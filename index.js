// thepokebot.com — the Pokébot website.
// Data: the bot publishes its inventory export, changelog, catalog and help table to the
// public ssss repo; the site keeps each warm (lib/cache.js), builds every derived view once
// per inventory revision (lib/population.js) and serves pages + JSON from memory.
'use strict';
const express = require('express');
const compression = require('compression');
const { Webhook } = require('@top-gg/sdk');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const axios = require('axios');
const { remoteJson } = require('./lib/cache');
const P = require('./lib/population');
const images = require('./lib/images');
const { render, escapeHtml, SITE } = require('./lib/render');

const app = express();
const webhook = new Webhook('252566');

const CLIENT_ID     = '1362516883785515199';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '';
const REDIRECT_URI  = process.env.REDIRECT_URI || 'https://thepokebot.com/callback';
const INVITE_URL    = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=534723951680&scope=bot+applications.commands`;
const SUPPORT_URL   = 'https://discord.gg/zj9Sxz3reR';
const VOTE_URL      = `https://top.gg/bot/${CLIENT_ID}/vote`;
const DEMO          = process.env.DEMO === '1';
// The trainer count is the real one (the old site added 10,000 to it; the owner removed that on 2026-09-18).
const RAW = 'https://raw.githubusercontent.com/Yo0l0/ssss/main';

// ── the feeds the bot publishes ───────────────────────────────
let built = null, builtRev = -1;
const invalidate = () => { built = null; };
const inventory = remoteJson({ name: 'inventory', url: DEMO ? null : (process.env.INVENTORY_URL || `${RAW}/user_inventory.json`), ttl: 2 * 60 * 1000,
  local: path.join(__dirname, 'user_inventory.json'), validate: d => d && typeof d === 'object' && !Array.isArray(d), onUpdate: invalidate });
const news = remoteJson({ name: 'changelog', url: process.env.NEWS_URL || `${RAW}/news.json`, ttl: 2 * 60 * 1000, local: path.join(__dirname, 'news.json'), validate: d => Array.isArray(d) && d.length > 0 });
const catalog = remoteJson({ name: 'catalog', url: DEMO ? null : (process.env.CATALOG_URL || `${RAW}/catalog.json`), ttl: 10 * 60 * 1000, local: path.join(__dirname, 'data', 'catalog.json'), validate: d => Array.isArray(d?.sets), onUpdate: invalidate, quiet404: true });
const namesFeed = remoteJson({ name: 'names', url: DEMO ? null : (process.env.NAMES_URL || `${RAW}/names.json`), ttl: 10 * 60 * 1000, local: path.join(__dirname, 'names.json'), validate: d => d && typeof d.names === 'object', quiet404: true });
const help = remoteJson({ name: 'help', url: DEMO ? null : (process.env.HELP_URL || `${RAW}/help.json`), ttl: 10 * 60 * 1000, local: path.join(__dirname, 'data', 'help.json'), validate: d => Array.isArray(d?.groups), quiet404: true });

if (DEMO) {   // DEMO: a synthetic inventory and the committed catalog/help/names, so a local run is deterministic and touches no player data
  const demo = require('./lib/demo');
  inventory.set(demo.inventory(catalog.get(), { devUser: process.env.DEV_USER || '000000000000000001' }));
  console.log('🧪 DEMO mode: synthetic inventory, no player data');
}

