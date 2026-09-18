// lib/cache.js — a remote JSON file that stays warm. Memory cache, a TTL, a conditional GET
// (ETag → 304 means nothing is re-downloaded or re-parsed), a local copy as the cold-start
// fallback, and a background refresh that never blocks a request. Every feed the bot
// publishes to GitHub (inventory, news, catalog, help) rides this.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');

const CACHE_DIR = path.join(os.tmpdir(), 'pokebot-site');

/**
 * `local` is the cold-start fallback. With writeLocal (the default) it is also where refreshed copies
 * land — right for runtime files like user_inventory.json. For a committed snapshot (data/catalog.json,
 * data/help.json) pass writeLocal:false: refreshed copies go to the temp dir instead, and are read from
 * there first on the next boot, so the checked-in file is never overwritten by whatever the bot last published.
 */
function remoteJson({ name, url, ttl, local, validate = (d) => d != null, onUpdate = null, quiet404 = false, writeLocal = true }) {
  let data = null, fetchedAt = 0, etag = null, revision = 0, inflight = null, warned404 = false;
  const cacheFile = local && !writeLocal ? path.join(CACHE_DIR, path.basename(local)) : null;
  if (cacheFile) { try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {} }

  async function refresh() {
    if (!url) return;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const res = await axios.get(url, {
          params: { _: Date.now() },                       // cache-buster vs GitHub's CDN
          headers: { 'Cache-Control': 'no-cache', ...(etag ? { 'If-None-Match': etag } : {}) },
          timeout: 25000, responseType: 'text', transformResponse: [d => d],
          validateStatus: s => s === 200 || s === 304,
        });
        fetchedAt = Date.now();
        if (res.status === 304) return;                     // unchanged: keep what we have
        const parsed = JSON.parse(res.data);                // throws on HTML / bad JSON → caught
        if (!validate(parsed)) throw new Error('unexpected shape');
        data = parsed; etag = res.headers.etag || null; revision++;
        const dest = cacheFile || (writeLocal ? local : null);
        if (dest) fs.promises.writeFile(dest, res.data, 'utf8').catch(() => {});
        if (onUpdate) onUpdate(data);
        console.log(`✅ ${name} refreshed (${Math.round(res.data.length / 1024)} KB)`);
      } catch (err) {
        const status = err?.response?.status || '';
        if (status === 404 && quiet404) { if (!warned404) { warned404 = true; console.log(`ℹ️ ${name}: not published yet (404) — using the local copy`); } }
        else console.error(`${name} refresh failed:`, status, err.message);
        fetchedAt = Date.now() - ttl + 60 * 1000;           // try again in a minute, not on every request
      } finally { inflight = null; }
    })();
    return inflight;
  }

  /** Sync: the cache right now (refreshing in the background when stale), else the local copy. */
  function get() {
    if (Date.now() - fetchedAt > ttl) refresh();
    if (data) return data;
    for (const file of [cacheFile, local].filter(Boolean)) {   // the temp copy of the last refresh first, then the checked-in snapshot
      try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (!validate(d)) throw new Error('unexpected shape'); data = d; revision++; if (onUpdate) onUpdate(data); break; }
      catch (err) { if (fs.existsSync(file)) console.error(`Failed to read ${name} from ${file}:`, err.message); }
    }
    return data;
  }
  /** Replace the data by hand (demo mode, the /upload webhook). */
  function set(d) { data = d; revision++; fetchedAt = Date.now(); if (onUpdate) onUpdate(d); }

  return { get, set, refresh, revision: () => revision, fetchedAt: () => fetchedAt };
}

module.exports = { remoteJson };
