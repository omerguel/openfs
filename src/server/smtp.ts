/* ------------------------------------------------------------------ */
/* Minimal SMTP client (RFC 5321) on node:net / node:tls — no deps.     */
/* Supports implicit TLS (port 465), STARTTLS (port 587) and, for      */
/* local relays and tests only, plain TCP. One message per connection: */
/* EHLO → [STARTTLS → EHLO] → AUTH PLAIN|LOGIN → MAIL/RCPT → DATA →   */
/* QUIT. The message body is sent quoted-printable so no 8BITMIME      */
/* support is needed on the server side.                               */
/* ------------------------------------------------------------------ */

import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

export type SmtpSecurity = "tls" | "starttls" | "none";

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** Header From — bare address or "Name <address>". */
  from: string;
  secure: SmtpSecurity;
};

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
};

export type MailTransport = {
  send(mail: OutgoingMail): Promise<void>;
};

export class SmtpError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "SmtpError";
  }
}

/* ------------------------------ config ----------------------------- */

/** Reads SMTP_HOST/PORT/USER/PASS/FROM (+ SMTP_SECURE). Returns null when
 *  host or sender are missing — mails then stay 'nicht_konfiguriert'. */
export function smtpConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim() ?? "";
  const from = env.SMTP_FROM?.trim() ?? "";
  if (!host || !from) return null;

  const rawSecure = env.SMTP_SECURE?.trim().toLowerCase() ?? "";
  const rawPort = Number(env.SMTP_PORT);
  const port =
    Number.isInteger(rawPort) && rawPort > 0 ? rawPort : rawSecure === "tls" ? 465 : 587;
  const secure: SmtpSecurity =
    rawSecure === "tls" || rawSecure === "starttls" || rawSecure === "none"
      ? rawSecure
      : port === 465
        ? "tls"
        : "starttls";

  return {
    host,
    port,
    user: env.SMTP_USER?.trim() ?? "",
    pass: env.SMTP_PASS ?? "",
    from,
    secure,
  };
}

/* ---------------------------- encoding ---------------------------- */

/** Header values must never carry line breaks (header injection). */
const oneLine = (value: string): string => value.replace(/[\r\n]+/g, " ").trim();

const ASCII_PRINTABLE = /^[\x20-\x7e]*$/;

/** RFC 2047 encoded-words (UTF-8, base64) for non-ASCII header text,
 *  folded so that no single encoded-word exceeds 75 characters. */
export function encodeHeaderWord(value: string): string {
  const text = oneLine(value);
  if (ASCII_PRINTABLE.test(text)) return text;
  const encoder = new TextEncoder();
  const words: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  // 45 bytes → 60 base64 chars + 12 chars of "=?UTF-8?B??=" = 72 ≤ 75.
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (chunkBytes + size > 45) {
      words.push(chunk);
      chunk = "";
      chunkBytes = 0;
    }
    chunk += char;
    chunkBytes += size;
  }
  if (chunk) words.push(chunk);
  return words
    .map((word) => `=?UTF-8?B?${Buffer.from(word, "utf8").toString("base64")}?=`)
    .join("\r\n ");
}

/** "Name <a@b.de>" / "a@b.de" → { name, address }. */
export function parseAddress(value: string): { name: string; address: string } {
  const match = /^(.*)<([^<>]+)>\s*$/.exec(oneLine(value));
  if (match) {
    return {
      name: match[1]!.trim().replace(/^"(.*)"$/, "$1"),
      address: match[2]!.trim(),
    };
  }
  return { name: "", address: oneLine(value) };
}

function formatAddress({ name, address }: { name: string; address: string }): string {
  if (!name) return address;
  const encoded = encodeHeaderWord(name);
  // Plain ASCII names are quoted so commas/dots stay inside the phrase.
  const phrase = encoded === name ? `"${name.replace(/(["\\])/g, "\\$1")}"` : encoded;
  return `${phrase} <${address}>`;
}

