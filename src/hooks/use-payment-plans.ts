/* ------------------------------------------------------------------ */
/* Ratenpläne + SEPA-Lastschrift — client fetch layer. Every mutation  */
/* also invalidates the invoice queries: collected money changes the   */
/* invoices' open amounts.                                             */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";

import { invalidateInvoices } from "@/hooks/use-invoices";
import { parseOrThrow } from "@/lib/api";
import type { PaymentMethod } from "@/lib/accounting-types";
import type {
  CreateInstalmentPlanInput,
  InstalmentPlan,
  SepaCandidate,
  SepaCollection,
  SepaMandate,
} from "@/lib/payment-plan-types";
import { queryClient } from "@/lib/query-client";

async function post<T>(url: string, body: unknown): Promise<T> {
  const result = await parseOrThrow<T>(
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["payment-plans"] }),
    invalidateInvoices(),
  ]);
  return result;
}

export function useInstalmentPlans(studentId?: number) {
  return useQuery({
    queryKey: ["payment-plans", "instalments", studentId ?? "all"],
    queryFn: async () =>
      (
        await parseOrThrow<{ plans: InstalmentPlan[] }>(
          await fetch(
            `/api/instalment-plans${studentId ? `?studentId=${studentId}` : ""}`,
          ),
        )
      ).plans,
  });
}

export function useMandates(studentId?: number) {
  return useQuery({
    queryKey: ["payment-plans", "mandates", studentId ?? "all"],
    queryFn: async () =>
      (
        await parseOrThrow<{ mandates: SepaMandate[] }>(
          await fetch(`/api/sepa/mandates${studentId ? `?studentId=${studentId}` : ""}`),
        )
      ).mandates,
  });
}

export function useSepaCandidates(collectionDate: string) {
  return useQuery({
    queryKey: ["payment-plans", "candidates", collectionDate],
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(collectionDate),
    queryFn: async () =>
      (
        await parseOrThrow<{ candidates: SepaCandidate[] }>(
          await fetch(`/api/sepa/candidates?collectionDate=${collectionDate}`),
        )
      ).candidates,
  });
}

export function useSepaCollections() {
  return useQuery({
    queryKey: ["payment-plans", "collections"],
    queryFn: async () =>
      (
        await parseOrThrow<{ collections: SepaCollection[] }>(
          await fetch("/api/sepa/collections"),
        )
      ).collections,
  });
}

export const createInstalmentPlan = (input: CreateInstalmentPlanInput) =>
  post<InstalmentPlan>("/api/instalment-plans", input);

export const cancelInstalmentPlan = (id: number, date: string) =>
  post<InstalmentPlan>(`/api/instalment-plans/${id}/cancel`, { date });

export const payInstalment = (
  id: number,
  input: { date: string; geldkonto: string; paymentMethod: PaymentMethod },
) => post(`/api/instalments/${id}/pay`, input);

export const createMandate = (input: {
  studentId: number;
  accountHolder: string;
  iban: string;
  bic: string;
  signedOn: string;
  mandateRef?: string;
}) => post<SepaMandate>("/api/sepa/mandates", input);

export const revokeMandate = (id: number, date: string) =>
  post<SepaMandate>(`/api/sepa/mandates/${id}/revoke`, { date });

export const createCollection = (input: {
  collectionDate: string;
  items: { sourceType: "invoice" | "instalment"; sourceId: number }[];
}) => post<SepaCollection>("/api/sepa/collections", input);

export const bookCollection = (id: number, date: string) =>
  post<SepaCollection>(`/api/sepa/collections/${id}/book`, { date });

export const returnSepaItem = (id: number, input: { date: string; reason: string }) =>
  post(`/api/sepa/items/${id}/return`, input);

/** Trigger the browser download of a Sammler's pain.008 file. */
export function downloadCollectionXml(id: number) {
  const link = document.createElement("a");
  link.href = `/api/sepa/collections/${id}/xml`;
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
}
