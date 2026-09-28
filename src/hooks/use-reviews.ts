/* ------------------------------------------------------------------ */
/* Bewertungen — single client-side source of truth                    */
/*                                                                     */
/* /bewertungen reads from this hook so all review edits (Antworten,   */
/* Ausblenden, Löschen) persist and survive reloads.                   */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";

import { parseOrThrow, useFetchList } from "@/lib/api";
import type { GoogleImportResult, GoogleReviewSummary } from "@/server/reviews";

export type { GoogleImportResult, GoogleReviewSummary };

export const REVIEW_SOURCES = ["Google", "Facebook", "Webseite", "Intern"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

export const REVIEW_STATUSES = ["neu", "beantwortet", "ausgeblendet"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export type Review = {
  id: number;
  author: string;
  rating: number;
  source: ReviewSource;
  text: string;
  reply: string;
  status: ReviewStatus;
  date: string; // ISO "YYYY-MM-DD"
  /** Set for imported reviews (Google). */
  externalId: string | null;
};

export type ReviewInput = Omit<Review, "id" | "externalId">;

export async function fetchReviews(): Promise<Review[]> {
  const data = await parseOrThrow<{ reviews: Review[] }>(await fetch("/api/reviews"));
  return data.reviews;
}

export async function createReview(input: Partial<ReviewInput>): Promise<Review> {
  return parseOrThrow<Review>(
    await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function updateReview(
  id: number,
  input: Partial<ReviewInput>,
): Promise<Review> {
  return parseOrThrow<Review>(
    await fetch(`/api/reviews/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

export async function deleteReview(id: number): Promise<void> {
  await parseOrThrow<{ ok: true }>(
    await fetch(`/api/reviews/${id}`, { method: "DELETE" }),
  );
}

export function useReviews() {
  const {
    items: reviews,
    loading,
    refresh,
  } = useFetchList(["reviews"], fetchReviews, "Bewertungen konnten nicht geladen werden");
  return { reviews, loading, refresh };
}

export async function importGoogleReviews(): Promise<GoogleImportResult> {
  return parseOrThrow<GoogleImportResult>(
    await fetch("/api/reviews/import/google", { method: "POST" }),
  );
}

export function useGoogleReviewSummary() {
  const query = useQuery({
    queryKey: ["reviews-google"],
    queryFn: async () =>
      parseOrThrow<GoogleReviewSummary>(await fetch("/api/reviews/google")),
  });
  return { summary: query.data ?? null, refresh: query.refetch };
}
