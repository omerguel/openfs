# Design spike: multi-tenant architecture mapping

> Status: IMPLEMENTED (2026-09-28, `src/server/tenancy.ts`). Deviation from §3
> Option A: instead of rewriting all route factories to `getDb(req)`, routes
> are built once over a context database (a Proxy resolving the request's
> school DB from AsyncLocalStorage, set by the auth guard). Sessions are
> server-side per school (§4 option 2), not signed cookies. Original design
> text below.
> Authored against branch `advisor/026-tenancy-spike`
> (base `160eccc`, remove electron support).
> Every factual claim cites `file:line` or quotes code read in this tree.

---

## 0. Context

`plans/saas-plan.md` closes with: "Map exactly what in the current codebase
transfers to the multi-tenant server and what needs rethinking (tenancy, auth,
subdomain routing, uploads, backups)." This document is that mapping. It covers
all ten topics required to begin Phase 1 (the portal), ordered so later sections
build on earlier ones.

---

## 1. Request → tenant resolution

### The problem today

`src/index.ts:17-32` starts a single `Bun.serve()` with `"/*": index` as the
catch-all and a single `db` closed over at startup. There is no host-based
dispatch.

### Subdomain parsing in Bun.serve

Bun's `Request` object exposes the full URL including `Host` header, so tenant
extraction does not require a separate reverse proxy. Inside any route handler:

```ts
function tenantSlug(req: Request): string | null {
  const host = new URL(req.url).hostname; // e.g. "meineschule.openfs.de"
  const parts = host.split(".");
  if (parts.length < 3) return null;      // bare "openfs.de" → marketing site
  return parts[0];                        // "meineschule"
}
```

This works because `Bun.serve()` routes are matched on path only; the request
object is available in every handler. No framework change is needed.

### Local development story

Production hostnames (`slug.openfs.de`) do not resolve locally. Two workable
approaches:

1. **`/etc/hosts` + slug prefix**: add `127.0.0.1 demo.localhost` (or
   `demo.lvh.me` which already resolves to 127.0.0.1). Run with
   `BUN_ENV=development`; server treats `demo.localhost:3000` exactly as
   `demo.openfs.de`. Zero extra tooling.
2. **`X-Tenant` header override** (dev-only): if
   `process.env.NODE_ENV !== "production"` the tenant resolver accepts an
   `X-Tenant: <slug>` request header as a fallback. Allows `curl` scripting and
   unit tests without real DNS.

Approach 1 is the primary story; approach 2 is a testing convenience.

### SPA serving per tenant

Today `"/*": index` serves the same compiled bundle regardless of host
(`src/index.ts:21`). In the multi-tenant server each tenant gets the same React
bundle — the bundle reads its own API (relative paths, e.g. `/api/students`) and
the server resolves the tenant from `Host` on every API call. No per-tenant
bundle is needed. The catch-all stays `"/*": index` but API routes resolve db
per request (see §3).

The marketing site (`openfs.de`, no subdomain) and the admin panel need a
separate `serve()` instance or a path prefix (`/admin`), not covered in Phase 1.

---

## 2. DB-per-tenant lifecycle

### The existing seam

`src/server/sqlite.ts:52-54` exposes `openSqlite(path)` which wraps
`new BunDatabase(path, { create: true })`. The comment at
`src/server/sqlite.ts:1-8` explicitly names it "the single seam for opening
databases, which the multi-tenant SaaS will extend to 'open the database for
tenant X'."

`src/server/db.ts:282-299` shows `openDb(path = "data/fahrschule.db")` which
calls `openSqlite`, then runs DDL, migrations, `initAccounts`, `initSequences`,
`initSettings`, `initVehicles`, `initInstructors`, `initStudents`,
`initPricePlans`, `initCalendarEvents`, and `repairSoftReferences`.

### Proposed extension

Add `src/server/tenant-db.ts` (new file, Phase 1 work):

```ts
// Conceptual shape — not production code
const dbCache = new Map<string, Database>();

export function getDb(slug: string): Database {
  if (dbCache.has(slug)) return dbCache.get(slug)!;
  const db = openTenantDb(slug);        // openDb(`data/tenants/${slug}.db`)
  dbCache.set(slug, db);
  return db;
}
```

**File layout:** `data/tenants/<slug>.db` — keeps all tenant files under one
directory, easy to `ls` and rsync, no collision with the existing dev file
`data/fahrschule.db` (`src/server/db.ts:282`).

