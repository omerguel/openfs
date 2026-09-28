/* ------------------------------------------------------------------ */
/* Student view of the ledger (Fahrschüler → Zahlungserfassung): every */
/* row carries what it credited to / charged against the student's     */
/* Guthaben, so Gezahlt − Kosten always equals the balance.            */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";

import { openDb } from "./db";
import {
  createTransaction,
  listLedger,
  listStudentBalances,
  stornoTransaction,
} from "./engine";
import type { Database } from "./sqlite";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:", { demoData: false });
});

const STUDENT = {
  customerNo: "1001",
  name: "Mia Schneider",
  address: "Rheinstraße 1, 64283 Darmstadt",
  contractNo: "V-2026-0001",
  classes: "B",
};

const rowsOf = () => listLedger(db, { customerNo: STUDENT.customerNo }).rows;
const balance = () =>
  listStudentBalances(db).find((b) => b.customerNo === STUDENT.customerNo)
    ?.balanceCents ?? 0;

/** What the Zahlungserfassung cards show: sums over active rows. */
function totals() {
  const active = rowsOf().filter((row) => !row.storniert && !row.isStorno);
  const paid = active.reduce((sum, row) => sum + (row.studentCreditCents ?? 0), 0);
  const costs = active.reduce((sum, row) => sum + (row.studentDebitCents ?? 0), 0);
  return { paid, costs };
}

describe("student ledger columns", () => {
  test("payment credits, charge debits — charges are no longer '-'", () => {
    createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-01",
      amountCents: 200_00,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: STUDENT,
    });
    createTransaction(db, {
      type: "guthaben_uebertragung",
      date: "2026-06-02",
      amountCents: 65_00,
      habenKonto: "4400",
      student: STUDENT,
      description: "Fahrübungsstunde (45)",
    });
    const [charge, payment] = rowsOf();
    expect(charge).toMatchObject({ studentCreditCents: null, studentDebitCents: 65_00 });
    expect(payment).toMatchObject({
      studentCreditCents: 200_00,
      studentDebitCents: null,
    });
    expect(totals()).toEqual({ paid: 200_00, costs: 65_00 });
    expect(balance()).toBe(135_00);
  });

  test("multi-line exam charge counts every line incl. pass-through fees", () => {
    createTransaction(db, {
      type: "guthaben_uebertragung",
      date: "2026-06-03",
      amountCents: 280_00 + 129_83,
      student: STUDENT,
      description: "Praktische Prüfung",
      lines: [
        { habenKonto: "4400", amountCents: 280_00, description: "Praktische Prüfung" },
        { habenKonto: "1370", amountCents: 129_83, description: "TÜV-Gebühr Praxis" },
      ],
    });
    expect(totals()).toEqual({ paid: 0, costs: 409_83 });
    expect(balance()).toBe(-409_83);
  });

  test("Saldovortrag: Forderung is a cost, Guthaben a credit", () => {
    createTransaction(db, {
      type: "saldovortrag",
      date: "2026-01-01",
      amountCents: 85_00,
      direction: "forderung",
      student: STUDENT,
    });
    expect(totals()).toEqual({ paid: 0, costs: 85_00 });
    expect(balance()).toBe(-85_00);
  });

  test("Direktzahlung is paid and consumed at once — balance unchanged", () => {
    createTransaction(db, {
      type: "direktzahlung",
      date: "2026-06-04",
      amountCents: 50_00,
      geldkonto: "1600",
      habenKonto: "4400",
      paymentMethod: "bar",
      student: STUDENT,
      description: "Lernmaterial",
    });
    expect(totals()).toEqual({ paid: 50_00, costs: 50_00 });
    expect(balance()).toBe(0);
  });

  test("storniert rows drop out; paid − costs always equals the balance", () => {
    const payment = createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-01",
      amountCents: 300_00,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: STUDENT,
    });
    createTransaction(db, {
      type: "guthaben_uebertragung",
      date: "2026-06-02",
      amountCents: 65_00,
      habenKonto: "4400",
      student: STUDENT,
      description: "Fahrübungsstunde (45)",
    });
    stornoTransaction(db, payment.id, "Falscher Betrag", "2026-06-05");
    const { paid, costs } = totals();
    expect({ paid, costs }).toEqual({ paid: 0, costs: 65_00 });
    expect(paid - costs).toBe(balance());
  });

  test("bookings without a student carry no student columns", () => {
    createTransaction(db, {
      type: "ausgabe",
      date: "2026-06-01",
      amountCents: 10_00,
      geldkonto: "1600",
      aufwandKonto: "6815",
      description: "Büromaterial",
    });
    const [row] = listLedger(db, {}).rows;
    expect(row).toMatchObject({ studentCreditCents: null, studentDebitCents: null });
  });
});
