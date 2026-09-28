/* ------------------------------------------------------------------ */
/* Campaigns (Marketing) — DB access + validation + HTTP wrappers.     */
/* Self-contained: ensureCampaignTables(db) creates + seeds the table, */
/* campaignRoutes(db) mounts into the Bun.serve() routes object.       */
/*                                                                     */
/* Lead attribution: every campaign has a unique tracking_code; the    */
/* public /anfrage form reads ?kampagne=<code> (or utm_campaign) and   */
/* stores the campaign on the appointment request. `leads` and        */
/* `signups` are derived on read: tracked requests (+ requests whose   */
/* requester became a student) plus the manually kept numbers for      */
/* offline channels (Flyer, Empfehlung). Ad spend stays manual — the  */
/* Google Ads and Meta Marketing APIs need a developer token / app     */
/* review per school, which a small Fahrschule rarely gets.            */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import { ValidationError } from "./engine";
import { handle, json } from "./http";
import { demoDataEnabled } from "./db";
import { schoolToday } from "./school-time";

export type CampaignChannel =
  | "Google Ads"
  | "Instagram"
  | "Facebook"
  | "TikTok"
  | "Flyer"
  | "Empfehlung"
  | "Webseite";

export const CAMPAIGN_CHANNELS: CampaignChannel[] = [
  "Google Ads",
  "Instagram",
  "Facebook",
  "TikTok",
  "Flyer",
  "Empfehlung",
  "Webseite",
];

export type CampaignStatus = "aktiv" | "pausiert" | "beendet";

export const CAMPAIGN_STATUSES: CampaignStatus[] = ["aktiv", "pausiert", "beendet"];

export type Campaign = {
  id: number;
  name: string;
  channel: CampaignChannel;
  /** Unique slug for the /anfrage?kampagne=<code> tracking link. */
  trackingCode: string;
  budgetCents: number;
  spentCents: number;
  /** Derived: manualLeads + trackedLeads. */
  leads: number;
  /** Derived: manualSignups + trackedSignups. */
  signups: number;
  /** Offline leads counted by hand (Flyer, Telefon, Empfehlung). */
  manualLeads: number;
  manualSignups: number;
  /** Appointment requests that came in through the tracking link. */
  trackedLeads: number;
  /** …of which the requester was taken on as a student. */
  trackedSignups: number;
  startDate: string;
  /** Empty string = open-ended (laufend). */
  endDate: string;
  /** Effective status: a campaign whose end date has passed reads as
      "beendet" even if it was never switched off by hand. */
  status: CampaignStatus;
  /** True when `status` is "beendet" only because the end date passed. */
  endedByDate: boolean;
  notes: string;
  createdAt: string;
};

export type CampaignInput = Omit<
  Campaign,
  | "id"
  | "createdAt"
  | "leads"
  | "signups"
  | "trackedLeads"
  | "trackedSignups"
  | "endedByDate"
>;

type CampaignRow = {
  id: number;
  name: string;
  channel: CampaignChannel;
  tracking_code: string;
  budget_cents: number;
  spent_cents: number;
  leads: number;
  signups: number;
  start_date: string;
  end_date: string;
  status: CampaignStatus;
  notes: string;
  created_at: string;
};

/** Stored status, or "beendet" once the end date lies before `today`. */
export function effectiveCampaignStatus(
  status: CampaignStatus,
  endDate: string,
  today: string,
): CampaignStatus {
  return status !== "beendet" && endDate !== "" && endDate < today ? "beendet" : status;
}

const toCampaign = (
  row: CampaignRow,
  tracked: { leads: number; signups: number } = { leads: 0, signups: 0 },
  today = schoolToday(),
): Campaign => ({
  id: row.id,
  name: row.name,
  channel: row.channel,
  trackingCode: row.tracking_code,
  budgetCents: row.budget_cents,
  spentCents: row.spent_cents,
  leads: row.leads + tracked.leads,
  signups: row.signups + tracked.signups,
  manualLeads: row.leads,
  manualSignups: row.signups,
  trackedLeads: tracked.leads,
  trackedSignups: tracked.signups,
  startDate: row.start_date,
  endDate: row.end_date,
  status: effectiveCampaignStatus(row.status, row.end_date, today),
  endedByDate: effectiveCampaignStatus(row.status, row.end_date, today) !== row.status,
  notes: row.notes,
  createdAt: row.created_at,
});