**LRU vs. open-on-demand:** at Phase 1 scale (single Hetzner box, tens of
tenants) a simple `Map` with no eviction is fine. Add LRU only when the
process holds too many WAL file descriptors under load — not a first-sprint
concern.

**Migration timing:** run `openDb` (which already runs all DDL + migrations
idempotently) on first request for a tenant. This means: if the server restarts,
each tenant's DB is opened and migrated on their first request. No separate
migration runner is needed until the school count is large enough that
all-at-once startup takes too long (hundreds of tenants).

**Seed policy — what an empty school needs:**

The init* functions in `db.ts` seed demo data gated on `count > 0` checks:
- `initAccounts` (`src/server/db.ts:700-720`): inserts SKR 04 accounts if the
  table is empty. This must run — every school starts with the same chart of
  accounts. Safe.
- `initSequences` (`src/server/db.ts:722-730`): inserts starting sequence
  values. The demo starts at beleg=123, buchung=218 to align with old UI seed
  numbers (`src/server/db.ts:727-729`). A fresh tenant should start at 0 (or 1).
  **Change needed**: pass a flag or use a separate `initProductionSequences()`
  that inserts `("beleg", 0)` and `("buchung", 0)`.
- `initSettings` (`src/server/db.ts:732-736`): inserts `DEFAULT_COMPANY`
  (`src/server/db.ts:270-280`, hardcoded "Fahrschule Gül"). Must be replaced
  with provisioning-time data (school name, address, email, phone from signup).
- `initVehicles` / `initInstructors` / `initStudents` / `initCalendarEvents`
  (`src/server/db.ts:457-634`): insert demo rows gated on `count > 0`.
  **Must NOT run for real tenants.** A fresh tenant has no vehicles, instructors,
  students, or calendar events.
- `seedTransactions` (`src/server/seed.ts:34-136`): inserts demo Buchungen.
  **Must NOT run for real tenants.**
- `ensureTheoryGroupTables` (`src/server/theory-groups.ts:156-162`): creates
  table + seeds demo theory groups if count = 0. The table creation must run;
  the seed must not.

**Proposed split:**

```
openTenantDb(slug, companyProfile)   // production path
  → openSqlite + DDL + migrations
  → initAccounts + initProductionSequences + initSettings(companyProfile)
  → ensureModuleTables()             // CREATE IF NOT EXISTS only, no seeds

openDemoDb()                         // dev/demo path (existing behaviour)
  → openDb()                         // unchanged — existing call in index.ts
```

Module table creation (campaigns, chat, reviews, branches, appointment_requests,
theory_groups) already uses `CREATE TABLE IF NOT EXISTS` inside their
`ensure*Tables` functions (`src/server/campaigns.ts:166`, `src/server/chat.ts:182`,
`src/server/reviews.ts:131`, `src/server/branches.ts:46`,
`src/server/appointment-requests.ts:223`, `src/server/theory-groups.ts:156`),
so calling them without their seed blocks is straightforward — just call
`db.exec(TABLE_DDL)` separately, or add a `{ seed: false }` option to each.

---

## 3. Routes refactor shape

### Current shape

`src/server/app-routes.ts:26-44` shows `buildApiRoutes(db: Database)` calling 15
route factory functions, each of which closes over `db` at build time:

```ts
export function buildApiRoutes(db: Database) {
  return {
    ...accountingRoutes(db),
    ...archiveRoutes(db),
    ...calendarEventRoutes(db),
    ...instructorRoutes(db),
    ...pricePlanRoutes(db),
    ...studentRoutes(db),
    ...vehicleRoutes(db),
    ...appointmentRequestRoutes(db),
    ...branchRoutes(db),
    ...campaignRoutes(db),
    ...chatRoutes(db),
    ...reviewRoutes(db),
    ...theoryGroupRoutes(db),
    ...schoolProfileRoutes(db),
    ...statisticsRoutes(db),
  };
}
```

The factories are defined across two files: `src/server/routes.ts` (7 factories:
`instructorRoutes`, `studentRoutes`, `pricePlanRoutes`, `vehicleRoutes`,
`calendarEventRoutes`, `archiveRoutes`, `accountingRoutes`) and 8 self-contained
modules (`appointmentRequestRoutes`, `branchRoutes`, `campaignRoutes`,
`chatRoutes`, `reviewRoutes`, `theoryGroupRoutes`, `schoolProfileRoutes`,
`statisticsRoutes`). Total: **15 factories across 9 files**.

