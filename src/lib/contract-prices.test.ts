import { describe, expect, test } from "bun:test";

import {
  contractPricesFromPlan,
  missingContractPrices,
  parseContractPriceOverrides,
  resolveContractPrices,
} from "./contract-prices";
import { PRICE_PLAN_SEED, type PricePlanRecord } from "./price-plan";

const standard: PricePlanRecord = { id: 1, ...PRICE_PLAN_SEED[0]! };

describe("contractPricesFromPlan", () => {
  test("the demo plan fills every § 32 FahrlG price", () => {
    expect(contractPricesFromPlan(standard)).toEqual({
      grundbetrag: 100_00,
      fahrstunde: 65_00,
      sonderfahrt: 75_00,
      theoriePruefung: 130_00,
      praxisPruefung: 280_00,
      lernmaterial: "inklusive",
    });
  });

  test("TÜV fees (Konto 1370) never count as the school's exam price", () => {
    const plan: PricePlanRecord = {
      id: 2,
      name: "Nur Gebühren",
      guaranteedMonths: 0,
      components: [
        {
          label: "TÜV-Gebühr Praxis",
          priceCents: 129_83,
          erloesKonto: "1370",
          eventType: "Vorstellung zur prakt. Prüfung",
        },
      ],
    };
    expect(contractPricesFromPlan(plan).praxisPruefung).toBeNull();
  });

  test("label fallback for plans without event types", () => {
    const plan: PricePlanRecord = {
      id: 3,
      name: "Alt",
      guaranteedMonths: 0,
      components: [
        { label: "Fahrübungsstunde", durationMin: 45, priceCents: 60_00 },
        { label: "Nachtfahrt", durationMin: 45, priceCents: 70_00 },
        { label: "Praktische Prüfung", priceCents: 250_00 },
      ],
    };
    expect(contractPricesFromPlan(plan)).toMatchObject({
      fahrstunde: 60_00,
      sonderfahrt: 70_00,
      praxisPruefung: 250_00,
      grundbetrag: null,
    });
  });

  test("no plan → everything unknown", () => {
    expect(
      Object.values(contractPricesFromPlan(undefined)).every((v) => v === null),
    ).toBe(true);
  });
});

describe("resolveContractPrices", () => {
  test("overrides win, the rest comes from the plan", () => {
    const prices = resolveContractPrices(standard, { grundbetrag: 89_00 });
    expect(prices.grundbetrag).toEqual({ value: 89_00, source: "override" });
    expect(prices.fahrstunde).toEqual({ value: 65_00, source: "plan" });
    expect(missingContractPrices(prices)).toEqual([]);
  });

  test("missing prices are reported (no 'Es fehlen Preise' when the plan has them)", () => {
    const prices = resolveContractPrices(undefined, { fahrstunde: 65_00 });
    expect(missingContractPrices(prices)).toEqual([
      "grundbetrag",
      "sonderfahrt",
      "theoriePruefung",
      "praxisPruefung",
    ]);
  });
});

describe("parseContractPriceOverrides", () => {
  test("accepts cents, drops null entries", () => {
    expect(
      parseContractPriceOverrides({ grundbetrag: 100_00, fahrstunde: null }),
    ).toEqual({ ok: true, value: { grundbetrag: 100_00 } });
    expect(parseContractPriceOverrides(null)).toEqual({ ok: true, value: {} });
  });

  test("rejects unknown keys and non-cent values", () => {
    expect(parseContractPriceOverrides({ rabatt: 1 }).ok).toBe(false);
    expect(parseContractPriceOverrides({ grundbetrag: 12.5 }).ok).toBe(false);
    expect(parseContractPriceOverrides({ grundbetrag: -1 }).ok).toBe(false);
    expect(parseContractPriceOverrides([1]).ok).toBe(false);
  });
});
