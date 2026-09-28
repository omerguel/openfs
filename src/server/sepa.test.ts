import { beforeEach, describe, expect, test } from "bun:test";

import { getCompany, openDb, setCompany } from "./db";
import { createTransaction, listLedger, ValidationError } from "./engine";
import {
  addMonths,
  cancelInstalmentPlan,
  createInstalmentPlan,
  getInstalment,
  listDueInstalments,
  payInstalment,
} from "./instalments";
import { createInvoice, getInvoice, todayIso } from "./invoices";
import {
  bookCollection,
  createCollection,
  createMandate,
  getCollectionXml,
  listCandidates,
  listMandates,
  returnItem,
  revokeMandate,
} from "./sepa";
import type { Database } from "./sqlite";
import { createStudent, type StudentRecord } from "./students";

let db: Database;
let student: StudentRecord;
let seq = 0;

const IBAN = "DE89370400440532013000";
const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

function charge(amountCents: number) {
  return createTransaction(db, {
    type: "guthaben_uebertragung",
    date: "2026-01-10",
    amountCents,
    habenKonto: "4400",
    student: {
      customerNo: student.customerNumber,
      name: "Sepa Schüler",
      address: "",
      contractNo: student.contractNumber,
      classes: "B",
    },
    description: "Fahrstunde",
  }).id;
}

beforeEach(() => {
  db = openDb(":memory:");
  seq += 1;
  student = createStudent(db, {
    firstName: "Sepa",
    lastName: "Schüler",
    contractNumber: `V-SEPA-${seq}`,
    customerNumber: `SEPA-${seq}`,
  });
  setCompany(db, {
    ...getCompany(db),
    name: "Fahrschule Müller",
    iban: "DE02120300000000202051",
    glaeubigerId: "DE98ZZZ09999999999",
  });
});

describe("Ratenpläne", () => {
  test("splits evenly with the remainder on the last rate, monthly due dates", () => {
    const plan = createInstalmentPlan(db, {
      studentId: student.id,
      totalCents: 100_000,
      count: 3,
      firstDueDate: "2026-01-31",
    });
    expect(plan.instalments.map((r) => [r.seq, r.dueDate, r.amountCents])).toEqual([
      [1, "2026-01-31", 33_333],
      [2, "2026-02-28", 33_333],
      [3, "2026-03-31", 33_334],
    ]);
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });

  test("paying a rate books an Anzahlung and marks it paid; cancelled plans are not due", () => {
    const plan = createInstalmentPlan(db, {
      studentId: student.id,
      totalCents: 20_000,
      count: 2,
      firstDueDate: "2026-01-01",
    });
    const rate = payInstalment(db, plan.instalments[0]!.id, {
      date: "2026-01-02",
      geldkonto: "1600",
      paymentMethod: "bar",
    });
    expect(rate.paid).toBe(true);
    const row = listLedger(db, { customerNo: student.customerNumber }).rows[0]!;
    expect(row.incomeCents).toBe(10_000);
    expect(row.description).toContain("Rate 1/2");
    expect(() => payInstalment(db, rate.id, { date: "2026-01-03" })).toThrow(
      "bereits bezahlt",
    );

    expect(listDueInstalments(db, "2026-12-31").map((r) => r.seq)).toEqual([2]);
    cancelInstalmentPlan(db, plan.id, "2026-01-05");
    expect(listDueInstalments(db, "2026-12-31")).toEqual([]);
  });

  test("validation", () => {
    expect(() =>
      createInstalmentPlan(db, {
        studentId: student.id,
        totalCents: 100,
        count: 1,
        firstDueDate: "2026-01-01",
      }),
    ).toThrow(ValidationError);
  });
});

describe("Mandate", () => {
  test("validates IBAN and replaces the previous active mandate", () => {
    expect(() =>
      createMandate(db, {
        studentId: student.id,
        accountHolder: "Sepa Schüler",
        iban: "DE00123",
        signedOn: "2026-01-01",
      }),
    ).toThrow("IBAN");
    const first = createMandate(db, {
      studentId: student.id,
      accountHolder: "Sepa Schüler",
      iban: IBAN,
      signedOn: "2026-01-01",
    });
    expect(first.mandateRef).toBe(`FS-${student.customerNumber}-1`);
    expect(first.active).toBe(true);
    const second = createMandate(db, {
      studentId: student.id,
      accountHolder: "Eltern Schüler",
      iban: IBAN,
      signedOn: "2026-02-01",
    });
    const all = listMandates(db, { studentId: student.id });
    expect(all.find((m) => m.id === first.id)?.active).toBe(false);
    expect(all.find((m) => m.id === second.id)?.active).toBe(true);
    revokeMandate(db, second.id, "2026-03-01");
    expect(listMandates(db, { studentId: student.id }).some((m) => m.active)).toBe(false);
  });
});

