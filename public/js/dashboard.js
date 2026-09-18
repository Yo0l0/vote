/* Pokébot dashboard: my binder — the profile block, a set checklist, the filtered grid, the card sheet */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let page = 1, searchTimer, lastCards = [], modalIndex = -1, summary = null;
  const filters = ['fSpecial', 'fRarity', 'fSet', 'fGrade', 'fCondition', 'fSort'];

  /* ── URL state ─────────────────────────────────────────────────────── */
  function readState() {
    const q = new URLSearchParams(location.search);
    filters.forEach(id => { const v = q.get(id.slice(1).toLowerCase()); if (v) $(id).value = v; });
    if (q.get('q')) $('fSearch').value = q.get('q');
    page = Math.max(1, parseInt(q.get('page')) || 1);
  }
  function writeState() {
    const q = new URLSearchParams();
    filters.forEach(id => { const v = $(id).value; if (v && v !== 'all' && !(id === 'fSort' && v === 'newest')) q.set(id.slice(1).toLowerCase(), v); });
    if ($('fSearch').value) q.set('q', $('fSearch').value);
    if (page > 1) q.set('page', page);
    const s = q.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
  }

  /* ── Summary (the profile block) + checklist ───────────────────────── */
  async function loadSummary() {
    try {
      const d = await (await fetch('/api/summary', { cache: 'no-store' })).json();
      if (d.empty) { $('profSub').textContent = 'Your binder is empty. Open a pack in Discord and it shows up here a few minutes later.'; $('profKpis').innerHTML = ''; $('wall').innerHTML = '<div class="empty"><div class="big">📦</div><h3>Nothing yet</h3><p>Run <code class="cmd">/openpack</code> in Discord.</p></div>'; return; }
      summary = d;
      renderProfile(d, { maxSets: 8 });
      const all = d.sets.slice().sort((a, b) => b.pct - a.pct || (b.releaseAt || 0) - (a.releaseAt || 0));
      $('checkSet').innerHTML = all.map(s => `<option value="${esc(s.slug)}">${esc(s.name)} · ${s.have}/${s.total}</option>`).join('');
      const sel = $('fSet'), cur = sel.value;
      sel.innerHTML = '<option value="all">All sets</option>' + all.filter(s => s.have).map(s => `<option value="${esc(s.name)}">${esc(s.name)} (${s.have})</option>`).join('');
      sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'all';
      loadChecklist();
    } catch (e) { console.error('Summary failed:', e); }
  }
  async function loadChecklist() {
    const slug = $('checkSet').value; if (!slug) return;
    $('checklist').innerHTML = '<div class="skel-tiles"><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>';
    try {
      const c = await (await fetch('/api/checklist/' + slug)).json();
      const missing = c.cards.filter(x => !x.copies);
      $('checkHead').innerHTML = `<div class="ch-bar"><i style="--w:${Math.round(c.have / c.set.total * 100)}%"></i></div><div class="ch-line"><b>${c.have}/${c.set.total}</b> ${c.set.name}${missing.length ? ` · <b>${missing.length}</b> missing` : ' · <b>complete ✓</b>'} · <a href="/sets/${esc(c.set.slug)}">open the set</a> · in Discord: <code class="cmd" data-copy="/checklist set:${esc(c.set.name)}">/checklist set:${esc(c.set.name)}</code></div>`;
      requestAnimationFrame(() => $('checkHead').querySelectorAll('.ch-bar i').forEach(i => i.style.transform = 'scaleX(' + parseFloat(i.style.getPropertyValue('--w')) / 100 + ')'));
      const order = c.cards.slice().sort((a, b) => (!!a.copies - !!b.copies) || Number(a.n) - Number(b.n));
      $('checklist').innerHTML = order.map(x => tile({ ...x, set: c.set.name }, { w: 160, cls: x.copies ? '' : 'dim', meta: `<span class="n">#${esc(x.n)}</span>${esc(rarLabel(x.rarity))}`, extraBadges: x.copies ? `<span class="bdg b-have">✓${x.copies > 1 ? ' ×' + x.copies : ''}</span>` : '<span class="bdg">missing</span>' })).join('');
      holoInit($('checklist'));
    } catch { $('checklist').innerHTML = '<div class="empty"><h3>Couldn\'t load the checklist</h3></div>'; }
  }
  $('checkSet').addEventListener('change', loadChecklist);

  /* ── Grid ──────────────────────────────────────────────────────────── */
  function pageButtons(total) {
    if (total <= 1) return [];
    const out = new Set([1, total, page, page - 1, page + 1]);
    if (page <= 3) { out.add(2); out.add(3); } if (page >= total - 2) { out.add(total - 1); out.add(total - 2); }
    const nums = [...out].filter(n => n >= 1 && n <= total).sort((a, b) => a - b), seq = [];
    nums.forEach((n, i) => { if (i && n - nums[i - 1] > 1) seq.push('…'); seq.push(n); });
    return seq;
  }
  function renderPagination(total) {
    const pag = $('pagination'); pag.innerHTML = '';
    if (total <= 1) return;
    const mk = (label, p, o = {}) => { const b = document.createElement('button'); b.className = 'pg' + (o.active ? ' active' : '') + (o.dots ? ' dots' : ''); b.textContent = label; b.disabled = !!(o.dots || o.disabled); if (!b.disabled) b.onclick = () => load(p, true); pag.appendChild(b); };
    mk('‹', page - 1, { disabled: page === 1 });
    pageButtons(total).forEach(n => n === '…' ? mk('…', 0, { dots: true }) : mk(n, n, { active: n === page }));
    mk('›', page + 1, { disabled: page === total });
  }
  function load(p, scroll) {
    page = p || 1; writeState();
    const q = new URLSearchParams({ special: $('fSpecial').value, rarity: $('fRarity').value, grade: $('fGrade').value, condition: $('fCondition').value, set: $('fSet').value, sort: $('fSort').value, search: $('fSearch').value, page });
    const grid = $('cardGrid');
    grid.innerHTML = '<div class="skel-tiles">' + Array.from({ length: 12 }, () => '<div class="skel"></div>').join('') + '</div>';
    $('pagination').innerHTML = '';
    fetch('/api/cards?' + q).then(r => { if (r.status === 403) location.href = '/login?next=/dashboard'; return r.json(); }).then(data => {
      $('countLabel').textContent = fmt(data.total) + (data.total === 1 ? ' card' : ' cards');
      lastCards = data.cards || [];
      if (!lastCards.length) {
        const filtered = [...filters, 'fSearch'].some(id => $(id).value && $(id).value !== 'all' && id !== 'fSort');
        grid.innerHTML = filtered ? '<div class="empty"><div class="big">🔍</div><h3>No cards match</h3><p>Try clearing a filter or two.</p><button class="btn btn-ghost btn-sm" id="emptyReset">Clear filters</button></div>'
          : '<div class="empty"><div class="big">📦</div><h3>Your binder is empty</h3><p>Open your first pack in Discord with <code class="cmd">/openpack</code>. It shows up here a few minutes later.</p></div>';
        $('emptyReset')?.addEventListener('click', reset);
        return;
      }
      grid.innerHTML = lastCards.map((c, i) => tile(c, { w: 240, noLink: true, attrs: `data-i="${i}" tabindex="0" role="button"`, meta: `${esc(rarLabel(c.rarity))}${c.set ? ' · ' + esc(c.set) : ''}`, foot: `${esc(c.condition || '')} · ${fmt(c.value)} coin${c.value === 1 ? '' : 's'}${c.copies > 1 ? ` · ×${c.copies}` : ''}` })).join('');
      holoInit(grid);
      grid.querySelectorAll('.tile').forEach((el, i) => { const open = () => openModal(+el.dataset.i); el.addEventListener('click', open); el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }); });
      renderPagination(data.totalPages || 1);
      if (scroll) $('toolbar').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(() => { grid.innerHTML = '<div class="empty"><div class="big">⚠️</div><h3>Couldn\'t load your cards</h3><p>Refresh to try again.</p></div>'; });
  }

  /* ── The card sheet ────────────────────────────────────────────────── */
  function openModal(i) {
    const c = lastCards[i]; if (!c) return;
    modalIndex = i;
    const ed = c.edition && c.edition.print === '1st' ? `🥇 1st Edition #${esc(c.edition.n)}${c.edition.wf ? ' · 🌍 World First' : ''}` : (c.edition && c.edition.print === 'unl' ? 'Unlimited' : '—');
    $('sheet').innerHTML = `
      <button class="close" aria-label="Close">×</button>
      <div class="big ${rar(c.rarity)}" data-holo-group data-tilt-max="14">${c.grade ? slabHtml(c, { w: 480, eager: true }) : holoCard(c, { w: 480, eager: true })}</div>
      <div class="body">
        <h2>${esc(c.name)}</h2>
        <div class="set">${esc(c.set || 'Unknown set')}${c.href ? ` · <a href="${esc(c.href)}">card page ›</a>` : ''}</div>
        <div class="tile-badges static">${badges(c)}</div>
        <div class="row"><span class="l">Rarity</span><span class="r ${rar(c.rarity)}"><span class="rtag">${esc(rarLabel(c.rarity))}</span></span></div>
        <div class="row"><span class="l">Condition</span><span class="r">${esc(c.condition || '—')}</span></div>
        <div class="row"><span class="l">Edition</span><span class="r">${ed}</span></div>
        ${c.shiny ? `<div class="row"><span class="l">Shiny</span><span class="r">✦ ${esc(c.shiny.style || '')}${c.shiny.name ? ' · ' + esc(c.shiny.name) : ''}${c.shiny.tier ? ' · ' + esc(c.shiny.tier) : ''}</span></div>` : ''}
        ${c.grade ? `<div class="row"><span class="l">Grade</span><span class="r">${esc(gradeTitle(c.grade, c.black))}${c.subgrades ? ` <small>· ${esc(c.subgrades.centering)} / ${esc(c.subgrades.corners)} / ${esc(c.subgrades.edges)} / ${esc(c.subgrades.surface)}</small>` : ''}</span></div><div class="row"><span class="l">Cert</span><span class="r mono">${esc(c.cert || '—')}${c.gradedAt ? ` <small>· ${esc(fmtDate(c.gradedAt))}</small>` : ''}</span></div>` : (c.gradeRequestedAt ? '<div class="row"><span class="l">Grade</span><span class="r">🧪 At the graders</span></div>' : '')}
        ${c.slab && c.slab.key ? `<div class="row"><span class="l">Case</span><span class="r"><i class="dot" style="background:${esc(c.slab.hex || '#888')}"></i> ${esc((c.slab.shade ? c.slab.shade + ' ' : '') + c.slab.key)}</span></div>` : ''}
        <div class="row"><span class="l">Est. value</span><span class="r">${fmt(c.value)} coins</span></div>
        <div class="row"><span class="l">Obtained</span><span class="r">${c.obtainedAt ? esc(fmtDate(c.obtainedAt)) : '—'}${c.copies > 1 ? ` <small>· you hold ${c.copies} copies</small>` : ''}</span></div>
        <div class="row"><span class="l">Code</span><span class="r mono">${esc(c.code)} <button class="tb-btn xs" data-copy="${esc(c.code)}">copy</button></span></div>
        <div class="hint">${c.grade ? `In Discord: <code class="cmd" data-copy="/card view code:${esc(c.code)}">/card view code:${esc(c.code)}</code> shows the slab.` : c.gradeRequestedAt ? 'Crack it open with <code class="cmd">/checkgrade</code> when the DM lands.' : `Send it to the desk: <code class="cmd" data-copy="/grade code:${esc(c.code)}">/grade code:${esc(c.code)}</code>`} · ${i + 1} of ${lastCards.length} on this page</div>
      </div>`;
    $('modal').classList.add('open'); document.body.style.overflow = 'hidden';
    holoInit($('sheet'));
    $('sheet').querySelector('.close').addEventListener('click', closeModal);
    $('mPrev').disabled = i === 0; $('mNext').disabled = i === lastCards.length - 1;
  }
  function closeModal() { $('modal').classList.remove('open'); document.body.style.overflow = ''; modalIndex = -1; }
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $('mPrev').addEventListener('click', () => openModal(modalIndex - 1));
  $('mNext').addEventListener('click', () => openModal(modalIndex + 1));
  document.addEventListener('keydown', e => {
    if (modalIndex < 0) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'ArrowLeft' && modalIndex > 0) openModal(modalIndex - 1);
    if (e.key === 'ArrowRight' && modalIndex < lastCards.length - 1) openModal(modalIndex + 1);
  });

  /* ── Wire up ───────────────────────────────────────────────────────── */
  function reset() { filters.forEach(id => $(id).selectedIndex = 0); $('fSearch').value = ''; load(1); }
  filters.forEach(id => $(id).addEventListener('change', () => load(1)));
  $('fSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => load(1), 350); });
  $('resetBtn').addEventListener('click', reset);
  document.addEventListener('keydown', e => { if (e.key === '/' && document.activeElement !== $('fSearch') && modalIndex < 0) { e.preventDefault(); $('fSearch').focus(); } });

  readState();
  loadSummary();
  load(page);
})();
