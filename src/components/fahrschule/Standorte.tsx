/* Standorte (Filialen / Anmeldestellen) — tab of "Fahrschule &          */
/* Einstellungen". Each change saves immediately via /api/branches.     */

import { useState } from "react";
import {
  Building2,
  Clock,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { FormField, RequiredLegend } from "@/components/FormField";
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
  type Branch,
  type BranchInput,
  createBranch,
  deleteBranch,
  updateBranch,
  useBranches,
} from "@/hooks/use-branches";
import { cn } from "@/lib/utils";

const emptyDraft: BranchInput = {
  name: "",
  address: "",
  phone: "",
  email: "",
  openingHours: "",
  isMain: false,
  status: "offen",
};

function BranchDialog({
  branch,
  onClose,
  onSaved,
}: {
  /** null = new Standort */
  branch: Branch | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<BranchInput>(() => {
    if (!branch) return emptyDraft;
    const { id: _id, createdAt: _createdAt, ...rest } = branch;
    return rest;
  });
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const errors = {
    name: draft.name.trim() ? null : "Bitte einen Namen angeben.",
    address: draft.address.trim() ? null : "Bitte die Adresse angeben.",
  };
  const set = <K extends keyof BranchInput>(key: K, value: BranchInput[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setTouched(true);
    if (errors.name || errors.address) return;
    setSaving(true);
    try {
      if (branch) await updateBranch(branch.id, draft);
      else await createBranch(draft);
      await onSaved();
      toast.success(branch ? "Standort gespeichert." : "Standort angelegt.");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {branch ? "Standort bearbeiten" : "Standort hinzufügen"}
          </DialogTitle>
          <DialogDescription>
            Filiale oder Anmeldestelle — erscheint mit Adresse und Öffnungszeiten.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="branch-name"
              label="Name"
              required
              error={touched ? errors.name : null}
            >
              <Input
                placeholder="z. B. Hauptstelle Mitte"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </FormField>
            <FormField
              id="branch-address"
              label="Adresse"
              required
              error={touched ? errors.address : null}
            >
              <Input
                placeholder="Straße Nr., PLZ Ort"
                value={draft.address}
                onChange={(e) => set("address", e.target.value)}
              />
            </FormField>
            <FormField id="branch-phone" label="Telefon">
              <Input
                type="tel"
                value={draft.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </FormField>
            <FormField id="branch-email" label="E-Mail">
              <Input
                type="email"
                value={draft.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </FormField>
            <FormField id="branch-hours" label="Öffnungszeiten">
              <Input
                placeholder="z. B. Mo–Fr 14–18 Uhr"
                value={draft.openingHours}
                onChange={(e) => set("openingHours", e.target.value)}
              />
            </FormField>
            <FormField id="branch-status" label="Status">
              <NativeSelect
                className="w-full"
                value={draft.status}
                onChange={(e) => set("status", e.target.value as BranchInput["status"])}
              >
                <NativeSelectOption value="offen">Offen</NativeSelectOption>
                <NativeSelectOption value="geschlossen">Geschlossen</NativeSelectOption>
              </NativeSelect>
            </FormField>
          </div>
          <RequiredLegend />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Speichert …" : "Speichern"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BranchRow({
  branch,
  onEdit,
  onDelete,
  onMakeMain,
}: {
  branch: Branch;
  onEdit: () => void;
  onDelete: () => void;
  onMakeMain: () => void;
}) {
  const details = [
    { Icon: MapPin, value: branch.address },
    { Icon: Phone, value: branch.phone },
    { Icon: Mail, value: branch.email },
    { Icon: Clock, value: branch.openingHours },
  ].filter((detail) => detail.value);
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-start">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-md",
          branch.isMain ? "bg-amber-500/10 text-amber-600" : "bg-sky-500/10 text-sky-600",
        )}
      >
        <Building2 className="size-5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{branch.name}</span>
          {branch.isMain && (
            <Badge variant="secondary">
              <Star data-icon="inline-start" />
              Hauptstandort
            </Badge>
          )}
          <Badge variant="outline" className="font-normal">
            {branch.status === "offen" ? "Offen" : "Geschlossen"}
          </Badge>
        </div>
        <dl className="flex flex-col gap-1 text-sm text-muted-foreground">
          {details.map(({ Icon, value }) => (
            <div key={value} className="flex items-center gap-2">
              <Icon className="size-3.5 shrink-0" />
              <dd className="truncate">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {!branch.isMain && (
          <Button type="button" variant="ghost" size="sm" onClick={onMakeMain}>
            Als Hauptstandort
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${branch.name} bearbeiten`}
          onClick={onEdit}
        >
          <Pencil />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          aria-label={`${branch.name} löschen`}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

export function Standorte() {
  const { branches, loading, refresh } = useBranches();
  const [editing, setEditing] = useState<Branch | "new" | null>(null);
  const [deleting, setDeleting] = useState<Branch | null>(null);

  const makeMain = async (branch: Branch) => {
    try {
      await updateBranch(branch.id, { isMain: true });
      await refresh();
      toast.success(`„${branch.name}“ ist jetzt der Hauptstandort.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Aktion fehlgeschlagen.");
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await deleteBranch(deleting.id);
      await refresh();
      toast.success("Standort gelöscht.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Löschen fehlgeschlagen.");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          Filialen und Anmeldestellen Ihrer Fahrschule. Änderungen hier werden sofort
          gespeichert.
        </p>
        {branches.length > 0 && (
          <Button type="button" size="sm" onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" />
            Standort hinzufügen
          </Button>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-28 rounded-lg" />
      ) : branches.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Building2 />
            </EmptyMedia>
            <EmptyTitle>Noch keine Standorte</EmptyTitle>
            <EmptyDescription>
              Legen Sie Ihren Hauptstandort an — und weitere Filialen, falls vorhanden.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" onClick={() => setEditing("new")}>
              <Plus data-icon="inline-start" />
              Standort hinzufügen
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {branches.map((branch) => (
            <BranchRow
              key={branch.id}
              branch={branch}
              onEdit={() => setEditing(branch)}
              onDelete={() => setDeleting(branch)}
              onMakeMain={() => void makeMain(branch)}
            />
          ))}
        </div>
      )}

      {editing && (
        <BranchDialog
          key={editing === "new" ? "new" : editing.id}
          branch={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Standort löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `„${deleting.name}“ (${deleting.address}) wird dauerhaft entfernt.`
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