The `db` parameter threads through consistently — every factory has the same
`(db: Database)` signature.

### Proposed mechanical transform

The smallest change that preserves the existing signature while adding per-request
resolution:

**Option A (recommended) — `getDb(req)` injected into each handler:**

```ts
// New type
type DbResolver = (req: Request) => Database;

// Transform each factory from:
export function studentRoutes(db: Database) { ... }
// to:
export function studentRoutes(getDb: DbResolver) { ... }
// Inside each handler, replace `db` with `getDb(req)`.
```

The transform is mechanical and uniform: every `db` reference inside a handler
body becomes `getDb(req)`. The `db` variable that existed at factory-call time is
removed. The handler already has `req` in scope (`src/server/routes.ts:84-113`
shows all handlers receive `req: BunRequest`).

`buildApiRoutes` becomes `buildApiRoutes(getDb: DbResolver)` and
`src/index.ts` passes `(req) => getDb(tenantSlug(req)!)` (with error handling
for unknown slugs).

**Blast radius:** 15 factory signatures change (9 files). Inside the handler
bodies, roughly one `db` reference per route endpoint — estimated 60-90
substitutions total across the codebase. No domain logic changes; no schema
changes. This is a safe find-and-replace refactor, suitable for a single commit.

**Option B — wrapper that resolves tenant before dispatching:**

Build routes once with a fake "dispatcher db" and add a middleware layer. This
does not fit Bun.serve's static route map — routes are matched at startup, not
per request. Option A is the correct approach for Bun.

**Auth guard integration:** once §4's auth is in place, the `getDb` resolver
also validates the session (reject requests where the subdomain does not match
the authenticated tenant), keeping security centralised.

---

## 4. Auth

### Minimum viable for Phase 1

Phase 1 ships the portal for school staff only (no student-facing login). One
shared school account per tenant ("the school logs in") is sufficient at launch.
Per-user accounts (multiple instructors with separate logins) are a Phase 2
concern.

**Session mechanism:** Bun.serve has no built-in session store. Two viable
options:

1. **Signed cookie (stateless JWT/HMAC):** the server signs `{ slug, iat, exp }`
   with a secret and sets it as a `HttpOnly; Secure; SameSite=Strict` cookie.
   Verification on every request is CPU-cheap (HMAC-SHA256). No server-side
   session storage. Works across horizontal restarts. Recommended for Phase 1.
2. **Server-side session table:** a row per session keyed by a random token in a
   central DB. Allows instant revocation. Adds the central DB as an operational
   dependency.

Option 1 is recommended: no extra infrastructure, compatible with Hetzner
single-box.

### User table location

**Per-tenant DB:** each school's DB holds its own users table (initially one row:
the school admin). This gives physical isolation — a DB export includes
credentials (hashed). Schools can change their password independently.

**Central registry DB:** a separate `registry.db` maps `slug → tenant` +
subscription status + the school's admin email. This is the single source of
truth for "does this subdomain exist and is it active?". It is **not** the same
as per-tenant auth; it is the provisioning/billing layer.

Recommended shape: `registry.db` holds `tenants(slug, status, email, plan,
created_at)`. Per-tenant DB holds `users(id, email, password_hash, role,
created_at)`. Login flow: (1) resolve slug → verify tenant active in registry,
(2) check password against per-tenant `users` table.

### Subscription gate

The registry check happens in the `getDb` resolver. If `tenants.status !=
'aktiv'` the server returns 402 / a "subscription expired" page before the
tenant DB is opened. No in-portal payment processing in Phase 1
(`plans/saas-plan.md:12-14`); status is set manually by the operator on signup
confirmation.

---

## 5. Public vs. authenticated surfaces

The appointment-request flow (plan 024, in flight) is the only public surface:
a prospective student submits name/phone/email/date without a login.

**Table of surfaces:**

| Route pattern | Auth required | Notes |
|---|---|---|
| `GET /anfrage` | No | Public appointment form |
| `POST /api/appointment-requests` | No | Accepts the form submission |
| `GET /api/appointment-requests` (list) | Yes | School staff only |
| `PATCH /api/appointment-requests/:id` | Yes | Accept / reject |
| All other `/api/*` | Yes | All current routes |
| `/*` (SPA) | Yes (redirect to login) | Except `/login`, `/anfrage` |

The `ensureAppointmentRequestTables` function already runs per-tenant
(`src/server/appointment-requests.ts:548`) so the public endpoint works with
the tenant-resolved DB.

