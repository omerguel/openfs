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
bun dev                  # dev server with HMR at http://localhost:3000
bun test                 # run the test suite
bun run test:e2e         # browser smoke test over every route (needs Chromium)
bun run typecheck        # type-check without emitting
bun run build            # production renderer bundle → dist/
bun run start            # production server
```

`data/fahrschule.db` is created and seeded automatically on first start — no migration step needed.

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
| Fahrlehrer/in | Kalender (inkl. Absagen), Ausbildungsnachweise, Theorie-Anwesenheit, Chat; keine Finanzen (auch keine Statistik/Umsatz), keine Stammdaten |

The menu and a route guard follow the same split (`src/lib/navigation.ts`): pages a role may not use are not listed, and opening one by URL shows a „Kein Zugriff“ page instead of a half-loaded page.

Passwords are hashed with argon2id (`Bun.password`). Sessions are random tokens in an `HttpOnly; SameSite=Strict` cookie (`Secure` behind HTTPS); only their SHA-256 is stored, they slide for 7 days and end on sign-out, password change, role change or deactivation. State-changing requests from a foreign `Origin` are rejected, failed sign-ins are rate-limited per IP and e-mail (10 per 15 minutes; a successful sign-in resets the count), and every write (plus every sign-in attempt) lands in the audit log (*Benutzer → Protokoll*, shown as plain German with the raw request as detail). Unknown `/api/*` paths answer with a JSON 404. The rules live in `src/server/auth.ts`; new endpoints are protected automatically.

**Network.** The server listens on `127.0.0.1` by default (`HOST`/`PORT` to change). To use it from other devices, run it behind a TLS-terminating reverse proxy (Caddy, nginx) that forwards `X-Forwarded-Proto`; don't expose plain HTTP.

**Public surfaces** (no sign-in): `/einladung/:token` with `GET/POST /api/auth/invite/:token` (token-gated, one-time); `/anfrage` with `POST /api/appointment-requests` (rate-limited, length-capped) and `GET /api/school-profile`; the legal pages `/impressum` and `/datenschutz` (`/api/public/…`); and the Schülerportal at `/portal/:token` with its `/api/portal/:token…` endpoints. The portal is token-gated — each student gets a secret link (32 random bytes, revocable and rotatable from the student page, deleted with the student) that only ever exposes that student's own lessons, balance and chat thread — and rate-limited per IP; unknown and revoked tokens get the same generic 404. Treat portal links like passwords.

**Data.** A real school starts empty — including its public profile (no sample slogan, classes, brands or highlights); demo data only appears with `DEMO_MODE=1` (in-memory) or `SEED_DEMO=1`. `DB_PATH` overrides the database file (default `data/fahrschule.db`).

### Pages and navigation

The sidebar is grouped and collapsible (collapsed groups are remembered per browser): **Übersicht** (Dashboard, Kalender, Mein Tag for Fahrlehrer), **Schüler** (Fahrschüler, Schüler anmelden, Terminanfragen, Verträge, Archiv), **Ausbildung** (Theorie, Theoriegruppen, Prüfungsplaner), **Finanzen** (Rechnungen, Buchhaltung, Preise, Statistik), **Kommunikation** (Chat, Nachrichten, Bewertungen, Marketing) and **Verwaltung** (Fahrschule & Einstellungen, Fahrlehrer, Fahrzeuge, Benutzer, Datenimport, Datensicherung). Add a page by adding one entry to `NAV_GROUPS` in `src/lib/navigation.ts`.

*Fahrschule & Einstellungen* (`/fahrschule?tab=…`) holds all school settings in tabs — Stammdaten & Steuer, Bankverbindung, Öffentliches Profil, Öffnungszeiten, Standorte, Rechtliches, Terminabsagen. The old URLs `/profil` and `/schulprofil` redirect there, `/kalendar` redirects to `/kalender`.

### Multi-tenant mode (one portal per school)

Set `MULTI_TENANT=1` and `BASE_DOMAIN=openfs.de` to serve many schools from one process: each school lives at `<slug>.openfs.de` with its own SQLite file (`TENANTS_DIR`, default `data/tenants/<slug>.db`), listed in a registry (`REGISTRY_PATH`, default `data/registry.db`) with status `aktiv`/`gesperrt`. Uploaded files are stored under `<slug>/…` and backups under `BACKUP_DIR/<slug>/` (and `<prefix><slug>/` in S3). Sessions are per school — a login at one subdomain is worthless at another.

- The bare domain shows a landing page; with `PLATFORM_SIGNUP=1` schools can register themselves there (address, school name, Inhaber account, acceptance of AGB/AVV — templates in `docs/legal/`, have them reviewed).
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

Outside demo mode the server backs up the database with SQLite's `VACUUM INTO` (a consistent copy while the app keeps running), checks the copy with `PRAGMA integrity_check` and keeps it as `openfs-YYYY-MM-DD-HHMMSS.db`. It checks at startup and then hourly, and creates a backup whenever the newest one is older than the interval. When S3 is configured (see above), every backup is also uploaded to `<S3_PREFIX>backups/`. The page **Verwaltung → Datensicherung** (`/datensicherung`, Inhaber only) lists backups, creates one on demand and offers two downloads: the **Datenbank-Sicherung (.db)** (`/api/export/database`, the file to restore from) and a **Datenexport (ZIP)** (`/api/export/zip`) with CSVs of students, instructors, vehicles, Termine, invoices, bookings, accounts and price plans plus all uploaded documents — for reading, archiving or the tax advisor. Its restore steps name the real database file (`DB_PATH`) and document store.

| Variable | Meaning |
|----------|---------|
| `BACKUP_DIR` | Local backup directory (default `data/backups`) |
| `BACKUP_KEEP` | Number of most recent backups kept, locally and in S3 (default `14`) |
| `BACKUP_INTERVAL_HOURS` | Backup interval (default `24`) |

Backups contain the database only; uploaded documents live in the file store (`data/files` or S3) and need their own backup (S3 versioning, or copy `data/files`).

**Restore:**

1. Stop the server.
2. Move the current database file (`DB_PATH`, default `data/fahrschule.db`) and its `-wal` / `-shm` files aside.
3. Copy the backup (from `BACKUP_DIR`, S3 or the download on `/datensicherung`) to that same path.
4. Start the server.

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
