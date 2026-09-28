<p align="center">
  <span style="display: inline-block; background: #ffffff; padding: 12px 16px; border-radius: 12px;">
    <img src="logos/OpenFS%20LOGO%20%2B%20TEXT.svg" alt="OpenFS" width="180" />
  </span>
</p>

# OpenFS

Management software for German driving schools (Fahrschulen). It covers the full operational workflow: a week-based lesson calendar, student and instructor management, vehicle fleet tracking, configurable price plans, and a GoBD-shaped double-entry accounting engine (SKR 04, immutable bookings, Storno-only corrections, gapless receipt sequences) with Quittungen printing and DATEV CSV export. On top of that:

- **Billing & receivables:** lesson billing (per lesson or batch), exam billing (Vorstellungsentgelt + TÜV/DEKRA fee as durchlaufender Posten in one booking), § 14 UStG invoices with gapless numbers and Stornorechnungen, open items with FIFO payment matching, a three-level Mahnwesen, instalment plans (Ratenpläne) and SEPA direct debit (mandates, pain.008 export for the bank portal, booking and Rücklastschriften).
- **Scheduling:** recurring lessons, instructor absences, overlap checks for instructors and vehicles, lesson kinds with Sonderfahrten progress (class B minimums), cancellations and no-shows with an optional Ausfallentschädigung, and a working-time report with the 495-minute daily limit for practical instruction.
- **Training records:** exam results with a Prüfungsplaner, a digital Ausbildungsnachweis (signed per lesson, printable), theory attendance, statistics.
- **Communication:** e-mail and SMS through one outbox (confirmations, reminders, cancellations, free-text mails/SMS), a per-student Schülerportal at `/portal/:token` with a two-way chat, and a public appointment request form at `/anfrage`.
- **Marketing:** campaigns with a tracking link (`/anfrage?kampagne=<code>`, `utm_campaign` works too); leads and signups are counted from the requests (plus manual offline numbers), ad spend stays manual. Google reviews import via the Places API.
- **Onboarding:** CSV import of the student register from other software (column mapping, preview, all-or-nothing commit), optionally with each student's opening balance booked as Saldovortrag (9000 ↔ 3272).
- **Theory:** progress and status per student are derived from theory-group attendance (FahrSchAusbO: 12 Doppelstunden Grundstoff + class-specific units).

Currently a single-tenant Bun web app; being rebuilt as a multi-tenant SaaS (one portal per school at `schoolname.openfs.de`) — see `plans/saas-plan.md`.

## Stack

- **Runtime/server:** Bun.serve with bundler-mode HTML imports, bun test
- **Database:** SQLite (WAL) via `bun:sqlite` (`src/server/sqlite.ts`)
- **Frontend:** React 19 SPA, TanStack Router + Query, Tailwind CSS v4, shadcn/ui
- **Language:** TypeScript (strict mode)

## Getting started

```bash
bun install              # install dependencies
bun dev                  # dev server with HMR at http://localhost:3000 (NODE_ENV=development)
bun test                 # run the test suite
bun run test:e2e         # browser smoke test over every route (needs Chromium)
bun run typecheck        # type-check without emitting
bun run build            # production renderer bundle → dist/
bun run start            # production server
bun run drill            # restore drill: backup → disaster → restore, verified via the API
```

**Running it in production** (install, HTTPS with Caddy/nginx, systemd, backups, off-site copies, restore, updates, monitoring): see the runbook [`docs/operations.md`](docs/operations.md) and the files in [`deploy/`](deploy/).

`data/fahrschule.db` is created and seeded automatically on first start — no migration step needed.

Hot reloading, the browser-console echo and the Agentation toolbar are only active with `NODE_ENV=development` (what `bun dev` sets). Any other start — including a plain `bun src/index.ts` — is production mode: the UI is bundled once at startup and served with the security headers. The startup line says which mode runs.

### Demo mode

Set `DEMO_MODE=1` to run against an in-memory database instead of the file (sign in with `demo@openfs.de` / `openfs-demo`, shown on the sign-in page). The full
persistence layer still runs (same schema, migrations, seeds and read/write paths) — but
every start begins from the freshly seeded state and changes are discarded on restart
rather than written to disk. Use it for public demos where visitor edits should not stick:

