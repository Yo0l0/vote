// lib/population.js — everything the site knows from the bot's inventory export, built ONCE
// per inventory revision (about 120k cards, ~150 ms) and then served from memory:
// network stats, the live feed, the population of every card in the catalog (copies,
// holders, grades, 1st Editions, shinies), per-set completion, per-trainer summaries
// and the leaderboards. Nothing here touches the network.
'use strict';

const RANK = { common: 1, uncommon: 2, rare: 3, promo: 4, holo: 5, ultra: 6, sir: 7, mythical: 8 };
const PRICES = { common: 1, uncommon: 2, rare: 3, promo: 10, holo: 15, ultra: 20, sir: 30, mythical: 40 };   // the bot's house prices (config SELL_PRICES)
const HOLO = new Set(['holo', 'ultra', 'sir', 'mythical']);
const SUBS = ['centering', 'corners', 'edges', 'surface'];
const DAY = 86400000;

// ── the home clock ───────────────────────────────────────────
// "Today" and the per-day buckets follow SITE_TZ (America/Chicago unless set), so the pulls chart rolls over at
// midnight where the players are. It used to be UTC, which is 7 PM in Texas — the owner watched the day reset at 7.
const TZ = process.env.SITE_TZ || 'America/Chicago';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let clockFmt = null;
function partsOf(ms) {
  if (!clockFmt) clockFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const o = {}; for (const p of clockFmt.formatToParts(ms)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, dow: DOW.indexOf(o.weekday) };
}
/** 'YYYY-MM-DD' of the home-clock day `ms` falls in. */
function dayKey(ms) { const p = partsOf(ms); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }
/** UTC ms of the home-clock midnight that starts the day `ms` falls in. A second pass keeps a DST-switch day honest. */
function dayStart(ms) {
  const p = partsOf(ms), asUtc = Date.UTC(p.y, p.m - 1, p.d);
  let t = asUtc - (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - ms);
  const q = partsOf(t); t = asUtc - (Date.UTC(q.y, q.m - 1, q.d, q.h, q.mi, q.s) - t);
  return t;
}

const lc = r => String(r || 'common').toLowerCase();
const rank = r => RANK[lc(r)] || 0;
const imgKey = u => String(u || '').split('?')[0];
const isHolo = c => !!c?.isHolo || HOLO.has(lc(c?.rarity));
const isBlack = subs => !!subs && SUBS.every(k => Number(subs[k]) === 10);
const isFirst = c => c?.edition?.print === '1st';
const isWF = c => !!c?.edition?.wf;

function toMillis(ts) {
  if (ts == null) return NaN;
  if (typeof ts === 'number') return ts;
  const n = Number(ts); if (!Number.isNaN(n)) return n;
  const d = new Date(ts).getTime(); return Number.isNaN(d) ? NaN : d;
}

// net-worth multiplier, the bot's core/grades.js anchors: 6 → ×1.2 … 10 → ×5, Black Label half again
function gradeMult(g, black) {
  g = Number(g); if (!Number.isFinite(g) || g < 6) return 1;
  const A = { 6: 1.2, 7: 1.5, 8: 2, 9: 3, 10: 5 };
  if (g >= 10) return black ? 7.5 : 5;
  const lo = Math.floor(g), hi = Math.ceil(g);
  const m = lo === hi ? A[lo] : A[lo] + (A[hi] - A[lo]) * (g - lo);
  return m;
}
/** Estimated coin value of one card: house price (+holo), × grade, × 1st Edition (3, World First 10), × shiny 20. */
function value(c) {
  let v = PRICES[lc(c.rarity)] ?? 1;
  if (isHolo(c)) v += 5;
  if (c.grade) v *= gradeMult(c.grade, isBlack(c.subgrades));
  if (isWF(c)) v *= 10; else if (isFirst(c)) v *= 3;
  if (c.shiny) v *= 20;
  return Math.round(v);
}
/** How good a card is to look at: the ordering for "best nine", big pulls and the rarest card. */
function score(c) {
  return rank(c.rarity) * 100 + (c.shiny ? 400 : 0) + (isWF(c) ? 150 : isFirst(c) ? 40 : 0) + (Number(c.grade) || 0) * 6 + (isBlack(c.subgrades) ? 60 : 0);
}
const gradeKey = g => { const n = Number(g); return Number.isInteger(n) ? String(n) : n.toFixed(1); };

