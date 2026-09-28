import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  CalendarDays,
  ChevronDown,
  Download,
  Plus,
  Printer,
  Receipt,
  Search,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { GeldkontoBalance } from "@/lib/accounting-report-types";
import type { Account, AccountKind, JournalRow, LedgerRow } from "@/lib/accounting-types";
import { accountName } from "@/lib/account-labels";
import { formatCents, formatEuro } from "@/lib/money";
import {
  accountingApi,
  buildFilterQuery,
  downloadFile,
  formatIsoDate,
  toIsoDate,
  useApi,
  type StatusFilter,
} from "./components/buchhaltung/api";
import { CashbookTab } from "./components/buchhaltung/CashbookTab";
import { PaymentDialog } from "./components/buchhaltung/PaymentDialog";
import { QuittungDialog } from "./components/buchhaltung/QuittungDialog";
import {
  money,
  PrintTable,
  useReportPrinter,
  type PrintJob,
} from "./components/buchhaltung/ReportPrint";
import { SectionTabs } from "./components/buchhaltung/SectionTabs";
import { StornoDialog, type StornoTarget } from "./components/buchhaltung/StornoDialog";
import { VatTab } from "./components/buchhaltung/VatTab";

type TabKey = "ledger" | "journal" | "cashbook" | "vat" | "accounts" | "cash-bank";

type Column<Row> = {
  key: string;
  label: string;
  className?: string;
  cellClassName?: string;
  render: (row: Row) => React.ReactNode;
};

const tabs: { value: TabKey; label: string }[] = [
  { value: "ledger", label: "Zahlungsübersicht" },
  { value: "journal", label: "Buchungsjournal" },
  { value: "cashbook", label: "Kassenbuch" },
  { value: "vat", label: "Umsatzsteuer" },
  { value: "accounts", label: "Kontenrahmen" },
  { value: "cash-bank", label: "Kasse/Bank" },
];

const KIND_LABELS: Record<AccountKind, string> = {
  geldkonto: "Geldkonto",
  transit: "Neutrale Anwendung",
  durchlaufend: "Durchlaufende Posten",
  anzahlung: "Fahrschüler-Guthaben",
  vortrag: "Saldenvortrag",
  steuer: "Steuerkonto",
  erloes: "Einnahmen",
  privat: "Privat",
  aufwand: "Ausgabe",
};

function Money({
  cents,
  tone = "positive",
}: {
  cents: number | null;
  tone?: "positive" | "negative" | "neutral";
}) {
  if (cents == null) return <span className="text-muted-foreground">–</span>;
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        tone === "negative"
          ? "text-destructive"
          : tone === "positive"
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-foreground",
      )}
    >
      {formatCents(cents)}
    </span>
  );
}

function RowActions({
  printable,
  stornoEligible,
  onPrint,
  onStorno,
}: {
  printable: boolean;
  stornoEligible: boolean;
  onPrint: () => void;
  onStorno: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 xl:flex-nowrap">
      {printable && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label="Quittung drucken"
          onClick={onPrint}
        >
          <Receipt data-icon="inline-start" />
          Quittung
        </Button>
      )}
      {stornoEligible && (
        <Button type="button" variant="ghost" size="xs" onClick={onStorno}>
          <Undo2 data-icon="inline-start" />
          Stornieren
        </Button>
      )}
    </div>
  );
}