```bash
DEMO_MODE=1 bun run start
```

## Security & deployment

**Sign-in and roles.** Every `/api` endpoint requires a signed-in user unless it is explicitly public (see below). On first start a real school sees the setup wizard: school master data, optional opening balances of Kasse/Bank, and the first **Inhaber/in** account. Further accounts are created under *Verwaltung → Benutzer* with one of three roles — preferably with an **Einladungslink** (one-time, 7 days, only its hash is stored; mailed via the outbox when SMTP is configured, otherwise copied by the Inhaber) with which the person sets their own password at `/einladung/:token`:

| Rolle | Darf |
|-------|------|
| Inhaber/in | alles, inkl. Benutzerverwaltung, Protokoll, Datensicherung, Exporte; als Einzige/r Steuernummer, USt-IdNr. und Bankverbindung ändern |
| Büro | alles außer Benutzerverwaltung, Protokoll, Datensicherung, Exporte; Steuer- und Bankdaten nur lesend |
| Fahrlehrer/in | Kalender, Mein Tag, Prüfungsplaner (Termine inkl. Serien, Prüfungsergebnis und Absage — eine Ausfallgebühr nur in der von der Fahrschule festgelegten Höhe, gebucht mit heutigem Datum), Ausbildungsnachweise, Fahrschüler lesen (Ausbildungsdaten, ohne Kontostand/Preise), Theoriegruppen lesen und Anwesenheit erfassen, Chat, Fahrlehrer/Fahrzeuge lesen, eigenes Passwort. Nicht: Finanzen (auch Statistik, Preispläne, Beträge von Ausfallgebühren), Postausgang/Nachrichten, Bewertungen, Terminanfragen, Verträge, Dokumente, Portal-Links, Standorte, Abwesenheiten verwalten, Stammdaten ändern; Steuer- und Bankdaten der Fahrschule werden nicht ausgeliefert |

The Fahrlehrer role works on an **explicit allow-list** (`FAHRLEHRER_ALLOWED` in `src/server/auth.ts`): every endpoint not listed there answers 403, so a new endpoint is closed to Fahrlehrer/innen until someone decides otherwise. `src/server/security.test.ts` holds the expected policy (public / all roles / office / owner) for every route and method and fails for a route without a decision.

*Deliberate decision:* Fahrlehrer/innen are **not** limited to "their own" students or Termine. Small schools cover for each other (sick days, holidays, exam drives), so every instructor can read all students' training data and work with every Termin. Money, documents and office tools stay closed regardless.

The menu and a route guard follow the same split (`src/lib/navigation.ts`): pages a role may not use are not listed, and opening one by URL shows a „Kein Zugriff“ page instead of a half-loaded page.

Passwords are hashed with argon2id (`Bun.password`); at most 4 hashes run at once and 64 wait, beyond that the server answers 503 instead of running out of memory. Sessions are random tokens in an `HttpOnly; SameSite=Strict` cookie (`Secure` behind HTTPS); only their SHA-256 is stored, they slide for 7 days, never live longer than 30 days, and end on sign-out, password change, role change or deactivation. A malformed cookie counts as signed out.

Every write (`POST`/`PUT`/`PATCH`/`DELETE`) — public ones such as sign-in, setup, invites, `/anfrage`, the portal chat and the platform signup included — must be JSON (`Content-Type: application/json`, else 415; document uploads are the only multipart endpoint) and is rejected when it carries a foreign `Origin` (requests without `Origin`, e.g. curl, pass). Bodies are capped at 16 MB (64 KB on public endpoints; 413, also for chunked uploads). Failed sign-ins are rate-limited per IP + e-mail (10 per 15 minutes) and per e-mail from any IP (20 per 15 minutes — a guessed account also waits for its owner); the e-mail is normalised (trimmed, lower-case) the same way for the lookup, the limit and the log. A successful sign-in resets both counts. Wrong current passwords in *Passwort ändern* are limited to 5 per 15 minutes. Every write (plus every sign-in attempt) lands in the audit log (*Benutzer → Protokoll*, shown as plain German with the raw request as detail). Unknown `/api/*` paths answer with a JSON 404. The rules live in `src/server/auth.ts` and `src/server/request-guards.ts`; new endpoints are protected automatically. First-run setup and invite acceptance are atomic (two racing requests cannot both succeed).

