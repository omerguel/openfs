import { beforeEach, describe, expect, test } from "bun:test";

import type { InvoiceLine } from "../lib/invoice-types";
import { cleanPositionText, letterSalutation } from "../lib/invoice-text";
import { openDb } from "./db";
import { createTransaction } from "./engine";
import {
  invoiceFileName,
  renderInvoicePdf,
  renderReminderPdf,
  invoiceDunningSubject,
  sendInvoiceMail,
} from "./invoice-documents";
import {
  allocatePrepaid,
  createInvoice,
  createOpeningBalanceReminder,
  createReminder,
  getInvoice,
  invoiceRoutes,
  listOpenItems,
  listOpeningBalances,
  listUninvoicedCharges,
} from "./invoices";
import { listOutbox } from "./mail";
import { buildMessage } from "./smtp";
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

function charge(amountCents: number, date: string, habenKonto: string, text: string) {
  return createTransaction(db, {
    type: "guthaben_uebertragung",
    date,
    amountCents,
    habenKonto,
    student: ref(student),
    description: `FS ${ref(student).name} - ${student.classes}, ${text}`,
  }).id;
}

function pay(amountCents: number, date: string) {
  return createTransaction(db, {
    type: "zahlung_guthaben",
    date,
    amountCents,
    geldkonto: "1600",
    paymentMethod: "bar",
    student: ref(student),
  }).id;
}

beforeEach(() => {
  db = openDb(":memory:");
  seq += 1;
  student = createStudent(db, {
    firstName: "Aylin",
    lastName: "Demir",
    address: "Rheinstraße 5, 64283 Darmstadt",
    classes: "B197",
    contractNumber: `V-DOC-${seq}`,
    customerNumber: `DOC-${seq}`,
    email: "aylin@example.de",
  });
});

describe("prepayment VAT on the Endrechnung", () => {
  test("a prepaid pass-through fee carries no VAT (R-2026-00002 case)", () => {
    // TÜV fee (durchlaufend) and a 19 % lesson; the payment covers
    // exactly the older TÜV fee (FIFO) and part of the lesson.
    const tuev = charge(12983, "2026-09-01", "1370", "TÜV Prüfungsgebühr");
    const lesson = charge(13000, "2026-09-10", "4400", "Fahrübungsstunde (90)");
    pay(21800, "2026-09-12");
    const invoice = createInvoice(db, {
      studentId: student.id,
      date: "2026-09-28",
      transactionIds: [tuev, lesson],
    });
    const vatOnInvoice = invoice.vatSummary.reduce((sum, row) => sum + row.vatCents, 0);
    expect(vatOnInvoice).toBe(2076);
    expect(invoice.prepaidCents).toBe(21800);
    const prepaidVat = invoice.prepaidVat.reduce((sum, row) => sum + row.vatCents, 0);
    // Flat 19 % on 218,00 € would be 34,81 € — more than the invoice's VAT.
    expect(prepaidVat).toBeLessThanOrEqual(vatOnInvoice);
    expect(invoice.prepaidVat).toEqual([
      // 218,00 − 129,83 = 88,17 € of the lesson → 14,08 € VAT.
      { vatRate: 19, netCents: 7409, vatCents: 1408, grossCents: 8817 },
      { vatRate: null, netCents: 12983, vatCents: 0, grossCents: 12983 },
    ]);
    // Stored with the invoice: a later payment does not change the document.
    pay(5000, "2026-09-30");
    expect(getInvoice(db, invoice.id).prepaidVat).toEqual(invoice.prepaidVat);
  });

  test("fully prepaid invoice deducts exactly the invoiced VAT", () => {
    const tuev = charge(12983, "2026-09-01", "1370", "TÜV Prüfungsgebühr");
    const lesson = charge(52932, "2026-09-02", "4400", "Grundbetrag");
    pay(100000, "2026-08-01");
    const invoice = createInvoice(db, {
      studentId: student.id,
      date: "2026-09-28",
      transactionIds: [tuev, lesson],
    });
    const vat = invoice.vatSummary.reduce((sum, row) => sum + row.vatCents, 0);
    expect(invoice.prepaidCents).toBe(invoice.totalCents);
    expect(invoice.prepaidVat.reduce((sum, row) => sum + row.vatCents, 0)).toBe(vat);
  });

  test("allocatePrepaid never exceeds the VAT of a rate and sums to the prepayment", () => {
    const lines: InvoiceLine[] = [
      {
        transactionId: 1,
        date: "2026-09-01",
        description: "A",
        netCents: 841,
        vatRate: 19,
        vatCents: 159,
        grossCents: 1000,
        durchlaufend: false,
        steuerfrei: false,
      },
      {
        transactionId: 1,
        date: "2026-09-01",
        description: "B",
        netCents: 3333,
        vatRate: null,
        vatCents: 0,
        grossCents: 3333,
        durchlaufend: true,
        steuerfrei: false,
      },
    ];
    for (const prepaid of [1, 999, 2000, 4332, 4333]) {
      const rows = allocatePrepaid(lines, prepaid);
      expect(rows.reduce((s, r) => s + r.grossCents, 0)).toBe(prepaid);
      const vat19 = rows.find((r) => r.vatRate === 19)?.vatCents ?? 0;
      expect(vat19).toBeLessThanOrEqual(159);
    }
    // Per-charge coverage (FIFO) is split proportionally within the charge.
    const rows = allocatePrepaid(lines, 433, new Map([[1, 433]]));
    expect(rows).toEqual([
      { vatRate: 19, netCents: 83, vatCents: 16, grossCents: 99 },
      { vatRate: null, netCents: 334, vatCents: 0, grossCents: 334 },
    ]);
  });
});

