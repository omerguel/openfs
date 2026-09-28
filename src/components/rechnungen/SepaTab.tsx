/* ------------------------------------------------------------------ */
/* Lastschriften — build a SEPA-Sammler from open invoices and due     */
/* rates, download the pain.008 file for the bank portal, then book    */
/* it once the bank has credited the money (or record Rücklastschriften). */
/* ------------------------------------------------------------------ */

import { useEffect, useMemo, useState } from "react";
import { Download, TriangleAlert, Undo2, WalletCards } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  bookCollection,
  createCollection,
  downloadCollectionXml,
  returnSepaItem,
  useSepaCandidates,
  useSepaCollections,
} from "@/hooks/use-payment-plans";
import { plural } from "@/lib/account-labels";
import type { SepaCandidate, SepaCollectionItem } from "@/lib/payment-plan-types";
import { formatCents } from "@/lib/money";
import type { SepaSequenceType } from "@/lib/sepa";

/* Default collection date: 5 business days ahead, so the
   Vorabankündigung (Pre-Notification) can reach the debtors in time —
   most mandates shorten the 14-day default to 5 days. The bank itself
   only needs the file one business day before (SEPA Core, D-1). */
const PRE_NOTIFICATION_DAYS = 5;

function addBusinessDays(days: number, from = new Date()): string {
  const date = new Date(from);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) added += 1;
  }
  return toIsoDate(date);
}

const SEQUENCE_LABELS: Record<SepaSequenceType, string> = {
  FRST: "Erstlastschrift",
  RCUR: "Folgelastschrift",
};

const ITEM_STATUS: Record<SepaCollectionItem["status"], string> = {
  exportiert: "Exportiert",
  gebucht: "Gebucht",
  zurueckgegeben: "Rücklastschrift",
};

