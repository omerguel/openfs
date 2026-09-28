/* ------------------------------------------------------------------ */
/* Schulprofil (public profile) — /api/school-profile.                 */
/* Type-only import from the server module keeps server code out of    */
/* the bundle. Edited on "Fahrschule & Einstellungen" (/fahrschule);    */
/* read publicly by /anfrage.                                          */
/* ------------------------------------------------------------------ */

import { queryOptions, useQuery } from "@tanstack/react-query";

import { parseOrThrow } from "@/lib/api";
import type {
  OpeningHoursEntry,
  SchoolProfile,
  VehicleBrands,
} from "@/server/school-profile";

export type { OpeningHoursEntry, SchoolProfile, VehicleBrands };

export const WEEK_DAYS = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

/** Client-side blank while loading — the server answers with the real one. */
export const EMPTY_SCHOOL_PROFILE: SchoolProfile = {
  description: "",
  slogan: "",
  founded_year: null,
  website: "",
  instagram: "",
  facebook: "",
  google_maps_url: "",
  google_place_id: "",
  opening_hours: WEEK_DAYS.map((day) => ({ day, hours: "" })),
  services: [],
  highlights: [],
  license_classes: [],
  bkf_classes: [],
  features: [],
  languages: [],
  certificates: [],
  vehicle_brands: { A: [], B: [], C: [], D: [] },
  payment_methods: [],
  theory_hours: WEEK_DAYS.map((day) => ({ day, hours: "" })),
};

export async function fetchSchoolProfile(): Promise<SchoolProfile> {
  return parseOrThrow<SchoolProfile>(await fetch("/api/school-profile"));
}

export async function saveSchoolProfile(
  profile: Partial<SchoolProfile>,
): Promise<SchoolProfile> {
  return parseOrThrow<SchoolProfile>(
    await fetch("/api/school-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    }),
  );
}

export const schoolProfileQueryOptions = queryOptions({
  queryKey: ["school-profile"] as const,
  queryFn: fetchSchoolProfile,
});

export function useSchoolProfile() {
  const query = useQuery(schoolProfileQueryOptions);
  return {
    profile: query.data ?? EMPTY_SCHOOL_PROFILE,
    loading: query.isPending,
    error: query.error,
    refresh: query.refetch,
  };
}
