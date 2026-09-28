/* ------------------------------------------------------------------ */
/* Verträge — dashboard over the Ausbildungsverträge.                  */
/*                                                                     */
/* No own server module: contracts are derived 1:1 from the DB-backed  */
/* students list (contractNumber, customerNumber, registrationDate,    */
/* classes, status, pricePlanId) joined with the price plans — same    */
/* sources as /fahrschueler and /preisangebot. Archived students keep  */
/* their contract visible under "Archiviert" (/api/students/archived). */
/* Pure derivation lives in src/lib/contracts.ts; the "Vertrag         */
/* anzeigen" action reuses the printable VertragDialog.                */
/* ------------------------------------------------------------------ */

import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, FileSearch, FileText } from "lucide-react";

import { PageHeader } from "./components/PageHeader.tsx";
import { VertragDialog } from "./components/VertragDialog.tsx";
import { useArchivedContracts } from "@/hooks/use-archive";
import { useFinanceAccess } from "@/hooks/use-finance-access";
import { useStudents, type StudentRecord } from "@/hooks/use-students";
import { usePricePlans } from "@/hooks/use-price-plans";
import { type StudentBalance, accountingApi, useApi } from "@/components/buchhaltung/api";
import { archiveReasonLabel } from "@/lib/archive-reasons";
import { BALANCE_TONE_CLASS, describeBalance } from "@/lib/student-balance";
import { cn } from "@/lib/utils";
import {
  computeContractKpis,
  deriveArchivedContractRows,
  deriveContractRows,
  filterContractRows,
  type ContractRow,
  type ContractStatusFilter,
} from "@/lib/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
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

type KpiItem = {
  label: string;
  value: number;
  hint: string;
};

/* Compact on phones (one row of four numbers), roomy from sm up. */
function KpiBand({ items }: { items: KpiItem[] }) {
  return (
    <dl className="grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-border/80 bg-border/80 shadow-none xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 bg-card px-2.5 py-2 sm:px-4 sm:py-3.5">
          <dt className="truncate text-[11px] font-medium text-muted-foreground">
            {item.label}
          </dt>
          <dd className="mt-0.5 text-base font-semibold tracking-[-0.01em] tabular-nums sm:mt-1 sm:text-lg">
            {item.value}
          </dd>
          <p className="mt-1 hidden truncate text-xs text-muted-foreground sm:block">
            {item.hint}
          </p>
        </div>
      ))}
    </dl>
  );
}

function KpiBandSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-border/80 bg-border/80">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="bg-card px-2.5 py-2 sm:px-4 sm:py-3.5">
          <Skeleton className="h-3 w-16 max-w-full" />
          <Skeleton className="mt-2 h-5 w-8" />
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ row }: { row: ContractRow }) {
  const label = row.archived
    ? "Archiviert"
    : row.status === "aktiv"
      ? "Aktiv"
      : "Inaktiv";
  return (
    <Badge variant="outline" className="gap-1.5 font-normal whitespace-nowrap">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          row.archived
            ? "bg-muted-foreground/40"
            : row.status === "aktiv"
              ? "bg-emerald-500"
              : "bg-muted-foreground/60",
        )}
      />
      {label}
    </Badge>
  );
}

function Balance({ cents }: { cents: number | null }) {
  if (cents == null) return <span className="text-muted-foreground">—</span>;
  const balance = describeBalance(cents);
  return (
    <span
      className={cn("whitespace-nowrap tabular-nums", BALANCE_TONE_CLASS[balance.tone])}
    >
      {balance.tone === "even"
        ? balance.amount
        : `${balance.tone === "debt" ? "Offen" : "Guthaben"} ${balance.amount}`}
    </span>
  );
}

const STATUS_OPTIONS: { value: ContractStatusFilter; label: string }[] = [
  { value: "alle", label: "Alle" },
  { value: "aktiv", label: "Aktiv" },
  { value: "inaktiv", label: "Inaktiv" },
  { value: "archiviert", label: "Archiviert" },
];

