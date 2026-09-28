/* ------------------------------------------------------------------ */
/* Datenimport — Fahrschüler aus CSV-Zeilen übernehmen.                */
/*                                                                     */
/* POST /api/import/students/preview  → per-row result, nothing saved  */
/* POST /api/import/students/commit   → all importable rows in ONE     */
/*                                      transaction (all-or-nothing)   */
/*                                                                     */
/* Row mapping/validation lives in src/lib/student-import.ts (shared   */
/* with the /import page); this module adds the DB checks: duplicates, */
/* instructor/vehicle lookup and number generation. Balances are NOT   */
/* imported — opening balances belong in Buchhaltung (GoBD).           */
/* ------------------------------------------------------------------ */

import type { BunRequest } from "bun";
import type { Database } from "./sqlite";

import {
  mapImportRow,
  parseImportMapping,
  type ImportCommitResult,
  type ImportMapping,
  type ImportPreview,
  type ImportRowResult,
  type ImportSummary,
} from "../lib/student-import";
import { initialLessons, studentNumberSequence } from "../lib/student-numbers";
import { tableExists } from "./archive";
import { getCompany } from "./db";
import { ValidationError } from "./engine";
import { handle, json } from "./http";
import { instructorIdByName, UNASSIGNED, vehicleIdByName } from "./refs";
import { createStudent, listStudents } from "./students";

export const MAX_IMPORT_ROWS = 5000;

type ParsedRequest = {
  rows: string[][];
  mapping: ImportMapping;
  /** File row number of rows[0] (1-based, header counted). */
  firstRowNumber: number;
};

function parseRequest(body: unknown): ParsedRequest {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("Ungültige Anfrage.");
  }
  const { rows, mapping, options } = body as {
    rows?: unknown;
    mapping?: unknown;
    options?: { hasHeader?: unknown };
  };
  if (!Array.isArray(rows) || !rows.every(Array.isArray)) {
    throw new ValidationError("Feld 'rows' muss eine Liste von Zeilen sein.");
  }
  let parsedMapping: ImportMapping;
  try {
    parsedMapping = parseImportMapping(mapping);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : String(error));
  }
  const fields = new Set(Object.values(parsedMapping));
  if (!fields.has("firstName") || !fields.has("lastName")) {
    throw new ValidationError("Bitte die Spalten für Vorname und Nachname zuordnen.");
  }
  const hasHeader = options?.hasHeader !== false;
  const data = (hasHeader ? rows.slice(1) : rows) as unknown[][];
  if (data.length === 0) {
    throw new ValidationError("Die Datei enthält keine Datenzeilen.");
  }
  if (data.length > MAX_IMPORT_ROWS) {
    throw new ValidationError(
      `Zu viele Zeilen (${data.length}). Bitte höchstens ${MAX_IMPORT_ROWS} Zeilen auf einmal importieren.`,
    );
  }
  return {
    rows: data.map((row) =>
      row.map((cell) =>
        typeof cell === "string" ? cell : cell == null ? "" : String(cell),
      ),
    ),
    mapping: parsedMapping,
    firstRowNumber: hasHeader ? 2 : 1,
  };
}

type PlannedRow = {
  result: ImportRowResult;
  instructorId: number | null;
  vehicleId: number | null;
};

const personKey = (first: string, last: string, birthday: string) =>
  `${first.toLowerCase()}|${last.toLowerCase()}|${birthday}`;

/* "Nachname, Vorname" is common in exports — try the swapped form too. */
function lookupName(
  name: string,
  find: (name: string) => number | null,
  cache: Map<string, number | null>,
): number | null {
  if (cache.has(name)) return cache.get(name)!;
  let id = find(name);
  if (id === null && name.includes(",")) {
    const [last, first] = name.split(",", 2).map((part) => part.trim());
    if (first && last) id = find(`${first} ${last}`);
  }
  cache.set(name, id);
  return id;
}