/** The current build of every derived view, rebuilt only when the inventory or catalog changed. */
function data() {
  const inv = inventory.get() || {};
  const rev = inventory.revision() * 1000 + catalog.revision();
  if (!built || builtRev !== rev) {
    const t = Date.now();
    built = P.build(inv, catalog.get() || { sets: [], upcoming: [] });
    builtRev = rev;
    console.log(`📊 rebuilt views: ${built.stats.totalUsers} trainers · ${built.stats.totalCards} cards · ${built.cards.size} catalog cards in circulation · ${Date.now() - t} ms`);
    images.warm([...built.feed.bigPulls, ...built.feed.showcase].map(c => c.image), [320]);   // the home page's pictures, ready before anyone asks
  }
  return built;
}
const cat = () => catalog.get() || { sets: [], upcoming: [] };
// names.json is the bot's roster: uid → { name, avatar } (the first version was a bare string)
const nameEntry = (uid) => { const v = namesFeed.get()?.names?.[uid]; return typeof v === 'string' ? { name: v, avatar: null } : (v || null); };
const nameOf = (uid, req = null) => (req?.session?.user?.id === uid ? (req.session.user.global_name || req.session.user.username) : null) || P.displayName(data(), inventory.get(), uid) || nameEntry(uid)?.name || P.maskName(uid);
const avatarOf = (uid, req = null) => (req?.session?.user?.id === uid ? avatarFor(req.session.user) : null) || nameEntry(uid)?.avatar || null;

// ── helpers ───────────────────────────────────────────────────
function avatarFor(user) {
  return user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : '/img/pokebot.png';
}
function navUser(user) {
  return user
    ? `<a class="pill" href="/dashboard"><img src="${escapeHtml(avatarFor(user))}" alt=""> ${escapeHtml(user.global_name || user.username)}</a><a href="/logout">Logout</a>`
    : `<a class="btn btn-primary btn-sm" href="/login">Login with Discord</a>`;
}
const page = (req, view, vars = {}) => render(view, { NAV_USER: navUser(req.session?.user), INVITE_URL, SUPPORT_URL, VOTE_URL, ...vars });
const fmtDate = ms => ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
const rarityLabel = r => ({ sir: 'SIR', ultra: 'Ultra Rare' }[r] || (r ? r[0].toUpperCase() + r.slice(1) : ''));
const publicSet = s => ({ name: s.name, slug: s.slug, source: s.source, series: s.series, originalRelease: s.originalRelease, releaseAt: s.releaseAt, notes: s.notes, total: s.total });
const withPop = (s) => ({ ...publicSet(s), pop: P.setPop(data(), s.slug), chase: s.cards.filter(c => P.rank(c.rarity) >= P.RANK.holo).sort((a, b) => P.rank(b.rarity) - P.rank(a.rarity)).slice(0, 4).map(c => ({ ...c, href: `/cards/${s.slug}/${c.slug}` })) });

// ── middleware ────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '30d', etag: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'pk-secret-2024', resave: false, saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax', secure: false },
}));
if (DEMO && process.env.DEV_USER) app.use((req, res, next) => { req.session.user = { id: process.env.DEV_USER, username: 'demo_trainer', global_name: 'Demo Trainer', avatar: null }; next(); });

// ── vote webhook + the bot's file endpoints (unchanged) ───────
app.post('/dblwebhook', webhook.middleware(), (req, res) => {
  try {
    const userId = req.vote?.user;
    if (!userId) return res.status(400).send('No user');
    const file = 'vote_rewards.json';
    let d = {};
    if (fs.existsSync(file)) { try { d = JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); } catch {} }
    d[userId] = { pending: true, timestamp: Date.now() };
    fs.writeFileSync(file, JSON.stringify(d, null, 2));
    if (!res.headersSent) res.status(200).send('Vote recorded');
  } catch (err) { console.error('Vote webhook error:', err.message); if (!res.headersSent) res.status(500).send('Error'); }
});
app.post('/upload', (req, res) => {
  if (req.body.secret !== (process.env.UPLOAD_SECRET || '')) return res.status(403).send('Forbidden');
  try { const d = JSON.parse(req.body.inventory); fs.writeFileSync('user_inventory.json', req.body.inventory, 'utf8'); inventory.set(d); res.send('✅ File received'); }
  catch { res.status(500).send('Write failed'); }
});
app.get('/vote_rewards.json', (req, res) => { const f = path.join(__dirname, 'vote_rewards.json'); if (fs.existsSync(f)) return res.sendFile(f); res.status(404).send('Not found'); });
app.post('/clear_vote', (req, res) => {
  const { userId } = req.body; const file = 'vote_rewards.json';
  if (!userId) return res.status(400).send('Missing userId');
  try {
    if (!fs.existsSync(file)) return res.status(404).send('Not found');
    const d = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    if (!d[userId]) return res.status(404).send('User not found');
    delete d[userId]; fs.writeFileSync(file, JSON.stringify(d, null, 2)); res.status(200).send('Cleared');
  } catch { res.status(500).send('Error'); }
});

