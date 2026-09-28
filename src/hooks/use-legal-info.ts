import { useQuery } from "@tanstack/react-query";

import { parseOrThrow } from "@/lib/api";
import type { LegalInfo } from "@/lib/legal";

/** Public, unauthenticated endpoint — see src/server/legal.ts. */
export async function fetchLegalInfo(): Promise<LegalInfo> {
  return parseOrThrow<LegalInfo>(await fetch("/api/public/legal"));
}

export function useLegalInfo() {
  return useQuery({ queryKey: ["public-legal"], queryFn: fetchLegalInfo });
}
