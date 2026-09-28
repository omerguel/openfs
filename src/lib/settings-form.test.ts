import { describe, expect, test } from "bun:test";

import { EMPTY_SCHOOL_PROFILE } from "@/hooks/use-school-profile";
import type { CompanyProfile } from "./accounting-types";
import { toInstagramUrl } from "./instagram";
import {
  changedParts,
  formatHours,
  parseHours,
  sameValue,
  type SettingsDraft,
  tabOfField,
  validateSettings,
} from "./settings-form";

const company: CompanyProfile = {
  name: "Fahrschule Nord",
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

const draft = (patch: Partial<SettingsDraft> = {}): SettingsDraft => ({
  company,
  school: EMPTY_SCHOOL_PROFILE,
  policy: { hours: "24", fee: "" },
  ...patch,
});

describe("settings form", () => {
  test("dirty = differs from the saved state; typing it back is clean again", () => {
    const saved = draft();
    expect(changedParts(draft(), saved)).toEqual({
      company: false,
      school: false,
      policy: false,
    });
    const edited = draft({ company: { ...company, ustIdNr: "DE123456789" } });
    expect(changedParts(edited, saved).company).toBe(true);
    expect(changedParts(draft({ company: { ...company } }), saved).company).toBe(false);
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameValue([1], [1, 2])).toBe(false);
  });

  test("IBAN checksum, BIC and e-mail are validated inline", () => {
    const errors = validateSettings(
      draft({
        company: {
          ...company,
          iban: "DE88 3704 0044 0532 0130 00",
          bic: "XYZ",
          email: "info@",
        },
      }),
    );
    expect(errors["company-iban"]).toContain("Prüfziffer");
    expect(errors["company-bic"]).toBeDefined();
    expect(errors["company-email"]).toBeDefined();
    expect(tabOfField("company-iban")).toBe("bank");
    const ok = validateSettings(
      draft({ company: { ...company, iban: "DE89 3704 0044 0532 0130 00" } }),
    );
    expect(ok).toEqual({});
  });

  test("required name, founding year range, Instagram handle, policy numbers", () => {
    const now = new Date("2026-09-28");
    const errors = validateSettings(
      draft({
        company: { ...company, name: " " },
        school: { ...EMPTY_SCHOOL_PROFILE, founded_year: 2031, instagram: "zwei worte" },
        policy: { hours: "abc", fee: "zehn" },
      }),
      now,
    );
    expect(Object.keys(errors).sort()).toEqual([
      "company-name",
      "policy-fee",
      "policy-hours",
      "school-founded",
      "school-instagram",
    ]);
    expect(toInstagramUrl("@fs_nord")).toBe("https://instagram.com/fs_nord");
  });

  test("opening hours round-trip and 'bis' after 'von'", () => {
    expect(parseHours("9:00 – 18:00 Büro")).toEqual({
      open: true,
      set: true,
      from: "09:00",
      to: "18:00",
      note: "Büro",
    });
    expect(parseHours("Geschlossen").open).toBe(false);
    expect(parseHours("").set).toBe(false);
    expect(formatHours({ open: true, from: "10:00", to: "13:00", note: "" })).toBe(
      "10:00 – 13:00",
    );
    const school = {
      ...EMPTY_SCHOOL_PROFILE,
      opening_hours: EMPTY_SCHOOL_PROFILE.opening_hours.map((e, i) =>
        i === 0 ? { ...e, hours: "18:00 – 09:00" } : e,
      ),
    };
    expect(validateSettings(draft({ school }))["opening-0"]).toBeDefined();
  });
});
