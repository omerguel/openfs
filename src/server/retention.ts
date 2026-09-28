/* ------------------------------------------------------------------ */
/* Löschkonzept — retention engine (DSGVO Art. 5 Abs. 1 lit. e, 17).    */
/*                                                                     */
/*  planRetention()    what is due today, per category (the Lösch-      */
/*                     vorschau); `hash` identifies the exact batch.    */
/*  executeRetention() deletes/anonymises exactly the planned items.   */
/*  startRetentionScheduler()  daily per school (bootstrap.ts): always */
/*                     housekeeping, the batch only in "automatisch"   */
/*                     mode — otherwise the owner confirms it on       */
/*                     Fahrschule → Datenschutz.                        */
/*                                                                     */
/* Accounting stays untouched while its period runs: bookings and      */
/* invoices keep their name snapshot until every record of a customer  */
/* is past 10 years, then engine.pseudonymiseExpiredCustomer replaces  */
/* the name (amounts, numbers, sequences stay). Legal holds             */
/* ("Aufbewahrung verlängern") exclude a student from every student-   */
/* bound category. Every run lands in retention_runs and the audit log */
/* with counts only. Rationale: docs/datenschutz/loeschkonzept.md.     */
/* ------------------------------------------------------------------ */

import type { BunRequest } from "bun";

import type { Database } from "./sqlite";

import {
  normalizeRetentionPolicy,
  periodError,
  periodOver,
  PSEUDONYM_FIRST_NAME,
  RETENTION_CATEGORIES,
  RETENTION_DEFS,
  type RetentionCategory,
  type RetentionPolicy,
  studentPseudonym,
} from "../lib/retention";
import { tableExists } from "./archive";
import { audit } from "./auth";
import { latestAccountingDate, pseudonymiseExpiredCustomer } from "./engine";
import { ValidationError } from "./errors";
import type { FileStore } from "./file-store";
import { err, handle, json } from "./http";
import { currentUser, requestContext } from "./request-context";
import { schoolToday } from "./school-time";
import { deleteStoredFiles } from "./student-files";

/* ----------------------------- schema ----------------------------- */

const DDL = `
-- "Aufbewahrung verlängern": excluded from every student-bound deletion
-- (dispute, audit, pending claim). until NULL = until lifted.
CREATE TABLE IF NOT EXISTS retention_holds (
  student_id INTEGER PRIMARY KEY,
  reason TEXT NOT NULL,
  until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by TEXT NOT NULL DEFAULT ''
);
-- Students whose data was erased: kind 'frist' = master data anonymised
-- after the period; 'antrag' = Art. 17 request, contact data erased at
-- once, the rest is due at retained_until. accounting_done_at: names in
-- bookings/invoices pseudonymised after the accounting period.
CREATE TABLE IF NOT EXISTS privacy_erasures (
  student_id INTEGER PRIMARY KEY,
  customer_no TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('frist', 'antrag')),
  erased_at TEXT NOT NULL DEFAULT (datetime('now')),
  retained_until TEXT,
  accounting_done_at TEXT
);
-- One row per deletion run — counts only, no personal data.
CREATE TABLE IF NOT EXISTS retention_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  trigger TEXT NOT NULL CHECK (trigger IN ('automatisch', 'bestaetigt', 'antrag')),
  counts TEXT NOT NULL,
  user_name TEXT NOT NULL DEFAULT ''
);
`;

export function ensureRetentionTables(db: Database): void {
  db.exec(DDL);
}

/* ----------------------------- policy ----------------------------- */

const POLICY_KEY = "retention_policy";
const LAST_JOB_KEY = "retention_last_job";

function getSetting(db: Database, key: string): string | null {
  return (
    db
      .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
      .get(key)?.value ?? null
  );
}

