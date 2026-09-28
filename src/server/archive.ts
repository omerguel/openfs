/* ------------------------------------------------------------------ */
/* Archiv (Papierkorb) — soft-delete fallback for accidental deletes.  */
/*                                                                     */
/* Every delete* function snapshots the raw table row into `archive`   */
/* before removing it. Restore re-inserts the snapshot verbatim        */
/* (including the original id), so references that survive by name or  */
/* id keep working. The HTTP wrappers live in routes.ts.               */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import { ValidationError } from "./engine";
import type { FileStore } from "./file-store";
import { instructorIdByName, vehicleIdByName } from "./refs";
import { deleteStoredFiles, removeStudentFileRows } from "./student-files";

export type ArchiveEntity =
  | "student"
  | "calendar_event"
  | "instructor"
  | "vehicle"
  | "price_plan";

/* Whitelist — entity → table. Restore builds SQL from this map only,
   never from client input. */
const TABLES: Record<ArchiveEntity, string> = {
  student: "students",
  calendar_event: "calendar_events",
  instructor: "instructors",
  vehicle: "vehicles",
  price_plan: "price_plans",
};

/* Records that pointed at the deleted row and were reset to NULL
   (instructor_id / vehicle_id / price_plan_id / conversations.student_id;
   removed from the member list for theory groups). Restore re-links them — but only the ones
   still unassigned, so reassignments made in the meantime survive. */
export type ArchiveLinks = {
  students?: number[];
  instructors?: number[];
  theoryGroups?: number[];
  conversations?: number[];
  calendarEvents?: number[];
};

/* Tables created lazily by their route modules (theory_groups,
   conversations) may be absent in a bare openDb() database. */
export function tableExists(db: Database, name: string): boolean {
  return (
    db
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(name) !== null
  );
}

type ArchivePayload = {
  row: Record<string, unknown>;
  links?: ArchiveLinks;
};

export type ArchiveRecord = {
  id: number;
  entity: ArchiveEntity;
  label: string;
  deletedAt: string;
};

type ArchiveRow = {
  id: number;
  entity: ArchiveEntity;
  label: string;
  payload: string;
  deleted_at: string;
};

const toRecord = (row: ArchiveRow): ArchiveRecord => ({
  id: row.id,
  entity: row.entity,
  label: row.label,
  // datetime('now') stores UTC without zone marker — make it ISO.
  deletedAt: `${row.deleted_at.replace(" ", "T")}Z`,
});

/* Snapshot a row into the archive. Call this inside the same
   transaction that deletes the row. */
export function archiveRow(
  db: Database,
  entity: ArchiveEntity,
  id: number,
  label: string,
  links?: ArchiveLinks,
): void {
  const row = db
    .query<Record<string, unknown>, [number]>(
      `SELECT * FROM ${TABLES[entity]} WHERE id = ?`,
    )
    .get(id);
  if (!row) throw new ValidationError("Eintrag nicht gefunden.");
  const payload: ArchivePayload = { row };
  if (links && Object.values(links).some((ids) => ids?.length)) {
    payload.links = links;
  }
  db.prepare("INSERT INTO archive (entity, label, payload) VALUES (?, ?, ?)").run(
    entity,
    label,
    JSON.stringify(payload),
  );
}

export function listArchive(db: Database): ArchiveRecord[] {
  return db
    .query<ArchiveRow, []>(
      "SELECT id, entity, label, payload, deleted_at FROM archive ORDER BY deleted_at DESC, id DESC",
    )
    .all()
    .map(toRecord);
}

function getArchiveRow(db: Database, id: number): ArchiveRow {
  const row = db
    .query<ArchiveRow, [number]>(
      "SELECT id, entity, label, payload, deleted_at FROM archive WHERE id = ?",
    )
    .get(id);
  if (!row) throw new ValidationError("Archiveintrag nicht gefunden.");
  return row;
}

/* Put records that were reset to NULL when their target was
   deleted back onto the restored target — skipping any that have been
   reassigned since. Runs inside the restore transaction. */
function relink(
  db: Database,
  entity: ArchiveEntity,
  snapshot: Record<string, unknown>,
  links: ArchiveLinks,
): void {
  const idList = (ids: number[]) => ids.map(() => "?").join(", ");

  const targetId = Number(snapshot.id);
  // Re-point `column` at the restored row — only where it is still NULL.
  const relinkColumn = (table: string, column: string, ids: number[] | undefined) => {
    if (!ids?.length || !tableExists(db, table)) return;
    db.prepare(
      `UPDATE ${table} SET ${column} = ?
       WHERE ${column} IS NULL AND id IN (${idList(ids)})`,
    ).run(targetId, ...ids);
  };

  if (entity === "instructor") {
    relinkColumn("students", "instructor_id", links.students);
    relinkColumn("calendar_events", "instructor_id", links.calendarEvents);
    relinkColumn("theory_groups", "instructor_id", links.theoryGroups);
  } else if (entity === "vehicle") {
    relinkColumn("students", "vehicle_id", links.students);
    relinkColumn("instructors", "vehicle_id", links.instructors);
    relinkColumn("calendar_events", "vehicle_id", links.calendarEvents);
  } else if (entity === "price_plan") {
    relinkColumn("students", "price_plan_id", links.students);
  }

  if (links.theoryGroups?.length && tableExists(db, "theory_groups")) {
    const ids = links.theoryGroups;
    if (entity === "student") {
      // Re-add the student to each group it was removed from — unless
      // the seat has been filled or the student re-added in the meantime.
      const studentId = Number(snapshot.id);
      const lookup = db.query<{ student_ids: string; capacity: number }, [number]>(
        "SELECT student_ids, capacity FROM theory_groups WHERE id = ?",
      );
      const update = db.prepare("UPDATE theory_groups SET student_ids = ? WHERE id = ?");
      for (const groupId of ids) {
        const group = lookup.get(groupId);
        if (!group) continue;
        const members = parseIdList(group.student_ids);
        if (members.includes(studentId) || members.length >= group.capacity) {
          continue;
        }
        members.push(studentId);
        update.run(JSON.stringify(members), groupId);
      }
    }
  }

  if (
    links.conversations?.length &&
    entity === "student" &&
    tableExists(db, "conversations")
  ) {
    const ids = links.conversations;
    db.prepare(
      `UPDATE conversations SET student_id = ?, orphaned = 0
       WHERE student_id IS NULL AND id IN (${idList(ids)})`,
    ).run(Number(snapshot.id), ...ids);
  }
}