// ── Discord OAuth (unchanged) ─────────────────────────────────
app.get('/login', (req, res) => {
  if (req.query.next) req.session.next = String(req.query.next).startsWith('/') ? req.query.next : '/dashboard';
  res.redirect(`https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`);
});
app.get('/callback', async (req, res) => {
  if (req.query.error) { console.warn('OAuth denied:', req.query.error); return res.redirect('/'); }
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code');
  if (!CLIENT_SECRET) { console.error('OAuth error: CLIENT_SECRET env var is not set on the server.'); return res.status(500).send('Login is misconfigured (missing client secret). Contact the bot owner.'); }
  try {
    const params = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token', params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const userRes = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokenRes.data.access_token}` } });
    req.session.user = userRes.data;
    const next = req.session.next || '/dashboard'; delete req.session.next;
    req.session.save(() => res.redirect(next));
  } catch (err) {
    const discord = err?.response?.data;
    console.error('OAuth error:', discord || err.message);
    if (res.headersSent) return;
    if (discord?.error === 'invalid_client') return res.status(500).send('Login failed: invalid client credentials (check CLIENT_SECRET).');
    if (discord?.error === 'invalid_grant' || discord?.error === 'redirect_uri_mismatch') return res.status(500).send('Login failed: redirect URI must exactly equal ' + REDIRECT_URI + ' in the Discord Developer Portal.');
    return res.status(500).send('Login error. Please try again.');
  }
});
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

// ── pictures ──────────────────────────────────────────────────
app.get('/img/card', images.handler);

// ── pages ─────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const user = req.session.user;
  const c = cat();
  const next = c.upcoming[0] || null;
  const teaser = (next?.teaser || []).map(c => `<img src="${escapeHtml(images.thumbUrl(c.image, 160))}" alt="${escapeHtml(c.name)}" title="${escapeHtml(c.name)}" loading="lazy">`).join('');
  res.send(page(req, 'home', {
    NEXT_TEASER: teaser, NEXT_TEASER_NAMES: (next?.teaser || []).map(c => c.name).join(' · '),
    COLLECTION_HREF: user ? '/dashboard' : '/login', COLLECTION_TEXT: user ? 'My binder' : 'Log in — see your binder',
    NEXT_SET_NAME: next ? next.name : '', NEXT_SET_AT: next ? next.releaseAt : 0, NEXT_SET_TOTAL: next ? next.total : 0, NEXT_SET_DATE: next ? fmtDate(next.releaseAt) : '',
    NEWEST_SET_NAME: c.sets[0]?.name || '', NEWEST_SET_SLUG: c.sets[0]?.slug || '', SETS_OUT: c.sets.length, CARDS_OUT: c.sets.reduce((n, s) => n + s.total, 0),
  }));
});

app.get('/cards', (req, res) => res.send(page(req, 'cards', {
  TITLE: 'Card database — every Pokébot card', DESC: 'Every set and every card in Pokébot, with how many copies exist, who holds them, top slabs, 1st Editions and shinies.', PATH: '/cards',
  SETS_OUT: cat().sets.length, CARDS_OUT: cat().sets.reduce((n, s) => n + s.total, 0), UPCOMING: cat().upcoming.length,
})));

