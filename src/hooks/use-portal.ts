/* ------------------------------------------------------------------ */
/* Schülerportal — staff helpers for /api/students/:id/portal-link and */
/* public fetchers for /api/portal/:token (the student-facing page).   */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";

import { parseOrThrow } from "@/lib/api";
import type { OutboxEntry } from "@/server/mail";
import type {
  PortalLink,
  PortalLinkStatus,
  PortalMessage,
  PortalOverview,
} from "@/server/portal";

export type { PortalLink, PortalLinkStatus, PortalMessage, PortalOverview };

/* ------------------------------ staff ----------------------------- */

const linkPath = (studentId: number) => `/api/students/${studentId}/portal-link`;

export function portalUrl(token: string): string {
  return `${window.location.origin}/portal/${token}`;
}

export function usePortalLink(studentId: number) {
  const query = useQuery({
    queryKey: ["portal-link", studentId],
    queryFn: async () =>
      (
        await parseOrThrow<{ link: PortalLinkStatus | null }>(
          await fetch(linkPath(studentId)),
        )
      ).link,

  });
  return { link: query.data ?? null, loading: query.isPending, refresh: query.refetch };
}

export async function createPortalLink(studentId: number): Promise<PortalLink> {
  return parseOrThrow<PortalLink>(await fetch(linkPath(studentId), { method: "POST" }));
}

export async function revokePortalLink(studentId: number): Promise<void> {
  await parseOrThrow<{ ok: true }>(
    await fetch(linkPath(studentId), { method: "DELETE" }),
  );
}

export async function emailPortalLink(studentId: number): Promise<OutboxEntry> {
  return parseOrThrow<OutboxEntry>(
    await fetch(`${linkPath(studentId)}/email`, { method: "POST" }),
  );
}

/* ------------------------------ public ---------------------------- */

/** Error carrying the HTTP status so the page can tell 404 from 429. */
export class PortalError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function portalFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !data) {
    throw new PortalError(data?.error ?? "Anfrage fehlgeschlagen.", response.status);
  }
  return data;
}

const tokenPath = (token: string) => `/api/portal/${encodeURIComponent(token)}`;

export function usePortalOverview(token: string) {
  return useQuery({
    queryKey: ["portal", token],
    queryFn: () => portalFetch<PortalOverview>(tokenPath(token)),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function usePortalMessages(token: string, enabled: boolean) {
  return useQuery({
    queryKey: ["portal-messages", token],
    queryFn: async () =>
      (await portalFetch<{ messages: PortalMessage[] }>(`${tokenPath(token)}/messages`))
        .messages,
    enabled,
    retry: false,
    // No WebSockets — the thread polls every 15 s while the page is open.
    refetchInterval: 15_000,
  });
}

export function sendPortalMessage(token: string, text: string): Promise<PortalMessage> {
  return portalFetch<PortalMessage>(`${tokenPath(token)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}
