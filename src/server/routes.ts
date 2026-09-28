/* ------------------------------------------------------------------ */
/* HTTP layer — thin JSON wrappers around the booking engine.          */
/* Mounted into the Bun.serve() routes object in src/index.ts.         */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import type { CompanyProfile } from "../lib/accounting-types";
import { listArchive, purgeArchived, restoreArchived } from "./archive";
import { getCompany, setCompany } from "./db";
import { getSchoolProfile, setSchoolProfile } from "./school-profile";
import { generateDatevExport } from "./datev";
import {
  createInstructor,
  deleteInstructor,
  listInstructors,
  updateInstructor,
} from "./instructors";
import {
  createPricePlan,
  deletePricePlan,
  listPricePlans,
  updatePricePlan,
} from "./price-plans";
import { createStudent, deleteStudent, listStudents, updateStudent } from "./students";
import {
  createCalendarEvent,
  type CalendarEventInput,
  deleteCalendarEvent,
  getCalendarEvent,
  listCalendarEvents,
  markEventBilled,
  recordExamResult,
  updateCalendarEvent,
} from "./calendar-events";
import { UNASSIGNED_VEHICLE } from "../lib/vehicle-options";
import { BILLABLE_EVENT_TYPES } from "../lib/price-plan";
import {
  createVehicle,
  type VehicleInput,
  listVehicles,
  updateVehicle,
  deleteVehicle,
} from "./vehicles";
import {
  createTransaction,
  getQuittung,
  listAccounts,
  listJournal,
  listLedger,
  listStudentBalances,
  setAccountActive,
  stornoTransaction,
  ValidationError,
  type ListFilter,
} from "./engine";
import { handle, json } from "./http";
import { listVehicleLabels } from "./refs";

function filterFromUrl(url: string): ListFilter {
  const params = new URL(url).searchParams;
  const status = params.get("status");
  return {
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    q: params.get("q")?.trim() || undefined,
    customerNo: params.get("customerNo")?.trim() || undefined,
    status: status === "active" || status === "storniert" ? status : "all",
  };
}

export function instructorRoutes(db: Database) {
  return {
    "/api/instructors": {
      GET: (req: BunRequest) =>
        handle(() => json({ instructors: listInstructors(db) }))(),
      POST: (req: BunRequest) =>
        handle(async () => json(createInstructor(db, await req.json()), 201))(),
    },

    "/api/instructors/:id": {
      PATCH: (req: BunRequest<"/api/instructors/:id">) =>
        handle(async () => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Fahrlehrer-ID.");
          }
          return json(updateInstructor(db, id, await req.json()));
        })(),
      DELETE: (req: BunRequest<"/api/instructors/:id">) =>
        handle(() => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Fahrlehrer-ID.");
          }
          deleteInstructor(db, id);
          return json({ ok: true });
        })(),
    },
  };
}

export function studentRoutes(db: Database) {
  return {
    "/api/students": {
      GET: (req: BunRequest) => handle(() => json({ students: listStudents(db) }))(),
      POST: (req: BunRequest) =>
        handle(async () => json(createStudent(db, await req.json()), 201))(),
    },

    "/api/students/:id": {
      PATCH: (req: BunRequest<"/api/students/:id">) =>
        handle(async () => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Fahrschüler-ID.");
          }
          return json(updateStudent(db, id, await req.json()));
        })(),
      DELETE: (req: BunRequest<"/api/students/:id">) =>
        handle(() => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Fahrschüler-ID.");
          }
          deleteStudent(db, id);
          return json({ ok: true });
        })(),
    },
  };
}

export function pricePlanRoutes(db: Database) {
  return {
    "/api/price-plans": {
      GET: (req: BunRequest) => handle(() => json({ plans: listPricePlans(db) }))(),
      POST: (req: BunRequest) =>
        handle(async () => json(createPricePlan(db, await req.json()), 201))(),
    },

    "/api/price-plans/:id": {
      PATCH: (req: BunRequest<"/api/price-plans/:id">) =>
        handle(async () => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Preisplan-ID.");
          }
          return json(updatePricePlan(db, id, await req.json()));
        })(),
      DELETE: (req: BunRequest<"/api/price-plans/:id">) =>
        handle(() => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Preisplan-ID.");
          }
          deletePricePlan(db, id);
          return json({ ok: true });
        })(),
    },
  };
}

