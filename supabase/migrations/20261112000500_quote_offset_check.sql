-- QA-M1b (release triage, 2026-11-12): exact quotes must sit at their stored offsets.
-- Offsets are JavaScript UTF-16 code units. When the message body contains no characters outside the
-- Basic Multilingual Plane, UTF-16 units and Postgres characters coincide, so the database can check the
-- offsets exactly: an `exact` quote must equal substr(body, start + 1, end - start), and every verified
-- quote must lie inside the body. Bodies with astral characters (emoji etc.) keep the containment rule.
-- CREATE OR REPLACE with an unchanged signature; the helper stays non-executable by API roles.

create or replace function public._quote_check_plausible(p_check text, p_quote text, p_start int, p_end int, p_body text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_check in ('pending', 'not_found') then true
    when p_check in ('exact', 'normalized') then
      p_start is not null and p_end is not null and p_body is not null and p_start >= 0 and p_end > p_start
      and p_end <= 2 * char_length(p_body) and char_length(btrim(p_quote)) >= 12
      and (p_check <> 'exact' or strpos(p_body, p_quote) > 0)
      and (p_body ~ '[\U00010000-\U0010FFFF]'          -- astral characters: offsets cannot be compared in SQL
           or (p_end <= char_length(p_body)
               and (p_check <> 'exact' or substr(p_body, p_start + 1, p_end - p_start) = p_quote)))
    else false end
$$;
