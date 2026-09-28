/* Löschkonzept — retention engine: every category, legal hold, preview
   == run, accounting untouched while in its period, idempotency and
   isolation between two schools' databases. In-memory DBs throughout. */

import { beforeEach, describe, expect, test } from "bun:test";

import type { Database } from "./sqlite";

import { DEFAULT_RETENTION_POLICY, periodEnd, subtractMonths } from "../lib/retention";
import { prepareSchoolDb } from "./bootstrap";
import { openDb } from "./db";
import { createTransaction, pseudonymiseExpiredCustomer } from "./engine";
import { MemoryFileStore } from "./file-store";
import {
  auskunftHtml,
  collectAuskunft,
  executeErasure,
  listSubjects,
  planErasure,
} from "./privacy";
import {
  executeRetention,
  getRetentionPolicy,
  housekeeping,
  planRetention,
  retentionRoutes,
  runRetentionJob,
  setHold,
  setRetentionPolicy,
} from "./retention";
import { createStudent, deleteStudent } from "./students";
import { uploadStudentFile } from "./student-files";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let db: Database;
let store: MemoryFileStore;

async function freshDb(): Promise<Database> {
  const next = openDb(":memory:", { demoData: false });
  await prepareSchoolDb(next);
  return next;
}

beforeEach(async () => {
  db = await freshDb();
  store = new MemoryFileStore();
});

let counter = 0;
type Fixture = { id: number; customer: string; name: string };

/** A student with a lesson, attestation, file, chat, portal link, mails,
 *  an enquiry and bookings — archived on `archivedAt`. */
async function archivedStudent(
  target: Database,
  archivedAt: string,
  options: { bookingDate?: string; archive?: boolean } = {},
): Promise<Fixture> {
  counter += 1;
  const customer = `K-${counter}`;
  const student = createStudent(target, {
    firstName: "Mara",
    lastName: `Muster${counter}`,
    email: `mara${counter}@example.de`,
    phone: `+49151000${counter}`,
    address: "Hauptstr. 1, 64283 Darmstadt",
    birthday: "2007-04-01",
    companion: { name: "Papa Muster", phone: "0151 1" },
    contractNumber: `V-${counter}`,
    customerNumber: customer,
  });
  const name = `Mara Muster${counter}`;
  const event = target
    .query<{ id: number }, [number, string]>(
      `INSERT INTO calendar_events (date, start, "end", title, subtitle, type, student_id, notes)
       VALUES ('2025-03-01', '10:00', '11:30', 'Fahrstunde', ?2, 'Praktisch', ?1, 'Notiz')
       RETURNING id`,
    )
    .get(student.id, name)!;
  target
    .prepare(
      `INSERT INTO lesson_attestations (event_id, student_id, instructor, content, duration_min, signature_data_url, signed_at)
       VALUES (?, ?, 'Martin Weber', 'Überland', 90, 'data:image/png;base64,AAAA', '2025-03-01 11:30:00')`,
    )
    .run(event.id, student.id);
  await uploadStudentFile(target, store, student.id, {
    name: "sehtest.png",
    bytes: PNG,
    docType: "Sehtest",
  });
  const thread = target
    .query<{ id: number }, [number, string]>(
      "INSERT INTO conversations (student_id, student_name, last_message_at) VALUES (?, ?, '2025-03-02 09:00:00') RETURNING id",
    )
    .get(student.id, name)!;
  target
    .prepare(
      "INSERT INTO chat_messages (conversation_id, sender, text, sent_at) VALUES (?, 'schueler', 'Hallo', '2025-03-02 09:00:00')",
    )
    .run(thread.id);
  target
    .prepare(
      "INSERT INTO portal_tokens (token_hash, student_id, created_at, revoked_at) VALUES (?, ?, '2025-01-01', '2025-02-01')",
    )
    .run(`tok-${counter}`, student.id);
  target
    .prepare(
      `INSERT INTO outbox (recipient, subject, body_text, kind, status, created_at, sent_at)
       VALUES (?, 'Erinnerung', 'Hallo Mara', 'lesson_reminder', 'gesendet', '2025-02-28 09:00:00', '2025-02-28 09:01:00')`,
    )
    .run(`mara${counter}@example.de`);
  createTransaction(target, {
    type: "zahlung_guthaben",
    date: options.bookingDate ?? "2025-03-05",
    amountCents: 10000,
    geldkonto: "1600",
    paymentMethod: "bar",
    student: {
      customerNo: customer,
      name,
      address: "Hauptstr. 1, 64283 Darmstadt",
      contractNo: "",
      classes: "B",
    },
  });
  target
    .prepare(
      `INSERT INTO invoices (invoice_nr, kind, date, due_date, student_id, student_customer_no,
         recipient_name, recipient_address, issuer, lines, total_cents)
       VALUES (?, 'rechnung', ?, ?, ?, ?, ?, 'Hauptstr. 1', '{}', ?, 10000)`,
    )
    .run(
      `RE-${counter}`,
      options.bookingDate ?? "2025-03-06",
      options.bookingDate ?? "2025-03-20",
      student.id,
      customer,
      name,
      JSON.stringify([{ text: `Fahrstunde ${name}` }]),
    );
  if (options.archive !== false) {
    deleteStudent(target, student.id, { reason: "abgeschlossen" });
    target
      .prepare("UPDATE archive SET deleted_at = ? WHERE entity = 'student' AND label = ?")
      .run(`${archivedAt} 12:00:00`, name);
  }
  return { id: student.id, customer, name };
}

