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
 * Ввод — обычной фразой, бот сам разбирает:
 *   «найди в декабре билеты из москвы на бали 2 взрослых 1 ребёнок 1 младенец»
 *   «бали в марте на 3 недели»
 *   «стамбул с 10 декабря по 20 декабря в одну сторону»
 * Плюс строгий формат для точности:
 *   /search DPS 2026-11 21 from=LED adults=2 children=1
 */

import { parseQuery, search } from "./search.js";

const MAX_ROWS = 12;

const HELP = [
  "✈️ <b>Билетовед</b> — ищу самую выгодную поездку, сканируя весь месяц по дням вылета.",
  "",
  "<b>Просто напишите фразой</b>, например:",
  "• <i>найди в декабре билеты из Москвы на Бали, 2 взрослых, 1 ребёнок и 1 младенец</i>",
  "• <i>Стамбул в марте на неделю</i>",
  "• <i>Пхукет из Питера с декабря по февраль на 12 ночей, только прямые</i>",
  "• <i>Дубай 2026-12 в одну сторону</i>",
  "",
  "Понимаю: город вылета («из …»), город назначения, месяц или диапазон",
  "(«в декабре», «с декабря по февраль», «2026-12»), длительность («на 21 ночь»,",
  "«на 3 недели»), пассажиров, «в одну сторону», «только прямые», валюту.",
  "Слово «семья» = 2 взрослых + 1 ребёнок + 1 младенец.",
  "Чего не сказали — подставлю по умолчанию (из Москвы, 2 взрослых, 14 ночей)",
  "и покажу это в подтверждении.",
  "",
  "<b>Строгий формат</b> (если хочется точности):",
  "<code>/search КУДА МЕСЯЦ НОЧЕЙ [ключ=значение]</code>",
  "<code>/search DPS 2026-11 21 from=LED adults=2 children=1 infants=1</code>",
  "ключи: <code>from adults children infants oneway direct maxstops maxlayover currency through top</code>",
].join("\n");

const SYM = { rub: "₽", usd: "$", eur: "€", kzt: "₸", try: "₺", thb: "฿", gbp: "£", aed: "AED" };

