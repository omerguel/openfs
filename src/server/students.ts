/* ------------------------------------------------------------------ */
/* Students (Fahrschüler) — DB access + validation.                    */
/* The HTTP wrappers live in routes.ts (studentRoutes).                */
/* ------------------------------------------------------------------ */

import type { Database, SQLQueryBindings } from "./sqlite";

import type { Student } from "../lib/student-data";
import { archiveRow, tableExists } from "./archive";
import { ValidationError } from "./engine";
import {
  instructorNameSql,
  resolveInstructorId,
  resolveVehicleId,
  vehicleNameSql,
} from "./refs";
import { deriveStudentFacts, type StudentFacts } from "./student-facts";

export type StudentRecord = Student & {
  id: number;
  instructorId: number | null;
  vehicleId: number | null;
  /** Derived from the ledger; `balance` is its display string. */
  balanceCents: number;
};

/** Write payload: display names or ids for the instructor/vehicle links. */
export type StudentInput = Partial<Student> & {
  instructorId?: number | null;
  vehicleId?: number | null;
};

type StudentRow = {
  id: number;
  first_name: string;
  last_name: string;
  birthday: string;
  phone: string;
  email: string;
  address: string;
  classes: string;
  driving_school: string;
  registration_date: string;
  contract_number: string;
  customer_number: string;
  status: Student["status"];
  instructor: string;
  vehicle: string;
  instructor_id: number | null;
  vehicle_id: number | null;
  progress: number;
  documents: string;
  theory: string;
  price_plan_id: number | null;
  license_date: string | null;
};

const toStudent = (row: StudentRow, facts: StudentFacts): StudentRecord => {
  const record: StudentRecord = {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthday: row.birthday,
    phone: row.phone,
    email: row.email,
    address: row.address,
    classes: row.classes,
    drivingSchool: row.driving_school,
    registrationDate: row.registration_date,
    contractNumber: row.contract_number,
    customerNumber: row.customer_number,
    status: row.status,
    instructor: row.instructor,
    vehicle: row.vehicle,
    instructorId: row.instructor_id,
    vehicleId: row.vehicle_id,
    balance: facts.balance,
    balanceCents: facts.balanceCents,
    lastLesson: facts.lastLesson,
    nextLesson: facts.nextLesson,
    progress: row.progress,
    lessons: facts.lessons,
    documents: JSON.parse(row.documents),
    theory: JSON.parse(row.theory),
    pricePlanId: row.price_plan_id,
  };
  if (row.license_date) record.licenseDate = row.license_date;
  return record;
};

const SELECT = `SELECT s.id, s.first_name, s.last_name, s.birthday, s.phone, s.email,
  s.address, s.classes, s.driving_school, s.registration_date, s.contract_number,
  s.customer_number, s.status, s.instructor_id, s.vehicle_id,
  ${instructorNameSql("s")} AS instructor, ${vehicleNameSql("s")} AS vehicle,
  s.progress, s.documents, s.theory, s.price_plan_id, s.license_date FROM students s`;

function withFacts(db: Database, rows: StudentRow[]): StudentRecord[] {
  const facts = deriveStudentFacts(
    db,
    rows.map((row) => ({ id: row.id, customerNumber: row.customer_number })),
  );
  return rows.map((row) => toStudent(row, facts.get(row.id)!));
}

export function listStudents(db: Database): StudentRecord[] {
  return withFacts(
    db,
    db.query<StudentRow, []>(`${SELECT} ORDER BY s.last_name, s.first_name`).all(),
  );
}

export function getStudent(db: Database, id: number): StudentRecord {
  const row = db.query<StudentRow, [number]>(`${SELECT} WHERE s.id = ?`).get(id);
  if (!row) throw new ValidationError("Fahrschüler/in nicht gefunden.");
  return withFacts(db, [row])[0]!;
}

const STRING_KEYS = [
  "firstName",
  "lastName",
  "birthday",
  "phone",
  "email",
  "address",
  "classes",
  "drivingSchool",
  "registrationDate",
  "contractNumber",
  "customerNumber",
] as const;

type StringKey = (typeof STRING_KEYS)[number];

/* Merge a partial payload over current values, trimming strings and
   rejecting anything that would leave the record unusable. */
type StudentData = Student & { instructorId: number | null; vehicleId: number | null };

