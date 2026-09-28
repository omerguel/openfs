/* ------------------------------------------------------------------ */
/* Datensicherung — automatische Sicherungen (Datenbank + Dokumente,   */
/* data/backups, optional offsite in S3), manuelles „Jetzt sichern",   */
/* Prüfen, Download als Archiv (.tar), der ZIP-Datenexport, die .db-   */
/* Kopie und die Wiederherstellung (bun run restore). Nur für Inhaber  */
/* (Route-Guard). Daten kommen aus /api/admin/backups (use-backups).   */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import {
  Cloud,
  DatabaseBackup,
  Download,
  FileArchive,
  HardDrive,
  Info,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import {
  backupDownloadUrl,
  createBackupNow,
  useBackups,
  verifyBackup,
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
import { describeBackupContents, missingFilesWarning } from "@/lib/backup-contents";
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
  const [checking, setChecking] = useState(false);
  const missing = missingFilesWarning(backup);
  const isSet = backup.kind === "set";

  const check = async () => {
    setChecking(true);
    try {
      const result = await verifyBackup(backup.name);
      if (result.ok) {
        toast.success("Sicherung ist vollständig und unbeschädigt", {
          description: `${backup.name}: Prüfsummen und Datenbank-Integrität in Ordnung.`,
        });
      } else {
        toast.error("Sicherung ist beschädigt", {
          description: result.problems.slice(0, 3).join(" "),
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Prüfung fehlgeschlagen.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-[13px]">{backup.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatCreatedAt(backup.createdAt)} · {describeBackupContents(backup)} ·{" "}
          {formatStudentDocumentSize(backup.size)}
        </span>
        {missing ? <span className="text-xs text-destructive">{missing}</span> : null}
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={checking}
          onClick={check}
        >
          <ShieldCheck data-icon="inline-start" />
          {checking ? "Prüft …" : "Prüfen"}
        </Button>
        <Button asChild variant="outline" size="sm">
          <a
            href={backupDownloadUrl(backup.name)}
            download={isSet ? `${backup.name}.tar` : backup.name}
            title={
              isSet
                ? "Vollständiges Archiv: Datenbank, Dokumente und Prüfliste (manifest.json)"
                : "Datenbank-Datei (älteres Format, ohne Dokumente)"
            }
          >
            <Download data-icon="inline-start" />
            {isSet ? "Archiv (.tar)" : ".db"}
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
              OpenFS sichert automatisch alle {config.intervalHours} Stunden{" "}
              {config.filesIncluded === false
                ? "die Datenbank (ohne Dokumente)"
                : "die Datenbank und alle hochgeladenen Dokumente"}
              ; die neuesten {config.keep} Sicherungen bleiben erhalten, ältere werden
              samt ihrer Dokumente gelöscht. Jede Sicherung enthält eine Prüfliste mit
              Prüfsummen. Ablage auf dem Server: <Code>{config.dir}</Code>
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
                  Eine Kopie der Datenbank in diesem Moment, ohne Dokumente. Für eine
                  vollständige Sicherung laden Sie oben ein Archiv (.tar) herunter —
                  Datenbank und alle Dokumente.
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
              zurück — Datenbank und Dokumente; alles, was danach eingegeben wurde, ist
              dann weg. Das erledigt die Person, die Ihren Server betreut:
            </p>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-pretty text-muted-foreground">
              <li>
                OpenFS (den Server) beenden, z. B. <Code>systemctl stop openfs</Code>.
              </li>
              <li>
                Im OpenFS-Verzeichnis ausführen:{" "}
                <Code>
                  bun run restore restore{" "}
                  {overview?.backups[0]?.name ?? "openfs-JJJJ-MM-TT-HHMMSS"}
                  {config?.tenant ? ` --tenant ${config.tenant}` : ""}
                </Code>{" "}
                — oder statt des Namens den Pfad zu einem heruntergeladenen Archiv (.tar).
                Das Skript prüft die Sicherung, verweigert die Arbeit, solange der Server
                läuft, und legt die aktuelle Datenbank <Code>{dbPath}</Code> und die
                Dokumente
                {config?.files ? (
                  <>
                    {" "}
                    (<Code>{config.files}</Code>)
                  </>
                ) : null}{" "}
                mit der Endung <Code>.before-restore-…</Code> beiseite, statt sie zu
                löschen.
              </li>
              <li>OpenFS wieder starten und kurz prüfen, ob die Daten stimmen.</li>
            </ol>
            <p className="text-xs text-pretty text-muted-foreground">
              Die ausführliche Anleitung (auch ohne Skript) steht in{" "}
              <Code>docs/operations.md</Code>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

export default Datensicherung;
