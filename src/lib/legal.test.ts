import { describe, expect, test } from "bun:test";

import {
  EMPTY_LEGAL_INFO,
  type LegalInfo,
  addressLines,
  missingDatenschutzFields,
  missingImpressumFields,
  privacyContactEmail,
  toLegalInfo,
} from "./legal";

const COMPLETE: LegalInfo = {
  ...EMPTY_LEGAL_INFO,
  name: "Fahrschule Müller",
  address: "Hauptstraße 1, 64283 Darmstadt",
  phone: "06151 123456",
  email: "info@mueller.example",
  inhaber: "Anna Müller",
  aufsichtsbehoerde: "Stadt Darmstadt, Straßenverkehrsbehörde",
};

describe("toLegalInfo", () => {
  test("keeps only publishable fields and trims them", () => {
    const info = toLegalInfo({
      name: "  Fahrschule Müller ",
      iban: "DE02120300000000202051",
      glaeubigerId: "DE98ZZZ09999999999",
      beraterNr: "29098",
    });
    expect(info.name).toBe("Fahrschule Müller");
    expect(info).not.toHaveProperty("iban");
    expect(info).not.toHaveProperty("glaeubigerId");
    expect(info).not.toHaveProperty("beraterNr");
    expect(info.inhaber).toBe("");
  });

  test("replaces non-string values with empty strings", () => {
    const info = toLegalInfo({ name: 42 as unknown as string });
    expect(info.name).toBe("");
  });
});

describe("missingImpressumFields", () => {
  test("empty profile lists every required field", () => {
    expect(missingImpressumFields(EMPTY_LEGAL_INFO)).toEqual([
      "name",
      "address",
      "phone",
      "email",
      "inhaber",
      "aufsichtsbehoerde",
    ]);
  });

  test("complete profile has nothing missing", () => {
    expect(missingImpressumFields(COMPLETE)).toEqual([]);
  });

  test("whitespace-only counts as missing", () => {
    expect(missingImpressumFields({ ...COMPLETE, inhaber: "   " })).toEqual(["inhaber"]);
  });

  test("register data is optional but must come as a pair", () => {
    expect(missingImpressumFields({ ...COMPLETE, registergericht: "AG Darmstadt" })).toEqual(
      ["registernummer"],
    );
    expect(missingImpressumFields({ ...COMPLETE, registernummer: "HRB 1234" })).toEqual([
      "registergericht",
    ]);
    expect(
      missingImpressumFields({
        ...COMPLETE,
        registergericht: "AG Darmstadt",
        registernummer: "HRB 1234",
      }),
    ).toEqual([]);
  });

  test("USt-IdNr and Steuernummer are never required", () => {
    expect(missingImpressumFields({ ...COMPLETE, ustIdNr: "", steuernummer: "" })).toEqual(
      [],
    );
  });
});

describe("missingDatenschutzFields", () => {
  test("needs the Verantwortliche but not the Aufsichtsbehörde", () => {
    expect(missingDatenschutzFields({ ...COMPLETE, aufsichtsbehoerde: "" })).toEqual([]);
    expect(missingDatenschutzFields(EMPTY_LEGAL_INFO)).toEqual([
      "name",
      "address",
      "email",
      "inhaber",
    ]);
  });
});

describe("privacyContactEmail", () => {
  test("prefers the dedicated address and falls back to the general one", () => {
    expect(privacyContactEmail(COMPLETE)).toBe("info@mueller.example");
    expect(
      privacyContactEmail({ ...COMPLETE, datenschutzEmail: "datenschutz@mueller.example" }),
    ).toBe("datenschutz@mueller.example");
    expect(privacyContactEmail(EMPTY_LEGAL_INFO)).toBe("");
  });
});

describe("addressLines", () => {
  test("splits on commas and newlines", () => {
    expect(addressLines("Hauptstraße 1, 64283 Darmstadt")).toEqual([
      "Hauptstraße 1",
      "64283 Darmstadt",
    ]);
    expect(addressLines("Hauptstraße 1\n64283 Darmstadt\n")).toEqual([
      "Hauptstraße 1",
      "64283 Darmstadt",
    ]);
    expect(addressLines("")).toEqual([]);
  });
});
