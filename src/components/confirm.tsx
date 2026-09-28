/* ------------------------------------------------------------------ */
/* Promise-based confirmation in the app's own dialog style, instead   */
/* of window.confirm (unstyled, English buttons on some browsers):     */
/*                                                                     */
/*   if (await confirmDialog({ title: "…", confirmLabel: "Absagen" })) */
/*                                                                     */
/* <ConfirmHost /> is mounted once in the app shell.                   */
/* ------------------------------------------------------------------ */

import { useEffect, useState } from "react";

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

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Request = ConfirmOptions & { resolve: (ok: boolean) => void };

let show: ((request: Request) => void) | null = null;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // Without a mounted host (tests, public pages) fall back to the browser.
    if (!show) {
      resolve(
        window.confirm([options.title, options.description].filter(Boolean).join("\n\n")),
      );
      return;
    }
    show({ ...options, resolve });
  });
}

export function ConfirmHost() {
  const [request, setRequest] = useState<Request | null>(null);

  useEffect(() => {
    show = (next) =>
      setRequest((current) => {
        current?.resolve(false);
        return next;
      });
    return () => {
      show = null;
    };
  }, []);

  const close = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };

  return (
    <AlertDialog open={request !== null} onOpenChange={(open) => !open && close(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          {request?.description ? (
            <AlertDialogDescription className="whitespace-pre-line">
              {request.description}
            </AlertDialogDescription>
          ) : (
            <AlertDialogDescription className="sr-only">
              Bitte bestätigen.
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>
            {request?.cancelLabel ?? "Abbrechen"}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={request?.destructive ? "destructive" : "default"}
            onClick={() => close(true)}
          >
            {request?.confirmLabel ?? "Bestätigen"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
