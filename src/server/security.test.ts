/* ------------------------------------------------------------------ */
/* Security regression suite. Boots the real, guarded route table      */
/* (buildApiRoutes + platformRoutes, wrapped like src/index.ts) on a   */
/* random port and                                                     */
/*  1. sweeps EVERY route × method × role (anonymous, Fahrlehrer, Büro, */
/*     Inhaber) against the explicit POLICY below — a new endpoint     */
/*     without a policy decision fails this test;                      */
/*  2. replays the findings of the security review / pen test as       */
/*     tests (invite takeover via the outbox, limiter bypass, setup    */
/*     and invite races, Fahrlehrer fee bookings, oversized bodies,    */
/*     malformed cookies, CSRF, portal tokens at rest, headers,        */
/*     cross-tenant cookie replay).                                    */
/* In-memory databases only (the tenant file test uses a temp dir).   */
/* ------------------------------------------------------------------ */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serve } from "bun";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { API_NOT_FOUND, buildApiRoutes, type ApiRouteOptions } from "./app-routes";
import {
  createSession,
  createUser,
  SESSION_COOKIE,
  sessionUser,
  withArgonSlot,
} from "./auth";
import { createCalendarEvent } from "./calendar-events";
import { setCancellationPolicy } from "./cancellations";
import { openDb } from "./db";
import { BusyError } from "./errors";
import { createFailureLimiter, LIMITER_MAX_KEYS } from "./http";
import { createInvite } from "./invites";
import { deliverPending, OUTBOX_SECRET_PLACEHOLDER } from "./mail";
import { prepareSchoolDb } from "./bootstrap";
import { MAX_REQUEST_BODY_BYTES, PUBLIC_BODY_LIMIT_BYTES } from "./request-guards";
import {
  CONTENT_SECURITY_POLICY,
  documentHeaders,
  secureRoutes,
} from "./security-headers";
import type { Database } from "./sqlite";
import {
  buildTenantApiRoutes,
  platformRoutes,
  Registry,
  TenantFileStore,
  TenantManager,
} from "./tenancy";
import { MemoryFileStore } from "./file-store";

/* ------------------------------------------------------------------ */
/* the policy — one decision per route and method                      */
/* ------------------------------------------------------------------ */

/** public: no sign-in · staff: every role incl. Fahrlehrer/in ·
 *  office: Inhaber + Büro · owner: Inhaber only. */
type Access = "public" | "staff" | "office" | "owner";

