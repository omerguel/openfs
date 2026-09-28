/* ------------------------------------------------------------------ */
/* Schülerportal — per-student secret access link + public read-mostly */
/* endpoints. Self-contained: ensurePortalTables() creates the table,  */
/* portalRoutes() mounts both the staff endpoints                      */
/* (/api/students/:id/portal-link…) and the public ones                */
/* (/api/portal/:token…).                                              */
/*                                                                     */
/* Security model: the token (32 random bytes, base64url) is the only  */
/* credential. Public handlers resolve it to exactly one student id    */
/* and only ever query by that id; unknown and revoked tokens get the  */
/* same generic 404. All public handlers are rate-limited per IP.      */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import { tableExists } from "./archive";
import {
  createConversation,
  ensureChatTables,
  findStudentConversation,
  listMessages,
  sendStudentMessage,
  type ChatSender,
} from "./chat";
import { getCompany } from "./db";
import { listStudentBalances, ValidationError } from "./engine";
import {
  clientIp,
  createRateLimiter,
  handle,
  json,
  type RateLimit,
  type RequestIPSource,
} from "./http";
import { isValidEmail, mailSchool, queueMail, type OutboxEntry } from "./mail";
import { portalLinkMail } from "./mail-templates";
import { localIsoDate } from "./notifications";
import { instructorNameSql } from "./refs";

/* ----------------------------- schema ----------------------------- */

const DDL = `
CREATE TABLE IF NOT EXISTS portal_tokens (
  token TEXT PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_student ON portal_tokens(student_id);
`;

export function ensurePortalTables(db: Database): void {
  db.exec(DDL);
}

/* ----------------------------- tokens ----------------------------- */

export type PortalLink = { token: string; createdAt: string };

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generatePortalToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function requireStudent(db: Database, studentId: number) {
  const row = db
    .query<
      {
        id: number;
        first_name: string;
        last_name: string;
        email: string;
        classes: string;
        customer_number: string;
      },
      [number]
    >(
      "SELECT id, first_name, last_name, email, classes, customer_number FROM students WHERE id = ?",
    )
    .get(studentId);
  if (!row) throw new ValidationError("Fahrschüler/in nicht gefunden.");
  return row;
}

