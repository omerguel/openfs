/* ------------------------------------------------------------------ */
/* E-Mail-Postausgang (outbox) — queue, delivery, notification         */
/* settings and HTTP wrappers. Self-contained: ensureMailTables()       */
/* creates the table; mailRoutes() mounts /api/outbox, /api/mail/status */
/* and /api/settings/notifications. Delivery runs out-of-band via       */
/* startMailScheduler() (src/index.ts) — never in tests.                */
/*                                                                     */
/* Status lifecycle: wartend → gesendet | wartend (retry, attempts+1)   */
/* → fehlgeschlagen after MAX_ATTEMPTS. Without SMTP configuration      */
/* queued mails become 'nicht_konfiguriert' (visible/copyable in the   */
/* UI); "Erneut senden" resets any entry to 'wartend'.                  */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import { getCompany } from "./db";
import { ValidationError } from "./engine";
import { handle, json } from "./http";
import { genericMail } from "./mail-templates";
import { smtpConfigFromEnv, type MailTransport, type SmtpConfig } from "./smtp";

export type OutboxStatus =
  | "wartend"
  | "gesendet"
  | "fehlgeschlagen"
  | "nicht_konfiguriert";

export const OUTBOX_STATUSES: OutboxStatus[] = [
  "wartend",
  "gesendet",
  "fehlgeschlagen",
  "nicht_konfiguriert",
];

export type MailKind =
  | "request_confirmed"
  | "request_declined"
  | "lesson_reminder"
  | "lesson_cancelled"
  | "portal_link"
  | "generic";

export type OutboxEntry = {
  id: number;
  recipient: string;
  subject: string;
  bodyText: string;
  kind: MailKind;
  relatedType: string | null;
  relatedId: number | null;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
};

export type QueueMailInput = {
  recipient: string;
  subject: string;
  bodyText: string;
  kind: MailKind;
  relatedType?: string | null;
  relatedId?: number | null;
};

export type NotificationSettings = {
  /** Bestätigung/Absage bei Terminanfragen. */
  appointmentMails: boolean;
  /** Erinnerung am Vortag. */
  lessonReminders: boolean;
  /** Absage-Mail, wenn ein Termin gestrichen wird (notifyLessonCancelled). */
  lessonCancellations: boolean;
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  appointmentMails: true,
  lessonReminders: true,
  lessonCancellations: true,
};

export const MAX_ATTEMPTS = 3;

/* ----------------------------- schema ----------------------------- */

/* settings is part of db.ts; repeated here (IF NOT EXISTS) so the module
   also works on the minimal schemas used by unit tests. */
const DDL = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  kind TEXT NOT NULL,
  related_type TEXT,
  related_id INTEGER,
  status TEXT NOT NULL DEFAULT 'wartend'
    CHECK (status IN ('wartend','gesendet','fehlgeschlagen','nicht_konfiguriert')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);
CREATE INDEX IF NOT EXISTS idx_outbox_related ON outbox(related_type, related_id);
-- One reminder per calendar event, ever (queueLessonReminders is idempotent).
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_reminder_once
  ON outbox(related_type, related_id) WHERE kind = 'lesson_reminder';
`;

const ensured = new WeakSet<Database>();

export function ensureMailTables(db: Database): void {
  if (ensured.has(db)) return;
  db.exec(DDL);
  ensured.add(db);
}

/* ------------------------------ reads ----------------------------- */

type OutboxRow = {
  id: number;
  recipient: string;
  subject: string;
  body_text: string;
  kind: MailKind;
  related_type: string | null;
  related_id: number | null;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

const toEntry = (row: OutboxRow): OutboxEntry => ({
  id: row.id,
  recipient: row.recipient,
  subject: row.subject,
  bodyText: row.body_text,
  kind: row.kind,
  relatedType: row.related_type,
  relatedId: row.related_id,
  status: row.status,
  attempts: row.attempts,
  lastError: row.last_error,
  createdAt: row.created_at,
  sentAt: row.sent_at,
});

const SELECT = `SELECT id, recipient, subject, body_text, kind, related_type, related_id,
  status, attempts, last_error, created_at, sent_at FROM outbox`;

export function listOutbox(
  db: Database,
  filter: { status?: OutboxStatus; limit?: number } = {},
): OutboxEntry[] {
  ensureMailTables(db);
  const limit = Math.min(Math.max(filter.limit ?? 500, 1), 2000);
  if (filter.status) {
    return db
      .query<OutboxRow, [string, number]>(
        `${SELECT} WHERE status = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(filter.status, limit)
      .map(toEntry);
  }
  return db
    .query<OutboxRow, [number]>(`${SELECT} ORDER BY id DESC LIMIT ?`)
    .all(limit)
    .map(toEntry);
}

export function getOutboxEntry(db: Database, id: number): OutboxEntry {
  ensureMailTables(db);
  const row = db.query<OutboxRow, [number]>(`${SELECT} WHERE id = ?`).get(id);
  if (!row) throw new ValidationError("Nachricht nicht gefunden.");
  return toEntry(row);
}

