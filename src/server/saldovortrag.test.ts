/* ------------------------------------------------------------------ */
/* Saldovortrag (opening balance from the previous software): engine   */
/* bookings + storno, the once-per-student rule, balances, FIFO open   */
/* items and the DATEV rows for SKR 04 account 9000.                   */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";

import type { CreateTransactionInput } from "../lib/accounting-types";
import { generateDatevExport } from "./datev";
import { DEFAULT_COMPANY, openDb, setCompany } from "./db";
import {
  createTransaction,
  listAccounts,
  listJournal,
  listLedger,
  listStudentBalances,
  stornoTransaction,
} from "./engine";
import { chargeRemainders } from "./invoices";
import type { Database } from "./sqlite";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
});

const STUDENT = {
  customerNo: "10051",
  name: "Aylin Demir",
  address: "Bleichstraße 9, 64283 Darmstadt",
  contractNo: "V-2026-0987",
  classes: "B197",
};

const vortrag = (
  direction: "guthaben" | "forderung",
  amountCents = 25_000,
  student = STUDENT,
): CreateTransactionInput => ({
  type: "saldovortrag",
  date: "2026-01-01",
  amountCents,
  direction,
  student,
});

const balanceOf = (customerNo: string) =>
  listStudentBalances(db).find((row) => row.customerNo === customerNo)?.balanceCents ?? 0;

describe("account 9000", () => {
  test("is seeded as Saldenvortragskonto without VAT", () => {
    const account = listAccounts(db).find((a) => a.number === "9000");
    expect(account).toMatchObject({
      name: "Saldenvorträge, Sachkonten",
      kind: "vortrag",
      vatRate: null,
      active: true,
    });
  });
});

describe("engine", () => {
  test("Guthaben: 9000 an 3272 with Beleg, no VAT split", () => {
    const created = createTransaction(db, vortrag("guthaben"));
    expect(created.belegNr).toMatch(/^T\d{7}A$/);
    expect(created.bookings).toEqual([
      { buchungNr: expect.any(String), soll: "9000", haben: "3272", amountCents: 25_000 },
    ]);
    const booking = db
      .query<{ vat_rate: number | null; vat_cents: number | null }, [number]>(
        "SELECT vat_rate, vat_cents FROM bookings WHERE transaction_id = ?",
      )
      .get(created.id)!;
    expect(booking).toEqual({ vat_rate: null, vat_cents: null });
    expect(balanceOf("10051")).toBe(25_000);
  });

  test("Forderung: 3272 an 9000 — the student owes", () => {
    const created = createTransaction(db, vortrag("forderung", 8_500));
    expect(created.bookings[0]).toMatchObject({ soll: "3272", haben: "9000" });
    expect(balanceOf("10051")).toBe(-8_500);
  });

  test("journal/ledger label it without VAT and without cash movement", () => {
    createTransaction(db, vortrag("guthaben"));
    const [row] = listJournal(db, {});
    expect(row).toMatchObject({
      type: "saldovortrag",
      typeLabel: "Saldovortrag",
      sollName: "Saldenvorträge, Sachkonten",
      vatRate: null,
      printable: false,
    });
    const ledger = listLedger(db, {});
    expect(ledger.rows[0]).toMatchObject({
      vatLabel: "Nicht zutreffend",
      incomeCents: null,
      expenseCents: null,
    });
  });

  test("only once per student unless the first one is storniert", () => {
    const first = createTransaction(db, vortrag("guthaben"));
    expect(() => createTransaction(db, vortrag("forderung"))).toThrow(
      "bereits ein Saldovortrag",
    );
    // Other students are unaffected.
    createTransaction(db, vortrag("guthaben", 100, { ...STUDENT, customerNo: "10052" }));

    const storno = stornoTransaction(db, first.id, "Betrag falsch", "2026-01-02");
    expect(storno.bookings[0]).toMatchObject({ soll: "3272", haben: "9000" });
    expect(storno.belegNr).not.toBeNull();
    expect(balanceOf("10051")).toBe(0);

    createTransaction(db, vortrag("guthaben", 30_000));
    expect(balanceOf("10051")).toBe(30_000);
  });

  test("validates direction, student and customer number", () => {
    expect(() =>
      createTransaction(db, { ...vortrag("guthaben"), direction: "x" } as never),
    ).toThrow("Richtung");
    expect(() =>
      createTransaction(db, { ...vortrag("guthaben"), student: undefined } as never),
    ).toThrow("Fahrschüler");
    expect(() =>
      createTransaction(db, vortrag("guthaben", 100, { ...STUDENT, customerNo: "" })),
    ).toThrow("Kundennummer");
    expect(() => createTransaction(db, vortrag("guthaben", 0))).toThrow("Betrag");
  });

  test("an opening Guthaben settles later charges (FIFO)", () => {
    createTransaction(db, vortrag("guthaben", 10_000));
    const charge = createTransaction(db, {
      type: "guthaben_uebertragung",
      date: "2026-02-01",
      amountCents: 15_000,
      habenKonto: "4400",
      student: STUDENT,
      description: "Fahrstunden",
    });
    expect(chargeRemainders(db, "10051").get(charge.id)).toBe(5_000);
  });
});

describe("DATEV export", () => {
  const exportRows = () => {
    setCompany(db, { ...DEFAULT_COMPANY, beraterNr: "29098", mandantNr: "55003" });
    const { bytes } = generateDatevExport(db, {
      from: "2026-01-01",
      to: "2026-12-31",
      createdAt: new Date(2026, 0, 5),
    });
    const lines = new TextDecoder("windows-1252").decode(bytes).trimEnd().split("\r\n");
    return lines.slice(2).map((line) => line.split(";"));
  };

  test("Guthaben: Konto 9000 S, Gegenkonto 3272 with BU 40", () => {
    createTransaction(db, vortrag("guthaben"));
    const [row] = exportRows();
    expect(row).toHaveLength(125);
    expect(row![0]).toBe("250,00");
    expect(row![1]).toBe('"S"');
    expect(row![6]).toBe("9000");
    expect(row![7]).toBe("3272");
    expect(row![8]).toBe('"40"');
    expect(row![9]).toBe("0101");
    expect(row![10]).toMatch(/^"T\d{7}A"$/);
  });

  test("Forderung and Storno keep 9000 as Konto (H) with BU 40", () => {
    const created = createTransaction(db, vortrag("forderung"));
    stornoTransaction(db, created.id, "Doppelt", "2026-01-02");
    const [forderung, storno] = exportRows();
    expect([forderung![1], forderung![6], forderung![7], forderung![8]]).toEqual([
      '"H"',
      "9000",
      "3272",
      '"40"',
    ]);
    expect([storno![1], storno![6], storno![7], storno![8]]).toEqual([
      '"S"',
      "9000",
      "3272",
      '"40"',
    ]);
  });
});