// ── the catalog index: an inventory card → its page ──────────
function indexCatalog(catalog) {
  const byImage = new Map(), bySetName = new Map(), setBySlug = new Map(), setByName = new Map(), cardByKey = new Map();
  for (const set of catalog?.sets || []) {
    setBySlug.set(set.slug, set); setByName.set(set.name, set);
    for (const card of set.cards) {
      const ref = { set, card, key: `${set.slug}/${card.slug}` };
      cardByKey.set(ref.key, ref);
      if (card.image && !byImage.has(imgKey(card.image))) byImage.set(imgKey(card.image), ref);
      const nk = `${set.name}|${card.name}`;
      if (!bySetName.has(nk)) bySetName.set(nk, ref);
    }
  }
  const resolve = c => byImage.get(imgKey(c.image)) || bySetName.get(`${c.set}|${c.name}`) || null;
  return { byImage, bySetName, setBySlug, setByName, cardByKey, resolve };
}

// ── the build ────────────────────────────────────────────────
function build(inv, catalog, now = Date.now()) {
  const idx = indexCatalog(catalog);
  const cards = new Map();      // catalog key → population
  const sets = new Map();       // set slug → population
  const users = new Map();      // uid → summary
  const all = [];               // every dated card, for the feed
  const packStamps = new Set();
  const perDay = {};
  const todayStart = dayStart(now);
  const week7 = now - 7 * DAY;
  const S = { totalCards: 0, totalUsers: 0, graded: 0, tens: 0, black: 0, shinies: 0, firstEd: 0, worldFirst: 0, droppedToday: 0 };

  for (const set of catalog?.sets || []) sets.set(set.slug, { slug: set.slug, name: set.name, total: set.total, copies: 0, holders: new Set(), held: new Set(), completions: 0 });

  const popFor = (ref) => {
    let p = cards.get(ref.key);
    if (!p) { p = { key: ref.key, copies: 0, holders: new Set(), graded: 0, tens: 0, black: 0, best: null, firstEd: 0, wf: false, shiny: 0, cond: {}, grades: {}, last7: 0, slabs: [] }; cards.set(ref.key, p); }
    return p;
  };

  for (const uid in inv) {
    const u = inv[uid];
    const list = u?.cards;
    if (!Array.isArray(list)) continue;
    S.totalUsers++;
    const me = { uid, name: u.name || u.username || null, total: 0, unique: new Set(), graded: 0, tens: 0, black: 0, shinies: 0, firstEd: 0, wf: 0, value: 0, best: [], sets: new Map(), last: 0, first: 0 };
    users.set(uid, me);
    for (const c of list) {
      if (!c || !c.name) continue;
      S.totalCards++; me.total++;
      const ms = toMillis(c.obtainedAt);
      const ref = idx.resolve(c);
      const v = value(c); me.value += v;
      const sc = score(c);
      if (me.best.length < 9 || sc > me.best[me.best.length - 1].sc) { me.best.push({ sc, c }); me.best.sort((a, b) => b.sc - a.sc); if (me.best.length > 9) me.best.pop(); }
      const black = !!c.grade && isBlack(c.subgrades);
      if (c.grade) { S.graded++; me.graded++; if (Number(c.grade) >= 10) { S.tens++; me.tens++; if (black) { S.black++; me.black++; } } }
      if (c.shiny) { S.shinies++; me.shinies++; }
      if (isFirst(c)) { S.firstEd++; me.firstEd++; if (isWF(c)) { S.worldFirst++; me.wf++; } }
      if (!Number.isNaN(ms)) {
        packStamps.add(ms);
        const day = dayKey(ms);
        perDay[day] = (perDay[day] || 0) + 1;
        if (ms >= todayStart) S.droppedToday++;
        if (ms > me.last) me.last = ms;
        if (!me.first || ms < me.first) me.first = ms;
        all.push({ c, ms, ref, sc });
      }
      if (ref) {
        me.unique.add(ref.key);
        let mine = me.sets.get(ref.set.slug); if (!mine) { mine = new Set(); me.sets.set(ref.set.slug, mine); } mine.add(ref.key);
        const p = popFor(ref);
        p.copies++; p.holders.add(uid);
        if (c.grade) {
          p.graded++; const gk = gradeKey(c.grade); p.grades[gk] = (p.grades[gk] || 0) + 1;
          if (Number(c.grade) >= 10) { p.tens++; if (black) p.black++; }
          const slab = { grade: Number(c.grade), black, cert: c.cert || null, at: toMillis(c.gradedAt) || null, cond: c.condition || null };
          if (!p.best || slab.grade > p.best.grade || (slab.grade === p.best.grade && slab.black && !p.best.black)) p.best = slab;
          if (p.slabs.length < 6 || slab.grade > p.slabs[p.slabs.length - 1].grade) { p.slabs.push(slab); p.slabs.sort((a, b) => b.grade - a.grade || (b.black - a.black)); if (p.slabs.length > 6) p.slabs.pop(); }
        }
        if (isFirst(c)) { p.firstEd++; if (isWF(c)) p.wf = true; }
        if (c.shiny) p.shiny++;
        const cond = lc(c.condition || 'unknown'); p.cond[cond] = (p.cond[cond] || 0) + 1;
        if (ms >= week7) p.last7++;
        const sp = sets.get(ref.set.slug);
        if (sp) { sp.copies++; sp.holders.add(uid); sp.held.add(ref.key); }
      }
    }
  }
  // set completions: trainers holding every card of a set
  for (const me of users.values()) for (const [slug, have] of me.sets) { const sp = sets.get(slug); if (sp && have.size >= sp.total) sp.completions++; }

  // ── stats ──
  // days are counted back from today on the home clock, noon-anchored so a 23- or 25-hour DST day can't skip one
  const keyAt = (daysAgo) => dayKey(todayStart + DAY / 2 - daysAgo * DAY);
  const dow = partsOf(todayStart + DAY / 2).dow;          // Sunday starts the week, like the old UTC version
  let thisWeek = 0, lastWeek = 0;
  for (let i = 0; i <= dow; i++) thisWeek += perDay[keyAt(i)] || 0;
  for (let i = dow + 1; i <= dow + 7; i++) lastWeek += perDay[keyAt(i)] || 0;
  const daysElapsed = dow + 1;
  const days14 = Array.from({ length: 14 }, (_, i) => { const d = keyAt(13 - i); return { day: d, n: perDay[d] || 0 }; });
  const stats = {
    ...S, totalPacks: packStamps.size, thisWeekAvg: Math.round(thisWeek / daysElapsed), lastWeekAvg: Math.round(lastWeek / 7), perDay: days14,
    catalogCards: (catalog?.sets || []).reduce((n, s) => n + s.total, 0), catalogSets: (catalog?.sets || []).length,
    circulating: cards.size, activeToday: 0, newThisWeek: 0, tz: TZ, today: keyAt(0), updated: now,
  };
  stats.activeToday = [...users.values()].filter(u => u.last >= todayStart).length;
  stats.newThisWeek = [...users.values()].filter(u => u.first && u.first >= week7).length;   // trainers whose first card is under a week old

  // ── feed ──
  all.sort((a, b) => b.ms - a.ms);
  const pub = (x) => ({ name: x.c.name, rarity: lc(x.c.rarity), set: x.c.set, image: x.c.image || null, at: x.ms, href: x.ref ? `/cards/${x.ref.key}` : null,
    grade: x.c.grade || null, black: !!x.c.grade && isBlack(x.c.subgrades), shiny: !!x.c.shiny, first: isFirst(x.c), wf: isWF(x.c), cond: x.c.condition || null });
  const recent = all.slice(0, 40).map(pub);
  const seen = new Set(); const showcase = [];
  for (const x of all) { if (rank(x.c.rarity) < RANK.rare || !x.c.image || seen.has(x.c.image)) continue; seen.add(x.c.image); showcase.push(pub(x)); if (showcase.length >= 6) break; }
  const big = all.filter(x => x.ms >= week7 && x.c.image && (rank(x.c.rarity) >= RANK.holo || x.c.shiny || isWF(x.c))).sort((a, b) => b.sc - a.sc || b.ms - a.ms);
  const seen2 = new Set(); const bigPulls = [];
  for (const x of big) { if (seen2.has(x.c.image)) continue; seen2.add(x.c.image); bigPulls.push(pub(x)); if (bigPulls.length >= 12) break; }

  // ── leaderboards ──
  const U = [...users.values()];
  const top = (fn, sub, n = 25) => U.map(u => ({ uid: u.uid, name: u.name, v: fn(u), sub: sub ? sub(u) : null })).filter(r => r.v > 0).sort((a, b) => b.v - a.v).slice(0, n);
  const completion = (u) => { let best = { pct: 0, name: null, have: 0, total: 0 }; for (const [slug, have] of u.sets) { const sp = sets.get(slug); if (!sp) continue; const pct = have.size / sp.total; if (pct > best.pct || (pct === best.pct && sp.total > best.total)) best = { pct, name: sp.name, have: have.size, total: sp.total }; } return best; };
  const boards = {
    binder:  { title: 'Biggest binders', unit: 'cards', rows: top(u => u.total, u => `${u.unique.size} unique`) },
    unique:  { title: 'Most unique cards', unit: 'unique', rows: top(u => u.unique.size, u => `of ${stats.catalogCards} in the game`) },
    value:   { title: 'Most valuable binders', unit: 'coins', rows: top(u => u.value, u => `${u.total} cards`) },
    slabs:   { title: 'Most slabs', unit: 'graded', rows: top(u => u.graded, u => u.tens ? `${u.tens} Gem Mint` : null) },
    gems:    { title: 'Gem Mint 10s', unit: 'tens', rows: top(u => u.tens, u => u.black ? `${u.black} Black Label` : null) },
    first:   { title: '1st Edition hunters', unit: '1st Ed', rows: top(u => u.firstEd, u => u.wf ? `${u.wf} World First` : null) },
    wf:      { title: 'World Firsts', unit: 'World Firsts', rows: top(u => u.wf, u => `${u.firstEd} 1st Editions`) },
    shiny:   { title: 'Shiny collectors', unit: 'shinies', rows: top(u => u.shinies) },
    sets:    { title: 'Set completion', unit: '%', rows: U.map(u => { const c = completion(u); return { uid: u.uid, name: u.name, v: Math.round(c.pct * 1000) / 10, sub: c.name ? `${c.name} · ${c.have}/${c.total}` : null }; }).filter(r => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 25) },
  };

  return { idx, cards, sets, users, stats, feed: { recent, showcase, bigPulls, updated: now }, boards, built: now };
}

