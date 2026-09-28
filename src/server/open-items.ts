/* ------------------------------------------------------------------ */
/* Offene Posten: FIFO allocation of a student's payments to charges.  */
/*                                                                     */
/* Shared by the invoicing module (open invoices, Saldovortrag         */
/* reminders) and the booking engine (which part of a payment settles  */
/* an opening debt from the previous software and therefore carries   */
/* no Anzahlungs-USt). Reads bookings only — no engine dependency.     */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

/** Line description of the no-VAT part of a payment that settles an opening debt. */
export const SALDOVORTRAG_SETTLEMENT_LINE = "Ausgleich Saldovortrag";

export type ChargeRow = {
  id: number;
  type: "guthaben_uebertragung" | "saldovortrag";
  date: string;
  description: string;
  gross_cents: number;
};

/* Active charges of a student: guthaben_uebertragung that is neither a
   Storno nor storniert, plus an opening debt taken over as Saldovortrag
   (3272 an 9000) — it is owed like a charge and settled by payments,
   but never invoiced. Oldest first — the FIFO order. */
export function activeCharges(db: Database, customerNo: string): ChargeRow[] {
  return db
    .query<ChargeRow, [string]>(
      `SELECT t.id, t.type, t.date, t.description, SUM(b.amount_cents) AS gross_cents
       FROM transactions t JOIN bookings b ON b.transaction_id = t.id
       WHERE (t.type = 'guthaben_uebertragung'
              OR (t.type = 'saldovortrag' AND b.soll_account = '3272'))
         AND t.storno_of IS NULL AND t.storniert_by IS NULL
         AND t.student_customer_no = ?
       GROUP BY t.id
       ORDER BY t.date, t.id`,
    )
    .all(customerNo);
}

/* Payments plus an opening Guthaben taken over as Saldovortrag
   (9000 an 3272) — both settle charges oldest-first. A payment counts
   in full, whether or not part of it was booked as Saldovortrag
   settlement (all its lines credit 3272). */
function paymentPool(db: Database, customerNo: string): number {
  return (
    db
      .query<{ total: number | null }, [string]>(
        `SELECT SUM(b.amount_cents) AS total
         FROM transactions t JOIN bookings b ON b.transaction_id = t.id
         WHERE (t.type = 'zahlung_guthaben'
                OR (t.type = 'saldovortrag' AND b.haben_account = '3272'))
           AND t.storno_of IS NULL AND t.storniert_by IS NULL
           AND t.student_customer_no = ?`,
      )
      .get(customerNo)!.total ?? 0
  );
}

/** Uncovered remainder per active charge (transaction id → cents). */
export function chargeRemainders(db: Database, customerNo: string): Map<number, number> {
  let pool = paymentPool(db, customerNo);
  const remainders = new Map<number, number>();
  for (const charge of activeCharges(db, customerNo)) {
    const covered = Math.min(pool, charge.gross_cents);
    pool -= covered;
    remainders.set(charge.id, charge.gross_cents - covered);
  }
  return remainders;
}

/**
 * Still-unsettled part of the student's opening debt (active Saldovortrag
 * "forderung", 3272 an 9000) — what the next payment settles without VAT.
 *
 * It is the FIFO remainder the Offene Posten show for the Saldovortrag,
 * capped by the debt minus the settlement lines already booked on active
 * payments. The cap keeps the VAT-free total within the debt even if the
 * FIFO order shifts later (e.g. an older charge is storniert), so no more
 * than the opening debt is ever booked without Anzahlungs-USt. Payments
 * booked before this rule existed carry no settlement line; the FIFO
 * remainder already counts them as having settled the debt.
 */
export function unsettledOpeningDebt(db: Database, customerNo: string): number {
  if (!customerNo) return 0;
  const debt = activeCharges(db, customerNo).find((c) => c.type === "saldovortrag");
  if (!debt) return 0;
  const fifoOpen = chargeRemainders(db, customerNo).get(debt.id) ?? 0;
  const settled =
    db
      .query<{ total: number | null }, [string, string]>(
        `SELECT SUM(b.amount_cents) AS total
         FROM transactions t JOIN bookings b ON b.transaction_id = t.id
         WHERE t.type = 'zahlung_guthaben' AND b.vat_rate IS NULL
           AND b.line_description = ?
           AND t.storno_of IS NULL AND t.storniert_by IS NULL
           AND t.student_customer_no = ?`,
      )
      .get(SALDOVORTRAG_SETTLEMENT_LINE, customerNo)!.total ?? 0;
  return Math.max(0, Math.min(fifoOpen, debt.gross_cents - settled));
}
