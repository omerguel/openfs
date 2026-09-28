/* ------------------------------------------------------------------ */
/* Unit tests for the Ausbildungsnachweis module.                      */
/* Uses an in-memory DB opened via openDb() so migrations (including   */
/* migrateCalendarEventBilling which adds student_id) are applied.     */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "./sqlite";

import { openDb } from "./db";
import { ValidationError } from "./engine";
import {
  createAttestation,
  ensureAttestationTables,
  getAttestationForEvent,
  listAttestationsForStudent,
} from "./ausbildungsnachweis";

let db: Database;

const SIG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let studentSeq = 0;

/** Inserts a minimal student, returns id. */
function insertStudent(target: Database, firstName = "Lena", lastName = "Braun"): number {
  studentSeq += 1;
  const row = target
    .query<{ id: number }, [string, string, string, string]>(
      `INSERT INTO students
         (first_name, last_name, birthday, phone, email, address, classes,
          driving_school, registration_date, contract_number, customer_number)
       VALUES (?, ?, '', '', '', '', 'B', 'Fahrschule', '01.01.2026', ?, ?)
       RETURNING id`,
    )
    .get(firstName, lastName, `V-TEST-${studentSeq}`, `C${studentSeq}`)!;
  return row.id;
}

/** Inserts a minimal Praktisch calendar event linked to a student, returns id. */
function insertPraktischEvent(
  target: Database,
  studentId: number,
  opts: { type?: string } = {},
): number {
  const type = opts.type ?? "Praktisch";
  const row = target
    .query<{ id: number }, [string, number | null]>(
      `INSERT INTO calendar_events
         (date, start, "end", title, instructor_id, type, student_id)
       VALUES ('2026-06-10', '09:00', '10:30', 'Fahrstunde',
               (SELECT id FROM instructors WHERE last_name = 'Weber'), ?, ?)
       RETURNING id`,
    )
    .get(type, studentId)!;
  return row.id;
}

beforeEach(() => {
  db = openDb(":memory:");
  ensureAttestationTables(db);
  // Remove seeded events to keep tests isolated
  db.exec("DELETE FROM lesson_attestations");
  db.exec("DELETE FROM calendar_events");
  db.exec("DELETE FROM students");
});

/* ------------------------------------------------------------------ */
/* Happy path                                                          */
/* ------------------------------------------------------------------ */

describe("createAttestation — happy path", () => {
  test("creates and returns a valid attestation", () => {
    const sid = insertStudent(db);
    const eid = insertPraktischEvent(db, sid);

    const att = createAttestation(db, {
      eventId: eid,
      studentId: sid,
      instructor: "Martin Weber",
      content: "Stadtfahrt, Einparken",
      durationMin: 90,
      signatureDataUrl: SIG,
    });

    expect(att.eventId).toBe(eid);
    expect(att.studentId).toBe(sid);
    expect(att.durationMin).toBe(90);
    expect(att.content).toBe("Stadtfahrt, Einparken");
    expect(att.signatureDataUrl).toBe(SIG);
    expect(typeof att.signedAt).toBe("string");
    expect(att.id).toBeGreaterThan(0);
  });

  test("getAttestationForEvent returns the just-created record", () => {
    const sid = insertStudent(db);
    const eid = insertPraktischEvent(db, sid);
    createAttestation(db, {
      eventId: eid,
      studentId: sid,
      instructor: "X",
      content: "",
      durationMin: 45,
      signatureDataUrl: SIG,
    });
    const found = getAttestationForEvent(db, eid);
    expect(found).not.toBeNull();
    expect(found!.eventId).toBe(eid);
  });

  test("getAttestationForEvent returns null when no attestation exists", () => {
    const sid = insertStudent(db);
    const eid = insertPraktischEvent(db, sid);
    expect(getAttestationForEvent(db, eid)).toBeNull();
  });

  test("listAttestationsForStudent returns all attestations for the student", () => {
    const sid = insertStudent(db);
    const eid1 = insertPraktischEvent(db, sid);
    const eid2 = insertPraktischEvent(db, sid);
    createAttestation(db, {
      eventId: eid1,
      studentId: sid,
      instructor: "",
      content: "",
      durationMin: 45,
      signatureDataUrl: SIG,
    });
    createAttestation(db, {
      eventId: eid2,
      studentId: sid,
      instructor: "",
      content: "",
      durationMin: 90,
      signatureDataUrl: SIG,
    });
    const list = listAttestationsForStudent(db, sid);
    expect(list).toHaveLength(2);
  });

  test("the list carries the lesson date and Fahrtart for the printout", () => {
    const sid = insertStudent(db);
    const eid = insertPraktischEvent(db, sid);
    db.prepare("UPDATE calendar_events SET lesson_kind = 'Nachtfahrt' WHERE id = ?").run(
      eid,
    );
    createAttestation(db, {
      eventId: eid,
      studentId: sid,
      instructor: "",
      content: "",
      durationMin: 45,
      signatureDataUrl: SIG,
    });
    expect(listAttestationsForStudent(db, sid)[0]).toMatchObject({
      lessonDate: "2026-06-10",
      lessonKind: "Nachtfahrt",
    });
  });
});

/* ------------------------------------------------------------------ */
/* Rejection: duplicate                                                */
/* ------------------------------------------------------------------ */

