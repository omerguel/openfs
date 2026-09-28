/* ------------------------------------------------------------------ */
/* Pure logic of "Fahrschule & Einstellungen" (src/Fahrschule.tsx):     */
/* the editable draft, dirty detection by comparing with the server     */
/* state (never by listening to input events — that dropped the first   */
/* keystroke before), field validation and the opening-hours format.    */
/* ------------------------------------------------------------------ */

import type { CompanyProfile } from "./accounting-types";
import type { SettingsTab } from "./settings-tabs";
import { toInstagramUrl } from "./instagram";
import { formatCents, parseEuroToCents } from "./money";
import { isValidBic, isValidCreditorId, isValidIban } from "./sepa";
import type { SchoolProfile } from "@/server/school-profile";

export type PolicyDraft = { hours: string; fee: string };

export type SettingsDraft = {
  company: CompanyProfile;
  school: SchoolProfile;
  policy: PolicyDraft;
};

export function policyToDraft(policy: { hoursBefore: number; feeCents: number }) {
  return {
    hours: String(policy.hoursBefore),
    fee: policy.feeCents > 0 ? formatCents(policy.feeCents) : "",
  };
}

/** Structural equality for JSON-like drafts (key order independent). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]))
    );
  }
  if (typeof a === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return (
      ka.length === kb.length &&
      ka.every((k) =>
        sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    );
  }
  return false;
}

/** Which parts differ from the saved state (each saves via its own API). */
export function changedParts(draft: SettingsDraft, saved: SettingsDraft) {
  return {
    company: !sameValue(draft.company, saved.company),
    school: !sameValue(draft.school, saved.school),
    policy: !sameValue(draft.policy, saved.policy),
  };
}

export type FieldErrors = Partial<Record<string, string>>;

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Field id → message. Ids match the inputs' ids on the page. */
export function validateSettings(draft: SettingsDraft, now = new Date()): FieldErrors {
  const errors: FieldErrors = {};
  const { company, school, policy } = draft;
  if (!company.name.trim())
    errors["company-name"] = "Bitte den Namen der Fahrschule angeben.";
  for (const [id, value] of [
    ["company-email", company.email],
    ["company-datenschutzemail", company.datenschutzEmail],
  ] as const) {
    if (value.trim() && !EMAIL.test(value.trim()))
      errors[id] = "Bitte eine gültige E-Mail-Adresse angeben.";
  }
  if (company.iban.trim() && !isValidIban(company.iban))
    errors["company-iban"] =
      "Diese IBAN ist ungültig — Prüfziffer stimmt nicht. Bitte Ziffern kontrollieren.";
  if (company.bic.trim() && !isValidBic(company.bic))
    errors["company-bic"] = "Die BIC hat 8 oder 11 Zeichen, z. B. HELADEF1DAS.";
  if (company.glaeubigerId.trim() && !isValidCreditorId(company.glaeubigerId))
    errors["company-glaeubigerid"] = "Ungültige Gläubiger-ID (z. B. DE98ZZZ09999999999).";
  if (
    company.beraterNr.trim() &&
    !(/^\d{4,7}$/.test(company.beraterNr.trim()) && Number(company.beraterNr) >= 1001)
  )
    errors["company-beraternr"] = "Beraternummer: 1001 bis 9999999.";
  if (
    company.mandantNr.trim() &&
    !(/^\d{1,5}$/.test(company.mandantNr.trim()) && Number(company.mandantNr) >= 1)
  )
    errors["company-mandantnr"] = "Mandantennummer: 1 bis 99999.";

  const year = school.founded_year;
  if (year !== null && (year < 1900 || year > now.getFullYear()))
    errors["school-founded"] =
      `Bitte ein Jahr zwischen 1900 und ${now.getFullYear()} angeben.`;
  if (toInstagramUrl(school.instagram) === null)
    errors["school-instagram"] =
      "Bitte als Link oder @Name angeben, z. B. @fahrschule_nord.";
  if (school.google_place_id && !/^[A-Za-z0-9_-]{10,300}$/.test(school.google_place_id))
    errors["school-place-id"] =
      "Die Place ID besteht nur aus Buchstaben, Ziffern, - und _.";
  for (const [key, list] of [
    ["opening", school.opening_hours],
    ["theory", school.theory_hours],
  ] as const) {
    list.forEach((entry, index) => {
      const parsed = parseHours(entry.hours);
      if (parsed.open && parsed.from >= parsed.to)
        errors[`${key}-${index}`] = "„Bis“ muss nach „Von“ liegen.";
    });
  }

  const hours = Number(policy.hours);
  if (!/^\d+$/.test(policy.hours.trim()) || hours > 720)
    errors["policy-hours"] = "Ganze Zahl zwischen 0 und 720 Stunden.";
  if (policy.fee.trim() && parseEuroToCents(policy.fee) === null)
    errors["policy-fee"] = "Bitte als Betrag angeben, z. B. 45,00.";
  return errors;
}

/** Which tab each field lives on (error badges on the tabs). */
export function tabOfField(id: string): SettingsTab {
  if (/^company-(iban|bic|glaeubigerid|bankname)$/.test(id)) return "bank";
  if (
    /^company-(datenschutzemail|registergericht|registernummer|aufsichtsbehoerde|impressumzusatz)$/.test(
      id,
    )
  )
    return "recht";
  if (id.startsWith("school-")) return "profil";
  if (id.startsWith("opening-") || id.startsWith("theory-")) return "zeiten";
  if (id.startsWith("policy-")) return "absagen";
  return "stammdaten";
}

/* ---------------------------- hours ---------------------------------- */

export type ParsedHours = {
  open: boolean;
  set: boolean;
  from: string;
  to: string;
  note: string;
};

/** "09:00 – 18:00 Büro" | "Geschlossen" | "" (keine Angabe). */
export function parseHours(value: string): ParsedHours {
  const trimmed = value.trim();
  const match = /^(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})(?:\s+(.+))?$/.exec(trimmed);
  if (match) {
    const pad = (t: string) => t.padStart(5, "0");
    return {
      open: true,
      set: true,
      from: pad(match[1]!),
      to: pad(match[2]!),
      note: match[3] ?? "",
    };
  }
  return { open: false, set: trimmed !== "", from: "09:00", to: "18:00", note: "" };
}

export function formatHours(hours: {
  open: boolean;
  from: string;
  to: string;
  note: string;
}) {
  if (!hours.open) return "Geschlossen";
  const note = hours.note.trim();
  return `${hours.from} – ${hours.to}${note ? ` ${note}` : ""}`;
}
