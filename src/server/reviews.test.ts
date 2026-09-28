/* ------------------------------------------------------------------ */
/* Unit tests for the reviews DB module: ensure/seed, CRUD and          */
/* validation. In-memory DB per test.                                   */
/* ------------------------------------------------------------------ */

import { beforeEach, describe, expect, test } from "bun:test";
import { openSqlite, type Database } from "./sqlite";

import {
  createReview,
  deleteReview,
  ensureReviewTables,
  getGoogleReviewSummary,
  getReview,
  importGoogleReviews,
  listReviews,
  PLACES_ENDPOINT,
  PLACES_FIELD_MASK,
  updateReview,
} from "./reviews";
import { DEFAULT_SCHOOL_PROFILE, setSchoolProfile } from "./school-profile";
import { ValidationError } from "./engine";

let db: Database;

beforeEach(() => {
  db = openSqlite(":memory:");
  ensureReviewTables(db);
});

const VALID = {
  author: "Max Mustermann",
  rating: 5,
  source: "Google" as const,
  text: "Sehr gute Fahrschule!",
  date: "2026-06-01",
};

describe("ensureReviewTables", () => {
  test("a fresh DB seeds 10 reviews", () => {
    expect(listReviews(db)).toHaveLength(10);
  });

  test("calling it again does not re-seed", () => {
    ensureReviewTables(db);
    expect(listReviews(db)).toHaveLength(10);
  });

  test("does not seed when the table already has rows", () => {
    const fresh = openSqlite(":memory:");
    ensureReviewTables(fresh);
    fresh.exec("DELETE FROM reviews");
    createReview(fresh, VALID);
    ensureReviewTables(fresh);
    expect(listReviews(fresh)).toHaveLength(1);
  });

  test("seeded reviews carry valid ratings, sources and statuses", () => {
    for (const review of listReviews(db)) {
      expect(review.rating).toBeGreaterThanOrEqual(1);
      expect(review.rating).toBeLessThanOrEqual(5);
      expect(["Google", "Facebook", "Webseite", "Intern"]).toContain(review.source);
      expect(["neu", "beantwortet", "ausgeblendet"]).toContain(review.status);
    }
  });
});

describe("listReviews", () => {
  test("orders newest first (date DESC)", () => {
    const reviews = listReviews(db);
    for (let i = 1; i < reviews.length; i++) {
      expect(reviews[i - 1]!.date >= reviews[i]!.date).toBe(true);
    }
  });
});

describe("createReview", () => {
  test("happy path returns the stored review with defaults", () => {
    const review = createReview(db, VALID);
    expect(review.id).toBeGreaterThan(0);
    expect(review.author).toBe("Max Mustermann");
    expect(review.rating).toBe(5);
    expect(review.source).toBe("Google");
    expect(review.reply).toBe(""); // default
    expect(review.status).toBe("neu"); // default
  });

  test("trims string fields", () => {
    const review = createReview(db, { ...VALID, author: "  Anna Beispiel  " });
    expect(review.author).toBe("Anna Beispiel");
  });

  test("defaults the date to today when omitted", () => {
    const review = createReview(db, { ...VALID, date: undefined });
    expect(review.date).toBe(new Date().toISOString().slice(0, 10));
  });

  test("empty author → ValidationError 'Name ist ein Pflichtfeld.'", () => {
    expect(() => createReview(db, { ...VALID, author: "   " })).toThrow(
      "Name ist ein Pflichtfeld.",
    );
  });

  test("missing rating → ValidationError", () => {
    expect(() => createReview(db, { ...VALID, rating: undefined })).toThrow(
      ValidationError,
    );
  });

  test.each([0, 6, 4.5])("rating %p → ValidationError", (rating) => {
    expect(() => createReview(db, { ...VALID, rating })).toThrow(
      "Bewertung muss eine ganze Zahl zwischen 1 und 5 sein.",
    );
  });

  test("non-numeric rating → ValidationError", () => {
    expect(() => createReview(db, { ...VALID, rating: "5" as never })).toThrow(
      ValidationError,
    );
  });

  test("invalid source → ValidationError", () => {
    expect(() => createReview(db, { ...VALID, source: "Yelp" as never })).toThrow(
      "Quelle muss 'Google', 'Facebook', 'Webseite' oder 'Intern' sein.",
    );
  });

  test("invalid status → ValidationError", () => {
    expect(() => createReview(db, { ...VALID, status: "offen" as never })).toThrow(
      "Status muss 'neu', 'beantwortet' oder 'ausgeblendet' sein.",
    );
  });

  test("malformed date → ValidationError", () => {
    expect(() => createReview(db, { ...VALID, date: "01.06.2026" })).toThrow(
      "Datum muss im Format JJJJ-MM-TT vorliegen.",
    );
  });

  test("non-string text → ValidationError", () => {
    expect(() => createReview(db, { ...VALID, text: 42 as never })).toThrow(
      "Feld 'text' muss ein Text sein.",
    );
  });
});

