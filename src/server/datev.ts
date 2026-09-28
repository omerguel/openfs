/* ------------------------------------------------------------------ */
/* DATEV-Format Export — EXTF-CSV "Buchungsstapel".                    */
/*                                                                     */
/* Produces the official DATEV import format (Schnittstellen-Version   */
/* 700, Formatkategorie 21, Formatname "Buchungsstapel", Format-       */
/* version 13) so the Steuerberater can import the Buchungen directly  */
/* into DATEV Kanzlei-Rechnungswesen (USt-VA, EÜR/Jahresabschluss,     */
/* Steuererklärung).                                                   */
/*                                                                     */
/* Format rules implemented here (verified against the published       */
/* spec and the DATEV reference example):                              */
/*  - Encoding Windows-1252 (ANSI), separator ';', line ending CRLF.   */
/*  - Row 1: 31-field metadata header (Berater, Mandant, WJ-Beginn,    */
/*    Sachkontenlänge, Zeitraum, Festschreibung, WKZ, SKR at pos 27).  */
/*  - Row 2: the 125 column names of Formatversion 13.                 */
/*  - Data rows: Umsatz always positive with S/H-Kennzeichen relative  */
/*    to "Konto"; Belegdatum is TTMM (the year comes from the header   */
/*    Wirtschaftsjahr — a Stapel must therefore stay in ONE year).     */
/*  - BU-Schlüssel applies to the Gegenkonto. SKR-04-Automatikkonten   */
/*    (4400, 4300, 3272, …) calculate USt themselves and must NOT get  */
/*    a BU-Schlüssel; non-automatic Aufwandskonten get Vorsteuer keys  */
/*    (9 = 19 %, 8 = 7 %).                                             */
/*  - Saldenvorträge (9000 ↔ 3272) always carry Konto 9000 and BU 40   */
/*    ("Aufhebung der Automatik") on the Automatikkonto 3272, so DATEV */
/*    does not compute USt on an opening balance a second time. The    */
/*    same holds for every line on an Automatikkonto booked without    */
/*    VAT, e.g. the "Ausgleich Saldovortrag" part of a payment         */
/*    (Geldkonto an 3272): Automatikkonto as Gegenkonto, BU 40.        */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";

import type { Account } from "../lib/accounting-types";
import { getCompany } from "./db";
import { listAccounts, listJournal, ValidationError } from "./engine";

/* Verbatim column row of Formatversion 13 (125 fields) — taken from   */
/* the DATEV reference example. The dashes are U+2013 (CP1252 0x96).   */
export const DATEV_COLUMNS =
  "Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basisumsatz;WKZ Basisumsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext;Postensperre;Diverse Adressnummer;Geschäftspartnerbank;Sachverhalt;Zinssperre;Beleglink;Beleginfo – Art 1;Beleginfo – Inhalt 1;Beleginfo – Art 2;Beleginfo – Inhalt 2;Beleginfo – Art 3;Beleginfo – Inhalt 3;Beleginfo – Art 4;Beleginfo – Inhalt 4;Beleginfo – Art 5;Beleginfo – Inhalt 5;Beleginfo – Art 6;Beleginfo – Inhalt 6;Beleginfo – Art 7;Beleginfo – Inhalt 7;Beleginfo – Art 8;Beleginfo – Inhalt 8;KOST1 – Kostenstelle;KOST2 – Kostenstelle;Kost Menge;EU-Land u. USt-IdNr.;EU-Steuersatz;Abw. Versteuerungsart;Sachverhalt L+L;Funktionsergänzung L+L;BU 49 Hauptfunktionstyp;BU 49 Hauptfunktionsnummer;BU 49 Funktionsergänzung;Zusatzinformation – Art 1;Zusatzinformation – Inhalt 1;Zusatzinformation – Art 2;Zusatzinformation – Inhalt 2;Zusatzinformation – Art 3;Zusatzinformation – Inhalt 3;Zusatzinformation – Art 4;Zusatzinformation – Inhalt 4;Zusatzinformation – Art 5;Zusatzinformation – Inhalt 5;Zusatzinformation – Art 6;Zusatzinformation – Inhalt 6;Zusatzinformation – Art 7;Zusatzinformation – Inhalt 7;Zusatzinformation – Art 8;Zusatzinformation – Inhalt 8;Zusatzinformation – Art 9;Zusatzinformation – Inhalt 9;Zusatzinformation – Art 10;Zusatzinformation – Inhalt 10;Zusatzinformation – Art 11;Zusatzinformation – Inhalt 11;Zusatzinformation – Art 12;Zusatzinformation – Inhalt 12;Zusatzinformation – Art 13;Zusatzinformation – Inhalt 13;Zusatzinformation – Art 14;Zusatzinformation – Inhalt 14;Zusatzinformation – Art 15;Zusatzinformation – Inhalt 15;Zusatzinformation – Art 16;Zusatzinformation – Inhalt 16;Zusatzinformation – Art 17;Zusatzinformation – Inhalt 17;Zusatzinformation – Art 18;Zusatzinformation – Inhalt 18;Zusatzinformation – Art 19;Zusatzinformation – Inhalt 19;Zusatzinformation – Art 20;Zusatzinformation – Inhalt 20;Stück;Gewicht;Zahlweise;Forderungsart;Veranlagungsjahr;Zugeordnete Fälligkeit;Skontotyp;Auftragsnummer;Buchungstyp;USt-Schlüssel (Anzahlungen);EU-Mitgliedstaat (Anzahlungen);Sachverhalt L+L (Anzahlungen);EU-Steuersatz (Anzahlungen);Erlöskonto (Anzahlungen);Herkunft-Kz;Leerfeld;KOST-Datum;SEPA-Mandatsreferenz;Skontosperre;Gesellschaftername;Beteiligtennummer;Identifikationsnummer;Zeichnernummer;Postensperre bis;Bezeichnung;Kennzeichen;Festschreibung;Leistungsdatum;Datum Zuord.;Fälligkeit;Generalumkehr;Steuersatz;Land;Abrechnungsreferent;BVV-Position;EU-Mitgliedstaat u. UStID (Ursprung);EU-Steuersatz (Ursprung);Abw. Skontokonto";

