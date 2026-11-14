/**
 * Why a single source failed to be read (SourceSummary.errorCode), in plain language for the processing
 * page. Codes come from the parse stage (lib/pipeline/stages/parse.ts: parser and parser-input codes,
 * identity and exclusion checks) and the raw-file integrity check (lib/db/storage.ts). Pure and React-free.
 */

const SOURCE_ERRORS: Record<string, string> = {
  // Problems with the file itself (lib/parsers/errors.ts).
  unsupported_format: "This file type or layout isn't supported. Export it again, or add it as a PDF, Word or text file.",
  empty_source: "The file doesn't contain any messages or text.",
  encoding_error: "The file's text encoding couldn't be read. Export it again as UTF-8 text.",
  date_format_ambiguous: "The dates could be day-first or month-first. Add the file again and choose the date order.",
  too_large: "The file is larger than Baton can read in one go. Try a shorter export.",
  corrupt_file: "The file looks damaged or incomplete. Export it again and re-add it.",
  password_protected: "The file is password-protected. Remove the password and add it again.",
  no_text_layer: "The PDF has no selectable text (it may be scanned). Scanned documents aren't supported.",
  // Problems with the reading settings.
  timezone_invalid: "The timezone saved with this source isn't valid. Add the file again.",
  date_order_invalid: "The date order saved with this source isn't valid. Add the file again and choose the date order.",
  exclusion_invalid: "One of the leave-out rules for this source is malformed, so the file wasn't read.",
  exclusion_context_mismatch: "A left-out conversation was chosen on an older preview. Confirm it again in the draft.",
  input_invalid: "The reading settings for this source were incomplete.",
  // Privacy checks (§6.8).
  identity_confirmation_required: "Confirm whether the people matched in this chat are the ones who asked to be left out, then try again.",
  excluded_participant_content: "Content from someone who asked to be left out was found, so Baton stopped reading this source.",
  integrity_mismatch: "The stored file doesn't match what was uploaded. Remove it and upload it again.",
};

/** Plain-language reason for a failed source, with the raw code kept as a reference for support. */
export function sourceErrorText(code: string | null | undefined): { text: string; reference: string | null } {
  if (!code) return { text: "Baton couldn't read this source.", reference: null };
  const known = SOURCE_ERRORS[code];
  return { text: known ?? "Baton couldn't read this source.", reference: code };
}
