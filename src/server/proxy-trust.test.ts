/* TRUST_PROXY: X-Forwarded-Proto/-Host/-For are only believed when the
   operator says a reverse proxy sits in front (http.ts). Checked on the
   helpers and through the fully protected route table (Secure cookie,
   Origin check, audit IP), plus the public health endpoint. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { serve } from "bun";

import { buildApiRoutes } from "./app-routes";
import { createUser, isPublic } from "./auth";
import { openDb } from "./db";
import { healthRoutes } from "./health";
import { clientIp, isHttpsRequest, requestHost, trustProxy } from "./http";
import type { Database } from "./sqlite";
import { APP_VERSION } from "./version";

const original = process.env.TRUST_PROXY;
const setTrust = (on: boolean) => {
  if (on) process.env.TRUST_PROXY = "1";
  else delete process.env.TRUST_PROXY;
};
afterEach(() => {
  if (original === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = original;
});

const proxied = (headers: Record<string, string>) =>
  new Request("http://127.0.0.1:3000/api/x", {
    headers: { Host: "127.0.0.1:3000", ...headers },
  });
const socket = { requestIP: () => ({ address: "127.0.0.1" }) };

describe("forwarded headers (helpers)", () => {
  test("trustProxy reads TRUST_PROXY=1/true, default off", () => {
    expect(trustProxy({})).toBe(false);
    expect(trustProxy({ TRUST_PROXY: "0" })).toBe(false);
    expect(trustProxy({ TRUST_PROXY: "1" })).toBe(true);
    expect(trustProxy({ TRUST_PROXY: "true" })).toBe(true);
  });

  test("without TRUST_PROXY the forwarded headers are ignored", () => {
    setTrust(false);
    const req = proxied({
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": "evil.example",
      "X-Forwarded-For": "203.0.113.9",
    });
    expect(isHttpsRequest(req)).toBe(false);
    expect(requestHost(req)).toBe("127.0.0.1:3000");
    expect(clientIp(req, socket)).toBe("127.0.0.1");
  });

  test("with TRUST_PROXY the last (proxy-written) value counts", () => {
    setTrust(true);
    const req = proxied({
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": "fs-a.openfs.de",
      // A client-sent value first, the proxy appended the real peer.
      "X-Forwarded-For": "10.6.6.6, 198.51.100.7",
    });
    expect(isHttpsRequest(req)).toBe(true);
    expect(requestHost(req)).toBe("fs-a.openfs.de");
    expect(clientIp(req, socket)).toBe("198.51.100.7");
  });

  test("with TRUST_PROXY but no forwarded headers: falls back to the socket", () => {
    setTrust(true);
    const req = proxied({});
    expect(isHttpsRequest(req)).toBe(false);
    expect(requestHost(req)).toBe("127.0.0.1:3000");
    expect(clientIp(req, socket)).toBe("127.0.0.1");
  });
});

describe("through the guarded API", () => {
  let db: Database;
  let server: ReturnType<typeof serve>;
  let base: string;

  beforeEach(async () => {
    db = openDb(":memory:");
    await createUser(db, {
      email: "chefin@fs.de",
      name: "Chefin",
      password: "geheim-geheim",
      role: "inhaber",
    });
    server = serve({
      port: 0,
      routes: {
        ...healthRoutes(),
        ...buildApiRoutes(db, { auth: { loginRateLimit: false } }),
      },
      fetch: () => new Response("not found", { status: 404 }),
    });
    base = `http://127.0.0.1:${server.port}`;
  });
  afterEach(() => server.stop(true));

  const login = (headers: Record<string, string> = {}) =>
    fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ email: "chefin@fs.de", password: "geheim-geheim" }),
    });

  test("Secure cookie only for a trusted X-Forwarded-Proto: https", async () => {
    setTrust(false);
    const spoofed = await login({ "X-Forwarded-Proto": "https" });
    expect(spoofed.headers.get("set-cookie")).not.toContain("Secure");

    setTrust(true);
    const behindTls = await login({ "X-Forwarded-Proto": "https" });
    expect(behindTls.headers.get("set-cookie")).toContain("; Secure");
    const plain = await login();
    expect(plain.headers.get("set-cookie")).not.toContain("Secure");
  });

  test("Origin check compares against the forwarded host only when trusted", async () => {
    setTrust(true);
    const cookie = (await login()).headers.get("set-cookie")!.split(";")[0]!;
    const write = (headers: Record<string, string>) =>
      fetch(`${base}/api/vehicles`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie, ...headers },
        body: JSON.stringify({ model: "Golf", plate: "DA-X 1", klass: "B" }),
      });
    const proxyHeaders = {
      "X-Forwarded-Host": "fs.example.de",
      "X-Forwarded-Proto": "https",
    };
    expect(
      (await write({ ...proxyHeaders, Origin: "https://fs.example.de" })).status,
    ).toBe(201);
    expect(
      (await write({ ...proxyHeaders, Origin: "https://evil.example" })).status,
    ).toBe(403);

    // Untrusted: a forged X-Forwarded-Host cannot make a foreign Origin pass.
    setTrust(false);
    expect(
      (
        await write({
          "X-Forwarded-Host": "evil.example",
          Origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
  });

  test("audit log records the forwarded client IP only when trusted", async () => {
    setTrust(true);
    await login({ "X-Forwarded-For": "198.51.100.7" });
    setTrust(false);
    await login({ "X-Forwarded-For": "203.0.113.9" });
    const ips = db
      .query<{ ip: string }, []>(
        "SELECT ip FROM audit_log WHERE method = 'LOGIN' ORDER BY id",
      )
      .all()
      .map((row) => row.ip);
    expect(ips[0]).toBe("198.51.100.7");
    expect(ips[1]).not.toBe("203.0.113.9");
  });

  test("GET /api/health is public and reports the version", async () => {
    expect(isPublic("GET", "/api/health")).toBe(true);
    expect(isPublic("POST", "/api/health")).toBe(false);
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", version: APP_VERSION });
    expect(typeof body.commit).toBe("string");
  });
});