function putSetting(db: Database, key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function getRetentionPolicy(db: Database): RetentionPolicy {
  const raw = getSetting(db, POLICY_KEY);
  if (!raw) return normalizeRetentionPolicy(null);
  try {
    return normalizeRetentionPolicy(JSON.parse(raw));
  } catch {
    return normalizeRetentionPolicy(null);
  }
}

export function setRetentionPolicy(db: Database, input: unknown): RetentionPolicy {
  if (!input || typeof input !== "object")
    throw new ValidationError("Ungültige Anfrage.");
  const body = input as { mode?: unknown; months?: Record<string, unknown> };
  const current = getRetentionPolicy(db);
  const next: RetentionPolicy = { mode: current.mode, months: { ...current.months } };
  if (body.mode !== undefined) {
    if (body.mode !== "bestaetigung" && body.mode !== "automatisch") {
      throw new ValidationError(
        "Löschmodus muss „bestaetigung“ oder „automatisch“ sein.",
      );
    }
    next.mode = body.mode;
  }
  if (body.months !== undefined) {
    if (!body.months || typeof body.months !== "object") {
      throw new ValidationError("Feld 'months' muss ein Objekt sein.");
    }
    for (const [key, value] of Object.entries(body.months)) {
      if (!(RETENTION_CATEGORIES as readonly string[]).includes(key)) {
        throw new ValidationError(`Unbekannte Kategorie: ${key}.`);
      }
      const category = key as RetentionCategory;
      const problem = periodError(category, value as number);
      if (typeof value !== "number" || problem) {
        throw new ValidationError(
          `${RETENTION_DEFS[category].label}: ${problem ?? "Bitte ganze Monate angeben."}`,
        );
      }
      next.months[category] = value;
    }
  }
  putSetting(db, POLICY_KEY, JSON.stringify(next));
  return next;
}

/* ------------------------------ holds ----------------------------- */

export type RetentionHold = {
  studentId: number;
  label: string;
  reason: string;
  until: string | null;
  createdAt: string;
  createdBy: string;
};

export function activeHoldIds(db: Database, today: string): Set<number> {
  return new Set(
    db
      .query<{ student_id: number }, [string]>(
        "SELECT student_id FROM retention_holds WHERE until IS NULL OR until >= ?",
      )
      .all(today)
      .map((row) => row.student_id),
  );
}

export function listHolds(db: Database): RetentionHold[] {
  const labels = subjectLabels(db);
  return db
    .query<
      {
        student_id: number;
        reason: string;
        until: string | null;
        created_at: string;
        created_by: string;
      },
      []
    >("SELECT * FROM retention_holds ORDER BY created_at DESC")
    .all()
    .map((row) => ({
      studentId: row.student_id,
      label: labels.get(row.student_id) ?? `Schüler #${row.student_id}`,
      reason: row.reason,
      until: row.until,
      createdAt: row.created_at,
      createdBy: row.created_by,
    }));
}

export function setHold(
  db: Database,
  input: { studentId?: unknown; reason?: unknown; until?: unknown },
): RetentionHold {
  const studentId = Number(input.studentId);
  if (!Number.isInteger(studentId) || studentId < 1) {
    throw new ValidationError("Ungültige Schüler-ID.");
  }
  if (!subjectLabels(db).has(studentId)) {
    throw new ValidationError("Fahrschüler/in nicht gefunden.");
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason)
    throw new ValidationError("Bitte einen Grund angeben (z. B. Rechtsstreit).");
  if (reason.length > 200) throw new ValidationError("Der Grund ist zu lang.");
  let until: string | null = null;
  if (input.until !== undefined && input.until !== null && input.until !== "") {
    if (typeof input.until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.until)) {
      throw new ValidationError("„Bis“ muss ein Datum (JJJJ-MM-TT) sein.");
    }
    until = input.until;
  }
  db.prepare(
    `INSERT INTO retention_holds (student_id, reason, until, created_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(student_id) DO UPDATE SET reason = excluded.reason, until = excluded.until,
       created_by = excluded.created_by, created_at = datetime('now')`,
  ).run(studentId, reason, until, currentUser()?.name ?? "");
  return listHolds(db).find((hold) => hold.studentId === studentId)!;
}

export function removeHold(db: Database, studentId: number): void {
  const result = db
    .prepare("DELETE FROM retention_holds WHERE student_id = ?")
    .run(studentId);
  if (result.changes === 0) throw new ValidationError("Keine Aufbewahrung eingetragen.");
}

/* ------------------------ students (subjects) --------------------- */

/** A student as far as retention is concerned — active (students
    table) or archived (snapshot in `archive`). */
export type ArchivedStudent = {
  archiveId: number;
  studentId: number;
  /** ISO date of the archiving = Ende der Ausbildung. */
  archivedOn: string;
  row: Record<string, unknown>;
  links: { conversations?: number[]; calendarEvents?: number[] };
  payload: Record<string, unknown>;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function fullNameOf(row: Record<string, unknown>): string {
  return `${text(row.first_name)} ${text(row.last_name)}`.trim();
}

/** Archived students by id (newest snapshot wins). */
export function archivedStudents(db: Database): Map<number, ArchivedStudent> {
  const out = new Map<number, ArchivedStudent>();
  if (!tableExists(db, "archive")) return out;
  const rows = db
    .query<{ id: number; payload: string; deleted_at: string }, []>(
      "SELECT id, payload, deleted_at FROM archive WHERE entity = 'student' ORDER BY id",
    )
    .all();
  for (const entry of rows) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(entry.payload);
    } catch {
      continue;
    }
    // Early snapshots stored the bare row without the { row, links } wrapper.
    const wrapped = payload.row && typeof payload.row === "object";
    const row = (wrapped ? payload.row : payload) as Record<string, unknown>;
    const studentId = Number(row.id);
    if (!Number.isInteger(studentId)) continue;
    out.set(studentId, {
      archiveId: entry.id,
      studentId,
      archivedOn: entry.deleted_at.slice(0, 10),
      row,
      links: (wrapped && payload.links && typeof payload.links === "object"
        ? payload.links
        : {}) as ArchivedStudent["links"],
      payload,
    });
  }
  return out;
}

