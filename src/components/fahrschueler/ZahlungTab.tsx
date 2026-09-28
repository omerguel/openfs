/* ------------------------------------------------------------------ */
/* Fahrschüler detail — Zahlungserfassung tab. The student-scoped view */
/* of the accounting ledger: payments land in the same booking engine  */
/* as /buchhaltung (PaymentDialog → SKR 04), with Quittung + Storno.   */
/*                                                                     */
/* Amounts are shown from the student's point of view (Guthabenkonto): */
/* Zahlung = credited, Kosten = charged (Leistungen, Saldovorträge,    */
/* importierte Salden), so Gezahlt − Kosten = Kontostand.              */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { FilePlus2, Plus, Printer, Undo2 } from "lucide-react";
import { toast } from "sonner";

import type { StudentRecord } from "@/hooks/use-students";
import type { LedgerRow } from "@/lib/accounting-types";
import { formatEuro } from "@/lib/money";
import { BALANCE_TONE_CLASS, describeBalance } from "@/lib/student-balance";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { accountingApi, formatIsoDate, useApi } from "@/components/buchhaltung/api";
import { PaymentDialog } from "@/components/buchhaltung/PaymentDialog";
import { QuittungDialog } from "@/components/buchhaltung/QuittungDialog";
import { StornoDialog, type StornoTarget } from "@/components/buchhaltung/StornoDialog";
import { PaymentPlansSection } from "@/components/fahrschueler/PaymentPlansSection";
import { CreateInvoiceDialog } from "@/components/rechnungen/CreateInvoiceDialog";
import { InvoiceList } from "@/components/rechnungen/InvoiceList";
import { invalidateStudentMoney } from "@/hooks/use-finance-access";
import { invalidateInvoices, useInvoices } from "@/hooks/use-invoices";

function Money({
  cents,
  tone = "positive",
}: {
  cents: number | null;
  tone?: "positive" | "negative";
}) {
  if (cents == null) return <span className="text-muted-foreground">–</span>;
  return (
    <span
      className={cn(
        "font-medium whitespace-nowrap tabular-nums",
        tone === "negative"
          ? "text-destructive"
          : "text-emerald-600 dark:text-emerald-400",
      )}
    >
      {formatEuro(cents)}
    </span>
  );
}

