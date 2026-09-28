/* ------------------------------------------------------------------ */
/* Integration tests for the CRUD modules (no HTTP layer).             */
/* All tests run against an in-memory DB seeded by openDb(":memory:"). */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "./sqlite";

import { openDb } from "./db";
import { createTransaction, listJournal, listLedger, ValidationError } from "./engine";
import {
  createStudent,
  deleteStudent,
  getStudent,
  listStudents,
  updateStudent,
} from "./students";
import {
  createInstructor,
  deleteInstructor,
  listInstructors,
  type InstructorInput,
  type InstructorStatus,
} from "./instructors";
import { createVehicle, deleteVehicle, listVehicles } from "./vehicles";
import {
  createPricePlan,
  deletePricePlan,
  listPricePlans,
  updatePricePlan,
} from "./price-plans";
import { createCalendarEvent, getCalendarEvent } from "./calendar-events";
import { ensureTheoryGroupTables } from "./theory-groups";
import {
  createAttestation,
  ensureAttestationTables,
  listAttestationsForStudent,
} from "./ausbildungsnachweis";

let db: Database;

/* Fresh DB for each test — no seedTransactions needed (that's accounting). */
beforeEach(() => {
  db = openDb(":memory:");
});

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

let counter = 0;
function uniq(prefix = "") {
  return `${prefix}${++counter}-${Date.now()}`;
}

function makeStudent(overrides: Record<string, unknown> = {}) {
  const id = uniq();
  return {
    firstName: "Max",
    lastName: "Mustermann",
    contractNumber: `V-TEST-${id}`,
    customerNumber: `C-TEST-${id}`,
    ...overrides,
  };
}

function makeInstructor(overrides: Partial<InstructorInput> = {}): InstructorInput {
  return {
    firstName: "Anna",
    lastName: "Test",
    phone: "",
    email: "",
    classes: "B",
    vehicle: "",
    since: "2024-01-01",
    status: "aktiv" as const,
    ...overrides,
  };
}

function makeVehicle(overrides: Record<string, unknown> = {}) {
  const id = uniq("plate-");
  return {
    model: "TestAuto",
    plate: id,
    klass: "B",
    ...overrides,
  };
}

function makePricePlan(overrides: Record<string, unknown> = {}) {
  return {
    name: "Testpaket",
    guaranteedMonths: 6,
    components: [{ label: "Fahrstunde", durationMin: 45, priceCents: 7500 }],
    ...overrides,
  };
}

/* ================================================================== */
/* Students                                                             */
/* ================================================================== */

