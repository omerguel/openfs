/* ------------------------------------------------------------------ */
/* Stammdaten der Fahrschule (settings key 'company') — the PUT logic  */
/* behind /api/profile. Tax numbers and the Bankverbindung end up on   */
/* every Rechnung, Quittung and SEPA file, so only the Inhaber may     */
/* change them; Büro sees them read-only. Changed values are checked   */
/* (IBAN / Gläubiger-ID checksums, BIC format).                        */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import type { CompanyProfile } from "../lib/accounting-types";
import { isValidBic, isValidCreditorId, isValidIban } from "../lib/sepa";
import { getCompany, setCompany } from "./db";
import { ForbiddenError, ValidationError } from "./errors";
import type { Role } from "./request-context";
import { getSchoolProfile, setSchoolProfile } from "./school-profile";

/** Fields only the Inhaber may change (read-only for Büro). */
export const OWNER_COMPANY_FIELDS = [
  "steuernummer",
  "ustIdNr",
  "bankName",
  "iban",
  "bic",
  "glaeubigerId",
] as const satisfies readonly (keyof CompanyProfile)[];

const CHECKS: Partial<Record<keyof CompanyProfile, [(v: string) => boolean, string]>> = {
  iban: [
    isValidIban,
    "Die IBAN ist ungültig — bitte Länderkennung, Prüfziffer und Länge prüfen.",
  ],
  bic: [isValidBic, "Die BIC ist ungültig (8 oder 11 Zeichen, z. B. HELADEF1DAS)."],
  glaeubigerId: [
    isValidCreditorId,
    "Die Gläubiger-ID ist ungültig (z. B. DE98ZZZ09999999999).",
  ],
};

/** Merges the string fields of `body` onto the stored profile.
 *  `role` undefined = trusted caller (tests, setup). */
export function updateCompanyProfile(
  db: Database,
  body: Partial<Record<keyof CompanyProfile, unknown>>,
  role?: Role,
): CompanyProfile {
  const current = getCompany(db);
  const next: CompanyProfile = { ...current };
  for (const key of Object.keys(current) as (keyof CompanyProfile)[]) {
    const value = body[key];
    if (typeof value === "string") next[key] = value.trim();
  }
  const changed = (key: keyof CompanyProfile) => next[key] !== current[key];

  if (role && role !== "inhaber") {
    const locked = OWNER_COMPANY_FIELDS.filter(changed);
    if (locked.length > 0) {
      throw new ForbiddenError(
        "Steuer- und Bankdaten kann nur die Inhaberin bzw. der Inhaber ändern.",
      );
    }
  }
  for (const [key, [valid, message]] of Object.entries(CHECKS) as [
    keyof CompanyProfile,
    [(v: string) => boolean, string],
  ][]) {
    if (changed(key) && next[key] && !valid(next[key])) {
      throw new ValidationError(message);
    }
  }

  setCompany(db, next);
  if (next.website !== current.website) {
    setSchoolProfile(db, { ...getSchoolProfile(db), website: next.website });
  }
  return next;
}
