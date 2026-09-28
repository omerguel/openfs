/* ------------------------------------------------------------------ */
/* Schulprofil — public school profile (Aushängeschild der Fahrschule). */
/* Persisted as a single JSON blob under settings key 'school_profile', */
/* mirroring getCompany/setCompany in ./db.ts.                          */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import { ValidationError } from "./engine";
import { handle, json } from "./http";
import { toInstagramUrl } from "../lib/instagram";
import { demoDataEnabled, getCompany, setCompany } from "./db";

export type OpeningHoursEntry = {
  day: string;
  hours: string;
};

export type SchoolProfile = {
  description: string;
  slogan: string;
  founded_year: number | null;
  website: string;
  instagram: string;
  facebook: string;
  google_maps_url: string;
  /** Google Place ID ("ChIJ…") — source of the Google-Bewertungen import. */
  google_place_id: string;
  /** Always exactly 7 entries, Montag–Sonntag in order. */
  opening_hours: OpeningHoursEntry[];
  services: string[];
  highlights: string[];
  /** Offered Führerscheinklassen (e.g. "B", "B197", "A2"). */
  license_classes: string[];
  /** Berufskraftfahrer classes (e.g. "C (BKF)"). */
  bkf_classes: string[];
  /** Merkmale the school offers (e.g. "Sehtest", "Intensivkurs"). */
  features: string[];
  languages: string[];
  certificates: string[];
  /** Brands of the training vehicles per class group. */
  vehicle_brands: VehicleBrands;
  payment_methods: string[];
  /** Theorieunterricht, same shape as opening_hours. */
  theory_hours: OpeningHoursEntry[];
};

export const BRAND_GROUPS = ["A", "B", "C", "D"] as const;
export type VehicleBrands = Record<(typeof BRAND_GROUPS)[number], string[]>;

export const WEEK_DAYS = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

const SETTINGS_KEY = "school_profile";

/* A real school starts with an empty profile — nothing public that the
   owner did not write. The demo school (demo data enabled) gets the
   sample content below. */
export const EMPTY_SCHOOL_PROFILE: SchoolProfile = {
  description: "",
  slogan: "",
  founded_year: null,
  website: "",
  instagram: "",
  facebook: "",
  google_maps_url: "",
  google_place_id: "",
  opening_hours: WEEK_DAYS.map((day) => ({ day, hours: "" })),
  services: [],
  highlights: [],
  license_classes: [],
  bkf_classes: [],
  features: [],
  languages: [],
  certificates: [],
  vehicle_brands: { A: [], B: [], C: [], D: [] },
  payment_methods: [],
  theory_hours: WEEK_DAYS.map((day) => ({ day, hours: "" })),
};

export const DEMO_SCHOOL_PROFILE: SchoolProfile = {
  description:
    "Ihre Fahrschule vor Ort — wir begleiten Sie sicher und entspannt zum Führerschein.",
  slogan: "Sicher ans Ziel.",
  founded_year: null,
  website: "",
  instagram: "",
  facebook: "",
  google_maps_url: "",
  google_place_id: "",
  opening_hours: WEEK_DAYS.map((day) => ({
    day,
    hours:
      day === "Sonntag"
        ? "Geschlossen"
        : day === "Samstag"
          ? "10:00 – 13:00"
          : "09:00 – 18:00",
  })),
  services: [
    "Klasse B",
    "Klasse A",
    "Klasse BE",
    "Intensivkurse",
    "Theorieunterricht online",
  ],
  highlights: ["Moderne Fahrzeugflotte", "Erfahrene Fahrlehrer", "Hohe Bestehensquote"],
  license_classes: ["B", "B197", "A1", "AM"],
  bkf_classes: [],
  features: ["Sehtest", "Erste Hilfe", "Finanzierung", "Online lernen"],
  languages: ["Deutsch", "Türkisch"],
  certificates: [],
  vehicle_brands: { A: ["Honda"], B: ["VW", "Audi"], C: [], D: [] },
  payment_methods: ["Banküberweisung", "Bar"],
  theory_hours: WEEK_DAYS.map((day) => ({
    day,
    hours: day === "Dienstag" || day === "Donnerstag" ? "18:30 – 20:00" : "Geschlossen",
  })),
};

/** @deprecated name kept for older imports — the demo school's profile. */
export const DEFAULT_SCHOOL_PROFILE = DEMO_SCHOOL_PROFILE;

function baseProfile(db: Database): SchoolProfile {
  return structuredClone(
    demoDataEnabled(db) ? DEMO_SCHOOL_PROFILE : EMPTY_SCHOOL_PROFILE,
  );
}

/* ------------------------------------------------------------------ */
/* Persistence                                                          */
/* ------------------------------------------------------------------ */

export function getSchoolProfile(db: Database): SchoolProfile {
  const row = db
    .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
    .get(SETTINGS_KEY);
  if (!row) return baseProfile(db);
  try {
    // Re-sanitize on read so a hand-edited/legacy blob can never leak
    // malformed data into the API; fields added later come from the base.
    return sanitizeSchoolProfile(JSON.parse(row.value), baseProfile(db));
  } catch {
    return baseProfile(db);
  }
}

export function setSchoolProfile(db: Database, profile: SchoolProfile) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    SETTINGS_KEY,
    JSON.stringify(profile),
  );
}

/* ------------------------------------------------------------------ */
/* Validation / sanitizing                                              */
/* ------------------------------------------------------------------ */