function normalize(db: Database, input: StudentInput, current: StudentData): StudentData {
  const next: StudentData = { ...current };

  next.instructorId = resolveInstructorId(
    db,
    { id: input.instructorId, name: input.instructor },
    current.instructorId,
  );
  next.vehicleId = resolveVehicleId(
    db,
    { id: input.vehicleId, name: input.vehicle },
    current.vehicleId,
  );

  for (const key of STRING_KEYS) {
    const value = input[key as StringKey];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new ValidationError(`Feld '${key}' muss ein Text sein.`);
    }
    next[key as StringKey] = value.trim();
  }

  if (input.status !== undefined) {
    if (input.status !== "aktiv" && input.status !== "inaktiv") {
      throw new ValidationError("Status muss 'aktiv' oder 'inaktiv' sein.");
    }
    next.status = input.status;
  }

  if (input.progress !== undefined) {
    const progress = Number(input.progress);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
      throw new ValidationError("Fortschritt muss zwischen 0 und 100 liegen.");
    }
    next.progress = Math.round(progress);
  }

  // balance, lastLesson, nextLesson and lessons are derived on read
  // (student-facts.ts) — values sent by older clients are ignored.

  if (input.documents !== undefined) {
    if (!Array.isArray(input.documents)) {
      throw new ValidationError("Feld 'documents' muss eine Liste sein.");
    }
    // Only checklist entries live here; uploaded files go through
    // POST /api/students/:id/files (student-files.ts).
    for (const entry of input.documents as unknown[]) {
      if (typeof entry === "string") continue;
      if (typeof entry === "object" && entry !== null && "kind" in entry) {
        throw new ValidationError(
          "Dateien werden nicht mehr in 'documents' gespeichert. Bitte über POST /api/students/:id/files hochladen.",
        );
      }
      throw new ValidationError("Feld 'documents' darf nur Texte enthalten.");
    }
    next.documents = (input.documents as string[])
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (input.theory !== undefined) {
    if (typeof input.theory !== "object" || input.theory === null) {
      throw new ValidationError("Feld 'theory' muss ein Objekt sein.");
    }
    next.theory = input.theory;
  }

  if (input.pricePlanId !== undefined) {
    if (
      input.pricePlanId !== null &&
      (!Number.isInteger(input.pricePlanId) || input.pricePlanId <= 0)
    ) {
      throw new ValidationError(
        "Feld 'pricePlanId' muss eine Preisplan-ID oder null sein.",
      );
    }
    next.pricePlanId = input.pricePlanId;
  }

  if (input.licenseDate !== undefined) {
    if (input.licenseDate !== null && input.licenseDate !== "") {
      if (
        typeof input.licenseDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.licenseDate)
      ) {
        throw new ValidationError(
          "Feld 'licenseDate' muss ein ISO-Datum (YYYY-MM-DD) oder leer sein.",
        );
      }
    }
    next.licenseDate = input.licenseDate ?? undefined;
  }

  if (!next.firstName || !next.lastName) {
    throw new ValidationError("Vor- und Nachname sind Pflichtfelder.");
  }
  if (!next.contractNumber || !next.customerNumber) {
    throw new ValidationError("Kunden- und Vertragsnummer sind Pflichtfelder.");
  }

  return next;
}

const EMPTY: StudentData = {
  instructorId: null,
  vehicleId: null,
  firstName: "",
  lastName: "",
  birthday: "",
  phone: "",
  email: "",
  address: "",
  classes: "",
  drivingSchool: "",
  registrationDate: "",
  contractNumber: "",
  customerNumber: "",
  status: "aktiv",
  instructor: "Nicht zugeteilt",
  vehicle: "Nicht zugeteilt",
  balance: "0,00 EUR",
  lastLesson: "Nicht geplant",
  nextLesson: "Nicht geplant",
  progress: 0,
  lessons: [],
  documents: [],
  theory: {
    lastLogin: "Noch nie",
    preExams: "Keine",
    exam: "Nicht geplant",
    status: "Aktiv",
    progress: 0,
  },
};

/* SQLite UNIQUE violations on the number columns become user-readable
   validation errors instead of opaque 500s. */
function guardUnique<T>(write: () => T): T {
  try {
    return write();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      throw new ValidationError("Kunden- oder Vertragsnummer ist bereits vergeben.");
    }
    throw error;
  }
}

function writeParams(data: StudentData) {
  return [
    data.firstName,
    data.lastName,
    data.birthday,
    data.phone,
    data.email,
    data.address,
    data.classes,
    data.drivingSchool,
    data.registrationDate,
    data.contractNumber,
    data.customerNumber,
    data.status,
    data.instructorId,
    data.vehicleId,
    data.progress,
    JSON.stringify(data.documents),
    JSON.stringify(data.theory),
    data.pricePlanId ?? null,
    data.licenseDate ?? null,
  ] as const;
}

