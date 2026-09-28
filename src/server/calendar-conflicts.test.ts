import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "./sqlite";

import { createAbsence } from "./absences";
import { createCalendarEvent } from "./calendar-events";
import { listSchedulingConflicts } from "./calendar-conflicts";
import { cancelCalendarEvent } from "./cancellations";
import { openDb } from "./db";
import { instructorIdByName } from "./refs";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
});

const RANGE = { from: "2026-06-01", to: "2026-06-30" };

const lesson = (overrides: Record<string, unknown> = {}) =>
  createCalendarEvent(db, {
    date: "2026-06-10",
    start: "09:00",
    end: "10:00",
    title: "Fahrstunde",
    instructor: "Martin Weber",
    type: "Praktisch",
    allowConflicts: true,
    ...overrides,
  });

describe("listSchedulingConflicts", () => {
  test("an empty range has no conflicts", () => {
    expect(listSchedulingConflicts(db, RANGE)).toEqual({
      overlaps: [],
      absences: [],
      count: 0,
    });
  });

  test("reports instructor and vehicle overlaps as separate pairs", () => {
    const a = lesson({ vehicle: "VW Golf", title: "A" });
    // New vehicle double bookings are rejected outright; this is legacy
    // data from before that rule.
    const b = lesson({ start: "09:30", end: "10:30", title: "B" });
    db.prepare("UPDATE calendar_events SET vehicle_id = ? WHERE id = ?").run(
      a.vehicleId,
      Number(b.id),
    );
    lesson({ start: "10:00", end: "11:00", instructor: "Nadine Aksoy", title: "C" });
    const result = listSchedulingConflicts(db, RANGE);
    expect(result.count).toBe(2);
    expect(
      result.overlaps.map((o) => [o.resource, o.label, o.first.id, o.second.id]),
    ).toEqual([
      ["instructor", "Martin Weber", a.id, b.id],
      ["vehicle", "VW Golf", a.id, b.id],
    ]);
  });

  test("ignores cancelled Termine and events outside the range", () => {
    const a = lesson();
    lesson();
    lesson({ date: "2026-07-10" });
    lesson({ date: "2026-07-10" });
    cancelCalendarEvent(db, Number(a.id), { kind: "abgesagt" });
    expect(listSchedulingConflicts(db, RANGE).count).toBe(0);
  });

  test("lists Termine on absence days", () => {
    const event = lesson();
    createAbsence(db, {
      instructorId: instructorIdByName(db, "Martin Weber")!,
      fromDate: "2026-06-09",
      toDate: "2026-06-11",
      kind: "Krank",
    });
    const result = listSchedulingConflicts(db, RANGE);
    expect(result.absences).toHaveLength(1);
    expect(result.absences[0]!.event.id).toBe(event.id);
    expect(result.absences[0]!.absence.kind).toBe("Krank");
    expect(result.count).toBe(1);
  });

  test("malformed range → ValidationError", () => {
    expect(() => listSchedulingConflicts(db, { from: "01.06.2026" })).toThrow(
      /ISO-Daten/,
    );
  });
});
