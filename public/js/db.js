/* Pokébot database pages: the set index, a set, a card, the leaderboards, a trainer profile (and the profile half of the dashboard) */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const main = document.querySelector('main');
  const RARITIES = ['sir', 'ultra', 'holo', 'promo', 'rare', 'uncommon', 'common'];
  const COND_ORDER = ['flawless', 'pristine', 'mint', 'near mint', 'light play', 'damaged', 'unknown'];
  const pct = (n, d) => d ? Math.round(n / d * 1000) / 10 : 0;
  const plural = (n, s) => `${fmt(n)} ${s}${n === 1 ? '' : 's'}`;
  const bar = (el, legend, entries, cls) => {   // entries: [[label, count, rarClass]]
    const total = entries.reduce((s, e) => s + e[1], 0) || 1;
    el.innerHTML = entries.map(e => `<i class="${e[2] || ''}" style="--w:${(e[1] / total * 100).toFixed(2)}%" title="${esc(e[0])}: ${fmt(e[1])}"></i>`).join('');
    legend.innerHTML = entries.map(e => `<span class="${e[2] || ''}"><span class="rdot"></span>${esc(e[0])} <b>${fmt(e[1])}</b> · ${Math.round(e[1] / total * 100)}%</span>`).join('');
    /* .hbar segments size themselves from --w */
  };

  /* ── /cards: sets, schedule, search ────────────────────────────────── */
  async function cardsIndex() {
    const grid = $('setGrid'), sched = $('schedule');
    try {
      const d = await (await fetch('/api/catalog')).json();
      grid.innerHTML = d.sets.map(s => { const held = s.pop ? s.pop.held : 0; return `<a class="setcard panel lift" href="/sets/${esc(s.slug)}">
        <div class="sc-art">${(s.chase || []).slice(0, 3).map(c => `<img src="${esc(thumb(c.image, 160))}" alt="" loading="lazy">`).join('')}</div>
        <div class="sc-body"><div class="sc-name">${esc(s.name)}</div><div class="sc-meta">${esc(s.total)} cards · ${s.releaseAt ? (s.releaseAt > Date.now() - 8 * 86400000 ? '<b class="new">🥇 1st Edition week</b>' : 'released ' + fmtDate(s.releaseAt)) : (s.series || 'classic')}</div>
        <div class="sc-pop">${fmt(s.pop ? s.pop.copies : 0)} in circulation · ${fmt(s.pop ? s.pop.holders : 0)} trainers${s.pop && s.pop.completions ? ` · ${fmt(s.pop.completions)} full set${s.pop.completions === 1 ? '' : 's'}` : ''}</div>
        <div class="sc-bar" title="${held} of ${s.total} cards found by someone"><i style="--w:${pct(held, s.total)}%"></i></div></div></a>`; }).join('');
      requestAnimationFrame(() => grid.querySelectorAll('.sc-bar i').forEach(i => i.style.transform = 'scaleX(' + parseFloat(i.style.getPropertyValue('--w')) / 100 + ')'));
      const up = d.upcoming || [];
      sched.innerHTML = up.slice(0, 12).map((u, i) => `<div class="sched-row panel ${i === 0 ? 'next' : ''}"><div class="sd-date"><b>${esc(new Date(u.releaseAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }))}</b><span>${esc(new Date(u.releaseAt).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }))}</span></div><div class="sd-body"><div class="sd-name">${esc(u.name)}${i === 0 ? ' <span class="bdg b-first">next</span>' : ''}</div><div class="sd-meta">${esc(u.total)} cards${u.series ? ' · ' + esc(u.series) : ''}${u.originalRelease ? ' · first printed ' + esc(String(u.originalRelease).slice(0, 4)) : ''}</div></div>${i === 0 ? '<div class="countdown sm" id="schedCountdown"><div><b>—</b><span>d</span></div><div><b>—</b><span>h</span></div><div><b>—</b><span>m</span></div><div><b>—</b><span>s</span></div></div>' : ''}</div>`).join('')
        + (up.length > 12 ? `<p class="hint-line">…and ${up.length - 12} more, one a week.</p>` : '');
      if (up[0]) countdown($('schedCountdown'), up[0].releaseAt);
    } catch (e) { grid.innerHTML = '<div class="empty"><h3>Couldn\'t load the catalog</h3></div>'; }
    let t;
    const run = async () => {
      const q = $('q').value.trim();
      if (q.length < 2) { $('results').hidden = true; return; }
      const d = await (await fetch('/api/search?q=' + encodeURIComponent(q))).json();
      $('results').hidden = false;
      $('resultsTitle').textContent = d.results.length ? `${d.results.length} card${d.results.length === 1 ? '' : 's'} for “${q}”` : `Nothing for “${q}”`;
      $('resultsGrid').innerHTML = d.results.map(c => tile(c, { w: 240, meta: `${esc(rarLabel(c.rarity))} · ${esc(c.set)}`, foot: `${fmt(c.copies)} in circulation` })).join('');
      holoInit($('resultsGrid'));
    };
    $('q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
    $('clearSearch').addEventListener('click', () => { $('q').value = ''; $('results').hidden = true; });
    document.addEventListener('keydown', e => { if (e.key === '/' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus(); } });
    if (location.hash === '#upcoming') $('upcoming').scrollIntoView();
  }

  /* ── /sets/:slug ───────────────────────────────────────────────────── */
  async function setPage(slug) {
    let d, mine = null;
    try { d = await (await fetch('/api/sets/' + slug)).json(); } catch { $('grid').innerHTML = '<div class="empty"><h3>Couldn\'t load this set</h3></div>'; return; }
    try { const r = await fetch('/api/checklist/' + slug); if (r.ok) { const c = await r.json(); mine = new Map(c.cards.map(x => [x.slug, x.copies])); } } catch {}
    const p = d.pop || {};
    $('kCopies').textContent = fmt(p.copies); $('kCopiesSub').textContent = p.copies ? `${(p.copies / d.total).toFixed(1)} per card` : '';
    $('kHolders').textContent = fmt(p.holders);
    $('kHeld').textContent = `${fmt(p.held)}/${d.total}`; $('kHeldSub').textContent = p.held < d.total ? `${d.total - p.held} never pulled yet` : 'every card has been pulled';
    $('kFull').textContent = fmt(p.completions);
    $('chaseRow').innerHTML = (d.chase || []).map(c => tile({ ...c, set: d.name }, { w: 240, meta: esc(rarLabel(c.rarity)) })).join('');
    holoInit($('chaseRow'));
    const counts = {}; d.cards.forEach(c => counts[c.rarity] = (counts[c.rarity] || 0) + 1);
    $('rarityChips').innerHTML = '<button class="active" data-r="all">All · ' + d.cards.length + '</button>' + RARITIES.filter(r => counts[r]).map(r => `<button class="${rar(r)}" data-r="${r}"><span class="rdot"></span>${rarLabel(r)} · ${counts[r]}</button>`).join('');
    if (mine) { $('onlyMissing').parentElement.classList.add('show'); $('onlyMissingLabel').textContent = `Only cards I'm missing (${d.total - [...mine.values()].filter(Boolean).length})`; }
    let filter = 'all';
    const RANKV = { common: 0, uncommon: 1, rare: 2, promo: 3, holo: 4, ultra: 5, sir: 6 };
    function draw() {
      const sort = $('sort').value, onlyMissing = $('onlyMissing').checked;
      let list = d.cards.filter(c => (filter === 'all' || c.rarity === filter) && (!onlyMissing || !mine || !mine.get(c.slug)));
      const s = { number: (a, b) => Number(a.n) - Number(b.n), rarity: (a, b) => RANKV[b.rarity] - RANKV[a.rarity] || Number(a.n) - Number(b.n), copies: (a, b) => b.copies - a.copies, rarest: (a, b) => a.copies - b.copies, graded: (a, b) => b.graded - a.graded || b.copies - a.copies };
      list.sort(s[sort] || s.number);
      $('count').textContent = plural(list.length, 'card');
      $('grid').innerHTML = list.length ? list.map(c => { const have = mine ? mine.get(c.slug) : null; return tile({ ...c, set: d.name, first: false, wf: false }, { w: 240, meta: `<span class="n">#${esc(c.n)}</span>${esc(rarLabel(c.rarity))}`,
        extraBadges: (c.best ? `<span class="bdg b-grade ${c.best >= 10 ? 'ten' : c.best >= 9.5 ? 'nine5' : c.best >= 9 ? 'nine' : ''}${c.black ? ' black' : ''}">${c.black ? '🖤 ' : '🏅 '}${esc(c.best)}</span>` : '') + (c.wf ? '<span class="bdg b-wf">🌍</span>' : c.firstEd ? `<span class="bdg b-first">🥇 ${c.firstEd}</span>` : '') + (c.shiny ? '<span class="bdg b-shiny">✦</span>' : '') + (have ? `<span class="bdg b-have">✓ ${have > 1 ? '×' + have : 'own'}</span>` : ''),
        foot: c.copies ? `${fmt(c.copies)} ${c.copies === 1 ? 'copy' : 'copies'} · ${fmt(c.holders)} trainer${c.holders === 1 ? '' : 's'}` : 'never pulled' }); }).join('') : '<div class="empty"><div class="big">🎉</div><h3>Nothing missing here</h3></div>';
      holoInit($('grid'));
    }
    $('rarityChips').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; filter = b.dataset.r; $('rarityChips').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); draw(); });
    $('sort').addEventListener('change', draw); $('onlyMissing').addEventListener('change', draw);
    draw();
  }

  /* ── /cards/:set/:card ─────────────────────────────────────────────── */
  async function cardPage(key) {
    let d;
    try { d = await (await fetch('/api/cards/' + key)).json(); } catch { return; }
    const p = d.pop;
    $('kCopies').textContent = fmt(p.copies); $('kLast7').textContent = p.last7 ? `+${fmt(p.last7)} this week` : (p.copies ? 'none this week' : 'never pulled');
    $('kHolders').textContent = fmt(p.holders); $('kScarce').textContent = p.holders ? (p.holders <= 3 ? 'very scarce' : p.holders <= 15 ? 'scarce' : p.holders <= 60 ? 'uncommon to hold' : 'widely held') : '';
    $('kGraded').textContent = fmt(p.graded); $('kTens').textContent = p.tens ? `${fmt(p.tens)} Gem Mint${p.black ? ` · ${fmt(p.black)} Black Label` : ''}` : (p.graded ? `best ${p.best.grade}` : 'nothing slabbed yet');
    $('kFirst').textContent = fmt(p.firstEd); $('kWF').textContent = p.wf ? '🌍 World First exists' : (p.firstEd ? 'no World First yet' : d.set.releaseAt ? 'none in this set\'s week' : 'classic set: no 1st Ed week');
    if (d.odds && d.odds.pct != null) $('odds').textContent = `${d.odds.pct}% of ${d.odds.slot}`; else if (d.odds && d.odds.slot) $('odds').textContent = d.odds.slot;
    const gk = Object.keys(p.grades || {}).sort((a, b) => Number(b) - Number(a));
    if (gk.length) { bar($('gradeBar'), $('gradeLegend'), gk.map(g => [g, p.grades[g], Number(g) >= 10 ? 'rar-mythical' : Number(g) >= 9 ? 'rar-holo' : Number(g) >= 8 ? 'rar-uncommon' : 'rar-common'])); $('gradeNote').textContent = `${fmt(p.graded)} slab${p.graded === 1 ? '' : 's'}`; }
    else { $('gradeBar').innerHTML = ''; $('gradeLegend').innerHTML = '<span>No slabs yet. Be the first: <code class="cmd">/grade</code></span>'; }
    const ck = COND_ORDER.filter(c => p.cond[c]);
    if (ck.length) { bar($('condBar'), $('condLegend'), ck.map(c => [c.replace(/\b\w/g, m => m.toUpperCase()), p.cond[c], { flawless: 'rar-sir', pristine: 'rar-holo', mint: 'rar-uncommon', 'near mint': 'rar-common', 'light play': 'rar-promo', damaged: 'rar-rare' }[c] || ''])); $('condNote').textContent = `${fmt(p.copies)} copies`; }
    else $('condLegend').innerHTML = '<span>No copies in circulation yet.</span>';
    if (p.slabs && p.slabs.length) { $('slabPanel').hidden = false; $('slabList').innerHTML = p.slabs.map(s => `<div class="slab-row"><span class="bdg b-grade ${s.grade >= 10 ? 'ten' : s.grade >= 9.5 ? 'nine5' : s.grade >= 9 ? 'nine' : ''}${s.black ? ' black' : ''}">${s.black ? '🖤 ' : ''}${esc(s.grade)}</span><span class="sr-title">${esc(gradeTitle(s.grade, s.black))}</span><span class="sr-cert">${esc(s.cert || '')}</span><span class="sr-date">${s.at ? esc(fmtDate(s.at)) : ''}</span></div>`).join(''); }
    const nb = (c, dir) => c ? `<a class="cn ${dir}" href="${esc(c.href)}"><img src="${esc(thumb(c.image, 96))}" alt=""><span><small>${dir === 'prev' ? '‹ Previous' : 'Next ›'}</small>#${esc(c.n)} ${esc(c.name)}</span></a>` : '<span></span>';
    $('cardNav').innerHTML = nb(d.prev, 'prev') + nb(d.next, 'next');
  }

  /* ── /leaderboards ─────────────────────────────────────────────────── */
  async function leaderboards() {
    let d;
    try { d = await (await fetch('/api/boards', { cache: 'no-store' })).json(); } catch { $('board').innerHTML = '<div class="empty"><h3>Couldn\'t load the boards</h3></div>'; return; }
    const keys = Object.keys(d.boards);
    let cur = location.hash.slice(1) && keys.includes(location.hash.slice(1)) ? location.hash.slice(1) : keys[0];
    $('tabs').innerHTML = keys.map(k => `<button data-k="${k}" class="${k === cur ? 'active' : ''}">${esc(d.boards[k].title)}</button>`).join('');
    $('boardsNote').textContent = 'Updated ' + new Date(d.updated).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const draw = () => {
      const b = d.boards[cur];
      history.replaceState(null, '', '#' + cur);
      $('board').innerHTML = b.rows.length ? `<table class="table"><thead><tr><th>#</th><th>Trainer</th><th style="text-align:right">${esc(b.unit)}</th></tr></thead><tbody>${b.rows.map(r => `<tr class="${r.me ? 'me' : ''}"><td class="rank">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td><td class="who"><a href="/t/${esc(r.uid)}">${esc(r.name)}${r.me ? ' <span class="bdg b-lab">you</span>' : ''}</a>${r.sub ? `<div class="sub">${esc(r.sub)}</div>` : ''}</td><td class="val">${b.unit === '%' ? r.v + '%' : fmt(r.v)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty"><div class="big">🌱</div><h3>Nobody on this board yet</h3></div>';
      $('boardHint').textContent = d.me ? (b.rows.some(r => r.me) ? 'That\'s you, highlighted.' : 'You\'re not in the top 25 of this one yet.') : 'Log in with Discord to see where you stand.';
    };
    $('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; cur = b.dataset.k; $('tabs').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); draw(); });
    draw();
  }

  /* ── profile (also the top half of the dashboard) ──────────────────── */
  window.renderProfile = function (d, opts) {
    opts = opts || {};
    $('profSub').innerHTML = `${plural(d.total, 'card')} · ${fmt(d.unique)} unique of ${fmt(d.catalogCards)} · ${d.setsStarted} set${d.setsStarted === 1 ? '' : 's'} started${d.completed ? `, <b>${d.completed} complete</b>` : ''}${d.lastPull ? ` · last pull ${timeAgo(d.lastPull)}` : ''}`;
    const k = [['Cards', fmt(d.total), d.rank.binder ? `#${d.rank.binder} biggest binder` : `${fmt(d.spares)} spares`], ['Unique', fmt(d.unique), `${pct(d.unique, d.catalogCards)}% of the game`], ['Slabs', fmt(d.graded), d.tens ? `${d.tens} Gem Mint${d.black ? ` · ${d.black} Black Label` : ''}` : (d.atGraders ? `${d.atGraders} at the graders` : '')],
      ['1st Editions', fmt(d.firstEd), d.wf ? `🌍 ${d.wf} World First${d.wf === 1 ? '' : 's'}` : ''], ['Shinies', fmt(d.shinies), d.shinies ? '✦ one in five thousand' : ''], ['Est. value', fmt(d.value), d.rank.value ? `#${d.rank.value} most valuable` : 'coins at house prices']];
    $('profKpis').innerHTML = k.map(([a, b, c]) => `<div class="kpi panel"><div class="k">${a}</div><div class="v">${b}</div><div class="s">${c}</div></div>`).join('');
    $('wall').innerHTML = d.best9.length ? d.best9.map(c => tile(c, { w: 240, meta: `${esc(rarLabel(c.rarity))} · ${esc(c.set || '')}` })).join('') : '<div class="empty"><div class="big">📦</div><h3>An empty wall</h3><p>Open a pack in Discord and it fills up.</p></div>';
    holoInit($('wall'));
    const sets = d.sets.filter(s => s.have > 0).slice(0, opts.maxSets || 10);
    $('sets').innerHTML = sets.length ? sets.map(s => `<a class="setrow" href="/sets/${esc(s.slug)}"><span>${esc(s.name)}</span><span class="cnt"><b>${s.have}</b>/${s.total}${s.have >= s.total ? ' ✓' : ''}</span><div class="bar"><i style="--w:${s.pct}%"></i></div></a>`).join('') : '<div class="bd-note">No sets yet.</div>';
    requestAnimationFrame(() => $('sets').querySelectorAll('.bar i').forEach(i => i.style.transform = 'scaleX(' + parseFloat(i.style.getPropertyValue('--w')) / 100 + ')'));
    $('setsNote').textContent = sets.length ? `${d.setsStarted} started · ${d.completed} complete` : '';
    const by = d.byRarity || {};
    bar($('rarBar'), $('rarLegend'), RARITIES.filter(r => by[r]).map(r => [rarLabel(r), by[r], rar(r)]));
    const holo = (by.holo || 0) + (by.ultra || 0) + (by.sir || 0);
    $('rarNote').textContent = holo ? `${fmt(holo)} holo or better (${pct(holo, d.total)}%)` : '';
    const sec = (id, gridId, list, fn) => { if (!$(id) || !list || !list.length) return; $(id).hidden = false; $(gridId).innerHTML = list.map(fn).join(''); holoInit($(gridId)); };
    sec('slabsSec', 'slabs', d.slabs, c => `<a href="${esc(c.href || '#')}">${slabHtml(c, { cls: 'sm', w: 240 })}<div class="slab-cap">${esc(gradeTitle(c.grade, c.black))}${c.cert ? ' · ' + esc(c.cert) : ''}</div></a>`);
    sec('firstSec', 'firsts', d.firsts, c => tile(c, { w: 240, meta: `${esc(rarLabel(c.rarity))} · ${esc(c.set || '')}` }));
    sec('shinySec', 'shinies', d.shinyCards, c => tile(c, { w: 240, meta: `✦ ${esc(c.shiny && c.shiny.style || 'Shiny')} · ${esc(c.set || '')}` }));
    sec('recentSec', 'recent', d.recent, c => tile(c, { w: 160, meta: esc(rarLabel(c.rarity)), foot: c.obtainedAt ? timeAgo(c.obtainedAt) : '' }));
    revealInit();
  };
  async function profile(uid) {
    try {
      const d = await (await fetch('/api/profile/' + uid)).json();
      if (d.error) return;
      renderProfile(d);
      if (d.me) $('profMine').hidden = false;
    } catch (e) { console.error('Profile failed:', e); }
  }

  /* ── dispatch ──────────────────────────────────────────────────────── */
  if ($('setGrid')) cardsIndex();
  else if (main && main.dataset.set) setPage(main.dataset.set);
  else if (main && main.dataset.card) cardPage(main.dataset.card);
  else if ($('tabs') && $('board')) leaderboards();
  else if (main && main.classList.contains('profile')) profile(main.dataset.uid);
})();
