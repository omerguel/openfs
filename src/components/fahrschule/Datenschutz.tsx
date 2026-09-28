/* Datenschutz — tab of "Fahrschule & Einstellungen" (Inhaber only).   */
/* Löschfristen and Löschmodus (saved with the tab's own button), the  */
/* Löschvorschau with its confirmation, "Aufbewahrung verlängern", the */
/* Betroffenenrechte per student and the last deletion runs. Rules and */
/* periods: src/lib/retention.ts, engine: src/server/retention.ts.     */

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Lock,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { confirmDialog } from "@/components/confirm";
import {
  AuskunftLinks,
  ErasureDialog,
  germanDate,
  HoldDialog,
} from "@/components/datenschutz/SubjectDialogs";
import { FormField } from "@/components/FormField";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStatus } from "@/hooks/use-auth";
import {
  confirmRetentionRun,
  type RetentionOverview,
  removeRetentionHold,
  saveRetentionPolicy,
  usePrivacySubjects,
  useRetentionOverview,
} from "@/hooks/use-retention";
import {
  formatPeriod,
  periodError,
  RETENTION_CATEGORIES,
  RETENTION_DEFS,
  RETENTION_MODE_LABELS,
  type RetentionCategory,
  type RetentionMode,
} from "@/lib/retention";
import { cn } from "@/lib/utils";

function Section({
  title,
  description,
  end,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  end?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t pt-6 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex max-w-prose flex-col gap-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
          {description && (
            <p className="text-sm text-pretty text-muted-foreground">{description}</p>
          )}
        </div>
        {end}
      </div>
      {children}
    </section>
  );
}

type Draft = { mode: RetentionMode; months: Record<RetentionCategory, string> };

const toDraft = (policy: RetentionOverview["policy"]): Draft => ({
  mode: policy.mode,
  months: Object.fromEntries(
    RETENTION_CATEGORIES.map((c) => [c, String(policy.months[c])]),
  ) as Record<RetentionCategory, string>,
});

