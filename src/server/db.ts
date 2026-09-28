/* ------------------------------------------------------------------ */
/* SQLite layer (see ./sqlite) — schema, sequences, account seed.      */
/*                                                                     */
/* GoBD principles baked into the schema:                              */
/*  - bookings are immutable (no UPDATE/DELETE code paths exist),      */
/*  - Beleg-/Buchungs-/Quittungsnummern come from gapless DB           */
/*    sequences allocated inside the same write transaction,           */
/*  - corrections only via Storno (reversal transactions).             */
/* ------------------------------------------------------------------ */

import { openSqlite, type Database } from "./sqlite";
import { ensureAbsenceTables } from "./absences";
import { instructorIdByName, migrateNameColumn, vehicleIdByName } from "./refs";
import { ensureAuthTables } from "./auth";

import type { AccountKind, CompanyProfile } from "../lib/accounting-types";
import { PRICE_PLAN_SEED } from "../lib/price-plan";
import { students as STUDENT_SEED } from "../lib/student-data";

export const DDL = `
CREATE TABLE IF NOT EXISTS accounts (
  number TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  vat_rate INTEGER,
  vat_label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  opening_cents INTEGER,
  opening_date TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  beleg_nr TEXT UNIQUE,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL,
  payment_method TEXT,
  description TEXT NOT NULL DEFAULT '',
  student_customer_no TEXT,
  student_name TEXT,
  student_address TEXT,
  student_contract_no TEXT,
  student_classes TEXT,
  storno_of INTEGER REFERENCES transactions(id),
  storno_reason TEXT,
  storniert_by INTEGER REFERENCES transactions(id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  buchung_nr TEXT NOT NULL UNIQUE,
  soll_account TEXT NOT NULL REFERENCES accounts(number),
  haben_account TEXT NOT NULL REFERENCES accounts(number),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  vat_rate INTEGER,
  net_cents INTEGER,
  vat_cents INTEGER,
  line_description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS quittungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quittung_nr TEXT NOT NULL UNIQUE,
  transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id),
  issued_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sequences (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS price_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  guaranteed_months INTEGER NOT NULL DEFAULT 0,
  classes TEXT NOT NULL DEFAULT '[]',
  components TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birthday TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  classes TEXT NOT NULL DEFAULT '',
  driving_school TEXT NOT NULL DEFAULT '',
  registration_date TEXT NOT NULL DEFAULT '',
  contract_number TEXT NOT NULL UNIQUE,
  customer_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv', 'inaktiv')),
  instructor_id INTEGER REFERENCES instructors(id),
  vehicle_id INTEGER REFERENCES vehicles(id),
  progress INTEGER NOT NULL DEFAULT 0,
  documents TEXT NOT NULL DEFAULT '[]',
  theory TEXT NOT NULL DEFAULT '{}',
  price_plan_id INTEGER REFERENCES price_plans(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS instructors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  classes TEXT NOT NULL DEFAULT '',
  vehicle_id INTEGER REFERENCES vehicles(id),
  since TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv', 'inaktiv')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  plate TEXT NOT NULL UNIQUE,
  klass TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv', 'wartung')),
  accent TEXT NOT NULL DEFAULT 'bg-slate-500/10 text-slate-600',
  details TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,            -- ISO "YYYY-MM-DD"
  start TEXT NOT NULL,           -- "HH:MM"
  end TEXT NOT NULL,             -- "HH:MM"
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  instructor_id INTEGER REFERENCES instructors(id),
  vehicle_id INTEGER REFERENCES vehicles(id),
  type TEXT NOT NULL CHECK (type IN ('Praktisch','Theorie','Vorstellung zur prakt. Prüfung','Theorieprüfung','Andere')),
  tentative INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(date);

-- Papierkorb: deleted records land here as raw row snapshots so they can
-- be restored from the Archiv page (src/server/archive.ts).
CREATE TABLE IF NOT EXISTS archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL CHECK (entity IN ('student','calendar_event','instructor','vehicle','price_plan')),
  label TEXT NOT NULL,
  payload TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Rechnungen (§ 14 UStG): immutable documents over already-booked
-- charges (guthaben_uebertragung). Corrections only via a Storno-
-- rechnung (kind 'storno', storno_of → original). Numbers come from the
-- gapless per-year sequence 'rechnung:<year>'.
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_nr TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('rechnung', 'storno')),
  date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  student_id INTEGER,
  student_customer_no TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_address TEXT NOT NULL DEFAULT '',
  student_contract_no TEXT NOT NULL DEFAULT '',
  student_classes TEXT NOT NULL DEFAULT '',
  issuer TEXT NOT NULL,
  lines TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  prepaid_cents INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  storno_of INTEGER REFERENCES invoices(id),
  storno_reason TEXT,
  storniert_by INTEGER REFERENCES invoices(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(student_customer_no);

CREATE TABLE IF NOT EXISTS invoice_items (
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  PRIMARY KEY (invoice_id, transaction_id)
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_tx ON invoice_items(transaction_id);

-- Mahnwesen: one row per Zahlungserinnerung/Mahnung (level 1–3).
CREATE TABLE IF NOT EXISTS invoice_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
  date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  open_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL DEFAULT 0,
  fee_transaction_id INTEGER REFERENCES transactions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (invoice_id, level)
);

-- SEPA-Lastschriftmandate. No FK on student_id: the mandate is a signed
-- document that stays on record even if the student is deleted.
CREATE TABLE IF NOT EXISTS sepa_mandates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  mandate_ref TEXT NOT NULL UNIQUE,
  account_holder TEXT NOT NULL,
  iban TEXT NOT NULL,
  bic TEXT NOT NULL DEFAULT '',
  signed_on TEXT NOT NULL,
  revoked_on TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sepa_mandates_student ON sepa_mandates(student_id);

-- Ratenpläne: expected Anzahlungen with due dates. A paid rate links
-- the zahlung_guthaben transaction that settled it.
CREATE TABLE IF NOT EXISTS instalment_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  customer_no TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  cancelled_on TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS instalments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES instalment_plans(id),
  seq INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  payment_transaction_id INTEGER REFERENCES transactions(id),
  UNIQUE (plan_id, seq)
);

-- SEPA-Lastschrift-Sammler (pain.008.001.02). The generated XML is kept
-- verbatim as the record of what was submitted to the bank.
CREATE TABLE IF NOT EXISTS sepa_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  msg_id TEXT NOT NULL UNIQUE,
  collection_date TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  xml TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sepa_collection_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES sepa_collections(id),
  mandate_id INTEGER NOT NULL REFERENCES sepa_mandates(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('invoice', 'instalment')),
  source_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  sequence_type TEXT NOT NULL CHECK (sequence_type IN ('FRST', 'RCUR')),
  end_to_end_id TEXT NOT NULL UNIQUE,
  remittance TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'exportiert'
    CHECK (status IN ('exportiert', 'gebucht', 'zurueckgegeben')),
  payment_transaction_id INTEGER REFERENCES transactions(id),
  return_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions(student_customer_no);
CREATE INDEX IF NOT EXISTS idx_bookings_transaction ON bookings(transaction_id);
`;

