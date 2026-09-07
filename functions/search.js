/**
 * Cloudflare Pages Function - flight search for the Biletoved site.
 * Path: /functions/search.js  ->  serves GET /search on the same domain.
 *
 * Keeps TRAVELPAYOUTS_TOKEN server-side, scans a month of departure days,
 * filters / scores / tags the results and returns JSON the page renders.
 *
 * Deploy: connect this repo in Cloudflare Pages, add env var
 * TRAVELPAYOUTS_TOKEN (Settings -> Environment variables). No wrangler needed.
 *
 * GET /search?from=MOW&to=DPS&month=2026-11&nights=21&adults=2&children=1&infants=1
 *            &oneway=0&currency=usd&maxStops=1&maxLayoverH=5&top=20&all=0&through=
 */

const API = "https://api.travelpayouts.com/aviasales/v3/prices_for_dates";
const PER_DAY = 20;
const BATCH = 8;

const AIRLINES = {
  QR:["Qatar Airways",5,8.6,0], SQ:["Singapore Airlines",5,8.7,0], NH:["ANA All Nippon Airways",5,8.4,0],
  JL:["Japan Airlines",5,8.3,0], CX:["Cathay Pacific",5,8.0,0], BR:["EVA Air",5,8.2,0],
  HU:["Hainan Airlines",4.5,7.6,0], EK:["Emirates",4.5,8.0,0], EY:["Etihad Airways",4,7.6,0],
  TK:["Turkish Airlines",4,7.4,0], QF:["Qantas",4,7.5,0], VA:["Virgin Australia",4,7.2,0],
  NZ:["Air New Zealand",4.5,7.9,0], FJ:["Fiji Airways",4,7.3,0], LX:["Swiss",4,7.6,0],
  LH:["Lufthansa",4,7.0,0], OS:["Austrian Airlines",4,7.1,0], AF:["Air France",4,6.9,0],
  KL:["KLM",4,7.1,0], BA:["British Airways",4,6.6,0], VS:["Virgin Atlantic",4,7.4,0],
  AY:["Finnair",4,7.5,0], IB:["Iberia",4,6.8,0], TP:["TAP Air Portugal",3.5,6.3,0],
  A3:["Aegean Airlines",4,7.6,0], LO:["LOT Polish Airlines",3.5,6.7,0], SK:["SAS",3.5,6.6,0],
  DY:["Norwegian",3,6.3,1], KE:["Korean Air",4,7.7,0], OZ:["Asiana Airlines",4,7.5,0],
  "7C":["Jeju Air",3,6.0,1], CI:["China Airlines",4,7.0,0], CA:["Air China",3.5,6.6,0],
  CZ:["China Southern Airlines",4,7.0,0], MU:["China Eastern Airlines",3.5,6.6,0], MF:["Xiamen Airlines",3.5,6.7,0],
  "3U":["Sichuan Airlines",3,6.3,0], HX:["Hong Kong Airlines",3,6.2,0], MH:["Malaysia Airlines",4,6.9,0],
  TG:["Thai Airways",4,7.2,0], PG:["Bangkok Airways",4,7.4,0], GA:["Garuda Indonesia",4,7.4,0],
  VN:["Vietnam Airlines",4,7.3,0], VJ:["VietJet Air",3,5.9,1], PR:["Philippine Airlines",3.5,6.5,0],
  "5J":["Cebu Pacific",3,6.0,1], TR:["Scoot",3,6.1,1], AK:["AirAsia",3,6.2,1],
  D7:["AirAsia X",3,6.2,1], JQ:["Jetstar",3,6.0,1], UL:["SriLankan Airlines",4,6.9,0],
  AI:["Air India",3,5.8,0], UK:["Vistara",4,7.2,0], "6E":["IndiGo",3,6.6,1],
  SG:["SpiceJet",2.5,5.4,1], PK:["Pakistan International Airlines",2.5,5.5,0], BG:["Biman Bangladesh Airlines",3,5.8,0],
  SU:["Aeroflot",3,6.5,0], SVO:["Aeroflot",3,6.5,0], S7:["S7 Airlines",3,6.7,0],
  U6:["Ural Airlines",3,6.2,0], DP:["Pobeda",2.5,5.8,1], FV:["Rossiya Airlines",3,6.3,0],
  N4:["Nordwind Airlines",3,6.0,0], "5N":["Smartavia",3,6.0,0], KC:["Air Astana",4,7.4,0],
  HY:["Uzbekistan Airways",3.5,6.6,0], J2:["Azerbaijan Airlines",3.5,6.6,0], GF:["Gulf Air",4,7.0,0],
  SV:["Saudia",3.5,6.6,0], WY:["Oman Air",4,7.2,0], KU:["Kuwait Airways",3,5.9,0],
  ME:["Middle East Airlines",3.5,6.5,0], RJ:["Royal Jordanian",3.5,6.4,0], MS:["EgyptAir",3.5,6.3,0],
  ET:["Ethiopian Airlines",4,7.0,0], KQ:["Kenya Airways",3.5,6.5,0], AT:["Royal Air Maroc",3.5,6.3,0],
  FZ:["flydubai",3,6.4,1], G9:["Air Arabia",3,6.2,1], PC:["Pegasus Airlines",3,6.3,1],
  W6:["Wizz Air",3,6.4,1], U2:["easyJet",3,6.6,1], FR:["Ryanair",3,6.0,1],
  VY:["Vueling",3,6.0,1], EW:["Eurowings",3,6.0,1], HV:["Transavia",3,6.4,1],
  AA:["American Airlines",3,6.2,0], DL:["Delta Air Lines",4,7.3,0], UA:["United Airlines",3,6.4,0],
  B6:["JetBlue Airways",3.5,6.8,0], WN:["Southwest Airlines",3.5,7.0,0], AS:["Alaska Airlines",4,7.4,0],
  NK:["Spirit Airlines",2.5,5.4,1], F9:["Frontier Airlines",2.5,5.3,1], AC:["Air Canada",3.5,6.6,0],
  WS:["WestJet",3.5,6.6,0], AM:["Aeromexico",3.5,6.4,0], CM:["Copa Airlines",4,7.3,0],
  AV:["Avianca",3.5,6.7,0], LA:["LATAM Airlines",4,7.2,0], G3:["Gol Linhas Aereas",3.5,6.5,1],
  AD:["Azul Brazilian Airlines",4,7.3,0], AR:["Aerolineas Argentinas",3,6.2,0],
};
const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (!env.TRAVELPAYOUTS_TOKEN) return json({ error: "TRAVELPAYOUTS_TOKEN is not set: add it as a Secret in the Worker (Settings -> Variables and Secrets) and redeploy" }, 500);
  try {
    const q = parseQuery(new URL(request.url).searchParams);
    return json(await search(q, env.TRAVELPAYOUTS_TOKEN));
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 400);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });
}

