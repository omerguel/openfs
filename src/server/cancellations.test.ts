/* ------------------------------------------------------------------ */
/* Unit tests for Absage / Nichterscheinen: guards, fee booking via   */
/* the GoBD engine, uncancel rules and the policy setting.            */
/* In-memory DB per test.                                             */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "./sqlite";

import {
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvent,
  markEventBilled,
} from "./calendar-events";
import {
  cancelCalendarEvent,
  getCancellationPolicy,
  resolveCancellationFee,
  setCancellationPolicy,
  uncancelCalendarEvent,
} from "./cancellations";
import { openDb } from "./db";
import { createTransaction, stornoTransaction } from "./engine";
import { computeSpecialDriveProgress } from "../lib/special-drives";
import { createAttestation, ensureAttestationTables } from "./ausbildungsnachweis";
import { ensureMailTables, listOutbox } from "./mail";

let db: Database;
let studentId: number;

beforeEach(() => {
  db = openDb(":memory:");
  studentId = db
    .query<{ id: number }, []>("SELECT id FROM students ORDER BY id LIMIT 1")
    .get()!.id;
  // "Standard Tarif": Fahrübungsstunde 65,00 €.
  db.prepare("UPDATE students SET price_plan_id = 1 WHERE id = ?").run(studentId);
});

const lesson = (overrides: Record<string, unknown> = {}) =>
  createCalendarEvent(db, {
    date: "2026-06-10",
    start: "09:00",
    end: "09:45",
    title: "Fahrstunde",
    instructor: "Martin Weber",
    type: "Praktisch",
    studentId,
    ...overrides,
  });

const feeBooking = (transactionId: number) =>
  db
    .query<
      {
        amount_cents: number;
        soll_account: string;
        haben_account: string;
        description: string;
      },
      [number]
    >(
      `SELECT b.amount_cents, b.soll_account, b.haben_account, t.description
       FROM bookings b JOIN transactions t ON t.id = b.transaction_id
       WHERE t.id = ?`,
    )
    .get(transactionId);

describe("cancellation policy", () => {
  test("defaults to 24 h and 0 (= per-lesson price)", () => {
    expect(getCancellationPolicy(db)).toEqual({ hoursBefore: 24, feeCents: 0 });
  });

  test("set merges and persists; invalid values are rejected", () => {
    expect(setCancellationPolicy(db, { hoursBefore: 48 })).toEqual({
      hoursBefore: 48,
      feeCents: 0,
    });
    setCancellationPolicy(db, { feeCents: 3000 });
    expect(getCancellationPolicy(db)).toEqual({ hoursBefore: 48, feeCents: 3000 });
    expect(() => setCancellationPolicy(db, { hoursBefore: -1 })).toThrow(/Frist/);
    expect(() => setCancellationPolicy(db, { feeCents: 1.5 })).toThrow(/Ausfallgebühr/);
  });
});

describe("resolveCancellationFee", () => {
  test("explicit > policy > per-lesson price > null", () => {
    expect(resolveCancellationFee(db, studentId, 1234)).toBe(1234);
    expect(resolveCancellationFee(db, studentId)).toBe(6500);
    setCancellationPolicy(db, { feeCents: 2500 });
    expect(resolveCancellationFee(db, studentId)).toBe(2500);
    setCancellationPolicy(db, { feeCents: 0 });
    // No plan assigned → the default (first) plan's lesson price.
    db.prepare("UPDATE students SET price_plan_id = NULL WHERE id = ?").run(studentId);
    expect(resolveCancellationFee(db, studentId)).toBe(6500);
    db.prepare("DELETE FROM price_plans").run();
    expect(resolveCancellationFee(db, studentId)).toBeNull();
  });
});