function accountingSnapshot(target: Database) {
  return {
    tx: target.query("SELECT * FROM transactions ORDER BY id").all(),
    bookings: target.query("SELECT * FROM bookings ORDER BY id").all(),
    invoices: target.query("SELECT * FROM invoices ORDER BY id").all(),
    sequences: target.query("SELECT * FROM sequences ORDER BY name").all(),
  };
}

const archivePayload = (target: Database, studentId: number) =>
  target
    .query<{ payload: string; label: string }, []>(
      "SELECT payload, label FROM archive WHERE entity = 'student'",
    )
    .all()
    .map((row) => ({ label: row.label, row: JSON.parse(row.payload).row }))
    .find((entry) => entry.row.id === studentId)!;

describe("policy", () => {
  test("defaults, validation and legal minimums", () => {
    expect(getRetentionPolicy(db)).toEqual(DEFAULT_RETENTION_POLICY);
    expect(DEFAULT_RETENTION_POLICY.mode).toBe("bestaetigung");
    const next = setRetentionPolicy(db, { mode: "automatisch", months: { anfragen: 3 } });
    expect(next.mode).toBe("automatisch");
    expect(next.months.anfragen).toBe(3);
    expect(() => setRetentionPolicy(db, { months: { buchhaltung: 60 } })).toThrow(
      /Buchhaltung/,
    );
    expect(() => setRetentionPolicy(db, { months: { ausbildungsnachweis: 36 } })).toThrow(
      /Gesetzlich festgelegt/,
    );
    expect(() => setRetentionPolicy(db, { months: { gibtsnicht: 3 } })).toThrow();
    expect(() => setRetentionPolicy(db, { mode: "sofort" })).toThrow();
  });

  test("period arithmetic", () => {
    expect(subtractMonths("2026-03-31", 1)).toBe("2026-02-28");
    expect(periodEnd("2025-06-15", 60, true)).toBe("2030-12-31");
    expect(periodEnd("2025-06-15", 6, false)).toBe("2025-12-15");
  });
});

