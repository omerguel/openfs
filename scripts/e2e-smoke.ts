/* ------------------------------------------------------------------ */
/* Browser smoke test: boots the real server in DEMO_MODE (in-memory   */
/* DB, never touches data/fahrschule.db), opens every route from       */
/* src/router.tsx in Chromium and fails on uncaught page errors,       */
/* console errors, failed API calls or an empty page. Tab-heavy pages  */
/* additionally click through their tabs.                              */
/*                                                                     */
/*   bun run test:e2e                                                  */
/*                                                                     */
/* The route list is parsed from the router, so a new page is covered  */
/* without touching this file.                                         */
/* ------------------------------------------------------------------ */

import { chromium, type Browser, type Page } from "playwright";

import { canSeeRoute } from "../src/lib/navigation";

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = Number(process.env.E2E_PORT) || 4100 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;

/* Pages meant to be reachable without signing in. */
const PUBLIC_PAGES = [
  "/anfrage",
  "/portal/",
  "/impressum",
  "/datenschutz",
  "/einladung/",
];

/* Tabs worth clicking per page (visible button/tab labels). */
const CLICK_THROUGH: Record<string, string[]> = {
  "/fahrschule": [
    "Bankverbindung",
    "Öffentliches Profil",
    "Öffnungszeiten",
    "Standorte",
    "Rechtliches",
    "Terminabsagen",
    "Datenschutz",
  ],
  "/benutzer": ["Protokoll"],
  "/fahrlehrer": ["Arbeitszeiten"],
  "/rechnungen": ["Offene Posten", "Ratenpläne", "Lastschriften", "Einstellungen"],
  "/fahrschueler/$studentId": [
    "Stundenübersicht",
    "Dokumente",
    "Zahlungserfassung",
    "Preise",
  ],
};

async function routesFromRouter(): Promise<string[]> {
  const source = await Bun.file(`${ROOT}src/router.tsx`).text();
  return [...source.matchAll(/path: "([^"]+)"/g)].map((match) => match[1]!);
}

/* Demo mode seeds this Inhaber login (src/index.ts). */
const DEMO_LOGIN = { email: "demo@openfs.de", password: "openfs-demo" };
let cookie = "";

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", cookie, ...init.headers },
  });
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/api/auth/status`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(200);
  }
  throw new Error("Server did not start.");
}

async function resolveParams(path: string): Promise<string> {
  if (path.includes("$inviteToken")) {
    const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.de`;
    const created = await api("/api/users", {
      method: "POST",
      body: JSON.stringify({ email, name: "E2E Einladung", role: "buero", invite: true }),
    });
    const { id } = (await created.json()) as { id: number };
    const res = await api(`/api/users/${id}/invite`, { method: "POST", body: "{}" });
    const { url } = (await res.json()) as { url?: string };
    if (!url) throw new Error(`Could not create an invite link: ${res.status}`);
    return path.replace("$inviteToken", url.split("/einladung/")[1]!);
  }
  if (path.includes("$studentId")) {
    const { students } = (await (await api("/api/students")).json()) as {
      students: { id: number }[];
    };
    return path.replace("$studentId", String(students[0]!.id));
  }
  if (path.includes("$token")) {
    const { students } = (await (await api("/api/students")).json()) as {
      students: { id: number }[];
    };
    const res = await api(`/api/students/${students[0]!.id}/portal-link`, {
      method: "POST",
    });
    const body = (await res.json()) as { token?: string };
    if (!body.token) throw new Error(`Could not create a portal token: ${res.status}`);
    return path.replace("$token", body.token);
  }
  return path;
}

async function check(
  page: Page,
  url: string,
  clicks: string[],
  /** Also flag 401/403 answers — a page asking for data its role may
   *  not read (Fahrlehrer pass). */
  flagForbidden = false,
): Promise<string[]> {
  const problems: string[] = [];
  const onError = (error: Error) => problems.push(`pageerror: ${error.message}`);
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  };
  const onResponse = (response: {
    url(): string;
    status(): number;
    request(): { method(): string };
  }) => {
    if (!response.url().includes("/api/")) return;
    const status = response.status();
    if (status >= 500 || (flagForbidden && (status === 401 || status === 403))) {
      problems.push(`api ${status}: ${response.request().method()} ${response.url()}`);
    }
  };
  page.on("pageerror", onError);
  page.on("console", onConsole);
  page.on("response", onResponse);
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    const text = (await page.locator("body").innerText()).trim();
    if (text.length < 20) problems.push("page rendered (almost) nothing");
    if (text.includes("Seite nicht gefunden"))
      problems.push("route rendered the 404 page");
    for (const label of clicks) {
      await page.getByText(label, { exact: true }).first().click({ timeout: 5000 });
      await page.waitForLoadState("networkidle");
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message.split("\n")[0]! : String(error));
  } finally {
    page.off("pageerror", onError);
    page.off("console", onConsole);
    page.off("response", onResponse);
  }
  return problems;
}

