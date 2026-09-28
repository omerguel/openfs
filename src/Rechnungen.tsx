/* ------------------------------------------------------------------ */
/* Rechnungen — Rechnungsausgang, Offene Posten, Mahnwesen.            */
/* Invoices are documents over charges already booked in the           */
/* Buchhaltung; payment status comes live from the student's payments  */
/* (see src/server/invoices.ts).                                       */
/* ------------------------------------------------------------------ */

import { useMemo, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import { CreateInvoiceDialog } from "@/components/rechnungen/CreateInvoiceDialog";
import { InvoiceList } from "@/components/rechnungen/InvoiceList";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  saveInvoicingSettings,
  useInvoices,
  useInvoicingSettings,
  useOpenItems,
} from "@/hooks/use-invoices";
import { useStudents } from "@/hooks/use-students";
import type { InvoicingSettings } from "@/lib/invoice-types";
import { formatCents, parseEuroToCents } from "@/lib/money";
import { cn } from "@/lib/utils";

type TabKey = "rechnungen" | "offen" | "einstellungen";

const TABS: { value: TabKey; label: string }[] = [
  { value: "rechnungen", label: "Rechnungen" },
  { value: "offen", label: "Offene Posten" },
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
  const [studentId, setStudentId] = useState<string>("");
  const [creating, setCreating] = useState(false);

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

  const student = students.find((s) => String(s.id) === studentId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          className="w-64"
          placeholder="Suchen (Nr., Name, Kundennr.)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="ml-auto flex items-end gap-2">
          <NativeSelect
            aria-label="Fahrschüler/in für neue Rechnung"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          >
            <NativeSelectOption value="">Fahrschüler/in wählen…</NativeSelectOption>
            {students.map((s) => (
              <NativeSelectOption key={s.id} value={String(s.id)}>
                {s.lastName}, {s.firstName} ({s.customerNumber})
              </NativeSelectOption>
            ))}
          </NativeSelect>
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
          onCreated={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function OpenItemsTab() {
  const openItems = useOpenItems();
  if (openItems.isPending || !openItems.data)
    return <Skeleton className="h-40 rounded-lg" />;
  const { totals, invoices, students } = openItems.data;
  const uninvoiced = students.reduce((sum, s) => sum + s.uninvoicedOpenCents, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Offen aus Rechnungen" value={`${formatCents(totals.openCents)} €`} />
        <Stat
          label={`Überfällig (${totals.overdueCount} Rechnungen)`}
          value={`${formatCents(totals.overdueCents)} €`}
          tone={totals.overdueCents > 0 ? "warn" : undefined}
        />
        <Stat
          label="Offen, noch nicht fakturiert"
          value={`${formatCents(uninvoiced)} €`}
        />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Offene Rechnungen</h2>
        <InvoiceList
          invoices={invoices.toSorted((a, b) => b.overdueDays - a.overdueDays)}
          emptyText="Keine offenen Rechnungen."
        />
      </section>

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
                  <TableHead className="pr-4 text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((row) => (
                  <TableRow
                    key={row.customerNo}
                    className={cn(row.studentId != null && "cursor-pointer")}
                    onClick={() => row.studentId != null && openStudent(row.studentId)}
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

function SettingsForm({ initial }: { initial: InvoicingSettings }) {
  const [term, setTerm] = useState(String(initial.paymentTermDays));
  const [reminderTerm, setReminderTerm] = useState(String(initial.reminderTermDays));
  const [fees, setFees] = useState(initial.reminderFeeCents.map((c) => formatCents(c)));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const parsedFees = fees.map((fee) => parseEuroToCents(fee || "0"));
    if (parsedFees.some((fee) => fee == null)) {
      toast.error("Mahngebühren sind ungültig (z. B. 5,00).");
      return;
    }
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
    <div className="flex max-w-xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="payment-term">Zahlungsziel (Tage)</Label>
          <Input
            id="payment-term"
            inputMode="numeric"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reminder-term">Frist je Mahnung (Tage)</Label>
          <Input
            id="reminder-term"
            inputMode="numeric"
            value={reminderTerm}
            onChange={(e) => setReminderTerm(e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {(["Zahlungserinnerung", "1. Mahnung", "2. Mahnung"] as const).map((label, i) => (
          <div key={label} className="flex flex-col gap-1.5">
            <Label htmlFor={`fee-${i}`}>Gebühr {label}, EUR</Label>
            <Input
              id={`fee-${i}`}
              inputMode="decimal"
              value={fees[i] ?? ""}
              onChange={(e) =>
                setFees((current) =>
                  current.map((f, j) => (j === i ? e.target.value : f)),
                )
              }
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Mahngebühren werden als pauschalierter Schadensersatz (nicht steuerbar, Konto
        4830) gebucht. Die Höhe bitte mit dem Steuerberater bzw. den Vertragsbedingungen
        abstimmen.
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
          <ToggleGroup
            type="single"
            value={tab}
            onValueChange={(value) => value && setTab(value as TabKey)}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Rechnungen Bereich"
          >
            {TABS.map((item) => (
              <ToggleGroupItem key={item.value} value={item.value}>
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      >
        <span className="text-sm font-medium">Rechnungen</span>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        <Card className="animate-enter min-h-full">
          <CardContent>
            {tab === "rechnungen" && <InvoicesTab />}
            {tab === "offen" && <OpenItemsTab />}
            {tab === "einstellungen" && <SettingsTab />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
