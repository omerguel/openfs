/* ------------------------------------------------------------------ */
/* Vehicles (Fahrzeuge) — DB access + validation.                      */
/* The HTTP wrappers live in routes.ts (vehicleRoutes).                 */
/*                                                                     */
/* Fahrlehrer ↔ Fahrzeug has one source of truth: instructors.         */
/* vehicle_id (the Stammfahrzeug). The vehicle's "Fahrlehrer/in"       */
/* detail is derived from it on read; setting it on a vehicle (by      */
/* name or `instructorId`) moves that instructor's Stammfahrzeug here. */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import { archiveRow } from "./archive";
import { ValidationError } from "./engine";
import { instructorIdByName, UNASSIGNED } from "./refs";

export type VehicleStatus = "aktiv" | "wartung";

export type VehicleDetail = {
  label: string;
  value: string;
};

export type Vehicle = {
  id: number;
  model: string;
  plate: string;
  klass: string;
  status: VehicleStatus;
  accent: string;
  details: VehicleDetail[];
  /** Instructors whose Stammfahrzeug this is (derived, read-only). */
  instructorIds: number[];
};

export type VehicleInput = Omit<Vehicle, "id" | "instructorIds"> & {
  /** Assign this instructor (null = nobody); wins over the detail name. */
  instructorId?: number | null;
};

const INSTRUCTOR_LABEL = "Fahrlehrer/in";
const HU_LABEL = "Nächste HU";
const MILEAGE_LABEL = "Kilometerstand";

type VehicleRow = {
  id: number;
  model: string;
  plate: string;
  klass: string;
  status: VehicleStatus;
  accent: string;
  details: string;
};

const DETAIL_LABELS = [
  "Getriebe",
  "Kraftstoff",
  "Kilometerstand",
  "Fahrlehrer/in",
  "Nächste HU",
  "Versicherung",
] as const;

const BASE_DETAILS: VehicleDetail[] = [
  { label: "Getriebe", value: "" },
  { label: "Kraftstoff", value: "" },
  { label: "Kilometerstand", value: "" },
  { label: "Fahrlehrer/in", value: "Nicht zugeteilt" },
  { label: "Nächste HU", value: "" },
  { label: "Versicherung", value: "" },
];

function parseDetails(raw: string): VehicleDetail[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return BASE_DETAILS;
    const next = new Map<string, string>(
      parsed
        .filter(
          (item) =>
            item !== null &&
            typeof item === "object" &&
            "label" in item &&
            "value" in item,
        )
        .map((item) => [
          String((item as { label: unknown }).label).trim(),
          String((item as { value: unknown }).value).trim(),
        ]),
    );
    return DETAIL_LABELS.map((label) => ({
      label,
      value: next.get(label) ?? "",
    }));
  } catch {
    return BASE_DETAILS;
  }
}

function assignedInstructors(db: Database, vehicleId: number) {
  return db
    .query<{ id: number; name: string }, [number]>(
      `SELECT id, trim(first_name || ' ' || last_name) AS name FROM instructors
       WHERE vehicle_id = ? ORDER BY status = 'aktiv' DESC, last_name, first_name`,
    )
    .all(vehicleId);
}

function toVehicle(db: Database, row: VehicleRow): Vehicle {
  const instructors = assignedInstructors(db, row.id);
  const names = instructors.map((i) => i.name).join(", ") || UNASSIGNED;
  return {
    id: row.id,
    model: row.model,
    plate: row.plate,
    klass: row.klass,
    status: row.status,
    accent: row.accent,
    details: parseDetails(row.details).map((detail) =>
      detail.label === INSTRUCTOR_LABEL ? { ...detail, value: names } : detail,
    ),
    instructorIds: instructors.map((i) => i.id),
  };
}

const SELECT = "SELECT id, model, plate, klass, status, accent, details FROM vehicles";

export function listVehicles(db: Database): Vehicle[] {
  return db
    .query<VehicleRow, []>(`${SELECT} ORDER BY model`)
    .all()
    .map((row) => toVehicle(db, row));
}

export function getVehicle(db: Database, id: number): Vehicle {
  const row = db.query<VehicleRow, [number]>(`${SELECT} WHERE id = ?`).get(id);
  if (!row) throw new ValidationError("Fahrzeug nicht gefunden.");
  return toVehicle(db, row);
}

export function listVehicleModels(db: Database): string[] {
  return db
    .query<{ model: string }, []>("SELECT DISTINCT model FROM vehicles ORDER BY model")
    .all()
    .map((row) => row.model)
    .filter(Boolean);
}

