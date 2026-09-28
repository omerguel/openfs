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
import { FormField, RequiredLegend } from "@/components/FormField";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/sonner";
import {
  installAuthFetchHook,
  login,
  setup,
  UNAUTHORIZED_EVENT,
  useAuthStatus,
} from "@/hooks/use-auth";
import { parseOrThrow } from "@/lib/api";
import { parseEuroToCents } from "@/lib/money";
import { useQuery } from "@tanstack/react-query";
import { PlatformPage } from "./PlatformPage";
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
  error,
  required,
  ...props
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
} & React.ComponentProps<typeof Input>) {
  return (
    <FormField id={id} label={label} hint={hint} error={error} required={required}>
      <Input {...props} />
    </FormField>
  );
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MIN_PASSWORD = 10;

/** Today as YYYY-MM-DD in local time. */
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
      toast.dismiss();
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

type SetupState = {
  schoolName: string;
  address: string;
  phone: string;
  schoolEmail: string;
  name: string;
  email: string;
  password: string;
  passwordRepeat: string;
  openingDate: string;
  kasse: string;
  bank: string;
};

/* All problems at once, next to their fields (not one toast at a time). */
export function setupErrors(form: SetupState): Partial<Record<keyof SetupState, string>> {
  const errors: Partial<Record<keyof SetupState, string>> = {};
  if (!form.schoolName.trim())
    errors.schoolName = "Bitte den Namen der Fahrschule angeben.";
  if (form.schoolEmail.trim() && !EMAIL.test(form.schoolEmail.trim()))
    errors.schoolEmail = "Bitte eine gültige E-Mail-Adresse angeben.";
  if (!form.name.trim()) errors.name = "Bitte Ihren Namen angeben.";
  if (!EMAIL.test(form.email.trim()))
    errors.email = "Bitte eine gültige E-Mail-Adresse angeben — sie ist Ihr Anmeldename.";
  if (form.password.length < MIN_PASSWORD)
    errors.password = `Mindestens ${MIN_PASSWORD} Zeichen.`;
  if (form.passwordRepeat !== form.password)
    errors.passwordRepeat = "Die Passwörter stimmen nicht überein.";
  if (form.kasse.trim() && parseEuroToCents(form.kasse) === null)
    errors.kasse = "Betrag wie 1.250,00 angeben.";
  if (form.bank.trim() && parseEuroToCents(form.bank) === null)
    errors.bank = "Betrag wie 1.250,00 angeben.";
  if ((form.kasse.trim() || form.bank.trim()) && !form.openingDate)
    errors.openingDate = "Bitte den Stichtag angeben.";
  return errors;
}

function SetupForm() {
  const [form, setForm] = useState<SetupState>({
    schoolName: "",
    address: "",
    phone: "",
    schoolEmail: "",
    name: "",
    email: "",
    password: "",
    passwordRepeat: "",
    // Today: the balances you can read off the Kassenbuch and the bank
    // statement now. (1 January would need every booking since then.)
    openingDate: todayIso(),
    kasse: "",
    bank: "",
  });
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const errors = submitted ? setupErrors(form) : {};
  const set = (key: keyof SetupState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    const problems = setupErrors(form);
    const first = Object.keys(problems)[0];
    if (first) {
      document.getElementById(`setup-${first}`)?.focus();
      return;
    }
    const kasseCents = form.kasse.trim() ? parseEuroToCents(form.kasse) : undefined;
    const bankCents = form.bank.trim() ? parseEuroToCents(form.bank) : undefined;
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
        kasseCents: kasseCents ?? undefined,
        bankCents: bankCents ?? undefined,
      });
      toast.dismiss();
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
      description="Einmalig: Stammdaten der Fahrschule und der erste Zugang (Inhaber/in). Weitere Zugänge legen Sie danach unter Verwaltung → Benutzer an."
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
        <Field
          id="setup-schoolName"
          label="Name der Fahrschule"
          required
          error={errors.schoolName}
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
            type="tel"
            value={form.phone}
            onChange={set("phone")}
          />
          <Field
            id="setup-schoolEmail"
            label="E-Mail der Fahrschule"
            type="email"
            error={errors.schoolEmail}
            value={form.schoolEmail}
            onChange={set("schoolEmail")}
          />
        </div>
        <div className="h-px bg-border" />
        <Field
          id="setup-name"
          label="Ihr Name"
          required
          autoComplete="name"
          error={errors.name}
          value={form.name}
          onChange={set("name")}
        />
        <Field
          id="setup-email"
          label="Ihre E-Mail (Anmeldename)"
          type="email"
          autoComplete="username"
          required
          error={errors.email}
          value={form.email}
          onChange={set("email")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="setup-password"
            label="Passwort"
            type="password"
            autoComplete="new-password"
            hint={`Mindestens ${MIN_PASSWORD} Zeichen.`}
            required
            error={errors.password}
            value={form.password}
            onChange={set("password")}
          />
          <Field
            id="setup-passwordRepeat"
            label="Passwort wiederholen"
            type="password"
            autoComplete="new-password"
            required
            error={errors.passwordRepeat}
            value={form.passwordRepeat}
            onChange={set("passwordRepeat")}
          />
        </div>
        <div className="h-px bg-border" />
        <p className="text-xs text-pretty text-muted-foreground">
          Anfangsbestände (optional) — Kassen- und Bankbestand am Stichtag, ab dem Sie mit
          OpenFS buchen. Am einfachsten: heute, mit dem Stand laut Kassenbuch und
          Kontoauszug. Können nur vor der ersten Buchung gesetzt werden.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            id="setup-openingDate"
            label="Stichtag"
            type="date"
            error={errors.openingDate}
            value={form.openingDate}
            onChange={set("openingDate")}
          />
          <Field
            id="setup-kasse"
            label="Kasse, EUR"
            inputMode="decimal"
            placeholder="0,00"
            error={errors.kasse}
            value={form.kasse}
            onChange={set("kasse")}
          />
          <Field
            id="setup-bank"
            label="Bank, EUR"
            inputMode="decimal"
            placeholder="0,00"
            error={errors.bank}
            value={form.bank}
            onChange={set("bank")}
          />
        </div>
        <RequiredLegend />
        <Button type="submit" disabled={busy}>
          {busy ? "Wird eingerichtet…" : "Fahrschule einrichten"}
        </Button>
      </form>
    </Shell>
  );
}

