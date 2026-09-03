/* Pokebot shared front-end helpers: nav, reveal, holo tilt, toast, utils */
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

  const menuBtn = document.querySelector('.menu-btn');
  const links   = document.getElementById('navlinks');
  if (menuBtn && links) {
    menuBtn.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    links.addEventListener('click', e => { if (e.target.tagName === 'A') links.classList.remove('open'); });
    document.addEventListener('click', e => { if (!links.contains(e.target) && !menuBtn.contains(e.target)) links.classList.remove('open'); });
  }
  const totop = document.querySelector('.totop');
  if (totop) totop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));

  // highlight the nav link whose section is on screen
  const sectionLinks = [...document.querySelectorAll('.links a[href^="#"]')];
  if (sectionLinks.length && 'IntersectionObserver' in window) {
    const map = new Map();
    sectionLinks.forEach(a => { const s = document.querySelector(a.getAttribute('href')); if (s) map.set(s, a); });
    const so = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { sectionLinks.forEach(a => a.classList.remove('active')); map.get(en.target)?.classList.add('active'); } });
    }, { rootMargin: '-40% 0px -55% 0px' });
    map.forEach((_, s) => so.observe(s));
  }

  /* ── Reveal on scroll (safe: everything shows if IO is missing) ────── */
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.08, rootMargin: '0px 0px -5% 0px' });
    reveals.forEach(el => io.observe(el));
    // belt and braces: anything still hidden after 2.5s gets shown
    setTimeout(() => reveals.forEach(el => el.classList.add('in')), 2500);
  } else {
    reveals.forEach(el => el.classList.add('in'));
  }

  /* ── Holographic tilt ──────────────────────────────────────────────── */
  // Attach to any .holo-card (or a container with data-holo-group whose
  // children tilt together). Pointer position drives rotate + glare + foil.
  function holoInit(root) {
    root = root || document;
    const cards = root.querySelectorAll('.holo-card:not([data-holo])');
    cards.forEach(card => {
      card.dataset.holo = '1';
      const img = card.querySelector('img');
      if (img) {
        const done = () => img.classList.add('loaded');
        if (img.complete && img.naturalWidth) done(); else { img.addEventListener('load', done); img.addEventListener('error', done); }
      }
      if (!finePointer || reduceMotion) return;
      const group = card.closest('[data-holo-group]');
      const target = group || card;
      if (group && group.dataset.bound) return;
      if (group) group.dataset.bound = '1';
      const all = group ? group.querySelectorAll('.holo-card') : [card];
      const max = Number(target.dataset.tiltMax || 14);
      let raf = 0, lx = 0, ly = 0;
      const apply = () => {
        raf = 0;
        all.forEach(c => {
          c.style.setProperty('--rx', (-ly * max).toFixed(2) + 'deg');
          c.style.setProperty('--ry', (lx * max).toFixed(2) + 'deg');
          c.style.setProperty('--mx', (50 + lx * 50).toFixed(1) + '%');
          c.style.setProperty('--my', (50 + ly * 50).toFixed(1) + '%');
        });
      };
      target.addEventListener('pointerenter', () => all.forEach(c => c.classList.add('active', 'tilting')));
      target.addEventListener('pointermove', e => {
        const r = target.getBoundingClientRect();
        lx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
        ly = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
        if (!raf) raf = requestAnimationFrame(apply);
      });
      target.addEventListener('pointerleave', () => {
        all.forEach(c => { c.classList.remove('active', 'tilting'); ['--rx','--ry'].forEach(p => c.style.setProperty(p, '0deg')); c.style.setProperty('--mx', '50%'); c.style.setProperty('--my', '50%'); });
      });
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
  window.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
  window.fmt = n => (Number(n) || 0).toLocaleString('en-US');
  window.timeAgo = ms => {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  window.animateNum = function (el, target, dur) {
    target = Number(target) || 0; dur = dur || 1100;
    const from = Number(String(el.textContent).replace(/[^0-9.-]/g, '')) || 0;
    if (reduceMotion || from === target) { el.textContent = fmt(target); return; }
    const t0 = performance.now();
    const step = t => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(from + (target - from) * e));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  window.copyText = async function (text) {
    try { await navigator.clipboard.writeText(text); toast('Copied ' + text); }
    catch { toast('Press Ctrl+C to copy'); }
  };
})();