describe("plan and run", () => {
  test("nothing is due for a student archived recently", async () => {
    await archivedStudent(db, "2026-09-01");
    const plan = planRetention(db, { today: "2026-09-28" });
    expect(plan.items.filter((i) => i.studentId !== undefined)).toEqual([]);
  });

  test("each category becomes due after its own period", async () => {
    const s = await archivedStudent(db, "2025-04-01");
    db.prepare(
      `INSERT INTO appointment_requests (name, phone, email, message, requested_date, requested_time, type, created_at)
       VALUES ('Nie Schüler', '0151', 'nie@example.de', 'Hallo', '2025-01-10', '10:00', 'Praktisch', '2025-01-05 08:00:00')`,
    ).run();
    db.prepare(
      "INSERT INTO audit_log (at, method, path, status, ip) VALUES ('2024-01-01 10:00:00', 'POST', '/api/students', 200, '1.2.3.4')",
    ).run();

    // An active student's revoked portal link (archiving deletes links).
    const active = await archivedStudent(db, "", { archive: false });

    // Half a year after archiving: documents, chat, enquiry, mails, portal.
    const early = planRetention(db, { today: "2025-10-15" });
    const cats = (plan: typeof early) => new Set(plan.items.map((i) => i.category));
    expect(cats(early)).toEqual(
      new Set(["anfragen", "dokumente", "chat", "portal", "nachrichten", "protokoll"]),
    );
    // Documents and chat of the active student stay.
    expect(
      early.items.some((i) => i.studentId === active.id && i.category !== "portal"),
    ).toBe(false);

    // Five years after the end of the archiving year: master data +
    // Ausbildungsnachweis; accounting still inside its 10 years.
    const later = planRetention(db, { today: "2031-01-02" });
    expect(cats(later).has("schueler")).toBe(true);
    expect(cats(later).has("ausbildungsnachweis")).toBe(true);
    expect(cats(later).has("buchhaltung")).toBe(false);
    expect(later.items.find((i) => i.category === "schueler")?.studentId).toBe(s.id);
  });

  test("preview equals the run, and the run is idempotent", async () => {
    const s = await archivedStudent(db, "2020-02-01", { bookingDate: "2020-01-15" });
    const before = accountingSnapshot(db);
    const plan = planRetention(db, { today: "2026-01-10" });
    const run = await executeRetention(db, plan, { store, trigger: "bestaetigt" });
    // Every planned category was carried out with the planned count.
    expect(run.counts).toEqual(
      Object.fromEntries(Object.entries(plan.counts).filter(([, n]) => n > 0)),
    );

    const entry = archivePayload(db, s.id);
    expect(entry.label).toBe(`Gelöscht #${s.id}`);
    expect(entry.row.first_name).toBe("Gelöscht");
    expect(entry.row.email).toBe("");
    expect(entry.row.phone).toBe("");
    expect(entry.row.address).toBe("");
    expect(entry.row.birthday).toBe("");
    expect(entry.row.companion).toBeNull();
    expect(entry.row.customer_number).toBe(s.customer);
    const event = db
      .query<{ subtitle: string; notes: string }, []>(
        "SELECT subtitle, notes FROM calendar_events WHERE title = 'Fahrstunde'",
      )
      .get()!;
    expect(event.subtitle).toBe(`Gelöscht #${s.id}`);
    expect(event.notes).toBe("");
    const count = (sql: string) => db.query<{ n: number }, []>(sql).get()!.n;
    expect(count("SELECT count(*) AS n FROM lesson_attestations")).toBe(0);
    expect(count("SELECT count(*) AS n FROM student_files")).toBe(0);
    expect(store.files.size).toBe(0);
    expect(count("SELECT count(*) AS n FROM chat_messages")).toBe(0);
    expect(count("SELECT count(*) AS n FROM portal_tokens")).toBe(0);
    expect(count("SELECT count(*) AS n FROM outbox")).toBe(0);

    // GoBD: bookings, invoices and sequences untouched (period runs to 2030).
    expect(accountingSnapshot(db)).toEqual(before);

    // Idempotent: nothing left, a second run changes nothing.
    const again = planRetention(db, { today: "2026-01-10" });
    expect(again.items).toEqual([]);

    // The run is recorded with counts only.
    const audit = db
      .query<{ path: string }, []>(
        "SELECT path FROM audit_log WHERE method = 'LOESCHLAUF'",
      )
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.path).toContain("schueler=1");
    expect(audit[0]!.path).not.toContain("Mara");
  });

  test("accounting is pseudonymised only after its 10 years, amounts stay", async () => {
    const s = await archivedStudent(db, "2020-02-01", { bookingDate: "2020-01-15" });
    await executeRetention(db, planRetention(db, { today: "2026-01-10" }), {
      store,
      trigger: "bestaetigt",
    });
    const before = accountingSnapshot(db);
    expect(planRetention(db, { today: "2030-12-31" }).counts.buchhaltung).toBe(0);
    const plan = planRetention(db, { today: "2031-01-01" });
    expect(plan.items.some((i) => i.category === "buchhaltung")).toBe(true);
    await executeRetention(db, plan, { store, trigger: "bestaetigt" });
    const after = accountingSnapshot(db);
    const tx = after.tx as Record<string, unknown>[];
    const mine = tx.filter((t) => t.student_customer_no === s.customer);
    expect(mine.every((t) => t.student_name === `Gelöscht #${s.id}`)).toBe(true);
    expect(mine.every((t) => !String(t.description).includes(s.name))).toBe(true);
    expect(mine.every((t) => t.student_address === "")).toBe(true);
    const inv = (after.invoices as Record<string, unknown>[])[0]!;
    expect(inv.recipient_name).toBe(`Gelöscht #${s.id}`);
    expect(String(inv.lines)).not.toContain(s.name);
    // Amounts, accounts, numbers and sequences are identical.
    const strip = (rows: unknown[]) =>
      (rows as Record<string, unknown>[]).map(
        ({ student_name, student_address, description, line_description, ...rest }) =>
          rest,
      );
    expect(strip(after.tx)).toEqual(strip(before.tx));
    expect(strip(after.bookings)).toEqual(strip(before.bookings));
    expect(after.sequences).toEqual(before.sequences);
    expect(planRetention(db, { today: "2031-01-01" }).items).toEqual([]);
  });

  test("the engine refuses to pseudonymise a customer still in its period", async () => {
    const s = await archivedStudent(db, "2020-02-01", { bookingDate: "2021-06-01" });
    expect(() =>
      pseudonymiseExpiredCustomer(db, {
        customerNo: s.customer,
        pseudonym: "X",
        today: "2031-06-01",
      }),
    ).toThrow(/läuft noch bis 2031-12-31/);
  });

  test("legal hold excludes the student from every student-bound category", async () => {
    const held = await archivedStudent(db, "2020-02-01");
    const other = await archivedStudent(db, "2020-02-01");
    setHold(db, { studentId: held.id, reason: "Rechtsstreit" });
    const plan = planRetention(db, { today: "2026-01-10" });
    expect(plan.items.some((i) => i.studentId === held.id)).toBe(false);
    expect(plan.items.some((i) => i.studentId === other.id)).toBe(true);
    await executeRetention(db, plan, { store, trigger: "bestaetigt" });
    expect(archivePayload(db, held.id).row.email).toContain("@");
    expect(() => planErasure(db, held.id)).not.toThrow();
    await expect(executeErasure(db, held.id, store, "2026-01-10")).rejects.toThrow(
      /Aufbewahrung verlängern/,
    );
    // An expired hold no longer protects.
    setHold(db, { studentId: held.id, reason: "Prüfung", until: "2026-01-01" });
    expect(
      planRetention(db, { today: "2026-01-10" }).items.some(
        (i) => i.studentId === held.id,
      ),
    ).toBe(true);
  });

  test("the confirm endpoint only runs the batch the owner saw", async () => {
    await archivedStudent(db, "2020-02-01");
    const routes = retentionRoutes(db, store);
    const post = (hash: string) =>
      routes["/api/admin/retention/run"].POST(
        new Request("http://x/api/admin/retention/run", {
          method: "POST",
          body: JSON.stringify({ hash }),
        }) as never,
      );
    expect((await post("veraltet")).status).toBe(409);
    const plan = planRetention(db);
    const res = await post(plan.hash);
    expect(res.status).toBe(200);
    expect((await res.json()).counts.schueler).toBe(1);
  });

  test("the daily job deletes only in automatic mode, once per day", async () => {
    await archivedStudent(db, "2020-02-01");
    const now = new Date("2026-03-01T10:00:00Z");
    expect(await runRetentionJob(db, { store, now })).toBeNull();
    expect(planRetention(db).counts.schueler).toBe(1);
    setRetentionPolicy(db, { mode: "automatisch" });
    // Same day: already checked.
    expect(await runRetentionJob(db, { store, now })).toBeNull();
    const run = await runRetentionJob(db, {
      store,
      now: new Date("2026-03-02T10:00:00Z"),
    });
    expect(run?.trigger).toBe("automatisch");
    expect(run?.counts.schueler).toBe(1);
  });

  test("two schools stay isolated", async () => {
    const other = await freshDb();
    await archivedStudent(db, "2020-02-01");
    const theirs = await archivedStudent(other, "2020-02-01");
    const plan = planRetention(db, { today: "2026-01-10" });
    await executeRetention(db, plan, { store, trigger: "bestaetigt" });
    expect(archivePayload(other, theirs.id).row.first_name).toBe("Mara");
    expect(planRetention(other, { today: "2026-01-10" }).counts.schueler).toBe(1);
    expect(
      other.query<{ n: number }, []>("SELECT count(*) AS n FROM retention_runs").get()!.n,
    ).toBe(0);
  });
});