function ReturnDialog({
  item,
  onClose,
}: {
  item: SepaCollectionItem | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(() => toIsoDate(new Date()));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!item) return;
    setSaving(true);
    try {
      await returnSepaItem(item.id, { date, reason });
      toast.success("Rücklastschrift erfasst — die Zahlung wurde storniert.");
      setReason("");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={item != null} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rücklastschrift erfassen</DialogTitle>
          <DialogDescription>
            {item ? `${item.studentName} · ${formatCents(item.amountCents)} €` : null}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="return-reason">Grund (laut Bank)</Label>
            <Input
              id="return-reason"
              value={reason}
              placeholder="z. B. AC04 Konto erloschen"
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="return-date">Datum</Label>
            <Input
              id="return-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button variant="destructive" onClick={() => void save()} disabled={saving}>
            Erfassen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmCollectionDialog({
  open,
  collectionDate,
  items,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  collectionDate: string;
  items: SepaCandidate[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const total = items.reduce((sum, c) => sum + c.amountCents, 0);
  const first = items.filter((c) => c.sequenceType === "FRST").length;
  const tooEarly = collectionDate < addBusinessDays(PRE_NOTIFICATION_DAYS);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Lastschriftdatei erstellen?</DialogTitle>
          <DialogDescription className="text-pretty">
            {plural(items.length, "Position", "Positionen")} über{" "}
            <span className="font-medium text-foreground tabular-nums">
              {formatCents(total)} €
            </span>
            , Einzug am{" "}
            <span className="font-medium text-foreground tabular-nums">
              {formatIsoDate(collectionDate)}
            </span>
            . Die Datei (pain.008) laden Sie anschließend im Online-Banking hoch.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-xs text-pretty text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Vorabankündigung:</span> Die
            Zahlungspflichtigen müssen Betrag und Einzugsdatum vorher erfahren —
            gesetzlich 14 Tage, meist im Mandat auf 5 Tage verkürzt (z. B. per Rechnung,
            Ratenplan oder E-Mail).
          </p>
          {first > 0 && (
            <p>
              {plural(first, "Erstlastschrift", "Erstlastschriften")} dabei: Das Mandat
              wird zum ersten Mal genutzt — bitte besonders auf die Vorabankündigung
              achten.
            </p>
          )}
          {tooEarly && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Das Einzugsdatum liegt weniger als {PRE_NOTIFICATION_DAYS} Bankarbeitstage
              in der Zukunft. Reicht die Zeit für die Vorabankündigung?
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button onClick={onConfirm}>
            <WalletCards data-icon="inline-start" />
            Datei erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SepaTab() {
  const [collectionDate, setCollectionDate] = useState(() =>
    addBusinessDays(PRE_NOTIFICATION_DAYS),
  );
  const [confirming, setConfirming] = useState(false);
  const candidates = useSepaCandidates(collectionDate);
  const collections = useSepaCollections();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [returnTarget, setReturnTarget] = useState<SepaCollectionItem | null>(null);

  const list = useMemo(() => candidates.data ?? [], [candidates.data]);
  // Preselect every candidate whenever the candidate list changes.
  useEffect(() => {
    setSelected(new Set(list.map((c) => `${c.sourceType}:${c.sourceId}`)));
  }, [list]);

  const total = useMemo(
    () =>
      list
        .filter((c) => selected.has(`${c.sourceType}:${c.sourceId}`))
        .reduce((sum, c) => sum + c.amountCents, 0),
    [list, selected],
  );

  const chosen = list.filter((c) => selected.has(`${c.sourceType}:${c.sourceId}`));

  const create = async () => {
    setConfirming(false);
    setCreating(true);
    try {
      const collection = await createCollection({
        collectionDate,
        items: chosen.map((c) => ({ sourceType: c.sourceType, sourceId: c.sourceId })),
      });
      toast.success(
        `Sammler ${collection.msgId} erstellt — Datei im Online-Banking hochladen.`,
      );
      downloadCollectionXml(collection.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sammler fehlgeschlagen.");
    } finally {
      setCreating(false);
    }
  };

  const book = async (id: number) => {
    try {
      await bookCollection(id, toIsoDate(new Date()));
      toast.success("Lastschriften als eingegangen gebucht.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Buchung fehlgeschlagen.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="collection-date">Fälligkeit (Einzugsdatum)</Label>
            <Input
              id="collection-date"
              type="date"
              value={collectionDate}
              onChange={(e) => setCollectionDate(e.target.value)}
            />
          </div>
          <p className="max-w-md pb-2 text-xs text-pretty text-muted-foreground">
            Offene Rechnungen und bis dahin fällige Raten von Fahrschüler/innen mit
            gültigem Mandat. Gläubiger-ID und IBAN der Fahrschule kommen aus dem Profil.
            Vor dem Einzug erhalten die Zahlungspflichtigen eine Vorabankündigung
            (Pre-Notification) mit Betrag und Datum.
          </p>
          <Button
            className="w-full sm:ml-auto sm:w-auto"
            disabled={selected.size === 0 || creating}
            onClick={() => setConfirming(true)}
          >
            <WalletCards data-icon="inline-start" />
            Sammler erstellen ({formatCents(total)} €)
          </Button>
        </div>
        {candidates.isPending ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : list.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nichts einzuziehen — keine offenen Posten mit gültigem Mandat.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4" />
                  <TableHead>Fahrschüler/in</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Fällig</TableHead>
                  <TableHead>Mandat</TableHead>
                  <TableHead className="pr-4 text-right">Betrag</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((c) => {
                  const key = `${c.sourceType}:${c.sourceId}`;
                  return (
                    <TableRow key={key}>
                      <TableCell className="pl-4">
                        <Checkbox
                          checked={selected.has(key)}
                          onCheckedChange={() =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                          aria-label={`${c.label} auswählen`}
                        />
                      </TableCell>
                      <TableCell>{c.studentName}</TableCell>
                      <TableCell>{c.label}</TableCell>
                      <TableCell className="tabular-nums">
                        {formatIsoDate(c.dueDate)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="font-mono">{c.mandateRef}</span>
                        <span className="block text-muted-foreground">
                          {SEQUENCE_LABELS[c.sequenceType]}
                        </span>
                      </TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">
                        {formatCents(c.amountCents)} €
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Bisherige Sammler</h2>
        {(collections.data ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Noch keine Lastschriften erstellt.
          </p>
        ) : (
          (collections.data ?? []).map((collection) => {
            const pending = collection.items.some((i) => i.status === "exportiert");
            return (
              <div
                key={collection.id}
                className="flex flex-col gap-2 rounded-lg border p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono font-medium">{collection.msgId}</span>
                  <span className="text-muted-foreground">
                    Einzug {formatIsoDate(collection.collectionDate)} ·{" "}
                    {plural(collection.items.length, "Position", "Positionen")} ·{" "}
                    {formatCents(collection.totalCents)} €
                  </span>
                  <div className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadCollectionXml(collection.id)}
                    >
                      <Download data-icon="inline-start" />
                      XML
                    </Button>
                    {pending && (
                      <Button size="sm" onClick={() => void book(collection.id)}>
                        Als eingegangen buchen
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex flex-col divide-y rounded-md border text-xs">
                  {collection.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5"
                    >
                      <span className="w-40 truncate">{item.studentName}</span>
                      <span className="min-w-0 flex-1 basis-40 truncate text-muted-foreground">
                        {item.remittance}
                      </span>
                      <span className="tabular-nums">
                        {formatCents(item.amountCents)} €
                      </span>
                      <Badge variant="outline" className="font-normal">
                        {ITEM_STATUS[item.status]}
                      </Badge>
                      {item.status !== "zurueckgegeben" && (
                        <Button
                          variant="ghost"
                          size="xs"
                          aria-label={`Rücklastschrift für ${item.studentName} erfassen`}
                          onClick={() => setReturnTarget(item)}
                        >
                          <Undo2 data-icon="inline-start" />
                          Rücklastschrift
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </section>

      <ReturnDialog item={returnTarget} onClose={() => setReturnTarget(null)} />
      <ConfirmCollectionDialog
        open={confirming}
        collectionDate={collectionDate}
        items={chosen}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void create()}
      />
    </div>
  );
}
