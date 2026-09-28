/** "@fahrschule", "fahrschule" or "instagram.com/fahrschule" → profile URL.
 *  Full http(s) URLs pass unchanged; "" stays "". null = not a handle. */
export function toInstagramUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const handle = trimmed
    .replace(/^(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `https://instagram.com/${handle}` : null;
}
