// Workers entry for the biletoved site (static assets + one dynamic API route).
// Referenced as "main" in wrangler.jsonc; static files live in ./public,
// bound as env.ASSETS.
//
//   /api/search    -> flight search function (JSON)
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
