/* ------------------------------------------------------------------ */
/* Datenimport (Fahrschüler): preview checks, number generation, and   */
/* the all-or-nothing commit. In-memory DB seeded by openDb(), plus an */
/* HTTP round trip through importRoutes() via Bun.serve().             */
/* ------------------------------------------------------------------ */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { serve } from "bun";

import type { ImportCommitResult, ImportPreview } from "../lib/student-import";
import { openDb } from "./db";
import { ValidationError } from "./engine";
import type { Database } from "./sqlite";
import {
  commitStudentImport,
  importRoutes,
  MAX_IMPORT_ROWS,
  previewStudentImport,
} from "./student-import";
import { listStudents } from "./students";

const NOW = new Date(2026, 8, 28);

const HEADER = [
  "Vorname",
  "Nachname",
  "Geburtsdatum",
  "Kundennummer",
  "Vertragsnummer",
  "Fahrlehrer",
  "Fahrzeug",
  "Klasse",
];
const MAPPING = {
  "0": "firstName",
  "1": "lastName",
  "2": "birthday",
  "3": "customerNumber",
  "4": "contractNumber",
  "5": "instructor",
  "6": "vehicle",
  "7": "classes",
};

const body = (rows: string[][], extra: Record<string, unknown> = {}) => ({
  rows: [HEADER, ...rows],
  mapping: MAPPING,
  options: { hasHeader: true },
  ...extra,
});

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
});

describe("previewStudentImport", () => {
  test("valid row is importable and nothing is written", () => {
    const before = listStudents(db).length;
    const preview = previewStudentImport(
      db,
      body([["Max", "Neu", "1.2.2005", "", "", "Nadine Aksoy", "VW Golf", "b"]]),
      NOW,
    );
    expect(preview.summary).toEqual({ total: 1, importable: 1, skipped: 0, failed: 0 });
    const [row] = preview.rows;
    expect(row).toMatchObject({ row: 2, ok: true, status: "import", errors: [] });
    expect(row!.warnings).toEqual([]);
    expect(row!.student).toMatchObject({
      firstName: "Max",
      birthday: "01.02.2005",
      classes: "B",
      instructor: "Nadine Aksoy",
      vehicle: "VW Golf",
      drivingSchool: "Fahrschule Demo",
    });
    expect(listStudents(db)).toHaveLength(before);
  });

  test("missing numbers continue the school's range", () => {
    const max = Math.max(...listStudents(db).map((s) => Number(s.customerNumber)), 10058);
    const preview = previewStudentImport(
      db,
      body([
        ["A", "Eins", "", "", "", "", "", "B"],
        ["B", "Zwei", "", "90000", "V-2026-5000", "", "", "B"],
        ["C", "Drei", "", "", "", "", "", "B"],
      ]),
      NOW,
    );
    const [a, b, c] = preview.rows.map((r) => r.student);
    expect(b!.customerNumber).toBe("90000");
    // Generated numbers come after everything imported in the same run.
    expect(a!.customerNumber).toBe("90001");
    expect(c!.customerNumber).toBe("90002");
    expect(a!.contractNumber).toBe("V-2026-5001");
    expect(preview.rows[0]!.generated).toEqual({
      customerNumber: true,
      contractNumber: true,
    });
    expect(preview.rows[1]!.generated).toEqual({
      customerNumber: false,
      contractNumber: false,
    });
    expect(max).toBeLessThan(90000);
  });

  test("unknown instructor/vehicle → unassigned with warning, not an error", () => {
    const [row] = previewStudentImport(
      db,
      body([["Max", "Neu", "", "", "", "Hans Unbekannt", "Trabant", "B"]]),
      NOW,
    ).rows;
    expect(row!.ok).toBe(true);
    expect(row!.student.instructor).toBe("Nicht zugeteilt");
    expect(row!.student.vehicle).toBe("Nicht zugeteilt");
    expect(row!.warnings).toEqual([
      "Fahrlehrer/in „Hans Unbekannt“ nicht gefunden – wird ohne Zuteilung importiert.",
      "Fahrzeug „Trabant“ nicht gefunden – wird ohne Zuteilung importiert.",
    ]);
  });

  test("resolves 'Nachname, Vorname' instructor names", () => {
    const [row] = previewStudentImport(
      db,
      body([["Max", "Neu", "", "", "", "Aksoy, Nadine", "", "B"]]),
      NOW,
    ).rows;
    expect(row!.warnings).toEqual([]);
    expect(row!.student.instructor).toBe("Aksoy, Nadine");
  });

  test("duplicates against the DB and within the file are skipped", () => {
    const preview = previewStudentImport(
      db,
      body([
        ["Irgend", "Wer", "", "10057", "", "", "", "B"], // seed: Lena Braun
        ["lena", "braun", "1999-08-11", "", "", "", "", "B"], // same name+birthday
        ["Neu", "Person", "01.01.2000", "777", "", "", "", "B"],
        ["Andere", "Person", "", "777", "", "", "", "B"], // same customer no.
        ["Neu", "Person", "01.01.2000", "", "", "", "", "B"], // same person
      ]),
      NOW,
    );
    expect(preview.rows.map((r) => r.status)).toEqual([
      "skip",
      "skip",
      "import",
      "skip",
      "skip",
    ]);
    expect(preview.rows[0]!.warnings[0]).toBe(
      "Kundennummer 10057 ist bereits vergeben (Lena Braun) – Zeile wird übersprungen.",
    );
    expect(preview.rows[1]!.warnings[0]).toContain("ist bereits angelegt");
    expect(preview.rows[3]!.warnings[0]).toBe(
      "Kundennummer 777 steht schon in Zeile 4 – Zeile wird übersprungen.",
    );
    expect(preview.rows[4]!.warnings[0]).toBe(
      "Gleiche Person wie in Zeile 4 – Zeile wird übersprungen.",
    );
    expect(preview.summary).toEqual({ total: 5, importable: 1, skipped: 4, failed: 0 });
  });

  test("a taken contract number is an error", () => {
    const [row] = previewStudentImport(
      db,
      body([["Max", "Neu", "", "", "V-2026-1042", "", "", "B"]]),
      NOW,
    ).rows;
    expect(row!.status).toBe("error");
    expect(row!.errors).toEqual(["Vertragsnummer V-2026-1042 ist bereits vergeben."]);
  });

  test("row validation errors are reported per row", () => {
    const preview = previewStudentImport(
      db,
      body([["", "Neu", "31.02.2001", "", "", "", "", "B"]]),
      NOW,
    );
    expect(preview.rows[0]!.errors).toEqual([
      "Vorname fehlt.",
      "Geburtsdatum „31.02.2001“ ist kein gültiges Datum (erwartet TT.MM.JJJJ).",
    ]);
    expect(preview.summary.failed).toBe(1);
  });

  test("without header the row numbers start at 1", () => {
    const preview = previewStudentImport(
      db,
      {
        rows: [["Max", "Neu"]],
        mapping: { 0: "firstName", 1: "lastName" },
        options: { hasHeader: false },
      },
      NOW,
    );
    expect(preview.rows[0]!.row).toBe(1);
  });

  test("rejects bad requests", () => {
    expect(() => previewStudentImport(db, { rows: "x", mapping: MAPPING })).toThrow(
      ValidationError,
    );
    expect(() =>
      previewStudentImport(db, body([["A", "B"]], { mapping: { 0: "firstName" } })),
    ).toThrow("Vorname und Nachname");
    expect(() => previewStudentImport(db, body([]))).toThrow("keine Datenzeilen");
    expect(() =>
      previewStudentImport(
        db,
        body([["A", "B"]], { mapping: { 0: "balance", 1: "lastName" } }),
      ),
    ).toThrow("Unbekanntes Feld");
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ["A", "B"]);
    expect(() => previewStudentImport(db, body(many))).toThrow("Zu viele Zeilen");
  });
});

