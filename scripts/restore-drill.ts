/* ------------------------------------------------------------------ */
/* Restore drill — rehearses disaster recovery end to end against real */
/* server processes (no demo mode) in a scratch directory:             */
/*                                                                     */
/*  Single school                                                      */
/*   1. start the server, run the setup wizard, create users, an       */
/*      instructor, students, uploads, charges, payments, an invoice   */
/*      and calendar lessons through the API; record the state;        */
/*   2. take a backup (POST /api/admin/backups) and download its .tar; */
/*   3. change data after the backup (must be gone after the restore); */
/*   4. `bun run restore` must refuse while the server is running;     */
/*   5. stop, delete database + documents, restore, start again and    */
/*      compare: logins, students, invoices, bookings, lessons, and    */
/*      every document download byte for byte;                         */
/*   6. again from the downloaded .tar alone (backup dir lost too).    */
/*                                                                     */
/*  Multi-tenant                                                       */
/*   7. two schools; back up fs-a, change both, lose fs-a, restore     */
/*      only fs-a: fs-a is back at the backup, fs-b keeps its newer    */
/*      data untouched; restoring fs-a's backup into fs-b is refused.  */
/*                                                                     */
/*   bun run drill            (add --keep to keep the scratch dir)     */
/* ------------------------------------------------------------------ */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { saveStream } from "../src/server/tar";

const REPO = resolve(import.meta.dir, "..");
const keep = process.argv.includes("--keep");
const root = await mkdtemp(join(tmpdir(), "openfs-drill-"));
const started = Date.now();
const results: string[] = [];

function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`✗ ${label}`);
  results.push(`✓ ${label}`);
  console.log(`  ✓ ${label}`);
}

function equal(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    console.error(`  erwartet: ${b.slice(0, 2000)}\n  erhalten: ${a.slice(0, 2000)}`);
  }
  check(a === b, label);
}

const sha256 = (bytes: Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/* ------------------------------------------------------------------ */
/* Server processes                                                     */
/* ------------------------------------------------------------------ */

type Env = Record<string, string>;

/* Only what the drill sets — never the operator's own DB/S3 settings. */
function cleanEnv(extra: Env): Env {
  const env: Env = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "TZ"]) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return { ...env, NODE_ENV: "production", HOST: "127.0.0.1", ...extra };
}

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port!;
  probe.stop(true);
  return port;
}

type Server = { proc: ReturnType<typeof Bun.spawn>; port: number; base: string };

let serverRuns = 0;
let lastLog = "";

async function startServer(env: Env): Promise<Server> {
  const port = Number(env.PORT);
  lastLog = join(root, `server-${++serverRuns}.log`);
  const proc = Bun.spawn(["sh", "-c", 'exec bun src/index.ts >"$DRILL_LOG" 2>&1'], {
    cwd: REPO,
    env: { ...env, DRILL_LOG: lastLog },
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 300; i++) {
    const ok = await fetch(`${base}/api/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return { proc, port, base };
    if (proc.exitCode !== null) break;
    await Bun.sleep(100);
  }
  proc.kill();
  throw new Error(`Server startet nicht:\n${await Bun.file(lastLog).text()}`);
}

async function stopServer(server: Server) {
  server.proc.kill("SIGTERM");
  await server.proc.exited;
}

async function runRestore(env: Env, args: string[]) {
  const proc = Bun.spawn(["bun", "scripts/restore.ts", ...args], {
    cwd: REPO,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, errText, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, output: `${out}${errText}` };
}

/* ------------------------------------------------------------------ */
/* API client (one cookie per school)                                   */
/* ------------------------------------------------------------------ */

class Client {
  cookie = "";
  constructor(
    readonly base: string,
    readonly host?: string,
  ) {}

  async send(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.host) headers.Host = this.host;
    if (this.cookie) headers.Cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${this.base}${path}`, { method, headers, body: payload });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie?.startsWith("openfs_session=")) this.cookie = setCookie.split(";")[0]!;
    return res;
  }

  async json<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.send(method, path, body);
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  async login(email: string, password: string): Promise<boolean> {
    this.cookie = "";
    const res = await this.send("POST", "/api/auth/login", { email, password });
    return res.ok && this.cookie !== "";
  }
}

/* ------------------------------------------------------------------ */
/* Realistic data                                                       */
/* ------------------------------------------------------------------ */

const PASSWORD = "drill-passwort-2026";

