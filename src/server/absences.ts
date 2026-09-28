/* ------------------------------------------------------------------ */
/* Instructor absences (Abwesenheiten) — DB access + validation.       */
/* Self-contained module: ensureAbsenceTables(db) creates the table    */
/* (openDb calls it, so every consumer can rely on it), absenceRoutes  */
/* returns the Bun.serve() entries (mounted in app-routes.ts).          */
/*                                                                     */
/* An absence blocks new/moved Termine of that instructor on the days  */
/* it covers (see checkScheduling in calendar-events.ts).              */
/* ------------------------------------------------------------------ */

import type { Database, SQLQueryBindings } from "./sqlite";
import type { BunRequest } from "bun";

import { ValidationError } from "./engine";
import { handle, json } from "./http";
import { instructorNameSql } from "./refs";

export const ABSENCE_KINDS = ["Urlaub", "Krank", "Fortbildung", "Sonstiges"] as const;

export type AbsenceKind = (typeof ABSENCE_KINDS)[number];

export type Absence = {
  id: number;
  instructorId: number;
  /** Display name, derived on read. */
  instructor: string;
  /** Inclusive ISO date range. */
  fromDate: string;
  toDate: string;
  kind: AbsenceKind;
  note: string;
  createdAt: string;
};

export type AbsenceInput = {
  instructorId: number;
  fromDate: string;
  toDate: string;
  kind: AbsenceKind;
  note?: string;
};

export function ensureAbsenceTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS instructor_absences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instructor_id INTEGER NOT NULL REFERENCES instructors(id),
      from_date TEXT NOT NULL,
      to_date TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('Urlaub','Krank','Fortbildung','Sonstiges')),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_instructor_absences_instructor
      ON instructor_absences(instructor_id, from_date);
  `);
}

type AbsenceRow = {
  id: number;
  instructor_id: number;
  instructor: string;
  from_date: string;
  to_date: string;
  kind: AbsenceKind;
  note: string;
  created_at: string;
};

const toAbsence = (row: AbsenceRow): Absence => ({
  id: row.id,
  instructorId: row.instructor_id,
  instructor: row.instructor,
  fromDate: row.from_date,
  toDate: row.to_date,
  kind: row.kind,
  note: row.note,
  createdAt: row.created_at,
});

const SELECT = `SELECT a.id, a.instructor_id, ${instructorNameSql("a")} AS instructor,
  a.from_date, a.to_date, a.kind, a.note, a.created_at FROM instructor_absences a`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireIsoDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    throw new ValidationError(`${label} muss ein ISO-Datum (JJJJ-MM-TT) sein.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(`Ungültiges Datum: ${value}.`);
  }
  return value;
}

export type AbsenceFilter = { instructorId?: number; from?: string; to?: string };

/** Absences overlapping the optional [from, to] window, oldest first. */
export function listAbsences(db: Database, filter: AbsenceFilter = {}): Absence[] {
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (filter.instructorId !== undefined) {
    clauses.push("a.instructor_id = ?");
    params.push(filter.instructorId);
  }
  if (filter.from) {
    clauses.push("a.to_date >= ?");
    params.push(requireIsoDate(filter.from, "Von-Datum"));
  }
  if (filter.to) {
    clauses.push("a.from_date <= ?");
    params.push(requireIsoDate(filter.to, "Bis-Datum"));
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return db
    .query<AbsenceRow, SQLQueryBindings[]>(
      `${SELECT}${where} ORDER BY a.from_date, a.instructor_id, a.id`,
    )
    .all(...params)
    .map(toAbsence);
}

export function getAbsence(db: Database, id: number): Absence {
  const row = db.query<AbsenceRow, [number]>(`${SELECT} WHERE a.id = ?`).get(id);
  if (!row) throw new ValidationError("Abwesenheit nicht gefunden.");
  return toAbsence(row);
}

/** The absence covering `date` for this instructor, if any. */
export function findAbsence(
  db: Database,
  instructorId: number,
  date: string,
): Absence | null {
  const row = db
    .query<AbsenceRow, [number, string, string]>(
      `${SELECT} WHERE a.instructor_id = ? AND a.from_date <= ? AND a.to_date >= ?
       ORDER BY a.from_date LIMIT 1`,
    )
    .get(instructorId, date, date);
  return row ? toAbsence(row) : null;
}

export function createAbsence(db: Database, input: Partial<AbsenceInput>): Absence {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Ungültige Anfrage.");
  }
  const instructorId = input.instructorId;
  if (
    typeof instructorId !== "number" ||
    !Number.isInteger(instructorId) ||
    instructorId <= 0
  ) {
    throw new ValidationError("Feld 'instructorId' muss eine positive ganze Zahl sein.");
  }
  if (!db.query("SELECT 1 FROM instructors WHERE id = ?").get(instructorId)) {
    throw new ValidationError(`Fahrlehrer/in mit ID ${instructorId} nicht gefunden.`);
  }
  const fromDate = requireIsoDate(input.fromDate, "Von-Datum");
  const toDate = requireIsoDate(input.toDate ?? input.fromDate, "Bis-Datum");
  if (toDate < fromDate) {
    throw new ValidationError("Bis-Datum darf nicht vor dem Von-Datum liegen.");
  }
  if (!ABSENCE_KINDS.includes(input.kind as AbsenceKind)) {
    throw new ValidationError(
      "Art muss 'Urlaub', 'Krank', 'Fortbildung' oder 'Sonstiges' sein.",
    );
  }
  if (input.note !== undefined && typeof input.note !== "string") {
    throw new ValidationError("Feld 'note' muss ein Text sein.");
  }
  const row = db
    .query<{ id: number }, [number, string, string, string, string]>(
      `INSERT INTO instructor_absences (instructor_id, from_date, to_date, kind, note)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(instructorId, fromDate, toDate, input.kind as string, input.note?.trim() ?? "")!;
  return getAbsence(db, row.id);
}

export function deleteAbsence(db: Database, id: number): void {
  getAbsence(db, id); // throws ValidationError if unknown
  db.prepare("DELETE FROM instructor_absences WHERE id = ?").run(id);
}

export function absenceRoutes(db: Database) {
  ensureAbsenceTables(db);

  return {
    "/api/absences": {
      GET: (req: BunRequest) =>
        handle(() => {
          const params = new URL(req.url).searchParams;
          const rawInstructor = params.get("instructorId");
          let instructorId: number | undefined;
          if (rawInstructor) {
            instructorId = Number(rawInstructor);
            if (!Number.isInteger(instructorId)) {
              throw new ValidationError("Ungültige Fahrlehrer-ID.");
            }
          }
          const absences = listAbsences(db, {
            instructorId,
            from: params.get("from") ?? undefined,
            to: params.get("to") ?? undefined,
          });
          return json({ absences });
        })(),
      POST: (req: BunRequest) =>
        handle(async () =>
          json(createAbsence(db, (await req.json()) as Partial<AbsenceInput>), 201),
        )(),
    },

    "/api/absences/:id": {
      DELETE: (req: BunRequest<"/api/absences/:id">) =>
        handle(() => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Abwesenheits-ID.");
          }
          deleteAbsence(db, id);
          return json({ ok: true });
        })(),
    },
  };
}
