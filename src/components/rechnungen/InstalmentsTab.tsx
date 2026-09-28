/* ------------------------------------------------------------------ */
/* Ratenpläne — school-wide overview: all plans with paid/open rates,  */
/* overdue rates first. Plans are created and rates paid by hand on    */
/* the student's Zahlung tab; Lastschrift runs happen in the SEPA tab. */
/* Payments count automatically: every payment on the student's        */
/* Ausbildungskonto after the plan started covers the oldest open      */
/* rate (see src/server/instalments.ts).                               */
/* ------------------------------------------------------------------ */

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatIsoDate, toIsoDate } from "@/components/buchhaltung/api";
import { useInstalmentPlans } from "@/hooks/use-payment-plans";
import type { Instalment } from "@/lib/payment-plan-types";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

function openStudent(id: number) {
  window.history.pushState({}, "", `/fahrschueler/${id}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function RateChip({ rate, today }: { rate: Instalment; today: string }) {
  const paidCents = rate.paidCents ?? (rate.paid ? rate.amountCents : 0);
  const partial = !rate.paid && paidCents > 0;
  const overdue = !rate.paid && rate.dueDate < today;
  return (
    <li
      className={cn(
        "flex flex-col rounded-md border px-2 py-1 text-xs tabular-nums",
        rate.paid && "border-green-500/40 bg-green-500/10",
        overdue && "border-destructive/50 text-destructive",
      )}
    >
      <span>
        {rate.seq}. · {formatIsoDate(rate.dueDate)}
      </span>
      <span className="font-medium">{formatCents(rate.amountCents)} €</span>
      <span className="text-[11px] text-muted-foreground">
        {rate.paid
          ? "bezahlt"
          : partial
            ? `${formatCents(paidCents)} € bezahlt · ${formatCents(rate.amountCents - paidCents)} € offen`
            : rate.inCollection
              ? "im Lastschrifteinzug"
              : "offen"}
      </span>
    </li>
  );
}

export function InstalmentsTab() {
  const plans = useInstalmentPlans();
  const today = toIsoDate(new Date());
  if (plans.isPending) return <Skeleton className="h-40 rounded-lg" />;
  const list = plans.data ?? [];
  if (list.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Noch keine Ratenpläne. Anlegen im Zahlungsbereich eines Fahrschülers.
      </p>
    );
  }
  const rows = list.map((plan) => {
    const open = plan.instalments.filter((r) => !r.paid);
    const overdue = plan.cancelledOn ? [] : open.filter((r) => r.dueDate < today);
    return { plan, next: plan.cancelledOn ? undefined : open[0], overdue };
  });
  rows.sort((a, b) => b.overdue.length - a.overdue.length);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-pretty text-muted-foreground">
        Zahlungen auf das Ausbildungskonto werden automatisch der ältesten offenen Rate
        zugeordnet — auch Barzahlungen, die nicht über „Als bezahlt buchen“ erfasst
        wurden.
      </p>
      {rows.map(({ plan, next, overdue }) => (
        <button
          type="button"
          key={plan.id}
          onClick={() => openStudent(plan.studentId)}
          className="flex flex-col gap-2 rounded-lg border p-3 text-left text-sm transition-colors duration-150 hover:bg-muted/50 hover:duration-0"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">{plan.studentName}</span>
            <span className="text-muted-foreground">{plan.title}</span>
            <span className="ml-auto tabular-nums">
              {formatCents(plan.paidCents)} von {formatCents(plan.totalCents)} € bezahlt
            </span>
            {plan.cancelledOn ? (
              <Badge variant="outline" className="font-normal">
                Beendet
              </Badge>
            ) : overdue.length > 0 ? (
              <Badge variant="outline" className="font-normal text-destructive">
                {overdue.length} {overdue.length === 1 ? "Rate" : "Raten"} überfällig
              </Badge>
            ) : next ? (
              <Badge variant="outline" className="font-normal">
                Nächste Rate {formatIsoDate(next.dueDate)}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1.5 font-normal">
                <span aria-hidden className="size-1.5 rounded-full bg-green-500" />
                Abgeschlossen
              </Badge>
            )}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {plan.instalments.map((rate) => (
              <RateChip key={rate.id} rate={rate} today={today} />
            ))}
          </ul>
        </button>
      ))}
    </div>
  );
}