describe("Lastschrift-Sammler", () => {
  function setupCandidates() {
    createMandate(db, {
      studentId: student.id,
      accountHolder: "Sepa Schüler",
      iban: IBAN,
      signedOn: "2026-01-01",
    });
    const invoice = createInvoice(db, {
      studentId: student.id,
      date: "2026-01-15",
      transactionIds: [charge(12_345)],
    });
    const plan = createInstalmentPlan(db, {
      studentId: student.id,
      totalCents: 10_000,
      count: 2,
      firstDueDate: "2026-01-01",
    });
    return { invoice, plan };
  }

  test("candidates: open invoices and due rates of students with an active mandate", () => {
    setupCandidates();
    const candidates = listCandidates(db, tomorrow());
    expect(candidates.map((c) => [c.sourceType, c.amountCents, c.sequenceType])).toEqual([
      ["instalment", 5_000, "FRST"], // due 01.01.
      ["invoice", 12_345, "FRST"], // due 29.01.
      ["instalment", 5_000, "FRST"], // due 01.02.
    ]);
  });

  test("export → XML, book → payments, second run uses RCUR, return storniert", () => {
    const { invoice, plan } = setupCandidates();
    const collection = createCollection(db, {
      collectionDate: tomorrow(),
      items: [
        { sourceType: "invoice", sourceId: invoice.id },
        { sourceType: "instalment", sourceId: plan.instalments[0]!.id },
      ],
    });
    expect(collection.totalCents).toBe(17_345);
    expect(collection.items.map((i) => i.status)).toEqual(["exportiert", "exportiert"]);
    const { xml } = getCollectionXml(db, collection.id);
    expect(xml).toContain("<CtrlSum>173.45</CtrlSum>");
    expect(xml).toContain(`<MndtId>FS-${student.customerNumber}-1</MndtId>`);
    expect(xml).toContain("<Nm>Fahrschule Mueller</Nm>");

    // Items in an open Sammler are not offered twice.
    expect(listCandidates(db, tomorrow()).map((c) => c.sourceId)).toEqual([
      plan.instalments[1]!.id,
    ]);

    const booked = bookCollection(db, collection.id, todayIso());
    expect(booked.items.every((i) => i.status === "gebucht")).toBe(true);
    expect(getInvoice(db, invoice.id).status).toBe("bezahlt");
    expect(getInstalment(db, plan.instalments[0]!.id).paid).toBe(true);
    const payments = listLedger(db, { customerNo: student.customerNumber }).rows.filter(
      (r) => r.incomeCents != null,
    );
    expect(payments).toHaveLength(2);
    expect(() => bookCollection(db, collection.id, todayIso())).toThrow(
      "bereits verbucht",
    );

    // The mandate has been used → the next collection is RCUR.
    expect(listCandidates(db, tomorrow())[0]!.sequenceType).toBe("RCUR");

    const returned = returnItem(db, booked.items[1]!.id, {
      date: todayIso(),
      reason: "MD06 Rückgabe auf Verlangen",
    });
    expect(returned.status).toBe("zurueckgegeben");
    expect(getInstalment(db, plan.instalments[0]!.id).paid).toBe(false);
  });

  test("needs a valid creditor id and a future collection date", () => {
    const { invoice } = setupCandidates();
    const items = [{ sourceType: "invoice", sourceId: invoice.id }];
    expect(() => createCollection(db, { collectionDate: todayIso(), items })).toThrow(
      "Bankarbeitstag",
    );
    setCompany(db, { ...getCompany(db), glaeubigerId: "" });
    expect(() => createCollection(db, { collectionDate: tomorrow(), items })).toThrow(
      "Gläubiger-ID",
    );
  });
});
