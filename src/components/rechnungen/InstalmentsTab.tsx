/* ------------------------------------------------------------------ */
/* Ratenpläne — school-wide overview: all plans with paid/open rates,  */
/* overdue rates first. Plans are created and rates paid by hand on    */
/* the student's Zahlung tab; Lastschrift runs happen in the SEPA tab. */
/* ------------------------------------------------------------------ */

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatIsoDate, toIsoDate } from "@/components/buchhaltung/api";
import { useInstalmentPlans } from "@/hooks/use-payment-plans";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

function openStudent(id: number) {
  window.history.pushState({}, "", `/fahrschueler/${id}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
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
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Fahrschüler/in</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead className="text-right">Bezahlt</TableHead>
            <TableHead>Nächste Rate</TableHead>
            <TableHead className="pr-4">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ plan, next, overdue }) => (
            <TableRow
              key={plan.id}
              className="cursor-pointer"
              onClick={() => openStudent(plan.studentId)}
            >
              <TableCell className="pl-4 font-medium">{plan.studentName}</TableCell>
              <TableCell>{plan.title}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCents(plan.paidCents)} / {formatCents(plan.totalCents)} €
              </TableCell>
              <TableCell className="tabular-nums">
                {next
                  ? `${formatIsoDate(next.dueDate)} · ${formatCents(next.amountCents)} €`
                  : "–"}
              </TableCell>
              <TableCell className="pr-4">
                {plan.cancelledOn ? (
                  <Badge variant="outline" className="font-normal">
                    Beendet
                  </Badge>
                ) : overdue.length > 0 ? (
                  <Badge variant="outline" className={cn("font-normal text-destructive")}>
                    {overdue.length} Rate{overdue.length > 1 ? "n" : ""} überfällig
                  </Badge>
                ) : next ? (
                  <Badge variant="outline" className="font-normal">
                    Laufend
                  </Badge>
                ) : (
                  <Badge variant="outline" className="font-normal">
                    Abgeschlossen
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
