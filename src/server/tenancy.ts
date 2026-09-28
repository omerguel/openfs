/* ------------------------------------------------------------------ */
/* Multi-tenant mode (SaaS): one portal per school at                  */
/* <slug>.<BASE_DOMAIN>, one SQLite file per school (physical          */
/* isolation, "export all your data" = hand over the file).            */
/*                                                                     */
/*  - registry.db   tenants(slug, name, email, status) — which schools */
/*                  exist and whether they are active.                 */
/*  - TenantManager opens a school's DB lazily, prepares it and starts */
/*                  its jobs (mail, backups) once.                     */
/*  - Routes are built once over a *context database*: a Proxy that    */
/*    forwards every call to the DB of the current request, which the  */
/*    auth guard resolves from the Host header and puts into the       */
/*    request context (AsyncLocalStorage). Domain modules stay         */
/*    unchanged and never see another school's data.                   */
/*  - Files and backups are namespaced by slug the same way.           */
/* ------------------------------------------------------------------ */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { BunRequest } from "bun";

import { buildApiRoutes } from "./app-routes";
import { createUser, sameOrigin } from "./auth";
import type { BackupConfig } from "./backups";
import { type SchoolJobOptions, prepareSchoolDb, startSchoolJobs } from "./bootstrap";
import { openDb } from "./db";
import { ValidationError } from "./errors";
import type { FileStore } from "./file-store";
import {
  clientIp,
  createRateLimiter,
  err,
  handle,
  json,
  type RateLimit,
  type RequestIPSource,
} from "./http";
import { requestContext } from "./request-context";
import { checkContentType, limitBody, PUBLIC_BODY_LIMIT_BYTES } from "./request-guards";
import { applySetup } from "./setup";
import type { SmsConfig } from "./sms";
import type { SmtpConfig } from "./smtp";
import { type Database, openSqlite } from "./sqlite";

export type TenancyConfig = {
  /** e.g. "openfs.de" — schools live at <slug>.openfs.de. */
  baseDomain: string;
  /** Directory holding <slug>.db files. */
  dir: string;
  registryPath: string;
  /** Self-service signup on the bare domain. */
  signup: boolean;
};

type Env = Record<string, string | undefined>;

export function tenancyConfigFromEnv(env: Env = process.env): TenancyConfig | null {
  if (env.MULTI_TENANT !== "1" && env.MULTI_TENANT !== "true") return null;
  const baseDomain = env.BASE_DOMAIN?.trim().toLowerCase();
  if (!baseDomain)
    throw new Error("MULTI_TENANT=1 braucht BASE_DOMAIN (z. B. openfs.de).");
  const dir = env.TENANTS_DIR?.trim() || join("data", "tenants");
  return {
    baseDomain,
    dir,
    registryPath: env.REGISTRY_PATH?.trim() || join("data", "registry.db"),
    signup: env.PLATFORM_SIGNUP === "1" || env.PLATFORM_SIGNUP === "true",
  };
}

/* ------------------------------------------------------------------ */
/* slugs + host parsing                                                */
/* ------------------------------------------------------------------ */

const RESERVED = new Set([
  "www",
  "api",
  "app",
  "admin",
  "mail",
  "smtp",
  "static",
  "assets",
  "portal",
  "demo",
  "status",
  "hilfe",
  "support",
]);

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(slug) && !RESERVED.has(slug);
}

/** "fs-mueller.openfs.de" → "fs-mueller"; bare/www domain → null;
    foreign host → undefined. Ports are ignored. */
export function tenantSlugFromHost(
  host: string | null,
  baseDomain: string,
): string | null | undefined {
  if (!host) return undefined;
  const name = host.toLowerCase().replace(/:\d+$/, "");
  if (name === baseDomain || name === `www.${baseDomain}`) return null;
  if (!name.endsWith(`.${baseDomain}`)) return undefined;
  const sub = name.slice(0, -(baseDomain.length + 1));
  return sub.includes(".") ? undefined : sub;
}

export function requestHost(req: Request): string | null {
  return req.headers.get("x-forwarded-host") ?? req.headers.get("host");
}

/* ------------------------------------------------------------------ */
/* registry                                                            */
/* ------------------------------------------------------------------ */

export type TenantStatus = "aktiv" | "gesperrt";

export type Tenant = {
  slug: string;
  name: string;
  email: string;
  status: TenantStatus;
  createdAt: string;
};

export class Registry {
  constructor(readonly db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv', 'gesperrt')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  static open(path: string): Registry {
    if (path !== ":memory:") mkdirSync(join(path, ".."), { recursive: true });
    const db = openSqlite(path);
    db.exec("PRAGMA journal_mode = WAL;");
    return new Registry(db);
  }

