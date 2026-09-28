/* ------------------------------------------------------------------ */
/* Fahrschüler detail — Zahlungserfassung tab. The student-scoped view */
/* of the accounting ledger: payments land in the same booking engine  */
/* as /buchhaltung (PaymentDialog → SKR 04), with Quittung + Storno.   */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { FilePlus2, Plus, Printer, Undo2 } from "lucide-react";
import { toast } from "sonner";

import type { StudentRecord } from "@/hooks/use-students";
import type { LedgerRow } from "@/lib/accounting-types";
import { formatEuro, formatCents } from "@/lib/money";
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
import { CreateInvoiceDialog } from "@/components/rechnungen/CreateInvoiceDialog";
import { InvoiceList } from "@/components/rechnungen/InvoiceList";
import { invalidateInvoices, useInvoices } from "@/hooks/use-invoices";

function Money({
  cents,
  tone = "positive",
}: {
  cents: number | null;
  tone?: "positive" | "negative";
}) {
  if (cents == null) return <span className="text-muted-foreground">-</span>;
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        tone === "negative"
          ? "text-destructive"
          : "text-emerald-600 dark:text-emerald-400",
      )}
    >
      {formatCents(cents)}
    </span>
  );
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
  };
  const invoices = useInvoices(student.id);
  const [creatingInvoice, setCreatingInvoice] = useState(false);

  const rows = ledger.data?.rows ?? [];
  const activeRows = rows.filter((row) => !row.storniert && !row.isStorno);
  const paidCents = activeRows.reduce((sum, row) => sum + (row.incomeCents ?? 0), 0);
  const chargedCents = activeRows.reduce((sum, row) => sum + (row.expenseCents ?? 0), 0);
  const printableIds = rows.filter((row) => row.printable).map((row) => row.id);

  // Real balance from the ledger; null = no ledger activity yet.
  const balanceEntry = balancesData.data?.balances.find(
    (b) => b.customerNo === student.customerNumber,
  );
  const balanceCents = balanceEntry?.balanceCents ?? null;
  const hasDebt = balanceCents != null && balanceCents < 0;

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
      className: "pl-4",
      cellClassName: "pl-4 text-muted-foreground",
      render: (row) => formatIsoDate(row.date),
    },
    {
      key: "receipt",
      label: "Belegnummer",
      cellClassName: "text-muted-foreground",
      render: (row) => row.belegNr ?? "-",
    },
    {
      key: "type",
      label: "Typ",
      cellClassName: "text-muted-foreground",
      render: (row) => row.typeLabel,
    },
    {
      key: "description",
      label: "Beschreibung",
      className: "min-w-64",
      cellClassName: "max-w-80",
      render: (row) => (
        <span className={cn(row.storniert && "line-through")}>
          {row.description || "-"}
        </span>
      ),
    },
    {
      key: "vat",
      label: "Inkl. MwSt",
      cellClassName: "text-muted-foreground",
      render: (row) => row.vatLabel,
    },
    {
      key: "income",
      label: "Zahlung, EUR",
      render: (row) => <Money cents={row.incomeCents} />,
    },
    {
      key: "expense",
      label: "Kosten, EUR",
      render: (row) => <Money cents={row.expenseCents} tone="negative" />,
    },
    {
      key: "actions",
      label: "Aktionen",
      className: "pr-4",
      cellClassName: "pr-4",
      render: (row) => (
        <div className="flex items-center gap-1">
          {row.printable && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Quittung drucken"
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Card size="sm" className="py-3">
            <CardContent className="flex flex-col gap-0.5 px-4">
              <span className="text-xs text-muted-foreground">Bilanz</span>
              <span
                className={cn(
                  "text-base font-semibold tabular-nums",
                  hasDebt ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {balanceCents != null ? formatCents(balanceCents) : "—"}
              </span>
            </CardContent>
          </Card>
          <Card size="sm" className="py-3">
            <CardContent className="flex flex-col gap-0.5 px-4">
              <span className="text-xs text-muted-foreground">Gezahlt</span>
              <span className="text-base font-semibold tabular-nums">
                {formatEuro(paidCents)}
              </span>
            </CardContent>
          </Card>
          <Card size="sm" className="py-3">
            <CardContent className="flex flex-col gap-0.5 px-4">
              <span className="text-xs text-muted-foreground">Kosten</span>
              <span className="text-base font-semibold tabular-nums">
                {formatEuro(chargedCents)}
              </span>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="Quittungen drucken"
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
              {ledger.error ?? `Für ${fullName} wurden noch keine Zahlungen erfasst.`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table className="min-w-[64rem] text-xs">
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