describe("getReview", () => {
  test("missing id → ValidationError 'Bewertung nicht gefunden.'", () => {
    expect(() => getReview(db, 999999)).toThrow("Bewertung nicht gefunden.");
  });
});

describe("updateReview", () => {
  test("reply + status change merges over current values", () => {
    const created = createReview(db, VALID);
    const updated = updateReview(db, created.id, {
      reply: "Vielen Dank für das Feedback!",
      status: "beantwortet",
    });
    expect(updated.reply).toBe("Vielen Dank für das Feedback!");
    expect(updated.status).toBe("beantwortet");
    expect(updated.author).toBe("Max Mustermann"); // unchanged field preserved
    expect(updated.rating).toBe(5);
  });

  test("can hide and unhide via status", () => {
    const created = createReview(db, VALID);
    expect(updateReview(db, created.id, { status: "ausgeblendet" }).status).toBe(
      "ausgeblendet",
    );
    expect(updateReview(db, created.id, { status: "neu" }).status).toBe("neu");
  });

  test("invalid update is rejected and leaves the row unchanged", () => {
    const created = createReview(db, VALID);
    expect(() => updateReview(db, created.id, { rating: 99 })).toThrow(ValidationError);
    expect(getReview(db, created.id).rating).toBe(5);
  });

  test("update on missing id → ValidationError", () => {
    expect(() => updateReview(db, 999999, { status: "neu" })).toThrow(
      "Bewertung nicht gefunden.",
    );
  });
});

describe("deleteReview", () => {
  test("removes the review (hard delete)", () => {
    const created = createReview(db, VALID);
    const before = listReviews(db).length;
    deleteReview(db, created.id);
    expect(listReviews(db).length).toBe(before - 1);
    expect(() => getReview(db, created.id)).toThrow("Bewertung nicht gefunden.");
  });

  test("delete on missing id → ValidationError", () => {
    expect(() => deleteReview(db, 999999)).toThrow("Bewertung nicht gefunden.");
  });
});

/* ------------------------- Google import -------------------------- */

const PLACE_ID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

const PLACES_BODY = {
  rating: 4.6,
  userRatingCount: 128,
  reviews: [
    {
      name: `places/${PLACE_ID}/reviews/AAA`,
      rating: 5,
      text: { text: "Super Fahrschule!", languageCode: "de" },
      originalText: { text: "Super Fahrschule!", languageCode: "de" },
      authorAttribution: { displayName: "Paula Gruber" },
      publishTime: "2026-09-01T10:15:00Z",
    },
    {
      name: `places/${PLACE_ID}/reviews/BBB`,
      rating: 3,
      text: { text: "Ganz ok" },
      authorAttribution: { displayName: "Kai Ost" },
      publishTime: "2026-08-20T08:00:00.123456Z",
    },
  ],
};

function placesFetch(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Response.json(body, { status });
  };
  return { fetchImpl, calls };
}