const POLICY: Record<string, Access> = {
  // sign-in, invites
  "GET /api/auth/status": "public",
  "POST /api/auth/login": "public",
  "POST /api/auth/logout": "public",
  "POST /api/auth/setup": "public",
  "POST /api/auth/password": "staff",
  "GET /api/auth/invite/:token": "public",
  "POST /api/auth/invite/:token": "public",
  "GET /api/users": "owner",
  "POST /api/users": "owner",
  "PATCH /api/users/:id": "owner",
  "POST /api/users/:id/invite": "owner",
  "GET /api/audit-log": "owner",
  // money
  "GET /api/student-balances": "office",
  "GET /api/accounting/accounts": "office",
  "PATCH /api/accounting/accounts/:number": "office",
  "GET /api/accounting/transactions": "office",
  "POST /api/accounting/transactions": "office",
  "POST /api/accounting/transactions/:id/storno": "office",
  "GET /api/accounting/datev": "office",
  "GET /api/accounting/journal": "office",
  "GET /api/accounting/quittung/:id": "office",
  "GET /api/accounting/balances": "office",
  "GET /api/accounting/cashbook/:account": "office",
  "GET /api/accounting/journal/export": "office",
  "GET /api/accounting/vat-report": "office",
  "GET /api/invoices": "office",
  "POST /api/invoices": "office",
  "GET /api/invoices/uninvoiced": "office",
  "GET /api/invoices/:id": "office",
  "POST /api/invoices/:id/storno": "office",
  "POST /api/invoices/:id/reminders": "office",
  "GET /api/invoices/:id/pdf": "office",
  "GET /api/invoices/:id/reminders/:reminderId/pdf": "office",
  "POST /api/invoices/:id/send": "office",
  "GET /api/open-items": "office",
  "POST /api/open-items/saldovortrag/:id/reminders": "office",
  "GET /api/open-items/saldovortrag/:id/reminders/:reminderId/pdf": "office",
  "POST /api/open-items/saldovortrag/:id/reminders/:reminderId/send": "office",
  "GET /api/settings/invoicing": "office",
  "PUT /api/settings/invoicing": "office",
  "GET /api/instalment-plans": "office",
  "POST /api/instalment-plans": "office",
  "POST /api/instalment-plans/:id/cancel": "office",
  "POST /api/instalments/:id/pay": "office",
  "GET /api/sepa/mandates": "office",
  "POST /api/sepa/mandates": "office",
  "POST /api/sepa/mandates/:id/revoke": "office",
  "GET /api/sepa/candidates": "office",
  "GET /api/sepa/collections": "office",
  "POST /api/sepa/collections": "office",
  "GET /api/sepa/collections/:id/xml": "office",
  "POST /api/sepa/collections/:id/book": "office",
  "POST /api/sepa/items/:id/return": "office",
  "POST /api/calendar-events/:id/bill": "office",
  "GET /api/statistics": "office",
  "GET /api/price-plans": "office",
  "POST /api/price-plans": "office",
  "PATCH /api/price-plans/:id": "office",
  "DELETE /api/price-plans/:id": "office",
  "GET /api/campaigns": "office",
  "POST /api/campaigns": "office",
  "PATCH /api/campaigns/:id": "office",
  "DELETE /api/campaigns/:id": "office",
  // school master data
  "GET /api/profile": "staff", // tax + bank fields stripped for Fahrlehrer
  "PUT /api/profile": "office",
  "GET /api/school-profile": "public",
  "PUT /api/school-profile": "office",
  "GET /api/branches": "office",
  "POST /api/branches": "office",
  "PATCH /api/branches/:id": "office",
  "DELETE /api/branches/:id": "office",
  "GET /api/instructors": "staff",
  "POST /api/instructors": "office",
  "PATCH /api/instructors/:id": "office",
  "DELETE /api/instructors/:id": "office",
  "GET /api/vehicle-options": "staff",
  "GET /api/vehicles": "staff",
  "POST /api/vehicles": "office",
  "PATCH /api/vehicles/:id": "office",
  "DELETE /api/vehicles/:id": "office",
  "GET /api/settings/notifications": "office",
  "PUT /api/settings/notifications": "office",
  "GET /api/settings/cancellation-policy": "staff",
  "PUT /api/settings/cancellation-policy": "office",
  // students, archive, documents, portal links, import
  "GET /api/students": "staff", // balances and prices stripped
  "POST /api/students": "office",
  "GET /api/students/archived": "office",
  "PATCH /api/students/:id": "office",
  "DELETE /api/students/:id": "office",
  "GET /api/archive": "office",
  "POST /api/archive/:id/restore": "office",
  "DELETE /api/archive/:id": "office",
  "GET /api/students/:id/files": "office",
  "POST /api/students/:id/files": "office",
  "GET /api/files/:id": "office",
  "PATCH /api/files/:id": "office",
  "DELETE /api/files/:id": "office",
  "GET /api/students/:id/portal-link": "office",
  "POST /api/students/:id/portal-link": "office",
  "DELETE /api/students/:id/portal-link": "office",
  "POST /api/students/:id/portal-link/email": "office",
  "POST /api/import/students/preview": "office",
  "POST /api/import/students/commit": "office",
  // calendar (Fahrlehrer: all of it but billing)
  "GET /api/calendar-events": "staff",
  "POST /api/calendar-events": "staff",
  "PATCH /api/calendar-events/:id": "staff",
  "DELETE /api/calendar-events/:id": "staff",
  "POST /api/calendar-events/:id/exam-result": "staff",
  "POST /api/calendar-events/series": "staff",
  "PATCH /api/calendar-events/:id/series": "staff",
  "DELETE /api/calendar-events/series/:seriesId": "staff",
  "POST /api/calendar-events/:id/cancel": "staff", // fee overrides refused
  "POST /api/calendar-events/:id/uncancel": "staff",
  "GET /api/calendar-events/conflicts": "staff",
  "GET /api/absences": "staff",
  "POST /api/absences": "office",
  "DELETE /api/absences/:id": "office",
  "GET /api/absences/affected": "office",
  "POST /api/absences/reassign": "office",
  "POST /api/absences/cancel-lessons": "office",
  "GET /api/reports/instructor-hours": "office",
  // training
  "GET /api/attestations": "staff",
  "GET /api/calendar-events/:id/attestation": "staff",
  "POST /api/calendar-events/:id/attestation": "staff",
  "GET /api/theory-groups": "staff",
  "POST /api/theory-groups": "office",
  "PATCH /api/theory-groups/:id": "office",
  "DELETE /api/theory-groups/:id": "office",
  "GET /api/theory-groups/:id/attendance": "staff",
  "PUT /api/theory-groups/:id/attendance": "staff",
  // communication
  "GET /api/conversations": "staff",
  "POST /api/conversations": "staff",
  "GET /api/conversations/:id/messages": "staff",
  "POST /api/conversations/:id/messages": "staff",
  "POST /api/conversations/:id/read": "staff",
  "DELETE /api/conversations/:id": "staff",
  "GET /api/mail/status": "office",
  "GET /api/outbox": "office",
  "POST /api/outbox": "office",
  "POST /api/outbox/sms": "office",
  "POST /api/outbox/:id/retry": "office",
  "GET /api/reviews/google": "office",
  "POST /api/reviews/import/google": "office",
  "GET /api/reviews": "office",
  "POST /api/reviews": "office",
  "PATCH /api/reviews/:id": "office",
  "DELETE /api/reviews/:id": "office",
  "GET /api/appointment-requests": "office",
  "POST /api/appointment-requests": "public",
  "PATCH /api/appointment-requests/:id": "office",
  "DELETE /api/appointment-requests/:id": "office",
  "POST /api/appointment-requests/:id/accept": "office",
  "PUT /api/appointment-requests/:id/student": "office",
  "POST /api/appointment-requests/:id/decline": "office",
  // owner tools
  "GET /api/export/database": "owner",
  "GET /api/export/zip": "owner",
  "GET /api/admin/backups": "owner",
  "POST /api/admin/backups": "owner",
  "GET /api/admin/backups/:name": "owner",
  "POST /api/admin/backups/:name/verify": "owner",
  // Löschkonzept and Betroffenenrechte: decisions of the controller.
  "GET /api/admin/retention": "owner",
  "GET /api/admin/retention/policy": "owner",
  "PUT /api/admin/retention/policy": "owner",
  "POST /api/admin/retention/run": "owner",
  "GET /api/admin/retention/holds": "owner",
  "POST /api/admin/retention/holds": "owner",
  "DELETE /api/admin/retention/holds/:studentId": "owner",
  "GET /api/admin/privacy/subjects": "owner",
  "GET /api/admin/privacy/students/:id/auskunft": "owner",
  "GET /api/admin/privacy/students/:id/erasure": "owner",
  "POST /api/admin/privacy/students/:id/erasure": "owner",
  // public surfaces
  "GET /api/portal/:token": "public",
  "GET /api/portal/:token/messages": "public",
  "POST /api/portal/:token/messages": "public",
  "GET /api/public/legal": "public",
  "GET /api/platform/info": "public",
  "POST /api/platform/signup": "public",
};