app.get('/sets/:slug', (req, res) => {
  const set = data().idx.setBySlug.get(req.params.slug);
  if (!set) return notFound(req, res);
  const pop = P.setPop(data(), set.slug) || {};
  const chase = set.cards.filter(c => P.rank(c.rarity) >= P.RANK.holo)[0] || set.cards[0];
  res.send(page(req, 'set', {
    TITLE: `${set.name} — ${set.total} cards · Pokébot`, DESC: `${set.name} in Pokébot: ${set.total} cards, ${(pop.copies || 0).toLocaleString('en-US')} in circulation, ${pop.completions || 0} trainers have the full set.`,
    PATH: `/sets/${set.slug}`, OG_IMAGE: chase?.image || `${SITE}/img/og.jpg`,
    SET_NAME: set.name, SET_SLUG: set.slug, SET_TOTAL: set.total, SET_SERIES: set.series || (set.source === 'classic' ? 'Classic' : ''), SET_RELEASE: set.releaseAt ? `Released ${fmtDate(set.releaseAt)}` : 'Original set',
    SET_LEAD: set.notes ? `${set.notes.replace(/\s*·\s*\d+ cards$/, '')}.` : set.originalRelease ? `First printed ${fmtDate(Date.parse(set.originalRelease))}.` : 'One of the original sets.', SET_BACKDROP: chase ? images.thumbUrl(chase.image, 480) : '',
  }));
});

app.get('/cards/:set/:card', (req, res) => {
  const ref = data().idx.cardByKey.get(`${req.params.set}/${req.params.card}`);
  if (!ref) return notFound(req, res);
  const { set, card } = ref;
  const pop = P.cardPop(data(), ref.key);
  const bits = [`${pop.copies.toLocaleString('en-US')} in circulation`, pop.holders ? `held by ${pop.holders} trainers` : 'nobody holds one yet', pop.best ? `best slab ${pop.best.black ? 'Black Label' : 'grade ' + pop.best.grade}` : null].filter(Boolean);
  res.send(page(req, 'card', {
    TITLE: `${card.name} · ${set.name} — Pokébot`, DESC: `${card.name} (${rarityLabel(card.rarity)}, ${set.name}) in Pokébot: ${bits.join(' · ')}.`,
    PATH: `/cards/${ref.key}`, OG_IMAGE: card.image, OG_TYPE: 'article',
    CARD_NAME: card.name, CARD_N: card.n, CARD_RARITY: card.rarity, CARD_RARITY_LABEL: rarityLabel(card.rarity), CARD_IMAGE: card.image, CARD_THUMB: images.thumbUrl(card.image, 640), CARD_KEY: ref.key,
    SET_NAME: set.name, SET_SLUG: set.slug, SET_TOTAL: set.total,
  }));
});

app.get('/leaderboards', (req, res) => res.send(page(req, 'leaderboards', { TITLE: 'Leaderboards — Pokébot', DESC: 'The biggest binders, the most Gem Mints, 1st Edition hunters, World Firsts, shiny collectors and set completion across every Pokébot server.', PATH: '/leaderboards' })));

app.get('/t/:uid', (req, res) => {
  const uid = String(req.params.uid).replace(/\D/g, '');
  const d = P.userDetail(data(), inventory.get(), cat(), uid);
  if (!d) return notFound(req, res);
  const name = nameOf(uid, req);
  const me = req.session.user && req.session.user.id === uid;
  res.send(page(req, 'profile', {
    TITLE: `${name}'s binder — Pokébot`, DESC: `${d.total.toLocaleString('en-US')} cards, ${d.unique} unique, ${d.graded} slabs${d.tens ? `, ${d.tens} Gem Mint` : ''}${d.shinies ? `, ${d.shinies} shiny` : ''}${d.firstEd ? `, ${d.firstEd} 1st Editions` : ''}.`,
    PATH: `/t/${uid}`, OG_IMAGE: d.rarest?.image || `${SITE}/img/og.jpg`, ROBOTS: '<meta name="robots" content="noindex">',
    PROFILE_NAME: name, PROFILE_UID: uid, PROFILE_AVATAR: avatarOf(uid, req) || '/img/pokebot.png', IS_ME: me ? '1' : '',
  }));
});

app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login?next=/dashboard');
  const user = req.session.user;
  res.send(page(req, 'dashboard', { TITLE: 'My binder — Pokébot', DESC: 'Your Pokébot binder.', PATH: '/dashboard', ROBOTS: '<meta name="robots" content="noindex">',
    USERNAME: user.global_name || user.username, AVATAR: avatarFor(user), UID: user.id }));
});

