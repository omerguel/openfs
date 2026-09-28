/* ------------------------------------------------------------------ */
/* Nachrichten (E-Mail-Postausgang) — client helpers for /api/outbox,  */
/* /api/mail/status and /api/settings/notifications. Type-only imports */
/* from the server module keep server code out of the bundle.          */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";

import { parseOrThrow, useFetchList } from "@/lib/api";
import type {
  MailKind,
  NotificationSettings,
  OutboxChannel,
  OutboxEntry,
  OutboxStatus,
} from "@/server/mail";

export type { MailKind, NotificationSettings, OutboxChannel, OutboxEntry, OutboxStatus };

export type MailStatus = {
  configured: boolean;
  from: string;
  sms: { configured: boolean; provider: "seven" | "webhook" | null; from: string };
};

export async function fetchOutbox(): Promise<OutboxEntry[]> {
  const data = await parseOrThrow<{ items: OutboxEntry[] }>(await fetch("/api/outbox"));
  return data.items;
}

export async function retryOutboxEntry(id: number): Promise<OutboxEntry> {
  return parseOrThrow<OutboxEntry>(
    await fetch(`/api/outbox/${id}/retry`, { method: "POST" }),
  );
}

export async function queueGenericMail(input: {
  recipient: string;
  subject: string;
  body: string;
  studentId?: number;
}): Promise<OutboxEntry> {
  return parseOrThrow<OutboxEntry>(
    await fetch("/api/outbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function queueSms(input: {
  recipient: string;
  text: string;
  studentId?: number;
}): Promise<OutboxEntry> {
  return parseOrThrow<OutboxEntry>(
    await fetch("/api/outbox/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function saveNotificationSettings(
  input: Partial<NotificationSettings>,
): Promise<NotificationSettings> {
  return parseOrThrow<NotificationSettings>(
    await fetch("/api/settings/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export function useOutbox() {
  const { items, loading, refresh } = useFetchList(
    ["outbox"],
    fetchOutbox,
    "Nachrichten konnten nicht geladen werden",
  );
  return { items, loading, refresh };
}

export function useMailStatus() {
  const query = useQuery({
    queryKey: ["mail-status"],
    queryFn: async () => parseOrThrow<MailStatus>(await fetch("/api/mail/status")),
  });
  return query.data ?? null;
}

export function useNotificationSettings() {
  const query = useQuery({
    queryKey: ["notification-settings"],
    queryFn: async () =>
      parseOrThrow<NotificationSettings>(await fetch("/api/settings/notifications")),
  });
  return { settings: query.data ?? null, refresh: query.refetch };
}
