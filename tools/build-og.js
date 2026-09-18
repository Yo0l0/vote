#!/usr/bin/env node
// tools/build-og.js — the 1200×630 JPEG a link to thepokebot.com unfurls with (Discord, X, iMessage).
// Three real cards from the pool over the site's night-violet, with the tagline. Needs the site
// running locally for the thumbnails (node tools/dev.js), or SITE_ORIGIN pointing at it.
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ORIGIN = process.env.SITE_ORIGIN || 'http://localhost:3000';
const CARDS = ['https://www.pikawiz.com/images/baseset/4.png', 'https://www.pikawiz.com/images/fossil/5.png', 'https://www.pikawiz.com/images/baseset/10.png'];
const W = 1200, H = 630;

async function fetchThumb(u, w) {
  const res = await fetch(`${ORIGIN}/img/card?u=${encodeURIComponent(u)}&w=${w}`);
  if (!res.ok) throw new Error(`thumb ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

(async () => {
  const bg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="a" cx="15%" cy="0%" r="70%"><stop offset="0" stop-color="#7c3aed" stop-opacity=".75"/><stop offset="1" stop-color="#7c3aed" stop-opacity="0"/></radialGradient>
      <radialGradient id="b" cx="95%" cy="20%" r="60%"><stop offset="0" stop-color="#ff5ea2" stop-opacity=".45"/><stop offset="1" stop-color="#ff5ea2" stop-opacity="0"/></radialGradient>
      <radialGradient id="c" cx="60%" cy="120%" r="60%"><stop offset="0" stop-color="#3ee0d0" stop-opacity=".35"/><stop offset="1" stop-color="#3ee0d0" stop-opacity="0"/></radialGradient>
      <linearGradient id="t" x1="0" x2="1"><stop offset="0" stop-color="#a878ff"/><stop offset=".5" stop-color="#ff5ea2"/><stop offset="1" stop-color="#ffc94d"/></linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="#06030d"/>
    <rect width="${W}" height="${H}" fill="url(#a)"/><rect width="${W}" height="${H}" fill="url(#b)"/><rect width="${W}" height="${H}" fill="url(#c)"/>
    <g font-family="Segoe UI, Inter, Arial, sans-serif">
      <text x="72" y="122" font-size="22" font-weight="700" fill="#d9c4ff" letter-spacing="4">LIVE ON DISCORD</text>
      <text x="72" y="235" font-size="96" font-weight="800" fill="#f2ecff" letter-spacing="-3">Rip packs.</text>
      <text x="72" y="340" font-size="96" font-weight="800" fill="#f2ecff" letter-spacing="-3">Chase the <tspan fill="url(#t)">foil.</tspan></text>
      <text x="72" y="410" font-size="26" fill="#a99bcf">A Pokémon-style card game that lives in Discord.</text>
      <text x="72" y="448" font-size="26" fill="#a99bcf">1st Editions, shinies, real slabs, trades, duels.</text>
      <text x="72" y="548" font-size="30" font-weight="700" fill="#ffc94d">thepokebot.com</text>
    </g>
  </svg>`);
  const cards = await Promise.all(CARDS.map(u => fetchThumb(u, 320)));
  const card = async (buf, w, rot) => sharp(buf).resize({ width: w }).rotate(rot, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const [c1, c2, c3] = await Promise.all([card(cards[0], 250, -14), card(cards[1], 270, 0), card(cards[2], 250, 14)]);
  const out = await sharp(bg).composite([
    { input: c1, left: 690, top: 140 }, { input: c3, left: 930, top: 140 }, { input: c2, left: 815, top: 100 },
  ]).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  const file = path.join(__dirname, '..', 'public', 'img', 'og.jpg');
  fs.writeFileSync(file, out);
  console.log(`og: ${path.relative(process.cwd(), file)} (${Math.round(out.length / 1024)} KB)`);
})().catch(e => { console.error(e.message); process.exit(1); });
