/* ------------------------------------------------------------------ */
/* Campaign lead attribution: tracking codes, requests from the public  */
/* form counted as leads, "Als Fahrschüler anlegen" links counted as    */
/* signups, and the cleanup when campaigns or students are deleted.     */
/* Full in-memory schema via openDb(":memory:").                       */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";

import {
  appointmentRequestRoutes,
  createAppointmentRequest,
  ensureAppointmentRequestTables,
  getAppointmentRequest,
  linkAppointmentRequestStudent,
} from "./appointment-requests";
import {
  campaignIdByTrackingCode,
  createCampaign,
  deleteCampaign,
  ensureCampaignTables,
  getCampaign,
  listCampaigns,
  slugifyTrackingCode,
  updateCampaign,
} from "./campaigns";
import { openDb } from "./db";
import { openSqlite, type Database } from "./sqlite";
import { createStudent, deleteStudent } from "./students";

let db: Database;

beforeEach(() => {
  db = openDb(":memory:");
  ensureCampaignTables(db);
  ensureAppointmentRequestTables(db);
});

const CAMPAIGN = {
  name: "Flyer Abi 2027",
  channel: "Flyer" as const,
  startDate: "2026-09-01",
  manualLeads: 10,
  manualSignups: 2,
};

const REQUEST = {
  name: "Lea Sommer",
  phone: "0151 1234567",
  email: "lea@example.de",
  requestedDate: "2031-05-05",
  requestedTime: "15:00",
};

let seq = 0;
function student() {
  seq += 1;
  return createStudent(db, {
    firstName: "Lea",
    lastName: "Sommer",
    contractNumber: `V-A-${seq}`,
    customerNumber: `K-A-${seq}`,
  });
}