/* ------------------------------------------------------------------ */
/* server                                                              */
/* ------------------------------------------------------------------ */

const PASSWORD = "sicher-genug-1";
const JSON_HEADERS = { "Content-Type": "application/json" };

let db: Database;
let routes: Record<string, unknown>;
let server: ReturnType<typeof serve>;
let base: string;
const users = {} as Record<
  "inhaber" | "buero" | "fahrlehrer",
  { id: number; email: string }
>;

function start(database: Database, options: ApiRouteOptions) {
  const table = {
    ...buildApiRoutes(database, options),
    ...platformRoutes(null),
  };
  const srv = serve({
    port: 0,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    routes: { ...secureRoutes(API_NOT_FOUND), ...secureRoutes(table) },
    fetch: () => new Response("not found", { status: 404 }),
  });
  return { table, srv, url: `http://127.0.0.1:${srv.port}` };
}

beforeAll(async () => {
  db = openDb(":memory:");
  await prepareSchoolDb(db);
  for (const role of ["inhaber", "buero", "fahrlehrer"] as const) {
    const email = `${role}@fs.test`;
    const user = await createUser(db, {
      email,
      name: role,
      password: PASSWORD,
      role,
    });
    users[role] = { id: user.id, email };
  }
  const started = start(db, {
    // SMTP "configured" so invites are queued as mails (nothing is sent:
    // no scheduler runs in tests).
    mail: {
      config: {
        host: "smtp.invalid",
        port: 587,
        user: "",
        pass: "",
        from: "fs@fs.test",
        secure: "starttls",
      },
      sms: null,
    },
    auth: { loginRateLimit: false, accountRateLimit: false, passwordRateLimit: false },
  });
  routes = started.table;
  server = started.srv;
  base = started.url;
});

