/**
 * Telegram-бот «Билетовед». Тот же поиск, что и /api/search, только через
 * Telegram. ../_worker.js направляет сюда POST /tg (webhook от Telegram).
 *
 * Секреты воркера:
 *   TELEGRAM_BOT_TOKEN       — токен бота от @BotFather
 *   TELEGRAM_WEBHOOK_SECRET  — произвольная строка; Telegram шлёт её в
 *                              заголовке X-Telegram-Bot-Api-Secret-Token,
 *                              задаётся при setWebhook (?secret_token=...)
 *   TRAVELPAYOUTS_TOKEN      — уже используется search.js
 *
 * Регистрация webhook (один раз, после деплоя):
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *     -d url=https://biletoved.mangobayyy.workers.dev/tg \
 *     -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
 *
 * Команды в чате:
 *   /search DPS 2026-11 21
 *   /search Денпасар ноя 21 from=LED adults=2 children=1
 *   DPS 11 21                 (слэш и год необязательны)
 *   /help                     — подсказка
 */

import { parseQuery, search } from "./search.js";

const MAX_ROWS = 12;

const HELP = [
  "✈️ <b>Билетовед</b> — поиск самой выгодной поездки по всему месяцу.",
  "",
  "<b>Формат:</b>",
  "<code>/search КУДА МЕСЯЦ НОЧЕЙ [опции]</code>",
  "",
  "<b>Примеры:</b>",
  "<code>/search DPS 2026-11 21</code>",
  "<code>/search DPS 11 21 from=LED adults=2 children=1</code>",
  "<code>DPS ноя 14</code>",
  "",
  "<b>КУДА</b> — IATA-код (DPS) или город (Денпасар, Бали).",
  "<b>МЕСЯЦ</b> — <code>2026-11</code>, номер <code>11</code> или <code>ноя</code>.",
  "<b>НОЧЕЙ</b> — сколько ночей в поездке (для oneway не нужно).",
  "",
  "<b>Опции</b> (через пробел, <code>ключ=значение</code>):",
  "<code>from</code> — откуда (по умолчанию MOW)",
  "<code>adults</code> <code>children</code> <code>infants</code> — пассажиры",
  "<code>oneway=1</code> — в одну сторону",
  "<code>direct=1</code> — только прямые",
  "<code>maxstops</code> — макс. пересадок в одну сторону (по умолч. 1)",
  "<code>maxlayover</code> — макс. часов на стыковку (по умолч. 5)",
  "<code>currency</code> — rub / usd / eur (по умолч. rub)",
  "<code>through</code> — конец диапазона месяцев, напр. <code>2026-12</code>",
  "<code>top</code> — сколько дат вернуть",
].join("\n");

// частичный словарь городов -> IATA, чтобы можно было писать по-русски.
const CITY = {
  "денпасар": "DPS", "бали": "DPS", "москва": "MOW", "питер": "LED",
  "санктпетербург": "LED", "спб": "LED", "сочи": "AER", "стамбул": "IST",
  "бангкок": "BKK", "пхукет": "HKT", "дубай": "DXB", "ереван": "EVN",
  "тбилиси": "TBS", "минск": "MSQ", "казань": "KZN", "екатеринбург": "SVX",
  "новосибирск": "OVB", "калининград": "KGD", "анталья": "AYT", "анталия": "AYT",
  "коломбо": "CMB", "мале": "MLE", "мальдивы": "MLE", "гоа": "GOI",
  "дели": "DEL", "куала-лумпур": "KUL", "куалалумпур": "KUL", "сингапур": "SIN",
  "хошимин": "SGN", "ханой": "HAN", "токио": "TYO", "сеул": "SEL",
  "пекин": "BJS", "шанхай": "SHA", "гонконг": "HKG", "париж": "PAR",
  "лондон": "LON", "рим": "ROM", "барселона": "BCN", "мадрид": "MAD",
  "берлин": "BER", "прага": "PRG", "амстердам": "AMS", "белград": "BEG",
};

