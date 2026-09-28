/* ------------------------------------------------------------------ */
/* SMS: number normalisation, segment math, the seven.io and webhook   */
/* adapters (injected fetch — never the network), outbox delivery on   */
/* the 'sms' channel and the idempotent SMS lesson reminder.           */
/* ------------------------------------------------------------------ */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { serve } from "bun";

import { createCalendarEvent } from "./calendar-events";
import { getCompany, openDb, setCompany } from "./db";
import {
  deliverPending,
  ensureMailTables,
  listOutbox,
  mailRoutes,
  queueMail,
  queueSms,
  setNotificationSettings,
  type OutboxEntry,
} from "./mail";
import { lessonReminderSmsText } from "./mail-templates";
import { queueLessonReminderSms } from "./notifications";
import {
  createSmsTransport,
  isGermanMobile,
  normalizePhoneNumber,
  prepareSmsText,
  sanitizeSender,
  SEVEN_ENDPOINT,
  sevenReturnCode,
  smsConfigFromEnv,
  smsSegments,
  type FetchLike,
  type SmsConfig,
  type SmsTransport,
} from "./sms";
import type { Database } from "./sqlite";
import { createStudent } from "./students";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init = {}) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  return { fetchImpl, calls };
}

const SEVEN: SmsConfig = {
  provider: "seven",
  apiKey: "test-key",
  from: "FSDemo",
  webhookUrl: "",
};

describe("normalizePhoneNumber", () => {
  test("German formats become E.164", () => {
    expect(normalizePhoneNumber("0151 234 567-80")).toBe("+4915123456780");
    expect(normalizePhoneNumber("+49 (0)151/23456780")).toBe("+4915123456780");
    expect(normalizePhoneNumber("0049 160 9876512")).toBe("+491609876512");
    expect(normalizePhoneNumber("+49 151 1000 2000")).toBe("+4915110002000");
    expect(normalizePhoneNumber("+43 664 1234567")).toBe("+436641234567");
  });

  test("rejects implausible numbers", () => {
    expect(normalizePhoneNumber("")).toBeNull();
    expect(normalizePhoneNumber("12345")).toBeNull();
    expect(normalizePhoneNumber("0151 abc")).toBeNull();
    expect(normalizePhoneNumber("+49 151")).toBeNull();
  });

  test("isGermanMobile tells mobile from landline", () => {
    expect(isGermanMobile("+4915123456780")).toBe(true);
    expect(isGermanMobile("+496151123456")).toBe(false);
  });
});

describe("segments", () => {
  test("GSM text with umlauts stays 7-bit", () => {
    expect(smsSegments("Grüße aus Köln, Straße")).toMatchObject({
      encoding: "gsm",
      segments: 1,
    });
    expect(smsSegments("a".repeat(160)).segments).toBe(1);
    expect(smsSegments("a".repeat(161)).segments).toBe(2);
    // € is an extension character and counts twice.
    expect(smsSegments("€".repeat(80)).segments).toBe(1);
    expect(smsSegments("€".repeat(81)).segments).toBe(2);
  });

  test("non-GSM characters switch to UCS-2", () => {
    expect(smsSegments("Termin – morgen")).toMatchObject({ encoding: "ucs2" });
    expect(smsSegments("–".repeat(71)).segments).toBe(2);
  });

  test("prepareSmsText keeps short texts and cuts long ones politely", () => {
    expect(prepareSmsText("  Hallo  ")).toBe("Hallo");
    const long = "Wort ".repeat(200);
    const cut = prepareSmsText(long);
    expect(cut.endsWith("...")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(459);
    expect(smsSegments(cut).segments).toBe(3);
    expect(cut).not.toContain("Wor...");
  });
});

describe("config", () => {
  test("reads the SMS_* variables", () => {
    expect(smsConfigFromEnv({})).toBeNull();
    expect(smsConfigFromEnv({ SMS_PROVIDER: "seven" })).toBeNull();
    expect(
      smsConfigFromEnv({
        SMS_PROVIDER: "seven",
        SMS_API_KEY: "k",
        SMS_FROM: "Fahrschule Demo GmbH",
      }),
    ).toEqual({ provider: "seven", apiKey: "k", from: "FahrschuleD", webhookUrl: "" });
    expect(smsConfigFromEnv({ SMS_PROVIDER: "webhook" })).toBeNull();
    expect(
      smsConfigFromEnv({
        SMS_PROVIDER: "webhook",
        SMS_WEBHOOK_URL: "https://hooks.example/sms",
      }),
    ).toMatchObject({ provider: "webhook", webhookUrl: "https://hooks.example/sms" });
    expect(sanitizeSender("Fahr-Schule!")).toBe("FahrSchule");
  });
});

describe("seven.io adapter", () => {
  test("posts form fields with X-Api-Key and accepts success 100", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      Response.json({ success: "100", total_price: 0.075, messages: [] }),
    );
    await createSmsTransport(SEVEN, fetchImpl).send({
      to: "+4915123456780",
      text: "Hallo",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(SEVEN_ENDPOINT);
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBe("test-key");
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get("to")).toBe("+4915123456780");
    expect(form.get("text")).toBe("Hallo");
    expect(form.get("from")).toBe("FSDemo");
    expect(form.get("json")).toBe("1");
  });

  test("error codes become readable German errors", async () => {
    const { fetchImpl } = fakeFetch(() => Response.json({ success: "500" }));
    await expect(
      createSmsTransport(SEVEN, fetchImpl).send({ to: "+4915123456780", text: "x" }),
    ).rejects.toThrow("seven.io 500: Guthaben");
    const http = fakeFetch(() => new Response("nope", { status: 502 }));
    await expect(
      createSmsTransport(SEVEN, http.fetchImpl).send({ to: "+491511", text: "x" }),
    ).rejects.toThrow("HTTP 502");
  });

  test("reads plain-text and JSON return codes", () => {
    expect(sevenReturnCode("100\n123456789\n0.075")).toBe("100");
    expect(sevenReturnCode('{"success":"100"}')).toBe("100");
    expect(sevenReturnCode('{"success":100}')).toBe("100");
    expect(sevenReturnCode("900")).toBe("900");
  });
});

