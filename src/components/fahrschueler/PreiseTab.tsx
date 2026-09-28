/* ------------------------------------------------------------------ */
/* Fahrschüler detail — Preise tab. Shows the price plan assigned to   */
/* the student (default: first plan), lets the user switch plans,      */
/* edit the tariff inline, or jump to the Preisangebot page.           */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { Edit3, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import type { StudentRecord } from "@/hooks/use-students";
import { usePricePlans } from "@/hooks/use-price-plans";
import type { Student } from "@/lib/student-data";
import {
  formatGuaranteedPeriod,
  planMatchesClasses,
  resolveStudentPlan,
  type PricePlanRecord,
} from "@/lib/price-plan";
import { formatEuro } from "@/lib/money";
import { PricePlanDialog } from "@/components/preise/PricePlanDialog";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function PreiseTab({
  student,
  onSave,
  navigate,
}: {
  student: StudentRecord;
  onSave: (updates: Partial<Student>) => Promise<void>;
  navigate: (to: string) => void;
}) {
  const { plans, loading, refresh } = usePricePlans();
  const [editOpen, setEditOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const assignedPlan: PricePlanRecord | null = resolveStudentPlan(plans, student) ?? null;
  const isFallback = assignedPlan != null && assignedPlan.id !== student.pricePlanId;
  // Plans for the student's class first; the others stay selectable.
  const matching = plans.filter((plan) => planMatchesClasses(plan, student.classes));
  const others = plans.filter((plan) => !planMatchesClasses(plan, student.classes));
  const guarantee = assignedPlan
    ? formatGuaranteedPeriod(assignedPlan.guaranteedMonths)
    : null;

  const assignPlan = async (value: string) => {
    const id = Number(value);
    if (!Number.isInteger(id) || id === student.pricePlanId) return;
    setAssigning(true);
    try {
      await onSave({ pricePlanId: id });
      const plan = plans.find((entry) => entry.id === id);
      toast.success(`Preisplan „${plan?.name ?? id}" zugewiesen.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Zuweisen fehlgeschlagen.");
    } finally {
      setAssigning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!assignedPlan) {
    return (
      <Empty className="min-h-64 border-0">
        <EmptyHeader>
          <EmptyTitle>Keine Preispläne hinterlegt</EmptyTitle>
          <EmptyDescription>
            Legen Sie zuerst einen Preisplan im Preisangebot an.
          </EmptyDescription>
        </EmptyHeader>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => navigate("/preisangebot")}
        >
          <ExternalLink data-icon="inline-start" />
          Zum Preisangebot
        </Button>
      </Empty>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Datum des Fahrschulvertrages{" "}
          <span className="font-medium text-foreground">{student.registrationDate}</span>
        </p>
        <div className="flex items-center gap-2">
          <Select
            value={String(assignedPlan.id)}
            onValueChange={assignPlan}
            disabled={assigning}
          >
            <SelectTrigger className="w-52" size="sm" aria-label="Preisplan wählen">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Für Klasse {student.classes || "—"}</SelectLabel>
                {matching.map((plan) => (
                  <SelectItem key={plan.id} value={String(plan.id)}>
                    {plan.name}
                  </SelectItem>
                ))}
              </SelectGroup>
              {others.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Andere Klassen</SelectLabel>
                  {others.map((plan) => (
                    <SelectItem key={plan.id} value={String(plan.id)}>
                      {plan.name}
                      <span className="text-muted-foreground">
                        {" "}
                        · {(plan.classes ?? []).join(", ")}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate("/preisangebot")}
          >
            <ExternalLink data-icon="inline-start" />
            Alle Preispläne
          </Button>
        </div>
      </div>

      {isFallback && (
        <p className="text-xs text-muted-foreground">
          Kein Preisplan fest zugewiesen — es gilt der erste passende Preisplan für Klasse{" "}
          {student.classes}. Die Auswahl oben weist einen Preisplan fest zu.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{assignedPlan.name}</CardTitle>
          <CardDescription>
            {guarantee ? `${guarantee} ab ` : "Gültig ab "}
            {student.registrationDate}
          </CardDescription>
          <CardAction>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{student.classes}</Badge>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditOpen(true)}
              >
                <Edit3 data-icon="inline-start" />
                Bearbeiten
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Preiskomponente</TableHead>
                  <TableHead className="text-right">Preis</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignedPlan.components.map((component) => (
                  <TableRow key={component.label}>
                    <TableCell>
                      {component.label}
                      {component.durationMin != null && (
                        <span className="text-muted-foreground">
                          {" "}
                          ({component.durationMin} Min)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {component.priceCents == null ? (
                        <span className="text-muted-foreground">inklusive</span>
                      ) : (
                        formatEuro(component.priceCents)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <PricePlanDialog
        open={editOpen}
        plan={assignedPlan}
        onClose={() => setEditOpen(false)}
        onSaved={refresh}
      />
    </div>
  );
}