const MONTHS = {
  "янв": 1, "январь": 1, "января": 1, "фев": 2, "февраль": 2, "февраля": 2,
  "мар": 3, "март": 3, "марта": 3, "апр": 4, "апрель": 4, "апреля": 4,
  "май": 5, "мая": 5, "июн": 6, "июнь": 6, "июня": 6, "июл": 7, "июль": 7, "июля": 7,
  "авг": 8, "август": 8, "августа": 8, "сен": 9, "сент": 9, "сентябрь": 9, "сентября": 9,
  "окт": 10, "октябрь": 10, "октября": 10, "ноя": 11, "нояб": 11, "ноябрь": 11, "ноября": 11,
  "дек": 12, "декабрь": 12, "декабря": 12,
};

const SYM = { rub: "₽", usd: "$", eur: "€", kzt: "₸", try: "₺", thb: "฿", gbp: "£" };

export async function handleTelegram(request, env, ctx) {
  if (request.method !== "POST") return new Response("ok");
  if (
    env.TELEGRAM_WEBHOOK_SECRET &&
    request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return new Response("forbidden", { status: 403 });
  }
  if (!env.TELEGRAM_BOT_TOKEN) return new Response("no bot token", { status: 500 });

  let update;
  try { update = await request.json(); } catch { return new Response("ok"); }

  const msg = update.message || update.edited_message;
  const text = msg && typeof msg.text === "string" ? msg.text.trim() : "";
  if (!msg || !text) return new Response("ok");
  const chatId = msg.chat.id;

  if (/^\/(start|help)\b/i.test(text) || text === "/search" || text === "/search@") {
    ctx.waitUntil(tgSend(env, chatId, HELP));
    return new Response("ok");
  }

  let params;
  try {
    params = parseBotQuery(text);
  } catch (e) {
    ctx.waitUntil(tgSend(env, chatId, "⚠️ " + esc(String(e.message || e)) + "\n\nНапишите /help для формата."));
    return new Response("ok");
  }

  ctx.waitUntil(runSearch(env, chatId, params));
  return new Response("ok");
}

async function runSearch(env, chatId, params) {
  const from = params.get("from"), to = params.get("to");
  const month = params.get("month"), nights = params.get("nights");
  const range = params.get("through") ? `${month}…${params.get("through")}` : month;
  const trip = params.get("oneway") === "1" ? "в одну сторону" : `${nights} ноч.`;
  await tgSend(env, chatId, `🔎 Ищу <b>${esc(from)} → ${esc(to)}</b>, ${esc(range)}, ${esc(trip)}…\nСканирую месяц по дням вылета, это ~10–30 сек.`);

  try {
    const q = parseQuery(params);
    const res = await search(q, env.TRAVELPAYOUTS_TOKEN);
    for (const chunk of formatResults(res)) {
      await tgSend(env, chatId, chunk, { preview: false });
    }
  } catch (e) {
    await tgSend(env, chatId, "❌ " + esc(String(e.message || e)));
  }
}

// ---- парсер команды -------------------------------------------------------

function parseBotQuery(text) {
  let t = text.replace(/^\/search(@\w+)?\s*/i, "").trim();
  if (!t) throw new Error("нужно: КУДА МЕСЯЦ НОЧЕЙ, напр. DPS 2026-11 21");

  const opts = {};
  const positional = [];
  for (const tok of t.split(/\s+/)) {
    const m = /^([a-zA-Zа-яА-Я]+)=(.*)$/.exec(tok);
    if (m) opts[m[1].toLowerCase()] = m[2];
    else positional.push(tok);
  }
  if (positional.length < 2) throw new Error("мало данных. Нужно: КУДА МЕСЯЦ [НОЧЕЙ]. Пример: DPS 2026-11 21");

  const p = new URLSearchParams();
  p.set("to", resolvePlace(positional[0], "to"));
  p.set("month", resolveMonth(positional[1]));

  const oneway = opts.oneway === "1" || opts.oneway === "true";
  if (oneway) p.set("oneway", "1");
  if (positional[2] != null) {
    const n = parseInt(positional[2], 10);
    if (!isNaN(n)) p.set("nights", String(n));
  }
  if (!p.has("nights") && !oneway) p.set("nights", "14");

  p.set("from", resolvePlace(opts.from || "MOW", "from"));
  for (const [k, dst] of [["adults", "adults"], ["children", "children"], ["infants", "infants"], ["top", "top"], ["currency", "currency"]]) {
    if (opts[k] != null && opts[k] !== "") p.set(dst, opts[k]);
  }
  if (opts.through) p.set("through", resolveMonth(opts.through));
  if (opts.direct === "1" || opts.direct === "true") p.set("direct", "1");
  if (opts.maxstops != null && opts.maxstops !== "") p.set("maxStops", opts.maxstops);
  if (opts.maxlayover != null && opts.maxlayover !== "") p.set("maxLayoverH", opts.maxlayover);
  return p;
}

