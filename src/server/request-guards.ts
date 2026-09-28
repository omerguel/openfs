/* ------------------------------------------------------------------ */
/* Request shape checks shared by the API guard (auth.ts) and the      */
/* platform signup (tenancy.ts):                                       */
/*                                                                     */
/*  - body size: Bun.serve's maxRequestBodySize (src/index.ts) rejects */
/*    oversized bodies that announce a Content-Length, but not chunked */
/*    ones — limitBody() caps those while reading the stream.          */
/*  - Content-Type: JSON endpoints only accept application/json, so a  */
/*    cross-site "simple" request (text/plain form post) never reaches */
/*    a handler; uploads are the only multipart endpoints.             */
/* ------------------------------------------------------------------ */

import { err, type RequestIPSource } from "./http";

/** Server-wide cap (uploads are max. 12 MB plus multipart overhead). */
export const MAX_REQUEST_BODY_BYTES = 16 * 1024 * 1024;

/** Cap for the public (no sign-in) endpoints — small forms only. */
export const PUBLIC_BODY_LIMIT_BYTES = 64 * 1024;

const TOO_LARGE = "Die Anfrage ist zu groß.";

/* Multipart uploads: the student documents endpoint only. */
const MULTIPART_ROUTES = [/^\/api\/students\/[^/]+\/files$/];

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

function hasBody(req: Request): boolean {
  const length = req.headers.get("content-length");
  if (length !== null) return Number(length) > 0;
  return req.headers.has("transfer-encoding");
}

/** 415 unless a body-carrying POST/PUT/PATCH is JSON (or multipart on an
 *  upload route). Requests without a body pass (e.g. "Erneut senden"). */
export function checkContentType(
  req: Request,
  method: string,
  path: string,
): Response | null {
  if (!BODY_METHODS.has(method) || !hasBody(req)) return null;
  const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type === "application/json") return null;
  if (type === "multipart/form-data" && MULTIPART_ROUTES.some((p) => p.test(path))) {
    return null;
  }
  return err("Nicht unterstützter Inhaltstyp — erwartet wird application/json.", 415);
}

type Limited<R extends Request> =
  | { req: R; server: RequestIPSource | undefined }
  | Response;

/** Enforces `maxBytes` on the request body. A declared Content-Length is
 *  checked up front; a chunked body is read with a running count (413 as
 *  soon as it exceeds the cap) and handed on as a buffered copy — with a
 *  server wrapper so requestIP() still resolves the original socket. */
export async function limitBody<R extends Request>(
  req: R,
  server: RequestIPSource | undefined,
  maxBytes: number,
): Promise<Limited<R>> {
  const length = req.headers.get("content-length");
  if (length !== null) {
    return Number(length) > maxBytes ? err(TOO_LARGE, 413) : { req, server };
  }
  if (!req.body || !req.headers.has("transfer-encoding")) return { req, server };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return err(TOO_LARGE, 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(req.headers);
  headers.delete("transfer-encoding");
  headers.set("content-length", String(total));
  const copy = new Request(req.url, { method: req.method, headers, body });
  // Route params (BunRequest) travel with the copy.
  Object.defineProperty(copy, "params", {
    value: (req as { params?: unknown }).params ?? {},
  });
  return {
    req: copy as R,
    server: { requestIP: (r) => server?.requestIP(r === copy ? req : r) ?? null },
  };
}
