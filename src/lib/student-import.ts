/* ------------------------------------------------------------------ */
/* Datenimport — Fahrschüler aus CSV (Fahrschulmanager, FahrschulOffice,*/
/* ClickClickDrive, Excel-Listen).                                     */
/*                                                                     */
/* Pure helpers shared by the /import page and the server:             */
/*  - header → field auto-mapping (German/English synonyms)            */
/*  - per-row normalisation (dates → TT.MM.JJJJ, address, classes,     */
/*    status) and validation with German messages                      */
/*  - request/response types of /api/import/students/*                 */
/*  - optional "Saldo" column (German money, negative = student owes),  */
/*    booked as Saldovortrag on commit                                  */
/* The server (src/server/student-import.ts) adds DB checks: duplicates,*/
/* instructor/vehicle lookup and number generation.                    */
/* ------------------------------------------------------------------ */

import { parseEuroToCents } from "./money";
import type { StudentStatus } from "./student-data";

export type ImportField =
  | "firstName"
  | "lastName"
  | "birthday"
  | "phone"
  | "email"
  | "address"
  | "street"
  | "houseNumber"
  | "postalCode"
  | "city"
  | "classes"
  | "customerNumber"
  | "contractNumber"
  | "registrationDate"
  | "instructor"
  | "vehicle"
  | "status"
  | "drivingSchool"
  | "balance";

/* Synonyms are compared after normalizeHeader(): lower case, umlauts
   transliterated, everything but a–z/0–9 removed ("Geb.-Datum" →
   "gebdatum", "E-Mail" → "email", "Fahrlehrer/in" → "fahrlehrerin"). */
export const IMPORT_FIELDS: { field: ImportField; label: string; synonyms: string[] }[] =
  [
    {
      field: "firstName",
      label: "Vorname",
      synonyms: ["vorname", "vornamen", "rufname", "firstname", "givenname", "vname"],
    },
    {
      field: "lastName",
      label: "Nachname",
      synonyms: [
        "nachname",
        "name",
        "familienname",
        "zuname",
        "lastname",
        "surname",
        "familyname",
        "nname",
      ],
    },
    {
      field: "birthday",
      label: "Geburtsdatum",
      synonyms: [
        "geburtsdatum",
        "gebdatum",
        "gebdat",
        "geburtstag",
        "geboren",
        "geborenam",
        "gebam",
        "birthday",
        "birthdate",
        "dateofbirth",
        "dob",
      ],
    },
    {
      field: "phone",
      label: "Telefon",
      synonyms: [
        "telefon",
        "tel",
        "telefonnummer",
        "telnr",
        "rufnummer",
        "handy",
        "handynummer",
        "mobil",
        "mobilnummer",
        "mobiltelefon",
        "mobilfunk",
        "phone",
        "phonenumber",
        "mobile",
        "telephone",
      ],
    },
    {
      field: "email",
      label: "E-Mail",
      synonyms: ["email", "emailadresse", "mail", "mailadresse", "emailaddress"],
    },
    {
      field: "address",
      label: "Adresse (vollständig)",
      synonyms: ["adresse", "anschrift", "wohnanschrift", "address", "postanschrift"],
    },
    {
      field: "street",
      label: "Straße",
      synonyms: [
        "strasse",
        "str",
        "strassenr",
        "strassehausnummer",
        "strasseundhausnummer",
        "strassehausnr",
        "street",
        "streetaddress",
      ],
    },
    {
      field: "houseNumber",
      label: "Hausnummer",
      synonyms: ["hausnummer", "hausnr", "nr", "housenumber", "streetnumber"],
    },
    {
      field: "postalCode",
      label: "PLZ",
      synonyms: ["plz", "postleitzahl", "zip", "zipcode", "postalcode", "postcode"],
    },
    {
      field: "city",
      label: "Ort",
      synonyms: ["ort", "wohnort", "stadt", "city", "town"],
    },
    {
      field: "classes",
      label: "Klasse(n)",
      synonyms: [
        "klasse",
        "klassen",
        "fuehrerscheinklasse",
        "fuehrerscheinklassen",
        "fsklasse",
        "fsklassen",
        "ausbildungsklasse",
        "beantragteklasse",
        "class",
        "classes",
        "licenseclass",
        "licenceclass",
      ],
    },
    {
      field: "customerNumber",
      label: "Kundennummer",
      synonyms: [
        "kundennummer",
        "kundennr",
        "kdnr",
        "kdnummer",
        "kundenid",
        "schuelernummer",
        "schuelernr",
        "customernumber",
        "customerno",
        "customerid",
      ],
    },
    {
      field: "contractNumber",
      label: "Vertragsnummer",
      synonyms: [
        "vertragsnummer",
        "vertragsnr",
        "vertrag",
        "ausbildungsvertrag",
        "contractnumber",
        "contractno",
        "contract",
      ],
    },
    {
      field: "registrationDate",
      label: "Anmeldedatum",
      synonyms: [
        "anmeldedatum",
        "anmeldung",
        "angemeldetam",
        "anmeldungam",
        "eintrittsdatum",
        "vertragsdatum",
        "vertragsbeginn",
        "ausbildungsbeginn",
        "registrierungsdatum",
        "registrationdate",
        "signupdate",
        "startdatum",
      ],
    },
    {
      field: "instructor",
      label: "Fahrlehrer/in",
      synonyms: ["fahrlehrer", "fahrlehrerin", "lehrer", "ausbilder", "instructor"],
    },
    {
      field: "vehicle",
      label: "Fahrzeug",
      synonyms: ["fahrzeug", "schulfahrzeug", "auto", "kfz", "vehicle", "car"],
    },
    {
      field: "status",
      label: "Status",
      synonyms: ["status", "aktiv", "state", "zustand"],
    },
    {
      field: "drivingSchool",
      label: "Fahrschule / Filiale",
      synonyms: [
        "fahrschule",
        "filiale",
        "standort",
        "drivingschool",
        "school",
        "branch",
      ],
    },
    {
      // Deliberately no "Guthaben"/"Offener Betrag" synonyms: their sign
      // convention is ambiguous. Positive = Guthaben, negative = offen.
      field: "balance",
      label: "Saldo (+ Guthaben / − offen)",
      synonyms: ["saldo", "kontosaldo", "kontostand", "saldovortrag", "balance"],
    },
  ];