describe("position texts", () => {
  test("new invoices store cleaned position texts", () => {
    const lesson = charge(13000, "2026-09-12", "4400", "Fahrübungsstunde (90)");
    const invoice = createInvoice(db, {
      studentId: student.id,
      date: "2026-09-28",
      transactionIds: [lesson],
    });
    expect(invoice.lines[0]!.description).toBe("Fahrübungsstunde 90 Min.");
  });

  test("cleanPositionText", () => {
    const s = { name: "Aylin Demir", classes: "B197" };
    expect(cleanPositionText("FS Aylin Demir - B197, Praktische Prüfung (55)", s)).toBe(
      "Praktische Prüfung 55 Min.",
    );
    expect(
      cleanPositionText(
        "FS Aylin Demir - B197, TÜV Prüfungsgebühr (durchlaufender Posten)",
        s,
      ),
    ).toBe("TÜV Prüfungsgebühr");
    expect(cleanPositionText("Grundbetrag", s)).toBe("Grundbetrag");
    expect(cleanPositionText("FS Aylin Demir", s)).toBe("FS Aylin Demir");
  });

  test("letter salutation", () => {
    expect(letterSalutation("Aylin Demir")).toBe("Guten Tag Aylin Demir,");
    expect(letterSalutation(" ")).toBe("Sehr geehrte Damen und Herren,");
  });
});

describe("opening debts (Saldovortrag) as open items", () => {
  function openingDebt(amountCents: number, date = "2026-01-01") {
    return createTransaction(db, {
      type: "saldovortrag",
      date,
      amountCents,
      direction: "forderung",
      student: ref(student),
    }).id;
  }

  test("are listed, settled FIFO by payments and never offered for invoicing", () => {
    const sv = openingDebt(30000);
    const lesson = charge(13000, "2026-09-12", "4400", "Fahrübungsstunde (90)");
    let items = listOpenItems(db, "2026-09-28");
    expect(items.totals.openingCents).toBe(30000);
    expect(items.openingBalances).toHaveLength(1);
    expect(items.openingBalances[0]).toMatchObject({
      transactionId: sv,
      openCents: 30000,
      studentId: student.id,
    });
    const row = items.students.find((s) => s.customerNo === student.customerNumber)!;
    expect(row.openingOpenCents).toBe(30000);
    expect(row.uninvoicedOpenCents).toBe(13000);
    expect(listUninvoicedCharges(db, student.id).map((c) => c.transactionId)).toEqual([
      lesson,
    ]);
    expect(() =>
      createInvoice(db, {
        studentId: student.id,
        date: "2026-09-28",
        transactionIds: [sv],
      }),
    ).toThrow("Saldovortrag");

    pay(10000, "2026-09-20");
    items = listOpenItems(db, "2026-09-28");
    expect(items.openingBalances[0]!.openCents).toBe(20000);
    pay(20000, "2026-09-21");
    expect(listOpeningBalances(db, "2026-09-28")).toEqual([]);
  });

  test("can be dunned in three levels with fees booked to 4830", () => {
    const sv = openingDebt(30000, "2026-09-01");
    const first = createOpeningBalanceReminder(db, sv, { date: "2026-09-01" });
    expect(first.level).toBe(1);
    expect(() => createOpeningBalanceReminder(db, sv, { date: "2026-09-05" })).toThrow(
      "Zahlungsfrist",
    );
    const second = createOpeningBalanceReminder(db, sv, { date: "2026-09-09" });
    expect(second).toMatchObject({ level: 2, feeCents: 500, openCents: 30000 });
    const item = listOpeningBalances(db, "2026-09-10")[0]!;
    expect(item.reminders).toHaveLength(2);
    expect(item.nextReminderOn).toBe("2026-09-17");
    // The fee is a charge of its own, not offered for invoicing.
    expect(listUninvoicedCharges(db, student.id)).toEqual([]);
  });
});

