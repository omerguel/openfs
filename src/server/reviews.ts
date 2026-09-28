/* ------------------------------------------------------------------ */
/* Bewertungen (reviews) — DB access + validation + HTTP wrappers.     */
/* Self-contained: the table is not part of db.ts, so reviewRoutes()   */
/* calls ensureReviewTables() itself. Mount via `...reviewRoutes(db)`  */
/* in the Bun.serve() routes object in src/index.ts.                   */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import { ValidationError } from "./engine";
import { handle, json } from "./http";
import { demoDataEnabled } from "./db";
import { getSchoolProfile } from "./school-profile";

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
  /** Provider id of an imported review (Google: `places/…/reviews/…`);
   *  null for reviews entered by hand. */
  externalId: string | null;
};

export type ReviewInput = Omit<Review, "id" | "externalId">;

type ReviewRow = Omit<Review, "externalId"> & { external_id: string | null };

const toReview = ({ external_id, ...row }: ReviewRow): Review => ({
  ...row,
  externalId: external_id,
});

const DDL = `
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  source TEXT NOT NULL CHECK (source IN ('Google','Facebook','Webseite','Intern')),
  text TEXT NOT NULL DEFAULT '',
  reply TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'neu' CHECK (status IN ('neu','beantwortet','ausgeblendet')),
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/* Demo reviews — imported once into an empty table; afterwards the DB is
   the source of truth (/api/reviews). */
type ReviewSeed = Omit<ReviewInput, "reply" | "status"> &
  Partial<Pick<ReviewInput, "reply" | "status">>;

const REVIEW_SEED: ReviewSeed[] = [
  {
    author: "Lena Braun",
    rating: 5,
    source: "Google",
    text: "Super Fahrschule! Köksal ist ein geduldiger Fahrlehrer und hat mir vor der Prüfung die Nervosität genommen. Beim ersten Versuch bestanden.",
    reply: "Vielen Dank, Lena! Wir wünschen dir allzeit gute Fahrt.",
    status: "beantwortet",
    date: "2026-05-28",
  },
  {
    author: "Jonas Meyer",
    rating: 5,
    source: "Google",
    text: "Sehr flexible Terminvergabe und moderne Autos. Die Theoriestunden waren verständlich aufgebaut. Klare Empfehlung!",
    date: "2026-05-21",
  },
  {
    author: "Aylin Demir",
    rating: 4,
    source: "Facebook",
    text: "Tolle Betreuung von der Anmeldung bis zur praktischen Prüfung. Ein Stern Abzug, weil die Wartezeit auf Fahrstunden im Sommer etwas lang war.",
    date: "2026-05-14",
  },
  {
    author: "Tom Richter",
    rating: 5,
    source: "Webseite",
    text: "Faire Preise und transparente Abrechnung. Nadine erklärt ruhig und auf den Punkt — so macht Fahren lernen Spaß.",
    reply: "Danke für das Lob, Tom! Das geben wir gerne an Nadine weiter.",
    status: "beantwortet",
    date: "2026-05-05",
  },
  {
    author: "Mara Köhler",
    rating: 5,
    source: "Google",
    text: "Die Autobahnfahrten haben mir am Anfang Angst gemacht, aber das Team hat mich super vorbereitet. Danke an die ganze Fahrschule Demo!",
    date: "2026-04-27",
  },
  {
    author: "Zahra Rezaie",
    rating: 4,
    source: "Webseite",
    text: "Sehr freundliches Team und gute Erklärungen auch auf Englisch. Die Online-Theorie-App war hilfreich für die Prüfungsvorbereitung.",
    date: "2026-04-18",
  },
  {
    author: "Felix Wagner",
    rating: 3,
    source: "Google",
    text: "Unterricht war in Ordnung, allerdings musste ich zwei Fahrstunden kurzfristig verschieben lassen. Kommunikation könnte besser sein.",
    date: "2026-04-09",
  },
  {
    author: "Sofia Lindqvist",
    rating: 5,
    source: "Facebook",
    text: "B197 in vier Monaten geschafft! Emre fährt sehr strukturiert mit einem und gibt ehrliches Feedback. Jederzeit wieder.",
    date: "2026-03-30",
  },
  {
    author: "Deniz Aydin",
    rating: 2,
    source: "Intern",
    text: "Feedbackbogen nach der Theorieprüfung: Der Raum war zu voll und es gab zu wenige Übungsbögen. Inhaltlich aber gut.",
    date: "2026-03-19",
  },
  {
    author: "Hannah Schmitt",
    rating: 5,
    source: "Google",
    text: "Vom Sehtest bis zur praktischen Prüfung alles aus einer Hand. Besonders die Erste-Hilfe-Organisation hat mir viel Rennerei erspart.",
    date: "2026-03-08",
  },
];

/** Creates the reviews table and seeds demo data — only when empty. */
export function ensureReviewTables(db: Database) {
  db.exec(DDL);
  // Imported reviews (Google) carry the provider's id for de-duplication.
  const cols = db
    .query<{ name: string }, []>("PRAGMA table_info(reviews)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("external_id")) {
    db.exec("ALTER TABLE reviews ADD COLUMN external_id TEXT");
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_external ON reviews(external_id) WHERE external_id IS NOT NULL",
  );
  // settings is part of db.ts; repeated so bare test schemas work too.
  db.exec(
    "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );

  const count = db.query<{ n: number }, []>("SELECT count(*) AS n FROM reviews").get()!.n;
  if (count > 0 || !demoDataEnabled(db)) return;

  const insert = db.prepare(
    `INSERT INTO reviews (author, rating, source, text, reply, status, date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const review of REVIEW_SEED) {
    insert.run(
      review.author,
      review.rating,
      review.source,
      review.text,
      review.reply ?? "",
      review.status ?? "neu",
      review.date,
    );
  }
}

