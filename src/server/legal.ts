/* ------------------------------------------------------------------ */
/* Public legal data for /impressum and /datenschutz.                  */
/* Deliberately public (like POST /api/appointment-requests and        */
/* /api/portal/:token): the legal pages must be reachable without a    */
/* staff login. Returns only the publishable company fields — never    */
/* bank data, DATEV numbers or the Gläubiger-ID.                       */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import {
  missingDatenschutzFields,
  missingImpressumFields,
  toLegalInfo,
  type LegalField,
  type LegalInfo,
} from "../lib/legal";
import { getCompany } from "./db";
import { handle, json } from "./http";

export const PUBLIC_LEGAL_PATH = "/api/public/legal";

/* `missing` lists the required Impressum/Datenschutz fields that are
   still empty, so the staff app can warn the owner. The public pages
   never show it to visitors — they simply omit empty fields. */
export type PublicLegalInfo = LegalInfo & { missing: LegalField[] };

export function publicLegalInfo(db: Database): PublicLegalInfo {
  const info = toLegalInfo(getCompany(db));
  const missing = [
    ...new Set([...missingImpressumFields(info), ...missingDatenschutzFields(info)]),
  ];
  return { ...info, missing };
}

export function legalRoutes(db: Database) {
  return {
    [PUBLIC_LEGAL_PATH]: {
      GET: () => handle(() => json(publicLegalInfo(db)))(),
    },
  };
}
