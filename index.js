const express = require('express');
const { Webhook } = require('@top-gg/sdk');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const axios = require('axios');

const app = express();
const webhook = new Webhook('252566');

const CLIENT_ID     = '1362516883785515199';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '';
const REDIRECT_URI  = 'https://thepokebot.com/callback';
const INVITE_URL    = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=534723951680&scope=bot+applications.commands`;
const ASSET_V       = Date.now().toString(36);            // cache-buster for css/js, changes on every deploy

// ── In-memory caches ──────────────────────────────────────────────────────
let inventoryCache    = null;
let inventoryFetchedAt = 0;
let statsCache        = null;
let statsFetchedAt    = 0;
let feedCache         = null;   // { key, recent, showcase, pool }
const INVENTORY_TTL = 2 * 60 * 1000; // 2 min
const STATS_TTL     = 3 * 60 * 1000; // 3 min
const LOCAL_INVENTORY = path.join(__dirname, 'user_inventory.json');

// The bot commits user_inventory.json to GitHub every ~3 min. The site reads it
// back so the dashboard stays live. Override the URL with an env var if the
// repo/branch ever changes. Local disk is used as a cold-start fallback.
const INVENTORY_URL = process.env.INVENTORY_URL ||
  'https://raw.githubusercontent.com/Yo0l0/ssss/main/user_inventory.json';

// Background refresh — pulls the latest inventory and updates the cache.
async function refreshInventory() {
  if (!INVENTORY_URL) return;
  try {
    const res = await axios.get(INVENTORY_URL, {
      params: { _: Date.now() },            // cache-buster vs GitHub's CDN
      headers: { 'Cache-Control': 'no-cache' },
      timeout: 10000,
      responseType: 'text',
      transformResponse: [d => d]           // keep raw text; we JSON.parse below
    });
    const data = JSON.parse(res.data);      // throws on bad/HTML response → caught
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      inventoryCache     = data;
      inventoryFetchedAt = Date.now();
      statsCache         = null;            // force stats to recompute
      feedCache          = null;
      try { fs.writeFileSync(LOCAL_INVENTORY, res.data, 'utf8'); } catch {}
      console.log('✅ Inventory refreshed from GitHub —', Object.keys(data).length, 'users');
    }
  } catch (err) {
    console.error('Inventory refresh failed:', err?.response?.status || '', err.message);
  }
}

// Sync accessor for the routes: returns the cache instantly, refreshes in the
// background when stale (never blocks a request).
function getInventory() {
  const now = Date.now();
  if (now - inventoryFetchedAt > INVENTORY_TTL) refreshInventory(); // fire-and-forget
  if (inventoryCache) return inventoryCache;
  try {
    if (!fs.existsSync(LOCAL_INVENTORY)) return {};
    inventoryCache     = JSON.parse(fs.readFileSync(LOCAL_INVENTORY, 'utf8'));
    inventoryFetchedAt = now;
    return inventoryCache;
  } catch (err) {
    console.error('Failed to read local inventory:', err.message);
    return inventoryCache || {};
  }
}

// Normalize any timestamp shape (number, numeric string, ISO string) to ms
function toMillis(ts) {
  if (ts == null) return NaN;
  if (typeof ts === 'number') return ts;
  const n = Number(ts);
  if (!Number.isNaN(n)) return n;          // numeric string
  const d = new Date(ts).getTime();        // ISO / date string
  return Number.isNaN(d) ? NaN : d;
}

function getStats() {
  const now = Date.now();
  if (statsCache && now - statsFetchedAt < STATS_TTL) return statsCache;

  try {
    const data = getInventory();
    let totalCards = 0, totalUsers = 0, droppedToday = 0;
    const packTimestamps   = new Set();
    const dropCountsByDay  = {};
    const todayStart = new Date().setUTCHours(0, 0, 0, 0);

    for (const userId in data) {
      const cards = data[userId]?.cards;
      if (!Array.isArray(cards)) continue;
      totalUsers++;
      totalCards += cards.length;

      for (const card of cards) {
        const ms = toMillis(card.obtainedAt);
        if (Number.isNaN(ms)) continue;

        packTimestamps.add(ms);
        const day = new Date(ms).toISOString().split('T')[0];
        dropCountsByDay[day] = (dropCountsByDay[day] || 0) + 1;
        if (ms >= todayStart) droppedToday++;
      }
    }

    // Week averages: total drops ÷ days ELAPSED (not just active days). All UTC
    // so the day buckets (built with toISOString) and the week math agree.
    const DAY = 24 * 60 * 60 * 1000;
    const utcMidnight = new Date(now); utcMidnight.setUTCHours(0, 0, 0, 0);
    const dowUTC = utcMidnight.getUTCDay();                  // 0 = Sunday
    const thisWeekStart = utcMidnight.getTime() - dowUTC * DAY;
    const lastWeekStart = thisWeekStart - 7 * DAY;

    let thisWeekDrops = 0, lastWeekDrops = 0;
    for (const [day, count] of Object.entries(dropCountsByDay)) {
      const t = Date.parse(day + 'T00:00:00Z');
      if (t >= thisWeekStart && t <= now)                 thisWeekDrops += count;
      else if (t >= lastWeekStart && t < thisWeekStart)   lastWeekDrops += count;
    }
    const daysElapsed = Math.max(1, Math.floor((now - thisWeekStart) / DAY) + 1); // 1–7

    statsCache = {
      totalCards,
      totalUsers,
      totalPacks: packTimestamps.size,
      droppedToday,
      thisWeekAvg: Math.round(thisWeekDrops / daysElapsed),
      lastWeekAvg: Math.round(lastWeekDrops / 7)
    };
    statsFetchedAt = now;
    return statsCache;
  } catch (err) {
    console.error('Stats error:', err.message);
    return statsCache || { totalCards:0, totalUsers:0, totalPacks:0, droppedToday:0, thisWeekAvg:0, lastWeekAvg:0 };
  }
}

// ── Network-wide feed: recent pulls, showcase pulls, demo card pool ───────
const RARITY_RANK = { common:1, uncommon:2, rare:3, promo:4, holo:5, sir:6, mythical:7 };
const rarityRank = r => RARITY_RANK[String(r || '').toLowerCase()] || 0;

function getFeed() {
  const data = getInventory();
  const key = inventoryFetchedAt;
  if (feedCache && feedCache.key === key) return feedCache;
  try {
    const all = [];
    const byImage = new Map();               // distinct cards for the demo pool
    for (const userId in data) {
      const cards = data[userId]?.cards;
      if (!Array.isArray(cards)) continue;
      for (const c of cards) {
        if (!c || !c.name) continue;
        const ms = toMillis(c.obtainedAt);
        if (!Number.isNaN(ms)) all.push({ name:c.name, rarity:c.rarity, set:c.set, image:c.image, grade:c.grade || null, at:ms });
        if (c.image && !byImage.has(c.image)) byImage.set(c.image, { name:c.name, rarity:String(c.rarity || 'common').toLowerCase(), set:c.set, image:c.image });
      }
    }
    all.sort((a, b) => b.at - a.at);
    const recent = all.slice(0, 30).map(({ image, grade, ...rest }) => rest);   // no images: keeps the marquee light
    const seen = new Set(), showcase = [];
    for (const c of all) {
      if (rarityRank(c.rarity) < RARITY_RANK.rare || !c.image || seen.has(c.image)) continue;
      seen.add(c.image); showcase.push(c);
      if (showcase.length >= 6) break;
    }
    // demo pool: up to 40 distinct cards per rarity, shuffled
    const buckets = {};
    for (const c of byImage.values()) (buckets[c.rarity] = buckets[c.rarity] || []).push(c);
    const pool = [];
    for (const list of Object.values(buckets)) {
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      pool.push(...list.slice(0, 40));
    }
    feedCache = { key, recent, showcase, pool, updated: Date.now() };
  } catch (err) {
    console.error('Feed error:', err.message);
    feedCache = { key, recent:[], showcase:[], pool:[], updated: Date.now() };
  }
  return feedCache;
}

// ── Tiny template renderer: {{> partial}}, {{VAR}} (escaped), {{{VAR}}} raw ─
const VIEWS = path.join(__dirname, 'views');
const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
function render(view, vars = {}) {
  const base = {
    TITLE: 'Pokebot — Collect, Grade, Duel, Trade',
    DESC: 'A premium Pokémon-style card game for Discord. Rip packs, grade your best pulls, duel rivals and trade on the marketplace.',
    PATH: '/', YEAR: new Date().getFullYear(), V: ASSET_V, NAV_USER: '', INVITE_URL
  };
  const all = { ...base, ...vars };
  const read = name => fs.readFileSync(path.join(VIEWS, name + '.html'), 'utf8');
  const expand = src => src
    .replace(/\{\{>\s*([\w/-]+)\s*\}\}/g, (_, p) => expand(read('partials/' + p)))
    .replace(/\{\{\{\s*(\w+)\s*\}\}\}/g, (_, k) => all[k] == null ? '' : String(all[k]))
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => escapeHtml(all[k]));
  return expand(read(view)).replace(/\/(css|js)\/([\w.-]+)"/g, `/$1/$2?v=${ASSET_V}"`);
}
function avatarFor(user) {
  return user?.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : '/img/pokebot.png';
}
function navUser(user) {
  return user
    ? `<a class="pill" href="/dashboard"><img src="${escapeHtml(avatarFor(user))}" alt=""> ${escapeHtml(user.username)}</a><a href="/logout">Logout</a>`
    : `<a class="btn btn-primary btn-sm" href="/login">Login with Discord</a>`;
}