  private row(row: {
    slug: string;
    name: string;
    email: string;
    status: TenantStatus;
    created_at: string;
  }): Tenant {
    return {
      slug: row.slug,
      name: row.name,
      email: row.email,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  get(slug: string): Tenant | null {
    const row = this.db
      .query<
        {
          slug: string;
          name: string;
          email: string;
          status: TenantStatus;
          created_at: string;
        },
        [string]
      >("SELECT * FROM tenants WHERE slug = ?")
      .get(slug);
    return row ? this.row(row) : null;
  }

  list(): Tenant[] {
    return this.db
      .query<
        {
          slug: string;
          name: string;
          email: string;
          status: TenantStatus;
          created_at: string;
        },
        []
      >("SELECT * FROM tenants ORDER BY slug")
      .all()
      .map((row) => this.row(row));
  }

  insert(slug: string, name: string, email: string) {
    if (!isValidSlug(slug)) {
      throw new ValidationError(
        "Die Adresse darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten (3–30 Zeichen).",
      );
    }
    try {
      this.db
        .prepare("INSERT INTO tenants (slug, name, email) VALUES (?, ?, ?)")
        .run(slug, name, email);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new ValidationError("Diese Adresse ist bereits vergeben.");
      }
      throw error;
    }
  }

  remove(slug: string) {
    this.db.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  }

  setStatus(slug: string, status: TenantStatus) {
    const result = this.db
      .prepare("UPDATE tenants SET status = ? WHERE slug = ?")
      .run(status, slug);
    if (result.changes === 0)
      throw new ValidationError(`Fahrschule '${slug}' nicht gefunden.`);
  }
}

/* ------------------------------------------------------------------ */
/* tenant databases                                                    */
/* ------------------------------------------------------------------ */

export type ProvisionInput = {
  slug: string;
  schoolName: string;
  ownerName: string;
  email: string;
  password: string;
  address?: string;
  phone?: string;
};

export class TenantManager {
  private readonly open = new Map<string, Database>();
  private readonly stops = new Map<string, () => void>();

  constructor(
    readonly registry: Registry,
    readonly config: Pick<TenancyConfig, "dir" | "baseDomain">,
    private readonly jobs: ((slug: string) => SchoolJobOptions) | null = null,
    private readonly fileStore: FileStore | null = null,
  ) {
    if (config.dir !== ":memory:") mkdirSync(config.dir, { recursive: true });
  }

  private path(slug: string): string {
    return this.config.dir === ":memory:"
      ? ":memory:"
      : join(this.config.dir, `${slug}.db`);
  }

  /** Open (once) and prepare a registered school's database. */
  async get(slug: string): Promise<Database> {
    const cached = this.open.get(slug);
    if (cached) return cached;
    const db = openDb(this.path(slug), { demoData: false });
    await requestContext.run({ db, tenant: slug }, () =>
      prepareSchoolDb(db, { fileStore: this.fileStore ?? undefined }),
    );
    this.open.set(slug, db);
    if (this.jobs) this.stops.set(slug, startSchoolJobs(db, this.jobs(slug)));
    return db;
  }

  /** Open every registered school (at startup, so jobs run for all). */
  async openAll(): Promise<void> {
    for (const tenant of this.registry.list()) await this.get(tenant.slug);
  }

  cached(slug: string): Database | undefined {
    return this.open.get(slug);
  }

  /** Register a school, create its database and its first Inhaber. */
  async provision(input: ProvisionInput): Promise<Tenant> {
    const slug = input.slug.trim().toLowerCase();
    const email = input.email.trim().toLowerCase();
    this.registry.insert(slug, input.schoolName.trim(), email);
    try {
      const db = await this.get(slug);
      applySetup(db, {
        schoolName: input.schoolName,
        address: input.address,
        phone: input.phone,
        schoolEmail: email,
      });
      await createUser(db, {
        email,
        name: input.ownerName,
        password: input.password,
        role: "inhaber",
      });
    } catch (error) {
      // No half-provisioned school: drop the registry entry and the
      // database file (with its WAL/SHM companions) again.
      this.close(slug);
      this.registry.remove(slug);
      const path = this.path(slug);
      if (path !== ":memory:") {
        for (const suffix of ["", "-wal", "-shm", "-journal"]) {
          rmSync(`${path}${suffix}`, { force: true });
        }
      }
      throw error;
    }
    return this.registry.get(slug)!;
  }

  close(slug: string) {
    this.stops.get(slug)?.();
    this.stops.delete(slug);
    this.open.get(slug)?.close();
    this.open.delete(slug);
  }

