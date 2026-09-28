/* ------------------------------------------------------------------ */
/* Instructor absences (Abwesenheiten) + working-time report —         */
/* client access for /fahrlehrer and /kalendar.                        */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";

import { parseOrThrow } from "@/lib/api";
import type { Absence, AbsenceInput, AbsenceKind } from "@/server/absences";
import type { InstructorHoursReport } from "@/server/instructor-hours";

export type { Absence, AbsenceInput, AbsenceKind, InstructorHoursReport };

export const ABSENCE_KIND_OPTIONS: AbsenceKind[] = [
  "Urlaub",
  "Krank",
  "Fortbildung",
  "Sonstiges",
];

export async function fetchAbsences(filter: {
  instructorId?: number;
  from?: string;
  to?: string;
}): Promise<Absence[]> {
  const params = new URLSearchParams();
  if (filter.instructorId !== undefined) {
    params.set("instructorId", String(filter.instructorId));
  }
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  const data = await parseOrThrow<{ absences: Absence[] }>(
    await fetch(`/api/absences?${params}`),
  );
  return data.absences;
}

export async function createAbsence(input: AbsenceInput): Promise<Absence> {
  return parseOrThrow<Absence>(
    await fetch("/api/absences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteAbsence(id: number): Promise<void> {
  await parseOrThrow<{ ok: true }>(
    await fetch(`/api/absences/${id}`, { method: "DELETE" }),
  );
}

/** Absences, optionally narrowed to one instructor and/or a window. */
export function useAbsences(filter: {
  instructorId?: number;
  from?: string;
  to?: string;
}) {
  return useQuery({
    queryKey: [
      "absences",
      filter.instructorId ?? null,
      filter.from ?? null,
      filter.to ?? null,
    ],
    queryFn: () => fetchAbsences(filter),
  });
}

export function useInstructorHours(from: string, to: string) {
  return useQuery({
    queryKey: ["instructor-hours", from, to],
    queryFn: async () =>
      parseOrThrow<InstructorHoursReport>(
        await fetch(`/api/reports/instructor-hours?from=${from}&to=${to}`),
      ),
  });
}