describe("commitStudentImport", () => {
  test("imports importable rows only, with links and start lessons", () => {
    const before = listStudents(db).length;
    const result = commitStudentImport(
      db,
      body([
        ["Max", "Neu", "01.02.2005", "", "", "Nadine Aksoy", "Trabant", "B"],
        ["", "Kaputt", "", "", "", "", "", "B"],
        ["Irgend", "Wer", "", "10057", "", "", "", "B"],
      ]),
      NOW,
    );
    expect(result).toEqual({
      total: 3,
      importable: 1,
      skipped: 1,
      failed: 1,
      imported: 1,
    });
    const students = listStudents(db);
    expect(students).toHaveLength(before + 1);
    const max = students.find((s) => s.lastName === "Neu")!;
    expect(max.instructor).toBe("Nadine Aksoy");
    expect(max.instructorId).not.toBeNull();
    expect(max.vehicle).toBe("Nicht zugeteilt");
    expect(max.vehicleId).toBeNull();
    expect(max.balance).toBe("0,00 EUR");
    expect(max.lessons.map((l) => l.label)).toContain("Nachtfahrt");
    expect(max.customerNumber).toMatch(/^\d+$/);
    expect(max.contractNumber).toMatch(/^V-2026-\d+$/);
  });

  test("committing the same file twice skips everything the second time", () => {
    const file = body([["Max", "Neu", "01.02.2005", "", "", "", "", "B"]]);
    expect(commitStudentImport(db, file, NOW).imported).toBe(1);
    const again = commitStudentImport(db, file, NOW);
    expect(again.imported).toBe(0);
    expect(again.skipped).toBe(1);
  });

  test("a failing insert rolls back the whole import", () => {
    db.exec(`CREATE TRIGGER boom BEFORE INSERT ON students
      WHEN NEW.last_name = 'Boom'
      BEGIN SELECT RAISE(ABORT, 'Testfehler'); END`);
    const before = listStudents(db).length;
    expect(() =>
      commitStudentImport(
        db,
        body([
          ["Erst", "Gut", "", "", "", "", "", "B"],
          ["Dann", "Boom", "", "", "", "", "", "B"],
          ["Zuletzt", "Gut", "", "", "", "", "", "B"],
        ]),
        NOW,
      ),
    ).toThrow("Zeile 3: Testfehler");
    expect(listStudents(db)).toHaveLength(before);
    expect(listStudents(db).some((s) => s.firstName === "Erst")).toBe(false);
  });
});

describe("HTTP /api/import/students/*", () => {
  const httpDb = openDb(":memory:");
  let server: ReturnType<typeof serve>;

  beforeAll(() => {
    server = serve({
      port: 0,
      routes: importRoutes(httpDb),
      fetch: () => new Response("not found", { status: 404 }),
    });
  });
  afterAll(() => server.stop(true));

  const post = (path: string, payload: unknown) =>
    fetch(new URL(path, server.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

  test("preview → 200 with rows and summary", async () => {
    const res = await post(
      "/api/import/students/preview",
      body([["Max", "Neu", "", "", "", "", "", "B"]]),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as ImportPreview;
    expect(data.summary.importable).toBe(1);
    expect(data.rows[0]!.student.lastName).toBe("Neu");
  });

  test("commit → 201 with counts; bad request → 400 with German message", async () => {
    const res = await post(
      "/api/import/students/commit",
      body([["Max", "Http", "", "", "", "", "", "B"]]),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as ImportCommitResult).imported).toBe(1);

    const bad = await post("/api/import/students/commit", { rows: [], mapping: {} });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toContain("Vorname");
  });
});
