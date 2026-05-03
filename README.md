# cricket-overlay

Self-hosted, transparent TV-style scorebar for streaming club cricket to YouTube via OBS. One Cloudflare Worker scrapes Play-Cricket, caches in KV for 25s, and serves an HTML overlay that polls every 10s.

MIT licensed. No hardcoded club branding — logos, crests, sponsors and accent colours are all configured at runtime via an admin UI.

## Endpoints

### Core
- `GET /api/score/:matchId` — JSON `Score`. Add `?mock=1` for a fake ticking score (bypasses scraper + KV).
- `GET /overlay/:matchId` — HTML overlay for OBS Browser Source. `?mock=1` is forwarded to the API call.
- `GET /overlay/active` — HTML overlay for whichever match is currently flagged active in admin.
- `GET /admin?key=<ADMIN_KEY>` — set the active match, header logo, footer text, team crests, sponsors.

### Spectator surfaces
- `GET /live/:matchId` — phone-friendly live scoreboard with wagon-wheel + clip strip. Drop into a QR code for parents.
- `GET /highlights/:matchId` — auto-generated event cards (wickets, 4s, 6s, milestones) with YouTube deep-links.
- `GET /summary/:matchId` — final scoreline hero, top performers, wagon wheel, and OG meta tags for sharing.
- `GET /reel/:matchId` — top 12 ranked moments (wickets + boundaries + milestones, weighted by 🔥 reactions).

### Tagging + voting
- `GET /tag/:matchId?key=<ADMIN_KEY>` — wagon-wheel zone picker for the scorer.
- `POST /vote` — crowdsourced ball-tagging (HMAC-cookie weighted).
- `POST /vibe` — emoji reactions per ball (🔥 😮 🎯 👏 😂).

### Embeds + share cards
- `GET /embed/scorebar/:matchId` — iframe-embeddable scorebar (no chrome).
- `GET /embed/clip/:matchId/:eventIdx` — clipped YouTube player around a specific event.
- `GET /share/:matchId/:eventIdx.svg` — 1200×630 OG-card SVG per event.

### Misc
- `GET /docs` — bundled non-tech spec.
- `GET /api/discover` — auto-discovered fixtures (requires `DISCOVERY_HOME_URL`).

Scope prefixes (`/3s/...`, `/4s/...`) carry an isolated active-match + branding set, so one deployment can drive multiple concurrent streams.

## Quick start

```
npm install
npx wrangler kv namespace create CRICKET_CACHE
```

Paste the returned namespace ID into `wrangler.toml` (`id = "..."`), then:

```
npx wrangler dev
```

Open `http://localhost:8787/overlay/anything?mock=1` — runs and overs should tick up every 10 seconds.

## Deploy

```
npx wrangler secret put ADMIN_KEY                # required to use the admin UI
npx wrangler secret put PLAY_CRICKET_API_TOKEN   # optional, see below
npx wrangler deploy
```

Then visit `https://<your-worker>.workers.dev/admin?key=<ADMIN_KEY>` to set the active match and configure branding.

## Finding a Play-Cricket match ID

1. Visit a club page on `https://www.play-cricket.com` (or any league subdomain).
2. Results → click any match.
3. The numeric ID at the end of the URL is your match ID.

## Data sources

The worker prefers the official Play-Cricket Site API v2 when `PLAY_CRICKET_API_TOKEN` is set. Without a token it falls back to scraping the same ResultsVault calls that Play-Cricket's own React app makes. See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

## OBS setup

- Scene → Add → **Video Capture Device** → your camera.
- Scene → Add → **Browser Source** → URL `https://<your-worker>.workers.dev/overlay/active`, width 1920, height 1080, tick "Refresh browser when scene becomes active".
- Settings → Stream → Service: YouTube, paste stream key from YouTube Studio → Go Live.

## Optional features

- **Fixture auto-discovery.** Set `DISCOVERY_HOME_URL` (a Worker var) to your club's Play-Cricket home page (e.g. `https://yourclub.play-cricket.com/home`). The admin UI will list live and upcoming match IDs you can promote with one click.
- **Scrape audit log.** Bind a D1 database as `LOG_DB` and run `migrations/0001_scrape_log.sql` to record every scrape (with change detection) into `scrape_log`. View a paginated list at `/admin/logs?key=<ADMIN_KEY>`. When unbound, scraping silently skips logging.
- **Branding meta.** From the admin UI, set a header logo URL (rendered top-left of the overlay) and a footer text (used by share cards and the summary page) per scope.

## Files

- `src/index.ts` — fetch handler, route table, KV cache logic.
- `src/scraper.ts` — Play-Cricket fetch + parse, mock score generator.
- `src/signer.ts` — DES signature for the ResultsVault fallback path.
- `src/overlay.ts` — self-contained HTML overlay.
- `src/admin.ts` — admin UI for active match + branding.
- `src/branding.ts` — branding config types + KV read/write (sponsors, teams, header logo, footer text).
- `src/discovery.ts` — fixture auto-discovery from a Play-Cricket home page.
- `src/events.ts` — event diffing (wickets, 4s, 6s, milestones).
- `src/highlights.ts` — event-card page with YouTube deep links.
- `src/summary.ts` — final scoreline hero + wagon wheel + OG meta.
- `src/reel.ts` — auto-ranked highlight reel.
- `src/embed.ts` — iframe scorebar + clipped YouTube player.
- `src/share.ts` — per-ball SVG share card.
- `src/spectator.ts` — phone-friendly live scoreboard.
- `src/tagger.ts` — wagon-wheel zone picker.
- `src/voting.ts` — HMAC-cookie weighted ball-tag voting.
- `src/vibes.ts` — emoji reaction counters.
- `src/archive.ts` — KV helpers for YouTube config + ball tags.
- `src/log.ts` — optional D1 scrape audit log (no-op when `LOG_DB` unbound).
- `src/docs.ts` — serves `non_tech_spec.md`.
- `src/mock-seed.ts` — admin-triggered mock match seeder for testing v2 surfaces.
- `src/types.ts` — `Score` shape + Worker `Env`.

## When the parser breaks

Play-Cricket can rewrite their templates or InteractSport can rotate the DES key on the fallback path. Symptoms: `error: 'parse_failed'` in the API response, or the overlay stuck on a stale score. Get an API token (`PLAY_CRICKET_API_TOKEN`) — it's the durable fix. Failing that, open a current match in dev tools, find the new selectors / signing scheme, update `src/scraper.ts` or `src/signer.ts`, redeploy.

## Licence

MIT — see [LICENSE](LICENSE).
