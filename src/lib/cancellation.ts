/* ------------------------------------------------------------------ */
/* Cancellation policy (Absage / Nichterscheinen) — shared types and   */
/* the pure "is this a late cancellation?" rule used by the dialog.    */
/* ------------------------------------------------------------------ */

export type CancellationKind = "abgesagt" | "nicht_erschienen";

export const CANCELLATION_KIND_LABELS: Record<CancellationKind, string> = {
  abgesagt: "Abgesagt",
  nicht_erschienen: "Nicht erschienen",
};

export type CancellationPolicy = {
  /** A cancellation later than this many hours before the start is late. */
  hoursBefore: number;
  /** Fixed fee in cents; 0 = use the student's per-lesson price. */
  feeCents: number;
};

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = {
  hoursBefore: 24,
  feeCents: 0,
};

/** True when `now` is less than `hoursBefore` hours before the lesson's
    start (or the lesson has already started). Date/time are local. */
export function isLateCancellation(
  date: string,
  start: string,
  hoursBefore: number,
  now: Date,
): boolean {
  const [y = 0, mo = 1, d = 1] = date.split("-").map(Number);
  const [h = 0, mi = 0] = start.split(":").map(Number);
  const startsAt = new Date(y, mo - 1, d, h, mi).getTime();
  return startsAt - now.getTime() < hoursBefore * 3_600_000;
}

/** A fee is suggested for no-shows and for late cancellations. */
export function suggestCancellationFee(
  kind: CancellationKind,
  event: { date: string; start: string },
  policy: CancellationPolicy,
  now: Date,
): boolean {
  if (kind === "nicht_erschienen") return true;
  return isLateCancellation(event.date, event.start, policy.hoursBefore, now);
}
