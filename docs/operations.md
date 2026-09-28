# OpenFS — Operations runbook

For the person who runs an OpenFS server (Betreuer/in). Everything here was rehearsed; the restore part is re-run automatically in CI (`bun run drill`). Commands assume a Debian/Ubuntu server, the checkout in `/opt/openfs` and data in `/var/lib/openfs`.

Contents: [Overview](#overview) · [Install](#install) · [HTTPS](#https-reverse-proxy) · [Environment variables](#environment-variables) · [Backups](#backups) · [Off-site copies](#off-site-copies) · [Restore](#restore) · [Restore drill](#restore-drill) · [Updates and rollback](#updates-and-rollback) · [Monitoring](#monitoring) · [Logs](#logs) · [Rehearsal log](#rehearsal-log)

## Overview

```
Browser ──HTTPS──▶ Caddy / nginx (:443, TLS, HSTS)
                        │  X-Forwarded-Proto/-Host/-For
                        ▼
                  OpenFS (bun, 127.0.0.1:3000, TRUST_PROXY=1, user "openfs")
                        │
     /var/lib/openfs/fahrschule.db   SQLite database (WAL)
     /var/lib/openfs/files/          uploaded documents (or an S3 bucket)
     /var/lib/openfs/backups/        backup sets (database + documents + manifest)
```

Multi-tenant (`MULTI_TENANT=1`): one database per school in `tenants/<slug>.db`, the school list in `registry.db`, documents under `files/<slug>/`, backups under `backups/<slug>/`.

## Install

1. **Bun** (as root): `curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash` — or install it elsewhere and link `/usr/local/bin/bun`.
2. **User and code**:
   ```bash
   useradd --system --home-dir /var/lib/openfs --shell /usr/sbin/nologin openfs
   git clone <repo> /opt/openfs && cd /opt/openfs && git checkout <release-tag>
   bun install --frozen-lockfile        # dev dependencies too: the server bundles the UI at start
   ```
   The checkout stays owned by root; the service only needs to read it.
3. **Configuration**: `install -d -m 750 -g openfs /etc/openfs && install -m 640 -g openfs deploy/openfs.env.example /etc/openfs/openfs.env`, then edit it (see [Environment variables](#environment-variables)).
4. **Service**: `cp deploy/openfs.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now openfs`. The unit runs as `openfs`, restarts on failure, can only write `/var/lib/openfs` (`StateDirectory`, `ProtectSystem=strict`) and reads its settings from `/etc/openfs/openfs.env`.
5. **Check**: `curl -s http://127.0.0.1:3000/api/health` → `{"status":"ok","version":"…","commit":"…"}`.
6. **HTTPS**: set up Caddy (next section), open `https://<domain>/` and run the setup wizard (Stammdaten, Anfangsbestände, first Inhaber account).
7. **Command-line tools** (`scripts/tenant.ts`, `scripts/restore.ts`) must run as `openfs` with exactly the service's environment. This shell function does that (put it into root's `~/.bashrc`):
   ```bash
   openfs-cli() {
     systemd-run --quiet --pty --wait --collect --uid=openfs --gid=openfs \
       -p EnvironmentFile=/etc/openfs/openfs.env -p WorkingDirectory=/opt/openfs \
       -E NODE_ENV=production /usr/local/bin/bun "$@"
   }
   ```
8. **Multi-tenant**: set `MULTI_TENANT=1`, `BASE_DOMAIN`, then create schools with `openfs-cli scripts/tenant.ts create <slug> "<Name>" <email>` or allow `PLATFORM_SIGNUP=1`.

Docker instead of systemd: `docker compose -f deploy/compose.yaml up -d --build` (image from `deploy/Dockerfile`, data in the `openfs-data` volume, port published on the host's `127.0.0.1:3000` only — Caddy on the host in front).

## HTTPS (reverse proxy)

OpenFS never terminates TLS itself. It listens on `127.0.0.1` and a reverse proxy in front does HTTPS.

**Caddy (recommended)** — automatic Let's Encrypt certificates and renewal.

- One school: [`deploy/Caddyfile`](../deploy/Caddyfile) → `/etc/caddy/Caddyfile`, replace `fahrschule-muster.de`, `systemctl reload caddy`. DNS A/AAAA record to the server, ports 80 and 443 open.
- Multi-tenant: [`deploy/Caddyfile.multi-tenant`](../deploy/Caddyfile.multi-tenant) serves `openfs.de`, `www.openfs.de` and `*.openfs.de`. A wildcard certificate needs the ACME DNS challenge, so Caddy must be built with your DNS provider's plugin (e.g. `xcaddy build --with github.com/caddy-dns/hetzner`) and get an API token via its environment. DNS: `openfs.de` and `*.openfs.de` → server.

**nginx** — [`deploy/nginx.conf`](../deploy/nginx.conf) with certbot certificates (wildcard: certbot DNS plugin). Keep `proxy_set_header Host $http_host` (not `$host`): the Origin check compares host *and port*.

**`TRUST_PROXY=1`** (required behind a proxy, default off). Only then does OpenFS believe `X-Forwarded-Proto` (→ the session cookie gets `Secure`), `X-Forwarded-Host` (→ Origin check, school lookup in multi-tenant mode) and `X-Forwarded-For` (→ client IP for rate limits and the audit log; the last entry counts — the one your proxy wrote). Without it, behind TLS the cookie is sent without `Secure` and every client looks like `127.0.0.1`. Never set it while OpenFS is reachable directly from the network (`HOST=0.0.0.0` without a firewall): a client could then fake these headers.

**HSTS.** Both configs send `Strict-Transport-Security`. Roll it out carefully, because browsers remember it:

1. First deploy with `max-age=300` and check that every page works over HTTPS.
2. Raise to `max-age=31536000` (one year).
3. Add `includeSubDomains` only when *every* subdomain of that domain is HTTPS (true for the multi-tenant wildcard setup; for a school's own domain check e.g. `mail.` or old `www.` hosts first).
4. Do not add `preload` unless you are sure — removal from the preload list takes months.

## Environment variables

Set in `/etc/openfs/openfs.env` (systemd) or `deploy/openfs.env` (compose). Paths are relative to the working directory unless absolute.

| Variable | Default | Meaning |
|----------|---------|---------|
| `HOST` / `PORT` | `127.0.0.1` / `3000` | Listen address |
| `TRUST_PROXY` | off | `1` behind Caddy/nginx (see above) |
| `NODE_ENV` | — | `production` (set by the unit/image) |
| `TZ` | system | Process time zone — backup names, 09:00 reminder run; set `Europe/Berlin` |
| `SCHOOL_TIMEZONE` | `Europe/Berlin` | The school's wall clock for lessons |
| `DB_PATH` | `data/fahrschule.db` | Database (single school) |
| `FILE_STORE_DIR` | `data/files` | Uploaded documents (without S3) |
| `BACKUP_DIR` | `data/backups` | Backup sets |
| `BACKUP_KEEP` | `14` | Number of backup sets kept (locally and in S3) |
| `BACKUP_INTERVAL_HOURS` | `24` | Backup interval (checked hourly) |
| `BACKUP_FILES` | on | `0`: database-only backups (only for huge S3 stores protected by bucket versioning) |
| `S3_ENDPOINT` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` | — | S3 for documents and off-site backup copies |
| `S3_REGION` / `S3_PREFIX` | — | Optional; prefix e.g. `fahrschule-muster/` |
| `MULTI_TENANT` / `BASE_DOMAIN` | off | One portal per school at `<slug>.<BASE_DOMAIN>` |
| `TENANTS_DIR` / `REGISTRY_PATH` | `data/tenants` / `data/registry.db` | Multi-tenant databases |
| `PLATFORM_SIGNUP` | off | Self-service signup on the bare domain |
| `SMTP_*`, `SMS_*`, `GOOGLE_PLACES_API_KEY` | — | Mail, SMS, reviews — see README |
| `OPENFS_COMMIT` | from git | Commit shown by `/api/health` and written into backup manifests (set it for Docker images / tarballs) |
| `DEMO_MODE` / `SEED_DEMO` | off | Never in production |

## Backups

**What.** Every backup is a *set* — a directory `BACKUP_DIR/openfs-YYYY-MM-DD-HHMMSS/`:

| File | Content |
|------|---------|
| `database.db` | Consistent copy of the database (`VACUUM INTO`, taken while the server runs), checked with `PRAGMA integrity_check` |
| `files/<key>` | Every uploaded document the copy references (from disk or S3) |
| `manifest.json` | Time, app version + commit, school (multi-tenant), database size + SHA-256, every document with size + SHA-256, documents that were already missing |

Unchanged documents are **hard-linked** from the previous set instead of copied (like `rsync --link-dest`): every set is complete on its own, but a document that never changes uses disk space once. Documents are immutable (every upload gets a new key), so sharing them is safe. Across file systems a hard link is impossible — the file is copied instead. `du -sh BACKUP_DIR` shows the real usage.

**Where.** `BACKUP_DIR` (default `data/backups`; with the unit `/var/lib/openfs/backups`). Multi-tenant: `BACKUP_DIR/<slug>/`, each set only with that school's documents. With S3 configured, each set's `database.db` and `manifest.json` also go to `<S3_PREFIX>backups/<name>.db` / `.manifest.json` (multi-tenant: `…backups/<slug>/`).

**How often.** At startup and then hourly the server checks whether the newest set is older than `BACKUP_INTERVAL_HOURS` (24) and creates one. *Verwaltung → Datensicherung → Jetzt sichern* creates one on demand (e.g. before an update). Only one backup runs per school at a time.

**Retention.** The newest `BACKUP_KEEP` (14) sets are kept — locally with their documents, and in S3; older ones are deleted. Older single-file backups (`openfs-…db` from before sets existed) count towards the same limit.

**Check.** On the page: *Prüfen* per set (re-hashes everything). On the server: `openfs-cli scripts/restore.ts list` and `… verify <name>`.

**Download.** *Datensicherung → Archiv (.tar)* (Inhaber only) streams a set as one tar archive — database, documents and manifest; it opens with `tar -xf`, 7-Zip or the macOS/Windows archive tools and can be restored directly (see below). The other two downloads there are the database alone (`.db`) and the CSV/ZIP data export for humans.

**S3 document store.** When documents live in S3 (`S3_*` set), the backup job downloads them into each set (hard-linking unchanged ones, so after the first run only new uploads are fetched). Additionally protect the bucket itself:

- Enable **bucket versioning** (Hetzner Object Storage, AWS, MinIO support it): an accidentally deleted or overwritten object stays restorable as an older version.
- Add a **lifecycle rule** that expires *non-current* versions after e.g. 90 days, and one that deletes `…/backups/` objects older than `BACKUP_KEEP` days plus a margin as a safety net.
- Use credentials for OpenFS that cannot delete object versions or change bucket policy; ideally enable object lock (compliance mode) on a separate backup bucket.

**Multi-tenant registry.** The school list `registry.db` is not part of any school's set. It is small and changes rarely; copy it daily, e.g. with a cron job:

```bash
cd /opt/openfs && sudo -u openfs bun -e 'const {Database}=require("bun:sqlite"); new Database(process.argv[1]).run("VACUUM INTO ?", process.argv[2])' /var/lib/openfs/registry.db /var/lib/openfs/backups/registry-$(date +%F).db
```

If it is ever lost, re-add each school with `openfs-cli scripts/tenant.ts register <slug> "<Name>" <email>` — the school databases are untouched.

## Off-site copies

Backups on the same disk do not survive a lost server. At least one copy must live elsewhere:

- **With S3**: database + manifest go off-site automatically; documents are in the bucket (versioning, see above). Check the upload in the page's badge (*Lokal + Offsite*).
- **Without S3**: pull the backup directory to another machine daily; `-H` keeps the hard links, so the copy stays small:
  ```bash
  rsync -aH --delete backup@openfs-server:/var/lib/openfs/backups/ /srv/openfs-backups/
  ```
  or push it with restic/borg (both deduplicate). A NAS in the Fahrschule works too.
- **Manually**: the Inhaber downloads an *Archiv (.tar)* now and then and keeps it on an encrypted drive.

Backups contain personal data (DSGVO): encrypt off-site copies, restrict access, and apply the same deletion periods.

## Restore

`bun run restore` (= `bun scripts/restore.ts`) does it safely. It reads the same environment as the server, so run it as the service user with the service's environment — with the `openfs-cli` helper from [Install](#install), `openfs-cli scripts/restore.ts <command>`. (In a development checkout: `bun run restore <command>` with the right `DB_PATH` etc.)

### Step by step (one school)

1. **Stop the server**: `systemctl stop openfs`. (The script refuses while any process holds the database open or the server answers `http://127.0.0.1:$PORT/api/health`.)
2. **Pick a backup**: `openfs-cli scripts/restore.ts list`
   ```
   openfs-2026-09-28-031500   2026-09-28T01:15:00.000Z   18.2 MB  Datenbank + 214 Dokument(e)
   ```
3. **Check it**: `openfs-cli scripts/restore.ts verify openfs-2026-09-28-031500`
4. **Restore**: `openfs-cli scripts/restore.ts restore openfs-2026-09-28-031500`
   - verifies the set again (checksums of database and every document, `PRAGMA integrity_check`, completeness) — a damaged backup is never restored;
   - moves the current database (plus `-wal`/`-shm`) and the document directory aside as `…before-restore-<timestamp>` — nothing is deleted;
   - copies the database in, writes the documents to the store (disk or S3) and verifies each one;
   - on any error puts the moved-aside data back.
5. **Start**: `systemctl start openfs`, sign in, check a few students, invoices and a document.
6. When everything is fine, delete the `…before-restore-…` leftovers (they contain personal data).

Other sources instead of a name: a set directory (`/mnt/usb/openfs-…`), a downloaded **archive** (`…/openfs-2026-09-28-031500.tar` — useful when the server's backup directory is gone too), or an old single-file backup (`openfs-…db`; database only, documents untouched).

### One school in multi-tenant mode

```bash
systemctl stop openfs                      # all schools are offline for the few seconds of the restore
openfs-cli scripts/restore.ts list --tenant fs-mueller
openfs-cli scripts/restore.ts restore openfs-2026-09-28-031500 --tenant fs-mueller
systemctl start openfs
```

Only `tenants/fs-mueller.db` and `files/fs-mueller/` are replaced; other schools are not touched. A set made for another school is refused (the manifest names its school), even with `--force`. The school must be in `registry.db` (`openfs-cli scripts/tenant.ts register …` if the registry was lost).

### Options

| Option | Meaning |
|--------|---------|
| `--tenant <slug>` | Required in multi-tenant mode |
| `--check-url <url>` | Health URL to probe (default `http://127.0.0.1:$PORT/api/health`) |
| `--no-url-check` | Skip the probe (e.g. another OpenFS instance uses the port) |
| `--force` | Skip the "still running" checks and allow a single-school ↔ school mismatch. Never skips the verification. |

### Docker

```bash
docker compose -f deploy/compose.yaml stop openfs
docker compose -f deploy/compose.yaml run --rm openfs bun run restore list
docker compose -f deploy/compose.yaml run --rm openfs bun run restore restore <name>
docker compose -f deploy/compose.yaml start openfs
```

### Without the script (emergency)

1. Stop the server. 2. Move `DB_PATH` and its `-wal`/`-shm` files aside. 3. Copy `<set>/database.db` to `DB_PATH`. 4. Move the document directory aside and copy `<set>/files/` to `FILE_STORE_DIR` (multi-tenant: `FILE_STORE_DIR/<slug>/`). 5. `sha256sum` the files against `manifest.json` if in doubt. 6. `chown -R openfs:openfs /var/lib/openfs`, start.

## Restore drill

`bun run drill` rehearses a disaster end to end with real server processes (no demo mode) in a temporary directory, in about 10 seconds:

1. Starts OpenFS, runs the setup wizard and creates realistic data through the API: 3 users (Inhaber, Büro, Fahrlehrer), an instructor, 3 students, 6 uploaded documents (PDF, PNG), charges, cash and bank payments, 3 invoices and 3 lessons.
2. Takes a backup (`POST /api/admin/backups`) and downloads its archive.
3. Changes data after the backup (new student + document — must be gone after the restore).
4. Checks that `bun run restore` refuses while the server runs.
5. Stops the server, deletes database and documents, verifies and restores the backup, starts again and compares through the API: every user can sign in; students, invoices, journal (bookings), lessons and users equal the state at backup time; every document downloads byte-identical.
6. Deletes everything including the backup directory and restores from the downloaded archive alone; same checks.
7. Multi-tenant: two schools with data; backs up `fs-a`, changes both, deletes `fs-a`'s database and documents, checks that `fs-a`'s set is refused for `fs-b`, restores `--tenant fs-a` and verifies `fs-a` is back at the backup while `fs-b` still has its newer data and documents.

It runs in CI (`.github/workflows/ci.yml`). Pass `--keep` to inspect the scratch directory afterwards. Beyond the drill, **restore a real backup on a spare machine every quarter** and note the date — a backup that was never restored is a hope, not a backup.

## Updates and rollback

1. *Datensicherung → Jetzt sichern* (or `curl -X POST` as Inhaber) — a fresh set right before the update.
2. `cd /opt/openfs && git fetch && git checkout <new-tag> && bun install --frozen-lockfile`
3. `systemctl restart openfs && curl -s http://127.0.0.1:3000/api/health` — the version/commit must be the new one; watch `journalctl -u openfs -f` for errors.
4. Sign in and click through a few pages.

**Rollback.** Schema migrations run automatically at start and only go forward. If the new version misbehaves: `git checkout <previous-tag> && bun install --frozen-lockfile`, then restore the set from step 1 (`openfs-cli scripts/restore.ts restore …`) — the manifest records which version/commit wrote it — and restart. Data entered since the update is lost unless re-entered; the `…before-restore-…` copy keeps it for reference.

## Monitoring

- **Liveness**: `GET https://<domain>/api/health` → `200 {"status":"ok","version","commit","uptimeSeconds"}` without sign-in, on every host (also the multi-tenant bare domain). Point an uptime monitor (Uptime Kuma, Healthchecks, Better Stack…) at it every minute.
- **Backups**: alert when the newest set is older than `BACKUP_INTERVAL_HOURS` + 2 h, e.g. a daily cron:
  ```bash
  find /var/lib/openfs/backups -maxdepth 2 -name manifest.json -mmin -1560 | grep -q . || echo "OpenFS: keine aktuelle Sicherung" | mail -s "OpenFS Backup" admin@example.de
  ```
  and look for `Datensicherung fehlgeschlagen` / `Offsite-Sicherung … fehlgeschlagen` / `Dokument fehlt im Dateispeicher` in the log.
- **Disk**: `/var/lib/openfs` below 80 % (`df -h`); backups grow with the number of documents.
- **Certificates**: Caddy renews automatically; with certbot check `certbot renew --dry-run`.
- **Outbox**: undelivered mails show up under *Nachrichten* as „Fehlgeschlagen“.

## Logs

| What | Where |
|------|-------|
| OpenFS (start, backups, errors) | `journalctl -u openfs` (Docker: `docker compose logs openfs`) |
| HTTP access | Caddy: `/var/log/caddy/openfs-access.log`; nginx: `/var/log/nginx/openfs-access.log` |
| Who changed what | In the app: *Verwaltung → Benutzer → Protokoll* (audit log, with client IP behind `TRUST_PROXY=1`) |
| Mails/SMS | *Kommunikation → Nachrichten* |

## Rehearsal log

2026-09-28, commit of this document:

- **HTTPS with Caddy 2.10.2** (the shipped `deploy/Caddyfile` and `deploy/Caddyfile.multi-tenant`, only domain, ports, upstream port and TLS issuer swapped for Caddy's local CA): TLS 1.3 verified against the CA; HSTS, `nosniff` and `Referrer-Policy` headers present; HTTP → HTTPS redirect (308); setup and login set the cookie with `Secure`; the session works through the proxy; same-origin writes 201, foreign `Origin` 403; a client-sent `X-Forwarded-For: 6.6.6.6` is replaced by Caddy (audit log shows the real peer); a 3 MB document uploads and downloads byte-identical; the backup archive streams through the proxy and lists with `tar -tf`. Without `TRUST_PROXY` the same login yields a cookie without `Secure` (and a forged `X-Forwarded-Proto` sent directly to the app is ignored).
- **Multi-tenant through Caddy** (wildcard certificate `*.openfs.test`): platform info on the bare domain; self-service signup answers with `https://fs-a.openfs.test:8444/`; schools resolve per subdomain, an unknown one gives 404; `Secure` cookies per school; fs-a's session gives 401 at fs-b; a write to fs-a with fs-b's `Origin` gives 403.
- **nginx 1.24** with `deploy/nginx.conf` (self-signed certificate, IPv4 only in the sandbox): redirect, HSTS, `Secure` cookie, Origin check, audit IP and archive download pass. The rehearsal found that `$host` drops a non-default port and broke the Origin check — the config now uses `$http_host`.
- **systemd unit**: `systemd-analyze verify deploy/openfs.service` passes (not run under systemd in the sandbox).
- **Restore drill**: `bun run drill` — 25 checks pass (see [Restore drill](#restore-drill)). It found that invoices failed with a 500 in multi-tenant mode (per-school invoice schema missing) — fixed in `src/server/bootstrap.ts`.
