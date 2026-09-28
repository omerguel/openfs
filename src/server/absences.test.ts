/* ------------------------------------------------------------------ */
/* Unit tests for instructor absences: CRUD, filters, the calendar    */
/* block and the cascade on instructor delete. In-memory DB per test. */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "./sqlite";

import {
  createAbsence,
  deleteAbsence,
  findAbsence,
  getAbsence,
  listAbsences,
} from "./absences";
import { createCalendarEvent, updateCalendarEvent } from "./calendar-events";
import { openDb } from "./db";
import { ValidationError } from "./engine";
import { deleteInstructor } from "./instructors";
import { instructorIdByName } from "./refs";

let db: Database;
let martin: number;
let nadine: number;

beforeEach(() => {
  db = openDb(":memory:");
  martin = instructorIdByName(db, "Martin Weber")!;
  nadine = instructorIdByName(db, "Nadine Aksoy")!;
});

const LESSON = {
  date: "2026-07-15",
  start: "09:00",
  end: "09:45",
  title: "Fahrstunde",
  instructor: "Martin Weber",
  type: "Praktisch" as const,
};

describe("createAbsence", () => {
  test("happy path returns the record with display name", () => {
    const absence = createAbsence(db, {
      instructorId: martin,
      fromDate: "2026-07-13",
      toDate: "2026-07-17",
      kind: "Urlaub",
      note: "  Sommer  ",
    });
    expect(absence.instructor).toBe("Martin Weber");
    expect(absence.note).toBe("Sommer");
    expect(getAbsence(db, absence.id)).toEqual(absence);
  });

  test("toDate defaults to fromDate (single day)", () => {
    const absence = createAbsence(db, {
      instructorId: martin,
      fromDate: "2026-07-13",
      kind: "Krank",
    });
    expect(absence.toDate).toBe("2026-07-13");
  });

  test("validation errors", () => {
    const base = {
      instructorId: martin,
      fromDate: "2026-07-13",
      kind: "Urlaub" as const,
    };
    expect(() => createAbsence(db, { ...base, instructorId: 9999 })).toThrow(
      /nicht gefunden/,
    );
    expect(() => createAbsence(db, { ...base, fromDate: "13.07.2026" })).toThrow(
      ValidationError,
    );
    expect(() => createAbsence(db, { ...base, fromDate: "2026-02-30" })).toThrow(
      /Ungültiges Datum/,
    );
    expect(() => createAbsence(db, { ...base, toDate: "2026-07-12" })).toThrow(
      /nicht vor dem Von-Datum/,
    );
    expect(() =>
      createAbsence(db, { ...base, kind: "Party" as unknown as "Urlaub" }),
    ).toThrow(/Art muss/);
  });
});

describe("listAbsences / findAbsence / deleteAbsence", () => {
  beforeEach(() => {
    createAbsence(db, {
      instructorId: martin,
      fromDate: "2026-07-13",
      toDate: "2026-07-17",
      kind: "Urlaub",
    });
    createAbsence(db, { instructorId: nadine, fromDate: "2026-08-03", kind: "Krank" });
  });

  test("filters by instructor and overlapping window", () => {
    expect(listAbsences(db)).toHaveLength(2);
    expect(listAbsences(db, { instructorId: nadine })).toHaveLength(1);
    expect(listAbsences(db, { from: "2026-07-17", to: "2026-07-20" })).toHaveLength(1);
    expect(listAbsences(db, { from: "2026-07-18", to: "2026-08-02" })).toHaveLength(0);
  });

  test("findAbsence covers the inclusive range", () => {
    expect(findAbsence(db, martin, "2026-07-13")?.kind).toBe("Urlaub");
    expect(findAbsence(db, martin, "2026-07-17")?.kind).toBe("Urlaub");
    expect(findAbsence(db, martin, "2026-07-18")).toBeNull();
    expect(findAbsence(db, nadine, "2026-07-15")).toBeNull();
  });

  test("deleteAbsence removes; unknown id → ValidationError", () => {
    const [first] = listAbsences(db);
    deleteAbsence(db, first!.id);
    expect(listAbsences(db)).toHaveLength(1);
    expect(() => deleteAbsence(db, first!.id)).toThrow("Abwesenheit nicht gefunden.");
  });
});

describe("calendar block", () => {
  beforeEach(() => {
    createAbsence(db, {
      instructorId: martin,
      fromDate: "2026-07-13",
      toDate: "2026-07-17",
      kind: "Fortbildung",
    });
  });

  test("creating a Termin on an absence day → ValidationError", () => {
    expect(() => createCalendarEvent(db, LESSON)).toThrow(
      "Martin Weber ist am 15.07.2026 abwesend (Fortbildung).",
    );
  });

  test("moving a Termin onto an absence day → ValidationError", () => {
    const event = createCalendarEvent(db, { ...LESSON, date: "2026-07-20" });
    expect(() =>
      updateCalendarEvent(db, Number(event.id), { date: "2026-07-16" }),
    ).toThrow(/abwesend/);
    expect(() =>
      updateCalendarEvent(db, Number(event.id), { instructor: "Martin Weber" }),
    ).not.toThrow();
  });

  test("allowConflicts: true overrides; other instructors are unaffected", () => {
    expect(createCalendarEvent(db, { ...LESSON, allowConflicts: true }).id).toBeTruthy();
    expect(
      createCalendarEvent(db, { ...LESSON, instructor: "Nadine Aksoy" }).id,
    ).toBeTruthy();
  });
});

describe("deleteInstructor", () => {
  test("removes the instructor's absences inside the delete", () => {
    createAbsence(db, { instructorId: martin, fromDate: "2026-07-13", kind: "Urlaub" });
    createAbsence(db, { instructorId: nadine, fromDate: "2026-07-13", kind: "Urlaub" });
    deleteInstructor(db, martin);
    const remaining = listAbsences(db);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.instructorId).toBe(nadine);
  });
});
