/* ------------------------------------------------------------------ */
/* Unit tests for the theory-groups DB module: table setup, seed,      */
/* CRUD, member resolution against the students table, and capacity    */
/* validation. In-memory DB per test (schema from db.ts DDL, no seed). */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import { openSqlite, type Database } from "./sqlite";

import { DDL } from "./db";
import { ValidationError } from "./engine";
import {
  attendanceCounts,
  createTheoryGroup,
  deleteTheoryGroup,
  ensureTheoryGroupTables,
  getTheoryGroup,
  listAttendance,
  listTheoryGroups,
  setAttendance,
  theoryGroupRoutes,
  updateTheoryGroup,
} from "./theory-groups";

let db: Database;

/* Schema only (students/instructors tables for the joins) — no app seed,
   so the dataset stays fully under test control. */
function freshDb(): Database {
  const fresh = openSqlite(":memory:");
  fresh.exec("PRAGMA foreign_keys = ON;");
  fresh.exec(DDL);
  return fresh;
}

let studentCounter = 0;
function insertStudent(target: Database, firstName: string, lastName: string) {
  studentCounter += 1;
  const row = target
    .query<{ id: number }, [string, string, string, string]>(
      `INSERT INTO students (first_name, last_name, contract_number, customer_number)
       VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .get(firstName, lastName, `V-${studentCounter}`, `K-${studentCounter}`)!;
  return row.id;
}

beforeEach(() => {
  db = freshDb();
  db.prepare("INSERT INTO instructors (first_name, last_name) VALUES (?, ?)").run(
    "Martin",
    "Weber",
  );
  ensureTheoryGroupTables(db);
  db.exec("DELETE FROM theory_groups"); // most tests start from an empty table
});

const VALID = {
  name: "Gruppe B Test",
  klass: "B",
  weekday: "Montag",
  time: "18:00",
  room: "Schulungsraum 1",
  instructor: "Martin Weber",
  capacity: 20,
};

describe("ensureTheoryGroupTables", () => {
  test("creates the table and seeds 5 groups when empty", () => {
    const fresh = freshDb();
    ensureTheoryGroupTables(fresh);
    expect(listTheoryGroups(fresh)).toHaveLength(5);
  });

  test("does not reseed when groups already exist", () => {
    const fresh = freshDb();
    ensureTheoryGroupTables(fresh);
    ensureTheoryGroupTables(fresh);
    expect(listTheoryGroups(fresh)).toHaveLength(5);
  });

  test("does not reseed after all groups were deleted on purpose? — no: empty means seed", () => {
    // Documented behavior: seeding is "empty table" based, not flag based.
    const fresh = freshDb();
    ensureTheoryGroupTables(fresh);
    fresh.exec("DELETE FROM theory_groups");
    ensureTheoryGroupTables(fresh);
    expect(listTheoryGroups(fresh)).toHaveLength(5);
  });

  test("seed uses real instructor names when the instructors table has rows", () => {
    const fresh = freshDb();
    fresh
      .prepare(
        `INSERT INTO instructors (first_name, last_name, status)
         VALUES ('Maria', 'Schmidt', 'aktiv')`,
      )
      .run();
    ensureTheoryGroupTables(fresh);
    const groups = listTheoryGroups(fresh);
    expect(groups.every((group) => group.instructor === "Maria Schmidt")).toBe(true);
  });

  test("seed leaves groups unassigned when the instructors table is empty", () => {
    const fresh = freshDb();
    ensureTheoryGroupTables(fresh);
    const groups = listTheoryGroups(fresh);
    for (const group of groups) {
      expect(group.instructor).toBe("Nicht zugeteilt");
      expect(group.instructorId).toBeNull();
    }
  });

  test("seed distributes existing students across the groups", () => {
    const fresh = freshDb();
    for (let i = 0; i < 10; i++) insertStudent(fresh, "Schüler", `Nr${i}`);
    ensureTheoryGroupTables(fresh);
    const groups = listTheoryGroups(fresh);
    const total = groups.reduce((sum, group) => sum + group.members.length, 0);
    expect(total).toBe(10);
    for (const group of groups) {
      expect(group.members.length).toBeLessThanOrEqual(group.capacity);
    }
  });
});

describe("createTheoryGroup", () => {
  test("happy path returns the stored group with defaults applied", () => {
    const group = createTheoryGroup(db, VALID);
    expect(group.id).toBeGreaterThan(0);
    expect(group.name).toBe("Gruppe B Test");
    expect(group.klass).toBe("B");
    expect(group.weekday).toBe("Montag");
    expect(group.time).toBe("18:00");
    expect(group.room).toBe("Schulungsraum 1");
    expect(group.instructor).toBe("Martin Weber");
    expect(group.capacity).toBe(20);
    expect(group.studentIds).toEqual([]);
    expect(group.members).toEqual([]);
    expect(group.status).toBe("aktiv");
    expect(group.createdAt.length).toBeGreaterThan(0);
  });

  test("trims string fields and defaults empty instructor to 'Nicht zugeteilt'", () => {
    const group = createTheoryGroup(db, {
      ...VALID,
      name: "  Spaced  ",
      instructor: "   ",
    });
    expect(group.name).toBe("Spaced");
    expect(group.instructor).toBe("Nicht zugeteilt");
  });

  test("empty name → ValidationError 'Name ist ein Pflichtfeld.'", () => {
    expect(() => createTheoryGroup(db, { ...VALID, name: "  " })).toThrow(
      "Name ist ein Pflichtfeld.",
    );
  });

  test("empty klass → ValidationError", () => {
    expect(() => createTheoryGroup(db, { ...VALID, klass: "" })).toThrow(
      "Klasse ist ein Pflichtfeld.",
    );
  });

  test("invalid weekday → ValidationError", () => {
    expect(() => createTheoryGroup(db, { ...VALID, weekday: "Funday" })).toThrow(
      ValidationError,
    );
  });

  test("malformed time → ValidationError", () => {
    expect(() => createTheoryGroup(db, { ...VALID, time: "9:00" })).toThrow(
      "Uhrzeit muss im Format HH:MM angegeben werden.",
    );
    expect(() => createTheoryGroup(db, { ...VALID, time: "25:00" })).toThrow(
      ValidationError,
    );
  });

  test("invalid status → ValidationError", () => {
    expect(() =>
      createTheoryGroup(db, { ...VALID, status: "pausiert" as never }),
    ).toThrow("Status muss 'aktiv' oder 'abgeschlossen' sein.");
  });

  test("capacity must be an integer >= 1", () => {
    expect(() => createTheoryGroup(db, { ...VALID, capacity: 0 })).toThrow(
      "Kapazität muss eine ganze Zahl ab 1 sein.",
    );
    expect(() => createTheoryGroup(db, { ...VALID, capacity: 1.5 as never })).toThrow(
      ValidationError,
    );
  });

  test("studentIds must be a list of valid student ids", () => {
    expect(() => createTheoryGroup(db, { ...VALID, studentIds: "1,2" as never })).toThrow(
      "Feld 'studentIds' muss eine Liste sein.",
    );
    expect(() => createTheoryGroup(db, { ...VALID, studentIds: [-1] })).toThrow(
      ValidationError,
    );
    expect(() => createTheoryGroup(db, { ...VALID, studentIds: [999999] })).toThrow(
      "Fahrschüler/in mit ID 999999 nicht gefunden.",
    );
  });

  test("studentIds are de-duplicated and resolved to member names", () => {
    const anna = insertStudent(db, "Anna", "Albers");
    const ben = insertStudent(db, "Ben", "Berger");
    const group = createTheoryGroup(db, {
      ...VALID,
      studentIds: [anna, ben, anna],
    });
    expect(group.studentIds).toEqual([anna, ben]);
    expect(group.members).toEqual([
      { id: anna, name: "Anna Albers" },
      { id: ben, name: "Ben Berger" },
    ]);
  });

  test("more students than capacity → ValidationError (voll)", () => {
    const ids = [
      insertStudent(db, "A", "Eins"),
      insertStudent(db, "B", "Zwei"),
      insertStudent(db, "C", "Drei"),
    ];
    expect(() =>
      createTheoryGroup(db, { ...VALID, capacity: 2, studentIds: ids }),
    ).toThrow("Die Gruppe ist voll (max. 2 Teilnehmer).");
  });
});

describe("getTheoryGroup / listTheoryGroups", () => {
  test("missing id → ValidationError 'Theorie-Gruppe nicht gefunden.'", () => {
    expect(() => getTheoryGroup(db, 999999)).toThrow("Theorie-Gruppe nicht gefunden.");
  });

  test("list is ordered by name", () => {
    createTheoryGroup(db, { ...VALID, name: "Zeta" });
    createTheoryGroup(db, { ...VALID, name: "Alpha" });
    const names = listTheoryGroups(db).map((group) => group.name);
    expect(names).toEqual(["Alpha", "Zeta"]);
  });

  test("members drop out of the resolved list when the student is deleted", () => {
    const id = insertStudent(db, "Carla", "Conrad");
    const group = createTheoryGroup(db, { ...VALID, studentIds: [id] });
    db.prepare("DELETE FROM students WHERE id = ?").run(id);
    const reloaded = getTheoryGroup(db, group.id);
    expect(reloaded.studentIds).toEqual([id]); // raw list untouched
    expect(reloaded.members).toEqual([]); // resolved list empty
  });
});

describe("updateTheoryGroup", () => {
  test("partial update merges over current values", () => {
    const created = createTheoryGroup(db, VALID);
    const updated = updateTheoryGroup(db, created.id, {
      room: "Schulungsraum 2",
      status: "abgeschlossen",
    });
    expect(updated.room).toBe("Schulungsraum 2");
    expect(updated.status).toBe("abgeschlossen");
    expect(updated.name).toBe(VALID.name); // unchanged field preserved
    expect(updated.time).toBe(VALID.time);
  });

  test("add and remove student ids", () => {
    const anna = insertStudent(db, "Anna", "Albers");
    const ben = insertStudent(db, "Ben", "Berger");
    const created = createTheoryGroup(db, { ...VALID, studentIds: [anna] });

    const added = updateTheoryGroup(db, created.id, {
      studentIds: [anna, ben],
    });
    expect(added.members.map((member) => member.name)).toEqual([
      "Anna Albers",
      "Ben Berger",
    ]);

    const removed = updateTheoryGroup(db, created.id, { studentIds: [ben] });
    expect(removed.studentIds).toEqual([ben]);
    expect(removed.members).toEqual([{ id: ben, name: "Ben Berger" }]);
  });

  test("adding members beyond capacity → ValidationError", () => {
    const anna = insertStudent(db, "Anna", "Albers");
    const ben = insertStudent(db, "Ben", "Berger");
    const created = createTheoryGroup(db, {
      ...VALID,
      capacity: 1,
      studentIds: [anna],
    });
    expect(() => updateTheoryGroup(db, created.id, { studentIds: [anna, ben] })).toThrow(
      "Die Gruppe ist voll (max. 1 Teilnehmer).",
    );
  });

  test("shrinking capacity below current member count → ValidationError", () => {
    const anna = insertStudent(db, "Anna", "Albers");
    const ben = insertStudent(db, "Ben", "Berger");
    const created = createTheoryGroup(db, {
      ...VALID,
      capacity: 5,
      studentIds: [anna, ben],
    });
    expect(() => updateTheoryGroup(db, created.id, { capacity: 1 })).toThrow(
      "Die Gruppe ist voll (max. 1 Teilnehmer).",
    );
  });

  test("update on missing id → ValidationError", () => {
    expect(() => updateTheoryGroup(db, 999999, { name: "x" })).toThrow(
      "Theorie-Gruppe nicht gefunden.",
    );
  });

  test("invalid update is rejected and leaves the row unchanged", () => {
    const created = createTheoryGroup(db, VALID);
    expect(() => updateTheoryGroup(db, created.id, { time: "kaputt" })).toThrow(
      ValidationError,
    );
    expect(getTheoryGroup(db, created.id).time).toBe("18:00");
  });
});

describe("deleteTheoryGroup", () => {
  test("removes the group (hard delete, no archive)", () => {
    const created = createTheoryGroup(db, VALID);
    deleteTheoryGroup(db, created.id);
    expect(listTheoryGroups(db)).toHaveLength(0);
    expect(() => getTheoryGroup(db, created.id)).toThrow(
      "Theorie-Gruppe nicht gefunden.",
    );
  });

  test("delete on missing id → ValidationError", () => {
    expect(() => deleteTheoryGroup(db, 999999)).toThrow("Theorie-Gruppe nicht gefunden.");
  });
});

describe("theoryGroupRoutes", () => {
  test("exposes the expected endpoints and methods", () => {
    const routes = theoryGroupRoutes(db);
    expect(Object.keys(routes).sort()).toEqual([
      "/api/theory-groups",
      "/api/theory-groups/:id",
      "/api/theory-groups/:id/attendance",
    ]);
    expect(typeof routes["/api/theory-groups"].GET).toBe("function");
    expect(typeof routes["/api/theory-groups"].POST).toBe("function");
    expect(typeof routes["/api/theory-groups/:id"].PATCH).toBe("function");
    expect(typeof routes["/api/theory-groups/:id"].DELETE).toBe("function");
    expect(typeof routes["/api/theory-groups/:id/attendance"].GET).toBe("function");
    expect(typeof routes["/api/theory-groups/:id/attendance"].PUT).toBe("function");
  });

  test("GET returns { groups }, POST creates with 201, validation errors → 400", async () => {
    const routes = theoryGroupRoutes(db);
    const asReq = (request: Request, params: Record<string, string> = {}) =>
      Object.assign(request, { params }) as never;

    const created = await routes["/api/theory-groups"].POST(
      asReq(
        new Request("http://localhost/api/theory-groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(VALID),
        }),
      ),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: number; name: string };
    expect(createdBody.name).toBe(VALID.name);

    const list = await routes["/api/theory-groups"].GET(
      asReq(new Request("http://localhost/api/theory-groups")),
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { groups: unknown[] };
    expect(listBody.groups).toHaveLength(1);

    const bad = await routes["/api/theory-groups/:id"].DELETE(
      asReq(
        new Request("http://localhost/api/theory-groups/abc", {
          method: "DELETE",
        }),
        { id: "abc" },
      ),
    );
    expect(bad.status).toBe(400);
    const badBody = (await bad.json()) as { error: string };
    expect(badBody.error).toBe("Ungültige Gruppen-ID.");

    const ok = await routes["/api/theory-groups/:id"].DELETE(
      asReq(
        new Request(`http://localhost/api/theory-groups/${createdBody.id}`, {
          method: "DELETE",
        }),
        { id: String(createdBody.id) },
      ),
    );
    expect(ok.status).toBe(200);
    expect(listTheoryGroups(db)).toHaveLength(0);
  });

  test("GET /attendance returns { sessions } for a group", async () => {
    const routes = theoryGroupRoutes(db);
    const asReq = (request: Request, params: Record<string, string> = {}) =>
      Object.assign(request, { params }) as never;

    const anna = insertStudent(db, "Anna", "Albers");
    const group = createTheoryGroup(db, { ...VALID, studentIds: [anna] });
    setAttendance(db, group.id, "2026-06-09", [{ studentId: anna, attended: true }]);

    const res = await routes["/api/theory-groups/:id/attendance"].GET(
      asReq(new Request(`http://localhost/api/theory-groups/${group.id}/attendance`), {
        id: String(group.id),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: unknown[] };
    expect(body.sessions).toHaveLength(1);
  });

  test("PUT /attendance upserts and returns updated sessions", async () => {
    const routes = theoryGroupRoutes(db);
    const asReq = (request: Request, params: Record<string, string> = {}) =>
      Object.assign(request, { params }) as never;

    const ben = insertStudent(db, "Ben", "Berger");
    const group = createTheoryGroup(db, { ...VALID, studentIds: [ben] });

    const res = await routes["/api/theory-groups/:id/attendance"].PUT(
      asReq(
        new Request(`http://localhost/api/theory-groups/${group.id}/attendance`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionDate: "2026-06-10",
            entries: [{ studentId: ben, attended: true }],
          }),
        }),
        { id: String(group.id) },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: unknown[] };
    expect(body.sessions).toHaveLength(1);
  });

  test("PUT /attendance with non-member student → 400", async () => {
    const routes = theoryGroupRoutes(db);
    const asReq = (request: Request, params: Record<string, string> = {}) =>
      Object.assign(request, { params }) as never;

    const group = createTheoryGroup(db, { ...VALID });
    const outsider = insertStudent(db, "Out", "Sider");

    const res = await routes["/api/theory-groups/:id/attendance"].PUT(
      asReq(
        new Request(`http://localhost/api/theory-groups/${group.id}/attendance`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionDate: "2026-06-10",
            entries: [{ studentId: outsider, attended: true }],
          }),
        }),
        { id: String(group.id) },
      ),
    );
    expect(res.status).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
