/* ------------------------------------------------------------------ */
/* SMS text helpers shared by the server (src/server/sms.ts) and the   */
/* Nachrichten page: E.164 normalisation for (German) phone numbers    */
/* and GSM 03.38 / UCS-2 segment math.                                 */
/* ------------------------------------------------------------------ */

/** Up to three concatenated segments per SMS (see prepareSmsText). */
export const MAX_SMS_SEGMENTS = 3;

/* --------------------------- phone numbers ------------------------- */

/** "0151 234 567-80", "+49 (0)151/23456780", "0049151…" → "+4915123456780".
 *  Numbers without country code are read as German. Returns null for
 *  anything that is not a plausible E.164 number (8–15 digits). */
export function normalizePhoneNumber(raw: string): string | null {
  let value = raw.trim().replace(/\(0\)/g, "");
  value = value.replace(/[\s\-/().]/g, "");
  if (!value) return null;
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  else if (value.startsWith("0")) value = `+49${value.slice(1)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(value)) return null;
  // German numbers: +49 followed by an area/mobile code — at least 8 digits.
  if (value.startsWith("+49") && value.length < 11) return null;
  return value;
}

/** German mobile numbers start with +4915, +4916 or +4917. */
export function isGermanMobile(e164: string): boolean {
  return /^\+491[5-7]\d{7,10}$/.test(e164);
}

/* ------------------------------ segments --------------------------- */

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";
const GSM_BASIC_SET = new Set(GSM_BASIC);
const GSM_EXTENDED_SET = new Set(GSM_EXTENDED);

export type SmsEncoding = "gsm" | "ucs2";

export function smsEncoding(text: string): SmsEncoding {
  for (const char of text) {
    if (!GSM_BASIC_SET.has(char) && !GSM_EXTENDED_SET.has(char)) return "ucs2";
  }
  return "gsm";
}

/** Length in encoding units: GSM septets (extension chars count 2) or
 *  UTF-16 code units for UCS-2. */
export function smsLength(text: string, encoding = smsEncoding(text)): number {
  if (encoding === "ucs2") return text.length;
  let length = 0;
  for (const char of text) length += GSM_EXTENDED_SET.has(char) ? 2 : 1;
  return length;
}

const LIMITS: Record<SmsEncoding, { single: number; part: number }> = {
  gsm: { single: 160, part: 153 },
  ucs2: { single: 70, part: 67 },
};

export function smsSegments(text: string): {
  encoding: SmsEncoding;
  length: number;
  segments: number;
} {
  const encoding = smsEncoding(text);
  const length = smsLength(text, encoding);
  const { single, part } = LIMITS[encoding];
  const segments = length === 0 ? 0 : length <= single ? 1 : Math.ceil(length / part);
  return { encoding, length, segments };
}

/** Maximum length for `segments` concatenated parts. */
export function smsCapacity(encoding: SmsEncoding, segments = MAX_SMS_SEGMENTS): number {
  const { single, part } = LIMITS[encoding];
  return segments <= 1 ? single : part * segments;
}

/** Trims and, if the text exceeds `maxSegments`, cuts it at a word
 *  boundary and appends "..." so the message still reads naturally. */
export function prepareSmsText(text: string, maxSegments = MAX_SMS_SEGMENTS): string {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  const encoding = smsEncoding(clean);
  const capacity = smsCapacity(encoding, maxSegments);
  if (smsLength(clean, encoding) <= capacity) return clean;
  const ellipsis = "...";
  const chars = [...clean];
  let cut = "";
  for (const char of chars) {
    if (smsLength(cut + char + ellipsis, encoding) > capacity) break;
    cut += char;
  }
  const lastSpace = cut.search(/\s\S*$/);
  if (lastSpace > cut.length * 0.6) cut = cut.slice(0, lastSpace);
  return `${cut.trimEnd()}${ellipsis}`;
}
