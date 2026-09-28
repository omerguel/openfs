/* ------------------------------------------------------------------ */
/* Fahrzeuge — fleet list + create/edit dialog.                         */
/* Fahrlehrer/in on a vehicle = that instructor's Stammfahrzeug (one    */
/* source of truth, see server/vehicles.ts). HU is a month with an      */
/* overdue / due-soon badge (lib/vehicle-hu.ts).                        */
/* ------------------------------------------------------------------ */

import { useMemo, useState } from "react";
import { AlertTriangle, Car, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { FormField, RequiredLegend } from "@/components/FormField";
import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { instructorName, useInstructors } from "@/hooks/use-instructors";
import {
  useCreateVehicle,
  useDeleteVehicle,
  useUpdateVehicle,
  useVehicles,
  type Vehicle,
  type VehicleInput,
} from "@/hooks/use-vehicles";
import { cn } from "@/lib/utils";
import {
  formatHuMonth,
  formatMileage,
  HU_STATE_LABELS,
  huState,
  mileageDigits,
  parseHuMonth,
} from "@/lib/vehicle-hu";

const LABEL = {
  gearbox: "Getriebe",
  fuel: "Kraftstoff",
  mileage: "Kilometerstand",
  instructor: "Fahrlehrer/in",
  hu: "Nächste HU",
  insurance: "Versicherung",
} as const;

const CLASS_OPTIONS = [
  "B",
  "B197",
  "B Automatik",
  "BE",
  "B96",
  "AM",
  "A1",
  "A2",
  "A",
  "C1",
  "C1E",
  "C",
  "CE",
  "D1",
  "D",
  "DE",
  "T",
  "L",
  "Mofa",
];
const GEARBOX_OPTIONS = ["Schaltgetriebe", "Automatik"];
const FUEL_OPTIONS = [
  "Benzin",
  "Diesel",
  "Elektro",
  "Hybrid",
  "Plug-in-Hybrid",
  "Erdgas / LPG",
];
const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

const STATUS_DOTS: Record<Vehicle["status"], string> = {
  aktiv: "bg-green-500",
  wartung: "bg-amber-500",
};
const STATUS_LABELS: Record<Vehicle["status"], string> = {
  aktiv: "Aktiv",
  wartung: "In Wartung",
};

const detail = (vehicle: Vehicle | null, label: string) =>
  vehicle?.details.find((d) => d.label === label)?.value ?? "";

/** Options with the current (legacy/free-text) value kept selectable. */
const withCurrent = (options: string[], current: string) =>
  current && !options.includes(current) ? [current, ...options] : options;

type Draft = {
  model: string;
  plate: string;
  klass: string;
  status: Vehicle["status"];
  gearbox: string;
  fuel: string;
  mileage: string;
  /** "" = nicht zugeteilt, "multi" = unchanged (several instructors). */
  instructor: string;
  huMonth: string;
  huYear: string;
  insurance: string;
};

function toDraft(vehicle: Vehicle | null): Draft {
  const hu = parseHuMonth(detail(vehicle, LABEL.hu));
  const ids = vehicle?.instructorIds ?? [];
  return {
    model: vehicle?.model ?? "",
    plate: vehicle?.plate ?? "",
    klass: vehicle?.klass ?? "B",
    status: vehicle?.status ?? "aktiv",
    gearbox: detail(vehicle, LABEL.gearbox),
    fuel: detail(vehicle, LABEL.fuel),
    mileage: mileageDigits(detail(vehicle, LABEL.mileage)),
    instructor: ids.length > 1 ? "multi" : ids.length === 1 ? String(ids[0]) : "",
    huMonth: hu ? String(hu.month) : "",
    huYear: hu ? String(hu.year) : "",
    insurance: detail(vehicle, LABEL.insurance),
  };
}

function draftErrors(draft: Draft) {
  return {
    model: draft.model.trim() ? null : "Bitte das Modell angeben, z. B. VW Golf.",
    plate: draft.plate.trim() ? null : "Bitte das Kennzeichen angeben.",
    klass: draft.klass.trim() ? null : "Bitte die Klasse wählen.",
    hu:
      Boolean(draft.huMonth) !== Boolean(draft.huYear)
        ? "Bitte Monat und Jahr der HU wählen."
        : null,
  };
}

function toPayload(draft: Draft, vehicle: Vehicle | null): Partial<VehicleInput> {
  const initial = toDraft(vehicle);
  const hu =
    draft.huMonth && draft.huYear
      ? formatHuMonth({ month: Number(draft.huMonth), year: Number(draft.huYear) })
      : "";
  return {
    model: draft.model.trim(),
    plate: draft.plate.trim().toUpperCase(),
    klass: draft.klass,
    status: draft.status,
    details: [
      { label: LABEL.gearbox, value: draft.gearbox },
      { label: LABEL.fuel, value: draft.fuel },
      { label: LABEL.mileage, value: formatMileage(draft.mileage) },
      { label: LABEL.hu, value: hu },
      { label: LABEL.insurance, value: draft.insurance.trim() },
    ],
    // Only when changed — "multi" keeps several instructors as they are.
    ...(draft.instructor !== initial.instructor && draft.instructor !== "multi"
      ? { instructorId: draft.instructor ? Number(draft.instructor) : null }
      : {}),
  };
}

function VehicleDialog({
  vehicle,
  onClose,
}: {
  /** null = new vehicle */
  vehicle: Vehicle | null;
  onClose: () => void;
}) {
  const { instructors } = useInstructors();
  const createVehicle = useCreateVehicle();
  const updateVehicle = useUpdateVehicle();
  const [draft, setDraft] = useState<Draft>(() => toDraft(vehicle));
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const saving = createVehicle.isPending || updateVehicle.isPending;
  const errors = draftErrors(draft);
  const shown = submitted ? errors : { model: null, plate: null, klass: null, hu: null };
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => String(thisYear - 1 + i));
  if (draft.huYear && !years.includes(draft.huYear)) years.unshift(draft.huYear);
  const multiNames = detail(vehicle, LABEL.instructor);

  const save = async () => {
    setSubmitted(true);
    setServerError(null);
    if (Object.values(errors).some(Boolean)) return;
    try {
      const payload = toPayload(draft, vehicle);
      if (vehicle) {
        await updateVehicle.mutateAsync({ id: vehicle.id, input: payload });
        toast.success("Fahrzeug gespeichert.");
      } else {
        await createVehicle.mutateAsync(payload);
        toast.success(`Fahrzeug „${payload.model}“ angelegt.`);
      }
      onClose();
    } catch (error) {
      // Shown in the dialog, next to what needs fixing.
      setServerError(
        error instanceof Error
          ? error.message
          : "Fahrzeug konnte nicht gespeichert werden.",
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {vehicle ? "Fahrzeug bearbeiten" : "Fahrzeug hinzufügen"}
          </DialogTitle>
          <DialogDescription>
            Stammdaten, Zuteilung und Termine wie HU und Versicherung.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {serverError && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="vehicle-model" label="Modell" required error={shown.model}>
              <Input
                placeholder="z. B. VW Golf"
                value={draft.model}
                onChange={(e) => set("model", e.target.value)}
              />
            </FormField>
            <FormField
              id="vehicle-plate"
              label="Kennzeichen"
              required
              error={shown.plate}
            >
              <Input
                placeholder="z. B. DA-FS 1234"
                className="uppercase"
                value={draft.plate}
                onChange={(e) => set("plate", e.target.value)}
              />
            </FormField>
            <FormField id="vehicle-class" label="Klasse" required error={shown.klass}>
              <NativeSelect
                className="w-full"
                value={draft.klass}
                onChange={(e) => set("klass", e.target.value)}
              >
                {withCurrent(CLASS_OPTIONS, draft.klass).map((option) => (
                  <NativeSelectOption key={option} value={option}>
                    {option}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="vehicle-status" label="Status">
              <NativeSelect
                className="w-full"
                value={draft.status}
                onChange={(e) => set("status", e.target.value as Vehicle["status"])}
              >
                <NativeSelectOption value="aktiv">Aktiv</NativeSelectOption>
                <NativeSelectOption value="wartung">In Wartung</NativeSelectOption>
              </NativeSelect>
            </FormField>
            <FormField id="vehicle-gearbox" label="Getriebe">
              <NativeSelect
                className="w-full"
                value={draft.gearbox}
                onChange={(e) => set("gearbox", e.target.value)}
              >
                <NativeSelectOption value="">Keine Angabe</NativeSelectOption>
                {withCurrent(GEARBOX_OPTIONS, draft.gearbox).map((option) => (
                  <NativeSelectOption key={option} value={option}>
                    {option}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField id="vehicle-fuel" label="Kraftstoff">
              <NativeSelect
                className="w-full"
                value={draft.fuel}
                onChange={(e) => set("fuel", e.target.value)}
              >
                <NativeSelectOption value="">Keine Angabe</NativeSelectOption>
                {withCurrent(FUEL_OPTIONS, draft.fuel).map((option) => (
                  <NativeSelectOption key={option} value={option}>
                    {option}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              id="vehicle-mileage"
              label="Kilometerstand"
              hint="In km, nur Ziffern."
            >
              <Input
                inputMode="numeric"
                placeholder="z. B. 84320"
                className="tabular-nums"
                value={draft.mileage ? Number(draft.mileage).toLocaleString("de-DE") : ""}
                onChange={(e) =>
                  set("mileage", mileageDigits(e.target.value).slice(0, 7))
                }
              />
            </FormField>
            <FormField
              id="vehicle-instructor"
              label="Fahrlehrer/in"
              hint="Wird als Stammfahrzeug bei der Fahrlehrerin bzw. dem Fahrlehrer eingetragen."
            >
              <NativeSelect
                className="w-full"
                value={draft.instructor}
                onChange={(e) => set("instructor", e.target.value)}
              >
                <NativeSelectOption value="">Nicht zugeteilt</NativeSelectOption>
                {draft.instructor === "multi" && (
                  <NativeSelectOption value="multi">
                    {multiNames} (unverändert)
                  </NativeSelectOption>
                )}
                {instructors
                  .filter(
                    (i) => i.status === "aktiv" || String(i.id) === draft.instructor,
                  )
                  .map((i) => (
                    <NativeSelectOption key={i.id} value={String(i.id)}>
                      {instructorName(i)}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </FormField>
            <fieldset className="flex min-w-0 flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium">Nächste HU</legend>
              <div className="flex gap-2">
                <NativeSelect
                  aria-label="HU Monat"
                  className="flex-1"
                  value={draft.huMonth}
                  aria-invalid={shown.hu ? true : undefined}
                  onChange={(e) => set("huMonth", e.target.value)}
                >
                  <NativeSelectOption value="">Monat</NativeSelectOption>
                  {MONTHS.map((name, i) => (
                    <NativeSelectOption key={name} value={String(i + 1)}>
                      {name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label="HU Jahr"
                  className="w-28"
                  value={draft.huYear}
                  aria-invalid={shown.hu ? true : undefined}
                  onChange={(e) => set("huYear", e.target.value)}
                >
                  <NativeSelectOption value="">Jahr</NativeSelectOption>
                  {years.map((year) => (
                    <NativeSelectOption key={year} value={year}>
                      {year}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              {shown.hu ? (
                <span role="alert" className="text-xs text-destructive">
                  {shown.hu}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Laut Prüfplakette — wir erinnern 60 Tage vorher.
                </span>
              )}
            </fieldset>
            <FormField id="vehicle-insurance" label="Versicherung">
              <Input
                placeholder="z. B. Allianz · gültig bis 12/2026"
                value={draft.insurance}
                onChange={(e) => set("insurance", e.target.value)}
              />
            </FormField>
          </div>
          <RequiredLegend />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Speichert …" : vehicle ? "Speichern" : "Fahrzeug anlegen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: Vehicle["status"] }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOTS[status])} />
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function HuBadge({ value }: { value: string }) {
  const state = huState(value);
  if (!state || state === "ok") return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-normal",
        state === "overdue"
          ? "border-destructive/40 text-destructive"
          : "border-amber-500/50 text-amber-700 dark:text-amber-400",
      )}
    >
      <AlertTriangle className="size-3" />
      {HU_STATE_LABELS[state]}
    </Badge>
  );
}

function VehicleRow({
  vehicle,
  onEdit,
  onDelete,
}: {
  vehicle: Vehicle;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hu = detail(vehicle, LABEL.hu);
  const show = (label: string) => detail(vehicle, label) || "—";
  return (
    <TableRow
      tabIndex={0}
      className="group/row cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdit();
        }
      }}
    >
      <TableCell>
        <div className="flex min-w-36 flex-col gap-0.5">
          <span className="font-medium">{vehicle.model}</span>
          <span className="font-mono text-xs tracking-tight text-muted-foreground">
            {vehicle.plate}
          </span>
          <span className="md:hidden">
            <HuBadge value={hu} />
          </span>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{vehicle.klass || "—"}</TableCell>
      <TableCell className="hidden text-muted-foreground lg:table-cell">
        {show(LABEL.gearbox)}
      </TableCell>
      <TableCell className="hidden text-muted-foreground xl:table-cell">
        {show(LABEL.fuel)}
      </TableCell>
      <TableCell className="hidden tabular-nums xl:table-cell">
        {show(LABEL.mileage)}
      </TableCell>
      <TableCell className="hidden lg:table-cell">{show(LABEL.instructor)}</TableCell>
      <TableCell className="hidden md:table-cell">
        <div className="flex flex-col items-start gap-1">
          <span className="tabular-nums">{hu || "—"}</span>
          <HuBadge value={hu} />
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge status={vehicle.status} />
      </TableCell>
      <TableCell className="w-20 text-right">
        <div className="flex justify-end opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${vehicle.model} bearbeiten`}
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label={`${vehicle.model} löschen`}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function Fahrzeuge() {
  const { vehicles, loading } = useVehicles();
  const deleteVehicle = useDeleteVehicle();
  const [editing, setEditing] = useState<Vehicle | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const deleting = vehicles.find((v) => v.id === deletingId) ?? null;
  const huDue = useMemo(
    () =>
      vehicles.filter((v) => {
        const state = huState(detail(v, LABEL.hu));
        return state === "due" || state === "overdue";
      }),
    [vehicles],
  );

  const remove = async () => {
    if (!deleting) return;
    try {
      await deleteVehicle.mutateAsync(deleting.id);
      toast.success("Fahrzeug gelöscht.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Löschen fehlgeschlagen.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <Button type="button" size="sm" onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" />
            <span className="hidden sm:inline">Fahrzeug hinzufügen</span>
            <span className="sm:hidden">Neu</span>
          </Button>
        }
      >
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="text-[15px] font-semibold tracking-[-0.01em]">Fahrzeuge</h1>
          <span className="text-xs tabular-nums text-muted-foreground">
            {loading ? "—" : vehicles.length}
          </span>
        </div>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        {huDue.length > 0 && (
          <Alert>
            <AlertTriangle />
            <AlertDescription>
              HU fällig oder bald fällig:{" "}
              {huDue.map((v) => `${v.model} (${detail(v, LABEL.hu)})`).join(", ")}.
            </AlertDescription>
          </Alert>
        )}
        {loading ? (
          <div className="overflow-hidden rounded-lg border">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton
                key={index}
                className="h-14 rounded-none border-b last:border-0"
              />
            ))}
          </div>
        ) : vehicles.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Car />
              </EmptyMedia>
              <EmptyTitle>Noch keine Fahrzeuge</EmptyTitle>
              <EmptyDescription>
                Legen Sie Ihre Schulungsfahrzeuge an — dann lassen sie sich Terminen und
                Fahrlehrern zuordnen, und OpenFS erinnert an die HU.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" onClick={() => setEditing("new")}>
                <Plus data-icon="inline-start" />
                Fahrzeug hinzufügen
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="animate-enter overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Fahrzeug</TableHead>
                  <TableHead>Klasse</TableHead>
                  <TableHead className="hidden lg:table-cell">Getriebe</TableHead>
                  <TableHead className="hidden xl:table-cell">Kraftstoff</TableHead>
                  <TableHead className="hidden xl:table-cell">Kilometerstand</TableHead>
                  <TableHead className="hidden lg:table-cell">Fahrlehrer/in</TableHead>
                  <TableHead className="hidden md:table-cell">Nächste HU</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Aktionen</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map((vehicle) => (
                  <VehicleRow
                    key={vehicle.id}
                    vehicle={vehicle}
                    onEdit={() => setEditing(vehicle)}
                    onDelete={() => setDeletingId(vehicle.id)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {editing && (
        <VehicleDialog
          key={editing === "new" ? "new" : editing.id}
          vehicle={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeletingId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fahrzeug löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `„${deleting.model}“ (${deleting.plate}) wird ins Archiv verschoben. Zugeordnete Schüler und Fahrlehrer werden auf „Nicht zugeteilt“ gesetzt.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default Fahrzeuge;