app.get(['/commands', '/faq'], (req, res) => res.send(page(req, 'commands', { TITLE: 'Every command — Pokébot', DESC: 'Every Pokébot slash command, straight from the bot\'s own /help, plus answers to the questions everyone asks.', PATH: '/commands' })));
app.get('/terms-of-service', (req, res) => res.send(page(req, 'terms', { TITLE: 'Terms of Service — Pokébot', DESC: 'The rules for using Pokébot on Discord.', PATH: '/terms-of-service' })));
app.get('/privacy-policy', (req, res) => res.send(page(req, 'privacy', { TITLE: 'Privacy Policy — Pokébot', DESC: 'What Pokébot stores, why, and how to request deletion.', PATH: '/privacy-policy' })));

// ── JSON ──────────────────────────────────────────────────────
app.get('/stats', (req, res) => res.json(data().stats));
app.get('/api/feed', (req, res) => res.json(data().feed));
app.get('/api/news', (req, res) => res.json(news.get() || []));
app.get('/api/help', (req, res) => res.json(help.get() || { groups: [] }));
app.get('/api/catalog', (req, res) => { const c = cat(); res.json({ generatedAt: c.generatedAt, sets: c.sets.map(withPop), upcoming: c.upcoming, stats: { sets: c.sets.length, cards: c.sets.reduce((n, s) => n + s.total, 0), circulating: data().stats.circulating } }); });
app.get('/api/sets/:slug', (req, res) => {
  const set = data().idx.setBySlug.get(req.params.slug);
  if (!set) return res.status(404).json({ error: 'Not found' });
  res.json({ ...withPop(set), cards: set.cards.map(c => { const p = P.cardPop(data(), `${set.slug}/${c.slug}`); return { ...c, href: `/cards/${set.slug}/${c.slug}`, copies: p.copies, holders: p.holders, graded: p.graded, best: p.best ? p.best.grade : null, black: p.black > 0, firstEd: p.firstEd, wf: p.wf, shiny: p.shiny }; }) });
});
app.get('/api/cards/:set/:card', (req, res) => {
  const ref = data().idx.cardByKey.get(`${req.params.set}/${req.params.card}`);
  if (!ref) return res.status(404).json({ error: 'Not found' });
  const { set, card } = ref; const i = set.cards.indexOf(card);
  const pop = P.cardPop(data(), ref.key);
  const nb = (c) => c ? { name: c.name, slug: c.slug, n: c.n, rarity: c.rarity, image: c.image, href: `/cards/${set.slug}/${c.slug}` } : null;
  res.json({ card: { ...card, href: `/cards/${ref.key}` }, set: publicSet(set), pop: { ...pop, holders: pop.holders, slabs: pop.slabs }, prev: nb(set.cards[i - 1]), next: nb(set.cards[i + 1]),
    odds: pullOdds(card.rarity), setPop: P.setPop(data(), set.slug) });
});
app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ results: [] });
  const out = [];
  for (const set of cat().sets) for (const c of set.cards) {
    const n = c.name.toLowerCase();
    if (n.includes(q) || set.name.toLowerCase().includes(q)) { const p = P.cardPop(data(), `${set.slug}/${c.slug}`); out.push({ name: c.name, set: set.name, setSlug: set.slug, rarity: c.rarity, image: c.image, href: `/cards/${set.slug}/${c.slug}`, copies: p.copies, score: (n.startsWith(q) ? 2 : n.includes(q) ? 1 : 0) * 10 + P.rank(c.rarity) }); }
  }
  out.sort((a, b) => b.score - a.score || b.copies - a.copies);
  res.json({ results: out.slice(0, 30).map(({ score, ...r }) => r) });
});
app.get('/api/boards', (req, res) => {
  const b = data().boards; const me = req.session.user?.id || null;
  const out = {};
  for (const [k, v] of Object.entries(b)) out[k] = { title: v.title, unit: v.unit, rows: v.rows.map((r, i) => ({ rank: i + 1, uid: r.uid, name: nameOf(r.uid, req), avatar: avatarOf(r.uid, req), v: r.v, sub: r.sub, me: r.uid === me })) };
  res.json({ boards: out, updated: data().built, me });
});
app.get('/api/profile/:uid', (req, res) => {
  const uid = String(req.params.uid).replace(/\D/g, '');
  const d = P.userDetail(data(), inventory.get(), cat(), uid);
  if (!d) return res.status(404).json({ error: 'Not found' });
  res.json({ ...d, name: nameOf(uid, req), avatar: avatarOf(uid, req), me: req.session.user?.id === uid });
});
app.get('/api/pool', (req, res) => {   // the simulator: every card of a released set (or all of them), with the bot's odds
  const slug = req.query.set ? String(req.query.set) : null;
  const sets = slug ? cat().sets.filter(s => s.slug === slug) : cat().sets;
  const pool = []; for (const s of sets) for (const c of s.cards) pool.push({ name: c.name, rarity: c.rarity, set: s.name, image: c.image, href: `/cards/${s.slug}/${c.slug}` });
  res.json({ pool, sets: cat().sets.map(s => ({ name: s.name, slug: s.slug, total: s.total })), odds: ODDS });
});

