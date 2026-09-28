/* ------------------------------------------------------------------ */
/* Saldovortrag (opening balance from the previous software): engine   */
/* bookings + storno, the once-per-student rule, balances, FIFO open   */
/* items, the DATEV rows for SKR 04 account 9000 and payments that     */
/* settle an opening debt (no Anzahlungs-USt, BU 40 in DATEV).         */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";

import type { CreateTransactionInput } from "../lib/accounting-types";
import { splitVat } from "../lib/money";
import { vatReport } from "./accounting-reports";
import { generateDatevExport } from "./datev";
import { DEFAULT_COMPANY, openDb, setCompany } from "./db";
import {
  createTransaction,
  getQuittung,
  listAccounts,
  listJournal,
  listLedger,
  listStudentBalances,
  stornoTransaction,
} from "./engine";
import { chargeRemainders, listOpeningBalances } from "./invoices";
import { unsettledOpeningDebt } from "./open-items";
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

describe("payment settling an opening debt", () => {
  type Line = {
    soll_account: string;
    haben_account: string;
    amount_cents: number;
    vat_rate: number | null;
    vat_cents: number | null;
    line_description: string;
  };
  const linesOf = (transactionId: number) =>
    db
      .query<Line, [number]>(
        `SELECT soll_account, haben_account, amount_cents, vat_rate, vat_cents,
                line_description
         FROM bookings WHERE transaction_id = ? ORDER BY id`,
      )
      .all(transactionId);
  const pay = (amountCents: number, date = "2026-02-01", student = STUDENT) =>
    createTransaction(db, {
      type: "zahlung_guthaben",
      date,
      amountCents,
      geldkonto: "1800",
      paymentMethod: "ueberweisung",
      student,
    });
  const settlement = (amount: number): Line => ({
    soll_account: "1800",
    haben_account: "3272",
    amount_cents: amount,
    vat_rate: null,
    vat_cents: null,
    line_description: "Ausgleich Saldovortrag",
  });
  const anzahlung = (amount: number): Line => ({
    soll_account: "1800",
    haben_account: "3272",
    amount_cents: amount,
    vat_rate: 19,
    vat_cents: splitVat(amount, 19).vatCents,
    line_description: "Zahlung auf Ausbildungskonto",
  });
  const openDebt = () =>
    listOpeningBalances(db, "2026-03-01", { includeSettled: true })[0]?.openCents;

  test("smaller than the debt: all of it settles, no VAT", () => {
    createTransaction(db, vortrag("forderung", 25_000));
    const paid = pay(10_000);
    expect(linesOf(paid.id)).toEqual([settlement(10_000)]);
    expect(unsettledOpeningDebt(db, "10051")).toBe(15_000);
    expect(openDebt()).toBe(15_000);
    expect(balanceOf("10051")).toBe(-15_000);
  });

  test("equal to the debt: settles it completely, no VAT", () => {
    createTransaction(db, vortrag("forderung", 25_000));
    const paid = pay(25_000);
    expect(linesOf(paid.id)).toEqual([settlement(25_000)]);
    expect(unsettledOpeningDebt(db, "10051")).toBe(0);
    expect(openDebt()).toBe(0);
    expect(balanceOf("10051")).toBe(0);
  });

  test("larger than the debt: split into settlement and Anzahlung with 19 %", () => {
    createTransaction(db, vortrag("forderung", 25_000));
    const paid = pay(30_000);
    expect(paid.bookings.map((b) => b.amountCents)).toEqual([25_000, 5_000]);
    expect(linesOf(paid.id)).toEqual([settlement(25_000), anzahlung(5_000)]);
    expect(balanceOf("10051")).toBe(5_000);
    expect(openDebt()).toBe(0);
  });

  test("partial payments settle the rest, later payments carry full VAT", () => {
    createTransaction(db, vortrag("forderung", 25_000));
    pay(10_000);
    const second = pay(20_000, "2026-02-10");
    expect(linesOf(second.id)).toEqual([settlement(15_000), anzahlung(5_000)]);
    const third = pay(11_900, "2026-02-20");
    expect(linesOf(third.id)).toEqual([anzahlung(11_900)]);
  });

  test("Storno reverses both lines and restores the debt", () => {
    createTransaction(db, vortrag("forderung", 25_000));
    const paid = pay(30_000);
    const storno = stornoTransaction(db, paid.id, "Fehlbuchung", "2026-02-02");
    expect(linesOf(storno.id)).toEqual([
      {
        ...settlement(25_000),
        soll_account: "3272",
        haben_account: "1800",
        line_description: `Storno ${paid.bookings[0]!.buchungNr}: Ausgleich Saldovortrag`,
      },
      {
        ...anzahlung(5_000),
        soll_account: "3272",
        haben_account: "1800",
        line_description: `Storno ${paid.bookings[1]!.buchungNr}: Zahlung auf Ausbildungskonto`,
      },
    ]);
    expect(unsettledOpeningDebt(db, "10051")).toBe(25_000);
    expect(openDebt()).toBe(25_000);
    expect(balanceOf("10051")).toBe(-25_000);

    const again = pay(25_000, "2026-02-03");
    expect(linesOf(again.id)).toEqual([settlement(25_000)]);
    expect(openDebt()).toBe(0);
  });

  test("the debt is settled before later charges (FIFO, as the Offene Posten)", () => {
    createTransaction(db, vortrag("forderung", 10_000));
    createTransaction(db, {
      type: "guthaben_uebertragung",
      date: "2026-01-15",
      amountCents: 5_000,
      habenKonto: "4400",
      student: STUDENT,
      description: "Fahrstunde",
    });
    const paid = pay(12_000);
    expect(linesOf(paid.id)).toEqual([settlement(10_000), anzahlung(2_000)]);
  });

  test("students without an open Saldovortrag forderung are unchanged", () => {
    const other = { ...STUDENT, customerNo: "10052" };
    createTransaction(db, vortrag("forderung", 25_000));
    expect(linesOf(pay(10_000, "2026-02-01", other).id)).toEqual([anzahlung(10_000)]);

    const guthaben = { ...STUDENT, customerNo: "10053" };
    createTransaction(db, vortrag("guthaben", 25_000, guthaben));
    expect(linesOf(pay(10_000, "2026-02-01", guthaben).id)).toEqual([anzahlung(10_000)]);

    const storniert = { ...STUDENT, customerNo: "10054" };
    const opening = createTransaction(db, vortrag("forderung", 25_000, storniert));
    stornoTransaction(db, opening.id, "falsch", "2026-01-02");
    expect(linesOf(pay(10_000, "2026-02-01", storniert).id)).toEqual([anzahlung(10_000)]);
  });

  test("ledger and Quittung show the settlement without VAT", () => {
    createTransaction(db, vortrag("forderung", 25_000));
    const settling = pay(10_000);
    const mixed = pay(20_000, "2026-02-05");
    const rows = listLedger(db, {}).rows;
    const row = (id: number) => rows.find((r) => r.id === id)!;
    expect(row(settling.id)).toMatchObject({
      vatLabel: "Nicht zutreffend",
      incomeCents: 10_000,
      studentCreditCents: 10_000,
    });
    expect(row(mixed.id)).toMatchObject({
      vatLabel: "19%",
      incomeCents: 20_000,
      studentCreditCents: 20_000,
    });
    const quittung = getQuittung(db, mixed.id);
    expect(quittung.totalCents).toBe(20_000);
    expect(quittung.lines).toMatchObject([
      {
        description: "Ausgleich Saldovortrag",
        grossCents: 15_000,
        vatRate: null,
        vatCents: 0,
      },
      { grossCents: 5_000, vatRate: 19, vatCents: splitVat(5_000, 19).vatCents },
    ]);
  });

  test("VAT report counts only the Anzahlung part", () => {
    createTransaction(db, vortrag("forderung", 25_000));
    pay(30_000);
    const report = vatReport(db, 2026, "month");
    expect(report.periods[0]!.prepayment19VatCents).toBe(0);
    expect(report.periods[1]!.prepayment19NetCents).toBe(splitVat(5_000, 19).netCents);
    expect(report.periods[1]!.prepayment19VatCents).toBe(splitVat(5_000, 19).vatCents);
    expect(report.total.outputVatCents).toBe(splitVat(5_000, 19).vatCents);
  });

  test("VAT report: a storniert settling payment nets to zero", () => {
    createTransaction(db, vortrag("forderung", 25_000));
    const paid = pay(30_000);
    stornoTransaction(db, paid.id, "Fehlbuchung", "2026-02-02");
    const february = vatReport(db, 2026, "month").periods[1]!;
    expect(february.prepayment19NetCents).toBe(0);
    expect(february.prepayment19VatCents).toBe(0);
  });
});

describe("DATEV export of a settling payment", () => {
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
  const key = (row: string[] | undefined) => [
    row![0],
    row![1],
    row![6],
    row![7],
    row![8],
  ];

  test("settlement line gets BU 40, the Anzahlung part stays automatic", () => {
    createTransaction(db, vortrag("forderung", 25_000));
    const paid = createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-02-01",
      amountCents: 30_000,
      geldkonto: "1800",
      paymentMethod: "ueberweisung",
      student: STUDENT,
    });
    stornoTransaction(db, paid.id, "Fehlbuchung", "2026-02-02");
    const [opening, settle, rest, stornoSettle, stornoRest] = exportRows();
    expect(key(opening)).toEqual(["250,00", '"H"', "9000", "3272", '"40"']);
    expect(key(settle)).toEqual(["250,00", '"S"', "1800", "3272", '"40"']);
    expect(key(rest)).toEqual(["50,00", '"S"', "1800", "3272", ""]);
    // Storno: the Automatikkonto stays Gegenkonto with BU 40.
    expect(key(stornoSettle)).toEqual(["250,00", '"H"', "1800", "3272", '"40"']);
    expect(key(stornoRest)).toEqual(["50,00", '"S"', "3272", "1800", ""]);
  });
});
