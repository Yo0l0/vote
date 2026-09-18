# thepokebot.com

The website for [Pokébot](https://thepokebot.com), the Pokémon-style card game for Discord. Express, no build step, one process on Render.

## What it serves
| Page | What it is |
|---|---|
| `/` | Home: live stats, the pull feed, this week's big pulls, the next-set countdown, the pack simulator, the changelog |
| `/cards`, `/sets/:slug`, `/cards/:set/:card` | The card database: every released set and card with live population (copies, holders, slabs, 1st Editions, shinies) |
| `/leaderboards` | Nine boards computed from the binders |
| `/t/:uid` | A trainer's public profile (best nine, sets, slabs, 1st Editions, shinies) |
| `/dashboard` | The logged-in trainer's binder: checklist per set, filters, the card sheet |
| `/commands` | Generated from the bot's own `/help` table |
| `/sitemap.xml`, `/robots.txt`, `/healthz` | For crawlers and for Render |

## Where the data comes from
The bot publishes files to the public `Yo0l0/ssss` repo; the site keeps each one warm in memory (`lib/cache.js`: TTL, ETag conditional GET, local copy as the cold-start fallback) and rebuilds every derived view once per inventory revision (`lib/population.js`).

| File | Publisher | Local fallback |
|---|---|---|
| `user_inventory.json` | the bot, every 3 min | `user_inventory.json` |
| `news.json` | the bot, on every deploy | `news.json` |
| `catalog.json` | the bot (planned); until then `npm run build:data` | `data/catalog.json` |
| `help.json` | the bot (planned); until then `npm run build:data` | `data/help.json` |

`tools/build-catalog.js` reads the bot checkout (`BOT_DIR`, default `../pokebot-app`) and applies the bot's own release rule, so an unreleased set never reaches the site.

## Pictures
`/img/card?u=<url>&w=<px>` is the thumbnail proxy (`lib/images.js`): a pikawiz scan is ~850 KB, the 320px webp is ~35 KB. Memory + temp-dir cache, far-future headers, only the card pool's hosts are allowed; on any failure it redirects to the original.

## Running it
```
npm install
npm start                      # production: needs CLIENT_SECRET, SESSION_SECRET, UPLOAD_SECRET
node tools/dev.js              # DEMO=1: a synthetic inventory (no player data), a stubbed login, port 3000
npm run build:data             # regenerate data/catalog.json + data/help.json from the bot checkout
node tools/build-og.js         # regenerate public/img/og.jpg (needs the site running)
```
Env: `INVENTORY_URL`, `NEWS_URL`, `CATALOG_URL`, `HELP_URL`, `THUMB_MEM_MB` (default 96), `REDIRECT_URI`.
