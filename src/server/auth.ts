/* ------------------------------------------------------------------ */
/* Anmeldung, Rollen, Sitzungen, Protokoll.                             */
/*                                                                     */
/*  - users: per school (per tenant DB), password hashed with          */
/*    Bun.password (argon2id). Roles: inhaber (everything), buero      */
/*    (everything but user admin, backups, raw DB export), fahrlehrer  */
/*    (calendar, Nachweise, Theorie-Anwesenheit, Chat; no finances).   */
/*  - sessions: random 32-byte token in an HttpOnly SameSite=Strict    */
/*    cookie; only its SHA-256 is stored, so a leaked DB/backup does   */
/*    not leak live sessions. Sliding expiry (7 days) capped by an     */
/*    absolute lifetime (30 days), instant revocation.                 */
/*  - audit_log: every non-GET API call with user, path and status.    */
/*                                                                     */
/* protectApiRoutes() wraps every handler of the routes object built   */
/* in app-routes.ts — new endpoints are protected by default; public   */
/* ones must be listed in PUBLIC_ROUTES explicitly.                    */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import { BusyError, ValidationError } from "./errors";
import {
  clientIp,
  createFailureLimiter,
  err,
  handle,
  json,
  type RateLimit,
  type RequestIPSource,
} from "./http";
import { requestContext, type Role, type SessionUser } from "./request-context";
import {
  checkContentType,
  limitBody,
  MAX_REQUEST_BODY_BYTES,
  PUBLIC_BODY_LIMIT_BYTES,
} from "./request-guards";
import { immediateTransaction } from "./sqlite";

export type { Role, SessionUser } from "./request-context";

export const ROLES: Role[] = ["inhaber", "buero", "fahrlehrer"];

export const ROLE_LABELS: Record<Role, string> = {
  inhaber: "Inhaber/in",
  buero: "Büro",
  fahrlehrer: "Fahrlehrer/in",
};

export const SESSION_COOKIE = "openfs_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** No session lives longer than this, however active it is. */
export const SESSION_MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
/** RFC 5321 limit — longer "addresses" are never looked up or logged. */
export const MAX_EMAIL_LENGTH = 254;
const MAX_LOGIN_PASSWORD_LENGTH = 1024;
const SESSION_TOUCH_MS = 60 * 1000;
export const MIN_PASSWORD_LENGTH = 10;

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('inhaber', 'buero', 'fahrlehrer')),
  instructor_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER,
  user_email TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  ip TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at);