/* SKR 04 — verified against the published DATEV chart (Ecovis listing). */
type AccountSeed = {
  number: string;
  name: string;
  kind: AccountKind;
  vatRate: number | null;
  vatLabel: string;
  openingCents?: number;
  openingDate?: string;
};

export const SKR04_ACCOUNTS: AccountSeed[] = [
  {
    number: "1370",
    name: "Durchlaufende Posten",
    kind: "durchlaufend",
    vatRate: null,
    vatLabel: "Durchlaufende Posten",
  },
  {
    number: "1406",
    name: "Abziehbare Vorsteuer 19 %",
    kind: "steuer",
    vatRate: null,
    vatLabel: "Nicht zutreffend",
  },
  {
    number: "1460",
    name: "Geldtransit",
    kind: "transit",
    vatRate: null,
    vatLabel: "Nicht zutreffend",
  },
  {
    number: "1600",
    name: "Kasse",
    kind: "geldkonto",
    vatRate: null,
    vatLabel: "Nicht zutreffend",
    openingCents: 348457,
    openingDate: "2026-01-01",
  },
  {
    number: "1800",
    name: "Bank",
    kind: "geldkonto",
    vatRate: null,
    vatLabel: "Nicht zutreffend",
    openingCents: 1600000,
    openingDate: "2026-01-01",
  },
  {
    number: "2100",
    name: "Privatentnahmen allgemein",
    kind: "privat",
    vatRate: null,
    vatLabel: "Nicht zutreffend",
  },
  {
    number: "2180",
    name: "Privateinlagen",
    kind: "privat",
    vatRate: null,
    vatLabel: "Nicht zutreffend",
  },
  {
    number: "3272",
    name: "Erhaltene Anzahlungen 19 % USt",
    kind: "anzahlung",
    vatRate: 19,
    vatLabel: "19%",
  },
  {
    number: "3806",
    name: "Umsatzsteuer 19 %",
    kind: "steuer",
    vatRate: null,
    vatLabel: "Nicht zutreffend",
  },
  {
    number: "4100",
    name: "Steuerfreie Umsätze § 4 Nr. 8 ff. UStG (Ausbildung § 4 Nr. 21)",
    kind: "erloes",
    vatRate: 0,
    vatLabel: "steuerfrei § 4 UStG",
  },
  { number: "4300", name: "Erlöse 7 % USt", kind: "erloes", vatRate: 7, vatLabel: "7%" },
  {
    // Mahngebühren (pauschalierter Schadensersatz) — nicht steuerbar.
    number: "4830",
    name: "Sonstige betriebliche Erträge (nicht steuerbar)",
    kind: "erloes",
    vatRate: null,
    vatLabel: "nicht steuerbar",
  },
  {
    number: "4400",
    name: "Erlöse 19 % USt",
    kind: "erloes",
    vatRate: 19,
    vatLabel: "19%",
  },
  {
    number: "6310",
    name: "Miete (unbewegliche Wirtschaftsgüter)",
    kind: "aufwand",
    vatRate: 0,
    vatLabel: "0%",
  },
  {
    number: "6520",
    name: "Kfz-Versicherungen",
    kind: "aufwand",
    vatRate: 0,
    vatLabel: "0%",
  },
  {
    number: "6530",
    name: "Laufende Kfz-Betriebskosten",
    kind: "aufwand",
    vatRate: 19,
    vatLabel: "19%",
  },
  {
    number: "6540",
    name: "Kfz-Reparaturen",
    kind: "aufwand",
    vatRate: 19,
    vatLabel: "19%",
  },
  { number: "6815", name: "Bürobedarf", kind: "aufwand", vatRate: 19, vatLabel: "19%" },
  {
    number: "7310",
    name: "Zinsaufwendungen für kurzfristige Verbindlichkeiten",
    kind: "aufwand",
    vatRate: 0,
    vatLabel: "0%",
  },
  { number: "7685", name: "Kfz-Steuern", kind: "aufwand", vatRate: 0, vatLabel: "0%" },
  {
    // Eröffnungssalden (Datenübernahme aus der Vorgängersoftware).
    number: "9000",
    name: "Saldenvorträge, Sachkonten",
    kind: "vortrag",
    vatRate: null,
    vatLabel: "Nicht zutreffend",
  },
];

