/* ------------------------------------------------------------------ */
/* Instructors (Fahrlehrer/innen) — DB access + validation.            */
/* The HTTP wrappers live in routes.ts (instructorRoutes).             */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import { archiveRow, tableExists } from "./archive";
import { ValidationError } from "./engine";
import { resolveVehicleId, vehicleNameSql } from "./refs";

export type InstructorStatus = "aktiv" | "inaktiv";

export type Instructor = {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  classes: string;
  vehicle: string;
  vehicleId: number | null;
  since: string;
  status: InstructorStatus;
};

export type InstructorInput = Omit<Instructor, "id" | "vehicleId"> & {
  vehicleId?: number | null;
};

type InstructorData = Omit<Instructor, "id" | "vehicle">;

type InstructorRow = {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  classes: string;
  vehicle: string;
  vehicle_id: number | null;
  since: string;
  status: InstructorStatus;
};

const toInstructor = (row: InstructorRow): Instructor => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  phone: row.phone,
  email: row.email,
  classes: row.classes,
  vehicle: row.vehicle,
  vehicleId: row.vehicle_id,
  since: row.since,
  status: row.status,
});

const SELECT = `SELECT i.id, i.first_name, i.last_name, i.phone, i.email, i.classes,
  i.vehicle_id, ${vehicleNameSql("i")} AS vehicle, i.since, i.status FROM instructors i`;

export function listInstructors(db: Database): Instructor[] {
  return db
    .query<InstructorRow, []>(`${SELECT} ORDER BY i.last_name, i.first_name`)
    .all()
    .map(toInstructor);
}

export function getInstructor(db: Database, id: number): Instructor {
  const row = db.query<InstructorRow, [number]>(`${SELECT} WHERE i.id = ?`).get(id);
  if (!row) throw new ValidationError("Fahrlehrer/in nicht gefunden.");
  return toInstructor(row);
}

/* Merge a partial payload over current values, trimming strings and
   rejecting anything that would leave the record unusable. */
function normalize(
  db: Database,
  input: Partial<InstructorInput>,
  current: InstructorData,
): InstructorData {
  type TextKey = "firstName" | "lastName" | "phone" | "email" | "classes" | "since";
  const str = (key: TextKey): string => {
    const value = input[key];
    if (value === undefined) return current[key];
    if (typeof value !== "string") {
      throw new ValidationError(`Feld '${key}' muss ein Text sein.`);
    }
    return value.trim();
  };

  const next: InstructorData = {
    firstName: str("firstName"),
    lastName: str("lastName"),
    phone: str("phone"),
    email: str("email"),
    classes: str("classes"),
    vehicleId: resolveVehicleId(
      db,
      { id: input.vehicleId, name: input.vehicle },
      current.vehicleId,
    ),
    since: str("since"),
    status: current.status,
  };

  if (input.status !== undefined) {
    if (input.status !== "aktiv" && input.status !== "inaktiv") {
      throw new ValidationError("Status muss 'aktiv' oder 'inaktiv' sein.");
    }
    next.status = input.status;
  }

  if (!next.firstName || !next.lastName) {
    throw new ValidationError("Vor- und Nachname sind Pflichtfelder.");
  }

  return next;
}

const EMPTY: InstructorData = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  classes: "",
  vehicleId: null,
  since: "",
  status: "aktiv",
};

export function createInstructor(
  db: Database,
  input: Partial<InstructorInput>,
): Instructor {
  const data = normalize(db, input, EMPTY);
  const row = db
    .query<
      { id: number },
      [string, string, string, string, string, number | null, string, string]
    >(
      `INSERT INTO instructors (first_name, last_name, phone, email, classes, vehicle_id, since, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      data.firstName,
      data.lastName,
      data.phone,
      data.email,
      data.classes,
      data.vehicleId,
      data.since,
      data.status,
    )!;
  return getInstructor(db, row.id);
}

export function updateInstructor(
  db: Database,
  id: number,
  input: Partial<InstructorInput>,
): Instructor {
  const current = getInstructor(db, id);
  const data = normalize(db, input, current);
  // Students, Termine and theory groups link by instructor_id, so a
  // rename needs no cascade — display names are derived on read.
  db.prepare(
    `UPDATE instructors
     SET first_name = ?, last_name = ?, phone = ?, email = ?, classes = ?, vehicle_id = ?, since = ?, status = ?
     WHERE id = ?`,
  ).run(
    data.firstName,
    data.lastName,
    data.phone,
    data.email,
    data.classes,
    data.vehicleId,
    data.since,
    data.status,
    id,
  );
  return getInstructor(db, id);
}

export function deleteInstructor(db: Database, id: number): void {
  const instructor = getInstructor(db, id);
  const name = `${instructor.firstName} ${instructor.lastName}`.trim();

  const linked = (table: string): number[] =>
    tableExists(db, table)
      ? db
          .query<{ id: number }, [number]>(
            `SELECT id FROM ${table} WHERE instructor_id = ?`,
          )
          .all(id)
          .map((row) => row.id)
      : [];

  const remove = db.transaction(() => {
    // Remember who was assigned so a restore can re-link them.
    const students = linked("students");
    const theoryGroups = linked("theory_groups");
    const calendarEvents = linked("calendar_events");
    archiveRow(db, "instructor", id, name || "Fahrlehrer/in", {
      students,
      theoryGroups,
      calendarEvents,
    });
    for (const table of ["students", "theory_groups", "calendar_events"]) {
      if (tableExists(db, table)) {
        db.prepare(
          `UPDATE ${table} SET instructor_id = NULL WHERE instructor_id = ?`,
        ).run(id);
      }
    }
    // Absences only describe this instructor's calendar — they go with them.
    if (tableExists(db, "instructor_absences")) {
      db.prepare("DELETE FROM instructor_absences WHERE instructor_id = ?").run(id);
    }
    // lesson_attestations keep the instructor name on purpose: they record
    // who actually gave the lesson — rewriting would falsify a compliance record.
    db.prepare("DELETE FROM instructors WHERE id = ?").run(id);
  });

  remove();
}
