import { describe, expect, test } from "bun:test";

import { theoryLessonFromTitle, theoryLessonOptions } from "./theory-lessons";

describe("theoryLessonOptions", () => {
  test("class B: 12 Grundstoff + 2 Zusatzstoff", () => {
    const options = theoryLessonOptions("B");
    expect(options).toHaveLength(14);
    expect(options[0]).toBe("Grundstoff 1");
    expect(options.at(-1)).toBe("Zusatzstoff 2");
  });

  test("class A has 4 Zusatzstoff lessons, unknown classes fall back to B", () => {
    expect(theoryLessonOptions("A").at(-1)).toBe("Zusatzstoff 4");
    expect(theoryLessonOptions("BF17")).toHaveLength(14);
    expect(theoryLessonOptions("XYZ")).toHaveLength(14);
  });
});

describe("theoryLessonFromTitle", () => {
  test("maps Thema numbers straight through Grundstoff into Zusatzstoff", () => {
    expect(theoryLessonFromTitle("Thema 9: Verkehrsverhalten bei Fahrmanövern")).toBe(
      "Grundstoff 9",
    );
    expect(theoryLessonFromTitle("Thema 10: Ruhender Verkehr")).toBe("Grundstoff 10");
    expect(theoryLessonFromTitle("Thema 13 – Technik")).toBe("Zusatzstoff 1");
  });

  test("keeps explicit labels and ignores titles without a lesson", () => {
    expect(theoryLessonFromTitle("Zusatzstoff 2 (B)")).toBe("Zusatzstoff 2");
    expect(theoryLessonFromTitle("grundstoff 3")).toBe("Grundstoff 3");
    expect(theoryLessonFromTitle("Theorieunterricht")).toBeNull();
    expect(theoryLessonFromTitle("Thema 0")).toBeNull();
  });
});
