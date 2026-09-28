/* Multi-tenant mode end to end: two schools on one server must never see
   each other's data, sessions or files. Hosts are sent via the Host
   header (X-Forwarded-Host only counts with TRUST_PROXY=1, see http.ts). In-memory databases
   throughout (TENANTS_DIR ":memory:"). */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { serve } from "bun";

import { MemoryFileStore } from "./file-store";
import {
  buildTenantApiRoutes,
  createContextDb,
  isValidSlug,
  Registry,
  TenantFileStore,
  TenantManager,
  tenantSlugFromHost,
} from "./tenancy";
import { requestContext } from "./request-context";

const BASE = "openfs.test";
let manager: TenantManager;
let files: MemoryFileStore;
let server: ReturnType<typeof serve>;
let url: string;

async function start(signup = true) {
  files = new MemoryFileStore();
  manager = new TenantManager(Registry.open(":memory:"), {
    dir: ":memory:",
    baseDomain: BASE,
  });
  server = serve({
    port: 0,
    routes: buildTenantApiRoutes(manager, {
      smtp: null,
      backups: null,
      fileStore: new TenantFileStore(files),
      signup,
      signupRateLimit: false,
      loginRateLimit: false,
    }),
    fetch: () => new Response("not found", { status: 404 }),
  });
  url = `http://localhost:${server.port}`;
}

beforeEach(() => start());
afterEach(() => {
  server.stop(true);
  manager.closeAll();
});

const at = (slug: string | null, init: RequestInit & { cookie?: string } = {}) => ({
  ...init,
  headers: {
    "Content-Type": "application/json",
    Host: slug ? `${slug}.${BASE}` : BASE,
    ...(init.cookie ? { cookie: init.cookie } : {}),
    ...init.headers,
  },
});

async function provision(slug: string, schoolName: string) {
  await manager.provision({
    slug,
    schoolName,
    ownerName: "Inhaber",
    email: `chef@${slug}.de`,
    password: "sehr-geheim-1",
  });
}

async function login(slug: string): Promise<string> {
  const res = await fetch(
    `${url}/api/auth/login`,
    at(slug, {
      method: "POST",
      body: JSON.stringify({ email: `chef@${slug}.de`, password: "sehr-geheim-1" }),
    }),
  );
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

describe("hosts and slugs", () => {
  test("parses the school from the host", () => {
    expect(tenantSlugFromHost("fs-mueller.openfs.de", "openfs.de")).toBe("fs-mueller");
    expect(tenantSlugFromHost("fs-mueller.openfs.de:3000", "openfs.de")).toBe(
      "fs-mueller",
    );
    expect(tenantSlugFromHost("openfs.de", "openfs.de")).toBeNull();
    expect(tenantSlugFromHost("www.openfs.de", "openfs.de")).toBeNull();
    expect(tenantSlugFromHost("a.b.openfs.de", "openfs.de")).toBeUndefined();
    expect(tenantSlugFromHost("evil.example", "openfs.de")).toBeUndefined();
  });

  test("slug rules", () => {
    expect(isValidSlug("fs-mueller")).toBe(true);
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("-abc")).toBe(false);
    expect(isValidSlug("www")).toBe(false);
    expect(isValidSlug("Fahrschule")).toBe(false);
  });
});