const FIELD_SET = new Set<string>(IMPORT_FIELDS.map((f) => f.field));

export const FIELD_LABELS = Object.fromEntries(
  IMPORT_FIELDS.map((f) => [f.field, f.label]),
) as Record<ImportField, string>;

/** Column index → field; unmapped columns are simply absent. */
export type ImportMapping = Record<number, ImportField>;

export type ImportOptions = {
  /** First row holds the column titles (default true). */
  hasHeader?: boolean;
  /** ISO booking date of the Saldovorträge (required with a Saldo column). */
  openingBalanceDate?: string;
};

export type ImportRequest = {
  rows: string[][];
  mapping: Record<string, ImportField | null | "">;
  options?: ImportOptions;
};

/** Normalised student values of one import row. */
export type ImportDraft = {
  firstName: string;
  lastName: string;
  birthday: string;
  phone: string;
  email: string;
  address: string;
  classes: string;
  drivingSchool: string;
  registrationDate: string;
  customerNumber: string;
  contractNumber: string;
  status: StudentStatus;
  instructor: string;
  vehicle: string;
  /** Opening balance in cents: > 0 Guthaben, < 0 the student owes, 0 none. */
  balanceCents: number;
};

export type ImportRowStatus = "import" | "skip" | "error";

export type ImportRowResult = {
  /** 1-based row number in the file (header included), as Excel shows it. */
  row: number;
  ok: boolean;
  status: ImportRowStatus;
  errors: string[];
  warnings: string[];
  student: ImportDraft;
  /** Numbers the system will assign because the file had none. */
  generated: { customerNumber: boolean; contractNumber: boolean };
};

export type ImportSummary = {
  total: number;
  importable: number;
  skipped: number;
  failed: number;
};

/** Saldovorträge of the importable rows. */
export type ImportOpeningBalances = {
  count: number;
  /** Sum of the Guthaben (positive balances). */
  creditCents: number;
  /** Sum of the open amounts (negative balances, as positive cents). */
  debitCents: number;
};

export type ImportPreview = {
  rows: ImportRowResult[];
  summary: ImportSummary;
  openingBalances: ImportOpeningBalances;
};

export type ImportCommitResult = ImportSummary & {
  imported: number;
  /** Saldovorträge booked in the same transaction. */
  openingBalances: number;
};

/* ------------------------------------------------------------------ */
/* Header mapping                                                      */
/* ------------------------------------------------------------------ */

export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]/g, "");
}

/* Exact synonym matches first; then headers that start with a synonym
   ("Telefon (mobil)", "Geburtsdatum TT.MM.JJJJ"), longest synonym
   first. Each field is assigned to at most one column. */
