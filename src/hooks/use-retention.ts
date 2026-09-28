/* Löschkonzept + Betroffenenrechte (Inhaber only, /api/admin/…). */

import { useQuery } from "@tanstack/react-query";

import { parseOrThrow } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import type { RetentionPolicy } from "@/lib/retention";
import type { ErasurePlan, Subject } from "@/server/privacy";
import type { RetentionHold, RetentionOverview, RetentionRun } from "@/server/retention";

export type { ErasurePlan, RetentionHold, RetentionOverview, RetentionRun, Subject };

const OVERVIEW_KEY = ["retention"] as const;
const SUBJECTS_KEY = ["privacy-subjects"] as const;

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export function useRetentionOverview(enabled = true) {
  return useQuery({
    queryKey: OVERVIEW_KEY,
    enabled,
    queryFn: async () =>
      parseOrThrow<RetentionOverview>(await fetch("/api/admin/retention")),
  });
}

export function usePrivacySubjects(enabled = true) {
  return useQuery({
    queryKey: SUBJECTS_KEY,
    enabled,
    queryFn: async () =>
      parseOrThrow<Subject[]>(await fetch("/api/admin/privacy/subjects")),
  });
}

async function refreshAll() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY }),
    queryClient.invalidateQueries({ queryKey: SUBJECTS_KEY }),
    queryClient.invalidateQueries({ queryKey: ["public-legal"] }),
  ]);
}

export async function saveRetentionPolicy(
  policy: Partial<RetentionPolicy>,
): Promise<RetentionPolicy> {
  const saved = await parseOrThrow<RetentionPolicy>(
    await fetch("/api/admin/retention/policy", jsonInit("PUT", policy)),
  );
  await refreshAll();
  return saved;
}

export async function confirmRetentionRun(hash: string): Promise<RetentionRun> {
  const run = await parseOrThrow<RetentionRun>(
    await fetch("/api/admin/retention/run", jsonInit("POST", { hash })),
  );
  await refreshAll();
  return run;
}

export async function addRetentionHold(input: {
  studentId: number;
  reason: string;
  until?: string | null;
}): Promise<RetentionHold> {
  const hold = await parseOrThrow<RetentionHold>(
    await fetch("/api/admin/retention/holds", jsonInit("POST", input)),
  );
  await refreshAll();
  return hold;
}

export async function removeRetentionHold(studentId: number): Promise<void> {
  await parseOrThrow(
    await fetch(`/api/admin/retention/holds/${studentId}`, jsonInit("DELETE")),
  );
  await refreshAll();
}

export async function fetchErasurePlan(studentId: number): Promise<ErasurePlan> {
  return parseOrThrow<ErasurePlan>(
    await fetch(`/api/admin/privacy/students/${studentId}/erasure`),
  );
}

export async function executeErasure(studentId: number): Promise<ErasurePlan> {
  const result = await parseOrThrow<ErasurePlan>(
    await fetch(`/api/admin/privacy/students/${studentId}/erasure`, jsonInit("POST")),
  );
  await refreshAll();
  await queryClient.invalidateQueries({ queryKey: ["students"] });
  await queryClient.invalidateQueries({ queryKey: ["archive"] });
  return result;
}

export const auskunftUrl = (studentId: number, format: "html" | "download") =>
  `/api/admin/privacy/students/${studentId}/auskunft?format=${format}`;