describe("Betroffenenrechte", () => {
  test("Auskunft lists every category of personal data", async () => {
    const s = await archivedStudent(db, "2026-09-01", { archive: false });
    const data = collectAuskunft(db, s.id);
    const section = (key: string) => data.sections.find((x) => x.key === key)!;
    expect(section("stammdaten").rows[0]!["E-Mail"]).toContain("@example.de");
    expect(section("termine").rows).toHaveLength(1);
    expect(section("ausbildungsnachweis").rows).toHaveLength(1);
    expect(section("buchungen").rows.length).toBeGreaterThan(0);
    expect(section("rechnungen").rows).toHaveLength(1);
    expect(section("dokumente").rows[0]!.Datei).toBe("sehtest.png");
    expect(section("chat").rows[0]!.Nachricht).toBe("Hallo");
    expect(section("nachrichten").rows).toHaveLength(1);
    expect(section("portal").rows).toHaveLength(1);
    expect(data.information.length).toBeGreaterThan(5);

    // The printable page escapes what people typed.
    db.prepare(
      "INSERT INTO chat_messages (conversation_id, sender, text) SELECT id, 'schueler', '<script>x</script>' FROM conversations",
    ).run();
    const html = auskunftHtml(collectAuskunft(db, s.id));
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<script>x");
    expect(html).toContain("Auskunft nach Art. 15 DSGVO");
  });

  test("Art. 17: erases at once, keeps what the law requires, finishes later", async () => {
    const s = await archivedStudent(db, "2026-09-01", { archive: false });
    const before = accountingSnapshot(db);
    const plan = planErasure(db, s.id, "2026-09-28");
    expect(plan.willArchive).toBe(true);
    expect(plan.retain.map((r) => r.until)).toEqual(["2031-12-31", "2035-12-31"]);
    await executeErasure(db, s.id, store, "2026-09-28");

    const entry = archivePayload(db, s.id);
    expect(entry.row.email).toBe("");
    expect(entry.row.phone).toBe("");
    expect(entry.row.companion).toBeNull();
    // Needed for the Ausbildungsnachweis (§ 31 FahrlG) until 2031.
    expect(entry.row.last_name).toBe(`Muster${counter}`);
    expect(store.files.size).toBe(0);
    const count = (sql: string) => db.query<{ n: number }, []>(sql).get()!.n;
    expect(count("SELECT count(*) AS n FROM chat_messages")).toBe(0);
    expect(count("SELECT count(*) AS n FROM lesson_attestations")).toBe(1);
    expect(accountingSnapshot(db)).toEqual(before);
    expect(listSubjects(db).find((x) => x.studentId === s.id)?.erasure?.kind).toBe(
      "antrag",
    );

    // Not before the FahrlG period ends …
    expect(planRetention(db, { today: "2031-12-31" }).counts.schueler).toBe(0);
    // … then the job finishes the anonymisation.
    const later = planRetention(db, { today: "2032-01-01" });
    expect(later.counts.schueler).toBe(1);
    expect(later.counts.ausbildungsnachweis).toBe(1);
  });

  test("Art. 17 without training records anonymises the name at once", async () => {
    const student = createStudent(db, {
      firstName: "Kurz",
      lastName: "Interessent",
      contractNumber: "V-kurz",
      customerNumber: "K-kurz",
      email: "kurz@example.de",
    });
    const plan = await executeErasure(db, student.id, store, "2026-09-28");
    expect(plan.retain).toEqual([]);
    expect(archivePayload(db, student.id).row.first_name).toBe("Gelöscht");
    expect(listSubjects(db).find((x) => x.studentId === student.id)?.status).toBe(
      "anonymisiert",
    );
    expect(planRetention(db, { today: "2040-01-01" }).items).toEqual([]);
  });
});

