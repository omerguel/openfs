/* ------------------------------------------------------------------ */
/* Fahrzeug details: HU month ("Nächste HU", stored as MM/JJJJ) and     */
/* Kilometerstand ("84.320 km"). The HU is due by the end of its month; */
/* the Fahrzeuge list and the dashboard warn 60 days ahead.             */
/* ------------------------------------------------------------------ */

export const HU_WARN_DAYS = 60;

export type HuMonth = { year: number; month: number };
export type HuState = "overdue" | "due" | "ok";

/** "03/2027" or "2027-03" → { year, month }; anything else → null. */
export function parseHuMonth(value: string | undefined | null): HuMonth | null {
  const text = (value ?? "").trim();
  const mmYyyy = /^(\d{1,2})\s*[/.]\s*(\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})$/.exec(text);
  const month = Number(mmYyyy ? mmYyyy[1] : iso?.[2]);
  const year = Number(mmYyyy ? mmYyyy[2] : iso?.[1]);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !year) return null;
  return { year, month };
}

export function formatHuMonth({ year, month }: HuMonth): string {
  return `${String(month).padStart(2, "0")}/${year}`;
}

/** Overdue after the HU month; "due" within `warnDays` before its end. */
export function huState(
  value: string | undefined | null,
  today = new Date(),
  warnDays = HU_WARN_DAYS,
): HuState | null {
  const hu = parseHuMonth(value);
  if (!hu) return null;
  const endOfMonth = new Date(hu.year, hu.month, 0, 23, 59, 59);
  if (today > endOfMonth) return "overdue";
  const days = (endOfMonth.getTime() - today.getTime()) / 86_400_000;
  return days <= warnDays ? "due" : "ok";
}

export const HU_STATE_LABELS: Record<Exclude<HuState, "ok">, string> = {
  overdue: "HU überfällig",
  due: "HU bald fällig",
};

/** "84.320 km" / "84320" → "84320" (digits only, for a numeric input). */
export function mileageDigits(value: string | undefined | null): string {
  return (value ?? "").replace(/\D/g, "");
}

/** "84320" → "84.320 km" ("" stays ""). */
export function formatMileage(digits: string): string {
  const clean = mileageDigits(digits);
  return clean ? `${Number(clean).toLocaleString("de-DE")} km` : "";
}
