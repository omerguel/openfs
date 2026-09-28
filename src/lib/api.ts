/* ------------------------------------------------------------------ */
/* Shared client fetch helpers for the list hooks in src/hooks/.       */
/* (The Buchhaltung pages keep their own layer in                       */
/* src/components/buchhaltung/api.ts — different error semantics.)      */
/* ------------------------------------------------------------------ */

import { useEffect } from "react";
import { useQuery, type QueryKey } from "@tanstack/react-query";

const EMPTY_LIST: never[] = [];

/** Error carrying the HTTP status, so callers (and the query client's
 *  retry policy) can tell "signed out" (401/403) from a real failure. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function parseOrThrow<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || !data) {
    throw new HttpError(data?.error ?? "Anfrage fehlgeschlagen.", response.status);
  }
  return data;
}

/** Cached list state shared by the DB-backed list hooks. TanStack Query
 *  deduplicates StrictMode mounts and shares results between components. */
export function useFetchList<T>(
  queryKey: QueryKey,
  fetcher: () => Promise<T[]>,
  errorLabel: string,
) {
  const query = useQuery({ queryKey, queryFn: fetcher });

  useEffect(() => {
    if (query.error) console.error(`${errorLabel}:`, query.error);
  }, [errorLabel, query.error]);

  return {
    items: query.data ?? (EMPTY_LIST as T[]),
    loading: query.isPending,
    refresh: query.refetch,
  };
}
