/* ------------------------------------------------------------------ */
/* Theory groups (Theorie Gruppen) — DB access + validation.           */
/* Self-contained module: ensureTheoryGroupTables(db) creates + seeds  */
/* the table, theoryGroupRoutes(db) returns the Bun.serve() entries    */
/* (mounted in src/index.ts).                                          */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import { ValidationError } from "./engine";
import { handle, json } from "./http";
import { instructorNameSql, migrateNameColumn, resolveInstructorId } from "./refs";
import { demoDataEnabled } from "./db";

export type TheoryGroupStatus = "aktiv" | "abgeschlossen";

export type TheoryGroupMember = {
  id: number;
  name: string;
};

export type TheoryGroup = {
  id: number;
  name: string;
  klass: string;
  weekday: string;
  time: string;
  room: string;
  instructor: string;
  /** FK → instructors.id; null = unassigned. `instructor` is its display name. */
  instructorId: number | null;
  capacity: number;
  /** Raw membership as stored (JSON array of student ids). */
  studentIds: number[];
  /** studentIds resolved against the students table (missing ids drop out). */
  members: TheoryGroupMember[];
  status: TheoryGroupStatus;
  createdAt: string;
};

export type TheoryGroupInput = {
  name: string;
  klass: string;
  weekday: string;
  time: string;
  room: string;
  instructor: string;
  instructorId?: number | null;
  capacity: number;
  studentIds: number[];
  status: TheoryGroupStatus;
};

type TheoryGroupData = Omit<TheoryGroupInput, "instructor" | "instructorId"> & {
  instructorId: number | null;
};

export const THEORY_GROUP_WEEKDAYS = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ------------------------------------------------------------------ */
/* Schema + seed                                                       */
/* ------------------------------------------------------------------ */

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS theory_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  klass TEXT NOT NULL,
  weekday TEXT NOT NULL,
  time TEXT NOT NULL,
  room TEXT NOT NULL DEFAULT '',
  instructor_id INTEGER REFERENCES instructors(id),
  capacity INTEGER NOT NULL DEFAULT 20,
  student_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv', 'abgeschlossen')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const ATTENDANCE_DDL = `
CREATE TABLE IF NOT EXISTS theory_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES theory_groups(id),
  student_id INTEGER NOT NULL,
  session_date TEXT NOT NULL,
  attended INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (group_id, student_id, session_date)
);
`;

function tableExists(db: Database, name: string): boolean {
  return (
    db
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(name) !== null
  );
}

/* Seed groups — only on an empty table. Instructors come from the
   instructors table when it exists and has rows (else unassigned);
   member ids from the students table when present (round-robin). */
function seedTheoryGroups(db: Database) {
  const instructorIds: (number | null)[] = tableExists(db, "instructors")
    ? db
        .query<{ id: number }, []>(
          "SELECT id FROM instructors WHERE status = 'aktiv' ORDER BY id",
        )
        .all()
        .map((row) => row.id)
    : [];
  if (instructorIds.length === 0) instructorIds.push(null);

  const studentIds = tableExists(db, "students")
    ? db
        .query<{ id: number }, []>("SELECT id FROM students ORDER BY id LIMIT 12")
        .all()
        .map((row) => row.id)
    : [];

  const seeds = [
    {
      name: "Gruppe B-1 · Abendkurs",
      klass: "B",
      weekday: "Montag",
      time: "18:00",
      room: "Schulungsraum 1",
      capacity: 20,
      status: "aktiv",
    },
    {
      name: "Gruppe B-2 · Abendkurs",
      klass: "B",
      weekday: "Mittwoch",
      time: "18:00",
      room: "Schulungsraum 1",
      capacity: 20,
      status: "aktiv",
    },
    {
      name: "Gruppe A · Kompaktkurs",
      klass: "A",
      weekday: "Dienstag",
      time: "19:00",
      room: "Schulungsraum 2",
      capacity: 12,
      status: "aktiv",
    },
    {
      name: "Gruppe BE · Anhängerkurs",
      klass: "BE",
      weekday: "Donnerstag",
      time: "17:30",
      room: "Schulungsraum 2",
      capacity: 10,
      status: "aktiv",
    },
    {
      name: "Ferienkurs B · Intensiv",
      klass: "B",
      weekday: "Samstag",
      time: "09:00",
      room: "Schulungsraum 1",
      capacity: 16,
      status: "abgeschlossen",
    },
  ] as const;

  const insert = db.prepare(
    `INSERT INTO theory_groups
       (name, klass, weekday, time, room, instructor_id, capacity, student_ids, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const seedAll = db.transaction(() => {
    seeds.forEach((seed, index) => {
      const memberIds = studentIds.filter((_, i) => i % seeds.length === index);
      insert.run(
        seed.name,
        seed.klass,
        seed.weekday,
        seed.time,
        seed.room,
        instructorIds[index % instructorIds.length] ?? null,
        seed.capacity,
        JSON.stringify(memberIds),
        seed.status,
      );
    });
  });
  seedAll();
}

