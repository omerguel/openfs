/* Login, roles, sessions, audit log and first-run setup — through a real
   Bun.serve() with the fully protected route table. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { serve } from "bun";

import { API_NOT_FOUND, buildApiRoutes } from "./app-routes";
import { createUser, isAllowed, isPublic, updateUser } from "./auth";
import { ensureChatTables } from "./chat";
import { getCompany, openDb } from "./db";
import { listAccounts, listLedger, ValidationError } from "./engine";
import { applySetup } from "./setup";
import type { Database } from "./sqlite";
import { listStudents } from "./students";

let db: Database;
let server: ReturnType<typeof serve>;
let base: string;

function start(options: Parameters<typeof buildApiRoutes>[1] = {}) {
  server = serve({
    port: 0,
    routes: buildApiRoutes(db, {
      ...options,
      auth: { loginRateLimit: false, onSetup: applySetup, ...options.auth },
    }),
    fetch: () => new Response("not found", { status: 404 }),
  });
  base = `http://localhost:${server.port}`;
}

beforeEach(() => {
  db = openDb(":memory:");
});
afterEach(() => server?.stop(true));

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Strict");
  return cookie.split(";")[0]!;
}

const as = (cookie: string, init: RequestInit = {}) => ({
  ...init,
  headers: { "Content-Type": "application/json", ...init.headers, cookie },
});

async function seedUsers() {
  await createUser(db, {
    email: "chefin@fs.de",
    name: "Chefin",
    password: "geheim-geheim",
    role: "inhaber",
  });
  await createUser(db, {
    email: "buero@fs.de",
    name: "Büro",
    password: "geheim-geheim",
    role: "buero",
  });
  await createUser(db, {
    email: "lehrer@fs.de",
    name: "Lehrer",
    password: "geheim-geheim",
    role: "fahrlehrer",
  });
}

describe("sessions", () => {
  test("API requires a session; login sets it, logout ends it", async () => {
    await seedUsers();
    start();
    expect((await fetch(`${base}/api/students`)).status).toBe(401);

    const bad = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email: "chefin@fs.de", password: "falsch-falsch" }),
    });
    expect(bad.status).toBe(401);

    const cookie = await login("chefin@fs.de", "geheim-geheim");
    expect((await fetch(`${base}/api/students`, as(cookie))).status).toBe(200);
    const status = (await (
      await fetch(`${base}/api/auth/status`, as(cookie))
    ).json()) as {
      user: { email: string; role: string };
    };
    expect(status.user).toMatchObject({ email: "chefin@fs.de", role: "inhaber" });

    await fetch(`${base}/api/auth/logout`, as(cookie, { method: "POST" }));
    expect((await fetch(`${base}/api/students`, as(cookie))).status).toBe(401);
  });

  test("only the hash of the token is stored", async () => {
    await seedUsers();
    start();
    const cookie = await login("chefin@fs.de", "geheim-geheim");
    const token = cookie.split("=")[1]!;
    const stored = db
      .query<{ token_hash: string }, []>("SELECT token_hash FROM sessions")
      .get()!;
    expect(stored.token_hash).not.toBe(token);
    expect(stored.token_hash).toHaveLength(64);
  });

  test("deactivating a user ends their sessions", async () => {
    await seedUsers();
    start();
    const cookie = await login("buero@fs.de", "geheim-geheim");
    const buero = db
      .query<{ id: number }, []>("SELECT id FROM users WHERE role = 'buero'")
      .get()!;
    await updateUser(db, buero.id, { active: false });
    expect((await fetch(`${base}/api/students`, as(cookie))).status).toBe(401);
  });

  test("cross-origin writes are refused", async () => {
    await seedUsers();
    start();
    const cookie = await login("chefin@fs.de", "geheim-geheim");
    const res = await fetch(
      `${base}/api/vehicles`,
      as(cookie, {
        method: "POST",
        headers: { Origin: "https://evil.example" },
        body: JSON.stringify({ model: "X", plate: "X-1", klass: "B" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  test("login is rate limited per IP and e-mail", async () => {
    await seedUsers();
    start({ auth: { loginRateLimit: { max: 2, windowMs: 60_000 } } });
    const attempt = () =>
      fetch(`${base}/api/auth/login`, {
        method: "POST",
        body: JSON.stringify({ email: "chefin@fs.de", password: "falsch-falsch" }),
      });
    await attempt();
    await attempt();
    expect((await attempt()).status).toBe(429);
  });

  test("only failed logins count; a successful login resets the counter", async () => {
    await seedUsers();
    start({ auth: { loginRateLimit: { max: 2, windowMs: 60_000 } } });
    const attempt = (password: string) =>
      fetch(`${base}/api/auth/login`, {
        method: "POST",
        body: JSON.stringify({ email: "chefin@fs.de", password }),
      });
    // Many successful sign-ins never lock the account.
    for (let i = 0; i < 5; i++) {
      expect((await attempt("geheim-geheim")).status).toBe(200);
    }
    // One failure, then success resets: two more failures are still allowed.
    expect((await attempt("falsch-falsch")).status).toBe(401);
    expect((await attempt("geheim-geheim")).status).toBe(200);
    expect((await attempt("falsch-falsch")).status).toBe(401);
    expect((await attempt("falsch-falsch")).status).toBe(401);
    // Now blocked — even the right password waits for the window to pass.
    expect((await attempt("geheim-geheim")).status).toBe(429);
  });
});

describe("unknown API paths", () => {
  test("answer with a JSON 404 instead of the SPA page", async () => {
    await seedUsers();
    server = serve({
      port: 0,
      routes: {
        "/*": new Response("<!doctype html>", {
          headers: { "Content-Type": "text/html" },
        }),
        ...API_NOT_FOUND,
        ...buildApiRoutes(db, { auth: { loginRateLimit: false } }),
      },
    });
    base = `http://localhost:${server.port}`;
    const cookie = await login("chefin@fs.de", "geheim-geheim");
    const unknown = await fetch(`${base}/api/gibt-es-nicht`, as(cookie));
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("content-type")).toContain("application/json");
    expect(((await unknown.json()) as { error: string }).error).toContain("API");
    // Known endpoints and SPA pages are unaffected.
    expect((await fetch(`${base}/api/students`, as(cookie))).status).toBe(200);
    expect(await (await fetch(`${base}/fahrschueler`)).text()).toContain("doctype");
  });
});

describe("roles", () => {
  test("Fahrlehrer: calendar yes, finances and master data writes no", async () => {
    await seedUsers();
    start();
    const cookie = await login("lehrer@fs.de", "geheim-geheim");
    expect((await fetch(`${base}/api/students`, as(cookie))).status).toBe(200);
    expect((await fetch(`${base}/api/invoices`, as(cookie))).status).toBe(403);
    expect((await fetch(`${base}/api/accounting/transactions`, as(cookie))).status).toBe(
      403,
    );
    const newStudent = await fetch(
      `${base}/api/students`,
      as(cookie, { method: "POST", body: JSON.stringify({ firstName: "A" }) }),
    );
    expect(newStudent.status).toBe(403);
    const event = await fetch(
      `${base}/api/calendar-events`,
      as(cookie, {
        method: "POST",
        body: JSON.stringify({
          date: "2026-07-01",
          start: "08:00",
          end: "08:45",
          title: "Fahrstunde",
          type: "Praktisch",
        }),
      }),
    );
    expect(event.status).toBe(201);
  });

  test("Büro: everything but user admin and the protocol", async () => {
    await seedUsers();
    start();
    const cookie = await login("buero@fs.de", "geheim-geheim");
    expect((await fetch(`${base}/api/invoices`, as(cookie))).status).toBe(200);
    expect((await fetch(`${base}/api/users`, as(cookie))).status).toBe(403);
    expect((await fetch(`${base}/api/audit-log`, as(cookie))).status).toBe(403);
  });

  test("policy table", () => {
    expect(isPublic("POST", "/api/appointment-requests")).toBe(true);
    expect(isPublic("GET", "/api/appointment-requests")).toBe(false);
    expect(isPublic("GET", "/api/portal/abc")).toBe(true);
    expect(isAllowed("fahrlehrer", "POST", "/api/calendar-events/3/bill")).toBe(false);
    expect(isAllowed("fahrlehrer", "POST", "/api/calendar-events/3/cancel")).toBe(true);
    expect(isAllowed("buero", "GET", "/api/admin/backups")).toBe(false);
    // Integrations: office work, not for Fahrlehrer.
    expect(isPublic("PUT", "/api/appointment-requests/4/student")).toBe(false);
    expect(isAllowed("fahrlehrer", "POST", "/api/outbox/sms")).toBe(false);
    expect(isAllowed("fahrlehrer", "POST", "/api/reviews/import/google")).toBe(false);
    expect(isAllowed("fahrlehrer", "PUT", "/api/appointment-requests/4/student")).toBe(
      false,
    );
    expect(isAllowed("buero", "POST", "/api/outbox/sms")).toBe(true);
    // Umsatz statistics are money matters.
    expect(isAllowed("fahrlehrer", "GET", "/api/statistics")).toBe(false);
    expect(isAllowed("buero", "GET", "/api/statistics")).toBe(true);
  });

  test("Büro cannot change tax numbers or the IBAN; the Inhaber can", async () => {
    await seedUsers();
    start();
    const put = (cookie: string, body: object) =>
      fetch(
        `${base}/api/profile`,
        as(cookie, { method: "PUT", body: JSON.stringify(body) }),
      );
    const office = await login("buero@fs.de", "geheim-geheim");
    expect((await put(office, { phone: "06151 99" })).status).toBe(200);
    const denied = await put(office, { steuernummer: "045/123/45678" });
    expect(denied.status).toBe(403);
    const owner = await login("chefin@fs.de", "geheim-geheim");
    expect((await put(owner, { steuernummer: "045/123/45678" })).status).toBe(200);
    const instructor = await login("lehrer@fs.de", "geheim-geheim");
    expect((await put(instructor, { phone: "1" })).status).toBe(403);
  });

  test("the last Inhaber cannot be demoted or deactivated", async () => {
    await seedUsers();
    const owner = db
      .query<{ id: number }, []>("SELECT id FROM users WHERE role = 'inhaber'")
      .get()!;
    await expect(updateUser(db, owner.id, { role: "buero" })).rejects.toThrow(
      ValidationError,
    );
    await expect(updateUser(db, owner.id, { active: false })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("user admin + audit log", () => {
  test("Inhaber creates users; writes land in the protocol", async () => {
    await seedUsers();
    start();
    const cookie = await login("chefin@fs.de", "geheim-geheim");
    const created = await fetch(
      `${base}/api/users`,
      as(cookie, {
        method: "POST",
        body: JSON.stringify({
          email: "neu@fs.de",
          name: "Neu",
          password: "kurz",
          role: "buero",
        }),
      }),
    );
    expect(created.status).toBe(400); // password too short
    const log = (await (await fetch(`${base}/api/audit-log`, as(cookie))).json()) as {
      entries: { userEmail: string; method: string; path: string; status: number }[];
    };
    expect(log.entries[0]).toMatchObject({
      userEmail: "chefin@fs.de",
      method: "POST",
      path: "/api/users",
      status: 400,
    });
    expect(log.entries.some((e) => e.method === "LOGIN" && e.status === 200)).toBe(true);
  });

  test("password change needs the current password", async () => {
    await seedUsers();
    start();
    const cookie = await login("lehrer@fs.de", "geheim-geheim");
    const wrong = await fetch(
      `${base}/api/auth/password`,
      as(cookie, {
        method: "POST",
        body: JSON.stringify({ current: "nope-nope-nope", next: "neues-passwort-1" }),
      }),
    );
    expect(wrong.status).toBe(400);
    const ok = await fetch(
      `${base}/api/auth/password`,
      as(cookie, {
        method: "POST",
        body: JSON.stringify({ current: "geheim-geheim", next: "neues-passwort-1" }),
      }),
    );
    expect(ok.status).toBe(200);
    await login("lehrer@fs.de", "neues-passwort-1");
  });
});

describe("first-run setup of a real school", () => {
  test("an empty school starts without demo data", () => {
    const fresh = openDb(":memory:", { demoData: false });
    ensureChatTables(fresh);
    expect(listStudents(fresh)).toEqual([]);
    expect(listLedger(fresh, {}).rows).toEqual([]);
    expect(listAccounts(fresh).find((a) => a.number === "1600")?.openingCents).toBeNull();
    expect(fresh.query("SELECT count(*) AS n FROM conversations").get()).toEqual({
      n: 0,
    });
    expect(getCompany(fresh).name).toBe("");
  });

  test("setup creates the Inhaber, the company data and opening balances — once", async () => {
    db = openDb(":memory:", { demoData: false });
    start();
    const status = (await (await fetch(`${base}/api/auth/status`)).json()) as {
      setupRequired: boolean;
    };
    expect(status.setupRequired).toBe(true);

    const body = {
      email: "inhaber@meine-fs.de",
      name: "Ina Haber",
      password: "sehr-geheim-1",
      schoolName: "Fahrschule Haber",
      address: "Hauptstr. 1, 12345 Musterstadt",
      openingDate: "2026-01-01",
      kasseCents: 50_000,
      bankCents: 1_200_000,
    };
    const res = await fetch(`${base}/api/auth/setup`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toContain("openfs_session=");
    expect(getCompany(db).name).toBe("Fahrschule Haber");
    const accounts = new Map(listAccounts(db).map((a) => [a.number, a]));
    expect(accounts.get("1600")?.openingCents).toBe(50_000);
    expect(accounts.get("1800")?.openingCents).toBe(1_200_000);

    const again = await fetch(`${base}/api/auth/setup`, {
      method: "POST",
      body: JSON.stringify({ ...body, email: "zweiter@fs.de" }),
    });
    expect(again.status).toBe(409);
  });

  test("setup without a school name creates no account", async () => {
    db = openDb(":memory:", { demoData: false });
    start();
    const res = await fetch(`${base}/api/auth/setup`, {
      method: "POST",
      body: JSON.stringify({ email: "a@b.de", name: "A", password: "sehr-geheim-1" }),
    });
    expect(res.status).toBe(400);
    expect(db.query("SELECT count(*) AS n FROM users").get()).toEqual({ n: 0 });
  });
});