/* Attendance domain tests                                             */
/* ------------------------------------------------------------------ */

describe("attendance domain", () => {
  const theoryEvent = (date: string, type = "Theorie") =>
    db
      .query<{ id: number }, [string, string]>(
        `INSERT INTO calendar_events (date, start, "end", title, type)
         VALUES (?, '18:00', '19:30', 'Thema 9: Fahrmanöver', ?) RETURNING id`,
      )
      .get(date, type)!.id;

  test("topic and calendar Termin are stored per session", () => {
    const anna = insertStudent(db, "Anna", "Albers");
    const group = createTheoryGroup(db, { ...VALID, studentIds: [anna] });
    const eventId = theoryEvent("2026-06-09");

    setAttendance(db, group.id, "2026-06-09", [{ studentId: anna, attended: true }], {
      topic: " Grundstoff 9 ",
      eventId,
    });
    expect(listAttendance(db, group.id)[0]).toMatchObject({
      sessionDate: "2026-06-09",
      topic: "Grundstoff 9",
      eventId,
    });

    // Re-saving without meta keeps the stored topic and link.
    setAttendance(db, group.id, "2026-06-09", [{ studentId: anna, attended: false }]);
    expect(listAttendance(db, group.id)[0]).toMatchObject({
      topic: "Grundstoff 9",
      eventId,
    });

    // Changing only the topic keeps the link.
    setAttendance(db, group.id, "2026-06-09", [{ studentId: anna, attended: true }], {
      topic: "Grundstoff 10",
    });
    expect(listAttendance(db, group.id)[0]).toMatchObject({
      topic: "Grundstoff 10",
      eventId,
    });
  });

  test("sessions without meta report an empty topic", () => {
    const anna = insertStudent(db, "Anna", "Albers");
    const group = createTheoryGroup(db, { ...VALID, studentIds: [anna] });
    setAttendance(db, group.id, "2026-06-09", [{ studentId: anna, attended: true }]);
    expect(listAttendance(db, group.id)[0]).toMatchObject({ topic: "", eventId: null });
  });

  test("the linked Termin must be a Theorie Termin on the session date", () => {
    const anna = insertStudent(db, "Anna", "Albers");
    const group = createTheoryGroup(db, { ...VALID, studentIds: [anna] });
    const entries = [{ studentId: anna, attended: true }];
    expect(() =>
      setAttendance(db, group.id, "2026-06-09", entries, { eventId: 999999 }),
    ).toThrow("Termin nicht gefunden.");
    expect(() =>
      setAttendance(db, group.id, "2026-06-09", entries, {
        eventId: theoryEvent("2026-06-09", "Praktisch"),
      }),
    ).toThrow(/nur zu Theorie-Terminen/);
    expect(() =>
      setAttendance(db, group.id, "2026-06-10", entries, {
        eventId: theoryEvent("2026-06-09"),
      }),
    ).toThrow(/Datum des Termins/);
    expect(() =>
      setAttendance(db, group.id, "2026-06-09", entries, { topic: "x".repeat(201) }),
    ).toThrow(/höchstens 200 Zeichen/);
  });

  test("happy upsert: setAttendance creates rows, listAttendance returns them", () => {
    const anna = insertStudent(db, "Anna", "Albers");
    const ben = insertStudent(db, "Ben", "Berger");
    const group = createTheoryGroup(db, { ...VALID, studentIds: [anna, ben] });

    setAttendance(db, group.id, "2026-06-09", [
      { studentId: anna, attended: true },
      { studentId: ben, attended: false },
    ]);

    const sessions = listAttendance(db, group.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.sessionDate).toBe("2026-06-09");
    expect(sessions[0]!.entries).toHaveLength(2);
    const annaEntry = sessions[0]!.entries.find((e) => e.studentId === anna);
    const benEntry = sessions[0]!.entries.find((e) => e.studentId === ben);
    expect(annaEntry?.attended).toBe(true);
    expect(benEntry?.attended).toBe(false);
  });

  test("re-recording same (group, student, date) overwrites — no duplicate row", () => {
    const anna = insertStudent(db, "Anna", "Albers");
    const group = createTheoryGroup(db, { ...VALID, studentIds: [anna] });

    setAttendance(db, group.id, "2026-06-09", [{ studentId: anna, attended: true }]);
    setAttendance(db, group.id, "2026-06-09", [{ studentId: anna, attended: false }]);

    const sessions = listAttendance(db, group.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.entries).toHaveLength(1);
    expect(sessions[0]!.entries[0]!.attended).toBe(false);

    // Verify only one DB row
    const rowCount = db
      .query<{ n: number }, [number, number, string]>(
        "SELECT count(*) AS n FROM theory_attendance WHERE group_id = ? AND student_id = ? AND session_date = ?",
      )
      .get(group.id, anna, "2026-06-09")!.n;
    expect(rowCount).toBe(1);
  });

  test("student not in group → ValidationError", () => {
    const anna = insertStudent(db, "Anna", "Albers");
    const outsider = insertStudent(db, "Out", "Sider");
    const group = createTheoryGroup(db, { ...VALID, studentIds: [anna] });

    expect(() =>
      setAttendance(db, group.id, "2026-06-09", [
        { studentId: outsider, attended: true },
      ]),
    ).toThrow(ValidationError);
  });

  test("bad date format → ValidationError", () => {
    const anna = insertStudent(db, "Anna", "Albers");
    const group = createTheoryGroup(db, { ...VALID, studentIds: [anna] });

    expect(() =>
      setAttendance(db, group.id, "09-06-2026", [{ studentId: anna, attended: true }]),
    ).toThrow("Datum muss im Format YYYY-MM-DD angegeben werden.");

    expect(() =>
      setAttendance(db, group.id, "2026/06/09", [{ studentId: anna, attended: true }]),
    ).toThrow(ValidationError);
  });

  test("unknown group → ValidationError", () => {
    expect(() => setAttendance(db, 999999, "2026-06-09", [])).toThrow(
      "Theorie-Gruppe nicht gefunden.",
    );
  });

  test("attendanceCounts correct across multiple dates", () => {
    const anna = insertStudent(db, "Anna", "Albers");
    const ben = insertStudent(db, "Ben", "Berger");
    const group = createTheoryGroup(db, { ...VALID, studentIds: [anna, ben] });

    setAttendance(db, group.id, "2026-06-02", [
      { studentId: anna, attended: true },
      { studentId: ben, attended: true },
    ]);
    setAttendance(db, group.id, "2026-06-09", [
      { studentId: anna, attended: true },
      { studentId: ben, attended: false },
    ]);
    setAttendance(db, group.id, "2026-06-16", [{ studentId: anna, attended: true }]);

    const counts = attendanceCounts(db, group.id);
    expect(counts[anna]).toBe(3);
    expect(counts[ben]).toBe(1);
  });

  test("attendance history survives member removal from group", () => {
    const anna = insertStudent(db, "Anna", "Albers");
    const group = createTheoryGroup(db, { ...VALID, studentIds: [anna] });

    setAttendance(db, group.id, "2026-06-09", [{ studentId: anna, attended: true }]);

    // Remove anna from the group
    updateTheoryGroup(db, group.id, { studentIds: [] });

    // Old attendance record should still be there
    const sessions = listAttendance(db, group.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.entries[0]!.studentId).toBe(anna);

    // But new attendance for removed member should be rejected
    expect(() =>
      setAttendance(db, group.id, "2026-06-16", [{ studentId: anna, attended: true }]),
    ).toThrow(ValidationError);
  });
});