describe("students", () => {
  test("createStudent happy path: returns record with id and trimmed strings", () => {
    const student = createStudent(
      db,
      makeStudent({ firstName: "  Max  ", lastName: "  Muster  " }),
    );
    expect(student.id).toBeGreaterThan(0);
    expect(student.firstName).toBe("Max");
    expect(student.lastName).toBe("Muster");
  });

  test("createStudent: missing firstName → ValidationError", () => {
    expect(() => createStudent(db, makeStudent({ firstName: "" }))).toThrow(
      ValidationError,
    );
  });

  test("createStudent: missing lastName → ValidationError", () => {
    expect(() => createStudent(db, makeStudent({ lastName: "" }))).toThrow(
      ValidationError,
    );
  });

  test("createStudent: missing contractNumber → ValidationError", () => {
    expect(() => createStudent(db, makeStudent({ contractNumber: "" }))).toThrow(
      ValidationError,
    );
  });

  test("createStudent: missing customerNumber → ValidationError", () => {
    expect(() => createStudent(db, makeStudent({ customerNumber: "" }))).toThrow(
      ValidationError,
    );
  });

  test("createStudent: duplicate customerNumber → ValidationError with German message", () => {
    const base = makeStudent();
    createStudent(db, base);
    expect(() => createStudent(db, { ...base, contractNumber: uniq("V-") })).toThrowError(
      "Kunden- oder Vertragsnummer ist bereits vergeben.",
    );
  });

  test("createStudent: invalid status 'weg' → ValidationError", () => {
    expect(() => createStudent(db, makeStudent({ status: "weg" }))).toThrow(
      ValidationError,
    );
  });

  test("createStudent: valid status 'inaktiv' → persists", () => {
    const student = createStudent(db, makeStudent({ status: "inaktiv" }));
    expect(student.status).toBe("inaktiv");
  });

  test("createStudent: progress 101 → ValidationError", () => {
    expect(() => createStudent(db, makeStudent({ progress: 101 }))).toThrow(
      ValidationError,
    );
  });

  test("createStudent: progress -1 → ValidationError", () => {
    expect(() => createStudent(db, makeStudent({ progress: -1 }))).toThrow(
      ValidationError,
    );
  });

  test("createStudent: progress 'abc' → ValidationError", () => {
    expect(() => createStudent(db, makeStudent({ progress: "abc" }))).toThrow(
      ValidationError,
    );
  });

  test("createStudent: progress 50.4 → rounds to 50", () => {
    const student = createStudent(db, makeStudent({ progress: 50.4 }));
    expect(student.progress).toBe(50);
  });

  test("createStudent: derived fields sent by the client are ignored", () => {
    const student = createStudent(
      db,
      makeStudent({
        lessons: "not-an-array",
        balance: "999,00 EUR",
        nextLesson: "morgen",
      }),
    );
    expect(student.balance).toBe("0,00 EUR");
    expect(student.nextLesson).toBe("Nicht geplant");
    expect(Array.isArray(student.lessons)).toBe(true);
  });

  test("createStudent: pricePlanId 0 → ValidationError", () => {
    expect(() => createStudent(db, makeStudent({ pricePlanId: 0 }))).toThrow(
      ValidationError,
    );
  });

  test("createStudent: pricePlanId null → ok", () => {
    const student = createStudent(db, makeStudent({ pricePlanId: null }));
    expect(student.pricePlanId).toBeNull();
  });

  test("licenseDate roundtrip: set and read back on create", () => {
    const student = createStudent(db, makeStudent({ licenseDate: "2026-06-01" }));
    expect(student.licenseDate).toBe("2026-06-01");
  });

  test("licenseDate roundtrip: update and read back", () => {
    const created = createStudent(db, makeStudent());
    expect(created.licenseDate).toBeUndefined();
    const updated = updateStudent(db, created.id, { licenseDate: "2026-06-15" });
    expect(updated.licenseDate).toBe("2026-06-15");
  });

  test("licenseDate: not set → undefined on wire", () => {
    const student = createStudent(db, makeStudent());
    expect(student.licenseDate).toBeUndefined();
  });

  test("licenseDate: invalid format → ValidationError", () => {
    expect(() => createStudent(db, makeStudent({ licenseDate: "15.06.2026" }))).toThrow(
      ValidationError,
    );
  });

  test("updateStudent: merges partial input — changing phone leaves name unchanged", () => {
    const created = createStudent(
      db,
      makeStudent({ firstName: "Anna", lastName: "Schmidt" }),
    );
    const updated = updateStudent(db, created.id, { phone: "0123456789" });
    expect(updated.phone).toBe("0123456789");
    expect(updated.firstName).toBe("Anna");
    expect(updated.lastName).toBe("Schmidt");
  });

  test("getStudent with unknown id → ValidationError", () => {
    expect(() => getStudent(db, 999999)).toThrow(ValidationError);
  });

  test("deleteStudent: removes the row (listStudents length drops by 1)", () => {
    const before = listStudents(db).length;
    const student = createStudent(db, makeStudent());
    expect(listStudents(db).length).toBe(before + 1);
    deleteStudent(db, student.id);
    expect(listStudents(db).length).toBe(before);
  });

  test("deleteStudent: unknown id → ValidationError", () => {
    expect(() => deleteStudent(db, 999999)).toThrow(ValidationError);
  });

  test("deleteStudent: accounting snapshot survives (ledger keeps student name, journal rows intact)", () => {
    // Create a student and a transaction that snapshots their data.
    const student = createStudent(
      db,
      makeStudent({
        firstName: "Accounting",
        lastName: "Snapshot",
        customerNumber: uniq("SNAP-C-"),
        contractNumber: uniq("SNAP-V-"),
      }),
    );
    const fullName = `${student.firstName} ${student.lastName}`;
    const studentPayload = {
      customerNo: student.customerNumber,
      name: fullName,
      address: student.address,
      contractNo: student.contractNumber,
      classes: student.classes,
    };

    const journalBefore = listJournal(db, {}).length;
    createTransaction(db, {
      type: "zahlung_guthaben",
      date: "2026-06-09",
      amountCents: 10000,
      geldkonto: "1600",
      paymentMethod: "bar",
      student: studentPayload,
    });
    const journalAfterCreate = listJournal(db, {}).length;
    expect(journalAfterCreate).toBeGreaterThan(journalBefore);

    // Delete the student — hard delete.
    deleteStudent(db, student.id);
    expect(() => getStudent(db, student.id)).toThrow(ValidationError);

    // The ledger snapshot must still carry the student's name.
    const ledger = listLedger(db, {});
    const ledgerHasName = ledger.rows.some((row) => row.studentName === fullName);
    expect(ledgerHasName).toBe(true);

    // The journal rows must still exist (no cascade delete).
    const journalAfterDelete = listJournal(db, {}).length;
    expect(journalAfterDelete).toBe(journalAfterCreate);
  });

  test("deleteStudent: succeeds despite linked calendar event; event survives with link cleared", () => {
    const student = createStudent(db, makeStudent());
    const event = createCalendarEvent(db, {
      date: "2026-06-15",
      start: "09:00",
      end: "10:00",
      title: "Fahrstunde",
      instructor: "Martin Weber",
      type: "Praktisch",
      studentId: student.id,
    });
    expect(event.studentId).toBe(student.id);

    // Before the fix this threw a raw SQLite FK constraint error.
    deleteStudent(db, student.id);

    const survivor = getCalendarEvent(db, Number(event.id));
    expect(survivor.studentId).toBeUndefined();
  });

  test("deleteStudent: removes the student's theory_attendance rows", () => {
    ensureTheoryGroupTables(db);
    const student = createStudent(db, makeStudent());
    const group = db
      .query<{ id: number }, []>("SELECT id FROM theory_groups LIMIT 1")
      .get()!;
    db.prepare(
      "INSERT INTO theory_attendance (group_id, student_id, session_date) VALUES (?, ?, ?)",
    ).run(group.id, student.id, "2026-06-10");

    deleteStudent(db, student.id);

    const remaining = db
      .query<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM theory_attendance WHERE student_id = ?",
      )
      .get(student.id)!.n;
    expect(remaining).toBe(0);
  });

  test("deleteStudent: lesson_attestations are retained (compliance records)", () => {
    ensureAttestationTables(db);
    const student = createStudent(db, makeStudent());
    const event = createCalendarEvent(db, {
      date: "2026-06-15",
      start: "09:00",
      end: "10:00",
      title: "Fahrstunde",
      instructor: "Martin Weber",
      type: "Praktisch",
      studentId: student.id,
    });
    createAttestation(db, {
      eventId: Number(event.id),
      studentId: student.id,
      instructor: "Martin Weber",
      content: "Überlandfahrt",
      durationMin: 45,
      signatureDataUrl: "data:image/png;base64,abc123",
    });

    deleteStudent(db, student.id);

    expect(listAttestationsForStudent(db, student.id)).toHaveLength(1);
  });
});