describe("webhook adapter", () => {
  test("posts JSON {to, text, from}", async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    await createSmsTransport(
      {
        provider: "webhook",
        apiKey: "",
        from: "FSDemo",
        webhookUrl: "https://h.example/x",
      },
      fetchImpl,
    ).send({ to: "+4915123456780", text: "Hallo" });
    expect(calls[0]!.url).toBe("https://h.example/x");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      to: "+4915123456780",
      text: "Hallo",
      from: "FSDemo",
    });
  });

  test("non-2xx fails", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("x", { status: 500 }));
    await expect(
      createSmsTransport(
        { provider: "webhook", apiKey: "", from: "", webhookUrl: "https://h.example/x" },
        fetchImpl,
      ).send({ to: "+4915123456780", text: "Hallo" }),
    ).rejects.toThrow("HTTP 500");
  });
});

/* ------------------------------ outbox ---------------------------- */

let db: Database;
beforeEach(() => {
  db = openDb(":memory:");
  ensureMailTables(db);
});

function recordingSms(failures = 0) {
  const sent: { to: string; text: string }[] = [];
  let remaining = failures;
  const transport: SmsTransport = {
    async send(sms) {
      if (remaining > 0) {
        remaining -= 1;
        throw new Error("seven.io 600: Fehler beim Mobilfunkbetreiber");
      }
      sent.push(sms);
    },
  };
  return { transport, sent };
}

describe("SMS in the outbox", () => {
  test("queueSms normalises the number and stores channel 'sms'", () => {
    const entry = queueSms(db, {
      recipient: "0151 23456780",
      text: "Hallo Mia",
      kind: "generic",
    })!;
    expect(entry).toMatchObject({
      channel: "sms",
      recipient: "+4915123456780",
      subject: "",
      bodyText: "Hallo Mia",
      status: "wartend",
    });
    expect(() => queueSms(db, { recipient: "abc", text: "x", kind: "generic" })).toThrow(
      "Handynummer",
    );
    expect(() =>
      queueSms(db, { recipient: "0151 23456780", text: " ", kind: "generic" }),
    ).toThrow("leer");
  });

  test("delivery routes each channel to its own transport", async () => {
    queueMail(db, {
      recipient: "mia@example.de",
      subject: "Hallo",
      bodyText: "Text",
      kind: "generic",
    });
    queueSms(db, { recipient: "0151 23456780", text: "Hallo", kind: "generic" });
    const sms = recordingSms();
    const result = await deliverPending(db, null, { sms: sms.transport });
    expect(result).toMatchObject({ sent: 1, notConfigured: 1 });
    expect(sms.sent).toEqual([{ to: "+4915123456780", text: "Hallo" }]);
    const byChannel = Object.fromEntries(
      listOutbox(db).map((entry) => [entry.channel, entry.status]),
    );
    expect(byChannel).toEqual({ email: "nicht_konfiguriert", sms: "gesendet" });
  });

  test("failed SMS retry with the shared attempt budget", async () => {
    queueSms(db, { recipient: "0151 23456780", text: "Hallo", kind: "generic" });
    const sms = recordingSms(5);
    await deliverPending(db, null, { sms: sms.transport, maxAttempts: 2 });
    expect(listOutbox(db)[0]).toMatchObject({ status: "wartend", attempts: 1 });
    await deliverPending(db, null, { sms: sms.transport, maxAttempts: 2 });
    expect(listOutbox(db)[0]).toMatchObject({ status: "fehlgeschlagen", attempts: 2 });
    expect(listOutbox(db)[0]!.lastError).toContain("seven.io 600");
  });

  test("without an SMS transport SMS become 'nicht_konfiguriert'", async () => {
    queueSms(db, { recipient: "0151 23456780", text: "Hallo", kind: "generic" });
    await deliverPending(db, null);
    expect(listOutbox(db, { channel: "sms" })[0]!.status).toBe("nicht_konfiguriert");
  });

  test("an old outbox without channel column is migrated", () => {
    const old = openDb(":memory:");
    old.exec(`CREATE TABLE outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, recipient TEXT NOT NULL,
      subject TEXT NOT NULL, body_text TEXT NOT NULL, kind TEXT NOT NULL,
      related_type TEXT, related_id INTEGER,
      status TEXT NOT NULL DEFAULT 'wartend', attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT)`);
    old.exec(
      "INSERT INTO outbox (recipient, subject, body_text, kind) VALUES ('a@b.de', 'S', 'T', 'generic')",
    );
    ensureMailTables(old);
    expect(listOutbox(old)[0]!.channel).toBe("email");
  });
});

