// Workers entry for the biletoved site (static assets + dynamic routes).
// Referenced as "main" in wrangler.jsonc; static files live in ./public,
// bound as env.ASSETS.
//
//   /api/search    -> flight search function (JSON)
//   /tg            -> Telegram bot webhook (POST from Telegram)
//   everything else -> static files (index.html, search.html, ...)

import { onRequest } from "./functions/search.js";
import { handleTelegram } from "./functions/telegram.js";

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/search" || pathname === "/api/search/") {
      return onRequest({ request, env });
    }
    if (pathname === "/tg" || pathname === "/tg/") {
      return handleTelegram(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
};
