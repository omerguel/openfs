import { describe, expect, test } from "bun:test";

import { describeAudit } from "./audit-labels";

describe("Protokoll descriptions", () => {
  test("common actions read as plain German", () => {
    expect(describeAudit({ method: "POST", path: "/api/users", status: 201 }).label).toBe(
      "Benutzer angelegt",
    );
    expect(
      describeAudit({
        method: "POST",
        path: "/api/calendar-events/12/cancel",
        status: 200,
      }).label,
    ).toBe("Termin abgesagt");
    expect(
      describeAudit({ method: "DELETE", path: "/api/students/4", status: 200 }).label,
    ).toBe("Fahrschüler gelöscht");
    expect(
      describeAudit({ method: "PUT", path: "/api/profile", status: 200 }).label,
    ).toBe("Stammdaten der Fahrschule geändert");
  });

  test("failures say so; the raw request stays available", () => {
    const failed = describeAudit({ method: "POST", path: "/api/users", status: 400 });
    expect(failed.label).toBe("Benutzer angelegt – fehlgeschlagen");
    expect(failed.failed).toBe(true);
    expect(failed.detail).toBe("POST /api/users · 400");
    expect(
      describeAudit({ method: "PUT", path: "/api/profile", status: 403 }).label,
    ).toContain("keine Berechtigung");
  });

  test("logins, including the tried address on failure", () => {
    expect(
      describeAudit({ method: "LOGIN", path: "/api/auth/login", status: 200 }).label,
    ).toBe("Angemeldet");
    expect(
      describeAudit({ method: "LOGIN", path: "/api/auth/login (x@fs.de)", status: 401 })
        .label,
    ).toBe("Anmeldung fehlgeschlagen (x@fs.de)");
  });

  test("unknown endpoints fall back to a neutral label", () => {
    expect(describeAudit({ method: "POST", path: "/api/neu", status: 200 }).label).toBe(
      "Änderung",
    );
  });
});
