/* ------------------------------------------------------------------ */
/* Unit tests for the instructors module.                              */
/* Fixture pattern: openDb(":memory:") — same as crud.test.ts.         */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "./sqlite";

import { openDb } from "./db";
import { ValidationError } from "./engine";
import {
  createInstructor,
  deleteInstructor,
  getInstructor,
  listInstructors,
  updateInstructor,
  type InstructorInput,
  type InstructorStatus,
} from "./instructors";
import { listArchive } from "./archive";
import { createStudent, getStudent } from "./students";
import { ensureAttestationTables } from "./ausbildungsnachweis";
import { createCalendarEvent, getCalendarEvent } from "./calendar-events";
import {
  createTheoryGroup,
  ensureTheoryGroupTables,
  getTheoryGroup,
} from "./theory-groups";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
});

let counter = 0;
function uniq(prefix = "") {
  return `${prefix}${++counter}-${Date.now()}`;
}

function makeInstructor(overrides: Partial<InstructorInput> = {}): InstructorInput {
  return {
    firstName: "Anna",
    lastName: "Muster",
    phone: "0123456789",
    email: "anna@example.com",
    classes: "B",
    vehicle: "",
    since: "2024-01-01",
    status: "aktiv" as const,
    ...overrides,
  };
}

function makeStudent(overrides: Record<string, unknown> = {}) {
  const id = uniq();
  return {
    firstName: "Max",
    lastName: "Student",
    contractNumber: `V-${id}`,
    customerNumber: `C-${id}`,
    ...overrides,
  };
}

/* ================================================================== */
/* create                                                               */
/* ================================================================== */

describe("createInstructor", () => {
  test("happy path: returns record with id and correct fields", () => {
    const instructor = createInstructor(
      db,
      makeInstructor({ firstName: "  Britta  ", lastName: "  Schmidt  " }),
    );
    expect(instructor.id).toBeGreaterThan(0);
    expect(instructor.firstName).toBe("Britta");
    expect(instructor.lastName).toBe("Schmidt");
    expect(instructor.status).toBe("aktiv");
  });

  test("missing firstName → ValidationError", () => {
    expect(() => createInstructor(db, makeInstructor({ firstName: "" }))).toThrow(
      ValidationError,
    );
  });

  test("missing lastName → ValidationError", () => {
    expect(() => createInstructor(db, makeInstructor({ lastName: "" }))).toThrow(
      ValidationError,
    );
  });

  test("bad status → ValidationError", () => {
    expect(() =>
      createInstructor(db, makeInstructor({ status: "weg" as InstructorStatus })),
    ).toThrow(ValidationError);
  });

  test("valid status 'inaktiv' → persists", () => {
    const instructor = createInstructor(db, makeInstructor({ status: "inaktiv" }));
    expect(instructor.status).toBe("inaktiv");
  });

  test("listInstructors returns newly created instructor", () => {
    const before = listInstructors(db).length;
    createInstructor(db, makeInstructor());
    expect(listInstructors(db).length).toBe(before + 1);
  });
});

/* ================================================================== */
/* update / field merge                                                 */
/* ================================================================== */

describe("updateInstructor", () => {
  test("partial update merges — changing phone leaves name unchanged", () => {
    const instructor = createInstructor(
      db,
      makeInstructor({ firstName: "Clara", lastName: "Klein" }),
    );
    const updated = updateInstructor(db, instructor.id, { phone: "0987654321" });
    expect(updated.phone).toBe("0987654321");
    expect(updated.firstName).toBe("Clara");
    expect(updated.lastName).toBe("Klein");
  });

  test("update with unknown id → ValidationError", () => {
    expect(() => updateInstructor(db, 999999, { phone: "0000" })).toThrow(
      ValidationError,
    );
  });
});

/* ================================================================== */
/* rename cascade                                                       */
/* ================================================================== */

describe("rename (id-linked references)", () => {
  test("renaming an instructor shows the new name on students, Termine and theory groups", () => {
    const instructor = createInstructor(
      db,
      makeInstructor({ firstName: "Max", lastName: "Muster" }),
    );
    const student = createStudent(db, makeStudent({ instructorId: instructor.id }));
    const event = createCalendarEvent(db, {
      date: "2026-01-10",
      start: "10:00",
      end: "11:00",
      title: "Fahrstunde",
      type: "Praktisch",
      instructorId: instructor.id,
    });
    ensureTheoryGroupTables(db);
    const group = createTheoryGroup(db, {
      name: "Gruppe A",
      klass: "B",
      weekday: "Montag",
      time: "18:00",
      instructorId: instructor.id,
    });

    updateInstructor(db, instructor.id, { firstName: "Max", lastName: "Neumann" });

    expect(getStudent(db, student.id).instructor).toBe("Max Neumann");
    expect(getCalendarEvent(db, Number(event.id)).instructor).toBe("Max Neumann");
    expect(getTheoryGroup(db, group.id).instructor).toBe("Max Neumann");
    expect(getStudent(db, student.id).instructorId).toBe(instructor.id);
  });

  test("attestations keep the instructor name as signed (snapshot)", () => {
    const instructor = createInstructor(
      db,
      makeInstructor({ firstName: "Rena", lastName: "Alt" }),
    );
    const attId = insertAttestation(db, "Rena Alt");

    updateInstructor(db, instructor.id, { firstName: "Rena", lastName: "Neu" });

    const row = db
      .query<{ instructor: string }, [number]>(
        "SELECT instructor FROM lesson_attestations WHERE id = ?",
      )
      .get(attId);
    expect(row?.instructor).toBe("Rena Alt");
  });

  test("namesakes stay apart: renaming one instructor leaves the other's students alone", () => {
    const a = createInstructor(
      db,
      makeInstructor({ firstName: "Same", lastName: "Name" }),
    );
    const b = createInstructor(
      db,
      makeInstructor({ firstName: "Same", lastName: "Name" }),
    );
    const s1 = createStudent(db, makeStudent({ instructorId: a.id }));
    const s2 = createStudent(db, makeStudent({ instructorId: b.id }));

    updateInstructor(db, a.id, { firstName: "Same", lastName: "Renamed" });

    expect(getStudent(db, s1.id).instructor).toBe("Same Renamed");
    expect(getStudent(db, s2.id).instructor).toBe("Same Name");
  });

  test("an unknown instructor name is rejected instead of stored as a dangling reference", () => {
    expect(() => createStudent(db, makeStudent({ instructor: "Niemand Da" }))).toThrow(
      ValidationError,
    );
  });
});

