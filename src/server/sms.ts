/* ------------------------------------------------------------------ */
/* SMS — provider adapters (seven.io, generic HTTP webhook). Number   */
/* normalisation and segment math live in src/lib/sms-text.ts (shared  */
/* with the Nachrichten page) and are re-exported here. No deps: every */
/* adapter takes an injectable `fetch`, so tests never hit the network. */
/*                                                                     */
/* SMS share the outbox with e-mail (outbox.channel = 'sms', mail.ts): */
/* same statuses, retries and the Nachrichten page.                    */
/*                                                                     */
/* Env: SMS_PROVIDER=seven|webhook, SMS_API_KEY (seven), SMS_FROM      */
/* (Absender, max. 11 alphanumerische Zeichen), SMS_WEBHOOK_URL.       */
/* ------------------------------------------------------------------ */

export {
  isGermanMobile,
  MAX_SMS_SEGMENTS,
  normalizePhoneNumber,
  prepareSmsText,
  smsCapacity,
  smsEncoding,
  smsLength,
  smsSegments,
  type SmsEncoding,
} from "../lib/sms-text";

export type SmsProvider = "seven" | "webhook";

export type SmsConfig = {
  provider: SmsProvider;
  /** seven.io API key (X-Api-Key). */
  apiKey: string;
  /** Sender ID — alphanumeric, max. 11 chars; "" = provider default. */
  from: string;
  /** Target of the webhook adapter. */
  webhookUrl: string;
};

export type OutgoingSms = { to: string; text: string };

export type SmsTransport = {
  send(sms: OutgoingSms): Promise<void>;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const SEVEN_ENDPOINT = "https://gateway.seven.io/api/sms";

/* ------------------------------ config ----------------------------- */

/** Alphanumeric sender IDs are limited to 11 characters (GSM 03.40). */
export function sanitizeSender(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").slice(0, 11);
}

/** Reads SMS_PROVIDER/SMS_API_KEY/SMS_FROM/SMS_WEBHOOK_URL. Returns null
 *  when the provider is missing or incomplete — SMS then stay
 *  'nicht_konfiguriert' like unsent mails. */
export function smsConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): SmsConfig | null {
  const provider = env.SMS_PROVIDER?.trim().toLowerCase() ?? "";
  const apiKey = env.SMS_API_KEY?.trim() ?? "";
  const webhookUrl = env.SMS_WEBHOOK_URL?.trim() ?? "";
  const from = sanitizeSender(env.SMS_FROM?.trim() ?? "");
  if (provider === "seven") {
    if (!apiKey) return null;
    return { provider, apiKey, from, webhookUrl: "" };
  }
  if (provider === "webhook") {
    if (!/^https?:\/\//i.test(webhookUrl)) return null;
    return { provider, apiKey, from, webhookUrl };
  }
  return null;
}

/* ------------------------------ adapters --------------------------- */

export class SmsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsError";
  }
}

/* seven.io return codes (docs.seven.io → SMS → Rückgabewerte). */
const SEVEN_ERRORS: Record<string, string> = {
  "101": "Versand an mindestens einen Empfänger fehlgeschlagen",
  "201": "Absenderkennung ungültig (max. 11 alphanumerische Zeichen)",
  "202": "Empfängernummer ungültig",
  "301": "Empfänger fehlt",
  "305": "Text ungültig",
  "401": "Text zu lang",
  "402": "Doppelte SMS innerhalb von 180 Sekunden (Reload-Sperre)",
  "403": "Tageslimit für diesen Empfänger erreicht",
  "500": "Guthaben beim SMS-Anbieter reicht nicht aus",
  "600": "Fehler beim Mobilfunkbetreiber",
  "900": "Authentifizierung fehlgeschlagen (SMS_API_KEY prüfen)",
  "902": "API-Schlüssel hat keine Berechtigung für SMS",
  "903": "Server-IP ist beim SMS-Anbieter nicht freigegeben",
};

/** Reads the seven.io return code — JSON (`json=1`: { success: "100" })
 *  or plain text (first line "100"). */
export function sevenReturnCode(body: string): string {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { success?: unknown };
      if (parsed.success !== undefined) return String(parsed.success);
    } catch {
      // fall through to the plain-text reading
    }
  }
  return trimmed.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

export function createSevenTransport(
  config: SmsConfig,
  fetchImpl: FetchLike = fetch,
): SmsTransport {
  return {
    async send({ to, text }) {
      const form = new URLSearchParams({ to, text, json: "1" });
      if (config.from) form.set("from", config.from);
      const response = await fetchImpl(SEVEN_ENDPOINT, {
        method: "POST",
        headers: {
          "X-Api-Key": config.apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: form.toString(),
      });
      const body = await response.text().catch(() => "");
      if (!response.ok) {
        throw new SmsError(`SMS-Anbieter antwortet mit HTTP ${response.status}`);
      }
      const code = sevenReturnCode(body);
      if (code !== "100") {
        throw new SmsError(
          `seven.io ${code || "?"}: ${SEVEN_ERRORS[code] ?? "Unbekannter Fehler"}`,
        );
      }
    },
  };
}

/** Generic adapter: POST JSON { to, text, from } — any 2xx is success. */
export function createWebhookTransport(
  config: SmsConfig,
  fetchImpl: FetchLike = fetch,
): SmsTransport {
  return {
    async send({ to, text }) {
      const response = await fetchImpl(config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, text, from: config.from }),
      });
      if (!response.ok) {
        throw new SmsError(`SMS-Webhook antwortet mit HTTP ${response.status}`);
      }
    },
  };
}

export function createSmsTransport(
  config: SmsConfig,
  fetchImpl: FetchLike = fetch,
): SmsTransport {
  return config.provider === "seven"
    ? createSevenTransport(config, fetchImpl)
    : createWebhookTransport(config, fetchImpl);
}
