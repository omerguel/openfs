/* ------------------------------------------------------------------ */
/* Human labels for SKR-04 accounts and booking types. The UI leads    */
/* with what an account is for ("Fahrstunden & Leistungen") and shows  */
/* the account number and tax rate as secondary information           */
/* ("… · 4400 · 19 %") — the Steuerberater still finds the number.     */
/* ------------------------------------------------------------------ */

import type { Account, TransactionType } from "./accounting-types";

const ACCOUNT_LABELS: Record<string, string> = {
  "1370": "Durchlaufender Posten (TÜV/DEKRA-Gebühr)",
  "1406": "Vorsteuer 19 %",
  "1460": "Geldtransit",
  "1600": "Kasse",
  "1800": "Bank",
  "2100": "Privatentnahme",
  "2180": "Privateinlage",
  "3272": "Ausbildungskonten (Anzahlungen)",
  "3806": "Umsatzsteuer 19 %",
  "4100": "Ausbildung steuerfrei (§ 4 Nr. 21 UStG)",
  "4300": "Leistungen 7 %",
  "4400": "Fahrstunden & Leistungen",
  "4830": "Mahngebühren (nicht steuerbar)",
  "6310": "Miete",
  "6520": "Kfz-Versicherung",
  "6530": "Kfz-Betriebskosten (Tanken, Pflege)",
  "6540": "Kfz-Reparaturen",
  "6815": "Bürobedarf",
  "7310": "Zinsen",
  "7685": "Kfz-Steuer",
  "9000": "Saldenvorträge (Übernahme)",
};

type AccountLike = Pick<Account, "number" | "name"> &
  Partial<Pick<Account, "vatRate" | "kind">>;

/** "Kasse" — falls back to the chart's own name. */
export function accountName(account: AccountLike): string {
  return ACCOUNT_LABELS[account.number] ?? account.name;
}

/** "Fahrstunden & Leistungen · 4400 · 19 %" (rate only for revenue/expense). */
export function accountLabel(account: AccountLike): string {
  const parts = [accountName(account), account.number];
  if (
    (account.kind === "erloes" || account.kind === "aufwand") &&
    account.vatRate != null
  ) {
    parts.push(account.vatRate === 0 ? "0 %" : `${account.vatRate} %`);
  }
  return parts.join(" · ");
}

/** Short explanation per booking type, shown in the booking dialog. */
export const TRANSACTION_TYPE_HELP: Record<TransactionType, string> = {
  zahlung_guthaben:
    "Geld geht auf das Ausbildungskonto des Fahrschülers (Anzahlung). Fahrstunden und Gebühren werden später davon abgerechnet.",
  direktzahlung:
    "Eine Leistung wird sofort bezahlt, ohne Umweg über das Ausbildungskonto (z. B. eine bar bezahlte Nachschulung).",
  guthaben_uebertragung:
    "Eine erbrachte Leistung (Fahrstunde, Prüfung, Gebühr) wird dem Ausbildungskonto belastet. Es fließt dabei kein Geld.",
  transfer: "Geld zwischen Kasse und Bank verschieben, z. B. Bareinzahlung auf die Bank.",
  ausgabe: "Betriebsausgabe aus Kasse oder Bank, z. B. Tanken oder Büromaterial.",
  saldovortrag:
    "Einmalige Übernahme eines Guthabens oder offenen Betrags aus der bisherigen Software.",
};

/** Dialog titles per booking type. */
export const TRANSACTION_TYPE_TITLES: Record<TransactionType, string> = {
  zahlung_guthaben: "Einzahlung erfassen",
  direktzahlung: "Sofort bezahlte Leistung erfassen",
  guthaben_uebertragung: "Leistung abrechnen",
  transfer: "Umbuchung zwischen Kasse und Bank",
  ausgabe: "Ausgabe erfassen",
  saldovortrag: "Saldovortrag erfassen",
};

/** "1 Position" / "3 Positionen" */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