function StatusFilter({
  value,
  onChange,
  className,
}: {
  value: ContractStatusFilter;
  onChange: (value: ContractStatusFilter) => void;
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as ContractStatusFilter);
      }}
      variant="outline"
      size="sm"
      spacing={0}
      aria-label="Vertragsstatus"
      className={className}
    >
      {STATUS_OPTIONS.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          aria-label={`${option.label} Verträge`}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function Vertraege() {
  const navigate = useNavigate();
  const { canSeeMoney } = useFinanceAccess();
  // DB-backed: contracts are a view over /api/students + /api/price-plans.
  const { students, loading: studentsLoading } = useStudents();
  const { plans, loading: plansLoading } = usePricePlans();
  const { contracts: archivedContracts } = useArchivedContracts();
  // Balances are finance data — not requested for Fahrlehrer/innen.
  const balancesResult = useApi(
    () =>
      canSeeMoney ? accountingApi.studentBalances() : Promise.resolve({ balances: [] }),
    [canSeeMoney],
  );
  const loading = studentsLoading || plansLoading;

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ContractStatusFilter>("alle");
  const [vertragStudent, setVertragStudent] = useState<StudentRecord | null>(null);

  const balancesMap = useMemo(() => {
    const list: StudentBalance[] = balancesResult.data?.balances ?? [];
    return new Map(list.map((b) => [b.customerNo, b.balanceCents]));
  }, [balancesResult.data]);

  const rows = useMemo(
    () => [
      ...deriveContractRows(students, plans, balancesMap),
      ...deriveArchivedContractRows(archivedContracts, plans),
    ],
    [students, plans, balancesMap, archivedContracts],
  );
  const kpis = useMemo(
    () => computeContractKpis(rows.filter((row) => !row.archived)),
    [rows],
  );
  const filteredRows = useMemo(
    () =>
      filterContractRows(rows, query, statusFilter).toSorted((left, right) => {
        // Newest contracts first; unparseable dates sink to the end.
        const leftTime = Number.isNaN(left.registrationTime)
          ? Number.NEGATIVE_INFINITY
          : left.registrationTime;
        const rightTime = Number.isNaN(right.registrationTime)
          ? Number.NEGATIVE_INFINITY
          : right.registrationTime;
        if (leftTime !== rightTime) return rightTime - leftTime;
        return left.name.localeCompare(right.name, "de");
      }),
    [rows, query, statusFilter],
  );

  const studentsById = useMemo(
    () => new Map(students.map((student) => [student.id, student])),
    [students],
  );

  const resetFilters = () => {
    setQuery("");
    setStatusFilter("alle");
  };

  const openRow = (row: ContractRow) => {
    if (row.archived) {
      void navigate({ to: "/archiv" });
      return;
    }
    void navigate({
      to: "/fahrschueler/$studentId",
      params: { studentId: String(row.studentId) },
    });
  };

  const openVertrag = (row: ContractRow) => {
    const student = studentsById.get(row.studentId);
    if (student) setVertragStudent(student);
  };

  const hasFilter = query.trim().length > 0 || statusFilter !== "alle";
  const showBalance = canSeeMoney;
  const columnCount = showBalance ? 9 : 8;

  const rowKeyDown = (row: ContractRow) => (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openRow(row);
    }
  };

  const emptyState = (
    <Empty className="py-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileSearch />
        </EmptyMedia>
        <EmptyTitle>Keine Verträge gefunden</EmptyTitle>
        <EmptyDescription>
          {hasFilter
            ? "Für die aktuelle Suche bzw. den Statusfilter gibt es keine Treffer."
            : "Es sind noch keine Ausbildungsverträge vorhanden. Verträge entstehen mit der Anmeldung eines Fahrschülers."}
        </EmptyDescription>
      </EmptyHeader>
      {hasFilter && (
        <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
          Filter zurücksetzen
        </Button>
      )}
    </Empty>
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <div className="hidden items-center gap-2 md:flex">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, Vertrags- oder Kundennummer"
              aria-label="Verträge durchsuchen"
              className="h-8 w-56 lg:w-72"
            />
            <StatusFilter value={statusFilter} onChange={setStatusFilter} />
            {hasFilter && (
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                Zurücksetzen
              </Button>
            )}
          </div>
        }
      >
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-medium">Verträge</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {filteredRows.length}
          </span>
        </span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-3 sm:p-4 2xl:p-6">
        <div className="animate-enter flex flex-col gap-3 sm:gap-4 2xl:gap-5">
          {/* Phone: search + filter live in the body (the top bar never grows). */}
          <div className="flex flex-col gap-2 md:hidden">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, Vertrags- oder Kundennummer"
              aria-label="Verträge durchsuchen"
              className="h-9"
            />
            <StatusFilter
              value={statusFilter}
              onChange={setStatusFilter}
              className="w-full *:flex-1"
            />
          </div>

          {loading ? (
            <KpiBandSkeleton />
          ) : (
            <KpiBand
              items={[
                {
                  label: "Gesamt",
                  value: kpis.total,
                  hint: "Alle laufenden Ausbildungsverträge",
                },
                {
                  label: "Aktiv",
                  value: kpis.active,
                  hint: "Fahrschüler in laufender Ausbildung",
                },
                {
                  label: "Inaktiv",
                  value: kpis.inactive,
                  hint: "Ruhende Verträge",
                },
                {
                  label: "Neu",
                  value: kpis.thisMonth,
                  hint: "Anmeldungen im laufenden Monat",
                },
              ]}
            />
          )}

          {/* Phone: one compact card per contract, no sideways scrolling. */}
          <div className="flex flex-col divide-y rounded-lg border bg-card md:hidden">
            {loading
              ? Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="flex flex-col gap-2 p-3">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                ))
              : filteredRows.length === 0
                ? emptyState
                : filteredRows.map((row) => (
                    <button
                      key={`${row.archived ? "a" : "s"}-${row.archived?.archiveId ?? row.studentId}`}
                      onClick={() => openRow(row)}
                      type="button"
                      className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left outline-none focus-visible:bg-muted/50"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{row.name}</span>
                          <StatusBadge row={row} />
                        </div>
                        <span className="truncate text-xs text-muted-foreground">
                          <span className="font-mono">{row.contractNumber}</span> · Klasse{" "}
                          {row.classes.join(", ") || "—"} · {row.registrationDate}
                        </span>
                        {row.archived?.reason ? (
                          <span className="text-xs text-muted-foreground">
                            {archiveReasonLabel(row.archived.reason)}
                          </span>
                        ) : (
                          showBalance && (
                            <span className="text-xs">
                              <Balance cents={row.balanceCents} />
                            </span>
                          )
                        )}
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
          </div>

          {/* Contracts table (md and up) */}
          <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4 pr-1">Vertragsnummer</TableHead>
                  <TableHead className="px-1">Kundennummer</TableHead>
                  <TableHead className="px-1">Name</TableHead>
                  <TableHead className="px-1">Klassen</TableHead>
                  <TableHead className="px-1">Preisplan</TableHead>
                  <TableHead className="px-1">Anmeldedatum</TableHead>
                  <TableHead className="px-1">Status</TableHead>
                  {showBalance && (
                    <TableHead className="px-1 text-right">Kontostand</TableHead>
                  )}
                  <TableHead className="pl-1 pr-4 text-right">Aktion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }, (_, rowIndex) => (
                    <TableRow key={rowIndex}>
                      {Array.from({ length: columnCount }, (_, index) => (
                        <TableCell key={index} className="px-2">
                          <Skeleton className="h-4 w-full max-w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filteredRows.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={columnCount} className="p-0">
                      {emptyState}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRows.map((row) => (
                    <TableRow
                      key={`${row.archived ? "a" : "s"}-${row.archived?.archiveId ?? row.studentId}`}
                      tabIndex={0}
                      className={cn(
                        "cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none",
                        row.archived && "text-muted-foreground",
                      )}
                      onClick={() => openRow(row)}
                      onKeyDown={rowKeyDown(row)}
                    >
                      <TableCell className="pl-4 pr-1 font-mono font-medium">
                        {row.contractNumber}
                      </TableCell>
                      <TableCell className="px-1 font-mono text-muted-foreground">
                        {row.customerNumber}
                      </TableCell>
                      <TableCell className="px-1 font-medium">{row.name}</TableCell>
                      <TableCell className="px-1">
                        <div className="flex flex-wrap gap-1">
                          {row.classes.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            row.classes.map((klass) => (
                              <Badge key={klass} variant="outline">
                                {klass}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-1">{row.planName}</TableCell>
                      <TableCell className="px-1 tabular-nums">
                        {row.registrationDate}
                      </TableCell>
                      <TableCell className="px-1">
                        <div className="flex flex-col items-start gap-0.5">
                          <StatusBadge row={row} />
                          {row.archived?.reason && (
                            <span className="text-[11px] text-muted-foreground">
                              {archiveReasonLabel(row.archived.reason)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      {showBalance && (
                        <TableCell className="px-1 text-right">
                          <Balance cents={row.balanceCents} />
                        </TableCell>
                      )}
                      <TableCell className="pl-1 pr-4">
                        <div className="flex justify-end">
                          {row.archived ? (
                            <span className="text-[11px] text-muted-foreground">
                              Im Archiv
                            </span>
                          ) : canSeeMoney ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={(event) => {
                                event.stopPropagation();
                                openVertrag(row);
                              }}
                            >
                              <FileText data-icon="inline-start" />
                              Vertrag anzeigen
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <VertragDialog student={vertragStudent} onClose={() => setVertragStudent(null)} />
    </div>
  );
}

export default Vertraege;
