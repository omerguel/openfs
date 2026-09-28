/* ------------------------------------------------------------------ */
/* Outbox: queueing, delivery with an injected fake transport, retry,  */
/* notification settings and the HTTP routes.                          */
/* ------------------------------------------------------------------ */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { serve } from "bun";

import { openDb } from "./db";
import { ValidationError } from "./engine";
import {
  deliverPending,
  ensureMailTables,
  getNotificationSettings,
  getOutboxEntry,
  listOutbox,
  mailRoutes,
  queueMail,
  retryOutboxEntry,
  setNotificationSettings,
  type OutboxEntry,
} from "./mail";
import type { Database } from "./sqlite";
import type { MailTransport, OutgoingMail } from "./smtp";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
  ensureMailTables(db);
});

const MAIL = {
  recipient: "lena@example.de",
  subject: "Hallo",
  bodyText: "Text",
  kind: "generic" as const,
};

function fakeTransport(failures = 0) {
  const sent: OutgoingMail[] = [];
  let remainingFailures = failures;
  const transport: MailTransport = {
    async send(mail) {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("421 Service not available");
      }
      sent.push(mail);
    },
  };
  return { transport, sent };
}

describe("queueMail", () => {
  test("stores a 'wartend' entry", () => {
    const entry = queueMail(db, MAIL)!;
    expect(entry).toMatchObject({
      recipient: "lena@example.de",
      status: "wartend",
      attempts: 0,
      kind: "generic",
      sentAt: null,
    });
    expect(listOutbox(db)).toHaveLength(1);
  });

  test("rejects invalid recipients and empty subjects", () => {
    expect(() => queueMail(db, { ...MAIL, recipient: "keine-mail" })).toThrow(
      ValidationError,
    );
    expect(() => queueMail(db, { ...MAIL, subject: "  " })).toThrow(ValidationError);
    expect(() => queueMail(db, { ...MAIL, bodyText: "" })).toThrow(ValidationError);
  });

  test("a second reminder for the same event is ignored", () => {
    const reminder = {
      ...MAIL,
      kind: "lesson_reminder" as const,
      relatedType: "calendar_event",
      relatedId: 7,
    };
    expect(queueMail(db, reminder)).not.toBeNull();
    expect(queueMail(db, reminder)).toBeNull();
    // Other kinds for the same event are not affected.
    expect(queueMail(db, { ...reminder, kind: "lesson_cancelled" })).not.toBeNull();
  });
});

describe("deliverPending", () => {
  test("sends pending mails and marks them 'gesendet'", async () => {
    const { transport, sent } = fakeTransport();
    const entry = queueMail(db, MAIL)!;
    const result = await deliverPending(db, transport);
    expect(result.sent).toBe(1);
    expect(sent).toEqual([{ to: "lena@example.de", subject: "Hallo", text: "Text" }]);
    const after = getOutboxEntry(db, entry.id);
    expect(after.status).toBe("gesendet");
    expect(after.attempts).toBe(1);
    expect(after.sentAt).not.toBeNull();
  });

  test("retries up to 3 attempts, then 'fehlgeschlagen'", async () => {
    const { transport } = fakeTransport(10);
    const entry = queueMail(db, MAIL)!;

    await deliverPending(db, transport);
    let after = getOutboxEntry(db, entry.id);
    expect(after.status).toBe("wartend");
    expect(after.attempts).toBe(1);
    expect(after.lastError).toContain("421");

    await deliverPending(db, transport);
    const result = await deliverPending(db, transport);
    after = getOutboxEntry(db, entry.id);
    expect(result.failed).toBe(1);
    expect(after.status).toBe("fehlgeschlagen");
    expect(after.attempts).toBe(3);

    // No further attempts once failed.
    await deliverPending(db, transport);
    expect(getOutboxEntry(db, entry.id).attempts).toBe(3);
  });

  test("a transient failure followed by success ends 'gesendet'", async () => {
    const { transport, sent } = fakeTransport(1);
    const entry = queueMail(db, MAIL)!;
    await deliverPending(db, transport);
    await deliverPending(db, transport);
    expect(getOutboxEntry(db, entry.id).status).toBe("gesendet");
    expect(sent).toHaveLength(1);
  });

  test("without transport pending mails become 'nicht_konfiguriert'", async () => {
    const entry = queueMail(db, MAIL)!;
    const result = await deliverPending(db, null);
    expect(result.notConfigured).toBe(1);
    expect(getOutboxEntry(db, entry.id).status).toBe("nicht_konfiguriert");
  });

  test("concurrent runs never send the same mail twice", async () => {
    const sent: string[] = [];
    const slow: MailTransport = {
      send: async (mail) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        sent.push(mail.to);
      },
    };
    queueMail(db, MAIL);
    await Promise.all([deliverPending(db, slow), deliverPending(db, slow)]);
    expect(sent).toHaveLength(1);
  });
});

