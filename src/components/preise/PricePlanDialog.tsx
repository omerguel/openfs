/* ------------------------------------------------------------------ */
/* Preisplan anlegen/bearbeiten — one dialog for both. Prices are      */
/* entered as German euro strings and stored as integer cents; an      */
/* empty price means "inklusive" (no separate charge). A plan can be   */
/* limited to Führerscheinklassen (Pkw-Tarif, Motorrad-Tarif, …).      */
/* ------------------------------------------------------------------ */

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  BILLABLE_EVENT_TYPES,
  type BillableEventType,
  type PricePlanInput,
  type PricePlanRecord,
} from "@/lib/price-plan";
import { LICENSE_CLASS_GROUPS } from "@/lib/license-classes";
import { createPricePlan, updatePricePlan } from "@/hooks/use-price-plans";
import { formatCents, parseEuroToCents } from "@/lib/money";
import { AccountSelect } from "@/components/preise/AccountSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type ComponentDraft = {
  label: string;
  duration: string; // minutes as text, "" = none
  price: string; // euro string, "" = inklusive
  eventType: BillableEventType | ""; // "" = only billed by hand
  erloesKonto: string; // account number
  /** false until the user picks "Abrechnen bei"/Konto — until then both
      follow the label (Theorieprüfung → Theorieprüfung, TÜV → 1370). */
  touched: boolean;
};

const emptyRow: ComponentDraft = {
  label: "",
  duration: "",
  price: "",
  eventType: "",
  erloesKonto: "4400",
  touched: false,
};

const EVENT_TYPE_LABELS: Record<BillableEventType, string> = {
  Praktisch: "Fahrstunde",
  Theorieprüfung: "Theorieprüfung",
  "Vorstellung zur prakt. Prüfung": "Prakt. Prüfung",
};

/** Sensible defaults from the component name. */
function inferFromLabel(
  label: string,
): Pick<ComponentDraft, "eventType" | "erloesKonto"> {
  const text = label.toLocaleLowerCase("de-DE");
  const fee = /tüv|dekra|prüfgebühr|gebühr/.test(text);
  let eventType: ComponentDraft["eventType"] = "";
  if (/theorie/.test(text) && /prüfung|gebühr/.test(text)) eventType = "Theorieprüfung";
  else if (/(prakt|praxis)/.test(text) && /prüfung|gebühr/.test(text)) {
    eventType = "Vorstellung zur prakt. Prüfung";
  } else if (/fahrstunde|übungs/.test(text)) eventType = "Praktisch";
  return { eventType, erloesKonto: fee ? "1370" : "4400" };
}

function toDrafts(plan: PricePlanRecord | null): ComponentDraft[] {
  if (!plan) return [{ ...emptyRow }];
  return plan.components.map((component) => ({
    label: component.label,
    duration: component.durationMin == null ? "" : String(component.durationMin),
    price: component.priceCents == null ? "" : formatCents(component.priceCents),
    eventType: component.eventType ?? "",
    erloesKonto: component.erloesKonto || "4400",
    touched: true,
  }));
}

const ROW_GRID =
  "grid grid-cols-[1fr_1fr_2rem] items-center gap-2 sm:grid-cols-[minmax(9rem,1fr)_4.5rem_6.5rem_9rem_9.5rem_2rem]";

