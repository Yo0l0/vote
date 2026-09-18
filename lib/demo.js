// lib/demo.js — a synthetic inventory for local development (DEMO=1). Eighty made-up
// trainers with binders drawn from the real catalog and the bot's real odds, so every
// page can be built and photographed without a byte of player data leaving the server.
// The names are invented; nothing here is a real player.
'use strict';
const NAMES = ['Ash K.', 'Misty', 'Brock', 'Gary Oak', 'Leaf', 'Red', 'Blue', 'Ethan', 'Lyra', 'Silver', 'May', 'Brendan', 'Wally', 'Dawn', 'Lucas', 'Barry', 'Hilda', 'Hilbert', 'Cheren', 'Bianca',
  'Serena', 'Calem', 'Shauna', 'Elio', 'Selene', 'Hau', 'Gladion', 'Gloria', 'Victor', 'Hop', 'Marnie', 'Bede', 'Juliana', 'Florian', 'Nemona', 'Arven', 'Penny', 'Cynthia', 'Steven', 'Lance',
  'Wallace', 'Diantha', 'Leon', 'Geeta', 'Iono', 'Larry', 'Grusha', 'Raihan', 'Nessa', 'Bea', 'Allister', 'Opal', 'Gordie', 'Melony', 'Piers', 'Kabu', 'Milo', 'Sabrina', 'Erika', 'Koga',
  'Blaine', 'Giovanni', 'Lt. Surge', 'Whitney', 'Morty', 'Chuck', 'Jasmine', 'Pryce', 'Clair', 'Falkner', 'Bugsy', 'Roxanne', 'Brawly', 'Wattson', 'Flannery', 'Norman', 'Winona', 'Tate', 'Liza', 'Juan'];
const ODDS = [['common', 52], ['uncommon', 30], ['rare', 10], ['promo', 3], ['holo', 3.2], ['ultra', 1.3], ['sir', .5]];
const COND = [['Pristine', 0.05], ['Mint', 0.20], ['Near Mint', 0.60], ['Light Play', 0.85], ['Damaged', 1]];
const DAY = 86400000;

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function weighted(r, table) { const total = table.reduce((s, [, w]) => s + w, 0); let x = r() * total; for (const [k, w] of table) { x -= w; if (x <= 0) return k; } return table[0][0]; }
const roll = (r, table) => { const x = r(); for (const [k, p] of table) if (x <= p) return k; return table[table.length - 1][0]; };
const code = (r) => Array.from({ length: 6 }, () => '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(r() * 34)]).join('');

function subgrades(r, cond) {
  const lam = { pristine: 0.65, mint: 1.0, 'near mint': 1.5, 'light play': 3.5, damaged: 8 }[cond.toLowerCase()] || 2.2;
  const pois = (l) => { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; };
  const s = {}; for (const k of ['centering', 'corners', 'edges', 'surface']) s[k] = Math.max(1, 10 - 0.5 * pois(lam));
  const v = Object.values(s).sort((a, b) => a - b);
  let g = v[0]; if (v[1] > v[0] && (v[1] + v[2] + v[3]) / 3 >= v[0] + 0.5) g = v[0] + 0.5;
  return { subgrades: s, grade: Math.min(10, g) };
}

function inventory(catalog, { devUser = '000000000000000001', seed = 7, now = Date.now() } = {}) {
  const r = rng(seed);
  const sets = catalog.sets;
  const byRarity = {}; for (const s of sets) for (const c of s.cards) (byRarity[c.rarity] = byRarity[c.rarity] || []).push({ s, c });
  const serials = new Map(); let cert = 100000;
  const inv = {};
  const users = NAMES.map((name, i) => ({ uid: String(900000000000000000n + BigInt(i * 7919 + 13)), name }));
  users.unshift({ uid: devUser, name: 'You (demo)' });
  users.forEach((u, ui) => {
    const n = ui === 0 ? 260 : Math.max(3, Math.round(Math.exp(2.2 + r() * 3.6)));   // 9 … 330 cards, a long tail
    const cards = [];
    for (let i = 0; i < n; i++) {
      const rarity = weighted(r, ODDS);
      const pool = byRarity[rarity] || byRarity.common;
      const { s, c } = pick(r, pool);
      const fresh = ui >= users.length - 7;                       // the last seven demo trainers joined this week
      const age = Math.pow(r(), 1.8) * (fresh ? 5 : 60) * DAY;   // most pulls are recent
      const obtainedAt = Math.round(now - age);
      const condition = roll(r, COND);
      const card = { code: code(r), name: c.name, set: s.name, rarity: c.rarity === 'sir' ? 'SIR' : c.rarity, image: c.image, condition, obtainedAt };
      if (['holo', 'ultra', 'sir'].includes(c.rarity)) card.isHolo = true;
      if (s.releaseAt && obtainedAt >= s.releaseAt && obtainedAt < s.releaseAt + 7 * DAY) {
        const k = `${s.slug}/${c.slug}`; const serial = (serials.get(k) || 0) + 1; serials.set(k, serial);
        card.edition = { print: '1st', n: serial, ...(serial === 1 ? { wf: true } : {}) };
      } else if (s.releaseAt) card.edition = { print: 'unl' };
      if (r() < (ui === 0 ? 0.14 : 0.06)) { const g = subgrades(r, condition); Object.assign(card, g, { cert: `PB-${++cert}`, gradedAt: obtainedAt + Math.round(r() * 5 * DAY) });
        if (r() < 0.4) card.slab = pick(r, [{ key: 'obsidian', hex: '#111111', shade: null }, { key: 'peach', hex: '#FFB088', shade: 'Pale' }, { key: 'cobalt', hex: '#2F5BEA', shade: 'Deep' }, { key: 'mint', hex: '#7CE8B5', shade: null }]); }
      if (r() < 0.0004 || (ui === 0 && i === 42)) card.shiny = { seed: card.code, style: pick(r, ['Neon', 'Ghost', 'Midnight', 'Chrome', 'Void']), tier: pick(r, ['rare', 'epic', 'legendary']), n: 1 };
      cards.push(card);
    }
    inv[u.uid] = { name: u.name, cards };
  });
  return inv;
}

module.exports = { inventory };
