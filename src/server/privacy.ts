/* ------------------------------------------------------------------ */
/* Betroffenenrechte for students:                                      */
/*   Auskunft (Art. 15 DSGVO) — every personal record held about one    */
/*   student, as JSON and as a printable HTML page.                     */
/*   Löschen auf Antrag (Art. 17 DSGVO) — erases at once what may go,   */
/*   and says what must be kept (Art. 17 Abs. 3 lit. b) and until when; */
/*   the retention job finishes the rest when that period ends.         */
/* Routes under /api/admin/ → Inhaber only (OWNER_ONLY in auth.ts).     */
/* ------------------------------------------------------------------ */

import type { BunRequest } from "bun";

import type { Database } from "./sqlite";

import { periodEnd, RETENTION_DEFS, formatPeriod } from "../lib/retention";
import { tableExists } from "./archive";
import { getCompany } from "./db";
import { latestAccountingDate } from "./engine";
import { ValidationError } from "./errors";
import type { FileStore } from "./file-store";
import { handle, json } from "./http";
import {
  activeHoldIds,
  anonymiseArchivedStudent,
  type ArchivedStudent,
  archivedStudents,
  ensureRetentionTables,
  fullNameOf,
  getRetentionPolicy,
  recordErasure,
  recordRun,
} from "./retention";
import { schoolToday } from "./school-time";
import { deleteStoredFiles } from "./student-files";
import { deleteStudent } from "./students";

type Row = Record<string, unknown>;

/* ---------------------------- subjects ---------------------------- */

export type SubjectStatus = "aktiv" | "inaktiv" | "archiviert" | "anonymisiert";

export type Subject = {
  studentId: number;
  name: string;
  customerNumber: string;
  status: SubjectStatus;
  archivedOn: string | null;
  hold: { reason: string; until: string | null } | null;
  erasure: { kind: "frist" | "antrag"; retainedUntil: string | null } | null;
};