/* Databases created before the SKR-04 switch hold SKR-03 numbers.       */
/* Same accounts, different numbering scheme — remap in place so         */
/* existing Buchungen stay intact (GoBD: no data is lost or altered      */
/* beyond the account numbering).                                        */
const SKR03_TO_SKR04: [string, string][] = [
  ["1000", "1600"], // Kasse
  ["1200", "1800"], // Bank
  ["1360", "1460"], // Geldtransit
  ["1576", "1406"], // Abziehbare Vorsteuer 19 %
  ["1590", "1370"], // Durchlaufende Posten
  ["1718", "3272"], // Erhaltene Anzahlungen 19 % USt
  ["1776", "3806"], // Umsatzsteuer 19 %
  ["1800", "2100"], // Privatentnahmen allgemein
  ["1890", "2180"], // Privateinlagen
  ["2110", "7310"], // Zinsaufwendungen kurzfristige Verbindlichkeiten
  ["4210", "6310"], // Miete
  ["4510", "7685"], // Kfz-Steuern
  ["4520", "6520"], // Kfz-Versicherungen
  ["4530", "6530"], // Laufende Kfz-Betriebskosten
  ["4540", "6540"], // Kfz-Reparaturen
  ["4930", "6815"], // Bürobedarf
  ["8100", "4100"], // Steuerfreie Umsätze § 4 Nr. 8 ff. UStG
  ["8300", "4300"], // Erlöse 7 % USt
  ["8400", "4400"], // Erlöse 19 % USt
];

export function migrateSkr03ToSkr04(db: Database) {
  // Detect an SKR-03 database: the old Erlöskonto exists, the new not.
  const has = (number: string) =>
    db
      .query<{ n: number }, [string]>(
        "SELECT count(*) AS n FROM accounts WHERE number = ?",
      )
      .get(number)!.n > 0;
  if (!has("8400") || has("4400")) return;

  // Old "1800 Privatentnahmen" collides with new "1800 Bank", so the
  // rename runs two-phased over temporary numbers. FK checks are off
  // while parent keys move.
  db.exec("PRAGMA foreign_keys = OFF;");
  const migrate = db.transaction(() => {
    // Phase 1: park every old number on a temp name. This must happen
    // for accounts AND bookings before any new number is assigned —
    // otherwise a freshly assigned number (e.g. 1800 Bank) would be
    // re-matched by a later rule (alt 1800 Privatentnahmen → 2100).
    const accountTemp = db.prepare("UPDATE accounts SET number = ? WHERE number = ?");
    const sollTemp = db.prepare(
      "UPDATE bookings SET soll_account = ? WHERE soll_account = ?",
    );
    const habenTemp = db.prepare(
      "UPDATE bookings SET haben_account = ? WHERE haben_account = ?",
    );
    for (const [oldNr] of SKR03_TO_SKR04) {
      accountTemp.run(`alt:${oldNr}`, oldNr);
      sollTemp.run(`alt:${oldNr}`, oldNr);
      habenTemp.run(`alt:${oldNr}`, oldNr);
    }
    // Phase 2: temp → final SKR-04 numbers.
    for (const [oldNr, newNr] of SKR03_TO_SKR04) {
      accountTemp.run(newNr, `alt:${oldNr}`);
      sollTemp.run(newNr, `alt:${oldNr}`);
      habenTemp.run(newNr, `alt:${oldNr}`);
    }
  });
  migrate();
  db.exec("PRAGMA foreign_keys = ON;");
}

