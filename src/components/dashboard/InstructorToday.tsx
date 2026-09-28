/* The Fahrlehrer's own day on the dashboard: today's Termine of the     */
/* linked instructor, and the way to "Mein Tag" (when that page exists)  */
/* or the calendar.                                                      */

import { Link, useRouter } from "@tanstack/react-router";
import { CalendarDays, ChevronRight, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type CalEvent,
  eventTypeShortLabel,
  toISODate,
  toMinutes,
  TODAY,
} from "@/lib/calendar-data";

export function InstructorToday({
  events,
  linked,
}: {
  /** The instructor's own (non-cancelled) events. */
  events: CalEvent[];
  /** Whether the signed-in user is linked to an instructor. */
  linked: boolean;
}) {
  const router = useRouter();
  const hasMyDay = "/mein-tag" in router.routesByPath;
  const today = toISODate(TODAY);
  const todays = events
    .filter((event) => event.date === today)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  // "/mein-tag" is added separately; typed as string until it is registered.
  const target: string = hasMyDay ? "/mein-tag" : "/kalender";

  return (
    <Card className="h-full rounded-lg border border-border/80 shadow-none ring-0">
      <CardHeader className="border-b border-border/70">
        <CardTitle className="truncate text-sm font-medium">Mein Tag</CardTitle>
        <CardDescription>
          {linked
            ? `${todays.length} ${todays.length === 1 ? "Termin" : "Termine"} heute`
            : "Zugang ohne Fahrlehrer-Verknüpfung"}
        </CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link to={target}>
              {hasMyDay ? "Mein Tag öffnen" : "Kalender"}
              <ChevronRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-h-[240px] flex-col gap-1">
        {!linked ? (
          <p className="m-auto max-w-xs text-center text-xs text-pretty text-muted-foreground">
            Ihr Zugang ist noch keinem Fahrlehrer zugeordnet. Bitten Sie die Inhaberin
            bzw. den Inhaber, ihn unter Verwaltung → Benutzer zu verknüpfen — dann sehen
            Sie hier Ihre Termine.
          </p>
        ) : todays.length === 0 ? (
          <div className="m-auto flex flex-col items-center gap-1 text-center">
            <CalendarDays className="size-5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Heute keine Termine</span>
          </div>
        ) : (
          todays.map((event) => {
            const place = event.location ?? event.vehicle;
            return (
              <Link
                key={event.id}
                to={target}
                className="flex items-center gap-3 rounded-md px-2 py-2 text-left outline-hidden transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="w-20 shrink-0 text-sm font-medium tabular-nums">
                  {event.start}–{event.end}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{event.title}</span>
                  <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    {event.subtitle}
                    {place && (
                      <>
                        <MapPin className="size-3 shrink-0" />
                        {place}
                      </>
                    )}
                  </span>
                </span>
                <Badge variant="secondary" className="shrink-0">
                  {eventTypeShortLabel[event.type]}
                </Badge>
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