  closeAll() {
    for (const slug of [...this.open.keys()]) this.close(slug);
  }

  /** For the auth guard: the school of this request, or an error page. */
  resolve(req: Request): { db: Database; tenant: string } | Response {
    const slug = tenantSlugFromHost(requestHost(req), this.config.baseDomain);
    if (slug === null) return err("Bitte die Adresse Ihrer Fahrschule aufrufen.", 404);
    if (slug === undefined) return err("Unbekannte Adresse.", 404);
    const tenant = this.registry.get(slug);
    if (!tenant) return err("Diese Fahrschule gibt es nicht.", 404);
    if (tenant.status !== "aktiv") {
      return err(
        "Der Zugang dieser Fahrschule ist gesperrt. Bitte wenden Sie sich an OpenFS.",
        402,
      );
    }
    const db = this.open.get(slug);
    if (!db) {
      // Registered but not yet opened (e.g. provisioned by another process).
      return err(
        "Die Fahrschule wird gerade gestartet — bitte gleich erneut versuchen.",
        503,
      );
    }
    return { db, tenant: slug };
  }
}

/* ------------------------------------------------------------------ */
/* per-request forwarding                                              */
/* ------------------------------------------------------------------ */

/** A Database stand-in that forwards to the current request's tenant DB.
    Used outside a tenant request it throws instead of guessing. */
export function createContextDb(): Database {
  const target = () => {
    const db = requestContext.getStore()?.db;
    if (!db) throw new Error("Kein Mandant im Anfragekontext.");
    return db;
  };
  return new Proxy({} as Database, {
    get(_, prop) {
      const db = target();
      const value = Reflect.get(db, prop, db);
      return typeof value === "function" ? value.bind(db) : value;
    },
  });
}

function currentTenant(): string {
  const tenant = requestContext.getStore()?.tenant;
  if (!tenant) throw new Error("Kein Mandant im Anfragekontext.");
  return tenant;
}

/** File store that keeps every school's files under "<slug>/". */
export class TenantFileStore implements FileStore {
  constructor(private readonly base: FileStore) {}
  private key(key: string) {
    return `${currentTenant()}/${key}`;
  }
  put(key: string, bytes: Uint8Array, contentType: string) {
    return this.base.put(this.key(key), bytes, contentType);
  }
  get(key: string) {
    return this.base.get(this.key(key));
  }
  delete(key: string) {
    return this.base.delete(this.key(key));
  }
}

/** Backup settings per school: <dir>/<slug>/ and <prefix><slug>/. */
export function tenantBackupConfig(base: BackupConfig, slug: string): BackupConfig {
  return {
    ...base,
    dir: join(base.dir, slug),
    files: base.files ? `${base.files}/${slug}` : base.files,
    offsite: base.offsite
      ? {
          ...base.offsite,
          prefix: `${base.offsite.prefix}${slug}/`,
          label: `${base.offsite.label}${slug}/`,
        }
      : null,
  };
}

/** Backup config whose paths follow the request's school (for the admin
    routes, which are built once). */
export function contextBackupConfig(base: BackupConfig): BackupConfig {
  const current = () => tenantBackupConfig(base, currentTenant());
  return {
    get dir() {
      return current().dir;
    },
    keep: base.keep,
    intervalHours: base.intervalHours,
    get files() {
      return current().files;
    },
    get offsite() {
      return current().offsite;
    },
  };
}

/* ------------------------------------------------------------------ */
/* platform endpoints (bare domain + school info)                      */
/* ------------------------------------------------------------------ */

export type PlatformInfo =
  | { mode: "single" }
  | { mode: "platform"; baseDomain: string; signup: boolean }
  | { mode: "tenant"; slug: string; exists: boolean; active: boolean };

export function platformRoutes(
  manager: TenantManager | null,
  options: {
    signup?: boolean;
    /** Signups per IP (default 5 per hour). */
    rateLimit?: RateLimit | false;
    /** Signups overall, all IPs together (default 30 per hour). */
    globalRateLimit?: RateLimit | false;
  } = {},
) {
  const limited = createRateLimiter(
    options.rateLimit ?? { max: 5, windowMs: 60 * 60_000 },
  );
  // A botnet rotating IPs must not be able to create schools en masse:
  // every signup provisions a database and an argon2 hash.
  const globallyLimited = createRateLimiter(
    options.globalRateLimit ?? { max: 30, windowMs: 60 * 60_000 },
  );
  return {
    "/api/platform/info": {
      GET: (req: BunRequest) =>
        handle(() => {
          if (!manager) return json({ mode: "single" } satisfies PlatformInfo);
          const slug = tenantSlugFromHost(requestHost(req), manager.config.baseDomain);
          if (slug == null) {
            return json({
              mode: "platform",
              baseDomain: manager.config.baseDomain,
              signup: options.signup === true,
            } satisfies PlatformInfo);
          }
          const tenant = manager.registry.get(slug);
          return json({
            mode: "tenant",
            slug,
            exists: tenant != null,
            active: tenant?.status === "aktiv",
          } satisfies PlatformInfo);
        })(),
    },

    /* Public and not behind the API guard (no school yet), so it applies
       the guard's request checks itself: JSON only, same origin, small
       body. E-mail addresses are NOT verified (no confirmation link) —
       see README "Multi-tenant mode". */
    "/api/platform/signup": {
      POST: (req: BunRequest, server: RequestIPSource) =>
        handle(async () => {
          if (!manager || options.signup !== true) {
            return err("Die Registrierung ist nicht freigeschaltet.", 404);
          }
          const badType = checkContentType(req, "POST", "/api/platform/signup");
          if (badType) return badType;
          if (!sameOrigin(req)) return err("Ungültige Herkunft der Anfrage.", 403);
          if (tenantSlugFromHost(requestHost(req), manager.config.baseDomain) !== null) {
            return err("Die Registrierung ist nur auf der Hauptadresse möglich.", 400);
          }
          if (limited(clientIp(req, server)) || globallyLimited("*")) {
            return err("Zu viele Registrierungen. Bitte später erneut versuchen.", 429);
          }
          const sized = await limitBody(req, server, PUBLIC_BODY_LIMIT_BYTES);
          if (sized instanceof Response) return sized;
          const body = (await sized.req.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          const text = (key: string) =>
            typeof body[key] === "string" ? String(body[key]) : "";
          if (!text("schoolName").trim()) {
            throw new ValidationError("Bitte den Namen der Fahrschule angeben.");
          }
          if (!text("ownerName").trim())
            throw new ValidationError("Bitte Ihren Namen angeben.");
          if (body.acceptTerms !== true) {
            throw new ValidationError(
              "Bitte AGB und Auftragsverarbeitungsvertrag akzeptieren.",
            );
          }
          const tenant = await manager.provision({
            slug: text("slug"),
            schoolName: text("schoolName"),
            ownerName: text("ownerName"),
            email: text("email"),
            password: text("password"),
            address: text("address"),
            phone: text("phone"),
          });
          const proto =
            new URL(req.url).protocol === "https:" ||
            req.headers.get("x-forwarded-proto") === "https"
              ? "https"
              : "http";
          const port = requestHost(req)?.match(/:\d+$/)?.[0] ?? "";
          return json(
            {
              slug: tenant.slug,
              url: `${proto}://${tenant.slug}.${manager.config.baseDomain}${port}/`,
            },
            201,
          );
        })(),
    },
  };
}

/* ------------------------------------------------------------------ */
/* assembled API for multi-tenant mode                                 */
/* ------------------------------------------------------------------ */

export type TenantApiOptions = {
  smtp: SmtpConfig | null;
  sms?: SmsConfig | null;
  /** Base backup settings; each school gets its own sub-directory. */
  backups: BackupConfig | null;
  /** Namespaced per school (TenantFileStore). */
  fileStore: FileStore;
  signup: boolean;
  signupRateLimit?: RateLimit | false;
  signupGlobalRateLimit?: RateLimit | false;
  loginRateLimit?: RateLimit | false;
};

/** All API routes for multi-tenant mode: the normal (guarded) API over
    the context database, plus the platform endpoints. */
export function buildTenantApiRoutes(manager: TenantManager, options: TenantApiOptions) {
  // Routes are built once; build-time table setup goes to a scratch DB —
  // every real school got its tables in prepareSchoolDb.
  const scratch = openSqlite(":memory:");
  const api = requestContext.run({ db: scratch, tenant: "_build" }, () =>
    buildApiRoutes(createContextDb(), {
      mail: { config: options.smtp, sms: options.sms ?? null },
      auth: {
        onSetup: (db, body) => applySetup(db, body),
        loginRateLimit: options.loginRateLimit,
      },
      fileStore: options.fileStore,
      backups: options.backups ? contextBackupConfig(options.backups) : null,
      resolveDb: (req) => manager.resolve(req),
    }),
  );
  scratch.close();
  return {
    ...api,
    ...platformRoutes(manager, {
      signup: options.signup,
      rateLimit: options.signupRateLimit,
      globalRateLimit: options.signupGlobalRateLimit,
    }),
  };
}
