/* ------------------------------------------------------------------ */
/* Sign-in state for the staff app. The server sets an HttpOnly        */
/* session cookie; the client only asks /api/auth/status who it is.    */
/* Any 401 from the API (session expired, signed out elsewhere) flips  */
/* the app back to the sign-in page via the "openfs:unauthorized"      */
/* event raised by the fetch hook installed in installAuthFetchHook(). */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";

import { parseOrThrow } from "@/lib/api";
import { queryClient } from "@/lib/query-client";

export type Role = "inhaber" | "buero" | "fahrlehrer";

export const ROLE_LABELS: Record<Role, string> = {
  inhaber: "Inhaber/in",
  buero: "Büro",
  fahrlehrer: "Fahrlehrer/in",
};

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: Role;
  instructorId: number | null;
};

export type AuthStatus = {
  setupRequired: boolean;
  user: AuthUser | null;
  demo: { email: string; password: string } | null;
};

export const UNAUTHORIZED_EVENT = "openfs:unauthorized";

let hookInstalled = false;

/** Wrap window.fetch once: a 401 from any /api call (except the auth
 *  endpoints themselves) means the session is gone. */
export function installAuthFetchHook() {
  if (hookInstalled || typeof window === "undefined") return;
  hookInstalled = true;
  const original = window.fetch.bind(window);
  const hooked = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await original(input, init);
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (response.status === 401 && url.includes("/api/") && !url.includes("/api/auth/")) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return response;
  };
  window.fetch = Object.assign(hooked, { preconnect: window.fetch.preconnect });
}

export function useAuthStatus() {
  return useQuery({
    queryKey: ["auth", "status"],
    queryFn: async () => parseOrThrow<AuthStatus>(await fetch("/api/auth/status")),
    staleTime: 60_000,
  });
}

async function post<T>(url: string, body: unknown): Promise<T> {
  return parseOrThrow<T>(
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/* After signing in or out every cached query belongs to someone else. */
async function resetSession() {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
  await queryClient.refetchQueries({ queryKey: ["auth", "status"] });
}

export async function login(email: string, password: string) {
  await post("/api/auth/login", { email, password });
  await resetSession();
}

export async function logout() {
  await post("/api/auth/logout", {});
  await resetSession();
}

export type SetupInput = {
  name: string;
  email: string;
  password: string;
  schoolName: string;
  address: string;
  phone: string;
  schoolEmail: string;
  openingDate: string;
  kasseCents?: number;
  bankCents?: number;
};

export async function setup(input: SetupInput) {
  await post("/api/auth/setup", input);
  await resetSession();
}

export async function changePassword(current: string, next: string) {
  await post("/api/auth/password", { current, next });
}

/* Navigation hidden per role — the server enforces the same rules. */
const FINANCE_ROUTES = ["/buchhaltung", "/rechnungen", "/import", "/marketing"];
const OWNER_ROUTES = ["/benutzer", "/datensicherung"];

export function canSeeRoute(role: Role | undefined, route: string): boolean {
  if (!role || role === "inhaber") return true;
  if (OWNER_ROUTES.includes(route)) return false;
  if (role === "buero") return true;
  return !FINANCE_ROUTES.includes(route);
}