// ── Middleware ────────────────────────────────────────────────────────────
app.set('trust proxy', 1); // behind nginx/Render — needed for correct protocol & secure cookies
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '30d', etag: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'pk-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax', secure: false }
}));

// ── Vote webhook ──────────────────────────────────────────────────────────
app.post('/dblwebhook', webhook.middleware(), (req, res) => {
  try {
    const userId = req.vote?.user;
    if (!userId) return res.status(400).send('No user');
    console.log('✅ Vote received from', userId);

    const file = 'vote_rewards.json';
    let data = {};
    if (fs.existsSync(file)) {
      try { data = JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); } catch {}
    }
    data[userId] = { pending: true, timestamp: Date.now() };
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    if (!res.headersSent) res.status(200).send('Vote recorded');
  } catch (err) {
    console.error('Vote webhook error:', err.message);
    if (!res.headersSent) res.status(500).send('Error');
  }
});

// ── File upload from bot ──────────────────────────────────────────────────
app.post('/upload', (req, res) => {
  if (req.body.secret !== (process.env.UPLOAD_SECRET || '')) {
    return res.status(403).send('Forbidden');
  }
  try {
    fs.writeFileSync('user_inventory.json', req.body.inventory, 'utf8');
    // invalidate cache
    inventoryCache = null;
    statsCache     = null;
    feedCache      = null;
    res.send('✅ File received');
  } catch (err) {
    res.status(500).send('Write failed');
  }
});