**Security headers** (`src/server/security-headers.ts`, set on the page, its assets and every API response): `Content-Security-Policy` (scripts only from the app itself; inline styles allowed for the UI libraries; no framing, no plugins), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (portal and invite URLs carry their token), a minimal `Permissions-Policy`, and `Cache-Control: no-store` on API responses. `HSTS=1` adds `Strict-Transport-Security` — set it only when the app is reachable exclusively via HTTPS (or let the reverse proxy send it).

**Access links are never stored in plain text.** Sessions, Einladungslinks and Schülerportal links are kept as SHA-256 only. A portal link is therefore shown once, right after *Neuen Link erzeugen* (copy it then); afterwards the student page only says since when a link is active, and creating a new one ends all older links. Mails that carry such a link (Einladung, Portal-Link) wait in the outbox with a placeholder — the token is created only when the mail is actually sent — so *Nachrichten* never shows a working link. Portal links stored by older versions are hashed in place on startup and keep working.

**Network.** The server listens on `127.0.0.1` by default (`HOST`/`PORT` to change). To use it from other devices, run it behind a TLS-terminating reverse proxy (Caddy, nginx — configs in `deploy/`) and set `TRUST_PROXY=1`: only then are `X-Forwarded-Proto` (→ `Secure` cookie), `X-Forwarded-Host` (→ Origin check, school lookup) and `X-Forwarded-For` (→ client IP for rate limits and the audit log; the last entry counts) believed. Without a proxy leave it off, and don't expose plain HTTP. `GET /api/health` (public) answers `200` with version and commit for uptime monitors. Details and HSTS rollout: [`docs/operations.md`](docs/operations.md#https-reverse-proxy).

**Public surfaces** (no sign-in): `/einladung/:token` with `GET/POST /api/auth/invite/:token` (token-gated, one-time); `/anfrage` with `POST /api/appointment-requests` (rate-limited, length-capped) and `GET /api/school-profile`; the legal pages `/impressum` and `/datenschutz` (`/api/public/…`); and the Schülerportal at `/portal/:token` with its `/api/portal/:token…` endpoints. The portal is token-gated — each student gets a secret link (32 random bytes, stored only as a hash, revocable and rotatable from the student page, deleted with the student) that only ever exposes that student's own lessons, balance and chat thread — and rate-limited per IP; unknown and revoked tokens get the same generic 404. Treat portal links like passwords.

**Data.** A real school starts empty — including its public profile (no sample slogan, classes, brands or highlights); demo data only appears with `DEMO_MODE=1` (in-memory) or `SEED_DEMO=1`. `DB_PATH` overrides the database file (default `data/fahrschule.db`).

### Pages and navigation

The sidebar is grouped and collapsible (collapsed groups are remembered per browser): **Übersicht** (Dashboard, Kalender, Mein Tag for Fahrlehrer), **Schüler** (Fahrschüler, Schüler anmelden, Terminanfragen, Verträge, Archiv), **Ausbildung** (Theorie, Theoriegruppen, Prüfungsplaner), **Finanzen** (Rechnungen, Buchhaltung, Preise, Statistik), **Kommunikation** (Chat, Nachrichten, Bewertungen, Marketing) and **Verwaltung** (Fahrschule & Einstellungen, Fahrlehrer, Fahrzeuge, Benutzer, Datenimport, Datensicherung). Add a page by adding one entry to `NAV_GROUPS` in `src/lib/navigation.ts`.

*Fahrschule & Einstellungen* (`/fahrschule?tab=…`) holds all school settings in tabs — Stammdaten & Steuer, Bankverbindung, Öffentliches Profil, Öffnungszeiten, Standorte, Rechtliches, Terminabsagen, Datenschutz. The old URLs `/profil` and `/schulprofil` redirect there, `/kalendar` redirects to `/kalender`.

