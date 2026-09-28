/* ------------------------------------------------------------------ */
/* Preisangebot — all price plans of the school (Standard, Rabatt, …). */
/* Reachable from the sidebar; plans are DB-backed via                 */
/* /api/price-plans and editable through PricePlanDialog.              */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { Edit3, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import { PricePlanDialog } from "./components/preise/PricePlanDialog";
import { deletePricePlan, usePricePlans } from "@/hooks/use-price-plans";
import { formatGuaranteedPeriod, type PricePlanRecord } from "@/lib/price-plan";
import { formatEuro } from "@/lib/money";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function PlanCard({
  plan,
  onEdit,
  onDelete,
}: {
  plan: PricePlanRecord;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{plan.name}</CardTitle>
        <CardDescription>
          {(plan.classes ?? []).length > 0
            ? `Klasse ${(plan.classes ?? []).join(", ")}`
            : "Alle Klassen"}
          {formatGuaranteedPeriod(plan.guaranteedMonths)
            ? ` · ${formatGuaranteedPeriod(plan.guaranteedMonths)}`
            : ""}
        </CardDescription>
        <CardAction>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`${plan.name} bearbeiten`}
              onClick={onEdit}
            >
              <Edit3 />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`${plan.name} löschen`}
              onClick={onDelete}
            >
              <Trash2 />
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
              {plan.components.map((component) => (
                <TableRow key={component.label}>
                  <TableCell className="whitespace-normal">
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
  );
}

export function Preisangebot() {
  const { plans, loading, refresh } = usePricePlans();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<PricePlanRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PricePlanRecord | null>(null);

  const openCreate = () => {
    setEditPlan(null);
    setDialogOpen(true);
  };

  const openEdit = (plan: PricePlanRecord) => {
    setEditPlan(plan);
    setDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deletePricePlan(deleteTarget.id);
      toast.success(`Preisplan „${deleteTarget.name}" gelöscht.`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Löschen fehlgeschlagen.");
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus data-icon="inline-start" />
            Preisplan
          </Button>
        }
      >
        <span className="text-sm font-medium">Preisangebot</span>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        {loading ? (
          <div className="flex min-h-64 items-center justify-center">
            <Spinner />
          </div>
        ) : plans.length === 0 ? (
          <Empty className="min-h-64 border-0">
            <EmptyHeader>
              <EmptyTitle>Keine Preispläne</EmptyTitle>
              <EmptyDescription>
                Legen Sie den ersten Preisplan an, um Tarife zu hinterlegen.
              </EmptyDescription>
            </EmptyHeader>
            <Button type="button" size="sm" onClick={openCreate}>
              <Plus data-icon="inline-start" />
              Preisplan anlegen
            </Button>
          </Empty>
        ) : (
          <div className="animate-enter grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                onEdit={() => openEdit(plan)}
                onDelete={() => setDeleteTarget(plan)}
              />
            ))}
          </div>
        )}
      </div>

      <PricePlanDialog
        open={dialogOpen}
        plan={editPlan}
        onClose={() => setDialogOpen(false)}
        onSaved={refresh}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Preisplan „{deleteTarget?.name}" löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Fahrschüler/innen mit diesem Tarif erhalten den ersten passenden Preisplan
              ihrer Klasse. Der Preisplan kann unter „Archiv" wiederhergestellt werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
