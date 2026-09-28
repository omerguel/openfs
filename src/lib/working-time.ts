/* ------------------------------------------------------------------ */
/* Instructor working time (Arbeitszeit) — shared constants.           */
/* ------------------------------------------------------------------ */

/** Fahrlehrergesetz: practical instruction may not exceed 495 minutes
    per instructor and day. */
export const MAX_PRACTICAL_MINUTES_PER_DAY = 495;

export const PRACTICAL_LIMIT_LABEL = `Tageshöchstdauer praktischer Unterricht (${MAX_PRACTICAL_MINUTES_PER_DAY} Min.) überschritten`;

/** Event types that count as practical instruction for the daily limit. */
export const PRACTICAL_EVENT_TYPES = ["Praktisch", "Vorstellung zur prakt. Prüfung"];

/** "2026-06-09" → "09.06.2026" */
export function formatGermanDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
