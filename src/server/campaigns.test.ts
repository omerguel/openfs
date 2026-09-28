/* ------------------------------------------------------------------ */
/* Unit tests for the campaigns DB module: ensure + seed, CRUD and     */
/* validation. In-memory DB per test.                                  */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import { openSqlite, type Database } from "./sqlite";

import {
  createCampaign,
  deleteCampaign,
  ensureCampaignTables,
  getCampaign,
  listCampaigns,
  updateCampaign,
} from "./campaigns";
import { ValidationError } from "./engine";

let db: Database;

beforeEach(() => {
  db = openSqlite(":memory:");
  ensureCampaignTables(db);
});

const VALID = {
  name: "Sommerkampagne",
  channel: "Google Ads" as const,
  budgetCents: 50000,
  spentCents: 12000,
  manualLeads: 40,
  manualSignups: 5,
  startDate: "2026-06-01",
  endDate: "2026-08-31",
  status: "aktiv" as const,
  notes: "Testlauf",
};

describe("ensureCampaignTables", () => {
  test("a fresh DB seeds 6 campaigns", () => {
    expect(listCampaigns(db)).toHaveLength(6);
  });

  test("is idempotent — running again does not reseed", () => {
    ensureCampaignTables(db);
    ensureCampaignTables(db);
    expect(listCampaigns(db)).toHaveLength(6);
  });

  test("does not reseed once campaigns were deleted down to one", () => {
    const all = listCampaigns(db);
    for (const campaign of all.slice(1)) deleteCampaign(db, campaign.id);
    ensureCampaignTables(db);
    expect(listCampaigns(db)).toHaveLength(1);
  });

  test("seeded campaigns have valid channels, statuses and money", () => {
    for (const campaign of listCampaigns(db)) {
      expect([
        "Google Ads",
        "Instagram",
        "Facebook",
        "TikTok",
        "Flyer",
        "Empfehlung",
        "Webseite",
      ]).toContain(campaign.channel);
      expect(["aktiv", "pausiert", "beendet"]).toContain(campaign.status);
      expect(Number.isInteger(campaign.budgetCents)).toBe(true);
      expect(campaign.spentCents).toBeLessThanOrEqual(campaign.budgetCents);
      expect(campaign.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("list is ordered by start_date descending", () => {
    const campaigns = listCampaigns(db);
    for (let i = 1; i < campaigns.length; i++) {
      expect(campaigns[i - 1]!.startDate >= campaigns[i]!.startDate).toBe(true);
    }
  });
});

describe("createCampaign", () => {
  test("happy path returns the persisted campaign", () => {
    const campaign = createCampaign(db, VALID);
    expect(campaign.id).toBeGreaterThan(0);
    expect(campaign.name).toBe("Sommerkampagne");
    expect(campaign.channel).toBe("Google Ads");
    expect(campaign.budgetCents).toBe(50000);
    expect(campaign.spentCents).toBe(12000);
    expect(campaign.leads).toBe(40);
    expect(campaign.signups).toBe(5);
    expect(campaign.startDate).toBe("2026-06-01");
    expect(campaign.endDate).toBe("2026-08-31");
    expect(campaign.status).toBe("aktiv");
    expect(campaign.notes).toBe("Testlauf");
    expect(campaign.createdAt).toBeTruthy();
  });

  test("applies defaults for omitted numeric fields and status", () => {
    const campaign = createCampaign(db, {
      name: "Minimal",
      channel: "Flyer",
      startDate: "2026-04-01",
    });
    expect(campaign.budgetCents).toBe(0);
    expect(campaign.spentCents).toBe(0);
    expect(campaign.leads).toBe(0);
    expect(campaign.signups).toBe(0);
    expect(campaign.endDate).toBe("");
    expect(campaign.status).toBe("aktiv");
    expect(campaign.notes).toBe("");
  });

  test("trims string fields", () => {
    const campaign = createCampaign(db, { ...VALID, name: "  Spaced  " });
    expect(campaign.name).toBe("Spaced");
  });

  test("empty name → ValidationError 'Name ist ein Pflichtfeld.'", () => {
    expect(() => createCampaign(db, { ...VALID, name: "   " })).toThrow(
      "Name ist ein Pflichtfeld.",
    );
  });

  test("invalid channel → ValidationError 'Ungültiger Kanal.'", () => {
    expect(() => createCampaign(db, { ...VALID, channel: "Plakat" as never })).toThrow(
      "Ungültiger Kanal.",
    );
  });

  test("invalid status → ValidationError", () => {
    expect(() => createCampaign(db, { ...VALID, status: "archiviert" as never })).toThrow(
      "Status muss 'aktiv', 'pausiert' oder 'beendet' sein.",
    );
  });

  test("negative budget → ValidationError", () => {
    expect(() => createCampaign(db, { ...VALID, budgetCents: -1 })).toThrow(
      ValidationError,
    );
  });

  test("non-integer leads → ValidationError", () => {
    expect(() => createCampaign(db, { ...VALID, manualLeads: 1.5 })).toThrow(
      ValidationError,
    );
  });

  test("string spentCents → ValidationError", () => {
    expect(() => createCampaign(db, { ...VALID, spentCents: "120" as never })).toThrow(
      ValidationError,
    );
  });

  test("missing/invalid start date → ValidationError", () => {
    expect(() => createCampaign(db, { ...VALID, startDate: "01.06.2026" })).toThrow(
      "Startdatum muss ein ISO-Datum sein.",
    );
    expect(() => createCampaign(db, { ...VALID, startDate: "" })).toThrow(
      ValidationError,
    );
  });

  test("malformed end date → ValidationError", () => {
    expect(() => createCampaign(db, { ...VALID, endDate: "31.08.2026" })).toThrow(
      "Enddatum muss ein ISO-Datum oder leer sein.",
    );
  });

  test("end before start → ValidationError", () => {
    expect(() => createCampaign(db, { ...VALID, endDate: "2026-05-01" })).toThrow(
      "Enddatum darf nicht vor dem Startdatum liegen.",
    );
  });

  test("empty end date is allowed (laufende Kampagne)", () => {
    const campaign = createCampaign(db, { ...VALID, endDate: "" });
    expect(campaign.endDate).toBe("");
  });
});

describe("getCampaign", () => {
  test("missing id → ValidationError 'Kampagne nicht gefunden.'", () => {
    expect(() => getCampaign(db, 999999)).toThrow("Kampagne nicht gefunden.");
  });
});

describe("updateCampaign", () => {
  test("partial update merges over current values", () => {
    const created = createCampaign(db, VALID);
    const updated = updateCampaign(db, created.id, {
      spentCents: 25000,
      manualLeads: 80,
    });
    expect(updated.spentCents).toBe(25000);
    expect(updated.leads).toBe(80);
    expect(updated.name).toBe("Sommerkampagne"); // unchanged field preserved
    expect(updated.budgetCents).toBe(50000);
    expect(updated.status).toBe("aktiv");
  });

  test("pause/resume via status patch", () => {
    const created = createCampaign(db, VALID);
    expect(updateCampaign(db, created.id, { status: "pausiert" }).status).toBe(
      "pausiert",
    );
    expect(updateCampaign(db, created.id, { status: "aktiv" }).status).toBe("aktiv");
  });

  test("invalid update is rejected and keeps current values", () => {
    const created = createCampaign(db, VALID);
    expect(() => updateCampaign(db, created.id, { endDate: "2026-01-01" })).toThrow(
      "Enddatum darf nicht vor dem Startdatum liegen.",
    );
    expect(getCampaign(db, created.id).endDate).toBe("2026-08-31");
  });

  test("update on missing id → ValidationError", () => {
    expect(() => updateCampaign(db, 999999, { name: "x" })).toThrow(
      "Kampagne nicht gefunden.",
    );
  });
});

describe("deleteCampaign", () => {
  test("removes the campaign (hard delete)", () => {
    const created = createCampaign(db, VALID);
    const before = listCampaigns(db).length;
    deleteCampaign(db, created.id);
    expect(listCampaigns(db).length).toBe(before - 1);
    expect(() => getCampaign(db, created.id)).toThrow("Kampagne nicht gefunden.");
  });

  test("delete on missing id → ValidationError", () => {
    expect(() => deleteCampaign(db, 999999)).toThrow("Kampagne nicht gefunden.");
  });
});