export const DEFAULT_COMPANY: CompanyProfile = {
  name: "Fahrschule Demo",
  address: "Musterstraße 12, 64283 Darmstadt",
  email: "info@fahrschule-demo.example",
  phone: "+49 6151 123456",
  website: "https://fahrschule-demo.example",
  steuernummer: "",
  ustIdNr: "",
  beraterNr: "",
  mandantNr: "",
  bankName: "",
  iban: "",
  bic: "",
  glaeubigerId: "",
  inhaber: "",
  registergericht: "",
  registernummer: "",
  aufsichtsbehoerde: "",
  datenschutzEmail: "",
  impressumZusatz: "",
};

export type OpenDbOptions = {
  /** Fill an empty database with the demo school (staff, students,
      Termine, bookings, chats, …). Off for a real school — it starts
      empty and is set up through the first-run wizard. Omitted: keeps
      the stored choice (default on, which tests and old DBs rely on). */
  demoData?: boolean;
};

/* Whether demo seeds may run on this database (settings 'demo_data'). */
export function demoDataEnabled(db: Database): boolean {
  try {
    const row = db
      .query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'demo_data'")
      .get();
    return row?.value !== "false";
  } catch {
    return true; // minimal test schemas without a settings table
  }
}

export function openDb(
  path = "data/fahrschule.db",
  options: OpenDbOptions = {},
): Database {
  const db = openSqlite(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(DDL);
  ensureAuthTables(db);
  if (options.demoData !== undefined) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('demo_data', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(options.demoData));
  }
  const demo = demoDataEnabled(db);
  migrateSkr03ToSkr04(db);
  migrateStudentPricePlan(db);
  migrateStudentContractFields(db);
  migrateCalendarEventBilling(db);
  // student_id is added by migrateCalendarEventBilling, so this index can
  // only be created after that migration — not in the base DDL string.
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_calendar_events_student ON calendar_events(student_id);",
  );
  migrateExamResults(db);
  migrateCalendarEventScheduling(db);
  migrateDerivedStudentFields(db);
  migrateNameColumn(db, "students", { from: "instructor" });
  migrateNameColumn(db, "students", { from: "vehicle" });
  migrateNameColumn(db, "instructors", { from: "vehicle" });
  migrateNameColumn(db, "calendar_events", { from: "instructor" });
  migrateNameColumn(db, "calendar_events", { from: "vehicle" });
  initAccounts(db, demo);
  initSequences(db, demo);
  initSettings(db, demo);
  if (demo) {
    initVehicles(db);
    initInstructors(db);
    initStudents(db);
  }
  // Price plans are editable tariff templates — useful for a new school too.
  initPricePlans(db);
  if (demo) initCalendarEvents(db);
  // Calendar create/update checks absences, so the table must always exist.
  ensureAbsenceTables(db);
  repairSoftReferences(db);
  return db;
}

/* Safety net for the remaining JSON/soft links (theory-group member
   lists, chat threads). Instructor/vehicle links are real FKs
   (instructor_id / vehicle_id) and need no repair. Idempotent and
   cheap, so it runs on every open. */
export function repairSoftReferences(db: Database) {
  const tableExists = (name: string) =>
    db
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(name) !== null;

  if (tableExists("theory_groups")) {
    // Drop member ids whose student is gone — ghosts block group capacity.
    const groups = db
      .query<{ id: number; student_ids: string }, []>(
        "SELECT id, student_ids FROM theory_groups",
      )
      .all();
    const studentExists = db.query<{ n: number }, [number]>(
      "SELECT count(*) AS n FROM students WHERE id = ?",
    );
    const updateGroup = db.prepare(
      "UPDATE theory_groups SET student_ids = ? WHERE id = ?",
    );
    for (const group of groups) {
      let members: number[];
      try {
        const parsed = JSON.parse(group.student_ids) as unknown;
        members = Array.isArray(parsed)
          ? parsed.map(Number).filter((n) => Number.isInteger(n) && n > 0)
          : [];
      } catch {
        members = [];
      }
      const alive = members.filter((sid) => studentExists.get(sid)!.n > 0);
      if (alive.length !== members.length) {
        updateGroup.run(JSON.stringify(alive), group.id);
      }
    }
  }

  if (tableExists("conversations")) {
    db.exec(`
      UPDATE conversations SET student_id = NULL
        WHERE student_id IS NOT NULL
          AND student_id NOT IN (SELECT id FROM students);
    `);
  }
}

/* Databases created before price plans existed lack the column on
   students — CREATE TABLE IF NOT EXISTS won't add it, so ALTER does. */
export function migrateStudentPricePlan(db: Database) {
  const columns = db.query<{ name: string }, []>("PRAGMA table_info(students)").all();
  if (columns.some((column) => column.name === "price_plan_id")) return;
  db.exec(
    "ALTER TABLE students ADD COLUMN price_plan_id INTEGER REFERENCES price_plans(id)",
  );
}

