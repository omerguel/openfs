/* ------------------------------------------------------------------ */
/* Datenexport (ZIP) — the school's key data as CSV files that open    */
/* in Excel (UTF-8 with BOM, ';'), plus the uploaded documents, plus a */
/* LIESMICH.txt. Complements the raw SQLite copy                        */
/* (/api/export/database), which is the one to restore from.           */
/*                                                                     */
/*   GET /api/export/zip   Inhaber only (OWNER_ONLY /api/export/)       */
/* ------------------------------------------------------------------ */

import type { BunRequest } from "bun";

import type { Database } from "./sqlite";

import type { FileStore } from "./file-store";
import { handle } from "./http";
import { createZip, type ZipEntry } from "./zip";

type Row = Record<string, unknown>;

/* file name → query. Plain columns, one row per record. */
const TABLES: [file: string, sql: string][] = [
  ["schueler.csv", "SELECT * FROM students ORDER BY rowid"],
  ["fahrlehrer.csv", "SELECT * FROM instructors ORDER BY rowid"],
  ["fahrzeuge.csv", "SELECT * FROM vehicles ORDER BY rowid"],
  ["termine.csv", "SELECT * FROM calendar_events ORDER BY date, start"],
  ["rechnungen.csv", "SELECT * FROM invoices ORDER BY rowid"],
  ["rechnungspositionen.csv", "SELECT * FROM invoice_items ORDER BY rowid"],
  [
    "buchungen.csv",
    `SELECT t.date AS datum, t.beleg_nr, b.buchung_nr, t.type AS art,
            t.description AS text, b.line_description AS zeilentext,
            b.soll_account AS soll, b.haben_account AS haben,
            printf('%.2f', b.amount_cents / 100.0) AS betrag_eur,
            b.vat_rate AS ust_satz, t.student_customer_no AS kundennummer,
            t.student_name AS schueler, t.storno_of, t.storniert_by
       FROM bookings b JOIN transactions t ON t.id = b.transaction_id
       ORDER BY t.date, b.id`,
  ],
  ["konten.csv", "SELECT * FROM accounts ORDER BY number"],
  ["preisplaene.csv", "SELECT * FROM price_plans ORDER BY rowid"],
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = value instanceof Uint8Array ? "" : String(value);
  // Spreadsheet formula injection: text starting with = + @ (or - that is
  // not a number) would run as a formula in Excel — prefix an apostrophe.
  const text = /^[=+@\t\r]/.test(raw) || /^-(?!\d)/.test(raw) ? `'${raw}` : raw;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv(rows: Row[], columns?: string[]): string {
  const header = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  const lines = [header.map(csvCell).join(";")];
  for (const row of rows) lines.push(header.map((key) => csvCell(row[key])).join(";"));
  // BOM so Excel opens UTF-8 (umlauts) correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

function tableExists(db: Database, name: string): boolean {
  return (
    db
      .query<{ n: number }, [string]>(
        "SELECT count(*) AS n FROM sqlite_master WHERE type IN ('table','view') AND name = ?",
      )
      .get(name)!.n > 0
  );
}

const README = (date: string) =>
  [
    `OpenFS Datenexport vom ${date}`,
    "",
    "Dieser Export enthält die wichtigsten Daten Ihrer Fahrschule als CSV-Dateien",
    "(öffnen z. B. mit Excel oder LibreOffice; Trennzeichen Semikolon, UTF-8)",
    "sowie die hochgeladenen Dokumente im Ordner „dokumente“.",
    "",
    "  schueler.csv            Fahrschüler",
    "  fahrlehrer.csv          Fahrlehrer/innen",
    "  fahrzeuge.csv           Fahrzeuge",
    "  termine.csv             Termine (Fahrstunden, Theorie, Prüfungen …)",
    "  rechnungen.csv          Rechnungen, rechnungspositionen.csv ihre Positionen",
    "  buchungen.csv           Alle Buchungen (Kasse/Bank) mit Beleg-Nr. und Konten",
    "  konten.csv, preisplaene.csv",
    "",
    "Wichtig: Zum Wiederherstellen von OpenFS dient die Datenbank-Sicherung (.db),",
    "nicht dieser Export. Er ist zum Anschauen, Weitergeben (z. B. an den",
    "Steuerberater) und Archivieren gedacht.",
    "",
  ].join("\r\n");

export async function buildDataExport(
  db: Database,
  fileStore: FileStore | null,
  now = new Date(),
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const date = now.toLocaleDateString("de-DE");
  const entries: ZipEntry[] = [
    { name: "LIESMICH.txt", data: encoder.encode(README(date)) },
  ];
  for (const [file, sql] of TABLES) {
    const table = /FROM (\w+)/.exec(sql)?.[1] ?? "";
    if (!tableExists(db, table)) continue;
    entries.push({
      name: file,
      data: encoder.encode(rowsToCsv(db.query<Row, []>(sql).all())),
    });
  }

  if (fileStore && tableExists(db, "student_files")) {
    const files = db
      .query<
        {
          id: number;
          student_id: number;
          name: string;
          storage_key: string;
          last: string;
        },
        []
      >(
        `SELECT f.id, f.student_id, f.name, f.storage_key,
                COALESCE(s.last_name, '') AS last
           FROM student_files f LEFT JOIN students s ON s.id = f.student_id
           ORDER BY f.id`,
      )
      .all();
    const listed: Row[] = [];
    for (const file of files) {
      const bytes = await fileStore.get(file.storage_key).catch(() => null);
      const safe = (value: string) => value.replace(/[\\/:*?"<>|]+/g, "_").trim() || "_";
      const path = `dokumente/${file.student_id}-${safe(file.last)}/${file.id}-${safe(file.name)}`;
      if (bytes) entries.push({ name: path, data: bytes });
      listed.push({
        datei: bytes ? path : "",
        schueler_id: file.student_id,
        name: file.name,
        fehlt: bytes ? "" : "ja",
      });
    }
    if (listed.length) {
      entries.push({ name: "dokumente.csv", data: encoder.encode(rowsToCsv(listed)) });
    }
  }
  return createZip(entries.map((entry) => ({ ...entry, date: now })));
}

export function dataExportRoutes(db: Database, fileStore: FileStore | null) {
  return {
    "/api/export/zip": {
      GET: (_req: BunRequest) =>
        handle(async () => {
          const bytes = await buildDataExport(db, fileStore);
          const date = new Date().toISOString().slice(0, 10);
          return new Response(bytes as unknown as BodyInit, {
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": `attachment; filename="openfs-datenexport-${date}.zip"`,
            },
          });
        })(),
    },
  };
}
