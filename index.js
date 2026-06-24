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

// ── In-memory caches ──────────────────────────────────────────────────────
let inventoryCache    = null;
let inventoryFetchedAt = 0;
let statsCache        = null;
let statsFetchedAt    = 0;
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

// ── Middleware ────────────────────────────────────────────────────────────
app.set('trust proxy', 1); // behind nginx/Render — needed for correct protocol & secure cookies
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'pk-secret-2024',
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
app.get('/faq',              (req, res) => res.sendFile(path.join(__dirname, 'Public.html')));
app.get('/terms-of-service', (req, res) => res.sendFile(path.join(__dirname, 'terms-of-service.html')));
app.get('/privacy-policy',   (req, res) => res.sendFile(path.join(__dirname, 'privacy-policy.html')));

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

// ── Cards API (paginated, filtered) ──────────────────────────────────────
app.get('/api/cards', (req, res) => {
  if (!req.session.user) return res.status(403).json({ cards: [], totalPages: 0 });
  try {
    const data      = getInventory();
    const userId    = req.session.user.id;
    const rarity    = req.query.rarity    || 'all';
    const grade     = req.query.grade     || 'all';
    const condition = req.query.condition || 'all';
    const search    = (req.query.search   || '').toLowerCase();
    const page      = Math.max(1, parseInt(req.query.page) || 1);
    const perPage   = 24;

    const cards = data[userId]?.cards || [];
    const filtered = cards.filter(c => {
      if (rarity    !== 'all' && (c.rarity    || '').toLowerCase() !== rarity.toLowerCase()) return false;
      if (grade     !== 'all' && String(c.grade || '')              !== grade)               return false;
      if (condition !== 'all' && (c.condition  || '').toLowerCase() !== condition.toLowerCase()) return false;
      if (search && !(c.name || '').toLowerCase().includes(search) && !(c.code || '').toLowerCase().includes(search)) return false;
      return true;
    }).reverse();

    const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
    const pageCards  = filtered.slice((page - 1) * perPage, page * perPage);
    res.json({ cards: pageCards, totalPages, total: filtered.length });
  } catch (err) {
    console.error('Cards API error:', err.message);
    res.status(500).json({ cards: [], totalPages: 0 });
  }
});

// ── Collection summary (powers the dashboard header) ──────────────────────
const RARITY_RANK = { common:1, uncommon:2, rare:3, holo:4, promo:5, sir:6, mythical:7 };
app.get('/api/summary', (req, res) => {
  if (!req.session.user) return res.status(403).json({});
  try {
    const cards = getInventory()[req.session.user.id]?.cards || [];
    const sets = new Set();
    let graded = 0, topGrade = 0, rarest = null, rarestRank = 0;
    for (const c of cards) {
      if (c.set) sets.add(c.set);
      if (c.grade) { graded++; topGrade = Math.max(topGrade, Number(c.grade) || 0); }
      const rank = RARITY_RANK[(c.rarity || '').toLowerCase()] || 0;
      if (rank > rarestRank) { rarestRank = rank; rarest = c; }
    }
    res.json({
      total: cards.length,
      sets: sets.size,
      graded,
      topGrade,
      rarest: rarest ? { name: rarest.name, rarity: rarest.rarity, image: rarest.image, grade: rarest.grade || null } : null
    });
  } catch (err) {
    console.error('Summary API error:', err.message);
    res.status(500).json({});
  }
});