/** Display label per known student id (active and archived). */
export function subjectLabels(db: Database): Map<number, string> {
  const labels = new Map<number, string>();
  for (const [id, entry] of archivedStudents(db)) {
    labels.set(id, `${fullNameOf(entry.row)} (archiviert)`);
  }
  for (const row of db
    .query<{ id: number; first_name: string; last_name: string }, []>(
      "SELECT id, first_name, last_name FROM students",
    )
    .all()) {
    labels.set(row.id, `${row.first_name} ${row.last_name}`.trim());
  }
  return labels;
}

function erasures(db: Database) {
  return new Map(
    db
      .query<
        {
          student_id: number;
          customer_no: string;
          kind: "frist" | "antrag";
          retained_until: string | null;
          accounting_done_at: string | null;
        },
        []
      >(
        "SELECT student_id, customer_no, kind, retained_until, accounting_done_at FROM privacy_erasures",
      )
      .all()
      .map((row) => [row.student_id, row]),
  );
}

/* ------------------------------ plan ------------------------------ */

export type PlanItem = {
  category: RetentionCategory;
  /** Row id (student id for student-bound categories). */
  id: string;
  label: string;
  /** Start of the period (ISO date). */
  since: string;
  /** Number of records behind this item (e.g. attestations of a student). */
  count: number;
  studentId?: number;
};

export type RetentionPlan = {
  today: string;
  policy: RetentionPolicy;
  items: PlanItem[];
  counts: Record<RetentionCategory, number>;
  /** Identifies this exact batch: a confirmation must carry it. */
  hash: string;
  hints: { inactiveNotArchived: number };
};

function emptyCounts(): Record<RetentionCategory, number> {
  return Object.fromEntries(RETENTION_CATEGORIES.map((c) => [c, 0])) as Record<
    RetentionCategory,
    number
  >;
}

const PSEUDONYMISED_REQUEST = "Gelöschte Anfrage";