describe("defaults", () => {
  test("anonymised enquiries still count for campaigns", async () => {
    db.prepare(
      `INSERT INTO appointment_requests (name, phone, email, message, requested_date, requested_time, type, created_at)
       VALUES ('Alt', '0151', '', '', '2025-01-10', '10:00', 'Praktisch', '2025-01-05 08:00:00')`,
    ).run();
    const plan = planRetention(db, { today: "2025-08-01" });
    await executeRetention(db, plan, { store, trigger: "bestaetigt" });
    const row = db
      .query<{ name: string; phone: string }, []>(
        "SELECT name, phone FROM appointment_requests",
      )
      .get()!;
    expect(row).toEqual({ name: "Gelöschte Anfrage", phone: "" });
    expect(planRetention(db, { today: "2025-08-01" }).counts.anfragen).toBe(0);
  });
});

describe("demo data", () => {
  test("the demo shows a due batch and an archived student still in its period", async () => {
    const demo = openDb(":memory:");
    await prepareSchoolDb(demo, { demoLogin: true });
    await prepareSchoolDb(demo, { demoLogin: true }); // idempotent
    expect(listSubjects(demo).filter((s) => s.status === "archiviert")).toHaveLength(2);
    const plan = planRetention(demo);
    expect(plan.counts.schueler).toBe(1);
    expect(plan.counts.ausbildungsnachweis).toBe(1);
    expect(plan.counts.anfragen).toBeGreaterThanOrEqual(1);
    expect(plan.counts.chat).toBeGreaterThanOrEqual(1);
    const recent = listSubjects(demo).find((s) => s.name === "Lea Brandt")!;
    expect(plan.items.some((i) => i.studentId === recent.studentId)).toBe(false);
    expect(planErasure(demo, recent.studentId).retain.length).toBe(1);
  });
});

