/* ------------------------------------------------------------------ */
/* Branches (Standorte) — DB access + validation + HTTP wrappers.      */
/*                                                                     */
/* Self-contained: ensureBranchTables() owns the schema and seeds two   */
/* realistic branches once. branchRoutes(db) is the Bun.serve() route   */
/* factory (mounted from src/index.ts like vehicleRoutes etc.).         */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import { ValidationError } from "./engine";
import { handle, json } from "./http";
import { demoDataEnabled } from "./db";

export type BranchStatus = "offen" | "geschlossen";

export type Branch = {
  id: number;
  name: string;
  address: string;
  phone: string;
  email: string;
  openingHours: string;
  isMain: boolean;
  status: BranchStatus;
  createdAt: string;
};

export type BranchInput = Omit<Branch, "id" | "createdAt">;

type BranchRow = {
  id: number;
  name: string;
  address: string;
  phone: string;
  email: string;
  opening_hours: string;
  is_main: number;
  status: BranchStatus;
  created_at: string;
};

/* ------------------------------------------------------------------ */
/* Schema + seed                                                       */
/* ------------------------------------------------------------------ */

export function ensureBranchTables(db: Database): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS branches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  address       TEXT NOT NULL,
  phone         TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL DEFAULT '',
  opening_hours TEXT NOT NULL DEFAULT '',
  is_main       INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','geschlossen')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);`);

  const count = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM branches").get();
  if ((count && count.n > 0) || !demoDataEnabled(db)) return;

  const insert = db.prepare(
    `INSERT INTO branches (name, address, phone, email, opening_hours, is_main, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const seed = db.transaction(() => {
    insert.run(
      "Hauptstelle Innenstadt",
      "Musterstraße 12, 64283 Darmstadt",
      "+49 6151 123456",
      "info@fahrschule-demo.example",
      "Mo–Fr 14–18 Uhr, Sa 10–13 Uhr",
      1,
      "offen",
    );
    insert.run(
      "Filiale Bessungen",
      "Heidelberger Straße 87, 64285 Darmstadt",
      "+49 6151 987654",
      "bessungen@fahrschule-demo.example",
      "Di–Fr 15–18 Uhr",
      0,
      "offen",
    );
  });
  seed();
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

const toBranch = (row: BranchRow): Branch => ({
  id: row.id,
  name: row.name,
  address: row.address,
  phone: row.phone,
  email: row.email,
  openingHours: row.opening_hours,
  isMain: row.is_main === 1,
  status: row.status,
  createdAt: row.created_at,
});

const SELECT =
  "SELECT id, name, address, phone, email, opening_hours, is_main, status, created_at FROM branches";

export function listBranches(db: Database): Branch[] {
  return db
    .query<BranchRow, []>(`${SELECT} ORDER BY is_main DESC, name`)
    .all()
    .map(toBranch);
}

export function getBranch(db: Database, id: number): Branch {
  const row = db.query<BranchRow, [number]>(`${SELECT} WHERE id = ?`).get(id);
  if (!row) throw new ValidationError("Standort nicht gefunden.");
  return toBranch(row);
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function normalizeStatus(value: unknown, current: BranchStatus): BranchStatus {
  if (value === undefined) return current;
  if (value !== "offen" && value !== "geschlossen") {
    throw new ValidationError("Status muss 'offen' oder 'geschlossen' sein.");
  }
  return value;
}

function normalizeIsMain(value: unknown, current: boolean): boolean {
  if (value === undefined) return current;
  if (typeof value !== "boolean") {
    throw new ValidationError("Feld 'isMain' muss true oder false sein.");
  }
  return value;
}

type BranchTextKey = "name" | "address" | "phone" | "email" | "openingHours";

/* Merge partial payload over current values, trimming strings and applying
   minimal validation rules. */
function normalize(input: Partial<BranchInput>, current: Branch): Branch {
  const str = (key: BranchTextKey): string => {
    const value = input[key];
    if (value === undefined) return current[key];
    if (typeof value !== "string") {
      throw new ValidationError(`Feld '${key}' muss ein Text sein.`);
    }
    return value.trim();
  };

  const next: Branch = {
    id: current.id,
    name: str("name"),
    address: str("address"),
    phone: str("phone"),
    email: str("email"),
    openingHours: str("openingHours"),
    isMain: normalizeIsMain(input.isMain, current.isMain),
    status: normalizeStatus(input.status, current.status),
    createdAt: current.createdAt,
  };

  if (!next.name) {
    throw new ValidationError("Name ist ein Pflichtfeld.");
  }
  if (!next.address) {
    throw new ValidationError("Adresse ist ein Pflichtfeld.");
  }

  return next;
}

/* When a branch becomes the main one, every other branch loses the flag —
   there is exactly one Hauptstandort at a time. */
function clearOtherMains(db: Database, keepId: number): void {
  db.prepare("UPDATE branches SET is_main = 0 WHERE id != ?").run(keepId);
}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */

const EMPTY: Branch = {
  id: 0,
  name: "",
  address: "",
  phone: "",
  email: "",
  openingHours: "",
  isMain: false,
  status: "offen",
  createdAt: "",
};

export function createBranch(db: Database, input: Partial<BranchInput>): Branch {
  const data = normalize(input, EMPTY);
  const write = db.transaction(() => {
    const row = db
      .query<{ id: number }, [string, string, string, string, string, number, string]>(
        `INSERT INTO branches (name, address, phone, email, opening_hours, is_main, status)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(
        data.name,
        data.address,
        data.phone,
        data.email,
        data.openingHours,
        data.isMain ? 1 : 0,
        data.status,
      )!;
    if (data.isMain) clearOtherMains(db, row.id);
    return row.id;
  });
  return getBranch(db, write());
}

