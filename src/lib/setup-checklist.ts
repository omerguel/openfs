/* ------------------------------------------------------------------ */
/* "Erste Schritte" on the dashboard after the setup wizard: each step */
/* is ticked off from live data, so the list reflects what really      */
/* exists. Pure — the component (Dashboard.tsx) gathers the facts.     */
/* ------------------------------------------------------------------ */

import type { CompanyProfile } from "./accounting-types";

export type ChecklistFacts = {
  company: CompanyProfile | null;
  instructors: number;
  vehicles: number;
  students: number;
  /** null = unknown / not visible for this role. */
  users: number | null;
  backups: { enabled: boolean; count: number } | null;
  /** The Preise page was opened from the checklist (per browser). */
  pricesReviewed: boolean;
};

export type ChecklistItem = {
  id: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
};

/** Missing Stammdaten the Rechnungen/Impressum need, as labels. */
export function missingCompanyData(company: CompanyProfile | null): string[] {
  if (!company) return [];
  const missing: string[] = [];
  if (!company.address.trim()) missing.push("Anschrift");
  if (!company.phone.trim()) missing.push("Telefon");
  if (!company.email.trim()) missing.push("E-Mail");
  if (!company.inhaber.trim()) missing.push("Inhaber/in");
  if (!company.steuernummer.trim() && !company.ustIdNr.trim())
    missing.push("Steuernummer");
  if (!company.iban.trim()) missing.push("IBAN");
  return missing;
}

export function setupChecklist(
  facts: ChecklistFacts,
  role: "inhaber" | "buero",
): ChecklistItem[] {
  const missing = missingCompanyData(facts.company);
  const items: (ChecklistItem & { ownerOnly?: boolean })[] = [
    {
      id: "fahrschule",
      label: "Fahrschuldaten vervollständigen",
      description: missing.length
        ? `Es fehlt: ${missing.join(", ")} — nötig für Rechnungen und Impressum.`
        : "Anschrift, Steuernummer und Bankverbindung sind hinterlegt.",
      href: "/fahrschule?tab=stammdaten",
      done: facts.company !== null && missing.length === 0,
    },
    {
      id: "fahrlehrer",
      label: "Fahrlehrer anlegen",
      description: "Wer unterrichtet? Grundlage für Kalender und Arbeitszeiten.",
      href: "/fahrlehrer",
      done: facts.instructors > 0,
    },
    {
      id: "fahrzeuge",
      label: "Fahrzeuge anlegen",
      description: "Schulungsfahrzeuge mit HU-Termin — OpenFS erinnert rechtzeitig.",
      href: "/fahrzeuge",
      done: facts.vehicles > 0,
    },
    {
      id: "preise",
      label: "Preise prüfen",
      description: "Grundbetrag, Fahrstunden und Sonderfahrten an Ihre Preise anpassen.",
      href: "/preisangebot",
      done: facts.pricesReviewed,
    },
    {
      id: "benutzer",
      label: "Benutzer einladen",
      description:
        "Zugänge für Büro und Fahrlehrer — jede Rolle sieht nur, was sie braucht.",
      href: "/benutzer",
      done: (facts.users ?? 0) > 1,
      ownerOnly: true,
    },
    {
      id: "schueler",
      label: "Ersten Fahrschüler anmelden",
      description: "Anmeldung mit Ausbildungsvertrag und Preisplan.",
      href: "/neue-schueler",
      done: facts.students > 0,
    },
    {
      id: "sicherung",
      label: "Datensicherung prüfen",
      description: "Automatische Sicherungen ansehen und eine Sicherung herunterladen.",
      href: "/datensicherung",
      done: facts.backups !== null && (!facts.backups.enabled || facts.backups.count > 0),
      ownerOnly: true,
    },
  ];
  return items
    .filter((item) => role === "inhaber" || !item.ownerOnly)
    .map(({ ownerOnly: _ownerOnly, ...item }) => item);
}
