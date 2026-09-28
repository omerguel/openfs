import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis } from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ChevronRight,
  MapPin,
  Plus,
} from "lucide-react";

import { InstructorToday } from "@/components/dashboard/InstructorToday";
import { SetupChecklist } from "@/components/dashboard/SetupChecklist";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { PageHeader } from "./components/PageHeader.tsx";
import { MeinTagHint } from "./components/MeinTagHint.tsx";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  addDays,
  type CalEvent,
  eventTypeShortLabel,
  isCancelled,
  isFahrstunde,
  isSameDay,
  parseISODate,
  startOfWeek,
  toISODate,
  toMinutes,
  TODAY,
} from "@/lib/calendar-data";
import { useCalendarEvents } from "@/hooks/use-calendar-events";
import { useStudents } from "@/hooks/use-students";
import { useAuthStatus } from "@/hooks/use-auth";
import { useOpenItems } from "@/hooks/use-invoices";
import { useStatistics } from "@/hooks/use-statistics";
import { useVehicles } from "@/hooks/use-vehicles";
import { huState } from "@/lib/vehicle-hu";
import { formatEuro } from "@/lib/money";

/* Navigate without threading the router down — mirrors the "Schüler
   anmelden" button and the usePath() popstate listener in App.tsx. */
function goTo(url: string) {
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/* ------------------------------------------------------------------ */
/* Shared calendar data — every widget below is derived from the        */
/* persisted events (via useCalendarEvents) so the dashboard always     */
/* agrees with /kalender.                                               */
/* ------------------------------------------------------------------ */

const weekStart = startOfWeek(TODAY);
const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

const byDateTime = (a: CalEvent, b: CalEvent) =>
  a.date === b.date ? toMinutes(a.start) - toMinutes(b.start) : a.date < b.date ? -1 : 1;

const eventsOn = (events: CalEvent[], day: Date) =>
  events.filter((event) => isSameDay(parseISODate(event.date), day));

/* h-full lets the three widgets share one row height (the tallest — the
   month calendar — sets it), so the row reads as one composed band
   instead of three ragged card bottoms. */
const dashboardCardClass = "h-full rounded-lg border border-border/80 ring-0 shadow-none";
const dashboardCardHeaderClass = "border-b border-border/70";

function PanelTitle({ children }: { children: React.ReactNode }) {
  /* truncate (not balance-wrap): a two-line title makes one card header
     taller and breaks the hairline alignment across the widget band. */
  return <CardTitle className="truncate text-sm font-medium">{children}</CardTitle>;
}

/* ------------------------------------------------------------------ */
/* Top bar — compact stat readouts in the header center, instrument-   */
/* cluster style: tiny condensed label over the value. The number is   */
/* the visual; clicking a readout jumps to its page.                   */
/* ------------------------------------------------------------------ */

type Stat = {
  label: string;
  value: string;
  href: string;
  /* `positive` is about meaning, not arithmetic sign — fewer open
     invoices is a negative delta but good news, so it reads green. */
  trend?: { delta: string; positive: boolean };
  hint?: string;
};

function HeaderStats({ events }: { events: CalEvent[] }) {
  const { students } = useStudents();
  const activeStudents = students.filter((student) => student.status === "aktiv").length;

  // Counts derived from the shared sources — students come from the DB.
  const fahrstundenThisWeek = events.filter(isFahrstunde).length;
  const fahrstundenToday = eventsOn(events, TODAY).filter(isFahrstunde).length;

  const role = useAuthStatus().data?.user?.role;
  const canSeeFinance = role === "inhaber" || role === "buero";
  const { statistics } = useStatistics(canSeeFinance);
  const openItems = useOpenItems(canSeeFinance);
  const monthKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const month = monthKey(TODAY);
  const previousMonth = monthKey(new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, 1));
  const revenueOf = (m: string) =>
    statistics?.revenue.perMonth.find((row) => row.month === m)?.cents ?? 0;
  const revenueThisMonth = revenueOf(month);
  const revenueLastMonth = revenueOf(previousMonth);
  const revenueTrend =
    revenueLastMonth > 0
      ? {
          delta: `${revenueThisMonth >= revenueLastMonth ? "+" : "−"}${(
            (Math.abs(revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100
          ).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`,
          positive: revenueThisMonth >= revenueLastMonth,
        }
      : undefined;
  const openInvoices = openItems.data?.invoices.length ?? 0;
  const overdueInvoices = openItems.data?.totals.overdueCount ?? 0;

  const stats: Stat[] = [
    {
      label: "Schüler",
      value: String(activeStudents),
      href: "/fahrschueler",
      hint: `/ ${students.length}`,
    },
    {
      label: "Fahrstunden",
      value: String(fahrstundenThisWeek),
      href: "/kalender",
      hint: `${fahrstundenToday} heute`,
    },
    // Finance readouts come from the ledger/invoices — hidden for roles
    // without access to money matters (the API refuses them anyway).
    ...(canSeeFinance
      ? [
          {
            label: "Umsatz",
            value: formatEuro(revenueThisMonth),
            href: "/buchhaltung",
            hint: "diesen Monat",
            ...(revenueTrend ? { trend: revenueTrend } : {}),
          },
          {
            label: "Offene Rechnungen",
            value: String(openInvoices),
            href: "/rechnungen",
            hint:
              overdueInvoices > 0 ? `${overdueInvoices} überfällig` : "keine überfällig",
          },
        ]
      : []),
  ];

  return (
    /* xl, not lg — between 1024 and 1280 the readouts collide with the
       header button and wrap inside the fixed h-11 bar. Hide responsively
       rather than wrapping (guideline §4). */
    <div className="hidden items-center divide-x divide-border/70 xl:flex">
      {stats.map(({ label, value, href, trend, hint }) => (
        <button
          key={label}
          type="button"
          onClick={() => goTo(href)}
          className="group relative flex flex-col items-start gap-1 rounded-none px-4 text-left whitespace-nowrap outline-hidden before:absolute before:inset-x-0 before:-inset-y-2 focus-visible:ring-2 focus-visible:ring-ring first:pl-2 last:pr-2"
        >
          <span className="text-[11px] font-medium leading-none text-muted-foreground">
            {label}
          </span>
          <span className="flex items-baseline gap-1.5 leading-none">
            <span className="text-sm font-semibold leading-none tabular-nums transition-colors group-hover:text-primary">
              {value}
            </span>
            {trend ? (
              <span
                className={cn(
                  "text-[11px] leading-none tabular-nums",
                  trend.positive
                    ? "text-green-700 dark:text-green-400"
                    : "text-destructive",
                )}
              >
                {trend.delta}
              </span>
            ) : hint ? (
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

function Navigation({ events, office }: { events: CalEvent[]; office: boolean }) {
  return (
    <PageHeader
      center={<HeaderStats events={events} />}
      end={
        office ? (
          <Button size="sm" onClick={() => goTo("/neue-schueler")}>
            <Plus data-icon="inline-start" />
            <span className="hidden sm:inline">Schüler anmelden</span>
            <span className="sm:hidden">Anmelden</span>
          </Button>
        ) : undefined
      }
    />
  );
}

/* HU reminder for the office: vehicles whose HU is overdue or due within
   60 days (same rule as the badge on /fahrzeuge). */
function HuHint() {
  const { vehicles } = useVehicles();
  const due = vehicles.filter((vehicle) => {
    const hu = vehicle.details.find((d) => d.label === "Nächste HU")?.value;
    const state = huState(hu);
    return state === "due" || state === "overdue";
  });
  if (due.length === 0) return null;
  return (
    <Alert className="mx-auto w-full max-w-[1800px]">
      <AlertTriangle />
      <AlertDescription>
        <span>
          HU fällig oder bald fällig:{" "}
          {due
            .map(
              (v) =>
                `${v.model} (${v.details.find((d) => d.label === "Nächste HU")?.value})`,
            )
            .join(", ")}
          .{" "}
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => goTo("/fahrzeuge")}
          >
            Zu den Fahrzeugen
          </button>
        </span>
      </AlertDescription>
    </Alert>
  );
}

/* ------------------------------------------------------------------ */
/* Chart — weekly lessons bar chart                                    */
/* ------------------------------------------------------------------ */

const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const chartConfig = {
  value: { label: "Fahrstunden", color: "var(--chart-1)" },
} satisfies ChartConfig;

function Chart({ events }: { events: CalEvent[] }) {
  // Fahrstunden (practical driving lessons) per weekday, straight from the
  // calendar events — same items the /kalender grid renders.
  const chartData = useMemo(
    () =>
      weekDays.map((day, i) => ({
        day: WEEKDAY_LABELS[i],
        value: eventsOn(events, day).filter(isFahrstunde).length,
      })),
    [events],
  );
  const total = chartData.reduce((s, d) => s + d.value, 0);
  const max = Math.max(...chartData.map((d) => d.value));
  return (
    <Card className={dashboardCardClass}>
      <CardHeader className={dashboardCardHeaderClass}>
        <PanelTitle>Fahrstunden</PanelTitle>
        <CardDescription>
          <span className="tabular-nums">{total}</span> in dieser Woche
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => goTo("/kalender")}>
            Alle ansehen
            <ChevronRight />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {total === 0 ? (
          <div className="flex min-h-[240px] flex-1 flex-col items-center justify-center gap-1 text-center">
            <CalendarDays className="size-5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Keine Fahrstunden diese Woche
            </span>
          </div>
        ) : (
          /* basis-0 keeps the chart from dictating the row height — it
           absorbs whatever the calendar column leaves it. */
          <ChartContainer
            config={chartConfig}
            className="aspect-auto min-h-[240px] w-full flex-1 basis-0"
          >
            <BarChart data={chartData} margin={{ top: 8, left: 0, right: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              {/* The busiest day reads at full strength; the rest recede.
                Top-only rounding keeps bars anchored to the baseline. */}
              <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={36}>
                {chartData.map((entry) => (
                  <Cell
                    key={entry.day}
                    fill={
                      entry.value > 0 && entry.value === max
                        ? "var(--chart-1)"
                        : "var(--chart-2)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* List — upcoming appointments                                        */
/* ------------------------------------------------------------------ */

const weekdayShort = (date: Date) =>
  date.toLocaleDateString("de-DE", { weekday: "short" }).replace(".", "");

function List({ events }: { events: CalEvent[] }) {
  const openCalendar = () => goTo("/kalender?filter=non-fahrstunde");
  // Everything that isn't a routine driving lesson — theory, exams, exam
  // prep, courses — from today onward ("anstehend" excludes the past).
  // Clicking through opens the calendar filtered to these.
  const nonFahrstundeEvents = useMemo(() => {
    const todayISO = toISODate(TODAY);
    return events
      .filter((event) => !isFahrstunde(event) && event.date >= todayISO)
      .sort(byDateTime);
  }, [events]);
  return (
    <Card className={dashboardCardClass}>
      <CardHeader className={dashboardCardHeaderClass}>
        <PanelTitle>Anstehende Termine</PanelTitle>
        <CardDescription>
          <span className="tabular-nums">{nonFahrstundeEvents.length}</span>{" "}
          {nonFahrstundeEvents.length === 1 ? "Termin" : "Termine"} ohne Fahrstunden
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={openCalendar}>
            Kalender
            <ChevronRight />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {nonFahrstundeEvents.length === 0 ? (
          <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center gap-1 text-center">
            <CalendarDays className="size-5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Keine anstehenden Termine
            </span>
          </div>
        ) : (
          /* Radix wraps viewport children in a display:table div that sizes
           to max-content, which defeats row truncation — force block so
           long titles ellipsize instead of clipping the badges. */
          <ScrollArea className="min-h-[280px] flex-1 basis-0 [&>[data-slot=scroll-area-viewport]>div]:block!">
            <div className="flex flex-col gap-1 pr-3">
              {nonFahrstundeEvents.map((event) => {
                const place = event.location ?? event.vehicle;
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={openCalendar}
                    className="group/row flex items-center gap-3 rounded-md px-2 py-2.5 text-left outline-hidden transition-colors duration-150 hover:bg-muted hover:duration-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <span className="flex w-12 shrink-0 flex-col items-center">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {weekdayShort(parseISODate(event.date))}
                      </span>
                      <span className="text-sm font-medium tabular-nums">
                        {event.start}
                      </span>
                    </span>
                    <Separator orientation="vertical" className="h-9" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{event.title}</span>
                      <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        {event.subtitle}
                        {place && (
                          <>
                            <span className="text-border">·</span>
                            <MapPin className="size-3 shrink-0" />
                            {place}
                          </>
                        )}
                      </span>
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {eventTypeShortLabel[event.type]}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Calendar — month view with agenda                                   */
/* ------------------------------------------------------------------ */

function MonthCalendar({ events }: { events: CalEvent[] }) {
  const [selected, setSelected] = useState<Date | undefined>(TODAY);
  // Days that have at least one event, for the calendar's dot markers.
  const eventDates = useMemo(
    () => [...new Set(events.map((event) => event.date))].map(parseISODate),
    [events],
  );
  const dayEvents = selected
    ? eventsOn(events, selected).sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
    : [];
  const isToday = selected ? isSameDay(selected, TODAY) : false;
  const dayLabel = selected
    ? selected.toLocaleDateString("de-DE", { day: "numeric", month: "long" })
    : "";

  return (
    <Card className={dashboardCardClass}>
      <CardHeader className={dashboardCardHeaderClass}>
        <PanelTitle>Kalender</PanelTitle>
        <CardDescription>Monatsübersicht</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Calendar
          mode="single"
          required
          selected={selected}
          onSelect={setSelected}
          defaultMonth={new Date(TODAY.getFullYear(), TODAY.getMonth(), 1)}
          weekStartsOn={1}
          showOutsideDays={false}
          className="mx-auto p-0 [--cell-size:--spacing(8)]"
          modifiers={{ event: eventDates }}
          modifiersClassNames={{
            event:
              "relative after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary data-[selected-single=true]:after:bg-primary-foreground",
          }}
          formatters={{
            formatCaption: (d) =>
              d.toLocaleDateString("de-DE", { month: "long", year: "numeric" }),
            formatWeekdayName: (d) => d.toLocaleDateString("de-DE", { weekday: "short" }),
          }}
        />

        <Separator />

        <div className="flex flex-col">
          <div className="flex items-baseline justify-between pb-2">
            <span className="text-sm font-medium">
              {dayLabel}
              {isToday && (
                <span className="ml-1.5 text-xs text-muted-foreground">Heute</span>
              )}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {dayEvents.length} {dayEvents.length === 1 ? "Termin" : "Termine"}
            </span>
          </div>

          {dayEvents.length > 0 ? (
            <div key={dayLabel} className="flex flex-col gap-1">
              {dayEvents.map((event, idx) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => goTo("/kalender")}
                  className="animate-agenda-row group/row flex items-center gap-2.5 rounded-md px-1 py-2 text-left outline-hidden transition-colors duration-150 hover:bg-muted hover:duration-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <span className="h-8 w-1 shrink-0 rounded-full bg-primary/70" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{event.title}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {event.start} Uhr
                    </span>
                  </div>
                  <ArrowRight className="mr-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover/row:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover/row:translate-x-0" />
                </button>
              ))}
            </div>
          ) : (
            <div
              key={dayLabel}
              className="animate-agenda-fade flex flex-col items-center justify-center gap-1 py-6 text-center"
            >
              <CalendarDays className="size-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Keine Termine an diesem Tag
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export function Dashboard() {
  const { events: allEvents } = useCalendarEvents();
  const user = useAuthStatus().data?.user;
  const office = user?.role === "inhaber" || user?.role === "buero";
  const instructorId = user?.instructorId ?? null;
  // Cancelled lessons stay in the calendar as history but are not work.
  // A Fahrlehrer sees their own Termine only.
  const events = useMemo(
    () =>
      allEvents.filter(
        (event) =>
          !isCancelled(event) &&
          (office || (instructorId !== null && event.instructorId === instructorId)),
      ),
    [allEvents, office, instructorId],
  );
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <Navigation events={events} office={office} />
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:gap-5 2xl:p-6",
        )}
      >
        {/* The 12-col band needs ~1280px: below that the month calendar
            (7 × 32px cells + card padding) no longer fits a 3–4 col slot,
            so everything stacks. The cap keeps ultra-wide monitors from
            stretching the cards into slabs. */}
        {office && (
          <div className="mx-auto w-full max-w-[1800px]">
            <SetupChecklist />
          </div>
        )}
        {office && <HuHint />}
        <div className="stagger-in mx-auto grid w-full max-w-[1800px] grid-cols-1 gap-4 2xl:gap-5 xl:grid-cols-12">
          <MeinTagHint />
          <div className="xl:col-span-4 2xl:col-span-5">
            <Chart events={events} />
          </div>
          <div className="xl:col-span-4">
            {office ? (
              <List events={events} />
            ) : (
              <InstructorToday events={events} linked={instructorId !== null} />
            )}
          </div>
          <div className="xl:col-span-4 2xl:col-span-3">
            <MonthCalendar events={events} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