/* Columns added to price_plans / students after their tables shipped:
   the classes a plan is offered for, the per-student contract price
   overrides (§ 32 FahrlG), the Begleitperson (BF17) and the open
   checklist entries. */
export function migrateStudentContractFields(db: Database) {
  const addMissing = (table: string, column: string, ddl: string) => {
    const columns = db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name);
    if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  addMissing("price_plans", "classes", "classes TEXT NOT NULL DEFAULT '[]'");
  addMissing("students", "contract_prices", "contract_prices TEXT NOT NULL DEFAULT '{}'");
  addMissing("students", "companion", "companion TEXT");
  addMissing("students", "open_documents", "open_documents TEXT NOT NULL DEFAULT '[]'");
}

/* Databases created before lesson-billing existed lack the student_id
   and billed_transaction_id columns on calendar_events. Adds them when
   absent and runs a best-effort one-time back-fill: links events to a
   student where the subtitle matches exactly one student's full name;
   leaves NULL on 0 or >1 matches (safe for money). Idempotent. */
export function migrateCalendarEventBilling(db: Database) {
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(calendar_events)")
    .all();
  const hasStudentId = columns.some((c) => c.name === "student_id");
  const hasBilledId = columns.some((c) => c.name === "billed_transaction_id");

  if (!hasStudentId) {
    db.exec(
      "ALTER TABLE calendar_events ADD COLUMN student_id INTEGER REFERENCES students(id)",
    );
    // Best-effort back-fill: set student_id where subtitle matches exactly
    // one student's trimmed full name; leave NULL on 0 or >1 matches.
    db.exec(`
      UPDATE calendar_events
      SET student_id = (
        SELECT id FROM students
        WHERE trim(first_name || ' ' || last_name) = trim(calendar_events.subtitle)
      )
      WHERE subtitle != ''
        AND (
          SELECT count(*) FROM students
          WHERE trim(first_name || ' ' || last_name) = trim(calendar_events.subtitle)
        ) = 1
    `);
  }

  if (!hasBilledId) {
    db.exec(
      "ALTER TABLE calendar_events ADD COLUMN billed_transaction_id INTEGER REFERENCES transactions(id)",
    );
  }
}

/* Databases created before exam-result tracking existed lack the
   exam_result column on calendar_events and the license_date column on
   students. Adds each when absent. Idempotent. */
export function migrateExamResults(db: Database) {
  const eventCols = db
    .query<{ name: string }, []>("PRAGMA table_info(calendar_events)")
    .all()
    .map((c) => c.name);
  if (!eventCols.includes("exam_result")) {
    db.exec("ALTER TABLE calendar_events ADD COLUMN exam_result TEXT");
  }

  const studentCols = db
    .query<{ name: string }, []>("PRAGMA table_info(students)")
    .all()
    .map((c) => c.name);
  if (!studentCols.includes("license_date")) {
    db.exec("ALTER TABLE students ADD COLUMN license_date TEXT");
  }
}

/* Scheduling features on calendar_events — lesson kind (Sonderfahrten),
   recurring series, and cancellation / no-show with an optional fee
   booking. Adds each column when absent. Idempotent. */