export function planRetention(
  db: Database,
  options: { today?: string; policy?: RetentionPolicy } = {},
): RetentionPlan {
  ensureRetentionTables(db);
  const today = options.today ?? schoolToday();
  const policy = options.policy ?? getRetentionPolicy(db);
  const over = (category: RetentionCategory, since: string) =>
    periodOver(
      since,
      policy.months[category],
      RETENTION_DEFS[category].fromYearEnd,
      today,
    );
  const holds = activeHoldIds(db, today);
  const archived = archivedStudents(db);
  const active = new Set(
    db
      .query<{ id: number }, []>("SELECT id FROM students")
      .all()
      .map((row) => row.id),
  );
  const erased = erasures(db);
  const items: PlanItem[] = [];
  const studentLabel = (id: number) => {
    const entry = archived.get(id);
    if (!entry) return `Schüler #${id}`;
    const customer = text(entry.row.customer_number);
    return `${fullNameOf(entry.row) || `Schüler #${id}`}${customer ? ` · Kd.-Nr. ${customer}` : ""}`;
  };

  // Terminanfragen that did not (or no longer) belong to a student.
  if (tableExists(db, "appointment_requests")) {
    const hasStudentId = db
      .query<{ name: string }, []>("PRAGMA table_info(appointment_requests)")
      .all()
      .some((c) => c.name === "student_id");
    const rows = db
      .query<{ id: number; name: string; created_at: string }, [string]>(
        `SELECT id, name, created_at FROM appointment_requests
         WHERE ${hasStudentId ? "student_id IS NULL AND" : ""}
           NOT (name = ? AND phone = '' AND email = '' AND message = '')
         ORDER BY id`,
      )
      .all(PSEUDONYMISED_REQUEST);
    for (const row of rows) {
      if (!over("anfragen", row.created_at)) continue;
      items.push({
        category: "anfragen",
        id: String(row.id),
        label: row.name,
        since: row.created_at.slice(0, 10),
        count: 1,
      });
    }
  }

  // Uploaded documents of archived (or vanished) students.
  if (tableExists(db, "student_files")) {
    const rows = db
      .query<{ id: number; student_id: number; name: string; uploaded_at: string }, []>(
        "SELECT id, student_id, name, uploaded_at FROM student_files ORDER BY id",
      )
      .all();
    for (const row of rows) {
      if (active.has(row.student_id) || holds.has(row.student_id)) continue;
      const since = archived.get(row.student_id)?.archivedOn ?? row.uploaded_at;
      if (!over("dokumente", since)) continue;
      items.push({
        category: "dokumente",
        id: String(row.id),
        label: `${row.name} – ${studentLabel(row.student_id)}`,
        since: since.slice(0, 10),
        count: 1,
        studentId: row.student_id,
      });
    }
  }

  // Chat threads no longer linked to an active student.
  if (tableExists(db, "conversations")) {
    const owner = new Map<number, ArchivedStudent>();
    for (const entry of archived.values()) {
      for (const id of entry.links.conversations ?? []) owner.set(id, entry);
    }
    const rows = db
      .query<
        {
          id: number;
          student_name: string;
          last_message_at: string | null;
          created_at: string;
          messages: number;
        },
        []
      >(
        `SELECT c.id, c.student_name, c.last_message_at, c.created_at,
                (SELECT count(*) FROM chat_messages m WHERE m.conversation_id = c.id) AS messages
         FROM conversations c WHERE c.student_id IS NULL ORDER BY c.id`,
      )
      .all();
    for (const row of rows) {
      const entry = owner.get(row.id);
      if (entry && holds.has(entry.studentId)) continue;
      const last = (row.last_message_at ?? row.created_at).slice(0, 10);
      const since = entry && entry.archivedOn > last ? entry.archivedOn : last;
      if (!over("chat", since)) continue;
      items.push({
        category: "chat",
        id: String(row.id),
        label: `Chat mit ${row.student_name}`,
        since,
        count: Math.max(row.messages, 1),
        studentId: entry?.studentId,
      });
    }
  }

  // Revoked Schülerportal links.
  if (tableExists(db, "portal_tokens")) {
    const rows = db
      .query<{ rowid: number; student_id: number; revoked_at: string }, []>(
        "SELECT rowid, student_id, revoked_at FROM portal_tokens WHERE revoked_at IS NOT NULL ORDER BY rowid",
      )
      .all();
    for (const row of rows) {
      if (!over("portal", row.revoked_at)) continue;
      items.push({
        category: "portal",
        id: String(row.rowid),
        label: `Portal-Link (Schüler #${row.student_id})`,
        since: row.revoked_at.slice(0, 10),
        count: 1,
      });
    }
  }

  // Sent (or finally failed) e-mails and SMS.
  if (tableExists(db, "outbox")) {
    const rows = db
      .query<
        { id: number; channel: string; subject: string; at: string; recipient: string },
        []
      >(
        `SELECT id, channel, subject, recipient, coalesce(sent_at, created_at) AS at
         FROM outbox WHERE status != 'wartend' ORDER BY id`,
      )
      .all();
    for (const row of rows) {
      if (!over("nachrichten", row.at)) continue;
      items.push({
        category: "nachrichten",
        id: String(row.id),
        label: `${row.channel === "sms" ? "SMS" : "E-Mail"} an ${row.recipient}${row.subject ? ` – ${row.subject}` : ""}`,
        since: row.at.slice(0, 10),
        count: 1,
      });
    }
  }

  // Audit log (one aggregated item; deletion runs are kept).
  if (tableExists(db, "audit_log")) {
    const cutoffRows = db
      .query<{ id: number; at: string }, []>(
        "SELECT id, at FROM audit_log WHERE method != 'LOESCHLAUF' ORDER BY id",
      )
      .all()
      .filter((row) => over("protokoll", row.at));
    if (cutoffRows.length > 0) {
      const last = cutoffRows[cutoffRows.length - 1]!;
      items.push({
        category: "protokoll",
        id: String(last.id),
        label: `${cutoffRows.length} Protokolleinträge bis ${last.at.slice(0, 10)}`,
        since: last.at.slice(0, 10),
        count: cutoffRows.length,
      });
    }
  }

  // Ausbildungsnachweise: § 31 FahrlG — 5 years after the end of the year
  // the training ended, then delete.
  if (tableExists(db, "lesson_attestations")) {
    const rows = db
      .query<{ student_id: number; n: number; last: string }, []>(
        `SELECT student_id, count(*) AS n, max(signed_at) AS last
         FROM lesson_attestations GROUP BY student_id ORDER BY student_id`,
      )
      .all();
    for (const row of rows) {
      if (active.has(row.student_id) || holds.has(row.student_id)) continue;
      const since = archived.get(row.student_id)?.archivedOn ?? row.last.slice(0, 10);
      if (!over("ausbildungsnachweis", since)) continue;
      items.push({
        category: "ausbildungsnachweis",
        id: String(row.student_id),
        label: studentLabel(row.student_id),
        since,
        count: row.n,
        studentId: row.student_id,
      });
    }
  }

  // Student master data of archived students.
  for (const entry of archived.values()) {
    if (holds.has(entry.studentId) || active.has(entry.studentId)) continue;
    const done = erased.get(entry.studentId);
    if (done?.kind === "frist") continue;
    const due =
      done?.kind === "antrag" && done.retained_until
        ? done.retained_until < today
        : over("schueler", entry.archivedOn);
    if (!due) continue;
    items.push({
      category: "schueler",
      id: String(entry.studentId),
      label: studentLabel(entry.studentId),
      since: entry.archivedOn,
      count: 1,
      studentId: entry.studentId,
    });
  }

  // Accounting: pseudonymise once every record of the customer is past
  // its period — only for students whose master data is already gone.
  for (const [studentId, done] of erased) {
    if (done.kind !== "frist" || done.accounting_done_at) continue;
    if (holds.has(studentId) || !done.customer_no) continue;
    const latest = latestAccountingDate(db, done.customer_no);
    if (latest && !over("buchhaltung", latest)) continue;
    items.push({
      category: "buchhaltung",
      id: String(studentId),
      label: `Kd.-Nr. ${done.customer_no} (${studentPseudonym(studentId)})`,
      since: latest ?? today,
      count: 1,
      studentId,
    });
  }
  if (tableExists(db, "sepa_collections")) {
    for (const row of db
      .query<{ id: number; msg_id: string; collection_date: string }, []>(
        "SELECT id, msg_id, collection_date FROM sepa_collections WHERE xml != '' ORDER BY id",
      )
      .all()) {
      if (!over("buchhaltung", row.collection_date)) continue;
      items.push({
        category: "buchhaltung",
        id: `sepa-${row.id}`,
        label: `Lastschriftdatei ${row.msg_id}`,
        since: row.collection_date,
        count: 1,
      });
    }
  }

  const counts = emptyCounts();
  for (const item of items) counts[item.category] += item.count;
  const inactiveNotArchived = db
    .query<{ n: number }, []>(
      "SELECT count(*) AS n FROM students WHERE status = 'inaktiv'",
    )
    .get()!.n;
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify([today, items.map((i) => [i.category, i.id, i.count])]));
  return {
    today,
    policy,
    items,
    counts,
    hash: hasher.digest("hex").slice(0, 32),
    hints: { inactiveNotArchived },
  };
}

