import { beforeEach, describe, expect, test } from "bun:test";

import { createCalendarEvent } from "./calendar-events";
import { backfillLessonKinds, migrateDerivedStudentFields, openDb } from "./db";
import { createTransaction } from "./engine";
import { openSqlite, type Database } from "./sqlite";
import { deriveStudentFacts } from "./student-facts";
import { createStudent, getStudent, type StudentRecord } from "./students";

let db: Database;
let student: StudentRecord;
let seq = 0;

beforeEach(() => {
  db = openDb(":memory:");
  seq += 1;
  student = createStudent(db, {
    firstName: "Fakt",
    lastName: "Test",
    contractNumber: `V-F-${seq}`,
    customerNumber: `F-${seq}`,
  });
});

const lesson = (date: string, start: string, end: string, extra = {}) =>
  createCalendarEvent(db, {
    date,
    start,
    end,
    title: "Fahrstunde",
    type: "Praktisch",
    studentId: student.id,
    allowConflicts: true,
    ...extra,
  } as never);

describe("deriveStudentFacts", () => {
  test("balance comes from the ledger", () => {
    createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-01",
      amountCents: 45_000,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: {
        customerNo: student.customerNumber,
        name: "Fakt Test",
        address: "",
        contractNo: student.contractNumber,
        classes: "B",
      },
    });
    const fresh = getStudent(db, student.id);
    expect(fresh.balanceCents).toBe(45_000);
    expect(fresh.balance).toBe("450,00 EUR");
  });

  test("last and next lesson from the calendar, cancelled ones skipped", () => {
    lesson("2026-06-01", "09:00", "09:45");
    lesson("2026-06-03", "10:00", "10:45");
    const cancelled = lesson("2026-06-02", "08:00", "08:45");
    db.prepare("UPDATE calendar_events SET cancelled_at = 'x' WHERE id = ?").run(
      Number(cancelled.id),
    );
    const facts = deriveStudentFacts(
      db,
      [{ id: student.id, customerNumber: student.customerNumber }],
      new Date(2026, 5, 2, 12, 0),
    ).get(student.id)!;
    expect(facts.lastLesson).toBe("01.06.2026, 09:00");
    expect(facts.nextLesson).toBe("03.06.2026, 10:00");
  });

  test("Sonderfahrten minutes from tagged practical lessons", () => {
    lesson("2026-06-01", "09:00", "10:30", { lessonKind: "Autobahnfahrt" });
    lesson("2026-06-01", "20:00", "20:45", { lessonKind: "Nachtfahrt" });
    lesson("2026-12-01", "09:00", "10:30", { lessonKind: "Autobahnfahrt" }); // future
    const facts = deriveStudentFacts(
      db,
      [{ id: student.id, customerNumber: student.customerNumber }],
      new Date(2026, 5, 2),
    ).get(student.id)!;
    expect(facts.lessons).toEqual([
      { label: "Überlandfahrt", done: "0/225min" },
      { label: "Autobahnfahrt", done: "90/180min" },
      { label: "Nachtfahrt", done: "45/135min" },
      { label: "Theorieunterricht", done: "0 Einheiten" },
    ]);
  });
});

describe("migrateDerivedStudentFields", () => {
  test("tags old lessons by title and drops the hand-typed columns", () => {
    const legacy = openSqlite(":memory:");
    legacy.exec(`
      CREATE TABLE students (id INTEGER PRIMARY KEY, first_name TEXT,
        balance TEXT, last_lesson TEXT, next_lesson TEXT, lessons TEXT);
      CREATE TABLE calendar_events (id INTEGER PRIMARY KEY, title TEXT, type TEXT,
        lesson_kind TEXT);
      INSERT INTO students VALUES (1, 'A', '-85,00 EUR', 'x', 'y', '[]');
      INSERT INTO calendar_events (title, type) VALUES
        ('Fahrstunde · Autobahn', 'Praktisch'),
        ('Überlandfahrt · Klasse B', 'Praktisch'),
        ('Nachtfahrt', 'Theorie'),
        ('Fahrstunde · Stadt', 'Praktisch');
    `);
    migrateDerivedStudentFields(legacy);
    expect(
      legacy
        .query<{ lesson_kind: string | null }, []>(
          "SELECT lesson_kind FROM calendar_events ORDER BY id",
        )
        .all()
        .map((r) => r.lesson_kind),
    ).toEqual(["Autobahnfahrt", "Überlandfahrt", null, null]);
    const cols = legacy
      .query<{ name: string }, []>("PRAGMA table_info(students)")
      .all()
      .map((c) => c.name);
    expect(cols).toEqual(["id", "first_name"]);
    // Idempotent.
    expect(() => migrateDerivedStudentFields(legacy)).not.toThrow();
    expect(() => backfillLessonKinds(legacy)).not.toThrow();
  });
});