const SELECT =
  "SELECT id, author, rating, source, text, reply, status, date, external_id FROM reviews";

export function listReviews(db: Database): Review[] {
  return db
    .query<ReviewRow, []>(`${SELECT} ORDER BY date DESC, id DESC`)
    .all()
    .map(toReview);
}

export function getReview(db: Database, id: number): Review {
  const row = db.query<ReviewRow, [number]>(`${SELECT} WHERE id = ?`).get(id);
  if (!row) throw new ValidationError("Bewertung nicht gefunden.");
  return toReview(row);
}

function normalizeRating(value: unknown, current: number): number {
  if (value === undefined) return current;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ValidationError("Bewertung muss eine ganze Zahl zwischen 1 und 5 sein.");
  }
  return value;
}

function normalizeSource(value: unknown, current: ReviewSource): ReviewSource {
  if (value === undefined) return current;
  if (!REVIEW_SOURCES.includes(value as ReviewSource)) {
    throw new ValidationError(
      "Quelle muss 'Google', 'Facebook', 'Webseite' oder 'Intern' sein.",
    );
  }
  return value as ReviewSource;
}

function normalizeStatus(value: unknown, current: ReviewStatus): ReviewStatus {
  if (value === undefined) return current;
  if (!REVIEW_STATUSES.includes(value as ReviewStatus)) {
    throw new ValidationError(
      "Status muss 'neu', 'beantwortet' oder 'ausgeblendet' sein.",
    );
  }
  return value as ReviewStatus;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value: unknown, current: string): string {
  if (value === undefined) return current;
  if (typeof value !== "string" || !ISO_DATE.test(value.trim())) {
    throw new ValidationError("Datum muss im Format JJJJ-MM-TT vorliegen.");
  }
  return value.trim();
}

/* Merge partial payload over current values, trimming strings and applying
   minimal validation rules. */