export function getActivePortalLink(db: Database, studentId: number): PortalLink | null {
  ensurePortalTables(db);
  const row = db
    .query<{ token: string; created_at: string }, [number]>(
      `SELECT token, created_at FROM portal_tokens
       WHERE student_id = ? AND revoked_at IS NULL
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(studentId);
  return row ? { token: row.token, createdAt: row.created_at } : null;
}

/** Creates a fresh link and revokes every older one (rotation). */
export function createPortalLink(db: Database, studentId: number): PortalLink {
  ensurePortalTables(db);
  requireStudent(db, studentId);
  const token = generatePortalToken();
  const run = db.transaction(() => {
    db.prepare(
      `UPDATE portal_tokens SET revoked_at = datetime('now')
       WHERE student_id = ? AND revoked_at IS NULL`,
    ).run(studentId);
    db.prepare("INSERT INTO portal_tokens (token, student_id) VALUES (?, ?)").run(
      token,
      studentId,
    );
  });
  run();
  return getActivePortalLink(db, studentId)!;
}

/** Revokes all active links; returns how many were revoked. */
export function revokePortalLinks(db: Database, studentId: number): number {
  ensurePortalTables(db);
  requireStudent(db, studentId);
  return db
    .prepare(
      `UPDATE portal_tokens SET revoked_at = datetime('now')
       WHERE student_id = ? AND revoked_at IS NULL`,
    )
    .run(studentId).changes;
}

/** token → student id, or null for malformed/unknown/revoked tokens. */
export function resolvePortalToken(db: Database, token: string): number | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  ensurePortalTables(db);
  const row = db
    .query<{ student_id: number }, [string]>(
      "SELECT student_id FROM portal_tokens WHERE token = ? AND revoked_at IS NULL",
    )
    .get(token);
  return row?.student_id ?? null;
}

/* ----------------------------- overview --------------------------- */

export type PortalLesson = {
  date: string;
  start: string;
  end: string;
  type: string;
  title: string;
  instructor: string;
};

export type PortalOverview = {
  student: { firstName: string; lastName: string; classes: string };
  school: { name: string; phone: string; email: string };
  upcomingLessons: PortalLesson[];
  pastLessons: PortalLesson[];
  /** Guthabenkonto: positive = credit, negative = open amount; null when
   *  the ledger could not be read. */
  balanceCents: number | null;
  attestationCount: number;
};

const UPCOMING_LIMIT = 20;
const PAST_LIMIT = 30;

function listStudentLessons(db: Database, studentId: number, now: Date) {
  const today = localIsoDate(now);
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;
  const select = `SELECT ce.date, ce.start, ce."end" AS "end", ce.type, ce.title,
      ${instructorNameSql("ce")} AS instructor
    FROM calendar_events ce
    WHERE ce.student_id = ? AND ce.tentative = 0`;
  // Tentative (vorläufige) slots are not shown until they are confirmed.
  const upcoming = db
    .query<PortalLesson, [number, string, string, string, number]>(
      `${select} AND (ce.date > ? OR (ce.date = ? AND ce."end" > ?))
       ORDER BY ce.date, ce.start LIMIT ?`,
    )
    .all(studentId, today, today, time, UPCOMING_LIMIT);
  const past = db
    .query<PortalLesson, [number, string, string, string, number]>(
      `${select} AND (ce.date < ? OR (ce.date = ? AND ce."end" <= ?))
       ORDER BY ce.date DESC, ce.start DESC LIMIT ?`,
    )
    .all(studentId, today, today, time, PAST_LIMIT);
  return { upcoming, past };
}

function studentBalanceCents(db: Database, customerNumber: string): number | null {
  if (!customerNumber) return 0;
  try {
    return (
      listStudentBalances(db).find((row) => row.customerNo === customerNumber)
        ?.balanceCents ?? 0
    );
  } catch {
    return null;
  }
}

export function getPortalOverview(
  db: Database,
  studentId: number,
  now = new Date(),
): PortalOverview {
  const student = requireStudent(db, studentId);
  const company = getCompany(db);
  const { upcoming, past } = listStudentLessons(db, studentId, now);
  const attestationCount = tableExists(db, "lesson_attestations")
    ? db
        .query<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM lesson_attestations WHERE student_id = ?",
        )
        .get(studentId)!.n
    : 0;
  return {
    student: {
      firstName: student.first_name,
      lastName: student.last_name,
      classes: student.classes,
    },
    school: { name: company.name, phone: company.phone, email: company.email },
    upcomingLessons: upcoming,
    pastLessons: past,
    balanceCents: studentBalanceCents(db, student.customer_number),
    attestationCount,
  };
}

/* ----------------------------- messages --------------------------- */

export type PortalMessage = {
  id: number;
  sender: ChatSender;
  text: string;
  sentAt: string;
};

const toPortalMessage = (message: PortalMessage): PortalMessage => ({
  id: message.id,
  sender: message.sender,
  text: message.text,
  sentAt: message.sentAt,
});

/** The student's own thread; [] until the first message exists. */
export function listPortalMessages(db: Database, studentId: number): PortalMessage[] {
  ensureChatTables(db);
  const conversation = findStudentConversation(db, studentId);
  return conversation ? listMessages(db, conversation.id).map(toPortalMessage) : [];
}

/** Posts as 'schueler', creating the thread on first contact. */
export function postPortalMessage(
  db: Database,
  studentId: number,
  text: unknown,
): PortalMessage {
  ensureChatTables(db);
  const student = requireStudent(db, studentId);
  const run = db.transaction(() => {
    const conversation =
      findStudentConversation(db, studentId) ??
      createConversation(db, {
        student_id: studentId,
        student_name: `${student.first_name} ${student.last_name}`.trim(),
      });
    return sendStudentMessage(db, conversation.id, text);
  });
  return toPortalMessage(run());
}

/* ----------------------------- e-mail ----------------------------- */

/** Queues the portal link to the student's e-mail (creating a link when
 *  none is active). `baseUrl` is the app origin, e.g. from the request. */
export function sendPortalLinkMail(
  db: Database,
  studentId: number,
  baseUrl: string,
): OutboxEntry {
  const student = requireStudent(db, studentId);
  if (!isValidEmail(student.email)) {
    throw new ValidationError(
      "Für diese/n Fahrschüler/in ist keine E-Mail-Adresse hinterlegt.",
    );
  }
  let origin: string;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    origin = parsed.origin;
  } catch {
    throw new ValidationError("Ungültige Basis-URL für den Portal-Link.");
  }
  const link = getActivePortalLink(db, studentId) ?? createPortalLink(db, studentId);
  const mail = portalLinkMail(
    { firstName: student.first_name, url: `${origin}/portal/${link.token}` },
    mailSchool(db),
  );
  return queueMail(db, {
    recipient: student.email,
    subject: mail.subject,
    bodyText: mail.body,
    kind: "portal_link",
    relatedType: "student",
    relatedId: studentId,
  })!;
}

/* ------------------------------ routes ---------------------------- */

const NOT_FOUND = "Dieser Link ist ungültig oder wurde widerrufen.";
const TOO_MANY = "Zu viele Anfragen. Bitte später erneut versuchen.";

export type PortalRouteOptions = {
  /** Per-IP limits for the public endpoints; false disables (tests). */
  rateLimit?: { read: RateLimit; write: RateLimit } | false;
};

const DEFAULT_LIMITS = {
  // Polling every 15 s is 4 requests/minute per open tab.
  read: { max: 120, windowMs: 60_000 },
  write: { max: 30, windowMs: 10 * 60_000 },
};

function parseStudentId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError("Ungültige Fahrschüler-ID.");
  }
  return id;
}

/* Public responses must not be cached by shared caches or leak the
   token-bearing URL via the referrer. */
function publicJson(data: unknown, status = 200): Response {
  const response = json(data, status);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export function portalRoutes(db: Database, options: PortalRouteOptions = {}) {
  ensurePortalTables(db);
  ensureChatTables(db);

  const limits = options.rateLimit === undefined ? DEFAULT_LIMITS : options.rateLimit;
  const readLimited = createRateLimiter(limits ? limits.read : false);
  const writeLimited = createRateLimiter(limits ? limits.write : false);

  /* Wraps a public handler: rate limit → token → handler. Errors never
     reveal whether a token existed. */
  const publicHandler =
    <P extends string>(
      limited: (key: string) => boolean,
      fn: (studentId: number, req: BunRequest<P>) => unknown | Promise<unknown>,
      status = 200,
    ) =>
    (req: BunRequest<P>, server?: RequestIPSource) =>
      handle(async () => {
        if (limited(clientIp(req, server))) return publicJson({ error: TOO_MANY }, 429);
        const token = (req.params as { token?: string }).token ?? "";
        const studentId = resolvePortalToken(db, token);
        if (studentId === null) return publicJson({ error: NOT_FOUND }, 404);
        return publicJson(await fn(studentId, req), status);
      })();

  return {
    /* ---- staff ---- */
    "/api/students/:id/portal-link": {
      GET: (req: BunRequest<"/api/students/:id/portal-link">) =>
        handle(() => {
          const id = parseStudentId(req.params.id);
          requireStudent(db, id);
          return json({ link: getActivePortalLink(db, id) });
        })(),
      POST: (req: BunRequest<"/api/students/:id/portal-link">) =>
        handle(() => json(createPortalLink(db, parseStudentId(req.params.id)), 201))(),
      DELETE: (req: BunRequest<"/api/students/:id/portal-link">) =>
        handle(() =>
          json({
            ok: true,
            revoked: revokePortalLinks(db, parseStudentId(req.params.id)),
          }),
        )(),
    },

    "/api/students/:id/portal-link/email": {
      POST: (req: BunRequest<"/api/students/:id/portal-link/email">) =>
        handle(() => {
          // Browser fetches carry Origin; fall back to the request URL.
          const baseUrl = req.headers.get("origin") ?? new URL(req.url).origin;
          return json(
            sendPortalLinkMail(db, parseStudentId(req.params.id), baseUrl),
            201,
          );
        })(),
    },

    /* ---- public (token-gated) ---- */
    "/api/portal/:token": {
      GET: publicHandler<"/api/portal/:token">(readLimited, (studentId) =>
        getPortalOverview(db, studentId),
      ),
    },

    "/api/portal/:token/messages": {
      GET: publicHandler<"/api/portal/:token/messages">(readLimited, (studentId) => ({
        messages: listPortalMessages(db, studentId),
      })),
      POST: publicHandler<"/api/portal/:token/messages">(
        writeLimited,
        async (studentId, req) => {
          const body = (await req.json().catch(() => ({}))) as { text?: unknown };
          return postPortalMessage(db, studentId, body.text);
        },
        201,
      ),
    },
  };
}
