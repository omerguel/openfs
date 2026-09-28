import { beforeEach, describe, expect, test } from "bun:test";

import { openSqlite, type Database } from "./sqlite";
import { getCompany, setCompany } from "./db";
import { legalRoutes, PUBLIC_LEGAL_PATH } from "./legal";

let db: Database;

beforeEach(() => {
  db = openSqlite(":memory:");
  db.run("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
});

async function fetchLegal() {
  const res = await legalRoutes(db)[PUBLIC_LEGAL_PATH].GET();
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, string>;
}

describe("GET /api/public/legal", () => {
  test("returns the new legal fields empty by default", async () => {
    const data = await fetchLegal();
    expect(data.inhaber).toBe("");
    expect(data.aufsichtsbehoerde).toBe("");
    expect(data.impressumZusatz).toBe("");
  });

  test("publishes legal fields but never bank or DATEV data", async () => {
    setCompany(db, {
      ...getCompany(db),
      name: "Fahrschule Müller",
      inhaber: "Anna Müller",
      aufsichtsbehoerde: "Stadt Darmstadt",
      iban: "DE02120300000000202051",
      bic: "HELADEF1DAS",
      bankName: "Sparkasse",
      glaeubigerId: "DE98ZZZ09999999999",
      beraterNr: "29098",
      mandantNr: "55003",
    });
    const data = await fetchLegal();
    expect(data.name).toBe("Fahrschule Müller");
    expect(data.inhaber).toBe("Anna Müller");
    expect(data.aufsichtsbehoerde).toBe("Stadt Darmstadt");
    for (const key of [
      "iban",
      "bic",
      "bankName",
      "glaeubigerId",
      "beraterNr",
      "mandantNr",
    ]) {
      expect(data).not.toHaveProperty(key);
    }
  });

  test("legacy company blobs without the new fields read as empty", async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('company', ?)").run(
      JSON.stringify({ name: "Alt" }),
    );
    const data = await fetchLegal();
    expect(data.name).toBe("Alt");
    expect(data.registergericht).toBe("");
    expect(data.datenschutzEmail).toBe("");
  });

  test("lists missing required fields for the owner warning", async () => {
    const empty = (await fetchLegal()) as unknown as { missing: string[] };
    expect(empty.missing).toEqual(
      expect.arrayContaining(["inhaber", "aufsichtsbehoerde"]),
    );
    setCompany(db, {
      ...getCompany(db),
      name: "Fahrschule Müller",
      address: "Hauptstr. 1, 64283 Darmstadt",
      phone: "06151 1",
      email: "info@example.de",
      inhaber: "Anna Müller",
      aufsichtsbehoerde: "Stadt Darmstadt",
    });
    const complete = (await fetchLegal()) as unknown as { missing: string[] };
    expect(complete.missing).toEqual([]);
  });
});
