/* ------------------------------------------------------------------ */
/* Security headers, set centrally by src/index.ts on every response   */
/* of the app: the SPA's HTML and assets (production build, spa.ts),   */
/* all /api responses (JSON, PDFs, uploaded files).                    */
/*                                                                     */
/*  - Content-Security-Policy: scripts only from this origin (the     */
/*    bundle has no inline script); inline styles are allowed because */
/*    UI libraries (toasts, charts, popovers) set style attributes;   */
/*    fonts are inlined into the CSS as data: URIs; no framing.       */
/*  - X-Frame-Options / frame-ancestors: no clickjacking.             */
/*  - Referrer-Policy no-referrer: portal and invite URLs carry their  */
/*    token in the path and must never leak via Referer.              */
/*  - Cache-Control no-store on /api: personal data stays out of      */
/*    shared and browser caches (handlers may set their own).        */
/*  - Strict-Transport-Security only with HSTS=1 — set it once the    */
/*    app is reachable exclusively via HTTPS (the reverse proxy may   */
/*    add it instead).                                                */
/* ------------------------------------------------------------------ */

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/* JSON never renders as a document — nothing may load from it. */
const API_CSP = "default-src 'none'; frame-ancestors 'none'";

export const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), payment=(), usb=()";

export type HeaderOptions = {
  /** Add Strict-Transport-Security (HSTS=1). */
  hsts?: boolean;
};

export function hstsFromEnv(env: Record<string, string | undefined> = process.env) {
  return env.HSTS === "1" || env.HSTS === "true";
}

function setBase(headers: Headers, options: HeaderOptions) {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", PERMISSIONS_POLICY);
  if (options.hsts) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

/** Headers for the SPA document (index.html). */
export function documentHeaders(options: HeaderOptions = {}): Headers {
  const headers = new Headers({
    "Content-Type": "text/html;charset=utf-8",
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Cache-Control": "no-cache",
  });
  setBase(headers, options);
  return headers;
}

/** Headers for a hashed, immutable bundle asset (JS/CSS/SVG). */
export function assetHeaders(contentType: string, options: HeaderOptions = {}): Headers {
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  setBase(headers, options);
  return headers;
}

/** Adds the headers to an API response (copying it when its headers
 *  are immutable). */
export function secureApiResponse(response: Response, options: HeaderOptions = {}) {
  let target = response;
  try {
    target.headers.set("X-Content-Type-Options", "nosniff");
  } catch {
    target = new Response(response.body, response);
  }
  const headers = target.headers;
  setBase(headers, options);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  // PDFs and uploaded files open in the browser's own viewer, which a
  // document CSP could break — JSON gets the strictest policy.
  if ((headers.get("Content-Type") ?? "").includes("json")) {
    headers.set("Content-Security-Policy", API_CSP);
  }
  return target;
}

type AnyHandler = (...args: never[]) => Response | Promise<Response>;

/** Wraps every handler of a Bun routes object (function or method map)
 *  so its responses carry the security headers. */
export function secureRoutes<T extends Record<string, unknown>>(
  routes: T,
  options: HeaderOptions = {},
): T {
  const wrap =
    (handler: AnyHandler) =>
    async (...args: never[]) =>
      secureApiResponse(await handler(...args), options);
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(routes)) {
    if (typeof value === "function") {
      out[path] = wrap(value as AnyHandler);
    } else if (value && typeof value === "object" && !(value instanceof Response)) {
      out[path] = Object.fromEntries(
        Object.entries(value as Record<string, AnyHandler>).map(([method, handler]) => [
          method,
          wrap(handler),
        ]),
      );
    } else {
      out[path] = value;
    }
  }
  return out as T;
}
