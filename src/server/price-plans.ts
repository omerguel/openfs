/* ------------------------------------------------------------------ */
/* Preispläne — DB access + validation.                                */
/* The HTTP wrappers live in routes.ts (pricePlanRoutes).              */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import {
  BILLABLE_EVENT_TYPES,
  type BillableEventType,
  type PriceComponent,
  type PricePlanInput,
  type PricePlanRecord,
} from "../lib/price-plan";
import { archiveRow } from "./archive";
import { ValidationError } from "./engine";

type PricePlanRow = {
  id: number;
  name: string;
  guaranteed_months: number;
  classes: string;
  components: string;
};

function parseClasses(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const toPlan = (row: PricePlanRow): PricePlanRecord => ({
  id: row.id,
  name: row.name,
  guaranteedMonths: row.guaranteed_months,
  classes: parseClasses(row.classes),
  components: JSON.parse(row.components),
});

const SELECT = `SELECT id, name, guaranteed_months, classes, components FROM price_plans`;

export function listPricePlans(db: Database): PricePlanRecord[] {
  return db.query<PricePlanRow, []>(`${SELECT} ORDER BY id`).all().map(toPlan);
}

export function getPricePlan(db: Database, id: number): PricePlanRecord {
  const row = db.query<PricePlanRow, [number]>(`${SELECT} WHERE id = ?`).get(id);
  if (!row) throw new ValidationError("Preisplan nicht gefunden.");
  return toPlan(row);
}

function normalizeComponents(db: Database, input: unknown): PriceComponent[] {
  if (!Array.isArray(input)) {
    throw new ValidationError("Feld 'components' muss eine Liste sein.");
  }
  return input.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new ValidationError("Jede Preiskomponente muss ein Objekt sein.");
    }
    const { label, durationMin, priceCents, erloesKonto, eventType } =
      entry as PriceComponent;
    if (typeof label !== "string" || !label.trim()) {
      throw new ValidationError("Jede Preiskomponente braucht eine Bezeichnung.");
    }
    if (durationMin != null && (!Number.isInteger(durationMin) || durationMin <= 0)) {
      throw new ValidationError(
        `Dauer von '${label.trim()}' muss eine positive Minutenzahl sein.`,
      );
    }
    if (priceCents !== null && (!Number.isInteger(priceCents) || priceCents < 0)) {
      throw new ValidationError(
        `Preis von '${label.trim()}' muss ein Betrag in Cent (>= 0) sein.`,
      );
    }
    if (erloesKonto != null && erloesKonto !== "") {
      const account = db
        .query<{ kind: string }, [string]>("SELECT kind FROM accounts WHERE number = ?")
        .get(String(erloesKonto));
      if (!account || (account.kind !== "erloes" && account.kind !== "durchlaufend")) {
        throw new ValidationError(
          `Konto von '${label.trim()}' muss ein Erlöskonto oder durchlaufender Posten sein.`,
        );
      }
    }
    if (
      eventType != null &&
      !BILLABLE_EVENT_TYPES.includes(eventType as BillableEventType)
    ) {
      throw new ValidationError(`Ungültiger Termin-Typ bei '${label.trim()}'.`);
    }
    return {
      label: label.trim(),
      durationMin: durationMin ?? null,
      priceCents,
      erloesKonto: erloesKonto ? String(erloesKonto) : null,
      eventType: eventType ?? null,
    };
  });
}

function normalizeClasses(input: unknown): string[] {
  if (input === null) return [];
  if (!Array.isArray(input)) {
    throw new ValidationError("Feld 'classes' muss eine Liste von Klassen sein.");
  }
  const classes: string[] = [];
  for (const entry of input) {
    if (typeof entry !== "string" || !entry.trim() || entry.trim().length > 10) {
      throw new ValidationError("Ungültige Führerscheinklasse im Preisplan.");
    }
    const klass = entry.trim();
    if (!classes.some((c) => c.toUpperCase() === klass.toUpperCase())) {
      classes.push(klass);
    }
  }
  return classes;
}

function normalize(
  db: Database,
  input: Partial<PricePlanInput>,
  current: PricePlanInput,
): PricePlanInput {
  const next: PricePlanInput = { ...current };

  if (input.name !== undefined) {
    if (typeof input.name !== "string" || !input.name.trim()) {
      throw new ValidationError("Der Name des Preisplans ist ein Pflichtfeld.");
    }
    next.name = input.name.trim();
  }

  if (input.guaranteedMonths !== undefined) {
    // Empty / null = no price guarantee.
    const raw = input.guaranteedMonths as unknown;
    const months = raw === null || raw === "" ? 0 : Number(raw);
    if (!Number.isInteger(months) || months < 0) {
      throw new ValidationError(
        "Garantierter Zeitraum muss eine Monatszahl (>= 0) sein.",
      );
    }
    next.guaranteedMonths = months;
  }

  if (input.components !== undefined) {
    next.components = normalizeComponents(db, input.components);
  }

  if (input.classes !== undefined) {
    next.classes = normalizeClasses(input.classes);
  }

  if (!next.name) {
    throw new ValidationError("Der Name des Preisplans ist ein Pflichtfeld.");
  }
  if (next.components.length === 0) {
    throw new ValidationError("Ein Preisplan braucht mindestens eine Preiskomponente.");
  }

  return next;
}

const EMPTY: PricePlanInput = {
  name: "",
  guaranteedMonths: 0,
  classes: [],
  components: [],
};

export function createPricePlan(
  db: Database,
  input: Partial<PricePlanInput>,
): PricePlanRecord {
  const data = normalize(db, input, EMPTY);
  const row = db
    .query<{ id: number }, [string, number, string, string]>(
      `INSERT INTO price_plans (name, guaranteed_months, classes, components)
       VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .get(
      data.name,
      data.guaranteedMonths,
      JSON.stringify(data.classes ?? []),
      JSON.stringify(data.components),
    )!;
  return getPricePlan(db, row.id);
}

export function updatePricePlan(
  db: Database,
  id: number,
  input: Partial<PricePlanInput>,
): PricePlanRecord {
  const current = getPricePlan(db, id);
  const data = normalize(db, input, current);
  db.prepare(
    `UPDATE price_plans SET name = ?, guaranteed_months = ?, classes = ?, components = ?
     WHERE id = ?`,
  ).run(
    data.name,
    data.guaranteedMonths,
    JSON.stringify(data.classes ?? []),
    JSON.stringify(data.components),
    id,
  );
  return getPricePlan(db, id);
}

export function deletePricePlan(db: Database, id: number) {
  const plan = getPricePlan(db, id); // 404 → ValidationError
  const remove = db.transaction(() => {
    // Remember who was on the plan so a restore can re-link them.
    const students = db
      .query<{ id: number }, [number]>("SELECT id FROM students WHERE price_plan_id = ?")
      .all(id)
      .map((row) => row.id);
    archiveRow(db, "price_plan", id, plan.name, { students });
    // Students fall back to the default plan instead of dangling.
    db.prepare("UPDATE students SET price_plan_id = NULL WHERE price_plan_id = ?").run(
      id,
    );
    db.prepare("DELETE FROM price_plans WHERE id = ?").run(id);
  });
  remove();
}
