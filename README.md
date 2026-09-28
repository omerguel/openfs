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

Set `DEMO_MODE=1` to run against an in-memory database instead of the file. The full
persistence layer still runs (same schema, migrations, seeds and read/write paths) — but
every start begins from the freshly seeded state and changes are discarded on restart
rather than written to disk. Use it for public demos where visitor edits should not stick:

```bash
DEMO_MODE=1 bun run start
```

## Security & deployment

This application currently has **no authentication**. It is designed for single-user local use on a trusted machine. The database holds personal data (student names, addresses, phone numbers) and financial records. Do not expose the server to a network or the internet without first adding an authentication layer; doing so would give anyone with network access full read and write access to all data. (Multi-tenant auth is part of the SaaS plan.) There are two deliberate public surfaces: `/anfrage` and its POST endpoint (rate-limited per IP and length-capped), and the Schülerportal at `/portal/:token` with its `/api/portal/:token…` endpoints. The portal is token-gated — each student gets a secret link (32 random bytes, revocable and rotatable from the student page, deleted with the student) that only ever exposes that student's own lessons, balance and chat thread — and rate-limited per IP; unknown and revoked tokens get the same generic 404. Treat portal links like passwords. Everything else keeps this no-auth local posture.

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
