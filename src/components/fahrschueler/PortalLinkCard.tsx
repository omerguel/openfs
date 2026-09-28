/* ------------------------------------------------------------------ */
/* Fahrschüler detail — Schülerportal link: create / copy / rotate /   */
/* revoke the student's secret access link and send it by e-mail.      */
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

export function PortalLinkCard({ student }: { student: StudentRecord }) {
  const { link, loading, refresh } = usePortalLink(student.id);
  const [busy, setBusy] = useState(false);
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
      await copyText(portalUrl(created.token));
    });

  const url = link ? portalUrl(link.token) : "";

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
            <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5">
              <Link2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {url}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Portal-Link kopieren"
                onClick={() => void copyText(url)}
              >
                <Copy />
              </Button>
            </div>
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
                Neu erstellen
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
                      onClick={() =>
                        void run(
                          () => revokePortalLink(student.id),
                          "Portal-Link widerrufen.",
                        )
                      }
                    >
                      Widerrufen
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            <p className="text-[11px] text-muted-foreground">
              „Neu erstellen" macht den bisherigen Link ungültig.
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
