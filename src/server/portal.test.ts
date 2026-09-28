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
import { deliverPending, listOutbox, OUTBOX_SECRET_PLACEHOLDER } from "./mail";
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
    expect(getActivePortalLink(db, student.id)).toEqual({
      createdAt: second.createdAt,
    });
  });

  test("only the SHA-256 of a token is stored", () => {
    const student = newStudent(db);
    const { token } = createPortalLink(db, student.id);
    const stored = db
      .query<{ token_hash: string }, [number]>(
        "SELECT token_hash FROM portal_tokens WHERE student_id = ?",
      )
      .all(student.id)
      .map((row) => row.token_hash);
    expect(stored).toEqual([new Bun.CryptoHasher("sha256").update(token).digest("hex")]);
    expect(Buffer.from(db.serialize()).toString("latin1")).not.toContain(token);
  });

  test("plaintext tokens of older databases are hashed in place and keep working", () => {
    const old = openDb(":memory:");
    old.exec(`CREATE TABLE portal_tokens (
      token TEXT PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT
    )`);
    const student = newStudent(old);
    const token = generatePortalToken();
    old
      .prepare("INSERT INTO portal_tokens (token, student_id) VALUES (?, ?)")
      .run(token, student.id);
    expect(resolvePortalToken(old, token)).toBe(student.id);
    const rows = old
      .query<{ token_hash: string }, []>("SELECT token_hash FROM portal_tokens")
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    ensurePortalTables(old);
    expect(resolvePortalToken(old, token)).toBe(student.id);
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

  test("progress counts held lessons, Sonderfahrten and Theorie units", () => {
    const paula = newStudent(db);
    lesson(db, paula.id, "2031-03-01");
    createCalendarEvent(db, {
      date: "2031-03-02",
      start: "20:00",
      end: "21:30",
      title: "Nachtfahrt",
      instructor: "Nicht zugeteilt",
      type: "Praktisch",
      lessonKind: "Nachtfahrt",
      studentId: paula.id,
    });
    lesson(db, paula.id, "2031-03-20"); // future — not held yet
    const { progress } = getPortalOverview(db, paula.id, NOW);
    expect(progress.practicalLessons).toBe(2);
    expect(progress.practicalMinutes).toBe(150);
    expect(progress.specialDrives.find((d) => d.kind === "Nachtfahrt")).toEqual({
      kind: "Nachtfahrt",
      completedMinutes: 90,
      requiredMinutes: 135,
    });
    expect(progress.theory).toEqual({ attended: 0, required: 14 });
  });

  test("documents list names only; open invoices appear when present", () => {
    const paula = newStudent(db);
    db.exec(`CREATE TABLE IF NOT EXISTS student_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
      name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL,
      sha256 TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, uploaded_at TEXT NOT NULL)`);
    db.prepare(
      `INSERT INTO student_files (student_id, name, mime_type, size, sha256, storage_key, uploaded_at)
       VALUES (?, 'Sehtest.pdf', 'application/pdf', 10, 'x', 'k1', '2031-03-01 10:00:00')`,
    ).run(paula.id);
    const overview = getPortalOverview(db, paula.id, NOW);
    expect(overview.documents).toEqual([
      { name: "Sehtest.pdf", uploadedAt: "2031-03-01 10:00:00" },
    ]);
    expect(JSON.stringify(overview.documents)).not.toContain("k1");
    expect(overview.openInvoices).toEqual([]);
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
    expect(entry.kind).toBe("portal_link");
    expect(entry.recipient).toBe("paula@example.de");
    // The outbox holds a placeholder, never a working token.
    expect(entry.bodyText).toContain(
      `https://fs.example/portal/${OUTBOX_SECRET_PLACEHOLDER}`,
    );
    expect(getActivePortalLink(db, student.id)).toBeNull();
  });

  test("delivery mints a working token for the mail; a failed send drops it", async () => {
    const student = newStudent(db);
    sendPortalLinkMail(db, student.id, "https://fs.example");
    const failing = { send: async () => Promise.reject(new Error("SMTP down")) };
    await deliverPending(db, failing);
    expect(getActivePortalLink(db, student.id)).toBeNull();

    const sent: string[] = [];
    await deliverPending(db, {
      send: async (mail) => {
        sent.push(mail.text);
      },
    });
    const token = sent[0]!.match(/\/portal\/([A-Za-z0-9_-]{43})/)![1]!;
    expect(resolvePortalToken(db, token)).toBe(student.id);
    // Still only the placeholder at rest.
    const [row] = listOutbox(db);
    expect(row!.bodyText).not.toContain(token);
    expect(row!.status).toBe("gesendet");
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

    // Afterwards only "active since" — the token is shown once.
    const current = (await (await fetch(url(path))).json()) as {
      link: Record<string, unknown>;
    };
    expect(Object.keys(current.link)).toEqual(["createdAt"]);

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
