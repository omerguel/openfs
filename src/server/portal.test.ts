/* ------------------------------------------------------------------ */
/* Schülerportal: token lifecycle, overview isolation, two-sided chat, */
/* student-delete cascade and the HTTP layer (staff + public routes,   */
/* generic 404s, per-IP rate limiting). In-memory DB only.             */
/* ------------------------------------------------------------------ */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { serve } from "bun";

import {
  ensureChatTables,
  getConversation,
  listConversations,
  sendMessage,
} from "./chat";
import { createCalendarEvent } from "./calendar-events";
import { openDb } from "./db";
import { listOutbox } from "./mail";
import {
  createPortalLink,
  ensurePortalTables,
  generatePortalToken,
  getActivePortalLink,
  getPortalOverview,
  listPortalMessages,
  portalRoutes,
  postPortalMessage,
  resolvePortalToken,
  revokePortalLinks,
  sendPortalLinkMail,
  type PortalOverview,
} from "./portal";
import { seedTransactions } from "./seed";
import type { Database } from "./sqlite";
import { createStudent, deleteStudent } from "./students";

let seq = 0;
function newStudent(db: Database, firstName = "Paula", email = "paula@example.de") {
  seq += 1;
  return createStudent(db, {
    firstName,
    lastName: "Portal",
    email,
    classes: "B",
    contractNumber: `V-P-${seq}`,
    customerNumber: `K-P-${seq}`,
  });
}

function lesson(db: Database, studentId: number, date: string, title = "Fahrstunde") {
  return createCalendarEvent(db, {
    date,
    start: "10:00",
    end: "11:00",
    title,
    instructor: "Nicht zugeteilt",
    type: "Praktisch",
    studentId,
  });
}

let db: Database;
beforeEach(() => {
  db = openDb(":memory:");
  seedTransactions(db);
  ensurePortalTables(db);
  ensureChatTables(db);
});

describe("tokens", () => {
  test("tokens are 32 random bytes in base64url", () => {
    const token = generatePortalToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generatePortalToken()).not.toBe(token);
  });

  test("creating a new link rotates (revokes) the old one", () => {
    const student = newStudent(db);
    const first = createPortalLink(db, student.id);
    const second = createPortalLink(db, student.id);
    expect(resolvePortalToken(db, first.token)).toBeNull();
    expect(resolvePortalToken(db, second.token)).toBe(student.id);
    expect(getActivePortalLink(db, student.id)?.token).toBe(second.token);
  });

  test("revoke disables the link", () => {
    const student = newStudent(db);
    const link = createPortalLink(db, student.id);
    expect(revokePortalLinks(db, student.id)).toBe(1);
    expect(resolvePortalToken(db, link.token)).toBeNull();
    expect(getActivePortalLink(db, student.id)).toBeNull();
  });

  test("malformed and unknown tokens resolve to null", () => {
    expect(resolvePortalToken(db, "abc")).toBeNull();
    expect(resolvePortalToken(db, "' OR 1=1 --")).toBeNull();
    expect(resolvePortalToken(db, generatePortalToken())).toBeNull();
  });

  test("unknown student → ValidationError", () => {
    expect(() => createPortalLink(db, 999_999)).toThrow("nicht gefunden");
  });

  test("deleting the student deletes their tokens", () => {
    const student = newStudent(db);
    const link = createPortalLink(db, student.id);
    deleteStudent(db, student.id);
    expect(resolvePortalToken(db, link.token)).toBeNull();
    const n = db
      .query<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM portal_tokens WHERE student_id = ?",
      )
      .get(student.id)!.n;
    expect(n).toBe(0);
  });
});

