/* ------------------------------------------------------------------ */
/* Lastschriften — build a SEPA-Sammler from open invoices and due     */
/* rates, download the pain.008 file for the bank portal, then book    */
/* it once the bank has credited the money (or record Rücklastschriften). */
/* ------------------------------------------------------------------ */

import { useEffect, useMemo, useState } from "react";
import { Download, Undo2, WalletCards } from "lucide-react";
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
import type { SepaCollectionItem } from "@/lib/payment-plan-types";
import { formatCents } from "@/lib/money";

function nextBusinessDay(): string {
  const date = new Date();
  do {
    date.setDate(date.getDate() + 1);
  } while (date.getDay() === 0 || date.getDay() === 6);
  return toIsoDate(date);
}

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

export function SepaTab() {
  const [collectionDate, setCollectionDate] = useState(nextBusinessDay);
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

  const create = async () => {
    setCreating(true);
    try {
      const collection = await createCollection({
        collectionDate,
        items: list
          .filter((c) => selected.has(`${c.sourceType}:${c.sourceId}`))
          .map((c) => ({ sourceType: c.sourceType, sourceId: c.sourceId })),
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
          <p className="max-w-md pb-2 text-xs text-muted-foreground">
            Offene Rechnungen und bis dahin fällige Raten von Fahrschüler/innen mit
            gültigem Mandat. Gläubiger-ID und IBAN der Fahrschule kommen aus dem Profil.
          </p>
          <Button
            className="ml-auto"
            disabled={selected.size === 0 || creating}
            onClick={() => void create()}
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
                      <TableCell className="font-mono text-xs">
                        {c.mandateRef} · {c.sequenceType}
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
                    {collection.items.length} Positionen ·{" "}
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
                    <div key={item.id} className="flex items-center gap-3 px-3 py-1.5">
                      <span className="w-40 truncate">{item.studentName}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
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
                          size="icon-sm"
                          aria-label="Rücklastschrift erfassen"
                          onClick={() => setReturnTarget(item)}
                        >
                          <Undo2 />
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
    </div>
  );
}
