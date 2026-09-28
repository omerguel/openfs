/* ------------------------------------------------------------------ */
/* Unit tests for the absence impact: affected lessons, bulk hand-over */
/* to a colleague and bulk cancellation without fee.                  */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "./sqlite";

import {
  cancelLessonsWithoutFee,
  lessonsAffectedByAbsence,
  reassignLessons,
} from "./absence-impact";
import { createAbsence } from "./absences";
import { createCalendarEvent, getCalendarEvent } from "./calendar-events";
import { openDb } from "./db";
import { instructorIdByName } from "./refs";

let db: Database;
let martin: number;
let nadine: number;

beforeEach(() => {
  db = openDb(":memory:");
  martin = instructorIdByName(db, "Martin Weber")!;
  nadine = instructorIdByName(db, "Nadine Aksoy")!;
});

const lesson = (overrides: Record<string, unknown> = {}) =>
  createCalendarEvent(db, {
    date: "2026-07-15",
    start: "09:00",
    end: "09:45",
    title: "Fahrstunde",
    instructor: "Martin Weber",
    type: "Praktisch",
    ...overrides,
  });

describe("lessonsAffectedByAbsence", () => {
  test("lists the instructor's non-cancelled Termine inside the range", () => {
    const inside = lesson();
    const lastDay = lesson({ date: "2026-07-17", start: "14:00", end: "14:45" });
    lesson({ date: "2026-07-18" }); // after the range
    lesson({ instructor: "Nadine Aksoy" }); // other instructor
    const cancelled = lesson({ start: "11:00", end: "11:45" });
    cancelLessonsWithoutFee(db, { eventIds: [Number(cancelled.id)] });

    const affected = lessonsAffectedByAbsence(db, {
      instructorId: martin,
      from: "2026-07-15",
      to: "2026-07-17",
    });
    expect(affected.map((event) => event.id)).toEqual([inside.id, lastDay.id]);
  });

  test("validates the range", () => {
    expect(() =>
      lessonsAffectedByAbsence(db, { instructorId: martin, from: "15.07.", to: "x" }),
    ).toThrow(/ISO-Daten/);
    expect(() =>
      lessonsAffectedByAbsence(db, {
        instructorId: martin,
        from: "2026-07-17",
        to: "2026-07-15",
      }),
    ).toThrow(/nicht vor dem Von-Datum/);
  });
});

describe("reassignLessons", () => {
  test("moves free lessons to the colleague and reports the ones that clash", () => {
    const free = lesson();
    const clashing = lesson({ start: "10:00", end: "10:45" });
    lesson({ instructor: "Nadine Aksoy", start: "10:00", end: "11:00", title: "Belegt" });
    createAbsence(db, {
      instructorId: martin,
      fromDate: "2026-07-15",
      toDate: "2026-07-15",
      kind: "Krank",
    });

    const result = reassignLessons(db, {
      eventIds: [Number(free.id), Number(clashing.id)],
      instructorId: nadine,
    });
    expect(result.done.map((event) => event.instructor)).toEqual(["Nadine Aksoy"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.id).toBe(clashing.id);
    expect(result.failed[0]!.reason).toMatch(/Überschneidung mit „Belegt“/);
    expect(getCalendarEvent(db, Number(clashing.id)).instructor).toBe("Martin Weber");
  });

  test("an absent colleague is rejected per lesson", () => {
    const event = lesson();
    createAbsence(db, {
      instructorId: nadine,
      fromDate: "2026-07-15",
      toDate: "2026-07-15",
      kind: "Urlaub",
    });
    const result = reassignLessons(db, { eventIds: [Number(event.id)], instructorId: nadine });
    expect(result.done).toHaveLength(0);
    expect(result.failed[0]!.reason).toMatch(/abwesend \(Urlaub\)/);
  });

  test("input validation", () => {
    expect(() => reassignLessons(db, { eventIds: [], instructorId: nadine })).toThrow(
      /mindestens einen Termin/,
    );
    const event = lesson();
    expect(() =>
      reassignLessons(db, { eventIds: [Number(event.id)], instructorId: 9999 }),
    ).toThrow(/nicht gefunden/);
  });
});

describe("cancelLessonsWithoutFee", () => {
  test("cancels as 'abgesagt' and never books a fee", () => {
    const first = lesson();
    const second = lesson({ start: "10:00", end: "10:45" });
    const result = cancelLessonsWithoutFee(db, {
      eventIds: [Number(first.id), Number(second.id)],
    });
    expect(result.failed).toEqual([]);
    for (const event of result.done) {
      expect(event.cancellationKind).toBe("abgesagt");
      expect(event.cancellationFeeTransactionId).toBeUndefined();
    }
    // A second run reports the already cancelled lessons instead of failing.
    const again = cancelLessonsWithoutFee(db, { eventIds: [Number(first.id)] });
    expect(again.failed[0]!.reason).toMatch(/bereits abgesagt/);
  });
});
