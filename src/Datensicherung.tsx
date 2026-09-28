/* ------------------------------------------------------------------ */
/* Datensicherung — automatische SQLite-Sicherungen (data/backups,     */
/* optional offsite in S3), manuelles „Jetzt sichern", Downloads, der  */
/* ZIP-Datenexport, die .db-Kopie und eine Anleitung zur Wiederherstel-*/
/* lung mit dem echten Datenbankpfad. Nur für Inhaber (Route-Guard).   */
/* Daten kommen aus /api/admin/backups (use-backups).                  */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import {
  Cloud,
  DatabaseBackup,
  Download,
  FileArchive,
  HardDrive,
  Info,
} from "lucide-react";
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

function Code({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[13px] break-all text-foreground">{children}</span>
  );
}

export function Datensicherung() {
  const { overview, loading, refresh } = useBackups();
  const [creating, setCreating] = useState(false);
  const enabled = overview?.enabled === true;
  const config = overview?.enabled ? overview.config : null;
  const dbPath = config?.dbPath || "data/fahrschule.db";

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
          <Button
            type="button"
            size="sm"
            disabled={!enabled || creating}
            title={
              enabled
                ? undefined
                : overview?.enabled === false
                  ? overview.message
                  : undefined
            }
            onClick={backupNow}
          >
            <DatabaseBackup data-icon="inline-start" />
            {creating ? "Sichert …" : "Jetzt sichern"}
          </Button>
        }
      >
        <h1 className="text-sm font-medium">Datensicherung</h1>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        <div className="stagger-in mx-auto flex w-full max-w-3xl flex-col gap-8">
          {overview && !overview.enabled ? (
            <Alert>
              <Info />
              <AlertTitle>Automatische Sicherungen sind aus</AlertTitle>
              <AlertDescription>{overview.message}</AlertDescription>
            </Alert>
          ) : config ? (
            <p className="text-sm text-pretty text-muted-foreground">
              OpenFS sichert automatisch alle {config.intervalHours} Stunden; die neuesten{" "}
              {config.keep} Sicherungen bleiben erhalten. Ablage auf dem Server:{" "}
              <Code>{config.dir}</Code>
              {config.offsite ? (
                <>
                  , zusätzlich außer Haus in <Code>{config.offsite}</Code>
                </>
              ) : (
                <>
                  . Es ist keine Kopie außer Haus eingerichtet — laden Sie regelmäßig eine
                  Sicherung herunter oder bitten Sie Ihren Betreuer, einen S3-Speicher
                  einzurichten.
                </>
              )}
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
                      : (overview?.enabled === false && overview.message) ||
                        "Automatische Sicherungen sind nicht eingerichtet."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              overview.backups.map((backup) => (
                <BackupRow key={backup.name} backup={backup} />
              ))
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-medium">Daten herunterladen</h2>
              <p className="text-sm text-pretty text-muted-foreground">
                Zwei Formate für zwei Zwecke:
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <FileArchive className="size-4" />
                  Datenexport (ZIP mit CSV)
                </span>
                <p className="flex-1 text-xs text-pretty text-muted-foreground">
                  Schüler, Rechnungen, Buchungen, Termine u. a. als Tabellen für Excel —
                  plus alle hochgeladenen Dokumente. Zum Ansehen, Archivieren oder für den
                  Steuerberater.
                </p>
                <Button asChild variant="outline" size="sm" className="w-fit">
                  <a href="/api/export/zip" download>
                    <Download data-icon="inline-start" />
                    ZIP herunterladen
                  </a>
                </Button>
              </div>
              <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <HardDrive className="size-4" />
                  Datenbank-Sicherung (.db)
                </span>
                <p className="flex-1 text-xs text-pretty text-muted-foreground">
                  Eine vollständige Kopie der Datenbank in diesem Moment — die Datei, mit
                  der sich OpenFS wiederherstellen lässt. Ohne Dokumente.
                </p>
                <Button asChild variant="outline" size="sm" className="w-fit">
                  <a href="/api/export/database" download>
                    <Download data-icon="inline-start" />
                    .db herunterladen
                  </a>
                </Button>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Wiederherstellen — so geht es</h2>
            <p className="text-sm text-pretty text-muted-foreground">
              Eine Wiederherstellung setzt OpenFS auf den Stand der gewählten Sicherung
              zurück; alles, was danach eingegeben wurde, ist dann weg. Am besten erledigt
              das die Person, die Ihren Server betreut:
            </p>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-pretty text-muted-foreground">
              <li>OpenFS (den Server) beenden.</li>
              <li>
                Die aktuelle Datenbank-Datei <Code>{dbPath}</Code> samt der Dateien{" "}
                <Code>{dbPath}-wal</Code> und <Code>{dbPath}-shm</Code> (falls vorhanden)
                beiseitelegen — nicht löschen.
              </li>
              <li>
                Die gewünschte Sicherung herunterladen (oder aus{" "}
                <Code>{config?.dir ?? "data/backups"}</Code> nehmen) und unter genau
                diesem Namen ablegen: <Code>{dbPath}</Code>.
              </li>
              <li>OpenFS wieder starten und kurz prüfen, ob die Daten stimmen.</li>
            </ol>
            <p className="text-xs text-pretty text-muted-foreground">
              Hochgeladene Dokumente stecken nicht in der Datenbank, sondern im
              Dateispeicher
              {config?.files ? (
                <>
                  {" "}
                  (<Code>{config.files}</Code>)
                </>
              ) : null}{" "}
              — sichern Sie diesen Ordner zusätzlich, oder nutzen Sie den ZIP-Export.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default Datensicherung;
