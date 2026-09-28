import { useQuery } from "@tanstack/react-query";

import { parseOrThrow } from "@/lib/api";
import type { PublicLegalInfo } from "@/lib/legal";

/** Public, unauthenticated endpoint — see src/server/legal.ts. */
export async function fetchLegalInfo(): Promise<PublicLegalInfo> {
  return parseOrThrow<PublicLegalInfo>(await fetch("/api/public/legal"));
}

export function useLegalInfo() {
  return useQuery({ queryKey: ["public-legal"], queryFn: fetchLegalInfo });
}
