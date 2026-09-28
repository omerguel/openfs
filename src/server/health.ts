/* ------------------------------------------------------------------ */
/* GET /api/health — for uptime monitors and the restore script: 200   */
/* with the version while the process serves requests. Public (listed  */
/* in PUBLIC_ROUTES) and mounted outside the tenant guard, so it       */
/* answers on every host; it reveals no school data.                   */
/* ------------------------------------------------------------------ */

import { appVersion } from "./version";

const startedAt = Date.now();

export function healthRoutes() {
  return {
    "/api/health": {
      GET: () =>
        Response.json(
          {
            status: "ok",
            ...appVersion(),
            uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          },
          { headers: { "Cache-Control": "no-store" } },
        ),
    },
  };
}
