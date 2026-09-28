import { beforeEach, describe, expect, test } from "bun:test";

import { openDb } from "./db";
import {
  createTransaction,
  listJournal,
  stornoTransaction,
  ValidationError,
} from "./engine";
import {
  addDays,
  chargeRemainders,
  createInvoice,
  createReminder,
  getInvoice,
  invoiceRoutes,
  listOpenItems,
  listUninvoicedCharges,
  setInvoicingSettings,
  stornoInvoice,
} from "./invoices";
import type { Database } from "./sqlite";
import { createStudent, type StudentRecord } from "./students";

let db: Database;
let student: StudentRecord;
let seq = 0;

function ref(s: StudentRecord) {
  return {
    customerNo: s.customerNumber,
    name: `${s.firstName} ${s.lastName}`,
    address: s.address,
    contractNo: s.contractNumber,
    classes: s.classes,
  };
}

function charge(amountCents: number, date = "2026-03-01", habenKonto = "4400") {
  return createTransaction(db, {
    type: "guthaben_uebertragung",
    date,
    amountCents,
    habenKonto,
    student: ref(student),
    description: `Leistung ${amountCents}`,
  }).id;
}

function pay(amountCents: number, date = "2026-03-02") {
  return createTransaction(db, {
    type: "zahlung_guthaben",
    date,
    amountCents,
    geldkonto: "1800",
    paymentMethod: "ueberweisung",
    student: ref(student),
  }).id;
}

beforeEach(() => {
  db = openDb(":memory:");
  seq += 1;
  student = createStudent(db, {
    firstName: "Rita",
    lastName: "Rechnung",
    address: "Hauptstraße 1, 64283 Darmstadt",
    classes: "B",
    contractNumber: `V-INV-${seq}`,
    customerNumber: `INV-${seq}`,
  });
});

describe("createInvoice", () => {
  test("numbers gaplessly per year and snapshots lines with VAT per rate", () => {
    const lesson = charge(6500);
    const fee = charge(12983, "2026-03-03", "1370");

    const first = createInvoice(db, {
      studentId: student.id,
      date: "2026-03-10",
      transactionIds: [fee, lesson],
    });
    expect(first.invoiceNr).toBe("R-2026-00001");
    expect(first.dueDate).toBe("2026-03-24"); // default 14 days
    expect(first.lines.map((l) => l.transactionId)).toEqual([lesson, fee]); // by date
    expect(first.totalCents).toBe(6500 + 12983);
    expect(first.vatSummary).toEqual([
      { vatRate: 19, netCents: 5462, vatCents: 1038, grossCents: 6500 },
      { vatRate: null, netCents: 12983, vatCents: 0, grossCents: 12983 },
    ]);
    expect(first.lines[1]!.durchlaufend).toBe(true);
    expect(first.recipient).toEqual({
      name: "Rita Rechnung",
      address: "Hauptstraße 1, 64283 Darmstadt",
    });
    expect(first.status).toBe("offen");

    const second = createInvoice(db, {
      studentId: student.id,
      date: "2026-04-01",
      transactionIds: [charge(6500, "2026-03-20")],
    });
    expect(second.invoiceNr).toBe("R-2026-00002");
  });

  test("new lines are booked through the engine in the same step", () => {
    const invoice = createInvoice(db, {
      studentId: student.id,
      date: "2026-03-10",
      newLines: [{ habenKonto: "4400", amountCents: 10000, description: "Grundbetrag" }],
    });
    expect(invoice.lines).toHaveLength(1);
    const txId = invoice.lines[0]!.transactionId!;
    const journal = listJournal(db, {}).filter((r) => r.transactionId === txId);
    expect(journal.map((r) => [r.sollKonto, r.habenKonto])).toEqual([["3272", "4400"]]);
  });

  test("a charge can only be on one live invoice; foreign/storniert charges are refused", () => {
    const lesson = charge(6500);
    createInvoice(db, {
      studentId: student.id,
      date: "2026-03-10",
      transactionIds: [lesson],
    });
    expect(() =>
      createInvoice(db, {
        studentId: student.id,
        date: "2026-03-11",
        transactionIds: [lesson],
      }),
    ).toThrow("bereits in einer Rechnung");

    const cancelled = charge(1000);
    stornoTransaction(db, cancelled, "falsch", "2026-03-02");
    expect(() =>
      createInvoice(db, {
        studentId: student.id,
        date: "2026-03-11",
        transactionIds: [cancelled],
      }),
    ).toThrow(ValidationError);
    expect(() =>
      createInvoice(db, {
        studentId: student.id,
        date: "2026-03-11",
        transactionIds: [],
      }),
    ).toThrow("mindestens eine Position");
  });

  test("a failed invoice consumes no number and books nothing", () => {
    const before = listJournal(db, {}).length;
    expect(() =>
      createInvoice(db, {
        studentId: student.id,
        date: "2026-03-10",
        transactionIds: [999999],
        newLines: [{ habenKonto: "4400", amountCents: 100, description: "X" }],
      }),
    ).toThrow(ValidationError);
    expect(listJournal(db, {}).length).toBe(before);
    const ok = createInvoice(db, {
      studentId: student.id,
      date: "2026-03-10",
      transactionIds: [charge(100)],
    });
    expect(ok.invoiceNr).toBe("R-2026-00001");
  });

  test("uninvoiced charges list excludes invoiced ones", () => {
    const a = charge(1000);
    const b = charge(2000);
    createInvoice(db, { studentId: student.id, date: "2026-03-10", transactionIds: [a] });
    expect(listUninvoicedCharges(db, student.id).map((c) => c.transactionId)).toEqual([
      b,
    ]);
  });
});

