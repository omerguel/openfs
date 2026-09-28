import { beforeEach, describe, expect, test } from "bun:test";

import {
  cashbookCsv,
  getCashbook,
  journalCsv,
  listGeldkontoBalances,
  vatReport,
} from "./accounting-reports";
import { openDb } from "./db";
import { createTransaction, listJournal, listLedger, stornoTransaction } from "./engine";
import type { Database } from "./sqlite";

let db: Database;

const STUDENT = {
  customerNo: "R-1",
  name: "Rita Report",
  address: "",
  contractNo: "V-R-1",
  classes: "B",
};

beforeEach(() => {
  db = openDb(":memory:");
});

function payCash(amountCents: number, date: string) {
  return createTransaction(db, {
    type: "zahlung_guthaben",
    date,
    amountCents,
    geldkonto: "1600",
    paymentMethod: "bar",
    student: STUDENT,
  }).id;
}

function charge(amountCents: number, date: string, habenKonto: string) {
  return createTransaction(db, {
    type: "guthaben_uebertragung",
    date,
    amountCents,
    habenKonto,
    student: STUDENT,
    description: "Leistung",
  }).id;
}

describe("Kasse/Bank balances and Kassenbuch", () => {
  test("current balance per Geldkonto includes every movement", () => {
    const [kasse] = listGeldkontoBalances(db, "2026-09-28");
    const opening = kasse!.openingCents;
    payCash(10_000, "2026-09-01");
    createTransaction(db, {
      type: "ausgabe",
      date: "2026-09-02",
      amountCents: 2_500,
      geldkonto: "1600",
      aufwandKonto: "6815",
      paymentMethod: "bar",
      description: "Druckerpapier",
    });
    createTransaction(db, {
      type: "transfer",
      date: "2026-09-03",
      amountCents: 5_000,
      fromKonto: "1600",
      toKonto: "1800",
    });
    payCash(1_000, "2026-10-15"); // future-dated
    const balances = new Map(
      listGeldkontoBalances(db, "2026-09-28").map((b) => [b.number, b]),
    );
    expect(balances.get("1600")!.todayCents).toBe(opening + 10_000 - 2_500 - 5_000);
    expect(balances.get("1600")!.balanceCents).toBe(
      opening + 10_000 - 2_500 - 5_000 + 1_000,
    );
    expect(balances.get("1800")!.balanceCents - balances.get("1800")!.openingCents).toBe(
      5_000,
    );
  });

  test("Kassenbuch has running balance, range totals and a CSV with totals", () => {
    payCash(10_000, "2026-08-31");
    payCash(20_000, "2026-09-01");
    charge(5_000, "2026-09-02", "4400"); // no cash movement → no row
    createTransaction(db, {
      type: "ausgabe",
      date: "2026-09-05",
      amountCents: 3_000,
      geldkonto: "1600",
      aufwandKonto: "6815",
      paymentMethod: "bar",
      description: "=HYPERLINK()",
    });
    const book = getCashbook(db, "1600", { from: "2026-09-01", to: "2026-09-30" });
    const opening = listGeldkontoBalances(db)[0]!.openingCents + 10_000;
    expect(book.openingCents).toBe(opening);
    expect(book.rows.map((r) => [r.inCents, r.outCents])).toEqual([
      [20_000, 0],
      [0, 3_000],
    ]);
    expect(book.rows.at(-1)!.balanceCents).toBe(opening + 17_000);
    expect(book.closingCents).toBe(opening + 17_000);
    expect(book.totalInCents).toBe(20_000);
    const csv = cashbookCsv(book);
    expect(csv.startsWith("﻿Datum;Belegnr.")).toBe(true);
    expect(csv).toContain("'=HYPERLINK()");
    expect(csv).toContain("Summe / Endbestand;;200,00;30,00;");
  });

  test("counts rows with a negative cash balance", () => {
    const opening = listGeldkontoBalances(db)[0]!.openingCents;
    createTransaction(db, {
      type: "ausgabe",
      date: "2026-09-05",
      amountCents: opening + 100,
      geldkonto: "1600",
      aufwandKonto: "6815",
      paymentMethod: "bar",
      description: "zu viel",
    });
    expect(getCashbook(db, "1600").negativeRows).toBe(1);
  });
});

describe("ledger and journal views", () => {
  test("cashOnly leaves out charges; journal is sorted by date", () => {
    payCash(10_000, "2026-09-10");
    charge(5_000, "2026-09-01", "4400");
    payCash(1_000, "2026-09-05");
    expect(listLedger(db, {}).rows).toHaveLength(3);
    expect(listLedger(db, { cashOnly: true }).rows).toHaveLength(2);
    expect(listJournal(db, {}).map((r) => r.date)).toEqual([
      "2026-09-10",
      "2026-09-05",
      "2026-09-01",
    ]);
    expect(listJournal(db, { sort: "asc" }).map((r) => r.date)).toEqual([
      "2026-09-01",
      "2026-09-05",
      "2026-09-10",
    ]);
    const { csv, count } = journalCsv(db, { from: "2026-09-01", to: "2026-09-30" });
    expect(count).toBe(3);
    expect(csv.split("\r\n")[1]!.startsWith("01.09.2026;")).toBe(true);
    expect(csv).toContain("Summe (ohne Stornos)");
  });
});

describe("Umsatzsteuer overview", () => {
  test("Anzahlungs-USt is released when the Guthaben pays a pass-through fee", () => {
    payCash(11_900, "2026-09-01"); // 19 % Anzahlung: 100,00 + 19,00
    charge(11_900, "2026-09-02", "1370"); // TÜV fee → no VAT at all
    const month = vatReport(db, 2026, "month").periods[8]!;
    expect(month.prepayment19VatCents).toBe(0);
    expect(month.passThroughCents).toBe(11_900);
    expect(month.outputVatCents).toBe(0);
  });

  test("revenue, Anzahlungen, Vorsteuer and Zahllast per quarter", () => {
    payCash(23_800, "2026-07-01");
    charge(11_900, "2026-07-02", "4400"); // 100 + 19 revenue, releases 19
    charge(10_700, "2026-08-02", "4300"); // 7 %: 100 + 7
    charge(5_000, "2026-08-03", "4100"); // steuerfrei
    createTransaction(db, {
      type: "ausgabe",
      date: "2026-09-02",
      amountCents: 5_950,
      geldkonto: "1600",
      aufwandKonto: "6815",
      paymentMethod: "bar",
      description: "Büro",
    });
    const storno = payCash(1_190, "2026-09-03");
    stornoTransaction(db, storno, "doppelt", "2026-09-03");

    const q3 = vatReport(db, 2026, "quarter").periods[2]!;
    expect(q3.revenue19NetCents).toBe(10_000);
    expect(q3.revenue19VatCents).toBe(1_900);
    expect(q3.revenue7NetCents).toBe(10_000);
    expect(q3.revenue7VatCents).toBe(700);
    expect(q3.taxFreeCents).toBe(5_000);
    // Anzahlungen: +23.800 −11.900 −10.700 −5.000 (+1.190 −1.190) = −3.800
    expect(q3.prepayment19VatCents).toBe(-606);
    expect(q3.inputVatCents).toBe(950);
    expect(q3.outputVatCents).toBe(1_900 + 700 - 606);
    expect(q3.payableCents).toBe(1_900 + 700 - 606 - 950);
    expect(vatReport(db, 2026, "quarter").total.payableCents).toBe(q3.payableCents);
  });
});
