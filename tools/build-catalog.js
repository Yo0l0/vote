#!/usr/bin/env node
// tools/build-catalog.js — the card database the site browses, built from the bot's own
// card pool and release gate so the site can never show a set before the bot does.
//
//   BOT_DIR=../pokebot-app node tools/build-catalog.js
//
// Reads (from the bot folder): CardImages.js (the classic hand-made sets — always out
// unless the schedule says otherwise), sets/*.json (the catalogue, out only when
// upcoming.json schedules a past date — exactly core/release.js), upcoming.json.
// Writes data/catalog.json: released sets with every card, and the upcoming schedule
// with names, dates and sizes only (no card lists — those would be spoilers).
// The bot is meant to publish the same file to the ssss repo; this is the offline build.
'use strict';
const fs = require('fs');
const path = require('path');

const BOT_DIR = path.resolve(process.env.BOT_DIR || path.join(__dirname, '..', '..', 'pokebot-app'));
const OUT = path.join(__dirname, '..', 'data', 'catalog.json');
const now = Date.now();

const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const VALID = new Set(['common', 'uncommon', 'rare', 'promo', 'holo', 'ultra', 'sir']);
const rarityOf = (r) => { const k = String(r || 'common').toLowerCase(); return VALID.has(k) ? k : 'common'; };

// ── schedule (same parse as core/release.js) ─────────────────
const schedule = new Map();
try {
  for (const u of JSON.parse(fs.readFileSync(path.join(BOT_DIR, 'upcoming.json'), 'utf8'))) {
    if (u && u.name != null) schedule.set(u.name, { at: new Date(u.releaseDate).getTime(), notes: u.notes || null });
  }
} catch (e) { console.error('upcoming.json unreadable:', e.message); process.exit(1); }

// ── classic sets (CardImages.js) ─────────────────────────────
const classic = require(path.join(BOT_DIR, 'CardImages.js'));
const classicSets = new Map();
classic.forEach((c, i) => {
  if (!c?.name || !c?.set) return;
  const s = classicSets.get(c.set) || { name: c.set, slug: slugify(c.set), source: 'classic', series: 'Classic', originalRelease: null, cards: [] };
  const n = s.cards.length + 1;
  s.cards.push({ n, slug: `${n}-${slugify(c.name)}`, name: c.name, rarity: rarityOf(c.rarity), type: c.type || 'pokemon', image: c.image });
  classicSets.set(c.set, s);
});

// ── catalogue sets (sets/*.json) ─────────────────────────────
const catalogueSets = [];
const setsDir = path.join(BOT_DIR, 'sets');
for (const file of fs.readdirSync(setsDir).filter(f => f.endsWith('.json')).sort()) {
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(setsDir, file), 'utf8')); } catch { continue; }
  if (!data?.set || !data?.slug || !Array.isArray(data.cards)) continue;
  const cards = [];
  for (const c of data.cards) {
    if (!c?.name || !Number.isFinite(c?.n)) continue;   // cardpool.js skips these too
    cards.push({ n: c.n, slug: String(c.n), name: String(c.name), rarity: rarityOf(c.rarity), type: 'pokemon',
      image: c.image || `https://www.pikawiz.com/images/${data.slug}/${c.n}.png` });
  }
  if (!cards.length) continue;
  catalogueSets.push({ name: data.set, slug: slugify(data.set), pikawiz: data.slug, source: 'catalogue', series: data.series || null,
    originalRelease: data.originalRelease || null, notes: data.notes || null, cards });
}

// ── the release rule ─────────────────────────────────────────
function isReleased(set) {
  const s = schedule.get(set.name);
  if (s) return Number.isFinite(s.at) && now >= s.at;
  return set.source === 'classic';   // a catalogue set nobody scheduled isn't out
}

const all = [...classicSets.values(), ...catalogueSets];
const released = [], upcoming = [];
for (const set of all) {
  const s = schedule.get(set.name);
  const releaseAt = s && Number.isFinite(s.at) ? s.at : null;
  if (isReleased(set)) {
    released.push({ name: set.name, slug: set.slug, source: set.source, series: set.series, originalRelease: set.originalRelease,
      releaseAt, notes: set.notes || (s && s.notes) || null, total: set.cards.length, cards: set.cards });
  } else if (releaseAt) {
    upcoming.push({ name: set.name, slug: set.slug, series: set.series, originalRelease: set.originalRelease, releaseAt, notes: (s && s.notes) || set.notes || null, total: set.cards.length });
  }
}
// newest release first; classic sets (no date) keep their original print order at the end
released.sort((a, b) => (b.releaseAt || 0) - (a.releaseAt || 0));
upcoming.sort((a, b) => a.releaseAt - b.releaseAt);

// duplicate slugs would break URLs — make sure there are none
const seen = new Set();
for (const s of released) { if (seen.has(s.slug)) throw new Error(`duplicate set slug ${s.slug}`); seen.add(s.slug); }

const out = { generatedAt: now, sets: released, upcoming };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
const cards = released.reduce((n, s) => n + s.cards.length, 0);
console.log(`catalog: ${released.length} released sets · ${cards} cards · ${upcoming.length} upcoming (next: ${upcoming[0] ? `${upcoming[0].name} ${new Date(upcoming[0].releaseAt).toISOString().slice(0, 10)}` : '—'}) → ${path.relative(process.cwd(), OUT)} (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);