const MONTH_NAME = ["", "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

// Города -> IATA. Ключ — основа слова (после приведения ё→е, нижний регистр);
// матч допускает любое падежное окончание. Порядок в массиве = приоритет
// при совпадении нескольких основ (более специфичные — выше).
const CITY_STEMS = [
  ["москв", "MOW"], ["мск", "MOW"],
  ["петербург", "LED"], ["питер", "LED"], ["спб", "LED"], ["санкт", "LED"], ["ленинград", "LED"],
  ["адлер", "AER"], ["сочи", "AER"],
  ["денпасар", "DPS"], ["бали", "DPS"],
  ["пхукет", "HKT"], ["самуи", "USM"],
  ["бангкок", "BKK"], ["тайланд", "BKK"], ["таиланд", "BKK"],
  ["дубай", "DXB"], ["дубае", "DXB"], ["дубая", "DXB"], ["оаэ", "DXB"], ["эмират", "DXB"],
  ["абу-даби", "AUH"], ["абудаби", "AUH"],
  ["стамбул", "IST"], ["турци", "IST"],
  ["анталь", "AYT"], ["анталия", "AYT"],
  ["ереван", "EVN"], ["армени", "EVN"],
  ["тбилиси", "TBS"], ["грузи", "TBS"], ["батуми", "BUS"],
  ["баку", "GYD"], ["азербайджан", "GYD"],
  ["каир", "CAI"], ["хургад", "HRG"], ["египет", "HRG"], ["египт", "HRG"],
  ["шарм", "SSH"], ["шейх", "SSH"],
  ["мальдив", "MLE"],
  ["коломбо", "CMB"], ["шри-ланк", "CMB"], ["шриланк", "CMB"], ["цейлон", "CMB"],
  ["гоа", "GOI"], ["дели", "DEL"], ["индия", "DEL"], ["индии", "DEL"],
  ["хошимин", "SGN"], ["сайгон", "SGN"], ["вьетнам", "SGN"], ["ханой", "HAN"],
  ["нячанг", "CXR"], ["камрань", "CXR"], ["фукуок", "PQC"],
  ["куала", "KUL"], ["малайзи", "KUL"], ["сингапур", "SIN"],
  ["токио", "TYO"], ["япони", "TYO"], ["осака", "KIX"],
  ["сеул", "SEL"], ["корея", "SEL"], ["корее", "SEL"], ["кореи", "SEL"],
  ["пекин", "BJS"], ["китай", "BJS"], ["китае", "BJS"], ["шанхай", "SHA"],
  ["гуанчжоу", "CAN"], ["санья", "SYX"], ["хайнан", "SYX"], ["гонконг", "HKG"],
  ["париж", "PAR"], ["франци", "PAR"], ["лондон", "LON"],
  ["рим", "ROM"], ["милан", "MIL"], ["итали", "ROM"],
  ["барселон", "BCN"], ["испани", "BCN"], ["мадрид", "MAD"],
  ["берлин", "BER"], ["германи", "BER"], ["франкфурт", "FRA"], ["мюнхен", "MUC"],
  ["прага", "PRG"], ["праге", "PRG"], ["чехи", "PRG"],
  ["амстердам", "AMS"], ["нидерланд", "AMS"], ["голланд", "AMS"],
  ["вена", "VIE"], ["вене", "VIE"], ["вену", "VIE"], ["австри", "VIE"],
  ["будапешт", "BUD"], ["венгри", "BUD"], ["варшав", "WAW"], ["польш", "WAW"],
  ["хельсинки", "HEL"], ["финлянди", "HEL"], ["белград", "BEG"], ["серби", "BEG"],
  ["кипр", "LCA"], ["ларнак", "LCA"], ["пафос", "PFO"],
  ["крит", "HER"], ["ираклион", "HER"], ["афины", "ATH"], ["греци", "ATH"],
  ["родос", "RHO"], ["салоники", "SKG"],
  ["тель-авив", "TLV"], ["тельавив", "TLV"], ["израил", "TLV"],
  ["нью-йорк", "NYC"], ["ньюйорк", "NYC"], ["сша", "NYC"], ["америк", "NYC"],
  ["касабланк", "CMN"], ["марокко", "CMN"], ["марракеш", "RAK"],
  ["занзибар", "ZNZ"], ["танзани", "ZNZ"], ["сейшел", "SEZ"], ["маврики", "MRU"],
  ["пунта", "PUJ"], ["доминикан", "PUJ"], ["домникан", "PUJ"],
  ["гавана", "HAV"], ["куба", "HAV"], ["кубе", "HAV"], ["кубу", "HAV"], ["варадеро", "VRA"],
  ["доха", "DOH"], ["катар", "DOH"],
  ["рияд", "RUH"], ["саудовск", "RUH"], ["джидда", "JED"], ["джедда", "JED"],
  ["ташкент", "TAS"], ["узбекистан", "TAS"], ["самарканд", "SKD"],
  ["алмат", "ALA"], ["алма-ат", "ALA"], ["казахстан", "ALA"],
  ["астана", "NQZ"], ["астане", "NQZ"], ["нур-султан", "NQZ"],
  ["бишкек", "FRU"], ["киргизи", "FRU"], ["кыргызстан", "FRU"], ["душанбе", "DYU"],
  ["минск", "MSQ"], ["беларус", "MSQ"], ["калининград", "KGD"],
  ["казан", "KZN"], ["екатеринбург", "SVX"], ["екб", "SVX"],
  ["новосибирск", "OVB"], ["новосиб", "OVB"], ["владивосток", "VVO"],
  ["красноярск", "KJA"], ["уфа", "UFA"], ["уфе", "UFA"], ["уфу", "UFA"],
  ["самара", "KUF"], ["самаре", "KUF"], ["самару", "KUF"],
  ["краснодар", "KRR"], ["минводы", "MRV"], ["минеральных вод", "MRV"], ["минеральные воды", "MRV"],
];

const IATA_NAME = {
  MOW: "Москва", LED: "Санкт-Петербург", AER: "Сочи", DPS: "Бали", HKT: "Пхукет",
  USM: "Самуи", BKK: "Бангкок", DXB: "Дубай", AUH: "Абу-Даби", IST: "Стамбул",
  AYT: "Анталья", EVN: "Ереван", TBS: "Тбилиси", BUS: "Батуми", GYD: "Баку",
  CAI: "Каир", HRG: "Хургада", SSH: "Шарм-эль-Шейх", MLE: "Мальдивы", CMB: "Коломбо",
  GOI: "Гоа", DEL: "Дели", SGN: "Хошимин", HAN: "Ханой", CXR: "Нячанг", PQC: "Фукуок",
  KUL: "Куала-Лумпур", SIN: "Сингапур", TYO: "Токио", KIX: "Осака", SEL: "Сеул",
  BJS: "Пекин", SHA: "Шанхай", CAN: "Гуанчжоу", SYX: "Санья", HKG: "Гонконг",
  PAR: "Париж", LON: "Лондон", ROM: "Рим", MIL: "Милан", BCN: "Барселона", MAD: "Мадрид",
  BER: "Берлин", FRA: "Франкфурт", MUC: "Мюнхен", PRG: "Прага", AMS: "Амстердам",
  VIE: "Вена", BUD: "Будапешт", WAW: "Варшава", HEL: "Хельсинки", BEG: "Белград",
  LCA: "Ларнака", PFO: "Пафос", HER: "Ираклион", ATH: "Афины", RHO: "Родос", SKG: "Салоники",
  TLV: "Тель-Авив", NYC: "Нью-Йорк", CMN: "Касабланка", RAK: "Марракеш", ZNZ: "Занзибар",
  SEZ: "Сейшелы", MRU: "Маврикий", PUJ: "Пунта-Кана", HAV: "Гавана", VRA: "Варадеро",
  DOH: "Доха", RUH: "Эр-Рияд", JED: "Джидда", TAS: "Ташкент", SKD: "Самарканд",
  ALA: "Алматы", NQZ: "Астана", FRU: "Бишкек", DYU: "Душанбе", MSQ: "Минск",
  KGD: "Калининград", KZN: "Казань", SVX: "Екатеринбург", OVB: "Новосибирск",
  VVO: "Владивосток", KJA: "Красноярск", UFA: "Уфа", KUF: "Самара", KRR: "Краснодар",
  MRV: "Минеральные Воды",
};

const NUM = {
  один: 1, одного: 1, одна: 1, одну: 1, двое: 2, два: 2, две: 2, двух: 2, пара: 2, пару: 2,
  трое: 3, три: 3, трех: 3, четверо: 4, четыре: 4, четырех: 4, пятеро: 5, пять: 5,
  шесть: 6, семь: 7, восемь: 8, девять: 9,
};
const NUMWORDS = Object.keys(NUM).join("|");

// Месяцы: основа -> номер. Порядок важен (короткие «сент/окт/ноя/дек» — после длинных).
const MON = [
  [/январ/, 1], [/феврал/, 2], [/(?:^|[^а-я])март/, 3], [/апрел/, 4],
  [/(?:^|[^а-я])ма[йея](?![а-я])/, 5], [/(?:^|[^а-я])июн/, 6], [/(?:^|[^а-я])июл/, 7],
  [/август/, 8], [/сентябр/, 9], [/октябр/, 10], [/ноябр/, 11], [/декабр/, 12],
  [/(?:^|[^а-я])сент?(?![а-я])/, 9], [/(?:^|[^а-я])окт(?![а-я])/, 10],
  [/(?:^|[^а-я])ноя(?![а-я])/, 11], [/(?:^|[^а-я])дек(?![а-я])/, 12],
];

export async function handleTelegram(request, env, ctx) {
  // Отладка разбора фразы без отправки в Telegram:
  //   GET /tg?q=найди в декабре билеты из москвы на бали 2 взрослых 1 ребенок
  if (request.method === "GET") {
    const q = new URL(request.url).searchParams.get("q");
    if (!q) return new Response("ok");
    try {
      const isCommand = /^\/search\b/i.test(q) || /^[A-Za-z]{3}\s+\S/.test(q);
      const { params, assumptions } = isCommand ? parseBotQuery(q) : parseNaturalQuery(q);
      return json({ query: q, understood: describeQuery(params), assumptions, params: Object.fromEntries(params) });
    } catch (e) {
      return json({ query: q, error: String(e.message || e) }, 400);
    }
  }
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

  if (/^\/(start|help)\b/i.test(text) || /^\/search(@\w+)?$/i.test(text)) {
    ctx.waitUntil(tgSend(env, chatId, HELP));
    return new Response("ok");
  }

  let parsed;
  try {
    const isCommand = /^\/search\b/i.test(text) || /^[A-Za-z]{3}\s+\S/.test(text);
    parsed = isCommand ? parseBotQuery(text) : parseNaturalQuery(text);
  } catch (e) {
    ctx.waitUntil(tgSend(env, chatId, "⚠️ " + esc(String(e.message || e)) + "\n\nНапишите /help — там примеры."));
    return new Response("ok");
  }

  ctx.waitUntil(runSearch(env, chatId, parsed));
  return new Response("ok");
}

async function runSearch(env, chatId, { params, assumptions }) {
  const note = assumptions && assumptions.length ? "\n🤔 " + assumptions.map(esc).join("; ") : "";
  await tgSend(
    env, chatId,
    `🔎 <b>${esc(describeQuery(params))}</b>${note}\nСканирую месяц по дням вылета, это ~10–30 сек…`,
  );
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

// ---- фраза на естественном языке ---------------------------------------

function normalize(s) {
  return " " + s.toLowerCase().replace(/ё/g, "е").replace(/[^0-9a-zа-я.\-\s]/gi, " ").replace(/\s+/g, " ").trim() + " ";
}

function parseNaturalQuery(text) {
  const t = normalize(text);
  const p = new URLSearchParams();
  const assumptions = [];

  // --- города ---
  const hits = [];
  for (const [stem, iata] of CITY_STEMS) {
    const re = new RegExp("(^|[^а-яa-z])" + stem + "(?:я|ья|ье|ьи|ью|а|у|е|ы|и|ей|ой|ом|ию|ии|ах|ам|ов)?(?![а-яa-z])");
    const m = re.exec(t);
    if (m) hits.push({ iata, idx: m.index + m[1].length });
  }
  // bare IATA-код латиницей (напр. «DPS»)
  for (const m of t.matchAll(/(^|[^a-z])([a-z]{3})(?![a-z])/g)) {
    const code = m[2].toUpperCase();
    if (!["THE", "AND", "FOR", "OUT", "NON"].includes(code)) hits.push({ iata: code, idx: m.index + m[1].length });
  }
  const seen = new Set();
  const cities = hits.sort((a, b) => a.idx - b.idx).filter((h) => (seen.has(h.iata) ? false : seen.add(h.iata)));

  let origin = null, dest = null;
  const originHit = cities.find((h) => /(^|[^а-я])(из|от)\s+$/.test(t.slice(0, h.idx)));
  if (originHit) {
    origin = originHit.iata;
    const rest = cities.filter((h) => h !== originHit);
    if (rest.length) dest = rest[0].iata;
  } else if (cities.length >= 2) {
    origin = cities[0].iata;
    dest = cities[1].iata;
    assumptions.push(`принял ${name(origin)} за город вылета`);
  } else if (cities.length === 1) {
    dest = cities[0].iata;
  }
  if (!dest) throw new Error("не понял, КУДА лететь. Напишите город назначения, напр. «на Бали», «в Стамбул».");
  p.set("to", dest);
  if (!origin) { origin = "MOW"; assumptions.push("вылет не указан — из Москвы"); }
  p.set("from", origin);

  // --- месяц / диапазон ---
  let monthStr = null, throughStr = null;
  const isoM = /(20\d\d)-(0[1-9]|1[0-2])/.exec(t);
  const numM = /(^|[^0-9])(0?[1-9]|1[0-2])\.(20\d\d)/.exec(t);
  if (isoM) monthStr = `${isoM[1]}-${isoM[2]}`;
  else if (numM) monthStr = `${numM[3]}-${String(+numM[2]).padStart(2, "0")}`;

  const found = [];
  for (const [re, n] of MON) {
    const m = re.exec(t);
    if (m && !found.some((f) => f.n === n)) found.push({ n, idx: m.index });
  }
  found.sort((a, b) => a.idx - b.idx);
  const now = new Date();
  const curY = now.getUTCFullYear(), curM = now.getUTCMonth() + 1;
  const yearInText = /(^|[^0-9])(20\d\d)(?![0-9])/.exec(t);
  const ymOf = (mo) => {
    const y = yearInText ? +yearInText[2] : mo >= curM ? curY : curY + 1;
    return `${y}-${String(mo).padStart(2, "0")}`;
  };
  if (!monthStr && found.length) monthStr = ymOf(found[0].n);
  if (found.length >= 2) {
    monthStr = monthStr || ymOf(found[0].n);
    const b = found[1].n;
    let ty = yearInText ? +yearInText[2] : b >= curM ? curY : curY + 1;
    if (b < found[0].n) ty = +monthStr.slice(0, 4) + 1;
    throughStr = `${ty}-${String(b).padStart(2, "0")}`;
  }
  if (!monthStr) throw new Error(`понял: → ${name(dest)}, но не понял МЕСЯЦ. Добавьте «в декабре», «в марте», «2026-12».`);
  p.set("month", monthStr);
  if (throughStr && throughStr !== monthStr) p.set("through", throughStr);

  // --- туда/обратно и длительность ---
  const oneway = /(в\s+од(?:ну|ин)\s+(?:сторон|конец)|только\s+туда|без\s+обратн|обратн\w*\s+не\s+нуж)/.test(t);
  if (oneway) p.set("oneway", "1");

  let nights = null, m;
  if ((m = /на\s+(\d+)\s*(?:ноч|дн|дней|день|сут)/.exec(t))) nights = +m[1];
  else if ((m = /(\d+)\s*(?:ноч|ноче[йвя])/.exec(t))) nights = +m[1];
  else if ((m = /на\s+(\d+)\s*недел/.exec(t))) nights = +m[1] * 7;
  else if ((m = /на\s+(одну|две|три|четыре|пять|полторы|пару)\s+недел/.exec(t)))
    nights = ({ одну: 7, две: 14, три: 21, четыре: 28, пять: 35, полторы: 10, пару: 14 })[m[1]];
  else if (/на\s+недел/.test(t)) nights = 7;
  else if (/на\s+мес[яац]/.test(t)) nights = 30;
  if (nights) p.set("nights", String(Math.max(1, Math.min(60, nights))));
  else if (!oneway) { p.set("nights", "14"); assumptions.push("длительность не указана — 14 ночей"); }

  // --- пассажиры ---
  const grab = (re) => { const x = re.exec(t); return x ? toNum(x[1]) : null; };
  let adults = grab(new RegExp(`(\\d+|${NUMWORDS})\\s+взросл`));
  let children = grab(new RegExp(`(\\d+|${NUMWORDS})\\s+(?:реб|дет)`));
  let infants = grab(new RegExp(`(\\d+|${NUMWORDS})\\s+(?:младен|грудн)`));
  if (children == null && /(^|[^а-я])с\s+ребенком(?![а-я])/.test(t)) children = 1;
  if (children == null && /(^|[^а-я])с\s+детьми(?![а-я])/.test(t)) children = 2;
  if (infants == null && /(^|[^а-я])с\s+младенцем(?![а-я])/.test(t)) infants = 1;
  // «семья» / «всей семьёй» = 2 взрослых + 1 ребёнок + 1 младенец (состав семьи владельца)
  if (/(?:^|[^а-я])семь[еяию]/.test(t)) {
    if (!adults || isNaN(adults)) adults = 2;
    if (children == null) children = 1;
    if (infants == null) infants = 1;
    assumptions.push("«семья» → 2 взр. + 1 реб. + 1 млад.");
  } else if (!adults || isNaN(adults)) {
    adults = 2;
    assumptions.push("взрослых не указано — 2");
  }
  p.set("adults", String(clamp(adults, 1, 9)));
  if (children) p.set("children", String(clamp(children, 0, 9)));
  if (infants) p.set("infants", String(clamp(infants, 0, 9)));

  // --- прочее ---
  if (/(в\s+доллар|долларах|\busd\b)/.test(t)) p.set("currency", "usd");
  else if (/(в\s+евро|\beur\b)/.test(t)) p.set("currency", "eur");
  else if (/(в\s+тенге|\bkzt\b)/.test(t)) p.set("currency", "kzt");
  if (/(прям(?:ой|ые|ых|о)|без\s+пересад|нон-?стоп|non-?stop)/.test(t)) p.set("direct", "1");
  if ((m = /не\s+больше\s+(\d+)\s+пересад/.exec(t))) p.set("maxStops", m[1]);

  return { params: p, assumptions };
}

function toNum(w) {
  const n = parseInt(w, 10);
  return isNaN(n) ? (NUM[w] ?? NaN) : n;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function name(code) { return IATA_NAME[code] || code; }

// ---- строгий формат: /search КУДА МЕСЯЦ НОЧЕЙ ключ=значение --------------

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

  const assumptions = [];
  const p = new URLSearchParams();
  p.set("to", resolvePlace(positional[0], "to"));
  p.set("month", resolveMonth(positional[1]));

  const oneway = opts.oneway === "1" || opts.oneway === "true";
  if (oneway) p.set("oneway", "1");
  if (positional[2] != null) {
    const n = parseInt(positional[2], 10);
    if (!isNaN(n)) p.set("nights", String(n));
  }
  if (!p.has("nights") && !oneway) { p.set("nights", "14"); assumptions.push("ночей не указано — 14"); }

  p.set("from", resolvePlace(opts.from || "MOW", "from"));
  for (const k of ["adults", "children", "infants", "top", "currency"]) {
    if (opts[k] != null && opts[k] !== "") p.set(k, opts[k]);
  }
  if (opts.through) p.set("through", resolveMonth(opts.through));
  if (opts.direct === "1" || opts.direct === "true") p.set("direct", "1");
  if (opts.maxstops != null && opts.maxstops !== "") p.set("maxStops", opts.maxstops);
  if (opts.maxlayover != null && opts.maxlayover !== "") p.set("maxLayoverH", opts.maxlayover);
  return { params: p, assumptions };
}

function resolvePlace(raw, field) {
  const s = String(raw).trim();
  if (/^[A-Za-z]{3}$/.test(s)) return s.toUpperCase();
  const norm = normalize(s);
  for (const [stem, iata] of CITY_STEMS) {
    if (new RegExp("(^|[^а-яa-z])" + stem + "[а-яa-z]*(?![а-яa-z])").test(norm)) return iata;
  }
  throw new Error(`не понял город «${s}» (${field}). Дайте IATA-код из 3 букв, напр. DPS.`);
}

function resolveMonth(raw) {
  const s = String(raw).trim().toLowerCase().replace(/ё/g, "е");
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const now = new Date();
  const curY = now.getUTCFullYear(), curM = now.getUTCMonth() + 1;
  let mo = null;
  if (/^\d{1,2}$/.test(s)) mo = parseInt(s, 10);
  else for (const [re, n] of MON) if (re.test(" " + s + " ")) { mo = n; break; }
  if (!mo || mo < 1 || mo > 12) throw new Error(`не понял месяц «${raw}». Форматы: 2026-11, 11, ноя.`);
  const year = mo >= curM ? curY : curY + 1;
  return `${year}-${String(mo).padStart(2, "0")}`;
}

// ---- вывод ------------------------------------------------------------

function describeQuery(p) {
  const parts = [`${name(p.get("from") || "MOW")} → ${name(p.get("to"))}`];
  const [y, mo] = p.get("month").split("-");
  let when = `${MONTH_NAME[+mo]} ${y}`;
  if (p.get("through")) {
    const [ty, tm] = p.get("through").split("-");
    when += ` … ${MONTH_NAME[+tm]} ${ty}`;
  }
  parts.push(when);
  parts.push(p.get("oneway") === "1" ? "в одну сторону" : `${p.get("nights") || 14} ноч.`);
  const a = +(p.get("adults") || 2), c = +(p.get("children") || 0), i = +(p.get("infants") || 0);
  let pax = `${a} взр.`;
  if (c) pax += ` + ${c} реб.`;
  if (i) pax += ` + ${i} млад.`;
  parts.push(pax);
  if (p.get("direct") === "1") parts.push("только прямые");
  const cur = (p.get("currency") || "rub").toLowerCase();
  if (cur !== "rub") parts.push(cur.toUpperCase());
  return parts.join(" · ");
}

function formatResults(res) {
  const cur = (res.query.currency || "rub").toLowerCase();
  const sym = SYM[cur] || cur.toUpperCase();
  const rows = res.rows || [];
  const route = `${name(res.query.from)} → ${name(res.query.to)}`;
  if (!rows.length) {
    return [
      `😕 Ничего не нашлось: <b>${esc(route)}</b>, ${esc(res.query.month)}.\n` +
      `Просканировано дней: ${res.meta.daysScanned}, с данными: ${res.meta.daysWithData}. ` +
      `Попробуйте другой месяц или добавьте «до 2 пересадок».`,
    ];
  }

  const cheapest = Math.min(...rows.map((r) => r.familyTotal));
  const head =
    `✈️ <b>${esc(route)}</b> · ${esc(res.query.month)}` +
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

  const out = [];
  let buf = head;
  for (const l of lines) {
    if ((buf + "\n\n" + l).length > 3500) { out.push(buf); buf = l; }
    else buf += "\n\n" + l;
  }
  if (buf) out.push(buf);
  if (rows.length > MAX_ROWS) out[out.length - 1] += `\n\n…и ещё ${rows.length - MAX_ROWS} дат.`;
  return out;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function money(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

// ---- Telegram API ---------------------------------------------------

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
