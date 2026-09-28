/* ------------------------------------------------------------------ */
/* AuthGate — shows the staff app only to signed-in users. Before the  */
/* first account exists it shows the Einrichtung (first-run wizard),   */
/* otherwise the Anmeldung. Public pages (/anfrage, /portal, …) live   */
/* outside the app shell and never pass through here.                  */
/* ------------------------------------------------------------------ */

import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/sonner";
import {
  installAuthFetchHook,
  login,
  setup,
  UNAUTHORIZED_EVENT,
  useAuthStatus,
} from "@/hooks/use-auth";
import { parseEuroToCents } from "@/lib/money";
import { queryClient } from "@/lib/query-client";

installAuthFetchHook();

function Shell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-svh place-items-center bg-sidebar p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-heading text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      <Toaster />
    </main>
  );
}

function Field({
  id,
  label,
  hint,
  ...props
}: { id: string; label: string; hint?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Das hat nicht geklappt.";
}

function LoginForm({ demo }: { demo: { email: string; password: string } | null }) {
  const [email, setEmail] = useState(demo?.email ?? "");
  const [password, setPassword] = useState(demo?.password ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await login(email, password);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Anmelden" description="Melden Sie sich mit Ihrem OpenFS-Zugang an.">
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        {demo && (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Demo: {demo.email} · {demo.password}
          </p>
        )}
        <Field
          id="login-email"
          label="E-Mail"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          id="login-password"
          label="Passwort"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Anmelden…" : "Anmelden"}
        </Button>
      </form>
    </Shell>
  );
}

function SetupForm() {
  const [form, setForm] = useState({
    schoolName: "",
    address: "",
    phone: "",
    schoolEmail: "",
    name: "",
    email: "",
    password: "",
    passwordRepeat: "",
    openingDate: `${new Date().getFullYear()}-01-01`,
    kasse: "",
    bank: "",
  });
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (form.password !== form.passwordRepeat) {
      toast.error("Die Passwörter stimmen nicht überein.");
      return;
    }
    const kasseCents = form.kasse.trim() ? parseEuroToCents(form.kasse) : undefined;
    const bankCents = form.bank.trim() ? parseEuroToCents(form.bank) : undefined;
    if (kasseCents === null || bankCents === null) {
      toast.error("Anfangsbestände bitte als Betrag angeben (z. B. 1.250,00).");
      return;
    }
    setBusy(true);
    try {
      await setup({
        schoolName: form.schoolName,
        address: form.address,
        phone: form.phone,
        schoolEmail: form.schoolEmail,
        name: form.name,
        email: form.email,
        password: form.password,
        openingDate: form.openingDate,
        kasseCents,
        bankCents,
      });
      toast.success("Willkommen bei OpenFS!");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Fahrschule einrichten"
      description="Einmalig: Stammdaten der Fahrschule und der erste Zugang (Inhaber/in). Weitere Zugänge legen Sie danach unter Benutzer an."
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <Field
          id="setup-school"
          label="Name der Fahrschule"
          required
          value={form.schoolName}
          onChange={set("schoolName")}
        />
        <Field
          id="setup-address"
          label="Anschrift"
          placeholder="Straße Nr., PLZ Ort"
          value={form.address}
          onChange={set("address")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="setup-phone"
            label="Telefon"
            value={form.phone}
            onChange={set("phone")}
          />
          <Field
            id="setup-school-email"
            label="E-Mail der Fahrschule"
            type="email"
            value={form.schoolEmail}
            onChange={set("schoolEmail")}
          />
        </div>
        <div className="h-px bg-border" />
        <Field
          id="setup-name"
          label="Ihr Name"
          required
          value={form.name}
          onChange={set("name")}
        />
        <Field
          id="setup-email"
          label="Ihre E-Mail (Anmeldename)"
          type="email"
          autoComplete="username"
          required
          value={form.email}
          onChange={set("email")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="setup-password"
            label="Passwort"
            type="password"
            autoComplete="new-password"
            hint="Mindestens 10 Zeichen."
            required
            value={form.password}
            onChange={set("password")}
          />
          <Field
            id="setup-password-repeat"
            label="Passwort wiederholen"
            type="password"
            autoComplete="new-password"
            required
            value={form.passwordRepeat}
            onChange={set("passwordRepeat")}
          />
        </div>
        <div className="h-px bg-border" />
        <p className="text-xs text-muted-foreground">
          Anfangsbestände (optional) — Kassen- und Bankbestand zum Start in OpenFS. Können
          nur vor der ersten Buchung gesetzt werden.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            id="setup-opening-date"
            label="Stichtag"
            type="date"
            value={form.openingDate}
            onChange={set("openingDate")}
          />
          <Field
            id="setup-kasse"
            label="Kasse, EUR"
            inputMode="decimal"
            value={form.kasse}
            onChange={set("kasse")}
          />
          <Field
            id="setup-bank"
            label="Bank, EUR"
            inputMode="decimal"
            value={form.bank}
            onChange={set("bank")}
          />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Wird eingerichtet…" : "Fahrschule einrichten"}
        </Button>
      </form>
    </Shell>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStatus();

  // A 401 anywhere means the session ended — re-check who we are.
  useEffect(() => {
    const onUnauthorized = () => {
      void queryClient.invalidateQueries({ queryKey: ["auth"] });
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  if (status.isPending) {
    return (
      <main className="grid min-h-svh place-items-center bg-sidebar">
        <Spinner />
      </main>
    );
  }
  if (status.isError || !status.data) {
    return (
      <Shell
        title="Keine Verbindung"
        description="Der Server ist gerade nicht erreichbar."
      >
        <Button onClick={() => void status.refetch()}>Erneut versuchen</Button>
      </Shell>
    );
  }
  if (status.data.setupRequired) return <SetupForm />;
  if (!status.data.user) return <LoginForm demo={status.data.demo} />;
  return <>{children}</>;
}
