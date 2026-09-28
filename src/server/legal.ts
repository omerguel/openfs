/* ------------------------------------------------------------------ */
/* Public legal data for /impressum and /datenschutz.                  */
/* Deliberately public (like POST /api/appointment-requests and        */
/* /api/portal/:token): the legal pages must be reachable without a    */
/* staff login. Returns only the publishable company fields — never    */
/* bank data, DATEV numbers or the Gläubiger-ID.                       */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import { toLegalInfo } from "../lib/legal";
import { getCompany } from "./db";
import { handle, json } from "./http";

export const PUBLIC_LEGAL_PATH = "/api/public/legal";

export function legalRoutes(db: Database) {
  return {
    [PUBLIC_LEGAL_PATH]: {
      GET: () => handle(() => json(toLegalInfo(getCompany(db))))(),
    },
  };
}
