// lib/cache.js — a remote JSON file that stays warm. Memory cache, a TTL, a conditional GET
// (ETag → 304 means nothing is re-downloaded or re-parsed), a local copy as the cold-start
// fallback, and a background refresh that never blocks a request. Every feed the bot
// publishes to GitHub (inventory, news, catalog, help) rides this.
'use strict';
const fs = require('fs');
const axios = require('axios');

function remoteJson({ name, url, ttl, local, validate = (d) => d != null, onUpdate = null, quiet404 = false }) {
  let data = null, fetchedAt = 0, etag = null, revision = 0, inflight = null, warned404 = false;

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
        if (local) fs.promises.writeFile(local, res.data, 'utf8').catch(() => {});
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
    if (local) {
      try { data = JSON.parse(fs.readFileSync(local, 'utf8')); revision++; if (onUpdate) onUpdate(data); }
      catch (err) { if (fs.existsSync(local)) console.error(`Failed to read local ${name}:`, err.message); }
    }
    return data;
  }
  /** Replace the data by hand (demo mode, the /upload webhook). */
  function set(d) { data = d; revision++; fetchedAt = Date.now(); if (onUpdate) onUpdate(d); }

  return { get, set, refresh, revision: () => revision, fetchedAt: () => fetchedAt };
}

module.exports = { remoteJson };