describe("retryOutboxEntry", () => {
  test("resets a failed mail to 'wartend' with a fresh attempt budget", async () => {
    const entry = queueMail(db, MAIL)!;
    await deliverPending(db, null);
    const retried = retryOutboxEntry(db, entry.id);
    expect(retried.status).toBe("wartend");
    expect(retried.attempts).toBe(0);
    expect(retried.lastError).toBeNull();
  });

  test("rejects mails that are already waiting", () => {
    const entry = queueMail(db, MAIL)!;
    expect(() => retryOutboxEntry(db, entry.id)).toThrow("wartet bereits");
  });
});

describe("notification settings", () => {
  test("defaults to everything on", () => {
    expect(getNotificationSettings(db)).toEqual({
      appointmentMails: true,
      lessonReminders: true,
      lessonCancellations: true,
    });
  });

  test("partial updates persist and validate types", () => {
    setNotificationSettings(db, { lessonReminders: false });
    expect(getNotificationSettings(db)).toMatchObject({
      appointmentMails: true,
      lessonReminders: false,
    });
    expect(() =>
      setNotificationSettings(db, { appointmentMails: "ja" as unknown as boolean }),
    ).toThrow(ValidationError);
  });
});

/* ------------------------------ routes ---------------------------- */

describe("mail routes", () => {
  const routeDb = openDb(":memory:");
  let server: ReturnType<typeof serve>;
  const url = (path: string) => new URL(path, server.url).href;

  beforeAll(() => {
    server = serve({
      port: 0,
      routes: mailRoutes(routeDb, { config: null }),
      fetch: () => new Response("not found", { status: 404 }),
    });
  });
  afterAll(() => server.stop(true));

  test("GET /api/mail/status reports the missing configuration", async () => {
    const res = await fetch(url("/api/mail/status"));
    expect(await res.json()).toEqual({ configured: false, from: "" });
  });

  test("POST /api/outbox queues a generic mail with signature", async () => {
    const res = await fetch(url("/api/outbox"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: "tom@example.de",
        subject: "Unterlagen",
        body: "Bitte Sehtest mitbringen.",
        studentId: 3,
      }),
    });
    expect(res.status).toBe(201);
    const entry = (await res.json()) as OutboxEntry;
    expect(entry.kind).toBe("generic");
    expect(entry.relatedType).toBe("student");
    expect(entry.bodyText).toContain("Bitte Sehtest mitbringen.");
    expect(entry.bodyText).toContain("Viele Grüße");
  });

  test("POST /api/outbox validates input with German errors", async () => {
    const res = await fetch(url("/api/outbox"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: "x", subject: "a", body: "b" }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("E-Mail");
  });

  test("GET /api/outbox lists and filters by status", async () => {
    await deliverPending(routeDb, null);
    const all = (await (await fetch(url("/api/outbox"))).json()) as {
      items: OutboxEntry[];
    };
    expect(all.items.length).toBeGreaterThan(0);
    const filtered = (await (await fetch(url("/api/outbox?status=gesendet"))).json()) as {
      items: OutboxEntry[];
    };
    expect(filtered.items).toHaveLength(0);
    const bad = await fetch(url("/api/outbox?status=kaputt"));
    expect(bad.status).toBe(400);
  });

  test("POST /api/outbox/:id/retry resets to 'wartend'", async () => {
    const [entry] = listOutbox(routeDb, { status: "nicht_konfiguriert" });
    const res = await fetch(url(`/api/outbox/${entry!.id}/retry`), { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as OutboxEntry).status).toBe("wartend");
    const bad = await fetch(url("/api/outbox/abc/retry"), { method: "POST" });
    expect(bad.status).toBe(400);
  });

  test("GET/PUT /api/settings/notifications", async () => {
    const put = await fetch(url("/api/settings/notifications"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentMails: false }),
    });
    expect(put.status).toBe(200);
    const get = await fetch(url("/api/settings/notifications"));
    expect(await get.json()).toEqual({
      appointmentMails: false,
      lessonReminders: true,
      lessonCancellations: true,
    });
  });
});
