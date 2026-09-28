/* ------------------------------------------------------------------ */
/* First-run setup of a real (non-demo) school: company master data    */
/* and the opening balances of Kasse (1600) and Bank (1800). Runs      */
/* inside POST /api/auth/setup right after the first Inhaber account   */
/* was created. Opening balances are Stammdaten of the Geldkonten, not */
/* bookings — they can only be set while no transaction exists yet.    */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import { getCompany, setCompany } from "./db";
import { ValidationError } from "./errors";

type SetupBody = {
  schoolName?: unknown;
  address?: unknown;
  phone?: unknown;
  schoolEmail?: unknown;
  openingDate?: unknown;
  kasseCents?: unknown;
  bankCents?: unknown;
};

function optionalCents(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ValidationError(`${label} muss ein Betrag in Cent sein.`);
  }
  return value;
}

export function applySetup(db: Database, body: SetupBody) {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const name = text(body.schoolName);
  if (!name) throw new ValidationError("Bitte den Namen der Fahrschule angeben.");
  setCompany(db, {
    ...getCompany(db),
    name,
    address: text(body.address),
    phone: text(body.phone),
    email: text(body.schoolEmail),
  });

  const kasse = optionalCents(body.kasseCents, "Kassenbestand");
  const bank = optionalCents(body.bankCents, "Bankbestand");
  if (kasse == null && bank == null) return;
  const date = text(body.openingDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ValidationError("Bitte das Datum der Anfangsbestände angeben.");
  }
  setOpeningBalances(db, date, { "1600": kasse, "1800": bank });
}

export function setOpeningBalances(
  db: Database,
  date: string,
  balances: Record<"1600" | "1800", number | null>,
) {
  const booked = db
    .query<{ n: number }, []>("SELECT count(*) AS n FROM transactions")
    .get()!.n;
  if (booked > 0) {
    throw new ValidationError(
      "Anfangsbestände können nur vor der ersten Buchung festgelegt werden.",
    );
  }
  const update = db.prepare(
    "UPDATE accounts SET opening_cents = ?, opening_date = ? WHERE number = ?",
  );
  for (const [number, cents] of Object.entries(balances)) {
    if (cents != null) update.run(cents, date, number);
  }
}
