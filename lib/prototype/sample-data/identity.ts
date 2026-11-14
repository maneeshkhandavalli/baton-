/**
 * PROTOTYPE: how sample data is recognised, without loading the sample content itself (that lives in
 * ./codecell.ts and is only imported on demand). Pure; safe in client and server code.
 */

/** Every sample upload's file name starts with this, so a row stays recognisable after a reload. */
export const SAMPLE_FILE_PREFIX = "Sample - CodeCell";

/** The sample upload file names (content in ./codecell.ts). Lets the UI show "added" without loading content. */
export const SAMPLE_SOURCE_FILE_NAMES = [`${SAMPLE_FILE_PREFIX} core team chat.txt`, `${SAMPLE_FILE_PREFIX} infrastructure notes.md`] as const;

/** Sample review points start with this, so demo points are visibly demo points in the review. */
export const SAMPLE_POINT_TITLE_PREFIX = "Sample: ";

/** True for a sample source's file name or stored title (the title is derived from the file name). */
export function isSampleFileName(name: string | null | undefined): boolean {
  return typeof name === "string" && name.trim().startsWith(SAMPLE_FILE_PREFIX);
}

const bare = (n: string) => n.trim().replace(/\.(txt|md|markdown)$/i, "");

/** The given sample entries whose file names are not already in `existingNames` (extension-insensitive). */
export function missingByName<T extends { fileName: string }>(samples: readonly T[], existingNames: readonly string[]): T[] {
  const have = new Set(existingNames.map(bare));
  return samples.filter((s) => !have.has(bare(s.fileName)));
}
