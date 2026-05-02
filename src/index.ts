import type { Env, Score } from './types';
import { generateMockScore, scrapeMatch } from './scraper';
import { renderOverlay } from './overlay';
import { readBranding } from './branding';
import { handleAdmin, getActiveMatchId } from './admin';

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
  if (!fresh.error) {
    await Promise.all([
      env.CRICKET_CACHE.put(cacheKey, JSON.stringify(fresh)),
      env.CRICKET_CACHE.put(lastGoodKey, JSON.stringify(fresh)),
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

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const apiMatch = url.pathname.match(/^\/api\/score\/([^/]+)\/?$/);
    if (apiMatch) {
      const matchId = decodeURIComponent(apiMatch[1]);
      if (url.searchParams.get('mock') === '1') {
        const mock = generateMockScore();
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

    if (routePath === '/overlay/active' || routePath === '/overlay/active/') {
      const active = (await getActiveMatchId(env, scope)) ?? 'test';
      const branding = await readBranding(env, scope);
      return htmlResponse(renderOverlay(active, branding, scope));
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
      return htmlResponse(renderHome());
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function renderHome(): string {
  const scopes: { id: string; label: string }[] = [
    { id: '3s', label: '3rd XI' },
    { id: '4s', label: '4th XI' },
    { id: '', label: 'Default' },
  ];
  const scopeCards = scopes
    .map(({ id, label }) => {
      const prefix = id ? `/${id}` : '';
      return `  <section class="scope">
    <h2>${label}</h2>
    <ul>
      <li><a href="${prefix}/overlay/active">${prefix}/overlay/active</a> <code>— OBS Browser Source URL</code></li>
      <li><a href="${prefix}/overlay/test?mock=1">${prefix}/overlay/test?mock=1</a> <code>— mock for testing</code></li>
      <li><a href="${prefix}/admin">${prefix}/admin</a> <code>— admin (needs ?key=…)</code></li>
    </ul>
  </section>`;
    })
    .join('\n');

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
  .meta a { color: var(--accent); text-decoration: none; }
  .meta a:hover { text-decoration: underline; }
</style>
</head>
<body>
<header>
  <h1>Cricket overlay</h1>
  <p>Three concurrent scopes: default, 3rd XI, 4th XI. Each has its own active match, sponsors, and team branding.</p>
</header>
<main>
${scopeCards}

  <p class="meta">Each scope's admin is gated by a separate secret: <code>ADMIN_KEY</code> (default), <code>ADMIN_KEY_3S</code>, <code>ADMIN_KEY_4S</code>. Set with <code>npx wrangler secret put &lt;NAME&gt;</code>, then append <code>?key=&lt;value&gt;</code> to the admin URL.</p>
  <p class="meta">Raw score JSON: <code>/api/score/&lt;matchId&gt;</code>. Add <code>?mock=1</code> for fake ticking data.</p>
</main>
</body>
</html>`;
}