/* ================================================================== */
/* Instructors                                                          */
/* ================================================================== */

describe("instructors", () => {
  test("createInstructor happy path: returns record with id", () => {
    const instructor = createInstructor(db, makeInstructor());
    expect(instructor.id).toBeGreaterThan(0);
    expect(instructor.firstName).toBe("Anna");
    expect(instructor.lastName).toBe("Test");
  });

  test("createInstructor: missing firstName → ValidationError", () => {
    expect(() => createInstructor(db, makeInstructor({ firstName: "" }))).toThrow(
      ValidationError,
    );
  });

  test("createInstructor: missing lastName → ValidationError", () => {
    expect(() => createInstructor(db, makeInstructor({ lastName: "" }))).toThrow(
      ValidationError,
    );
  });

  test("createInstructor: bad status → ValidationError", () => {
    expect(() =>
      createInstructor(db, makeInstructor({ status: "gekündigt" as InstructorStatus })),
    ).toThrow(ValidationError);
  });

  test("deleteInstructor: removes the row", () => {
    const before = listInstructors(db).length;
    const instructor = createInstructor(db, makeInstructor());
    expect(listInstructors(db).length).toBe(before + 1);
    deleteInstructor(db, instructor.id);
    expect(listInstructors(db).length).toBe(before);
  });

  test("deleteInstructor: re-assigns that instructor's students to 'Nicht zugeteilt'", () => {
    // Create an instructor and a student assigned to them.
    const instructor = createInstructor(
      db,
      makeInstructor({ firstName: "Test", lastName: "Lehrer" }),
    );
    const fullName = `${instructor.firstName} ${instructor.lastName}`;
    const student = createStudent(db, makeStudent({ instructor: fullName }));
    expect(student.instructor).toBe(fullName);

    // Delete the instructor.
    deleteInstructor(db, instructor.id);

    // Student's instructor field must now be "Nicht zugeteilt".
    const updated = getStudent(db, student.id);
    expect(updated.instructor).toBe("Nicht zugeteilt");
  });
});

