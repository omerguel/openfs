/* ------------------------------------------------------------------ */
/* Calendar events — single client-side source of truth                 */
/*                                                                     */
/* The calendar (/kalendar), the dashboard (/) and the student Stunden  */
/* tab all read events from this hook so every create/move/edit/delete  */
/* persists and survives reloads.                                       */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";

import { parseOrThrow, useFetchList } from "@/lib/api";
import type { CalEvent } from "@/lib/calendar-data";
import type { CreateTransactionInput } from "@/lib/accounting-types";
import type { CancellationKind, CancellationPolicy } from "@/lib/cancellation";
import type { LessonKind } from "@/lib/special-drives";
import type { SchedulingConflicts } from "@/server/calendar-conflicts";
import type { SeriesRepeat } from "@/server/calendar-series";

export type CalendarEventInput = Omit<
  CalEvent,
  | "id"
  | "billedTransactionId"
  | "billedActive"
  | "studentId"
  | "lessonKind"
  | "seriesId"
  | "cancelledAt"
  | "cancellationKind"
  | "cancellationFeeTransactionId"
  | "cancellationFeeActive"
  | "cancellationFeeCents"
  | "warnings"
> & {
  /** number links the event to a student; null explicitly clears the
      link. The server keeps the stored value when the key is absent
      (JSON.stringify drops undefined), so senders that resolve the
      student must pass null — not undefined — to unlink. */
  studentId?: number | null;
  /** null clears the kind (same absent-key rule as studentId). */
  lessonKind?: LessonKind | null;
  /** Save despite an overlap / absence (user confirmed). */
  allowConflicts?: boolean;
};

export type { SchedulingConflicts, SeriesRepeat };

/* Overlap / absence rejections can be overridden with allowConflicts. */
export const isOverridableConflict = (message: string) =>
  message.includes("Überschneidung") || message.includes("abwesend");

export async function fetchCalendarEvents(): Promise<CalEvent[]> {
  const data = await parseOrThrow<{ events: CalEvent[] }>(
    await fetch("/api/calendar-events"),
  );
  return data.events;
}

export async function createCalendarEvent(
  input: Partial<CalendarEventInput>,
): Promise<CalEvent> {
  return parseOrThrow<CalEvent>(
    await fetch("/api/calendar-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function updateCalendarEvent(
  id: number,
  input: Partial<CalendarEventInput>,
): Promise<CalEvent> {
  return parseOrThrow<CalEvent>(
    await fetch(`/api/calendar-events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteCalendarEvent(id: number): Promise<void> {
  await parseOrThrow<{ ok: true }>(
    await fetch(`/api/calendar-events/${id}`, { method: "DELETE" }),
  );
}

export async function billCalendarEvent(
  id: string,
  input: CreateTransactionInput,
): Promise<{ transaction: { id: number }; event: CalEvent }> {
  return parseOrThrow<{ transaction: { id: number }; event: CalEvent }>(
    await fetch(`/api/calendar-events/${id}/bill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function recordExamResult(
  id: string,
  result: "bestanden" | "nicht_bestanden" | null,
): Promise<CalEvent> {
  return parseOrThrow<CalEvent>(
    await fetch(`/api/calendar-events/${id}/exam-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result }),
    }),
  );
}

export async function createCalendarEventSeries(
  input: Partial<CalendarEventInput> & { repeat: SeriesRepeat },
): Promise<{ seriesId: string; events: CalEvent[]; warnings?: string[] }> {
  return parseOrThrow(
    await fetch("/api/calendar-events/series", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

/** "Diesen und alle folgenden": apply the change to this occurrence and
    every later one of its series. */
export async function updateCalendarEventSeriesFrom(
  id: string,
  input: Partial<CalendarEventInput>,
): Promise<{ events: CalEvent[]; skipped: number; warnings?: string[] }> {
  return parseOrThrow(
    await fetch(`/api/calendar-events/${id}/series`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteCalendarEventSeries(
  seriesId: string,
  from: string,
): Promise<{ deleted: number; skipped: number }> {
  return parseOrThrow(
    await fetch(
      `/api/calendar-events/series/${encodeURIComponent(seriesId)}?from=${from}`,
      { method: "DELETE" },
    ),
  );
}

export type CancelEventInput = {
  kind: CancellationKind;
  chargeFee?: boolean;
  feeCents?: number;
  date?: string;
};

export async function cancelCalendarEvent(
  id: string,
  input: CancelEventInput,
): Promise<{ event: CalEvent; transaction?: { id: number } }> {
  return parseOrThrow(
    await fetch(`/api/calendar-events/${id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function uncancelCalendarEvent(
  id: string,
  allowConflicts = false,
): Promise<CalEvent> {
  return parseOrThrow<CalEvent>(
    await fetch(`/api/calendar-events/${id}/uncancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowConflicts }),
    }),
  );
}

export async function fetchCancellationPolicy(): Promise<CancellationPolicy> {
  return parseOrThrow<CancellationPolicy>(
    await fetch("/api/settings/cancellation-policy"),
  );
}

export async function saveCancellationPolicy(
  policy: CancellationPolicy,
): Promise<CancellationPolicy> {
  return parseOrThrow<CancellationPolicy>(
    await fetch("/api/settings/cancellation-policy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy),
    }),
  );
}

export function useCancellationPolicy() {
  return useQuery({
    queryKey: ["cancellation-policy"],
    queryFn: fetchCancellationPolicy,
  });
}

/** Existing overlaps + Termine on absence days in [from, to]. */
export function useCalendarConflicts(from: string, to: string) {
  return useQuery({
    queryKey: ["calendar-conflicts", from, to],
    queryFn: async () =>
      parseOrThrow<SchedulingConflicts>(
        await fetch(`/api/calendar-events/conflicts?from=${from}&to=${to}`),
      ),
  });
}

export function useCalendarEvents() {
  const {
    items: events,
    loading,
    refresh,
  } = useFetchList(
    ["calendar-events"],
    fetchCalendarEvents,
    "Termine konnten nicht geladen werden",
  );
  return { events, loading, refresh };
}