**Datenschutz / Löschkonzept** (tab *Datenschutz*, Inhaber only): retention periods per category (enquiries, documents, chat, portal links, mail/SMS log, audit log, Ausbildungsnachweis, student master data, accounting), a daily per-school job that deletes or anonymises what is due — after the owner confirms the Löschvorschau (default) or automatically — „Aufbewahrung verlängern“ (legal hold), the last runs, and per student an Auskunft (Art. 15, printable + JSON) and Löschen auf Antrag (Art. 17). Bookings and invoices stay untouched until their 10-year period is over; only then are names pseudonymised (amounts and numbers stay). Details and legal basis: `docs/datenschutz/loeschkonzept.md`; legal templates (AGB, AVV, Art. 30, Art. 13): `docs/legal/`.

### Multi-tenant mode (one portal per school)

Set `MULTI_TENANT=1` and `BASE_DOMAIN=openfs.de` to serve many schools from one process: each school lives at `<slug>.openfs.de` with its own SQLite file (`TENANTS_DIR`, default `data/tenants/<slug>.db`), listed in a registry (`REGISTRY_PATH`, default `data/registry.db`) with status `aktiv`/`gesperrt`. Uploaded files are stored under `<slug>/…` and backups under `BACKUP_DIR/<slug>/` (and `<prefix><slug>/` in S3). Sessions are per school — a login at one subdomain is worthless at another.

- The bare domain shows a landing page; with `PLATFORM_SIGNUP=1` schools can register themselves there (address, school name, Inhaber account, acceptance of AGB/AVV — templates in `docs/legal/`, have them reviewed). Signups are limited to 5 per IP and 30 overall per hour; a failed signup removes its registry entry and database file again. **The e-mail address is not verified** (no confirmation link) — anyone can register a school with any address, so review new schools (`bun scripts/tenant.ts list`) and suspend unwanted ones.

- Operators manage schools with `bun scripts/tenant.ts list | create <slug> "<Name>" <email> ["<Inhaber>"] | suspend <slug> | activate <slug>`; `create` prints an initial password. Suspended schools get a "Zugang gesperrt" page (HTTP 402).
- DNS/TLS: a wildcard record `*.openfs.de` and a wildcard certificate on the reverse proxy, which must pass `Host` (or `X-Forwarded-Host`) and `X-Forwarded-Proto`.
- Local testing: `BASE_DOMAIN=localhost` and open `http://<slug>.localhost:3000/` (browsers resolve `*.localhost` to the loopback address).

### E-Mail (SMTP)

Mails (appointment confirmations/declines, lesson reminders the day before, portal links, free-text mails from **Nachrichten**) go through an outbox table and are delivered every minute by a built-in SMTP client. Configure it with environment variables:

| Variable | Meaning |
|----------|---------|
| `SMTP_HOST` | SMTP server host (required) |
| `SMTP_PORT` | Port — `465` implicit TLS, `587` STARTTLS (default) |
| `SMTP_USER` / `SMTP_PASS` | Login (AUTH PLAIN or LOGIN); leave empty for no auth |
| `SMTP_FROM` | Sender, e.g. `Fahrschule Muster <info@example.de>` (required) |
| `SMTP_SECURE` | Optional override: `tls`, `starttls`, or `none` (plaintext, local relays only) |

Without `SMTP_HOST`/`SMTP_FROM` nothing is sent: mails show up as "Nicht versendet" in Nachrichten and can be copied by hand. Demo mode never sends mail.

### Uploaded documents (file storage)

Files uploaded on a student's **Dokumente** tab (PDF, PNG, JPEG, WebP, HEIC; max 12 MB; the type is checked from the file content) are not stored in SQLite. The database keeps metadata in `student_files`; the bytes go to a file store:

| Variable | Meaning |
|----------|---------|
| `S3_ENDPOINT` | S3-compatible endpoint, e.g. `https://fsn1.your-objectstorage.com` (Hetzner Object Storage) |
| `S3_BUCKET` | Bucket name |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Credentials |
| `S3_REGION` | Optional region |
| `S3_PREFIX` | Optional key prefix, e.g. `fahrschule-muster/` — files go to `<prefix>files/…`, backups to `<prefix>backups/…` |
| `FILE_STORE_DIR` | Local directory when S3 is not configured (default `data/files`) |

With all four required `S3_*` variables set, files go to the bucket; otherwise they go to `data/files`. Demo mode keeps them in memory. Older versions stored uploads as base64 inside `students.documents`; on startup they are moved to the file store once (idempotent). Files of a deleted student stay until the student is removed from the Archiv for good.

