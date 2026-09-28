/* ------------------------------------------------------------------ */
/* Impressum / Datenschutz — pure helpers shared by the public legal   */
/* pages (/impressum, /datenschutz) and the public API endpoint.       */
/* The pages never invent data: every missing field is reported so    */
/* the page can show a notice instead.                                 */
/* ------------------------------------------------------------------ */

import type { CompanyProfile } from "./accounting-types";

/** The subset of the company profile that is safe to publish. Bank data,
 *  DATEV numbers and the Gläubiger-ID stay private. */
export const LEGAL_FIELDS = [
  "name",
  "address",
  "phone",
  "email",
  "website",
  "ustIdNr",
  "steuernummer",
  "inhaber",
  "registergericht",
  "registernummer",
  "aufsichtsbehoerde",
  "datenschutzEmail",
  "impressumZusatz",
] as const satisfies readonly (keyof CompanyProfile)[];

export type LegalField = (typeof LEGAL_FIELDS)[number];
export type LegalInfo = Pick<CompanyProfile, LegalField>;

export const EMPTY_LEGAL_INFO: LegalInfo = Object.fromEntries(
  LEGAL_FIELDS.map((field) => [field, ""]),
) as LegalInfo;

export const LEGAL_FIELD_LABELS: Record<LegalField, string> = {
  name: "Name der Fahrschule",
  address: "Anschrift",
  phone: "Telefon",
  email: "E-Mail",
  website: "Webseite",
  ustIdNr: "USt-IdNr",
  steuernummer: "Steuernummer",
  inhaber: "Inhaber/in / vertretungsberechtigte Person",
  registergericht: "Registergericht",
  registernummer: "Registernummer",
  aufsichtsbehoerde: "Aufsichtsbehörde (Fahrschulerlaubnis)",
  datenschutzEmail: "E-Mail für Datenschutzanfragen",
  impressumZusatz: "Zusatz zum Impressum",
};

/** Picks only the publishable fields; non-string values become "". */
export function toLegalInfo(company: Partial<CompanyProfile>): LegalInfo {
  const info = { ...EMPTY_LEGAL_INFO };
  for (const field of LEGAL_FIELDS) {
    const value = company[field];
    info[field] = typeof value === "string" ? value.trim() : "";
  }
  return info;
}

/** Fields the Impressum cannot do without (§ 5 DDG: Name, Anschrift,
 *  schnelle Kontaktaufnahme, Vertretungsberechtigte, Aufsichtsbehörde bei
 *  erlaubnispflichtiger Tätigkeit — die Fahrschulerlaubnis ist eine). */
export const REQUIRED_IMPRESSUM_FIELDS = [
  "name",
  "address",
  "phone",
  "email",
  "inhaber",
  "aufsichtsbehoerde",
] as const satisfies readonly LegalField[];

/** Fields the Datenschutzerklärung needs to name the Verantwortliche. */
export const REQUIRED_DATENSCHUTZ_FIELDS = [
  "name",
  "address",
  "email",
  "inhaber",
] as const satisfies readonly LegalField[];

function missing(info: LegalInfo, fields: readonly LegalField[]): LegalField[] {
  return fields.filter((field) => !info[field].trim());
}

export function missingImpressumFields(info: LegalInfo): LegalField[] {
  const out = missing(info, REQUIRED_IMPRESSUM_FIELDS);
  // A Registernummer without its Registergericht (or vice versa) is incomplete.
  const hasCourt = Boolean(info.registergericht.trim());
  const hasNumber = Boolean(info.registernummer.trim());
  if (hasCourt && !hasNumber) out.push("registernummer");
  if (hasNumber && !hasCourt) out.push("registergericht");
  return out;
}

export function missingDatenschutzFields(info: LegalInfo): LegalField[] {
  return missing(info, REQUIRED_DATENSCHUTZ_FIELDS);
}

/** Where Datenschutz requests go: the dedicated address, else the general one. */
export function privacyContactEmail(info: LegalInfo): string {
  return info.datenschutzEmail.trim() || info.email.trim();
}

/** Splits a free-form address ("Straße 1, 12345 Ort") into display lines. */
export function addressLines(address: string): string[] {
  return address
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
}
