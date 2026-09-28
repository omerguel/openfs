import { describe, expect, test } from "bun:test";

import { describeBalance } from "./student-balance";

describe("describeBalance", () => {
  test("credit, debt and even read as Guthaben / Offen / Ausgeglichen", () => {
    expect(describeBalance(200_00)).toEqual({
      label: "Guthaben",
      amount: "200,00 EUR",
      tone: "credit",
    });
    expect(describeBalance(-85_50)).toEqual({
      label: "Offen",
      amount: "85,50 EUR",
      tone: "debt",
    });
    expect(describeBalance(0)).toMatchObject({ label: "Ausgeglichen", tone: "even" });
    expect(describeBalance(undefined).tone).toBe("even");
  });

  test("thousands are grouped", () => {
    expect(describeBalance(-1_250_00).amount).toBe("1.250,00 EUR");
  });
});