/* ---------------------------- execute ----------------------------- */

export type RetentionTrigger = "automatisch" | "bestaetigt" | "antrag";

export type RetentionRun = {
  id: number;
  at: string;
  trigger: RetentionTrigger;
  counts: Partial<Record<RetentionCategory, number>>;
  userName: string;
};

/** Anonymises an archived student's master data (snapshot in `archive`)
 *  and every operational trace that carries the name — Termine,
 *  Chat-Kopf, Anfragen, E-Mail-Protokoll, Dokumente. Accounting and
 *  Ausbildungsnachweise are NOT touched here (own categories). Returns
 *  the storage keys of removed files (delete after the transaction). */
export function anonymiseArchivedStudent(
  db: Database,
  entry: ArchivedStudent,
  options: { contactOnly?: boolean } = {},
): string[] {
  const id = entry.studentId;
  const pseudonym = studentPseudonym(id);
  const name = fullNameOf(entry.row);
  const email = text(entry.row.email).trim();
  const phone = text(entry.row.phone).trim();
  const row = { ...entry.row };
  row.phone = "";
  row.email = "";
  row.companion = null;
  row.documents = "[]";
  row.open_documents = "[]";
  if (!options.contactOnly) {
    row.first_name = PSEUDONYM_FIRST_NAME;
    row.last_name = `#${id}`;
    row.birthday = "";
    row.address = "";
    row.license_date = null;
  }
  const payload = { ...entry.payload };
  if (payload.row && typeof payload.row === "object") payload.row = row;
  else Object.assign(payload, row);
  db.prepare("UPDATE archive SET payload = ?, label = ? WHERE id = ?").run(
    JSON.stringify(payload),
    options.contactOnly ? name || pseudonym : pseudonym,
    entry.archiveId,
  );

  // Outbox and enquiries addressed to the student's e-mail / phone.
  if (tableExists(db, "outbox")) {
    for (const recipient of [email, phone].filter(Boolean)) {
      db.prepare("DELETE FROM outbox WHERE lower(recipient) = lower(?)").run(recipient);
    }
  }
  if (tableExists(db, "appointment_requests")) {
    for (const [column, value] of [
      ["email", email],
      ["phone", phone],
    ] as const) {
      if (!value) continue;
      db.prepare(
        `UPDATE appointment_requests SET name = ?, phone = '', email = '', message = ''
         WHERE lower(${column}) = lower(?)`,
      ).run(PSEUDONYMISED_REQUEST, value);
    }
  }
  if (tableExists(db, "conversations")) {
    const threads = entry.links.conversations ?? [];
    for (const threadId of threads) {
      db.prepare("DELETE FROM chat_messages WHERE conversation_id = ?").run(threadId);
      db.prepare("DELETE FROM conversations WHERE id = ?").run(threadId);
    }
  }
  if (tableExists(db, "portal_tokens")) {
    db.prepare("DELETE FROM portal_tokens WHERE student_id = ?").run(id);
  }
  let keys: string[] = [];
  if (tableExists(db, "student_files")) {
    keys = db
      .query<{ storage_key: string }, [number]>(
        "SELECT storage_key FROM student_files WHERE student_id = ?",
      )
      .all(id)
      .map((r) => r.storage_key);
    db.prepare("DELETE FROM student_files WHERE student_id = ?").run(id);
  }
  if (!options.contactOnly && name) {
    // Termine: linked at archiving time, or (older archives) by the name.
    const linked = entry.links.calendarEvents ?? [];
    const sameNameActive =
      db
        .query<{ n: number }, [string]>(
          "SELECT count(*) AS n FROM students WHERE trim(first_name || ' ' || last_name) = ?",
        )
        .get(name)!.n > 0;
    const update = db.prepare(
      `UPDATE calendar_events SET
         subtitle = CASE WHEN subtitle = ?1 THEN ?2 ELSE subtitle END,
         title = CASE WHEN title = ?1 THEN ?2 ELSE title END,
         notes = ''
       WHERE id = ?3`,
    );
    for (const eventId of linked) update.run(name, pseudonym, eventId);
    if (!sameNameActive) {
      db.prepare(
        `UPDATE calendar_events SET
           subtitle = CASE WHEN subtitle = ?1 THEN ?2 ELSE subtitle END,
           title = CASE WHEN title = ?1 THEN ?2 ELSE title END,
           notes = ''
         WHERE student_id IS NULL AND (subtitle = ?1 OR title = ?1)`,
      ).run(name, pseudonym);
    }
  }
  return keys;
}