/* Regression checks for form behaviour that a render smoke test misses.
   Each returns a problem description or null. */
const FORM_CHECKS: { name: string; run: (page: Page) => Promise<string | null> }[] = [
  {
    // The first keystroke into an untouched settings field used to be
    // dropped (dirty state set in a capture handler reset the input).
    name: "Einstellungen: erste Eingabe in ein unberührtes Feld bleibt erhalten",
    run: async (page) => {
      await page.goto(`${BASE}/fahrschule?tab=stammdaten`, { waitUntil: "networkidle" });
      await page.locator("#company-ustidnr").fill("DE123456789");
      const filled = await page.inputValue("#company-ustidnr");
      if (filled !== "DE123456789") return `fill() ergab „${filled}“`;
      await page.locator("#company-steuernummer").fill("");
      await page.goto(`${BASE}/fahrschule?tab=stammdaten`, { waitUntil: "networkidle" });
      await page
        .locator("#company-steuernummer")
        .pressSequentially("315/5", { delay: 20 });
      const typed = await page.inputValue("#company-steuernummer");
      if (typed !== "315/5") return `Tippen ergab „${typed}“`;
      const save = page.getByRole("button", { name: "Speichern" }).first();
      if (!(await save.isEnabled()))
        return "Speichern blieb nach der Eingabe deaktiviert";
      return null;
    },
  },
  {
    name: "Einstellungen: Klick auf einen Tab markiert nichts als geändert",
    run: async (page) => {
      await page.goto(`${BASE}/fahrschule?tab=stammdaten`, { waitUntil: "networkidle" });
      await page.getByRole("tab", { name: "Öffnungszeiten" }).click();
      await page.getByRole("tab", { name: "Stammdaten & Steuer" }).click();
      const save = page.getByRole("button", { name: "Speichern" }).first();
      return (await save.isEnabled()) ? "Speichern ist ohne Änderung aktiv" : null;
    },
  },
  {
    name: "Datenschutz: Fristen, Auskunft und Löschen-auf-Antrag-Übersicht",
    run: async (page) => {
      await page.goto(`${BASE}/fahrschule?tab=datenschutz`, { waitUntil: "networkidle" });
      if (!(await page.getByRole("heading", { name: "Löschvorschau" }).isVisible()))
        return "Löschvorschau fehlt";
      const anfragen = page.locator("#retention-anfragen");
      await anfragen.fill("9");
      const save = page.getByRole("button", { name: "Fristen speichern" });
      if (!(await save.isEnabled())) return "Löschfristen: Speichern bleibt deaktiviert";
      const select = page.locator("#privacy-subject");
      const value = await select.locator("option").nth(1).getAttribute("value");
      if (!value) return "keine Person zur Auswahl";
      await select.selectOption(value);
      const html = await api(`/api/admin/privacy/students/${value}/auskunft?format=html`);
      if (!html.ok || !(await html.text()).includes("Art. 15"))
        return `Auskunft: HTTP ${html.status}`;
      await page.getByRole("button", { name: "Löschen auf Antrag" }).click();
      await page
        .getByRole("heading", { name: "Wird sofort gelöscht" })
        .waitFor({ timeout: 5000 });
      await page.getByRole("button", { name: "Abbrechen" }).click();
      return null;
    },
  },
];

/* Fahrlehrer/in: every page of the role renders without a single 401/403
   (the explicit API allow-list in src/server/auth.ts and the pages must
   agree); office pages show "Kein Zugriff" without asking the API. */