/* ------------------------------------------------------------------ */
/* Schema + seed                                                       */
/* ------------------------------------------------------------------ */

/* ISO date `months` (and `days`) away from today — keeps the demo
   campaigns current: running ones run now, finished ones ended. */
function monthsFromToday(months: number, day = 1): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + months, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/* Last day of the month `months` away. */
const monthEnd = (months: number) => monthsFromToday(months + 1, 0);

const seedCampaigns = (): CampaignInput[] => [
  {
    name: "Suchanzeigen Führerschein B",
    channel: "Google Ads",
    trackingCode: "suche-fuehrerschein-b",
    budgetCents: 120000,
    spentCents: 78450,
    manualLeads: 96,
    manualSignups: 14,
    startDate: monthsFromToday(-2),
    endDate: monthEnd(1),
    status: "aktiv",
    notes: "Keywords: Führerschein, Fahrschule + Stadtteil. Anzeigen B/BF17.",
  },
  {
    name: "Instagram Reels „Erste Fahrstunde“",
    channel: "Instagram",
    trackingCode: "reels-erste-fahrstunde",
    budgetCents: 60000,
    spentCents: 41200,
    manualLeads: 73,
    manualSignups: 9,
    startDate: monthsFromToday(-7, 15),
    endDate: "",
    status: "aktiv",
    notes: "Reels mit Fahrlehrer-Tipps, Zielgruppe 16–24 im Umkreis 25 km.",
  },
  {
    name: "TikTok Challenge #Führerschein",
    channel: "TikTok",
    trackingCode: "tiktok-fuehrerschein",
    budgetCents: 45000,
    spentCents: 45000,
    manualLeads: 152,
    manualSignups: 11,
    startDate: monthsFromToday(-8, 10),
    endDate: monthsFromToday(-6, 10),
    status: "beendet",
    notes: "Viral gelaufen, aber viele unqualifizierte Leads.",
  },
  {
    name: "Flyer Abiturjahrgang Gymnasien",
    channel: "Flyer",
    trackingCode: "flyer-abi",
    budgetCents: 25000,
    spentCents: 18900,
    manualLeads: 21,
    manualSignups: 6,
    startDate: monthsFromToday(-5),
    endDate: monthEnd(-5),
    status: "beendet",
    notes: "Verteilung an 4 Gymnasien, Gutschein-Code ABI.",
  },
  {
    name: "Empfehlungsprogramm „Freunde werben“",
    channel: "Empfehlung",
    trackingCode: "freunde-werben",
    budgetCents: 30000,
    spentCents: 12500,
    manualLeads: 18,
    manualSignups: 8,
    startDate: monthsFromToday(-9),
    endDate: "",
    status: "aktiv",
    notes: "25 EUR Fahrstunden-Gutschrift pro erfolgreicher Empfehlung.",
  },
  {
    name: "Facebook Lokalkampagne Eltern",
    channel: "Facebook",
    trackingCode: "facebook-eltern",
    budgetCents: 40000,
    spentCents: 22300,
    manualLeads: 34,
    manualSignups: 5,
    startDate: monthsFromToday(-3, 15),
    endDate: monthsFromToday(2, 15),
    status: "pausiert",
    notes: "Pausiert bis neue Kreative fertig sind.",
  },
];

