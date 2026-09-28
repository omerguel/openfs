import { ForbiddenError, ValidationError } from "./errors";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export function handle<A extends unknown[]>(
  fn: (...args: A) => Response | Promise<Response>,
) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ValidationError) {
        return err(error.message);
      }
      if (error instanceof ForbiddenError) {
        return err(error.message, 403);
      }
      console.error(error);
      return err("Interner Fehler.", 500);
    }
  };
}

/* ------------------------------------------------------------------ */
/* Per-IP rate limiting for the deliberately public endpoints.         */
/* In-memory and per-process (same caveat as appointment-requests.ts): */
/* a load-balanced deployment would need a shared store.               */
/* ------------------------------------------------------------------ */

export type RateLimit = { max: number; windowMs: number };

/** Structural subset of Bun's Server — keeps handlers assignable to
 *  Bun.serve()'s generic route-handler type. */
export type RequestIPSource = {
  requestIP(req: Request): { address: string } | null;
};

/* ------------------------------------------------------------------ */
/* Reverse proxy trust. X-Forwarded-Proto/-Host/-For are only believed */
/* with TRUST_PROXY=1 — i.e. when the server listens on loopback (or a */
/* private network) behind Caddy/nginx, which overwrite or append      */
/* these headers. Without it, a client could fake HTTPS, its IP (rate  */
/* limits, audit log) or the host the Origin check compares against.  */
/* With several comma-separated values the last one counts: it was    */
/* written by the proxy directly in front of us.                       */
/* ------------------------------------------------------------------ */

export function trustProxy(env: Record<string, string | undefined> = process.env) {
  return env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true";
}

function forwarded(req: Request, name: string): string | null {
  if (!trustProxy()) return null;
  const value = req.headers.get(name)?.split(",").at(-1)?.trim();
  return value || null;
}

/** True when the client reached us via HTTPS (directly, or via a trusted
 *  proxy that terminated TLS). Decides the cookie's Secure flag. */
export function isHttpsRequest(req: Request): boolean {
  return (
    new URL(req.url).protocol === "https:" ||
    forwarded(req, "x-forwarded-proto") === "https"
  );
}

/** Host the client asked for (X-Forwarded-Host behind a trusted proxy). */
export function requestHost(req: Request): string | null {
  return forwarded(req, "x-forwarded-host") ?? req.headers.get("host");
}

export function clientIp(req: Request, server?: RequestIPSource): string {
  return (
    forwarded(req, "x-forwarded-for") ?? server?.requestIP(req)?.address ?? "unknown"
  );
}

/** Counts only failures (e.g. wrong passwords): `blocked(key)` is true
 *  once `key` has `max` failures within `windowMs`; `fail(key)` records
 *  one, `reset(key)` forgets them (successful login). `false` disables. */
export function createFailureLimiter(limit: RateLimit | false) {
  const failures = new Map<string, number[]>();
  const recent = (key: string, now: number) =>
    limit ? (failures.get(key) ?? []).filter((t) => t > now - limit.windowMs) : [];
  return {
    blocked(key: string, now = Date.now()): boolean {
      return limit ? recent(key, now).length >= limit.max : false;
    },
    fail(key: string, now = Date.now()) {
      if (!limit) return;
      if (failures.size > 10_000) {
        for (const k of failures.keys()) {
          if (recent(k, now).length === 0) failures.delete(k);
        }
      }
      failures.set(key, [...recent(key, now), now]);
    },
    reset(key: string) {
      failures.delete(key);
    },
  };
}

/** Returns `limited(key)`: true once `key` exceeded `max` hits within
 *  `windowMs`. `false` disables limiting (tests). */
export function createRateLimiter(limit: RateLimit | false) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()): boolean => {
    if (!limit) return false;
    const cutoff = now - limit.windowMs;
    // Keep the map bounded under many distinct clients.
    if (hits.size > 10_000) {
      for (const [k, times] of hits) {
        if (!times.some((t) => t > cutoff)) hits.delete(k);
      }
    }
    const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
    const limited = recent.length >= limit.max;
    if (!limited) recent.push(now);
    hits.set(key, recent);
    return limited;
  };
}
