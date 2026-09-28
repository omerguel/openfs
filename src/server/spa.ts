/* ------------------------------------------------------------------ */
/* Production SPA: bundles src/index.html once at startup (in memory,  */
/* same Bun.build + Tailwind setup as scripts/build-renderer.ts) and   */
/* serves the files with our own headers — Bun's HTML-import routes    */
/* offer no way to add a Content-Security-Policy or X-Frame-Options.   */
/* Development keeps the HTML import (hot reloading) in src/index.ts.  */
/* ------------------------------------------------------------------ */

import { join } from "node:path";

import { assetHeaders, documentHeaders, type HeaderOptions } from "./security-headers";

type StaticRoute = () => Response;

/** Routes for every bundle file plus "/*" → index.html (client routing). */
export async function buildSpaRoutes(
  options: HeaderOptions = {},
): Promise<Record<string, StaticRoute>> {
  const { default: tailwind } = await import("bun-plugin-tailwind");
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "..", "index.html")],
    target: "browser",
    minify: true,
    // Absolute asset URLs: the page is served under every client route.
    publicPath: "/",
    define: { "process.env.NODE_ENV": '"production"' },
    env: "BUN_PUBLIC_*",
    plugins: [tailwind],
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("Die Oberfläche konnte nicht gebaut werden.");
  }

  const routes: Record<string, StaticRoute> = {};
  let html: string | null = null;
  for (const output of result.outputs) {
    const name = output.path.replace(/^\.\//, "");
    if (name === "index.html") {
      html = await output.text();
      continue;
    }
    const bytes = new Uint8Array(await output.arrayBuffer());
    const type = output.type;
    routes[`/${name}`] = () =>
      new Response(bytes, { headers: assetHeaders(type, options) });
  }
  if (html === null) throw new Error("index.html fehlt im Build.");
  const page = html;
  routes["/*"] = () => new Response(page, { headers: documentHeaders(options) });
  return routes;
}
