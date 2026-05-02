# cricket-overlay

Self-hosted, transparent TV-style scorebar for streaming club cricket to YouTube via OBS. One Cloudflare Worker scrapes Play-Cricket, caches in KV for 25s, and serves an HTML overlay that polls every 10s.

MIT licensed. No hardcoded club branding — logos, crests, sponsors and accent colours are all configured at runtime via an admin UI.

## Endpoints

- `GET /api/score/:matchId` — JSON `Score`. Add `?mock=1` for a fake ticking score (bypasses scraper + KV).
- `GET /overlay/:matchId` — HTML overlay for OBS Browser Source. `?mock=1` is forwarded to the API call.
- `GET /overlay/active` — HTML overlay for whichever match is currently flagged active in admin.
- `GET /admin?key=<ADMIN_KEY>` — set the active match, header logos, team crests, sponsors.

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

## Files

- `src/index.ts` — fetch handler, route table, KV cache logic.
- `src/scraper.ts` — Play-Cricket fetch + parse, mock score generator.
- `src/signer.ts` — DES signature for the ResultsVault fallback path.
- `src/overlay.ts` — self-contained HTML overlay.
- `src/admin.ts` — admin UI for active match + branding.
- `src/branding.ts` — branding config types + KV read/write.
- `src/types.ts` — `Score` shape + Worker `Env`.

## When the parser breaks

Play-Cricket can rewrite their templates or InteractSport can rotate the DES key on the fallback path. Symptoms: `error: 'parse_failed'` in the API response, or the overlay stuck on a stale score. Get an API token (`PLAY_CRICKET_API_TOKEN`) — it's the durable fix. Failing that, open a current match in dev tools, find the new selectors / signing scheme, update `src/scraper.ts` or `src/signer.ts`, redeploy.

## Licence

MIT — see [LICENSE](LICENSE).
