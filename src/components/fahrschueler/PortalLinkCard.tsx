/* ------------------------------------------------------------------ */
/* Fahrschüler detail — Schülerportal link: create / copy / rotate /   */
/* revoke the student's secret access link and send it by e-mail.      */
/* The server keeps only a hash of the token, so a link is visible     */
/* once — right after it was created; later the card only says since   */
/* when a link is active. A mailed link gets its own token.            */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { Copy, Link2, Mail, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createPortalLink,
  emailPortalLink,
  portalUrl,
  revokePortalLink,
  usePortalLink,
} from "@/hooks/use-portal";
import type { StudentRecord } from "@/hooks/use-students";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Link kopiert.");
  } catch {
    toast.error("Kopieren nicht möglich.");
  }
}

function activeSince(createdAt: string): string {
  const date = new Date(`${createdAt.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime())
    ? createdAt
    : date.toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
}

export function PortalLinkCard({ student }: { student: StudentRecord }) {
  const { link, loading, refresh } = usePortalLink(student.id);
  const [busy, setBusy] = useState(false);
  // The just-created link — gone on reload (only its hash is stored).
  const [fresh, setFresh] = useState<string | null>(null);
  const hasEmail = student.email.trim().length > 0;

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try {
      await action();
      await refresh();
      if (success) toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const created = await createPortalLink(student.id);
      setFresh(portalUrl(created.token));
      await copyText(portalUrl(created.token));
    });

  const revoke = () =>
    run(async () => {
      await revokePortalLink(student.id);
      setFresh(null);
    }, "Portal-Link widerrufen.");

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Schülerportal</CardTitle>
        <CardDescription>
          Persönlicher Link zu Terminen, Kontostand und Nachrichten — ohne Passwort.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading ? (
          <Skeleton className="h-8 rounded-md" />
        ) : link ? (
          <>
            {fresh ? (
              <>
                <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5">
                  <Link2 className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {fresh}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Portal-Link kopieren"
                    onClick={() => void copyText(fresh)}
                  >
                    <Copy />
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Nur jetzt sichtbar — gespeichert wird lediglich ein Fingerabdruck des
                  Links. Bitte jetzt kopieren oder per E-Mail senden.
                </p>
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm">
                <Link2 className="size-4 shrink-0 text-muted-foreground" />
                Link aktiv seit {activeSince(link.createdAt)}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !hasEmail}
                title={hasEmail ? undefined : "Keine E-Mail-Adresse hinterlegt"}
                onClick={() =>
                  void run(
                    () => emailPortalLink(student.id),
                    "Link liegt im Postausgang (Nachrichten).",
                  )
                }
              >
                <Mail data-icon="inline-start" />
                Per E-Mail senden
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void create()}
              >
                <RefreshCw data-icon="inline-start" />
                Neuen Link erzeugen
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 data-icon="inline-start" />
                    Widerrufen
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Portal-Link widerrufen?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {student.firstName} {student.lastName} kann das Schülerportal danach
                      nicht mehr öffnen, bis ein neuer Link erstellt wird.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => void revoke()}
                    >
                      Widerrufen
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            <p className="text-[11px] text-muted-foreground">
              „Neuen Link erzeugen“ zeigt einen neuen Link zum Kopieren an — alle
              bisherigen Links (auch per E-Mail versandte) funktionieren danach nicht
              mehr. Per E-Mail geht ein eigener Link an die Schülerin bzw. den Schüler.
            </p>

          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={busy}
            onClick={() => void create()}
          >
            <Link2 data-icon="inline-start" />
            Link erstellen und kopieren
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
