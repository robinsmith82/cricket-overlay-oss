import type { Env, Score } from './types';
import { generateMockScore, scrapeMatch } from './scraper';
import { renderOverlay } from './overlay';
import { readBranding } from './branding';
import { handleAdmin, getActiveMatchId } from './admin';
import { discoverFixtures } from './discovery';
import { readAllBallTags, readYouTube } from './archive';
import { readEvents, detectAndAppendEvents } from './events';
import { renderSpectator } from './spectator';
import { handleTaggerPost, renderTaggerPage } from './tagger';
import { logScrape } from './log';
import { renderNonTechSpec } from './docs';
import { renderHighlights } from './highlights';
import { renderSummary } from './summary';
import { renderEmbedScore, renderEmbedClip } from './embed';
import { renderShareCardSvg } from './share';
import { renderReel } from './reel';
import { mintScorerCookieIfAuth, resolveVoter, checkRateLimit } from './voting';
import { bumpVibe, readAllVibes, VIBES, type Vibe } from './vibes';

const CACHE_MAX_AGE_MS = 25_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function jsonResponse(body: Score, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  });
}

function renderIndexPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Cricket overlay</title>
<style>
  :root { --bg:#0e1116; --panel:#161a22; --border:#232a35; --accent:#ffd23a; --text:#e8eaed; --muted:#8a93a4; }
  body { margin:0; font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
  header { padding: 28px 32px; border-bottom: 1px solid var(--border); }
  header h1 { margin:0; font-size: 20px; letter-spacing: 0.05em; text-transform: uppercase; }
  header p { margin: 6px 0 0; color: var(--muted); font-size: 13px; }
  main { max-width: 900px; margin: 28px auto; padding: 0 32px; display: grid; gap: 20px; }
  .scope { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 18px 22px; }
  .scope h2 { margin: 0 0 10px; font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); }
  .scope ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
  .scope a { color: var(--text); text-decoration: none; padding: 4px 0; display: inline-block; }
  .scope a:hover { color: var(--accent); }
  .scope code { color: var(--muted); font-size: 12px; }
  .meta { color: var(--muted); font-size: 13px; }
  .meta code { color: var(--text); background: #0a0d12; padding: 2px 6px; border-radius: 3px; }
</style>
</head>
<body>
<header>
  <h1>Cricket overlay</h1>
  <p>Three concurrent scopes: default, 3rd XI, 4th XI. Each has its own active match, sponsors, and team branding.</p>
</header>
<main>
  <section class="scope">
    <h2>3rd XI</h2>
    <ul>
      <li><a href="/3s/overlay/active">/3s/overlay/active</a> <code>— OBS Browser Source URL</code></li>
      <li><a href="/3s/overlay/test?mock=1">/3s/overlay/test?mock=1</a> <code>— mock for testing</code></li>
      <li><a href="/3s/admin">/3s/admin</a> <code>— admin (needs ?key=…)</code></li>
    </ul>
  </section>

  <section class="scope">
    <h2>4th XI</h2>
    <ul>
      <li><a href="/4s/overlay/active">/4s/overlay/active</a> <code>— OBS Browser Source URL</code></li>
      <li><a href="/4s/overlay/test?mock=1">/4s/overlay/test?mock=1</a> <code>— mock for testing</code></li>
      <li><a href="/4s/admin">/4s/admin</a> <code>— admin (needs ?key=…)</code></li>
    </ul>
  </section>

  <section class="scope">
    <h2>Default (legacy)</h2>
    <ul>
      <li><a href="/overlay/active">/overlay/active</a></li>
      <li><a href="/overlay/test?mock=1">/overlay/test?mock=1</a></li>
      <li><a href="/admin">/admin</a></li>
    </ul>
  </section>

  <p class="meta">Admin keys are set via <code>npx wrangler secret put ADMIN_KEY</code> (and <code>ADMIN_KEY_3S</code>, <code>ADMIN_KEY_4S</code> for scoped admin URLs). Append <code>?key=&lt;value&gt;</code> to the admin URL.</p>
  <p class="meta">Raw score JSON: <code>/api/score/&lt;matchId&gt;</code>. Add <code>?mock=1</code> for fake ticking data.</p>
  <p class="meta"><a href="/docs" style="color:var(--accent); text-decoration:none;">Plain English spec →</a></p>
</main>
</body>
</html>`;
}

async function getScore(env: Env, matchId: string): Promise<Score> {
  const cacheKey = `score:${matchId}`;
  const lastGoodKey = `score:${matchId}:last_good`;

  const cachedRaw = await env.CRICKET_CACHE.get(cacheKey);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw) as Score;
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (age < CACHE_MAX_AGE_MS) return cached;
    } catch {
      // fall through to re-scrape
    }
  }

  const fresh = await scrapeMatch(matchId, env);
  // Audit every real scrape attempt (cache miss). Logging never blocks the
  // response and never throws — see src/log.ts.
  await logScrape(env, fresh);
  if (!fresh.error) {
    await Promise.all([
      env.CRICKET_CACHE.put(cacheKey, JSON.stringify(fresh)),
      env.CRICKET_CACHE.put(lastGoodKey, JSON.stringify(fresh)),
      // Detect wickets / 4 / 6 / 50 / 100 / team milestones by diffing this
      // scrape against the previous snapshot. Idempotent on identical
      // scores — safe to call on every cache miss. This was the silently
      // broken bit: the detector existed but was never invoked, so
      // events:{matchId} stayed empty for every real match.
      detectAndAppendEvents(env, fresh).catch(() => { /* never block scrape */ }),
    ]);
    return fresh;
  }

  const lastGoodRaw = await env.CRICKET_CACHE.get(lastGoodKey);
  if (lastGoodRaw) {
    try {
      const lastGood = JSON.parse(lastGoodRaw) as Score;
      return { ...lastGood, stale: true };
    } catch {
      // ignore parse errors, fall through
    }
  }

  return fresh;
}

/**
 * GET /tag/:matchId handler. Anyone can hit this URL; the page is the same.
 * The only difference between scorer and crowd: scorer has a signed cookie
 * that weights their votes 5×. The cookie is minted server-side here when
 * a request arrives with `?key=<admin>` and the key matches; we then drop
 * the key from the URL via a 303 redirect so it doesn't sit in browser
 * history / get accidentally shared.
 */
async function renderTaggerWithMaybeScorerCookie(
  request: Request,
  env: Env,
  scope: string,
  matchId: string,
  url: URL,
): Promise<Response> {
  const providedKey = url.searchParams.get('key');
  if (providedKey) {
    const cookie = await mintScorerCookieIfAuth(env, scope, providedKey);
    if (cookie) {
      // Strip ?key= from the URL on the way out so the URL the user shares
      // doesn't accidentally hand out scorer status to anyone who taps it.
      const clean = new URL(url.toString());
      clean.searchParams.delete('key');
      const headers = new Headers({ Location: clean.toString() });
      headers.append('Set-Cookie', cookie);
      return new Response(null, { status: 303, headers });
    }
  }
  const voter = await resolveVoter(request, env, scope);
  const html = await renderTaggerPage(env, scope, matchId, voter.isScorer);
  const res = new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
  for (const c of voter.setCookieHeaders) res.headers.append('Set-Cookie', c);
  return res;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/api/discover' || url.pathname === '/api/discover/') {
      const matches = await discoverFixtures(env);
      return new Response(JSON.stringify({ matches }), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...CORS_HEADERS,
        },
      });
    }

    if (
      url.pathname === '/docs' ||
      url.pathname === '/docs/' ||
      url.pathname === '/docs/non-tech-spec' ||
      url.pathname === '/docs/non-tech-spec/'
    ) {
      return htmlResponse(renderNonTechSpec());
    }

    const apiMatch = url.pathname.match(/^\/api\/score\/([^/]+)\/?$/);
    if (apiMatch) {
      const matchId = decodeURIComponent(apiMatch[1]);
      const mockParam = url.searchParams.get('mock');
      if (mockParam === '1' || mockParam === '2') {
        const mock = generateMockScore(mockParam === '2' ? 2 : 1);
        return jsonResponse({ ...mock, matchId });
      }
      const score = await getScore(env, matchId);
      return jsonResponse(score);
    }

    // Scope-aware routing: /3s/..., /4s/... carry a scope prefix; root paths
    // are the default scope.
    const SCOPES = ['3s', '4s'];
    let scope = '';
    let routePath = url.pathname;
    for (const s of SCOPES) {
      if (routePath === `/${s}` || routePath.startsWith(`/${s}/`)) {
        scope = s;
        routePath = routePath.slice(s.length + 1) || '/';
        break;
      }
    }

    const apiTagsMatch = routePath.match(/^\/api\/tags\/([^/]+)\/?$/);
    if (apiTagsMatch) {
      const matchId = decodeURIComponent(apiTagsMatch[1]);
      const tags = await readAllBallTags(env, matchId);
      const counts = new Array(9).fill(0);
      const shots: Record<string, number> = {};
      for (const t of tags) {
        counts[t.tag.zone] = (counts[t.tag.zone] ?? 0) + 1;
        if (t.tag.shot) shots[t.tag.shot] = (shots[t.tag.shot] ?? 0) + 1;
      }
      return new Response(JSON.stringify({ counts, shots, total: tags.length, lastTaggedAt: tags.length ? tags[tags.length - 1].tag.taggedAt : 0 }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS_HEADERS },
      });
    }

    const apiEventsMatch = routePath.match(/^\/api\/events\/([^/]+)\/?$/);
    if (apiEventsMatch) {
      const matchId = decodeURIComponent(apiEventsMatch[1]);
      const [events, youtube] = await Promise.all([readEvents(env, matchId), readYouTube(env, scope)]);
      return new Response(JSON.stringify({ events, youtube }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS_HEADERS },
      });
    }

    // Embed: /embed/score/:matchId — tiny score iframe
    const embedScoreMatch = routePath.match(/^\/embed\/score\/([^/]+)\/?$/);
    if (embedScoreMatch) {
      const matchId = decodeURIComponent(embedScoreMatch[1]);
      return htmlResponse(renderEmbedScore(matchId, scope));
    }
    // Embed: /embed/clip/:matchId/:eventIdx — YouTube iframe cued to that ball
    const embedClipMatch = routePath.match(/^\/embed\/clip\/([^/]+)\/(\d+)\/?$/);
    if (embedClipMatch) {
      const matchId = decodeURIComponent(embedClipMatch[1]);
      const eventIdx = parseInt(embedClipMatch[2], 10);
      return htmlResponse(await renderEmbedClip(env, matchId, scope, eventIdx));
    }

    // Share card: /share/:matchId/:eventIdx.svg
    const shareSvgMatch = routePath.match(/^\/share\/([^/]+)\/(\d+)\.svg$/);
    if (shareSvgMatch) {
      const matchId = decodeURIComponent(shareSvgMatch[1]);
      const eventIdx = parseInt(shareSvgMatch[2], 10);
      const branding = await readBranding(env, scope);
      const svg = await renderShareCardSvg(env, matchId, scope, eventIdx, branding);
      return new Response(svg, {
        headers: {
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          ...CORS_HEADERS,
        },
      });
    }

    if (routePath === '/overlay/active' || routePath === '/overlay/active/') {
      const active = (await getActiveMatchId(env, scope)) ?? 'test';
      const branding = await readBranding(env, scope);
      return htmlResponse(renderOverlay(active, branding, scope));
    }

    if (routePath === '/live' || routePath === '/live/') {
      const isMock = url.searchParams.get('mock') === '1' || url.searchParams.get('mock') === '2';
      const active = isMock ? 'test' : ((await getActiveMatchId(env, scope)) ?? 'test');
      return htmlResponse(renderSpectator(active, scope));
    }
    const liveMatch = routePath.match(/^\/live\/([^/]+)\/?$/);
    if (liveMatch) {
      const matchId = decodeURIComponent(liveMatch[1]);
      return htmlResponse(renderSpectator(matchId, scope));
    }

    if (routePath === '/highlights' || routePath === '/highlights/') {
      const active = (await getActiveMatchId(env, scope)) ?? 'test';
      return htmlResponse(await renderHighlights(env, active, scope));
    }
    const highlightsMatch = routePath.match(/^\/highlights\/([^/]+)\/?$/);
    if (highlightsMatch) {
      const matchId = decodeURIComponent(highlightsMatch[1]);
      return htmlResponse(await renderHighlights(env, matchId, scope));
    }

    // Score fetcher used by /summary. Honours ?mock=1|2 by short-circuiting
    // to the synthetic score generator (same as /api/score does), so the
    // hero / current-state panels populate against fake data without
    // requiring a live match. Persisted events/tags are still empty under
    // mock — that's what the mock seeder is for.
    const summaryMockParam = url.searchParams.get('mock');
    const summaryFetcher = (id: string): Promise<Score> => {
      if (summaryMockParam === '1' || summaryMockParam === '2') {
        const m = generateMockScore(summaryMockParam === '2' ? 2 : 1);
        return Promise.resolve({ ...m, matchId: id });
      }
      return getScore(env, id);
    };

    if (routePath === '/summary' || routePath === '/summary/') {
      const isMock = summaryMockParam === '1' || summaryMockParam === '2';
      const active = isMock ? 'test' : ((await getActiveMatchId(env, scope)) ?? 'test');
      return htmlResponse(await renderSummary(env, active, scope, summaryFetcher, url.origin));
    }
    const summaryMatch = routePath.match(/^\/summary\/([^/]+)\/?$/);
    if (summaryMatch) {
      const matchId = decodeURIComponent(summaryMatch[1]);
      return htmlResponse(await renderSummary(env, matchId, scope, summaryFetcher, url.origin));
    }

    // Tagger POST: /[scope]/tag/:matchId/zone — open, cookie-driven
    const tagPostMatch = routePath.match(/^\/tag\/([^/]+)\/zone\/?$/);
    if (tagPostMatch && request.method === 'POST') {
      const matchId = decodeURIComponent(tagPostMatch[1]);
      const scopedUrl = new URL(url.toString());
      scopedUrl.pathname = routePath;
      return handleTaggerPost(request, env, scopedUrl, scope, matchId);
    }
    // Tagger UI: /[scope]/tag/:matchId  (open; ?key=… mints a scorer cookie)
    const tagPageMatch = routePath.match(/^\/tag\/([^/]+)\/?$/);
    if (tagPageMatch) {
      const matchId = decodeURIComponent(tagPageMatch[1]);
      return renderTaggerWithMaybeScorerCookie(request, env, scope, matchId, url);
    }
    // Tagger UI shortcut: /[scope]/tag → active match
    if (routePath === '/tag' || routePath === '/tag/') {
      const active = (await getActiveMatchId(env, scope)) ?? 'test';
      return renderTaggerWithMaybeScorerCookie(request, env, scope, active, url);
    }

    // Vibe (emoji reaction) POST: /[scope]/api/vibe/:matchId/:innings/:over/:ball
    const vibePostMatch = routePath.match(/^\/api\/vibe\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\/?$/);
    if (vibePostMatch && request.method === 'POST') {
      const matchId = decodeURIComponent(vibePostMatch[1]);
      const innings = parseInt(vibePostMatch[2], 10);
      const over = parseInt(vibePostMatch[3], 10);
      const ball = parseInt(vibePostMatch[4], 10);
      const ip = request.headers.get('cf-connecting-ip') || '';
      if (!(await checkRateLimit(env, ip))) {
        return new Response(JSON.stringify({ ok: false, error: 'rate_limited' }), {
          status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '5' },
        });
      }
      const voter = await resolveVoter(request, env, scope);
      let body: any;
      try { body = await request.json(); } catch { body = {}; }
      const emoji = String(body?.emoji || '');
      if (!(VIBES as readonly string[]).includes(emoji)) {
        return new Response(JSON.stringify({ ok: false, error: 'bad_emoji', allowed: VIBES }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }
      const total = await bumpVibe(env, matchId, innings, over, ball, emoji as Vibe);
      const res = new Response(JSON.stringify({ ok: true, emoji, total, voter: voter.voterId }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
      for (const cookie of voter.setCookieHeaders) res.headers.append('Set-Cookie', cookie);
      return res;
    }

    // Vibes read: /[scope]/api/vibes/:matchId
    const vibesGetMatch = routePath.match(/^\/api\/vibes\/([^/]+)\/?$/);
    if (vibesGetMatch) {
      const matchId = decodeURIComponent(vibesGetMatch[1]);
      const map = await readAllVibes(env, matchId);
      return new Response(JSON.stringify({ vibes: map, allowed: VIBES }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS_HEADERS },
      });
    }

    // Reel: /[scope]/reel[/:matchId]
    if (routePath === '/reel' || routePath === '/reel/') {
      const active = (await getActiveMatchId(env, scope)) ?? 'test';
      return htmlResponse(await renderReel(env, active, scope));
    }
    const reelMatch = routePath.match(/^\/reel\/([^/]+)\/?$/);
    if (reelMatch) {
      const matchId = decodeURIComponent(reelMatch[1]);
      return htmlResponse(await renderReel(env, matchId, scope));
    }

    if (routePath === '/admin' || routePath.startsWith('/admin/')) {
      // Reconstruct the URL with the scoped pathname so handleAdmin parses
      // POST action segments correctly relative to /admin/<action>.
      const scopedUrl = new URL(url.toString());
      scopedUrl.pathname = routePath;
      return handleAdmin(request, env, scopedUrl, scope);
    }

    const overlayMatch = routePath.match(/^\/overlay\/([^/]+)\/?$/);
    if (overlayMatch) {
      const matchId = decodeURIComponent(overlayMatch[1]);
      const branding = await readBranding(env, scope);
      return htmlResponse(renderOverlay(matchId, branding, scope));
    }

    if (url.pathname === '/' || url.pathname === '') {
      return new Response(renderIndexPage(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
