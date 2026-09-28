/* ------------------------------------------------------------------ */
/* Einladungslinks — a one-time link with which a new (or locked-out)   */
/* staff member sets their own password, so the Inhaber never has to   */
/* invent and pass on passwords. Only the SHA-256 of the token is      */
/* stored (like sessions); a link is valid for 7 days and once. With   */
/* SMTP configured the link is also mailed via the outbox, otherwise   */
/* the Inhaber copies it. Table: user_invites (auth.ts DDL).           */
/*                                                                     */
/*   POST /api/users/:id/invite       Inhaber (OWNER_ONLY via /api/users) */
/*   GET  /api/auth/invite/:token     public — who is invited          */
/*   POST /api/auth/invite/:token     public — set password, sign in   */
/* ------------------------------------------------------------------ */

import type { BunRequest } from "bun";

import type { Database } from "./sqlite";

import {
  audit,
  createSession,
  sessionCookie,
  updateUser,
  type UserRecord,
  listUsers,
} from "./auth";
import { ValidationError } from "./errors";
import { clientIp, err, handle, json, type RequestIPSource } from "./http";
import { mailSchool, queueMail } from "./mail";
import { requestContext } from "./request-context";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function sha256(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** New one-time token for `userId`; earlier unused links stop working. */
export function createInvite(
  db: Database,
  userId: number,
  now = Date.now(),
): { token: string; expiresAt: string } {
  const user = listUsers(db).find((u) => u.id === userId);
  if (!user) throw new ValidationError("Benutzer nicht gefunden.");
  if (!user.active) throw new ValidationError("Der Zugang ist gesperrt.");
  const token = newToken();
  db.transaction(() => {
    db.prepare("DELETE FROM user_invites WHERE user_id = ? AND used_at IS NULL").run(
      userId,
    );
    db.prepare(
      "INSERT INTO user_invites (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    ).run(sha256(token), userId, now + INVITE_TTL_MS);
  })();
  return { token, expiresAt: new Date(now + INVITE_TTL_MS).toISOString() };
}

type InviteRow = { user_id: number; expires_at: number; used_at: string | null };

function validInvite(db: Database, token: string, now: number): UserRecord | null {
  const row = db
    .query<InviteRow, [string]>(
      "SELECT user_id, expires_at, used_at FROM user_invites WHERE token_hash = ?",
    )
    .get(sha256(token));
  if (!row || row.used_at || row.expires_at < now) return null;
  const user = listUsers(db).find((u) => u.id === row.user_id);
  return user?.active ? user : null;
}

export function inviteInfo(db: Database, token: string, now = Date.now()) {
  const user = validInvite(db, token, now);
  return user ? { name: user.name, email: user.email } : null;
}

/** Sets the password (rules as everywhere) and uses up the link. */
export async function acceptInvite(
  db: Database,
  token: string,
  password: unknown,
  now = Date.now(),
): Promise<UserRecord> {
  const user = validInvite(db, token, now);
  if (!user) {
    throw new ValidationError(
      "Dieser Einladungslink ist ungültig, abgelaufen oder wurde schon benutzt.",
    );
  }
  const updated = await updateUser(db, user.id, { password });
  db.prepare(
    "UPDATE user_invites SET used_at = datetime('now') WHERE token_hash = ?",
  ).run(sha256(token));
  return updated;
}

function inviteMailBody(name: string, school: string, url: string) {
  return [
    `Hallo ${name},`,
    "",
    `Sie wurden zu OpenFS von ${school || "Ihrer Fahrschule"} eingeladen.`,
    "Über diesen Link legen Sie Ihr Passwort fest (gültig 7 Tage, einmal verwendbar):",
    "",
    url,
    "",
    "Danach melden Sie sich mit Ihrer E-Mail-Adresse und dem neuen Passwort an.",
  ].join("\n");
}

function dbOf(fallback: Database): Database {
  return requestContext.getStore()?.db ?? fallback;
}

export type InviteRouteOptions = {
  /** SMTP configured — the link is also sent by e-mail. */
  mailConfigured?: boolean;
};

export function inviteRoutes(fallbackDb: Database, options: InviteRouteOptions = {}) {
  return {
    "/api/users/:id/invite": {
      POST: (req: BunRequest<"/api/users/:id/invite">) =>
        handle(async () => {
          const db = dbOf(fallbackDb);
          const id = Number(req.params.id);
          if (!Number.isInteger(id)) throw new ValidationError("Ungültige Benutzer-ID.");
          const body = (await req.json().catch(() => ({}))) as { send?: unknown };
          const origin = req.headers.get("origin") ?? new URL(req.url).origin;
          const { token, expiresAt } = createInvite(db, id);
          const url = `${origin}/einladung/${token}`;
          const user = listUsers(db).find((u) => u.id === id)!;
          let mailed = false;
          if (body.send !== false && options.mailConfigured) {
            const school = mailSchool(db).name;
            queueMail(db, {
              recipient: user.email,
              subject: `Einladung zu OpenFS${school ? ` – ${school}` : ""}`,
              bodyText: inviteMailBody(user.name, school, url),
              kind: "generic",
              relatedType: "user",
              relatedId: id,
            });
            mailed = true;
          }
          return json({ url, expiresAt, mailed }, 201);
        })(),
    },

    "/api/auth/invite/:token": {
      GET: (req: BunRequest<"/api/auth/invite/:token">) =>
        handle(() => {
          const info = inviteInfo(dbOf(fallbackDb), req.params.token);
          return info
            ? json(info)
            : err(
                "Dieser Einladungslink ist ungültig, abgelaufen oder wurde schon benutzt.",
                404,
              );
        })(),
      POST: (req: BunRequest<"/api/auth/invite/:token">, server: RequestIPSource) =>
        handle(async () => {
          const db = dbOf(fallbackDb);
          const body = (await req.json().catch(() => ({}))) as { password?: unknown };
          const user = await acceptInvite(db, req.params.token, body.password);
          audit(db, {
            user,
            method: "INVITE",
            path: "/api/auth/invite",
            status: 200,
            ip: clientIp(req, server),
          });
          const token = createSession(db, user.id, {
            ip: clientIp(req, server),
            userAgent: req.headers.get("user-agent") ?? "",
          });
          return new Response(JSON.stringify({ user }), {
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": sessionCookie(req, token, SESSION_MAX_AGE),
            },
          });
        })(),
    },
  };
}