function resolvePlace(raw, field) {
  const s = String(raw).trim();
  if (/^[A-Za-z]{3}$/.test(s)) return s.toUpperCase();
  const key = s.toLowerCase().replace(/[\s.\-]/g, "");
  if (CITY[key]) return CITY[key];
  throw new Error(`не понял город «${s}» (${field}). Дайте IATA-код из 3 букв, напр. DPS.`);
}

function resolveMonth(raw) {
  const s = String(raw).trim().toLowerCase();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const now = new Date();
  const curY = now.getUTCFullYear(), curM = now.getUTCMonth() + 1;

  let mo = null;
  if (/^\d{1,2}$/.test(s)) mo = parseInt(s, 10);
  else {
    for (const key of Object.keys(MONTHS)) {
      if (s.startsWith(key)) { mo = MONTHS[key]; break; }
    }
  }
  if (!mo || mo < 1 || mo > 12) throw new Error(`не понял месяц «${raw}». Форматы: 2026-11, 11, ноя.`);
  const year = mo >= curM ? curY : curY + 1;
  return `${year}-${String(mo).padStart(2, "0")}`;
}

// ---- вывод --------------------------------------------------------------

function formatResults(res) {
  const cur = (res.query.currency || "rub").toLowerCase();
  const sym = SYM[cur] || cur.toUpperCase();
  const rows = res.rows || [];
  if (!rows.length) {
    return [
      `😕 Ничего не нашлось для <b>${esc(res.query.from)} → ${esc(res.query.to)}</b> на ${esc(res.query.month)}.\n` +
      `Просканировано дней: ${res.meta.daysScanned}, с данными: ${res.meta.daysWithData}. ` +
      `Попробуйте другой месяц, больше пересадок (<code>maxstops=2</code>) или <code>maxlayover=</code>.`,
    ];
  }

  const cheapest = Math.min(...rows.map((r) => r.familyTotal));
  const head =
    `✈️ <b>${esc(res.query.from)} → ${esc(res.query.to)}</b> · ${esc(res.query.month)}` +
    (res.query.through ? `…${esc(res.query.through)}` : "") +
    (res.query.oneway ? " · в одну сторону" : ` · ${res.query.nights} ноч.`) +
    `\nПассажиров: ${res.query.adults}+${res.query.children}+${res.query.infants} · ` +
    `цена — за всю семью · дат найдено: ${rows.length}`;

  const lines = rows.slice(0, MAX_ROWS).map((r) => {
    const tag = r.familyTotal === cheapest ? "💰 " : "";
    const when = res.query.oneway ? `<b>${esc(r.depart)}</b>` : `<b>${esc(r.depart)}</b> → ${esc(r.return)}`;
    const times = res.query.oneway
      ? `вылет ${esc(r.depOut)}`
      : `вылет ${esc(r.depOut)} / обр. ${esc(r.depBack)}`;
    return (
      `${tag}${when}\n` +
      `${money(r.familyTotal)} ${sym} · ${esc(r.airline)}\n` +
      `${times} · стык. ${esc(r.layover)} · в пути ${esc(r.totalH)}\n` +
      `<a href="${esc(r.link)}">Открыть на Aviasales</a>`
    );
  });

  // склеиваем в сообщения <= 3500 символов
  const out = [];
  let buf = head;
  for (const l of lines) {
    if ((buf + "\n\n" + l).length > 3500) { out.push(buf); buf = l; }
    else buf += "\n\n" + l;
  }
  if (buf) out.push(buf);
  if (rows.length > MAX_ROWS) out[out.length - 1] += `\n\n…и ещё ${rows.length - MAX_ROWS} дат. Сузьте запрос опцией <code>top=</code>.`;
  return out;
}

function money(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

// ---- Telegram API -----------------------------------------------------

async function tgSend(env, chatId, textHtml, { preview = true } = {}) {
  const body = {
    chat_id: chatId,
    text: textHtml,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: !preview },
  };
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) console.log("tgSend failed", r.status, await r.text());
  } catch (e) {
    console.log("tgSend error", String(e));
  }
}