/* ================================================================== */
/* delete                                                               */
/* ================================================================== */

describe("deleteInstructor", () => {
  test("removes the row from instructors", () => {
    const before = listInstructors(db).length;
    const instructor = createInstructor(db, makeInstructor());
    expect(listInstructors(db).length).toBe(before + 1);
    deleteInstructor(db, instructor.id);
    expect(listInstructors(db).length).toBe(before);
  });

  test("re-assigns students to 'Nicht zugeteilt'", () => {
    const instructor = createInstructor(
      db,
      makeInstructor({ firstName: "Lena", lastName: "Lehr" }),
    );
    const fullName = `${instructor.firstName} ${instructor.lastName}`;
    const student = createStudent(db, makeStudent({ instructor: fullName }));

    deleteInstructor(db, instructor.id);

    const updated = getStudent(db, student.id);
    expect(updated.instructor).toBe("Nicht zugeteilt");
  });

  test("re-assigns calendar_events to 'Nicht zugeteilt'", () => {
    const instructor = createInstructor(
      db,
      makeInstructor({ firstName: "Tom", lastName: "Fahr" }),
    );
    const fullName = `${instructor.firstName} ${instructor.lastName}`;
    createStudent(db, makeStudent());
    const event = createCalendarEvent(db, {
      date: "2026-02-01",
      start: "09:00",
      end: "10:00",
      title: "Fahrstunde",
      type: "Praktisch",
      instructor: fullName,
    });

    deleteInstructor(db, instructor.id);

    const ev = getCalendarEvent(db, Number(event.id));
    expect(ev.instructor).toBe("Nicht zugeteilt");
    expect(ev.instructorId).toBeNull();
  });

  test("writes archive entry with correct entity and label", () => {
    const instructor = createInstructor(
      db,
      makeInstructor({ firstName: "Karl", lastName: "Archiv" }),
    );
    const fullName = "Karl Archiv";
    const archiveBefore = listArchive(db).length;

    deleteInstructor(db, instructor.id);

    const archiveAfter = listArchive(db);
    expect(archiveAfter.length).toBe(archiveBefore + 1);
    const entry = archiveAfter[0]!;
    expect(entry.entity).toBe("instructor");
    expect(entry.label).toBe(fullName);
  });

  test("unknown id → ValidationError", () => {
    expect(() => deleteInstructor(db, 999999)).toThrow(ValidationError);
  });

  test("getInstructor on deleted id → ValidationError", () => {
    const instructor = createInstructor(db, makeInstructor());
    deleteInstructor(db, instructor.id);
    expect(() => getInstructor(db, instructor.id)).toThrow(ValidationError);
  });

  test("leaves lesson_attestations.instructor unchanged (compliance record)", () => {
    const instructor = createInstructor(
      db,
      makeInstructor({ firstName: "Doro", lastName: "Bleibt" }),
    );
    const fullName = `${instructor.firstName} ${instructor.lastName}`;
    const attId = insertAttestation(db, fullName);

    deleteInstructor(db, instructor.id);

    const row = db
      .query<{ instructor: string }, [number]>(
        "SELECT instructor FROM lesson_attestations WHERE id = ?",
      )
      .get(attId);
    expect(row?.instructor).toBe(fullName);
  });
});

/** Creates the attestation table plus a backing calendar event and inserts
    one attestation row signed by the given instructor name. Returns its id. */
function insertAttestation(db: Database, instructorName: string): number {
  ensureAttestationTables(db);
  const event = db
    .query<{ id: number }, [string]>(
      `INSERT INTO calendar_events (date, start, end, title, instructor_id, type)
       VALUES ('2026-03-01', '08:00', '09:00', 'Fahrstunde',
               (SELECT id FROM instructors
                WHERE trim(first_name || ' ' || last_name) = ?1 LIMIT 1), 'Praktisch')
       RETURNING id`,
    )
    .get(instructorName)!;
  return db
    .query<{ id: number }, [number, string]>(
      `INSERT INTO lesson_attestations
         (event_id, student_id, instructor, content, duration_min, signature_data_url)
       VALUES (?, 1, ?, 'Stadtfahrt', 45, 'data:image/png;base64,abc')
       RETURNING id`,
    )
    .get(event.id, instructorName)!.id;
}
