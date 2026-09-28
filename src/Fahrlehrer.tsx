import { useState } from "react";
import { GraduationCap, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "./components/PageHeader.tsx";
import { panelActionsClass, panelInteractiveClass } from "./components/Panel.tsx";
import {
  createInstructor,
  deleteInstructor,
  instructorName,
  updateInstructor,
  useInstructors,
  type Instructor,
  type InstructorInput,
} from "@/hooks/use-instructors";
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useVehicleOptions } from "@/hooks/use-vehicle-options";
import { UNASSIGNED_VEHICLE } from "@/lib/vehicle-options";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const STATUS_DOTS: Record<InstructorInput["status"], string> = {
  aktiv: "bg-green-500",
  inaktiv: "bg-muted-foreground/50",
};

const STATUS_LABELS: Record<InstructorInput["status"], string> = {
  aktiv: "Aktiv",
  inaktiv: "Inaktiv",
};

const emptyDraft: InstructorInput = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  classes: "",
  vehicle: "",
  since: "",
  status: "aktiv",
};

function instructorToDraft(instructor: Instructor): InstructorInput {
  const { id: _id, ...draft } = instructor;
  return draft;
}

/* Status as a colored dot + plain label in an outline badge (guideline §3). */
function StatusBadge({ status }: { status: InstructorInput["status"] }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_DOTS[status])} />
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/* Quiet readout: micro-label over value, no icon chips (guideline §3, §5). */
function Detail({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] font-medium leading-none text-muted-foreground">
        {label}
      </dt>
      <dd className={cn("truncate text-sm font-medium", className)}>{value || "—"}</dd>
    </div>
  );
}

