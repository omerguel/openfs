/* ------------------------------------------------------------------ */
/* Rechnungen / Offene Posten / Mahnungen — client fetch layer.        */
/* Mutations invalidate the whole "invoices" key family so the page,   */
/* the student Zahlung tab and the open-items view stay in sync.       */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";

import { parseOrThrow } from "@/lib/api";
import type {
  CreateInvoiceInput,
  Invoice,
  InvoiceReminder,
  InvoicingSettings,
  OpenItems,
  UninvoicedCharge,
} from "@/lib/invoice-types";
import { queryClient } from "@/lib/query-client";

async function post<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  return parseOrThrow<T>(
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

export function invalidateInvoices() {
  return queryClient.invalidateQueries({ queryKey: ["invoices"] });
}

export async function fetchInvoices(studentId?: number): Promise<Invoice[]> {
  const query = studentId ? `?studentId=${studentId}` : "";
  const data = await parseOrThrow<{ invoices: Invoice[] }>(
    await fetch(`/api/invoices${query}`),
  );
  return data.invoices;
}

export function useInvoices(studentId?: number) {
  return useQuery({
    queryKey: ["invoices", "list", studentId ?? "all"],
    queryFn: () => fetchInvoices(studentId),
  });
}

export function useUninvoicedCharges(studentId: number | null) {
  return useQuery({
    queryKey: ["invoices", "uninvoiced", studentId],
    enabled: studentId != null,
    queryFn: async () =>
      (
        await parseOrThrow<{ charges: UninvoicedCharge[] }>(
          await fetch(`/api/invoices/uninvoiced?studentId=${studentId}`),
        )
      ).charges,
  });
}

export function useOpenItems() {
  return useQuery({
    queryKey: ["invoices", "open-items"],
    queryFn: async () => parseOrThrow<OpenItems>(await fetch("/api/open-items")),
  });
}

export function useInvoicingSettings() {
  return useQuery({
    queryKey: ["invoices", "settings"],
    queryFn: async () =>
      parseOrThrow<InvoicingSettings>(await fetch("/api/settings/invoicing")),
  });
}

export async function createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
  const invoice = await post<Invoice>("/api/invoices", input);
  await invalidateInvoices();
  return invoice;
}

export async function stornoInvoice(
  id: number,
  input: { reason: string; date: string; stornoCharges: boolean },
): Promise<{ storno: Invoice; original: Invoice }> {
  const result = await post<{ storno: Invoice; original: Invoice }>(
    `/api/invoices/${id}/storno`,
    input,
  );
  await invalidateInvoices();
  return result;
}

export async function createReminder(
  id: number,
  input: { date: string; feeCents?: number },
): Promise<InvoiceReminder> {
  const reminder = await post<InvoiceReminder>(`/api/invoices/${id}/reminders`, input);
  await invalidateInvoices();
  return reminder;
}

export async function saveInvoicingSettings(
  input: Partial<InvoicingSettings>,
): Promise<InvoicingSettings> {
  const settings = await post<InvoicingSettings>("/api/settings/invoicing", input, "PUT");
  await invalidateInvoices();
  return settings;
}
