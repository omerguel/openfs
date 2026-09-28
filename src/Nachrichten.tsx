/* ------------------------------------------------------------------ */
/* Nachrichten — E-Mail-Postausgang (/nachrichten). Lists the outbox   */
/* with status, lets the office resend, copy unsent mails by hand and  */
/* write a free-text mail. Also hosts the notification toggles and a   */
/* banner when SMTP is not configured. Data: use-mail.ts.              */
/* ------------------------------------------------------------------ */

import { useEffect, useMemo, useState } from "react";
import { Copy, Mail, Plus, RotateCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import {
  queueGenericMail,
  retryOutboxEntry,
  saveNotificationSettings,
  useMailStatus,
  useNotificationSettings,
  useOutbox,
  type MailKind,
  type NotificationSettings,
  type OutboxEntry,
  type OutboxStatus,
} from "@/hooks/use-mail";
import { useStudents } from "@/hooks/use-students";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const STATUS_META: Record<OutboxStatus, { label: string; dot: string }> = {
  wartend: { label: "Wartend", dot: "bg-amber-500" },
  gesendet: { label: "Gesendet", dot: "bg-green-500" },
  fehlgeschlagen: { label: "Fehlgeschlagen", dot: "bg-red-500" },
  nicht_konfiguriert: { label: "Nicht versendet", dot: "bg-muted-foreground/50" },
};

const KIND_LABEL: Record<MailKind, string> = {
  request_confirmed: "Terminbestätigung",
  request_declined: "Anfrage abgelehnt",
  lesson_reminder: "Erinnerung",
  lesson_cancelled: "Terminabsage",
  portal_link: "Portal-Link",
  generic: "Freitext",
};

type StatusFilter = "all" | OutboxStatus;

const POLL_INTERVAL_MS = 30_000;

/* SQLite datetime('now') is UTC without a zone marker. */
const dateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "short",
  timeStyle: "short",
});
function formatCreatedAt(value: string): string {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

function StatusBadge({ status }: { status: OutboxStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span aria-hidden className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </Badge>
  );
}

async function copyMail(entry: OutboxEntry) {
  const text = `An: ${entry.recipient}\nBetreff: ${entry.subject}\n\n${entry.bodyText}`;
  try {
    await navigator.clipboard.writeText(text);
    toast.success("E-Mail in die Zwischenablage kopiert.");
  } catch {
    toast.error("Kopieren nicht möglich.");
  }
}

/* ------------------------- notification toggles -------------------- */

const TOGGLES: { key: keyof NotificationSettings; label: string; hint: string }[] = [
  {
    key: "appointmentMails",
    label: "Terminanfragen",
    hint: "Bestätigung oder Absage an die anfragende Person",
  },
  {
    key: "lessonReminders",
    label: "Erinnerungen",
    hint: "Am Vortag für Fahrstunden und Prüfungen",
  },
  {
    key: "lessonCancellations",
    label: "Terminabsagen",
    hint: "Wenn ein Termin gestrichen wird",
  },
];

function NotificationToggles() {
  const { settings, refresh } = useNotificationSettings();

  const toggle = async (key: keyof NotificationSettings, value: boolean) => {
    try {
      await saveNotificationSettings({ [key]: value });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    }
  };

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-3 border-b border-border/70 px-3 py-3">
      <span className="w-full text-sm font-medium sm:w-auto sm:self-center">
        Automatische E-Mails
      </span>
      {TOGGLES.map(({ key, label, hint }) => (
        <label
          key={key}
          htmlFor={`notify-${key}`}
          className="flex cursor-pointer items-center gap-2.5"
        >
          <Switch
            id={`notify-${key}`}
            checked={settings?.[key] ?? true}
            disabled={!settings}
            onCheckedChange={(value) => void toggle(key, value)}
          />
          <span className="flex flex-col">
            <span className="text-sm">{label}</span>
            <span className="text-[11px] text-muted-foreground">{hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/* ----------------------------- dialogs ---------------------------- */

function NewMailDialog({
  open,
  onOpenChange,
  onQueued,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onQueued: () => void;
}) {
  const { students } = useStudents();
  const withEmail = useMemo(
    () => students.filter((student) => student.email.trim()),
    [students],
  );
  const [studentId, setStudentId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) return;
    setStudentId("");
    setRecipient("");
    setSubject("");
    setBody("");
  }, [open]);

  const pickStudent = (value: string) => {
    setStudentId(value);
    const student = withEmail.find((item) => String(item.id) === value);
    if (student) setRecipient(student.email);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    try {
      await queueGenericMail({
        recipient,
        subject,
        body,
        studentId: studentId ? Number(studentId) : undefined,
      });
      toast.success("E-Mail in den Postausgang gelegt.");
      onOpenChange(false);
      onQueued();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Senden fehlgeschlagen.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Neue E-Mail</DialogTitle>
            <DialogDescription>
              Die Signatur der Fahrschule wird automatisch angehängt.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor="mail-student">Fahrschüler/in</FieldLabel>
              <Select value={studentId} onValueChange={pickStudent}>
                <SelectTrigger id="mail-student" className="w-full">
                  <SelectValue placeholder="Aus Fahrschülern mit E-Mail wählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {withEmail.map((student) => (
                      <SelectItem key={student.id} value={String(student.id)}>
                        {student.firstName} {student.lastName}
                        <span className="text-muted-foreground"> · {student.email}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="mail-recipient">Empfänger</FieldLabel>
              <Input
                id="mail-recipient"
                type="email"
                value={recipient}
                onChange={(event) => {
                  setRecipient(event.target.value);
                  setStudentId("");
                }}
                placeholder="name@beispiel.de"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mail-subject">Betreff</FieldLabel>
              <Input
                id="mail-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={200}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mail-body">Nachricht</FieldLabel>
              <Textarea
                id="mail-body"
                rows={7}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
              />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Abbrechen
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={sending || !recipient.trim() || !subject.trim() || !body.trim()}
            >
              Senden
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MailDetailDialog({
  entry,
  onOpenChange,
  onRetry,
}: {
  entry: OutboxEntry | null;
  onOpenChange: (open: boolean) => void;
  onRetry: (entry: OutboxEntry) => void;
}) {
  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {entry && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{entry.subject}</DialogTitle>
              <DialogDescription>
                An {entry.recipient} · {KIND_LABEL[entry.kind] ?? entry.kind} ·{" "}
                <span className="tabular-nums">{formatCreatedAt(entry.createdAt)}</span>
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge status={entry.status} />
              {entry.attempts > 0 && (
                <span className="tabular-nums">{entry.attempts} Versuch(e)</span>
              )}
              {entry.lastError && (
                <span className="text-red-700 dark:text-red-400">{entry.lastError}</span>
              )}
            </div>
            <pre className="max-h-[50vh] overflow-auto rounded-md border bg-muted/40 p-3 font-sans text-sm whitespace-pre-wrap">
              {entry.bodyText}
            </pre>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => void copyMail(entry)}
              >
                <Copy data-icon="inline-start" />
                Kopieren
              </Button>
              {entry.status !== "wartend" && (
                <Button type="button" onClick={() => onRetry(entry)}>
                  <RotateCw data-icon="inline-start" />
                  Erneut senden
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- page ------------------------------ */

export function Nachrichten() {
  const { items, loading, refresh } = useOutbox();
  const mailStatus = useMailStatus();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter(
      (entry) =>
        (statusFilter === "all" || entry.status === statusFilter) &&
        (!needle ||
          entry.recipient.toLowerCase().includes(needle) ||
          entry.subject.toLowerCase().includes(needle)),
    );
  }, [items, query, statusFilter]);

  const detail = items.find((entry) => entry.id === detailId) ?? null;
  const unsent = items.filter((entry) => entry.status !== "gesendet").length;

  const retry = async (entry: OutboxEntry) => {
    try {
      await retryOutboxEntry(entry.id);
      await refresh();
      toast.success("E-Mail wird erneut gesendet.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Aktion fehlgeschlagen.");
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Empfänger oder Betreff…"
              aria-label="Nachrichten durchsuchen"
              className="hidden w-48 sm:flex lg:w-64"
            />
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as StatusFilter)}
            >
              <SelectTrigger className="hidden w-40 md:flex" aria-label="Status filtern">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">Alle Status</SelectItem>
                  {(Object.keys(STATUS_META) as OutboxStatus[]).map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_META[status].label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button type="button" size="sm" onClick={() => setIsNewOpen(true)}>
              <Plus data-icon="inline-start" />
              Neue E-Mail
            </Button>
          </>
        }
      >
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">
            Nachrichten
          </h1>
          <span className="hidden text-[11px] text-muted-foreground tabular-nums sm:inline">
            {items.length} E-Mails · {unsent} nicht gesendet
          </span>
        </div>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-sm rounded-b-lg border border-border/70 bg-background">
        {mailStatus && !mailStatus.configured && (
          <div className="border-b border-border/70 p-3">
            <Alert>
              <TriangleAlert />
              <AlertTitle>E-Mail-Versand ist nicht eingerichtet</AlertTitle>
              <AlertDescription>
                Es sind keine SMTP-Zugangsdaten hinterlegt (SMTP_HOST, SMTP_PORT,
                SMTP_USER, SMTP_PASS, SMTP_FROM). E-Mails bleiben im Postausgang und
                können geöffnet und von Hand kopiert werden.
              </AlertDescription>
            </Alert>
          </div>
        )}

        <NotificationToggles />

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-9 rounded-md" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <Empty className="min-h-64 border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Mail />
                </EmptyMedia>
                <EmptyTitle>
                  {items.length === 0 ? "Noch keine E-Mails" : "Keine Treffer"}
                </EmptyTitle>
                <EmptyDescription>
                  {items.length === 0
                    ? "Bestätigungen, Erinnerungen und eigene Nachrichten erscheinen hier."
                    : "Filter anpassen, um weitere E-Mails zu sehen."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Status</TableHead>
                  <TableHead>Empfänger</TableHead>
                  <TableHead>Betreff</TableHead>
                  <TableHead className="hidden lg:table-cell">Art</TableHead>
                  <TableHead className="hidden md:table-cell">Erstellt</TableHead>
                  <TableHead className="w-24 text-right">
                    <span className="sr-only">Aktionen</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((entry) => (
                  <TableRow
                    key={entry.id}
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() => setDetailId(entry.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setDetailId(entry.id);
                      }
                    }}
                  >
                    <TableCell>
                      <StatusBadge status={entry.status} />
                    </TableCell>
                    <TableCell className="max-w-48 truncate">{entry.recipient}</TableCell>
                    <TableCell className="max-w-80 truncate">{entry.subject}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {KIND_LABEL[entry.kind] ?? entry.kind}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground tabular-nums md:table-cell">
                      {formatCreatedAt(entry.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`E-Mail an ${entry.recipient} kopieren`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void copyMail(entry);
                          }}
                        >
                          <Copy />
                        </Button>
                        {entry.status !== "wartend" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`E-Mail an ${entry.recipient} erneut senden`}
                            onClick={(event) => {
                              event.stopPropagation();
                              void retry(entry);
                            }}
                          >
                            <RotateCw />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <NewMailDialog
        open={isNewOpen}
        onOpenChange={setIsNewOpen}
        onQueued={() => void refresh()}
      />
      <MailDetailDialog
        entry={detail}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        onRetry={(entry) => void retry(entry)}
      />
    </div>
  );
}

export default Nachrichten;
