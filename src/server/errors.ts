/* Dependency-free home of ValidationError so low-level modules (refs.ts)
   can throw it without importing the engine — which would close an
   import cycle through db.ts. engine.ts re-exports it unchanged. */
export class ValidationError extends Error {}

/* The signed-in role may not perform this particular change (answered
   with 403 by handle() in http.ts). */
export class ForbiddenError extends Error {}

/* The server is saturated (e.g. too many password checks at once) —
   answered with 503 by handle(); the client may retry shortly. */
export class BusyError extends Error {}