function normalizeStatus(value: unknown): VehicleStatus {
  if (value === undefined) return "aktiv";
  if (value !== "aktiv" && value !== "wartung") {
    throw new ValidationError("Status muss 'aktiv' oder 'wartung' sein.");
  }
  return value;
}

function normalizeDetails(value: unknown, current: VehicleDetail[]): VehicleDetail[] {
  if (value === undefined) return current;
  if (!Array.isArray(value)) {
    throw new ValidationError("Feld 'details' muss eine Liste sein.");
  }
  const next = new Map<string, string>();
  for (const row of value) {
    if (!row || typeof row !== "object") {
      throw new ValidationError("Feld 'details' enthält ungültige Einträge.");
    }
    const hasLabel = "label" in row && "value" in row;
    if (!hasLabel) {
      throw new ValidationError("Feld 'details' enthält ungültige Einträge.");
    }
    const label = String((row as { label: unknown }).label).trim();
    const detailValue = String((row as { value: unknown }).value).trim();
    next.set(label, detailValue);
  }
  return DETAIL_LABELS.map((label) => ({ label, value: next.get(label) ?? "" }));
}

const detailOf = (details: VehicleDetail[], label: string) =>
  details.find((detail) => detail.label === label)?.value ?? "";

/* "Nächste HU" is a month: MM/JJJJ (a <input type="month"> sends JJJJ-MM).
   Kilometerstand is a number, stored as "84.320 km". Only changed values
   are checked, so hand-written legacy entries never block other edits. */
function normalizeKnownDetails(details: VehicleDetail[], current: VehicleDetail[]) {
  return details.map((detail) => {
    const before = detailOf(current, detail.label);
    let value = detail.value;
    if (detail.label === HU_LABEL && value && value !== before) {
      const iso = /^(\d{4})-(\d{2})$/.exec(value);
      if (iso) value = `${iso[2]}/${iso[1]}`;
      if (!/^(0[1-9]|1[0-2])\/\d{4}$/.test(value)) {
        throw new ValidationError("Nächste HU bitte als Monat angeben (MM/JJJJ).");
      }
    }
    if (detail.label === MILEAGE_LABEL && value && value !== before) {
      const digits = value.replace(/\D/g, "");
      if (!digits || digits.length > 7) {
        throw new ValidationError("Kilometerstand bitte als Zahl angeben.");
      }
      value = `${Number(digits).toLocaleString("de-DE")} km`;
    }
    // Derived from instructors.vehicle_id — never stored on the vehicle.
    if (detail.label === INSTRUCTOR_LABEL) value = "";
    return { ...detail, value };
  });
}

/* The instructor requested by a payload: `instructorId` wins over the
   "Fahrlehrer/in" detail name. undefined = leave the assignment alone. */
function requestedInstructor(
  db: Database,
  input: Partial<VehicleInput>,
  current: Vehicle | null,
): number | null | undefined {
  if (input.instructorId !== undefined) {
    if (input.instructorId === null) return null;
    const id = Number(input.instructorId);
    if (!db.query("SELECT 1 FROM instructors WHERE id = ?").get(id)) {
      throw new ValidationError("Fahrlehrer/in nicht gefunden.");
    }
    return id;
  }
  if (!Array.isArray(input.details)) return undefined;
  const row = input.details.find(
    (detail) => detail && String(detail.label).trim() === INSTRUCTOR_LABEL,
  );
  if (!row) return undefined;
  const name = String(row.value ?? "").trim();
  const shown = current ? detailOf(current.details, INSTRUCTOR_LABEL) : UNASSIGNED;
  if (name === shown) return undefined; // unchanged (may list several names)
  if (!name || name === UNASSIGNED) return null;
  const id = instructorIdByName(db, name);
  if (id === null) throw new ValidationError(`Fahrlehrer/in „${name}“ nicht gefunden.`);
  return id;
}

function assignInstructor(db: Database, vehicleId: number, instructorId: number | null) {
  db.prepare(
    "UPDATE instructors SET vehicle_id = NULL WHERE vehicle_id = ? AND id IS NOT ?",
  ).run(vehicleId, instructorId);
  if (instructorId !== null) {
    db.prepare("UPDATE instructors SET vehicle_id = ? WHERE id = ?").run(
      vehicleId,
      instructorId,
    );
  }
}

