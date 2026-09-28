/* ------------------------------------------------------------------ */
/* Datensicherung — /api/admin/backups (list, create, download).       */
/* ------------------------------------------------------------------ */

import { useQuery } from "@tanstack/react-query";

import { parseOrThrow } from "@/lib/api";

export type BackupItem = {
  name: string;
  size: number;
  createdAt: string;
  offsite: boolean;
};

export type BackupOverview =
  | {
      enabled: true;
      backups: BackupItem[];
      config: {
        dir: string;
        keep: number;
        intervalHours: number;
        /** "bucket/prefix/backups/" or null when no S3 is configured. */
        offsite: string | null;
        /** The live database file a restore replaces ("" = unknown). */
        dbPath?: string;
        /** Where uploaded documents live. */
        files?: string | null;
      };
    }
  | { enabled: false; message: string; backups: BackupItem[] };

export function backupDownloadUrl(name: string): string {
  return `/api/admin/backups/${encodeURIComponent(name)}`;
}

export function useBackups() {
  const query = useQuery({
    queryKey: ["admin-backups"],
    queryFn: async () => parseOrThrow<BackupOverview>(await fetch("/api/admin/backups")),
  });
  return {
    overview: query.data ?? null,
    loading: query.isPending,
    error: query.error,
    refresh: query.refetch,
  };
}

export async function createBackupNow(): Promise<BackupItem & { offsiteError?: string }> {
  return parseOrThrow(await fetch("/api/admin/backups", { method: "POST" }));
}