describe("getPortalOverview", () => {
  const NOW = new Date(2031, 2, 10, 12, 0); // 10.03.2031 12:00 local

  test("splits own lessons into upcoming and past, never others'", () => {
    const paula = newStudent(db);
    const other = newStudent(db, "Otto", "otto@example.de");
    lesson(db, paula.id, "2031-03-12");
    lesson(db, paula.id, "2031-03-01");
    lesson(db, paula.id, "2031-03-10"); // 10:00–11:00 today → already past
    lesson(db, other.id, "2031-03-12", "Otto Geheim");

    const overview = getPortalOverview(db, paula.id, NOW);
    expect(overview.student).toEqual({
      firstName: "Paula",
      lastName: "Portal",
      classes: "B",
    });
    expect(overview.upcomingLessons.map((l) => l.date)).toEqual(["2031-03-12"]);
    expect(overview.pastLessons.map((l) => l.date)).toEqual(["2031-03-10", "2031-03-01"]);
    expect(JSON.stringify(overview)).not.toContain("Otto");
    expect(Object.keys(overview.upcomingLessons[0]!).sort()).toEqual(
      ["date", "end", "instructor", "start", "title", "type"].sort(),
    );
    expect(overview.school.name.length).toBeGreaterThan(0);
  });

  test("balance comes from the Guthabenkonto by customer number", () => {
    // Seed student 1 (Lena Braun, 10057) has anzahlung bookings.
    expect(getPortalOverview(db, 1, NOW).balanceCents).toBe(40983);
    expect(getPortalOverview(db, newStudent(db).id, NOW).balanceCents).toBe(0);
  });
});

describe("portal chat", () => {
  test("GET is empty and read-only until the first message", () => {
    const student = newStudent(db);
    const before = listConversations(db).length;
    expect(listPortalMessages(db, student.id)).toEqual([]);
    expect(listConversations(db)).toHaveLength(before);
  });

  test("POST creates the thread as 'schueler' and bumps unread", () => {
    const student = newStudent(db);
    const message = postPortalMessage(db, student.id, "Hallo, kann ich verschieben?");
    expect(message.sender).toBe("schueler");
    const conversation = listConversations(db).find((c) => c.studentId === student.id)!;
    expect(conversation.unread).toBe(1);
    expect(conversation.studentName).toBe("Paula Portal");

    sendMessage(db, conversation.id, "Klar!");
    postPortalMessage(db, student.id, "Danke");
    expect(getConversation(db, conversation.id).unread).toBe(1);
    expect(listPortalMessages(db, student.id).map((m) => m.sender)).toEqual([
      "schueler",
      "schule",
      "schueler",
    ]);
  });

  test("empty messages are rejected", () => {
    const student = newStudent(db);
    expect(() => postPortalMessage(db, student.id, "  ")).toThrow("leer");
  });
});

describe("sendPortalLinkMail", () => {
  test("queues the link to the student's e-mail", () => {
    const student = newStudent(db);
    const entry = sendPortalLinkMail(db, student.id, "https://fs.example/irgendwas");
    const link = getActivePortalLink(db, student.id)!;
    expect(entry.kind).toBe("portal_link");
    expect(entry.recipient).toBe("paula@example.de");
    expect(entry.bodyText).toContain(`https://fs.example/portal/${link.token}`);
  });

  test("requires an e-mail address and an http(s) base URL", () => {
    const noMail = newStudent(db, "Nina", "");
    expect(() => sendPortalLinkMail(db, noMail.id, "https://x.de")).toThrow(
      "keine E-Mail",
    );
    const student = newStudent(db);
    expect(() => sendPortalLinkMail(db, student.id, "javascript:alert(1)")).toThrow(
      "Basis-URL",
    );
    expect(listOutbox(db)).toHaveLength(0);
  });
});

/* ------------------------------ routes ---------------------------- */