function planImport(db: Database, body: unknown, now: Date): PlannedRow[] {
  const request = parseRequest(body);
  const existing = listStudents(db);
  const existingByCustomer = new Map(existing.map((s) => [s.customerNumber, s]));
  const existingContracts = new Set(existing.map((s) => s.contractNumber));
  const existingPeople = new Set(
    existing
      .filter((s) => s.birthday)
      .map((s) => personKey(s.firstName, s.lastName, s.birthday)),
  );
  const defaultSchool = tableExists(db, "settings") ? getCompany(db).name : "";

  const seenCustomer = new Map<string, number>();
  const seenContract = new Map<string, number>();
  const seenPeople = new Map<string, number>();
  const instructorCache = new Map<string, number | null>();
  const vehicleCache = new Map<string, number | null>();

  const planned = request.rows.map((cells, index): PlannedRow => {
    const row = request.firstRowNumber + index;
    const { draft, errors, warnings } = mapImportRow(cells, request.mapping, now);
    if (!draft.drivingSchool) draft.drivingSchool = defaultSchool;
    let status: ImportRowResult["status"] = errors.length > 0 ? "error" : "import";

    const person = draft.birthday
      ? personKey(draft.firstName, draft.lastName, draft.birthday)
      : "";
    const skip = (message: string) => {
      warnings.push(`${message} – Zeile wird übersprungen.`);
      status = "skip";
    };

    if (status === "import") {
      const customer = draft.customerNumber;
      const contract = draft.contractNumber;
      const match = customer ? existingByCustomer.get(customer) : undefined;
      if (match) {
        skip(
          `Kundennummer ${customer} ist bereits vergeben (${match.firstName} ${match.lastName})`,
        );
      } else if (person && existingPeople.has(person)) {
        skip(
          `${draft.firstName} ${draft.lastName} (geb. ${draft.birthday}) ist bereits angelegt`,
        );
      } else if (customer && seenCustomer.has(customer)) {
        skip(
          `Kundennummer ${customer} steht schon in Zeile ${seenCustomer.get(customer)}`,
        );
      } else if (person && seenPeople.has(person)) {
        skip(`Gleiche Person wie in Zeile ${seenPeople.get(person)}`);
      } else if (contract && existingContracts.has(contract)) {
        errors.push(`Vertragsnummer ${contract} ist bereits vergeben.`);
        status = "error";
      } else if (contract && seenContract.has(contract)) {
        errors.push(
          `Vertragsnummer ${contract} steht schon in Zeile ${seenContract.get(contract)}.`,
        );
        status = "error";
      }
    }

    let instructorId: number | null = null;
    let vehicleId: number | null = null;
    if (status === "import") {
      if (draft.customerNumber) seenCustomer.set(draft.customerNumber, row);
      if (draft.contractNumber) seenContract.set(draft.contractNumber, row);
      if (person) seenPeople.set(person, row);

      // Unknown names never fail a row: import unassigned, with a warning.
      if (draft.instructor && draft.instructor !== UNASSIGNED) {
        instructorId = lookupName(
          draft.instructor,
          (name) => instructorIdByName(db, name),
          instructorCache,
        );
        if (instructorId === null) {
          warnings.push(
            `Fahrlehrer/in „${draft.instructor}“ nicht gefunden – wird ohne Zuteilung importiert.`,
          );
        }
      }
      if (draft.vehicle && draft.vehicle !== UNASSIGNED) {
        vehicleId = lookupName(
          draft.vehicle,
          (name) => vehicleIdByName(db, name),
          vehicleCache,
        );
        if (vehicleId === null) {
          warnings.push(
            `Fahrzeug „${draft.vehicle}“ nicht gefunden – wird ohne Zuteilung importiert.`,
          );
        }
      }
    }
    if (instructorId === null) draft.instructor = UNASSIGNED;
    if (vehicleId === null) draft.vehicle = UNASSIGNED;

    return {
      result: {
        row,
        ok: status === "import",
        status,
        errors,
        warnings,
        student: draft,
        generated: { customerNumber: false, contractNumber: false },
      },
      instructorId,
      vehicleId,
    };
  });

  // Missing numbers continue the school's range (same scheme as the
  // Schüler-Anmeldung), after every number that exists or is imported.
  const importing = planned.filter((p) => p.result.ok).map((p) => p.result);
  const sequence = studentNumberSequence([
    ...existing,
    ...importing.map((r) => r.student),
  ]);
  for (const result of importing) {
    if (!result.student.customerNumber) {
      result.student.customerNumber = sequence.nextCustomerNumber();
      result.generated.customerNumber = true;
    }
    if (!result.student.contractNumber) {
      result.student.contractNumber = sequence.nextContractNumber();
      result.generated.contractNumber = true;
    }
  }

  return planned;
}

function summarize(rows: ImportRowResult[]): ImportSummary {
  return {
    total: rows.length,
    importable: rows.filter((r) => r.status === "import").length,
    skipped: rows.filter((r) => r.status === "skip").length,
    failed: rows.filter((r) => r.status === "error").length,
  };
}

export function previewStudentImport(
  db: Database,
  body: unknown,
  now = new Date(),
): ImportPreview {
  const rows = planImport(db, body, now).map((p) => p.result);
  return { rows, summary: summarize(rows) };
}

/* Re-plans inside the transaction (the preview may be stale), then
   inserts every importable row. Any failure rolls back the whole
   import — a half-imported register is worse than none. */
export function commitStudentImport(
  db: Database,
  body: unknown,
  now = new Date(),
): ImportCommitResult {
  const run = db.transaction((): ImportCommitResult => {
    const planned = planImport(db, body, now);
    let imported = 0;
    for (const { result, instructorId, vehicleId } of planned) {
      if (!result.ok) continue;
      const { instructor: _i, vehicle: _v, ...student } = result.student;
      try {
        createStudent(db, {
          ...student,
          instructorId,
          vehicleId,
          progress: 0,
          lessons: initialLessons(),
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new ValidationError(
          `Zeile ${result.row}: ${reason} Der Import wurde abgebrochen, es wurde nichts importiert.`,
        );
      }
      imported++;
    }
    return { ...summarize(planned.map((p) => p.result)), imported };
  });
  return run();
}

export function importRoutes(db: Database) {
  return {
    "/api/import/students/preview": {
      POST: (req: BunRequest) =>
        handle(async () => json(previewStudentImport(db, await req.json())))(),
    },
    "/api/import/students/commit": {
      POST: (req: BunRequest) =>
        handle(async () => json(commitStudentImport(db, await req.json()), 201))(),
    },
  };
}
