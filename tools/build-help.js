#!/usr/bin/env node
// tools/build-help.js — the commands page is generated from the bot's own /help table
// (src/commands/meta.js `HELP`), so the site can't drift from the bot again.
//   BOT_DIR=../pokebot-app node tools/build-help.js  →  data/help.json
'use strict';
const fs = require('fs');
const path = require('path');

const BOT_DIR = path.resolve(process.env.BOT_DIR || path.join(__dirname, '..', '..', 'pokebot-app'));
const src = fs.readFileSync(path.join(BOT_DIR, 'src', 'commands', 'meta.js'), 'utf8');
const m = src.match(/const HELP = (\{[\s\S]*?\n\});/);
if (!m) { console.error('HELP table not found in meta.js'); process.exit(1); }
const HELP = new Function(`return ${m[1]}`)();   // a plain object literal of strings — nothing else runs

const groups = Object.entries(HELP).map(([id, [title, entries]]) => ({
  id, emoji: title.split(' ')[0], title: title.replace(/^\S+ /, ''),
  commands: entries.map(([cmd, desc]) => ({ cmd, desc })),
}));
const out = { generatedAt: Date.now(), groups };
const OUT = path.join(__dirname, '..', 'data', 'help.json');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`help: ${groups.length} groups · ${groups.reduce((n, g) => n + g.commands.length, 0)} entries → ${path.relative(process.cwd(), OUT)}`);