export function recordErasure(
  db: Database,
  entry: ArchivedStudent,
  kind: "frist" | "antrag",
  retainedUntil: string | null,
  accountingDone: boolean,
): void {
  db.prepare(
    `INSERT INTO privacy_erasures (student_id, customer_no, kind, retained_until, accounting_done_at)
     VALUES (?1, ?2, ?3, ?4, CASE WHEN ?5 THEN datetime('now') END)
     ON CONFLICT(student_id) DO UPDATE SET kind = excluded.kind,
       retained_until = excluded.retained_until, erased_at = datetime('now'),
       customer_no = excluded.customer_no,
       accounting_done_at = coalesce(privacy_erasures.accounting_done_at, excluded.accounting_done_at)`,
  ).run(
    entry.studentId,
    text(entry.row.customer_number),
    kind,
    retainedUntil,
    accountingDone ? 1 : 0,
  );
}

/** Carries out exactly `plan` (as returned by planRetention). */
export async function executeRetention(
  db: Database,
  plan: RetentionPlan,
  options: { store: FileStore | null; trigger: RetentionTrigger },
): Promise<RetentionRun> {
  const archived = archivedStudents(db);
  const counts: Partial<Record<RetentionCategory, number>> = {};
  const add = (category: RetentionCategory, n: number) => {
    if (n > 0) counts[category] = (counts[category] ?? 0) + n;
  };
  let keys: string[] = [];

  db.transaction(() => {
    for (const item of plan.items) {
      switch (item.category) {
        case "anfragen": {
          const id = Number(item.id);
          add(
            "anfragen",
            db
              .prepare(
                `UPDATE appointment_requests SET name = ?, phone = '', email = '', message = ''
                 WHERE id = ?`,
              )
              .run(PSEUDONYMISED_REQUEST, id).changes,
          );
          // The Termin created when the request was confirmed carries the name.
          const request = db
            .query<{ event_id: number | null }, [number]>(
              "SELECT * FROM appointment_requests WHERE id = ?",
            )
            .get(id);
          if (request?.event_id) {
            db.prepare(
              `UPDATE calendar_events SET title = 'Terminanfrage (gelöscht)', notes = ''
               WHERE id = ? AND student_id IS NULL`,
            ).run(request.event_id);
          }
          break;
        }
        case "dokumente": {
          // Without a store the bytes could not be removed — keep the row.
          if (!options.store) break;
          const row = db
            .query<{ storage_key: string }, [number]>(
              "SELECT storage_key FROM student_files WHERE id = ?",
            )
            .get(Number(item.id));
          if (!row) break;
          db.prepare("DELETE FROM student_files WHERE id = ?").run(Number(item.id));
          keys.push(row.storage_key);
          add("dokumente", 1);
          break;
        }
        case "chat": {
          const id = Number(item.id);
          const messages = db
            .prepare("DELETE FROM chat_messages WHERE conversation_id = ?")
            .run(id).changes;
          const threads = db
            .prepare("DELETE FROM conversations WHERE id = ?")
            .run(id).changes;
          add("chat", Math.max(messages, threads));
          break;
        }
        case "portal":
          add(
            "portal",
            db.prepare("DELETE FROM portal_tokens WHERE rowid = ?").run(Number(item.id))
              .changes,
          );
          break;
        case "nachrichten":
          add(
            "nachrichten",
            db.prepare("DELETE FROM outbox WHERE id = ?").run(Number(item.id)).changes,
          );
          break;
        case "protokoll":
          add(
            "protokoll",
            db
              .prepare("DELETE FROM audit_log WHERE id <= ? AND method != 'LOESCHLAUF'")
              .run(Number(item.id)).changes,
          );
          break;
        case "ausbildungsnachweis":
          add(
            "ausbildungsnachweis",
            db
              .prepare("DELETE FROM lesson_attestations WHERE student_id = ?")
              .run(Number(item.id)).changes,
          );
          break;
        case "schueler": {
          const entry = archived.get(Number(item.id));
          if (!entry) break;
          keys = keys.concat(anonymiseArchivedStudent(db, entry));
          const customer = text(entry.row.customer_number);
          recordErasure(
            db,
            entry,
            "frist",
            null,
            !customer || latestAccountingDate(db, customer) === null,
          );
          add("schueler", 1);
          break;
        }
        case "buchhaltung": {
          if (item.id.startsWith("sepa-")) {
            add(
              "buchhaltung",
              db
                .prepare("UPDATE sepa_collections SET xml = '' WHERE id = ?")
                .run(Number(item.id.slice(5))).changes,
            );
            break;
          }
          const studentId = Number(item.id);
          const done = erasures(db).get(studentId);
          if (!done) break;
          const pseudonym = studentPseudonym(studentId);
          if (done.customer_no) {
            pseudonymiseExpiredCustomer(db, {
              customerNo: done.customer_no,
              pseudonym,
              today: plan.today,
              months: plan.policy.months.buchhaltung,
            });
          }
          if (tableExists(db, "sepa_mandates")) {
            db.prepare(
              "UPDATE sepa_mandates SET account_holder = ?, iban = '', bic = '' WHERE student_id = ?",
            ).run(pseudonym, studentId);
          }
          db.prepare(
            "UPDATE privacy_erasures SET accounting_done_at = datetime('now') WHERE student_id = ?",
          ).run(studentId);
          add("buchhaltung", 1);
          break;
        }
      }
    }
  })();

  if (options.store && keys.length > 0) await deleteStoredFiles(options.store, keys);
  return recordRun(db, options.trigger, counts);
}