describe("importGoogleReviews", () => {
  beforeEach(() => {
    setSchoolProfile(db, { ...DEFAULT_SCHOOL_PROFILE, google_place_id: PLACE_ID });
  });

  test("calls Places API (New) with key and field mask", async () => {
    const { fetchImpl, calls } = placesFetch(PLACES_BODY);
    await importGoogleReviews(db, { apiKey: "k", fetch: fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.startsWith(`${PLACES_ENDPOINT}${PLACE_ID}`)).toBe(true);
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe("k");
    expect(headers["X-Goog-FieldMask"]).toBe(PLACES_FIELD_MASK);
  });

  test("inserts new reviews as 'neu' and stores the overall rating", async () => {
    const before = listReviews(db).length;
    const { fetchImpl } = placesFetch(PLACES_BODY);
    const result = await importGoogleReviews(db, {
      apiKey: "k",
      fetch: fetchImpl,
      now: new Date("2026-09-28T12:00:00Z"),
    });
    expect(result).toMatchObject({
      imported: 2,
      updated: 0,
      rating: 4.6,
      userRatingCount: 128,
      importedAt: "2026-09-28T12:00:00.000Z",
    });
    const reviews = listReviews(db);
    expect(reviews).toHaveLength(before + 2);
    const paula = reviews.find((r) => r.author === "Paula Gruber")!;
    expect(paula).toMatchObject({
      source: "Google",
      rating: 5,
      status: "neu",
      date: "2026-09-01",
      externalId: `places/${PLACE_ID}/reviews/AAA`,
    });
    expect(getGoogleReviewSummary(db, "k")).toMatchObject({
      configured: true,
      rating: 4.6,
      userRatingCount: 128,
    });
  });

  test("re-import updates by external id and keeps the reply", async () => {
    const { fetchImpl } = placesFetch(PLACES_BODY);
    await importGoogleReviews(db, { apiKey: "k", fetch: fetchImpl });
    const paula = listReviews(db).find((r) => r.author === "Paula Gruber")!;
    updateReview(db, paula.id, { reply: "Danke!", status: "beantwortet" });

    const changed = structuredClone(PLACES_BODY);
    changed.reviews[0]!.rating = 4;
    changed.reviews[0]!.originalText = { text: "Gut!", languageCode: "de" };
    const second = placesFetch(changed);
    const result = await importGoogleReviews(db, {
      apiKey: "k",
      fetch: second.fetchImpl,
    });
    expect(result).toMatchObject({ imported: 0, updated: 2 });
    expect(getReview(db, paula.id)).toMatchObject({
      rating: 4,
      text: "Gut!",
      reply: "Danke!",
      status: "beantwortet",
    });
  });

  test("a hand-typed Google review with same author/date/text is adopted", async () => {
    const manual = createReview(db, {
      author: "Kai Ost",
      rating: 3,
      source: "Google",
      text: "Ganz ok",
      date: "2026-08-20",
    });
    const { fetchImpl } = placesFetch(PLACES_BODY);
    const result = await importGoogleReviews(db, { apiKey: "k", fetch: fetchImpl });
    expect(result).toMatchObject({ imported: 1, updated: 1 });
    expect(getReview(db, manual.id).externalId).toBe(`places/${PLACE_ID}/reviews/BBB`);
  });

  test("missing key, missing place id and Google errors are German errors", async () => {
    const { fetchImpl, calls } = placesFetch(PLACES_BODY);
    await expect(importGoogleReviews(db, { fetch: fetchImpl })).rejects.toThrow(
      "GOOGLE_PLACES_API_KEY",
    );
    setSchoolProfile(db, { ...DEFAULT_SCHOOL_PROFILE, google_place_id: "" });
    await expect(
      importGoogleReviews(db, { apiKey: "k", fetch: fetchImpl }),
    ).rejects.toThrow("Place ID");
    expect(calls).toHaveLength(0);

    setSchoolProfile(db, { ...DEFAULT_SCHOOL_PROFILE, google_place_id: PLACE_ID });
    const denied = placesFetch({ error: { message: "API key not valid" } }, 403);
    await expect(
      importGoogleReviews(db, { apiKey: "k", fetch: denied.fetchImpl }),
    ).rejects.toThrow(ValidationError);
    expect(getGoogleReviewSummary(db, "k").rating).toBeNull();
  });
});