type Upload = { studentId: number; name: string; bytes: Uint8Array };
type School = {
  users: { email: string; password: string }[];
  uploads: Upload[];
};

function pdfBytes(label: string, size: number): Uint8Array {
  const head = new TextEncoder().encode(`%PDF-1.4\n% ${label}\n`);
  const bytes = new Uint8Array(size);
  bytes.set(head);
  for (let i = head.length; i < size - 6; i++) bytes[i] = (i * 7 + label.length) & 0xff;
  bytes.set(new TextEncoder().encode("\n%%EOF"), size - 6);
  return bytes;
}

function pngBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let i = 8; i < size; i++) bytes[i] = (i * 13) & 0xff;
  return bytes;
}

async function upload(
  client: Client,
  studentId: number,
  name: string,
  bytes: Uint8Array,
) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name));
  form.append("docType", "Sehtest");
  await client.json("POST", `/api/students/${studentId}/files`, form);
  return { studentId, name, bytes };
}

let studentNo = 1000;

async function createStudent(client: Client, first: string, last: string) {
  studentNo += 1;
  return client.json<{
    id: number;
    customerNumber: string;
    firstName: string;
    lastName: string;
    address: string;
    contractNumber: string;
    classes: string;
  }>("POST", "/api/students", {
    firstName: first,
    lastName: last,
    classes: "B",
    address: "Hauptstraße 1, 64283 Darmstadt",
    phone: "06151 123456",
    email: `${last.toLowerCase()}@example.de`,
    customerNumber: `K-${studentNo}`,
    contractNumber: `V-${studentNo}`,
  });
}

/** Fills a freshly set-up school (Inhaber signed in) with data. */
async function seedSchool(
  client: Client,
  owner: { email: string; password: string },
  tag: string,
): Promise<School> {
  const users = [owner];
  for (const [role, name] of [
    ["buero", "Berta Büro"],
    ["fahrlehrer", "Frank Fahrlehrer"],
  ] as const) {
    const email = `${role}-${tag}@drill.test`;
    await client.json("POST", "/api/users", { email, name, password: PASSWORD, role });
    users.push({ email, password: PASSWORD });
  }
  const instructor = await client.json<{ firstName: string; lastName: string }>(
    "POST",
    "/api/instructors",
    { firstName: "Frank", lastName: `Fahrlehrer-${tag}`, classes: "B" },
  );
  const instructorName = `${instructor.firstName} ${instructor.lastName}`;

  const uploads: Upload[] = [];
  const students = [];
  for (const [i, [first, last]] of [
    ["Anna", "Albers"],
    ["Ben", "Brandt"],
    ["Clara", "Cakir"],
  ].entries()) {
    const student = await createStudent(client, first!, `${last}-${tag}`);
    students.push(student);
    uploads.push(
      await upload(
        client,
        student.id,
        `sehtest-${i}.pdf`,
        pdfBytes(`${tag}-${i}`, 40_000 + i * 1000),
      ),
    );
    uploads.push(
      await upload(client, student.id, `passbild-${i}.png`, pngBytes(9_000 + i)),
    );

    const ref = {
      customerNo: student.customerNumber,
      name: `${student.firstName} ${student.lastName}`,
      address: student.address,
      contractNo: student.contractNumber,
      classes: student.classes,
    };
    const charge = await client.json<{ id: number }>(
      "POST",
      "/api/accounting/transactions",
      {
        type: "guthaben_uebertragung",
        date: "2026-03-02",
        amountCents: 6500 * (i + 1),
        habenKonto: "4400",
        student: ref,
        description: `${i + 1} Fahrstunde(n)`,
      },
    );
    await client.json("POST", "/api/accounting/transactions", {
      type: "zahlung_guthaben",
      date: "2026-03-05",
      amountCents: 5000,
      geldkonto: i === 0 ? "1600" : "1800",
      paymentMethod: i === 0 ? "bar" : "ueberweisung",
      student: ref,
    });
    await client.json("POST", "/api/invoices", {
      studentId: student.id,
      date: "2026-03-10",
      transactionIds: [charge.id],
    });
    await client.json("POST", "/api/calendar-events", {
      date: `2026-10-0${i + 1}`,
      start: "09:00",
      end: "10:30",
      title: "Fahrstunde",
      type: "Praktisch",
      instructor: instructorName,
      studentId: student.id,
      student: `${student.firstName} ${student.lastName}`,
    });
  }
  return { users, uploads };
}

