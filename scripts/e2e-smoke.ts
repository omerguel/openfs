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

import { chromium, type Page } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = 4100 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;

/* Pages meant to be reachable without signing in. */
const PUBLIC_PAGES = ["/anfrage", "/portal/", "/impressum", "/datenschutz"];

/* Tabs worth clicking per page (visible button/tab labels). */
const CLICK_THROUGH: Record<string, string[]> = {
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

async function check(page: Page, url: string, clicks: string[]): Promise<string[]> {
  const problems: string[] = [];
  const onError = (error: Error) => problems.push(`pageerror: ${error.message}`);
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  };
  const onResponse = (response: { url(): string; status(): number }) => {
    if (response.url().includes("/api/") && response.status() >= 500) {
      problems.push(`api ${response.status()}: ${response.url()}`);
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
  await browser.close();
} finally {
  server.kill();
}

if (failed > 0) {
  console.log(`\n${failed} route(s) failed.`);
  process.exit(1);
}
console.log("\nAll routes rendered without errors.");