-- One-time "set your password" links (invites.ts); only the hash is kept.
CREATE TABLE IF NOT EXISTS user_invites (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at INTEGER NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_invites_user ON user_invites(user_id);
`;

export function ensureAuthTables(db: Database) {
  db.exec(DDL);
}

/* ------------------------------------------------------------------ */
/* users                                                               */
/* ------------------------------------------------------------------ */

type UserRow = {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
  instructor_id: number | null;
  active: number;
  created_at: string;
  last_login_at: string | null;
};

export type UserRecord = SessionUser & {
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

const toUser = (row: UserRow): UserRecord => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  instructorId: row.instructor_id,
  active: row.active === 1,
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at,
});

export function countUsers(db: Database): number {
  return db.query<{ n: number }, []>("SELECT count(*) AS n FROM users").get()!.n;
}

export function listUsers(db: Database): UserRecord[] {
  return db
    .query<UserRow, []>("SELECT * FROM users ORDER BY active DESC, name")
    .all()
    .map(toUser);
}

function getUserRow(db: Database, id: number): UserRow {
  const row = db.query<UserRow, [number]>("SELECT * FROM users WHERE id = ?").get(id);
  if (!row) throw new ValidationError("Benutzer nicht gefunden.");
  return row;
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function requireEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!EMAIL.test(email))
    throw new ValidationError("Bitte eine gültige E-Mail-Adresse angeben.");
  return email;
}

function requirePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(
      `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`,
    );
  }
  if (value.length > 200) throw new ValidationError("Das Passwort ist zu lang.");
  return value;
}

function requireRole(value: unknown): Role {
  if (!ROLES.includes(value as Role)) throw new ValidationError("Ungültige Rolle.");
  return value as Role;
}

function requireInstructorId(db: Database, value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const id = Number(value);
  if (
    !Number.isInteger(id) ||
    !db.query("SELECT 1 FROM instructors WHERE id = ?").get(id)
  ) {
    throw new ValidationError("Fahrlehrer/in nicht gefunden.");
  }
  return id;
}

export type NewUserInput = {
  email?: unknown;
  name?: unknown;
  password?: unknown;
  role?: unknown;
  instructorId?: unknown;
  /** true: no password yet — the user sets it via an Einladungslink. */
  invite?: unknown;
};

export type PreparedUser = {
  email: string;
  name: string;
  role: Role;
  hash: string;
  instructorId: unknown;
};

/** Validates a new account and hashes its password (the slow part), so
 *  the insert itself can run synchronously inside a transaction. */
export async function prepareUser(input: NewUserInput): Promise<PreparedUser> {
  const email = requireEmail(input.email);
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new ValidationError("Name ist erforderlich.");
  const invited = input.invite === true && !input.password;
  const password = invited ? null : requirePassword(input.password);
  const role = requireRole(input.role);
  // Invited users get an unguessable placeholder until they accept.
  const hash = await hashPassword(password ?? newToken());
  return { email, name, role, hash, instructorId: input.instructorId };
}

export async function createUser(
  db: Database,
  input: NewUserInput,
): Promise<UserRecord> {
  requireInstructorId(db, input.instructorId);
  return insertUser(db, await prepareUser(input));
}

/** Synchronous insert of a prepared account (see prepareUser). */
export function insertUser(db: Database, prepared: PreparedUser): UserRecord {
  const { email, name, role, hash } = prepared;
  const instructorId = requireInstructorId(db, prepared.instructorId);
  try {
    const row = db
      .query<{ id: number }, [string, string, string, Role, number | null]>(
        `INSERT INTO users (email, name, password_hash, role, instructor_id)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(email, name, hash, role, instructorId)!;
    return toUser(getUserRow(db, row.id));
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      throw new ValidationError("Diese E-Mail-Adresse ist bereits vergeben.");
    }
    throw error;
  }
}

/* The last active Inhaber can never be demoted or deactivated — the
   school would lock itself out of user management. */
function assertKeepsAnOwner(
  db: Database,
  id: number,
  nextRole: Role,
  nextActive: boolean,
) {
  if (nextRole === "inhaber" && nextActive) return;
  const others = db
    .query<{ n: number }, [number]>(
      "SELECT count(*) AS n FROM users WHERE role = 'inhaber' AND active = 1 AND id != ?",
    )
    .get(id)!.n;
  if (others === 0) {
    throw new ValidationError(
      "Es muss mindestens ein aktiver Inhaber-Zugang bestehen bleiben.",
    );
  }
}

export async function updateUser(
  db: Database,
  id: number,
  input: {
    name?: unknown;
    role?: unknown;
    active?: unknown;
    instructorId?: unknown;
    password?: unknown;
  },
): Promise<UserRecord> {
  const current = getUserRow(db, id);
  const name =
    input.name === undefined
      ? current.name
      : typeof input.name === "string" && input.name.trim()
        ? input.name.trim()
        : (() => {
            throw new ValidationError("Name ist erforderlich.");
          })();
  const role = input.role === undefined ? current.role : requireRole(input.role);
  const active =
    input.active === undefined ? current.active === 1 : input.active === true;
  const instructorId =
    input.instructorId === undefined
      ? current.instructor_id
      : requireInstructorId(db, input.instructorId);
  assertKeepsAnOwner(db, id, role, active);
  const hash =
    input.password === undefined
      ? current.password_hash
      : await hashPassword(requirePassword(input.password));
  const write = db.transaction(() => {
    db.prepare(
      `UPDATE users SET name = ?, role = ?, active = ?, instructor_id = ?, password_hash = ?
       WHERE id = ?`,
    ).run(name, role, active ? 1 : 0, instructorId, hash, id);
    // Role, deactivation or a password reset end all running sessions.
    if (role !== current.role || !active || hash !== current.password_hash) {
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    }
  });
  write();
  return toUser(getUserRow(db, id));
}