type PlatformInfo =
  | { mode: "single" }
  | { mode: "platform"; baseDomain: string; signup: boolean }
  | { mode: "tenant"; slug: string; exists: boolean; active: boolean };

/* Multi-tenant mode: the bare domain shows the platform page, unknown
   or suspended schools a clear message instead of a sign-in form. */
export function AuthGate({ children }: { children: ReactNode }) {
  const platform = useQuery({
    queryKey: ["auth", "platform"],
    queryFn: async () => parseOrThrow<PlatformInfo>(await fetch("/api/platform/info")),
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (platform.isPending) {
    return (
      <main className="grid min-h-svh place-items-center bg-sidebar">
        <Spinner />
      </main>
    );
  }
  const info = platform.data ?? { mode: "single" };
  if (info.mode === "platform") {
    return <PlatformPage baseDomain={info.baseDomain} signup={info.signup} />;
  }
  if (info.mode === "tenant" && !info.exists) {
    return (
      <Shell
        title="Fahrschule nicht gefunden"
        description={`Unter „${info.slug}“ ist keine Fahrschule registriert. Bitte die Adresse prüfen.`}
      >
        <span />
      </Shell>
    );
  }
  if (info.mode === "tenant" && !info.active) {
    return (
      <Shell
        title="Zugang gesperrt"
        description="Der Zugang dieser Fahrschule ist derzeit gesperrt. Bitte wenden Sie sich an OpenFS."
      >
        <span />
      </Shell>
    );
  }
  return <SchoolGate>{children}</SchoolGate>;
}

function SchoolGate({ children }: { children: ReactNode }) {
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