function Readout({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <Card size="sm" className="py-3">
      <CardContent className="flex flex-col gap-0.5 px-3 sm:px-4">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span
          className={cn(
            "text-sm font-semibold whitespace-nowrap tabular-nums sm:text-base",
            className,
          )}
        >
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

/** Row type from the student's point of view. */
function studentTypeLabel(row: LedgerRow): string {
  if (row.isStorno) return "Storno";
  switch (row.type) {
    case "zahlung_guthaben":
      return "Zahlung";
    case "guthaben_uebertragung":
      return "Leistung";
    case "direktzahlung":
      return "Direktzahlung";
    case "saldovortrag":
      return "Saldovortrag";
    default:
      return row.typeLabel;
  }
}

export function ZahlungTab({ student }: { student: StudentRecord }) {
  const fullName = `${student.firstName} ${student.lastName}`;
  const [refresh, setRefresh] = useState(0);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [stornoTarget, setStornoTarget] = useState<StornoTarget | null>(null);
  const [quittungIds, setQuittungIds] = useState<number[]>([]);

  // Scoped by the customer number stored on every booking (exact match —
  // a name search would also hit namesakes and miss renamed students).
  const query = `?customerNo=${encodeURIComponent(student.customerNumber)}`;
  const ledger = useApi(() => accountingApi.ledger(query), [query, refresh]);
  const accounts = useApi(() => accountingApi.accounts(), []);
  const balancesData = useApi(() => accountingApi.studentBalances(), [refresh]);

  const refetch = () => {
    setRefresh((value) => value + 1);
    void invalidateInvoices();
    // Header badge + Übersicht read the balance from the students list.
    void invalidateStudentMoney();
  };
  const invoices = useInvoices(student.id);
  const [creatingInvoice, setCreatingInvoice] = useState(false);

  const rows = ledger.data?.rows ?? [];
  const activeRows = rows.filter((row) => !row.storniert && !row.isStorno);
  const paidCents = activeRows.reduce(
    (sum, row) => sum + (row.studentCreditCents ?? 0),
    0,
  );
  const chargedCents = activeRows.reduce(
    (sum, row) => sum + (row.studentDebitCents ?? 0),
    0,
  );
  const printableIds = rows.filter((row) => row.printable).map((row) => row.id);

  // Real balance from the ledger (same number as the header badge).
  const balanceEntry = balancesData.data?.balances.find(
    (b) => b.customerNo === student.customerNumber,
  );
  const balance = describeBalance(balanceEntry?.balanceCents ?? paidCents - chargedCents);

  const printFiltered = () => {
    if (!printableIds.length) {
      toast.info("Keine druckbaren Einträge vorhanden.");
      return;
    }
    setQuittungIds(printableIds);
  };

  const columns: {
    key: string;
    label: string;
    className?: string;
    cellClassName?: string;
    render: (row: LedgerRow) => React.ReactNode;
  }[] = [
    {
      key: "date",
      label: "Datum",
      className: "pl-4 max-sm:hidden",
      cellClassName:
        "pl-4 text-muted-foreground tabular-nums whitespace-nowrap max-sm:hidden",
      render: (row) => formatIsoDate(row.date),
    },
    {
      key: "description",
      label: "Beschreibung",
      className: "max-sm:pl-3 sm:min-w-56",
      cellClassName: "max-sm:pl-3",
      render: (row) => (
        <div className="flex flex-col">
          <span className={cn(row.storniert && "line-through")}>
            {row.description || row.typeLabel}
          </span>
          <span className="text-[11px] text-muted-foreground">
            <span className="tabular-nums sm:hidden">{formatIsoDate(row.date)} · </span>
            {studentTypeLabel(row)}
            {row.belegNr && (
              <>
                {" · "}
                <span className="font-mono">{row.belegNr}</span>
              </>
            )}
            {row.vatLabel && row.vatLabel !== "Nicht zutreffend"
              ? ` · ${row.vatLabel}`
              : ""}
          </span>
        </div>
      ),
    },
    {
      key: "income",
      label: "Zahlung",
      className: "text-right",
      cellClassName: "text-right",
      render: (row) => <Money cents={row.studentCreditCents} />,
    },
    {
      key: "expense",
      label: "Kosten",
      className: "text-right",
      cellClassName: "text-right",
      render: (row) => <Money cents={row.studentDebitCents} tone="negative" />,
    },
    {
      key: "actions",
      label: "",
      className: "w-16 pr-4 max-sm:pr-2",
      cellClassName: "pr-4 max-sm:pr-2",
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          {row.printable && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Quittung drucken"
              title="Quittung drucken"
              onClick={() => setQuittungIds([row.id])}
            >
              <Printer data-icon="inline-start" />
            </Button>
          )}
          {!row.storniert && !row.isStorno && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Stornieren"
              title="Stornieren"
              onClick={() =>
                setStornoTarget({
                  id: row.id,
                  label: row.belegNr
                    ? `Beleg ${row.belegNr}`
                    : row.description || "Buchung",
                })
              }
            >
              <Undo2 data-icon="inline-start" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid w-full grid-cols-3 gap-2 sm:w-auto sm:gap-3">
          <Readout
            label={balance.tone === "even" ? "Kontostand" : balance.label}
            value={balance.amount}
            className={BALANCE_TONE_CLASS[balance.tone]}
          />
          <Readout label="Gezahlt" value={formatEuro(paidCents)} />
          <Readout label="Kosten" value={formatEuro(chargedCents)} />
        </div>

        <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="Quittungen drucken"
            title="Quittungen drucken"
            onClick={printFiltered}
            disabled={!printableIds.length}
          >
            <Printer data-icon="inline-start" />
          </Button>
          <Button type="button" size="sm" onClick={() => setPaymentOpen(true)}>
            <Plus data-icon="inline-start" />
            Zahlung
          </Button>
        </div>
      </div>

      {ledger.loading ? (
        <div className="flex min-h-64 items-center justify-center">
          <Spinner />
        </div>
      ) : ledger.error || rows.length === 0 ? (
        <Empty className="min-h-64 border-0">
          <EmptyHeader>
            <EmptyTitle>
              {ledger.error ? "Fehler beim Laden" : "Keine Buchungen"}
            </EmptyTitle>
            <EmptyDescription>
              {ledger.error ??
                `Für ${fullName} wurden noch keine Zahlungen oder Leistungen gebucht.`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table className="text-xs sm:min-w-[36rem]">
            <TableHeader>
              <TableRow className="bg-background hover:bg-background">
                {columns.map((column) => (
                  <TableHead key={column.key} className={column.className}>
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn(
                    "border-0 even:bg-muted/30 hover:bg-muted/50",
                    (row.storniert || row.isStorno) && "opacity-60",
                  )}
                >
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className={cn("h-12 whitespace-normal", column.cellClassName)}
                    >
                      {column.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <PaymentPlansSection student={student} />

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Rechnungen</h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setCreatingInvoice(true)}
          >
            <FilePlus2 data-icon="inline-start" />
            Rechnung erstellen
          </Button>
        </div>
        <InvoiceList
          invoices={invoices.data ?? []}
          showStudent={false}
          emptyText={`Für ${fullName} wurden noch keine Rechnungen erstellt.`}
        />
      </section>

      <CreateInvoiceDialog
        open={creatingInvoice}
        studentId={student.id}
        studentName={fullName}
        onClose={() => setCreatingInvoice(false)}
        onCreated={() => {
          setCreatingInvoice(false);
          refetch();
        }}
      />

      <PaymentDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        accounts={accounts.data?.accounts ?? []}
        defaultCustomerNo={student.customerNumber}
        onCreated={(printableId) => {
          refetch();
          if (printableId != null) setQuittungIds([printableId]);
        }}
      />
      <StornoDialog
        target={stornoTarget}
        onClose={() => setStornoTarget(null)}
        onDone={refetch}
      />
      <QuittungDialog transactionIds={quittungIds} onClose={() => setQuittungIds([])} />
    </div>
  );
}