export function ensureCampaignTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN (
        'Google Ads','Instagram','Facebook','TikTok','Flyer','Empfehlung','Webseite'
      )),
      tracking_code TEXT,
      budget_cents INTEGER NOT NULL DEFAULT 0,
      spent_cents INTEGER NOT NULL DEFAULT 0,
      leads INTEGER NOT NULL DEFAULT 0,
      signups INTEGER NOT NULL DEFAULT 0,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','pausiert','beendet')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  migrateTrackingCodes(db);

  const count = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM campaigns")
    .get()!.n;
  if (count > 0 || !demoDataEnabled(db)) return;

  const insert = db.prepare(
    `INSERT INTO campaigns
       (name, channel, tracking_code, budget_cents, spent_cents, leads, signups,
        start_date, end_date, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const seedAll = db.transaction(() => {
    for (const c of seedCampaigns()) {
      insert.run(
        c.name,
        c.channel,
        c.trackingCode,
        c.budgetCents,
        c.spentCents,
        c.manualLeads,
        c.manualSignups,
        c.startDate,
        c.endDate,
        c.status,
        c.notes,
      );
    }
  });
  seedAll();
}

/* Campaigns created before lead attribution lack tracking_code: add the
   column, give every row a slug and enforce uniqueness. Idempotent. */
function migrateTrackingCodes(db: Database) {
  const cols = db
    .query<{ name: string }, []>("PRAGMA table_info(campaigns)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("tracking_code")) {
    db.exec("ALTER TABLE campaigns ADD COLUMN tracking_code TEXT");
  }
  const missing = db
    .query<{ id: number; name: string }, []>(
      "SELECT id, name FROM campaigns WHERE tracking_code IS NULL OR tracking_code = '' ORDER BY id",
    )
    .all();
  const setCode = db.prepare("UPDATE campaigns SET tracking_code = ? WHERE id = ?");
  for (const row of missing) setCode.run(uniqueTrackingCode(db, row.name), row.id);
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_tracking_code ON campaigns(tracking_code)",
  );
}

/* ------------------------------------------------------------------ */
/* Tracking codes                                                      */
/* ------------------------------------------------------------------ */

const TRACKING_CODE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** "Frühjahr: Suchanzeigen 2026!" → "fruehjahr-suchanzeigen-2026". */
export function slugifyTrackingCode(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function trackingCodeTaken(db: Database, code: string, exceptId?: number): boolean {
  return (
    db
      .query<{ id: number }, [string, number]>(
        "SELECT id FROM campaigns WHERE tracking_code = ? AND id != ?",
      )
      .get(code, exceptId ?? -1) !== null
  );
}

/** Slug of `name`, suffixed -2, -3, … until it is free. */
function uniqueTrackingCode(db: Database, name: string, exceptId?: number): string {
  const base = slugifyTrackingCode(name) || "kampagne";
  let code = base;
  for (let n = 2; trackingCodeTaken(db, code, exceptId); n++) {
    code = `${base.slice(0, 36)}-${n}`;
  }
  return code;
}

/** Campaign id for a tracking code (case-insensitive), or null. */
export function campaignIdByTrackingCode(db: Database, code: string): number | null {
  const slug = code.trim().toLowerCase();
  if (!slug || !TRACKING_CODE.test(slug)) return null;
  const row = db
    .query<{ id: number }, [string]>("SELECT id FROM campaigns WHERE tracking_code = ?")
    .get(slug);
  return row?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* CRUD + validation                                                   */
/* ------------------------------------------------------------------ */

const SELECT = `SELECT id, name, channel, tracking_code, budget_cents, spent_cents, leads,
  signups, start_date, end_date, status, notes, created_at FROM campaigns`;

/* Requests per campaign from appointment_requests (campaign_id), and
   how many of them were taken on as students (student_id). Tolerant of
   schemas without the requests table (unit tests). */
function trackedCounts(db: Database): Map<number, { leads: number; signups: number }> {
  const counts = new Map<number, { leads: number; signups: number }>();
  const cols = db
    .query<{ name: string }, []>("PRAGMA table_info(appointment_requests)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("campaign_id")) return counts;
  const hasStudents =
    cols.includes("student_id") &&
    db
      .query<{ n: number }, []>(
        "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'students'",
      )
      .get()!.n > 0;
  const signups = hasStudents
    ? "SUM(CASE WHEN r.student_id IN (SELECT id FROM students) THEN 1 ELSE 0 END)"
    : "0";
  for (const row of db
    .query<{ campaign_id: number; leads: number; signups: number }, []>(
      `SELECT r.campaign_id, count(*) AS leads, ${signups} AS signups
       FROM appointment_requests r WHERE r.campaign_id IS NOT NULL
       GROUP BY r.campaign_id`,
    )
    .all()) {
    counts.set(row.campaign_id, { leads: row.leads, signups: row.signups ?? 0 });
  }
  return counts;
}

export function listCampaigns(db: Database): Campaign[] {
  const tracked = trackedCounts(db);
  return db
    .query<CampaignRow, []>(`${SELECT} ORDER BY start_date DESC, name`)
    .all()
    .map((row) => toCampaign(row, tracked.get(row.id)));
}

export function getCampaign(db: Database, id: number): Campaign {
  const row = db.query<CampaignRow, [number]>(`${SELECT} WHERE id = ?`).get(id);
  if (!row) throw new ValidationError("Kampagne nicht gefunden.");
  return toCampaign(row, trackedCounts(db).get(id));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const EMPTY: CampaignInput = {
  name: "",
  channel: "Google Ads",
  trackingCode: "",
  budgetCents: 0,
  spentCents: 0,
  manualLeads: 0,
  manualSignups: 0,
  startDate: "",
  endDate: "",
  status: "aktiv",
  notes: "",
};

/* Merge a partial payload over current values, trimming strings and
   applying the validation rules shared by create and update. `leads` /
   `signups` are derived — older clients sending them are ignored. An
   empty tracking code is generated from the name. */
function normalize(
  db: Database,
  input: Partial<CampaignInput>,
  current: CampaignInput,
  id?: number,
): CampaignInput {
  const str = (key: "name" | "startDate" | "endDate" | "notes"): string => {
    const value = input[key];
    if (value === undefined) return current[key];
    if (typeof value !== "string") {
      throw new ValidationError(`Feld '${key}' muss ein Text sein.`);
    }
    return value.trim();
  };

  const int = (
    key: "budgetCents" | "spentCents" | "manualLeads" | "manualSignups",
  ): number => {
    const value = input[key];
    if (value === undefined) return current[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new ValidationError(`Feld '${key}' muss eine nicht-negative Ganzzahl sein.`);
    }
    return value;
  };

  const name = str("name");
  if (!name) {
    throw new ValidationError("Name ist ein Pflichtfeld.");
  }

  const channel = input.channel === undefined ? current.channel : input.channel;
  if (!CAMPAIGN_CHANNELS.includes(channel as CampaignChannel)) {
    throw new ValidationError("Ungültiger Kanal.");
  }

  const status = input.status === undefined ? current.status : input.status;
  if (!CAMPAIGN_STATUSES.includes(status as CampaignStatus)) {
    throw new ValidationError("Status muss 'aktiv', 'pausiert' oder 'beendet' sein.");
  }

  const startDate = str("startDate");
  if (!ISO_DATE.test(startDate)) {
    throw new ValidationError("Startdatum muss ein ISO-Datum sein.");
  }

  const endDate = str("endDate");
  if (endDate && !ISO_DATE.test(endDate)) {
    throw new ValidationError("Enddatum muss ein ISO-Datum oder leer sein.");
  }
  if (endDate && endDate < startDate) {
    throw new ValidationError("Enddatum darf nicht vor dem Startdatum liegen.");
  }

  let trackingCode = current.trackingCode;
  if (input.trackingCode !== undefined) {
    if (typeof input.trackingCode !== "string") {
      throw new ValidationError("Feld 'trackingCode' muss ein Text sein.");
    }
    trackingCode = input.trackingCode.trim().toLowerCase();
    if (trackingCode && !TRACKING_CODE.test(trackingCode)) {
      throw new ValidationError(
        "Tracking-Code: nur Kleinbuchstaben, Ziffern und Bindestriche (max. 40 Zeichen).",
      );
    }
  }
  if (!trackingCode) trackingCode = uniqueTrackingCode(db, name, id);
  else if (trackingCodeTaken(db, trackingCode, id)) {
    throw new ValidationError(`Tracking-Code „${trackingCode}“ ist bereits vergeben.`);
  }

  return {
    name,
    channel: channel as CampaignChannel,
    trackingCode,
    budgetCents: int("budgetCents"),
    spentCents: int("spentCents"),
    manualLeads: int("manualLeads"),
    manualSignups: int("manualSignups"),
    startDate,
    endDate,
    status: status as CampaignStatus,
    notes: str("notes"),
  };
}

export function createCampaign(db: Database, input: Partial<CampaignInput>): Campaign {
  const data = normalize(db, input, EMPTY);
  const row = db
    .query<
      { id: number },
      [
        string,
        string,
        string,
        number,
        number,
        number,
        number,
        string,
        string,
        string,
        string,
      ]
    >(
      `INSERT INTO campaigns
         (name, channel, tracking_code, budget_cents, spent_cents, leads, signups,
          start_date, end_date, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      data.name,
      data.channel,
      data.trackingCode,
      data.budgetCents,
      data.spentCents,
      data.manualLeads,
      data.manualSignups,
      data.startDate,
      data.endDate,
      data.status,
      data.notes,
    )!;
  return getCampaign(db, row.id);
}

