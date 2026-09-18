/* Pokébot homepage: live stats, feed, big pulls, next set, database teaser, changelog, the pack simulator */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);

  /* ── Stats ─────────────────────────────────────────────────────────── */
  async function loadStats() {
    try {
      const d = await (await fetch('/stats', { cache: 'no-store' })).json();
      animateNum($('statCards'), d.totalCards);
      animateNum($('statUsers'), d.totalUsers);
      animateNum($('statPacks'), d.totalPacks);
      animateNum($('statToday'), d.droppedToday);
      animateNum($('statSlabs'), d.graded);
      animateNum($('statFirst'), d.firstEd);
      $('trustUsers').textContent = fmt(d.totalUsers) + ' trainers';
      $('trustCards').textContent = fmt(d.totalCards) + ' cards';
      $('statActive').textContent = d.newThisWeek ? '+' + fmt(d.newThisWeek) + ' joined this week' : '';
      if (d.tens) $('statGems').textContent = fmt(d.tens) + ' Gem Mint' + (d.black ? ' · ' + fmt(d.black) + ' Black Label' : '');
      if (d.worldFirst) $('statWF').textContent = fmt(d.worldFirst) + ' World Firsts';
      if (Array.isArray(d.perDay) && d.perDay.length) $('statSpark').innerHTML = sparkline(d.perDay.map(x => x.n), 120, 26);
      const delta = $('statDelta');
      if (delta && d.lastWeekAvg > 0) { const pct = Math.round(((d.thisWeekAvg - d.lastWeekAvg) / d.lastWeekAvg) * 100); delta.className = 'delta ' + (pct >= 0 ? 'up' : 'down'); delta.textContent = (pct >= 0 ? '▲ +' : '▼ ') + pct + '% vs last week'; }
      if (d.shinies) { $('shinyLine').hidden = false; $('shinyLine').innerHTML = `✦ Only <b>${fmt(d.shinies)}</b> shin${d.shinies === 1 ? 'y exists' : 'ies exist'} in the whole game — about one every 1,000 packs.`; }
      $('statsNote').textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch (e) { console.error('Stats failed:', e); }
  }

  /* ── Feed + big pulls ──────────────────────────────────────────────── */
  const big = c => ['holo', 'ultra', 'sir', 'mythical'].includes(String(c.rarity || '').toLowerCase()) || c.shiny || c.wf;
  async function loadFeed() {
    try {
      const d = await (await fetch('/api/feed', { cache: 'no-store' })).json();
      const recent = d.recent || [];
      if (recent.length >= 6) {
        const items = recent.map(c => `<a class="pull ${rar(c.rarity)} ${big(c) ? 'big' : ''}" href="${esc(c.href || '/cards')}">${big(c) && c.image ? `<img src="${esc(thumb(c.image, 96))}" alt="" loading="lazy">` : '<span class="rdot"></span>'}<span class="nm">${esc(c.name)}</span><span class="st">${esc(rarLabel(c.rarity))} · ${esc(c.set || '')}${c.first ? ' · 🥇' : ''}${c.shiny ? ' · ✦' : ''}</span>${c.at ? `<span class="ago">${timeAgo(c.at)}</span>` : ''}</a>`).join('');
        $('feedTrack').innerHTML = items + items;
        $('feed').hidden = false;
      }
      const show = (d.bigPulls && d.bigPulls.length >= 3 ? d.bigPulls : d.showcase || []).slice(0, 12);
      if (show.length >= 3) {
        $('showcaseGrid').innerHTML = show.map(c => tile(c, { w: 320, meta: `${esc(rarLabel(c.rarity))} · ${esc(c.set || '')}`, foot: c.at ? timeAgo(c.at) : '' })).join('');
        $('showcase').hidden = false;
        holoInit($('showcaseGrid'));
      }
    } catch (e) { console.error('Feed failed:', e); }
  }

  /* ── Next set countdown ────────────────────────────────────────────── */
  const ns = $('nextset');
  if (ns) { const at = Number(ns.dataset.at) || 0; if (at > Date.now()) countdown($('countdown'), at); else ns.hidden = true; }

  /* ── Database teaser ───────────────────────────────────────────────── */
  async function loadTeaser() {
    try {
      const d = await (await fetch('/api/catalog')).json();
      const sets = (d.sets || []).slice(0, 4);
      $('dbTeaser').innerHTML = sets.map(s => `<a class="setcard panel lift" href="/sets/${esc(s.slug)}">
        <div class="sc-art">${(s.chase || []).slice(0, 3).map(c => `<img src="${esc(thumb(c.image, 160))}" alt="" loading="lazy">`).join('')}</div>
        <div class="sc-body"><div class="sc-name">${esc(s.name)}</div><div class="sc-meta">${esc(s.total)} cards${s.releaseAt ? ' · ' + (s.releaseAt > Date.now() - 8 * 86400000 ? '<b class="new">1st Edition week</b>' : 'released ' + fmtDate(s.releaseAt)) : ' · classic'}</div>
        <div class="sc-pop">${fmt(s.pop ? s.pop.copies : 0)} in circulation · ${fmt(s.pop ? s.pop.holders : 0)} trainers${s.pop && s.pop.completions ? ` · ${fmt(s.pop.completions)} full sets` : ''}</div></div></a>`).join('');
    } catch (e) { console.error('Teaser failed:', e); }
  }

  /* ── News ──────────────────────────────────────────────────────────── */
  async function loadNews() {
    const grid = $('newsGrid');
    try {
      const data = await (await fetch('/api/news', { cache: 'no-store' })).json();
      const news = Array.isArray(data) ? data : (data.news || data.items || []);
      if (!news.length) { grid.innerHTML = '<div class="ncard panel"><div class="nb">No updates yet.</div></div>'; return; }
      const newsDate = s => { const t = Date.parse(s); return isNaN(t) ? String(s || '') : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
      const sorted = news.slice().sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
      const newest = Date.parse(sorted[0].date) || 0;
      grid.innerHTML = sorted.slice(0, 6).map((item, i) => {
        const body = Array.isArray(item.body) ? item.body.join('\n') : String(item.body || item.text || item.description || '');
        const isNew = i === 0 && newest && Date.now() - newest < 30 * 86400000;
        const tag = item.tag ? `<span class="ntag">${esc(item.tag)}</span>` : '';
        return `<div class="ncard panel lift ${isNew ? 'new' : ''}"><div class="nd">${esc(newsDate(item.date))}${tag}</div><div class="nt">${esc(item.title || '')}</div><div class="nb">${esc(body)}</div></div>`;
      }).join('');
    } catch (e) { grid.innerHTML = '<div class="ncard panel"><div class="nb">Couldn\'t load updates. Try refreshing.</div></div>'; }
  }

  /* ── Demo pack: the bot's real shape and odds ──────────────────────── */
  const RANK = { common: 0, uncommon: 1, rare: 2, promo: 3, holo: 4, ultra: 5, sir: 6, mythical: 7 };
  let pools = {}, odds = null, opening = false, session = { packs: 0, best: null, bestRank: -1, holo: 0, god: 0, shiny: 0 };
  async function getPool(set) {
    const k = set || '*';
    if (pools[k]) return pools[k];
    const d = await (await fetch('/api/pool' + (set ? '?set=' + encodeURIComponent(set) : ''))).json();
    odds = odds || d.odds;
    const p = {};
    (d.pool || []).forEach(c => { const r = String(c.rarity || 'common').toLowerCase(); (p[r] = p[r] || []).push(c); });
    if (!$('packSet').options.length || $('packSet').options.length === 1) (d.sets || []).forEach(s => { const o = document.createElement('option'); o.value = s.slug; o.textContent = `${s.name} · ${s.total} cards`; $('packSet').appendChild(o); });
    pools[k] = p; return p;
  }
  const pickFrom = (p, r) => { const a = p[r] && p[r].length ? p[r] : p.common; return a[Math.floor(Math.random() * a.length)]; };
  function rollBonus(p) {
    const avail = odds.bonus.filter(([k]) => p[k] && p[k].length);
    const total = avail.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [k, w] of avail) { r -= w; if (r <= 0) return pickFrom(p, k); }
    return pickFrom(p, 'uncommon');
  }
  const rollCond = (table) => { const x = Math.random(); for (const [k, pct] of table) if (x <= pct) return k; return 'Near Mint'; };
  function ripPack(p) {
    const god = Math.random() < odds.godPack;
    const out = god
      ? Array.from({ length: 5 }, () => pickFrom(p, Math.random() < 0.3 && p.ultra ? 'ultra' : 'holo'))
      : odds.shape.map(slot => slot === 'bonus' ? rollBonus(p) : pickFrom(p, slot));
    const cards = out.map(c => { const holo = RANK[String(c.rarity).toLowerCase()] >= 4; const cond = rollCond(holo ? odds.condition.holo : odds.condition.normal); const shiny = Math.random() < odds.shiny; return { ...c, condition: cond, shiny: shiny ? { style: ['Neon', 'Ghost', 'Midnight', 'Chrome', 'Noir', 'Gold', 'Void'][Math.floor(Math.random() * 7)] } : null }; });
    if (!god) { const best = cards.reduce((b, c, i) => RANK[String(c.rarity).toLowerCase()] > RANK[String(cards[b].rarity).toLowerCase()] ? i : b, 0); cards.push(cards.splice(best, 1)[0]); }
    return { cards, god };
  }
  async function openPack() {
    if (opening) return; opening = true;
    const pack = $('packBtn'), pulls = $('pulls'), foot = $('tryFoot');
    pack.classList.add('opening');
    let p;
    try { p = await getPool($('packSet').value); } catch { toast('Card pool unavailable right now'); pack.classList.remove('opening'); opening = false; return; }
    const { cards, god } = ripPack(p);
    if (!cards.length) { toast('Card pool unavailable right now'); pack.classList.remove('opening'); opening = false; return; }
    setTimeout(() => {
      pack.classList.add('hidden'); $('packStage').hidden = true;
      pulls.hidden = false; foot.hidden = true;
      pulls.innerHTML = cards.map(c => `<div class="pull-card ${rar(c.rarity)} ${RANK[String(c.rarity).toLowerCase()] >= 2 || c.shiny ? 'big' : ''}"><div class="burst"></div>${holoCard(c, { w: 320, eager: true })}<div class="back"><img src="/img/pokebot.png" alt=""></div><div class="cap"><a href="${esc(c.href || '/cards')}">${esc(c.name)}</a><br><span class="rtag">${esc(rarLabel(c.rarity))}</span> <span class="cond">${esc(c.condition)}</span>${c.shiny ? `<br><span class="bdg b-shiny">✦ ${esc(c.shiny.style)}</span>` : ''}</div></div>`).join('');
      holoInit(pulls);
      const els = pulls.querySelectorAll('.pull-card');
      els.forEach((el, i) => setTimeout(() => el.classList.add('flip'), 150 + i * 420 + (i === 4 ? 300 : 0)));
      setTimeout(() => {
        const best = cards[4], bestRank = RANK[String(best.rarity).toLowerCase()] || 0;
        session.packs++; session.holo += cards.filter(c => RANK[String(c.rarity).toLowerCase()] >= 4).length; if (god) session.god++; session.shiny += cards.filter(c => c.shiny).length;
        if (bestRank > session.bestRank) { session.bestRank = bestRank; session.best = best; }
        const shiny = cards.find(c => c.shiny);
        $('trySummary').innerHTML = shiny ? `✦ <b>A SHINY ${esc(shiny.name)}</b> — one in five thousand. In Discord the whole server would hear about this.`
          : god ? `🌟 <b>GOD PACK</b> — all five Holo or better. One in two hundred.`
          : bestRank >= 4 ? `🔥 <b>${esc(best.name)}</b> — a ${esc(rarLabel(best.rarity))} pull in ${esc(best.condition)}. In Discord that's one for the grading desk.`
          : bestRank >= 2 ? `Nice — <b>${esc(best.name)}</b> is your best pull. Rip more packs to chase the holos.`
          : `All staples this time. That's the grind — the holos are out there.`;
        $('tryStats').hidden = false;
        $('tryStats').innerHTML = `<span>${session.packs} pack${session.packs === 1 ? '' : 's'} ripped</span><span>${session.holo} holo+</span>${session.god ? `<span>🌟 ${session.god} God Pack</span>` : ''}${session.shiny ? `<span>✦ ${session.shiny} shiny</span>` : ''}${session.best ? `<span>best: <b>${esc(session.best.name)}</b> (${esc(rarLabel(session.best.rarity))})</span>` : ''}`;
        foot.hidden = false; opening = false;
      }, 150 + 5 * 420 + 500);
    }, 650);
  }
  function resetPack() { const pack = $('packBtn'); $('pulls').hidden = true; $('pulls').innerHTML = ''; $('tryFoot').hidden = true; $('packStage').hidden = false; pack.classList.remove('opening', 'hidden'); }
  $('packBtn')?.addEventListener('click', openPack);
  $('againBtn')?.addEventListener('click', () => { resetPack(); setTimeout(openPack, 250); });
  $('packSet')?.addEventListener('change', () => { const o = $('packSet').selectedOptions[0]; $('pkSub').textContent = (o && o.value ? o.textContent.split(' · ')[0] : 'Booster pack') + ' · 5 cards'; });
  if ('IntersectionObserver' in window && $('try')) { const o = new IntersectionObserver(en => { if (en[0].isIntersecting) { getPool('').catch(() => {}); o.disconnect(); } }, { rootMargin: '400px' }); o.observe($('try')); }

  loadStats(); loadFeed(); loadTeaser(); loadNews();
  setInterval(loadStats, 60000);
  setInterval(loadFeed, 180000);
})();
