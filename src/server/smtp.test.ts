/* ------------------------------------------------------------------ */
/* SMTP client tests against a fake in-process SMTP server             */
/* (node:net on 127.0.0.1, port 0) — no external network.              */
/* ------------------------------------------------------------------ */

import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";

import {
  buildMessage,
  dotStuff,
  encodeHeaderWord,
  encodeQuotedPrintable,
  parseAddress,
  sendSmtpMail,
  smtpConfigFromEnv,
  type SmtpConfig,
} from "./smtp";

type FakeOptions = {
  ehlo?: string[];
  starttlsReply?: string;
  authReply?: string;
  rcptReply?: string;
};

type FakeServer = {
  server: Server;
  port: number;
  commands: string[];
  data: string[];
};

/* Speaks just enough SMTP for the client: records every command line and
   the raw DATA payload (still dot-stuffed, as on the wire). */
function startFakeServer(options: FakeOptions = {}): Promise<FakeServer> {
  const commands: string[] = [];
  const data: string[] = [];
  const server = createServer((socket) => {
    let buffer = "";
    let inData = false;
    let payload = "";
    let loginStep = 0;
    socket.write("220 fake.local ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index = buffer.indexOf("\r\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\r\n");
        if (inData) {
          if (line === ".") {
            inData = false;
            data.push(payload);
            payload = "";
            socket.write("250 2.0.0 Ok: queued\r\n");
          } else {
            payload += `${line}\r\n`;
          }
          continue;
        }
        commands.push(line);
        if (loginStep === 1) {
          loginStep = 2;
          socket.write("334 UGFzc3dvcmQ6\r\n");
          continue;
        }
        if (loginStep === 2) {
          loginStep = 0;
          socket.write("235 2.7.0 Authentication successful\r\n");
          continue;
        }
        const verb = line.split(" ")[0]!.toUpperCase();
        if (verb === "EHLO") {
          const caps = options.ehlo ?? ["AUTH PLAIN LOGIN", "8BITMIME"];
          const all = ["fake.local", ...caps];
          socket.write(
            all
              .map((cap, i) => `250${i === all.length - 1 ? " " : "-"}${cap}\r\n`)
              .join(""),
          );
        } else if (verb === "STARTTLS") {
          socket.write(options.starttlsReply ?? "454 4.7.0 TLS not available\r\n");
        } else if (verb === "AUTH") {
          if (line.toUpperCase() === "AUTH LOGIN") {
            loginStep = 1;
            socket.write("334 VXNlcm5hbWU6\r\n");
          } else {
            socket.write(options.authReply ?? "235 2.7.0 Authentication successful\r\n");
          }
        } else if (verb === "MAIL") {
          socket.write("250 2.1.0 Ok\r\n");
        } else if (verb === "RCPT") {
          socket.write(options.rcptReply ?? "250 2.1.5 Ok\r\n");
        } else if (verb === "DATA") {
          inData = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (verb === "QUIT") {
          socket.write("221 2.0.0 Bye\r\n");
          socket.end();
        } else {
          socket.write("502 5.5.2 Error: command not recognized\r\n");
        }
      }
    });
    socket.on("error", () => undefined);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port, commands, data });
    });
  });
}

let fake: FakeServer | null = null;
afterEach(() => {
  fake?.server.close();
  fake = null;
});

const config = (port: number, overrides: Partial<SmtpConfig> = {}): SmtpConfig => ({
  host: "127.0.0.1",
  port,
  user: "schule@example.de",
  pass: "geheim",
  from: "Fahrschule Müller <schule@example.de>",
  secure: "none",
  ...overrides,
});

const MAIL = {
  to: "lena@example.de",
  subject: "Terminbestätigung für Übermorgen",
  text: "Hallo Lena,\n.eine Zeile mit Punkt am Anfang\nBis bald!",
};

describe("sendSmtpMail (plain, fake server)", () => {
  test("runs the full dialogue with AUTH PLAIN and dot-stuffed DATA", async () => {
    fake = await startFakeServer();
    await sendSmtpMail(config(fake.port), MAIL, { helo: "client.local" });

    expect(fake.commands[0]).toBe("EHLO client.local");
    const plain = Buffer.from("\0schule@example.de\0geheim").toString("base64");
    expect(fake.commands).toContain(`AUTH PLAIN ${plain}`);
    expect(fake.commands).toContain("MAIL FROM:<schule@example.de>");
    expect(fake.commands).toContain("RCPT TO:<lena@example.de>");
    expect(fake.commands).toContain("DATA");
    expect(fake.commands.at(-1)).toBe("QUIT");

    const payload = fake.data[0]!;
    expect(payload).toContain("\r\n..eine Zeile mit Punkt am Anfang\r\n");
    expect(payload).toContain("Subject: =?UTF-8?B?");
    expect(payload).toContain("MIME-Version: 1.0\r\n");
    expect(payload).toContain("Content-Type: text/plain; charset=utf-8\r\n");
    expect(payload).toContain("Content-Transfer-Encoding: quoted-printable\r\n");
    expect(payload).toContain("To: lena@example.de\r\n");
    expect(payload).toMatch(/Message-ID: <[^>]+@example\.de>/);
    expect(payload).toMatch(/Date: \w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} \+0000/);
  });

  test("falls back to AUTH LOGIN when PLAIN is not offered", async () => {
    fake = await startFakeServer({ ehlo: ["AUTH LOGIN"] });
    await sendSmtpMail(config(fake.port), MAIL);
    const i = fake.commands.indexOf("AUTH LOGIN");
    expect(i).toBeGreaterThan(0);
    expect(fake.commands[i + 1]).toBe(
      Buffer.from("schule@example.de").toString("base64"),
    );
    expect(fake.commands[i + 2]).toBe(Buffer.from("geheim").toString("base64"));
    expect(fake.data).toHaveLength(1);
  });

  test("skips AUTH without a user", async () => {
    fake = await startFakeServer();
    await sendSmtpMail(config(fake.port, { user: "", pass: "" }), MAIL);
    expect(fake.commands.some((c) => c.startsWith("AUTH"))).toBe(false);
    expect(fake.data).toHaveLength(1);
  });

  test("auth failure rejects without leaking the credentials", async () => {
    fake = await startFakeServer({ authReply: "535 5.7.8 Authentication failed\r\n" });
    const error = await sendSmtpMail(config(fake.port), MAIL).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("535");
    expect((error as Error).message).not.toContain(
      Buffer.from("\0schule@example.de\0geheim").toString("base64"),
    );
    expect(fake.commands.some((c) => c.startsWith("MAIL"))).toBe(false);
  });

  test("rejected recipient surfaces the server reply", async () => {
    fake = await startFakeServer({ rcptReply: "550 5.1.1 User unknown\r\n" });
    await expect(sendSmtpMail(config(fake.port), MAIL)).rejects.toThrow("550");
  });

  test("connection refused rejects", async () => {
    fake = await startFakeServer();
    const port = fake.port;
    fake.server.close();
    fake = null;
    await expect(sendSmtpMail(config(port), MAIL)).rejects.toThrow();
  });
});

