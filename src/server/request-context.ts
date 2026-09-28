/* ------------------------------------------------------------------ */
/* Per-request context (AsyncLocalStorage): the signed-in user, and in  */
/* multi-tenant mode the tenant's database. Set by the API guard in    */
/* auth.ts around every handler; read anywhere below it without        */
/* threading parameters through every domain function.                 */
/* ------------------------------------------------------------------ */

import { AsyncLocalStorage } from "node:async_hooks";

import type { Database } from "./sqlite";

export type Role = "inhaber" | "buero" | "fahrlehrer";

export type SessionUser = {
  id: number;
  email: string;
  name: string;
  role: Role;
  instructorId: number | null;
};

export type RequestContext = {
  user?: SessionUser;
  /** Tenant database (multi-tenant mode only). */
  db?: Database;
  tenant?: string;
};

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function currentUser(): SessionUser | undefined {
  return requestContext.getStore()?.user;
}
