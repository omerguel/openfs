import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import {
  CalendarDays,
  ChevronDown,
  Download,
  Plus,
  Printer,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { Account, AccountKind, JournalRow, LedgerRow } from "@/lib/accounting-types";
import { formatCents, formatEuro } from "@/lib/money";
import {
  accountingApi,
  buildFilterQuery,
  formatIsoDate,
  toIsoDate,
  useApi,
  type StatusFilter,
} from "./components/buchhaltung/api";
import { PaymentDialog } from "./components/buchhaltung/PaymentDialog";
import { QuittungDialog } from "./components/buchhaltung/QuittungDialog";
import { StornoDialog, type StornoTarget } from "./components/buchhaltung/StornoDialog";

type TabKey = "ledger" | "journal" | "accounts" | "cash-bank";

type Column<Row> = {
  key: string;
  label: string;
  className?: string;
  cellClassName?: string;
  render: (row: Row) => React.ReactNode;
};

const tabs: { value: TabKey; label: string }[] = [
  { value: "ledger", label: "Kassen- und Bankenübersicht" },
  { value: "journal", label: "Buchungsjournal" },
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
  if (cents == null) return <span className="text-muted-foreground">-</span>;
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
    <div className="flex items-center gap-1">
      {printable && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Quittung drucken"
          onClick={onPrint}
        >
          <Printer data-icon="inline-start" />
        </Button>
      )}
      {stornoEligible && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Stornieren"
          onClick={onStorno}
        >
          <Undo2 data-icon="inline-start" />
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
  minWidth = "min-w-[72rem]",
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  rowClassName?: (row: Row) => string;
  minWidth?: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
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
  );
}