export const DATEV_COLUMN_COUNT = 125;

/* SKR-04-Automatikkonten used in this app: USt is derived from the    */
/* account itself — a BU-Schlüssel would be rejected by the import.    */
const AUTOMATIK_KONTEN = new Set(["4400", "4300", "3272"]);

/* Column indices (0-based) of the fields we fill. */
const COL = {
  umsatz: 0,
  sollHaben: 1,
  konto: 6,
  gegenkonto: 7,
  buSchluessel: 8,
  belegdatum: 9,
  belegfeld1: 10,
  buchungstext: 13,
} as const;

/** 40983 → "409,83" — decimal comma, NO thousand separators. */
export function datevAmount(cents: number): string {
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new ValidationError(`Ungültiger DATEV-Umsatz: ${cents}`);
  }
  return `${Math.trunc(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
}

/** "2026-06-08" → "0806" (TTMM — the year lives in the file header). */
function belegdatum(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}${month}`;
}

/** Quote a DATEV text field; quotes/semicolons/line breaks sanitized and
 *  spreadsheet formula triggers (=, +, -, @, tab) neutralized with a
 *  leading apostrophe so exported CSVs are inert in Excel/LibreOffice. */
function text(value: string, limit: number): string {
  let cleaned = value.replace(/["\r\n\t]/g, "'");
  if (/^[=+\-@]/.test(cleaned)) {
    cleaned = `'${cleaned}`;
  }
  return `"${cleaned.slice(0, limit)}"`;
}

/** Belegfeld 1 allows only a-zA-Z0-9 $ & % * + - / */
function belegfeld(value: string): string {
  return `"${value.replace(/[^a-zA-Z0-9$&%*+\-/]/g, "").slice(0, 36)}"`;
}

/* ------------------------- Windows-1252 ---------------------------- */

/* Unicode → CP1252 for the 0x80–0x9F range (the rest maps 1:1 with    */
/* Latin-1). Covers €, dashes and typographic quotes.                  */
const CP1252_EXTRA = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

export function encodeCp1252(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0xff && !(code >= 0x80 && code <= 0x9f)) {
      bytes[i] = code;
    } else {
      bytes[i] = CP1252_EXTRA.get(code) ?? 0x3f; // '?' for unmappable
    }
  }
  return bytes;
}

/* ----------------------------- header ------------------------------ */

