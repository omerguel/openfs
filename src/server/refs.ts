/* ------------------------------------------------------------------ */
/* Instructor / vehicle references.                                    */
/*                                                                     */
/* Students, Termine, theory groups and instructors point at           */
/* instructors and vehicles by id (instructor_id / vehicle_id, NULL =  */
/* unassigned). Display names are derived on read, so a rename needs   */
/* no cascade. The API still accepts a display name as input (older    */
/* clients, pickers keyed by name) and resolves it here.               */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import { ValidationError } from "./errors";

export const UNASSIGNED = "Nicht zugeteilt";

/** SQL expression yielding the instructor display name for `<alias>.instructor_id`. */
export function instructorNameSql(alias: string, fallback = UNASSIGNED): string {
  return `COALESCE((SELECT trim(i.first_name || ' ' || i.last_name) FROM instructors i
    WHERE i.id = ${alias}.instructor_id), '${fallback}')`;
}

/* Vehicle display label: the bare model while it is unique in the fleet,
   "Modell · Kennzeichen" once two vehicles share a model — so every label
   names exactly one vehicle and pickers keyed by label stay unambiguous. */
const VEHICLE_LABEL = `CASE WHEN (SELECT count(*) FROM vehicles v2 WHERE v2.model = v.model) > 1
  THEN v.model || ' · ' || v.plate ELSE v.model END`;

/** SQL expression yielding the vehicle display label for `<alias>.vehicle_id`. */
export function vehicleNameSql(alias: string, fallback = UNASSIGNED): string {
  return `COALESCE((SELECT ${VEHICLE_LABEL} FROM vehicles v WHERE v.id = ${alias}.vehicle_id), '${fallback}')`;
}

/** All vehicle labels (see VEHICLE_LABEL), sorted. */
export function listVehicleLabels(db: Database): string[] {
  return db
    .query<{ label: string }, []>(
      `SELECT ${VEHICLE_LABEL} AS label FROM vehicles v ORDER BY v.model, v.plate`,
    )
    .all()
    .map((row) => row.label);
}

function isUnassignedName(name: string): boolean {
  return name === "" || name === UNASSIGNED;
}

function requireIdOrNull(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(
      `Feld '${field}' muss eine positive ganze Zahl oder null sein.`,
    );
  }
  return value;
}

export function instructorIdByName(db: Database, name: string): number | null {
  const row = db
    .query<{ id: number }, [string]>(
      `SELECT id FROM instructors WHERE trim(first_name || ' ' || last_name) = ?
       ORDER BY status = 'aktiv' DESC, id LIMIT 1`,
    )
    .get(name.trim());
  return row?.id ?? null;
}

export function vehicleIdByName(db: Database, name: string): number | null {
  const trimmed = name.trim();
  // "Modell · Kennzeichen" (unambiguous) or the bare model.
  const byPlate = db
    .query<{ id: number }, [string]>(
      "SELECT id FROM vehicles WHERE model || ' · ' || plate = ? LIMIT 1",
    )
    .get(trimmed);
  if (byPlate) return byPlate.id;
  const row = db
    .query<{ id: number }, [string, string]>(
      `SELECT id FROM vehicles WHERE model = ? OR plate = ?
       ORDER BY status = 'aktiv' DESC, id LIMIT 1`,
    )
    .get(trimmed, trimmed);
  return row?.id ?? null;
}

type RefInput = { id?: unknown; name?: unknown };

/* A client that echoes a whole record back (id + display name) but edited
   only the name must not have its edit swallowed by the stale id: when
   both are sent and the name no longer matches the id's display name,
   the name wins. */