function PolicySection({ overview }: { overview: RetentionOverview }) {
  const saved = useMemo(() => toDraft(overview.policy), [overview.policy]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft ?? saved;
  const dirty = JSON.stringify(value) !== JSON.stringify(saved);
  const errors = Object.fromEntries(
    RETENTION_CATEGORIES.map((c) => [
      c,
      value.months[c].trim() === ""
        ? "Bitte eine Zahl angeben."
        : periodError(c, Number(value.months[c])),
    ]),
  ) as Record<RetentionCategory, string | null>;
  const invalid = Object.values(errors).some(Boolean);

  const save = async () => {
    setSaving(true);
    try {
      await saveRetentionPolicy({
        mode: value.mode,
        months: Object.fromEntries(
          RETENTION_CATEGORIES.map((c) => [c, Number(value.months[c])]),
        ) as Record<RetentionCategory, number>,
      });
      setDraft(null);
      toast.success("Löschfristen gespeichert.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Löschmodus und Löschfristen"
      description="Einmal täglich prüft OpenFS, welche Daten ihre Frist erreicht haben. Gesetzlich festgelegte Fristen sind nicht änderbar. Die Datenschutzerklärung (/datenschutz) nennt automatisch die hier gespeicherten Werte."
      end={
        <div className="flex items-center gap-2">
          {dirty && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => setDraft(null)}
            >
              Verwerfen
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={!dirty || invalid || saving}
            onClick={() => void save()}
          >
            <Check data-icon="inline-start" />
            {saving ? "Speichert …" : "Fristen speichern"}
          </Button>
        </div>
      }
    >
      <FormField
        id="retention-mode"
        label="Fällige Daten löschen"
        className="max-w-md"
        hint={
          value.mode === "automatisch"
            ? "Der tägliche Lauf löscht und anonymisiert ohne Rückfrage. Jeder Lauf wird protokolliert."
            : "Fällige Daten erscheinen unten in der Löschvorschau und werden erst gelöscht, wenn Sie den Lauf bestätigen."
        }
      >
        <NativeSelect
          value={value.mode}
          onChange={(event) =>
            setDraft({ ...value, mode: event.target.value as RetentionMode })
          }
        >
          {(["bestaetigung", "automatisch"] as const).map((mode) => (
            <NativeSelectOption key={mode} value={mode}>
              {RETENTION_MODE_LABELS[mode]}
              {mode === "bestaetigung" ? " (empfohlen)" : ""}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FormField>
      <div className="divide-y rounded-lg border">
        {RETENTION_CATEGORIES.map((category) => {
          const def = RETENTION_DEFS[category];
          const fixed = def.minMonths === def.maxMonths;
          const id = `retention-${category}`;
          return (
            <div
              key={category}
              className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_11rem]"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={id} className="text-sm font-medium">
                  {def.label}
                </label>
                <p className="text-xs text-pretty text-muted-foreground">
                  {def.action}. Beginn: {def.start}.
                </p>
                <p className="text-xs text-pretty text-muted-foreground">{def.basis}</p>
                {def.note && (
                  <p className="text-xs text-pretty text-amber-700 dark:text-amber-400">
                    {def.note}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {fixed ? (
                  <div className="flex h-8 items-center gap-1.5 rounded-lg border bg-muted/40 px-2.5 text-sm tabular-nums">
                    <Lock className="size-3.5 text-muted-foreground" />
                    {formatPeriod(def.minMonths)}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      id={id}
                      type="number"
                      inputMode="numeric"
                      min={def.minMonths}
                      max={def.maxMonths}
                      className="w-20 tabular-nums"
                      aria-invalid={errors[category] ? true : undefined}
                      value={value.months[category]}
                      onChange={(event) =>
                        setDraft({
                          ...value,
                          months: { ...value.months, [category]: event.target.value },
                        })
                      }
                    />
                    <span className="text-sm text-muted-foreground">Monate</span>
                  </div>
                )}
                {errors[category] && !fixed ? (
                  <span role="alert" className="text-xs text-destructive">
                    {errors[category]}
                  </span>
                ) : (
                  !fixed && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      = {formatPeriod(Number(value.months[category]) || 0)}
                    </span>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function PreviewSection({ overview }: { overview: RetentionOverview }) {
  const { plan, policy } = overview;
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<RetentionCategory | null>(null);
  const [hold, setHold] = useState<{ id: number; name: string } | null>(null);
  const total = plan.items.length;
  const run = async () => {
    const ok = await confirmDialog({
      title: "Löschlauf ausführen?",
      description:
        "Die in der Vorschau aufgeführten Daten werden endgültig gelöscht bzw. anonymisiert. Das lässt sich nicht rückgängig machen. Ältere Datensicherungen enthalten sie noch, bis diese turnusmäßig überschrieben werden.",
      confirmLabel: "Endgültig löschen",
      destructive: true,
    });
    if (!ok) return;
    setRunning(true);
    try {
      const result = await confirmRetentionRun(plan.hash);
      const summary = Object.entries(result.counts)
        .map(([key, n]) => `${n} × ${RETENTION_DEFS[key as RetentionCategory].label}`)
        .join(", ");
      toast.success("Löschlauf ausgeführt.", { description: summary });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Löschlauf fehlgeschlagen.");
    } finally {
      setRunning(false);
    }
  };
  const due = RETENTION_CATEGORIES.filter((c) => plan.counts[c] > 0);
  return (
    <Section
      title="Löschvorschau"
      description={
        policy.mode === "automatisch"
          ? `Stand ${germanDate(plan.today)}. Der tägliche Lauf löscht diese Daten automatisch; Sie können ihn hier auch sofort ausführen.`
          : `Stand ${germanDate(plan.today)}. Diese Daten haben ihre Frist erreicht und werden gelöscht, sobald Sie den Lauf bestätigen.`
      }
      end={
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={total === 0 || running}
          onClick={() => void run()}
        >
          <Trash2 data-icon="inline-start" />
          {running ? "Löscht …" : "Löschlauf ausführen"}
        </Button>
      }
    >
      {plan.hints.inactiveNotArchived > 0 && (
        <Alert>
          <AlertCircle />
          <AlertDescription>
            {plan.hints.inactiveNotArchived} inaktive Fahrschüler/innen sind nicht
            archiviert. Die Fristen für Stammdaten, Dokumente und Chat beginnen erst mit
            der Archivierung (Ende der Ausbildung).
          </AlertDescription>
        </Alert>
      )}
      {due.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border px-3 py-3 text-sm text-muted-foreground">
          <ShieldCheck className="size-4" />
          Zurzeit ist nichts fällig.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {due.map((category) => {
            const items = plan.items.filter((item) => item.category === category);
            const expanded = open === category;
            return (
              <li key={category}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : category)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors duration-150 outline-none hover:bg-muted hover:duration-0 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <ChevronRight
                    className={cn(
                      "size-4 text-muted-foreground transition-transform",
                      expanded && "rotate-90",
                    )}
                  />
                  <span className="flex-1 font-medium">
                    {RETENTION_DEFS[category].label}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {plan.counts[category]}
                  </span>
                </button>
                {expanded && (
                  <ul className="border-t bg-muted/20 px-3 py-1.5 text-sm">
                    {items.slice(0, 100).map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1"
                      >
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          seit {germanDate(item.since)}
                        </span>
                        {item.studentId !== undefined && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() =>
                              setHold({ id: item.studentId!, name: item.label })
                            }
                          >
                            <Lock data-icon="inline-start" />
                            Aufbewahren
                          </Button>
                        )}
                      </li>
                    ))}
                    {items.length > 100 && (
                      <li className="py-1 text-xs text-muted-foreground">
                        … und {items.length - 100} weitere
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hold && (
        <HoldDialog
          studentId={hold.id}
          name={hold.name}
          open
          onOpenChange={(next) => !next && setHold(null)}
        />
      )}
    </Section>
  );
}

function HoldsSection({ overview }: { overview: RetentionOverview }) {
  const lift = async (studentId: number) => {
    try {
      await removeRetentionHold(studentId);
      toast.success("Aufbewahrung aufgehoben.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Aufheben fehlgeschlagen.");
    }
  };
  return (
    <Section
      title="Aufbewahrung verlängert"
      description="Personen, deren Daten der Löschlauf vorerst nicht anfasst (Rechtsstreit, offene Forderung, Betriebsprüfung)."
    >
      {overview.holds.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine Verlängerungen eingetragen.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {overview.holds.map((hold) => (
            <li
              key={hold.studentId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{hold.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {hold.reason}
                  {hold.until ? ` · bis ${germanDate(hold.until)}` : " · unbefristet"}
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void lift(hold.studentId)}
              >
                Aufheben
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const STATUS_LABEL = {
  aktiv: "aktiv",
  inaktiv: "inaktiv",
  archiviert: "archiviert",
  anonymisiert: "anonymisiert",
} as const;

function SubjectsSection() {
  const subjects = usePrivacySubjects();
  const [selected, setSelected] = useState("");
  const [dialog, setDialog] = useState<"hold" | "erase" | null>(null);
  const subject = subjects.data?.find((s) => String(s.studentId) === selected) ?? null;
  return (
    <Section
      title="Betroffenenrechte"
      description="Auskunft (Art. 15 DSGVO) und Löschung auf Antrag (Art. 17 DSGVO) für aktive und archivierte Fahrschüler/innen. Antworten Sie innerhalb eines Monats (Art. 12 Abs. 3 DSGVO)."
    >
      <div className="flex flex-col gap-3">
        <FormField id="privacy-subject" label="Person" className="max-w-md">
          <NativeSelect
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            disabled={subjects.isPending}
          >
            <NativeSelectOption value="">Bitte wählen …</NativeSelectOption>
            {subjects.data?.map((s) => (
              <NativeSelectOption key={s.studentId} value={String(s.studentId)}>
                {s.name} · {STATUS_LABEL[s.status]}
                {s.customerNumber ? ` · ${s.customerNumber}` : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        {subject && (
          <div className="flex flex-col gap-3 rounded-lg border px-3 py-3">
            <div className="text-sm">
              <span className="font-medium">{subject.name}</span>
              <span className="text-muted-foreground">
                {" "}
                · {STATUS_LABEL[subject.status]}
                {subject.archivedOn ? ` seit ${germanDate(subject.archivedOn)}` : ""}
                {subject.hold ? " · Aufbewahrung verlängert" : ""}
                {subject.erasure?.kind === "antrag" && subject.erasure.retainedUntil
                  ? ` · gesperrt bis ${germanDate(subject.erasure.retainedUntil)}`
                  : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <AuskunftLinks studentId={subject.studentId} />
              {subject.status !== "anonymisiert" && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={Boolean(subject.hold)}
                    onClick={() => setDialog("hold")}
                  >
                    <Lock data-icon="inline-start" />
                    Aufbewahrung verlängern
                  </Button>
                  {subject.erasure?.kind !== "antrag" && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => setDialog("erase")}
                    >
                      <Trash2 data-icon="inline-start" />
                      Löschen auf Antrag
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {subject && dialog === "hold" && (
        <HoldDialog
          studentId={subject.studentId}
          name={subject.name}
          open
          onOpenChange={(next) => !next && setDialog(null)}
        />
      )}
      {subject && dialog === "erase" && (
        <ErasureDialog
          studentId={subject.studentId}
          open
          onOpenChange={(next) => !next && setDialog(null)}
        />
      )}
    </Section>
  );
}

const TRIGGER_LABEL = {
  automatisch: "Automatisch",
  bestaetigt: "Bestätigt",
  antrag: "Auf Antrag",
} as const;

function RunsSection({ overview }: { overview: RetentionOverview }) {
  return (
    <Section
      title="Letzte Löschläufe"
      description="Nur Anzahlen – die gelöschten Inhalte selbst werden nicht protokolliert."
    >
      {overview.runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch kein Löschlauf.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {overview.runs.map((run) => (
            <li key={run.id} className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="tabular-nums">{germanDate(run.at)}</span>
              <span className="text-muted-foreground">
                {TRIGGER_LABEL[run.trigger]}
                {run.userName ? ` · ${run.userName}` : ""}
              </span>
              <span className="w-full text-xs text-muted-foreground tabular-nums">
                {Object.entries(run.counts)
                  .map(
                    ([key, n]) =>
                      `${n} × ${RETENTION_DEFS[key as RetentionCategory]?.label ?? key}`,
                  )
                  .join(", ") || "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function DatenschutzSettings() {
  const isOwner = useAuthStatus().data?.user?.role === "inhaber";
  const overview = useRetentionOverview(isOwner);
  if (!isOwner) {
    return (
      <Alert>
        <Lock />
        <AlertTitle>Nur für die Inhaberin bzw. den Inhaber</AlertTitle>
        <AlertDescription>
          Löschfristen, Löschläufe und Anfragen nach Art. 15/17 DSGVO verwaltet die
          Inhaberin bzw. der Inhaber der Fahrschule.
        </AlertDescription>
      </Alert>
    );
  }
  if (overview.isPending) {
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }
  if (overview.isError || !overview.data) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertDescription>
          Die Datenschutz-Einstellungen konnten nicht geladen werden.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void overview.refetch()}
          >
            Erneut versuchen
          </button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <PolicySection overview={overview.data} />
      <PreviewSection overview={overview.data} />
      <HoldsSection overview={overview.data} />
      <SubjectsSection />
      <RunsSection overview={overview.data} />
      <p className="text-xs text-pretty text-muted-foreground">
        Datensicherungen enthalten gelöschte Daten noch so lange, bis sie turnusmäßig
        ersetzt werden (BACKUP_KEEP). Die Fristen sind Vorschläge nach dem Löschkonzept
        (docs/datenschutz/loeschkonzept.md) und von Ihrer Steuerberatung bzw.
        Rechtsberatung zu prüfen.
      </p>
    </div>
  );
}