// ── Homepage ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const user = req.session.user;
  const avatarUrl = user?.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : 'https://raw.githubusercontent.com/Yo0l0/ssss/main/Pokebot.png';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pokebot — Collect, Grade, Duel, Trade</title>
  <link rel="icon" type="image/png" href="https://raw.githubusercontent.com/Yo0l0/ssss/refs/heads/main/GengarImages.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --void:#0a0612; --abyss:#130c24; --haze:#1b1133; --edge:#2c2050;
      --plasma:#b06bff; --plasma-2:#7c3aed; --gold:#ffc94d; --cyan:#39e0d0;
      --text:#ece4ff; --muted:#9385b8;
      --disp:'Space Grotesk', sans-serif; --body:'Inter', sans-serif;
    }
    html { scroll-behavior: smooth; }
    body {
      font-family: var(--body); background: var(--void); color: var(--text);
      min-height: 100vh; overflow-x: hidden; line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }
    a { color: inherit; }
    ::selection { background: var(--plasma); color: #11071f; }

    /* ambient glows */
    body::before {
      content:''; position: fixed; inset:0; z-index:0; pointer-events:none;
      background:
        radial-gradient(60vw 60vw at 78% -8%, rgba(176,107,255,.18), transparent 60%),
        radial-gradient(50vw 50vw at 8% 12%, rgba(57,224,208,.10), transparent 55%),
        radial-gradient(40vw 40vw at 50% 110%, rgba(124,58,237,.16), transparent 60%);
    }
    /* drifting stars */
    body::after {
      content:''; position: fixed; inset:-50%; z-index:0; pointer-events:none; opacity:.5;
      background-image:
        radial-gradient(1px 1px at 10% 15%, rgba(255,255,255,.7), transparent),
        radial-gradient(1px 1px at 30% 45%, rgba(255,255,255,.4), transparent),
        radial-gradient(1px 1px at 55% 22%, rgba(255,255,255,.5), transparent),
        radial-gradient(1px 1px at 75% 65%, rgba(255,255,255,.35), transparent),
        radial-gradient(1px 1px at 90% 12%, rgba(255,255,255,.6), transparent),
        radial-gradient(1px 1px at 22% 82%, rgba(255,255,255,.4), transparent),
        radial-gradient(1.5px 1.5px at 64% 90%, rgba(192,160,255,.5), transparent);
      animation: drift 90s linear infinite;
    }
    @keyframes drift { from { transform: translate(0,0); } to { transform: translate(-3%, -4%); } }

    .wrap { max-width: 1160px; margin: 0 auto; padding: 0 24px; }

    /* ── NAV ── */
    nav {
      position: sticky; top:0; z-index:100;
      display:flex; align-items:center; justify-content:space-between; gap:16px;
      padding: 13px 24px; background: rgba(10,6,18,.72);
      backdrop-filter: blur(16px); border-bottom: 1px solid var(--edge);
    }
    .brand { display:flex; align-items:center; gap:10px; text-decoration:none;
      font-family:var(--disp); font-weight:700; font-size:1.05rem; color:var(--text); letter-spacing:.01em; }
    .brand img { width:32px; height:32px; border-radius:9px; box-shadow:0 0 0 1px var(--edge), 0 4px 14px rgba(176,107,255,.4); }
    .brand b { color: var(--plasma); }
    .links { display:flex; align-items:center; gap:6px; }
    .links a { padding:8px 15px; border-radius:10px; font-size:.88rem; font-weight:600; color:var(--muted); text-decoration:none; transition:.18s; }
    .links a:hover { color:var(--text); background: rgba(255,255,255,.05); }
    .links a.cta { background:linear-gradient(135deg,var(--plasma),var(--plasma-2)); color:#fff; box-shadow:0 6px 18px rgba(124,58,237,.45); }
    .links a.cta:hover { filter:brightness(1.08); }
    .pill { display:flex; align-items:center; gap:8px; padding:4px 12px 4px 4px; border-radius:24px;
      background:var(--haze); border:1px solid var(--edge); font-size:.85rem; font-weight:600; text-decoration:none; color:var(--text); }
    .pill img { width:26px; height:26px; border-radius:50%; }
    .menu-btn { display:none; background:none; border:1px solid var(--edge); color:var(--text);
      width:40px; height:40px; border-radius:10px; font-size:1.2rem; cursor:pointer; }

    /* ── HERO ── */
    .hero { position:relative; z-index:1; display:grid; grid-template-columns:1.05fr .95fr;
      gap:40px; align-items:center; padding: 84px 0 64px; }
    .eyebrow { display:inline-flex; align-items:center; gap:8px; padding:6px 14px; border-radius:24px;
      background:rgba(176,107,255,.12); border:1px solid rgba(176,107,255,.4);
      font-size:.74rem; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:#d6b6ff; }
    .eyebrow .dot { width:7px; height:7px; border-radius:50%; background:var(--cyan); box-shadow:0 0 8px var(--cyan); animation:pulse 1.8s ease-in-out infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
    h1 { font-family:var(--disp); font-weight:700; font-size:clamp(2.5rem,5.4vw,4.1rem); line-height:1.04; letter-spacing:-.02em; margin:22px 0 18px; }
    h1 .grad { background:linear-gradient(110deg,var(--plasma) 10%,var(--cyan) 90%); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; }
    .lead { max-width:30rem; color:var(--muted); font-size:1.06rem; }
    .hero-btns { display:flex; flex-wrap:wrap; gap:12px; margin-top:30px; }
    .btn { padding:13px 26px; border-radius:12px; font-weight:700; font-size:.95rem; text-decoration:none; transition:.2s; cursor:pointer; border:none; }
    .btn-1 { background:linear-gradient(135deg,var(--plasma),var(--plasma-2)); color:#fff; box-shadow:0 10px 30px rgba(124,58,237,.45); }
    .btn-1:hover { transform:translateY(-2px); filter:brightness(1.08); }
    .btn-2 { background:transparent; color:var(--text); border:1px solid var(--edge); }
    .btn-2:hover { border-color:var(--plasma); color:#d6b6ff; transform:translateY(-2px); }
    .trust { margin-top:24px; font-size:.82rem; color:var(--muted); display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .trust b { color:var(--gold); }

    /* ── FOIL CARD FAN (signature) ── */
    .fan { position:relative; height:420px; perspective:1200px; }
    .foil { position:absolute; top:50%; left:50%; width:208px; aspect-ratio:5/7; border-radius:16px;
      transform-style:preserve-3d; will-change:transform; --base:rotate(0deg);
      transform:translate(-50%,-50%) var(--base) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));
      background:linear-gradient(160deg,#241640,#160d2a); border:1px solid var(--edge);
      box-shadow:0 24px 60px rgba(0,0,0,.55); overflow:hidden; transition:transform .25s ease; }
    .foil .pad { position:absolute; inset:9px; border-radius:11px; background:radial-gradient(120% 90% at 50% 0%, #2b1c4d, #120a24); display:flex; flex-direction:column; }
    .foil .art { flex:1; display:flex; align-items:center; justify-content:center; padding:6px; }
    .foil .art img { width:90%; height:90%; object-fit:contain; filter:drop-shadow(0 8px 14px rgba(0,0,0,.5)); }
    .foil .plate { padding:7px 11px 10px; }
    .foil .plate .nm { font-family:var(--disp); font-weight:700; font-size:.92rem; }
    .foil .plate .rb { font-size:.66rem; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); margin-top:2px; }
    .foil .sheen { position:absolute; inset:0; mix-blend-mode:color-dodge; opacity:.55; pointer-events:none;
      background:
        radial-gradient(60% 60% at var(--mx,50%) var(--my,30%), rgba(255,255,255,.85), transparent 60%),
        linear-gradient(115deg, transparent 30%, rgba(57,224,208,.5) 45%, rgba(176,107,255,.5) 55%, transparent 70%);
      background-size: 200% 200%, 300% 300%; }
    .foil .holo { position:absolute; inset:0; opacity:.22; mix-blend-mode:overlay; pointer-events:none;
      background:repeating-linear-gradient(115deg,#ff5ea2 0 8px,#ffd24d 8px 16px,#5effa6 16px 24px,#5ec8ff 24px 32px,#b06bff 32px 40px);
      background-size:200% 200%; animation:holoshift 6s linear infinite; }
    @keyframes holoshift { from{background-position:0 0} to{background-position:200% 0} }
    .foil.c1 { --base:rotate(-13deg) translateX(-118px); border-top:3px solid var(--gold); }
    .foil.c2 { --base:rotate(0deg) scale(1.06); z-index:3; border-top:3px solid var(--plasma); }
    .foil.c3 { --base:rotate(13deg) translateX(118px); border-top:3px solid var(--cyan); }

    /* ── STAT BAND ── */
    .band { position:relative; z-index:1; }
    .band-head { display:flex; align-items:center; gap:10px; font-size:.78rem; color:var(--muted); letter-spacing:.12em; text-transform:uppercase; margin-bottom:14px; }
    .band-head .dot { width:8px; height:8px; border-radius:50%; background:var(--cyan); box-shadow:0 0 10px var(--cyan); animation:pulse 1.8s infinite; }
    .stats { display:grid; grid-template-columns:repeat(5,1fr); gap:14px; }
    .stat { background:linear-gradient(180deg,var(--abyss),#0d0820); border:1px solid var(--edge); border-radius:16px; padding:22px 16px; text-align:center; transition:.2s; }
    .stat:hover { border-color:var(--plasma); transform:translateY(-3px); box-shadow:0 14px 30px rgba(124,58,237,.25); }
    .stat .ic { font-size:1.15rem; }
    .stat .num { display:block; font-family:var(--disp); font-weight:700; font-size:2rem; color:var(--gold); margin:6px 0 2px; }
    .stat .lbl { font-size:.74rem; color:var(--muted); letter-spacing:.06em; text-transform:uppercase; }

    /* ── SECTIONS ── */
    section.blk { position:relative; z-index:1; padding:64px 0; }
    .stitle { font-family:var(--disp); font-weight:700; font-size:1.6rem; display:flex; align-items:center; gap:14px; margin-bottom:28px; }
    .stitle::after { content:''; flex:1; height:1px; background:linear-gradient(90deg,var(--edge),transparent); }

    /* rarity ladder */
    .ladder { display:flex; gap:10px; flex-wrap:wrap; }
    .tier { flex:1 1 130px; border:1px solid var(--edge); border-radius:14px; padding:16px; background:var(--abyss); position:relative; overflow:hidden; }
    .tier .bar { height:4px; border-radius:4px; margin-bottom:12px; }
    .tier .tn { font-family:var(--disp); font-weight:700; font-size:.98rem; }
    .tier .td { font-size:.76rem; color:var(--muted); margin-top:3px; }
    .tier.shine::before { content:''; position:absolute; inset:0; background:linear-gradient(115deg,transparent 40%,rgba(255,255,255,.13) 50%,transparent 60%); background-size:250% 100%; animation:holoshift 3.5s linear infinite; pointer-events:none; }

    .grid3 { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
    .feat { background:var(--abyss); border:1px solid var(--edge); border-radius:16px; padding:24px; transition:.2s; }
    .feat:hover { border-color:var(--plasma); transform:translateY(-3px); }
    .feat .chip { width:46px; height:46px; border-radius:12px; display:grid; place-items:center; font-size:1.3rem;
      background:rgba(176,107,255,.14); border:1px solid rgba(176,107,255,.3); margin-bottom:14px; }
    .feat h3 { font-family:var(--disp); font-size:1.02rem; margin-bottom:7px; }
    .feat p { font-size:.88rem; color:var(--muted); }

    .news { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:14px; }
    .ncard { background:var(--abyss); border:1px solid var(--edge); border-radius:14px; padding:18px; transition:.2s; }
    .ncard:hover { border-color:var(--cyan); transform:translateY(-3px); }
    .ncard .nd { font-size:.72rem; color:var(--muted); letter-spacing:.06em; text-transform:uppercase; }
    .ncard .nt { font-family:var(--disp); font-weight:700; margin:7px 0 8px; }
    .ncard .nb { font-size:.86rem; color:var(--muted); white-space:pre-line; }

    /* CTA */
    .cta-band { position:relative; z-index:1; text-align:center; margin:24px auto 0; max-width:760px;
      padding:48px 28px; border-radius:24px; border:1px solid var(--edge);
      background:radial-gradient(120% 140% at 50% 0%, rgba(124,58,237,.28), var(--abyss)); }
    .cta-band h2 { font-family:var(--disp); font-size:clamp(1.6rem,3.4vw,2.3rem); margin-bottom:12px; }
    .cta-band p { color:var(--muted); max-width:42ch; margin:0 auto 26px; }

    footer { position:relative; z-index:1; border-top:1px solid var(--edge); margin-top:64px; padding:28px 24px; text-align:center; font-size:.82rem; color:var(--muted); }
    footer a { color:var(--muted); text-decoration:none; margin:0 9px; }
    footer a:hover { color:var(--plasma); }

    /* reveal on scroll */
    .reveal { opacity:0; transform:translateY(22px); transition:opacity .7s ease, transform .7s ease; }
    .reveal.in { opacity:1; transform:none; }

    @media (max-width:900px) {
      .hero { grid-template-columns:1fr; gap:24px; padding:60px 0 40px; }
      .fan { height:360px; order:-1; }
      .stats { grid-template-columns:repeat(2,1fr); }
      .grid3 { grid-template-columns:1fr; }
    }
    @media (max-width:680px) {
      .links { position:fixed; inset:60px 12px auto 12px; flex-direction:column; align-items:stretch; gap:6px;
        background:var(--abyss); border:1px solid var(--edge); border-radius:14px; padding:10px; display:none; box-shadow:0 20px 50px rgba(0,0,0,.6); }
      .links.open { display:flex; }
      .links a, .links .pill { width:100%; }
      .menu-btn { display:block; }
      .stat .num { font-size:1.6rem; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation:none !important; transition:none !important; }
      .reveal { opacity:1; transform:none; }
    }
  </style>
</head>
<body>
<nav>
  <a class="brand" href="/"><img src="https://raw.githubusercontent.com/Yo0l0/ssss/main/Pokebot.png" alt="">Poke<b>bot</b></a>
  <button class="menu-btn" aria-label="Menu" onclick="document.getElementById('navlinks').classList.toggle('open')">☰</button>
  <div class="links" id="navlinks">
    <a href="#features">Features</a>
    <a href="#updates">Updates</a>
    <a href="/faq">FAQ</a>
    <a href="https://discord.gg/zj9Sxz3reR" target="_blank" rel="noopener">Discord</a>
    <a href="https://top.gg/bot/1362516883785515199" target="_blank" rel="noopener">Vote</a>
    ${user
      ? `<a class="pill" href="/dashboard"><img src="${avatarUrl}" alt=""> ${user.username}</a>
         <a href="/logout">Logout</a>`
      : `<a class="cta" href="/login">Login</a>`}
  </div>
</nav>

<main class="wrap">
  <section class="hero">
    <div>
      <span class="eyebrow"><span class="dot"></span> Live on Discord</span>
      <h1>Open packs.<br>Chase the <span class="grad">foil.</span></h1>
      <p class="lead">A premium Pokémon-style card game for your server. Rip packs, grade your best pulls like a pro, duel rivals, and corner the marketplace.</p>
      <div class="hero-btns">
        <a class="btn btn-1" href="https://discord.com/oauth2/authorize?client_id=1362516883785515199&permissions=534723951680&scope=bot+applications.commands">Add to Discord</a>
        <a class="btn btn-2" href="${user ? '/dashboard' : '/login'}">${user ? 'View my collection' : 'Log in to view collection'}</a>
      </div>
      <div class="trust">Trusted by <b id="trustUsers">collectors</b> across Discord servers.</div>
    </div>

    <div class="fan" id="fan">
      <div class="foil c1" data-tilt>
        <div class="pad"><div class="art"><img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/6.png" alt="Charizard" loading="lazy"></div>
        <div class="plate"><div class="nm">Charizard</div><div class="rb">Mythical · PSA 10</div></div></div>
        <div class="holo"></div><div class="sheen"></div>
      </div>
      <div class="foil c2" data-tilt>
        <div class="pad"><div class="art"><img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/94.png" alt="Gengar" loading="lazy"></div>
        <div class="plate"><div class="nm">Gengar</div><div class="rb">SIR · Holo</div></div></div>
        <div class="holo"></div><div class="sheen"></div>
      </div>
      <div class="foil c3" data-tilt>
        <div class="pad"><div class="art"><img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/150.png" alt="Mewtwo" loading="lazy"></div>
        <div class="plate"><div class="nm">Mewtwo</div><div class="rb">Holo · Mint</div></div></div>
        <div class="holo"></div><div class="sheen"></div>
      </div>
    </div>
  </section>

  <div class="band reveal">
    <div class="band-head"><span class="dot"></span> Live network stats</div>
    <div class="stats">
      <div class="stat"><div class="ic">🎴</div><span class="num" id="statCards">—</span><div class="lbl">Cards Dropped</div></div>
      <div class="stat"><div class="ic">🧑‍🚀</div><span class="num" id="statUsers">—</span><div class="lbl">Active Trainers</div></div>
      <div class="stat"><div class="ic">📦</div><span class="num" id="statPacks">—</span><div class="lbl">Packs Opened</div></div>
      <div class="stat"><div class="ic">⚡</div><span class="num" id="statToday">—</span><div class="lbl">Drops Today</div></div>
      <div class="stat"><div class="ic">📈</div><span class="num" id="statWeek">—</span><div class="lbl">Avg/Day This Week</div></div>
    </div>
  </div>

  <section class="blk reveal" id="rarity">
    <h2 class="stitle">Six tiers to chase</h2>
    <div class="ladder">
      <div class="tier"><div class="bar" style="background:#6b7280"></div><div class="tn">Common</div><div class="td">The backbone of every binder.</div></div>
      <div class="tier"><div class="bar" style="background:#3b82f6"></div><div class="tn">Uncommon</div><div class="td">A cut above the staples.</div></div>
      <div class="tier"><div class="bar" style="background:#ef4444"></div><div class="tn">Rare</div><div class="td">Worth setting aside.</div></div>
      <div class="tier shine"><div class="bar" style="background:#06b6d4"></div><div class="tn">Holo</div><div class="td">Shimmering and collectible.</div></div>
      <div class="tier shine"><div class="bar" style="background:#a855f7"></div><div class="tn">SIR</div><div class="td">Special illustration rares.</div></div>
      <div class="tier shine"><div class="bar" style="background:#fbbf24"></div><div class="tn">Mythical</div><div class="td">The crown of a collection.</div></div>
    </div>
  </section>

  <section class="blk reveal" id="features">
    <h2 class="stitle">Everything a collector wants</h2>
    <div class="grid3">
      <div class="feat"><div class="chip">🎴</div><h3>Pack Opening</h3><p>Rip packs from classic sets on a cooldown. Chase holos, promos, and ultra-rare SIR cards.</p></div>
      <div class="feat"><div class="chip">⭐</div><h3>Pro Grading</h3><p>Send cards to the lab. Pristine cards can hit a perfect 10 — and are worth far more.</p></div>
      <div class="feat"><div class="chip">⚔️</div><h3>Duels</h3><p>Challenge trainers to card battles. Attack, defend, heal, and unleash rarity moves.</p></div>
      <div class="feat"><div class="chip">🏪</div><h3>Marketplace</h3><p>Buy and sell with other players. Track price trends and snipe the best deals.</p></div>
      <div class="feat"><div class="chip">🧪</div><h3>Card Fusion</h3><p>Combine three identical cards to upgrade their condition toward Pristine.</p></div>
      <div class="feat"><div class="chip">🏆</div><h3>Leaderboards</h3><p>Compete globally and per-server for coins, aura, grades, and collection size.</p></div>
    </div>
  </section>

  <section class="blk reveal" id="updates">
    <h2 class="stitle">Latest updates</h2>
    <div class="news" id="newsGrid"><div class="ncard"><div class="nb" style="color:var(--muted)">Loading updates…</div></div></div>
  </section>

  <div class="cta-band reveal">
    <h2>Start your collection tonight</h2>
    <p>Add Pokebot to your server and open your first pack in seconds.</p>
    <a class="btn btn-1" href="https://discord.com/oauth2/authorize?client_id=1362516883785515199&permissions=534723951680&scope=bot+applications.commands">Add to Discord</a>
  </div>
</main>

<footer>
  © 2024 Pokebot
  <a href="/terms-of-service">Terms</a>
  <a href="/privacy-policy">Privacy</a>
  <a href="/faq">FAQ</a>
  <a href="https://discord.gg/zj9Sxz3reR" target="_blank" rel="noopener">Discord</a>
</footer>

<script>
  function animateNum(el, target) {
    target = Number(target) || 0;
    const start = parseInt(String(el.textContent).replace(/[^0-9-]/g, ''), 10) || 0;
    if (start === target) { el.textContent = target.toLocaleString(); return; }
    const steps = 40, inc = (target - start) / steps;
    let cur = start, i = 0;
    const t = setInterval(() => {
      i++; cur += inc;
      el.textContent = Math.round(i < steps ? cur : target).toLocaleString();
      if (i >= steps) clearInterval(t);
    }, 16);
  }

async function loadStats() {
  try {
    const d = await (await fetch('/stats')).json();

    const USER_DISPLAY_BONUS = 10000;
    const displayUsers = (Number(d.totalUsers) || 0) + USER_DISPLAY_BONUS;

    animateNum(document.getElementById('statCards'), d.totalCards   || 0);
    animateNum(document.getElementById('statUsers'), displayUsers);
    animateNum(document.getElementById('statPacks'), d.totalPacks   || 0);
    animateNum(document.getElementById('statToday'), d.droppedToday || 0);
    animateNum(document.getElementById('statWeek'),  d.thisWeekAvg  || 0);

    const tu = document.getElementById('trustUsers');
    if (tu) tu.textContent = displayUsers.toLocaleString() + ' trainers';
  } catch (e) {
    console.error('Stats failed:', e);
  }
}

  async function loadNews() {
    const grid = document.getElementById('newsGrid');
    try {
      const data = await (await fetch('/api/news', { cache:'no-store' })).json();
      const news = Array.isArray(data) ? data : (data.news || data.items || []);
      if (!news.length) { grid.innerHTML = '<div class="ncard"><div class="nb">No updates yet.</div></div>'; return; }
      grid.innerHTML = news.slice(0,6).map(item => {
        const body = Array.isArray(item.body) ? item.body.join('\\n') : String(item.body || item.text || item.description || '');
        return \`<div class="ncard"><div class="nd">\${item.date || ''}</div><div class="nt">\${item.title || ''}</div><div class="nb">\${body}</div></div>\`;
      }).join('');
    } catch (e) {
      grid.innerHTML = '<div class="ncard"><div class="nb">Couldn\\'t load updates. Try refreshing.</div></div>';
    }
  }

  // Foil-card tilt + sheen (skipped if reduced motion or touch)
  function initTilt() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const fan = document.getElementById('fan');
    if (!fan || window.matchMedia('(hover: none)').matches) return;
    const cards = fan.querySelectorAll('[data-tilt]');
    fan.addEventListener('pointermove', (e) => {
      const r = fan.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - .5;
      const py = (e.clientY - r.top) / r.height - .5;
      cards.forEach(c => {
        c.style.setProperty('--mx', (50 + px * 60) + '%');
        c.style.setProperty('--my', (30 + py * 60) + '%');
        c.style.setProperty('--rx', (-py * 10).toFixed(2) + 'deg');
        c.style.setProperty('--ry', (px * 12).toFixed(2) + 'deg');
      });
    });
    fan.addEventListener('pointerleave', () => cards.forEach(c => {
      c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg');
    }));
  }

  // Scroll reveal
  const io = new IntersectionObserver((entries) => {
    entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { threshold: .12 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

  loadStats(); loadNews(); initTilt();
  setInterval(loadStats, 60000);
</script>
</body>
</html>`);
});

// ── Dashboard ─────────────────────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const user = req.session.user;
  const avatarUrl = user?.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : 'https://raw.githubusercontent.com/Yo0l0/ssss/main/Pokebot.png';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Collection — Pokebot</title>
  <link rel="icon" type="image/png" href="https://raw.githubusercontent.com/Yo0l0/ssss/refs/heads/main/GengarImages.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
    :root {
      --void:#0a0612; --abyss:#130c24; --haze:#1b1133; --edge:#2c2050;
      --plasma:#b06bff; --plasma-2:#7c3aed; --gold:#ffc94d; --cyan:#39e0d0;
      --text:#ece4ff; --muted:#9385b8;
      --disp:'Space Grotesk',sans-serif; --body:'Inter',sans-serif;
    }
    body { font-family:var(--body); background:var(--void); color:var(--text); min-height:100vh; -webkit-font-smoothing:antialiased; }
    body::before { content:''; position:fixed; inset:0; z-index:0; pointer-events:none;
      background:radial-gradient(60vw 50vw at 85% -10%, rgba(176,107,255,.14), transparent 60%),
                 radial-gradient(50vw 50vw at 0% 0%, rgba(57,224,208,.07), transparent 55%); }
    .wrap { position:relative; z-index:1; max-width:1240px; margin:0 auto; }
    a { color:inherit; }

    nav { position:sticky; top:0; z-index:50; display:flex; align-items:center; justify-content:space-between;
      padding:13px 24px; background:rgba(10,6,18,.78); backdrop-filter:blur(16px); border-bottom:1px solid var(--edge); }
    .brand { font-family:var(--disp); font-weight:700; color:var(--plasma); text-decoration:none; font-size:1.02rem; }
    .nav-right { display:flex; align-items:center; gap:14px; font-size:.86rem; color:var(--muted); }
    .nav-right img { width:26px; height:26px; border-radius:50%; vertical-align:middle; }
    .nav-right a:hover { color:var(--plasma); }

    /* summary header */
    .head { padding:30px 24px 8px; }
    .head h1 { font-family:var(--disp); font-weight:700; font-size:1.7rem; }
    .head .sub { color:var(--muted); font-size:.9rem; margin-top:2px; }
    .summary { display:grid; grid-template-columns:repeat(4,1fr) 1.4fr; gap:12px; padding:18px 24px 4px; }
    .scard { background:linear-gradient(180deg,var(--abyss),#0d0820); border:1px solid var(--edge); border-radius:14px; padding:16px; }
    .scard .k { font-size:.72rem; letter-spacing:.07em; text-transform:uppercase; color:var(--muted); }
    .scard .v { font-family:var(--disp); font-weight:700; font-size:1.6rem; color:var(--gold); margin-top:4px; }
    .scard.rarest { display:flex; align-items:center; gap:14px; }
    .scard.rarest img { width:46px; height:62px; object-fit:contain; border-radius:8px; background:#160d2a; border:1px solid var(--edge); }
    .scard.rarest .nm { font-family:var(--disp); font-weight:700; font-size:1rem; }
    .scard.rarest .rb { font-size:.74rem; color:var(--muted); text-transform:capitalize; }

    .toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; padding:16px 24px; margin-top:8px;
      border-top:1px solid var(--edge); border-bottom:1px solid var(--edge); background:rgba(27,17,51,.4);
      position:sticky; top:53px; z-index:40; backdrop-filter:blur(10px); }
    .toolbar select, .toolbar input { padding:9px 13px; border-radius:10px; font-size:.86rem; font-family:var(--body);
      background:var(--void); color:var(--text); border:1px solid var(--edge); outline:none; transition:.15s; }
    .toolbar select:focus, .toolbar input:focus { border-color:var(--plasma); box-shadow:0 0 0 3px rgba(176,107,255,.18); }
    .toolbar input { flex:1; min-width:170px; }
    .count { font-size:.82rem; color:var(--muted); margin-left:auto; white-space:nowrap; }

    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(176px,1fr)); gap:16px; padding:24px; }
    .card { background:var(--abyss); border:1px solid var(--edge); border-radius:14px; overflow:hidden;
      transition:transform .18s, border-color .18s, box-shadow .18s; cursor:pointer; position:relative; opacity:0; transform:translateY(14px); }
    .card.in { opacity:1; transform:none; }
    .card:hover { transform:translateY(-5px); border-color:var(--plasma); box-shadow:0 16px 34px rgba(124,58,237,.3); }
    .card .imgwrap { position:relative; aspect-ratio:3/4; background:radial-gradient(120% 90% at 50% 0%,#241640,#120a24); overflow:hidden; }
    .card img { width:100%; height:100%; object-fit:contain; display:block; padding:8px; }
    .card-info { padding:10px 12px 12px; }
    .card-name { font-family:var(--disp); font-weight:600; font-size:.86rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .card-meta { font-size:.74rem; color:var(--muted); margin-top:3px; text-transform:capitalize; }
    .card-code { font-size:.68rem; color:var(--muted); font-family:ui-monospace,monospace; margin-top:3px; }
    .grade-badge { position:absolute; top:8px; right:8px; padding:3px 8px; border-radius:8px; font-size:.7rem; font-weight:700;
      background:rgba(255,201,77,.16); color:var(--gold); border:1px solid rgba(255,201,77,.4); backdrop-filter:blur(4px); }
    .holo-fx::after { content:''; position:absolute; inset:0; pointer-events:none; mix-blend-mode:overlay; opacity:.4;
      background:repeating-linear-gradient(115deg,#ff5ea2 0 10px,#ffd24d 10px 20px,#5effa6 20px 30px,#5ec8ff 30px 40px,#b06bff 40px 50px);
      background-size:200% 200%; animation:holoshift 5s linear infinite; }
    @keyframes holoshift { from{background-position:0 0} to{background-position:200% 0} }

    .rarity-mythical{ border-top:3px solid #fbbf24; } .rarity-sir{ border-top:3px solid #a855f7; }
    .rarity-holo{ border-top:3px solid #06b6d4; } .rarity-promo{ border-top:3px solid #f97316; }
    .rarity-rare{ border-top:3px solid #ef4444; } .rarity-uncommon{ border-top:3px solid #3b82f6; }
    .rarity-common{ border-top:3px solid #6b7280; }

    .empty,.loading { grid-column:1/-1; text-align:center; padding:64px 24px; color:var(--muted); }

    .pagination { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; align-items:center; padding:8px 24px 40px; }
    .pg { min-width:40px; padding:9px 13px; border-radius:10px; font-size:.85rem; font-weight:700;
      background:var(--abyss); color:var(--muted); border:1px solid var(--edge); cursor:pointer; transition:.15s; }
    .pg:hover:not(:disabled) { color:var(--text); border-color:var(--plasma); }
    .pg.active { background:linear-gradient(135deg,var(--plasma),var(--plasma-2)); color:#fff; border-color:transparent; }
    .pg:disabled { opacity:.4; cursor:default; }
    .pg.dots { border:none; background:none; cursor:default; }

    /* modal */
    .modal { position:fixed; inset:0; z-index:200; display:none; align-items:center; justify-content:center; padding:24px;
      background:rgba(6,3,14,.78); backdrop-filter:blur(6px); }
    .modal.open { display:flex; }
    .sheet { width:100%; max-width:760px; display:grid; grid-template-columns:300px 1fr; gap:0;
      background:var(--abyss); border:1px solid var(--edge); border-radius:20px; overflow:hidden; box-shadow:0 30px 80px rgba(0,0,0,.6); }
    .sheet .big { background:radial-gradient(120% 90% at 50% 0%,#241640,#120a24); display:flex; align-items:center; justify-content:center; padding:20px; }
    .sheet .big img { width:100%; object-fit:contain; filter:drop-shadow(0 12px 24px rgba(0,0,0,.5)); }
    .sheet .body { padding:26px; }
    .sheet .body h2 { font-family:var(--disp); font-size:1.5rem; }
    .sheet .body .set { color:var(--muted); margin-bottom:18px; }
    .row { display:flex; justify-content:space-between; padding:11px 0; border-bottom:1px solid var(--edge); font-size:.9rem; }
    .row .l { color:var(--muted); } .row .r { font-weight:600; text-transform:capitalize; }
    .slab { display:inline-block; margin-top:18px; padding:6px 14px; border-radius:10px; font-family:var(--disp); font-weight:700;
      background:rgba(255,201,77,.14); color:var(--gold); border:1px solid rgba(255,201,77,.4); }
    .close { position:absolute; top:18px; right:22px; font-size:1.6rem; color:var(--muted); background:none; border:none; cursor:pointer; }
    .close:hover { color:var(--text); }

    @media (max-width:560px) {
      .summary { grid-template-columns:repeat(2,1fr); }
      .summary .scard.rarest { grid-column:1/-1; }
      .sheet { grid-template-columns:1fr; max-width:380px; }
      .sheet .big { max-height:300px; }
    }
    @media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation:none!important; transition:none!important; } .card{opacity:1;transform:none;} }
  </style>
</head>
<body>
<nav>
  <a class="brand" href="/">← Pokebot</a>
  <div class="nav-right"><img src="${avatarUrl}" alt=""> <span>${user.username}</span> <a href="/logout">Logout</a></div>
</nav>

<div class="wrap">
  <div class="head">
    <h1>My Collection</h1>
    <div class="sub">Every card you own, live from your inventory.</div>
  </div>

  <div class="summary" id="summary">
    <div class="scard"><div class="k">Total Cards</div><div class="v" id="sTotal">—</div></div>
    <div class="scard"><div class="k">Sets</div><div class="v" id="sSets">—</div></div>
    <div class="scard"><div class="k">Graded</div><div class="v" id="sGraded">—</div></div>
    <div class="scard"><div class="k">Top Grade</div><div class="v" id="sTop">—</div></div>
    <div class="scard rarest" id="sRarest"><div><div class="k">Rarest Pull</div><div class="nm">—</div></div></div>
  </div>

  <div class="toolbar">
    <select id="fRarity">
      <option value="all">All Rarities</option>
      <option value="mythical">🌟 Mythical</option>
      <option value="SIR">💎 SIR</option>
      <option value="holo">✨ Holo</option>
      <option value="promo">🎁 Promo</option>
      <option value="rare">🔴 Rare</option>
      <option value="uncommon">🔵 Uncommon</option>
      <option value="common">⚪ Common</option>
    </select>
    <select id="fGrade">
      <option value="all">All Grades</option>
      ${[10,9,8,7,6].map(g => `<option value="${g}">Grade ${g}</option>`).join('')}
    </select>
    <select id="fCondition">
      <option value="all">All Conditions</option>
      <option value="Pristine">Pristine</option>
      <option value="Mint">Mint</option>
      <option value="Near Mint">Near Mint</option>
      <option value="Light play">Light Play</option>
      <option value="Damaged">Damaged</option>
    </select>
    <input id="fSearch" type="text" placeholder="Search name or code…" autocomplete="off">
    <span class="count" id="countLabel">Loading…</span>
  </div>

  <div class="grid" id="cardGrid"><div class="loading">Loading your collection…</div></div>
  <div class="pagination" id="pagination"></div>
</div>

<div class="modal" id="modal">
  <div class="sheet" id="sheet"></div>
</div>

<script>
  let page = 1, searchTimer, lastCards = [];
  const HOLO = ['holo','sir','mythical'];

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }

  async function loadSummary() {
    try {
      const d = await (await fetch('/api/summary')).json();
      document.getElementById('sTotal').textContent  = (d.total  || 0).toLocaleString();
      document.getElementById('sSets').textContent   = (d.sets   || 0).toLocaleString();
      document.getElementById('sGraded').textContent = (d.graded || 0).toLocaleString();
      document.getElementById('sTop').textContent    = d.topGrade ? d.topGrade + '/10' : '—';
      const r = d.rarest;
      document.getElementById('sRarest').innerHTML = r
        ? \`<img src="\${esc(r.image)}" alt=""><div><div class="k">Rarest Pull</div><div class="nm">\${esc(r.name)}</div><div class="rb">\${esc(r.rarity)}\${r.grade ? ' · PSA '+r.grade : ''}</div></div>\`
        : '<div><div class="k">Rarest Pull</div><div class="nm">No cards yet</div></div>';
    } catch (e) { console.error('Summary failed:', e); }
  }

  function rarityClass(r){ return 'rarity-' + (r||'common').toLowerCase(); }

  function pageButtons(total) {
    if (total <= 1) return [];
    const out = new Set([1, total, page, page-1, page+1]);
    if (page <= 3) { out.add(2); out.add(3); }
    if (page >= total-2) { out.add(total-1); out.add(total-2); }
    const nums = [...out].filter(n => n >= 1 && n <= total).sort((a,b)=>a-b);
    const seq = [];
    for (let i = 0; i < nums.length; i++) {
      if (i && nums[i] - nums[i-1] > 1) seq.push('…');
      seq.push(nums[i]);
    }
    return seq;
  }

  function renderPagination(total) {
    const pag = document.getElementById('pagination');
    pag.innerHTML = '';
    if (total <= 1) return;
    const mk = (label, p, opts={}) => {
      const b = document.createElement('button');
      b.className = 'pg' + (opts.active ? ' active' : '') + (opts.dots ? ' dots' : '');
      b.textContent = label;
      if (opts.dots) { b.disabled = true; }
      else if (opts.disabled) { b.disabled = true; }
      else { b.onclick = () => load(p); }
      pag.appendChild(b);
    };
    mk('‹', page-1, { disabled: page === 1 });
    pageButtons(total).forEach(n => n === '…' ? mk('…', 0, { dots:true }) : mk(n, n, { active: n === page }));
    mk('›', page+1, { disabled: page === total });
  }

  function openModal(c) {
    const holo = HOLO.includes((c.rarity||'').toLowerCase());
    document.getElementById('sheet').innerHTML = \`
      <button class="close" aria-label="Close" onclick="closeModal()">×</button>
      <div class="big \${holo ? 'holo-fx' : ''}"><img src="\${esc(c.image)}" alt="\${esc(c.name)}"></div>
      <div class="body">
        <h2>\${esc(c.name)}</h2>
        <div class="set">\${esc(c.set || 'Unknown set')}</div>
        <div class="row"><span class="l">Rarity</span><span class="r">\${esc(c.rarity || '—')}</span></div>
        <div class="row"><span class="l">Condition</span><span class="r">\${esc(c.condition || '—')}</span></div>
        <div class="row"><span class="l">Type</span><span class="r">\${esc(c.type || '—')}</span></div>
        <div class="row"><span class="l">Code</span><span class="r" style="font-family:ui-monospace,monospace;text-transform:none">\${esc(c.code)}</span></div>
        \${c.grade ? \`<div class="slab">PSA \${esc(c.grade)} / 10</div>\` : ''}
      </div>\`;
    document.getElementById('modal').classList.add('open');
  }
  function closeModal(){ document.getElementById('modal').classList.remove('open'); }
  document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  function load(p) {
    page = p || 1;
    const r = document.getElementById('fRarity').value;
    const g = document.getElementById('fGrade').value;
    const c = document.getElementById('fCondition').value;
    const s = encodeURIComponent(document.getElementById('fSearch').value);
    const grid = document.getElementById('cardGrid');
    grid.innerHTML = '<div class="loading">Loading…</div>';
    document.getElementById('pagination').innerHTML = '';

    fetch(\`/api/cards?rarity=\${r}&grade=\${g}&condition=\${c}&search=\${s}&page=\${page}\`)
      .then(res => res.json())
      .then(data => {
        document.getElementById('countLabel').textContent = \`\${(data.total || 0).toLocaleString()} cards\`;
        lastCards = data.cards || [];
        if (!lastCards.length) {
          grid.innerHTML = '<div class="empty">No cards match these filters. Try clearing one.</div>';
          return;
        }
        grid.innerHTML = lastCards.map((c, i) => {
          const holo = HOLO.includes((c.rarity||'').toLowerCase());
          return \`<div class="card \${rarityClass(c.rarity)}" data-i="\${i}">
            <div class="imgwrap \${holo ? 'holo-fx' : ''}">
              <img src="\${esc(c.image)}" alt="\${esc(c.name)}" loading="lazy">
              \${c.grade ? \`<span class="grade-badge">PSA \${esc(c.grade)}</span>\` : ''}
            </div>
            <div class="card-info">
              <div class="card-name">\${esc(c.name)}</div>
              <div class="card-meta">\${esc(c.rarity || '')}\${c.condition ? ' · ' + esc(c.condition) : ''}</div>
              <div class="card-code">\${esc(c.code)}</div>
            </div>
          </div>\`;
        }).join('');
        // click → modal, plus staggered reveal
        grid.querySelectorAll('.card').forEach((el, i) => {
          el.addEventListener('click', () => openModal(lastCards[+el.dataset.i]));
          setTimeout(() => el.classList.add('in'), Math.min(i * 22, 400));
        });
        renderPagination(data.totalPages || 1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
      .catch(() => { grid.innerHTML = '<div class="empty">Couldn\\'t load your cards. Refresh to try again.</div>'; });
  }

  ['fRarity','fGrade','fCondition'].forEach(id => document.getElementById(id).addEventListener('change', () => load(1)));
  document.getElementById('fSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => load(1), 400); });
  loadSummary();
  load(1);
</script>
</body>
</html>`);
});

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('CLIENT_SECRET loaded:', CLIENT_SECRET ? `YES (${CLIENT_SECRET.length} chars)` : 'NO');
  refreshInventory();                            // warm the cache on boot
  setInterval(refreshInventory, INVENTORY_TTL);  // keep it fresh even with no traffic
});