describe("payment status (FIFO)", () => {
  test("payments settle the oldest charges first", () => {
    const a = charge(5000, "2026-03-01");
    const b = charge(5000, "2026-03-05");
    pay(7000);
    const remainders = chargeRemainders(db, student.customerNumber);
    expect(remainders.get(a)).toBe(0);
    expect(remainders.get(b)).toBe(3000);

    const invoice = createInvoice(db, {
      studentId: student.id,
      date: "2026-03-10",
      transactionIds: [a, b],
    });
    expect(invoice.prepaidCents).toBe(7000);
    expect(invoice.openCents).toBe(3000);
    expect(invoice.status).toBe("teilbezahlt");

    pay(3000, "2026-03-12");
    expect(getInvoice(db, invoice.id).status).toBe("bezahlt");
  });

  test("an invoiced charge cannot be storniert on its own", () => {
    const a = charge(5000);
    createInvoice(db, { studentId: student.id, date: "2026-03-10", transactionIds: [a] });
    expect(() => stornoTransaction(db, a, "Fehler", "2026-03-11")).toThrow(
      "Teil der Rechnung R-2026-00001",
    );
  });
});

describe("stornoInvoice", () => {
  test("issues a numbered Stornorechnung with negated lines and frees the charges", () => {
    const a = charge(5000);
    const invoice = createInvoice(db, {
      studentId: student.id,
      date: "2026-03-10",
      transactionIds: [a],
    });
    const { storno, original } = stornoInvoice(db, invoice.id, {
      reason: "Falscher Empfänger",
      date: "2026-03-11",
    });
    expect(storno.invoiceNr).toBe("R-2026-00002");
    expect(storno.kind).toBe("storno");
    expect(storno.totalCents).toBe(-5000);
    expect(storno.lines[0]!.grossCents).toBe(-5000);
    expect(storno.stornoOf).toEqual({ id: invoice.id, invoiceNr: "R-2026-00001" });
    expect(original.status).toBe("storniert");
    expect(original.storniertBy?.invoiceNr).toBe("R-2026-00002");
    // The charge is billable again.
    expect(listUninvoicedCharges(db, student.id).map((c) => c.transactionId)).toEqual([
      a,
    ]);
    expect(() =>
      stornoInvoice(db, invoice.id, { reason: "nochmal", date: "2026-03-12" }),
    ).toThrow("bereits storniert");
  });

  test("stornoCharges also reverses the underlying bookings", () => {
    const a = charge(5000);
    const invoice = createInvoice(db, {
      studentId: student.id,
      date: "2026-03-10",
      transactionIds: [a],
    });
    stornoInvoice(db, invoice.id, {
      reason: "Leistung entfällt",
      date: "2026-03-11",
      stornoCharges: true,
    });
    expect(listUninvoicedCharges(db, student.id)).toEqual([]);
    const reversal = listJournal(db, {}).find((r) => r.isStorno);
    expect(reversal?.sollKonto).toBe("4400");
  });
});

