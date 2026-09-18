// lib/render.js — the tiny template renderer: {{> partial}}, {{VAR}} (escaped), {{{VAR}}} raw.
// Every page gets the same base vars (title, description, OG image, asset version, nav user).
'use strict';
const fs = require('fs');
const path = require('path');

const VIEWS = path.join(__dirname, '..', 'views');
const ASSET_V = Date.now().toString(36);   // cache-buster for css/js — changes on every deploy
const assetV = () => process.env.NODE_ENV === 'production' || !process.env.DEMO ? ASSET_V : Date.now().toString(36);   // dev: every request, so edits show up without a restart
const SITE = 'https://thepokebot.com';

const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const cache = new Map();
function read(name) {
  if (process.env.NODE_ENV !== 'production' || !cache.has(name)) cache.set(name, fs.readFileSync(path.join(VIEWS, name + '.html'), 'utf8'));
  return cache.get(name);
}

function render(view, vars = {}) {
  const base = {
    TITLE: 'Pokébot — the Pokémon card game for Discord',
    DESC: 'Rip packs, chase 1st Editions and shinies, grade your best pulls, trade and duel — a Pokémon-style card game that lives in Discord.',
    OG_IMAGE: `${SITE}/img/og.jpg`, OG_TYPE: 'website', ROBOTS: '',
    PATH: '/', YEAR: new Date().getFullYear(), V: assetV(), NAV_USER: '', SITE,
    INVITE_URL: vars.INVITE_URL || '',
  };
  const all = { ...base, ...vars };
  const expand = src => src
    .replace(/\{\{>\s*([\w/-]+)\s*\}\}/g, (_, p) => expand(read('partials/' + p)))
    .replace(/\{\{\{\s*(\w+)\s*\}\}\}/g, (_, k) => all[k] == null ? '' : String(all[k]))
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => escapeHtml(all[k]));
  const v = assetV();
  return expand(read(view)).replace(/\/(css|js)\/([\w.-]+)"/g, `/$1/$2?v=${v}"`);
}

module.exports = { render, escapeHtml, ASSET_V, SITE };