function headerRow(options: {
  beraterNr: string;
  mandantNr: string;
  exportedBy: string;
  from: string;
  to: string;
  createdAt: Date;
}): string {
  const { beraterNr, mandantNr, exportedBy, from, to, createdAt } = options;
  const compact = (iso: string) => iso.replace(/-/g, "");
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  const stamp =
    `${createdAt.getFullYear()}${pad(createdAt.getMonth() + 1, 2)}` +
    `${pad(createdAt.getDate(), 2)}${pad(createdAt.getHours(), 2)}` +
    `${pad(createdAt.getMinutes(), 2)}${pad(createdAt.getSeconds(), 2)}000`;

  const fields = new Array<string>(31).fill("");
  fields[0] = '"EXTF"'; //               1 Kennzeichen (extern erzeugt)
  fields[1] = "700"; //                  2 Versionsnummer der Schnittstelle
  fields[2] = "21"; //                   3 Formatkategorie Buchungsstapel
  fields[3] = '"Buchungsstapel"'; //     4 Formatname
  fields[4] = "13"; //                   5 Formatversion
  fields[5] = stamp; //                  6 Erzeugt am (JJJJMMTThhmmssfff)
  //                                     7 Importiert — bleibt leer
  fields[7] = '"FS"'; //                 8 Herkunft
  fields[8] = text(exportedBy, 25); //   9 Exportiert von
  //                                    10 Importiert von — bleibt leer
  fields[10] = beraterNr; //            11 Beraternummer
  fields[11] = mandantNr; //            12 Mandantennummer
  fields[12] = `${from.slice(0, 4)}0101`; // 13 WJ-Beginn
  fields[13] = "4"; //                  14 Sachkontenlänge
  fields[14] = compact(from); //        15 Datum vom
  fields[15] = compact(to); //          16 Datum bis
  fields[16] = text(`Buchungsstapel ${from.slice(0, 4)}`, 30); // 17 Bezeichnung
  //                                    18 Diktatkürzel — leer
  fields[18] = "1"; //                  19 Buchungstyp 1 = Finanzbuchhaltung
  fields[19] = "0"; //                  20 Rechnungslegungszweck unabhängig
  fields[20] = "0"; //                  21 Nicht festgeschrieben; kein Abschlussworkflow
  fields[21] = '"EUR"'; //              22 Währungskennzeichen
  fields[26] = '"04"'; //               27 SKR
  return fields.join(";");
}

/* --------------------------- booking rows -------------------------- */

/** Vorsteuer-BU-Schlüssel for non-automatic accounts (Aufwand). */
function buSchluessel(account: Account | undefined, vatRate: number | null): string {
  if (!account || vatRate == null || vatRate <= 0) return "";
  if (AUTOMATIK_KONTEN.has(account.number)) return "";
  if (account.kind === "aufwand") return vatRate === 19 ? '"9"' : '"8"';
  // Revenue on non-automatic accounts would need 2/3 — does not occur
  // with the seeded SKR 04 chart (4400/4300 are Automatikkonten).
  if (account.kind === "erloes") return vatRate === 19 ? '"3"' : '"2"';
  return "";
}

/* Kinds whose account governs a line's VAT itself (the engine's
   vatAccount): Erlös-, Aufwands- and durchlaufende Konten. */
const VAT_GOVERNING_KINDS = new Set<Account["kind"]>([
  "erloes",
  "aufwand",
  "durchlaufend",
]);

/**
 * A line on an Automatikkonto that deliberately carries no VAT needs BU 40
 * ("Aufhebung der Automatik"), else DATEV would compute USt from the
 * account. That is the case when the line has no VAT rate and its other
 * account does not govern the VAT itself — i.e. the Automatikkonto was
 * the line's only tax account (Saldovortrag 9000 ↔ 3272, Ausgleich eines
 * Saldovortrags Geldkonto an 3272). A charge 3272 an 1370/4830 keeps no
 * BU: there the Erlös-/Durchlaufkonto governs, and the Automatik on 3272
 * releases the Anzahlungs-USt as usual.
 */
function suspendsAutomatik(
  soll: Account | undefined,
  haben: Account | undefined,
  vatRate: number | null,
): boolean {
  if (vatRate != null || !soll || !haben) return false;
  const governs = (account: Account) => VAT_GOVERNING_KINDS.has(account.kind);
  return (
    (AUTOMATIK_KONTEN.has(soll.number) && !governs(haben)) ||
    (AUTOMATIK_KONTEN.has(haben.number) && !governs(soll))
  );
}

export type DatevExport = { filename: string; bytes: Uint8Array };