describe("Mahnwesen", () => {
  test("levels 1–3 after the due date, fee booked to 4830 without VAT", () => {
    const invoice = createInvoice(db, {
      studentId: student.id,
      date: "2026-03-01",
      transactionIds: [charge(5000)],
    });
    expect(() => createReminder(db, invoice.id, { date: "2026-03-10" })).toThrow(
      "Zahlungsfrist läuft noch",
    );

    const first = createReminder(db, invoice.id, { date: "2026-03-20" });
    expect(first.level).toBe(1);
    expect(first.feeCents).toBe(0);
    expect(first.dueDate).toBe(addDays("2026-03-20", 7));

    // Within the new deadline no further level.
    expect(() => createReminder(db, invoice.id, { date: "2026-03-25" })).toThrow(
      ValidationError,
    );
    const second = createReminder(db, invoice.id, { date: "2026-03-28" });
    expect(second.level).toBe(2);
    expect(second.feeCents).toBe(500);
    const feeLine = listJournal(db, {}).find((r) => r.habenKonto === "4830");
    expect(feeLine?.amountCents).toBe(500);
    expect(feeLine?.vatRate).toBeNull();
    // The fee is not offered for invoicing.
    expect(listUninvoicedCharges(db, student.id)).toEqual([]);

    createReminder(db, invoice.id, { date: "2026-04-10", feeCents: 0 });
    expect(() => createReminder(db, invoice.id, { date: "2026-04-30" })).toThrow(
      "letzte Mahnstufe",
    );
    expect(getInvoice(db, invoice.id).reminders.map((r) => r.level)).toEqual([1, 2, 3]);
  });

  test("paid invoices cannot be reminded", () => {
    const invoice = createInvoice(db, {
      studentId: student.id,
      date: "2026-03-01",
      transactionIds: [charge(5000)],
    });
    pay(5000);
    expect(() => createReminder(db, invoice.id, { date: "2026-04-01" })).toThrow(
      "bereits bezahlt",
    );
  });
});

describe("listOpenItems", () => {
  test("lists open invoices and uninvoiced open charges per student", () => {
    const a = charge(5000, "2026-03-01");
    charge(2000, "2026-03-05");
    createInvoice(db, { studentId: student.id, date: "2026-03-01", transactionIds: [a] });
    const items = listOpenItems(db, "2026-04-01");
    expect(items.totals).toEqual({
      openCents: 5000,
      overdueCents: 5000,
      overdueCount: 1,
    });
    const row = items.students.find((s) => s.customerNo === student.customerNumber)!;
    expect(row).toMatchObject({
      studentId: student.id,
      invoicedOpenCents: 5000,
      uninvoicedOpenCents: 2000,
      balanceCents: -7000,
    });
  });
});

describe("settings + routes", () => {
  test("payment term setting drives the due date", () => {
    setInvoicingSettings(db, { paymentTermDays: 30 });
    const invoice = createInvoice(db, {
      studentId: student.id,
      date: "2026-03-01",
      transactionIds: [charge(100)],
    });
    expect(invoice.dueDate).toBe("2026-03-31");
    expect(() => setInvoicingSettings(db, { paymentTermDays: -1 })).toThrow(
      ValidationError,
    );
  });

  test("POST /api/invoices → 201, validation → 400", async () => {
    const routes = invoiceRoutes(db);
    const ok = await routes["/api/invoices"].POST(
      new Request("http://x/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          studentId: student.id,
          date: "2026-03-01",
          transactionIds: [charge(100)],
        }),
      }) as never,
    );
    expect(ok.status).toBe(201);
    const bad = await routes["/api/invoices"].POST(
      new Request("http://x/api/invoices", {
        method: "POST",
        body: JSON.stringify({ studentId: student.id, date: "2026-03-01" }),
      }) as never,
    );
    expect(bad.status).toBe(400);
  });
});
