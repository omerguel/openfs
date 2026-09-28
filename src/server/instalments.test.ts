import { beforeEach, describe, expect, test } from "bun:test";

import { openDb } from "./db";
import { createTransaction, stornoTransaction } from "./engine";
import {
  cancelInstalmentPlan,
  createInstalmentPlan,
  getInstalmentPlan,
  listDueInstalments,
  listInstalmentPlans,
  payInstalment,
} from "./instalments";
import type { Database } from "./sqlite";
import { createStudent, type StudentRecord } from "./students";

let db: Database;
let student: StudentRecord;
let seq = 0;

function pay(amountCents: number, date: string) {
  return createTransaction(db, {
    type: "zahlung_guthaben",
    date,
    amountCents,
    geldkonto: "1600",
    paymentMethod: "bar",
    student: {
      customerNo: student.customerNumber,
      name: "Rita Rate",
      address: "",
      contractNo: student.contractNumber,
      classes: "B",
    },
  }).id;
}

function plan(firstDueDate = "2026-01-15", totalCents = 100_000, count = 4) {
  return createInstalmentPlan(db, {
    studentId: student.id,
    totalCents,
    count,
    firstDueDate,
  });
}

beforeEach(() => {
  db = openDb(":memory:");
  seq += 1;
  student = createStudent(db, {
    firstName: "Rita",
    lastName: "Rate",
    contractNumber: `V-RATE-${seq}`,
    customerNumber: `RATE-${seq}`,
  });
});

describe("Ratenplan: payments are allocated FIFO", () => {
  test("a cash payment of exactly the first rate pays that rate", () => {
    const created = plan();
    pay(25_000, "2026-01-15");
    const current = getInstalmentPlan(db, created.id);
    expect(current.paidCents).toBe(25_000);
    expect(current.instalments.map((r) => [r.paid, r.paidCents, r.openCents])).toEqual([
      [true, 25_000, 0],
      [false, 0, 25_000],
      [false, 0, 25_000],
      [false, 0, 25_000],
    ]);
    expect(current.instalments[0]!.paymentTransactionId).toBeNull();
  });

  test("partial and overflowing payments spread over the oldest open rates", () => {
    const created = plan();
    pay(10_000, "2026-01-20");
    pay(30_000, "2026-02-20");
    const rates = getInstalmentPlan(db, created.id).instalments;
    expect(rates.map((r) => r.paidCents)).toEqual([25_000, 15_000, 0, 0]);
    expect(rates.map((r) => r.paid)).toEqual([true, false, false, false]);
    // A partly paid rate is due with its open part only.
    const due = listDueInstalments(db, "2026-02-28");
    expect(due.map((r) => r.openCents)).toEqual([10_000]);
  });

  test("payments before the plan started or after it ended do not count", () => {
    pay(25_000, "2025-12-01"); // before created and before the first due date
    const created = plan("2026-01-15");
    expect(getInstalmentPlan(db, created.id).paidCents).toBe(0);
    cancelInstalmentPlan(db, created.id, "2026-02-01");
    pay(25_000, "2026-03-01");
    expect(getInstalmentPlan(db, created.id).paidCents).toBe(0);
  });

  test("a storniert payment no longer counts", () => {
    const created = plan();
    const payment = pay(25_000, "2026-01-15");
    stornoTransaction(db, payment, "Fehlbuchung", "2026-01-15");
    expect(getInstalmentPlan(db, created.id).paidCents).toBe(0);
  });

  test("'Als bezahlt buchen' books only the open part and links it", () => {
    const created = plan();
    pay(10_000, "2026-01-15");
    const rate = payInstalment(db, created.instalments[0]!.id, {
      date: "2026-01-15",
      geldkonto: "1800",
      paymentMethod: "ueberweisung",
    });
    expect(rate.paid).toBe(true);
    expect(rate.paymentTransactionId).not.toBeNull();
    const current = getInstalmentPlan(db, created.id);
    // 10.000 allocated + 15.000 linked; nothing spills into rate 2.
    expect(current.paidCents).toBe(25_000);
    expect(() =>
      payInstalment(db, created.instalments[0]!.id, { date: "2026-01-16" }),
    ).toThrow("bereits bezahlt");
  });

  test("two plans of one student share the payments by due date", () => {
    const first = plan("2026-01-15", 20_000, 2);
    const second = plan("2026-01-20", 20_000, 2);
    pay(25_000, "2026-01-21");
    const plans = listInstalmentPlans(db, { studentId: student.id });
    const byId = new Map(plans.map((p) => [p.id, p]));
    expect(byId.get(first.id)!.instalments.map((r) => r.paidCents)).toEqual([
      10_000, 5_000,
    ]);
    expect(byId.get(second.id)!.instalments.map((r) => r.paidCents)).toEqual([10_000, 0]);
  });
});
