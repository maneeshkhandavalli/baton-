-- Grants (§2, §8.3). Supabase grants API roles broad default privileges on new objects in `public`;
-- this migration revokes them and grants back exactly what each role needs.
--
--   anon           nothing at all.
--   authenticated  SELECT on RLS-protected tables; EXECUTE on RLS helpers, read API and user mutations.
--                  No INSERT/UPDATE/DELETE/TRUNCATE on any table: writes only through SECURITY DEFINER
--                  functions that check role, clearance and lifecycle.
--   service_role   SELECT on tables (it bypasses RLS) and EXECUTE on the server-only functions
--                  (token redemption, workers, privacy, account, purge). No direct writes either, so the
--                  append-only and lifecycle rules cannot be bypassed with the secret key.

revoke all on all tables in schema public from public, anon, authenticated, service_role;
revoke all on all sequences in schema public from public, anon, authenticated, service_role;
revoke execute on all functions in schema public from public, anon, authenticated, service_role;

alter default privileges in schema public revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated, service_role;

grant select on
  public.profiles, public.handovers, public.handover_members, public.sources,
  public.source_conversations, public.source_messages,
  public.handover_points, public.point_revisions, public.point_evidence, public.review_actions,
  public.gap_questions, public.gap_answers, public.processing_runs, public.processing_jobs,
  public.handover_publications, public.publication_points, public.acknowledgements, public.audit_logs,
  public.source_identity_confirmations, public.handover_member_directory
to authenticated;
-- access_tokens, access_token_questions, participant_erasures: never readable by clients (§8.4).