const STRING_FIELDS = [
  "description",
  "slogan",
  "website",
  "instagram",
  "facebook",
  "google_maps_url",
  "google_place_id",
] as const;

const LIST_FIELDS = [
  "license_classes",
  "bkf_classes",
  "features",
  "languages",
  "certificates",
  "payment_methods",
] as const;

/** "@fahrschule", "fahrschule" or "instagram.com/fahrschule" → full URL. */
export function normalizeInstagram(value: string): string {
  const url = toInstagramUrl(value);
  if (url === null) {
    throw new ValidationError(
      "Instagram bitte als Profil-Link oder @Name angeben (z. B. @fahrschule_nord).",
    );
  }
  return url;
}

function sanitizeStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`Feld '${label}' muss eine Liste sein.`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new ValidationError(`Feld '${label}' darf nur Texteinträge enthalten.`);
    }
    const trimmed = item.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

function sanitizeFoundedYear(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const year = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof year !== "number" || !Number.isInteger(year) || year < 1900 || year > 2100) {
    throw new ValidationError(
      "Feld 'founded_year' muss eine Jahreszahl zwischen 1900 und 2100 sein.",
    );
  }
  return year;
}

function sanitizeOpeningHours(
  value: unknown,
  current: OpeningHoursEntry[],
): OpeningHoursEntry[] {
  if (!Array.isArray(value)) {
    throw new ValidationError("Feld 'opening_hours' muss eine Liste sein.");
  }
  const byDay = new Map(current.map((e) => [e.day, e.hours]));
  for (const entry of value) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as OpeningHoursEntry).day !== "string" ||
      typeof (entry as OpeningHoursEntry).hours !== "string"
    ) {
      throw new ValidationError(
        "Feld 'opening_hours' erwartet Einträge mit 'day' und 'hours'.",
      );
    }
    const day = (entry as OpeningHoursEntry).day.trim();
    if (!(WEEK_DAYS as readonly string[]).includes(day)) {
      throw new ValidationError(`Unbekannter Wochentag: '${day}'.`);
    }
    byDay.set(day, (entry as OpeningHoursEntry).hours.trim());
  }
  // Normalize: always exactly Montag–Sonntag, in order.
  return WEEK_DAYS.map((day) => ({ day, hours: byDay.get(day) ?? "" }));
}

/** Merges a (partial) payload onto `current`, trimming strings and
 *  normalizing the arrays. Throws ValidationError on garbage. */
export function sanitizeSchoolProfile(
  body: unknown,
  current: SchoolProfile,
): SchoolProfile {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("Ungültiger Schulprofil-Datensatz.");
  }
  const input = body as Record<string, unknown>;
  const next: SchoolProfile = structuredClone(current);

  for (const key of STRING_FIELDS) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new ValidationError(`Feld '${key}' muss ein Text sein.`);
    }
    next[key] = value.trim();
  }

  if (next.google_place_id && !/^[A-Za-z0-9_-]{10,300}$/.test(next.google_place_id)) {
    throw new ValidationError(
      "Die Google Place ID besteht nur aus Buchstaben, Ziffern, '-' und '_' (z. B. ChIJ…).",
    );
  }

  if ("founded_year" in input) {
    next.founded_year = sanitizeFoundedYear(input.founded_year);
  }
  if (input.opening_hours !== undefined) {
    next.opening_hours = sanitizeOpeningHours(input.opening_hours, current.opening_hours);
  }
  if (input.services !== undefined) {
    next.services = sanitizeStringList(input.services, "services");
  }
  if (input.highlights !== undefined) {
    next.highlights = sanitizeStringList(input.highlights, "highlights");
  }
  for (const key of LIST_FIELDS) {
    if (input[key] !== undefined) next[key] = sanitizeStringList(input[key], key);
  }
  if (input.vehicle_brands !== undefined) {
    const brands = input.vehicle_brands;
    if (typeof brands !== "object" || brands === null || Array.isArray(brands)) {
      throw new ValidationError("Feld 'vehicle_brands' muss ein Objekt sein.");
    }
    for (const group of BRAND_GROUPS) {
      const value = (brands as Record<string, unknown>)[group];
      if (value !== undefined) {
        next.vehicle_brands[group] = sanitizeStringList(value, `vehicle_brands.${group}`);
      }
    }
  }
  if (input.theory_hours !== undefined) {
    next.theory_hours = sanitizeOpeningHours(input.theory_hours, current.theory_hours);
  }
  if (next.instagram) next.instagram = normalizeInstagram(next.instagram);

  return next;
}

/* ------------------------------------------------------------------ */
/* HTTP routes — same factory shape as src/server/routes.ts.            */
/* (json/handle are module-private there, so they are mirrored here.)   */
/* ------------------------------------------------------------------ */

export function schoolProfileRoutes(db: Database) {
  return {
    "/api/school-profile": {
      GET: (req: BunRequest) => handle(() => json(getSchoolProfile(db)))(),
      PUT: (req: BunRequest) =>
        handle(async () => {
          const body = await req.json().catch(() => {
            throw new ValidationError("Ungültiger JSON-Body.");
          });
          const next = sanitizeSchoolProfile(body, getSchoolProfile(db));
          // Tax data is Inhaber-only, the public profile is office work —
          // Fahrlehrer never reach this (auth.ts).
          setSchoolProfile(db, next);
          const company = getCompany(db);
          if (next.website !== company.website) {
            setCompany(db, { ...company, website: next.website });
          }
          return json(next);
        })(),
    },
  };
}