describe("edge cases", () => {
  test("the audit log keeps deletion runs, only older entries go", async () => {
    db.prepare(
      "INSERT INTO audit_log (at, method, path, status, ip) VALUES ('2024-01-01 10:00:00', 'POST', '/api/students', 200, '1.2.3.4')",
    ).run();
    db.prepare(
      "INSERT INTO audit_log (at, method, path, status, ip) VALUES ('2024-01-02 10:00:00', 'LOESCHLAUF', '/api/admin/retention/run?trigger=bestaetigt', 200, '')",
    ).run();
    db.prepare(
      "INSERT INTO audit_log (at, method, path, status, ip) VALUES ('2026-09-01 10:00:00', 'PUT', '/api/students/1', 200, '1.2.3.4')",
    ).run();
    const plan = planRetention(db, { today: "2026-09-28" });
    expect(plan.counts.protokoll).toBe(1);
    await executeRetention(db, plan, { store, trigger: "bestaetigt" });
    const rows = db
      .query<{ method: string }, []>("SELECT method FROM audit_log ORDER BY id")
      .all();
    // The old run, the recent PUT and the new run's own entry.
    expect(rows.map((r) => r.method)).toEqual(["LOESCHLAUF", "PUT", "LOESCHLAUF"]);
  });

  test("SEPA files are emptied only after the accounting period", async () => {
    db.prepare(
      `INSERT INTO sepa_collections (msg_id, collection_date, total_cents, xml)
       VALUES ('MSG-1', '2015-03-01', 100, '<xml>IBAN</xml>'), ('MSG-2', '2025-03-01', 100, '<xml/>')`,
    ).run();
    const plan = planRetention(db, { today: "2026-09-28" });
    expect(
      plan.items.filter((i) => i.category === "buchhaltung").map((i) => i.id),
    ).toEqual(["sepa-1"]);
    await executeRetention(db, plan, { store, trigger: "bestaetigt" });
    expect(
      db.query<{ xml: string }, []>("SELECT xml FROM sepa_collections ORDER BY id").all(),
    ).toEqual([{ xml: "" }, { xml: "<xml/>" }]);
  });

  test("bank details of a customer without bookings go with the master data", async () => {
    const student = createStudent(db, {
      firstName: "Ohne",
      lastName: "Buchung",
      contractNumber: "V-sepa",
      customerNumber: "K-sepa",
    });
    db.prepare(
      `INSERT INTO sepa_mandates (student_id, mandate_ref, account_holder, iban, signed_on)
       VALUES (?, 'M-1', 'Ohne Buchung', 'DE02120300000000202051', '2026-01-01')`,
    ).run(student.id);
    await executeErasure(db, student.id, store, "2026-09-28");
    expect(
      db
        .query<{ account_holder: string; iban: string }, []>(
          "SELECT account_holder, iban FROM sepa_mandates",
        )
        .get(),
    ).toEqual({ account_holder: `Gelöscht #${student.id}`, iban: "" });
  });

  test("Art. 17 with training records: the job finishes master data, then accounting", async () => {
    const s = await archivedStudent(db, "2026-09-01", {
      archive: false,
      bookingDate: "2026-09-10",
    });
    await executeErasure(db, s.id, store, "2026-09-28");
    const first = planRetention(db, { today: "2032-01-01" });
    await executeRetention(db, first, { store, trigger: "bestaetigt" });
    expect(archivePayload(db, s.id).row.first_name).toBe("Gelöscht");
    expect(
      db.query<{ n: number }, []>("SELECT count(*) AS n FROM lesson_attestations").get()!
        .n,
    ).toBe(0);
    // Names in bookings stay until the accounting period of 2026 is over.
    expect(planRetention(db, { today: "2036-12-31" }).counts.buchhaltung).toBe(0);
    const last = planRetention(db, { today: "2037-01-01" });
    expect(last.counts.buchhaltung).toBe(1);
    await executeRetention(db, last, { store, trigger: "bestaetigt" });
    const names = db
      .query<{ student_name: string }, [string]>(
        "SELECT student_name FROM transactions WHERE student_customer_no = ?",
      )
      .all(s.customer);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((row) => row.student_name === `Gelöscht #${s.id}`)).toBe(true);
    expect(planRetention(db, { today: "2037-01-01" }).items).toEqual([]);
  });

  test("a document is kept when no file store is available", async () => {
    await archivedStudent(db, "2025-01-01");
    const plan = planRetention(db, { today: "2025-09-01" });
    expect(plan.counts.dokumente).toBe(1);
    const run = await executeRetention(db, plan, { store: null, trigger: "bestaetigt" });
    expect(run.counts.dokumente).toBeUndefined();
    expect(
      db.query<{ n: number }, []>("SELECT count(*) AS n FROM student_files").get()!.n,
    ).toBe(1);
  });

  test("housekeeping removes expired sessions and stale invites", () => {
    const now = Date.parse("2026-09-28T10:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    db.prepare(
      "INSERT INTO users (email, name, password_hash, role) VALUES ('a@b.de', 'A', 'x', 'buero')",
    ).run();
    const userId = db
      .query<{ id: number }, []>("SELECT max(id) AS id FROM users")
      .get()!.id;
    db.prepare(
      `INSERT INTO sessions (token_hash, user_id, expires_at, last_seen_at)
       VALUES ('old', ?1, ?2, ?2), ('live', ?1, ?3, ?3)`,
    ).run(userId, now - day, now + day);
    db.prepare(
      "INSERT INTO user_invites (token_hash, user_id, expires_at) VALUES ('stale', ?1, ?2), ('fresh', ?1, ?3)",
    ).run(userId, now - 31 * day, now - day);
    expect(housekeeping(db, now)).toBe(2);
    expect(
      db.query<{ token_hash: string }, []>("SELECT token_hash FROM sessions").all(),
    ).toEqual([{ token_hash: "live" }]);
    expect(
      db.query<{ token_hash: string }, []>("SELECT token_hash FROM user_invites").all(),
    ).toEqual([{ token_hash: "fresh" }]);
  });
});