afterAll(() => server.stop(true));

type Role = keyof typeof users;
const sessionFor = (role: Role) =>
  `${SESSION_COOKIE}=${createSession(db, users[role].id)}`;

function concretePath(pattern: string): string {
  return pattern.replace(/:(\w+)/g, (_, name: string) =>
    name === "token" ? "x".repeat(43) : name === "name" ? "nope.db" : "999999",
  );
}

type Verdict = "unauthenticated" | "forbidden" | "allowed";

async function verdict(method: string, path: string, role: Role | null) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...JSON_HEADERS, ...(role ? { cookie: sessionFor(role) } : {}) },
    body: method === "GET" || method === "DELETE" ? undefined : "{}",
  });
  const text = await res.text();
  let error = "";
  try {
    error = (JSON.parse(text) as { error?: string }).error ?? "";
  } catch {
    // PDFs, CSV, …
  }
  // Only the guard's own answers count as a denial — a handler may
  // answer 401/403 for its own reasons (wrong password, fee override).
  if (res.status === 401 && error === "Bitte melden Sie sich an.") {
    return "unauthenticated" satisfies Verdict;
  }
  if (res.status === 403 && error === "Für diese Aktion fehlt die Berechtigung.") {
    return "forbidden" satisfies Verdict;
  }
  expect(res.status, `${method} ${path} as ${role}: ${text.slice(0, 200)}`).toBeLessThan(
    500,
  );
  return "allowed" satisfies Verdict;
}

function expected(access: Access, role: Role | null): Verdict {
  if (access === "public") return "allowed";
  if (role === null) return "unauthenticated";
  if (access === "staff") return "allowed";
  if (access === "office") return role === "fahrlehrer" ? "forbidden" : "allowed";
  return role === "inhaber" ? "allowed" : "forbidden";
}

/* ------------------------------------------------------------------ */
/* 1. the sweep                                                        */
/* ------------------------------------------------------------------ */

describe("access policy sweep", () => {
  test("every route and method has an explicit policy decision", () => {
    const table: string[] = [];
    for (const [path, value] of Object.entries(routes)) {
      const methods =
        typeof value === "function" ? ["GET"] : Object.keys(value as object);
      for (const method of methods) table.push(`${method} ${path}`);
    }
    const missing = table.filter((key) => !(key in POLICY));
    const stale = Object.keys(POLICY).filter((key) => !table.includes(key));
    expect(missing, "routes without a policy decision").toEqual([]);
    expect(stale, "policy entries for routes that no longer exist").toEqual([]);
  });

  test("anonymous, Fahrlehrer, Büro and Inhaber get exactly what the policy says", async () => {
    const mismatches: string[] = [];
    for (const [key, access] of Object.entries(POLICY)) {
      const [method, pattern] = key.split(" ") as [string, string];
      const path = concretePath(pattern);
      for (const role of [null, "fahrlehrer", "buero", "inhaber"] as const) {
        const got = await verdict(method, path, role);
        const want = expected(access, role);
        if (got !== want)
          mismatches.push(`${key} as ${role ?? "anon"}: ${got} ≠ ${want}`);
      }
    }
    expect(mismatches).toEqual([]);
  }, 60_000);
});

/* ------------------------------------------------------------------ */
/* 2. findings                                                          */
/* ------------------------------------------------------------------ */

async function post(path: string, body: unknown, cookie?: string, extra = {}) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { ...JSON_HEADERS, ...(cookie ? { cookie } : {}), ...extra },
    body: JSON.stringify(body),
  });
}

