import { describe, expect, test } from "bun:test";

import { describeBackupContents, missingFilesWarning } from "./backup-contents";

const set = { kind: "set" as const, fileCount: 6, filesIncluded: true, missingFiles: 0 };

describe("describeBackupContents", () => {
  test("names database and document count", () => {
    expect(describeBackupContents(set)).toBe("Datenbank + 6 Dokumente");
    expect(describeBackupContents({ ...set, fileCount: 1 })).toBe(
      "Datenbank + 1 Dokument",
    );
    expect(describeBackupContents({ ...set, fileCount: 0 })).toBe(
      "Datenbank + 0 Dokumente",
    );
  });

  test("database-only sets and legacy backups say so", () => {
    expect(describeBackupContents({ ...set, filesIncluded: false })).toContain(
      "Nur Datenbank",
    );
    expect(describeBackupContents({ ...set, kind: "legacy" })).toBe(
      "Nur Datenbank (älteres Format)",
    );
  });

  test("warns about documents that were missing at backup time", () => {
    expect(missingFilesWarning(set)).toBeNull();
    expect(missingFilesWarning({ ...set, missingFiles: 1 })).toBe(
      "1 Dokument fehlte schon im Dateispeicher",
    );
    expect(missingFilesWarning({ ...set, missingFiles: 2 })).toBe(
      "2 Dokumente fehlten schon im Dateispeicher",
    );
  });
});
