/* Betroffenenrechte per student — shared by Fahrschule → Datenschutz   */
/* and the student page: Auskunft (Art. 15), Aufbewahrung verlängern,   */
/* Löschen auf Antrag (Art. 17) with the "what stays until when" list.  */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, FileJson, FileText, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { FormField } from "@/components/FormField";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Spinner } from "@/components/ui/spinner";
import {
  addRetentionHold,
  auskunftUrl,
  executeErasure,
  fetchErasurePlan,
} from "@/hooks/use-retention";

export const germanDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
};

/** Two links: the printable page (new tab) and the JSON download. */
export function AuskunftLinks({
  studentId,
  size = "sm",
}: {
  studentId: number;
  size?: "sm" | "default";
}) {
  return (
    <>
      <Button asChild type="button" variant="outline" size={size}>
        <a href={auskunftUrl(studentId, "html")} target="_blank" rel="noopener">
          <FileText data-icon="inline-start" />
          Auskunft (Art. 15)
        </a>
      </Button>
      <Button asChild type="button" variant="ghost" size={size}>
        <a href={auskunftUrl(studentId, "download")} download>
          <FileJson data-icon="inline-start" />
          JSON
        </a>
      </Button>
    </>
  );
}

export function HoldDialog({
  studentId,
  name,
  open,
  onOpenChange,
}: {
  studentId: number;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await addRetentionHold({ studentId, reason, until: until || null });
      toast.success("Aufbewahrung verlängert.", {
        description: "Die Daten werden bis auf Weiteres nicht gelöscht.",
      });
      onOpenChange(false);
      setReason("");
      setUntil("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Aufbewahrung verlängern</DialogTitle>
          <DialogDescription className="text-pretty">
            {name}: Solange die Verlängerung gilt, löscht und anonymisiert der Löschlauf
            nichts, was zu dieser Person gehört – z. B. bei einem Rechtsstreit, einer
            offenen Forderung oder einer Betriebsprüfung.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <FormField id="hold-reason" label="Grund" required>
            <Input
              value={reason}
              maxLength={200}
              placeholder="z. B. Rechtsstreit um Rückzahlung"
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
          <FormField
            id="hold-until"
            label="Bis (optional)"
            hint="Leer lassen, um die Verlängerung von Hand aufzuheben."
          >
            <Input
              type="date"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            type="button"
            disabled={busy || !reason.trim()}
            onClick={() => void submit()}
          >
            <Lock data-icon="inline-start" />
            {busy ? "Speichert …" : "Verlängern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ErasureDialog({
  studentId,
  open,
  onOpenChange,
  onDone,
}: {
  studentId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const plan = useQuery({
    queryKey: ["erasure-plan", studentId],
    queryFn: () => fetchErasurePlan(studentId),
    enabled: open,
    staleTime: 0,
  });
  const run = async () => {
    setBusy(true);
    try {
      const result = await executeErasure(studentId);
      toast.success("Löschung durchgeführt.", {
        description: result.retain.length
          ? `Aufbewahrungspflichtige Daten folgen automatisch nach Fristende (${result.retain
              .map((r) => germanDate(r.until))
              .join(", ")}).`
          : "Die Daten sind gelöscht bzw. anonymisiert.",
      });
      onOpenChange(false);
      onDone?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Löschen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };
  const data = plan.data;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Löschen auf Antrag (Art. 17 DSGVO)</DialogTitle>
          <DialogDescription className="text-pretty">
            {data?.name ? `${data.name}: ` : ""}Was keiner Aufbewahrungspflicht
            unterliegt, wird sofort gelöscht. Was die Fahrschule aufbewahren muss, bleibt
            bis zum Fristende gesperrt und wird dann automatisch gelöscht bzw.
            anonymisiert.
          </DialogDescription>
        </DialogHeader>
        {plan.isPending ? (
          <div className="flex min-h-24 items-center justify-center">
            <Spinner />
          </div>
        ) : plan.isError || !data ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>
              {plan.error instanceof Error
                ? plan.error.message
                : "Die Übersicht konnte nicht geladen werden."}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            {data.blockedBy && (
              <Alert variant="destructive">
                <Lock />
                <AlertDescription>{data.blockedBy}</AlertDescription>
              </Alert>
            )}
            {data.willArchive && (
              <p className="text-pretty text-muted-foreground">
                Die Person steht noch in der aktiven Liste und wird dabei archiviert
                (Grund „Löschung auf Antrag“).
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <h3 className="font-medium">Wird sofort gelöscht</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {data.erase.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            {data.retain.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <h3 className="font-medium">Muss aufbewahrt werden</h3>
                <ul className="divide-y rounded-md border">
                  {data.retain.map((item) => (
                    <li key={item.what} className="flex flex-col gap-0.5 px-3 py-2">
                      <span>{item.what}</span>
                      <span className="text-xs text-muted-foreground">
                        bis <span className="tabular-nums">{germanDate(item.until)}</span>{" "}
                        · {item.basis}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-pretty text-muted-foreground">
                  Bitte teilen Sie der Person mit, welche Daten aus welchem Grund bis wann
                  aufbewahrt werden (Art. 12 Abs. 4, Art. 17 Abs. 3 lit. b DSGVO).
                </p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || !data || Boolean(data.blockedBy)}
            onClick={() => void run()}
          >
            <Trash2 data-icon="inline-start" />
            {busy ? "Löscht …" : "Jetzt löschen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