describe("H1: invite takeover via the outbox", () => {
  test("the outbox never holds a working invite link, and Fahrlehrer cannot read it", async () => {
    const target = await createUser(db, {
      email: "neu@fs.test",
      name: "Neu",
      role: "buero",
      invite: true,
    });
    const created = await post(
      `/api/users/${target.id}/invite`,
      {},
      sessionFor("inhaber"),
    );
    expect(created.status).toBe(201);
    expect(((await created.json()) as { mailed: boolean }).mailed).toBe(true);

    // PoC step 1: a Fahrlehrer reads the outbox — refused now.
    const asInstructor = await fetch(`${base}/api/outbox`, {
      headers: { cookie: sessionFor("fahrlehrer") },
    });
    expect(asInstructor.status).toBe(403);

    // Büro may read it, but the mail only holds a placeholder.
    const outbox = (await (
      await fetch(`${base}/api/outbox`, { headers: { cookie: sessionFor("buero") } })
    ).json()) as { items: { kind: string; bodyText: string; relatedId: number }[] };
    const mail = outbox.items.find(
      (item) => item.kind === "user_invite" && item.relatedId === target.id,
    )!;
    expect(mail.bodyText).toContain(`/einladung/${OUTBOX_SECRET_PLACEHOLDER}`);

    // PoC step 2: whatever follows /einladung/ is no working token.
    const stolen = mail.bodyText.split("/einladung/")[1]!.split("\n")[0]!;
    const takeover = await post(`/api/auth/invite/${encodeURIComponent(stolen)}`, {
      password: "angreifer-passwort",
    });
    expect(takeover.status).toBe(400);
    expect(takeover.headers.get("set-cookie")).toBeNull();

    // The real mail still works: the token is minted at delivery.
    const delivered: string[] = [];
    await deliverPending(db, {
      send: async (outgoing) => {
        if (outgoing.to === "neu@fs.test") delivered.push(outgoing.text);
      },
    });
    const token = delivered[0]!.match(/\/einladung\/([A-Za-z0-9_-]{43})/)![1]!;
    const accepted = await post(`/api/auth/invite/${token}`, {
      password: "mein-passwort-1",
    });
    expect(accepted.status).toBe(200);
  });
});

describe("B/L3: Fahrlehrer scope", () => {
  test("profile without tax and bank data, events without fee amounts", async () => {
    const fahrlehrer = sessionFor("fahrlehrer");
    db.exec(
      `UPDATE settings SET value = json_set(value, '$.iban', 'DE89370400440532013000',
         '$.steuernummer', '12/345/67890', '$.glaeubigerId', 'DE98ZZZ09999999999')
       WHERE key = 'company'`,
    );
    const profile = (await (
      await fetch(`${base}/api/profile`, { headers: { cookie: fahrlehrer } })
    ).json()) as Record<string, string>;
    expect(profile.iban).toBe("");
    expect(profile.steuernummer).toBe("");
    expect(profile.glaeubigerId).toBe("");
    expect(profile.name).not.toBe("");
    const office = (await (
      await fetch(`${base}/api/profile`, { headers: { cookie: sessionFor("buero") } })
    ).json()) as Record<string, string>;
    expect(office.iban).toBe("DE89370400440532013000");
  });
});

describe("M3: Fahrlehrer fee bookings", () => {
  test("no own amount or date; the policy fee is booked today", async () => {
    setCancellationPolicy(db, { feeCents: 2500 });
    const studentId = db
      .query<{ id: number }, []>("SELECT id FROM students ORDER BY id LIMIT 1")
      .get()!.id;
    const lesson = () =>
      createCalendarEvent(db, {
        date: "2030-01-15",
        start: "09:00",
        end: "09:45",
        title: "Fahrstunde",
        instructor: "Nicht zugeteilt",
        type: "Praktisch",
        studentId,
      });
    const fahrlehrer = sessionFor("fahrlehrer");

    const event = lesson();
    const amount = await post(
      `/api/calendar-events/${event.id}/cancel`,
      { kind: "nicht_erschienen", chargeFee: true, feeCents: 999_999_00 },
      fahrlehrer,
    );
    expect(amount.status).toBe(403);
    const backdated = await post(
      `/api/calendar-events/${event.id}/cancel`,
      { kind: "nicht_erschienen", chargeFee: true, date: "2020-01-01" },
      fahrlehrer,
    );
    expect(backdated.status).toBe(403);

    const ok = await post(
      `/api/calendar-events/${event.id}/cancel`,
      { kind: "nicht_erschienen", chargeFee: true },
      fahrlehrer,
    );
    expect(ok.status).toBe(200);
    const result = (await ok.json()) as {
      event: { cancellationFeeCents?: number };
      transaction: Record<string, unknown>;
    };
    expect(Object.keys(result.transaction)).toEqual(["id"]);
    expect(result.event.cancellationFeeCents).toBeUndefined();
    const booked = db
      .query<{ date: string; cents: number }, [number]>(
        `SELECT t.date, sum(b.amount_cents) AS cents FROM transactions t
         JOIN bookings b ON b.transaction_id = t.id WHERE t.id = ?`,
      )
      .get(result.transaction.id as number)!;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(booked).toEqual({ date: today, cents: 2500 });

    // Büro sees the amount; the Fahrlehrer/in only that a fee exists.
    const listFor = async (role: Role) =>
      (
        (await (
          await fetch(`${base}/api/calendar-events`, {
            headers: { cookie: sessionFor(role) },
          })
        ).json()) as { events: { id: string; cancellationFeeCents?: number }[] }
      ).events.find((e) => e.id === event.id)!;
    expect((await listFor("buero")).cancellationFeeCents).toBe(2500);
    expect((await listFor("fahrlehrer")).cancellationFeeCents).toBeUndefined();

    // The office may still set amount and date.
    const other = lesson();
    const office = await post(
      `/api/calendar-events/${other.id}/cancel`,
      { kind: "nicht_erschienen", chargeFee: true, feeCents: 4000, date: "2030-01-15" },
      sessionFor("buero"),
    );
    expect(office.status).toBe(200);
  });
});

