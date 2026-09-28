/* ------------------------------------------------------------------ */
/* Preispläne — types + one-time DB seed.                              */
/*                                                                     */
/* At runtime the plans live in SQLite (price_plans table, served via  */
/* /api/price-plans) — pages read them through usePricePlans() so      */
/* edits persist. The seed below is only imported by the server to     */
/* fill an empty database (src/server/db.ts). Amounts are integer      */
/* cents like everywhere else (src/lib/money.ts).                      */
/* ------------------------------------------------------------------ */

import { splitClassList } from "./license-classes";

/** Calendar event types a price component can price (see calendar-data.ts). */
export type BillableEventType =
  | "Praktisch"
  | "Theorieprüfung"
  | "Vorstellung zur prakt. Prüfung";

export const BILLABLE_EVENT_TYPES: BillableEventType[] = [
  "Praktisch",
  "Theorieprüfung",
  "Vorstellung zur prakt. Prüfung",
];

export type PriceComponent = {
  label: string;
  /** Unit duration in minutes — omitted for flat items (Grundbetrag). */
  durationMin?: number | null;
  /** null = included / no separate charge (e.g. Lernmaterial). */
  priceCents: number | null;
  /** Haben account for this charge — null = default Erlöskonto (4400).
      "1370" marks a durchlaufender Posten (TÜV/DEKRA-Gebühr). */
  erloesKonto?: string | null;
  /** Event type this component is charged for when billing a Termin.
      Several components may share a type (exam: Vorstellungsentgelt +
      Prüfgebühr) — each becomes one line of the same transaction. */
  eventType?: BillableEventType | null;
};

export const DEFAULT_ERLOES_KONTO = "4400";

/* Label fallback for plans saved before components carried eventType. */
const LEGACY_EVENT_LABELS: Record<BillableEventType, string[]> = {
  Praktisch: ["Fahrübungsstunde"],
  Theorieprüfung: ["Theorieprüfung", "TÜV-Gebühr Theorie"],
  "Vorstellung zur prakt. Prüfung": ["Praktische Prüfung", "TÜV-Gebühr Praxis"],
};

export type ChargeProposal = {
  label: string;
  priceCents: number;
  habenKonto: string;
};

/**
 * Proposed charge lines for billing a Termin of `eventType` from a
 * student's plan: every priced component tagged with that event type (or,
 * for untagged legacy plans, matched by label). Empty when nothing
 * resolves — the caller then falls back to manual entry.
 */
export function resolveEventCharges(
  plan: PricePlanRecord | undefined,
  eventType: BillableEventType,
): ChargeProposal[] {
  if (!plan) return [];
  const tagged = plan.components.filter((c) => c.eventType === eventType);
  const components =
    tagged.length > 0
      ? tagged
      : plan.components.filter(
          (c) => !c.eventType && LEGACY_EVENT_LABELS[eventType].includes(c.label),
        );
  return components
    .filter((c) => c.priceCents != null)
    .map((c) => ({
      label: c.label,
      priceCents: c.priceCents!,
      habenKonto: c.erloesKonto || DEFAULT_ERLOES_KONTO,
    }));
}

export type PricePlanInput = {
  name: string;
  /** Guaranteed price period in months — 0 = no guarantee. */
  guaranteedMonths: number;
  /** Führerscheinklassen this plan is offered for ("B", "A", …).
      Empty/omitted = valid for every class. */
  classes?: string[];
  components: PriceComponent[];
};

export type PricePlanRecord = PricePlanInput & { id: number };

/** True when `plan` is offered for any of the student's classes
    ("B, A1"); a plan without classes fits everyone. */
export function planMatchesClasses(
  plan: PricePlanRecord,
  studentClasses: string,
): boolean {
  const planClasses = (plan.classes ?? []).map((klass) => klass.toUpperCase());
  if (planClasses.length === 0) return true;
  return splitClassList(studentClasses).some((klass) =>
    planClasses.includes(klass.toUpperCase()),
  );
}

/** Default plan for a new student: the first plan (in list order)
    offered for one of the student's classes, else the first plan. */
export function defaultPlanForClasses(
  plans: PricePlanRecord[],
  studentClasses: string,
): PricePlanRecord | undefined {
  return plans.find((plan) => planMatchesClasses(plan, studentClasses)) ?? plans[0];
}

/** The plan that applies to a student: the assigned one, else the
    class default (students created before plans were assigned). */
