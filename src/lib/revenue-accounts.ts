/* ------------------------------------------------------------------ */
/* Erlöskonten offered when pricing or billing a student's service.    */
/* Human labels first, the SKR 04 account as secondary information —   */
/* the office thinks in "Fahrstunde" and "TÜV-Gebühr", the             */
/* Steuerberater in 4400 and 1370.                                     */
/* ------------------------------------------------------------------ */

export type RevenueAccountOption = {
  account: string;
  /** Short label for a narrow trigger, e.g. "19 % USt". */
  short: string;
  /** Full label in the list, e.g. "Leistungen (19 % USt)". */
  label: string;
  hint: string;
};

export const REVENUE_ACCOUNT_OPTIONS: RevenueAccountOption[] = [
  {
    account: "4400",
    short: "Leistung 19 %",
    label: "Leistungen (19 % USt)",
    hint: "Fahrstunden, Grundbetrag, Prüfungsvorstellung",
  },
  {
    account: "4300",
    short: "Leistung 7 %",
    label: "Ermäßigt (7 % USt)",
    hint: "z. B. Lehrmaterial",
  },
  {
    account: "4100",
    short: "Steuerfrei",
    label: "Steuerfrei",
    hint: "nach Absprache mit dem Steuerberater",
  },
  {
    account: "1370",
    short: "TÜV/DEKRA-Gebühr",
    label: "TÜV/DEKRA-Gebühr (durchlaufender Posten)",
    hint: "ohne Umsatzsteuer weitergereicht",
  },
];

export function revenueAccountOption(account: string | null | undefined) {
  return (
    REVENUE_ACCOUNT_OPTIONS.find((option) => option.account === (account || "4400")) ??
    null
  );
}
