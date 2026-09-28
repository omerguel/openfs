/* ------------------------------------------------------------------ */
/* Rechnungen — Rechnungsausgang, Offene Posten, Mahnwesen.            */
/* Invoices are documents over charges already booked in the           */
/* Buchhaltung; payment status comes live from the student's payments  */
/* (see src/server/invoices.ts).                                       */
/* ------------------------------------------------------------------ */

import { useMemo, useState } from "react";
import { BellRing, FilePlus2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import { formatIsoDate, toIsoDate } from "@/components/buchhaltung/api";
import { SectionTabs } from "@/components/buchhaltung/SectionTabs";
import { StudentCombobox } from "@/components/buchhaltung/StudentCombobox";
import { CreateInvoiceDialog } from "@/components/rechnungen/CreateInvoiceDialog";
import { InstalmentsTab } from "@/components/rechnungen/InstalmentsTab";
import {
  InvoiceList,
  ReminderDialog,
  nextReminderHint,
} from "@/components/rechnungen/InvoiceList";
import {
  InvoicePrintDialog,
  type PrintTarget,
} from "@/components/rechnungen/InvoiceSheet";
import { SepaTab } from "@/components/rechnungen/SepaTab";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createOpeningReminder,
  saveInvoicingSettings,
  useInvoices,
  useInvoicingSettings,
  useOpenItems,
} from "@/hooks/use-invoices";
import { useStudents } from "@/hooks/use-students";
import {
  type InvoicingSettings,
  type OpeningBalanceItem,
  REMINDER_LABELS,
} from "@/lib/invoice-types";
import { formatCents, parseEuroToCents } from "@/lib/money";
import { cn } from "@/lib/utils";

type TabKey = "rechnungen" | "offen" | "raten" | "lastschrift" | "einstellungen";

const TABS: { value: TabKey; label: string }[] = [
  { value: "rechnungen", label: "Rechnungen" },
  { value: "offen", label: "Offene Posten" },
  { value: "raten", label: "Ratenpläne" },
  { value: "lastschrift", label: "Lastschriften" },
  { value: "einstellungen", label: "Einstellungen" },
];