// ── per-request views over the build ─────────────────────────
const holderCount = p => p.holders.size;
function cardPop(P, key) {
  const p = P.cards.get(key);
  if (!p) return { copies: 0, holders: 0, graded: 0, tens: 0, black: 0, best: null, firstEd: 0, wf: false, shiny: 0, cond: {}, grades: {}, last7: 0, slabs: [] };
  return { ...p, holders: holderCount(p) };
}
function setPop(P, slug) {
  const s = P.sets.get(slug);
  if (!s) return null;
  return { copies: s.copies, holders: s.holders.size, held: s.held.size, completions: s.completions, total: s.total };
}
function displayName(P, inv, uid) {
  const u = P.users.get(uid);
  return (u && u.name) || inv?.[uid]?.name || inv?.[uid]?.username || null;
}
const maskName = uid => `Trainer ${String(uid).slice(-4)}`;

/** Everything a profile or the dashboard shows for one trainer. Built on demand — one binder is cheap. */
function userDetail(P, inv, catalog, uid, { full = false } = {}) {
  const u = P.users.get(uid);
  const list = inv?.[uid]?.cards;
  if (!u || !Array.isArray(list)) return null;
  const view = (c) => { const ref = P.idx.resolve(c); return { code: c.code, name: c.name, rarity: lc(c.rarity), set: c.set, image: c.image || null, condition: c.condition || null, grade: c.grade || null,
    subgrades: c.subgrades || null, cert: c.cert || null, black: !!c.grade && isBlack(c.subgrades), shiny: c.shiny ? { style: c.shiny.style || null, tier: c.shiny.tier || null, name: c.shiny.name || null, n: c.shiny.n || null } : null,
    edition: c.edition || null, slab: c.slab || null, label: c.label || null, locked: !!c.locked, atGraders: !!c.gradeRequestedAt && !c.grade, obtainedAt: toMillis(c.obtainedAt) || null, gradedAt: toMillis(c.gradedAt) || null,
    href: ref ? `/cards/${ref.key}` : null, value: value(c), isHolo: isHolo(c) }; };
  const byRarity = {}, byCond = {};
  for (const c of list) { byRarity[lc(c.rarity)] = (byRarity[lc(c.rarity)] || 0) + 1; byCond[lc(c.condition || 'unknown')] = (byCond[lc(c.condition || 'unknown')] || 0) + 1; }
  const sets = (catalog?.sets || []).map(s => { const have = u.sets.get(s.slug)?.size || 0; return { name: s.name, slug: s.slug, total: s.total, have, pct: Math.round(have / s.total * 1000) / 10, releaseAt: s.releaseAt }; })
    .filter(s => s.have > 0 || full).sort((a, b) => b.pct - a.pct || b.have - a.have);
  const slabs = list.filter(c => c.grade).sort((a, b) => Number(b.grade) - Number(a.grade) || score(b) - score(a)).slice(0, 24).map(view);
  const shinies = list.filter(c => c.shiny).map(view);
  const firsts = list.filter(isFirst).sort((a, b) => (isWF(b) - isWF(a)) || score(b) - score(a)).slice(0, 24).map(view);
  const recent = list.map(c => ({ c, ms: toMillis(c.obtainedAt) || 0 })).sort((a, b) => b.ms - a.ms).slice(0, 12).map(x => view(x.c));
  const dupes = new Map(); for (const c of list) { const k = imgKey(c.image) || `${c.set}|${c.name}`; dupes.set(k, (dupes.get(k) || 0) + 1); }
  const spares = [...dupes.values()].filter(n => n > 1).reduce((s, n) => s + n - 1, 0);
  const rarest = u.best[0] ? view(u.best[0].c) : null;
  return {
    uid, name: u.name, total: u.total, unique: u.unique.size, catalogCards: P.stats.catalogCards, graded: u.graded, tens: u.tens, black: u.black, shinies: u.shinies, firstEd: u.firstEd, wf: u.wf,
    value: u.value, spares, atGraders: list.filter(c => c.gradeRequestedAt && !c.grade).length, lastPull: u.last || null,
    best9: u.best.map(b => view(b.c)), rarest, sets, setsStarted: sets.filter(s => s.have > 0).length, completed: sets.filter(s => s.have >= s.total).length,
    slabs, shinyCards: shinies, firsts, recent, byRarity, byCond,
    rank: { binder: rankIn(P.boards.binder.rows, uid), value: rankIn(P.boards.value.rows, uid), slabs: rankIn(P.boards.slabs.rows, uid) },
  };
}
const rankIn = (rows, uid) => { const i = rows.findIndex(r => r.uid === uid); return i < 0 ? null : i + 1; };

/** Set checklist for one trainer: which catalog cards they hold and which they miss. */
function checklist(P, inv, catalog, uid, slug) {
  const set = P.idx.setBySlug.get(slug);
  if (!set) return null;
  const have = new Map();
  for (const c of inv?.[uid]?.cards || []) { const ref = P.idx.resolve(c); if (ref && ref.set.slug === slug) { const k = ref.card.slug; have.set(k, (have.get(k) || 0) + 1); } }
  return { set: { name: set.name, slug: set.slug, total: set.total }, have: have.size, cards: set.cards.map(c => ({ ...c, href: `/cards/${slug}/${c.slug}`, copies: have.get(c.slug) || 0 })) };
}

module.exports = { build, cardPop, setPop, userDetail, checklist, displayName, maskName, value, score, rank, gradeMult, isBlack, isFirst, isWF, isHolo, toMillis, lc, RANK, PRICES, imgKey };