function TableState({
  loading,
  error,
  empty,
  emptyText,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
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

  const label = range?.from
    ? range.to && !sameDay(range.from, range.to)
      ? `${formatDay(range.from)} – ${formatDay(range.to)}`
      : formatDay(range.from)
    : "Zeitraum wählen";

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
  onNew,
  onDatev,
  onPrintFiltered,
  hasPrintableRows,
  balances,
}: {
  tab: TabKey;
  range: DateRange | undefined;
  onRangeChange: (range: DateRange | undefined) => void;
  search: string;
  onSearchChange: (value: string) => void;
  status: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  onNew: () => void;
  onDatev: () => void;
  onPrintFiltered: () => void;
  hasPrintableRows: boolean;
  balances: { openingCents: number; closingCents: number } | null;
}) {
  const action =
    tab === "accounts" ? "Kategorie" : tab === "cash-bank" ? "Konto" : "Zahlung";
  const isBookkeeping = tab === "ledger" || tab === "journal";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={status}
            onValueChange={(value) => onStatusChange(value as StatusFilter)}
          >
            <SelectTrigger className="w-44" size="sm">
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
          {isBookkeeping && <DateRangeFilter range={range} onChange={onRangeChange} />}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isBookkeeping && (
            <Button type="button" variant="outline" size="sm" onClick={onDatev}>
              <Download data-icon="inline-start" />
              DATEV
            </Button>
          )}
          <InputGroup className="w-48">
            <InputGroupInput
              placeholder="Suche"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <Search />
            </InputGroupAddon>
          </InputGroup>
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="Drucken"
            onClick={onPrintFiltered}
            disabled={!hasPrintableRows}
          >
            <Printer data-icon="inline-start" />
          </Button>
          <Button type="button" size="sm" onClick={onNew}>
            <Plus data-icon="inline-start" />
            {action}
          </Button>
        </div>
      </div>
      {tab === "ledger" && balances && (
        <p className="text-xs text-muted-foreground">
          Anfangsbestand:{" "}
          <span className="font-medium text-foreground">
            {formatEuro(balances.openingCents)}
          </span>
          {" · "}
          Endbestand:{" "}
          <span className="font-medium text-foreground">
            {formatEuro(balances.closingCents)}
          </span>
        </p>
      )}
    </div>
  );
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
  const [refresh, setRefresh] = useState(0);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [stornoTarget, setStornoTarget] = useState<StornoTarget | null>(null);
  const [quittungIds, setQuittungIds] = useState<number[]>([]);

  // Debounce the search box so we don't hit the API per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const query = buildFilterQuery(range, search, status);
  const ledger = useApi(() => accountingApi.ledger(query), [query, refresh]);
  const journal = useApi(() => accountingApi.journal(query), [query, refresh]);
  const accounts = useApi(() => accountingApi.accounts(), [refresh]);

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

  const exportDatev = async () => {
    const params = new URLSearchParams();
    if (range?.from) {
      params.set("from", toIsoDate(range.from));
      params.set("to", toIsoDate(range.to ?? range.from));
    }
    try {
      const res = await fetch(`/api/accounting/datev?${params}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "DATEV-Export fehlgeschlagen.");
      }
      const filename =
        res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        "EXTF_Buchungsstapel.csv";
      const url = URL.createObjectURL(await res.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(`DATEV-Buchungsstapel ${filename} exportiert.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "DATEV-Export fehlgeschlagen.",
      );
    }
  };

  const stornoLabel = (belegNr: string | null, description: string) =>
    belegNr ? `Beleg ${belegNr}` : description || "Buchung";

  const ledgerColumns: Column<LedgerRow>[] = [
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
      key: "student",
      label: "Schüler",
      cellClassName: "font-medium",
      render: (row) => row.studentName ?? "-",
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
      label: "Einnahmen, EUR",
      render: (row) => <Money cents={row.incomeCents} />,
    },
    {
      key: "expense",
      label: "Ausgabe, EUR",
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

  const journalColumns: Column<JournalRow>[] = [
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
      key: "booking",
      label: "Buchungsnummer",
      cellClassName: "text-muted-foreground",
      render: (row) => row.buchungNr,
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
      key: "soll",
      label: "Sollkonto",
      cellClassName: "text-muted-foreground",
      render: (row) => `${row.sollKonto} · ${row.sollName}`,
    },
    {
      key: "haben",
      label: "Habenkonto",
      cellClassName: "text-muted-foreground",
      render: (row) => `${row.habenKonto} · ${row.habenName}`,
    },
    {
      key: "amount",
      label: "Betrag, EUR",
      render: (row) => <Money cents={row.amountCents} tone="neutral" />,
    },
    {
      key: "vat",
      label: "USt",
      cellClassName: "text-muted-foreground",
      render: (row) => (row.vatRate == null ? "-" : `${row.vatRate} %`),
    },
    {
      key: "reason",
      label: "Stornogrund",
      cellClassName: "text-muted-foreground",
      render: (row) => row.stornoReason ?? "-",
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
      cellClassName: "pl-4 text-muted-foreground",
      render: (row) => row.number,
    },
    { key: "name", label: "Name", className: "min-w-64", render: (row) => row.name },
    {
      key: "type",
      label: "Typ",
      cellClassName: "text-muted-foreground",
      render: (row) => KIND_LABELS[row.kind],
    },
    {
      key: "vat",
      label: "MwSt",
      cellClassName: "text-muted-foreground",
      render: (row) => row.vatLabel,
    },
    {
      key: "taxKey",
      label: "Steuerschlüssel",
      cellClassName: "text-muted-foreground",
      render: () => "-",
    },
    {
      key: "status",
      label: "Status",
      cellClassName: "text-muted-foreground",
      render: (row) => (row.active ? "Aktiv" : "Inaktiv"),
    },
    {
      key: "actions",
      label: "Aktionen",
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

  const cashBankColumns: Column<Account>[] = [
    {
      key: "name",
      label: "Name",
      className: "pl-4",
      cellClassName: "pl-4",
      render: (row) => row.name,
    },
    {
      key: "number",
      label: "Nummer",
      cellClassName: "text-muted-foreground",
      render: (row) => row.number,
    },
    {
      key: "type",
      label: "Typ",
      cellClassName: "text-muted-foreground",
      render: (row) => (row.name.includes("Kasse") ? "Kassenbuch" : "Bankenbuch"),
    },
    {
      key: "date",
      label: "Datum",
      cellClassName: "text-muted-foreground",
      render: (row) => (row.openingDate ? formatIsoDate(row.openingDate) : "-"),
    },
    {
      key: "status",
      label: "Status",
      cellClassName: "text-muted-foreground",
      render: (row) => (row.active ? "Aktiv" : "Inaktiv"),
    },
    {
      key: "opening",
      label: "Anfangssaldo, EUR",
      cellClassName: "text-right tabular-nums text-muted-foreground",
      render: (row) => formatCents(row.openingCents ?? 0),
    },
    {
      key: "actions",
      label: "Aktionen",
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
        const haystack = `${account.number} ${account.name}`.toLowerCase();
        if (!haystack.includes(search.trim().toLowerCase())) return false;
      }
      return true;
    });

  const renderTab = () => {
    if (tab === "ledger") {
      if (ledger.loading || ledger.error || !ledger.data?.rows.length) {
        return (
          <TableState
            loading={ledger.loading}
            error={ledger.error}
            empty
            emptyText="Für den gewählten Zeitraum liegen keine Buchungen vor."
          />
        );
      }
      return (
        <AccountingTable
          columns={ledgerColumns}
          rows={ledger.data.rows}
          rowKey={(row) => String(row.id)}
          rowClassName={(row) => (row.storniert || row.isStorno ? "opacity-60" : "")}
        />
      );
    }

    if (tab === "journal") {
      if (journal.loading || journal.error || !journal.data?.rows.length) {
        return (
          <TableState
            loading={journal.loading}
            error={journal.error}
            empty
            emptyText="Für den gewählten Zeitraum liegen keine Buchungen vor."
          />
        );
      }
      return (
        <AccountingTable
          columns={journalColumns}
          rows={journal.data.rows}
          rowKey={(row) => row.buchungNr}
          rowClassName={(row) => (row.storniert || row.isStorno ? "opacity-60" : "")}
          minWidth="min-w-[92rem]"
        />
      );
    }

    if (tab === "accounts" || tab === "cash-bank") {
      const all = accounts.data?.accounts ?? [];
      const rows = filterAccounts(
        tab === "cash-bank" ? all.filter((a) => a.kind === "geldkonto") : all,
      );
      if (accounts.loading || accounts.error || !rows.length) {
        return (
          <TableState
            loading={accounts.loading}
            error={accounts.error}
            empty
            emptyText="Keine Konten gefunden."
          />
        );
      }
      return tab === "accounts" ? (
        <AccountingTable
          columns={accountColumns}
          rows={rows}
          rowKey={(row) => `${row.number}-${row.name}`}
          minWidth="min-w-[88rem]"
        />
      ) : (
        <AccountingTable
          columns={cashBankColumns}
          rows={rows}
          rowKey={(row) => row.number}
        />
      );
    }

    return (
      <Empty className="min-h-80 border-0">
        <EmptyHeader>
          <EmptyTitle>Keine Ergebnisse gefunden</EmptyTitle>
          <EmptyDescription>
            Für den gewählten Zeitraum liegen keine Rechnungen vor.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  };

  const printableTransactionIds = (() => {
    if (tab === "ledger") {
      return ledger.data?.rows?.filter((row) => row.printable).map((row) => row.id) ?? [];
    }
    if (tab === "journal") {
      return (
        journal.data?.rows
          ?.filter((row) => row.printable)
          .map((row) => row.transactionId) ?? []
      );
    }
    return [];
  })();

  const printFilteredRows = () => {
    if (!printableTransactionIds.length) {
      toast.info("Keine druckbaren Einträge im aktuellen Filter.");
      return;
    }
    setQuittungIds(printableTransactionIds);
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        center={
          <div className="max-w-[calc(100vw-18rem)] overflow-x-auto">
            <ToggleGroup
              type="single"
              value={tab}
              onValueChange={(value) => {
                if (value) setTab(value as TabKey);
              }}
              variant="outline"
              size="sm"
              spacing={0}
              aria-label="Buchhaltung Bereich"
            >
              {tabs.map((item) => (
                <ToggleGroupItem
                  key={item.value}
                  value={item.value}
                  aria-label={item.label}
                >
                  {item.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as TabKey)}
        className="min-h-0 flex-1 gap-0 overflow-hidden rounded-t-sm rounded-b-lg border border-border/70 bg-background"
      >
        <div className="min-h-0 flex-1 overflow-auto p-4 2xl:p-6">
          <Card className="animate-enter min-h-full">
            <CardContent className="flex flex-col gap-4">
              <Toolbar
                tab={tab}
                range={range}
                onRangeChange={setRange}
                search={searchInput}
                onSearchChange={setSearchInput}
                status={status}
                onStatusChange={setStatus}
                balances={ledger.data}
                onDatev={exportDatev}
                onPrintFiltered={printFilteredRows}
                hasPrintableRows={printableTransactionIds.length > 0}
                onNew={() => {
                  if (tab === "accounts") {
                    toast("Der Kontenrahmen SKR 03 ist fest hinterlegt.");
                  } else if (tab === "cash-bank") {
                    toast("Folgt demnächst.");
                  } else {
                    setPaymentOpen(true);
                  }
                }}
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
    </div>
  );
}
