/* ------------------------------------------------------------------ */
/* Theorieunterricht — required units and derived status.              */
/*                                                                     */
/* FahrSchAusbO Anlage 2.2: 12 Doppelstunden Grundstoff (90 min each)  */
/* plus a class-specific Zusatzstoff. One recorded attendance of a     */
/* theory group (theory_attendance, attended = 1) counts as one        */
/* Doppelstunde. Only class counts we are sure about are listed;       */
/* anything else falls back to the class-B total of 14.                */
/* ------------------------------------------------------------------ */

import type { TheoryStatus } from "./student-data";

/** Grundstoff: 12 Doppelstunden for every class (Ersterwerb). */
export const THEORY_GRUNDSTOFF_UNITS = 12;

/** Klassenspezifischer Zusatzstoff in Doppelstunden. */
export const THEORY_CLASS_SPECIFIC_UNITS: Readonly<Record<string, number>> = {
  B: 2,
  AM: 2,
  A1: 4,
  A2: 4,
  A: 4,
};

/** Class B total (12 + 2) — also the fallback for unlisted classes. */
export const THEORY_REQUIRED_UNITS_B =
  THEORY_GRUNDSTOFF_UNITS + THEORY_CLASS_SPECIFIC_UNITS.B!;

/** Days without an attended unit before a learner counts as "Pausiert". */
export const THEORY_ACTIVE_DAYS = 30;

/** "B197" and "BF17" are class B variants (Schaltkompetenz / begleitetes Fahren). */
function baseClass(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (value === "B197" || value === "BF17" || value === "B96") return "B";
  return value;
}

/** Required Doppelstunden for a student's class list ("B, A1" → 16).
 *  With several classes the largest requirement wins. */
export function requiredTheoryUnits(classes: string): number {
  const known = classes
    .split(/[\s,;/+|]+/)
    .filter(Boolean)
    .map(baseClass)
    .map((klass) => THEORY_CLASS_SPECIFIC_UNITS[klass])
    .filter((units): units is number => units !== undefined);
  if (known.length === 0) return THEORY_REQUIRED_UNITS_B;
  return THEORY_GRUNDSTOFF_UNITS + Math.max(...known);
}

export function theoryProgress(attended: number, required: number): number {
  if (required <= 0) return 100;
  return Math.min(100, Math.round((attended / required) * 100));
}

/** ISO date `days` before `today` (UTC calendar arithmetic). */
function isoMinusDays(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** In Prüfung (Theorieprüfung scheduled ahead) > Bereit (all units) >
 *  Aktiv (attended within 30 days) > Pausiert. */
export function deriveTheoryStatus(input: {
  attended: number;
  required: number;
  lastSessionDate: string | null;
  examScheduled: boolean;
  today: string;
}): TheoryStatus {
  if (input.examScheduled) return "In Prüfung";
  if (input.attended >= input.required) return "Bereit";
  if (
    input.lastSessionDate &&
    input.lastSessionDate >= isoMinusDays(input.today, THEORY_ACTIVE_DAYS)
  ) {
    return "Aktiv";
  }
  return "Pausiert";
}