/* ================================================================== */
/* Vehicles                                                             */
/* ================================================================== */

describe("vehicles", () => {
  test("createVehicle happy path: returns record with id", () => {
    const vehicle = createVehicle(db, makeVehicle());
    expect(vehicle.id).toBeGreaterThan(0);
    expect(vehicle.model).toBe("TestAuto");
  });

  test("createVehicle: missing model → ValidationError", () => {
    expect(() => createVehicle(db, makeVehicle({ model: "" }))).toThrow(ValidationError);
  });

  test("createVehicle: missing plate → ValidationError", () => {
    expect(() => createVehicle(db, makeVehicle({ plate: "" }))).toThrow(ValidationError);
  });

  test("createVehicle: missing klass → ValidationError", () => {
    expect(() => createVehicle(db, makeVehicle({ klass: "" }))).toThrow(ValidationError);
  });

  test("createVehicle: bad status → ValidationError", () => {
    expect(() => createVehicle(db, makeVehicle({ status: "defekt" }))).toThrow(
      ValidationError,
    );
  });

  test("createVehicle: duplicate plate → ValidationError with German message", () => {
    const v = makeVehicle();
    createVehicle(db, v);
    expect(() => createVehicle(db, { ...v })).toThrowError(
      "Kennzeichen ist bereits vergeben.",
    );
  });

  test("deleteVehicle: removes the row", () => {
    const before = listVehicles(db).length;
    const vehicle = createVehicle(db, makeVehicle());
    expect(listVehicles(db).length).toBe(before + 1);
    deleteVehicle(db, vehicle.id);
    expect(listVehicles(db).length).toBe(before);
  });
});

/* ================================================================== */
/* Price Plans                                                          */
/* ================================================================== */

describe("price plans", () => {
  test("createPricePlan happy path: returns record with id", () => {
    const plan = createPricePlan(db, makePricePlan());
    expect(plan.id).toBeGreaterThan(0);
    expect(plan.name).toBe("Testpaket");
    expect(plan.components.length).toBe(1);
  });

  test("updatePricePlan: updates name and components", () => {
    const plan = createPricePlan(db, makePricePlan());
    const updated = updatePricePlan(db, plan.id, {
      name: "Neues Paket",
      components: [{ label: "Intensivstunde", durationMin: 60, priceCents: 9000 }],
    });
    expect(updated.name).toBe("Neues Paket");
    expect(updated.components[0]!.label).toBe("Intensivstunde");
  });

  test("deletePricePlan: removes the row", () => {
    const before = listPricePlans(db).length;
    const plan = createPricePlan(db, makePricePlan());
    expect(listPricePlans(db).length).toBe(before + 1);
    deletePricePlan(db, plan.id);
    expect(listPricePlans(db).length).toBe(before);
  });

  test("createPricePlan: missing name → ValidationError", () => {
    expect(() => createPricePlan(db, { ...makePricePlan(), name: "" })).toThrow(
      ValidationError,
    );
  });

  test("createPricePlan: empty components → ValidationError", () => {
    expect(() => createPricePlan(db, { ...makePricePlan(), components: [] })).toThrow(
      ValidationError,
    );
  });
});