// ── Static file endpoints ─────────────────────────────────────────────────
app.get('/user_inventory.json', (req, res) => res.sendFile(path.join(__dirname, 'user_inventory.json')));
app.get('/vote_rewards.json',   (req, res) => {
  const f = path.join(__dirname, 'vote_rewards.json');
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(404).send('Not found');
});

// ── Pages: commands/FAQ, legal ────────────────────────────────────────────
app.get(['/faq', '/commands'], (req, res) => res.send(render('commands', {
  TITLE: 'Commands & FAQ — Pokebot', DESC: 'Every Pokebot slash command, plus answers to common questions about packs, coins, grading, fusion and duels.',
  PATH: '/faq', NAV_USER: navUser(req.session.user)
})));
app.get('/terms-of-service', (req, res) => res.send(render('terms', {
  TITLE: 'Terms of Service — Pokebot', DESC: 'The rules for using Pokebot on Discord.', PATH: '/terms-of-service', NAV_USER: navUser(req.session.user)
})));
app.get('/privacy-policy', (req, res) => res.send(render('privacy', {
  TITLE: 'Privacy Policy — Pokebot', DESC: 'What Pokebot stores, why, and how to request deletion.', PATH: '/privacy-policy', NAV_USER: navUser(req.session.user)
})));

// ── News API ──────────────────────────────────────────────────────────────
app.get('/api/news', (req, res) => {
  try {
    const raw  = fs.readFileSync(path.join(__dirname, 'news.json'), 'utf8');
    const news = JSON.parse(raw);
    res.json(news);
  } catch (err) {
    console.error('News API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Stats API ─────────────────────────────────────────────────────────────
app.get('/stats', (req, res) => {
  try {
    const data = getStats();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Stats debug (raw view of what the server computes) ─────────────────────
app.get('/stats/debug', (req, res) => {
  try {
    const data = getInventory();
    let sampleStamps = [];
    for (const userId in data) {
      const cards = data[userId]?.cards;
      if (Array.isArray(cards)) {
        for (const c of cards.slice(0, 3)) {
          sampleStamps.push({ raw: c.obtainedAt, ms: toMillis(c.obtainedAt) });
        }
      }
      if (sampleStamps.length >= 9) break;
    }
    res.json({ stats: getStats(), now: Date.now(), todayStart: new Date().setHours(0,0,0,0), sampleStamps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Feed + demo pool APIs (public; no user data, only card names/images) ──
app.get('/api/feed', (req, res) => {
  try {
    const f = getFeed();
    res.json({ recent: f.recent, showcase: f.showcase, updated: f.updated });
  } catch (err) { res.status(500).json({ recent: [], showcase: [] }); }
});
app.get('/api/pool', (req, res) => {
  try { res.json({ pool: getFeed().pool }); }
  catch (err) { res.status(500).json({ pool: [] }); }
});

// ── Clear vote ────────────────────────────────────────────────────────────
app.post('/clear_vote', (req, res) => {
  const { userId } = req.body;
  const file = 'vote_rewards.json';
  if (!userId) return res.status(400).send('Missing userId');
  try {
    if (!fs.existsSync(file)) return res.status(404).send('Not found');
    const data = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    if (!data[userId]) return res.status(404).send('User not found');
    delete data[userId];
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    res.status(200).send('Cleared');
  } catch (err) {
    res.status(500).send('Error');
  }
});

// ── Discord OAuth ─────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
  const url = `https://discord.com/oauth2/authorize` +
    `?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code&scope=identify`;
  res.redirect(url);
});

app.get('/callback', async (req, res) => {
  if (req.query.error) {                 // user cancelled or Discord rejected
    console.warn('OAuth denied:', req.query.error, req.query.error_description || '');
    return res.redirect('/');
  }
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code');

  if (!CLIENT_SECRET) {
    console.error('OAuth error: CLIENT_SECRET env var is not set on the server.');
    return res.status(500).send('Login is misconfigured (missing client secret). Contact the bot owner.');
  }

  try {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI
    });
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
    });
    req.session.user = userRes.data;
    req.session.save(() => res.redirect('/dashboard')); // persist before redirect
  } catch (err) {
    const discord = err?.response?.data;
    console.error('OAuth error:', discord || err.message);
    if (res.headersSent) return;
    if (discord?.error === 'invalid_client') {
      return res.status(500).send('Login failed: invalid client credentials (check CLIENT_SECRET).');
    }
    if (discord?.error === 'invalid_grant' || discord?.error === 'redirect_uri_mismatch') {
      return res.status(500).send('Login failed: redirect URI must exactly equal ' + REDIRECT_URI + ' in the Discord Developer Portal.');
    }
    return res.status(500).send('Login error. Please try again.');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ── Cards API (paginated, filtered, sorted) ──────────────────────────────
app.get('/api/cards', (req, res) => {
  if (!req.session.user) return res.status(403).json({ cards: [], totalPages: 0 });
  try {
    const data      = getInventory();
    const userId    = req.session.user.id;
    const rarity    = (req.query.rarity    || 'all').toLowerCase();
    const grade     = req.query.grade     || 'all';
    const condition = (req.query.condition || 'all').toLowerCase();
    const set       = req.query.set       || 'all';
    const sort      = req.query.sort      || 'newest';
    const search    = (req.query.search   || '').toLowerCase().trim();
    const page      = Math.max(1, parseInt(req.query.page) || 1);
    const perPage   = 24;

    const cards = (data[userId]?.cards || []).map((c, i) => ({ ...c, _i: i }));
    let filtered = cards.filter(c => {
      if (rarity    !== 'all' && (c.rarity || '').toLowerCase() !== rarity) return false;
      if (grade === 'graded') { if (!c.grade) return false; }
      else if (grade !== 'all' && String(c.grade || '') !== grade) return false;
      if (condition !== 'all' && (c.condition || '').toLowerCase() !== condition) return false;
      if (set       !== 'all' && (c.set || '') !== set) return false;
      if (search && !(c.name || '').toLowerCase().includes(search) && !(c.code || '').toLowerCase().includes(search)) return false;
      return true;
    });

    const at = c => { const ms = toMillis(c.obtainedAt); return Number.isNaN(ms) ? 0 : ms; };
    const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
    const sorters = {
      newest: (a, b) => (at(b) - at(a)) || (b._i - a._i),
      oldest: (a, b) => (at(a) - at(b)) || (a._i - b._i),
      rarity: (a, b) => (rarityRank(b.rarity) - rarityRank(a.rarity)) || (Number(b.grade) || 0) - (Number(a.grade) || 0) || byName(a, b),
      grade:  (a, b) => ((Number(b.grade) || 0) - (Number(a.grade) || 0)) || (rarityRank(b.rarity) - rarityRank(a.rarity)) || byName(a, b),
      name:   (a, b) => byName(a, b) || (rarityRank(b.rarity) - rarityRank(a.rarity)),
      set:    (a, b) => String(a.set || '').localeCompare(String(b.set || '')) || byName(a, b)
    };
    filtered.sort(sorters[sort] || sorters.newest);

    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    const pageCards  = filtered.slice((page - 1) * perPage, page * perPage).map(({ _i, ...c }) => c);
    res.json({ cards: pageCards, totalPages, total: filtered.length });
  } catch (err) {
    console.error('Cards API error:', err.message);
    res.status(500).json({ cards: [], totalPages: 0 });
  }
});

// ── Collection summary (powers the dashboard header + breakdowns) ─────────
app.get('/api/summary', (req, res) => {
  if (!req.session.user) return res.status(403).json({});
  try {
    const cards = getInventory()[req.session.user.id]?.cards || [];
    const setMap = new Map(), byRarity = {}, uniqueImages = new Set();
    let graded = 0, topGrade = 0, tens = 0, rarest = null, rarestRank = 0;
    for (const c of cards) {
      const setName = c.set || 'Unknown set';
      const s = setMap.get(setName) || { name: setName, count: 0, images: new Set() };
      s.count++; if (c.image) s.images.add(c.image); setMap.set(setName, s);
      if (c.image) uniqueImages.add(c.image);
      const r = String(c.rarity || 'common').toLowerCase();
      byRarity[r] = (byRarity[r] || 0) + 1;
      if (c.grade) { graded++; topGrade = Math.max(topGrade, Number(c.grade) || 0); if (Number(c.grade) === 10) tens++; }
      const rank = rarityRank(c.rarity) * 100 + (Number(c.grade) || 0);
      if (rank > rarestRank) { rarestRank = rank; rarest = c; }
    }
    const bySet = [...setMap.values()].map(s => ({ name: s.name, count: s.count, unique: s.images.size })).sort((a, b) => b.count - a.count);
    res.json({
      total: cards.length,
      unique: uniqueImages.size,
      sets: setMap.size,
      graded, topGrade, tens,
      byRarity, bySet,
      rarest: rarest ? { name: rarest.name, rarity: rarest.rarity, image: rarest.image, set: rarest.set, grade: rarest.grade || null } : null
    });
  } catch (err) {
    console.error('Summary API error:', err.message);
    res.status(500).json({});
  }
});

// ── Homepage ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const user = req.session.user;
  res.send(render('home', {
    NAV_USER: navUser(user),
    COLLECTION_HREF: user ? '/dashboard' : '/login',
    COLLECTION_TEXT: user ? 'View my collection' : 'Log in to view collection'
  }));
});

// ── Dashboard ─────────────────────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const user = req.session.user;
  res.send(render('dashboard', {
    TITLE: 'My Collection — Pokebot', DESC: 'Your Pokebot card collection.', PATH: '/dashboard',
    NAV_USER: navUser(user), USERNAME: user.global_name || user.username, AVATAR: avatarFor(user)
  }));
});

// ── 404 ───────────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).send(render('404', { TITLE: 'Page not found — Pokebot', PATH: req.path, NAV_USER: navUser(req.session?.user) }));
});

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('CLIENT_SECRET loaded:', CLIENT_SECRET ? `YES (${CLIENT_SECRET.length} chars)` : 'NO');
  refreshInventory();                            // warm the cache on boot
  setInterval(refreshInventory, INVENTORY_TTL);  // keep it fresh even with no traffic
});