-- Identity hashes are pseudonymous identifiers and sensitive (§12.8 point 3); no DTO returns them (§11.6).
-- source_participants, source_exclusions and evidence_quotes are therefore readable by clients (under RLS)
-- column by column, WITHOUT their identity-hash columns, so a direct PostgREST select cannot read them
-- either. Server code reads hashes through SECURITY DEFINER functions only. (Database half of
-- contract-reconciliation Q1; the AddExclusionInput half is main's decision.)
do $$
declare
  v_table text;
  v_cols text;
begin
  foreach v_table in array array['source_participants', 'source_exclusions', 'evidence_quotes'] loop
    select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = v_table and c.column_name not like '%identity_hash';
    execute format('grant select (%s) on public.%I to authenticated', v_cols, v_table);
  end loop;
end $$;

grant select on all tables in schema public to service_role;

-- RLS helpers (evaluated as the querying user inside policies and the directory view).
grant execute on function
  public.access_rank(text), public.max_access(text, text),
  public.is_member(uuid), public.member_role(uuid), public.clearance(uuid), public.is_creator(uuid),
  public.is_review_role(uuid), public.within_clearance(uuid, text), public.point_visible(uuid),
  public.source_visible(uuid), public.gap_question_privacy_held(uuid), public.gap_answer_privacy_held(uuid),
  public.my_member_id(uuid), public.gap_question_visible_to_member(uuid), public.member_label(uuid, uuid),
  public.has_incoming_recipient(uuid), public.get_privacy_review(uuid), public.readiness_report(uuid, uuid),
  public.can_upload_source_object(text, text), public._source_json(public.sources)
to authenticated, service_role;

-- Read API (BatonQueries): user-scoped, RLS-protected.
grant execute on function
  public.api_list_my_handovers(), public.api_get_handover(uuid), public.api_list_members(uuid),
  public.api_list_sources(uuid), public.api_get_processing_status(uuid),
  public.api_list_points(uuid, text, text, text), public.api_get_point(uuid), public.api_list_gap_questions(uuid),
  public.api_get_readiness(uuid), public.api_get_published_handover(uuid),
  public.api_list_participants(uuid, uuid), public.api_list_exclusions(uuid),
  public.api_get_source_message_context(uuid, int, int), public.api_list_my_creator_transfer_offers(),
  public.get_account_deletion_blockers(), public.list_access_tokens(uuid, text, boolean)
to authenticated;

-- Application mutations (H1). SERVER ONLY: main's server actions call these with the service-role client,
-- passing the actor id from a verified session (auth.getUser). Every function re-validates that actor
-- (_require_actor) and its membership, role, clearance and lifecycle permissions itself. They are NOT
-- granted to authenticated, so a browser holding the public anon key cannot call them through PostgREST.
grant execute on function
  public.create_handover(uuid, text, text, text, text, text),
  public.start_processing(uuid, uuid, text, jsonb, jsonb),
  public.cancel_processing(uuid, uuid),
  public.publish_handover(uuid, uuid, text),
  public.start_revision(uuid, uuid),
  public.delete_handover(uuid, uuid),
  public.acknowledge_publication(uuid, uuid, text),
  public.approve_point(uuid, uuid, uuid, boolean, text, boolean),
  public.reject_point(uuid, uuid, text),
  public.reopen_point(uuid, uuid, text),
  public.edit_point(uuid, uuid, uuid, text, text, jsonb, text),
  public.confirm_inferred(uuid, uuid, text),
  public.resolve_conflict(uuid, uuid, text),
  public.exclude_evidence(uuid, uuid, uuid, text),
  public.restore_evidence(uuid, uuid, uuid),
  public.change_point_access(uuid, uuid, text),
  public.create_manual_point(uuid, uuid, text, text, text, jsonb, text, text, text, text),
  public.create_gap_question(uuid, uuid, uuid, text, text, text, text, text, uuid),
  public.submit_gap_answers(uuid, jsonb),
  public.review_gap_answer(uuid, uuid, text, text),
  public.create_source(uuid, uuid, text, text, text, bigint, text, text),
  public.source_upload_target(uuid, uuid),
  public.confirm_source_uploaded(uuid, uuid, bigint, text),
  public.record_source_consent(uuid, uuid, text, text, text, text, text, date),
  public.add_exclusion(uuid, uuid, text, text, text, text, text, text, text, text, text, timestamptz, timestamptz, text),
  public.confirm_identity_match(uuid, uuid, uuid, text),
  public.remove_source(uuid, uuid),
  public.create_gap_interview_link(uuid, uuid, bytea, uuid[], text, timestamptz, int),
  public.revoke_access_token(uuid, uuid),
  public.invite_member(uuid, uuid, text, text, text, bytea, timestamptz),
  public.update_member_clearance(uuid, uuid, text),
  public.remove_member(uuid, uuid),
  public.offer_creator_transfer(uuid, uuid, uuid),
  public.respond_to_creator_transfer(uuid, uuid, boolean)
to service_role;

-- Other server-only functions: token redemption, workers, privacy review, account (§8.3).
grant execute on function
  public.get_gap_interview(bytea),
  public.submit_gap_answers_with_token(bytea, text, jsonb),
  public.peek_member_invite(bytea),
  public.redeem_member_invite(bytea, uuid),
  public.finish_processing_run(uuid, text, text, text),
  public.claim_processing_jobs(int, int),
  public.set_job_provenance(uuid, jsonb),
  public.record_job_attempt(uuid, text, jsonb, text, text, timestamptz, int, int),
  public.persist_parsed_source(uuid, jsonb, text),
  public.mark_source_parse_failed(uuid, text),
  public.mark_source_raw_deleted(uuid),
  public.raw_source_for_processing(uuid),
  public.parse_exclusion_rules(uuid),
  public.insert_extracted_point(uuid, uuid, text, text, text, jsonb, text, text, jsonb, double precision),
  public.add_source_quote_evidence(uuid, uuid, text, int, int, text),
  public.record_quote_check(uuid, text),
  public.record_support_verdict(uuid, uuid, text, text, jsonb, bytea),
  public.create_system_gap_question(uuid, uuid, text, text, text, text, text),
  public.recompute_point_status(uuid),
  public.resolve_privacy_review(uuid, jsonb, text, uuid),
  public.erasure_target(uuid, uuid),
  public.check_account_deletion(uuid, text, uuid[]),
  public.delete_account_data(uuid, text),
  public.transfer_creator(uuid, uuid, uuid),
  public.consume_rate_limit(text, text),
  public.prune_rate_limit_counters()
to service_role;

-- H2 / D27: erase_participant and purge_handover are deliberately granted to NO application role.
-- They stay unreachable until the external recovery manifest (§12.8) exists and main adds a reviewed
-- migration granting them to the role that lib/recovery's write-ahead path uses. There is no
-- service-role fallback, and no baton_restore role is created (§12.8 point 10, assumption 13).