describe("cancelCalendarEvent", () => {
  test("records the cancellation without a fee", () => {
    const event = lesson();
    const result = cancelCalendarEvent(db, Number(event.id), { kind: "abgesagt" });
    expect(result.transaction).toBeUndefined();
    expect(result.event.cancellationKind).toBe("abgesagt");
    expect(result.event.cancelledAt).toBeTruthy();
    expect(result.event.cancellationFeeTransactionId).toBeUndefined();
  });

  test("books the fee through the engine with the per-lesson price", () => {
    const event = lesson();
    const result = cancelCalendarEvent(db, Number(event.id), {
      kind: "nicht_erschienen",
      chargeFee: true,
      date: "2026-06-10",
    });
    expect(result.transaction).toBeDefined();
    expect(result.event.cancellationKind).toBe("nicht_erschienen");
    expect(result.event.cancellationFeeTransactionId).toBe(result.transaction!.id);
    expect(result.event.cancellationFeeActive).toBe(true);
    expect(result.event.cancellationFeeCents).toBe(6500);
    expect(feeBooking(result.transaction!.id)).toEqual({
      amount_cents: 6500,
      soll_account: "3272",
      haben_account: "4400",
      description: "Ausfallentschädigung Fahrstunde 10.06.2026",
    });
  });

  test("an explicit amount wins", () => {
    const event = lesson();
    const { transaction } = cancelCalendarEvent(db, Number(event.id), {
      kind: "abgesagt",
      chargeFee: true,
      feeCents: 4000,
      date: "2026-06-09",
    });
    expect(feeBooking(transaction!.id)!.amount_cents).toBe(4000);
  });

  test("guards: already cancelled, billed, bad kind, fee without student/price", () => {
    const event = lesson();
    expect(() => cancelCalendarEvent(db, Number(event.id), {} as never)).toThrow(
      /Art muss/,
    );
    cancelCalendarEvent(db, Number(event.id), { kind: "abgesagt" });
    expect(() => cancelCalendarEvent(db, Number(event.id), { kind: "abgesagt" })).toThrow(
      "Termin ist bereits abgesagt.",
    );

    const billed = lesson({ start: "11:00", end: "11:45" });
    const tx = createTransaction(db, {
      type: "guthaben_uebertragung",
      date: "2026-06-10",
      amountCents: 6500,
      habenKonto: "4400",
      student: { customerNo: "K", name: "X", address: "", contractNo: "V", classes: "B" },
      description: "Fahrübungsstunde (45)",
    });
    markEventBilled(db, Number(billed.id), tx.id);
    expect(() =>
      cancelCalendarEvent(db, Number(billed.id), { kind: "abgesagt" }),
    ).toThrow(/abgerechnet — zuerst stornieren/);

    const anonymous = lesson({ start: "13:00", end: "13:45", studentId: null });
    expect(() =>
      cancelCalendarEvent(db, Number(anonymous.id), {
        kind: "abgesagt",
        chargeFee: true,
      }),
    ).toThrow(/Kein Fahrschüler/);

    db.prepare("UPDATE students SET price_plan_id = NULL").run();
    db.prepare("DELETE FROM price_plans").run();
    const noPrice = lesson({ start: "15:00", end: "15:45" });
    expect(() =>
      cancelCalendarEvent(db, Number(noPrice.id), { kind: "abgesagt", chargeFee: true }),
    ).toThrow(/Keine Ausfallgebühr ermittelbar/);
    // Failed fee → nothing was written.
    expect(getCalendarEvent(db, Number(noPrice.id)).cancelledAt).toBeUndefined();
  });

  test("an invalid booking date rolls the cancellation back", () => {
    const event = lesson();
    expect(() =>
      cancelCalendarEvent(db, Number(event.id), {
        kind: "abgesagt",
        chargeFee: true,
        date: "2026-02-30",
      }),
    ).toThrow(/Ungültiges Datum/);
    expect(getCalendarEvent(db, Number(event.id)).cancelledAt).toBeUndefined();
  });

  test("cancelled lessons free the slot and do not count as Sonderfahrt", () => {
    const event = lesson({ lessonKind: "Nachtfahrt" });
    cancelCalendarEvent(db, Number(event.id), { kind: "abgesagt" });
    // Same slot, same instructor — no overlap any more.
    lesson({ title: "Ersatz" });
    const progress = computeSpecialDriveProgress(
      [getCalendarEvent(db, Number(event.id))],
      "2026-12-31",
    );
    expect(progress.find((row) => row.kind === "Nachtfahrt")!.completedMinutes).toBe(0);
  });
});