describe("M1/M4: sign-in limits", () => {
  test("whitespace and case variants of an e-mail share the IP counter", async () => {
    const limited = start(db, {
      auth: { loginRateLimit: { max: 3, windowMs: 60_000 }, accountRateLimit: false },
    });
    try {
      const variants = [
        "inhaber@fs.test",
        " inhaber@fs.test",
        "INHABER@fs.test ",
        "\tInhaber@FS.test",
      ];
      const statuses: number[] = [];
      for (const email of variants) {
        const res = await fetch(`${limited.url}/api/auth/login`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ email, password: "falsch-falsch" }),
        });
        statuses.push(res.status);
      }
      expect(statuses).toEqual([401, 401, 401, 429]);
    } finally {
      limited.srv.stop(true);
    }
  });

  test("an account is limited independently of the IP counter", async () => {
    const limited = start(db, {
      auth: { loginRateLimit: false, accountRateLimit: { max: 2, windowMs: 60_000 } },
    });
    try {
      const attempt = (email: string, password = "falsch-falsch") =>
        fetch(`${limited.url}/api/auth/login`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ email, password }),
        });
      expect((await attempt("buero@fs.test")).status).toBe(401);
      expect((await attempt("buero@fs.test")).status).toBe(401);
      // Even the right password waits now …
      expect((await attempt("buero@fs.test", PASSWORD)).status).toBe(429);
      // … while other accounts are unaffected.
      expect((await attempt("inhaber@fs.test", PASSWORD)).status).toBe(200);
    } finally {
      limited.srv.stop(true);
    }
  });

  test("absurd e-mails are neither looked up nor logged in full", async () => {
    const email = `${"a".repeat(10_000)}@fs.test`;
    const res = await post("/api/auth/login", { email, password: "x" });
    expect(res.status).toBe(401);
    const row = db
      .query<{ path: string }, []>(
        "SELECT path FROM audit_log WHERE method = 'LOGIN' ORDER BY id DESC LIMIT 1",
      )
      .get()!;
    expect(row.path.length).toBeLessThan(300);
  });

  test("the limiter map stays bounded", () => {
    const limiter = createFailureLimiter({ max: 3, windowMs: 60_000 });
    for (let i = 0; i < LIMITER_MAX_KEYS + 500; i++) limiter.fail(`k${i}`);
    expect(limiter.size).toBe(LIMITER_MAX_KEYS);
    // The newest keys survive, the oldest were evicted.
    limiter.fail(`k${LIMITER_MAX_KEYS + 499}`);
    expect(limiter.size).toBe(LIMITER_MAX_KEYS);
  });

  test("argon2 runs are capped; beyond the queue the server answers busy", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = Array.from({ length: 4 + 64 }, () => withArgonSlot(() => gate));
    await expect(withArgonSlot(async () => {})).rejects.toBeInstanceOf(BusyError);
    release();
    await Promise.all(running);
    await expect(withArgonSlot(async () => "frei")).resolves.toBe("frei");
  });

  test("wrong current passwords on 'Passwort ändern' are limited", async () => {
    const limited = start(db, {
      auth: { passwordRateLimit: { max: 2, windowMs: 60_000 } },
    });
    try {
      const cookie = sessionFor("buero");
      const change = () =>
        fetch(`${limited.url}/api/auth/password`, {
          method: "POST",
          headers: { ...JSON_HEADERS, cookie },
          body: JSON.stringify({ current: "falsch-falsch", next: "neues-passwort-1" }),
        });
      expect((await change()).status).toBe(400);
      expect((await change()).status).toBe(400);
      expect((await change()).status).toBe(429);
    } finally {
      limited.srv.stop(true);
    }
  });
});