describe("portal routes", () => {
  const routeDb = openDb(":memory:");
  let server: ReturnType<typeof serve>;
  let limitedServer: ReturnType<typeof serve>;
  const url = (path: string, base = server.url) => new URL(path, base).href;

  beforeAll(() => {
    server = serve({
      port: 0,
      routes: portalRoutes(routeDb, { rateLimit: false }),
      fetch: () => new Response("not found", { status: 404 }),
    });
    limitedServer = serve({
      port: 0,
      routes: portalRoutes(routeDb, {
        rateLimit: {
          read: { max: 2, windowMs: 60_000 },
          write: { max: 1, windowMs: 60_000 },
        },
      }),
      fetch: () => new Response("not found", { status: 404 }),
    });
  });
  afterAll(() => {
    server.stop(true);
    limitedServer.stop(true);
  });

  test("staff: create, read, rotate and revoke a link", async () => {
    const student = newStudent(routeDb);
    const path = `/api/students/${student.id}/portal-link`;

    expect(await (await fetch(url(path))).json()).toEqual({ link: null });

    const created = await fetch(url(path), { method: "POST" });
    expect(created.status).toBe(201);
    const { token } = (await created.json()) as { token: string };
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const current = (await (await fetch(url(path))).json()) as {
      link: { token: string };
    };
    expect(current.link.token).toBe(token);

    const revoked = await fetch(url(path), { method: "DELETE" });
    expect(await revoked.json()).toEqual({ ok: true, revoked: 1 });
    expect((await fetch(url(`/api/portal/${token}`))).status).toBe(404);
  });

  test("staff: bad or unknown student ids → 400", async () => {
    expect((await fetch(url("/api/students/abc/portal-link"))).status).toBe(400);
    expect(
      (await fetch(url("/api/students/999999/portal-link"), { method: "POST" })).status,
    ).toBe(400);
  });

  test("public: overview and chat with a valid token", async () => {
    const student = newStudent(routeDb);
    const { token } = createPortalLink(routeDb, student.id);

    const res = await fetch(url(`/api/portal/${token}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const overview = (await res.json()) as PortalOverview;
    expect(overview.student.firstName).toBe("Paula");
    expect(overview).not.toHaveProperty("student.email");

    const post = await fetch(url(`/api/portal/${token}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hallo Fahrschule!" }),
    });
    expect(post.status).toBe(201);

    const list = (await (await fetch(url(`/api/portal/${token}/messages`))).json()) as {
      messages: { sender: string; text: string }[];
    };
    expect(list.messages).toEqual([
      expect.objectContaining({ sender: "schueler", text: "Hallo Fahrschule!" }),
    ]);

    const empty = await fetch(url(`/api/portal/${token}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "" }),
    });
    expect(empty.status).toBe(400);
  });

  test("public: unknown, malformed and revoked tokens get the same 404", async () => {
    const student = newStudent(routeDb);
    const { token } = createPortalLink(routeDb, student.id);
    revokePortalLinks(routeDb, student.id);
    const bodies = await Promise.all(
      [generatePortalToken(), "kurz", token].map(async (t) => {
        const res = await fetch(url(`/api/portal/${t}`));
        expect(res.status).toBe(404);
        return res.json();
      }),
    );
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect((bodies[0] as { error: string }).error).toContain("ungültig");

    const post = await fetch(url(`/api/portal/${token}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hallo" }),
    });
    expect(post.status).toBe(404);
  });

  test("public: rate-limited per IP (reads and writes separately)", async () => {
    const student = newStudent(routeDb);
    const { token } = createPortalLink(routeDb, student.id);
    const base = limitedServer.url;
    expect((await fetch(url(`/api/portal/${token}`, base))).status).toBe(200);
    expect((await fetch(url(`/api/portal/${token}/messages`, base))).status).toBe(200);
    const third = await fetch(url(`/api/portal/${token}`, base));
    expect(third.status).toBe(429);
    // Unknown tokens count against the limit too (no free guessing).
    expect((await fetch(url(`/api/portal/${generatePortalToken()}`, base))).status).toBe(
      429,
    );

    const send = () =>
      fetch(url(`/api/portal/${token}/messages`, base), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hallo" }),
      });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(429);
  });

  test("staff: portal link e-mail uses the request origin", async () => {
    const student = newStudent(routeDb, "Emil", "emil@example.de");
    const res = await fetch(url(`/api/students/${student.id}/portal-link/email`), {
      method: "POST",
      headers: { Origin: "https://schule.example" },
    });
    expect(res.status).toBe(201);
    const entry = (await res.json()) as { bodyText: string; recipient: string };
    expect(entry.recipient).toBe("emil@example.de");
    expect(entry.bodyText).toContain("https://schule.example/portal/");
  });
});