export function migrateCalendarEventScheduling(db: Database) {
  const cols = db
    .query<{ name: string }, []>("PRAGMA table_info(calendar_events)")
    .all()
    .map((c) => c.name);
  const add = (name: string, definition: string) => {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE calendar_events ADD COLUMN ${name} ${definition}`);
    }
  };
  add(
    "lesson_kind",
    "TEXT CHECK (lesson_kind IN ('Übungsfahrt','Überlandfahrt','Autobahnfahrt','Nachtfahrt','Grundfahraufgaben'))",
  );
  add("series_id", "TEXT");
  add("cancelled_at", "TEXT");
  add(
    "cancellation_kind",
    "TEXT CHECK (cancellation_kind IN ('abgesagt','nicht_erschienen'))",
  );
  add("cancellation_fee_transaction_id", "INTEGER REFERENCES transactions(id)");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_calendar_events_series ON calendar_events(series_id);",
  );
}

/* Best-effort Fahrtart for practical lessons created before lesson_kind
   existed, read from the title ("Fahrstunde · Autobahn"). Only fills
   NULLs, so deliberate choices are never overwritten. */
export function backfillLessonKinds(db: Database) {
  db.exec(`
    UPDATE calendar_events SET lesson_kind = CASE
        WHEN title LIKE '%autobahn%' THEN 'Autobahnfahrt'
        WHEN title LIKE '%nacht%' OR title LIKE '%dämmerung%' OR title LIKE '%Dämmerung%'
          THEN 'Nachtfahrt'
        WHEN title LIKE '%überland%' OR title LIKE '%Überland%' THEN 'Überlandfahrt'
        WHEN title LIKE '%grundfahraufgabe%' THEN 'Grundfahraufgaben'
      END
    WHERE type = 'Praktisch' AND lesson_kind IS NULL
      AND (title LIKE '%autobahn%' OR title LIKE '%nacht%' OR title LIKE '%dämmerung%'
        OR title LIKE '%Dämmerung%' OR title LIKE '%überland%' OR title LIKE '%Überland%'
        OR title LIKE '%grundfahraufgabe%');
  `);
}

/* balance, last_lesson, next_lesson and lessons were hand-maintained
   copies of ledger/calendar data and drifted (a student could show
   "Bilanz -85,00 EUR" with 450 € Guthaben). They are derived on read now
   (student-facts.ts); this one-time migration tags old lessons with their
   Fahrtart so Sonderfahrten keep counting, then drops the columns. */
export function migrateDerivedStudentFields(db: Database) {
  const cols = db
    .query<{ name: string }, []>("PRAGMA table_info(students)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("balance")) return;
  const migrate = db.transaction(() => {
    backfillLessonKinds(db);
    for (const column of ["balance", "last_lesson", "next_lesson", "lessons"]) {
      if (cols.includes(column)) db.exec(`ALTER TABLE students DROP COLUMN ${column}`);
    }
  });
  migrate();
}

/* Seed price plans — the demo tariffs from src/lib/price-plan.ts. After
   this one-time import the DB is the source of truth (/api/price-plans). */
function initPricePlans(db: Database) {
  const count = db
    .query<{ n: number }, []>("SELECT count(*) AS n FROM price_plans")
    .get()!.n;
  if (count > 0) return;
  const insert = db.prepare(
    `INSERT INTO price_plans (name, guaranteed_months, classes, components)
     VALUES (?, ?, ?, ?)`,
  );
  for (const plan of PRICE_PLAN_SEED) {
    insert.run(
      plan.name,
      plan.guaranteedMonths,
      JSON.stringify(plan.classes ?? []),
      JSON.stringify(plan.components),
    );
  }
}

const VEHICLE_SEED = [
  {
    model: "VW Golf",
    plate: "DA-FS 1234",
    klass: "B197",
    status: "aktiv" as const,
    accent: "bg-sky-500/10 text-sky-600",
    details: [
      { label: "Getriebe", value: "Schaltgetriebe" },
      { label: "Kraftstoff", value: "Diesel" },
      { label: "Kilometerstand", value: "84.320 km" },
      { label: "Fahrlehrer/in", value: "Nadine Aksoy" },
      { label: "Nächste HU", value: "03/2027" },
      { label: "Versicherung", value: "Allianz · gültig" },
    ],
  },
  {
    model: "Cupra Born",
    plate: "DA-FS 9012",
    klass: "B197",
    status: "aktiv" as const,
    accent: "bg-violet-500/10 text-violet-600",
    details: [
      { label: "Getriebe", value: "Automatik" },
      { label: "Kraftstoff", value: "Elektro" },
      { label: "Kilometerstand", value: "24.900 km" },
      { label: "Fahrlehrer/in", value: "Sven Kappel" },
      { label: "Nächste HU", value: "08/2027" },
      { label: "Versicherung", value: "HDI · gültig" },
    ],
  },
  {
    model: "Audi A3",
    plate: "DA-FS 5678",
    klass: "B Automatik",
    status: "wartung" as const,
    accent: "bg-emerald-500/10 text-emerald-600",
    details: [
      { label: "Getriebe", value: "Automatik" },
      { label: "Kraftstoff", value: "Benzin" },
      { label: "Kilometerstand", value: "51.090 km" },
      { label: "Fahrlehrer/in", value: "Emre Yilmaz" },
      { label: "Nächste HU", value: "11/2026" },
      { label: "Versicherung", value: "HUK · gültig" },
    ],
  },
];

function initVehicles(db: Database) {
  const hasPlate = db.query<{ n: number }, [string]>(
    "SELECT count(*) AS n FROM vehicles WHERE plate = ?",
  );
  const insert = db.prepare(
    `INSERT INTO vehicles (model, plate, klass, status, accent, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const vehicle of VEHICLE_SEED) {
    const exists = hasPlate.get(vehicle.plate)!.n > 0;
    if (exists) continue;
    insert.run(
      vehicle.model,
      vehicle.plate,
      vehicle.klass,
      vehicle.status,
      vehicle.accent,
      JSON.stringify(vehicle.details),
    );
  }
}

/* Seed calendar events — the demo week from src/lib/calendar-data.ts,
   authored by weekday (0 = Monday … 6 = Sunday) and anchored to the week
   of the real current date. After this one-time import the DB is the
   source of truth (/api/calendar-events). */
type CalendarEventSeed = {
  day: number;
  start: string;
  end: string;
  title: string;
  subtitle?: string;
  location?: string;
  instructor: string;
  vehicle?: string;
  type:
    | "Praktisch"
    | "Theorie"
    | "Vorstellung zur prakt. Prüfung"
    | "Theorieprüfung"
    | "Andere";
  tentative?: boolean;
};

const CALENDAR_EVENT_SEED: CalendarEventSeed[] = [
  {
    day: 0,
    start: "18:00",
    end: "19:30",
    title: "Thema 9: Verkehrsverhalten bei Fahrmanöver; Verkehrsbeobachtung",
    subtitle: "Martin Weber",
    location: "Fahrschule Demo",
    instructor: "Martin Weber",
    type: "Theorie",
  },
  {
    day: 1,
    start: "09:00",
    end: "09:45",
    title: "Fahrstunde · Stadt",
    subtitle: "Lena Braun",
    instructor: "Nadine Aksoy",
    vehicle: "VW Golf",
    type: "Praktisch",
  },
  {
    day: 1,
    start: "18:00",
    end: "19:30",
    title: "Thema 10: Ruhender Verkehr",
    subtitle: "Martin Weber",
    location: "Fahrschule Demo",
    instructor: "Martin Weber",
    type: "Theorie",
  },
  {
    day: 2,
    start: "11:00",
    end: "12:30",
    title: "Überlandfahrt · Klasse B",
    subtitle: "Jonas Meyer",
    instructor: "Emre Yilmaz",
    vehicle: "Audi A3",
    type: "Praktisch",
  },
  {
    day: 3,
    start: "08:30",
    end: "09:15",
    title: "Fahrübungsstunde · B197",
    subtitle: "Zahra Rezaie",
    instructor: "Martin Weber",
    vehicle: "VW Golf",
    type: "Praktisch",
    tentative: true,
  },
  {
    day: 3,
    start: "14:00",
    end: "15:30",
    title: "Vorstellung · Prüfungsvorbereitung",
    subtitle: "Aylin Demir",
    instructor: "Emre Yilmaz",
    vehicle: "Audi A3",
    type: "Vorstellung zur prakt. Prüfung",
  },
  {
    day: 4,
    start: "10:00",
    end: "10:45",
    title: "Theorieprüfung · TÜV",
    subtitle: "Tom Richter",
    location: "TÜV Süd",
    instructor: "Nadine Aksoy",
    type: "Theorieprüfung",
  },
  {
    day: 4,
    start: "16:00",
    end: "17:00",
    title: "Fahrstunde · Autobahn",
    subtitle: "Mara Köhler",
    instructor: "Nadine Aksoy",
    vehicle: "VW Golf",
    type: "Praktisch",
  },
  {
    day: 5,
    start: "09:00",
    end: "11:00",
    title: "Erste-Hilfe Kurs",
    subtitle: "Gruppe A",
    location: "Fahrschule Demo",
    instructor: "Martin Weber",
    type: "Andere",
  },
];

function initCalendarEvents(db: Database) {
  const count = db
    .query<{ n: number }, []>("SELECT count(*) AS n FROM calendar_events")
    .get()!.n;
  if (count > 0) return;

  // Monday of the current week — same logic as startOfWeek in
  // src/lib/calendar-data.ts (Monday = 0).
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const offset = (today.getDay() + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - offset);
  const toISODate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate(),
    ).padStart(2, "0")}`;

  const insert = db.prepare(
    `INSERT INTO calendar_events
       (date, start, "end", title, subtitle, location, instructor_id, vehicle_id, type, tentative)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const event of CALENDAR_EVENT_SEED) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + event.day);
    insert.run(
      toISODate(date),
      event.start,
      event.end,
      event.title,
      event.subtitle ?? "",
      event.location ?? "",
      instructorIdByName(db, event.instructor),
      event.vehicle ? vehicleIdByName(db, event.vehicle) : null,
      event.type,
      event.tentative ? 1 : 0,
    );
  }
  // The demo titles carry the Fahrtart ("Fahrstunde · Autobahn") and the
  // subtitle names the student — link both like a real booking would.
  backfillLessonKinds(db);
  db.exec(`
    UPDATE calendar_events
    SET student_id = (
      SELECT id FROM students
      WHERE trim(first_name || ' ' || last_name) = trim(calendar_events.subtitle)
    )
    WHERE student_id IS NULL AND type != 'Theorie' AND (
      SELECT count(*) FROM students
      WHERE trim(first_name || ' ' || last_name) = trim(calendar_events.subtitle)
    ) = 1
  `);
}