describe("L1/L2: races", () => {
  test("two simultaneous setups create exactly one Inhaber", async () => {
    const fresh = openDb(":memory:", { demoData: false });
    await prepareSchoolDb(fresh);
    const app = start(fresh, {});
    try {
      const setup = (email: string) =>
        fetch(`${app.url}/api/auth/setup`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            email,
            name: email,
            password: "sehr-geheim-1",
            schoolName: "Fahrschule Test",
          }),
        });
      const results = await Promise.all([setup("a@fs.test"), setup("b@fs.test")]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        fresh.query<{ n: number }, []>("SELECT count(*) AS n FROM users").get()!.n,
      ).toBe(1);
    } finally {
      app.srv.stop(true);
    }
  });

  test("an invite link is accepted once, even by simultaneous requests", async () => {
    const user = await createUser(db, {
      email: "doppelt@fs.test",
      name: "Doppelt",
      role: "fahrlehrer",
      invite: true,
    });
    const { token } = createInvite(db, user.id);
    const accept = (password: string) => post(`/api/auth/invite/${token}`, { password });
    const results = await Promise.all([
      accept("erstes-passwort-1"),
      accept("zweites-passwort-2"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const winner =
      results[0]!.status === 200 ? "erstes-passwort-1" : "zweites-passwort-2";
    const hash = db
      .query<{ password_hash: string }, [number]>(
        "SELECT password_hash FROM users WHERE id = ?",
      )
      .get(user.id)!.password_hash;
    expect(await Bun.password.verify(winner, hash)).toBe(true);
  });
});

describe("M4/L8: request size", () => {
  test("a declared oversized body is refused with 413", async () => {
    const body = new Uint8Array(MAX_REQUEST_BODY_BYTES + 1024);
    const res = await fetch(`${base}/api/students/1/files`, {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=x",
        cookie: sessionFor("inhaber"),
      },
      body,
      // Bun's fetch would reuse the socket despite "Connection: close".
      keepalive: false,
    });
    expect(res.status).toBe(413);
  });

  test("a chunked oversized body is refused with 413 while streaming", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MAX_REQUEST_BODY_BYTES + chunk.byteLength) return controller.close();
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const res = await fetch(`${base}/api/students/1/files`, {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=x",
        cookie: sessionFor("inhaber"),
      },
      body: stream,
      duplex: "half",
      keepalive: false,
    } as RequestInit);
    expect(res.status).toBe(413);
  });

  test("public endpoints take small bodies only", async () => {
    const res = await post("/api/appointment-requests", {
      name: "x".repeat(PUBLIC_BODY_LIMIT_BYTES),
    });
    expect(res.status, await res.clone().text()).toBe(413);
  });
});

describe("INFO: sessions", () => {
  test("a malformed session cookie means signed out, never a 500", async () => {
    const cookie = `${SESSION_COOKIE}=%E0%A4%A`;
    const students = await fetch(`${base}/api/students`, { headers: { cookie } });
    expect(students.status).toBe(401);
    const status = await fetch(`${base}/api/auth/status`, { headers: { cookie } });
    expect(status.status).toBe(200);
    expect(((await status.json()) as { user: unknown }).user).toBeNull();
  });

  test("sessions end after 30 days however active they are", () => {
    const token = createSession(db, users.buero.id);
    expect(sessionUser(db, token)).not.toBeNull();
    db.prepare(
      "UPDATE sessions SET created_at = datetime('now', '-31 days') WHERE user_id = ?",
    ).run(users.buero.id);
    expect(sessionUser(db, token)).toBeNull();
  });
});

describe("L1: CSRF on public and private writes", () => {
  test("text/plain bodies are refused with 415", async () => {
    for (const path of [
      "/api/auth/login",
      "/api/auth/setup",
      "/api/appointment-requests",
      `/api/auth/invite/${"x".repeat(43)}`,
    ]) {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ email: users.inhaber.email, password: PASSWORD }),
      });
      expect(res.status, path).toBe(415);
    }
    const signedIn = await fetch(`${base}/api/vehicles`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", cookie: sessionFor("inhaber") },
      body: "{}",
    });
    expect(signedIn.status).toBe(415);
  });

  test("a foreign Origin is refused on public writes; no Origin is fine", async () => {
    const evil = { Origin: "https://evil.example" };
    for (const path of [
      "/api/auth/login",
      "/api/auth/logout",
      "/api/appointment-requests",
    ]) {
      const res = await post(path, {}, undefined, evil);
      expect(res.status, path).toBe(403);
    }
    const same = await post(
      "/api/auth/login",
      {
        email: users.inhaber.email,
        password: PASSWORD,
      },
      undefined,
      { Origin: base },
    );
    expect(same.status).toBe(200);
    const none = await post("/api/auth/login", {
      email: users.inhaber.email,
      password: PASSWORD,
    });
    expect(none.status).toBe(200);
  });
});

