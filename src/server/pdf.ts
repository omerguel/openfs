/* ------------------------------------------------------------------ */
/* Minimal PDF 1.4 writer — no dependencies.                           */
/*                                                                     */
/* Enough for business letters (Rechnung, Mahnung): A4 pages, the two  */
/* standard fonts Helvetica / Helvetica-Bold (WinAnsiEncoding, so      */
/* umlauts, ß, € and § work without embedding a font), text with       */
/* left/right alignment and word wrapping, and hairlines. Text widths  */
/* come from the Adobe AFM metrics of the standard 14 fonts.           */
/* ------------------------------------------------------------------ */

import { encodeCp1252 } from "./datev";

export const A4 = { width: 595.28, height: 841.89 } as const;

export type FontStyle = "regular" | "bold";

/* Helvetica / Helvetica-Bold advance widths (1/1000 em) for ASCII 32–126. */
const REGULAR_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667,
  667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722,
  667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500,
  556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278,
  556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const BOLD_ASCII = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722,
  722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722,
  667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556,
  611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333,
  611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/* Non-ASCII characters that occur in German business letters. Accented
   letters share the width of their base letter in these fonts. */
const EXTRA: Record<string, [number, number]> = {
  "€": [556, 556],
  "§": [556, 556],
  ß: [611, 611],
  "–": [556, 556],
  "—": [1000, 1000],
  "·": [278, 278],
  "„": [333, 500],
  "“": [333, 500],
  "”": [333, 500],
  "‚": [222, 278],
  "‘": [222, 278],
  "’": [222, 278],
  "…": [1000, 1000],
  "°": [400, 400],
  " ": [278, 278],
};

function charWidth(char: string, style: FontStyle): number {
  const code = char.charCodeAt(0);
  const table = style === "bold" ? BOLD_ASCII : REGULAR_ASCII;
  if (code >= 32 && code <= 126) return table[code - 32]!;
  const extra = EXTRA[char];
  if (extra) return style === "bold" ? extra[1] : extra[0];
  const base = char.normalize("NFD")[0];
  if (base && base !== char) return charWidth(base, style);
  return 556;
}

export function textWidth(text: string, size: number, style: FontStyle = "regular") {
  let units = 0;
  for (const char of text) units += charWidth(char, style);
  return (units * size) / 1000;
}

/** Greedy word wrap; words longer than the line are hard-broken. */
export function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  style: FontStyle = "regular",
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (textWidth(candidate, size, style) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      let rest = word;
      while (textWidth(rest, size, style) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidth(rest.slice(0, cut), size, style) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    }
    lines.push(current);
  }
  return lines;
}

/** PDF literal string in WinAnsi bytes: non-ASCII as octal escapes. */
function pdfString(text: string): string {
  let out = "(";
  for (const byte of encodeCp1252(text)) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c)
      out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return `${out})`;
}

const num = (value: number) => (Math.round(value * 100) / 100).toString();

export type TextOptions = {
  size?: number;
  style?: FontStyle;
  align?: "left" | "right";
  /** 0 = black … 1 = white */
  gray?: number;
};

/** A document under construction. Coordinates are in points from the
 *  TOP-left corner (converted to PDF's bottom-left origin on output). */
export class PdfDocument {
  private pages: string[][] = [];
  private title: string;

  constructor(title: string) {
    this.title = title;
    this.addPage();
  }

  get pageCount() {
    return this.pages.length;
  }

  addPage() {
    this.pages.push([]);
  }

  private get ops(): string[] {
    return this.pages.at(-1)!;
  }

  text(x: number, y: number, text: string, options: TextOptions = {}) {
    if (!text) return;
    const size = options.size ?? 10;
    const style = options.style ?? "regular";
    const left = options.align === "right" ? x - textWidth(text, size, style) : x;
    const gray = options.gray ?? 0;
    this.ops.push(
      `BT /${style === "bold" ? "F2" : "F1"} ${num(size)} Tf ${num(gray)} g ${num(left)} ${num(
        A4.height - y,
      )} Td ${pdfString(text)} Tj ET`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0.6) {
    this.ops.push(
      `${num(gray)} G ${num(width)} w ${num(x1)} ${num(A4.height - y1)} m ${num(x2)} ${num(
        A4.height - y2,
      )} l S`,
    );
  }

  /** Serialises the document; byte offsets for the xref table are exact
   *  because every object is pure ASCII. */
  toBytes(): Uint8Array {
    const objects: string[] = [];
    const add = (body: string) => {
      objects.push(body);
      return objects.length;
    };
    const catalog = add("");
    const pagesId = add("");
    const regular = add(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    );
    const bold = add(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    );
    const info = add(`<< /Title ${pdfString(this.title)} /Producer (OpenFS) >>`);
    const pageIds: number[] = [];
    for (const ops of this.pages) {
      const stream = ops.join("\n");
      const contentId = add(
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      );
      pageIds.push(
        add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] ` +
            `/Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${contentId} 0 R >>`,
        ),
      );
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] =
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(out.length);
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(out);
  }
}
