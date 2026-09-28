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
- **Communication:** e-mail through an outbox (confirmations, reminders, cancellations, free-text mails), a per-student Schülerportal at `/portal/:token` with a two-way chat, and a public appointment request form at `/anfrage`.
- **Onboarding:** CSV import of the student register from other software (column mapping, preview, all-or-nothing commit).

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

**Sign-in and roles.** Every `/api` endpoint requires a signed-in user unless it is explicitly public (see below). On first start a real school sees the setup wizard: school master data, optional opening balances of Kasse/Bank, and the first **Inhaber/in** account. Further accounts are created under *Benutzer & Protokoll* with one of three roles:

| Rolle | Darf |
|-------|------|
| Inhaber/in | alles, inkl. Benutzerverwaltung, Protokoll, Datensicherung, Datenbank-Export |
| Büro | alles außer Benutzerverwaltung, Protokoll, Datensicherung, Datenbank-Export |
| Fahrlehrer/in | Kalender (inkl. Absagen), Ausbildungsnachweise, Theorie-Anwesenheit, Chat; lesend alles außer Finanzen |

Passwords are hashed with argon2id (`Bun.password`). Sessions are random tokens in an `HttpOnly; SameSite=Strict` cookie (`Secure` behind HTTPS); only their SHA-256 is stored, they slide for 7 days and end on sign-out, password change, role change or deactivation. State-changing requests from a foreign `Origin` are rejected, sign-in is rate-limited per IP and e-mail, and every write (plus every sign-in attempt) lands in the audit log (*Benutzer & Protokoll → Protokoll*). The rules live in `src/server/auth.ts`; new endpoints are protected automatically.

**Network.** The server listens on `127.0.0.1` by default (`HOST`/`PORT` to change). To use it from other devices, run it behind a TLS-terminating reverse proxy (Caddy, nginx) that forwards `X-Forwarded-Proto`; don't expose plain HTTP.

**Public surfaces** (no sign-in): `/anfrage` with `POST /api/appointment-requests` (rate-limited, length-capped) and `GET /api/school-profile`; the legal pages `/impressum` and `/datenschutz` (`/api/public/…`); and the Schülerportal at `/portal/:token` with its `/api/portal/:token…` endpoints. The portal is token-gated — each student gets a secret link (32 random bytes, revocable and rotatable from the student page, deleted with the student) that only ever exposes that student's own lessons, balance and chat thread — and rate-limited per IP; unknown and revoked tokens get the same generic 404. Treat portal links like passwords.

**Data.** A real school starts empty; demo data only appears with `DEMO_MODE=1` (in-memory) or `SEED_DEMO=1`. `DB_PATH` overrides the database file (default `data/fahrschule.db`).

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

Outside demo mode the server backs up the database with SQLite's `VACUUM INTO` (a consistent copy while the app keeps running), checks the copy with `PRAGMA integrity_check` and keeps it as `openfs-YYYY-MM-DD-HHMMSS.db`. It checks at startup and then hourly, and creates a backup whenever the newest one is older than the interval. When S3 is configured (see above), every backup is also uploaded to `<S3_PREFIX>backups/`. The page **Verwaltung → Datensicherung** (`/datensicherung`) lists backups, creates one on demand and offers downloads plus the whole-database export.

| Variable | Meaning |
|----------|---------|
| `BACKUP_DIR` | Local backup directory (default `data/backups`) |
| `BACKUP_KEEP` | Number of most recent backups kept, locally and in S3 (default `14`) |
| `BACKUP_INTERVAL_HOURS` | Backup interval (default `24`) |

Backups contain the database only; uploaded documents live in the file store (`data/files` or S3) and need their own backup (S3 versioning, or copy `data/files`).

**Restore:**

1. Stop the server.
2. Move the current `data/fahrschule.db` and its `data/fahrschule.db-wal` / `-shm` files aside.
3. Copy the backup (from `data/backups`, S3 or the download on `/datensicherung`) to `data/fahrschule.db`.
4. Start the server.

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
src/lib/                  Shared utilities and data-shape definitions
src/hooks/               Resource queries and mutations; migrating onto TanStack Query
src/lib/query-client.ts  Shared TanStack Query client and cache policy
plans/                    Plans, incl. the SaaS decision record (saas-plan.md)
```