describe("uncancelCalendarEvent", () => {
  test("reverts a cancellation without fee", () => {
    const event = lesson();
    cancelCalendarEvent(db, Number(event.id), { kind: "abgesagt" });
    const restored = uncancelCalendarEvent(db, Number(event.id));
    expect(restored.cancelledAt).toBeUndefined();
    expect(restored.cancellationKind).toBeUndefined();
  });

  test("blocked while the fee is active, allowed after storno", () => {
    const event = lesson();
    const { transaction } = cancelCalendarEvent(db, Number(event.id), {
      kind: "nicht_erschienen",
      chargeFee: true,
      date: "2026-06-10",
    });
    expect(() => uncancelCalendarEvent(db, Number(event.id))).toThrow(
      /zuerst stornieren/,
    );
    // Deleting the event is blocked for the same reason.
    expect(() => deleteCalendarEvent(db, Number(event.id))).toThrow(/Ausfallgebühr/);

    stornoTransaction(db, transaction!.id, "Kulanz", "2026-06-11");
    expect(getCalendarEvent(db, Number(event.id)).cancellationFeeActive).toBe(false);
    const restored = uncancelCalendarEvent(db, Number(event.id));
    expect(restored.cancelledAt).toBeUndefined();
    expect(restored.cancellationFeeTransactionId).toBeUndefined();
  });

  test("re-checks the slot: a replacement lesson blocks the revert", () => {
    const event = lesson();
    cancelCalendarEvent(db, Number(event.id), { kind: "abgesagt" });
    lesson({ title: "Ersatz" });
    expect(() => uncancelCalendarEvent(db, Number(event.id))).toThrow(/Überschneidung/);
    expect(
      uncancelCalendarEvent(db, Number(event.id), { allowConflicts: true }).cancelledAt,
    ).toBeUndefined();
  });

  test("not cancelled → ValidationError", () => {
    const event = lesson();
    expect(() => uncancelCalendarEvent(db, Number(event.id))).toThrow(
      "Termin ist nicht abgesagt.",
    );
  });
});

describe("attestations", () => {
  test("a cancelled lesson cannot be attested", () => {
    ensureAttestationTables(db);
    const event = lesson();
    cancelCalendarEvent(db, Number(event.id), { kind: "nicht_erschienen" });
    expect(() =>
      createAttestation(db, {
        eventId: Number(event.id),
        studentId,
        instructor: "Martin Weber",
        content: "",
        durationMin: 45,
        signatureDataUrl: "data:image/png;base64,abc123",
      }),
    ).toThrow(/abgesagte Termine/);
  });
});

describe("Absage-Benachrichtigung", () => {
  test("an Absage queues a mail to the student; a no-show does not", () => {
    ensureMailTables(db);
    db.prepare("UPDATE students SET email = 'schueler@example.de' WHERE id = ?").run(
      studentId,
    );
    cancelCalendarEvent(db, Number(lesson().id), { kind: "abgesagt" });
    cancelCalendarEvent(db, Number(lesson({ start: "11:00", end: "11:45" }).id), {
      kind: "nicht_erschienen",
    });
    const mails = listOutbox(db);
    expect(mails.map((m) => m.kind)).toEqual(["lesson_cancelled"]);
    expect(mails[0]!.recipient).toBe("schueler@example.de");
  });

  test("without the mail module the cancellation still works", () => {
    expect(() =>
      cancelCalendarEvent(db, Number(lesson().id), { kind: "abgesagt" }),
    ).not.toThrow();
  });
});
