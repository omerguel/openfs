/* ------------------------------------------------------------------ */
/* Bare domain in multi-tenant mode (openfs.de): find your school's    */
/* address, or — when PLATFORM_SIGNUP is on — register a new school.   */
/* ------------------------------------------------------------------ */

import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import { parseOrThrow } from "@/lib/api";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function schoolUrl(slug: string, baseDomain: string): string {
  const { protocol, port } = window.location;
  return `${protocol}//${slug}.${baseDomain}${port ? `:${port}` : ""}/`;
}

export function PlatformPage({
  baseDomain,
  signup,
}: {
  baseDomain: string;
  signup: boolean;
}) {
  const [goTo, setGoTo] = useState("");
  const [form, setForm] = useState({
    schoolName: "",
    slug: "",
    ownerName: "",
    email: "",
    password: "",
    acceptTerms: false,
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await parseOrThrow<{ url: string }>(
        await fetch("/api/platform/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }),
      );
      toast.success("Fahrschule angelegt — Sie werden weitergeleitet.");
      window.location.href = result.url;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Registrierung fehlgeschlagen.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-svh place-items-center bg-sidebar p-4">
      <div className="flex w-full max-w-md flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-xl">OpenFS</CardTitle>
            <CardDescription>
              Jede Fahrschule hat ihre eigene Adresse, z. B. meine-fahrschule.{baseDomain}
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (goTo.trim())
                  window.location.href = schoolUrl(slugify(goTo), baseDomain);
              }}
            >
              <Input
                aria-label="Adresse Ihrer Fahrschule"
                placeholder="meine-fahrschule"
                value={goTo}
                onChange={(e) => setGoTo(e.target.value)}
              />
              <Button type="submit" variant="outline">
                Öffnen
              </Button>
            </form>
          </CardContent>
        </Card>

        {signup && (
          <Card>
            <CardHeader>
              <CardTitle className="font-heading text-lg">
                Neue Fahrschule registrieren
              </CardTitle>
              <CardDescription>
                Eigene Datenbank, Server in Deutschland. Sie erhalten den ersten Zugang
                als Inhaber/in.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="signup-school">Name der Fahrschule</Label>
                  <Input
                    id="signup-school"
                    required
                    value={form.schoolName}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        schoolName: e.target.value,
                        slug: slugTouched ? f.slug : slugify(e.target.value),
                      }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="signup-slug">Adresse</Label>
                  <div className="flex items-center gap-1 text-sm">
                    <Input
                      id="signup-slug"
                      required
                      value={form.slug}
                      onChange={(e) => {
                        setSlugTouched(true);
                        setForm((f) => ({ ...f, slug: slugify(e.target.value) }));
                      }}
                    />
                    <span className="shrink-0 text-muted-foreground">.{baseDomain}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="signup-owner">Ihr Name</Label>
                  <Input
                    id="signup-owner"
                    required
                    value={form.ownerName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, ownerName: e.target.value }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="signup-email">E-Mail (Anmeldename)</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    autoComplete="username"
                    required
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="signup-password">Passwort</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  />
                  <span className="text-xs text-muted-foreground">
                    Mindestens 10 Zeichen.
                  </span>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={form.acceptTerms}
                    onCheckedChange={(value) =>
                      setForm((f) => ({ ...f, acceptTerms: value === true }))
                    }
                  />
                  <span>
                    Ich akzeptiere die AGB und den Auftragsverarbeitungsvertrag (Art. 28
                    DSGVO).
                  </span>
                </label>
                <Button type="submit" disabled={busy || !form.acceptTerms}>
                  {busy ? "Wird angelegt…" : "Fahrschule anlegen"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
      <Toaster />
    </main>
  );
}
