import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { serve } from "bun";

import { buildApiRoutes } from "./app-routes";
import { createUser, verifyLogin } from "./auth";
import { openDb } from "./db";
import { acceptInvite, createInvite, inviteInfo, INVITE_TTL_MS } from "./invites";
import type { Database } from "./sqlite";

let db: Database;
let server: ReturnType<typeof serve>;
let base: string;

beforeEach(() => {
  db = openDb(":memory:");
});
afterEach(() => server?.stop(true));

async function seed() {
  await createUser(db, {
    email: "chefin@fs.de",
    name: "Chefin",
    password: "geheim-geheim",
    role: "inhaber",
  });
  await createUser(db, {
    email: "buero@fs.de",
    name: "Büro",
    password: "geheim-geheim",
    role: "buero",
  });
}

async function login(email: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    body: JSON.stringify({ email, password: "geheim-geheim" }),
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

describe("Einladungslinks", () => {
  test("an invited user sets their own password once; the link then expires", async () => {
    await seed();
    const invited = await createUser(db, {
      email: "neu@fs.de",
      name: "Neu",
      role: "fahrlehrer",
      invite: true,
    });
    // No usable password before accepting.
    expect(await verifyLogin(db, "neu@fs.de", "")).toBeNull();
    const { token } = createInvite(db, invited.id);
    expect(inviteInfo(db, token)).toEqual({ name: "Neu", email: "neu@fs.de" });
    await expect(acceptInvite(db, token, "kurz")).rejects.toThrow("mindestens");
    await acceptInvite(db, token, "mein-neues-passwort");
    expect(await verifyLogin(db, "neu@fs.de", "mein-neues-passwort")).not.toBeNull();
    expect(inviteInfo(db, token)).toBeNull();
    await expect(acceptInvite(db, token, "noch-ein-passwort")).rejects.toThrow(
      "ungültig",
    );
  });

  test("a new link replaces the old one; links expire after 7 days", async () => {
    await seed();
    const user = await createUser(db, {
      email: "x@fs.de",
      name: "X",
      role: "buero",
      invite: true,
    });
    const first = createInvite(db, user.id, 1_000);
    const second = createInvite(db, user.id, 1_000);
    expect(inviteInfo(db, first.token, 2_000)).toBeNull();
    expect(inviteInfo(db, second.token, 2_000)).not.toBeNull();
    expect(inviteInfo(db, second.token, 1_000 + INVITE_TTL_MS + 1)).toBeNull();
  });

  test("HTTP: only the Inhaber creates links; accepting signs the user in", async () => {
    await seed();
    server = serve({
      port: 0,
      routes: buildApiRoutes(db, { auth: { loginRateLimit: false } }),
    });
    base = `http://localhost:${server.port}`;
    const user = await createUser(db, {
      email: "lehrer@fs.de",
      name: "Lehrer",
      role: "fahrlehrer",
      invite: true,
    });
    const office = await login("buero@fs.de");
    const denied = await fetch(`${base}/api/users/${user.id}/invite`, {
      method: "POST",
      headers: { cookie: office },
    });
    expect(denied.status).toBe(403);

    const owner = await login("chefin@fs.de");
    const res = await fetch(`${base}/api/users/${user.id}/invite`, {
      method: "POST",
      headers: { cookie: owner },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const { url, mailed } = (await res.json()) as { url: string; mailed: boolean };
    expect(mailed).toBe(false); // no SMTP in tests — the link is copied instead
    const token = url.split("/einladung/")[1]!;

    const info = await fetch(`${base}/api/auth/invite/${token}`);
    expect(info.status).toBe(200);
    const accept = await fetch(`${base}/api/auth/invite/${token}`, {
      method: "POST",
      body: JSON.stringify({ password: "lehrer-passwort" }),
    });
    expect(accept.status).toBe(200);
    const cookie = accept.headers.get("set-cookie")!.split(";")[0]!;
    const status = (await (
      await fetch(`${base}/api/auth/status`, { headers: { cookie } })
    ).json()) as { user: { email: string } };
    expect(status.user.email).toBe("lehrer@fs.de");
    expect((await fetch(`${base}/api/auth/invite/${token}`)).status).toBe(404);
  });
});
