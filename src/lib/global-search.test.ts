import { describe, expect, test } from "bun:test";

import {
  entryMatches,
  normalizeSearch,
  searchEntries,
  type SearchEntry,
} from "./global-search";

const student: SearchEntry = {
  key: "s1",
  kind: "Fahrschüler",
  label: "Jana Müller",
  detail: "K-1042",
  href: "/fahrschueler/1",
  text: ["Jana Müller", "K-1042", "jana@example.de"],
  phones: ["+49 171 2345678"],
};

describe("global search", () => {
  test("names match case- and accent-insensitively, words in any order", () => {
    expect(entryMatches(student, "müller")).toBe(true);
    expect(entryMatches(student, "MULLER")).toBe(true);
    expect(entryMatches(student, "müller jana")).toBe(true);
    expect(entryMatches(student, "müller peter")).toBe(false);
    expect(normalizeSearch("Straße")).toBe("strasse");
  });

  test("customer number and e-mail match", () => {
    expect(entryMatches(student, "k-1042")).toBe(true);
    expect(entryMatches(student, "jana@exa")).toBe(true);
  });

  test("phone numbers match ignoring spaces and the country prefix", () => {
    expect(entryMatches(student, "0171 234")).toBe(true);
    expect(entryMatches(student, "01712345678")).toBe(true);
    expect(entryMatches(student, "171-2345")).toBe(true);
    expect(entryMatches(student, "0172")).toBe(false);
    // Two digits are too few to search phone numbers.
    expect(entryMatches(student, "17")).toBe(false);
  });

  test("results are grouped by kind; label prefix ranks first", () => {
    const entries: SearchEntry[] = [
      { ...student, key: "a", label: "Kemüller", text: ["Kemüller"] },
      { ...student, key: "b", label: "Müller", text: ["Müller"] },
      {
        key: "p",
        kind: "Seite",
        label: "Fahrzeuge",
        href: "/fahrzeuge",
        text: ["Fahrzeuge"],
      },
    ];
    const groups = searchEntries(entries, "mül");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((e) => e.key)).toEqual(["b", "a"]);
    expect(searchEntries(entries, "fahrz")[0]!.kind).toBe("Seite");
    expect(searchEntries(entries, "  ")).toEqual([]);
  });
});