Auth enforcement is a thin wrapper in the `getDb` resolver: check for a valid
session cookie; if absent and the path is not on the public allowlist, return
401/redirect. This keeps the route factories themselves auth-agnostic.

---

## 6. Files/uploads

### Current state

`src/lib/student-data.ts:17-25` defines:

```ts
export type UploadedStudentDocument = {
  kind: "upload";
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  dataUrl: string;   // ← base64-encoded file content, stored inline
};
```

Documents are stored as base64 data-URLs in the `students.documents` JSON column
(`src/server/db.ts:101`). This is the entire storage mechanism today.

### Size math

A typical driving-school PDF (Ausbildungsnachweis, Quittung, Führerscheinkopie):
200–600 KB per document. A student accumulates 5–20 documents over a course.
With 100 active students per school and 10 documents at 400 KB average:

- Per tenant: 100 × 10 × 400 KB ≈ 400 MB in the `students` column
- With 50 tenants: 20 GB of base64 in SQLite files

**Verdict:** base64-in-SQLite does not survive multi-tenant Phase 1. Problems:

1. SQLite's WAL journal checkpoints the full DB on writes; large blobs make
   every student update expensive.
2. Litestream replicates the entire WAL. At 400 MB of documents per tenant,
   backup traffic is dominated by binary data that changes slowly.
3. `GET /api/students` returns the full `documents` array per student, sending
   MB of base64 over the wire for a student list.
4. The Hetzner Object Storage (S3-compatible) is a first-class architecture
   element in `plans/saas-plan.md:27` — documents are its primary use case.

**Recommended Phase 1 plan:** move documents to Hetzner Object Storage before
launch. Keep the `UploadedStudentDocument` type but replace `dataUrl` with
`objectKey: string` pointing at `hetzner-bucket/<slug>/students/<id>/<doc-id>`.
The server generates pre-signed GET URLs on demand (short TTL, school-scoped).
The `dataUrl` field can be kept for backward compatibility in the type but
treated as empty on new uploads.

**Migration path for existing data:** a one-time export script reads the current
`students.documents` JSON, uploads each base64-decoded blob to object storage,
and writes the `objectKey` back. This runs as part of the data-migration service
(`plans/saas-plan.md:43-44`) when onboarding a school from the current desktop
app. No schema change needed on SQLite (the `documents` column stays JSON; the
payload shape changes from `{dataUrl}` to `{objectKey}`).

---

## 7. Backups/export

### Per-tenant export

A `GET /api/export/database` endpoint is in flight as plan 025. The endpoint
streams the tenant's `.db` file with `Content-Disposition: attachment`. Because
the DB is a single file (`data/tenants/<slug>.db`), "export all your data" is
literally handing the school the file — as designed in `plans/saas-plan.md:25`.

**Operational requirement:** the export endpoint must call
`db.exec("PRAGMA wal_checkpoint(FULL)")` before streaming the file to ensure
the WAL is merged back into the main DB file. Otherwise the export may miss
uncommitted WAL data.

### Litestream-style replication

Litestream watches the WAL for changes and streams pages to object storage in
near-real-time. For the multi-tenant layout it needs to be configured once per
tenant DB file (or Litestream v0.4+ supports directory-level replication that
automatically picks up new `.db` files in `data/tenants/`).

**Operational requirements for Phase 1:**

1. Hetzner Object Storage bucket per environment (prod/staging) with lifecycle
   rules to expire WAL segments older than 30 days.
2. Litestream config points at `data/tenants/*.db` (or each file individually
   until directory mode is confirmed stable).
3. A `restore` runbook: `litestream restore -o data/tenants/<slug>.db
   s3://bucket/tenants/<slug>/db` — tested before first customer.
4. The per-tenant export endpoint is a complement to Litestream, not a
   replacement. Schools get self-service exports; Litestream is the operator's
   disaster recovery.

**DSGVO / AVV note:** `plans/saas-plan.md:28-30` requires an AVV per school
(school = Verantwortlicher, we = Auftragsverarbeiter). Object storage buckets
must be on Hetzner's German data centres (already planned). The AVV template
must name the backup location explicitly.

---

## 8. What transfers untouched

The following modules work correctly on a per-tenant DB with no changes beyond
receiving `db` from the per-request resolver instead of startup closure:

