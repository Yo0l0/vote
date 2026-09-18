// lib/images.js — the card-art thumbnail proxy. A pikawiz scan is ~850 KB; a grid of
// twenty of them was 17 MB. /img/card?u=<url>&w=<px> fetches the original once, resizes
// it to webp with sharp (~20 KB at 320px), and keeps it in memory + the temp dir with
// far-future cache headers. Only the hosts the card pool uses are allowed. If anything
// fails the browser is sent to the original picture, so a card is never blank.
'use strict';
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

let sharp = null;
try { sharp = require('sharp'); } catch { console.warn('⚠️ sharp not installed — /img/card redirects to the originals'); }

const ALLOWED = new Set(['www.pikawiz.com', 'pikawiz.com', 'images.pokemontcg.io', 'images.scrydex.com', 'raw.githubusercontent.com', 'cdn.discordapp.com']);
const WIDTHS = new Set([96, 160, 240, 320, 480, 640]);
const MEM_LIMIT = Number(process.env.THUMB_MEM_MB || 96) * 1024 * 1024;
const DIR = path.join(os.tmpdir(), 'pokebot-thumbs');
try { fs.mkdirSync(DIR, { recursive: true }); } catch {}

const mem = new Map();        // key → Buffer (insertion order = LRU order)
let memBytes = 0;
const inflight = new Map();   // key → Promise<Buffer>

function remember(key, buf) {
  if (mem.has(key)) { memBytes -= mem.get(key).length; mem.delete(key); }
  mem.set(key, buf); memBytes += buf.length;
  while (memBytes > MEM_LIMIT && mem.size) { const [k, v] = mem.entries().next().value; mem.delete(k); memBytes -= v.length; }
}
function recall(key) {
  const buf = mem.get(key);
  if (buf) { mem.delete(key); mem.set(key, buf); }   // touch → most recent
  return buf || null;
}

function allowed(u) {
  try { const url = new URL(u); return (url.protocol === 'https:' || url.protocol === 'http:') && ALLOWED.has(url.hostname); }
  catch { return false; }
}
function normWidth(w) { w = Number(w) || 320; return WIDTHS.has(w) ? w : [...WIDTHS].reduce((a, b) => Math.abs(b - w) < Math.abs(a - w) ? b : a); }

async function fetchOriginal(u) {
  const res = await axios.get(u, { responseType: 'arraybuffer', timeout: 20000, maxContentLength: 12 * 1024 * 1024,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; thepokebot.com thumbnailer)', Accept: 'image/*' } });
  return Buffer.from(res.data);
}

async function thumbnail(u, w) {
  const key = crypto.createHash('sha1').update(`${u}|${w}`).digest('hex');
  const hit = recall(key);
  if (hit) return hit;
  const file = path.join(DIR, key + '.webp');
  try { const buf = await fs.promises.readFile(file); remember(key, buf); return buf; } catch {}
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const original = await fetchOriginal(u);
      const buf = await sharp(original).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      remember(key, buf);
      fs.promises.writeFile(file, buf).catch(() => {});
      return buf;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

/** Express handler for GET /img/card?u=…&w=… */
async function handler(req, res) {
  const u = String(req.query.u || '');
  if (!allowed(u)) return res.status(400).send('Bad image URL');
  const w = normWidth(req.query.w);
  if (!sharp) return res.redirect(302, u);
  try {
    const buf = await thumbnail(u, w);
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=2592000, immutable', 'Content-Length': buf.length });
    res.end(buf);
  } catch (err) {
    console.error('thumb failed:', err.message, u);
    res.redirect(302, u);   // a slow original beats a broken picture
  }
}

/** The URL a template uses for a thumbnail of `u`. */
const thumbUrl = (u, w = 320) => u ? `/img/card?u=${encodeURIComponent(u)}&w=${normWidth(w)}` : '';

function stats() { return { memItems: mem.size, memMB: Math.round(memBytes / 1048576 * 10) / 10, inflight: inflight.size, dir: DIR }; }

/** Pre-render thumbnails in the background, two at a time, so the first visitor after a restart isn't the one waiting on pikawiz. */
let warmQueue = [], warming = false;
function warm(urls, widths = [240]) {
  if (!sharp) return;
  for (const u of urls) if (allowed(u)) for (const w of widths) warmQueue.push([u, normWidth(w)]);
  if (warming) return;
  warming = true;
  (async () => {
    while (warmQueue.length) {
      const batch = warmQueue.splice(0, 2);
      await Promise.all(batch.map(([u, w]) => thumbnail(u, w).catch(() => {})));
    }
    warming = false;
  })();
}

module.exports = { handler, thumbUrl, stats, allowed, warm };