/** Sets an already hashed password and ends the user's sessions —
 *  synchronous, for use inside a transaction (invites.ts). */
export function setPasswordHash(db: Database, id: number, hash: string): UserRecord {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  return toUser(getUserRow(db, id));
}

/* ------------------------------------------------------------------ */
/* password hashing: argon2id with bounded concurrency                 */
/* ------------------------------------------------------------------ */

/* Every argon2id run costs ~64 MB and noticeable CPU. The public
   endpoints (login, setup, invite) must not let a burst of requests run
   hundreds at once: at most ARGON_CONCURRENCY run in parallel, up to
   ARGON_QUEUE wait, everything beyond is answered with 503. */
const ARGON_CONCURRENCY = 4;
const ARGON_QUEUE = 64;
let argonActive = 0;
const argonWaiting: (() => void)[] = [];

export async function withArgonSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (argonActive >= ARGON_CONCURRENCY) {
    if (argonWaiting.length >= ARGON_QUEUE) {
      throw new BusyError("Der Server ist ausgelastet. Bitte gleich erneut versuchen.");
    }
    // The finishing run hands its slot over (argonActive stays the same).
    await new Promise<void>((resolve) => argonWaiting.push(resolve));
  } else {
    argonActive += 1;
  }
  try {
    return await fn();
  } finally {
    const next = argonWaiting.shift();
    if (next) next();
    else argonActive -= 1;
  }
}

export function hashPassword(password: string): Promise<string> {
  return withArgonSlot(() => Bun.password.hash(password));
}

function verifyPassword(password: string, hash: string): Promise<boolean> {
  return withArgonSlot(() => Bun.password.verify(password, hash));
}

/* ------------------------------------------------------------------ */
/* sessions                                                            */
/* ------------------------------------------------------------------ */

function sha256(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

export function createSession(
  db: Database,
  userId: number,
  meta: { ip?: string; userAgent?: string } = {},
  now = Date.now(),
): string {
  const token = newToken();
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at, last_seen_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    sha256(token),
    userId,
    now + SESSION_TTL_MS,
    now,
    meta.ip ?? "",
    (meta.userAgent ?? "").slice(0, 300),
  );
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userId);
  // Housekeeping: drop expired sessions of everyone.
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  return token;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return null; // malformed %-escape: no session, never a 500
    }
  }
  return null;
}

export function sessionUser(db: Database, token: string | null, now = Date.now()) {
  if (!token) return null;
  const hash = sha256(token);
  const row = db
    .query<
      UserRow & { expires_at: number; last_seen_at: number; session_created_at: string },
      [string]
    >(
      `SELECT u.*, s.expires_at, s.last_seen_at, s.created_at AS session_created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND u.active = 1`,
    )
    .get(hash);
  if (!row || row.expires_at < now) return null;
  // Absolute lifetime: sliding renewals never keep a session past it.
  const createdAt = Date.parse(`${row.session_created_at.replace(" ", "T")}Z`);
  const deadline = Number.isNaN(createdAt)
    ? Number.POSITIVE_INFINITY
    : createdAt + SESSION_MAX_LIFETIME_MS;
  if (now >= deadline) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
    return null;
  }
  if (now - row.last_seen_at > SESSION_TOUCH_MS) {
    db.prepare(
      "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?",
    ).run(now, Math.min(now + SESSION_TTL_MS, deadline), hash);
  }
  const user = toUser(row);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    instructorId: user.instructorId,
  } satisfies SessionUser;
}

export function deleteSession(db: Database, token: string | null) {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

function isHttps(req: Request): boolean {
  return (
    new URL(req.url).protocol === "https:" ||
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https"
  );
}

export function sessionCookie(
  req: Request,
  token: string,
  maxAgeSeconds: number,
): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
    ...(isHttps(req) ? ["Secure"] : []),
  ].join("; ");
}