describe("isolation", () => {
  test("each school sees only its own data and sessions", async () => {
    await provision("alpha", "Fahrschule Alpha");
    await provision("beta", "Fahrschule Beta");
    const alpha = await login("alpha");
    const beta = await login("beta");

    const created = await fetch(
      `${url}/api/instructors`,
      at("alpha", {
        method: "POST",
        cookie: alpha,
        body: JSON.stringify({ firstName: "Anna", lastName: "Alpha", classes: "B" }),
      }),
    );
    expect(created.status).toBe(201);

    const listOf = async (slug: string, cookie: string) =>
      (
        (await (await fetch(`${url}/api/instructors`, at(slug, { cookie }))).json()) as {
          instructors: { lastName: string }[];
        }
      ).instructors.map((i) => i.lastName);
    expect(await listOf("alpha", alpha)).toEqual(["Alpha"]);
    expect(await listOf("beta", beta)).toEqual([]);

    // Alpha's session cookie means nothing at Beta.
    expect(
      (await fetch(`${url}/api/instructors`, at("beta", { cookie: alpha }))).status,
    ).toBe(401);
    const company = (await (
      await fetch(`${url}/api/profile`, at("beta", { cookie: beta }))
    ).json()) as {
      name: string;
    };
    expect(company.name).toBe("Fahrschule Beta");
  });

  test("invoices work in every school (per-school invoice schema)", async () => {
    await provision("alpha", "Fahrschule Alpha");
    await provision("beta", "Fahrschule Beta");
    for (const slug of ["alpha", "beta"]) {
      const cookie = await login(slug);
      const post = async (path: string, body: unknown) => {
        const res = await fetch(
          `${url}${path}`,
          at(slug, { method: "POST", cookie, body: JSON.stringify(body) }),
        );
        expect(res.status).toBe(201);
        return (await res.json()) as Record<string, unknown>;
      };
      const student = await post("/api/students", {
        firstName: "Rita",
        lastName: "Rechnung",
        customerNumber: `K-${slug}`,
        contractNumber: `V-${slug}`,
      });
      const charge = await post("/api/accounting/transactions", {
        type: "guthaben_uebertragung",
        date: "2026-03-01",
        amountCents: 6500,
        habenKonto: "4400",
        student: { customerNo: student.customerNumber, name: "Rita Rechnung" },
        description: "Fahrstunde",
      });
      await post("/api/invoices", {
        studentId: student.id,
        date: "2026-03-02",
        transactionIds: [charge.id],
      });
    }
  });

  test("new schools start empty (no demo data)", async () => {
    await provision("gamma", "Fahrschule Gamma");
    const cookie = await login("gamma");
    const res = (await (
      await fetch(`${url}/api/students`, at("gamma", { cookie }))
    ).json()) as {
      students: unknown[];
    };
    expect(res.students).toEqual([]);
  });

  test("files are stored under the school's prefix", async () => {
    await provision("alpha", "Fahrschule Alpha");
    const db = manager.cached("alpha")!;
    const store = new TenantFileStore(files);
    await requestContext.run({ db, tenant: "alpha" }, () =>
      store.put("x/1.pdf", new Uint8Array([1]), "application/pdf"),
    );
    expect([...files.files.keys()]).toEqual(["alpha/x/1.pdf"]);
  });

  test("the context database refuses to work outside a request", () => {
    expect(() => createContextDb().query("SELECT 1")).toThrow();
  });
});

describe("unknown, suspended and platform hosts", () => {
  test("unknown school → 404, suspended → 402, bare domain → 404 for school APIs", async () => {
    await provision("alpha", "Fahrschule Alpha");
    expect((await fetch(`${url}/api/auth/status`, at("nope"))).status).toBe(404);
    manager.registry.setStatus("alpha", "gesperrt");
    expect((await fetch(`${url}/api/auth/status`, at("alpha"))).status).toBe(402);
    expect((await fetch(`${url}/api/auth/status`, at(null))).status).toBe(404);
  });

  test("platform info tells the SPA which page to show", async () => {
    await provision("alpha", "Fahrschule Alpha");
    const info = async (slug: string | null) =>
      (await fetch(`${url}/api/platform/info`, at(slug))).json();
    expect(await info(null)).toEqual({
      mode: "platform",
      baseDomain: BASE,
      signup: true,
    });
    expect(await info("alpha")).toEqual({
      mode: "tenant",
      slug: "alpha",
      exists: true,
      active: true,
    });
    expect(await info("nope")).toMatchObject({ exists: false });
  });
});

describe("self-service signup", () => {
  const body = {
    slug: "fs-neu",
    schoolName: "Fahrschule Neu",
    ownerName: "Nina Neu",
    email: "nina@fs-neu.de",
    password: "sehr-geheim-1",
    acceptTerms: true,
  };

  test("creates the school and its Inhaber; the address can only be taken once", async () => {
    const res = await fetch(
      `${url}/api/platform/signup`,
      at(null, { method: "POST", body: JSON.stringify(body) }),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as { url: string }).url).toContain(`fs-neu.${BASE}`);
    const login = await fetch(
      `${url}/api/auth/login`,
      at("fs-neu", {
        method: "POST",
        body: JSON.stringify({ email: body.email, password: body.password }),
      }),
    );
    expect(login.status).toBe(200);

    const again = await fetch(
      `${url}/api/platform/signup`,
      at(null, { method: "POST", body: JSON.stringify(body) }),
    );
    expect(again.status).toBe(400);
  });

  test("a failed signup leaves no half-created school", async () => {
    const res = await fetch(
      `${url}/api/platform/signup`,
      at(null, { method: "POST", body: JSON.stringify({ ...body, password: "kurz" }) }),
    );
    expect(res.status).toBe(400);
    expect(manager.registry.get("fs-neu")).toBeNull();
  });

  test("needs accepted terms and is off unless enabled", async () => {
    const noTerms = await fetch(
      `${url}/api/platform/signup`,
      at(null, { method: "POST", body: JSON.stringify({ ...body, acceptTerms: false }) }),
    );
    expect(noTerms.status).toBe(400);
    server.stop(true);
    manager.closeAll();
    await start(false);
    const off = await fetch(
      `${url}/api/platform/signup`,
      at(null, { method: "POST", body: JSON.stringify(body) }),
    );
    expect(off.status).toBe(404);
  });
});
