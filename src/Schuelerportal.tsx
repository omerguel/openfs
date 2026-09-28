/* ------------------------------------------------------------------ */
/* Schülerportal — /portal/$token                                       */
/* Public, token-gated page for one student; rendered outside the staff */
/* app shell (like /anfrage). Mobile-first: school header, next and    */
/* past lessons, Ausbildungsstand, Guthaben/offene Rechnungen, the     */
/* uploaded documents (names only) and a chat thread with the school   */
/* (polls every 15 s). Data: use-portal.ts. Tone: students are         */
/* addressed with "du", like the public /anfrage form.                 */
/* ------------------------------------------------------------------ */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { CalendarDays, FileText, Link2Off, Mail, Phone, Send } from "lucide-react";

import {
  PortalError,
  sendPortalMessage,
  usePortalMessages,
  usePortalOverview,
  type PortalMessage,
  type PortalOverview,
} from "@/hooks/use-portal";
import { formatEuro } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { LegalLinks } from "@/components/legal/LegalPage";

type Lesson = PortalOverview["upcomingLessons"][number];

const LESSON_LABEL: Record<string, string> = {
  Praktisch: "Fahrstunde",
  Theorie: "Theorieunterricht",
  "Vorstellung zur prakt. Prüfung": "Praktische Prüfung",
  Theorieprüfung: "Theorieprüfung",
  Andere: "Termin",
};

const dayFormatter = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});
const fullDayFormatter = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  timeZone: "UTC",
});

const formatDay = (iso: string, full = false) => {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return (full ? fullDayFormatter : dayFormatter).format(date);
};

/* SQLite datetime('now') is UTC without a zone marker. */
const formatSentAt = (sentAt: string) => {
  const date = new Date(`${sentAt.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime())
    ? sentAt
    : date.toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
};

const hasInstructor = (name: string) => name && name !== "Nicht zugeteilt";

function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="text-sm font-medium">{title}</h2>
        {aside}
      </div>
      <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
        {children}
      </div>
    </section>
  );
}

function LessonRow({ lesson, muted }: { lesson: Lesson; muted?: boolean }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <div
        className={cn(
          "w-20 shrink-0 text-sm tabular-nums",
          muted ? "text-muted-foreground" : "font-medium",
        )}
      >
        {formatDay(lesson.date)}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate text-sm", muted && "text-muted-foreground")}>
          {LESSON_LABEL[lesson.type] ?? lesson.type}
        </span>
        {hasInstructor(lesson.instructor) && (
          <span className="truncate text-xs text-muted-foreground">
            mit {lesson.instructor}
          </span>
        )}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {lesson.start}–{lesson.end}
      </span>
    </li>
  );
}

function Readout({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          "truncate text-sm font-semibold tabular-nums",
          tone === "positive" && "text-green-700 dark:text-green-400",
          tone === "negative" && "text-red-700 dark:text-red-400",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Chat({ token, schoolName }: { token: string; schoolName: string }) {
  const messagesQuery = usePortalMessages(token, true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messages: PortalMessage[] = messagesQuery.data ?? [];

  useEffect(() => {
    if (messages.length > 0) bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      await sendPortalMessage(token, text);
      setDraft("");
      await messagesQuery.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Senden fehlgeschlagen.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Section title={`Nachrichten an die ${schoolName}`}>
      <div className="flex max-h-[28rem] min-h-32 flex-col gap-2 overflow-y-auto p-3">
        {messagesQuery.isPending ? (
          <Skeleton className="h-10 w-2/3 rounded-xl" />
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Noch keine Nachrichten. Schreib uns, wenn du Fragen hast oder einen Termin
            verschieben möchtest.
          </p>
        ) : (
          messages.map((message) => {
            const own = message.sender === "schueler";
            return (
              <div
                key={message.id}
                className={cn("flex", own ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "flex max-w-[85%] flex-col gap-0.5 rounded-xl px-3 py-2",
                    own
                      ? "rounded-br-sm bg-primary text-primary-foreground"
                      : "rounded-bl-sm bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "text-[11px] font-medium",
                      own ? "text-primary-foreground/80" : "text-muted-foreground",
                    )}
                  >
                    {own ? "Du" : schoolName}
                  </span>
                  <p className="text-sm break-words whitespace-pre-wrap">
                    {message.text}
                  </p>
                  <span
                    className={cn(
                      "self-end text-[10px] tabular-nums",
                      own ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    {formatSentAt(message.sentAt)}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={(event) => void send(event)}
        className="flex items-end gap-2 border-t border-border/70 p-2"
      >
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Nachricht schreiben…"
          aria-label="Nachricht schreiben"
          rows={1}
          maxLength={2000}
          className="min-h-10 resize-none"
        />
        <Button
          type="submit"
          size="icon"
          disabled={sending || !draft.trim()}
          aria-label="Nachricht senden"
        >
          {sending ? <Spinner /> : <Send />}
        </Button>
      </form>
      {error && (
        <p className="border-t border-border/70 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </Section>
  );
}

const PAST_PREVIEW = 5;

const formatMinutes = (minutes: number) =>
  minutes % 60 === 0
    ? `${minutes / 60} Std.`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")} Std.`;

function ProgressRow({
  label,
  value,
  done,
  total,
}: {
  label: string;
  value: string;
  done: number;
  total: number;
}) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate">{label}</span>
        <span
          className={cn(
            "shrink-0 text-xs tabular-nums",
            done >= total
              ? "text-green-700 dark:text-green-400"
              : "text-muted-foreground",
          )}
        >
          {value}
        </span>
      </div>
      <Progress value={percent} aria-label={`${label}: ${value}`} className="h-1.5" />
    </li>
  );
}

