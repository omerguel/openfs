/* ------------------------------------------------------------------ */
/* Wording for a student's balance (Guthabenkonto 3272). Positive =    */
/* the student has credit, negative = the student owes the school.     */
/* One helper so header badge, Übersicht, Zahlungserfassung and the    */
/* archive warning all say the same thing.                             */
/* ------------------------------------------------------------------ */

import { formatEuro } from "./money";

export type BalanceTone = "credit" | "debt" | "even";

export type BalanceWording = {
  /** "Guthaben" | "Offen" | "Ausgeglichen" */
  label: string;
  /** Unsigned amount, "200,00 EUR" (empty when even). */
  amount: string;
  tone: BalanceTone;
};

export function describeBalance(cents: number | null | undefined): BalanceWording {
  const value = cents ?? 0;
  if (value > 0) return { label: "Guthaben", amount: formatEuro(value), tone: "credit" };
  if (value < 0) return { label: "Offen", amount: formatEuro(-value), tone: "debt" };
  return { label: "Ausgeglichen", amount: formatEuro(0), tone: "even" };
}

/** Text color per tone — green = credit, red = debt, neutral otherwise. */
export const BALANCE_TONE_CLASS: Record<BalanceTone, string> = {
  credit: "text-emerald-600 dark:text-emerald-400",
  debt: "text-destructive",
  even: "text-foreground",
};

/** Dot color per tone for outline badges. */
export const BALANCE_DOT_CLASS: Record<BalanceTone, string> = {
  credit: "bg-emerald-500",
  debt: "bg-destructive",
  even: "bg-muted-foreground/50",
};
