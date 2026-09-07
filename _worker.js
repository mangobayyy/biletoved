// Workers entry for the biletoved site (static assets + one dynamic API route).
// Cloudflare uses this file as the Worker (either via "main" in wrangler.jsonc
// or by auto-detecting _worker.js in the assets directory).
//
//   /api/search   -> flight search function (JSON)
//   everything else -> static files (index.html, search.html, ...)

import { onRequest } from "./functions/search.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/search" || pathname === "/api/search/") {
      return onRequest({ request, env });
    }
    return env.ASSETS.fetch(request);
  },
};