/* ------------------------------ writes ---------------------------- */

const EMAIL_PATTERN = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const SUBJECT_MAX_LEN = 200;
const BODY_MAX_LEN = 20_000;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/** Inserts a 'wartend' mail. With `onceKey` semantics handled by the
 *  unique reminder index, a duplicate reminder returns null. */
export function queueMail(db: Database, input: QueueMailInput): OutboxEntry | null {
  ensureMailTables(db);
  const recipient = typeof input.recipient === "string" ? input.recipient.trim() : "";
  if (!isValidEmail(recipient)) {
    throw new ValidationError("Bitte eine gültige E-Mail-Adresse angeben.");
  }
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  if (!subject) throw new ValidationError("Betreff ist ein Pflichtfeld.");
  if (subject.length > SUBJECT_MAX_LEN) {
    throw new ValidationError(
      `Betreff darf maximal ${SUBJECT_MAX_LEN} Zeichen lang sein.`,
    );
  }
  const body = typeof input.bodyText === "string" ? input.bodyText : "";
  if (!body.trim()) throw new ValidationError("Nachricht darf nicht leer sein.");
  if (body.length > BODY_MAX_LEN) {
    throw new ValidationError(
      `Nachricht darf maximal ${BODY_MAX_LEN} Zeichen lang sein.`,
    );
  }

  const row = db
    .query<
      { id: number },
      [string, string, string, string, string | null, number | null]
    >(
      `INSERT OR IGNORE INTO outbox (recipient, subject, body_text, kind, related_type, related_id)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      recipient,
      subject,
      body,
      input.kind,
      input.relatedType ?? null,
      input.relatedId ?? null,
    );
  return row ? getOutboxEntry(db, row.id) : null;
}

/** "Erneut senden": back to 'wartend' with a fresh attempt budget. */
export function retryOutboxEntry(db: Database, id: number): OutboxEntry {
  const entry = getOutboxEntry(db, id);
  if (entry.status === "wartend") {
    throw new ValidationError("Nachricht wartet bereits auf den Versand.");
  }
  db.prepare(
    "UPDATE outbox SET status = 'wartend', attempts = 0, last_error = NULL WHERE id = ?",
  ).run(id);
  return getOutboxEntry(db, id);
}

/* ----------------------------- delivery --------------------------- */

export type DeliveryResult = {
  sent: number;
  failed: number;
  retrying: number;
  notConfigured: number;
};

const delivering = new WeakSet<Database>();

/** Sends every 'wartend' mail through `transport`. With transport = null
 *  (no SMTP configured) they are marked 'nicht_konfiguriert'. Re-entrant
 *  calls for the same DB are skipped so a slow run never double-sends. */
export async function deliverPending(
  db: Database,
  transport: MailTransport | null,
  options: { limit?: number; maxAttempts?: number } = {},
): Promise<DeliveryResult> {
  ensureMailTables(db);
  const result: DeliveryResult = { sent: 0, failed: 0, retrying: 0, notConfigured: 0 };
  if (delivering.has(db)) return result;
  delivering.add(db);
  try {
    if (!transport) {
      result.notConfigured = db
        .prepare(
          "UPDATE outbox SET status = 'nicht_konfiguriert' WHERE status = 'wartend'",
        )
        .run().changes;
      return result;
    }

    const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    const pending = db
      .query<OutboxRow, [number]>(
        `${SELECT} WHERE status = 'wartend' ORDER BY id LIMIT ?`,
      )
      .all(options.limit ?? 50);

    for (const row of pending) {
      try {
        await transport.send({
          to: row.recipient,
          subject: row.subject,
          text: row.body_text,
        });
        db.prepare(
          `UPDATE outbox SET status = 'gesendet', attempts = attempts + 1,
             last_error = NULL, sent_at = datetime('now') WHERE id = ?`,
        ).run(row.id);
        result.sent += 1;
      } catch (error) {
        const attempts = row.attempts + 1;
        const message = (error instanceof Error ? error.message : String(error)).slice(
          0,
          500,
        );
        const status: OutboxStatus =
          attempts >= maxAttempts ? "fehlgeschlagen" : "wartend";
        db.prepare(
          "UPDATE outbox SET status = ?, attempts = ?, last_error = ? WHERE id = ?",
        ).run(status, attempts, message, row.id);
        if (status === "fehlgeschlagen") result.failed += 1;
        else result.retrying += 1;
      }
    }
    return result;
  } finally {
    delivering.delete(db);
  }
}

/* ----------------------------- settings --------------------------- */

export function getNotificationSettings(db: Database): NotificationSettings {
  ensureMailTables(db);
  const row = db
    .query<{ value: string }, []>(
      "SELECT value FROM settings WHERE key = 'notifications'",
    )
    .get();
  let stored: Partial<NotificationSettings> = {};
  try {
    stored = row ? (JSON.parse(row.value) as Partial<NotificationSettings>) : {};
  } catch {
    stored = {};
  }
  const settings = { ...DEFAULT_NOTIFICATION_SETTINGS };
  for (const key of Object.keys(settings) as (keyof NotificationSettings)[]) {
    if (typeof stored[key] === "boolean") settings[key] = stored[key];
  }
  return settings;
}

export function setNotificationSettings(
  db: Database,
  input: Partial<NotificationSettings>,
): NotificationSettings {
  if (typeof input !== "object" || input === null) {
    throw new ValidationError("Ungültige Einstellungen.");
  }
  const next = getNotificationSettings(db);
  for (const key of Object.keys(
    DEFAULT_NOTIFICATION_SETTINGS,
  ) as (keyof NotificationSettings)[]) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      throw new ValidationError(`Feld '${key}' muss ein Wahrheitswert sein.`);
    }
    next[key] = value;
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('notifications', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(JSON.stringify(next));
  return next;
}

/** School profile for signatures — tolerant of bare test schemas. */
export function mailSchool(db: Database) {
  ensureMailTables(db);
  const company = getCompany(db);
  return {
    name: company.name,
    address: company.address,
    phone: company.phone,
    email: company.email,
  };
}

/* ----------------------------- scheduler -------------------------- */

export type MailSchedulerOptions = {
  transport: MailTransport | null;
  intervalMs?: number;
  /** Extra periodic work before delivery (e.g. queueing reminders). */
  beforeDelivery?: (now: Date) => void;
};

/** Runs `beforeDelivery` + deliverPending now and then every intervalMs.
 *  Returns a stop function. Used by src/index.ts only. */
export function startMailScheduler(
  db: Database,
  options: MailSchedulerOptions,
): () => void {
  const tick = async () => {
    try {
      options.beforeDelivery?.(new Date());
      await deliverPending(db, options.transport);
    } catch (error) {
      console.error("E-Mail-Versand fehlgeschlagen:", error);
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), options.intervalMs ?? 60_000);
  return () => clearInterval(timer);
}

/* ------------------------------ routes ---------------------------- */

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError("Ungültige Nachrichten-ID.");
  }
  return id;
}

export type MailRouteOptions = {
  /** SMTP configuration; defaults to the SMTP_* environment variables. */
  config?: SmtpConfig | null;
};

export function mailRoutes(db: Database, options: MailRouteOptions = {}) {
  ensureMailTables(db);
  const config = options.config === undefined ? smtpConfigFromEnv() : options.config;

  return {
    "/api/mail/status": {
      GET: () =>
        handle(() => json({ configured: config !== null, from: config?.from ?? "" }))(),
    },

    "/api/outbox": {
      GET: (req: BunRequest) =>
        handle(() => {
          const status = new URL(req.url).searchParams.get("status");
          if (status && !OUTBOX_STATUSES.includes(status as OutboxStatus)) {
            throw new ValidationError("Ungültiger Status-Filter.");
          }
          return json({
            items: listOutbox(db, {
              status: (status as OutboxStatus | null) ?? undefined,
            }),
          });
        })(),
      /* Free-text mail ("Neue E-Mail"); signature appended server-side. */
      POST: (req: BunRequest) =>
        handle(async () => {
          const body = (await req.json().catch(() => ({}))) as {
            recipient?: unknown;
            subject?: unknown;
            body?: unknown;
            studentId?: unknown;
          };
          const subject = typeof body.subject === "string" ? body.subject : "";
          const text = typeof body.body === "string" ? body.body : "";
          if (!subject.trim()) throw new ValidationError("Betreff ist ein Pflichtfeld.");
          if (!text.trim()) throw new ValidationError("Nachricht darf nicht leer sein.");
          const studentId =
            typeof body.studentId === "number" && Number.isInteger(body.studentId)
              ? body.studentId
              : null;
          const mail = genericMail({ subject, body: text }, mailSchool(db));
          const entry = queueMail(db, {
            recipient: typeof body.recipient === "string" ? body.recipient : "",
            subject: mail.subject,
            bodyText: mail.body,
            kind: "generic",
            relatedType: studentId !== null ? "student" : null,
            relatedId: studentId,
          });
          return json(entry, 201);
        })(),
    },

    "/api/outbox/:id/retry": {
      POST: (req: BunRequest<"/api/outbox/:id/retry">) =>
        handle(() => json(retryOutboxEntry(db, parseId(req.params.id))))(),
    },

    "/api/settings/notifications": {
      GET: () => handle(() => json(getNotificationSettings(db)))(),
      PUT: (req: BunRequest) =>
        handle(async () =>
          json(
            setNotificationSettings(
              db,
              (await req.json().catch(() => null)) as Partial<NotificationSettings>,
            ),
          ),
        )(),
    },
  };
}
