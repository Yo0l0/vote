/* Pokebot dashboard: summary, breakdown, filtered card grid, modal */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const HOLO = ['holo', 'sir', 'mythical'];
  const RANK = ['common', 'uncommon', 'rare', 'promo', 'holo', 'sir', 'mythical'];
  const rar = r => 'rar-' + String(r || 'common').toLowerCase();
  const rarLabel = r => { r = String(r || 'common'); return r.toLowerCase() === 'sir' ? 'SIR' : r.charAt(0).toUpperCase() + r.slice(1).toLowerCase(); };
  const holoCard = c => `<div class="holo-card ${HOLO.includes(String(c.rarity || '').toLowerCase()) ? 'is-holo' : ''}"><img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy" decoding="async"><div class="sk"></div><div class="foil"></div><div class="glare"></div></div>`;

  let page = 1, searchTimer, lastCards = [], modalIndex = -1, totalPages = 1;
  const filters = ['fRarity', 'fSet', 'fGrade', 'fCondition', 'fSort'];

  /* ── URL state (filters survive refresh / can be shared) ───────────── */
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

  /* ── Summary + breakdown ───────────────────────────────────────────── */
  async function loadSummary() {
    try {
      const d = await (await fetch('/api/summary', { cache: 'no-store' })).json();
      $('sTotal').textContent = fmt(d.total);
      $('sUnique').textContent = d.unique ? fmt(d.unique) + ' unique cards' : '';
      $('sSets').textContent = fmt(d.sets);
      $('sSetsSub').textContent = d.bySet && d.bySet[0] ? 'Most: ' + d.bySet[0].name : '';
      $('sGraded').textContent = fmt(d.graded);
      $('sGradedSub').textContent = d.total ? Math.round((d.graded / d.total) * 100) + '% of collection' : '';
      $('sTop').textContent = d.topGrade ? d.topGrade + '/10' : '—';
      $('sTopSub').textContent = d.tens ? d.tens + ' perfect 10' + (d.tens > 1 ? 's' : '') : (d.graded ? 'No 10s yet' : 'Nothing graded yet');
      const r = d.rarest;
      $('sRarest').innerHTML = r
        ? `${holoCard(r)}<div><div class="k">Rarest pull</div><div class="nm">${esc(r.name)}</div><div class="rb">${esc(rarLabel(r.rarity))}${r.set ? ' · ' + esc(r.set) : ''}${r.grade ? ' · PSA ' + esc(r.grade) : ''}</div></div>`
        : '<div><div class="k">Rarest pull</div><div class="nm">No cards yet</div><div class="rb">Open a pack in Discord</div></div>';
      holoInit($('sRarest'));

      // rarity bar
      const by = d.byRarity || {};
      const total = Object.values(by).reduce((a, b) => a + b, 0) || 1;
      const order = [...RANK].reverse().filter(k => by[k]);
      $('rarityBar').innerHTML = order.map(k => `<i class="${rar(k)}" data-w="${(by[k] / total * 100).toFixed(2)}" title="${rarLabel(k)}: ${fmt(by[k])}"></i>`).join('');
      $('rarityLegend').innerHTML = order.map(k => `<span class="${rar(k)}"><span class="rdot"></span>${rarLabel(k)} <b>${fmt(by[k])}</b> · ${Math.round(by[k] / total * 100)}%</span>`).join('');
      requestAnimationFrame(() => $('rarityBar').querySelectorAll('i').forEach(i => i.style.width = i.dataset.w + '%'));
      const shiny = (by.holo || 0) + (by.sir || 0) + (by.mythical || 0);
      $('bdNote').textContent = shiny ? `${fmt(shiny)} shiny (${(shiny / total * 100).toFixed(1)}%)` : '';

      // sets
      const sets = d.bySet || [];
      const max = Math.max(1, ...sets.map(s => s.count));
      $('setList').innerHTML = sets.length ? sets.map(s => `<div class="setrow"><span>${esc(s.name)}</span><span class="cnt"><b>${fmt(s.unique)}</b> · ${fmt(s.count)}</span><div class="bar"><i data-w="${(s.count / max * 100).toFixed(1)}"></i></div></div>`).join('') : '<div class="bd-note">No sets yet.</div>';
      requestAnimationFrame(() => $('setList').querySelectorAll('i').forEach(i => i.style.width = i.dataset.w + '%'));
      const sel = $('fSet'), cur = sel.value;
      sel.innerHTML = '<option value="all">All sets</option>' + sets.map(s => `<option value="${esc(s.name)}">${esc(s.name)} (${fmt(s.count)})</option>`).join('');
      sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'all';
    } catch (e) { console.error('Summary failed:', e); }
  }

  /* ── Grid ──────────────────────────────────────────────────────────── */
  function pageButtons(total) {
    if (total <= 1) return [];
    const out = new Set([1, total, page, page - 1, page + 1]);
    if (page <= 3) { out.add(2); out.add(3); }
    if (page >= total - 2) { out.add(total - 1); out.add(total - 2); }
    const nums = [...out].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
    const seq = [];
    nums.forEach((n, i) => { if (i && n - nums[i - 1] > 1) seq.push('…'); seq.push(n); });
    return seq;
  }
  function renderPagination(total) {
    const pag = $('pagination'); pag.innerHTML = '';
    if (total <= 1) return;
    const mk = (label, p, o = {}) => {
      const b = document.createElement('button');
      b.className = 'pg' + (o.active ? ' active' : '') + (o.dots ? ' dots' : '');
      b.textContent = label; b.disabled = !!(o.dots || o.disabled);
      if (!b.disabled) b.onclick = () => load(p, true);
      pag.appendChild(b);
    };
    mk('‹', page - 1, { disabled: page === 1 });
    pageButtons(total).forEach(n => n === '…' ? mk('…', 0, { dots: true }) : mk(n, n, { active: n === page }));
    mk('›', page + 1, { disabled: page === total });
  }

  function skeletons() {
    return Array.from({ length: 12 }, () => '<div><div class="skel sk-card"></div><div class="skel sk-line"></div></div>').join('');
  }

  function load(p, scroll) {
    page = p || 1;
    writeState();
    const q = new URLSearchParams({
      rarity: $('fRarity').value, grade: $('fGrade').value, condition: $('fCondition').value,
      set: $('fSet').value, sort: $('fSort').value, search: $('fSearch').value, page
    });
    const grid = $('cardGrid');
    grid.innerHTML = skeletons();
    $('pagination').innerHTML = '';
    fetch('/api/cards?' + q).then(r => { if (r.status === 403) location.href = '/login'; return r.json(); }).then(data => {
      totalPages = data.totalPages || 1;
      $('countLabel').textContent = fmt(data.total) + (data.total === 1 ? ' card' : ' cards');
      lastCards = data.cards || [];
      if (!lastCards.length) {
        const filtered = [...filters, 'fSearch'].some(id => $(id).value && $(id).value !== 'all' && !(id === 'fSort'));
        grid.innerHTML = filtered
          ? '<div class="empty"><div class="big">🔍</div><h3>No cards match</h3><p>Try clearing a filter or two.</p><button class="btn btn-ghost btn-sm" id="emptyReset">Clear filters</button></div>'
          : '<div class="empty"><div class="big">📦</div><h3>Your binder is empty</h3><p>Open your first pack in Discord with <code class="cmd">/openpack</code> — it shows up here a few minutes later.</p><a class="btn btn-primary btn-sm" href="https://discord.gg/zj9Sxz3reR" target="_blank" rel="noopener">Go to Discord</a></div>';
        $('emptyReset')?.addEventListener('click', reset);
        return;
      }
      grid.innerHTML = lastCards.map((c, i) => {
        const cond = c.condition ? String(c.condition) : '';
        return `<div class="card ${rar(c.rarity)}" data-i="${i}" tabindex="0" role="button" aria-label="${esc(c.name)}">
          ${holoCard(c)}
          ${c.grade ? `<span class="grade-badge ${Number(c.grade) === 10 ? 'ten' : ''}">PSA ${esc(c.grade)}</span>` : ''}
          ${cond ? `<span class="cond ${cond.toLowerCase() === 'pristine' ? 'pristine' : ''}">${esc(cond)}</span>` : ''}
          <div class="card-info">
            <div class="card-name">${esc(c.name)}</div>
            <div class="card-meta"><span class="rdot"></span>${esc(rarLabel(c.rarity))}${c.set ? ' · ' + esc(c.set) : ''}</div>
            <div class="card-code">${esc(c.code)}</div>
          </div></div>`;
      }).join('');
      holoInit(grid);
      grid.querySelectorAll('.card').forEach((el, i) => {
        const open = () => openModal(+el.dataset.i);
        el.addEventListener('click', open);
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
        setTimeout(() => el.classList.add('in'), Math.min(i * 25, 450));
      });
      renderPagination(totalPages);
      if (scroll) $('toolbar').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(() => { grid.innerHTML = '<div class="empty"><div class="big">⚠️</div><h3>Couldn\'t load your cards</h3><p>Refresh to try again.</p></div>'; });
  }

  /* ── Modal ─────────────────────────────────────────────────────────── */
  function openModal(i) {
    const c = lastCards[i]; if (!c) return;
    modalIndex = i;
    const ten = Number(c.grade) === 10;
    $('sheet').innerHTML = `
      <button class="close" aria-label="Close">×</button>
      <div class="big ${rar(c.rarity)}" data-holo-group data-tilt-max="16">${holoCard(c)}</div>
      <div class="body">
        <h2>${esc(c.name)}</h2>
        <div class="set">${esc(c.set || 'Unknown set')}</div>
        <div class="row"><span class="l">Rarity</span><span class="r ${rar(c.rarity)}"><span class="rtag">${esc(rarLabel(c.rarity))}</span></span></div>
        <div class="row"><span class="l">Condition</span><span class="r">${esc(c.condition || '—')}</span></div>
        <div class="row"><span class="l">Type</span><span class="r">${esc(c.type || '—')}</span></div>
        <div class="row"><span class="l">Obtained</span><span class="r">${c.obtainedAt ? esc(new Date(Number(c.obtainedAt) || c.obtainedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })) : '—'}</span></div>
        <div class="row"><span class="l">Code</span><span class="r mono">${esc(c.code)} <button class="tb-btn" style="height:26px;padding:0 8px;margin-left:6px;font-size:.72rem" data-copy="${esc(c.code)}">copy</button></span></div>
        ${c.grade ? `<div class="slab ${ten ? 'ten' : ''}">${ten ? '💎' : '⭐'} PSA ${esc(c.grade)} / 10</div>` : (c.gradeRequestedAt ? '<div class="slab">🧪 At the grading lab</div>' : '')}
        <div class="hint">${c.grade ? 'Graded cards sell for more on <code>/shop</code>.' : 'Send it to the lab with <code>/grade ' + esc(c.code) + '</code>'} · ${i + 1} of ${lastCards.length} on this page</div>
      </div>`;
    $('modal').classList.add('open');
    document.body.style.overflow = 'hidden';
    holoInit($('sheet'));
    $('sheet').querySelector('.close').addEventListener('click', closeModal);
    $('sheet').querySelector('[data-copy]').addEventListener('click', e => copyText(e.currentTarget.dataset.copy));
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