function parseQuery(p) {
  const from = (p.get("from") || "MOW").toUpperCase();
  const to = (p.get("to") || "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(to)) throw new Error("bad 'to' (need IATA code)");
  if (!/^[A-Z]{3}$/.test(from)) throw new Error("bad 'from'");
  const month = p.get("month") || "";
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("bad 'month' (YYYY-MM)");
  const through = p.get("through") || "";
  if (through && !/^\d{4}-\d{2}$/.test(through)) throw new Error("bad 'through'");
  const oneway = p.get("oneway") === "1";
  const nights = clampInt(p.get("nights"), 1, 60, 14);
  const adults = clampInt(p.get("adults"), 1, 9, 2);
  const children = clampInt(p.get("children"), 0, 9, 0);
  const infants = clampInt(p.get("infants"), 0, 9, 0);
  const currency = (p.get("currency") || "rub").toLowerCase();
  const maxStops = clampInt(p.get("maxStops"), 0, 3, 1);
  const maxLayoverH = clampInt(p.get("maxLayoverH"), 1, 48, 5);
  const top = clampInt(p.get("top"), 1, 60, 20);
  const all = p.get("all") === "1";
  const direct = p.get("direct") === "1";
  return { from, to, month, through, oneway, nights, adults, children, infants, currency, maxStops, maxLayoverH, top, all, direct };
}
function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

function monthDays(month, through) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  let end;
  if (through) { const [ty, tm] = through.split("-").map(Number); end = new Date(Date.UTC(ty, tm, 1)); }
  else { end = new Date(Date.UTC(y, m, 1)); }
  const min = new Date(Date.now() + 24 * 3600 * 1000);
  const out = [];
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) if (d >= min) out.push(new Date(d));
  return out;
}
const iso = (d) => d.toISOString().slice(0, 10);
const ddmm = (d) => String(d.getUTCDate()).padStart(2, "0") + String(d.getUTCMonth() + 1).padStart(2, "0");
const ddmmyyyy = (d) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
const hm = (min) => { min = Math.max(0, Math.round(min)); return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`; };

function paxCode(a, c, i) {
  let s = String(Math.max(1, Math.min(a, 9)));
  if (c > 0 || i > 0) s += String(Math.min(c, 9));
  if (i > 0) s += String(Math.min(i, 9));
  return s;
}
function aviasalesUrl(q, dep, ret) {
  let seg = q.from + ddmm(dep) + q.to;
  if (ret) seg += ddmm(ret);
  return "https://www.aviasales.ru/search/" + seg + paxCode(q.adults, q.children, q.infants);
}
function airline(code) {
  const a = AIRLINES[(code || "").toUpperCase()];
  return a ? { name: a[0], stars: a[1], review: a[2], low: !!a[3] } : { name: code || "?", stars: 3, review: 6.5, low: false };
}
function localHM(s) { const m = /T(\d\d):(\d\d)/.exec(s || ""); return m ? `${m[1]}:${m[2]}` : ""; }
function redeye(s) {
  const m = /T(\d\d):/.exec(s || ""); if (!m) return 0;
  const h = +m[1];
  if (h < 5) return 45; if (h < 7) return 20; if (h >= 23) return 15; if (h >= 22) return 8; return 0;
}
function legLayovers(link, durTo, durBack, durTotal, so, sb) {
  const totLay = Math.max(0, durTotal - (durTo + durBack));
  const ts = (String(link).match(/\d{10}/g) || []).map(Number);
  if (ts.length >= 4) {
    const jOut = Math.round((ts[1] - ts[0]) / 60), jBack = Math.round((ts[3] - ts[2]) / 60);
    if (jOut > 0 && jBack > 0 && Math.abs(jOut + jBack - durTotal) <= 20) {
      const lo = Math.max(0, Math.round(totLay * jOut / (jOut + jBack)));
      return [lo, Math.max(0, totLay - lo)];
    }
  }
  if (so + sb <= 0) return [0, 0];
  const lo = Math.round(totLay * so / (so + sb));
  return [lo, totLay - lo];
}
function oneWayLayover(link, flightMin) {
  const ts = (String(link).match(/\d{10}/g) || []).map(Number);
  if (ts.length >= 2) {
    const j = Math.round((ts[1] - ts[0]) / 60);
    if (j > 0 && j < 6000) return Math.max(0, j - flightMin);
  }
  return null;
}

async function fetchDay(q, token, dep) {
  const ret = q.oneway ? null : new Date(dep.getTime() + q.nights * 86400000);
  const sp = new URLSearchParams({
    origin: q.from, destination: q.to, departure_at: iso(dep),
    currency: q.currency, sorting: "price", limit: String(PER_DAY),
    one_way: q.oneway ? "true" : "false", token,
  });
  if (ret) sp.set("return_at", iso(ret));
  if (q.direct) sp.set("direct", "true");
  let data = [];
  try {
    const r = await fetch(API + "?" + sp.toString());
    if (r.ok) { const j = await r.json(); data = Array.isArray(j.data) ? j.data : []; }
  } catch (_) { /* skip day */ }
  return { dep, ret, data };
}

async function search(q, token) {
  const days = monthDays(q.month, q.through);
  if (!days.length) throw new Error("no future days in that month");
  if (days.length > 46) throw new Error("date range too wide (" + days.length + " days); search one month at a time");

  const results = [];
  for (let i = 0; i < days.length; i += BATCH) {
    results.push(...await Promise.all(days.slice(i, i + BATCH).map((d) => fetchDay(q, token, d))));
  }

  const paxMult = q.adults + q.children + q.infants * 0.1;
  const rows = [];
  let daysWithData = 0;

  for (const { dep, ret, data } of results) {
    if (!data.length) continue;
    daysWithData++;
    for (const f of data) {
      if (!f.price) continue;
      const farePP = Math.round(+f.price);
      const stopsOut = +f.transfers || 0;
      const stopsBack = (f.return_transfers == null) ? null : (+f.return_transfers || 0);
      const sb = stopsBack == null ? 0 : stopsBack;
      const durTo = +f.duration_to || 0;
      const durBack = +f.duration_back || 0;
      const flightMin = durTo + durBack;
      let totalMin = +f.duration || flightMin;
      if (totalMin < flightMin) totalMin = flightMin;
      const layMin = Math.max(0, totalMin - flightMin);

      let layOut, layBack;
      if (q.oneway) {
        layOut = oneWayLayover(f.link, durTo);
        if (layOut == null) layOut = legLayovers(f.link, durTo, durBack, totalMin, stopsOut, sb)[0];
        layBack = null;
      } else {
        [layOut, layBack] = legLayovers(f.link, durTo, durBack, totalMin, stopsOut, sb);
      }

      const air = airline(f.airline);
      const flightH = flightMin / 60, layH = layMin / 60, totalH = Math.round(totalMin / 60 * 10) / 10;
      const conv = (stopsOut + sb) * 80 + flightH * 3 + layH * 5
        + redeye(f.departure_at) + redeye(f.return_at)
        + (5 - air.stars) * 16 + (8 - air.review) * 4 + (air.low ? 15 : 0);

      rows.push({
        depDate: dep, retDate: ret, depIso: iso(dep), retIso: ret ? iso(ret) : "",
        farePP, familyTotal: Math.round(farePP * paxMult),
        airline: f.airline, airlineName: air.name,
        stopsOut, stopsBack,
        depOut: localHM(f.departure_at), depBack: localHM(f.return_at),
        flightMin, layOut, layBack, layMin, totalMin, totalH,
        conv: Math.round(conv * 10) / 10,
        link: aviasalesUrl(q, dep, ret),
      });
    }
  }

  let f = rows.filter((r) =>
    r.stopsOut <= q.maxStops &&
    (r.stopsBack == null || r.stopsBack <= q.maxStops) &&
    r.layMin <= q.maxLayoverH * 60
  );
  f.sort((a, b) => a.familyTotal - b.familyTotal || a.totalMin - b.totalMin);
  if (!q.all) {
    const seen = new Set();
    f = f.filter((r) => (seen.has(r.depIso) ? false : (seen.add(r.depIso), true)));
  }
  f = f.slice(0, q.top);

  if (f.length) {
    const keyOf = (r) => `${r.depIso}|${r.retIso}|${r.airline}|${r.farePP}|${r.depOut}|${r.totalH}`;
    const cheap = keyOf([...f].sort((a, b) => a.familyTotal - b.familyTotal || a.totalMin - b.totalMin)[0]);
    const fast = keyOf([...f].sort((a, b) => a.totalMin - b.totalMin || a.familyTotal - b.familyTotal)[0]);
    const conv = keyOf([...f].sort((a, b) => a.conv - b.conv || a.familyTotal - b.familyTotal)[0]);
    for (const r of f) {
      const k = keyOf(r), t = [];
      if (k === cheap) t.push("дёшево");
      if (k === conv) t.push("удобно");
      if (k === fast) t.push("быстро");
      r.rec = t.join("+");
    }
  }

  const fmtDate = (d) => d ? `${ddmmyyyy(d)} (${WD[d.getUTCDay()]})` : "";
  const outRows = f.map((r) => {
    const o = {
      depart: fmtDate(r.depDate),
      familyTotal: r.familyTotal,
      currency: q.currency.toUpperCase(),
      airline: r.airlineName,
      depOut: r.depOut,
      totalH: r.totalH,
      link: r.link,
    };
    if (!q.oneway) {
      o.return = fmtDate(r.retDate);
      o.depBack = r.depBack;
      o.layover = `${hm(r.layOut)} - ${hm(r.layBack)}`;
    } else {
      o.layover = hm(r.layOut);
    }
    return o;
  });

  return {
    query: q,
    meta: { daysScanned: days.length, daysWithData, itineraries: rows.length, shown: outRows.length },
    columns: q.oneway
      ? ["depart", "familyTotal", "airline", "depOut", "layover", "totalH", "link"]
      : ["depart", "return", "familyTotal", "airline", "depOut", "depBack", "layover", "totalH", "link"],
    headers: q.oneway
      ? ["Вылет", `Цена, ${q.currency.toUpperCase()}`, "Авиакомпания", "Время туда", "Стыковки", "В пути, ч", "Ссылка"]
      : ["Вылет", "Обратно", `Цена, ${q.currency.toUpperCase()}`, "Авиакомпания", "Время туда", "Время обр.", "Стыковки т/о", "В пути, ч", "Ссылка"],
    rows: outRows,
  };
}