| Module | Files | Notes |
|---|---|---|
| Booking engine | `src/server/engine.ts` | Pure functions over `db`; no global state |
| DATEV export | `src/server/datev.ts` | Reads `accounts`/`transactions`/`bookings` |
| SKR 04 migration | `src/server/db.ts:226-268` | Idempotent; runs on `openDb` |
| Price plans | `src/server/price-plans.ts` | CRUD over `price_plans` table |
| Students CRUD | `src/server/students.ts` | Needs upload migration (§6) but logic unchanged |
| Instructors CRUD | `src/server/instructors.ts` | No changes needed |
| Vehicles CRUD | `src/server/vehicles.ts` | No changes needed |
| Calendar events | `src/server/calendar-events.ts` | No changes needed |
| Archive / Papierkorb | `src/server/archive.ts` | No changes needed |
| Statistics | `src/server/statistics.ts` | Read-only aggregations; no global state |
| Campaigns | `src/server/campaigns.ts` | Self-contained; `ensureCampaignTables` at route mount |
| Chat | `src/server/chat.ts` | Self-contained; `ensureChatTables` at route mount |
| Reviews | `src/server/reviews.ts` | Self-contained; `ensureReviewTables` at route mount |
| Branches | `src/server/branches.ts` | Self-contained; `ensureBranchTables` at route mount |
| Appointment requests | `src/server/appointment-requests.ts` | Self-contained; also the public endpoint |
| Theory groups | `src/server/theory-groups.ts` | Needs seed removed; table creation transfers |
| School profile | `src/server/school-profile.ts` | Transfers; provisioning sets initial profile |
| GoBD sequences | `src/server/db.ts:738-762` | Per-tenant sequences start at 0 in production |
| Storno / immutability | `src/server/engine.ts:422-506` | Architectural constraint survives tenancy |
| repairSoftReferences | `src/server/db.ts:307-375` | Runs on every open; safe to keep |

This is the encouraging list: the entire domain is portable. The new work is
plumbing (tenant resolution, auth, provisioning, object storage, backups) —
not domain re-implementation.

---

## 9. Open questions for the maintainer

1. **What is the slug generation policy?** The SaaS plan says
   `schoolname.openfs.de` but does not specify how the slug is derived at
   signup. *Suggested default:* generate a slug from the school name
   (`fahrschule-guel` → `fahrschule-guel.openfs.de`), show it to the owner on
   signup, allow a one-time rename within 7 days. Reserve short slugs (≤3 chars)
   and known squats (www, api, admin, static, …).

2. **Where does the registry DB live?** Options: a dedicated `data/registry.db`
   on the same Hetzner box, or a Postgres instance. *Suggested default:* a
   second `bun:sqlite` file (`data/registry.db`) at Phase 1 — consistent with
   the SQLite-everywhere strategy and no new infrastructure. Migrate to Postgres
   if subscription automation (Stripe webhooks updating status) creates
   write-contention concerns.

3. **Should branches (`ensureBranchTables`, `src/server/branches.ts:46`) be
   stripped from Phase 1?** The current schema seeds two demo branches for the
   same school. In multi-tenant, "branches of a school" is a Phase 2 feature
   (multi-location schools). *Suggested default:* keep the module (it transfers
   unchanged), but disable the demo seed. A fresh tenant starts with one branch
   (the main location, populated from signup data).

4. **What does "provisioning" look like operationally for Phase 1?** The SaaS
   plan defers payment processing, which means signups are manually confirmed
   by the operator. *Suggested default:* a simple admin CLI script
   (`bun run provision --slug fahrschule-guel --name "Fahrschule Gül" ...`)
   that creates the tenant row in `registry.db` and calls `openTenantDb` to
   initialize the DB. No in-portal signup flow in Phase 1.

5. **How are per-tenant sequence numbers scoped?** Today `initSequences` starts
   beleg at 123, buchung at 218 to match the demo UI (`src/server/db.ts:727-729`).
   For real tenants, sequences start at 0. *Suggested default:* `openTenantDb`
   calls a new `initProductionSequences` that inserts `("beleg", 0)` and
   `("buchung", 0)` (with `INSERT OR IGNORE`). The demo path keeps the existing
   `initSequences`.

6. **Does the current `DEFAULT_COMPANY` profile
   (`src/server/db.ts:270-280` — hardcoded "Fahrschule Gül") need to be
   sanitised before any code path reaches a real tenant?** Yes. *Suggested
   default:* `openTenantDb` takes a `CompanyProfile` argument (name, address,
   email, phone from signup) and passes it to `initSettings` instead of
   `DEFAULT_COMPANY`. The existing `DEFAULT_COMPANY` stays for the demo/dev path.