export function ensureTheoryGroupTables(db: Database) {
  db.exec(TABLE_DDL);
  db.exec(ATTENDANCE_DDL);
  if (tableExists(db, "instructors")) {
    migrateNameColumn(db, "theory_groups", { from: "instructor" });
  }
  const count = db
    .query<{ n: number }, []>("SELECT count(*) AS n FROM theory_groups")
    .get()!.n;
  if (count === 0 && demoDataEnabled(db)) seedTheoryGroups(db);
}

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

type TheoryGroupRow = {
  id: number;
  name: string;
  klass: string;
  weekday: string;
  time: string;
  room: string;
  instructor: string;
  instructor_id: number | null;
  capacity: number;
  student_ids: string;
  status: TheoryGroupStatus;
  created_at: string;
};

/* The instructor display name needs the instructors table — bare test
   databases without it fall back to the unassigned marker. */
function selectSql(db: Database): string {
  const instructor = tableExists(db, "instructors")
    ? instructorNameSql("g")
    : "'Nicht zugeteilt'";
  return `SELECT g.id, g.name, g.klass, g.weekday, g.time, g.room, g.instructor_id,
    ${instructor} AS instructor, g.capacity, g.student_ids, g.status, g.created_at
    FROM theory_groups g`;
}

function parseStudentIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => Number(value))
      .filter((id) => Number.isInteger(id) && id > 0);
  } catch {
    return [];
  }
}

/* Resolve member ids to display names. Ids of since-deleted students
   silently drop out of `members` (they stay in studentIds). */
function resolveMembers(db: Database, ids: number[]): TheoryGroupMember[] {
  if (ids.length === 0 || !tableExists(db, "students")) return [];
  const lookup = db.query<{ id: number; name: string }, [number]>(
    "SELECT id, trim(first_name || ' ' || last_name) AS name FROM students WHERE id = ?",
  );
  const members: TheoryGroupMember[] = [];
  for (const id of ids) {
    const row = lookup.get(id);
    if (row) members.push({ id: row.id, name: row.name });
  }
  return members;
}

function toGroup(db: Database, row: TheoryGroupRow): TheoryGroup {
  const studentIds = parseStudentIds(row.student_ids);
  return {
    id: row.id,
    name: row.name,
    klass: row.klass,
    weekday: row.weekday,
    time: row.time,
    room: row.room,
    instructor: row.instructor,
    instructorId: row.instructor_id,
    capacity: row.capacity,
    studentIds,
    members: resolveMembers(db, studentIds),
    status: row.status,
    createdAt: row.created_at,
  };
}

export function listTheoryGroups(db: Database): TheoryGroup[] {
  return db
    .query<TheoryGroupRow, []>(`${selectSql(db)} ORDER BY g.name`)
    .all()
    .map((row) => toGroup(db, row));
}

export function getTheoryGroup(db: Database, id: number): TheoryGroup {
  const row = db
    .query<TheoryGroupRow, [number]>(`${selectSql(db)} WHERE g.id = ?`)
    .get(id);
  if (!row) throw new ValidationError("Theorie-Gruppe nicht gefunden.");
  return toGroup(db, row);
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function normalizeStudentIds(db: Database, value: unknown, current: number[]): number[] {
  if (value === undefined) return current;
  if (!Array.isArray(value)) {
    throw new ValidationError("Feld 'studentIds' muss eine Liste sein.");
  }
  const ids: number[] = [];
  for (const raw of value) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      throw new ValidationError("Feld 'studentIds' darf nur Fahrschüler-IDs enthalten.");
    }
    if (!ids.includes(id)) ids.push(id); // de-dupe
  }
  if (tableExists(db, "students")) {
    const exists = db.query<{ id: number }, [number]>(
      "SELECT id FROM students WHERE id = ?",
    );
    for (const id of ids) {
      if (!exists.get(id)) {
        throw new ValidationError(`Fahrschüler/in mit ID ${id} nicht gefunden.`);
      }
    }
  }
  return ids;
}

