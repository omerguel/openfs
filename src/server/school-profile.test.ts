/* ------------------------------------------------------------------ */
/* Schulprofil — defaults, settings round-trip, validation, HTTP layer. */
/* Runs against a bare in-memory DB with only the settings table.       */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import { openSqlite, type Database } from "./sqlite";
import type { BunRequest } from "bun";

import { ValidationError } from "./engine";
import {
  DEFAULT_SCHOOL_PROFILE,
  EMPTY_SCHOOL_PROFILE,
  normalizeInstagram,
  getSchoolProfile,
  sanitizeSchoolProfile,
  schoolProfileRoutes,
  setSchoolProfile,
  WEEK_DAYS,
  type SchoolProfile,
} from "./school-profile";
import { getCompany, openDb } from "./db";

let db: Database;

beforeEach(() => {
  db = openSqlite(":memory:");
  db.run("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
});

function sampleProfile(): SchoolProfile {
  return {
    ...EMPTY_SCHOOL_PROFILE,
    license_classes: ["B", "A2"],
    vehicle_brands: { A: ["Yamaha"], B: ["VW"], C: [], D: [] },
    description: "Fahrschule mit Herz seit über 25 Jahren.",
    slogan: "Entspannt zum Führerschein.",
    founded_year: 1998,
    website: "https://fahrschule-beispiel.de",
    instagram: "https://instagram.com/fahrschule",
    facebook: "https://facebook.com/fahrschule",
    google_maps_url: "https://maps.google.com/?q=Fahrschule",
    google_place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    opening_hours: WEEK_DAYS.map((day) => ({
      day,
      hours: day === "Sonntag" ? "Geschlossen" : "08:00 – 19:00",
    })),
    services: ["Klasse B", "Klasse A", "Intensivkurse"],
    highlights: ["Hohe Bestehensquote", "Eigener Fahrsimulator"],
  };
}

/* ================================================================== */
/* Defaults                                                            */
/* ================================================================== */

describe("getSchoolProfile defaults", () => {
  test("returns German defaults when key is unset", () => {
    const profile = getSchoolProfile(db);
    expect(profile).toEqual(DEFAULT_SCHOOL_PROFILE);
    expect(profile.slogan.length).toBeGreaterThan(0);
    expect(profile.services).toContain("Klasse B");
    expect(profile.highlights.length).toBeGreaterThan(0);
  });

  test("defaults contain exactly 7 opening-hours rows, Montag–Sonntag", () => {
    const profile = getSchoolProfile(db);
    expect(profile.opening_hours).toHaveLength(7);
    expect(profile.opening_hours.map((e) => e.day)).toEqual([...WEEK_DAYS]);
    expect(profile.opening_hours[6]!.hours).toBe("Geschlossen");
  });

  test("returned defaults are a copy — mutation does not leak", () => {
    const a = getSchoolProfile(db);
    a.services.push("MUTIERT");
    expect(getSchoolProfile(db).services).not.toContain("MUTIERT");
  });

  test("corrupt JSON in settings falls back to defaults", () => {
    db.run("INSERT INTO settings (key, value) VALUES ('school_profile', 'kaputt{')");
    expect(getSchoolProfile(db)).toEqual(DEFAULT_SCHOOL_PROFILE);
  });
});

/* ================================================================== */
/* Round-trip                                                          */
/* ================================================================== */

describe("set/getSchoolProfile round-trip", () => {
  test("stores under settings key 'school_profile' and reads back", () => {
    const profile = sampleProfile();
    setSchoolProfile(db, profile);

    const row = db
      .query<{ value: string }, []>(
        "SELECT value FROM settings WHERE key = 'school_profile'",
      )
      .get();
    expect(row).not.toBeNull();
    expect(JSON.parse(row!.value).slogan).toBe(profile.slogan);

    expect(getSchoolProfile(db)).toEqual(profile);
  });

  test("second set replaces the first (single key)", () => {
    setSchoolProfile(db, sampleProfile());
    setSchoolProfile(db, { ...sampleProfile(), slogan: "Neu!" });

    const rows = db
      .query<{ n: number }, []>(
        "SELECT COUNT(*) AS n FROM settings WHERE key = 'school_profile'",
      )
      .get();
    expect(rows!.n).toBe(1);
    expect(getSchoolProfile(db).slogan).toBe("Neu!");
  });
});

/* ================================================================== */
/* Validation                                                          */
/* ================================================================== */

describe("sanitizeSchoolProfile", () => {
  const current = DEFAULT_SCHOOL_PROFILE;

  test("trims string fields", () => {
    const next = sanitizeSchoolProfile(
      { slogan: "  Hallo  ", website: " https://x.de " },
      current,
    );
    expect(next.slogan).toBe("Hallo");
    expect(next.website).toBe("https://x.de");
  });

  test("partial payload keeps untouched fields from current", () => {
    const next = sanitizeSchoolProfile({ slogan: "Nur Slogan" }, current);
    expect(next.description).toBe(current.description);
    expect(next.services).toEqual(current.services);
  });

  test("non-object body → ValidationError", () => {
    expect(() => sanitizeSchoolProfile("garbage", current)).toThrow(ValidationError);
    expect(() => sanitizeSchoolProfile(null, current)).toThrow(ValidationError);
    expect(() => sanitizeSchoolProfile([1, 2], current)).toThrow(ValidationError);
  });

  test("non-string value for a string field → ValidationError", () => {
    expect(() => sanitizeSchoolProfile({ slogan: 42 }, current)).toThrow(ValidationError);
  });

  test("founded_year accepts number, numeric string, and null", () => {
    expect(sanitizeSchoolProfile({ founded_year: 1998 }, current).founded_year).toBe(
      1998,
    );
    expect(sanitizeSchoolProfile({ founded_year: "2005" }, current).founded_year).toBe(
      2005,
    );
    expect(
      sanitizeSchoolProfile({ founded_year: null }, current).founded_year,
    ).toBeNull();
    expect(sanitizeSchoolProfile({ founded_year: "" }, current).founded_year).toBeNull();
  });

  test("founded_year garbage → ValidationError", () => {
    for (const bad of ["bald", 1850, 9999, 19.98, {}]) {
      expect(() => sanitizeSchoolProfile({ founded_year: bad }, current)).toThrow(
        ValidationError,
      );
    }
  });

  test("services/highlights are trimmed, de-duplicated, empties dropped", () => {
    const next = sanitizeSchoolProfile(
      { services: [" Klasse B ", "Klasse B", "", "Intensivkurse"] },
      current,
    );
    expect(next.services).toEqual(["Klasse B", "Intensivkurse"]);
  });

  test("services non-array / non-string entries → ValidationError", () => {
    expect(() => sanitizeSchoolProfile({ services: "Klasse B" }, current)).toThrow(
      ValidationError,
    );
    expect(() => sanitizeSchoolProfile({ highlights: [1, 2] }, current)).toThrow(
      ValidationError,
    );
  });

  test("opening_hours normalized to 7 canonical days in order", () => {
    const next = sanitizeSchoolProfile(
      { opening_hours: [{ day: "Mittwoch", hours: " 10:00 – 12:00 " }] },
      current,
    );
    expect(next.opening_hours).toHaveLength(7);
    expect(next.opening_hours.map((e) => e.day)).toEqual([...WEEK_DAYS]);
    expect(next.opening_hours[2]).toEqual({ day: "Mittwoch", hours: "10:00 – 12:00" });
    // Untouched days keep current values.
    expect(next.opening_hours[0]!.hours).toBe(current.opening_hours[0]!.hours);
  });

  test("opening_hours garbage → ValidationError", () => {
    expect(() => sanitizeSchoolProfile({ opening_hours: "Mo-Fr" }, current)).toThrow(
      ValidationError,
    );
    expect(() =>
      sanitizeSchoolProfile({ opening_hours: [{ day: "Funtag", hours: "x" }] }, current),
    ).toThrow(ValidationError);
    expect(() =>
      sanitizeSchoolProfile({ opening_hours: [{ day: "Montag" }] }, current),
    ).toThrow(ValidationError);
  });
});

/* ================================================================== */
/* HTTP routes                                                         */
/* ================================================================== */

describe("schoolProfileRoutes", () => {
  function routes() {
    return schoolProfileRoutes(db)["/api/school-profile"];
  }

  function putRequest(body: unknown): BunRequest {
    return new Request("http://localhost/api/school-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }) as BunRequest;
  }

  test("GET → 200 with defaults", async () => {
    const res = await routes().GET(
      new Request("http://localhost/api/school-profile") as BunRequest,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as SchoolProfile;
    expect(data).toEqual(DEFAULT_SCHOOL_PROFILE);
  });

  test("PUT valid payload → 200, persists and returns sanitized profile", async () => {
    const res = await routes().PUT(
      putRequest({ slogan: "  Neu  ", services: [" Klasse BE "] }),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as SchoolProfile;
    expect(data.slogan).toBe("Neu");
    expect(data.services).toEqual(["Klasse BE"]);
    expect(getSchoolProfile(db).slogan).toBe("Neu");
  });

  test("PUT synchronizes the website with the company profile", async () => {
    const res = await routes().PUT(
      putRequest({ website: " https://öffentlich.example " }),
    );

    expect(res.status).toBe(200);
    expect(getCompany(db).website).toBe("https://öffentlich.example");
  });

  test("PUT garbage field → 400 with German error", async () => {
    const res = await routes().PUT(putRequest({ services: 17 }));
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("'services'");
    // Nothing persisted.
    expect(getSchoolProfile(db)).toEqual(DEFAULT_SCHOOL_PROFILE);
  });

  test("PUT invalid JSON body → 400", async () => {
    const res = await routes().PUT(putRequest("kein json{"));
    expect(res.status).toBe(400);
  });
});

/* ================================================================== */
/* Real (non-demo) school, extended fields                              */
/* ================================================================== */

describe("a real school", () => {
  test("starts with an empty public profile (no demo slogan, classes, brands)", () => {
    const real = openDb(":memory:", { demoData: false });
    const profile = getSchoolProfile(real);
    expect(profile).toEqual(EMPTY_SCHOOL_PROFILE);
    expect(profile.slogan).toBe("");
    expect(profile.highlights).toEqual([]);
    expect(profile.license_classes).toEqual([]);
    expect(profile.languages).toEqual([]);
    // The demo school keeps its sample content.
    expect(getSchoolProfile(openDb(":memory:")).slogan).toBe("Sicher ans Ziel.");
  });

  test("persists classes, Merkmale, brands, payment methods and theory hours", () => {
    const real = openDb(":memory:", { demoData: false });
    const next = sanitizeSchoolProfile(
      {
        license_classes: ["B", " B197 ", "B"],
        features: ["Sehtest"],
        vehicle_brands: { B: ["VW", ""] },
        payment_methods: ["Bar"],
        theory_hours: [{ day: "Montag", hours: "18:00 – 19:30" }],
      },
      getSchoolProfile(real),
    );
    setSchoolProfile(real, next);
    const stored = getSchoolProfile(real);
    expect(stored.license_classes).toEqual(["B", "B197"]);
    expect(stored.vehicle_brands).toEqual({ A: [], B: ["VW"], C: [], D: [] });
    expect(stored.theory_hours[0]).toEqual({ day: "Montag", hours: "18:00 – 19:30" });
    expect(stored.theory_hours).toHaveLength(7);
  });

  test("an Instagram handle becomes a profile URL", () => {
    expect(normalizeInstagram("@fahrschule_nord")).toBe(
      "https://instagram.com/fahrschule_nord",
    );
    expect(normalizeInstagram("instagram.com/fs.nord/")).toBe(
      "https://instagram.com/fs.nord",
    );
    expect(normalizeInstagram("https://instagram.com/x")).toBe("https://instagram.com/x");
    expect(() => normalizeInstagram("zwei Worte")).toThrow(ValidationError);
    expect(
      sanitizeSchoolProfile({ instagram: "@fs" }, EMPTY_SCHOOL_PROFILE).instagram,
    ).toBe("https://instagram.com/fs");
  });
});
