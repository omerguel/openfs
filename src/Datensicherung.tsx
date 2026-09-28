/* ------------------------------------------------------------------ */
/* Datensicherung — automatische SQLite-Sicherungen (data/backups,     */
/* optional offsite in S3), manuelles „Jetzt sichern", Downloads, der  */
/* Gesamt-Export und eine kurze Anleitung zur Wiederherstellung.       */
/* Daten kommen aus /api/admin/backups (use-backups).                  */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { Cloud, DatabaseBackup, Download, HardDrive, Info } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import {
  backupDownloadUrl,
  createBackupNow,
  useBackups,
  type BackupItem,
} from "@/hooks/use-backups";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { formatStudentDocumentSize } from "@/lib/student-documents";

const createdAtFormatter = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unbekannt" : createdAtFormatter.format(date);
}

function BackupRow({ backup }: { backup: BackupItem }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-[13px]">{backup.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatCreatedAt(backup.createdAt)} · {formatStudentDocumentSize(backup.size)}
        </span>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Badge variant="outline" className="gap-1.5 font-normal">
          {backup.offsite ? (
            <>
              <Cloud className="size-3.5" />
              Lokal + Offsite
            </>
          ) : (
            <>
              <HardDrive className="size-3.5" />
              Nur lokal
            </>
          )}
        </Badge>
        <Button asChild variant="outline" size="sm">
          <a href={backupDownloadUrl(backup.name)} download={backup.name}>
            <Download data-icon="inline-start" />
            Download
          </a>
        </Button>
      </div>
    </div>
  );
}

export function Datensicherung() {
  const { overview, loading, refresh } = useBackups();
  const [creating, setCreating] = useState(false);
  const enabled = overview?.enabled === true;

  const backupNow = async () => {
    setCreating(true);
    try {
      const backup = await createBackupNow();
      if (backup.offsiteError) {
        toast.warning("Sicherung lokal erstellt, Offsite-Upload fehlgeschlagen", {
          description: backup.offsiteError,
        });
      } else {
        toast.success("Sicherung erstellt", { description: backup.name });
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sicherung fehlgeschlagen.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <>
            <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
              <a href="/api/export/database" download>
                <Download data-icon="inline-start" />
                Gesamt-Export
              </a>
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!enabled || creating}
              onClick={backupNow}
            >
              <DatabaseBackup data-icon="inline-start" />
              {creating ? "Sichert …" : "Jetzt sichern"}
            </Button>
          </>
        }
      >
        <span className="text-sm font-medium">Datensicherung</span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        <div className="stagger-in mx-auto flex w-full max-w-3xl flex-col gap-6">
          {overview && !overview.enabled ? (
            <Alert>
              <Info />
              <AlertTitle>Sicherungen deaktiviert</AlertTitle>
              <AlertDescription>{overview.message}</AlertDescription>
            </Alert>
          ) : overview?.enabled ? (
            <p className="text-sm text-pretty text-muted-foreground">
              Automatisch alle {overview.config.intervalHours} Stunden, die neuesten{" "}
              {overview.config.keep} Sicherungen bleiben erhalten. Ablage:{" "}
              <span className="font-mono text-[13px]">{overview.config.dir}</span>
              {overview.config.offsite ? (
                <>
                  {" "}
                  · offsite in{" "}
                  <span className="font-mono text-[13px]">{overview.config.offsite}</span>
                </>
              ) : (
                " · keine Offsite-Kopie konfiguriert (S3_* Umgebungsvariablen)"
              )}
              .
            </p>
          ) : null}

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Sicherungen</h2>
            {loading ? (
              <>
                <Skeleton className="h-16 rounded-lg" />
                <Skeleton className="h-16 rounded-lg" />
              </>
            ) : !overview || overview.backups.length === 0 ? (
              <Empty className="min-h-40 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <DatabaseBackup />
                  </EmptyMedia>
                  <EmptyTitle>Noch keine Sicherungen</EmptyTitle>
                  <EmptyDescription>
                    {enabled
                      ? "Die erste Sicherung entsteht automatisch – oder jetzt über „Jetzt sichern“."
                      : "Im Demo-Modus werden keine Sicherungen angelegt."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              overview.backups.map((backup) => (
                <BackupRow key={backup.name} backup={backup} />
              ))
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Wiederherstellen</h2>
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-pretty text-muted-foreground">
              <li>Server beenden.</li>
              <li>
                Die gewünschte Sicherung herunterladen (oder aus dem Sicherungsordner
                nehmen) und als{" "}
                <span className="font-mono text-[13px]">data/fahrschule.db</span> ablegen
                – vorher die aktuelle Datei samt{" "}
                <span className="font-mono text-[13px]">-wal</span>/
                <span className="font-mono text-[13px]">-shm</span> beiseitelegen.
              </li>
              <li>Server wieder starten.</li>
            </ol>
            <p className="text-xs text-pretty text-muted-foreground">
              Hochgeladene Dokumente liegen nicht in der Datenbank, sondern im
              Dateispeicher (data/files bzw. S3) und werden separat gesichert.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default Datensicherung;