// the logged-in trainer
const me = (req, res, next) => { if (!req.session.user) return res.status(403).json({ error: 'login' }); next(); };
app.get('/api/summary', me, (req, res) => { const d = P.userDetail(data(), inventory.get(), cat(), req.session.user.id, { full: true }); res.json(d || { total: 0, empty: true }); });
app.get('/api/checklist/:slug', me, (req, res) => { const c = P.checklist(data(), inventory.get(), cat(), req.session.user.id, req.params.slug); if (!c) return res.status(404).json({ error: 'Not found' }); res.json(c); });
app.get('/api/cards', me, (req, res) => {
  try {
    const uid = req.session.user.id;
    const rarity = String(req.query.rarity || 'all').toLowerCase(), grade = String(req.query.grade || 'all'), condition = String(req.query.condition || 'all').toLowerCase();
    const set = String(req.query.set || 'all'), sort = String(req.query.sort || 'newest'), search = String(req.query.search || '').toLowerCase().trim(), special = String(req.query.special || 'all');
    const pageN = Math.max(1, parseInt(req.query.page) || 1), perPage = 24;
    const list = (inventory.get()?.[uid]?.cards || []);
    const dupes = new Map(); for (const c of list) { const k = P.imgKey(c.image) || `${c.set}|${c.name}`; dupes.set(k, (dupes.get(k) || 0) + 1); }
    const at = c => P.toMillis(c.obtainedAt) || 0;
    let filtered = list.map((c, i) => ({ c, i })).filter(({ c }) => {
      if (rarity !== 'all' && P.lc(c.rarity) !== rarity) return false;
      if (grade === 'graded') { if (!c.grade) return false; } else if (grade === 'raw') { if (c.grade) return false; } else if (grade !== 'all' && String(c.grade || '') !== grade) return false;
      if (condition !== 'all' && P.lc(c.condition) !== condition) return false;
      if (set !== 'all' && (c.set || '') !== set) return false;
      if (special === 'first' && !P.isFirst(c)) return false;
      if (special === 'wf' && !P.isWF(c)) return false;
      if (special === 'shiny' && !c.shiny) return false;
      if (special === 'dupes' && (dupes.get(P.imgKey(c.image) || `${c.set}|${c.name}`) || 0) < 2) return false;
      if (special === 'locked' && !c.locked) return false;
      if (search && !(c.name || '').toLowerCase().includes(search) && !(c.code || '').toLowerCase().includes(search)) return false;
      return true;
    });
    const byName = (a, b) => String(a.c.name || '').localeCompare(String(b.c.name || ''));
    const sorters = {
      newest: (a, b) => (at(b.c) - at(a.c)) || (b.i - a.i), oldest: (a, b) => (at(a.c) - at(b.c)) || (a.i - b.i),
      rarity: (a, b) => (P.score(b.c) - P.score(a.c)) || byName(a, b), grade: (a, b) => ((Number(b.c.grade) || 0) - (Number(a.c.grade) || 0)) || (P.rank(b.c.rarity) - P.rank(a.c.rarity)) || byName(a, b),
      value: (a, b) => (P.value(b.c) - P.value(a.c)) || byName(a, b), name: (a, b) => byName(a, b) || (P.rank(b.c.rarity) - P.rank(a.c.rarity)), set: (a, b) => String(a.c.set || '').localeCompare(String(b.c.set || '')) || byName(a, b),
    };
    filtered.sort(sorters[sort] || sorters.newest);
    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    const cards = filtered.slice((pageN - 1) * perPage, pageN * perPage).map(({ c }) => { const ref = data().idx.resolve(c); return { ...c, href: ref ? `/cards/${ref.key}` : null, value: P.value(c), black: !!c.grade && P.isBlack(c.subgrades), copies: dupes.get(P.imgKey(c.image) || `${c.set}|${c.name}`) || 1 }; });
    res.json({ cards, totalPages, total: filtered.length });
  } catch (err) { console.error('Cards API error:', err.message); res.status(500).json({ cards: [], totalPages: 0 }); }
});