const hexByte = (byte: number): string =>
  `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;

/** Quoted-printable (RFC 2045) for a UTF-8 text body, CRLF line endings,
 *  soft line breaks keep every encoded line ≤ 76 characters. */
export function encodeQuotedPrintable(text: string): string {
  const encoder = new TextEncoder();
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const bytes = encoder.encode(line);
      let out = "";
      let current = "";
      bytes.forEach((byte, index) => {
        const last = index === bytes.length - 1;
        let token: string;
        if (byte === 0x20 || byte === 0x09) {
          // Trailing whitespace would be stripped in transit — encode it.
          token = last ? hexByte(byte) : String.fromCharCode(byte);
        } else if (byte >= 33 && byte <= 126 && byte !== 61) {
          token = String.fromCharCode(byte);
        } else {
          token = hexByte(byte);
        }
        if (current.length + token.length > 75) {
          out += `${current}=\r\n`;
          current = "";
        }
        current += token;
      });
      return out + current;
    })
    .join("\r\n");
}

/** RFC 5321 §4.5.2 transparency: lines starting with "." get another ".". */
export function dotStuff(data: string): string {
  return data.replace(/(^|\r\n)\./g, "$1..");
}

/** RFC 5322 date, e.g. "Mon, 28 Sep 2026 09:00:00 +0000". */
export function formatRfc5322Date(date: Date): string {
  return date.toUTCString().replace(/GMT$/, "+0000");
}

/** Full RFC 5322 message (headers + QP body), CRLF line endings. */
export function buildMessage(
  from: string,
  mail: OutgoingMail,
  options: { date?: Date; messageId?: string } = {},
): string {
  const sender = parseAddress(from);
  const recipient = parseAddress(mail.to);
  const domain = sender.address.split("@")[1] || "localhost";
  const messageId = options.messageId ?? `<${crypto.randomUUID()}@${domain}>`;
  const headers = [
    `Date: ${formatRfc5322Date(options.date ?? new Date())}`,
    `Message-ID: ${messageId}`,
    `From: ${formatAddress(sender)}`,
    `To: ${formatAddress(recipient)}`,
    `Subject: ${encodeHeaderWord(mail.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${encodeQuotedPrintable(mail.text)}`;
}

/* ----------------------------- session ---------------------------- */

type Reply = { code: number; lines: string[] };

/** Line reader + command/reply pairing on top of one socket. The socket
 *  can be swapped after STARTTLS via attach(). */
class SmtpSession {
  private buffer = "";
  private queue: string[] = [];
  private waiter: ((line: string | Error) => void) | null = null;
  private failure: Error | null = null;
  socket: Socket;

  constructor(socket: Socket) {
    this.socket = socket;
    this.attach(socket);
  }

  private onData = (chunk: Buffer | string) => {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      this.push(line);
      index = this.buffer.indexOf("\n");
    }
  };

  private onError = (error: Error) => this.fail(error);
  private onClose = () =>
    this.fail(new SmtpError("Verbindung vom SMTP-Server getrennt."));
  private onTimeout = () => {
    this.fail(new SmtpError("Zeitüberschreitung bei der SMTP-Verbindung."));
    this.socket.destroy();
  };

  attach(socket: Socket) {
    this.socket = socket;
    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", this.onClose);
    socket.on("timeout", this.onTimeout);
  }

  detach() {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("close", this.onClose);
    this.socket.off("timeout", this.onTimeout);
  }

  private push(line: string) {
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(line);
    } else {
      this.queue.push(line);
    }
  }

  private fail(error: Error) {
    this.failure ??= error;
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(this.failure);
    }
  }

  private readLine(): Promise<string> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiter = (value) => (value instanceof Error ? reject(value) : resolve(value));
    });
  }

  async readReply(): Promise<Reply> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.readLine();
      const code = Number(line.slice(0, 3));
      if (!Number.isInteger(code) || line.length < 3) {
        throw new SmtpError(`Ungültige SMTP-Antwort: ${line.slice(0, 200)}`);
      }
      lines.push(line.slice(4));
      if (line[3] !== "-") return { code, lines };
    }
  }

  async expect(expected: number[], label: string): Promise<Reply> {
    const reply = await this.readReply();
    if (!expected.includes(reply.code)) {
      throw new SmtpError(
        `SMTP ${label} abgelehnt: ${reply.code} ${reply.lines.join(" ")}`.slice(0, 500),
        reply.code,
      );
    }
    return reply;
  }

  write(data: string) {
    this.socket.write(data);
  }

  /** Sends one command line; `label` replaces it in error messages so
   *  credentials never end up in outbox.last_error. */
  command(line: string, expected: number[], label = line): Promise<Reply> {
    this.write(`${line}\r\n`);
    return this.expect(expected, label);
  }

  bufferedLength(): number {
    return this.buffer.length + this.queue.length;
  }
}

/* ---------------------------- transport --------------------------- */

const TIMEOUT_MS = 30_000;

function openSocket(config: SmtpConfig): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket =
      config.secure === "tls"
        ? tlsConnect({ host: config.host, port: config.port, servername: config.host })
        : netConnect({ host: config.host, port: config.port });
    const ready = config.secure === "tls" ? "secureConnect" : "connect";
    const onError = (error: Error) => reject(error);
    socket.once("error", onError);
    socket.once(ready, () => {
      socket.off("error", onError);
      resolve(socket);
    });
    socket.setTimeout(TIMEOUT_MS);
  });
}

function upgradeToTls(socket: Socket, host: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const secure = tlsConnect({ socket, servername: host });
    const onError = (error: Error) => reject(error);
    secure.once("error", onError);
    secure.once("secureConnect", () => {
      secure.off("error", onError);
      secure.setTimeout(TIMEOUT_MS);
      resolve(secure);
    });
  });
}

const capabilities = (reply: Reply): string[] =>
  reply.lines.slice(1).map((line) => line.toUpperCase());

/** Sends exactly one message over a fresh connection. */
export async function sendSmtpMail(
  config: SmtpConfig,
  mail: OutgoingMail,
  options: { helo?: string; date?: Date } = {},
): Promise<void> {
  const recipient = parseAddress(mail.to).address;
  const sender = parseAddress(config.from).address;
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(recipient)) {
    throw new SmtpError(`Ungültige Empfängeradresse: ${recipient}`);
  }
  const helo = options.helo ?? (sender.split("@")[1] || "localhost");

  const session = new SmtpSession(await openSocket(config));
  try {
    await session.expect([220], "Begrüßung");
    let ehlo = await session.command(`EHLO ${helo}`, [250], "EHLO");

    if (config.secure === "starttls") {
      if (!capabilities(ehlo).some((cap) => cap.startsWith("STARTTLS"))) {
        throw new SmtpError("SMTP-Server unterstützt kein STARTTLS.");
      }
      await session.command("STARTTLS", [220]);
      if (session.bufferedLength() > 0) {
        // Data after the 220 before the handshake = injection attempt.
        throw new SmtpError("Unerwartete Daten vor dem TLS-Handshake.");
      }
      session.detach();
      session.socket.on("error", () => undefined);
      session.attach(await upgradeToTls(session.socket, config.host));
      ehlo = await session.command(`EHLO ${helo}`, [250], "EHLO");
    }

    if (config.user) {
      const auth = capabilities(ehlo).find((cap) => cap.startsWith("AUTH")) ?? "";
      if (/\bPLAIN\b/.test(auth) || !/\bLOGIN\b/.test(auth)) {
        const token = Buffer.from(`\0${config.user}\0${config.pass}`, "utf8").toString(
          "base64",
        );
        await session.command(`AUTH PLAIN ${token}`, [235], "AUTH PLAIN");
      } else {
        await session.command("AUTH LOGIN", [334]);
        await session.command(
          Buffer.from(config.user, "utf8").toString("base64"),
          [334],
          "AUTH LOGIN (Benutzer)",
        );
        await session.command(
          Buffer.from(config.pass, "utf8").toString("base64"),
          [235],
          "AUTH LOGIN (Passwort)",
        );
      }
    }

    await session.command(`MAIL FROM:<${sender}>`, [250]);
    await session.command(`RCPT TO:<${recipient}>`, [250, 251]);
    await session.command("DATA", [354]);
    const message = buildMessage(config.from, mail, { date: options.date });
    session.write(`${dotStuff(message)}\r\n.\r\n`);
    await session.expect([250], "Nachricht");
    // QUIT failures after an accepted message do not matter.
    await session.command("QUIT", [221]).catch(() => undefined);
  } finally {
    session.detach();
    // Late socket errors after we are done must not become uncaught.
    session.socket.on("error", () => undefined);
    session.socket.destroy();
  }
}

export function createSmtpTransport(config: SmtpConfig): MailTransport {
  return { send: (mail) => sendSmtpMail(config, mail) };
}