7. **What session expiry and rotation policy?** *Suggested default:* 8-hour
   JWT/HMAC cookie, refreshed on activity (sliding window). Schools log in at
   the start of the working day and expect not to be kicked out mid-session.
   Force re-login after 24 hours of inactivity.

8. **Is the `dataUrl`-in-SQLite document storage a hard blocker for Phase 1 or
   a day-1 launch risk?** Object storage integration is non-trivial
   (upload endpoint, pre-signed URLs, migration script). *Suggested default:*
   treat it as a hard blocker for multi-tenant. A school with 80 active students
   and normal document volume will bloat their DB to several hundred MB within
   months. Ship object storage before opening to the first paying customer.

9. **Theory-group seed removal: is the existing `ensureTheoryGroupTables` seed
   safe to skip?** (`src/server/theory-groups.ts:156-162` seeds demo groups if
   count = 0). *Suggested default:* yes — add a `{ seed: boolean }` parameter to
   `ensureTheoryGroupTables` (or split it into `ensureTheoryGroupSchema(db)` +
   `seedTheoryGroups(db)`). The demo path calls both; the tenant path calls only
   schema.

10. **Litestream directory mode**: Litestream v0.4+ claims directory-level
    replication, but at the time of writing its stability for dynamic file sets
    is not confirmed. *Suggested default:* configure Litestream with an explicit
    entry per tenant DB file at Phase 1 scale (tens of tenants). Revisit when
    the school count exceeds 50. Write the provisioning script to also update
    the Litestream config and send `SIGHUP` to reload.

---

## 10. Phasing

Dependencies are listed in build order. Each phase must be fully done before the
next starts. Sizes are coarse (S = 1–2 days, M = 3–5 days, L = 1–2 weeks).

### Phase A: tenancy seam (prerequisite for everything) — M

1. `src/server/tenant-db.ts`: `openTenantDb(slug, profile)` — calls `openDb`
   variant with demo seeds stripped; `getDb(slug)` with Map cache.
2. `data/registry.db` minimal schema: `tenants(slug, status, email, created_at)`.
   Simple CRUD CLI.
3. `openTenantDb` distinguishes production sequences from demo sequences (Q9.5).
4. Provisioning CLI script: create tenant row + initialize DB.
5. `tenantSlug(req)` helper + `X-Tenant` dev fallback.

### Phase B: routes refactor — S

1. Change all 15 factory signatures from `(db: Database)` to
   `(getDb: DbResolver)` across 9 files
   (`src/server/routes.ts`, `app-routes.ts`, and the 8 self-contained modules).
2. Each handler body: replace the closed-over `db` with `getDb(req)`.
3. `src/index.ts`: pass `(req) => tenantGetDb(req)` to `buildApiRoutes`.
4. Run the existing test suite — `bun test` must pass (tests open their own DBs
   via `openDb(path)` directly, so they are unaffected by the signature change).

### Phase C: auth — M

1. Per-tenant `users` table (single row for Phase 1 school admin).
2. Login endpoint: validate slug active in registry → check password hash →
   issue HMAC-signed cookie.
3. Auth middleware in the `getDb` resolver: check cookie; reject non-public
   paths without a valid session.
4. `/login` route + minimal login form (within the existing React SPA).
5. Public allowlist for `/anfrage` and `POST /api/appointment-requests`.

### Phase D: provisioning hardening — S

1. Replace `DEFAULT_COMPANY` in `initSettings` with signup-supplied profile (Q9.6).
2. Object storage client integration (Hetzner S3-compatible): upload, pre-signed
   GET, deletion.
3. Migrate `students.documents` from `dataUrl` to `objectKey` in the document
   type and the student routes.
4. Provisioning script extended to set company profile and configure Litestream.

### Phase E: backups — S

1. Litestream config per tenant DB (one entry per `data/tenants/*.db`).
2. `GET /api/export/database` with WAL checkpoint before stream.
3. Restore runbook written and tested on a staging tenant.
4. Object storage bucket lifecycle rules (WAL segment expiry).

### Total Phase 1 estimate: M + S + M + S + S ≈ 3–4 weeks of focused work.

Phases A and B can be parallelised (A is infrastructure, B is mechanical
refactor) once the `DbResolver` type is agreed. C depends on A+B. D and E
depend on A; D's object storage work can start once A is done.
