import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3 } from "lucide-react";

import { PageHeader } from "./components/PageHeader.tsx";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  useStatistics,
  type ExamTypeStatistics,
  type Statistics,
} from "@/hooks/use-statistics";

const panelClass = "h-full rounded-lg border border-border/80 shadow-none";
const panelHeaderClass = "border-b border-border/70";
const chartClass = "h-[230px] w-full aspect-auto 2xl:h-[270px]";

const formatEuro = (cents: number, maximumFractionDigits = 0) =>
  (cents / 100).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits,
  });

const formatMonth = (month: string) => {
  const [year, monthIndex] = month.split("-").map(Number);
  if (!year || !monthIndex) return month;
  return new Date(year, monthIndex - 1, 1).toLocaleDateString("de-DE", {
    month: "short",
    year: "2-digit",
  });
};

const formatHours = (minutes: number) =>
  `${(minutes / 60).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Std.`;

function goTo(url: string) {
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function HeaderStats({ stats }: { stats: Statistics }) {
  const items = [
    {
      label: "Aktive Fahrschüler",
      value: String(stats.students.aktiv),
      hint: `/ ${stats.students.total}`,
      href: "/fahrschueler",
    },
    {
      label: "Termine",
      value: String(stats.lessons.total),
      hint: "gesamt",
      href: "/kalender",
    },
    {
      label: "Umsatz",
      value: formatEuro(stats.revenue.totalCents),
      href: "/buchhaltung",
    },
    {
      label: "Aktive Fahrlehrer",
      value: String(stats.instructors.aktiv),
      hint: `/ ${stats.instructors.total}`,
      href: "/fahrlehrer",
    },
  ];

  return (
    <div className="hidden items-center divide-x divide-border/70 xl:flex">
      {items.map(({ label, value, hint, href }) => (
        <button
          key={label}
          type="button"
          onClick={() => goTo(href)}
          className="group relative flex flex-col items-start gap-1 rounded-none px-4 text-left whitespace-nowrap outline-hidden transition-transform duration-150 before:absolute before:inset-x-0 before:-inset-y-2 active:scale-[0.97] first:pl-2 last:pr-2 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          <span className="text-[11px] font-medium leading-none text-muted-foreground">
            {label}
          </span>
          <span className="flex items-baseline gap-1.5 leading-none">
            <span className="text-sm font-semibold leading-none tabular-nums transition-colors duration-150 group-hover:text-primary group-hover:duration-0">
              {value}
            </span>
            {hint ? (
              <span className="text-[11px] leading-none tabular-nums text-muted-foreground">
                {hint}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

function CompactSummary({ stats }: { stats: Statistics }) {
  const items = [
    {
      label: "Aktive Fahrschüler",
      value: String(stats.students.aktiv),
      detail: `von ${stats.students.total}`,
    },
    {
      label: "Termine",
      value: String(stats.lessons.total),
      detail: "gesamt",
    },
    {
      label: "Umsatz",
      value: formatEuro(stats.revenue.totalCents),
      detail: "erfasst",
    },
    {
      label: "Fahrlehrer",
      value: String(stats.instructors.aktiv),
      detail: `von ${stats.instructors.total}`,
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-2 rounded-lg border border-border/80 bg-card p-2 shadow-none sm:grid-cols-4 xl:hidden">
      {items.map((item) => (
        <div key={item.label} className="min-w-0 rounded-md bg-muted/40 px-3 py-3">
          <dt className="truncate text-[11px] font-medium text-muted-foreground">
            {item.label}
          </dt>
          <dd className="mt-1 flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[15px] font-semibold tracking-[-0.01em] tabular-nums">
              {item.value}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {item.detail}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ChartPanel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className={panelClass}>
      <CardHeader className={panelHeaderClass}>
        <CardTitle className="truncate text-sm font-medium">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[230px] items-center justify-center text-center 2xl:h-[270px]">
      <p className="max-w-64 text-xs text-pretty text-muted-foreground">{children}</p>
    </div>
  );
}

const registrationsConfig = {
  count: { label: "Anmeldungen", color: "var(--chart-1)" },
} satisfies ChartConfig;

function RegistrationsChart({ stats }: { stats: Statistics }) {
  const data = useMemo(
    () =>
      stats.students.registrationsPerMonth.map((row) => ({
        month: formatMonth(row.month),
        count: row.count,
      })),
    [stats.students.registrationsPerMonth],
  );
  const peak = Math.max(0, ...data.map((row) => row.count));
  const average =
    data.length === 0 ? 0 : data.reduce((sum, row) => sum + row.count, 0) / data.length;

  return (
    <ChartPanel
      title="Neue Fahrschüler"
      description="Anmeldungen pro Monat"
      action={
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">
            {average.toLocaleString("de-DE", { maximumFractionDigits: 1 })}
          </div>
          <div className="text-[11px] text-muted-foreground">Ø pro Monat</div>
        </div>
      }
    >
      {data.length === 0 ? (
        <ChartEmpty>Noch keine Anmeldungen mit Datum erfasst.</ChartEmpty>
      ) : (
        <ChartContainer config={registrationsConfig} className={chartClass}>
          <BarChart
            accessibilityLayer
            data={data}
            margin={{ top: 8, left: 0, right: 0, bottom: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
            <Bar
              dataKey="count"
              radius={[5, 5, 0, 0]}
              maxBarSize={36}
              isAnimationActive={false}
            >
              {data.map((row) => (
                <Cell
                  key={row.month}
                  fill={
                    row.count > 0 && row.count === peak
                      ? "var(--chart-1)"
                      : "var(--chart-2)"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      )}
    </ChartPanel>
  );
}

const revenueConfig = {
  euro: { label: "Umsatz", color: "var(--chart-1)" },
} satisfies ChartConfig;

function RevenueChart({ stats }: { stats: Statistics }) {
  const data = useMemo(
    () =>
      stats.revenue.perMonth.map((row) => ({
        month: formatMonth(row.month),
        euro: Math.round(row.cents) / 100,
      })),
    [stats.revenue.perMonth],
  );
  const current = data.at(-1)?.euro ?? 0;
  const previous = data.at(-2)?.euro ?? 0;
  const change = previous > 0 ? ((current - previous) / previous) * 100 : null;

  return (
    <ChartPanel
      title="Umsatzentwicklung"
      description="Monatlich verbuchte Erlöse"
      action={
        <div className="text-right">
          <div className="text-[15px] font-semibold tracking-[-0.01em] tabular-nums">
            {formatEuro(stats.revenue.totalCents)}
          </div>
          <div
            className={cn(
              "mt-0.5 flex items-center justify-end gap-1.5 text-[11px] tabular-nums",
              change === null
                ? "text-muted-foreground"
                : change >= 0
                  ? "text-green-700 dark:text-green-400"
                  : "text-red-700 dark:text-red-400",
            )}
          >
            {change !== null ? (
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  change >= 0
                    ? "bg-green-600 dark:bg-green-400"
                    : "bg-red-600 dark:bg-red-400",
                )}
              />
            ) : null}
            {change === null
              ? "Noch kein Vergleich"
              : `${change >= 0 ? "+" : ""}${change.toLocaleString("de-DE", { maximumFractionDigits: 1 })} % zum Vormonat`}
          </div>
        </div>
      }
    >
      {data.length === 0 ? (
        <ChartEmpty>Noch keine Erlösbuchungen vorhanden.</ChartEmpty>
      ) : (
        <ChartContainer config={revenueConfig} className={chartClass}>
          <AreaChart
            accessibilityLayer
            data={data}
            margin={{ top: 12, left: 0, right: 0, bottom: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  hideLabel
                  formatter={(value) => (
                    <div className="flex w-full items-center justify-between gap-4">
                      <span className="text-muted-foreground">Umsatz</span>
                      <span className="font-medium tabular-nums">
                        {typeof value === "number" ? formatEuro(value * 100, 2) : value}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Area
              dataKey="euro"
              type="monotone"
              fill="var(--chart-2)"
              fillOpacity={0.35}
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 4,
                fill: "var(--chart-1)",
                stroke: "var(--card)",
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </ChartPanel>
  );
}

function LessonTypesChart({ stats }: { stats: Statistics }) {
  const data = useMemo(
    () =>
      stats.lessons.byType
        .toSorted((a, b) => b.count - a.count)
        .map((row) => ({ type: row.type, count: row.count })),
    [stats.lessons.byType],
  );
  const peak = Math.max(0, ...data.map((row) => row.count));

  return (
    <ChartPanel
      title="Termine nach Art"
      description="Verteilung aller Kalendereinträge"
      action={
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{stats.lessons.total}</div>
          <div className="text-[11px] text-muted-foreground">Termine gesamt</div>
        </div>
      }
    >
      {data.length === 0 ? (
        <ChartEmpty>Noch keine Termine im Kalender.</ChartEmpty>
      ) : (
        <div className="flex h-[230px] flex-col justify-center gap-5 2xl:h-[270px]">
          {data.map((row) => {
            const percentage = peak === 0 ? 0 : (row.count / peak) * 100;
            return (
              <div key={row.type}>
                <div className="mb-2 flex items-baseline justify-between gap-4">
                  <span className="truncate text-sm font-medium">{row.type}</span>
                  <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                    {row.count}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      row.count > 0 && row.count === peak
                        ? "bg-primary"
                        : "bg-[var(--chart-2)]",
                    )}
                    style={{ width: `${Math.min(100, percentage)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ChartPanel>
  );
}

const utilizationConfig = {
  hours: { label: "Stunden", color: "var(--chart-1)" },
} satisfies ChartConfig;

function UtilizationChart({ stats }: { stats: Statistics }) {
  const data = useMemo(
    () =>
      stats.instructors.utilization
        .toSorted((a, b) => b.minutes - a.minutes)
        .map((row) => ({
          instructor: row.instructor,
          hours: Math.round((row.minutes / 60) * 10) / 10,
          events: row.events,
        })),
    [stats.instructors.utilization],
  );
  const peak = Math.max(0, ...data.map((row) => row.hours));
  const totalMinutes = stats.instructors.utilization.reduce(
    (sum, row) => sum + row.minutes,
    0,
  );

  return (
    <ChartPanel
      title="Auslastung Fahrlehrer"
      description="Geplante Stunden nach Fahrlehrer"
      action={
        data.length > 0 ? (
          <div className="text-right">
            <div className="text-sm font-semibold tabular-nums">
              {formatHours(totalMinutes)}
            </div>
            <div className="text-[11px] text-muted-foreground">geplant gesamt</div>
          </div>
        ) : undefined
      }
    >
      {data.length === 0 ? (
        <ChartEmpty>Noch keine Termine zugeteilt.</ChartEmpty>
      ) : (
        <ChartContainer config={utilizationConfig} className={chartClass}>
          <BarChart
            accessibilityLayer
            data={data}
            layout="vertical"
            margin={{ top: 8, left: 0, right: 16, bottom: 0 }}
          >
            <CartesianGrid horizontal={false} />
            <XAxis type="number" dataKey="hours" hide />
            <YAxis
              type="category"
              dataKey="instructor"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={112}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value, _name, _item, _index, payload) => (
                    <div className="flex w-full items-center justify-between gap-4">
                      <span className="text-muted-foreground">
                        <span className="tabular-nums">
                          {(payload as { events?: number })?.events ?? 0}
                        </span>{" "}
                        Termine
                      </span>
                      <span className="font-medium tabular-nums">
                        {typeof value === "number"
                          ? `${value.toLocaleString("de-DE")} Std.`
                          : value}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Bar
              dataKey="hours"
              radius={[0, 5, 5, 0]}
              maxBarSize={24}
              isAnimationActive={false}
            >
              {data.map((row) => (
                <Cell
                  key={row.instructor}
                  fill={
                    row.hours > 0 && row.hours === peak
                      ? "var(--chart-1)"
                      : "var(--chart-2)"
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      )}
    </ChartPanel>
  );
}

type ExamMetricProps = {
  label: string;
  value: number;
  tone: "positive" | "negative" | "pending";
};

function ExamMetric({ label, value, tone }: ExamMetricProps) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          tone === "positive" && "bg-green-600 dark:bg-green-400",
          tone === "negative" && "bg-red-600 dark:bg-red-400",
          tone === "pending" && "bg-amber-600 dark:bg-amber-400",
        )}
      />
      <span className="font-medium tabular-nums text-foreground">{value}</span>
      {label}
    </div>
  );
}

function ExamRow({ row }: { row: ExamTypeStatistics }) {
  const label = row.type === "Theorieprüfung" ? "Theorieprüfung" : "Praktische Prüfung";
  const rate =
    row.firstAttemptPassRate === null
      ? "–"
      : `${Math.round(row.firstAttemptPassRate * 100)} %`;

  return (
    <div className="grid gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{label}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          <ExamMetric label="bestanden" value={row.bestanden} tone="positive" />
          <ExamMetric
            label="nicht bestanden"
            value={row.nicht_bestanden}
            tone="negative"
          />
          <ExamMetric label="offen" value={row.offen} tone="pending" />
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-4 sm:flex-col sm:items-end sm:gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          Erfolgsquote · 1. Versuch
        </span>
        <span className="text-[15px] font-semibold tracking-[-0.01em] tabular-nums">
          {rate}
        </span>
      </div>
    </div>
  );
}

function ExamsPanel({ stats }: { stats: Statistics }) {
  const total = stats.exams.byType.reduce((sum, row) => sum + row.total, 0);

  return (
    <ChartPanel
      title="Prüfungsergebnisse"
      description={
        total === 0 ? (
          "Noch keine Ergebnisse erfasst"
        ) : (
          <>
            <span className="tabular-nums">{total}</span> Prüfungen insgesamt
          </>
        )
      }
    >
      {total === 0 ? (
        <ChartEmpty>
          Ergebnisse werden im Prüfungsplaner pro Termin eingetragen.
        </ChartEmpty>
      ) : (
        <div className="divide-y divide-border/60">
          {stats.exams.byType.map((row) => (
            <ExamRow key={row.type} row={row} />
          ))}
        </div>
      )}
    </ChartPanel>
  );
}

function OperationsPanel({ stats }: { stats: Statistics }) {
  const rows = [
    {
      label: "Fahrlehrer aktiv",
      value: stats.instructors.aktiv,
      total: stats.instructors.total,
    },
    {
      label: "Fahrzeuge im Einsatz",
      value: stats.vehicles.aktiv,
      total: stats.vehicles.total,
    },
  ];

  return (
    <ChartPanel
      title="Betrieb"
      description="Aktuelle verfügbare Kapazität"
      action={
        stats.vehicles.wartung > 0 ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-amber-600 dark:bg-amber-400"
            />
            <span className="tabular-nums">{stats.vehicles.wartung}</span> in Wartung
          </span>
        ) : undefined
      }
    >
      <div className="divide-y divide-border/60">
        {rows.map((row) => {
          const percentage = row.total === 0 ? 0 : (row.value / row.total) * 100;
          return (
            <div key={row.label} className="py-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm font-medium">{row.label}</span>
                <span className="text-sm font-semibold tabular-nums">
                  {row.value}
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    / {row.total}
                  </span>
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary motion-reduce:transition-none"
                  style={{ width: `${Math.min(100, percentage)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </ChartPanel>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-[1800px] grid-cols-1 gap-4 xl:grid-cols-12 2xl:gap-5">
      <Skeleton className="h-[330px] rounded-lg xl:col-span-7" />
      <Skeleton className="h-[330px] rounded-lg xl:col-span-5" />
      <Skeleton className="h-[330px] rounded-lg xl:col-span-5" />
      <Skeleton className="h-[330px] rounded-lg xl:col-span-7" />
      <Skeleton className="h-52 rounded-lg xl:col-span-8" />
      <Skeleton className="h-52 rounded-lg xl:col-span-4" />
    </div>
  );
}

export function Statistik() {
  const { statistics, loading } = useStatistics();

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        center={statistics ? <HeaderStats stats={statistics} /> : undefined}
        end={<span className="text-sm font-medium sm:hidden">Statistik</span>}
      >
        <span className="hidden text-sm font-medium sm:inline">Statistik</span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        {loading ? (
          <LoadingSkeleton />
        ) : !statistics ? (
          <Empty className="h-full border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BarChart3 />
              </EmptyMedia>
              <EmptyTitle>Statistik nicht verfügbar</EmptyTitle>
              <EmptyDescription>
                Die Auswertung konnte nicht geladen werden. Bitte Seite neu laden.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="stagger-in mx-auto grid w-full max-w-[1680px] grid-cols-1 items-start gap-4 xl:grid-cols-12 2xl:gap-5">
            <div className="xl:hidden">
              <CompactSummary stats={statistics} />
            </div>
            <div className="xl:col-span-7">
              <RevenueChart stats={statistics} />
            </div>
            <div className="xl:col-span-5">
              <RegistrationsChart stats={statistics} />
            </div>
            <div className="xl:col-span-5">
              <LessonTypesChart stats={statistics} />
            </div>
            <div className="xl:col-span-7">
              <UtilizationChart stats={statistics} />
            </div>
            <div className="xl:col-span-8">
              <ExamsPanel stats={statistics} />
            </div>
            <div className="xl:col-span-4">
              <OperationsPanel stats={statistics} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Statistik;