/* ---------------------------- reminders --------------------------- */

describe("queueLessonReminderSms", () => {
  let seq = 0;
  const DATE = "2031-03-11";

  function lessonFor(phone: string, type = "Praktisch") {
    seq += 1;
    const student = createStudent(db, {
      firstName: "Mia",
      lastName: "Muster",
      phone,
      contractNumber: `V-S-${seq}`,
      customerNumber: `K-S-${seq}`,
    });
    return createCalendarEvent(db, {
      date: DATE,
      start: "10:00",
      end: "11:30",
      title: "Mia Muster",
      instructor: "Nicht zugeteilt",
      type: type as "Praktisch",
      studentId: student.id,
    });
  }

  beforeEach(() => {
    setCompany(db, { ...getCompany(db), name: "Fahrschule Demo", phone: "06151 123456" });
  });

  test("is off by default", () => {
    lessonFor("0151 23456780");
    expect(queueLessonReminderSms(db, "2031-03-10")).toBe(0);
  });

  test("queues one SMS per lesson tomorrow, idempotently", () => {
    setNotificationSettings(db, { smsReminders: true });
    const event = lessonFor("0151 23456780");
    lessonFor(""); // no phone → skipped
    lessonFor("keine Nummer"); // implausible → skipped
    lessonFor("0151 99999999", "Theorie"); // Theorie gets no reminder
    expect(queueLessonReminderSms(db, "2031-03-10")).toBe(1);
    expect(queueLessonReminderSms(db, "2031-03-10")).toBe(0);
    const [sms] = listOutbox(db, { channel: "sms" });
    expect(sms).toMatchObject({
      recipient: "+4915123456780",
      kind: "lesson_reminder_sms",
      relatedType: "calendar_event",
      relatedId: Number(event.id),
    });
    expect(sms!.bodyText).toContain("Fahrstunde morgen (11.03.) um 10:00 Uhr");
    expect(smsSegments(sms!.bodyText).encoding).toBe("gsm");
  });

  test("the text fits a single GSM segment in the common case", () => {
    const text = lessonReminderSmsText(
      {
        firstName: "Mia",
        type: "Praktisch",
        date: DATE,
        start: "10:00",
        end: "11:30",
        instructor: "Nadine Aksoy",
      },
      { name: "Fahrschule Demo", phone: "06151 123456", address: "", email: "" },
    );
    expect(smsSegments(text)).toMatchObject({ encoding: "gsm", segments: 1 });
  });
});

/* ------------------------------ routes ---------------------------- */

describe("SMS routes", () => {
  const routeDb = openDb(":memory:");
  let server: ReturnType<typeof serve>;
  const url = (path: string) => new URL(path, server.url).href;

  beforeAll(() => {
    server = serve({
      port: 0,
      routes: mailRoutes(routeDb, { config: null, sms: SEVEN }),
      fetch: () => new Response("not found", { status: 404 }),
    });
  });
  afterAll(() => server.stop(true));

  test("status reports the SMS provider", async () => {
    const res = await fetch(url("/api/mail/status"));
    expect(((await res.json()) as { sms: unknown }).sms).toEqual({
      configured: true,
      provider: "seven",
      from: "FSDemo",
    });
  });

  test("POST /api/outbox/sms queues and GET filters by channel", async () => {
    const res = await fetch(url("/api/outbox/sms"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: "0160 9876512",
        text: "Bitte Sehtest mitbringen.",
      }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as OutboxEntry).recipient).toBe("+491609876512");
    const sms = (await (await fetch(url("/api/outbox?channel=sms"))).json()) as {
      items: OutboxEntry[];
    };
    expect(sms.items.map((e) => e.channel)).toEqual(["sms"]);
    const mails = (await (await fetch(url("/api/outbox?channel=email"))).json()) as {
      items: OutboxEntry[];
    };
    expect(mails.items).toHaveLength(0);
    expect((await fetch(url("/api/outbox?channel=fax"))).status).toBe(400);
    const bad = await fetch(url("/api/outbox/sms"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: "x", text: "y" }),
    });
    expect(bad.status).toBe(400);
  });
});