describe("L4: portal tokens at rest", () => {
  test("the database holds only the hash of a created link", async () => {
    const studentId = db
      .query<{ id: number }, []>("SELECT id FROM students ORDER BY id LIMIT 1")
      .get()!.id;
    const res = await post(
      `/api/students/${studentId}/portal-link`,
      {},
      sessionFor("buero"),
    );
    const { token } = (await res.json()) as { token: string };
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(db.serialize()).toString("latin1")).not.toContain(token);
    expect((await fetch(`${base}/api/portal/${token}`)).status).toBe(200);
  });
});

describe("L5: security headers", () => {
  test("API responses carry the headers and are not cached", async () => {
    const res = await fetch(`${base}/api/students`, {
      headers: { cookie: sessionFor("buero") },
    });
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
    const unknown = await fetch(`${base}/api/gibt-es-nicht`);
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("X-Frame-Options")).toBe("DENY");
  });

  test("the SPA document gets the full policy", () => {
    const headers = documentHeaders({ hsts: true });
    expect(headers.get("Content-Security-Policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("script-src 'self' 'unsafe");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=");
  });
});

describe("multi-tenant mode", () => {
  const BASE = "openfs.test";
  let manager: TenantManager;
  let tenantServer: ReturnType<typeof serve>;
  let tenantUrl: string;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "openfs-security-"));
    manager = new TenantManager(Registry.open(":memory:"), { dir, baseDomain: BASE });
    tenantServer = serve({
      port: 0,
      routes: buildTenantApiRoutes(manager, {
        smtp: null,
        backups: null,
        fileStore: new TenantFileStore(new MemoryFileStore()),
        signup: true,
        signupRateLimit: false,
        signupGlobalRateLimit: false,
        loginRateLimit: false,
      }),
      fetch: () => new Response("not found", { status: 404 }),
    });
    tenantUrl = `http://127.0.0.1:${tenantServer.port}`;
    for (const slug of ["alpha", "beta"]) {
      await manager.provision({
        slug,
        schoolName: slug,
        ownerName: "Chef",
        email: `chef@${slug}.test`,
        password: PASSWORD,
      });
    }
  });

  afterAll(() => {
    tenantServer.stop(true);
    manager.closeAll();
    rmSync(dir, { recursive: true, force: true });
  });

  const at = (slug: string | null, init: RequestInit = {}) => ({
    ...init,
    headers: {
      ...JSON_HEADERS,
      // Without TRUST_PROXY the school comes from the Host header.
      Host: slug ? `${slug}.${BASE}` : BASE,
      ...(init.headers as Record<string, string>),
    },
  });

  test("a session cookie of one school is worthless at another", async () => {
    const login = await fetch(
      `${tenantUrl}/api/auth/login`,
      at("alpha", {
        method: "POST",
        body: JSON.stringify({ email: "chef@alpha.test", password: PASSWORD }),
      }),
    );
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const own = await fetch(
      `${tenantUrl}/api/students`,
      at("alpha", { headers: { cookie } }),
    );
    expect(own.status).toBe(200);
    const replay = await fetch(
      `${tenantUrl}/api/students`,
      at("beta", { headers: { cookie } }),
    );
    expect(replay.status).toBe(401);
  });

  test("signup: JSON and same origin only; a failed signup leaves no database file", async () => {
    const signup = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(
        `${tenantUrl}/api/platform/signup`,
        at(null, { method: "POST", body: JSON.stringify(body), headers }),
      );
    const valid = {
      slug: "gamma",
      schoolName: "Gamma",
      ownerName: "Chef",
      email: "chef@gamma.test",
      password: PASSWORD,
      acceptTerms: true,
    };
    expect((await signup(valid, { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await signup(valid, { Origin: "https://evil.example" })).status).toBe(403);

    // Too short a password: fails after the database was created.
    const failed = await signup({ ...valid, slug: "delta", password: "kurz" });
    expect(failed.status).toBe(400);
    expect(manager.registry.get("delta")).toBeNull();
    expect(existsSync(join(dir, "delta.db"))).toBe(false);

    expect((await signup(valid)).status).toBe(201);
    expect(existsSync(join(dir, "gamma.db"))).toBe(true);
  });
});