type GroupTextKey = "name" | "klass" | "weekday" | "time" | "room";

/* Merge a partial payload over current values, trimming strings and
   rejecting anything that would leave the group unusable. */
function normalize(
  db: Database,
  input: Partial<TheoryGroupInput>,
  current: TheoryGroupData,
): TheoryGroupData {
  const str = (key: GroupTextKey): string => {
    const value = input[key];
    if (value === undefined) return current[key];
    if (typeof value !== "string") {
      throw new ValidationError(`Feld '${key}' muss ein Text sein.`);
    }
    return value.trim();
  };

  const next: TheoryGroupData = {
    name: str("name"),
    klass: str("klass"),
    weekday: str("weekday"),
    time: str("time"),
    room: str("room"),
    instructorId: resolveInstructorId(
      db,
      { id: input.instructorId, name: input.instructor },
      current.instructorId,
    ),
    capacity: current.capacity,
    studentIds: current.studentIds,
    status: current.status,
  };

  if (input.capacity !== undefined) {
    const capacity = Number(input.capacity);
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new ValidationError("Kapazität muss eine ganze Zahl ab 1 sein.");
    }
    next.capacity = capacity;
  }

  if (input.status !== undefined) {
    if (input.status !== "aktiv" && input.status !== "abgeschlossen") {
      throw new ValidationError("Status muss 'aktiv' oder 'abgeschlossen' sein.");
    }
    next.status = input.status;
  }

  next.studentIds = normalizeStudentIds(db, input.studentIds, current.studentIds);

  if (!next.name) {
    throw new ValidationError("Name ist ein Pflichtfeld.");
  }
  if (!next.klass) {
    throw new ValidationError("Klasse ist ein Pflichtfeld.");
  }
  if (!(THEORY_GROUP_WEEKDAYS as readonly string[]).includes(next.weekday)) {
    throw new ValidationError(
      "Wochentag muss ein gültiger Wochentag sein (Montag–Sonntag).",
    );
  }
  if (!TIME_RE.test(next.time)) {
    throw new ValidationError("Uhrzeit muss im Format HH:MM angegeben werden.");
  }
  if (next.studentIds.length > next.capacity) {
    throw new ValidationError(`Die Gruppe ist voll (max. ${next.capacity} Teilnehmer).`);
  }

  return next;
}

const EMPTY: TheoryGroupData = {
  name: "",
  klass: "",
  weekday: "Montag",
  time: "18:00",
  room: "",
  instructorId: null,
  capacity: 20,
  studentIds: [],
  status: "aktiv",
};

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

