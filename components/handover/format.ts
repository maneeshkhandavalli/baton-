/**
 * Deterministic date and size formatting. A fixed locale and time zone keep server and client
 * output identical (no hydration mismatches). Baton's v1 audience is in India (§15.1).
 */

const TZ = "Asia/Kolkata";

/**
 * Only NUMERIC parts come from Intl (stable across ICU versions); month names are fixed here. Locale
 * month abbreviations differ between ICU builds ("Sep" vs "Sept"), so server (Node) and browser
 * output could disagree and break hydration.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function zoned(d: Date): { y: number; m: number; d: number; hh: string; mm: string } {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: String(p.hour).padStart(2, "0"), mm: String(p.minute).padStart(2, "0") };
}

const valid = (d: Date) => !Number.isNaN(d.getTime());

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso);
  if (!valid(d)) return iso;
  const z = zoned(d);
  return `${z.d} ${MONTHS[z.m - 1]} ${z.y}`;
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!valid(d)) return iso;
  const z = zoned(d);
  return `${z.d} ${MONTHS[z.m - 1]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!valid(d)) return iso;
  const z = zoned(d);
  return `${z.d} ${MONTHS[z.m - 1]} ${z.y}, ${z.hh}:${z.mm}`;
}

export function formatDateRange(from: string | null, to: string | null): string {
  if (!from && !to) return "—";
  return `${formatShortDate(from)} – ${formatDate(to)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCount(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("en-IN");
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
}
