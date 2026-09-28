/* ------------------------------------------------------------------ */
/* Entgelte im Ausbildungsvertrag (§ 32 FahrlG).                       */
/*                                                                     */
/* The contract shows six prices. They come from the student's price   */
/* plan; the office may override single values per student — those    */
/* overrides are stored on the student (students.contract_prices) so  */
/* every workstation prints the same contract. Pure helpers, shared by */
/* the server (validation) and the VertragDialog.                      */
/* ------------------------------------------------------------------ */

import type { PriceComponent, PricePlanRecord } from "./price-plan";

export const CONTRACT_PRICE_KEYS = [
  "grundbetrag",
  "fahrstunde",
  "sonderfahrt",
  "theoriePruefung",
  "praxisPruefung",
  "lernmaterial",
] as const;

export type ContractPriceKey = (typeof CONTRACT_PRICE_KEYS)[number];

/** Per-student overrides in cents; a missing key = take the plan's price. */
export type ContractPriceOverrides = Partial<Record<ContractPriceKey, number>>;

/** Resolved contract price: cents, "inklusive" (plan says no separate
    charge) or null (unknown — printed as a blank to fill in by hand). */
export type ContractPriceValue = number | "inklusive" | null;

export type ResolvedContractPrice = {
  value: ContractPriceValue;
  source: "plan" | "override" | "none";
};

export const CONTRACT_PRICE_LABELS: Record<ContractPriceKey, string> = {
  grundbetrag: "Grundbetrag",
  fahrstunde: "Fahrstunde (45 Min.)",
  sonderfahrt: "Sonderfahrt (45 Min.)",
  theoriePruefung: "Vorstellung theor. Prüfung",
  praxisPruefung: "Vorstellung prakt. Prüfung",
  lernmaterial: "Lernmaterial (optional)",
};

/** Keys the contract needs for complete § 32 FahrlG price information. */
export const REQUIRED_CONTRACT_PRICE_KEYS: ContractPriceKey[] =
  CONTRACT_PRICE_KEYS.filter((key) => key !== "lernmaterial");

const PASS_THROUGH = "1370";

const norm = (label: string) => label.toLocaleLowerCase("de-DE");

/* TÜV/DEKRA fees are durchlaufende Posten, never the school's own price. */
function isFee(component: PriceComponent): boolean {
  return (
    component.erloesKonto === PASS_THROUGH ||
    /tüv|dekra|gebühr/.test(norm(component.label))
  );
}

function priceOf(component: PriceComponent | undefined): ContractPriceValue {
  if (!component) return null;
  return component.priceCents == null ? "inklusive" : component.priceCents;
}

/** Plan component per contract price — by event type first, then by label. */
export function contractPricesFromPlan(
  plan: PricePlanRecord | undefined,
): Record<ContractPriceKey, ContractPriceValue> {
  const components = plan?.components ?? [];
  const byLabel = (pattern: RegExp) =>
    components.find((c) => !isFee(c) && pattern.test(norm(c.label)));
  const byEvent = (eventType: PriceComponent["eventType"]) =>
    components.find((c) => c.eventType === eventType && !isFee(c));

  const special = ["überland", "autobahn", "nacht"]
    .map((word) => byLabel(new RegExp(word)))
    .find((c) => c?.priceCents != null);

  return {
    grundbetrag: priceOf(byLabel(/grundbetrag|grundgebühr/)),
    fahrstunde: priceOf(byEvent("Praktisch") ?? byLabel(/übungsstunde|fahrstunde/)),
    sonderfahrt: priceOf(special ?? byLabel(/sonderfahrt|besondere/)),
    theoriePruefung: priceOf(
      byEvent("Theorieprüfung") ?? byLabel(/theorieprüfung|theoretische prüfung/),
    ),
    praxisPruefung: priceOf(
      byEvent("Vorstellung zur prakt. Prüfung") ??
        byLabel(/praktische prüfung|praxisprüfung/),
    ),
    lernmaterial: priceOf(byLabel(/lernmaterial|lehrmittel/)),
  };
}

/** Plan prices with the student's overrides on top. */
export function resolveContractPrices(
  plan: PricePlanRecord | undefined,
  overrides: ContractPriceOverrides | undefined,
): Record<ContractPriceKey, ResolvedContractPrice> {
  const fromPlan = contractPricesFromPlan(plan);
  const result = {} as Record<ContractPriceKey, ResolvedContractPrice>;
  for (const key of CONTRACT_PRICE_KEYS) {
    const override = overrides?.[key];
    if (override != null) {
      result[key] = { value: override, source: "override" };
    } else {
      const value = fromPlan[key];
      result[key] = { value, source: value == null ? "none" : "plan" };
    }
  }
  return result;
}

/** Required prices that are still unknown (neither plan nor override). */
export function missingContractPrices(
  prices: Record<ContractPriceKey, ResolvedContractPrice>,
): ContractPriceKey[] {
  return REQUIRED_CONTRACT_PRICE_KEYS.filter((key) => prices[key].value == null);
}

/** Validates an overrides payload; returns a clean copy or an error text. */
export function parseContractPriceOverrides(
  input: unknown,
): { ok: true; value: ContractPriceOverrides } | { ok: false; error: string } {
  if (input === null) return { ok: true, value: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Feld 'contractPrices' muss ein Objekt sein." };
  }
  const value: ContractPriceOverrides = {};
  for (const [key, cents] of Object.entries(input as Record<string, unknown>)) {
    if (!(CONTRACT_PRICE_KEYS as readonly string[]).includes(key)) {
      return { ok: false, error: `Unbekannter Vertragspreis '${key}'.` };
    }
    if (cents == null) continue;
    if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 0) {
      return {
        ok: false,
        error: `Vertragspreis '${CONTRACT_PRICE_LABELS[key as ContractPriceKey]}' muss ein Betrag in Cent (>= 0) sein.`,
      };
    }
    value[key as ContractPriceKey] = cents;
  }
  return { ok: true, value };
}