export function resolveStudentPlan(
  plans: PricePlanRecord[],
  student: { pricePlanId?: number | null; classes: string },
): PricePlanRecord | undefined {
  return (
    plans.find((plan) => plan.id === student.pricePlanId) ??
    defaultPlanForClasses(plans, student.classes)
  );
}

/** "Garantierter Zeitraum 12 Monate" / "1 Monat"; null when there is none. */
export function formatGuaranteedPeriod(months: number | null | undefined): string | null {
  if (!months || months <= 0) return null;
  return `Preisgarantie ${months} ${months === 1 ? "Monat" : "Monate"}`;
}

/**
 * Resolve the price for a practical lesson component from a student's
 * price plan. Returns the matching component and its price in cents, or
 * null when the plan is missing, the component is not found, or the
 * component's priceCents is null (included / no separate charge).
 *
 * @param plan       The student's price plan (or undefined if none assigned).
 * @param componentLabel  Label of the component to look up (default: "Fahrübungsstunde").
 */
export function resolveLessonPrice(
  plan: PricePlanRecord | undefined,
  componentLabel = "Fahrübungsstunde",
): { component: PriceComponent; priceCents: number } | null {
  if (!plan) return null;
  const component = plan.components.find((c) => c.label === componentLabel);
  if (!component) return null;
  if (component.priceCents == null) return null;
  return { component, priceCents: component.priceCents };
}

export const PRICE_PLAN_SEED: PricePlanInput[] = [
  {
    name: "Standard Tarif",
    guaranteedMonths: 12,
    classes: [],
    components: [
      { label: "Grundbetrag", priceCents: 100_00 },
      { label: "Nachtfahrt", durationMin: 45, priceCents: 75_00 },
      { label: "Autobahnfahrt", durationMin: 45, priceCents: 75_00 },
      { label: "Überlandfahrt", durationMin: 45, priceCents: 75_00 },
      {
        label: "Fahrübungsstunde",
        durationMin: 45,
        priceCents: 65_00,
        eventType: "Praktisch",
      },
      { label: "Schaltkompetenzprüfung", durationMin: 15, priceCents: 70_00 },
      {
        label: "Theorieprüfung",
        durationMin: 45,
        priceCents: 130_00,
        eventType: "Theorieprüfung",
      },
      {
        label: "TÜV-Gebühr Theorie",
        priceCents: 25_87,
        erloesKonto: "1370",
        eventType: "Theorieprüfung",
      },
      {
        label: "Praktische Prüfung",
        durationMin: 55,
        priceCents: 280_00,
        eventType: "Vorstellung zur prakt. Prüfung",
      },
      {
        label: "TÜV-Gebühr Praxis",
        priceCents: 129_83,
        erloesKonto: "1370",
        eventType: "Vorstellung zur prakt. Prüfung",
      },
      { label: "Lernmaterial", priceCents: null },
    ],
  },
  {
    name: "Rabatt Tarif",
    guaranteedMonths: 12,
    classes: ["B", "B197"],
    components: [
      { label: "Grundbetrag", priceCents: 89_00 },
      { label: "Nachtfahrt", durationMin: 45, priceCents: 69_00 },
      { label: "Autobahnfahrt", durationMin: 45, priceCents: 69_00 },
      { label: "Überlandfahrt", durationMin: 45, priceCents: 69_00 },
      {
        label: "Fahrübungsstunde",
        durationMin: 45,
        priceCents: 55_00,
        eventType: "Praktisch",
      },
      { label: "Schaltkompetenzprüfung", durationMin: 15, priceCents: 60_00 },
      {
        label: "Theorieprüfung",
        durationMin: 45,
        priceCents: 110_00,
        eventType: "Theorieprüfung",
      },
      {
        label: "TÜV-Gebühr Theorie",
        priceCents: 25_87,
        erloesKonto: "1370",
        eventType: "Theorieprüfung",
      },
      {
        label: "Praktische Prüfung",
        durationMin: 55,
        priceCents: 240_00,
        eventType: "Vorstellung zur prakt. Prüfung",
      },
      {
        label: "TÜV-Gebühr Praxis",
        priceCents: 129_83,
        erloesKonto: "1370",
        eventType: "Vorstellung zur prakt. Prüfung",
      },
      { label: "Lernmaterial", priceCents: null },
    ],
  },
];
