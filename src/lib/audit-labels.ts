/* ------------------------------------------------------------------ */
/* Protokoll (Benutzer → Protokoll): a readable German description for */
/* each audit entry ("Fahrschüler angelegt", "Anmeldung fehlgeschlagen") */
/* — the raw method, path and status stay available as detail.          */
/* ------------------------------------------------------------------ */

type Rule = {
  pattern: RegExp;
  /** Label per HTTP method; "*" as fallback. */
  labels: Partial<Record<string, string>>;
};

/* First match wins — specific sub-resources before their parents. */
const RULES: Rule[] = [
  {
    pattern: /^\/api\/users\/[^/]+\/invite$/,
    labels: { POST: "Einladungslink erstellt" },
  },
  { pattern: /^\/api\/users$/, labels: { POST: "Benutzer angelegt" } },
  { pattern: /^\/api\/users\/[^/]+$/, labels: { PATCH: "Benutzer geändert" } },
  { pattern: /^\/api\/auth\/password$/, labels: { POST: "Eigenes Passwort geändert" } },
  { pattern: /^\/api\/auth\/logout$/, labels: { POST: "Abgemeldet" } },
  {
    pattern: /^\/api\/students\/[^/]+\/files/,
    labels: { POST: "Dokument hochgeladen", DELETE: "Dokument gelöscht" },
  },
  {
    pattern: /^\/api\/students\/[^/]+\/portal-link\/email$/,
    labels: { POST: "Portal-Link per E-Mail gesendet" },
  },
  {
    pattern: /^\/api\/students\/[^/]+\/portal-link$/,
    labels: { POST: "Portal-Link erstellt", DELETE: "Portal-Link widerrufen" },
  },
  { pattern: /^\/api\/students$/, labels: { POST: "Fahrschüler angelegt" } },
  {
    pattern: /^\/api\/students\/[^/]+$/,
    labels: {
      PATCH: "Fahrschüler geändert",
      PUT: "Fahrschüler geändert",
      DELETE: "Fahrschüler gelöscht",
    },
  },
  {
    pattern: /^\/api\/calendar-events\/[^/]+\/bill$/,
    labels: { POST: "Termin abgerechnet" },
  },
  {
    pattern: /^\/api\/calendar-events\/[^/]+\/cancel$/,
    labels: { POST: "Termin abgesagt" },
  },
  {
    pattern: /^\/api\/calendar-events\/[^/]+\/uncancel$/,
    labels: { POST: "Absage zurückgenommen" },
  },
  {
    pattern: /^\/api\/calendar-events\/[^/]+\/attestation$/,
    labels: { "*": "Ausbildungsnachweis erfasst" },
  },
  {
    pattern: /^\/api\/calendar-events\/[^/]+\/exam-result$/,
    labels: { "*": "Prüfungsergebnis eingetragen" },
  },
  {
    pattern: /^\/api\/calendar-events\/series/,
    labels: {
      POST: "Terminserie angelegt",
      PATCH: "Terminserie geändert",
      DELETE: "Terminserie gelöscht",
    },
  },
  { pattern: /^\/api\/calendar-events$/, labels: { POST: "Termin angelegt" } },
  {
    pattern: /^\/api\/calendar-events\/[^/]+$/,
    labels: {
      PATCH: "Termin geändert",
      PUT: "Termin geändert",
      DELETE: "Termin gelöscht",
    },
  },
  {
    pattern: /^\/api\/accounting\/transactions\/[^/]+\/storno$/,
    labels: { POST: "Buchung storniert" },
  },
  { pattern: /^\/api\/accounting\/transactions$/, labels: { POST: "Buchung erfasst" } },
  { pattern: /^\/api\/accounting\/accounts/, labels: { "*": "Konto geändert" } },
  { pattern: /^\/api\/invoices\/[^/]+\/storno$/, labels: { POST: "Rechnung storniert" } },
  {
    pattern: /^\/api\/invoices\/[^/]+\/reminders$/,
    labels: { POST: "Mahnung erstellt" },
  },
  { pattern: /^\/api\/invoices$/, labels: { POST: "Rechnung erstellt" } },
  {
    pattern: /^\/api\/instalment/,
    labels: { "*": "Ratenplan geändert", POST: "Ratenplan angelegt" },
  },
  { pattern: /^\/api\/sepa\//, labels: { "*": "Lastschrift bearbeitet" } },
  { pattern: /^\/api\/profile$/, labels: { PUT: "Stammdaten der Fahrschule geändert" } },
  { pattern: /^\/api\/school-profile$/, labels: { PUT: "Öffentliches Profil geändert" } },
  {
    pattern: /^\/api\/settings\/cancellation-policy$/,
    labels: { "*": "Absage-Regeln geändert" },
  },
  {
    pattern: /^\/api\/settings\/invoicing$/,
    labels: { "*": "Rechnungseinstellungen geändert" },
  },
  {
    pattern: /^\/api\/settings\/notifications$/,
    labels: { "*": "Benachrichtigungen geändert" },
  },
  { pattern: /^\/api\/instructors$/, labels: { POST: "Fahrlehrer/in angelegt" } },
  {
    pattern: /^\/api\/instructors\/[^/]+$/,
    labels: { PATCH: "Fahrlehrer/in geändert", DELETE: "Fahrlehrer/in gelöscht" },
  },
  {
    pattern: /^\/api\/absences/,
    labels: {
      POST: "Abwesenheit eingetragen",
      PATCH: "Abwesenheit geändert",
      DELETE: "Abwesenheit gelöscht",
    },
  },
  { pattern: /^\/api\/vehicles$/, labels: { POST: "Fahrzeug angelegt" } },
  {
    pattern: /^\/api\/vehicles\/[^/]+$/,
    labels: { PATCH: "Fahrzeug geändert", DELETE: "Fahrzeug gelöscht" },
  },
  { pattern: /^\/api\/price-plans$/, labels: { POST: "Preisplan angelegt" } },
  {
    pattern: /^\/api\/price-plans\/[^/]+$/,
    labels: {
      PATCH: "Preisplan geändert",
      PUT: "Preisplan geändert",
      DELETE: "Preisplan gelöscht",
    },
  },
  {
    pattern: /^\/api\/theory-groups\/[^/]+\/attendance$/,
    labels: { "*": "Theorie-Anwesenheit erfasst" },
  },
  {
    pattern: /^\/api\/theory-groups/,
    labels: {
      POST: "Theoriegruppe angelegt",
      PATCH: "Theoriegruppe geändert",
      DELETE: "Theoriegruppe gelöscht",
    },
  },
  { pattern: /^\/api\/attestations/, labels: { "*": "Ausbildungsnachweis erfasst" } },
  {
    pattern: /^\/api\/appointment-requests\/[^/]+\/accept$/,
    labels: { POST: "Terminanfrage angenommen" },
  },
  {
    pattern: /^\/api\/appointment-requests\/[^/]+\/decline$/,
    labels: { POST: "Terminanfrage abgelehnt" },
  },
  {
    pattern: /^\/api\/appointment-requests/,
    labels: { "*": "Terminanfrage bearbeitet" },
  },
  {
    pattern: /^\/api\/conversations\/[^/]+\/messages$/,
    labels: { POST: "Chat-Nachricht gesendet" },
  },
  { pattern: /^\/api\/conversations/, labels: { "*": "Chat bearbeitet" } },
  { pattern: /^\/api\/outbox\/sms$/, labels: { POST: "SMS gesendet" } },
  { pattern: /^\/api\/outbox/, labels: { "*": "E-Mail erneut gesendet" } },
  { pattern: /^\/api\/reviews/, labels: { "*": "Bewertungen bearbeitet" } },
  {
    pattern: /^\/api\/campaigns/,
    labels: { POST: "Kampagne angelegt", "*": "Kampagne geändert" },
  },
  {
    pattern: /^\/api\/branches/,
    labels: {
      POST: "Standort angelegt",
      PATCH: "Standort geändert",
      DELETE: "Standort gelöscht",
    },
  },
  { pattern: /^\/api\/import\//, labels: { "*": "Datenimport" } },
  {
    pattern: /^\/api\/archive\/[^/]+\/restore$/,
    labels: { POST: "Aus dem Archiv wiederhergestellt" },
  },
  {
    pattern: /^\/api\/archive/,
    labels: { DELETE: "Aus dem Archiv endgültig gelöscht", "*": "Archiv bearbeitet" },
  },
  { pattern: /^\/api\/admin\/backups$/, labels: { POST: "Datensicherung erstellt" } },
  {
    pattern: /^\/api\/admin\/retention\/policy$/,
    labels: { "*": "Löschfristen geändert" },
  },
  { pattern: /^\/api\/admin\/retention\/run$/, labels: { POST: "Löschlauf bestätigt" } },
  {
    pattern: /^\/api\/admin\/retention\/holds/,
    labels: { POST: "Aufbewahrung verlängert", DELETE: "Aufbewahrung aufgehoben" },
  },
  {
    pattern: /^\/api\/admin\/privacy\/students\/[^/]+\/erasure$/,
    labels: { POST: "Löschung auf Antrag (Art. 17) ausgeführt" },
  },
];

const RUN_LABELS: Record<string, string> = {
  anfragen: "Anfragen",
  dokumente: "Dokumente",
  chat: "Chat-Nachrichten",
  portal: "Portal-Links",
  nachrichten: "E-Mails/SMS",
  protokoll: "Protokolleinträge",
  ausbildungsnachweis: "Ausbildungsnachweise",
  schueler: "Schüler anonymisiert",
  buchhaltung: "Buchhaltung pseudonymisiert",
};

/* "LOESCHLAUF" entries carry counts only: ?trigger=…&anfragen=2&… */
function describeRun(path: string): string {
  const params = new URLSearchParams(path.split("?")[1] ?? "");
  const trigger = params.get("trigger");
  const parts = [...params.entries()]
    .filter(([key]) => key !== "trigger")
    .map(([key, n]) => `${n} ${RUN_LABELS[key] ?? key}`);
  const kind =
    trigger === "antrag"
      ? "Löschung auf Antrag"
      : trigger === "automatisch"
        ? "Automatischer Löschlauf"
        : "Löschlauf";
  return parts.length ? `${kind}: ${parts.join(", ")}` : kind;
}

export type AuditDescription = { label: string; failed: boolean; detail: string };

export function describeAudit(entry: {
  method: string;
  path: string;
  status: number;
}): AuditDescription {
  const failed = entry.status >= 400;
  const detail = `${entry.method} ${entry.path} · ${entry.status}`;
  if (entry.method === "LOGIN") {
    const who = /\(([^)]+)\)$/.exec(entry.path)?.[1];
    return {
      label: failed ? `Anmeldung fehlgeschlagen${who ? ` (${who})` : ""}` : "Angemeldet",
      failed,
      detail,
    };
  }
  if (entry.method === "LOESCHLAUF") {
    return { label: describeRun(entry.path), failed, detail };
  }
  if (entry.method === "INVITE") {
    return { label: "Passwort über Einladungslink gesetzt", failed, detail };
  }
  const path = entry.path.split("?")[0]!;
  const rule = RULES.find((r) => r.pattern.test(path));
  const base = rule?.labels[entry.method] ?? rule?.labels["*"] ?? "Änderung";
  const reason =
    entry.status === 403
      ? "keine Berechtigung"
      : entry.status === 401
        ? "nicht angemeldet"
        : entry.status >= 500
          ? "Serverfehler"
          : "fehlgeschlagen";
  return { label: failed ? `${base} – ${reason}` : base, failed, detail };
}