function AccountingTable<Row>({
  columns,
  rows,
  rowKey,
  rowClassName,
  minWidth = "min-w-[64rem]",
  mobile,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  rowClassName?: (row: Row) => string;
  minWidth?: string;
  /** Card rendering for phones; the table is shown from sm up. */
  mobile?: (row: Row) => React.ReactNode;
}) {
  return (
    <>
      {mobile && (
        <ul className="flex flex-col divide-y rounded-lg border bg-card sm:hidden">
          {rows.map((row) => (
            <li key={rowKey(row)} className={cn("px-3 py-2", rowClassName?.(row))}>
              {mobile(row)}
            </li>
          ))}
        </ul>
      )}
      <div
        className={cn(
          "overflow-x-auto rounded-lg border bg-card",
          mobile && "hidden sm:block",
        )}
      >
        <Table className={cn("text-xs", minWidth)}>
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
                key={rowKey(row)}
                className={cn(
                  "border-0 even:bg-muted/30 hover:bg-muted/50",
                  rowClassName?.(row),
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
    </>
  );
}

function MobileRow({
  meta,
  title,
  subtitle,
  amount,
  actions,
}: {
  meta: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  amount: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-xs text-muted-foreground">{meta}</span>
        <span className="shrink-0">{amount}</span>
      </div>
      <div className="min-w-0">{title}</div>
      {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
      {actions}
    </div>
  );
}

function TableState({
  loading,
  error,
  emptyText,
}: {
  loading: boolean;
  error: string | null;
  emptyText: string;
}) {
  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }
  return (
    <Empty className="min-h-64 border-0">
      <EmptyHeader>
        <EmptyTitle>{error ? "Fehler beim Laden" : "Keine Ergebnisse"}</EmptyTitle>
        <EmptyDescription>{error ?? emptyText}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/* ------------------------------ filters ---------------------------- */

const monthLabels = [
  "Jan",
  "Feb",
  "Mär",
  "Apr",
  "Mai",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Okt",
  "Nov",
  "Dez",
];

function formatDay(date?: Date) {
  return date
    ? date.toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "";
}

function monthRange(year: number, month: number): DateRange {
  // Day 0 of the next month = last day of the requested month.
  return { from: new Date(year, month, 1), to: new Date(year, month + 1, 0) };
}

function sameDay(a?: Date, b?: Date) {
  return (
    !!a &&
    !!b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function rangeText(range: DateRange | undefined) {
  if (!range?.from) return "Gesamter Zeitraum";
  return range.to && !sameDay(range.from, range.to)
    ? `${formatDay(range.from)} – ${formatDay(range.to)}`
    : formatDay(range.from);
}

function DateRangeFilter({
  range,
  onChange,
}: {
  range: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const filterYear = range?.from?.getFullYear() ?? today.getFullYear();

  const label = range?.from ? rangeText(range) : "Zeitraum wählen";

  // If the active range matches a whole month, highlight that quick button.
  const activeMonth = (() => {
    if (!range?.from || !range.to) return -1;
    for (let i = 0; i < 12; i++) {
      const m = monthRange(filterYear, i);
      if (sameDay(range.from, m.from) && sameDay(range.to, m.to)) return i;
    }
    return -1;
  })();

  const presets: { label: string; get: () => DateRange }[] = [
    {
      label: "Dieser Monat",
      get: () => monthRange(today.getFullYear(), today.getMonth()),
    },
    {
      label: "Letzter Monat",
      get: () => monthRange(today.getFullYear(), today.getMonth() - 1),
    },
    {
      label: "Dieses Quartal",
      get: () => {
        const q = Math.floor(today.getMonth() / 3) * 3;
        return {
          from: new Date(today.getFullYear(), q, 1),
          to: new Date(today.getFullYear(), q + 3, 0),
        };
      },
    },
    {
      label: "Dieses Jahr",
      get: () => ({
        from: new Date(today.getFullYear(), 0, 1),
        to: new Date(today.getFullYear(), 11, 31),
      }),
    },
  ];

  const apply = (next: DateRange) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <CalendarDays data-icon="inline-start" />
          {label}
          <ChevronDown data-icon="inline-end" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex max-sm:flex-col">
          <div className="flex flex-col gap-1 border-b p-3 sm:w-48 sm:border-b-0 sm:border-r">
            <span className="px-1 pb-1 text-xs font-medium text-muted-foreground">
              Schnellauswahl
            </span>
            {presets.map((preset) => (
              <Button
                key={preset.label}
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start"
                onClick={() => apply(preset.get())}
              >
                {preset.label}
              </Button>
            ))}

            <Separator className="my-2" />

            <span className="px-1 pb-1 text-xs font-medium text-muted-foreground">
              Monat {filterYear}
            </span>
            <div className="grid grid-cols-3 gap-1">
              {monthLabels.map((month, index) => (
                <Button
                  key={month}
                  type="button"
                  variant={activeMonth === index ? "default" : "outline"}
                  size="sm"
                  className="px-0"
                  onClick={() => apply(monthRange(filterYear, index))}
                >
                  {month}
                </Button>
              ))}
            </div>
          </div>

          <div className="p-3">
            <Calendar
              mode="range"
              numberOfMonths={1}
              defaultMonth={range?.from ?? today}
              selected={range}
              onSelect={onChange}
              weekStartsOn={1}
              className="p-0 [--cell-size:--spacing(8)]"
              formatters={{
                formatCaption: (date) =>
                  date.toLocaleDateString("de-DE", { month: "long", year: "numeric" }),
                formatWeekdayName: (date) =>
                  date.toLocaleDateString("de-DE", { weekday: "short" }),
              }}
            />
            <div className="flex items-center justify-between gap-2 pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(undefined)}
              >
                Zurücksetzen
              </Button>
              <Button type="button" size="sm" onClick={() => setOpen(false)}>
                Anwenden
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------ toolbar ---------------------------- */

function Toolbar({
  tab,
  range,
  onRangeChange,
  search,
  onSearchChange,
  status,
  onStatusChange,
  sort,
  onSortChange,
  onNew,
  onDatev,
  onJournalCsv,
  onJournalPrint,
  onPrintFiltered,
  printableCount,
  balances,
  geldkonten,
}: {
  tab: TabKey;
  range: DateRange | undefined;
  onRangeChange: (range: DateRange | undefined) => void;
  search: string;
  onSearchChange: (value: string) => void;
  status: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  sort: "asc" | "desc";
  onSortChange: (value: "asc" | "desc") => void;
  onNew: () => void;
  onDatev: () => void;
  onJournalCsv: () => void;
  onJournalPrint: () => void;
  onPrintFiltered: () => void;
  printableCount: number;
  balances: { openingCents: number; closingCents: number } | null;
  geldkonten: GeldkontoBalance[] | null;
}) {
  const isBookkeeping = tab === "ledger" || tab === "journal";
  const hasStatus = isBookkeeping || tab === "accounts" || tab === "cash-bank";
  const hasRange = isBookkeeping || tab === "cashbook";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {hasStatus && (
            <Select
              value={status}
              onValueChange={(value) => onStatusChange(value as StatusFilter)}
            >
              <SelectTrigger className="w-36" size="sm" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">Alle</SelectItem>
                  <SelectItem value="active">Aktiv</SelectItem>
                  <SelectItem value="storniert">
                    {isBookkeeping ? "Storniert" : "Inaktiv"}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          {hasRange && <DateRangeFilter range={range} onChange={onRangeChange} />}
          {tab === "journal" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onSortChange(sort === "desc" ? "asc" : "desc")}
            >
              {sort === "desc" ? (
                <ArrowDownWideNarrow data-icon="inline-start" />
              ) : (
                <ArrowUpWideNarrow data-icon="inline-start" />
              )}
              {sort === "desc" ? "Neueste zuerst" : "Älteste zuerst"}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isBookkeeping && (
            <Button type="button" variant="outline" size="sm" onClick={onDatev}>
              <Download data-icon="inline-start" />
              DATEV
            </Button>
          )}
          {tab === "journal" && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={onJournalCsv}>
                <Download data-icon="inline-start" />
                CSV
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onJournalPrint}>
                <Printer data-icon="inline-start" />
                Drucken
              </Button>
            </>
          )}
          {(isBookkeeping || tab === "accounts" || tab === "cash-bank") && (
            <InputGroup className="w-full sm:w-48">
              <InputGroupInput
                placeholder="Suche"
                aria-label="Suche"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <Search />
              </InputGroupAddon>
            </InputGroup>
          )}
          {tab === "ledger" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onPrintFiltered}
              disabled={printableCount === 0}
              title="Quittungen aller Zahlungen im aktuellen Filter drucken"
            >
              <Receipt data-icon="inline-start" />
              Quittungen drucken ({printableCount})
            </Button>
          )}
          {tab !== "accounts" && tab !== "vat" && (
            <Button type="button" size="sm" onClick={onNew}>
              <Plus data-icon="inline-start" />
              Buchung
            </Button>
          )}
        </div>
      </div>
      {tab === "ledger" && (balances || geldkonten) && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {balances && (
            <span>
              Zeitraum: Anfangsbestand{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatEuro(balances.openingCents)}
              </span>
              {" · "}Endbestand{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatEuro(balances.closingCents)}
              </span>
            </span>
          )}
          {geldkonten?.map((konto) => (
            <span key={konto.number}>
              Aktuell {accountName(konto)}{" "}
              <span
                className={cn(
                  "font-medium text-foreground tabular-nums",
                  konto.todayCents < 0 && "text-destructive",
                )}
              >
                {formatEuro(konto.todayCents)}
              </span>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function journalPrintJob(rows: JournalRow[], range: DateRange | undefined): PrintJob {
  const active = rows.filter((row) => !row.storniert && !row.isStorno);
  return {
    title: `Buchungsjournal ${rangeText(range)}`,
    subtitle: `${rows.length} Buchungen · Summe ohne Stornos ${formatCents(
      active.reduce((sum, row) => sum + row.amountCents, 0),
    )} €`,
    body: (
      <PrintTable
        head={[
          "Datum",
          "Beleg",
          "Buchung",
          "Beschreibung",
          "Soll",
          "Haben",
          "Betrag",
          "USt",
        ]}
        numeric={[6]}
        rows={rows.map((row) => [
          formatIsoDate(row.date),
          row.belegNr ?? "",
          row.buchungNr,
          `${row.description}${row.isStorno ? " (Storno)" : row.storniert ? " (storniert)" : ""}`,
          `${row.sollKonto} ${accountName({ number: row.sollKonto, name: row.sollName })}`,
          `${row.habenKonto} ${accountName({ number: row.habenKonto, name: row.habenName })}`,
          money(row.amountCents),
          row.vatRate == null ? "" : `${row.vatRate} %`,
        ])}
        foot={[
          [
            "",
            "",
            "",
            "Summe (ohne Stornos)",
            "",
            "",
            formatCents(active.reduce((sum, row) => sum + row.amountCents, 0)),
            "",
          ],
        ]}
      />
    ),
  };
}

/* ------------------------------- page ------------------------------ */

export function Buchhaltung() {
  const [tab, setTab] = useState<TabKey>("ledger");
  const [range, setRange] = useState<DateRange | undefined>(() =>
    monthRange(new Date().getFullYear(), new Date().getMonth()),
  );
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  const [refresh, setRefresh] = useState(0);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [stornoTarget, setStornoTarget] = useState<StornoTarget | null>(null);
  const [quittungIds, setQuittungIds] = useState<number[]>([]);
  const printer = useReportPrinter();

  // Debounce the search box so we don't hit the API per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const query = buildFilterQuery(range, search, status);
  const joiner = query ? "&" : "?";
  const ledger = useApi(
    () => accountingApi.ledger(`${query}${joiner}cash=1`),
    [query, refresh],
  );
  const journal = useApi(
    () => accountingApi.journal(`${query}${joiner}sort=${sort}`),
    [query, sort, refresh],
  );
  const accounts = useApi(() => accountingApi.accounts(), [refresh]);
  const balances = useApi(() => accountingApi.balances(), [refresh]);

  const refetch = () => setRefresh((value) => value + 1);

  const toggleAccount = async (account: Account) => {
    try {
      await accountingApi.setAccountActive(account.number, !account.active);
      toast.success(
        `Konto ${account.number} ${account.active ? "deaktiviert" : "aktiviert"}.`,
      );
      refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Fehler.");
    }
  };

  const rangeParams = () => {
    const params = new URLSearchParams();
    if (range?.from) {
      params.set("from", toIsoDate(range.from));
      params.set("to", toIsoDate(range.to ?? range.from));
    }
    return params;
  };

  const exportDatev = async () => {
    try {
      const filename = await downloadFile(
        `/api/accounting/datev?${rangeParams()}`,
        "EXTF_Buchungsstapel.csv",
      );
      toast.success(`DATEV-Buchungsstapel ${filename} exportiert.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "DATEV-Export fehlgeschlagen.",
      );
    }
  };

  const exportJournalCsv = async () => {
    try {
      const filename = await downloadFile(
        `/api/accounting/journal/export?${rangeParams()}`,
        "Buchungsjournal.csv",
      );
      toast.success(`${filename} exportiert.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export fehlgeschlagen.");
    }
  };

  const stornoLabel = (belegNr: string | null, description: string) =>
    belegNr ? `Beleg ${belegNr}` : description || "Buchung";

  const ledgerColumns: Column<LedgerRow>[] = [
    {
      key: "date",
      label: "Datum",
      className: "pl-4",
      cellClassName: "pl-4 text-muted-foreground tabular-nums",
      render: (row) => formatIsoDate(row.date),
    },
    {
      key: "receipt",
      label: "Beleg",
      cellClassName: "text-muted-foreground",
      render: (row) => row.belegNr ?? "–",
    },
    {
      key: "type",
      label: "Art",
      cellClassName: "text-muted-foreground",
      render: (row) => row.typeLabel,
    },
    {
      key: "student",
      label: "Fahrschüler/in",
      cellClassName: "font-medium",
      render: (row) => row.studentName ?? "–",
    },
    {
      key: "description",
      label: "Beschreibung",
      className: "min-w-56",
      cellClassName: "max-w-80",
      render: (row) => (
        <span className={cn(row.storniert && "line-through")}>
          {row.description || "–"}
          {row.stornoReason && (
            <span className="block text-muted-foreground no-underline">
              Storno: {row.stornoReason}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "vat",
      label: "USt",
      cellClassName: "text-muted-foreground",
      render: (row) => row.vatLabel,
    },
    {
      key: "income",
      label: "Einnahme, EUR",
      className: "text-right",
      cellClassName: "text-right",
      render: (row) => <Money cents={row.incomeCents} />,
    },
    {
      key: "expense",
      label: "Ausgabe, EUR",
      className: "text-right",
      cellClassName: "text-right",
      render: (row) => <Money cents={row.expenseCents} tone="negative" />,
    },
    {
      key: "actions",
      label: "Aktionen",
      className: "pr-4",
      cellClassName: "pr-4",
      render: (row) => (
        <RowActions
          printable={row.printable}
          stornoEligible={!row.storniert && !row.isStorno}
          onPrint={() => setQuittungIds([row.id])}
          onStorno={() =>
            setStornoTarget({
              id: row.id,
              label: stornoLabel(row.belegNr, row.description),
            })
          }
        />
      ),
    },
  ];

  const kontoCell = (number: string, name: string) => (
    <span>
      {accountName({ number, name })}
      <span className="block text-muted-foreground tabular-nums">{number}</span>
    </span>
  );

  const journalColumns: Column<JournalRow>[] = [
    {
      key: "date",
      label: "Datum",
      className: "pl-4",
      cellClassName: "pl-4 text-muted-foreground tabular-nums",
      render: (row) => formatIsoDate(row.date),
    },
    {
      key: "receipt",
      label: "Beleg / Buchung",
      cellClassName: "text-muted-foreground tabular-nums",
      render: (row) => (
        <span>
          {row.belegNr ?? "–"}
          <span className="block">{row.buchungNr}</span>
        </span>
      ),
    },
    {
      key: "description",
      label: "Beschreibung",
      className: "min-w-56",
      render: (row) => (
        <span>
          <span className={cn(row.storniert && "line-through")}>
            {row.description || "–"}
          </span>
          <span className="block text-muted-foreground">
            {row.typeLabel}
            {row.stornoReason ? ` · Storno: ${row.stornoReason}` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "soll",
      label: "Soll",
      cellClassName: "text-muted-foreground",
      render: (row) => kontoCell(row.sollKonto, row.sollName),
    },
    {
      key: "haben",
      label: "Haben",
      cellClassName: "text-muted-foreground",
      render: (row) => kontoCell(row.habenKonto, row.habenName),
    },
    {
      key: "amount",
      label: "Betrag, EUR",
      className: "text-right",
      cellClassName: "text-right",
      render: (row) => <Money cents={row.amountCents} tone="neutral" />,
    },
    {
      key: "vat",
      label: "USt",
      cellClassName: "whitespace-nowrap text-muted-foreground tabular-nums",
      render: (row) => (row.vatRate == null ? "–" : `${row.vatRate} %`),
    },
    {
      key: "actions",
      label: "Aktionen",
      className: "pr-4",
      cellClassName: "pr-4",
      render: (row) => (
        <RowActions
          printable={row.printable}
          stornoEligible={!row.storniert && !row.isStorno}
          onPrint={() => setQuittungIds([row.transactionId])}
          onStorno={() =>
            setStornoTarget({
              id: row.transactionId,
              label: stornoLabel(row.belegNr, row.description),
            })
          }
        />
      ),
    },
  ];

  const accountColumns: Column<Account>[] = [
    {
      key: "number",
      label: "Nummer",
      className: "pl-4",
      cellClassName: "pl-4 text-muted-foreground tabular-nums",
      render: (row) => row.number,
    },
    {
      key: "name",
      label: "Name",
      className: "min-w-64",
      render: (row) => (
        <span>
          {accountName(row)}
          {accountName(row) !== row.name && (
            <span className="block text-muted-foreground">{row.name}</span>
          )}
        </span>
      ),
    },
    {
      key: "type",
      label: "Typ",
      cellClassName: "text-muted-foreground",
      render: (row) => KIND_LABELS[row.kind],
    },
    {
      key: "vat",
      label: "USt",
      cellClassName: "text-muted-foreground",
      render: (row) => row.vatLabel,
    },
    {
      key: "status",
      label: "Status",
      cellClassName: "text-muted-foreground",
      render: (row) => (row.active ? "Aktiv" : "Inaktiv"),
    },
    {
      key: "actions",
      label: "Aktiv",
      className: "pr-4",
      cellClassName: "pr-4",
      render: (row) => (
        <Switch
          checked={row.active}
          aria-label={`Konto ${row.number} aktivieren/deaktivieren`}
          onCheckedChange={() => toggleAccount(row)}
        />
      ),
    },
  ];

  const balanceOf = (number: string) =>
    balances.data?.find((balance) => balance.number === number) ?? null;

  const cashBankColumns: Column<Account>[] = [
    {
      key: "name",
      label: "Name",
      className: "pl-4",
      cellClassName: "pl-4 font-medium",
      render: (row) => `${accountName(row)} · ${row.number}`,
    },
    {
      key: "type",
      label: "Typ",
      cellClassName: "text-muted-foreground",
      render: (row) => (row.number === "1600" ? "Kassenbuch" : "Bankbuch"),
    },
    {
      key: "opening",
      label: "Anfangssaldo, EUR",
      className: "text-right",
      cellClassName: "text-right tabular-nums text-muted-foreground",
      render: (row) => (
        <span>
          {formatCents(row.openingCents ?? 0)}
          {row.openingDate && (
            <span className="block">am {formatIsoDate(row.openingDate)}</span>
          )}
        </span>
      ),
    },
    {
      key: "current",
      label: "Aktueller Saldo, EUR",
      className: "text-right",
      cellClassName: "text-right tabular-nums",
      render: (row) => {
        const balance = balanceOf(row.number);
        if (!balance) return "–";
        return (
          <span>
            <span
              className={cn("font-medium", balance.todayCents < 0 && "text-destructive")}
            >
              {formatCents(balance.todayCents)}
            </span>
            {balance.balanceCents !== balance.todayCents && (
              <span className="block text-muted-foreground">
                inkl. künftiger Buchungen {formatCents(balance.balanceCents)}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Status",
      cellClassName: "text-muted-foreground",
      render: (row) => (row.active ? "Aktiv" : "Inaktiv"),
    },
    {
      key: "actions",
      label: "Aktiv",
      className: "pr-4",
      cellClassName: "pr-4",
      render: (row) => (
        <Switch
          checked={row.active}
          aria-label={`Konto ${row.number} aktivieren/deaktivieren`}
          onCheckedChange={() => toggleAccount(row)}
        />
      ),
    },
  ];

  const filterAccounts = (rows: Account[]) =>
    rows.filter((account) => {
      if (status === "active" && !account.active) return false;
      if (status === "storniert" && account.active) return false;
      if (search.trim()) {
        const haystack =
          `${account.number} ${account.name} ${accountName(account)}`.toLowerCase();
        if (!haystack.includes(search.trim().toLowerCase())) return false;
      }
      return true;
    });

  const rowFade = (row: { storniert: boolean; isStorno: boolean }) =>
    row.storniert || row.isStorno ? "opacity-60" : "";

  const renderTab = () => {
    if (tab === "ledger") {
      if (ledger.loading || ledger.error || !ledger.data?.rows.length) {
        return (
          <TableState
            loading={ledger.loading}
            error={ledger.error}
            emptyText="Für den gewählten Zeitraum liegen keine Zahlungen vor."
          />
        );
      }
      return (
        <AccountingTable
          columns={ledgerColumns}
          rows={ledger.data.rows}
          rowKey={(row) => String(row.id)}
          rowClassName={rowFade}
          mobile={(row) => (
            <MobileRow
              meta={`${formatIsoDate(row.date)} · ${row.typeLabel}${row.belegNr ? ` · ${row.belegNr}` : ""}`}
              title={
                <span className={cn(row.storniert && "line-through")}>
                  {row.studentName ? `${row.studentName} — ` : ""}
                  {row.description || "–"}
                </span>
              }
              amount={
                row.incomeCents != null ? (
                  <Money cents={row.incomeCents} />
                ) : (
                  <Money cents={row.expenseCents} tone="negative" />
                )
              }
              actions={
                <RowActions
                  printable={row.printable}
                  stornoEligible={!row.storniert && !row.isStorno}
                  onPrint={() => setQuittungIds([row.id])}
                  onStorno={() =>
                    setStornoTarget({
                      id: row.id,
                      label: stornoLabel(row.belegNr, row.description),
                    })
                  }
                />
              }
            />
          )}
        />
      );
    }

    if (tab === "journal") {
      if (journal.loading || journal.error || !journal.data?.rows.length) {
        return (
          <TableState
            loading={journal.loading}
            error={journal.error}
            emptyText="Für den gewählten Zeitraum liegen keine Buchungen vor."
          />
        );
      }
      return (
        <AccountingTable
          columns={journalColumns}
          rows={journal.data.rows}
          rowKey={(row) => row.buchungNr}
          rowClassName={rowFade}
          minWidth="min-w-[60rem]"
          mobile={(row) => (
            <MobileRow
              meta={`${formatIsoDate(row.date)} · ${row.belegNr ?? row.buchungNr}`}
              title={
                <span className={cn(row.storniert && "line-through")}>
                  {row.description || "–"}
                </span>
              }
              subtitle={`${accountName({ number: row.sollKonto, name: row.sollName })} (${row.sollKonto}) an ${accountName({ number: row.habenKonto, name: row.habenName })} (${row.habenKonto})${row.vatRate != null ? ` · USt ${row.vatRate} %` : ""}`}
              amount={<Money cents={row.amountCents} tone="neutral" />}
              actions={
                <RowActions
                  printable={row.printable}
                  stornoEligible={!row.storniert && !row.isStorno}
                  onPrint={() => setQuittungIds([row.transactionId])}
                  onStorno={() =>
                    setStornoTarget({
                      id: row.transactionId,
                      label: stornoLabel(row.belegNr, row.description),
                    })
                  }
                />
              }
            />
          )}
        />
      );
    }

    if (tab === "cashbook") {
      return <CashbookTab range={range} refresh={refresh} onPrint={printer.print} />;
    }

    if (tab === "vat") {
      return <VatTab refresh={refresh} onPrint={printer.print} />;
    }

    const all = accounts.data?.accounts ?? [];
    const rows = filterAccounts(
      tab === "cash-bank" ? all.filter((a) => a.kind === "geldkonto") : all,
    );
    if (accounts.loading || accounts.error || !rows.length) {
      return (
        <TableState
          loading={accounts.loading}
          error={accounts.error}
          emptyText="Keine Konten gefunden."
        />
      );
    }
    return tab === "accounts" ? (
      <AccountingTable
        columns={accountColumns}
        rows={rows}
        rowKey={(row) => `${row.number}-${row.name}`}
        minWidth="min-w-[48rem]"
      />
    ) : (
      <AccountingTable
        columns={cashBankColumns}
        rows={rows}
        rowKey={(row) => row.number}
        minWidth="min-w-[40rem]"
      />
    );
  };

  const printableTransactionIds =
    tab === "ledger"
      ? (ledger.data?.rows?.filter((row) => row.printable).map((row) => row.id) ?? [])
      : [];

  const printFilteredRows = () => {
    if (!printableTransactionIds.length) {
      toast.info("Keine druckbaren Quittungen im aktuellen Filter.");
      return;
    }
    setQuittungIds(printableTransactionIds);
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <SectionTabs
            className="hidden md:block"
            items={tabs}
            value={tab}
            onChange={setTab}
            label="Buchhaltung Bereich"
          />
        }
      >
        <span className="text-sm font-medium">Buchhaltung</span>
      </PageHeader>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as TabKey)}
        className="min-h-0 flex-1 gap-0 overflow-hidden rounded-t-sm rounded-b-lg border border-border/70 bg-background"
      >
        <div className="min-h-0 flex-1 overflow-auto p-2 sm:p-4 2xl:p-6">
          <SectionTabs
            className="mb-2 md:hidden"
            items={tabs}
            value={tab}
            onChange={setTab}
            label="Buchhaltung Bereich"
          />
          <Card className="animate-enter min-h-full">
            <CardContent className="flex flex-col gap-4 px-3 sm:px-6">
              <Toolbar
                tab={tab}
                range={range}
                onRangeChange={setRange}
                search={searchInput}
                onSearchChange={setSearchInput}
                status={status}
                onStatusChange={setStatus}
                sort={sort}
                onSortChange={setSort}
                balances={ledger.data}
                geldkonten={balances.data}
                onDatev={exportDatev}
                onJournalCsv={() => void exportJournalCsv()}
                onJournalPrint={() =>
                  journal.data && printer.print(journalPrintJob(journal.data.rows, range))
                }
                onPrintFiltered={printFilteredRows}
                printableCount={printableTransactionIds.length}
                onNew={() => setPaymentOpen(true)}
              />

              {tabs.map((item) => (
                <TabsContent key={item.value} value={item.value} className="m-0">
                  {item.value === tab && (
                    <div key={tab} className="animate-agenda-fade">
                      {renderTab()}
                    </div>
                  )}
                </TabsContent>
              ))}
            </CardContent>
          </Card>
        </div>
      </Tabs>

      <PaymentDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        accounts={accounts.data?.accounts ?? []}
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
      {printer.portal}
    </div>
  );
}
