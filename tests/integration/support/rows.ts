/**
 * Valid snake_case rows as the read API (supabase/migrations/…_read_api.sql) returns them, so the real
 * lib/db mappers accept the re-reads that follow a mutation. Synthetic, masked content only.
 */

const NOW = "2026-11-12T10:00:00.000Z";

export function handoverRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id, title: "Handover", team_name: "Team", role_title: null, state: "in_review",
    viewer_role: "outgoing", viewer_is_creator: true, viewer_clearance: "reviewer_only",
    current_publication_id: null, pending_creator_transfer: null, created_at: NOW, updated_at: NOW, ...over,
  };
}

export function sourceRow(id: string, handoverId: string, over: Record<string, unknown> = {}) {
  return {
    id, handover_id: handoverId, kind: "whatsapp_export", title: "chat.txt", state: "uploaded", access_level: "everyone",
    size_bytes: 1000, consent_recorded_at: NOW, raw_deleted_at: null, first_message_at: null, last_message_at: null,
    message_count: null, masking_counts: null, error_code: null, ...over,
  };
}

export function pointDetailRow(id: string, category = "decision", over: Record<string, unknown> = {}) {
  return {
    id, category, title: "A point", statement: "A statement", evidence_status: "inferred", review_state: "pending",
    access_level: "everyone", is_potentially_outdated: false, origin: "extracted", evidence_count: 0,
    privacy_review: "none", last_supported_at: null, updated_at: NOW,
    current_revision_id: "00000000-0000-4000-8000-0000000000aa", revision_number: 1, attributes: {},
    inference_rationale: null, privacy_review_flagged_at: null, privacy_review_reason: null, privacy_review_set: null,
    inferred_confirmation: null, conflict_resolution: null, evidence: [], revisions: [], review_history: [], ...over,
  };
}

export function gapQuestionRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id, point_id: null, category: "owner", question: "Q?", context: null, priority: "optional", status: "open",
    privacy_held: false, answers: [], ...over,
  };
}