function nameOverridesId(
  db: Database,
  kind: "instructor" | "vehicle",
  input: RefInput,
): boolean {
  if (typeof input.name !== "string") return false;
  const name = input.name.trim();
  if (input.id === null) return !isUnassignedName(name);
  if (typeof input.id !== "number") return false;
  const aliases =
    kind === "instructor"
      ? db
          .query<{ a: string }, [number]>(
            "SELECT trim(first_name || ' ' || last_name) AS a FROM instructors WHERE id = ?",
          )
          .all(input.id)
          .map((r) => r.a)
      : (db
          .query<{ model: string; plate: string }, [number]>(
            "SELECT model, plate FROM vehicles WHERE id = ?",
          )
          .all(input.id)
          .flatMap((r) => [r.model, r.plate, `${r.model} · ${r.plate}`]) as string[]);
  if (aliases.length === 0) return false;
  return !aliases.includes(name);
}

/* Resolve the next instructor id from a partial payload: `instructorId`
   wins over `instructor` (display name); absent both → keep current. */
export function resolveInstructorId(
  db: Database,
  input: RefInput,
  current: number | null,
): number | null {
  if (input.id !== undefined && !nameOverridesId(db, "instructor", input)) {
    const id = requireIdOrNull(input.id, "instructorId");
    if (id !== null && !db.query("SELECT 1 FROM instructors WHERE id = ?").get(id)) {
      throw new ValidationError(`Fahrlehrer/in mit ID ${id} nicht gefunden.`);
    }
    return id;
  }
  if (input.name === undefined) return current;
  if (input.name === null) return null;
  if (typeof input.name !== "string") {
    throw new ValidationError("Feld 'instructor' muss ein Text sein.");
  }
  if (isUnassignedName(input.name.trim())) return null;
  const id = instructorIdByName(db, input.name);
  if (id === null) {
    throw new ValidationError(`Fahrlehrer/in '${input.name.trim()}' nicht gefunden.`);
  }
  return id;
}

export function resolveVehicleId(
  db: Database,
  input: RefInput,
  current: number | null,
): number | null {
  if (input.id !== undefined && !nameOverridesId(db, "vehicle", input)) {
    const id = requireIdOrNull(input.id, "vehicleId");
    if (id !== null && !db.query("SELECT 1 FROM vehicles WHERE id = ?").get(id)) {
      throw new ValidationError(`Fahrzeug mit ID ${id} nicht gefunden.`);
    }
    return id;
  }
  if (input.name === undefined) return current;
  if (input.name === null) return null;
  if (typeof input.name !== "string") {
    throw new ValidationError("Feld 'vehicle' muss ein Text sein.");
  }
  if (isUnassignedName(input.name.trim())) return null;
  const id = vehicleIdByName(db, input.name);
  if (id === null) {
    throw new ValidationError(`Fahrzeug '${input.name.trim()}' nicht gefunden.`);
  }
  return id;
}

/* ------------------------------------------------------------------ */
/* Migration: name-keyed text columns → id columns                    */
/* ------------------------------------------------------------------ */

function columnNames(db: Database, table: string): string[] {
  return db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

/* Replace a legacy name column with an id column. Back-fills by exact
   display-name match (ambiguous or unknown names → NULL), then drops the
   text column. Idempotent: no-op once the text column is gone. */
export function migrateNameColumn(
  db: Database,
  table: string,
  spec: { from: "instructor" | "vehicle" },
): void {
  const cols = columnNames(db, table);
  if (cols.length === 0 || !cols.includes(spec.from)) return;
  const idCol = `${spec.from}_id`;
  const target = spec.from === "instructor" ? "instructors" : "vehicles";
  if (!cols.includes(idCol)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${idCol} INTEGER REFERENCES ${target}(id)`);
  }
  const rows = db
    .query<{ id: number; name: string }, []>(
      `SELECT id, ${spec.from} AS name FROM ${table} WHERE ${idCol} IS NULL`,
    )
    .all();
  const update = db.prepare(`UPDATE ${table} SET ${idCol} = ? WHERE id = ?`);
  const resolve = spec.from === "instructor" ? instructorIdByName : vehicleIdByName;
  for (const row of rows) {
    const name = (row.name ?? "").trim();
    if (isUnassignedName(name)) continue;
    const id = resolve(db, name);
    if (id !== null) update.run(id, row.id);
  }
  db.exec(`ALTER TABLE ${table} DROP COLUMN ${spec.from}`);
}
