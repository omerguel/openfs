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
};

export type ReviewInput = Omit<Review, "id">;

type ReviewRow = Review;

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
  "SELECT id, author, rating, source, text, reply, status, date FROM reviews";

export function listReviews(db: Database): Review[] {
  return db.query<ReviewRow, []>(`${SELECT} ORDER BY date DESC, id DESC`).all();
}

export function getReview(db: Database, id: number): Review {
  const row = db.query<ReviewRow, [number]>(`${SELECT} WHERE id = ?`).get(id);
  if (!row) throw new ValidationError("Bewertung nicht gefunden.");
  return row;
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
/* HTTP layer — same shape as the factories in routes.ts. Local        */
/* json/handle helpers because routes.ts must stay untouched.          */
/* ------------------------------------------------------------------ */

export function reviewRoutes(db: Database) {
  ensureReviewTables(db);

  return {
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