function TrainingProgress({ progress }: { progress: PortalOverview["progress"] }) {
  return (
    <Section title="Dein Ausbildungsstand">
      <ul className="divide-y divide-border/70">
        <li className="flex items-baseline justify-between gap-2 px-3 py-2.5 text-sm">
          <span>Fahrstunden bisher</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {progress.practicalLessons}{" "}
            {progress.practicalLessons === 1 ? "Termin" : "Termine"} ·{" "}
            {formatMinutes(progress.practicalMinutes)}
          </span>
        </li>
        {progress.specialDrives.map((drive) => (
          <ProgressRow
            key={drive.kind}
            label={drive.kind}
            value={`${drive.completedMinutes} von ${drive.requiredMinutes} Min. (Pflicht)`}
            done={drive.completedMinutes}
            total={drive.requiredMinutes}
          />
        ))}
        <ProgressRow
          label="Theorieunterricht"
          value={`${progress.theory.attended} von ${progress.theory.required} Doppelstunden`}
          done={progress.theory.attended}
          total={progress.theory.required}
        />
      </ul>
    </Section>
  );
}

function OpenInvoices({ invoices }: { invoices: PortalOverview["openInvoices"] }) {
  if (invoices.length === 0) return null;
  return (
    <Section title="Offene Rechnungen">
      <ul className="divide-y divide-border/70">
        {invoices.map((invoice) => (
          <li key={invoice.invoiceNr} className="flex items-center gap-3 px-3 py-2.5">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-mono text-[13px]">{invoice.invoiceNr}</span>
              <span
                className={cn(
                  "text-xs tabular-nums",
                  invoice.overdue
                    ? "text-red-700 dark:text-red-400"
                    : "text-muted-foreground",
                )}
              >
                {invoice.overdue ? "Überfällig seit" : "Fällig am"}{" "}
                {formatDay(invoice.dueDate)}
              </span>
            </div>
            <span className="shrink-0 text-sm font-medium tabular-nums">
              {formatEuro(invoice.openCents)}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Documents({ documents }: { documents: PortalOverview["documents"] }) {
  return (
    <Section title="Deine Dokumente">
      {documents.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          Noch keine Dokumente hinterlegt. Sehtest, Erste-Hilfe-Nachweis und Passbild
          gibst du direkt in der Fahrschule ab.
        </p>
      ) : (
        <ul className="divide-y divide-border/70">
          {documents.map((document, index) => (
            <li
              key={`${document.name}-${index}`}
              className="flex items-center gap-3 px-3 py-2.5 text-sm"
            >
              <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{document.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatDay(document.uploadedAt.slice(0, 10))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function PortalContent({ token, data }: { token: string; data: PortalOverview }) {
  const [showAllPast, setShowAllPast] = useState(false);
  const next = data.upcomingLessons[0];
  const balance = data.balanceCents;
  const pastLessons = useMemo(
    () => (showAllPast ? data.pastLessons : data.pastLessons.slice(0, PAST_PREVIEW)),
    [data.pastLessons, showAllPast],
  );

  return (
    <div className="stagger-in flex flex-col gap-5">
      <header className="flex flex-col gap-1 px-1">
        <span className="text-xs text-muted-foreground">
          {data.school.name} · Schülerportal
        </span>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-balance">
            Hallo {data.student.firstName}
          </h1>
          {data.student.classes && (
            <Badge variant="outline" className="font-normal">
              Klasse {data.student.classes}
            </Badge>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 divide-x divide-border/70 overflow-hidden rounded-lg border border-border/70 bg-card">
        <Readout
          label="Nächster Termin"
          value={next ? `${formatDay(next.date)} · ${next.start}` : "Keiner geplant"}
        />
        {balance === null ? (
          <Readout label="Kontostand" value="—" />
        ) : balance < 0 ? (
          <Readout label="Offener Betrag" value={formatEuro(-balance)} tone="negative" />
        ) : (
          <Readout
            label="Guthaben"
            value={formatEuro(balance)}
            tone={balance > 0 ? "positive" : undefined}
          />
        )}
      </div>

      {next && (
        <p className="px-1 text-sm text-pretty text-muted-foreground">
          {LESSON_LABEL[next.type] ?? "Termin"} am{" "}
          <span className="font-medium text-foreground">
            {formatDay(next.date, true)} um {next.start} Uhr
          </span>
          {hasInstructor(next.instructor) ? ` mit ${next.instructor}.` : "."}
        </p>
      )}

      <Section title="Nächste Termine">
        {data.upcomingLessons.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Aktuell sind keine Termine geplant.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {data.upcomingLessons.map((lesson) => (
              <LessonRow
                key={`${lesson.date}-${lesson.start}-${lesson.type}`}
                lesson={lesson}
              />
            ))}
          </ul>
        )}
      </Section>

      {data.progress && <TrainingProgress progress={data.progress} />}

      <Chat token={token} schoolName={data.school.name} />

      {data.openInvoices && <OpenInvoices invoices={data.openInvoices} />}

      {data.documents && <Documents documents={data.documents} />}

      <Section
        title="Vergangene Termine"
        aside={
          data.attestationCount > 0 ? (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {data.attestationCount} Stunden im Ausbildungsnachweis
            </span>
          ) : undefined
        }
      >
        {data.pastLessons.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Noch keine vergangenen Termine.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border/70">
              {pastLessons.map((lesson) => (
                <LessonRow
                  key={`${lesson.date}-${lesson.start}-${lesson.type}`}
                  lesson={lesson}
                  muted
                />
              ))}
            </ul>
            {data.pastLessons.length > PAST_PREVIEW && (
              <button
                type="button"
                onClick={() => setShowAllPast((value) => !value)}
                className="w-full border-t border-border/70 px-3 py-2.5 text-sm text-primary transition-colors duration-150 hover:bg-muted/60 hover:duration-0 focus-visible:bg-muted/60 focus-visible:outline-none"
              >
                {showAllPast
                  ? "Weniger anzeigen"
                  : `Alle ${data.pastLessons.length} anzeigen`}
              </button>
            )}
          </>
        )}
      </Section>

      <footer className="flex flex-col gap-2 px-1 pb-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{data.school.name}</span>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {data.school.phone && (
            <a
              href={`tel:${data.school.phone.replace(/[^\d+]/g, "")}`}
              className="inline-flex min-h-10 items-center gap-1.5 tabular-nums hover:text-foreground"
            >
              <Phone className="size-4" />
              {data.school.phone}
            </a>
          )}
          {data.school.email && (
            <a
              href={`mailto:${data.school.email}`}
              className="inline-flex min-h-10 items-center gap-1.5 hover:text-foreground"
            >
              <Mail className="size-4" />
              {data.school.email}
            </a>
          )}
        </div>
      </footer>
    </div>
  );
}

export function Schuelerportal() {
  const { token } = useParams({ from: "/portal/$token" });
  const overview = usePortalOverview(token);

  return (
    <div className="min-h-svh bg-background px-4 py-6 sm:py-10">
      {/* The token is the credential — keep it out of Referer headers. */}
      <meta name="referrer" content="no-referrer" />
      <title>Schülerportal</title>
      <main className="mx-auto w-full max-w-lg">
        {overview.isPending ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-40 rounded-lg" />
          </div>
        ) : overview.isError ? (
          <Empty className="min-h-[60svh]">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {overview.error instanceof PortalError &&
                overview.error.status === 404 ? (
                  <Link2Off />
                ) : (
                  <CalendarDays />
                )}
              </EmptyMedia>
              <EmptyTitle>
                {overview.error instanceof PortalError && overview.error.status === 404
                  ? "Link ungültig"
                  : "Portal nicht erreichbar"}
              </EmptyTitle>
              <EmptyDescription>
                {overview.error instanceof PortalError && overview.error.status === 404
                  ? "Dieser Link ist ungültig oder wurde widerrufen. Bitte wende dich an deine Fahrschule."
                  : overview.error.message}
              </EmptyDescription>
            </EmptyHeader>
            <Button
              type="button"
              variant="outline"
              onClick={() => void overview.refetch()}
            >
              Erneut versuchen
            </Button>
          </Empty>
        ) : (
          <PortalContent token={token} data={overview.data} />
        )}
        <footer className="px-1 pb-4">
          <LegalLinks />
        </footer>
      </main>
    </div>
  );
}

export default Schuelerportal;