/* ------------------------------------------------------------------ */
/* login / setup                                                       */
/* ------------------------------------------------------------------ */

/* A constant hash to verify against when the e-mail is unknown, so the
   response time does not reveal which addresses exist. */
let dummyHash: Promise<string> | null = null;

/** The one normalisation of a sign-in e-mail — used for the lookup, the
 *  rate-limit keys and the audit log alike: trimmed, lower-case, "" for
 *  non-strings and for anything longer than an e-mail address can be. */
export function normalizeLoginEmail(email: unknown): string {
  if (typeof email !== "string") return "";
  const normalized = email.trim().toLowerCase();
  return normalized.length > MAX_EMAIL_LENGTH ? "" : normalized;
}

export async function verifyLogin(
  db: Database,
  email: unknown,
  password: unknown,
): Promise<UserRecord | null> {
  const normalized = normalizeLoginEmail(email);
  if (!normalized || typeof password !== "string") return null;
  if (password.length > MAX_LOGIN_PASSWORD_LENGTH) return null;
  const row = db
    .query<UserRow, [string]>("SELECT * FROM users WHERE email = ? AND active = 1")
    .get(normalized);
  if (!row) {
    dummyHash ??= Bun.password.hash("openfs-timing-equalizer");
    await verifyPassword(password, await dummyHash);
    return null;
  }
  return (await verifyPassword(password, row.password_hash)) ? toUser(row) : null;
}


/* ------------------------------------------------------------------ */
/* access policy                                                       */
/* ------------------------------------------------------------------ */

type Rule = { method: string | "*"; pattern: RegExp };

