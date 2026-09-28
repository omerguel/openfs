/* ------------------------------------------------------------------ */
/* Schulprofil — client fetch/save helpers for /api/school-profile.    */
/* Type-only import from the server module keeps server code out of    */
/* the bundle (mirrors how Profil.tsx loads /api/profile).             */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useState } from "react";

import { parseOrThrow } from "@/lib/api";
import type { OpeningHoursEntry, SchoolProfile } from "@/server/school-profile";

export type { OpeningHoursEntry, SchoolProfile };

export const WEEK_DAYS = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

/** Client-side blank — the server answers with real defaults on load. */
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
};

export async function fetchSchoolProfile(): Promise<SchoolProfile> {
  return parseOrThrow<SchoolProfile>(await fetch("/api/school-profile"));
}

export async function saveSchoolProfile(profile: SchoolProfile): Promise<SchoolProfile> {
  return parseOrThrow<SchoolProfile>(
    await fetch("/api/school-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    }),
  );
}

/** Fetch-on-mount state for the Schulprofil editor. `refresh` re-loads
 *  the persisted profile (used by the "Verwerfen" button). */
export function useSchoolProfile(onError?: () => void) {
  const [profile, setProfile] = useState<SchoolProfile>(EMPTY_SCHOOL_PROFILE);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setProfile(await fetchSchoolProfile());
    } catch (error) {
      console.error("Schulprofil konnte nicht geladen werden:", error);
      onError?.();
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { profile, setProfile, loading, refresh };
}