export function vehicleRoutes(db: Database) {
  return {
    "/api/vehicle-options": {
      GET: () =>
        handle(() => {
          // Unique labels ("Modell" or "Modell · Kennzeichen" for fleet
          // mates) — the server resolves each back to exactly one vehicle.
          const options = [...listVehicleLabels(db), UNASSIGNED_VEHICLE];
          return json({ vehicleOptions: options });
        })(),
    },

    "/api/vehicles": {
      GET: () => handle(() => json({ vehicles: listVehicles(db) }))(),
      POST: (req: BunRequest) =>
        handle(async () =>
          json(createVehicle(db, (await req.json()) as Partial<VehicleInput>), 201),
        )(),
    },

    "/api/vehicles/:id": {
      PATCH: (req: BunRequest<"/api/vehicles/:id">) =>
        handle(async () => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Fahrzeug-ID.");
          }
          return json(updateVehicle(db, id, await req.json()));
        })(),
      DELETE: (req: BunRequest<"/api/vehicles/:id">) =>
        handle(() => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Fahrzeug-ID.");
          }
          deleteVehicle(db, id);
          return json({ ok: true });
        })(),
    },
  };
}

export function calendarEventRoutes(db: Database) {
  return {
    "/api/calendar-events": {
      GET: (req: BunRequest) =>
        handle(() => {
          const params = new URL(req.url).searchParams;
          const events = listCalendarEvents(db, {
            from: params.get("from") ?? undefined,
            to: params.get("to") ?? undefined,
          });
          return json({ events });
        })(),
      POST: (req: BunRequest) =>
        handle(async () =>
          json(
            createCalendarEvent(db, (await req.json()) as Partial<CalendarEventInput>),
            201,
          ),
        )(),
    },

    "/api/calendar-events/:id": {
      PATCH: (req: BunRequest<"/api/calendar-events/:id">) =>
        handle(async () => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Termin-ID.");
          }
          return json(
            updateCalendarEvent(
              db,
              id,
              (await req.json()) as Partial<CalendarEventInput>,
            ),
          );
        })(),
      DELETE: (req: BunRequest<"/api/calendar-events/:id">) =>
        handle(() => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Termin-ID.");
          }
          deleteCalendarEvent(db, id);
          return json({ ok: true });
        })(),
    },

    "/api/calendar-events/:id/bill": {
      POST: (req: BunRequest<"/api/calendar-events/:id/bill">) =>
        handle(async () => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Termin-ID.");
          }

          // Pre-flight: load event, validate prerequisites.
          const event = getCalendarEvent(db, id);
          if (!(BILLABLE_EVENT_TYPES as string[]).includes(event.type)) {
            throw new ValidationError(
              "Nur praktische Fahrstunden und Prüfungen können abgerechnet werden.",
            );
          }
          if (event.studentId == null) {
            throw new ValidationError(
              "Kein Fahrschüler verknüpft — Termin kann nicht abgerechnet werden.",
            );
          }
          if (event.billedActive) {
            throw new ValidationError(
              "Termin ist bereits abgerechnet. Zuerst stornieren um neu abzurechnen.",
            );
          }
          if (event.cancelledAt) {
            throw new ValidationError(
              "Abgesagte Termine können nicht abgerechnet werden.",
            );
          }

          const body = await req.json();

          if (
            !(
              body &&
              typeof body === "object" &&
              (body as { type?: unknown }).type === "guthaben_uebertragung"
            )
          ) {
            throw new ValidationError(
              "Abrechnung muss vom Typ 'guthaben_uebertragung' sein.",
            );
          }

          // Wrap BOTH writes atomically: if markEventBilled fails,
          // the transaction row is rolled back (savepoint nesting).
          let result!: {
            transaction: ReturnType<typeof createTransaction>;
            event: ReturnType<typeof getCalendarEvent>;
          };
          const bill = db.transaction(() => {
            const tx = createTransaction(db, body);
            const updated = markEventBilled(db, id, tx.id);
            result = { transaction: tx, event: updated };
          });
          bill();

          return json(result, 201);
        })(),
    },

    "/api/calendar-events/:id/exam-result": {
      POST: (req: BunRequest<"/api/calendar-events/:id/exam-result">) =>
        handle(async () => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Termin-ID.");
          }
          const body = (await req.json()) as { result?: unknown };
          const raw = body?.result;
          if (raw !== null && raw !== "bestanden" && raw !== "nicht_bestanden") {
            throw new ValidationError(
              "Ergebnis muss 'bestanden', 'nicht_bestanden' oder null sein.",
            );
          }
          const updated = recordExamResult(
            db,
            id,
            raw as "bestanden" | "nicht_bestanden" | null,
          );
          return json(updated);
        })(),
    },
  };
}