// the bot's real pack odds (config PACK.LAST_SLOT_FALLBACK, GOD_PACK_CHANCE, SHINY.PACK_CHANCE, CONDITION_ROLLS)
const ODDS = { bonus: [['sir', 1.5], ['ultra', 4], ['holo', 9], ['promo', 14], ['rare', 20], ['uncommon', 51.5]], shape: ['common', 'common', 'uncommon', 'uncommon', 'bonus'], godPack: 1 / 200, shiny: 1 / 5000,
  condition: { holo: [['Pristine', 0.10], ['Mint', 0.40], ['Near Mint', 0.75], ['Light Play', 0.95], ['Damaged', 1]], normal: [['Pristine', 0.05], ['Mint', 0.20], ['Near Mint', 0.60], ['Light Play', 0.85], ['Damaged', 1]] } };
function pullOdds(rarity) {
  const total = ODDS.bonus.reduce((s, [, w]) => s + w, 0);
  const w = ODDS.bonus.find(([k]) => k === rarity);
  if (rarity === 'common') return { slot: 'two of every pack', pct: null };
  if (!w) return { slot: null, pct: null };
  return { slot: 'the bonus slot', pct: Math.round(w[1] / total * 1000) / 10 };
}

// ── SEO ───────────────────────────────────────────────────────
app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /api/\nDisallow: /img/card\nSitemap: ${SITE}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => {
  const urls = ['/', '/cards', '/leaderboards', '/commands', '/terms-of-service', '/privacy-policy'];
  for (const s of cat().sets) { urls.push(`/sets/${s.slug}`); for (const c of s.cards) urls.push(`/cards/${s.slug}/${c.slug}`); }
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${SITE}${escapeHtml(u)}</loc></url>`).join('\n')}\n</urlset>`);
});
app.get('/healthz', (req, res) => res.json({ ok: true, built: data().built, inventoryFetchedAt: inventory.fetchedAt(), thumbs: images.stats(), demo: DEMO }));

// ── 404 ───────────────────────────────────────────────────────
function notFound(req, res) {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).send(page(req, '404', { TITLE: 'Page not found — Pokébot', PATH: req.path }));
}
app.use(notFound);

// ── start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 thepokebot.com on port ${PORT}${DEMO ? ' (DEMO)' : ''}`);
  console.log('CLIENT_SECRET loaded:', CLIENT_SECRET ? `YES (${CLIENT_SECRET.length} chars)` : 'NO');
  catalog.get(); help.get(); news.get(); inventory.get(); namesFeed.get();       // warm every feed, then keep them fresh
  setTimeout(() => { const urls = []; for (const s of cat().sets) for (const c of s.cards.filter(c => P.rank(c.rarity) >= P.RANK.holo).slice(0, 4)) urls.push(c.image); images.warm(urls, [160, 240]); }, 5000);   // set covers
  setInterval(() => { inventory.get(); news.get(); catalog.get(); help.get(); namesFeed.get(); }, 60 * 1000);
});
