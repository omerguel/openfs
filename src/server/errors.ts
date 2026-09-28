/* Dependency-free home of ValidationError so low-level modules (refs.ts)
   can throw it without importing the engine — which would close an
   import cycle through db.ts. engine.ts re-exports it unchanged. */
export class ValidationError extends Error {}