type ReviewTextKey = "author" | "text" | "reply";
function normalize(input: Partial<ReviewInput>, current: Review): Review {
  const str = (key: ReviewTextKey): string => {
    const value = input[key];
    if (value === undefined) return current[key];
    if (typeof value !== "string") {
      throw new ValidationError(`Feld '${key}' muss ein Text sein.`);
    }
    return value.trim();
  };

  const next: Review = {
    id: current.id,
    externalId: current.externalId,
    author: str("author"),
    rating: normalizeRating(input.rating, current.rating),
    source: normalizeSource(input.source, current.source),
    text: str("text"),
    reply: str("reply"),
    status: normalizeStatus(input.status, current.status),
    date: normalizeDate(input.date, current.date),
  };

  if (!next.author) {
    throw new ValidationError("Name ist ein Pflichtfeld.");
  }
  if (next.rating < 1 || next.rating > 5) {
    throw new ValidationError("Bewertung muss eine ganze Zahl zwischen 1 und 5 sein.");
  }

  return next;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/* `rating: 0` fails the final 1–5 check, so creating without a rating
   throws — rating is effectively a Pflichtfeld on create. */
const EMPTY = (): Omit<Review, "id"> => ({
  externalId: null,
  author: "",
  rating: 0,
  source: "Intern",
  text: "",
  reply: "",
  status: "neu",
  date: todayIso(),
});

export function createReview(db: Database, input: Partial<ReviewInput>): Review {
  const data = normalize(input, { ...EMPTY(), id: 0 });
  const row = db
    .query<{ id: number }, [string, number, string, string, string, string, string]>(
      `INSERT INTO reviews (author, rating, source, text, reply, status, date)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      data.author,
      data.rating,
      data.source,
      data.text,
      data.reply,
      data.status,
      data.date,
    )!;
  return getReview(db, row.id);
}

export function updateReview(
  db: Database,
  id: number,
  input: Partial<ReviewInput>,
): Review {
  const current = getReview(db, id);
  const data = normalize(input, current);
  db.prepare(
    `UPDATE reviews
     SET author = ?, rating = ?, source = ?, text = ?, reply = ?, status = ?, date = ?
     WHERE id = ?`,
  ).run(
    data.author,
    data.rating,
    data.source,
    data.text,
    data.reply,
    data.status,
    data.date,
    id,
  );
  return getReview(db, id);
}

export function deleteReview(db: Database, id: number): void {
  getReview(db, id); // throws when missing
  db.prepare("DELETE FROM reviews WHERE id = ?").run(id);
}

/* ------------------------------------------------------------------ */
/* Google-Bewertungen — Places API (New), API key only.                */
/*                                                                     */
/* GET places/{placeId} with the field mask rating,userRatingCount,    */
/* reviews returns the overall rating and at most five reviews         */
/* (Google's choice, "most relevant"). They are upserted by their      */
/* `name` (external_id): text/rating refresh, reply + status stay.     */
/* Replying on Google needs the Business Profile API (OAuth + Google's */
/* approval of the project) — replies therefore stay internal.         */
/* ------------------------------------------------------------------ */

export const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places/";
export const PLACES_FIELD_MASK = "rating,userRatingCount,reviews";

export type GoogleReviewSummary = {
  /** GOOGLE_PLACES_API_KEY is set. */
  configured: boolean;
  placeId: string;
  rating: number | null;
  userRatingCount: number | null;
  /** ISO timestamp of the last successful import. */
  importedAt: string | null;
};

export type GoogleImportResult = GoogleReviewSummary & {
  imported: number;
  updated: number;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type PlacesReview = {
  name?: string;
  rating?: number;
  text?: { text?: string };
  originalText?: { text?: string };
  authorAttribution?: { displayName?: string };
  publishTime?: string;
};

type PlacesResponse = {
  rating?: number;
  userRatingCount?: number;
  reviews?: PlacesReview[];
  error?: { message?: string; status?: string };
};

const GOOGLE_SETTINGS_KEY = "google_reviews";

type StoredGoogleSummary = Pick<
  GoogleReviewSummary,
  "rating" | "userRatingCount" | "importedAt"
> & { placeId: string };

function readGoogleSummary(db: Database): StoredGoogleSummary | null {
  const row = db
    .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
    .get(GOOGLE_SETTINGS_KEY);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as StoredGoogleSummary;
  } catch {
    return null;
  }
}

function currentPlaceId(db: Database): string {
  try {
    return getSchoolProfile(db).google_place_id;
  } catch {
    return "";
  }
}

export function getGoogleReviewSummary(
  db: Database,
  apiKey: string | undefined,
): GoogleReviewSummary {
  const placeId = currentPlaceId(db);
  const stored = readGoogleSummary(db);
  // A summary of a different place (Place ID changed) is stale.
  const own = stored && stored.placeId === placeId ? stored : null;
  return {
    configured: Boolean(apiKey),
    placeId,
    rating: own?.rating ?? null,
    userRatingCount: own?.userRatingCount ?? null,
    importedAt: own?.importedAt ?? null,
  };
}

function placesError(status: number, body: PlacesResponse | null): string {
  const detail = body?.error?.message ? ` (${body.error.message})` : "";
  if (status === 400) return `Google lehnt die Anfrage ab — Place ID prüfen${detail}.`;
  if (status === 403 || status === 401) {
    return `Google verweigert den Zugriff — API-Schlüssel und freigeschaltete Places API (New) prüfen${detail}.`;
  }
  if (status === 404) return `Place ID wurde bei Google nicht gefunden${detail}.`;
  if (status === 429)
    return "Google-Kontingent erschöpft — bitte später erneut versuchen.";
  return `Google-Abruf fehlgeschlagen (HTTP ${status})${detail}.`;
}

export async function importGoogleReviews(
  db: Database,
  options: { apiKey?: string; fetch?: FetchLike; now?: Date } = {},
): Promise<GoogleImportResult> {
  const apiKey = options.apiKey ?? "";
  if (!apiKey) {
    throw new ValidationError(
      "Kein Google-API-Schlüssel hinterlegt (Umgebungsvariable GOOGLE_PLACES_API_KEY).",
    );
  }
  const placeId = currentPlaceId(db);
  if (!placeId) {
    throw new ValidationError(
      "Bitte zuerst die Google Place ID im Schulprofil hinterlegen.",
    );
  }
  const fetchImpl = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(
      `${PLACES_ENDPOINT}${encodeURIComponent(placeId)}?languageCode=de`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": PLACES_FIELD_MASK,
        },
      },
    );
  } catch {
    throw new ValidationError(
      "Google ist nicht erreichbar — bitte später erneut versuchen.",
    );
  }
  const body = (await response.json().catch(() => null)) as PlacesResponse | null;
  if (!response.ok || !body) {
    throw new ValidationError(placesError(response.status, body));
  }

  const findExisting = db.query<{ id: number }, [string]>(
    "SELECT id FROM reviews WHERE external_id = ?",
  );
  // Reviews imported before an external id existed (or typed in by
  // hand) are matched on author + date + text instead of duplicated.
  const findManual = db.query<{ id: number }, [string, string, string]>(
    `SELECT id FROM reviews WHERE external_id IS NULL AND source = 'Google'
       AND author = ? AND date = ? AND text = ?`,
  );
  const update = db.prepare(
    "UPDATE reviews SET author = ?, rating = ?, text = ?, date = ?, external_id = ? WHERE id = ?",
  );
  const insert = db.prepare(
    `INSERT INTO reviews (author, rating, source, text, reply, status, date, external_id)
     VALUES (?, ?, 'Google', ?, '', 'neu', ?, ?)`,
  );

  const now = options.now ?? new Date();
  const run = db.transaction(() => {
    let imported = 0;
    let updated = 0;
    for (const review of body.reviews ?? []) {
      const rating = Math.round(Number(review.rating));
      if (!review.name || !Number.isInteger(rating) || rating < 1 || rating > 5) continue;
      const author = review.authorAttribution?.displayName?.trim() || "Google-Nutzer/in";
      const text = (review.originalText?.text ?? review.text?.text ?? "").trim();
      const date = /^\d{4}-\d{2}-\d{2}/.test(review.publishTime ?? "")
        ? review.publishTime!.slice(0, 10)
        : now.toISOString().slice(0, 10);
      const existing =
        findExisting.get(review.name) ?? findManual.get(author, date, text);
      if (existing) {
        update.run(author, rating, text, date, review.name, existing.id);
        updated += 1;
      } else {
        insert.run(author, rating, text, date, review.name);
        imported += 1;
      }
    }
    const summary: StoredGoogleSummary = {
      placeId,
      rating: typeof body.rating === "number" ? body.rating : null,
      userRatingCount:
        typeof body.userRatingCount === "number" ? body.userRatingCount : null,
      importedAt: now.toISOString(),
    };
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(GOOGLE_SETTINGS_KEY, JSON.stringify(summary));
    return { imported, updated };
  });
  const counts = run();
  return { ...getGoogleReviewSummary(db, apiKey), ...counts };
}

/* ------------------------------------------------------------------ */
/* HTTP layer — same shape as the factories in routes.ts. Local        */
/* json/handle helpers because routes.ts must stay untouched.          */
/* ------------------------------------------------------------------ */

export type ReviewRouteOptions = {
  /** Places API key; defaults to GOOGLE_PLACES_API_KEY. */
  googleApiKey?: string;
  /** Injected fetch for tests. */
  fetch?: FetchLike;
};

export function reviewRoutes(db: Database, options: ReviewRouteOptions = {}) {
  ensureReviewTables(db);
  const googleApiKey =
    options.googleApiKey ?? process.env.GOOGLE_PLACES_API_KEY?.trim() ?? "";

  return {
    "/api/reviews/google": {
      GET: () => handle(() => json(getGoogleReviewSummary(db, googleApiKey)))(),
    },

    "/api/reviews/import/google": {
      POST: () =>
        handle(async () =>
          json(
            await importGoogleReviews(db, {
              apiKey: googleApiKey,
              fetch: options.fetch,
            }),
          ),
        )(),
    },

    "/api/reviews": {
      GET: (req: BunRequest) => handle(() => json({ reviews: listReviews(db) }))(),
      POST: (req: BunRequest) =>
        handle(async () =>
          json(createReview(db, (await req.json()) as Partial<ReviewInput>), 201),
        )(),
    },

    "/api/reviews/:id": {
      PATCH: (req: BunRequest<"/api/reviews/:id">) =>
        handle(async () => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Bewertungs-ID.");
          }
          return json(updateReview(db, id, (await req.json()) as Partial<ReviewInput>));
        })(),
      DELETE: (req: BunRequest<"/api/reviews/:id">) =>
        handle(() => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Bewertungs-ID.");
          }
          deleteReview(db, id);
          return json({ ok: true });
        })(),
    },
  };
}
