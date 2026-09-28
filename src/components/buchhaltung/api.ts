/* ------------------------------------------------------------------ */
/* Buchhaltung fetch layer — typed helpers + a small data hook.        */
/* ------------------------------------------------------------------ */

import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";

import type {
  Cashbook,
  GeldkontoBalance,
  VatReport,
} from "@/lib/accounting-report-types";
import type {
  Account,
  CreateTransactionInput,
  JournalRow,
  LedgerResponse,
  QuittungData,
} from "@/lib/accounting-types";

export class ApiError extends Error {}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body.error === "string" ? body.error : "Anfrage fehlgeschlagen.";
    throw new ApiError(message);
  }
  if (body == null) {
    throw new ApiError("Ungültige Antwort vom Server.");
  }
  return body as T;
}

function post<T>(url: string, payload: unknown): Promise<T> {
  return request<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/* ------------------------------ params ----------------------------- */

/** Local-date ISO (no toISOString — that shifts across timezones). */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "2026-06-08" → "08.06.2026" */
export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export type StatusFilter = "all" | "active" | "storniert";

export function buildFilterQuery(
  range: DateRange | undefined,
  search: string,
  status: StatusFilter,
): string {
  const params = new URLSearchParams();
  if (range?.from) params.set("from", toIsoDate(range.from));
  if (range?.to) params.set("to", toIsoDate(range.to));
  else if (range?.from) params.set("to", toIsoDate(range.from));
  if (search.trim()) params.set("q", search.trim());
  if (status !== "all") params.set("status", status);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/* ------------------------------ calls ------------------------------ */

export type StudentBalance = {
  customerNo: string;
  name: string;
  balanceCents: number;
};

export const accountingApi = {
  ledger: (query: string) =>
    request<LedgerResponse>(`/api/accounting/transactions${query}`),
  journal: (query: string) =>
    request<{ rows: JournalRow[] }>(`/api/accounting/journal${query}`),
  accounts: () => request<{ accounts: Account[] }>("/api/accounting/accounts"),
  studentBalances: () => request<{ balances: StudentBalance[] }>("/api/student-balances"),
  setAccountActive: (number: string, active: boolean) =>
    request<{ ok: true }>(`/api/accounting/accounts/${number}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    }),
  createTransaction: (input: CreateTransactionInput) =>
    post<{ id: number; belegNr: string | null }>("/api/accounting/transactions", input),
  storno: (id: number, reason: string, date: string) =>
    post<{ id: number }>(`/api/accounting/transactions/${id}/storno`, {
      reason,
      date,
    }),
  quittung: (id: number) => request<QuittungData>(`/api/accounting/quittung/${id}`),
  balances: () =>
    request<{ balances: GeldkontoBalance[] }>("/api/accounting/balances").then(
      (body) => body.balances,
    ),
  cashbook: (account: string, query: string) =>
    request<Cashbook>(`/api/accounting/cashbook/${account}${query}`),
  vatReport: (year: number, period: "month" | "quarter") =>
    request<VatReport>(`/api/accounting/vat-report?year=${year}&period=${period}`),
};

/** Download a server-generated file (CSV, PDF) under its own file name. */
export async function downloadFile(url: string, fallbackName: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? "Download fehlgeschlagen.");
  }
  const filename =
    res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
    fallbackName;
  const href = URL.createObjectURL(await res.blob());
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return filename;
}

/** Past-month / future checks for a booking or document date. */
export function dateWarnings(iso: string, today = toIsoDate(new Date())): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return [];
  if (iso > today) return [`Das Datum ${formatIsoDate(iso)} liegt in der Zukunft.`];
  if (iso.slice(0, 7) < today.slice(0, 7)) {
    return [
      `Das Datum ${formatIsoDate(iso)} liegt in einem vergangenen Monat — die Umsatzsteuer-Voranmeldung für diesen Monat ist womöglich schon abgegeben.`,
    ];
  }
  return [];
}

/* ------------------------------- hook ------------------------------ */

export function useApi<T>(
  load: () => Promise<T>,
  deps: unknown[],
): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Fehler beim Laden.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}