### Datensicherung (backups)

Outside demo mode the server creates a **backup set** per interval: a directory `openfs-YYYY-MM-DD-HHMMSS/` with a consistent copy of the database (`VACUUM INTO`, checked with `PRAGMA integrity_check`), every uploaded document it references (from disk or S3) and a `manifest.json` (time, app version/commit, school, SHA-256 of the database and of every document). Unchanged documents are hard-linked from the previous set, so each set is complete but a document takes disk space once. It checks at startup and then hourly and creates a set whenever the newest one is older than the interval; the newest `BACKUP_KEEP` sets are kept, older ones are deleted with their documents. With S3 configured, each set's database and manifest are also uploaded to `<S3_PREFIX>backups/` (documents already live in the bucket — enable bucket versioning). In multi-tenant mode every school has its own sets under `BACKUP_DIR/<slug>/` with only its documents.

The page **Verwaltung → Datensicherung** (`/datensicherung`, Inhaber only) lists the sets with their contents („Datenbank + N Dokumente“), creates one on demand, re-checks one (*Prüfen*) and downloads a set as one **archive (.tar)** — database, documents and manifest. It also offers the bare **Datenbank-Sicherung (.db)** (`/api/export/database`) and the **Datenexport (ZIP)** (`/api/export/zip`) with CSVs plus all documents for reading, archiving or the tax advisor.

| Variable | Meaning |
|----------|---------|
| `BACKUP_DIR` | Local backup directory (default `data/backups`) |
| `BACKUP_KEEP` | Number of most recent sets kept, locally and in S3 (default `14`) |
| `BACKUP_INTERVAL_HOURS` | Backup interval (default `24`) |
| `BACKUP_FILES` | `0` = database-only sets (default: documents included) |

**Restore** with `bun run restore` (stop the server first):

```bash
bun run restore list                                  # sets in BACKUP_DIR
bun run restore verify openfs-2026-09-28-031500        # checksums + integrity_check
bun run restore restore openfs-2026-09-28-031500       # or a set directory, a downloaded .tar, an old .db
bun run restore restore <name> --tenant fs-mueller     # one school in multi-tenant mode
```

