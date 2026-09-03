/* Pokebot homepage: live stats, feed, showcase, news, demo pack */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const rar = r => 'rar-' + String(r || 'common').toLowerCase();
  const rarLabel = r => { r = String(r || 'common'); return r.toLowerCase() === 'sir' ? 'SIR' : r.charAt(0).toUpperCase() + r.slice(1).toLowerCase(); };
  const holoCard = (c, extra) => `<div class="holo-card ${['holo','sir','mythical'].includes(String(c.rarity||'').toLowerCase()) ? 'is-holo' : ''} ${extra || ''}"><img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy" decoding="async"><div class="sk"></div><div class="foil"></div><div class="glare"></div></div>`;

  /* ── Stats ─────────────────────────────────────────────────────────── */
  async function loadStats() {
    try {
      const d = await (await fetch('/stats', { cache: 'no-store' })).json();
      const USER_DISPLAY_BONUS = 10000; // kept from the previous site
      const users = (Number(d.totalUsers) || 0) + USER_DISPLAY_BONUS;
      animateNum($('statCards'), d.totalCards);
      animateNum($('statUsers'), users);
      animateNum($('statPacks'), d.totalPacks);
      animateNum($('statToday'), d.droppedToday);
      animateNum($('statWeek'), d.thisWeekAvg);
      const tu = $('trustUsers'); if (tu) tu.textContent = fmt(users) + ' trainers';
      const delta = $('statDelta');
      if (delta && d.lastWeekAvg > 0) {
        const pct = Math.round(((d.thisWeekAvg - d.lastWeekAvg) / d.lastWeekAvg) * 100);
        delta.className = 'delta ' + (pct >= 0 ? 'up' : 'down');
        delta.textContent = (pct >= 0 ? '▲ +' : '▼ ') + pct + '% vs last week';
      }
      const note = $('statsNote'); if (note) note.textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch (e) { console.error('Stats failed:', e); }
  }

  /* ── Feed + showcase ───────────────────────────────────────────────── */
  async function loadFeed() {
    try {
      const d = await (await fetch('/api/feed', { cache: 'no-store' })).json();
      const recent = d.recent || [];
      if (recent.length >= 6) {
        const items = recent.map(c => `<span class="pull ${rar(c.rarity)}"><span class="rdot"></span><span class="nm">${esc(c.name)}</span><span class="st">${esc(rarLabel(c.rarity))} · ${esc(c.set || '')}</span>${c.at ? `<span class="ago">${timeAgo(c.at)}</span>` : ''}</span>`).join('');
        $('feedTrack').innerHTML = items + items; // duplicated for a seamless loop
        $('feed').hidden = false;
      }
      const show = (d.showcase || []).slice(0, 6);
      if (show.length >= 3) {
        $('showcaseGrid').innerHTML = show.map(c => `<div class="show ${rar(c.rarity)}">${holoCard(c)}<div class="nm">${esc(c.name)}</div><div class="st">${esc(rarLabel(c.rarity))} · ${esc(c.set || '')}${c.grade ? ' · PSA ' + esc(c.grade) : ''}</div></div>`).join('');
        $('showcase').hidden = false;
        holoInit($('showcaseGrid'));
      }
    } catch (e) { console.error('Feed failed:', e); }
  }

  /* ── News ──────────────────────────────────────────────────────────── */
  async function loadNews() {
    const grid = $('newsGrid');
    try {
      const data = await (await fetch('/api/news', { cache: 'no-store' })).json();
      const news = Array.isArray(data) ? data : (data.news || data.items || []);
      if (!news.length) { grid.innerHTML = '<div class="ncard panel"><div class="nb">No updates yet.</div></div>'; return; }
      const newest = news.map(n => Date.parse(n.date) || 0).reduce((a, b) => Math.max(a, b), 0);
      grid.innerHTML = news.slice(0, 6).map(item => {
        const body = Array.isArray(item.body) ? item.body.join('\n') : String(item.body || item.text || item.description || '');
        const isNew = newest && Date.parse(item.date) === newest && Date.now() - newest < 30 * 86400000;
        return `<div class="ncard panel lift ${isNew ? 'new' : ''}"><div class="nd">${esc(item.date || '')}</div><div class="nt">${esc(item.title || '')}</div><div class="nb">${esc(body)}</div></div>`;
      }).join('');
    } catch (e) {
      grid.innerHTML = '<div class="ncard panel"><div class="nb">Couldn\'t load updates. Try refreshing.</div></div>';
    }
  }

  /* ── Demo pack ─────────────────────────────────────────────────────── */
  const ODDS = [['common', 52], ['uncommon', 30], ['rare', 10], ['promo', 3], ['holo', 4], ['sir', .7], ['mythical', .3]];
  let pool = null, opening = false;
  async function getPool() {
    if (pool) return pool;
    const d = await (await fetch('/api/pool')).json();
    pool = {};
    (d.pool || []).forEach(c => { const k = String(c.rarity || 'common').toLowerCase(); (pool[k] = pool[k] || []).push(c); });
    return pool;
  }
  function roll(p) {
    const avail = ODDS.filter(([k]) => p[k] && p[k].length);
    const total = avail.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [k, w] of avail) { r -= w; if (r <= 0) return p[k][Math.floor(Math.random() * p[k].length)]; }
    return avail[0] ? p[avail[0][0]][0] : null;
  }
  function pickFive(p) {
    const out = [];
    for (let i = 0; i < 5; i++) { const c = roll(p); if (c) out.push(c); }
    // guarantee at least one uncommon-or-better in slot 4, like a real pack
    if (out.length === 5 && out.every(c => String(c.rarity).toLowerCase() === 'common')) {
      const better = ODDS.slice(1).map(([k]) => p[k]).find(a => a && a.length);
      if (better) out[3] = better[Math.floor(Math.random() * better.length)];
    }
    // best card last for the reveal
    const rank = { common: 0, uncommon: 1, rare: 2, promo: 3, holo: 4, sir: 5, mythical: 6 };
    const best = out.reduce((b, c, i) => (rank[String(c.rarity).toLowerCase()] || 0) > (rank[String(out[b].rarity).toLowerCase()] || 0) ? i : b, 0);
    out.push(out.splice(best, 1)[0]);
    return out;
  }
  async function openPack() {
    if (opening) return; opening = true;
    const pack = $('packBtn'), pulls = $('pulls'), foot = $('tryFoot');
    pack.classList.add('opening');
    let p;
    try { p = await getPool(); } catch { toast('Card pool unavailable right now'); pack.classList.remove('opening'); opening = false; return; }
    const five = pickFive(p);
    if (!five.length) { toast('Card pool unavailable right now'); pack.classList.remove('opening'); opening = false; return; }
    setTimeout(() => {
      pack.classList.add('hidden'); $('packStage').hidden = true;
      pulls.hidden = false; foot.hidden = true;
      const rank = { common: 0, uncommon: 1, rare: 2, promo: 3, holo: 4, sir: 5, mythical: 6 };
      pulls.innerHTML = five.map((c, i) => `<div class="pull-card ${rar(c.rarity)} ${rank[String(c.rarity).toLowerCase()] >= 2 ? 'big' : ''}"><div class="burst"></div>${holoCard(c)}<div class="back"><img src="/img/pokebot.png" alt=""></div><div class="cap">${esc(c.name)}<br><span class="rtag">${esc(rarLabel(c.rarity))}</span></div></div>`).join('');
      holoInit(pulls);
      const cards = pulls.querySelectorAll('.pull-card');
      cards.forEach((el, i) => setTimeout(() => el.classList.add('flip'), 150 + i * 420 + (i === 4 ? 300 : 0)));
      setTimeout(() => {
        const best = five[4];
        const bestRank = rank[String(best.rarity).toLowerCase()] || 0;
        $('trySummary').innerHTML = bestRank >= 4 ? `🔥 <b>${esc(best.name)}</b> — a ${esc(rarLabel(best.rarity))} pull! In Discord that's one for the grading lab.`
          : bestRank >= 2 ? `Nice — <b>${esc(best.name)}</b> is your best pull. Rip more packs to chase the holos.`
          : `All staples this time. That's the grind — the holos are out there.`;
        foot.hidden = false; opening = false;
      }, 150 + 5 * 420 + 500);
    }, 650);
  }
  function resetPack() {
    const pack = $('packBtn');
    $('pulls').hidden = true; $('pulls').innerHTML = ''; $('tryFoot').hidden = true;
    $('packStage').hidden = false; pack.classList.remove('opening', 'hidden');
  }
  $('packBtn')?.addEventListener('click', openPack);
  $('againBtn')?.addEventListener('click', () => { resetPack(); setTimeout(openPack, 250); });
  // warm the pool once the section is near the viewport
  if ('IntersectionObserver' in window && $('try')) {
    const o = new IntersectionObserver(en => { if (en[0].isIntersecting) { getPool().catch(() => {}); o.disconnect(); } }, { rootMargin: '400px' });
    o.observe($('try'));
  }

  loadStats(); loadFeed(); loadNews();
  setInterval(loadStats, 60000);
  setInterval(loadFeed, 180000);
})();