/* Seed students — the demo roster from src/lib/student-data.ts. After this
   one-time import the DB is the source of truth (/api/students). */
function initStudents(db: Database) {
  const count = db
    .query<{ n: number }, []>("SELECT count(*) AS n FROM students")
    .get()!.n;
  if (count > 0) return;
  const insert = db.prepare(
    `INSERT INTO students (
       first_name, last_name, birthday, phone, email, address, classes,
       driving_school, registration_date, contract_number, customer_number,
       status, instructor_id, vehicle_id, progress, documents, theory
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const s of STUDENT_SEED) {
    insert.run(
      s.firstName,
      s.lastName,
      s.birthday,
      s.phone,
      s.email,
      s.address,
      s.classes,
      s.drivingSchool,
      s.registrationDate,
      s.contractNumber,
      s.customerNumber,
      s.status,
      instructorIdByName(db, s.instructor),
      vehicleIdByName(db, s.vehicle),
      s.progress,
      JSON.stringify(s.documents),
      JSON.stringify(s.theory),
    );
  }
}

/* Seed instructors — the same people the demo calendar/students reference. */
const INSTRUCTOR_SEED = [
  {
    firstName: "Martin",
    lastName: "Weber",
    phone: "+49 151 1000 2000",
    email: "martin.weber@fahrschule-demo.example",
    classes: "B, B197",
    vehicle: "VW Golf",
    since: "03/2008",
    status: "aktiv",
  },
  {
    firstName: "Nadine",
    lastName: "Aksoy",
    phone: "+49 151 5566 7788",
    email: "nadine.aksoy@fahrschule-demo.example",
    classes: "B",
    vehicle: "VW Golf",
    since: "08/2019",
    status: "aktiv",
  },
  {
    firstName: "Emre",
    lastName: "Yilmaz",
    phone: "+49 160 9988 7766",
    email: "emre.yilmaz@fahrschule-demo.example",
    classes: "A, B",
    vehicle: "Audi A3",
    since: "05/2021",
    status: "aktiv",
  },
  {
    firstName: "Sven",
    lastName: "Kappel",
    phone: "+49 171 2233 4455",
    email: "sven.kappel@fahrschule-demo.example",
    classes: "B197",
    vehicle: "Cupra Born",
    since: "02/2024",
    status: "aktiv",
  },
] as const;

function initInstructors(db: Database) {
  const count = db
    .query<{ n: number }, []>("SELECT count(*) AS n FROM instructors")
    .get()!.n;
  if (count > 0) return;
  const insert = db.prepare(
    `INSERT INTO instructors (first_name, last_name, phone, email, classes, vehicle_id, since, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const i of INSTRUCTOR_SEED) {
    insert.run(
      i.firstName,
      i.lastName,
      i.phone,
      i.email,
      i.classes,
      vehicleIdByName(db, i.vehicle),
      i.since,
      i.status,
    );
  }
}

/* Seeds the chart on a fresh database and adds accounts introduced by
   later versions (e.g. 4830 for Mahngebühren) to existing ones. Existing
   rows are never touched — INSERT OR IGNORE on the account number. */
function initAccounts(db: Database, demo: boolean) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO accounts (number, name, kind, vat_rate, vat_label, active, opening_cents, opening_date)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  );
  for (const a of SKR04_ACCOUNTS) {
    insert.run(
      a.number,
      a.name,
      a.kind,
      a.vatRate,
      a.vatLabel,
      // Opening balances are demo figures; a real school enters its own
      // Kassen-/Bankbestand in the setup wizard.
      demo ? (a.openingCents ?? null) : null,
      demo ? (a.openingDate ?? null) : null,
    );
  }
}

