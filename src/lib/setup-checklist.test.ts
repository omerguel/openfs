import { describe, expect, test } from "bun:test";

import type { CompanyProfile } from "./accounting-types";
import {
  type ChecklistFacts,
  missingCompanyData,
  setupChecklist,
} from "./setup-checklist";

const blankCompany: CompanyProfile = {
  name: "FS Nord",
  address: "",
  email: "",
  phone: "",
  website: "",
  steuernummer: "",
  ustIdNr: "",
  beraterNr: "",
  mandantNr: "",
  bankName: "",
  iban: "",
  bic: "",
  glaeubigerId: "",
  inhaber: "",
  registergericht: "",
  registernummer: "",
  aufsichtsbehoerde: "",
  datenschutzEmail: "",
  impressumZusatz: "",
};

const fresh: ChecklistFacts = {
  company: blankCompany,
  instructors: 0,
  vehicles: 0,
  students: 0,
  users: 1,
  backups: { enabled: true, count: 0 },
  pricesReviewed: false,
};

describe("setup checklist", () => {
  test("a fresh school has every step open; Büro does not see owner steps", () => {
    const owner = setupChecklist(fresh, "inhaber");
    expect(owner.map((i) => i.id)).toEqual([
      "fahrschule",
      "fahrlehrer",
      "fahrzeuge",
      "preise",
      "benutzer",
      "schueler",
      "sicherung",
    ]);
    expect(owner.every((i) => !i.done)).toBe(true);
    const office = setupChecklist(fresh, "buero").map((i) => i.id);
    expect(office).not.toContain("benutzer");
    expect(office).not.toContain("sicherung");
  });

  test("steps tick off from live data", () => {
    const items = setupChecklist(
      {
        ...fresh,
        company: {
          ...blankCompany,
          address: "Hauptstr. 1",
          phone: "1",
          email: "a@b.de",
          inhaber: "Eva",
          steuernummer: "1/2/3",
          iban: "DE89370400440532013000",
        },
        instructors: 1,
        vehicles: 2,
        students: 1,
        users: 2,
        backups: { enabled: true, count: 3 },
        pricesReviewed: true,
      },
      "inhaber",
    );
    expect(items.every((i) => i.done)).toBe(true);
  });

  test("the Stammdaten step names what is missing", () => {
    expect(missingCompanyData(blankCompany)).toEqual([
      "Anschrift",
      "Telefon",
      "E-Mail",
      "Inhaber/in",
      "Steuernummer",
      "IBAN",
    ]);
    expect(setupChecklist(fresh, "inhaber")[0]!.description).toContain("Anschrift");
  });
});