/* Same tolerant parse as theory-groups.ts uses for student_ids. */
function parseIdList(raw: string): number[] {
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

/* Adapt a snapshot to the table as it is today: snapshots taken before
   the id migration carry name columns (instructor / vehicle) — resolve
   them to ids; columns the table no longer has are dropped; links to an
   instructor/vehicle that is itself gone become unassigned (NULL). */
function normalizeSnapshot(
  db: Database,
  table: string,
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  const existing = new Set(
    db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name),
  );
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (existing.has(key)) next[key] = value;
  }
  if (existing.has("instructor_id") && next.instructor_id === undefined) {
    const name = typeof snapshot.instructor === "string" ? snapshot.instructor : "";
    next.instructor_id = name ? instructorIdByName(db, name) : null;
  }
  if (existing.has("vehicle_id") && next.vehicle_id === undefined) {
    const name = typeof snapshot.vehicle === "string" ? snapshot.vehicle : "";
    next.vehicle_id = name ? vehicleIdByName(db, name) : null;
  }
  const exists = (target: string, id: unknown) =>
    typeof id === "number" && db.query(`SELECT 1 FROM ${target} WHERE id = ?`).get(id);
  if (next.instructor_id != null && !exists("instructors", next.instructor_id)) {
    next.instructor_id = null;
  }
  if (next.vehicle_id != null && !exists("vehicles", next.vehicle_id)) {
    next.vehicle_id = null;
  }
  return next;
}

/* Re-insert the snapshot verbatim and drop the archive entry. UNIQUE /
   FK violations (e.g. the Vertragsnummer was reused, or a referenced
   price plan is itself still deleted) become readable errors. */
export function restoreArchived(db: Database, id: number): ArchiveRecord {
  const row = getArchiveRow(db, id);
  const parsed = JSON.parse(row.payload) as ArchivePayload | Record<string, unknown>;
  // Early snapshots stored the bare row without the { row, links } wrapper.
  const { row: snapshot, links } =
    "row" in parsed && typeof parsed.row === "object"
      ? (parsed as ArchivePayload)
      : { row: parsed as Record<string, unknown>, links: undefined };
  const table = TABLES[row.entity];
  const restorable = normalizeSnapshot(db, table, snapshot);
  const columns = Object.keys(restorable);

  const restore = db.transaction(() => {
    db.prepare(
      `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})`,
    ).run(...(columns.map((c) => restorable[c]) as (string | number | null)[]));
    if (links) relink(db, row.entity, snapshot, links);
    db.prepare("DELETE FROM archive WHERE id = ?").run(id);
  });

  try {
    restore();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      throw new ValidationError(
        "Wiederherstellen nicht möglich: Eine Nummer oder ID ist inzwischen neu vergeben.",
      );
    }
    if (error instanceof Error && error.message.includes("FOREIGN KEY")) {
      throw new ValidationError(
        "Wiederherstellen nicht möglich: Ein verknüpfter Eintrag ist noch gelöscht.",
      );
    }
    throw error;
  }
  return toRecord(row);
}

/* Removes the archive entry for good. For a student this is also the
   moment its uploaded files go (student_files keeps them while the
   student is only archived). The DB part is synchronous; the returned
   promise settles once the stored bytes are deleted — best effort, it
   never rejects. Without a store the file rows are left alone so no
   bytes are orphaned without a trace. */
export function purgeArchived(
  db: Database,
  id: number,
  store?: FileStore,
): Promise<void> {
  const row = getArchiveRow(db, id); // throws ValidationError if unknown
  let keys: string[] = [];
  db.transaction(() => {
    db.prepare("DELETE FROM archive WHERE id = ?").run(id);
    if (row.entity === "student" && store && tableExists(db, "student_files")) {
      const studentId = archivedRowId(row.payload);
      if (studentId !== null) keys = removeStudentFileRows(db, studentId);
    }
  })();
  return store && keys.length > 0 ? deleteStoredFiles(store, keys) : Promise.resolve();
}

function archivedRowId(payload: string): number | null {
  try {
    const parsed = JSON.parse(payload) as { row?: { id?: unknown }; id?: unknown };
    const id = Number(
      parsed.row && typeof parsed.row === "object" ? parsed.row.id : parsed.id,
    );
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
}