describe("next dunning level", () => {
  test("invoice exposes when the next Mahnstufe becomes possible", () => {
    const lesson = charge(13000, "2026-09-01", "4400", "Fahrübungsstunde (90)");
    const invoice = createInvoice(db, {
      studentId: student.id,
      date: "2026-09-01",
      transactionIds: [lesson],
    });
    expect(invoice.nextReminderOn).toBe("2026-09-16");
    createReminder(db, invoice.id, { date: "2026-09-20" });
    expect(getInvoice(db, invoice.id, "2026-09-21").nextReminderOn).toBe("2026-09-28");
  });
});

describe("PDF + E-Mail", () => {
  function sampleInvoice() {
    const tuev = charge(12983, "2026-09-01", "1370", "TÜV Prüfungsgebühr");
    const lesson = charge(13000, "2026-09-10", "4400", "Fahrübungsstunde (90)");
    pay(5000, "2026-09-12");
    return createInvoice(db, {
      studentId: student.id,
      date: "2026-09-28",
      transactionIds: [tuev, lesson],
    });
  }

  test("renders a PDF with the invoice number as file name and title", () => {
    const invoice = sampleInvoice();
    const bytes = renderInvoicePdf(invoice);
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain(`(Rechnung ${invoice.invoiceNr})`);
    expect(text).toContain("(Fahr\\374bungsstunde 90 Min.)");
    expect(invoiceFileName(invoice)).toBe("R-2026-00001.pdf");
    // xref offsets point at the objects.
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");

    const reminderPdf = new TextDecoder("latin1").decode(
      renderReminderPdf(invoiceDunningSubject(invoice), {
        level: 1,
        date: "2026-10-20",
        dueDate: "2026-10-27",
        openCents: 20983,
        feeCents: 0,
      }),
    );
    expect(reminderPdf).toContain("(Guten Tag Aylin Demir,)");
  });

  test("GET /api/invoices/:id/pdf answers application/pdf with a file name", async () => {
    const invoice = sampleInvoice();
    const routes = invoiceRoutes(db);
    const res = await routes["/api/invoices/:id/pdf"].GET(
      Object.assign(new Request(`http://x/api/invoices/${invoice.id}/pdf`), {
        params: { id: String(invoice.id) },
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain(
      'filename="R-2026-00001.pdf"',
    );
  });

  test("Per E-Mail senden queues the PDF as attachment in the outbox", () => {
    const invoice = sampleInvoice();
    const entry = sendInvoiceMail(db, invoice.id, {});
    expect(entry.recipient).toBe("aylin@example.de");
    expect(entry.subject).toBe("Rechnung R-2026-00001");
    expect(entry.bodyText.startsWith("Guten Tag Aylin Demir,")).toBe(true);
    expect(entry.attachmentNames).toEqual(["R-2026-00001.pdf"]);
    expect(listOutbox(db)[0]!.attachmentNames).toEqual(["R-2026-00001.pdf"]);
    expect(() => sendInvoiceMail(db, invoice.id, { recipient: "kein-mail" })).toThrow(
      "E-Mail-Adresse",
    );
  });

  test("SMTP message becomes multipart/mixed with a base64 attachment", () => {
    const message = buildMessage("schule@example.de", {
      to: "a@example.de",
      subject: "Rechnung",
      text: "Hallo",
      attachments: [
        {
          filename: "R-1.pdf",
          contentType: "application/pdf",
          contentBase64: "JVBERi0=",
        },
      ],
    });
    expect(message).toContain("Content-Type: multipart/mixed;");
    expect(message).toContain('Content-Disposition: attachment; filename="R-1.pdf"');
    expect(message).toContain("JVBERi0=");
  });
});