export function createTheoryGroup(
  db: Database,
  input: Partial<TheoryGroupInput>,
): TheoryGroup {
  const data = normalize(db, input, EMPTY);
  const row = db
    .query<
      { id: number },
      [string, string, string, string, string, number | null, number, string, string]
    >(
      `INSERT INTO theory_groups
         (name, klass, weekday, time, room, instructor_id, capacity, student_ids, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      data.name,
      data.klass,
      data.weekday,
      data.time,
      data.room,
      data.instructorId,
      data.capacity,
      JSON.stringify(data.studentIds),
      data.status,
    )!;
  return getTheoryGroup(db, row.id);
}

export function updateTheoryGroup(
  db: Database,
  id: number,
  input: Partial<TheoryGroupInput>,
): TheoryGroup {
  const current = getTheoryGroup(db, id);
  const data = normalize(db, input, current);
  db.prepare(
    `UPDATE theory_groups
     SET name = ?, klass = ?, weekday = ?, time = ?, room = ?, instructor_id = ?,
         capacity = ?, student_ids = ?, status = ?
     WHERE id = ?`,
  ).run(
    data.name,
    data.klass,
    data.weekday,
    data.time,
    data.room,
    data.instructorId,
    data.capacity,
    JSON.stringify(data.studentIds),
    data.status,
    id,
  );
  return getTheoryGroup(db, id);
}

export function deleteTheoryGroup(db: Database, id: number): void {
  getTheoryGroup(db, id); // throws ValidationError if unknown
  db.prepare("DELETE FROM theory_groups WHERE id = ?").run(id);
}

/* ------------------------------------------------------------------ */
/* Attendance domain                                                   */
/* ------------------------------------------------------------------ */

export type AttendanceEntry = {
  studentId: number;
  attended: boolean;
};

export type AttendanceSession = {
  sessionDate: string;
  entries: AttendanceEntry[];
};

const SESSION_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns all recorded sessions for a group, newest date first. */
export function listAttendance(db: Database, groupId: number): AttendanceSession[] {
  getTheoryGroup(db, groupId); // throws if unknown
  const rows = db
    .query<{ session_date: string; student_id: number; attended: number }, [number]>(
      `SELECT session_date, student_id, attended
       FROM theory_attendance
       WHERE group_id = ?
       ORDER BY session_date DESC, student_id`,
    )
    .all(groupId);

  const byDate = new Map<string, AttendanceEntry[]>();
  for (const row of rows) {
    let entries = byDate.get(row.session_date);
    if (!entries) {
      entries = [];
      byDate.set(row.session_date, entries);
    }
    entries.push({ studentId: row.student_id, attended: row.attended === 1 });
  }

  return Array.from(byDate.entries()).map(([sessionDate, entries]) => ({
    sessionDate,
    entries,
  }));
}

/** Upsert attendance for a session. All entries are written in one transaction. */
export function setAttendance(
  db: Database,
  groupId: number,
  sessionDate: string,
  entries: { studentId: number; attended: boolean }[],
): void {
  const group = getTheoryGroup(db, groupId); // throws if unknown
  if (!SESSION_DATE_RE.test(sessionDate)) {
    throw new ValidationError("Datum muss im Format YYYY-MM-DD angegeben werden.");
  }
  const memberSet = new Set(group.studentIds);
  for (const entry of entries) {
    if (!memberSet.has(entry.studentId)) {
      throw new ValidationError(
        `Fahrschüler/in mit ID ${entry.studentId} ist kein Mitglied dieser Gruppe.`,
      );
    }
  }

  const upsert = db.prepare(
    `INSERT INTO theory_attendance (group_id, student_id, session_date, attended)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (group_id, student_id, session_date)
     DO UPDATE SET attended = excluded.attended`,
  );

  const run = db.transaction(() => {
    for (const entry of entries) {
      upsert.run(groupId, entry.studentId, sessionDate, entry.attended ? 1 : 0);
    }
  });
  run();
}

/** Returns a map of studentId → count of attended=1 sessions for a group. */
export function attendanceCounts(db: Database, groupId: number): Record<number, number> {
  getTheoryGroup(db, groupId); // throws if unknown
  const rows = db
    .query<{ student_id: number; n: number }, [number]>(
      `SELECT student_id, count(*) AS n
       FROM theory_attendance
       WHERE group_id = ? AND attended = 1
       GROUP BY student_id`,
    )
    .all(groupId);

  const result: Record<number, number> = {};
  for (const row of rows) {
    result[row.student_id] = row.n;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* HTTP layer — same thin JSON wrapper shape as src/server/routes.ts.  */
/* ------------------------------------------------------------------ */

export function theoryGroupRoutes(db: Database) {
  const parseId = (raw: string): number => {
    const id = Number(raw);
    if (!Number.isInteger(id)) {
      throw new ValidationError("Ungültige Gruppen-ID.");
    }
    return id;
  };

  return {
    "/api/theory-groups": {
      GET: (req: BunRequest) => handle(() => json({ groups: listTheoryGroups(db) }))(),
      POST: (req: BunRequest) =>
        handle(async () =>
          json(
            createTheoryGroup(db, (await req.json()) as Partial<TheoryGroupInput>),
            201,
          ),
        )(),
    },

    "/api/theory-groups/:id": {
      PATCH: (req: BunRequest<"/api/theory-groups/:id">) =>
        handle(async () =>
          json(
            updateTheoryGroup(
              db,
              parseId(req.params.id),
              (await req.json()) as Partial<TheoryGroupInput>,
            ),
          ),
        )(),
      DELETE: (req: BunRequest<"/api/theory-groups/:id">) =>
        handle(() => {
          deleteTheoryGroup(db, parseId(req.params.id));
          return json({ ok: true });
        })(),
    },

    "/api/theory-groups/:id/attendance": {
      GET: (req: BunRequest<"/api/theory-groups/:id/attendance">) =>
        handle(() => json({ sessions: listAttendance(db, parseId(req.params.id)) }))(),
      PUT: (req: BunRequest<"/api/theory-groups/:id/attendance">) =>
        handle(async () => {
          const body = (await req.json()) as {
            sessionDate: string;
            entries: { studentId: number; attended: boolean }[];
          };
          const groupId = parseId(req.params.id);
          setAttendance(db, groupId, body.sessionDate, body.entries);
          return json({ sessions: listAttendance(db, groupId) });
        })(),
    },
  };
}
