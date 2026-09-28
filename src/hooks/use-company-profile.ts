import { queryOptions, useQuery } from "@tanstack/react-query";

import type { CompanyProfile } from "@/lib/accounting-types";
import { parseOrThrow } from "@/lib/api";

export async function fetchCompanyProfile(): Promise<CompanyProfile> {
  return parseOrThrow<CompanyProfile>(await fetch("/api/profile"));
}

export const companyProfileQueryOptions = queryOptions({
  queryKey: ["company-profile"] as const,
  queryFn: fetchCompanyProfile,
});

export function useCompanyProfile() {
  const query = useQuery(companyProfileQueryOptions);
  return {
    profile: query.data ?? null,
    loading: query.isPending,
    error: query.error,
    refresh: query.refetch,
  };
}

export async function saveCompanyProfile(
  profile: Partial<CompanyProfile>,
): Promise<CompanyProfile> {
  return parseOrThrow<CompanyProfile>(
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    }),
  );
}