It verifies the set (a damaged backup is never restored), refuses while the server still has the database open or answers its health URL, moves the current database and documents aside as `…before-restore-<timestamp>` instead of deleting them, restores and re-verifies database and documents, and rolls back on any error. `bun run drill` rehearses the whole cycle against real server processes (also in CI). Step-by-step runbook, off-site copies and the manual fallback: [`docs/operations.md`](docs/operations.md#restore).

### SMS

SMS (free text from **Nachrichten**, optional reminders the day before — toggle "SMS-Erinnerungen", off by default) share the outbox, statuses and retries with e-mail. Numbers are normalised to E.164 (+49 when no country code is given); texts are cut to at most three segments.

| Variable | Meaning |
|----------|---------|
| `SMS_PROVIDER` | `seven` (seven.io) or `webhook` |
| `SMS_API_KEY` | seven.io API key (sent as `X-Api-Key`) |
| `SMS_FROM` | Sender ID, max. 11 alphanumeric characters (optional) |
| `SMS_WEBHOOK_URL` | For `webhook`: receives `POST` JSON `{ to, text, from }`, any 2xx counts as sent |

Without a provider SMS stay "Nicht versendet". Demo mode never sends SMS.

### Google reviews

`GOOGLE_PLACES_API_KEY` (Places API (New) enabled) plus the Google Place ID in **Schulprofil** enable "Google importieren" on **Bewertungen**: the overall rating, the rating count and at most five reviews (Google's selection) are imported and de-duplicated by the review id. Replies stay internal — answering on Google needs the Business Profile API (OAuth and Google's approval).

### Rechnungen & Buchhaltung — rules worth knowing

- **Anzahlungen on the Endrechnung (§ 14 Abs. 5 UStG).** Every payment is booked to 3272 "Erhaltene Anzahlungen 19 %", because at receipt nobody knows what it will pay for; when a charge consumes the Guthaben, the tax follows the charge's own account. An invoice therefore deducts the prepayment with the tax of the positions it actually settled: payments settle charges oldest-first (FIFO, as for the payment status), within a multi-position charge proportionally to the gross amounts, and the deducted VAT per rate is capped at the invoiced VAT of that rate. A prepaid TÜV fee is a durchlaufender Posten, not a 19 % Anzahlung. The split is frozen with the invoice (`invoices.prepaid_vat`); older invoices fall back to a proportional split. *Steuerberater: please confirm this allocation (FIFO across charges, proportional within one charge).*
- **Opening debts** (Saldovortrag "offener Betrag", 3272 an 9000) are open items: settled first by payments (FIFO), listed under Offene Posten and dunnable in three levels (`saldovortrag_reminders`), but never put on an invoice.
- **Paying off an opening debt carries no Anzahlungs-USt.** The services behind a Saldovortrag "offener Betrag" were rendered and taxed in the previous software, and no later charge on 3272 releases that tax again — booking the payment as a normal 19 % Anzahlung would tax them twice. So a Zahlung auf Ausbildungskonto is split (`src/server/engine.ts`, `unsettledOpeningDebt` in `src/server/open-items.ts`): the part up to the still-open debt is booked Geldkonto an 3272 **without VAT** ("Ausgleich Saldovortrag"), only the rest as a 19 % Anzahlung. The open debt is the FIFO remainder the Offene Posten show (payments settle the debt first, as it is the oldest item), capped at the debt minus settlement lines already booked; a Storno of the payment reverses both lines and reopens the debt. In the DATEV export every line on an Automatikkonto without VAT whose other account does not carry the tax itself (Saldovortrag, Ausgleich Saldovortrag) gets BU 40 with the Automatikkonto as Gegenkonto; the USt overview leaves these lines out of the Anzahlungen. Payments booked before this rule keep their 19 % (immutable bookings) but still count as having settled the debt. *Steuerberater: please confirm the VAT-free settlement and BU 40 on Geldkonto an 3272, and whether earlier payments that settled an opening debt with 19 % need a correction.*
- **Ratenpläne** count payments automatically: a rate is covered by its linked payment plus every other payment on the Ausbildungskonto made after the plan started (not after it ended), oldest rate first. Lastschriften collected for an invoice do not count towards a plan.
- **Documents:** Rechnungen, Stornorechnungen and Mahnungen are real PDFs rendered server-side without dependencies (`src/server/pdf.ts`, `/api/invoices/:id/pdf`) and can be sent through the outbox with the PDF attached. Issued documents are frozen; corrections via Storno + new invoice.
- **Guard rails (confirmable, not blocking):** invoice dates before the last invoice, dates in a past month or in the future, and cash bookings that would push the Kasse below zero.
- **Reports** (`src/server/accounting-reports.ts`): current Kasse/Bank balances, Kassen-/Bankbuch with running balance, CSV exports of Kassenbuch and Buchungsjournal, and an Umsatzsteuer overview per month/quarter (Vorbereitung der Voranmeldung, keine Abgabe — derived like DATEV derives it from the Automatikkonten).

## Architecture

```
src/index.ts              Bun.serve entry point; serves the SPA and mounts /api/*
src/router.tsx            Typed TanStack route tree and route-level data preloading
src/server/app-routes.ts  All API route factories merged into one routes object
src/server/sqlite.ts      SQLite layer (bun:sqlite); single seam for opening databases
src/server/routes.ts      HTTP route definitions, delegates to domain modules
src/server/              Domain modules: students.ts, vehicles.ts, instructors.ts,
                          price-plans.ts, engine.ts (accounting), datev.ts, etc.
src/server/db.ts          Schema, migrations, and GoBD constraints (immutable bookings,
                          Storno-only corrections, gapless number sequences)
src/*.tsx                 React page components (calendar, students, vehicles, …)
src/lib/navigation.ts     The menu (grouped), page access per role, used by sidebar,
                          route guard and global search (Strg/⌘ + K)
src/lib/                  Shared utilities and data-shape definitions
src/hooks/               Resource queries and mutations; migrating onto TanStack Query
src/lib/query-client.ts  Shared TanStack Query client and cache policy
plans/                    Plans, incl. the SaaS decision record (saas-plan.md)
```