describe("sendSmtpMail (STARTTLS)", () => {
  test("refuses to continue when STARTTLS is not advertised", async () => {
    fake = await startFakeServer({ ehlo: ["AUTH PLAIN"] });
    await expect(
      sendSmtpMail(config(fake.port, { secure: "starttls" }), MAIL),
    ).rejects.toThrow("STARTTLS");
    expect(fake.commands.some((c) => c.startsWith("AUTH"))).toBe(false);
  });

  test("issues STARTTLS before AUTH and aborts when the server declines", async () => {
    fake = await startFakeServer({ ehlo: ["STARTTLS", "AUTH PLAIN"] });
    await expect(
      sendSmtpMail(config(fake.port, { secure: "starttls" }), MAIL),
    ).rejects.toThrow("454");
    expect(fake.commands).toEqual(["EHLO example.de", "STARTTLS"]);
  });
});

describe("message encoding", () => {
  test("encodeHeaderWord leaves ASCII alone and base64-encodes UTF-8", () => {
    expect(encodeHeaderWord("Terminbestaetigung")).toBe("Terminbestaetigung");
    const encoded = encodeHeaderWord("Prüfung");
    expect(encoded).toBe(`=?UTF-8?B?${Buffer.from("Prüfung").toString("base64")}?=`);
  });

  test("encodeHeaderWord folds long subjects into ≤75-char words", () => {
    const encoded = encodeHeaderWord("Ä".repeat(80));
    const words = encoded.split("\r\n ");
    expect(words.length).toBeGreaterThan(1);
    for (const word of words) expect(word.length).toBeLessThanOrEqual(75);
    const decoded = words
      .map((w) => Buffer.from(w.slice(10, -2), "base64").toString("utf8"))
      .join("");
    expect(decoded).toBe("Ä".repeat(80));
  });

  test("header values cannot inject new headers", () => {
    const message = buildMessage("a@b.de", {
      to: "x@y.de",
      subject: "Hallo\r\nBcc: evil@z.de",
      text: "",
    });
    expect(message).not.toContain("\r\nBcc:");
  });

  test("quoted-printable encodes umlauts, '=' and trailing spaces, max 76 chars", () => {
    expect(encodeQuotedPrintable("Grüße = ok ")).toBe("Gr=C3=BC=C3=9Fe =3D ok=20");
    const long = encodeQuotedPrintable("ä".repeat(60));
    for (const line of long.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    expect(encodeQuotedPrintable("a\nb")).toBe("a\r\nb");
  });

  test("dotStuff doubles leading dots on every line", () => {
    expect(dotStuff(".a\r\nb\r\n.c")).toBe("..a\r\nb\r\n..c");
  });

  test("parseAddress handles display names", () => {
    expect(parseAddress('"Fahrschule" <a@b.de>')).toEqual({
      name: "Fahrschule",
      address: "a@b.de",
    });
    expect(parseAddress("a@b.de")).toEqual({ name: "", address: "a@b.de" });
  });
});

describe("smtpConfigFromEnv", () => {
  test("null without host or sender", () => {
    expect(smtpConfigFromEnv({})).toBeNull();
    expect(smtpConfigFromEnv({ SMTP_HOST: "smtp.x.de" })).toBeNull();
  });

  test("defaults: 587 → starttls, 465 → tls", () => {
    expect(
      smtpConfigFromEnv({ SMTP_HOST: "smtp.x.de", SMTP_FROM: "a@x.de" })!,
    ).toMatchObject({ port: 587, secure: "starttls" });
    expect(
      smtpConfigFromEnv({
        SMTP_HOST: "smtp.x.de",
        SMTP_FROM: "a@x.de",
        SMTP_PORT: "465",
      })!,
    ).toMatchObject({ port: 465, secure: "tls" });
    expect(
      smtpConfigFromEnv({ SMTP_HOST: "h", SMTP_FROM: "a@x.de", SMTP_SECURE: "tls" })!,
    ).toMatchObject({ port: 465, secure: "tls" });
  });
});