export function PricePlanDialog({
  open,
  plan,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = create a new plan */
  plan: PricePlanRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [months, setMonths] = useState("");
  const [classes, setClasses] = useState<string[]>([]);
  const [rows, setRows] = useState<ComponentDraft[]>(() => [{ ...emptyRow }]);
  const [submitting, setSubmitting] = useState(false);

  // Re-seed the form whenever the dialog opens for a (different) plan.
  useEffect(() => {
    if (!open) return;
    setName(plan?.name ?? "");
    setMonths(plan?.guaranteedMonths ? String(plan.guaranteedMonths) : plan ? "" : "12");
    setClasses(plan?.classes ?? []);
    setRows(toDrafts(plan));
  }, [open, plan]);

  const updateRow = (index: number, patch: Partial<ComponentDraft>) => {
    setRows((current) =>
      current.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        if (patch.label !== undefined && !row.touched) {
          Object.assign(next, inferFromLabel(patch.label));
        }
        return next;
      }),
    );
  };

  const removeRow = (index: number) => {
    setRows((current) => current.filter((_, i) => i !== index));
  };

  const addRow = () => setRows((current) => [...current, { ...emptyRow }]);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Bitte einen Namen für den Preisplan angeben.");
      return;
    }
    const guaranteedMonths = months.trim() === "" ? 0 : Number(months);
    if (!Number.isInteger(guaranteedMonths) || guaranteedMonths < 0) {
      toast.error("Die Preisgarantie muss eine Anzahl Monate sein (oder leer).");
      return;
    }

    const components: PricePlanInput["components"] = [];
    for (const row of rows) {
      if (!row.label.trim()) {
        // Skip fully empty rows; complain about half-filled ones.
        if (!row.duration.trim() && !row.price.trim()) continue;
        toast.error("Jede Preiskomponente braucht eine Bezeichnung.");
        return;
      }
      let durationMin: number | null = null;
      if (row.duration.trim()) {
        const minutes = Number(row.duration);
        if (!Number.isInteger(minutes) || minutes <= 0) {
          toast.error(
            `Dauer von „${row.label.trim()}" muss eine positive Minutenzahl sein.`,
          );
          return;
        }
        durationMin = minutes;
      }
      let priceCents: number | null = null;
      if (row.price.trim()) {
        priceCents = parseEuroToCents(row.price);
        if (priceCents == null) {
          toast.error(`Preis von „${row.label.trim()}" ist ungültig (z. B. 75,00).`);
          return;
        }
      }
      components.push({
        label: row.label.trim(),
        durationMin,
        priceCents,
        eventType: row.eventType || null,
        erloesKonto:
          row.erloesKonto && row.erloesKonto !== "4400" ? row.erloesKonto : null,
      });
    }
    if (components.length === 0) {
      toast.error("Ein Preisplan braucht mindestens eine Preiskomponente.");
      return;
    }

    const input: PricePlanInput = {
      name: name.trim(),
      guaranteedMonths,
      classes,
      components,
    };

    setSubmitting(true);
    try {
      if (plan) {
        await updatePricePlan(plan.id, input);
        toast.success(`Preisplan „${input.name}" gespeichert.`);
      } else {
        await createPricePlan(input);
        toast.success(`Preisplan „${input.name}" angelegt.`);
      }
      onSaved();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{plan ? "Preisplan bearbeiten" : "Preisplan anlegen"}</DialogTitle>
          <DialogDescription className="text-pretty">
            Preise gelten brutto; ein leerer Preis bedeutet „inklusive".
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-name">Name des Preisplans</Label>
              <Input
                id="plan-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="z. B. Pkw Standard"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-months">Preisgarantie (Monate)</Label>
              <Input
                id="plan-months"
                inputMode="numeric"
                value={months}
                onChange={(event) => setMonths(event.target.value)}
                placeholder="keine"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Gilt für Klassen</Label>
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              value={classes}
              onValueChange={setClasses}
              className="flex flex-wrap justify-start gap-1.5"
              aria-label="Führerscheinklassen des Preisplans"
            >
              {LICENSE_CLASS_GROUPS.flatMap((group) => group.classes).map((klass) => (
                <ToggleGroupItem
                  key={klass}
                  value={klass}
                  className="min-w-10 rounded-md data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                >
                  {klass}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-xs text-muted-foreground text-pretty">
              {classes.length === 0
                ? "Keine Auswahl = für alle Klassen. Neue Fahrschüler/innen erhalten den ersten passenden Preisplan."
                : `Wird neuen Fahrschüler/innen der Klasse ${classes.join(", ")} vorgeschlagen.`}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <div
              className={`${ROW_GRID} hidden text-xs font-medium text-muted-foreground sm:grid`}
            >
              <span>Preiskomponente</span>
              <span>Dauer (Min)</span>
              <span>Preis, EUR</span>
              <span>Abrechnen bei</span>
              <span>Art</span>
              <span />
            </div>
            {rows.map((row, index) => (
              <div key={index} className={`${ROW_GRID} max-sm:border-b max-sm:pb-2`}>
                <Input
                  value={row.label}
                  onChange={(event) => updateRow(index, { label: event.target.value })}
                  placeholder="z. B. Nachtfahrt"
                  aria-label={`Bezeichnung Komponente ${index + 1}`}
                  className="max-sm:col-span-2"
                />
                <Input
                  inputMode="numeric"
                  value={row.duration}
                  onChange={(event) => updateRow(index, { duration: event.target.value })}
                  placeholder="Min"
                  aria-label={`Dauer Komponente ${index + 1}`}
                  className="max-sm:order-3"
                />
                <Input
                  inputMode="decimal"
                  value={row.price}
                  onChange={(event) => updateRow(index, { price: event.target.value })}
                  placeholder="inklusive"
                  aria-label={`Preis Komponente ${index + 1}`}
                  className="max-sm:order-4 max-sm:col-span-2"
                />
                <NativeSelect
                  value={row.eventType}
                  onChange={(event) =>
                    updateRow(index, {
                      eventType: event.target.value as ComponentDraft["eventType"],
                      touched: true,
                    })
                  }
                  aria-label={`Abrechnen bei Komponente ${index + 1}`}
                  className="w-full max-sm:order-5"
                >
                  <NativeSelectOption value="">Nur manuell</NativeSelectOption>
                  {BILLABLE_EVENT_TYPES.map((type) => (
                    <NativeSelectOption key={type} value={type}>
                      {EVENT_TYPE_LABELS[type]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <div className="min-w-0 max-sm:order-6 max-sm:col-span-2">
                  <AccountSelect
                    value={row.erloesKonto}
                    onChange={(erloesKonto) =>
                      updateRow(index, { erloesKonto, touched: true })
                    }
                    ariaLabel={`Art Komponente ${index + 1}`}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeRow(index)}
                  disabled={rows.length === 1}
                  aria-label={`Komponente ${index + 1} entfernen`}
                  className="max-sm:order-2"
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={addRow}
            >
              <Plus data-icon="inline-start" />
              Komponente hinzufügen
            </Button>
            <p className="text-xs text-muted-foreground text-pretty">
              „Abrechnen bei" schlägt die Komponente vor, wenn ein Termin dieses Typs im
              Fahrschüler abgerechnet wird (z. B. Theorieprüfung + TÜV-Gebühr bei der
              Theorieprüfung). „Nur manuell" wird nie automatisch vorgeschlagen — richtig
              für Grundbetrag oder Lernmaterial. Die Vorschläge folgen der Bezeichnung,
              bis Sie sie selbst ändern.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="button" disabled={submitting} onClick={submit}>
            {plan ? "Speichern" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
