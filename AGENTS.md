---
description: Agent instructions for OpenFS (Fahrschule management).
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: true
---

## Bun not Node

- `bun test` / `bun run <script>` / `bun install` / `bunx` — never npm/yarn/pnpm/npx.
- `bun:sqlite` not better-sqlite3; `Bun.serve()` not express; `Bun.file` not fs.readFile.
- `vite.config.ts` exists as a deliberate shadcn-CLI shim — do not delete it or run vite at runtime.
- The shadcn CLI is not a dependency (its transitive deps failed `bun audit`). Add components with `bunx shadcn@latest add <component>`; its base CSS is vendored in `src/styles/shadcn-tailwind.css`.

## What this is

OpenFS is a Fahrschule (driving school) management web app: student records, calendar, theory groups, and a GoBD-compliant accounting engine. The UI is German throughout.

## Commands

| Purpose    | Command             | Expected       |
|------------|---------------------|----------------|
| Test       | `bun test`          | 850+ pass, 0 fail |
| Browser smoke | `bun run test:e2e` | every route ✓ (needs Chromium: `bunx playwright install chromium`) |
| Typecheck  | `bun run typecheck` | exit 0         |
| Build      | `bun run build`     | exit 0         |
| Audit      | `bun audit`         | no vulnerabilities |

The test count grows over time — fewer tests than last documented is the red flag, not an exact-number mismatch.

## Architecture

See `README.md` for the full diagram. Short version:

- **Frontend**: React 19 SPA, HTML imports via `Bun.serve()`, shadcn/ui + Tailwind v4. Design rules: `design-guideline.md`.
- **Backend**: `src/server/` — route handlers call the accounting engine and SQLite helpers.
- **DB**: `bun:sqlite`; schema migrations in `src/server/db.ts`. Production DB: `data/fahrschule.db`. Tests use in-memory DBs — never touch the file.
- **Plans/advisor workflow**: `plans/`.

## Hard rules

### GoBD accounting engine
The accounting module enforces GoBD: immutable bookings, Storno-only corrections, gapless sequences, SKR 04 chart (migrated from SKR 03 via `migrateSkr03ToSkr04` in `src/server/db.ts`).

**The only permitted write paths are `createTransaction` and `stornoTransaction` in `src/server/engine.ts`.**
Never add UPDATE or DELETE on the `transactions` or `bookings` tables.

### Instructor / vehicle references
`students`, `calendar_events`, `theory_groups` and `instructors` link instructors and vehicles by id (`instructor_id` / `vehicle_id`, NULL = unassigned). Display names are derived on read (`src/server/refs.ts`), so renames need no cascade; deletes set the id to NULL and archive the links for restore. The API still accepts a display name as input and resolves it (vehicle labels are "Modell" or "Modell · Kennzeichen" when two vehicles share a model). `lesson_attestations.instructor` stays a name snapshot on purpose (compliance record).

### Auth
All `/api` routes are wrapped by `protectApiRoutes` (`src/server/auth.ts`): session required, role checked, writes audited. A new endpoint is protected automatically; making one public means adding it to `PUBLIC_ROUTES` deliberately. Route-level tests mount factories directly (unprotected); `src/server/auth.test.ts` covers the guard. The current user is available via `currentUser()` (`request-context.ts`).

### Tests
- All tests use in-memory SQLite: `openSqlite(":memory:")`.
- Test files are co-located as `*.test.ts` alongside the module they test.
- Never read from or write to `data/fahrschule.db` in tests.
- No DOM unit-test framework (by decision). UI coverage comes from `scripts/e2e-smoke.ts`: it boots the app in `DEMO_MODE` (in-memory DB), opens every route parsed from `src/router.tsx` in Chromium and fails on page/console errors or 5xx API responses. New pages are covered automatically; add tab labels to `CLICK_THROUGH` for tab-heavy pages. Keep pure UI logic in `src/lib/` with unit tests.

### UI
- All user-visible strings are German.
- Follow `design-guideline.md` for visual/interaction rules — do not duplicate its content here.

### Commits
Title-only, no body. Split into small chunks until each title is self-explanatory.
