import { useState } from "react";
import { toast } from "sonner";

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
import { changePassword } from "@/hooks/use-auth";

export function ChangePasswordDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (next !== repeat) {
      toast.error("Die neuen Passwörter stimmen nicht überein.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      toast.success("Passwort geändert. Andere Anmeldungen wurden beendet.");
      setCurrent("");
      setNext("");
      setRepeat("");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ändern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Passwort ändern</DialogTitle>
          <DialogDescription>Mindestens 10 Zeichen.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {(
            [
              [
                "pw-current",
                "Aktuelles Passwort",
                current,
                setCurrent,
                "current-password",
              ],
              ["pw-next", "Neues Passwort", next, setNext, "new-password"],
              [
                "pw-repeat",
                "Neues Passwort wiederholen",
                repeat,
                setRepeat,
                "new-password",
              ],
            ] as const
          ).map(([id, label, value, setValue, autoComplete]) => (
            <div key={id} className="flex flex-col gap-1.5">
              <Label htmlFor={id}>{label}</Label>
              <Input
                id={id}
                type="password"
                autoComplete={autoComplete}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