async function instructorPass(browser: Browser): Promise<number> {
  const email = `e2e-fahrlehrer-${Date.now()}@example.de`;
  const password = "fahrlehrer-e2e-1";
  const { instructors } = (await (await api("/api/instructors")).json()) as {
    instructors: { id: number }[];
  };
  const created = await api("/api/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      name: "E2E Fahrlehrer",
      password,
      role: "fahrlehrer",
      instructorId: instructors[0]?.id,
    }),
  });
  if (!created.ok) throw new Error(`Could not create a Fahrlehrer: ${created.status}`);
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error(`Fahrlehrer login failed: ${login.status}`);
  const [name, value] = login.headers.get("set-cookie")!.split(";")[0]!.split("=") as [
    string,
    string,
  ];
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addCookies([{ name, value, url: BASE }]);
  const page = await context.newPage();
  let failures = 0;
  for (const route of await routesFromRouter()) {
    if (PUBLIC_PAGES.some((prefix) => route.startsWith(prefix))) continue;
    const path = await resolveParams(route);
    const allowed = canSeeRoute("fahrlehrer", path);
    const clicks = allowed ? (INSTRUCTOR_CLICK_THROUGH[route] ?? []) : [];
    const problems = await check(page, `${BASE}${path}`, clicks, true);
    if (!allowed) {
      const text = await page.locator("body").innerText();
      if (!text.includes("Kein Zugriff")) problems.push("office page not blocked");
    }
    if (problems.length) {
      failures += 1;
      console.log(`✗ ${route} (Fahrlehrer)`);
      for (const problem of problems) console.log(`    ${problem}`);
    }
  }
  await context.close();
  if (failures === 0) console.log("✓ Fahrlehrer: alle Seiten ohne 401/403");
  return failures;
}

/* Tabs a Fahrlehrer/in sees (Dokumente, Zahlung, Preise are office-only). */
const INSTRUCTOR_CLICK_THROUGH: Record<string, string[]> = {
  "/fahrschueler/$studentId": ["Stundenübersicht"],
};

const server = Bun.spawn(["bun", "src/index.ts"], {
  cwd: ROOT,
  env: { ...process.env, DEMO_MODE: "1", PORT: String(PORT), NODE_ENV: "production" },
  stdout: "ignore",
  stderr: "inherit",
});

let failed = 0;
try {
  await waitForServer();
  const login = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(DEMO_LOGIN),
  });
  if (!login.ok) throw new Error(`Demo login failed: ${login.status}`);
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const [name, value] = cookie.split("=") as [string, string];
  await context.addCookies([{ name, value, url: BASE }]);
  const page = await context.newPage();
  for (const route of await routesFromRouter()) {
    const path = await resolveParams(route);
    const problems = await check(page, `${BASE}${path}`, CLICK_THROUGH[route] ?? []);
    if (problems.length) {
      failed += 1;
      console.log(`✗ ${route}`);
      for (const problem of problems) console.log(`    ${problem}`);
    } else {
      console.log(`✓ ${route}`);
    }
  }
  for (const check of FORM_CHECKS) {
    let problem: string | null;
    try {
      problem = await check.run(page);
    } catch (error) {
      problem = error instanceof Error ? error.message.split("\n")[0]! : String(error);
    }
    if (problem) {
      failed += 1;
      console.log(`✗ ${check.name}\n    ${problem}`);
    } else {
      console.log(`✓ ${check.name}`);
    }
  }
  // Signed out: public pages still work, staff pages show the sign-in form.
  const anonymous = await (await browser.newContext()).newPage();
  for (const route of await routesFromRouter()) {
    const path = await resolveParams(route);
    const isPublicPage = PUBLIC_PAGES.some((prefix) => route.startsWith(prefix));
    const problems = isPublicPage ? await check(anonymous, `${BASE}${path}`, []) : [];
    if (!isPublicPage) {
      await anonymous.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      const text = await anonymous.locator("body").innerText();
      if (!text.includes("Anmelden"))
        problems.push("staff page visible without signing in");
    }
    if (problems.length) {
      failed += 1;
      console.log(`✗ ${route} (abgemeldet)`);
      for (const problem of problems) console.log(`    ${problem}`);
    }
  }
  console.log("✓ abgemeldet: öffentliche Seiten erreichbar, interne Seiten geschützt");
  failed += await instructorPass(browser);
  await browser.close();
} finally {
  server.kill();
}

if (failed > 0) {
  console.log(`\n${failed} route(s) failed.`);
  process.exit(1);
}
console.log("\nAll routes rendered without errors.");
