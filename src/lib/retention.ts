/* ------------------------------------------------------------------ */
/* Löschkonzept — retention categories shared by the server (retention */
/* job, public /datenschutz data) and the Datenschutz settings tab.    */
/* Periods are months. `fromYearEnd`: the period starts at the end of  */
/* the calendar year of the start event (§ 147 Abs. 4 AO, § 31 FahrlG). */
/* The legal reasoning lives in docs/datenschutz/loeschkonzept.md.     */
/* ------------------------------------------------------------------ */

export const RETENTION_CATEGORIES = [
  "anfragen",
  "dokumente",
  "chat",
  "portal",
  "nachrichten",
  "protokoll",
  "ausbildungsnachweis",
  "schueler",
  "buchhaltung",
] as const;

export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];

export type RetentionMode = "bestaetigung" | "automatisch";

export type RetentionPolicy = {
  /** "bestaetigung": the owner confirms each batch; "automatisch": the
      daily job deletes unattended. */
  mode: RetentionMode;
  months: Record<RetentionCategory, number>;
};

export type RetentionCategoryDef = {
  label: string;
  /** What happens when the period is over. */
  action: string;
  /** Start event of the period. */
  start: string;
  fromYearEnd: boolean;
  /** Legal basis, short. */
  basis: string;
  defaultMonths: number;
  minMonths: number;
  maxMonths: number;
  /** Items the owner should have checked (lawyer / Steuerberater). */
  note?: string;
};

export const RETENTION_DEFS: Record<RetentionCategory, RetentionCategoryDef> = {
  anfragen: {
    label: "Terminanfragen",
    action:
      "Name, Telefon, E-Mail und Nachricht werden gelöscht (die Anfrage zählt weiter in der Kampagnenstatistik)",
    start: "Eingang der Anfrage",
    fromYearEnd: false,
    basis:
      "Art. 5 Abs. 1 lit. e, Art. 17 Abs. 1 lit. a DSGVO – keine Aufbewahrungspflicht",
    defaultMonths: 6,
    minMonths: 1,
    maxMonths: 36,
  },
  dokumente: {
    label: "Hochgeladene Dokumente",
    action: "Dateien (Sehtest, Passbild, Erste Hilfe, Antrag …) werden gelöscht",
    start: "Archivierung (Ende der Ausbildung)",
    fromYearEnd: false,
    basis:
      "Art. 17 Abs. 1 lit. a DSGVO – Kopien; die Originale liegen bei der Fahrerlaubnisbehörde",
    defaultMonths: 6,
    minMonths: 0,
    maxMonths: 60,
  },
  chat: {
    label: "Chat- und Portalnachrichten",
    action: "Unterhaltungen werden mit allen Nachrichten gelöscht",
    start: "Letzte Nachricht, frühestens Archivierung",
    fromYearEnd: false,
    basis: "Art. 17 Abs. 1 lit. a DSGVO",
    defaultMonths: 6,
    minMonths: 0,
    maxMonths: 72,
    note: "Enthält ein Chat Handels- oder Geschäftsbriefe (z. B. Vertragsabsprachen), gilt § 257 HGB / § 147 AO: 6 Jahre.",
  },
  portal: {
    label: "Widerrufene Portal-Links",
    action: "Widerrufene Zugangslinks werden gelöscht",
    start: "Widerruf des Links",
    fromYearEnd: false,
    basis: "Art. 5 Abs. 1 lit. c, e DSGVO",
    defaultMonths: 1,
    minMonths: 0,
    maxMonths: 12,
  },
  nachrichten: {
    label: "E-Mail- und SMS-Protokoll",
    action: "Versandte E-Mails/SMS (Empfänger, Text, Anhänge) werden gelöscht",
    start: "Versand",
    fromYearEnd: false,
    basis: "Art. 17 Abs. 1 lit. a DSGVO",
    defaultMonths: 6,
    minMonths: 1,
    maxMonths: 72,
    note: "Rechnungen und Mahnungen bleiben als eigene Belege erhalten. Ob Mailtexte als versandte Geschäftsbriefe 6 Jahre aufzubewahren sind, bitte mit der Steuerberatung klären.",
  },
  protokoll: {
    label: "Änderungsprotokoll",
    action:
      "Einträge (Benutzer, Pfad, IP-Adresse) werden gelöscht; Löschläufe bleiben protokolliert",
    start: "Protokolleintrag",
    fromYearEnd: false,
    basis: "Art. 5 Abs. 1 lit. e, Art. 32 DSGVO",
    defaultMonths: 12,
    minMonths: 3,
    maxMonths: 72,
  },
  ausbildungsnachweis: {
    label: "Ausbildungsnachweise",
    action: "Unterschriebene Ausbildungsnachweise werden gelöscht",
    start: "Ende des Jahres des Ausbildungsabschlusses (Archivierung)",
    fromYearEnd: true,
    basis: "§ 31 FahrlG: 5 Jahre aufbewahren, danach unverzüglich löschen",
    defaultMonths: 60,
    minMonths: 60,
    maxMonths: 60,
  },
  schueler: {
    label: "Schülerstammdaten",
    action:
      "Name wird zu „Gelöscht #Nr.“; Kontaktdaten, Anschrift, Geburtsdatum und Begleitperson werden geleert, Termine pseudonymisiert",
    start: "Ende des Jahres der Archivierung",
    fromYearEnd: true,
    basis:
      "§ 31 FahrlG (Ausbildungsnachweis nennt die Person), §§ 195, 199 BGB (Verjährung), danach Art. 17 DSGVO",
    defaultMonths: 60,
    minMonths: 60,
    maxMonths: 120,
  },
  buchhaltung: {
    label: "Buchhaltung (Namen in Buchungen und Rechnungen)",
    action:
      "Beträge, Konten und Belegnummern bleiben; Name, Anschrift und Kontoverbindung werden pseudonymisiert",
    start: "Ende des Kalenderjahres der letzten Buchung bzw. Rechnung",
    fromYearEnd: true,
    basis:
      "§ 147 Abs. 1, 3, 4 AO, § 257 HGB, § 14b UStG: Bücher 10 Jahre, Buchungsbelege/Rechnungen 8 Jahre",
    defaultMonths: 120,
    minMonths: 120,
    maxMonths: 132,
    note: "Rechnungen allein wären nach 8 Jahren frei; weil derselbe Name im Buchungsjournal (10 Jahre) steht, gilt einheitlich die längere Frist. Die Frist endet nicht, solange die steuerliche Festsetzungsfrist noch läuft (Ablaufhemmung, § 147 Abs. 3 AO), z. B. bei einer Betriebsprüfung – dann „Aufbewahrung verlängern“. Bitte mit der Steuerberatung abstimmen.",
  },
};