export function generateDatevExport(
  db: Database,
  options: { from?: string; to?: string; createdAt?: Date },
): DatevExport {
  const { from, to } = options;
  if (
    !from ||
    !to ||
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to)
  ) {
    throw new ValidationError("DATEV-Export benötigt einen Zeitraum (von/bis).");
  }
  if (from > to) {
    throw new ValidationError("Zeitraum: 'von' liegt nach 'bis'.");
  }
  if (from.slice(0, 4) !== to.slice(0, 4)) {
    // Belegdatum is TTMM — the year comes from the header WJ, so a
    // Stapel must not span fiscal years.
    throw new ValidationError(
      "DATEV-Buchungsstapel müssen je Wirtschaftsjahr exportiert werden — bitte den Zeitraum auf ein Kalenderjahr begrenzen.",
    );
  }

  const company = getCompany(db);
  if (!/^\d{4,7}$/.test(company.beraterNr) || Number(company.beraterNr) < 1001) {
    throw new ValidationError(
      "Bitte zuerst die DATEV-Beraternummer (1001–9999999) im Profil hinterlegen.",
    );
  }
  if (!/^\d{1,5}$/.test(company.mandantNr) || Number(company.mandantNr) < 1) {
    throw new ValidationError(
      "Bitte zuerst die DATEV-Mandantennummer (1–99999) im Profil hinterlegen.",
    );
  }

  const rows = listJournal(db, { from, to });
  if (rows.length === 0) {
    throw new ValidationError("Im gewählten Zeitraum liegen keine Buchungen vor.");
  }

  const accounts = new Map(listAccounts(db).map((a) => [a.number, a]));
  const lines: string[] = [
    headerRow({
      beraterNr: company.beraterNr,
      mandantNr: company.mandantNr,
      exportedBy: company.name,
      from,
      to,
      createdAt: options.createdAt ?? new Date(),
    }),
    DATEV_COLUMNS,
  ];

  // Journal is newest-first; DATEV Stapel are usually chronological.
  for (const row of [...rows].reverse()) {
    const soll = accounts.get(row.sollKonto);
    const haben = accounts.get(row.habenKonto);

    // S/H bezieht sich auf "Konto"; der BU-Schlüssel gehört zum
    // Gegenkonto. Steht das steuerrelevante (nicht-automatische)
    // Konto im Soll, wird die Buchung gedreht, damit der Schlüssel
    // am Gegenkonto landet (z. B. Ausgabe: 1800 "H" an 6530 BU 9).
    // Automatikkonto ohne USt (Saldovortrag 9000 ↔ 3272, Ausgleich eines
    // Saldovortrags 1800 an 3272): das Automatikkonto wird Gegenkonto
    // und bekommt BU 40, damit DATEV keine USt herausrechnet.
    const suspend = suspendsAutomatik(soll, haben, row.vatRate);
    const vortrag = soll?.kind === "vortrag" || haben?.kind === "vortrag";
    const flip = suspend
      ? AUTOMATIK_KONTEN.has(row.sollKonto)
      : vortrag
        ? haben?.kind === "vortrag"
        : buSchluessel(soll, row.vatRate) !== "" &&
          buSchluessel(haben, row.vatRate) === "";
    const konto = flip ? row.habenKonto : row.sollKonto;
    const gegenkonto = flip ? row.sollKonto : row.habenKonto;
    const kennzeichen = flip ? '"H"' : '"S"';
    const bu = suspend
      ? '"40"'
      : vortrag
        ? ""
        : buSchluessel(flip ? soll : haben, row.vatRate);

    const fields = new Array<string>(DATEV_COLUMN_COUNT).fill("");
    fields[COL.umsatz] = datevAmount(row.amountCents);
    fields[COL.sollHaben] = kennzeichen;
    fields[COL.konto] = konto;
    fields[COL.gegenkonto] = gegenkonto;
    fields[COL.buSchluessel] = bu;
    fields[COL.belegdatum] = belegdatum(row.date);
    fields[COL.belegfeld1] = belegfeld(row.belegNr ?? row.buchungNr);
    fields[COL.buchungstext] = text(row.description, 60);
    lines.push(fields.join(";"));
  }

  const csv = `${lines.join("\r\n")}\r\n`;
  return {
    filename: `EXTF_Buchungsstapel_${from.replace(/-/g, "")}_${to.replace(/-/g, "")}.csv`,
    bytes: encodeCp1252(csv),
  };
}