describe("tracking codes", () => {
  test("slugify handles umlauts, punctuation and length", () => {
    expect(slugifyTrackingCode("Frühjahr: Suchanzeigen 2026!")).toBe(
      "fruehjahr-suchanzeigen-2026",
    );
    expect(slugifyTrackingCode("Straße & Café")).toBe("strasse-cafe");
    expect(slugifyTrackingCode("x".repeat(60))).toHaveLength(40);
  });

  test("seeded campaigns all carry unique codes", () => {
    const codes = listCampaigns(db).map((c) => c.trackingCode);
    expect(codes.every(Boolean)).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("an empty code is generated from the name and made unique", () => {
    const a = createCampaign(db, CAMPAIGN);
    const b = createCampaign(db, CAMPAIGN);
    expect(a.trackingCode).toBe("flyer-abi-2027");
    expect(b.trackingCode).toBe("flyer-abi-2027-2");
  });

  test("codes are editable, validated and unique", () => {
    const a = createCampaign(db, { ...CAMPAIGN, trackingCode: "Abi27" });
    expect(a.trackingCode).toBe("abi27");
    expect(() => createCampaign(db, { ...CAMPAIGN, trackingCode: "abi27" })).toThrow(
      "bereits vergeben",
    );
    expect(() => updateCampaign(db, a.id, { trackingCode: "mit leerzeichen" })).toThrow(
      "Tracking-Code",
    );
    // Saving the campaign with its own code is fine.
    expect(updateCampaign(db, a.id, { trackingCode: "abi27" }).trackingCode).toBe(
      "abi27",
    );
    expect(campaignIdByTrackingCode(db, "ABI27")).toBe(a.id);
    expect(campaignIdByTrackingCode(db, "gibt-es-nicht")).toBeNull();
  });

  test("a campaigns table from before attribution gets codes", () => {
    const old = openSqlite(":memory:");
    old.exec(`CREATE TABLE campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, channel TEXT NOT NULL,
      budget_cents INTEGER NOT NULL DEFAULT 0, spent_cents INTEGER NOT NULL DEFAULT 0,
      leads INTEGER NOT NULL DEFAULT 0, signups INTEGER NOT NULL DEFAULT 0,
      start_date TEXT NOT NULL, end_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'aktiv', notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    old.exec(`INSERT INTO campaigns (name, channel, leads, start_date) VALUES
      ('Sommer', 'Flyer', 7, '2026-06-01'), ('Sommer', 'Flyer', 3, '2026-07-01')`);
    ensureCampaignTables(old);
    const campaigns = listCampaigns(old);
    expect(campaigns.map((c) => c.trackingCode).toSorted()).toEqual([
      "sommer",
      "sommer-2",
    ]);
    // The stored numbers survive as the manual share.
    expect(campaigns.map((c) => c.manualLeads).toSorted()).toEqual([3, 7]);
  });
});

describe("derived leads and signups", () => {
  test("requests with the code count as leads on top of manual leads", () => {
    const campaign = createCampaign(db, { ...CAMPAIGN, trackingCode: "abi27" });
    const request = createAppointmentRequest(db, { ...REQUEST, campaign: "abi27" });
    createAppointmentRequest(db, { ...REQUEST, campaign: "ABI27" });
    createAppointmentRequest(db, { ...REQUEST, campaign: "unbekannt" });
    createAppointmentRequest(db, REQUEST);
    expect(request).toMatchObject({
      campaignId: campaign.id,
      campaignName: "Flyer Abi 2027",
    });
    expect(getCampaign(db, campaign.id)).toMatchObject({
      manualLeads: 10,
      trackedLeads: 2,
      leads: 12,
      trackedSignups: 0,
      signups: 2,
    });
  });

  test("an unknown code never fails the public request", () => {
    const request = createAppointmentRequest(db, { ...REQUEST, campaign: "<script>" });
    expect(request.campaignId).toBeNull();
  });

  test("linking the created student turns the lead into a signup", () => {
    const campaign = createCampaign(db, { ...CAMPAIGN, trackingCode: "abi27" });
    const request = createAppointmentRequest(db, { ...REQUEST, campaign: "abi27" });
    const lea = student();
    const linked = linkAppointmentRequestStudent(db, request.id, lea.id);
    expect(linked).toMatchObject({ studentId: lea.id, studentName: "Lea Sommer" });
    expect(getCampaign(db, campaign.id)).toMatchObject({ trackedSignups: 1, signups: 3 });

    expect(() => linkAppointmentRequestStudent(db, request.id, 999_999)).toThrow(
      "nicht gefunden",
    );
    expect(() => linkAppointmentRequestStudent(db, request.id, "x")).toThrow("studentId");

    // Deleting the student clears the link (and the signup).
    deleteStudent(db, lea.id);
    expect(getAppointmentRequest(db, request.id).studentId).toBeNull();
    expect(getCampaign(db, campaign.id).trackedSignups).toBe(0);
  });

  test("deleting a campaign keeps its requests without attribution", () => {
    const campaign = createCampaign(db, { ...CAMPAIGN, trackingCode: "abi27" });
    const request = createAppointmentRequest(db, { ...REQUEST, campaign: "abi27" });
    deleteCampaign(db, campaign.id);
    expect(getAppointmentRequest(db, request.id)).toMatchObject({
      campaignId: null,
      campaignName: null,
    });
  });

  test("leads/signups sent by old clients are ignored", () => {
    const campaign = createCampaign(db, CAMPAIGN);
    const updated = updateCampaign(db, campaign.id, {
      leads: 999,
      signups: 999,
    } as Parameters<typeof updateCampaign>[2]);
    expect(updated).toMatchObject({ leads: 10, signups: 2 });
  });
});

describe("routes", () => {
  test("POST with campaign code and PUT /:id/student", async () => {
    const campaign = createCampaign(db, { ...CAMPAIGN, trackingCode: "abi27" });
    const server = Bun.serve({
      port: 0,
      routes: appointmentRequestRoutes(db, { rateLimit: false }),
      fetch: () => new Response("not found", { status: 404 }),
    });
    try {
      const created = await fetch(new URL("/api/appointment-requests", server.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...REQUEST, campaign: "abi27", consent: true }),
      });
      expect(created.status).toBe(201);
      const request = (await created.json()) as { id: number; campaignId: number };
      expect(request.campaignId).toBe(campaign.id);

      const lea = student();
      const linked = await fetch(
        new URL(`/api/appointment-requests/${request.id}/student`, server.url),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId: lea.id }),
        },
      );
      expect(linked.status).toBe(200);
      expect(((await linked.json()) as { studentId: number }).studentId).toBe(lea.id);
    } finally {
      server.stop(true);
    }
  });
});