export const RETENTION_MODE_LABELS: Record<RetentionMode, string> = {
  bestaetigung: "Nach Bestätigung",
  automatisch: "Automatisch",
};

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  mode: "bestaetigung",
  months: Object.fromEntries(
    RETENTION_CATEGORIES.map((category) => [
      category,
      RETENTION_DEFS[category].defaultMonths,
    ]),
  ) as Record<RetentionCategory, number>,
};

/** "6 Monate", "1 Monat", "5 Jahre", "sofort". */
export function formatPeriod(months: number): string {
  if (months === 0) return "sofort";
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? "1 Jahr" : `${years} Jahre`;
  }
  return months === 1 ? "1 Monat" : `${months} Monate`;
}

/** Merges stored (possibly partial or outdated) settings over the
 *  defaults and clamps every period to its allowed range. */
export function normalizeRetentionPolicy(raw: unknown): RetentionPolicy {
  const input = (raw && typeof raw === "object" ? raw : {}) as Partial<{
    mode: unknown;
    months: Record<string, unknown>;
  }>;
  const mode: RetentionMode =
    input.mode === "automatisch" ? "automatisch" : "bestaetigung";
  const months = { ...DEFAULT_RETENTION_POLICY.months };
  for (const category of RETENTION_CATEGORIES) {
    const value = input.months?.[category];
    if (typeof value === "number" && Number.isInteger(value)) {
      const def = RETENTION_DEFS[category];
      months[category] = Math.min(def.maxMonths, Math.max(def.minMonths, value));
    }
  }
  return { mode, months };
}

/** Validation error text for a period, or null when it is allowed. */
export function periodError(category: RetentionCategory, value: number): string | null {
  const def = RETENTION_DEFS[category];
  if (!Number.isInteger(value)) return "Bitte ganze Monate angeben.";
  if (value < def.minMonths || value > def.maxMonths) {
    return def.minMonths === def.maxMonths
      ? `Gesetzlich festgelegt: ${formatPeriod(def.minMonths)}.`
      : `Erlaubt: ${def.minMonths}–${def.maxMonths} Monate.`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Date arithmetic on ISO dates ("YYYY-MM-DD"), no time zones.          */
/* ------------------------------------------------------------------ */

/** ISO date `months` before `iso` (day clamped to the month's length). */
export function subtractMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** ISO date `months` after `iso`. */
export function addMonths(iso: string, months: number): string {
  return subtractMonths(iso, -months);
}

/** Last day of the period that starts with `startIso` — inclusive. */
export function periodEnd(
  startIso: string,
  months: number,
  fromYearEnd: boolean,
): string {
  const start = fromYearEnd ? `${startIso.slice(0, 4)}-12-31` : startIso.slice(0, 10);
  return addMonths(start, months);
}

/** True once the period that started at `startIso` is over on `today`. */
export function periodOver(
  startIso: string,
  months: number,
  fromYearEnd: boolean,
  today: string,
): boolean {
  return periodEnd(startIso, months, fromYearEnd) < today;
}

export const PSEUDONYM_FIRST_NAME = "Gelöscht";

/** Pseudonym that replaces a student's name ("Gelöscht #12"). */
export function studentPseudonym(studentId: number): string {
  return `${PSEUDONYM_FIRST_NAME} #${studentId}`;
}
