/* ------------------------------------------------------------------ */
/* CSV — RFC 4180 parser/writer for the Datenimport.                   */
/*                                                                     */
/* German exports (Excel, Fahrschulmanager & co.) use ';' and are      */
/* often Windows-1252 encoded, so the delimiter is auto-detected among */
/* ';', ',' and TAB and the byte decoder falls back from UTF-8 to      */
/* Windows-1252 when the bytes are not valid UTF-8.                    */
/* ------------------------------------------------------------------ */

export type CsvDelimiter = ";" | "," | "\t";

export type CsvEncoding = "UTF-8" | "Windows-1252";

export const CSV_DELIMITERS: CsvDelimiter[] = [";", ",", "\t"];

export const DELIMITER_LABELS: Record<CsvDelimiter, string> = {
  ";": "Semikolon (;)",
  ",": "Komma (,)",
  "\t": "Tabulator",
};

/** Decode file bytes: strict UTF-8 first, Windows-1252 if that fails. */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): {
  text: string;
  encoding: CsvEncoding;
} {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(view);
    return { text: stripBom(text), encoding: "UTF-8" };
  } catch {
    const text = new TextDecoder("windows-1252").decode(view);
    return { text: stripBom(text), encoding: "Windows-1252" };
  }
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/* Parse the whole text with one delimiter. Quoted fields may contain the
   delimiter, doubled quotes ("") and line breaks; CRLF, LF and lone CR
   all end a record. Blank lines are dropped. */
function parseWith(text: string, delimiter: string, maxRows = Infinity): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endRow = () => {
    row.push(field);
    field = "";
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  while (i < text.length && rows.length < maxRows) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      endRow();
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else {
      field += ch;
    }
    i++;
  }
  if (rows.length < maxRows && (field !== "" || row.length > 0)) endRow();
  return rows;
}

/* Pick the delimiter that splits the first lines into the most columns,
   consistently. Ties favour ';' (German default). */
export function detectDelimiter(text: string): CsvDelimiter {
  const sample = stripBom(text);
  let best: CsvDelimiter = ";";
  let bestScore = 0;
  for (const delimiter of CSV_DELIMITERS) {
    const rows = parseWith(sample, delimiter, 10);
    if (rows.length === 0) continue;
    const width = rows[0]!.length;
    if (width < 2) continue;
    const consistent = rows.filter((r) => r.length === width).length / rows.length;
    const score = width * consistent;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

export function parseCsv(
  text: string,
  delimiter?: CsvDelimiter,
): { rows: string[][]; delimiter: CsvDelimiter } {
  const clean = stripBom(text);
  const used = delimiter ?? detectDelimiter(clean);
  return { rows: parseWith(clean, used), delimiter: used };
}

function quoteField(value: string, delimiter: string): string {
  if (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/** Serialize rows as CSV with CRLF line ends (Excel-friendly). */
export function toCsv(rows: string[][], delimiter: CsvDelimiter = ";"): string {
  return rows
    .map((row) => row.map((value) => quoteField(value, delimiter)).join(delimiter))
    .join("\r\n");
}
