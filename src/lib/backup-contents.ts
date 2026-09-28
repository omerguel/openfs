/* What a Datensicherung contains, as shown on /datensicherung. */

export type BackupContents = {
  kind: "set" | "legacy";
  fileCount: number;
  filesIncluded: boolean;
  missingFiles: number;
};

const documents = (n: number) => (n === 1 ? "1 Dokument" : `${n} Dokumente`);

export function describeBackupContents(backup: BackupContents): string {
  if (backup.kind === "legacy") return "Nur Datenbank (älteres Format)";
  if (!backup.filesIncluded) return "Nur Datenbank (Dokumente nicht mitgesichert)";
  return `Datenbank + ${documents(backup.fileCount)}`;
}

/** Warning for documents that were already missing when backing up. */
export function missingFilesWarning(backup: BackupContents): string | null {
  if (backup.missingFiles <= 0) return null;
  return `${documents(backup.missingFiles)} fehlte${backup.missingFiles === 1 ? "" : "n"} schon im Dateispeicher`;
}