export function updateCampaign(
  db: Database,
  id: number,
  input: Partial<CampaignInput>,
): Campaign {
  const current = getCampaign(db, id);
  const data = normalize(db, input, current, id);
  db.prepare(
    `UPDATE campaigns
     SET name = ?, channel = ?, tracking_code = ?, budget_cents = ?, spent_cents = ?,
         leads = ?, signups = ?, start_date = ?, end_date = ?, status = ?, notes = ?
     WHERE id = ?`,
  ).run(
    data.name,
    data.channel,
    data.trackingCode,
    data.budgetCents,
    data.spentCents,
    data.manualLeads,
    data.manualSignups,
    data.startDate,
    data.endDate,
    data.status,
    data.notes,
    id,
  );
  return getCampaign(db, id);
}

export function deleteCampaign(db: Database, id: number): void {
  getCampaign(db, id); // throws ValidationError when missing
  const remove = db.transaction(() => {
    // Requests stay; they just lose their attribution.
    const cols = db
      .query<{ name: string }, []>("PRAGMA table_info(appointment_requests)")
      .all();
    if (cols.some((c) => c.name === "campaign_id")) {
      db.prepare(
        "UPDATE appointment_requests SET campaign_id = NULL WHERE campaign_id = ?",
      ).run(id);
    }
    db.prepare("DELETE FROM campaigns WHERE id = ?").run(id);
  });
  remove();
}

/* ------------------------------------------------------------------ */
/* HTTP layer — same shape as the factories in routes.ts.              */
/* ------------------------------------------------------------------ */

export function campaignRoutes(db: Database) {
  ensureCampaignTables(db);

  return {
    "/api/campaigns": {
      GET: () => handle(() => json({ campaigns: listCampaigns(db) }))(),
      POST: (req: BunRequest) =>
        handle(async () =>
          json(createCampaign(db, (await req.json()) as Partial<CampaignInput>), 201),
        )(),
    },

    "/api/campaigns/:id": {
      PATCH: (req: BunRequest<"/api/campaigns/:id">) =>
        handle(async () => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Kampagnen-ID.");
          }
          return json(
            updateCampaign(db, id, (await req.json()) as Partial<CampaignInput>),
          );
        })(),
      DELETE: (req: BunRequest<"/api/campaigns/:id">) =>
        handle(() => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Kampagnen-ID.");
          }
          deleteCampaign(db, id);
          return json({ ok: true });
        })(),
    },
  };
}
