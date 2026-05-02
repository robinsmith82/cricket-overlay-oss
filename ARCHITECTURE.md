# Architecture

## Pipeline

```
Play-Cricket data source ──► Cloudflare Worker ──► /api/score/:id (JSON)
                                    │                      ▲
                                    │                      │ poll 10s
                                    ▼                      │
                              KV cache (25s)         /overlay/:id (HTML)
                                                           │
                                                           ▼
                                                   OBS Browser Source
                                                           │
                                                           ▼
                                                   YouTube Live (RTMP)
```

One Worker. KV used as a cache-aside store with two keys per match:

- `score:{matchId}` — last fetch (overwritten on every successful scrape).
- `score:{matchId}:last_good` — last *successful* fetch, used as the stale fallback when the upstream errors.

Cache freshness is 25s in code, not via KV TTL — keeps the `last_good` fallback usable when scrapes fail.

## Routes

- `GET /api/score/:matchId` — JSON `Score`. `?mock=1` returns a fake ticking score, bypassing scraper + KV.
- `GET /overlay/:matchId` — self-contained HTML overlay. Forwards `?mock=1` to its API call.
- `GET /overlay/active` — overlay for the currently-active match (set via admin).
- `GET /admin?key=…` — admin UI for active match + branding (sponsors, team crests, header logos).

Optional scope prefixes (`/3s/...`, `/4s/...`) carry an isolated active-match + branding set, so a single deployment can drive multiple concurrent streams.

## Data sources

Play-Cricket's public match centre page is a React app. The HTML shell only contains team names — score numbers are loaded client-side from `https://api.resultsvault.co.uk/rv/`. The worker has two paths to that data:

### Path A: Play-Cricket Site API v2 (preferred, when token available)

```
GET https://www.play-cricket.com/api/v2/match_detail.json?match_id=<id>&api_token=<token>
```

Auth: `api_token` query parameter, issued per club to site admins (or via the commercial/non-profit application route). Returns JSON. Stable, supported.

Worker reads the token from the `PLAY_CRICKET_API_TOKEN` secret. When set, this path is used.

### Path B: ResultsVault direct (fallback, no token)

```
GET https://api.resultsvault.co.uk/rv/<entityId>/matches/<rvMatchId>/?strmflg=3&apiid=1003
Headers:
  X-IAS-API-REQUEST: <DES-signed timestamp>
  Content-Type: application/json
```

This is the same call the React app makes. Two-step:

1. Resolve `externalId → rvMatchId` (and entity) via `mappings/4/12/<externalId>/?sportid=1`.
2. Fetch match by `rvMatchId`.

Both calls require the `X-IAS-API-REQUEST` header — a base64'd DES-encrypted timestamp. The signing logic (`ce()` in `match-centre/1.3.0/main.js`) is ported verbatim into `src/signer.ts`. Signature is cached for 30 minutes server-side, matching the upstream `se` window.

Used when `PLAY_CRICKET_API_TOKEN` is absent. Fragile: breaks if InteractSport rotate the DES key or rev the bundle. Not in our control.

## Mock mode

`?mock=1` short-circuits both data paths, returning a synthetic `Score` derived from wall-clock minutes/seconds (one ball every 5s). Bypasses KV. Used for OBS pipeline validation when no live match is on.

## Overlay

Single HTML doc, no external assets, transparent background, ~80px bottom-anchored bar. Polls `/api/score/:matchId` every 10s with `setTimeout` recursion (not `setInterval` — stops requests stacking on a slow response). On error, last render stays on screen — no loading/error chrome.

Layout: optional top-left header logo block (driven by branding config), two team blocks (batting team highlighted with yellow accent), score on each side, overs + optional 2nd-innings target on the right.

## Branding

All branding is driven from KV via the admin UI — the codebase ships with no hardcoded club assets. Three knobs per scope:

- **Header logos** (`branding:header[:scope]`) — `{ logos: [{ imageUrl, alt?, height? }, ...] }`. Renders top-left. Empty array = no header block.
- **Team crests + accent colours** (`branding:teams[:scope]`) — `{ "<substring>": { primary?, secondary?, crestUrl? } }`. Keys substring-match against the team name (case-insensitive).
- **Sponsors strip** (`branding:sponsors[:scope]`) — rotating array of `{ name, imageUrl?, text?, durationMs? }`.

Logo URLs must be reachable from the browser running OBS. Host on your own CDN, GitHub raw, R2, etc.

## Worker bindings

- `CRICKET_CACHE` — KV namespace. Set the ID in `wrangler.toml` after `wrangler kv namespace create CRICKET_CACHE`.
- `PLAY_CRICKET_API_TOKEN` — secret, optional. If unset, ResultsVault path is used.
- `ADMIN_KEY`, `ADMIN_KEY_3S`, `ADMIN_KEY_4S` — secrets, optional. Required to reach the admin UI for the default / `3s` / `4s` scopes respectively. If unset, that scope's admin returns 401.

Set a secret with: `npx wrangler secret put <NAME>`.

## Backlog

- **Status detection.** `live | break | finished | unknown` — best effort from upstream fields. Currently anything `status_id >= 60` lumps to `finished`. Need to learn the specific codes for `abandoned` / `no_result` / `drawn` and add explicit badges to the overlay's right side.
- **Workers Tail logging.** Add structured logs around scrape success/failure to make selector/key rotations debuggable.

## Out of scope

Multi-match aggregation, history endpoint, SSE instead of polling.