export function listSubjects(db: Database): Subject[] {
  ensureRetentionTables(db);
  const holds = new Map(
    db
      .query<{ student_id: number; reason: string; until: string | null }, []>(
        "SELECT student_id, reason, until FROM retention_holds",
      )
      .all()
      .map((row) => [row.student_id, { reason: row.reason, until: row.until }]),
  );
  const erased = new Map(
    db
      .query<
        { student_id: number; kind: "frist" | "antrag"; retained_until: string | null },
        []
      >("SELECT student_id, kind, retained_until FROM privacy_erasures")
      .all()
      .map((row) => [
        row.student_id,
        { kind: row.kind, retainedUntil: row.retained_until },
      ]),
  );
  const out: Subject[] = [];
  for (const row of db
    .query<
      {
        id: number;
        first_name: string;
        last_name: string;
        customer_number: string;
        status: "aktiv" | "inaktiv";
      },
      []
    >("SELECT id, first_name, last_name, customer_number, status FROM students")
    .all()) {
    out.push({
      studentId: row.id,
      name: `${row.first_name} ${row.last_name}`.trim(),
      customerNumber: row.customer_number,
      status: row.status,
      archivedOn: null,
      hold: holds.get(row.id) ?? null,
      erasure: erased.get(row.id) ?? null,
    });
  }
  for (const entry of archivedStudents(db).values()) {
    if (out.some((s) => s.studentId === entry.studentId)) continue;
    const erasure = erased.get(entry.studentId) ?? null;
    out.push({
      studentId: entry.studentId,
      name: fullNameOf(entry.row),
      customerNumber: String(entry.row.customer_number ?? ""),
      status: erasure?.kind === "frist" ? "anonymisiert" : "archiviert",
      archivedOn: entry.archivedOn,
      hold: holds.get(entry.studentId) ?? null,
      erasure,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/* ------------------------- Auskunft (Art. 15) --------------------- */

export type AuskunftSection = {
  key: string;
  title: string;
  /** Rows as label → value (already German, display-ready). */
  rows: Record<string, string>[];
  note?: string;
};

export type Auskunft = {
  createdAt: string;
  controller: { name: string; address: string; email: string };
  subject: { studentId: number; name: string; status: SubjectStatus };
  sections: AuskunftSection[];
  /** Art. 15 Abs. 1 lit. a–h — purposes, recipients, periods, rights. */
  information: { title: string; text: string }[];
};

function subjectRecord(
  db: Database,
  studentId: number,
): { row: Row; archived: ArchivedStudent | null; status: SubjectStatus } {
  const active = db
    .query<Row, [number]>("SELECT * FROM students WHERE id = ?")
    .get(studentId);
  if (active) {
    return { row: active, archived: null, status: active.status as SubjectStatus };
  }
  const archived = archivedStudents(db).get(studentId);
  if (!archived) throw new ValidationError("Fahrschüler/in nicht gefunden.");
  ensureRetentionTables(db);
  const erased = db
    .query<{ kind: string }, [number]>(
      "SELECT kind FROM privacy_erasures WHERE student_id = ?",
    )
    .get(studentId);
  return {
    row: archived.row,
    archived,
    status: erased?.kind === "frist" ? "anonymisiert" : "archiviert",
  };
}

const str = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);
const euro = (cents: unknown) =>
  `${(Number(cents ?? 0) / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const germanDate = (iso: unknown) => {
  const value = str(iso);
  const [y, m, d] = value.slice(0, 10).split("-");
  return y && m && d
    ? `${d}.${m}.${y}${value.length > 10 ? ` ${value.slice(11, 16)}` : ""}`
    : value;
};

function jsonText(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "";
  try {
    const value = JSON.parse(raw);
    if (value === null) return "";
    if (Array.isArray(value)) return value.map(String).join(", ");
    if (typeof value === "object") {
      return Object.entries(value)
        .filter(([, v]) => v !== "" && v !== null && v !== undefined)
        .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
        .join(", ");
    }
    return String(value);
  } catch {
    return raw;
  }
}

export function collectAuskunft(db: Database, studentId: number): Auskunft {
  const { row, archived, status } = subjectRecord(db, studentId);
  const customer = str(row.customer_number);
  const email = str(row.email).trim();
  const phone = str(row.phone).trim();
  const sections: AuskunftSection[] = [];
  const has = (table: string) => tableExists(db, table);

  sections.push({
    key: "stammdaten",
    title: "Stammdaten",
    rows: [
      {
        Vorname: str(row.first_name),
        Nachname: str(row.last_name),
        Geburtsdatum: germanDate(row.birthday),
        Telefon: phone,
        "E-Mail": email,
        Anschrift: str(row.address),
        Führerscheinklassen: str(row.classes),
        Anmeldedatum: germanDate(row.registration_date),
        Vertragsnummer: str(row.contract_number),
        Kundennummer: customer,
        Status: status,
        Begleitperson: jsonText(row.companion),
        "Führerschein erteilt am": germanDate(row.license_date),
        Checkliste: jsonText(row.documents),
        "Offene Unterlagen": jsonText(row.open_documents),
        "Vereinbarte Preise": jsonText(row.contract_prices),
        Theorie: jsonText(row.theory),
      },
    ],
  });

  // Termine: linked by id, or (archived) through the archive links.
  const eventIds = new Set<number>(archived?.links.calendarEvents ?? []);
  const events = db
    .query<Row, [number]>(
      `SELECT ce.*, trim(i.first_name || ' ' || i.last_name) AS instructor_name
       FROM calendar_events ce LEFT JOIN instructors i ON i.id = ce.instructor_id
       WHERE ce.student_id = ? ORDER BY ce.date, ce.start`,
    )
    .all(studentId);
  for (const id of eventIds) {
    if (events.some((event) => event.id === id)) continue;
    const event = db
      .query<Row, [number]>(
        `SELECT ce.*, trim(i.first_name || ' ' || i.last_name) AS instructor_name
         FROM calendar_events ce LEFT JOIN instructors i ON i.id = ce.instructor_id
         WHERE ce.id = ?`,
      )
      .get(id);
    if (event) events.push(event);
  }
  sections.push({
    key: "termine",
    title: "Termine (Fahrstunden, Theorie, Prüfungen)",
    rows: events.map((event) => ({
      Datum: germanDate(event.date),
      Zeit: `${str(event.start)}–${str(event.end)}`,
      Art: str(event.type),
      Fahrtart: str(event.lesson_kind),
      Titel: str(event.title),
      "Fahrlehrer/in": str(event.instructor_name),
      Absage: event.cancelled_at
        ? `${str(event.cancellation_kind)} (${germanDate(event.cancelled_at)})`
        : "",
      Prüfungsergebnis: str(event.exam_result),
      Notiz: str(event.notes),
    })),
  });

  if (has("lesson_attestations")) {
    sections.push({
      key: "ausbildungsnachweis",
      title: "Ausbildungsnachweis",
      rows: db
        .query<Row, [number]>(
          "SELECT * FROM lesson_attestations WHERE student_id = ? ORDER BY signed_at",
        )
        .all(studentId)
        .map((a) => ({
          Unterschrieben: germanDate(a.signed_at),
          "Dauer (Min.)": str(a.duration_min),
          Inhalt: str(a.content),
          "Fahrlehrer/in": str(a.instructor),
          Unterschrift: a.signature_data_url ? "gespeichert (Bild)" : "",
        })),
    });
  }

  if (has("theory_attendance")) {
    sections.push({
      key: "theorie",
      title: "Theorie-Anwesenheit",
      rows: db
        .query<Row, [number]>(
          `SELECT a.session_date, a.attended, g.name FROM theory_attendance a
           LEFT JOIN theory_groups g ON g.id = a.group_id
           WHERE a.student_id = ? ORDER BY a.session_date`,
        )
        .all(studentId)
        .map((a) => ({
          Datum: germanDate(a.session_date),
          Gruppe: str(a.name),
          Anwesend: a.attended ? "ja" : "nein",
        })),
    });
  }

  if (customer) {
    sections.push({
      key: "buchungen",
      title: "Buchungen (Zahlungen und Leistungen)",
      note: "Gesetzliche Aufbewahrungspflicht nach § 147 AO / § 257 HGB.",
      rows: db
        .query<Row, [string]>(
          `SELECT t.date, t.beleg_nr, t.type, t.description, t.student_name,
                  t.student_address, t.storno_of,
                  (SELECT sum(amount_cents) FROM bookings b WHERE b.transaction_id = t.id) AS cents
           FROM transactions t WHERE t.student_customer_no = ? ORDER BY t.date, t.id`,
        )
        .all(customer)
        .map((t) => ({
          Datum: germanDate(t.date),
          Beleg: str(t.beleg_nr),
          Art: str(t.type),
          Text: str(t.description),
          Betrag: euro(t.cents),
          Name: str(t.student_name),
          Anschrift: str(t.student_address),
          Storno: t.storno_of ? "ja" : "",
        })),
    });
    if (has("invoices")) {
      sections.push({
        key: "rechnungen",
        title: "Rechnungen",
        note: "Gesetzliche Aufbewahrungspflicht nach § 14b UStG / § 147 AO.",
        rows: db
          .query<Row, [string]>(
            "SELECT * FROM invoices WHERE student_customer_no = ? ORDER BY date, id",
          )
          .all(customer)
          .map((inv) => ({
            Nummer: str(inv.invoice_nr),
            Art: inv.kind === "storno" ? "Stornorechnung" : "Rechnung",
            Datum: germanDate(inv.date),
            Betrag: euro(inv.total_cents),
            Empfänger: str(inv.recipient_name),
            Anschrift: str(inv.recipient_address),
          })),
      });
    }
  }

  if (has("sepa_mandates")) {
    sections.push({
      key: "sepa",
      title: "SEPA-Lastschriftmandate",
      rows: db
        .query<Row, [number]>("SELECT * FROM sepa_mandates WHERE student_id = ?")
        .all(studentId)
        .map((m) => ({
          Mandatsreferenz: str(m.mandate_ref),
          Kontoinhaber: str(m.account_holder),
          IBAN: str(m.iban),
          BIC: str(m.bic),
          Unterschrieben: germanDate(m.signed_on),
          Widerrufen: germanDate(m.revoked_on),
        })),
    });
  }
  if (has("instalment_plans")) {
    sections.push({
      key: "ratenplaene",
      title: "Ratenpläne",
      rows: db
        .query<Row, [number]>("SELECT * FROM instalment_plans WHERE student_id = ?")
        .all(studentId)
        .map((p) => ({
          Titel: str(p.title),
          Gesamt: euro(p.total_cents),
          Angelegt: germanDate(p.created_at),
          Beendet: germanDate(p.cancelled_on),
        })),
    });
  }

  if (has("student_files")) {
    sections.push({
      key: "dokumente",
      title: "Hochgeladene Dokumente",
      note: "Die Dateien selbst stellt die Fahrschule auf Wunsch als Kopie bereit.",
      rows: db
        .query<Row, [number]>(
          "SELECT * FROM student_files WHERE student_id = ? ORDER BY uploaded_at",
        )
        .all(studentId)
        .map((f) => ({
          Datei: str(f.name),
          Dokumentart: str(f.doc_type),
          Hochgeladen: germanDate(f.uploaded_at),
          "Größe (KB)": String(Math.ceil(Number(f.size ?? 0) / 1024)),
        })),
    });
  }

  if (has("conversations")) {
    const threadIds = new Set<number>(archived?.links.conversations ?? []);
    for (const t of db
      .query<{ id: number }, [number]>(
        "SELECT id FROM conversations WHERE student_id = ?",
      )
      .all(studentId)) {
      threadIds.add(t.id);
    }
    const rows: Record<string, string>[] = [];
    for (const id of threadIds) {
      for (const m of db
        .query<Row, [number]>(
          "SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY sent_at, id",
        )
        .all(id)) {
        rows.push({
          Zeitpunkt: germanDate(m.sent_at),
          Von: m.sender === "schule" ? "Fahrschule" : "Fahrschüler/in",
          Nachricht: str(m.text),
        });
      }
    }
    sections.push({ key: "chat", title: "Chat-/Portalnachrichten", rows });
  }

  if (has("outbox")) {
    const recipients = [email, phone].filter(Boolean);
    const rows: Record<string, string>[] = [];
    for (const recipient of recipients) {
      for (const o of db
        .query<Row, [string]>(
          "SELECT * FROM outbox WHERE lower(recipient) = lower(?) ORDER BY created_at, id",
        )
        .all(recipient)) {
        rows.push({
          Datum: germanDate(o.sent_at ?? o.created_at),
          Kanal: o.channel === "sms" ? "SMS" : "E-Mail",
          An: str(o.recipient),
          Betreff: str(o.subject),
          Text: str(o.body_text),
          Status: str(o.status),
        });
      }
    }
    sections.push({ key: "nachrichten", title: "Versandte E-Mails und SMS", rows });
  }

  if (has("appointment_requests")) {
    const cols = db
      .query<{ name: string }, []>("PRAGMA table_info(appointment_requests)")
      .all()
      .map((c) => c.name);
    const conditions: string[] = [];
    const params: string[] = [];
    if (cols.includes("student_id")) {
      conditions.push("student_id = ?");
      params.push(String(studentId));
    }
    if (email) {
      conditions.push("lower(email) = lower(?)");
      params.push(email);
    }
    if (phone) {
      conditions.push("phone = ?");
      params.push(phone);
    }
    sections.push({
      key: "anfragen",
      title: "Terminanfragen",
      rows: conditions.length
        ? db
            .query<Row, string[]>(
              `SELECT * FROM appointment_requests WHERE ${conditions.join(" OR ")} ORDER BY created_at`,
            )
            .all(...params)
            .map((r) => ({
              Eingang: germanDate(r.created_at),
              Name: str(r.name),
              Telefon: str(r.phone),
              "E-Mail": str(r.email),
              Wunschtermin: `${germanDate(r.requested_date)} ${str(r.requested_time)}`,
              Nachricht: str(r.message),
              Status: str(r.status),
            }))
        : [],
    });
  }

  if (has("portal_tokens")) {
    sections.push({
      key: "portal",
      title: "Schülerportal-Zugänge",
      note: "Der geheime Link selbst wird aus Sicherheitsgründen nicht angezeigt.",
      rows: db
        .query<Row, [number]>(
          "SELECT created_at, revoked_at FROM portal_tokens WHERE student_id = ?",
        )
        .all(studentId)
        .map((t) => ({
          Erstellt: germanDate(t.created_at),
          Widerrufen: germanDate(t.revoked_at),
        })),
    });
  }

  const company = getCompany(db);
  const policy = getRetentionPolicy(db);
  const periods = (Object.keys(RETENTION_DEFS) as (keyof typeof RETENTION_DEFS)[])
    .map(
      (key) =>
        `${RETENTION_DEFS[key].label}: ${formatPeriod(policy.months[key])} ab ${RETENTION_DEFS[key].start}`,
    )
    .join("; ");
  return {
    createdAt: new Date().toISOString(),
    controller: { name: company.name, address: company.address, email: company.email },
    subject: { studentId, name: fullNameOf(row), status },
    sections,
    information: [
      {
        title: "Zwecke der Verarbeitung",
        text: "Durchführung des Ausbildungsvertrags (Art. 6 Abs. 1 lit. b DSGVO): Planung und Durchführung der Ausbildung, Abrechnung, Kommunikation, Anmeldung zur Prüfung; Erfüllung gesetzlicher Pflichten (Art. 6 Abs. 1 lit. c DSGVO): Ausbildungsnachweis nach § 31 FahrlG, Buchführung nach AO/HGB/UStG.",
      },
      {
        title: "Kategorien der Daten",
        text: "Stamm- und Kontaktdaten, Vertrags- und Ausbildungsdaten, Termine, Ausbildungsnachweis mit Unterschrift, Zahlungs- und Rechnungsdaten, Bankverbindung (bei Lastschrift), Dokumente, Nachrichten.",
      },
      {
        title: "Empfänger",
        text: "Fahrerlaubnisbehörde und Technische Prüfstelle (Prüfungsanmeldung), Steuerberatung und Finanzamt (Buchführung), Kreditinstitut (Lastschrift), IT-Dienstleister als Auftragsverarbeiter (Hosting, E-Mail-/SMS-Versand). Eine Übermittlung in Drittländer findet nicht statt, soweit nicht anders angegeben.",
      },
      { title: "Speicherdauer", text: periods },
      {
        title: "Ihre Rechte",
        text: "Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18), Datenübertragbarkeit (Art. 20), Widerspruch (Art. 21 DSGVO) sowie Beschwerde bei einer Datenschutz-Aufsichtsbehörde (Art. 77 DSGVO).",
      },
      {
        title: "Herkunft der Daten",
        text: "Die Daten stammen von Ihnen selbst (Anmeldung, Terminanfrage, Schülerportal) oder entstehen im Rahmen der Ausbildung bei der Fahrschule.",
      },
      {
        title: "Automatisierte Entscheidungen",
        text: "Es findet keine automatisierte Entscheidungsfindung einschließlich Profiling statt (Art. 22 DSGVO).",
      },
    ],
  };
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Printable, self-contained page (print → PDF from the browser). */
export function auskunftHtml(data: Auskunft): string {
  const section = (s: AuskunftSection) => {
    const columns = [
      ...new Set(
        s.rows.flatMap((r) =>
          Object.keys(r).filter((k) => r[k] !== "" && r[k] !== undefined),
        ),
      ),
    ];
    const body =
      s.rows.length === 0
        ? "<p class=muted>Keine Daten gespeichert.</p>"
        : s.key === "stammdaten"
          ? `<table>${columns
              .map(
                (c) =>
                  `<tr><th>${escapeHtml(c)}</th><td>${escapeHtml(s.rows[0]![c] ?? "")}</td></tr>`,
              )
              .join("")}</table>`
          : `<table><thead><tr>${columns
              .map((c) => `<th>${escapeHtml(c)}</th>`)
              .join("")}</tr></thead><tbody>${s.rows
              .map(
                (r) =>
                  `<tr>${columns.map((c) => `<td>${escapeHtml(r[c] ?? "")}</td>`).join("")}</tr>`,
              )
              .join("")}</tbody></table>`;
    return `<section><h2>${escapeHtml(s.title)}</h2>${
      s.note ? `<p class=muted>${escapeHtml(s.note)}</p>` : ""
    }${body}</section>`;
  };
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auskunft nach Art. 15 DSGVO – ${escapeHtml(data.subject.name)}</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;color:#111;max-width:960px;margin:24px auto;padding:0 16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px}
table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #eee;padding:4px 6px}
th{font-weight:600;color:#444;white-space:nowrap}.muted{color:#666;font-size:12.5px}
@media print{body{margin:0}button{display:none}section{break-inside:avoid-page}}
</style></head><body>
<button onclick="window.print()" style="float:right">Drucken / als PDF speichern</button>
<h1>Auskunft nach Art. 15 DSGVO</h1>
<p class=muted>Verantwortliche Stelle: ${escapeHtml(
    [data.controller.name, data.controller.address, data.controller.email]
      .filter(Boolean)
      .join(" · "),
  )}<br>Betroffene Person: ${escapeHtml(data.subject.name)} (Nr. ${data.subject.studentId}) · erstellt am ${escapeHtml(
    germanDate(data.createdAt),
  )}</p>
${data.sections.map(section).join("\n")}
<section><h2>Informationen nach Art. 15 Abs. 1 DSGVO</h2>${data.information
    .map((i) => `<p><strong>${escapeHtml(i.title)}:</strong> ${escapeHtml(i.text)}</p>`)
    .join("")}</section>
</body></html>`;
}

/* ---------------------- Löschen auf Antrag (Art. 17) -------------- */

export type ErasurePlan = {
  studentId: number;
  name: string;
  /** Still in the active list: the request archives the student first. */
  willArchive: boolean;
  blockedBy: string | null;
  erase: string[];
  retain: { what: string; basis: string; until: string }[];
};

function counts(
  db: Database,
  studentId: number,
  archived: ArchivedStudent | null,
  row: Row,
) {
  const n = (sql: string, ...params: (string | number)[]) =>
    db.query<{ n: number }, (string | number)[]>(sql).get(...params)!.n;
  const email = str(row.email).trim();
  const phone = str(row.phone).trim();
  const threads = new Set<number>(archived?.links.conversations ?? []);
  if (tableExists(db, "conversations")) {
    for (const t of db
      .query<{ id: number }, [number]>(
        "SELECT id FROM conversations WHERE student_id = ?",
      )
      .all(studentId)) {
      threads.add(t.id);
    }
  }
  return {
    files: tableExists(db, "student_files")
      ? n("SELECT count(*) AS n FROM student_files WHERE student_id = ?", studentId)
      : 0,
    threads: threads.size,
    outbox: tableExists(db, "outbox")
      ? [email, phone]
          .filter(Boolean)
          .reduce(
            (sum, r) =>
              sum +
              n("SELECT count(*) AS n FROM outbox WHERE lower(recipient) = lower(?)", r),
            0,
          )
      : 0,
    attestations: tableExists(db, "lesson_attestations")
      ? n("SELECT count(*) AS n FROM lesson_attestations WHERE student_id = ?", studentId)
      : 0,
  };
}

export function planErasure(
  db: Database,
  studentId: number,
  today = schoolToday(),
): ErasurePlan {
  ensureRetentionTables(db);
  const { row, archived } = subjectRecord(db, studentId);
  const policy = getRetentionPolicy(db);
  const c = counts(db, studentId, archived, row);
  const archivedOn = archived?.archivedOn ?? today;
  const customer = str(row.customer_number);
  const latest = customer ? latestAccountingDate(db, customer) : null;
  const holds = activeHoldIds(db, today);
  const erase = [
    "Telefon, E-Mail-Adresse und Begleitperson",
    c.files > 0 ? `${c.files} hochgeladene(s) Dokument(e)` : "",
    c.threads > 0 ? `${c.threads} Chat-Unterhaltung(en)` : "",
    c.outbox > 0 ? `${c.outbox} E-Mail(s)/SMS im Versandprotokoll` : "",
    "Schülerportal-Zugang und Terminanfragen",
  ].filter(Boolean);
  const retain: ErasurePlan["retain"] = [];
  if (c.attestations > 0) {
    retain.push({
      what: `Name, Geburtsdatum, Anschrift und ${c.attestations} unterschriebene(r) Ausbildungsnachweis(e) samt Terminen`,
      basis: "§ 31 FahrlG, Art. 17 Abs. 3 lit. b DSGVO",
      until: periodEnd(archivedOn, policy.months.ausbildungsnachweis, true),
    });
  } else {
    erase.unshift("Name, Geburtsdatum und Anschrift (Pseudonym „Gelöscht #Nr.“)");
    erase.push("Name in Terminen");
  }
  if (latest) {
    retain.push({
      what: "Name und Anschrift in Buchungen und Rechnungen (Buchhaltung)",
      basis: "§ 147 AO, § 257 HGB, § 14b UStG, Art. 17 Abs. 3 lit. b DSGVO",
      until: periodEnd(latest, policy.months.buchhaltung, true),
    });
  }
  return {
    studentId,
    name: fullNameOf(row),
    willArchive: archived === null,
    blockedBy: holds.has(studentId)
      ? "Für diese Person ist „Aufbewahrung verlängern“ eingetragen. Bitte zuerst aufheben."
      : null,
    erase,
    retain,
  };
}

export async function executeErasure(
  db: Database,
  studentId: number,
  store: FileStore | null,
  today = schoolToday(),
): Promise<ErasurePlan> {
  const plan = planErasure(db, studentId, today);
  if (plan.blockedBy) throw new ValidationError(plan.blockedBy);
  if (plan.willArchive) deleteStudent(db, studentId, { reason: "loeschung" });
  const entry = archivedStudents(db).get(studentId);
  if (!entry) throw new ValidationError("Fahrschüler/in nicht gefunden.");
  const attestationRule = plan.retain.find((r) => r.basis.startsWith("§ 31 FahrlG"));
  const customer = str(entry.row.customer_number);
  let keys: string[] = [];
  db.transaction(() => {
    keys = anonymiseArchivedStudent(db, entry, { contactOnly: Boolean(attestationRule) });
    recordErasure(
      db,
      entry,
      attestationRule ? "antrag" : "frist",
      attestationRule?.until ?? null,
      !customer || latestAccountingDate(db, customer) === null,
    );
  })();
  if (store && keys.length > 0) await deleteStoredFiles(store, keys);
  recordRun(
    db,
    "antrag",
    { schueler: 1, ...(keys.length ? { dokumente: keys.length } : {}) },
    "/api/admin/privacy/erasure",
  );
  return plan;
}

/* ------------------------------ HTTP ------------------------------ */

function parseStudentId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new ValidationError("Ungültige Schüler-ID.");
  return id;
}

export function privacyRoutes(db: Database, store: FileStore) {
  return {
    "/api/admin/privacy/subjects": {
      GET: () => handle(() => json(listSubjects(db)))(),
    },
    "/api/admin/privacy/students/:id/auskunft": {
      GET: (req: BunRequest<"/api/admin/privacy/students/:id/auskunft">) =>
        handle(() => {
          const data = collectAuskunft(db, parseStudentId(req.params.id));
          const format = new URL(req.url).searchParams.get("format");
          const fileBase = `auskunft-art15-${data.subject.studentId}`;
          if (format === "html") {
            return new Response(auskunftHtml(data), {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Security-Policy":
                  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
                "X-Content-Type-Options": "nosniff",
              },
            });
          }
          if (format === "download") {
            return new Response(JSON.stringify(data, null, 2), {
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Disposition": `attachment; filename="${fileBase}.json"`,
              },
            });
          }
          return json(data);
        })(),
    },
    "/api/admin/privacy/students/:id/erasure": {
      GET: (req: BunRequest<"/api/admin/privacy/students/:id/erasure">) =>
        handle(() => json(planErasure(db, parseStudentId(req.params.id))))(),
      POST: (req: BunRequest<"/api/admin/privacy/students/:id/erasure">) =>
        handle(async () =>
          json(await executeErasure(db, parseStudentId(req.params.id), store)),
        )(),
    },
  };
}
