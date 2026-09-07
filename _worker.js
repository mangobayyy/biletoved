// Workers entry for the biletoved site (static assets + one dynamic route).
// Cloudflare picks this up automatically ("main" in wrangler.jsonc).
//   /search        -> flight search function
//   everything else -> static files from this directory (index.html, search.html, ...)

import { onRequest } from "./functions/search.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/search" || pathname === "/search/") {
      return onRequest({ request, env });
    }
    return env.ASSETS.fetch(request);
  },
};
