/* ------------------------------------------------------------------ */
/* Global search (Strg/⌘ + K) — pure matching over data the app has    */
/* already loaded through the regular list APIs. See GlobalSearch.tsx.  */
/* ------------------------------------------------------------------ */

export type SearchKind = "Seite" | "Fahrschüler" | "Fahrlehrer" | "Fahrzeug" | "Rechnung";

export type SearchEntry = {
  key: string;
  kind: SearchKind;
  label: string;
  detail?: string;
  /** Path to open. */
  href: string;
  /** Matched as text (all query words must occur). */
  text: string[];
  /** Matched as digits only (spaces, dashes, +49 … ignored). */
  phones?: string[];
};

/** Lowercase, without accents; ß → ss, so "strasse" finds "Straße". */
export function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

export const onlyDigits = (value: string) => value.replace(/\D/g, "");

export function entryMatches(entry: SearchEntry, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return false;
  const haystack = normalizeSearch(entry.text.join(" "));
  if (q.split(/\s+/).every((word) => haystack.includes(word))) return true;
  const digits = onlyDigits(query);
  // Phone numbers: "0171 234" finds "+49 171 2345678" and "0171/2345678".
  if (digits.length >= 3 && /^[\d\s+()/-]+$/.test(query.trim())) {
    const local = digits.replace(/^(0049|49|0)/, "");
    return (entry.phones ?? []).some((phone) => {
      const p = onlyDigits(phone).replace(/^(0049|49|0)/, "");
      return p.includes(local) || onlyDigits(phone).includes(digits);
    });
  }
  return false;
}

const KIND_ORDER: SearchKind[] = [
  "Fahrschüler",
  "Rechnung",
  "Fahrlehrer",
  "Fahrzeug",
  "Seite",
];

/** Matching entries grouped by kind (in a fixed order), `perKind` each. */
export function searchEntries(
  entries: SearchEntry[],
  query: string,
  perKind = 6,
): { kind: SearchKind; items: SearchEntry[] }[] {
  const hits = entries.filter((entry) => entryMatches(entry, query));
  // Label starts with the query first (e.g. "Mül" → "Müller" before "Kemüller").
  const q = normalizeSearch(query);
  const starts = (entry: SearchEntry) =>
    normalizeSearch(entry.label).startsWith(q) ? 0 : 1;
  return KIND_ORDER.map((kind) => ({
    kind,
    items: hits
      .filter((entry) => entry.kind === kind)
      .sort((a, b) => starts(a) - starts(b))
      .slice(0, perKind),
  })).filter((group) => group.items.length > 0);
}