/* Reachable without a session. Everything else requires one. */
export const PUBLIC_ROUTES: Rule[] = [
  { method: "GET", pattern: /^\/api\/auth\/status$/ },
  { method: "POST", pattern: /^\/api\/auth\/(login|setup|logout)$/ },
  // Einladungslink: read who is invited, set the password (token-gated).
  { method: "*", pattern: /^\/api\/auth\/invite\/[^/]+$/ },
  // Public appointment form (/anfrage): submit + school profile for the header.
  { method: "POST", pattern: /^\/api\/appointment-requests$/ },
  { method: "GET", pattern: /^\/api\/school-profile$/ },
  { method: "GET", pattern: /^\/api\/public\// },
  // Token-gated, rate-limited Schülerportal.
  { method: "*", pattern: /^\/api\/portal\// },
  // Multi-tenant platform: school info + self-service signup.
  { method: "*", pattern: /^\/api\/platform\// },
];

/* Inhaber only: user admin, protocol, backups, raw database export. */
const OWNER_ONLY = [
  /^\/api\/users/,
  /^\/api\/audit-log/,
  /^\/api\/admin\//,
  /^\/api\/export\//,
];

/* Money matters are out of bounds for the Fahrlehrer role — read and write. */
const FINANCE = [
  /^\/api\/accounting\//,
  /^\/api\/student-balances/,
  /^\/api\/invoices/,
  /^\/api\/open-items/,
  /^\/api\/sepa\//,
  /^\/api\/instalment/,
  /^\/api\/settings\/invoicing/,
  /^\/api\/import\//,
  /^\/api\/calendar-events\/[^/]+\/bill$/,
  /^\/api\/campaigns/,
  // Umsatz per month etc. — the Statistik page is an office/owner tool.
  /^\/api\/statistics/,
];

/* What a Fahrlehrer may change: Termine (incl. Absage), Ausbildungs-
   nachweise, Theorie-Anwesenheit, Chat, own password. */
const INSTRUCTOR_WRITES = [
  /^\/api\/calendar-events(\/|$)/,
  /^\/api\/attestations/,
  /^\/api\/theory-groups\/[^/]+\/attendance$/,
  /^\/api\/conversations/,
  /^\/api\/auth\//,
];

export function isPublic(method: string, path: string): boolean {
  return PUBLIC_ROUTES.some(
    (rule) => (rule.method === "*" || rule.method === method) && rule.pattern.test(path),
  );
}

export function isAllowed(role: Role, method: string, path: string): boolean {
  if (role === "inhaber") return true;
  if (OWNER_ONLY.some((p) => p.test(path))) return false;
  if (role === "buero") return true;
  if (FINANCE.some((p) => p.test(path))) return false;
  if (method === "GET" || method === "HEAD") return true;
  return INSTRUCTOR_WRITES.some((p) => p.test(path));
}

/* Cross-site request guard on top of SameSite=Strict: a state-changing
   request that carries an Origin must come from this host. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* the guard                                                           */
/* ------------------------------------------------------------------ */

type Handler = (req: BunRequest, server: RequestIPSource) => Response | Promise<Response>;
type RouteValue = Handler | Record<string, Handler> | unknown;

export type ProtectOptions = {
  /** Resolves the tenant (and its database) for a request in multi-tenant
      mode; a Response (unknown or suspended school) is returned as is. */
  resolveDb?: (req: Request) => { db: Database; tenant: string } | Response;
};

export function audit(
  db: Database,
  entry: { user?: SessionUser; method: string; path: string; status: number; ip: string },
) {
  db.prepare(
    `INSERT INTO audit_log (user_id, user_email, method, path, status, ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.user?.id ?? null,
    entry.user?.email ?? "",
    entry.method,
    entry.path,
    entry.status,
    entry.ip,
  );
}

function guard(
  fallbackDb: Database,
  routeMethod: string,
  handler: Handler,
  options: ProtectOptions,
) {
  return async (req: BunRequest, server: RequestIPSource): Promise<Response> => {
    const path = new URL(req.url).pathname;
    const method = routeMethod === "*" ? req.method : routeMethod;
    let db = fallbackDb;
    let tenant: string | undefined;
    if (options.resolveDb) {
      const resolved = options.resolveDb(req);
      if (resolved instanceof Response) return resolved;
      ({ db, tenant } = resolved);
    }
    const store = requestContext.getStore() ?? {};
    const mutating = method !== "GET" && method !== "HEAD";
    const publicRoute = isPublic(method, path);

    // Shape checks for every write, public or not: JSON only (415), a
    // foreign Origin is refused, bodies are capped (413).
    let request = req;
    let ipSource: RequestIPSource | undefined = server;
    if (mutating) {
      const badType = checkContentType(req, method, path);
      if (badType) return badType;
      if (!sameOrigin(req)) return err("Ungültige Herkunft der Anfrage.", 403);
    }
    const run = async (user?: SessionUser) => {
      const limited = await limitBody(
        request,
        ipSource,
        publicRoute ? PUBLIC_BODY_LIMIT_BYTES : MAX_REQUEST_BODY_BYTES,
      );
      if (limited instanceof Response) return limited;
      request = limited.req;
      ipSource = limited.server;
      return requestContext.run({ ...store, db, tenant, user }, () =>
        handler(request, ipSource as RequestIPSource),
      );
    };

    if (publicRoute) return run();

    const user = sessionUser(db, readCookie(req, SESSION_COOKIE));
    if (!user) return err("Bitte melden Sie sich an.", 401);
    if (!isAllowed(user.role, method, path)) {
      return err("Für diese Aktion fehlt die Berechtigung.", 403);
    }

    const response = await run(user);
    if (mutating) {
      try {
        audit(db, {
          user,
          method,
          path,
          status: response.status,
          ip: clientIp(req, ipSource),
        });
      } catch (error) {
        console.error("Protokoll konnte nicht geschrieben werden:", error);

      }
    }
    return response;
  };
}

/** Wrap every handler of a Bun routes object with the session/role guard. */
export function protectApiRoutes<T extends Record<string, RouteValue>>(
  db: Database,
  routes: T,
  options: ProtectOptions = {},
): T {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(routes)) {
    if (typeof value === "function") {
      out[path] = guard(db, "*", value as Handler, options);
    } else if (value && typeof value === "object" && !(value instanceof Response)) {
      const methods: Record<string, Handler> = {};
      for (const [method, handler] of Object.entries(value as Record<string, Handler>)) {
        methods[method] = guard(db, method, handler, options);
      }
      out[path] = methods;
    } else {
      out[path] = value;
    }
  }
  return out as T;
}

/* ------------------------------------------------------------------ */
/* HTTP: /api/auth/*, /api/users, /api/audit-log                       */
/* ------------------------------------------------------------------ */

export type AuthRouteOptions = {
  /** Demo mode shows the demo login on the sign-in page. */
  demo?: { email: string; password: string } | null;
  /** Failed sign-ins per IP + e-mail (default 10 per 15 minutes). */
  loginRateLimit?: RateLimit | false;
  /** Failed sign-ins per e-mail from any IP (default 20 per 15 minutes). */
  accountRateLimit?: RateLimit | false;
  /** Wrong current passwords on "Passwort ändern" per user (5 / 15 min). */
  passwordRateLimit?: RateLimit | false;
  /** Called after the first Inhaber account was created by the setup. */
  onSetup?: (db: Database, body: Record<string, unknown>) => void;
};

function dbOf(fallback: Database): Database {
  return requestContext.getStore()?.db ?? fallback;
}

export function authRoutes(fallbackDb: Database, options: AuthRouteOptions = {}) {
  // Only failed attempts count; a successful login clears the counter, so
  // staff signing in often (several devices, shared PC) is never locked out.
  const failures = createFailureLimiter(
    options.loginRateLimit ?? { max: 10, windowMs: 15 * 60_000 },
  );
  // Independent of the IP: a botnet guessing one account's password is
  // throttled too (at the price that the account's owner waits as well).
  const accountFailures = createFailureLimiter(
    options.accountRateLimit ?? { max: 20, windowMs: 15 * 60_000 },
  );
  const passwordFailures = createFailureLimiter(
    options.passwordRateLimit ?? { max: 5, windowMs: 15 * 60_000 },
  );
  // Limiter keys are per school in multi-tenant mode.
  const tenantKey = () => requestContext.getStore()?.tenant ?? "";
  const TOO_MANY = "Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.";

  const startSession = (
    db: Database,
    req: Request,
    server: RequestIPSource,
    userId: number,
  ) => {
    const token = createSession(db, userId, {
      ip: clientIp(req, server),
      userAgent: req.headers.get("user-agent") ?? "",
    });
    return sessionCookie(req, token, SESSION_TTL_MS / 1000);
  };

  return {
    "/api/auth/status": {
      GET: (req: BunRequest) =>
        handle(() => {
          const db = dbOf(fallbackDb);
          return json({
            setupRequired: countUsers(db) === 0,
            user: sessionUser(db, readCookie(req, SESSION_COOKIE)),
            demo: options.demo ?? null,
          });
        })(),
    },

    "/api/auth/login": {
      POST: (req: BunRequest, server: RequestIPSource) =>
        handle(async () => {
          const db = dbOf(fallbackDb);
          const body = (await req.json().catch(() => ({}))) as {
            email?: unknown;
            password?: unknown;
          };
          // Same normalisation as verifyLogin, so " Chef@X.de" and
          // "chef@x.de" share one counter.
          const email = normalizeLoginEmail(body.email);
          const accountKey = `${tenantKey()}|${email}`;
          const key = `${clientIp(req, server)}|${accountKey}`;
          if (failures.blocked(key) || accountFailures.blocked(accountKey)) {
            return err(TOO_MANY, 429);
          }
          const user = await verifyLogin(db, email, body.password);
          audit(db, {
            user: user ?? undefined,
            method: "LOGIN",
            path: user ? "/api/auth/login" : `/api/auth/login (${email})`,
            status: user ? 200 : 401,
            ip: clientIp(req, server),
          });
          if (!user) {
            failures.fail(key);
            accountFailures.fail(accountKey);
            return err("E-Mail-Adresse oder Passwort ist falsch.", 401);
          }
          failures.reset(key);
          accountFailures.reset(accountKey);
          const cookie = startSession(db, req, server, user.id);
          return new Response(JSON.stringify({ user }), {
            headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
          });
        })(),
    },

    "/api/auth/logout": {
      POST: (req: BunRequest) =>
        handle(() => {
          deleteSession(dbOf(fallbackDb), readCookie(req, SESSION_COOKIE));
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": sessionCookie(req, "", 0),
            },
          });
        })(),
    },

    /* First run: creates the first Inhaber account (only while no user
       exists) and signs it in. */
    "/api/auth/setup": {
      POST: (req: BunRequest, server: RequestIPSource) =>
        handle(async () => {
          const db = dbOf(fallbackDb);
          const done = () => err("Die Einrichtung wurde bereits abgeschlossen.", 409);
          if (countUsers(db) > 0) return done();
          const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
          // Validate and hash first (slow, async), then check-and-insert in
          // ONE immediate transaction: two racing setups cannot both create
          // an Inhaber, and a failed attempt leaves no school data behind.
          const prepared = await prepareUser({ ...body, role: "inhaber" });
          const user = immediateTransaction(db, () => {
            if (countUsers(db) > 0) return null;
            options.onSetup?.(db, body);
            return insertUser(db, prepared);
          });
          if (!user) return done();
          const cookie = startSession(db, req, server, user.id);
          return new Response(JSON.stringify({ user }), {
            status: 201,
            headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
          });
        })(),
    },

    "/api/auth/password": {
      POST: (req: BunRequest) =>
        handle(async () => {
          const db = dbOf(fallbackDb);
          const current = requestContext.getStore()?.user;
          if (!current) return err("Bitte melden Sie sich an.", 401);
          const body = (await req.json()) as { current?: unknown; next?: unknown };
          const limitKey = `${tenantKey()}|${current.id}`;
          if (passwordFailures.blocked(limitKey)) {
            return err("Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.", 429);
          }
          const ok = await verifyLogin(db, current.email, body.current);
          if (!ok) {
            passwordFailures.fail(limitKey);
            throw new ValidationError("Das aktuelle Passwort ist falsch.");
          }
          passwordFailures.reset(limitKey);

          await updateUser(db, current.id, { password: body.next });
          // Password change ended all sessions — start a fresh one here.
          const token = createSession(db, current.id);
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": sessionCookie(req, token, SESSION_TTL_MS / 1000),
            },
          });
        })(),
    },

    "/api/users": {
      GET: () => handle(() => json({ users: listUsers(dbOf(fallbackDb)) }))(),
      POST: (req: BunRequest) =>
        handle(async () =>
          json(await createUser(dbOf(fallbackDb), await req.json()), 201),
        )(),
    },

    "/api/users/:id": {
      PATCH: (req: BunRequest<"/api/users/:id">) =>
        handle(async () => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) throw new ValidationError("Ungültige Benutzer-ID.");
          return json(await updateUser(dbOf(fallbackDb), id, await req.json()));
        })(),
    },

    "/api/audit-log": {
      GET: (req: BunRequest) =>
        handle(() => {
          const limit = Math.min(
            Math.max(Number(new URL(req.url).searchParams.get("limit") ?? 200), 1),
            1000,
          );
          const rows = dbOf(fallbackDb)
            .query<
              {
                id: number;
                at: string;
                user_email: string;
                method: string;
                path: string;
                status: number;
                ip: string;
              },
              [number]
            >(
              "SELECT id, at, user_email, method, path, status, ip FROM audit_log ORDER BY id DESC LIMIT ?",
            )
            .all(limit);
          return json({
            entries: rows.map((row) => ({
              id: row.id,
              at: `${row.at.replace(" ", "T")}Z`,
              userEmail: row.user_email,
              method: row.method,
              path: row.path,
              status: row.status,
              ip: row.ip,
            })),
          });
        })(),
    },
  };
}