export function updateBranch(
  db: Database,
  id: number,
  input: Partial<BranchInput>,
): Branch {
  const current = getBranch(db, id);
  const data = normalize(input, current);
  const write = db.transaction(() => {
    db.prepare(
      `UPDATE branches
       SET name = ?, address = ?, phone = ?, email = ?, opening_hours = ?, is_main = ?, status = ?
       WHERE id = ?`,
    ).run(
      data.name,
      data.address,
      data.phone,
      data.email,
      data.openingHours,
      data.isMain ? 1 : 0,
      data.status,
      id,
    );
    if (data.isMain) clearOtherMains(db, id);
  });
  write();
  return getBranch(db, id);
}

export function deleteBranch(db: Database, id: number): void {
  const branch = getBranch(db, id);
  const count = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM branches").get();
  if (!count || count.n <= 1) {
    throw new ValidationError("Der letzte Standort kann nicht gelöscht werden.");
  }
  const remove = db.transaction(() => {
    db.prepare("DELETE FROM branches WHERE id = ?").run(id);
    // Keep the Hauptstandort invariant: if the main branch goes away,
    // the oldest remaining branch takes over.
    if (branch.isMain) {
      db.prepare(
        `UPDATE branches SET is_main = 1
         WHERE id = (SELECT id FROM branches ORDER BY created_at, id LIMIT 1)`,
      ).run();
    }
  });
  remove();
}

/* ------------------------------------------------------------------ */
/* HTTP layer — same thin-wrapper shape as routes.ts factories.        */
/* ------------------------------------------------------------------ */

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) {
    throw new ValidationError("Ungültige Standort-ID.");
  }
  return id;
}

export function branchRoutes(db: Database) {
  ensureBranchTables(db);

  return {
    "/api/branches": {
      GET: (req: BunRequest) => handle(() => json({ branches: listBranches(db) }))(),
      POST: (req: BunRequest) =>
        handle(async () =>
          json(createBranch(db, (await req.json()) as Partial<BranchInput>), 201),
        )(),
    },

    "/api/branches/:id": {
      PATCH: (req: BunRequest<"/api/branches/:id">) =>
        handle(async () =>
          json(
            updateBranch(
              db,
              parseId(req.params.id),
              (await req.json()) as Partial<BranchInput>,
            ),
          ),
        )(),
      DELETE: (req: BunRequest<"/api/branches/:id">) =>
        handle(() => {
          deleteBranch(db, parseId(req.params.id));
          return json({ ok: true });
        })(),
    },
  };
}
