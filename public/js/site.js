/* Pokébot shared front-end: nav, reveal, holo tilt, toast, utils, and the card components every page uses */
(function () {
  'use strict';
  document.documentElement.classList.add('js');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer  = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ── Nav: scrolled state, mobile menu, active link ─────────────────── */
  const nav = document.querySelector('.nav');
  const onScroll = () => {
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 10);
    const tt = document.querySelector('.totop');
    if (tt) tt.classList.toggle('show', window.scrollY > 600);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  document.querySelectorAll('.links a[data-nav]').forEach(a => { if (location.pathname === a.dataset.nav || location.pathname.startsWith(a.dataset.nav + '/') || (a.dataset.nav === '/cards' && location.pathname.startsWith('/sets/'))) a.classList.add('active'); });

  const menuBtn = document.querySelector('.menu-btn');
  const links   = document.getElementById('navlinks');
  if (menuBtn && links) {
    menuBtn.addEventListener('click', () => { const open = links.classList.toggle('open'); menuBtn.setAttribute('aria-expanded', String(open)); });
    links.addEventListener('click', e => { if (e.target.tagName === 'A') links.classList.remove('open'); });
    document.addEventListener('click', e => { if (!links.contains(e.target) && !menuBtn.contains(e.target)) links.classList.remove('open'); });
  }
  const totop = document.querySelector('.totop');
  if (totop) totop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));

  /* ── Reveal on scroll (safe: everything shows if IO is missing) ────── */
  function revealInit(root) {
    const reveals = (root || document).querySelectorAll('.reveal:not(.in)');
    if ('IntersectionObserver' in window && !reduceMotion) {
      const io = new IntersectionObserver(entries => { entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }); }, { threshold: 0.08, rootMargin: '0px 0px -5% 0px' });
      reveals.forEach(el => io.observe(el));
      setTimeout(() => reveals.forEach(el => el.classList.add('in')), 2500);
    } else reveals.forEach(el => el.classList.add('in'));
  }
  window.revealInit = revealInit;
  revealInit();

  /* ── Holographic tilt ──────────────────────────────────────────────── */
  function holoInit(root) {
    root = root || document;
    root.querySelectorAll('.holo-card:not([data-holo])').forEach(card => {
      card.dataset.holo = '1';
      const img = card.querySelector('img');
      if (img) { const done = () => img.classList.add('loaded'); if (img.complete && img.naturalWidth) done(); else { img.addEventListener('load', done); img.addEventListener('error', done); } }
      if (!finePointer || reduceMotion) return;
      const group = card.closest('[data-holo-group]');
      const target = group || card;
      if (group && group.dataset.bound) return;
      if (group) group.dataset.bound = '1';
      const all = group ? group.querySelectorAll('.holo-card') : [card];
      const max = Number(target.dataset.tiltMax || 14);
      let raf = 0, lx = 0, ly = 0;
      const apply = () => { raf = 0; all.forEach(c => { c.style.setProperty('--rx', (-ly * max).toFixed(2) + 'deg'); c.style.setProperty('--ry', (lx * max).toFixed(2) + 'deg'); c.style.setProperty('--mx', (50 + lx * 50).toFixed(1) + '%'); c.style.setProperty('--my', (50 + ly * 50).toFixed(1) + '%'); }); };
      target.addEventListener('pointerenter', () => all.forEach(c => c.classList.add('active', 'tilting')));
      target.addEventListener('pointermove', e => { const r = target.getBoundingClientRect(); lx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2)); ly = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2)); if (!raf) raf = requestAnimationFrame(apply); });
      target.addEventListener('pointerleave', () => { all.forEach(c => { c.classList.remove('active', 'tilting'); ['--rx', '--ry'].forEach(p => c.style.setProperty(p, '0deg')); c.style.setProperty('--mx', '50%'); c.style.setProperty('--my', '50%'); }); });
    });
  }
  window.holoInit = holoInit;
  holoInit();

  /* ── Toast ─────────────────────────────────────────────────────────── */
  let toastEl, toastTimer;
  window.toast = function (msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  };

  /* ── Utils ─────────────────────────────────────────────────────────── */
  const esc = window.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmt = window.fmt = n => (Number(n) || 0).toLocaleString('en-US');
  window.timeAgo = ms => {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  window.fmtDate = ms => ms ? new Date(Number(ms) || ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  window.animateNum = function (el, target, dur) {
    target = Number(target) || 0; dur = dur || 1100;
    const from = Number(String(el.textContent).replace(/[^0-9.-]/g, '')) || 0;
    if (reduceMotion || from === target) { el.textContent = fmt(target); return; }
    const t0 = performance.now();
    const step = t => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(Math.round(from + (target - from) * e)); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  window.copyText = async function (text) { try { await navigator.clipboard.writeText(text); toast('Copied ' + text); } catch { toast('Press Ctrl+C to copy'); } };
  document.addEventListener('click', e => { const b = e.target.closest('[data-copy]'); if (b) { e.preventDefault(); copyText(b.dataset.copy); } });

  /* ── Card components (shared by home, database, profiles, dashboard) ── */
  const HOLO = ['holo', 'ultra', 'sir', 'mythical'];
  const rar = window.rar = r => 'rar-' + String(r || 'common').toLowerCase();
  window.rarLabel = r => { r = String(r || 'common'); const k = r.toLowerCase(); return k === 'sir' ? 'SIR' : k === 'ultra' ? 'Ultra Rare' : r.charAt(0).toUpperCase() + k.slice(1); };
  window.thumb = (u, w) => u ? '/img/card?u=' + encodeURIComponent(u) + '&w=' + (w || 320) : '';
  window.gradeTitle = (g, black) => { g = Number(g); if (!g) return ''; if (g >= 10) return black ? 'Pristine 10 · Black Label' : 'Gem Mint 10'; if (g >= 9.5) return 'Gem Mint 9.5'; if (g >= 9) return 'Mint 9'; if (g >= 8.5) return 'NM-MT+ 8.5'; if (g >= 8) return 'NM-MT 8'; if (g >= 7) return 'Near Mint ' + g; if (g >= 5) return 'Excellent ' + g; return 'Grade ' + g; };
  const gradeClass = g => { g = Number(g); return g >= 10 ? 'ten' : g >= 9.5 ? 'nine5' : g >= 9 ? 'nine' : ''; };
  /** The picture: a tilting holo card, shiny recolour, with the thumbnail proxy. */
  window.holoCard = (c, opts) => {
    opts = opts || {};
    const w = opts.w || 320;
    const shiny = c.shiny ? ' shiny-' + String(c.shiny.style || c.shiny || 'neon').toLowerCase().replace(/[^a-z]/g, '') : '';
    return `<div class="holo-card ${HOLO.includes(String(c.rarity || '').toLowerCase()) || c.isHolo ? 'is-holo' : ''}${shiny} ${opts.cls || ''}"><img src="${esc(thumb(c.image, w))}" alt="${esc(c.name)}" loading="${opts.eager ? 'eager' : 'lazy'}" decoding="async"><div class="sk"></div><div class="foil"></div><div class="glare"></div>${c.shiny ? '<div class="sparkles"></div>' : ''}</div>`;
  };
  /** The little truths on a card: grade, 1st Edition serial, World First, shiny, condition. */
  window.badges = (c) => {
    const out = [];
    if (c.grade) out.push(`<span class="bdg b-grade ${gradeClass(c.grade)}${c.black ? ' black' : ''}" title="${esc(gradeTitle(c.grade, c.black))}">${c.black ? '🖤 ' : ''}${esc(c.grade)}</span>`);
    else if (c.atGraders || (c.gradeRequestedAt && !c.grade)) out.push('<span class="bdg b-lab">🧪 at the graders</span>');
    if (c.wf || (c.edition && c.edition.wf)) out.push('<span class="bdg b-wf">🌍 World First</span>');
    else if (c.first || (c.edition && c.edition.print === '1st')) out.push(`<span class="bdg b-first">🥇 1st Ed${c.edition && c.edition.n ? ' #' + esc(c.edition.n) : ''}</span>`);
    if (c.shiny) out.push(`<span class="bdg b-shiny">✦ ${esc(c.shiny.style || 'Shiny')}</span>`);
    if (c.locked) out.push('<span class="bdg b-lock">🔒</span>');
    return out.join('');
  };
  /** A grid tile: picture + name + meta, linking to the card's page when it has one. */
  window.tile = (c, opts) => {
    opts = opts || {};
    const tag = c.href && !opts.noLink ? 'a' : 'div';
    const meta = opts.meta != null ? opts.meta : `${rarLabel(c.rarity)}${c.set ? ' · ' + esc(c.set) : ''}`;
    return `<${tag} class="tile ${rar(c.rarity)} ${opts.cls || ''}" ${tag === 'a' ? `href="${esc(c.href)}"` : ''} ${opts.attrs || ''}>${holoCard(c, opts)}<div class="tile-badges">${badges(c)}${opts.extraBadges || ''}</div><div class="tile-name">${esc(c.name)}</div><div class="tile-meta"><span class="rdot"></span>${meta}</div>${opts.foot ? `<div class="tile-foot">${opts.foot}</div>` : ''}</${tag}>`;
  };
  /** A slab: the card in a case with the Grading Co. label — sub-grades, cert, case colour. */
  window.slabHtml = (c, opts) => {
    opts = opts || {};
    const g = Number(c.grade) || 0, black = !!c.black, s = c.subgrades || null;
    const caseHex = c.slab && c.slab.hex ? c.slab.hex : null, labelHex = c.label && c.label.hex ? c.label.hex : null;
    const label = g >= 10 ? (black ? 'BLACK LABEL' : 'GEM MINT') : g >= 9 ? 'MINT' : g >= 8 ? 'NM-MT' : g >= 7 ? 'NEAR MINT' : 'GRADED';
    const first = c.edition && c.edition.print === '1st' ? `<div class="sl-first">1ST EDITION${c.edition.n ? ' #' + esc(c.edition.n) : ''}${c.edition.wf ? ' · WORLD FIRST' : ''}</div>` : '';
    return `<div class="slab ${opts.cls || ''} ${black ? 'black' : ''}" style="${caseHex ? `--case:${esc(caseHex)};` : ''}${labelHex ? `--label:${esc(labelHex)};` : ''}">
      <div class="slab-label"><div class="sl-co">Pokébot Grading Co.</div><div class="sl-name">${esc(c.name)} <span>· ${esc(c.set || '')}${c.rarity ? ' · ' + esc(rarLabel(c.rarity)) : ''}</span></div>${first}<div class="sl-grade"><b>${esc(String(g).replace(/\.0$/, ''))}</b><i>${label}</i></div>${s ? `<div class="sl-subs"><span>CEN ${esc(s.centering)}</span><span>COR ${esc(s.corners)}</span><span>EDG ${esc(s.edges)}</span><span>SUR ${esc(s.surface)}</span></div>` : ''}<div class="sl-cert">${c.cert ? esc(c.cert) : 'PB-······'}${opts.pop != null ? ' · POP ' + esc(opts.pop) : ''}</div></div>
      ${holoCard(c, { w: opts.w || 480, eager: opts.eager })}
    </div>`;
  };
  /** An inline SVG sparkline. */
  window.sparkline = (values, w, h) => {
    w = w || 120; h = h || 28;
    const max = Math.max(1, ...values), n = values.length;
    const pts = values.map((v, i) => [(i / (n - 1)) * w, h - (v / max) * (h - 3) - 1]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d} L${w} ${h} L0 ${h} Z" class="sp-fill"/><path d="${d}" class="sp-line"/></svg>`;
  };
  /** A live countdown into four <b> cells. */
  window.countdown = (el, at) => {
    const cells = el.querySelectorAll('b');
    const tick = () => {
      let s = Math.max(0, Math.floor((at - Date.now()) / 1000));
      const d = Math.floor(s / 86400); s -= d * 86400; const h = Math.floor(s / 3600); s -= h * 3600; const m = Math.floor(s / 60); s -= m * 60;
      [d, h, m, s].forEach((v, i) => { if (cells[i]) cells[i].textContent = i ? String(v).padStart(2, '0') : String(v); });
    };
    tick(); setInterval(tick, 1000);
  };
})();