function InstructorDialog({
  title,
  description,
  draft,
  open,
  saving,
  onOpenChange,
  onChange,
  onSave,
  onDelete,
}: {
  title: string;
  description: string;
  draft: InstructorInput;
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (draft: InstructorInput) => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const { vehicleOptions } = useVehicleOptions();

  function update<Key extends keyof InstructorInput>(
    key: Key,
    value: InstructorInput[Key],
  ) {
    onChange({ ...draft, [key]: value });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="instructor-first-name">Vorname</FieldLabel>
            <Input
              id="instructor-first-name"
              value={draft.firstName}
              onChange={(event) => update("firstName", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="instructor-last-name">Nachname</FieldLabel>
            <Input
              id="instructor-last-name"
              value={draft.lastName}
              onChange={(event) => update("lastName", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="instructor-classes">Ausbildungsklassen</FieldLabel>
            <Input
              id="instructor-classes"
              placeholder="z. B. B, B197"
              value={draft.classes}
              onChange={(event) => update("classes", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="instructor-status">Status</FieldLabel>
            <Select
              value={draft.status}
              onValueChange={(value) =>
                update("status", value as InstructorInput["status"])
              }
            >
              <SelectTrigger id="instructor-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="aktiv">Aktiv</SelectItem>
                  <SelectItem value="inaktiv">Inaktiv</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="instructor-phone">Telefon</FieldLabel>
            <Input
              id="instructor-phone"
              value={draft.phone}
              onChange={(event) => update("phone", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="instructor-email">E-Mail</FieldLabel>
            <Input
              id="instructor-email"
              type="email"
              value={draft.email}
              onChange={(event) => update("email", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="instructor-vehicle">Stammfahrzeug</FieldLabel>
            <NativeSelect
              id="instructor-vehicle"
              value={draft.vehicle || UNASSIGNED_VEHICLE}
              onChange={(event) => update("vehicle", event.target.value)}
              className="w-full"
            >
              {(vehicleOptions.includes(draft.vehicle) || !draft.vehicle
                ? vehicleOptions
                : [draft.vehicle, ...vehicleOptions]
              ).map((option) => (
                <NativeSelectOption key={option} value={option}>
                  {option}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="instructor-since">Dabei seit</FieldLabel>
            <Input
              id="instructor-since"
              placeholder="z. B. 03/2019"
              value={draft.since}
              onChange={(event) => update("since", event.target.value)}
            />
          </Field>
        </FieldGroup>

        <DialogFooter className="gap-2 sm:justify-between">
          {onDelete ? (
            <Button
              type="button"
              variant="destructive"
              disabled={saving}
              onClick={onDelete}
            >
              <Trash2 data-icon="inline-start" />
              Löschen
            </Button>
          ) : (
            <span />
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Abbrechen
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={saving || !draft.firstName.trim() || !draft.lastName.trim()}
              onClick={onSave}
            >
              Speichern
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InstructorCard({
  instructor,
  onEdit,
}: {
  instructor: Instructor;
  onEdit: () => void;
}) {
  const fullName = instructorName(instructor);
  const details = [
    { label: "Telefon", value: instructor.phone, nums: true },
    { label: "E-Mail", value: instructor.email, nums: false },
    { label: "Stammfahrzeug", value: instructor.vehicle, nums: false },
    { label: "Dabei seit", value: instructor.since, nums: true },
  ].filter((detail) => detail.value);

  return (
    <Card className={cn("border-border/70", panelInteractiveClass)}>
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <CardTitle className="truncate text-sm font-semibold">{fullName}</CardTitle>
          <CardDescription className="text-xs">
            Klassen {instructor.classes || "—"}
          </CardDescription>
        </div>
        <CardAction>
          <div className={cn("flex items-center gap-1.5", panelActionsClass)}>
            <StatusBadge status={instructor.status} />
            <div className="flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`${fullName} bearbeiten`}
                onClick={onEdit}
              >
                <Pencil />
              </Button>
            </div>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {details.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3.5">
            {details.map(({ label, value, nums }) => (
              <Detail
                key={label}
                label={label}
                value={value}
                className={nums ? "tabular-nums" : undefined}
              />
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Keine Kontaktdaten hinterlegt.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function Fahrlehrer() {
  const { instructors, loading, refresh } = useInstructors();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<InstructorInput>(emptyDraft);
  const [saving, setSaving] = useState(false);

  const startCreating = () => {
    setDraft(emptyDraft);
    setCreating(true);
  };

  const startEditing = (instructor: Instructor) => {
    setDraft(instructorToDraft(instructor));
    setEditingId(instructor.id);
  };

  const save = async (action: () => Promise<unknown>, success: string) => {
    setSaving(true);
    try {
      await action();
      await refresh();
      setCreating(false);
      setEditingId(null);
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  const removeEditingInstructor = async () => {
    if (editingId === null) return;
    const name = `${draft.firstName} ${draft.lastName}`.trim();
    const confirmed = window.confirm(
      `${name || "Diese/n Fahrlehrer/in"} wirklich löschen? Zugeordnete Fahrschüler werden auf „Nicht zugeteilt“ gesetzt.`,
    );
    if (!confirmed) return;

    await save(
      () => deleteInstructor(editingId),
      "Fahrlehrer/in gelöscht. Zugeordnete Fahrschüler wurden aktualisiert.",
    );
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-[3px] overflow-hidden bg-sidebar">
      <PageHeader
        end={
          <Button type="button" size="sm" onClick={startCreating}>
            <Plus data-icon="inline-start" />
            Fahrlehrer/in hinzufügen
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto rounded-t-sm rounded-b-lg border border-border/70 bg-background p-4 2xl:p-6">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:gap-5">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-40 rounded-lg" />
            ))}
          </div>
        ) : instructors.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-muted-foreground">
            <GraduationCap className="size-5" />
            <span className="text-sm">Noch keine Fahrlehrer/innen angelegt.</span>
          </div>
        ) : (
          <div className="stagger-in grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:gap-5">
            {instructors.map((instructor) => (
              <InstructorCard
                key={instructor.id}
                instructor={instructor}
                onEdit={() => startEditing(instructor)}
              />
            ))}
          </div>
        )}
      </div>

      <InstructorDialog
        title="Fahrlehrer/in hinzufügen"
        description="Neue Fahrlehrerin oder neuen Fahrlehrer anlegen."
        draft={draft}
        open={creating}
        saving={saving}
        onOpenChange={(open) => !open && setCreating(false)}
        onChange={setDraft}
        onSave={() => save(() => createInstructor(draft), "Fahrlehrer/in angelegt.")}
      />

      <InstructorDialog
        title="Fahrlehrer/in bearbeiten"
        description="Stammdaten, Status und Zuordnung aktualisieren."
        draft={draft}
        open={editingId !== null}
        saving={saving}
        onOpenChange={(open) => !open && setEditingId(null)}
        onChange={setDraft}
        onSave={() =>
          save(() => updateInstructor(editingId!, draft), "Änderungen gespeichert.")
        }
        onDelete={removeEditingInstructor}
      />
    </div>
  );
}

export default Fahrlehrer;