export function createStudent(db: Database, input: StudentInput): StudentRecord {
  const data = normalize(db, input, EMPTY);
  const row = guardUnique(() =>
    db
      .query<{ id: number }, SQLQueryBindings[]>(
        `INSERT INTO students (
           first_name, last_name, birthday, phone, email, address, classes,
           driving_school, registration_date, contract_number, customer_number,
           status, instructor_id, vehicle_id, progress, documents, theory,
           price_plan_id, license_date
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .get(...writeParams(data)),
  )!;
  return getStudent(db, row.id);
}

export function updateStudent(
  db: Database,
  id: number,
  input: StudentInput,
): StudentRecord {
  const current = getStudent(db, id);
  const data = normalize(db, input, current);
  const write = db.transaction(() => {
    db.prepare(
      `UPDATE students SET
         first_name = ?, last_name = ?, birthday = ?, phone = ?, email = ?,
         address = ?, classes = ?, driving_school = ?, registration_date = ?,
         contract_number = ?, customer_number = ?, status = ?, instructor_id = ?,
         vehicle_id = ?, progress = ?, documents = ?, theory = ?,
         price_plan_id = ?, license_date = ?
       WHERE id = ?`,
    ).run(...writeParams(data), id);
    // Chat threads carry a denormalized student_name next to their
    // student_id — keep it in sync on rename.
    const oldName = `${current.firstName} ${current.lastName}`.trim();
    const newName = `${data.firstName} ${data.lastName}`.trim();
    if (newName !== oldName && tableExists(db, "conversations")) {
      db.prepare("UPDATE conversations SET student_name = ? WHERE student_id = ?").run(
        newName,
        id,
      );
    }
  });
  guardUnique(write);
  return getStudent(db, id);
}

export function deleteStudent(db: Database, id: number): void {
  const student = getStudent(db, id); // throws ValidationError if unknown
  const remove = db.transaction(() => {
    // Remember which theory groups and chats pointed here so a restore
    // can re-link them (same pattern as instructor/vehicle deletes).
    const theoryGroups = tableExists(db, "theory_groups")
      ? db
          .query<{ id: number; student_ids: string }, []>(
            "SELECT id, student_ids FROM theory_groups",
          )
          .all()
          .filter((group) => parseIdList(group.student_ids).includes(id))
      : [];
    const conversations = tableExists(db, "conversations")
      ? db
          .query<{ id: number }, [number]>(
            "SELECT id FROM conversations WHERE student_id = ?",
          )
          .all(id)
          .map((row) => row.id)
      : [];
    archiveRow(
      db,
      "student",
      id,
      `${student.firstName} ${student.lastName}`.trim() ||
        `Vertrag ${student.contractNumber}`,
      { theoryGroups: theoryGroups.map((group) => group.id), conversations },
    );
    // Drop the id from member lists — a ghost id would keep counting
    // toward the group capacity (theory-groups.ts validates against
    // studentIds, not the resolved members).
    if (theoryGroups.length > 0) {
      const updateGroup = db.prepare(
        "UPDATE theory_groups SET student_ids = ? WHERE id = ?",
      );
      for (const group of theoryGroups) {
        updateGroup.run(
          JSON.stringify(parseIdList(group.student_ids).filter((sid) => sid !== id)),
          group.id,
        );
      }
    }
    // Chat threads survive as history; only the live link is cut.
    // orphaned = 1 prevents these threads from being reused via name lookup.
    if (conversations.length > 0) {
      db.prepare(
        "UPDATE conversations SET student_id = NULL, orphaned = 1 WHERE student_id = ?",
      ).run(id);
    }
    // Calendar events survive as operational history, name-keyed via
    // subtitle — only the FK link is cut (it would otherwise block the
    // DELETE below, since PRAGMA foreign_keys is ON).
    if (tableExists(db, "calendar_events")) {
      db.prepare("UPDATE calendar_events SET student_id = NULL WHERE student_id = ?").run(
        id,
      );
    }
    // Theory attendance is operational data, not a compliance record.
    if (tableExists(db, "theory_attendance")) {
      db.prepare("DELETE FROM theory_attendance WHERE student_id = ?").run(id);
    }
    // Schülerportal links die with the student — a restore from the
    // Archiv does not bring them back (the office issues a new one).
    if (tableExists(db, "portal_tokens")) {
      db.prepare("DELETE FROM portal_tokens WHERE student_id = ?").run(id);
    }
    // lesson_attestations are deliberately untouched: retained compliance
    // records (FahrSchAusbO) — no UPDATE, no DELETE.
    db.prepare("DELETE FROM students WHERE id = ?").run(id);
  });
  remove();
}

/* Same tolerant parse as theory-groups.ts uses for student_ids. */
function parseIdList(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => Number(value))
      .filter((sid) => Number.isInteger(sid) && sid > 0);
  } catch {
    return [];
  }
}