/* Merge partial payload over current values, trimming strings and applying
   minimal validation rules. */
type VehicleTextKey = "model" | "plate" | "klass" | "accent";
function normalize(input: Partial<VehicleInput>, current: Vehicle): Vehicle {
  const str = (key: VehicleTextKey): string => {
    const value = input[key as keyof VehicleInput];
    if (value === undefined) {
      const cur = current[key as keyof Omit<Vehicle, "id">];
      return Array.isArray(cur) ? "" : String(cur);
    }
    if (typeof value !== "string") {
      throw new ValidationError(`Feld '${key}' muss ein Text sein.`);
    }
    return value.trim();
  };

  const next: Vehicle = {
    id: current.id,
    model: str("model"),
    plate: str("plate"),
    klass: str("klass"),
    status: current.status,
    accent: str("accent"),
    details: current.details,
    instructorIds: current.instructorIds,
  };

  if (input.status !== undefined) {
    next.status = normalizeStatus(input.status);
  }

  next.details = normalizeKnownDetails(
    normalizeDetails(input.details, current.details),
    current.details,
  );

  if (!next.model) {
    throw new ValidationError("Modell ist ein Pflichtfeld.");
  }
  if (!next.plate) {
    throw new ValidationError("Kennzeichen ist ein Pflichtfeld.");
  }
  if (!next.klass) {
    throw new ValidationError("Klasse ist ein Pflichtfeld.");
  }

  return next;
}

const EMPTY: Omit<Vehicle, "id"> = {
  model: "",
  plate: "",
  klass: "",
  status: "aktiv",
  accent: "bg-slate-500/10 text-slate-600",
  details: BASE_DETAILS,
  instructorIds: [],
};

function guardUnique<T>(write: () => T): T {
  try {
    return write();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("UNIQUE") || error.message.includes("unique constraint"))
    ) {
      throw new ValidationError("Kennzeichen ist bereits vergeben.");
    }
    throw error;
  }
}

function toJson(details: VehicleDetail[]) {
  return JSON.stringify(details);
}

export function createVehicle(db: Database, input: Partial<VehicleInput>): Vehicle {
  const data = normalize(input, { ...EMPTY, id: 0 });
  const instructorId = requestedInstructor(db, input, null);
  const insert = db.transaction(() => {
    const row = db
      .query<{ id: number }, [string, string, string, string, string, string]>(
        `INSERT INTO vehicles (model, plate, klass, status, accent, details)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(
        data.model,
        data.plate,
        data.klass,
        data.status,
        data.accent,
        toJson(data.details),
      )!;
    if (instructorId !== undefined) assignInstructor(db, row.id, instructorId);
    return row.id;
  });
  return getVehicle(db, guardUnique(insert));
}

export function updateVehicle(
  db: Database,
  id: number,
  input: Partial<VehicleInput>,
): Vehicle {
  const current = getVehicle(db, id);
  const data = normalize(input, current);
  const instructorId = requestedInstructor(db, input, current);
  const write = db.transaction(() => {
    db.prepare(
      `UPDATE vehicles
       SET model = ?, plate = ?, klass = ?, status = ?, accent = ?, details = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      data.model,
      data.plate,
      data.klass,
      data.status,
      data.accent,
      toJson(data.details),
      id,
    );
    // Students, instructors and Termine link by vehicle_id — a model
    // rename needs no cascade; display names are derived on read.
    if (instructorId !== undefined) assignInstructor(db, id, instructorId);
  });
  guardUnique(write);
  return getVehicle(db, id);
}

export function deleteVehicle(db: Database, id: number): void {
  const vehicle = getVehicle(db, id);
  const tables = ["students", "instructors", "calendar_events"] as const;
  const remove = db.transaction(() => {
    // Remember who was assigned so a restore can re-link them.
    const linked = (table: string) =>
      db
        .query<{ id: number }, [number]>(`SELECT id FROM ${table} WHERE vehicle_id = ?`)
        .all(id)
        .map((row) => row.id);
    archiveRow(db, "vehicle", id, `${vehicle.model} · ${vehicle.plate}`, {
      students: linked("students"),
      instructors: linked("instructors"),
      calendarEvents: linked("calendar_events"),
    });
    for (const table of tables) {
      db.prepare(`UPDATE ${table} SET vehicle_id = NULL WHERE vehicle_id = ?`).run(id);
    }
    db.prepare("DELETE FROM vehicles WHERE id = ?").run(id);
  });
  remove();
}