export function archiveRoutes(db: Database) {
  const parseId = (raw: string): number => {
    const id = Number(raw);
    if (!Number.isInteger(id)) {
      throw new ValidationError("Ungültige Archiv-ID.");
    }
    return id;
  };

  return {
    "/api/archive": {
      GET: (req: BunRequest) => handle(() => json({ items: listArchive(db) }))(),
    },

    "/api/archive/:id/restore": {
      POST: (req: BunRequest<"/api/archive/:id/restore">) =>
        handle(() => json(restoreArchived(db, parseId(req.params.id))))(),
    },

    "/api/archive/:id": {
      DELETE: (req: BunRequest<"/api/archive/:id">) =>
        handle(() => {
          purgeArchived(db, parseId(req.params.id));
          return json({ ok: true });
        })(),
    },
  };
}

export function accountingRoutes(db: Database) {
  return {
    "/api/student-balances": {
      GET: (req: BunRequest) =>
        handle(() => json({ balances: listStudentBalances(db) }))(),
    },

    "/api/accounting/accounts": {
      GET: (req: BunRequest) => handle(() => json({ accounts: listAccounts(db) }))(),
    },

    "/api/accounting/accounts/:number": {
      PATCH: (req: BunRequest<"/api/accounting/accounts/:number">) =>
        handle(async () => {
          const body = (await req.json()) as { active?: unknown };
          if (typeof body.active !== "boolean") {
            throw new ValidationError("Feld 'active' (boolean) erwartet.");
          }
          setAccountActive(db, req.params.number, body.active);
          return json({ ok: true });
        })(),
    },

    "/api/accounting/transactions": {
      GET: (req: BunRequest) =>
        handle(() => json(listLedger(db, filterFromUrl(req.url))))(),
      POST: (req: BunRequest) =>
        handle(async () => {
          const created = createTransaction(db, await req.json());
          return json(created, 201);
        })(),
    },

    "/api/accounting/transactions/:id/storno": {
      POST: (req: BunRequest<"/api/accounting/transactions/:id/storno">) =>
        handle(async () => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Buchungs-ID.");
          }
          const body = (await req.json()) as { reason?: unknown; date?: unknown };
          const created = stornoTransaction(
            db,
            id,
            typeof body.reason === "string" ? body.reason : "",
            typeof body.date === "string" ? body.date : "",
          );
          return json(created, 201);
        })(),
    },

    "/api/accounting/datev": {
      GET: (req: BunRequest) =>
        handle(() => {
          const params = new URL(req.url).searchParams;
          const { filename, bytes } = generateDatevExport(db, {
            from: params.get("from") ?? undefined,
            to: params.get("to") ?? undefined,
          });
          // Bun accepts Uint8Array bodies; DOM lib types lag
          return new Response(bytes as unknown as BodyInit, {
            headers: {
              "Content-Type": "text/csv; charset=windows-1252",
              "Content-Disposition": `attachment; filename="${filename}"`,
            },
          });
        })(),
    },

    "/api/accounting/journal": {
      GET: (req: BunRequest) =>
        handle(() => json({ rows: listJournal(db, filterFromUrl(req.url)) }))(),
    },

    "/api/accounting/quittung/:id": {
      GET: (req: BunRequest<"/api/accounting/quittung/:id">) =>
        handle(() => {
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) {
            throw new ValidationError("Ungültige Buchungs-ID.");
          }
          return json(getQuittung(db, id));
        })(),
    },

    "/api/profile": {
      GET: (req: BunRequest) => handle(() => json(getCompany(db)))(),
      PUT: (req: BunRequest) =>
        handle(async () => {
          const body = (await req.json()) as Partial<CompanyProfile>;
          const current = getCompany(db);
          const next: CompanyProfile = { ...current };
          for (const key of Object.keys(current) as (keyof CompanyProfile)[]) {
            const value = body[key];
            if (typeof value === "string") next[key] = value.trim();
          }
          setCompany(db, next);
          if (next.website !== current.website) {
            setSchoolProfile(db, { ...getSchoolProfile(db), website: next.website });
          }
          return json(next);
        })(),
    },
  };
}

export function exportRoutes(db: Database) {
  return {
    "/api/export/database": {
      GET: (_req: BunRequest) =>
        handle(() => {
          const bytes = db.serialize();
          const date = new Date().toISOString().slice(0, 10);
          return new Response(bytes as unknown as BodyInit, {
            headers: {
              "Content-Type": "application/vnd.sqlite3",
              "Content-Disposition": `attachment; filename="openfs-export-${date}.db"`,
            },
          });
        })(),
    },
  };
}