function initSequences(db: Database, demo: boolean) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO sequences (name, value) VALUES (?, ?)",
  );
  // Demo: start below the demo numbers so the seed lines up with the old
  // UI (first Beleg T0000124A, first Buchung 00000219A). A real school
  // starts at 1.
  insert.run("beleg", demo ? 123 : 0);
  insert.run("buchung", demo ? 218 : 0);
}

function initSettings(db: Database, demo: boolean) {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('company', ?)").run(
    JSON.stringify(
      demo
        ? DEFAULT_COMPANY
        : {
            ...DEFAULT_COMPANY,
            name: "",
            address: "",
            email: "",
            phone: "",
            website: "",
          },
    ),
  );
}

/** Gapless sequence — call inside the surrounding write transaction. */
export function nextSequence(db: Database, name: string): number {
  db.prepare("INSERT OR IGNORE INTO sequences (name, value) VALUES (?, 0)").run(name);
  const row = db
    .query<{ value: number }, [string]>(
      "UPDATE sequences SET value = value + 1 WHERE name = ? RETURNING value",
    )
    .get(name);
  return row!.value;
}

export function nextBelegNr(db: Database): string {
  return `T${String(nextSequence(db, "beleg")).padStart(7, "0")}A`;
}

export function nextBuchungNr(db: Database): string {
  return `${String(nextSequence(db, "buchung")).padStart(8, "0")}A`;
}

export function nextQuittungNr(db: Database, year: number): string {
  return `Q-${year}-${String(nextSequence(db, `quittung:${year}`)).padStart(5, "0")}`;
}

export function getCompany(db: Database): CompanyProfile {
  const row = db
    .query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'company'")
    .get();
  return { ...DEFAULT_COMPANY, ...(row ? JSON.parse(row.value) : {}) };
}

export function setCompany(db: Database, profile: CompanyProfile) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('company', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify(profile));
}