/** Writes the run to retention_runs and the audit log (counts only). */
export function recordRun(
  db: Database,
  trigger: RetentionTrigger,
  counts: Partial<Record<RetentionCategory, number>>,
  path = "/api/admin/retention/run",
): RetentionRun {
  const user = currentUser();
  const row = db
    .query<{ id: number; at: string }, [string, string, string]>(
      "INSERT INTO retention_runs (trigger, counts, user_name) VALUES (?, ?, ?) RETURNING id, at",
    )
    .get(trigger, JSON.stringify(counts), user?.name ?? "")!;
  const query = new URLSearchParams(
    Object.entries(counts).map(([key, n]) => [key, String(n)]),
  ).toString();
  audit(db, {
    user,
    method: "LOESCHLAUF",
    path: `${path}?trigger=${trigger}${query ? `&${query}` : ""}`,
    status: 200,
    ip: "",
  });
  return { id: row.id, at: row.at, trigger, counts, userName: user?.name ?? "" };
}

export function listRuns(db: Database, limit = 20): RetentionRun[] {
  ensureRetentionTables(db);
  return db
    .query<
      {
        id: number;
        at: string;
        trigger: RetentionTrigger;
        counts: string;
        user_name: string;
      },
      [number]
    >("SELECT * FROM retention_runs ORDER BY id DESC LIMIT ?")
    .all(limit)
    .map((row) => ({
      id: row.id,
      at: row.at,
      trigger: row.trigger,
      counts: JSON.parse(row.counts),
      userName: row.user_name,
    }));
}

