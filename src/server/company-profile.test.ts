import { describe, expect, test } from "bun:test";

import { updateCompanyProfile } from "./company-profile";
import { getCompany, openDb } from "./db";
import { ForbiddenError, ValidationError } from "./errors";
import { getSchoolProfile } from "./school-profile";

const VALID_IBAN = "DE89 3704 0044 0532 0130 00";

describe("updateCompanyProfile", () => {
  test("trims strings and keeps the website in sync with the Schulprofil", () => {
    const db = openDb(":memory:");
    const next = updateCompanyProfile(db, {
      name: "  FS Nord ",
      website: " https://x.de ",
    });
    expect(next.name).toBe("FS Nord");
    expect(getSchoolProfile(db).website).toBe("https://x.de");
  });

  test("rejects an IBAN with a wrong check digit", () => {
    const db = openDb(":memory:");
    expect(() =>
      updateCompanyProfile(db, { iban: "DE88 3704 0044 0532 0130 00" }, "inhaber"),
    ).toThrow(ValidationError);
    expect(updateCompanyProfile(db, { iban: VALID_IBAN }, "inhaber").iban).toBe(
      VALID_IBAN,
    );
    // Clearing is always allowed.
    expect(updateCompanyProfile(db, { iban: "" }, "inhaber").iban).toBe("");
  });

  test("Büro may edit Stammdaten but not tax numbers or the Bankverbindung", () => {
    const db = openDb(":memory:");
    updateCompanyProfile(db, { steuernummer: "045/123/45678", iban: VALID_IBAN });
    // Unchanged locked fields in the payload are fine (the form sends all).
    const saved = updateCompanyProfile(
      db,
      { ...getCompany(db), phone: "06151 1", steuernummer: "045/123/45678" },
      "buero",
    );
    expect(saved.phone).toBe("06151 1");
    expect(() => updateCompanyProfile(db, { steuernummer: "1/2/3" }, "buero")).toThrow(
      ForbiddenError,
    );
    expect(() => updateCompanyProfile(db, { iban: "" }, "buero")).toThrow(ForbiddenError);
    expect(getCompany(db).steuernummer).toBe("045/123/45678");
    expect(
      updateCompanyProfile(db, { steuernummer: "1/2/3" }, "inhaber").steuernummer,
    ).toBe("1/2/3");
  });
});