/* The state a restore must bring back, read through the API. */
async function snapshot(client: Client) {
  const students = await client.json("GET", "/api/students");
  const list = (Array.isArray(students) ? students : students.students) as {
    id: number;
    firstName: string;
    lastName: string;
    customerNumber: string;
  }[];
  const files: Record<string, string[]> = {};
  for (const student of list) {
    const { files: rows } = await client.json<{
      files: { id: number; name: string; sha256: string }[];
    }>("GET", `/api/students/${student.id}/files`);
    files[student.id] = [];
    for (const row of rows) {
      const res = await client.send("GET", `/api/files/${row.id}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      files[student.id]!.push(`${row.name}:${sha256(bytes)}:${bytes.length}`);
    }
  }
  const { invoices } = await client.json<{
    invoices: {
      id: number;
      invoiceNr: string;
      date: string;
      lines: unknown[];
      totalCents: number;
      prepaidCents: number;
      openCents: number;
      status: string;
    }[];
  }>("GET", "/api/invoices");
  const { rows: journal } = await client.json<{ rows: unknown[] }>(
    "GET",
    "/api/accounting/journal",
  );
  const { events } = await client.json<{ events: unknown[] }>(
    "GET",
    "/api/calendar-events?from=2026-01-01&to=2027-12-31",
  );
  const users = (
    (await client.json("GET", "/api/users")).users as {
      email: string;
      role: string;
      active: boolean;
    }[]
  ).map((u) => `${u.email}:${u.role}:${u.active}`);
  return {
    students: list.map((s) => `${s.id}:${s.firstName} ${s.lastName}:${s.customerNumber}`),
    files,
    invoices: invoices.map((inv) => ({
      id: inv.id,
      invoiceNr: inv.invoiceNr,
      date: inv.date,
      lines: inv.lines,
      totalCents: inv.totalCents,
      prepaidCents: inv.prepaidCents,
      openCents: inv.openCents,
      status: inv.status,
    })),
    journal,
    events,
    users,
  };
}

/** Every uploaded document downloads byte for byte as uploaded. */
async function checkUploads(client: Client, school: School, label: string) {
  let bytes = 0;
  for (const up of school.uploads) {
    const { files } = await client.json<{ files: { id: number; name: string }[] }>(
      "GET",
      `/api/students/${up.studentId}/files`,
    );
    const row = files.find((f) => f.name === up.name);
    if (!row) throw new Error(`✗ ${label}: ${up.name} fehlt`);
    const res = await client.send("GET", `/api/files/${row.id}`);
    const got = new Uint8Array(await res.arrayBuffer());
    if (res.status !== 200 || sha256(got) !== sha256(up.bytes)) {
      throw new Error(`✗ ${label}: ${up.name} weicht ab`);
    }
    bytes += got.length;
  }
  check(
    true,
    `${label}: ${school.uploads.length} Dokumente byte-identisch (${(bytes / 1024).toFixed(0)} KB)`,
  );
}

async function checkLogins(base: string, school: School, label: string, host?: string) {
  for (const user of school.users) {
    const c = new Client(base, host);
    if (!(await c.login(user.email, user.password)))
      throw new Error(`✗ ${label}: Anmeldung ${user.email}`);
  }
  check(true, `${label}: alle ${school.users.length} Benutzer können sich anmelden`);
}

/* ------------------------------------------------------------------ */
/* Single school                                                        */
/* ------------------------------------------------------------------ */

async function singleSchoolDrill() {
  console.log("\nEinzelbetrieb");
  const dir = join(root, "single");
  const port = await freePort();
  const env = cleanEnv({
    PORT: String(port),
    DB_PATH: join(dir, "data", "fahrschule.db"),
    FILE_STORE_DIR: join(dir, "data", "files"),
    BACKUP_DIR: join(dir, "backups"),
  });

  let server = await startServer(env);
  const owner = { email: "inhaber@drill.test", password: PASSWORD };
  const client = new Client(server.base);
  await client.json("POST", "/api/auth/setup", {
    ...owner,
    name: "Ines Inhaber",
    schoolName: "Fahrschule Drill",
    address: "Rheinstraße 1, 64283 Darmstadt",
    openingDate: "2026-01-01",
    kasseCents: 20_000,
    bankCents: 1_000_000,
  });
  const school = await seedSchool(client, owner, "s");
  const before = await snapshot(client);
  check(
    before.students.length === 3 &&
      before.invoices.every((inv) => inv.invoiceNr && inv.totalCents > 0) &&
      before.invoices.length === 3 &&
      before.journal.length > 0 &&
      before.events.length === 3 &&
      before.users.length === 3,
    "Testdaten über die API angelegt (3 Schüler, 3 Rechnungen, 6 Dokumente, 3 Termine)",
  );

  const backup = await client.json<{ name: string; fileCount: number }>(
    "POST",
    "/api/admin/backups",
  );
  check(
    backup.fileCount === 6,
    `Sicherung ${backup.name}: Datenbank + ${backup.fileCount} Dokumente`,
  );
  const archive = join(dir, "download", `${backup.name}.tar`);
  const res = await client.send("GET", `/api/admin/backups/${backup.name}`);
  check(
    res.ok && res.headers.get("content-type") === "application/x-tar",
    "Sicherungsarchiv (.tar) heruntergeladen",
  );
  await saveStream(res.body!, archive);

  // Changes after the backup: must be gone after the restore.
  const late = await createStudent(client, "Nach", "Sicherung");
  await upload(client, late.id, "spaet.pdf", pdfBytes("spaet", 5000));

  const refused = await runRestore(env, ["restore", backup.name]);
  check(
    refused.code !== 0 && /noch geöffnet|antwortet noch/.test(refused.output),
    "Restore verweigert, solange der Server läuft",
  );

  await stopServer(server);
  // Disaster: database and documents are gone.
  await rm(join(dir, "data"), { recursive: true, force: true });
  check(
    !(await Bun.file(env.DB_PATH!).exists()),
    "Katastrophe simuliert: Datenbank und Dokumente gelöscht",
  );

  const verified = await runRestore(env, ["verify", backup.name]);
  check(verified.code === 0, "bun run restore verify: Prüfsummen und integrity_check ok");
  const restored = await runRestore(env, ["restore", backup.name]);
  if (restored.code !== 0) console.error(restored.output);
  check(restored.code === 0, "bun run restore restore aus BACKUP_DIR");

  server = await startServer(env);
  await checkLogins(server.base, school, "nach Restore");
  const client2 = new Client(server.base);
  await client2.login(owner.email, owner.password);
  equal(
    await snapshot(client2),
    before,
    "Schüler, Rechnungen, Buchungen, Termine, Benutzer wie zum Sicherungszeitpunkt",
  );
  await checkUploads(client2, school, "nach Restore");
  await stopServer(server);

  // Worst case: the server's backup directory is lost as well — only the
  // downloaded archive is left.
  await rm(join(dir, "data"), { recursive: true, force: true });
  await rm(join(dir, "backups"), { recursive: true, force: true });
  const fromArchive = await runRestore(env, ["restore", archive]);
  if (fromArchive.code !== 0) console.error(fromArchive.output);
  check(
    fromArchive.code === 0,
    "Restore aus dem heruntergeladenen .tar-Archiv (Sicherungsordner ebenfalls verloren)",
  );
  server = await startServer(env);
  await checkLogins(server.base, school, "nach Archiv-Restore");
  const client3 = new Client(server.base);
  await client3.login(owner.email, owner.password);
  equal(
    await snapshot(client3),
    before,
    "Archiv-Restore: Daten wie zum Sicherungszeitpunkt",
  );
  await checkUploads(client3, school, "nach Archiv-Restore");
  await stopServer(server);
}

/* ------------------------------------------------------------------ */
/* Multi-tenant                                                         */
/* ------------------------------------------------------------------ */

async function multiTenantDrill() {
  console.log("\nMehrmandantenbetrieb");
  const dir = join(root, "multi");
  const port = await freePort();
  const env = cleanEnv({
    PORT: String(port),
    MULTI_TENANT: "1",
    BASE_DOMAIN: "drill.test",
    PLATFORM_SIGNUP: "1",
    TENANTS_DIR: join(dir, "data", "tenants"),
    REGISTRY_PATH: join(dir, "data", "registry.db"),
    FILE_STORE_DIR: join(dir, "data", "files"),
    BACKUP_DIR: join(dir, "backups"),
  });

  let server = await startServer(env);
  const platform = new Client(server.base, "drill.test");
  const schools: Record<
    string,
    { school: School; owner: { email: string; password: string } }
  > = {};
  const clients: Record<string, Client> = {};
  for (const slug of ["fs-a", "fs-b"]) {
    const owner = { email: `inhaber@${slug}.drill.test`, password: PASSWORD };
    await platform.json("POST", "/api/platform/signup", {
      slug,
      schoolName: `Fahrschule ${slug}`,
      ownerName: "Ines Inhaber",
      acceptTerms: true,
      ...owner,
    });
    const client = new Client(server.base, `${slug}.drill.test`);
    check(
      await client.login(owner.email, owner.password),
      `${slug}: registriert und angemeldet`,
    );
    schools[slug] = { school: await seedSchool(client, owner, slug), owner };
    clients[slug] = client;
  }
  const beforeA = await snapshot(clients["fs-a"]!);
  const backup = await clients["fs-a"]!.json<{ name: string; fileCount: number }>(
    "POST",
    "/api/admin/backups",
  );
  check(
    backup.fileCount === 6,
    `fs-a gesichert: ${backup.name} (Datenbank + ${backup.fileCount} Dokumente, nur fs-a)`,
  );

  // After the backup both schools keep working.
  await createStudent(clients["fs-a"]!, "Nach", "Sicherung-A");
  const lateB = await createStudent(clients["fs-b"]!, "Neu", "Nach-Sicherung-B");
  schools["fs-b"]!.school.uploads.push(
    await upload(clients["fs-b"]!, lateB.id, "neu-b.pdf", pdfBytes("neu-b", 7000)),
  );
  const afterB = await snapshot(clients["fs-b"]!);
  await stopServer(server);

  // Disaster for fs-a only.
  await rm(join(dir, "data", "tenants", "fs-a.db"), { force: true });
  await rm(join(dir, "data", "tenants", "fs-a.db-wal"), { force: true });
  await rm(join(dir, "data", "tenants", "fs-a.db-shm"), { force: true });
  await rm(join(dir, "data", "files", "fs-a"), { recursive: true, force: true });

  const wrong = await runRestore(env, [
    "restore",
    join(dir, "backups", "fs-a", backup.name),
    "--tenant",
    "fs-b",
    "--force",
  ]);
  check(
    wrong.code !== 0 && wrong.output.includes("fs-a"),
    "Sicherung von fs-a wird für fs-b verweigert (auch mit --force)",
  );

  const restored = await runRestore(env, ["restore", backup.name, "--tenant", "fs-a"]);
  if (restored.code !== 0) console.error(restored.output);
  check(restored.code === 0, "bun run restore restore --tenant fs-a");

  server = await startServer(env);
  const a = new Client(server.base, "fs-a.drill.test");
  const b = new Client(server.base, "fs-b.drill.test");
  await checkLogins(server.base, schools["fs-a"]!.school, "fs-a", "fs-a.drill.test");
  await checkLogins(server.base, schools["fs-b"]!.school, "fs-b", "fs-b.drill.test");
  await a.login(schools["fs-a"]!.owner.email, PASSWORD);
  await b.login(schools["fs-b"]!.owner.email, PASSWORD);
  equal(
    await snapshot(a),
    beforeA,
    "fs-a: Stand der Sicherung (spätere Änderung verworfen)",
  );
  await checkUploads(a, schools["fs-a"]!.school, "fs-a");
  equal(
    await snapshot(b),
    afterB,
    "fs-b: unberührt, inkl. Änderungen nach der Sicherung von fs-a",
  );
  await checkUploads(b, schools["fs-b"]!.school, "fs-b");
  await stopServer(server);
}

/* ------------------------------------------------------------------ */

let failed = false;
try {
  console.log(`Restore-Drill in ${root}`);
  await singleSchoolDrill();
  await multiTenantDrill();
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
  if (lastLog) {
    const log = await Bun.file(lastLog)
      .text()
      .catch(() => "");
    console.error(
      `\nServer-Log (${lastLog}, Ende):\n${log.split("\n").slice(-40).join("\n")}`,
    );
  }
} finally {
  if (keep || failed) console.log(`\nArbeitsverzeichnis bleibt erhalten: ${root}`);
  else await rm(root, { recursive: true, force: true });
}
const seconds = ((Date.now() - started) / 1000).toFixed(1);
if (failed) {
  console.error(
    `\n✗ Drill fehlgeschlagen nach ${results.length} erfolgreichen Prüfungen (${seconds} s).`,
  );
  process.exit(1);
}
console.log(`\n✓ Drill bestanden: ${results.length} Prüfungen in ${seconds} s.`);