/* ---------------------------- the job ----------------------------- */

/** Always-on housekeeping: expired sessions and stale invite links. */
export function housekeeping(db: Database, now = Date.now()): number {
  let removed = 0;
  if (tableExists(db, "sessions")) {
    removed += db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now).changes;
  }
  if (tableExists(db, "user_invites")) {
    removed += db
      .prepare("DELETE FROM user_invites WHERE expires_at < ?")
      .run(now - 30 * 24 * 60 * 60 * 1000).changes;
  }
  return removed;
}

/** One daily pass: housekeeping, plus the batch in "automatisch" mode.
 *  Returns the run, or null when nothing was deleted automatically. */
export async function runRetentionJob(
  db: Database,
  options: { store: FileStore | null; now?: Date },
): Promise<RetentionRun | null> {
  ensureRetentionTables(db);
  const now = options.now ?? new Date();
  const today = schoolToday(now);
  if (getSetting(db, LAST_JOB_KEY) === today) return null;
  putSetting(db, LAST_JOB_KEY, today);
  housekeeping(db, now.getTime());
  const policy = getRetentionPolicy(db);
  if (policy.mode !== "automatisch") return null;
  const plan = planRetention(db, { today, policy });
  if (plan.items.length === 0) return null;
  return executeRetention(db, plan, { store: options.store, trigger: "automatisch" });
}

/** Checks hourly, runs once per school day. `tenant` scopes the file
 *  store in multi-tenant mode (TenantFileStore reads it from context). */
export function startRetentionScheduler(
  db: Database,
  options: { store: FileStore | null; tenant?: string; checkEveryMs?: number },
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await requestContext.run({ db, tenant: options.tenant }, async () => {
        const run = await runRetentionJob(db, { store: options.store });
        if (run) console.log(`🧹 Löschlauf: ${JSON.stringify(run.counts)}`);
      });
    } catch (error) {
      console.error("Löschlauf fehlgeschlagen:", error);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, options.checkEveryMs ?? 3_600_000);
  return () => clearInterval(timer);
}

/* ------------------------------ HTTP ------------------------------ */
/* Under /api/admin/ → Inhaber only (OWNER_ONLY in auth.ts).           */

export type RetentionOverview = {
  policy: RetentionPolicy;
  plan: Omit<RetentionPlan, "policy">;
  holds: RetentionHold[];
  runs: RetentionRun[];
};

export function retentionOverview(db: Database): RetentionOverview {
  const { policy, ...plan } = planRetention(db);
  return { policy, plan, holds: listHolds(db), runs: listRuns(db) };
}

export function retentionRoutes(db: Database, store: FileStore) {
  ensureRetentionTables(db);
  return {
    "/api/admin/retention": {
      GET: () => handle(() => json(retentionOverview(db)))(),
    },
    "/api/admin/retention/policy": {
      GET: () => handle(() => json(getRetentionPolicy(db)))(),
      PUT: (req: BunRequest) =>
        handle(async () => json(setRetentionPolicy(db, await req.json())))(),
    },
    "/api/admin/retention/run": {
      POST: (req: BunRequest) =>
        handle(async () => {
          const body = (await req.json().catch(() => ({}))) as { hash?: unknown };
          const plan = planRetention(db);
          if (body.hash !== plan.hash) {
            return err(
              "Die Löschvorschau hat sich inzwischen geändert. Bitte neu laden und erneut bestätigen.",
              409,
            );
          }
          if (plan.items.length === 0) {
            throw new ValidationError("Zurzeit ist nichts zu löschen.");
          }
          return json(await executeRetention(db, plan, { store, trigger: "bestaetigt" }));
        })(),
    },
    "/api/admin/retention/holds": {
      GET: () => handle(() => json(listHolds(db)))(),
      POST: (req: BunRequest) =>
        handle(async () => json(setHold(db, await req.json()), 201))(),
    },
    "/api/admin/retention/holds/:studentId": {
      DELETE: (req: BunRequest<"/api/admin/retention/holds/:studentId">) =>
        handle(() => {
          removeHold(db, Number(req.params.studentId));
          return json({ ok: true });
        })(),
    },
  };
}
