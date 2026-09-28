/* ------------------------------------------------------------------ */
/* Campaigns (Marketing) — DB access + validation + HTTP wrappers.     */
/* Self-contained: ensureCampaignTables(db) creates + seeds the table, */
/* campaignRoutes(db) mounts into the Bun.serve() routes object.       */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import { ValidationError } from "./engine";
import { handle, json } from "./http";
import { demoDataEnabled } from "./db";

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
  budgetCents: number;
  spentCents: number;
  leads: number;
  signups: number;
  startDate: string;
  /** Empty string = open-ended (laufend). */
  endDate: string;
  status: CampaignStatus;
  notes: string;
  createdAt: string;
};

export type CampaignInput = Omit<Campaign, "id" | "createdAt">;

type CampaignRow = {
  id: number;
  name: string;
  channel: CampaignChannel;
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

const toCampaign = (row: CampaignRow): Campaign => ({
  id: row.id,
  name: row.name,
  channel: row.channel,
  budgetCents: row.budget_cents,
  spentCents: row.spent_cents,
  leads: row.leads,
  signups: row.signups,
  startDate: row.start_date,
  endDate: row.end_date,
  status: row.status,
  notes: row.notes,
  createdAt: row.created_at,
});

/* ------------------------------------------------------------------ */
/* Schema + seed                                                       */
/* ------------------------------------------------------------------ */

const SEED_CAMPAIGNS: CampaignInput[] = [
  {
    name: "Frühjahrsoffensive Suchanzeigen",
    channel: "Google Ads",
    budgetCents: 120000,
    spentCents: 78450,
    leads: 96,
    signups: 14,
    startDate: "2026-03-01",
    endDate: "2026-05-31",
    status: "aktiv",
    notes: "Keywords: Führerschein, Fahrschule + Stadtteil. Anzeigen B/BF17.",
  },
  {
    name: "Instagram Reels „Erste Fahrstunde“",
    channel: "Instagram",
    budgetCents: 60000,
    spentCents: 41200,
    leads: 73,
    signups: 9,
    startDate: "2026-02-15",
    endDate: "",
    status: "aktiv",
    notes: "Reels mit Fahrlehrer-Tipps, Zielgruppe 16–24 im Umkreis 25 km.",
  },
  {
    name: "TikTok Challenge #Führerschein2026",
    channel: "TikTok",
    budgetCents: 45000,
    spentCents: 45000,
    leads: 152,
    signups: 11,
    startDate: "2026-01-10",
    endDate: "2026-03-10",
    status: "beendet",
    notes: "Viral gelaufen, aber viele unqualifizierte Leads.",
  },
  {
    name: "Flyer Abiturjahrgang Gymnasien",
    channel: "Flyer",
    budgetCents: 25000,
    spentCents: 18900,
    leads: 21,
    signups: 6,
    startDate: "2026-04-01",
    endDate: "2026-04-30",
    status: "beendet",
    notes: "Verteilung an 4 Gymnasien, Gutschein-Code ABI26.",
  },
  {
    name: "Empfehlungsprogramm „Freunde werben“",
    channel: "Empfehlung",
    budgetCents: 30000,
    spentCents: 12500,
    leads: 18,
    signups: 8,
    startDate: "2026-01-01",
    endDate: "",
    status: "aktiv",
    notes: "25 EUR Fahrstunden-Gutschrift pro erfolgreicher Empfehlung.",
  },
  {
    name: "Facebook Lokalkampagne Eltern",
    channel: "Facebook",
    budgetCents: 40000,
    spentCents: 22300,
    leads: 34,
    signups: 5,
    startDate: "2026-03-15",
    endDate: "2026-06-15",
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

  const count = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM campaigns")
    .get()!.n;
  if (count > 0 || !demoDataEnabled(db)) return;

  const insert = db.prepare(
    `INSERT INTO campaigns
       (name, channel, budget_cents, spent_cents, leads, signups, start_date, end_date, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const seedAll = db.transaction(() => {
    for (const c of SEED_CAMPAIGNS) {
      insert.run(
        c.name,
        c.channel,
        c.budgetCents,
        c.spentCents,
        c.leads,
        c.signups,
        c.startDate,
        c.endDate,
        c.status,
        c.notes,
      );
    }
  });
  seedAll();
}

/* ------------------------------------------------------------------ */
/* CRUD + validation                                                   */
/* ------------------------------------------------------------------ */

const SELECT = `SELECT id, name, channel, budget_cents, spent_cents, leads,
  signups, start_date, end_date, status, notes, created_at FROM campaigns`;

export function listCampaigns(db: Database): Campaign[] {
  return db
    .query<CampaignRow, []>(`${SELECT} ORDER BY start_date DESC, name`)
    .all()
    .map(toCampaign);
}

export function getCampaign(db: Database, id: number): Campaign {
  const row = db.query<CampaignRow, [number]>(`${SELECT} WHERE id = ?`).get(id);
  if (!row) throw new ValidationError("Kampagne nicht gefunden.");
  return toCampaign(row);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const EMPTY: CampaignInput = {
  name: "",
  channel: "Google Ads",
  budgetCents: 0,
  spentCents: 0,
  leads: 0,
  signups: 0,
  startDate: "",
  endDate: "",
  status: "aktiv",
  notes: "",
};

/* Merge a partial payload over current values, trimming strings and
   applying the validation rules shared by create and update. */
function normalize(input: Partial<CampaignInput>, current: CampaignInput): CampaignInput {
  const str = (key: "name" | "startDate" | "endDate" | "notes"): string => {
    const value = input[key];
    if (value === undefined) return current[key];
    if (typeof value !== "string") {
      throw new ValidationError(`Feld '${key}' muss ein Text sein.`);
    }
    return value.trim();
  };

  const int = (key: "budgetCents" | "spentCents" | "leads" | "signups"): number => {
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

  return {
    name,
    channel: channel as CampaignChannel,
    budgetCents: int("budgetCents"),
    spentCents: int("spentCents"),
    leads: int("leads"),
    signups: int("signups"),
    startDate,
    endDate,
    status: status as CampaignStatus,
    notes: str("notes"),
  };
}

export function createCampaign(db: Database, input: Partial<CampaignInput>): Campaign {
  const data = normalize(input, EMPTY);
  const row = db
    .query<
      { id: number },
      [string, string, number, number, number, number, string, string, string, string]
    >(
      `INSERT INTO campaigns
         (name, channel, budget_cents, spent_cents, leads, signups, start_date, end_date, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      data.name,
      data.channel,
      data.budgetCents,
      data.spentCents,
      data.leads,
      data.signups,
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
  const data = normalize(input, current);
  db.prepare(
    `UPDATE campaigns
     SET name = ?, channel = ?, budget_cents = ?, spent_cents = ?, leads = ?,
         signups = ?, start_date = ?, end_date = ?, status = ?, notes = ?
     WHERE id = ?`,
  ).run(
    data.name,
    data.channel,
    data.budgetCents,
    data.spentCents,
    data.leads,
    data.signups,
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
  db.prepare("DELETE FROM campaigns WHERE id = ?").run(id);
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
