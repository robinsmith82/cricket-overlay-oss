# Backlog — "NV Play but free, for club cricket"

Pitch: every wicket and boundary becomes a clickable, shareable per-ball video clip; every tagged ball builds a live wagon wheel; every match leaves a permanent searchable artifact. All on Cloudflare's free tier.

Status legend: ✅ shipped · 🚧 in progress · ⏳ next up · 🗄 backlog

---

## Tier 0 — wire what's already coded

- ⏳ **`/highlights/:matchId`** — event cards + per-ball YouTube deep links. Code in `src/highlights.ts` exists, route was unwired.
- ⏳ **`/summary/:matchId`** — final scoreline + wagon wheel + OG meta. Code in `src/summary.ts` exists, route was unwired.
- ⏳ **Active-match shortcuts** — `/highlights` and `/summary` (no id) → resolve to current active match for the scope.

## Tier 1 — ball-level video & live tagging

- ⏳ **Per-ball YouTube deep-link strip on spectator page.** Latest 5 events as clickable badges that jump to the right second on YouTube.
- ⏳ **Live wagon wheel on spectator page.** Reuse `renderWagonWheelSvg`. New `/api/tags/:matchId` JSON endpoint, client polls.
- ⏳ **Shot-type tag** (drive/cut/pull/sweep/defence/glance) alongside zone in tagger. One extra optional tap. Stored on `BallTag.shot`.

## Tier 4 — embed & distribution

- ⏳ **`/embed/score/:matchId`** — tiny iframe scorebar for club website.
- ⏳ **`/embed/clip/:matchId/:eventIdx`** — embedded YouTube cued to that ball + caption.
- ⏳ **`/share/:matchId/:eventIdx.svg`** — share-card SVG per ball (wicket / boundary / milestone). Inline in pages and emails.

---

## Backlog (not yet picked)

### Tier 2 — crowdsourcing

- 🗄 **Open tagger with per-IP rate limit + dedupe.** Anyone with link can tag; majority-vote per ball wins; scorer-cookie-signed tags weighted heavier.
- 🗄 **"Vibe" reactions** per ball (😮 🔥 🎯). KV counter. Feeds highlight ranking.
- 🗄 **Auto-highlight ranking.** Score = boundary/wicket weight + crowd reactions. `/reel/:matchId` shows top 10.

### Tier 3 — archive & stats

- 🗄 **D1 match archive.** Promote completed matches into `matches` / `innings` / `balls` / `tags` tables on completion. One D1 transaction per match.
- 🗄 **`/player/:slug`** — career page aggregating runs/wickets/SR/economy across archived matches.
- 🗄 **`/archive`** — searchable UI with filters (player, opposition, season, "matches with a 50+", "wickets in first over").
- 🗄 **Head-to-head card.** When fixture is discovered, auto-show prior meetings' results.

### Tier 4 (later)

- 🗄 **OG share-card PNGs.** SVG → PNG via `resvg-wasm` so cards render in WhatsApp / Twitter previews.

### Tier 5 — AI (Workers AI is unused, free tier sitting there)

- 🗄 **Auto-commentary.** Small model writes 1–2 lines of colour per over from event diff.
- 🗄 **Match report generator.** ~200-word writeup post-match from events + top performers. Embeddable on club site.
- 🗄 **Smart highlight captions.** "Smith's slog-sweep for six off Patel, 14th over."

### Tier 6 — multi-club

- 🗄 **Generalise scope beyond a single club.** Pluggable scraper per club; admin UI for adding a club.

---

## Already shipped (v0)

- Live overlay (OBS browser source), per-scope sponsors and team branding
- Spectator live page (`/live/:matchId`)
- Wagon-wheel zone tagger (`/tag/:matchId`)
- Event detection (wickets / 4 / 6 / 50 / 100 / team milestones)
- your club fixture discovery, admin UI per scope
- Mock mode for testing
