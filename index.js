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

// Reads from local disk — the bot uploads via POST /upload, no GitHub needed
function getInventory() {
  const now = Date.now();
  if (inventoryCache && now - inventoryFetchedAt < INVENTORY_TTL) return inventoryCache;
  try {
    if (!fs.existsSync(LOCAL_INVENTORY)) return inventoryCache || {};
    const raw = fs.readFileSync(LOCAL_INVENTORY, 'utf8');
    inventoryCache    = JSON.parse(raw);
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
app.set('trust proxy', 1); // behind nginx/Render/Heroku — needed for correct protocol & secure cookies
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
  <title>Pokebot — Collect, Battle, Trade</title>
  <link rel="icon" type="image/png" href="https://raw.githubusercontent.com/Yo0l0/ssss/refs/heads/main/GengarImages.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:       #08060f;
      --surface:  #110d1e;
      --border:   #2a1f4a;
      --accent:   #c084fc;
      --gold:     #fbbf24;
      --teal:     #2dd4bf;
      --text:     #e2d9f3;
      --muted:    #7c6ea0;
    }

    body {
      font-family: 'Nunito', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* starfield */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image:
        radial-gradient(1px 1px at 10% 15%, rgba(255,255,255,.6) 0%, transparent 100%),
        radial-gradient(1px 1px at 30% 40%, rgba(255,255,255,.4) 0%, transparent 100%),
        radial-gradient(1px 1px at 55% 20%, rgba(255,255,255,.5) 0%, transparent 100%),
        radial-gradient(1px 1px at 75% 60%, rgba(255,255,255,.3) 0%, transparent 100%),
        radial-gradient(1px 1px at 90% 10%, rgba(255,255,255,.6) 0%, transparent 100%),
        radial-gradient(1px 1px at 20% 80%, rgba(255,255,255,.4) 0%, transparent 100%),
        radial-gradient(1px 1px at 60% 90%, rgba(255,255,255,.3) 0%, transparent 100%),
        radial-gradient(1px 1px at 85% 35%, rgba(255,255,255,.5) 0%, transparent 100%);
      pointer-events: none;
      z-index: 0;
    }

    /* ── NAV ── */
    nav {
      position: fixed; top: 0; left: 0; right: 0; z-index: 100;
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 32px;
      background: rgba(8,6,15,.85);
      backdrop-filter: blur(14px);
      border-bottom: 1px solid var(--border);
    }
    .nav-logo {
      display: flex; align-items: center; gap: 10px;
      font-family: 'Cinzel', serif; font-size: 1.1rem; font-weight: 700;
      color: var(--accent); text-decoration: none;
    }
    .nav-logo img { width: 34px; height: 34px; border-radius: 50%; }
    .nav-links { display: flex; align-items: center; gap: 8px; }
    .nav-links a {
      padding: 7px 16px; border-radius: 20px; font-size: .85rem; font-weight: 600;
      text-decoration: none; color: var(--muted); transition: all .2s;
    }
    .nav-links a:hover { color: var(--text); background: rgba(255,255,255,.06); }
    .nav-links a.cta {
      background: var(--accent); color: #0a0015; padding: 7px 20px;
    }
    .nav-links a.cta:hover { background: #d8a5ff; }
    .user-pill {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 14px 4px 4px; border-radius: 20px;
      background: var(--surface); border: 1px solid var(--border);
      font-size: .85rem; font-weight: 600; color: var(--text);
      text-decoration: none;
    }
    .user-pill img { width: 28px; height: 28px; border-radius: 50%; }

    /* ── HERO ── */
    .hero {
      position: relative; z-index: 1;
      display: flex; flex-direction: column; align-items: center;
      text-align: center; padding: 160px 24px 80px;
    }
    .hero-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 16px; border-radius: 20px; margin-bottom: 28px;
      background: rgba(192,132,252,.12); border: 1px solid rgba(192,132,252,.35);
      font-size: .78rem; font-weight: 700; letter-spacing: .08em;
      color: var(--accent); text-transform: uppercase;
    }
    .hero h1 {
      font-family: 'Cinzel', serif;
      font-size: clamp(2.4rem, 6vw, 4.5rem);
      font-weight: 900; line-height: 1.1;
      background: linear-gradient(135deg, #e2d9f3 0%, var(--accent) 45%, var(--gold) 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      margin-bottom: 20px;
    }
    .hero p {
      max-width: 520px; font-size: 1.05rem; color: var(--muted);
      line-height: 1.7; margin-bottom: 40px;
    }
    .hero-btns { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
    .btn-primary {
      padding: 13px 28px; border-radius: 10px; font-weight: 700; font-size: .95rem;
      background: var(--accent); color: #0a0015; text-decoration: none;
      transition: all .2s; border: none; cursor: pointer;
    }
    .btn-primary:hover { background: #d8a5ff; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(192,132,252,.4); }
    .btn-secondary {
      padding: 13px 28px; border-radius: 10px; font-weight: 700; font-size: .95rem;
      background: transparent; color: var(--text); text-decoration: none;
      border: 1px solid var(--border); transition: all .2s;
    }
    .btn-secondary:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-2px); }

    /* ── STATS STRIP ── */
    .stats-strip {
      position: relative; z-index: 1;
      display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1px; background: var(--border);
      border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
      margin: 0 0 80px;
    }
    .stat-box {
      background: var(--surface);
      padding: 28px 20px; text-align: center;
    }
    .stat-box .num {
      font-family: 'Cinzel', serif; font-size: 2rem; font-weight: 700;
      color: var(--gold); display: block;
    }
    .stat-box .lbl { font-size: .8rem; color: var(--muted); margin-top: 4px; text-transform: uppercase; letter-spacing: .06em; }

    /* ── NEWS ── */
    .section { position: relative; z-index: 1; max-width: 1100px; margin: 0 auto 80px; padding: 0 24px; }
    .section-title {
      font-family: 'Cinzel', serif; font-size: 1.5rem; font-weight: 700;
      color: var(--text); margin-bottom: 24px;
      display: flex; align-items: center; gap: 10px;
    }
    .section-title::after {
      content: ''; flex: 1; height: 1px; background: var(--border);
    }
    .news-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .news-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; padding: 20px;
      transition: border-color .2s, transform .2s;
    }
    .news-card:hover { border-color: var(--accent); transform: translateY(-3px); }
    .news-date { font-size: .75rem; color: var(--muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: .06em; }
    .news-title { font-weight: 700; font-size: .95rem; color: var(--text); margin-bottom: 10px; }
    .news-body { font-size: .875rem; color: var(--muted); line-height: 1.6; white-space: pre-line; }

    /* ── FEATURES ── */
    .features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
    .feat-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; padding: 24px;
    }
    .feat-icon { font-size: 2rem; margin-bottom: 12px; }
    .feat-title { font-weight: 700; font-size: .95rem; color: var(--text); margin-bottom: 8px; }
    .feat-desc { font-size: .85rem; color: var(--muted); line-height: 1.6; }

    /* ── FOOTER ── */
    footer {
      position: relative; z-index: 1;
      border-top: 1px solid var(--border);
      padding: 32px 24px; text-align: center;
      font-size: .8rem; color: var(--muted);
    }
    footer a { color: var(--muted); text-decoration: none; margin: 0 8px; }
    footer a:hover { color: var(--accent); }

    @media (max-width: 600px) {
      nav { padding: 12px 16px; }
      .nav-links a:not(.cta) { display: none; }
    }
  </style>
</head>
<body>

<nav>
  <a class="nav-logo" href="/">
    <img src="https://raw.githubusercontent.com/Yo0l0/ssss/main/Pokebot.png" alt="Pokebot">
    Pokebot
  </a>
  <div class="nav-links">
    <a href="/faq">FAQ</a>
    <a href="https://discord.gg/zj9Sxz3reR" target="_blank">Discord</a>
    <a href="https://top.gg/bot/1362516883785515199" target="_blank">Vote</a>
    ${user
      ? `<a class="user-pill" href="/dashboard">
           <img src="${avatarUrl}" alt="avatar"> ${user.username}
         </a>
         <a href="/logout" class="nav-links" style="color:var(--muted);font-size:.85rem;padding:7px 16px;text-decoration:none;">Logout</a>`
      : `<a class="cta" href="/login">Login</a>`
    }
  </div>
</nav>

<main>
  <section class="hero">
    <div class="hero-badge">✨ The #1 Pokémon Card Bot</div>
    <h1>Collect. Battle.<br>Trade. Dominate.</h1>
    <p>Build your ultimate Pokémon card collection on Discord. Open packs, grade rare cards, duel friends, and climb the global leaderboard.</p>
    <div class="hero-btns">
      <a class="btn-primary" href="https://discord.com/oauth2/authorize?client_id=1362516883785515199&permissions=534723951680&scope=bot+applications.commands">
        ✨ Add to Discord
      </a>
      <a class="btn-secondary" href="${user ? '/dashboard' : '/login'}">
        🗂️ View Collection
      </a>
      <a class="btn-secondary" href="https://discord.gg/zj9Sxz3reR" target="_blank">
        💬 Support Server
      </a>
    </div>
  </section>

  <div class="stats-strip">
    <div class="stat-box"><span class="num" id="statCards">—</span><div class="lbl">Cards Dropped</div></div>
    <div class="stat-box"><span class="num" id="statUsers">—</span><div class="lbl">Active Trainers</div></div>
    <div class="stat-box"><span class="num" id="statPacks">—</span><div class="lbl">Packs Opened</div></div>
    <div class="stat-box"><span class="num" id="statToday">—</span><div class="lbl">Drops Today</div></div>
    <div class="stat-box"><span class="num" id="statWeek">—</span><div class="lbl">Avg/Day This Week</div></div>
  </div>

  <div class="section">
    <div class="section-title">📰 Latest Updates</div>
    <div class="news-grid" id="newsGrid">
      <div class="news-card"><div class="news-body" style="color:var(--muted)">Loading updates…</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">⚡ Features</div>
    <div class="features-grid">
      <div class="feat-card"><div class="feat-icon">🎴</div><div class="feat-title">Pack Opening</div><div class="feat-desc">Open packs from classic sets every 20 minutes. Chase holos, promos, and ultra-rare SIR cards.</div></div>
      <div class="feat-card"><div class="feat-icon">⭐</div><div class="feat-title">Card Grading</div><div class="feat-desc">Send cards to the lab. Pristine condition cards can score a perfect 10 and are worth far more.</div></div>
      <div class="feat-card"><div class="feat-icon">⚔️</div><div class="feat-title">Duels</div><div class="feat-desc">Challenge other trainers to card battles. Attack, defend, heal, and use special rarity moves.</div></div>
      <div class="feat-card"><div class="feat-icon">🏪</div><div class="feat-title">Marketplace</div><div class="feat-desc">Buy and sell cards with other players. Track price trends and find the best deals.</div></div>
      <div class="feat-card"><div class="feat-icon">🧪</div><div class="feat-title">Card Fusion</div><div class="feat-desc">Combine 3 identical cards to upgrade their condition. Fuse your way to a Pristine collection.</div></div>
      <div class="feat-card"><div class="feat-icon">🏆</div><div class="feat-title">Leaderboards</div><div class="feat-desc">Compete globally and per-server for coins, aura, grades, and card count.</div></div>
    </div>
  </div>
</main>

<footer>
  © 2024 Pokebot
  <a href="/terms-of-service">Terms</a>
  <a href="/privacy-policy">Privacy</a>
  <a href="/faq">FAQ</a>
  <a href="https://discord.gg/zj9Sxz3reR" target="_blank">Discord</a>
</footer>

<script>
function animateNum(el, target) {
  target = Number(target) || 0;
  const start = parseInt(String(el.textContent).replace(/[^0-9-]/g, ''), 10) || 0;
  if (start === target) {            // includes the 0 → 0 case that left "—" stuck
    el.textContent = target.toLocaleString();
    return;
  }
  const steps = 40, inc = (target - start) / steps;
  let cur = start, i = 0;
  const t = setInterval(() => {
    i++;
    cur += inc;
    el.textContent = Math.round(i < steps ? cur : target).toLocaleString();
    if (i >= steps) clearInterval(t);
  }, 16);
}

async function loadStats() {
  try {
    const r = await fetch('/stats');
    const d = await r.json();
    animateNum(document.getElementById('statCards'),  d.totalCards  || 0);
    animateNum(document.getElementById('statUsers'),  d.totalUsers  || 0);
    animateNum(document.getElementById('statPacks'),  d.totalPacks  || 0);
    animateNum(document.getElementById('statToday'),  d.droppedToday|| 0);
    animateNum(document.getElementById('statWeek'),   d.thisWeekAvg || 0);
  } catch(e) { console.error('Stats failed:', e); }
}

async function loadNews() {
  const grid = document.getElementById('newsGrid');
  try {
    const r    = await fetch('/api/news', { cache: 'no-store' });
    const data = await r.json();
    const news = Array.isArray(data) ? data : (data.news || data.items || []);
    if (!news.length) { grid.innerHTML = '<div class="news-card"><div class="news-body">No updates yet.</div></div>'; return; }
    grid.innerHTML = news.slice(0, 6).map(item => {
      const body = Array.isArray(item.body) ? item.body.join('\\n') : String(item.body || item.text || item.description || '');
      return \`<div class="news-card">
        <div class="news-date">\${item.date || ''}</div>
        <div class="news-title">\${item.title || ''}</div>
        <div class="news-body">\${body}</div>
      </div>\`;
    }).join('');
  } catch(e) {
    grid.innerHTML = '<div class="news-card"><div class="news-body">Failed to load updates.</div></div>';
  }
}

loadStats();
loadNews();
setInterval(loadStats, 60000);
</script>
</body>
</html>`);
});

// ── Dashboard ─────────────────────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const user = req.session.user;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Collection — Pokebot</title>
  <link rel="icon" type="image/png" href="https://raw.githubusercontent.com/Yo0l0/ssss/refs/heads/main/GengarImages.png">
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #08060f; --surface: #110d1e; --border: #2a1f4a;
      --accent: #c084fc; --gold: #fbbf24; --text: #e2d9f3; --muted: #7c6ea0;
    }
    body { font-family: 'Nunito', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }

    nav {
      position: sticky; top: 0; z-index: 100;
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 32px;
      background: rgba(8,6,15,.9); backdrop-filter: blur(14px);
      border-bottom: 1px solid var(--border);
    }
    .nav-logo { font-family: 'Cinzel', serif; font-size: 1.1rem; font-weight: 700; color: var(--accent); text-decoration: none; }
    .nav-right { display: flex; align-items: center; gap: 12px; font-size: .85rem; color: var(--muted); }
    .nav-right a { color: var(--muted); text-decoration: none; }
    .nav-right a:hover { color: var(--accent); }

    .toolbar {
      display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
      padding: 20px 24px; border-bottom: 1px solid var(--border);
      background: var(--surface);
    }
    .toolbar select, .toolbar input {
      padding: 8px 14px; border-radius: 8px; font-size: .85rem; font-family: 'Nunito', sans-serif;
      background: var(--bg); color: var(--text); border: 1px solid var(--border); outline: none;
    }
    .toolbar select:focus, .toolbar input:focus { border-color: var(--accent); }
    .toolbar input { flex: 1; min-width: 180px; }
    .count-label { font-size: .8rem; color: var(--muted); margin-left: auto; white-space: nowrap; }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 16px; padding: 24px;
    }
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; overflow: hidden;
      transition: transform .2s, border-color .2s;
      cursor: default;
    }
    .card:hover { transform: translateY(-4px); border-color: var(--accent); }
    .card img { width: 100%; aspect-ratio: 3/4; object-fit: cover; display: block; }
    .card-info { padding: 10px 12px; }
    .card-name { font-weight: 700; font-size: .85rem; color: var(--text); margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .card-meta { font-size: .75rem; color: var(--muted); line-height: 1.6; }
    .card-code { font-size: .7rem; color: var(--muted); font-family: monospace; }
    .grade-badge {
      display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: .7rem; font-weight: 700;
      background: rgba(251,191,36,.15); color: var(--gold); border: 1px solid rgba(251,191,36,.3);
      margin-top: 4px;
    }
    .rarity-holo    { border-top: 3px solid #06b6d4; }
    .rarity-sir     { border-top: 3px solid #a855f7; }
    .rarity-mythical{ border-top: 3px solid #fbbf24; }
    .rarity-promo   { border-top: 3px solid #f97316; }
    .rarity-rare    { border-top: 3px solid #ef4444; }
    .rarity-uncommon{ border-top: 3px solid #3b82f6; }
    .rarity-common  { border-top: 3px solid #6b7280; }

    .empty { grid-column: 1/-1; text-align: center; padding: 60px; color: var(--muted); }

    .pagination {
      display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;
      padding: 24px; border-top: 1px solid var(--border);
    }
    .page-btn {
      padding: 8px 16px; border-radius: 8px; font-size: .85rem; font-weight: 700;
      background: var(--surface); color: var(--muted); border: 1px solid var(--border);
      cursor: pointer; transition: all .15s;
    }
    .page-btn:hover, .page-btn.active {
      background: var(--accent); color: #0a0015; border-color: var(--accent);
    }
    .loading { text-align: center; padding: 60px; color: var(--muted); }
  </style>
</head>
<body>
<nav>
  <a class="nav-logo" href="/">← Pokebot</a>
  <div class="nav-right">
    <span>${user.username}'s Collection</span>
    <a href="/logout">Logout</a>
  </div>
</nav>

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
  <span class="count-label" id="countLabel">Loading…</span>
</div>

<div class="grid" id="cardGrid"><div class="loading">Loading your collection…</div></div>
<div class="pagination" id="pagination"></div>

<script>
let page = 1, searchTimer;

function load(p) {
  page = p || 1;
  const r = document.getElementById('fRarity').value;
  const g = document.getElementById('fGrade').value;
  const c = document.getElementById('fCondition').value;
  const s = encodeURIComponent(document.getElementById('fSearch').value);
  const grid = document.getElementById('cardGrid');
  const pag  = document.getElementById('pagination');
  grid.innerHTML = '<div class="loading">Loading…</div>';
  pag.innerHTML  = '';

  fetch(\`/api/cards?rarity=\${r}&grade=\${g}&condition=\${c}&search=\${s}&page=\${page}\`)
    .then(res => res.json())
    .then(data => {
      document.getElementById('countLabel').textContent = \`\${data.total || 0} cards\`;

      if (!data.cards.length) {
        grid.innerHTML = '<div class="empty">No cards match your filters.</div>';
        return;
      }

      const rarityClass = r => ('rarity-' + (r||'common').toLowerCase());

      grid.innerHTML = data.cards.map(c => \`
        <div class="card \${rarityClass(c.rarity)}">
          <img src="\${c.image || ''}" alt="\${c.name}" loading="lazy">
          <div class="card-info">
            <div class="card-name">\${c.name}</div>
            <div class="card-meta">\${c.set || ''}<br>\${c.rarity || ''} · \${c.condition || ''}</div>
            <div class="card-code">\${c.code}</div>
            \${c.grade ? \`<span class="grade-badge">Grade \${c.grade}/10</span>\` : ''}
          </div>
        </div>\`).join('');

      pag.innerHTML = '';
      for (let i = 1; i <= data.totalPages; i++) {
        const b = document.createElement('button');
        b.className = 'page-btn' + (i === page ? ' active' : '');
        b.textContent = i;
        b.onclick = () => load(i);
        pag.appendChild(b);
      }
    })
    .catch(() => { grid.innerHTML = '<div class="empty">Failed to load cards.</div>'; });
}

['fRarity','fGrade','fCondition'].forEach(id => document.getElementById(id).addEventListener('change', () => load(1)));
document.getElementById('fSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => load(1), 400); });
load(1);
</script>
</body>
</html>`);
});

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