export function autoMapHeaders(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const used = new Set<ImportField>();
  const keys = headers.map(normalizeHeader);

  keys.forEach((key, index) => {
    if (!key) return;
    const hit = IMPORT_FIELDS.find((f) => !used.has(f.field) && f.synonyms.includes(key));
    if (hit) {
      mapping[index] = hit.field;
      used.add(hit.field);
    }
  });

  const prefixes = IMPORT_FIELDS.flatMap((f) =>
    f.synonyms.filter((s) => s.length >= 4).map((s) => ({ field: f.field, s })),
  ).sort((a, b) => b.s.length - a.s.length);

  keys.forEach((key, index) => {
    if (!key || mapping[index] !== undefined) return;
    const hit = prefixes.find((p) => !used.has(p.field) && key.startsWith(p.s));
    if (hit) {
      mapping[index] = hit.field;
      used.add(hit.field);
    }
  });

  return mapping;
}

/** Validate a mapping received as JSON (string keys). Throws on garbage. */
export function parseImportMapping(raw: unknown): ImportMapping {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Spaltenzuordnung fehlt.");
  }
  const mapping: ImportMapping = {};
  const used = new Set<string>();
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === "" || value === undefined) continue;
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Ungültige Spalte '${key}' in der Zuordnung.`);
    }
    if (typeof value !== "string" || !FIELD_SET.has(value)) {
      throw new Error(`Unbekanntes Feld '${String(value)}' in der Zuordnung.`);
    }
    if (used.has(value)) {
      throw new Error(
        `Feld „${FIELD_LABELS[value as ImportField]}“ ist mehreren Spalten zugeordnet.`,
      );
    }
    used.add(value);
    mapping[index] = value as ImportField;
  }
  return mapping;
}

/* ------------------------------------------------------------------ */
/* Value normalisation                                                 */
/* ------------------------------------------------------------------ */

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Today as TT.MM.JJJJ (the students' display format). */
export function formatGermanDate(date: Date): string {
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/* Accepts TT.MM.JJJJ, T.M.JJJJ, TT.MM.JJ, TT/MM/JJJJ, TT-MM-JJJJ and ISO
   JJJJ-MM-TT (a trailing time is ignored). Two-digit years up to the
   current year map to 20JJ, the rest to 19JJ. Returns "" for empty
   input and null for anything that is not a real calendar date. */
export function normalizeDate(raw: string, now = new Date()): string | null {
  const value = raw.trim();
  if (!value) return "";
  let day: number;
  let month: number;
  let year: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(value);
  const german = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?:[ ,T].*)?$/.exec(value);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (german) {
    day = Number(german[1]);
    month = Number(german[2]);
    year = Number(german[3]);
    if (german[3]!.length === 2) {
      year += year <= now.getFullYear() % 100 ? 2000 : 1900;
    }
  } else {
    return null;
  }
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  if (day > new Date(year, month, 0).getDate()) return null;
  return `${pad2(day)}.${pad2(month)}.${year}`;
}

/** "b, be" / "B/BE" / "B;BE" → "B, BE". */
export function normalizeClasses(raw: string): string {
  return raw
    .toUpperCase()
    .split(/[\s,;/+|]+/)
    .filter(Boolean)
    .join(", ");
}

const ACTIVE = new Set(["aktiv", "active", "ja", "yes", "j", "x", "1", "true", "wahr"]);
const INACTIVE = new Set([
  "inaktiv",
  "inactive",
  "nein",
  "no",
  "n",
  "0",
  "false",
  "falsch",
  "abgeschlossen",
  "beendet",
  "archiviert",
  "abgemeldet",
  "ausgeschieden",
  "pausiert",
]);

/** Empty → aktiv; unknown values → null. */
export function normalizeStatus(raw: string): StudentStatus | null {
  const value = raw.trim().toLowerCase();
  if (!value || ACTIVE.has(value)) return "aktiv";
  if (INACTIVE.has(value)) return "inaktiv";
  return null;
}

/* "Straße Nr, PLZ Ort" — leaving out whatever is empty. */
export function composeAddress(parts: {
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
}): string {
  const line1 = [parts.street, parts.houseNumber].filter(Boolean).join(" ");
  const line2 = [parts.postalCode, parts.city].filter(Boolean).join(" ");
  return [line1, line2].filter(Boolean).join(", ");
}

/** German money with sign: "-85,00", "−1.250,50 €", "85,00-" (trailing
 *  minus as in accounting exports), "+12". "" → 0; garbage → null. */
export function parseSignedEuro(raw: string): number | null {
  let value = raw.replace(/\s|€|EUR/gi, "").replace(/\u2212/g, "-");
  if (!value) return 0;
  let negative = false;
  if (value.startsWith("-") || value.endsWith("-")) {
    negative = true;
    value = value.startsWith("-") ? value.slice(1) : value.slice(0, -1);
  } else if (value.startsWith("+")) {
    value = value.slice(1);
  }
  const cents = parseEuroToCents(value);
  if (cents === null) return null;
  return negative && cents !== 0 ? -cents : cents;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------------------------------------------ */
/* Row mapping + validation                                            */
/* ------------------------------------------------------------------ */

export function mapImportRow(
  cells: string[],
  mapping: ImportMapping,
  now = new Date(),
): { draft: ImportDraft; errors: string[]; warnings: string[] } {
  const values: Partial<Record<ImportField, string>> = {};
  for (const [key, field] of Object.entries(mapping)) {
    const cell = cells[Number(key)];
    values[field] = typeof cell === "string" ? cell.replace(/\s+/g, " ").trim() : "";
  }
  const get = (field: ImportField) => values[field] ?? "";
  const errors: string[] = [];
  const warnings: string[] = [];

  const firstName = get("firstName");
  const lastName = get("lastName");
  if (!firstName) errors.push("Vorname fehlt.");
  if (!lastName) errors.push("Nachname fehlt.");

  const date = (field: "birthday" | "registrationDate", label: string) => {
    const raw = get(field);
    const normalized = normalizeDate(raw, now);
    if (normalized === null) {
      errors.push(`${label} „${raw}“ ist kein gültiges Datum (erwartet TT.MM.JJJJ).`);
      return "";
    }
    return normalized;
  };
  const birthday = date("birthday", "Geburtsdatum");
  const registrationDate = date("registrationDate", "Anmeldedatum");
  if (birthday) {
    const [d, m, y] = birthday.split(".").map(Number) as [number, number, number];
    if (new Date(y, m - 1, d) > now) errors.push("Geburtsdatum liegt in der Zukunft.");
  }

  const email = get("email");
  if (email && !EMAIL.test(email)) warnings.push(`E-Mail „${email}“ sieht ungültig aus.`);

  const rawStatus = get("status");
  let status = normalizeStatus(rawStatus);
  if (status === null) {
    warnings.push(`Status „${rawStatus}“ unbekannt – wird als aktiv importiert.`);
    status = "aktiv";
  }

  const classes = normalizeClasses(get("classes"));
  if (!classes) warnings.push("Keine Führerscheinklasse angegeben.");

  const rawBalance = get("balance");
  let balanceCents = parseSignedEuro(rawBalance);
  if (balanceCents === null) {
    errors.push(
      `Saldo „${rawBalance}“ ist kein gültiger Betrag (z. B. 1.250,00 oder -85,00).`,
    );
    balanceCents = 0;
  }

  const address =
    get("address") ||
    composeAddress({
      street: get("street"),
      houseNumber: get("houseNumber"),
      postalCode: get("postalCode"),
      city: get("city"),
    });

  return {
    draft: {
      firstName,
      lastName,
      birthday,
      phone: get("phone"),
      email,
      address,
      classes,
      drivingSchool: get("drivingSchool"),
      registrationDate,
      customerNumber: get("customerNumber"),
      contractNumber: get("contractNumber"),
      status,
      instructor: get("instructor"),
      vehicle: get("vehicle"),
      balanceCents,
    },
    errors,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Vorlage (template)                                                  */
/* ------------------------------------------------------------------ */

export function studentImportTemplate(): string[][] {
  return [
    [
      "Vorname",
      "Nachname",
      "Geburtsdatum",
      "Telefon",
      "E-Mail",
      "Straße",
      "PLZ",
      "Ort",
      "Klasse",
      "Kundennummer",
      "Vertragsnummer",
      "Anmeldedatum",
      "Fahrlehrer",
      "Fahrzeug",
      "Status",
    ],
    [
      "Lena",
      "Beispiel",
      "11.08.2004",
      "+49 151 23456780",
      "lena.beispiel@example.com",
      "Weidingweg 31",
      "64297",
      "Darmstadt",
      "B",
      "",
      "",
      "12.05.2026",
      "",
      "",
      "aktiv",
    ],
  ];
}
