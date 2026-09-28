/* ------------------------------------------------------------------ */
/* /einladung/$inviteToken — public page behind an Einladungslink:      */
/* the invited staff member sets their password and is signed in.      */
/* (server: src/server/invites.ts)                                      */
/* ------------------------------------------------------------------ */

import { type FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";

import { FormField } from "@/components/FormField";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const MIN_PASSWORD = 10;

type InviteInfo = { name: string; email: string };

export function Einladung() {
  const { inviteToken } = useParams({ from: "/einladung/$inviteToken" });
  const info = useQuery({
    queryKey: ["invite", inviteToken],
    // A used or expired link answers 404 — shown as a message, not an error.
    queryFn: async (): Promise<InviteInfo | null> => {
      const res = await fetch(`/api/auth/invite/${encodeURIComponent(inviteToken)}`);
      return res.ok ? ((await res.json()) as InviteInfo) : null;
    },
    retry: false,
  });
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const errors = {
    password:
      password.length < MIN_PASSWORD ? `Mindestens ${MIN_PASSWORD} Zeichen.` : null,
    repeat: repeat !== password ? "Die Passwörter stimmen nicht überein." : null,
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (errors.password || errors.repeat) return;
    setBusy(true);
    setServerError(null);
    try {
      const res = await fetch(`/api/auth/invite/${encodeURIComponent(inviteToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Das hat nicht geklappt.");
      }
      // Signed in by the response cookie — open the app.
      window.location.assign("/");
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Das hat nicht geklappt.");
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-svh place-items-center bg-sidebar p-4">
      <Card className="w-full max-w-md">
        {info.isPending ? (
          <CardContent className="grid place-items-center py-10">
            <Spinner />
          </CardContent>
        ) : !info.data ? (
          <CardHeader>
            <CardTitle className="font-heading text-xl">Link nicht gültig</CardTitle>
            <CardDescription>
              Dieser Einladungslink ist abgelaufen, wurde schon benutzt oder durch einen
              neueren ersetzt. Bitten Sie die Inhaberin bzw. den Inhaber Ihrer Fahrschule
              um einen neuen Link — oder melden Sie sich an, wenn Sie Ihr Passwort schon
              festgelegt haben.
            </CardDescription>
            <Button asChild variant="outline" className="mt-2 w-fit">
              <a href="/">Zur Anmeldung</a>
            </Button>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              <CardTitle className="font-heading text-xl">
                Willkommen, {info.data.name}
              </CardTitle>
              <CardDescription>
                Legen Sie Ihr Passwort für OpenFS fest. Ihr Anmeldename ist{" "}
                <span className="font-medium text-foreground">{info.data.email}</span>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                noValidate
                className="flex flex-col gap-4"
                onSubmit={(e) => void submit(e)}
              >
                {serverError && (
                  <p role="alert" className="text-sm text-destructive">
                    {serverError}
                  </p>
                )}
                <FormField
                  id="invite-password"
                  label="Neues Passwort"
                  required
                  hint={`Mindestens ${MIN_PASSWORD} Zeichen — z. B. mehrere Wörter.`}
                  error={submitted ? errors.password : null}
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </FormField>
                <FormField
                  id="invite-repeat"
                  label="Passwort wiederholen"
                  required
                  error={submitted ? errors.repeat : null}
                >
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={repeat}
                    onChange={(e) => setRepeat(e.target.value)}
                  />
                </FormField>
                <Button type="submit" disabled={busy}>
                  {busy ? "Wird gespeichert …" : "Passwort festlegen und anmelden"}
                </Button>
              </form>
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}

export default Einladung;