describe("createAttestation — duplicate rejected", () => {
  test("second attestation for the same event → ValidationError", () => {
    const sid = insertStudent(db);
    const eid = insertPraktischEvent(db, sid);
    createAttestation(db, {
      eventId: eid,
      studentId: sid,
      instructor: "X",
      content: "",
      durationMin: 45,
      signatureDataUrl: SIG,
    });
    expect(() =>
      createAttestation(db, {
        eventId: eid,
        studentId: sid,
        instructor: "X",
        content: "",
        durationMin: 45,
        signatureDataUrl: SIG,
      }),
    ).toThrow(ValidationError);
  });
});

/* ------------------------------------------------------------------ */
/* Rejection: wrong event type                                         */
/* ------------------------------------------------------------------ */

describe("createAttestation — wrong event type rejected", () => {
  test("event of type Theorie → ValidationError", () => {
    const sid = insertStudent(db);
    const eid = insertPraktischEvent(db, sid, { type: "Theorie" });
    expect(() =>
      createAttestation(db, {
        eventId: eid,
        studentId: sid,
        instructor: "X",
        content: "",
        durationMin: 45,
        signatureDataUrl: SIG,
      }),
    ).toThrow(ValidationError);
  });
});

/* ------------------------------------------------------------------ */
/* Rejection: student mismatch                                         */
/* ------------------------------------------------------------------ */

describe("createAttestation — student mismatch rejected", () => {
  test("different studentId than on the event → ValidationError", () => {
    const sid1 = insertStudent(db, "Lena", "Braun");
    const sid2 = insertStudent(db, "Max", "Müller");
    const eid = insertPraktischEvent(db, sid1);
    expect(() =>
      createAttestation(db, {
        eventId: eid,
        studentId: sid2, // wrong student
        instructor: "X",
        content: "",
        durationMin: 45,
        signatureDataUrl: SIG,
      }),
    ).toThrow(ValidationError);
  });
});

/* ------------------------------------------------------------------ */
/* Rejection: bad signature data-URL                                   */
/* ------------------------------------------------------------------ */

describe("createAttestation — bad data-url rejected", () => {
  test("non-PNG data-url → ValidationError", () => {
    const sid = insertStudent(db);
    const eid = insertPraktischEvent(db, sid);
    expect(() =>
      createAttestation(db, {
        eventId: eid,
        studentId: sid,
        instructor: "X",
        content: "",
        durationMin: 45,
        signatureDataUrl: "data:image/jpeg;base64,/9j/4AAQ",
      }),
    ).toThrow(ValidationError);
  });

  test("plain string (not a data-url) → ValidationError", () => {
    const sid = insertStudent(db);
    const eid = insertPraktischEvent(db, sid);
    expect(() =>
      createAttestation(db, {
        eventId: eid,
        studentId: sid,
        instructor: "X",
        content: "",
        durationMin: 45,
        signatureDataUrl: "not-a-data-url",
      }),
    ).toThrow(ValidationError);
  });
});

/* ------------------------------------------------------------------ */
/* Rejection: oversize signature                                        */
/* ------------------------------------------------------------------ */

describe("createAttestation — oversize signature rejected", () => {
  test("signature longer than 200k chars → ValidationError", () => {
    const sid = insertStudent(db);
    const eid = insertPraktischEvent(db, sid);
    // Oversize: prefix + 200_001 'A' chars
    const oversized = `data:image/png;base64,${"A".repeat(200_000)}`;
    expect(() =>
      createAttestation(db, {
        eventId: eid,
        studentId: sid,
        instructor: "X",
        content: "",
        durationMin: 45,
        signatureDataUrl: oversized,
      }),
    ).toThrow(ValidationError);
  });
});

/* ------------------------------------------------------------------ */
/* Rejection: zero/negative duration                                   */
/* ------------------------------------------------------------------ */

describe("createAttestation — invalid duration rejected", () => {
  test("durationMin = 0 → ValidationError", () => {
    const sid = insertStudent(db);
    const eid = insertPraktischEvent(db, sid);
    expect(() =>
      createAttestation(db, {
        eventId: eid,
        studentId: sid,
        instructor: "X",
        content: "",
        durationMin: 0,
        signatureDataUrl: SIG,
      }),
    ).toThrow(ValidationError);
  });

  test("durationMin = -5 → ValidationError", () => {
    const sid = insertStudent(db);
    const eid = insertPraktischEvent(db, sid);
    expect(() =>
      createAttestation(db, {
        eventId: eid,
        studentId: sid,
        instructor: "X",
        content: "",
        durationMin: -5,
        signatureDataUrl: SIG,
      }),
    ).toThrow(ValidationError);
  });
});

/* ------------------------------------------------------------------ */
/* Immutability — no UPDATE/DELETE                                     */
/* ------------------------------------------------------------------ */

describe("immutability", () => {
  test("no UPDATE on lesson_attestations is possible via API", () => {
    // We just verify there's no exported update/delete function.
    // The type check enforces this at compile time; here we confirm
    // the module shape at runtime.
    const mod = require("./ausbildungsnachweis") as Record<string, unknown>;
    expect(mod.updateAttestation).toBeUndefined();
    expect(mod.deleteAttestation).toBeUndefined();
  });
});