function openStudent(id: number) {
  window.history.pushState({}, "", `/fahrschueler/${id}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "warn" && "text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function InvoicesTab() {
  const invoices = useInvoices();
  const { students } = useStudents();
  const [query, setQuery] = useState("");
  const [customerNo, setCustomerNo] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<PrintTarget | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = invoices.data ?? [];
    if (!q) return list;
    return list.filter((invoice) =>
      `${invoice.invoiceNr} ${invoice.recipient.name} ${invoice.customerNo}`
        .toLowerCase()
        .includes(q),
    );
  }, [invoices.data, query]);

  const student = students.find((s) => s.customerNumber === customerNo);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          className="w-full sm:w-64"
          placeholder="Suchen (Nr., Name, Kundennr.)"
          aria-label="Rechnungen durchsuchen"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:items-end">
          <div className="w-full sm:w-80">
            <StudentCombobox
              students={students}
              value={customerNo}
              onChange={setCustomerNo}
              placeholder="Fahrschüler/in für neue Rechnung…"
            />
          </div>
          <Button disabled={!student} onClick={() => setCreating(true)}>
            <FilePlus2 data-icon="inline-start" />
            Rechnung erstellen
          </Button>
        </div>
      </div>

      {invoices.isPending ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : (
        <InvoiceList invoices={filtered} />
      )}

      {student && (
        <CreateInvoiceDialog
          open={creating}
          studentId={student.id}
          studentName={`${student.firstName} ${student.lastName}`}
          onClose={() => setCreating(false)}
          onCreated={(invoice) => {
            setCreating(false);
            setCreated({ kind: "invoice", invoice });
          }}
        />
      )}
      <InvoicePrintDialog target={created} onClose={() => setCreated(null)} />
    </div>
  );
}

function OpeningBalances({ items }: { items: OpeningBalanceItem[] }) {
  const [remind, setRemind] = useState<OpeningBalanceItem | null>(null);
  const [printTarget, setPrintTarget] = useState<PrintTarget | null>(null);
  const today = toIsoDate(new Date());
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">Offene Saldovorträge</h2>
        <p className="text-xs text-pretty text-muted-foreground">
          Offene Beträge aus der bisherigen Software. Sie sind keine Rechnungen, werden
          aber durch Zahlungen zuerst ausgeglichen und können angemahnt werden.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Fahrschüler/in</TableHead>
              <TableHead>Übernommen am</TableHead>
              <TableHead className="text-right">Betrag</TableHead>
              <TableHead className="text-right">Offen</TableHead>
              <TableHead>Mahnstand</TableHead>
              <TableHead className="pr-4 text-right">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const last = item.reminders.at(-1);
              const hint = nextReminderHint(item.nextReminderOn, last?.level ?? 0);
              const canRemind =
                item.nextReminderOn != null && item.nextReminderOn <= today;
              return (
                <TableRow key={item.transactionId}>
                  <TableCell className="pl-4 font-medium">
                    {item.recipient.name}
                    <span className="block text-xs font-normal text-muted-foreground">
                      Saldovortrag{item.belegNr ? ` · Beleg ${item.belegNr}` : ""}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatIsoDate(item.date)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(item.amountCents)} €
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(item.openCents)} €
                  </TableCell>
                  <TableCell className="whitespace-normal text-xs text-muted-foreground">
                    {last ? REMINDER_LABELS[last.level] : "Noch nicht gemahnt"}
                    {hint && <span className="block">{hint}</span>}
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex flex-wrap justify-end gap-1">
                      {item.reminders.map((reminder) => (
                        <Button
                          key={reminder.id}
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setPrintTarget({ kind: "opening-reminder", item, reminder })
                          }
                        >
                          {REMINDER_LABELS[reminder.level]}
                        </Button>
                      ))}
                      {canRemind && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRemind(item)}
                        >
                          <BellRing data-icon="inline-start" />
                          Mahnen
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <ReminderDialog
        subject={
          remind && {
            title: `Saldovortrag ${remind.recipient.name}`,
            openCents: remind.openCents,
            lastLevel: remind.reminders.at(-1)?.level ?? 0,
          }
        }
        onClose={() => setRemind(null)}
        onCreate={async (input) => {
          const item = remind!;
          const reminder = await createOpeningReminder(item.transactionId, input);
          return { kind: "opening-reminder", item, reminder };
        }}
        onCreated={setPrintTarget}
      />
      <InvoicePrintDialog target={printTarget} onClose={() => setPrintTarget(null)} />
    </section>
  );
}

function OpenItemsTab() {
  const openItems = useOpenItems();
  if (openItems.isPending || !openItems.data)
    return <Skeleton className="h-40 rounded-lg" />;
  const { totals, invoices, students, openingBalances = [] } = openItems.data;
  const uninvoiced = students.reduce((sum, s) => sum + s.uninvoicedOpenCents, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Offen aus Rechnungen" value={`${formatCents(totals.openCents)} €`} />
        <Stat
          label={`Überfällig (${totals.overdueCount} ${
            totals.overdueCount === 1 ? "Rechnung" : "Rechnungen"
          })`}
          value={`${formatCents(totals.overdueCents)} €`}
          tone={totals.overdueCents > 0 ? "warn" : undefined}
        />
        <Stat
          label="Offen, noch nicht fakturiert"
          value={`${formatCents(uninvoiced)} €`}
        />
        <Stat
          label="Offene Saldovorträge"
          value={`${formatCents(totals.openingCents ?? 0)} €`}
        />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Offene Rechnungen</h2>
        <InvoiceList
          invoices={invoices.toSorted((a, b) => b.overdueDays - a.overdueDays)}
          emptyText="Keine offenen Rechnungen."
        />
      </section>

      {openingBalances.length > 0 && <OpeningBalances items={openingBalances} />}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Nach Fahrschüler/in</h2>
        {students.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Keine offenen Beträge.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Fahrschüler/in</TableHead>
                  <TableHead>Kundennr.</TableHead>
                  <TableHead className="text-right">Offen (Rechnungen)</TableHead>
                  <TableHead className="text-right">Offen (nicht fakturiert)</TableHead>
                  <TableHead className="text-right">Saldovortrag</TableHead>
                  <TableHead className="pr-4 text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((row) => (
                  <TableRow
                    key={row.customerNo}
                    className={cn(row.studentId != null && "cursor-pointer")}
                    tabIndex={row.studentId != null ? 0 : undefined}
                    onClick={() => row.studentId != null && openStudent(row.studentId)}
                    onKeyDown={(event) => {
                      if (
                        row.studentId != null &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        openStudent(row.studentId);
                      }
                    }}
                  >
                    <TableCell className="pl-4 font-medium">{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.customerNo}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(row.invoicedOpenCents)} €
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(row.uninvoicedOpenCents)} €
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(row.openingOpenCents ?? 0)} €
                    </TableCell>
                    <TableCell
                      className={cn(
                        "pr-4 text-right tabular-nums",
                        row.balanceCents < 0 && "text-destructive",
                      )}
                    >
                      {formatCents(row.balanceCents)} €
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}

function SettingsTab() {
  const settings = useInvoicingSettings();
  if (!settings.data) return <Skeleton className="h-40 rounded-lg" />;
  return <SettingsForm key={JSON.stringify(settings.data)} initial={settings.data} />;
}

const FEE_LEVELS = [
  { label: "Zahlungserinnerung", hint: "nach Ablauf des Zahlungsziels" },
  { label: "1. Mahnung", hint: "nach Ablauf der Frist der Erinnerung" },
  { label: "2. Mahnung", hint: "letzte Stufe, danach Inkasso/Anwalt" },
] as const;

function SettingsForm({ initial }: { initial: InvoicingSettings }) {
  const [term, setTerm] = useState(String(initial.paymentTermDays));
  const [reminderTerm, setReminderTerm] = useState(String(initial.reminderTermDays));
  const [fees, setFees] = useState(initial.reminderFeeCents.map((c) => formatCents(c)));
  const [saving, setSaving] = useState(false);
  const [invalidFees, setInvalidFees] = useState<Set<number>>(() => new Set());

  const save = async () => {
    const parsedFees = fees.map((fee) => parseEuroToCents(fee || "0"));
    const invalid = new Set(
      parsedFees.map((fee, i) => (fee == null ? i : -1)).filter((i) => i >= 0),
    );
    setInvalidFees(invalid);
    if (invalid.size > 0) return;
    setSaving(true);
    try {
      await saveInvoicingSettings({
        paymentTermDays: Number(term),
        reminderTermDays: Number(reminderTerm),
        reminderFeeCents: parsedFees as InvoicingSettings["reminderFeeCents"],
      });
      toast.success("Einstellungen gespeichert.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payment-term">Zahlungsziel (Tage)</Label>
          <Input
            id="payment-term"
            inputMode="numeric"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">ab Rechnungsdatum</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reminder-term">Frist je Mahnung (Tage)</Label>
          <Input
            id="reminder-term"
            inputMode="numeric"
            value={reminderTerm}
            onChange={(e) => setReminderTerm(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            nächste Stufe frühestens danach
          </span>
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-sm font-medium">Mahngebühren</legend>
        {FEE_LEVELS.map((level, i) => (
          <div
            key={level.label}
            className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-x-4 gap-y-1"
          >
            <Label htmlFor={`fee-${i}`} className="flex flex-col items-start gap-0">
              {level.label}
              <span className="text-xs font-normal text-muted-foreground">
                {level.hint}
              </span>
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id={`fee-${i}`}
                inputMode="decimal"
                className="text-right tabular-nums"
                aria-invalid={invalidFees.has(i) ? true : undefined}
                value={fees[i] ?? ""}
                onChange={(e) =>
                  setFees((current) =>
                    current.map((f, j) => (j === i ? e.target.value : f)),
                  )
                }
              />
              <span className="text-sm text-muted-foreground">€</span>
            </div>
            {invalidFees.has(i) && (
              <p className="col-span-2 text-xs text-destructive">
                Ungültiger Betrag (z. B. 5,00).
              </p>
            )}
          </div>
        ))}
      </fieldset>
      <p className="text-xs text-pretty text-muted-foreground">
        Mahngebühren werden dem Ausbildungskonto belastet (pauschalierter Schadensersatz,
        nicht steuerbar, Konto 4830). Die Höhe bitte mit dem Steuerberater bzw. den
        Vertragsbedingungen abstimmen.
      </p>
      <Button className="self-start" onClick={() => void save()} disabled={saving}>
        Speichern
      </Button>
    </div>
  );
}

export function Rechnungen() {
  const [tab, setTab] = useState<TabKey>("rechnungen");
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <SectionTabs
            className="hidden md:block"
            items={TABS}
            value={tab}
            onChange={setTab}
            label="Rechnungen Bereich"
          />
        }
      >
        <span className="text-sm font-medium">Rechnungen</span>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-2 sm:p-4 2xl:p-6">
        <SectionTabs
          className="mb-2 md:hidden"
          items={TABS}
          value={tab}
          onChange={setTab}
          label="Rechnungen Bereich"
        />
        <Card className="animate-enter min-h-full">
          <CardContent className="px-3 sm:px-6">
            {tab === "rechnungen" && <InvoicesTab />}
            {tab === "offen" && <OpenItemsTab />}
            {tab === "raten" && <InstalmentsTab />}
            {tab === "lastschrift" && <SepaTab />}
            {tab === "einstellungen" && <SettingsTab />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
