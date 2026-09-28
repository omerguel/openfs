/* ------------------------------------------------------------------ */
/* Terminanfragen — single client-side source of truth                 */
/*                                                                     */
/* The /terminanfragen inbox reads from this hook; accepting a request */
/* also creates a calendar event server-side, so the Kalender picks it */
/* up on its next fetch.                                               */
/* ------------------------------------------------------------------ */

import { parseOrThrow, useFetchList } from "@/lib/api";

export type AppointmentRequestType =
  | "Praktisch"
  | "Theorie"
  | "Vorstellung zur prakt. Prüfung"
  | "Theorieprüfung"
  | "Andere";

export type AppointmentRequestStatus = "offen" | "bestätigt" | "abgelehnt";

/* Calendar event overlapping the requested slot (assuming the 60min
   default duration) — the server only fills this for open requests. */
export type AppointmentRequestConflict = {
  id: string;
  title: string;
  start: string;
  end: string;
  instructor: string;
};

export type AppointmentRequest = {
  id: number;
  name: string;
  phone: string;
  email: string;
  message: string;
  requestedDate: string; // ISO "YYYY-MM-DD"
  requestedTime: string; // "HH:MM"
  type: AppointmentRequestType;
  status: AppointmentRequestStatus;
  createdAt: string;
  /** Campaign whose tracking link brought the request. */
  campaignId: number | null;
  campaignName: string | null;
  /** Student created from the request ("Als Fahrschüler anlegen"). */
  studentId: number | null;
  studentName: string | null;
  /* Present on list responses; create/update responses omit it. */
  conflicts?: AppointmentRequestConflict[];
};

export type AppointmentRequestInput = Omit<
  AppointmentRequest,
  | "id"
  | "createdAt"
  | "conflicts"
  | "campaignId"
  | "campaignName"
  | "studentId"
  | "studentName"
>;

/* Slot/assignment adjustments sent along when accepting a request. */
export type AcceptOverrides = {
  date?: string;
  start?: string;
  end?: string;
  instructor?: string;
  vehicle?: string;
  location?: string;
};

export type AcceptResult = {
  request: AppointmentRequest;
  event: { id: string; date: string; start: string; end: string; title: string };
};

export async function fetchAppointmentRequests(): Promise<AppointmentRequest[]> {
  const data = await parseOrThrow<{ requests: AppointmentRequest[] }>(
    await fetch("/api/appointment-requests"),
  );
  return data.requests;
}

export async function createAppointmentRequest(
  input: Partial<AppointmentRequestInput>,
): Promise<AppointmentRequest> {
  return parseOrThrow<AppointmentRequest>(
    await fetch("/api/appointment-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function updateAppointmentRequest(
  id: number,
  input: Partial<AppointmentRequestInput>,
): Promise<AppointmentRequest> {
  return parseOrThrow<AppointmentRequest>(
    await fetch(`/api/appointment-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteAppointmentRequest(id: number): Promise<void> {
  await parseOrThrow<{ ok: true }>(
    await fetch(`/api/appointment-requests/${id}`, { method: "DELETE" }),
  );
}

export async function acceptAppointmentRequest(
  id: number,
  overrides: AcceptOverrides = {},
): Promise<AcceptResult> {
  return parseOrThrow<AcceptResult>(
    await fetch(`/api/appointment-requests/${id}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(overrides),
    }),
  );
}

export async function linkAppointmentRequestStudent(
  id: number,
  studentId: number | null,
): Promise<AppointmentRequest> {
  return parseOrThrow<AppointmentRequest>(
    await fetch(`/api/appointment-requests/${id}/student`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId }),
    }),
  );
}

export async function declineAppointmentRequest(id: number): Promise<AppointmentRequest> {
  return parseOrThrow<AppointmentRequest>(
    await fetch(`/api/appointment-requests/${id}/decline`, { method: "POST" }),
  );
}

export function useAppointmentRequests() {
  const {
    items: requests,
    loading,
    refresh,
  } = useFetchList(
    ["appointment-requests"],
    fetchAppointmentRequests,
    "Terminanfragen konnten nicht geladen werden",
  );
  return { requests, loading, refresh };
}
