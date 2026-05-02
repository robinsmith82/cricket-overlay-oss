import type { Env } from './types';
import { readBranding, writeSponsors, writeTeams, writeHeader, type Sponsor, type TeamBrand, type HeaderConfig } from './branding';

function activeKey(scope: string): string {
  return scope ? `active_match_id:${scope}` : 'active_match_id';
}

export async function getActiveMatchId(env: Env, scope = ''): Promise<string | null> {
  return (await env.CRICKET_CACHE.get(activeKey(scope))) ?? null;
}

async function setActiveMatchId(env: Env, id: string, scope = ''): Promise<void> {
  await env.CRICKET_CACHE.put(activeKey(scope), id);
}

function unauth(): Response {
  return new Response('Unauthorized', { status: 401 });
}

function adminKeyFor(env: Env, scope: string): string | undefined {
  if (scope === '3s') return env.ADMIN_KEY_3S;
  if (scope === '4s') return env.ADMIN_KEY_4S;
  return env.ADMIN_KEY;
}

function isAuthed(env: Env, url: URL, scope: string): boolean {
  const expected = adminKeyFor(env, scope);
  if (!expected) return false;
  return url.searchParams.get('key') === expected;
}

export async function handleAdmin(request: Request, env: Env, url: URL, scope = ''): Promise<Response> {
  if (!isAuthed(env, url, scope)) return unauth();

  if (request.method === 'POST') {
    return handleAdminPost(request, env, url, scope);
  }

  const branding = await readBranding(env, scope);
  const active = await getActiveMatchId(env, scope);
  const key = adminKeyFor(env, scope) ?? '';
  return new Response(
    renderAdmin(active, branding.sponsors, branding.teams, branding.header ?? { logos: [] }, key, scope, env, url),
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

async function handleAdminPost(request: Request, env: Env, url: URL, scope: string): Promise<Response> {
  const action = url.pathname.split('/').filter(Boolean).pop();
  const form = await request.formData();
  if (action === 'set-active') {
    const id = String(form.get('matchId') ?? '').trim();
    if (id) await setActiveMatchId(env, id, scope);
  } else if (action === 'sponsors') {
    const json = String(form.get('json') ?? '[]');
    try { await writeSponsors(env, JSON.parse(json) as Sponsor[], scope); } catch { /* ignore parse */ }
  } else if (action === 'teams') {
    const json = String(form.get('json') ?? '{}');
    try { await writeTeams(env, JSON.parse(json) as Record<string, TeamBrand>, scope); } catch { /* ignore parse */ }
  } else if (action === 'header') {
    const json = String(form.get('json') ?? '{}');
    try { await writeHeader(env, JSON.parse(json) as HeaderConfig, scope); } catch { /* ignore parse */ }
  }
  const adminPath = scope ? `/${scope}/admin` : '/admin';
  const key = adminKeyFor(env, scope) ?? '';
  return Response.redirect(`${url.origin}${adminPath}?key=${encodeURIComponent(key)}`, 303);
}

function renderAdmin(
  active: string | null,
  sponsors: Sponsor[],
  teams: Record<string, TeamBrand>,
  header: HeaderConfig,
  key: string,
  scope: string,
  env: Env,
  url: URL,
): string {
  const sponsorsJson = JSON.stringify(sponsors, null, 2);
  const teamsJson = JSON.stringify(teams, null, 2);
  const headerJson = JSON.stringify(header, null, 2);
  const prefix = scope ? `/${scope}` : '';
  const overlayActiveUrl = `${prefix}/overlay/active`;
  const adminPath = `${prefix}/admin`;
  const scopeLabel = scope ? scope.toUpperCase() : 'DEFAULT';

  const otherScopes = ['', '3s', '4s'].filter((s) => s !== scope);
  function urlForScope(s: string): string {
    const k = adminKeyFor(env, s) ?? '';
    const path = s ? `/${s}/admin` : '/admin';
    return `${path}?key=${encodeURIComponent(k)}`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Cricket overlay admin · ${escapeHtml(scopeLabel)}</title>
<style>
  :root {
    --bg: #0e1116;
    --panel: #161a22;
    --border: #232a35;
    --accent: #ffd23a;
    --text: #e8eaed;
    --muted: #8a93a4;
  }
  body { margin:0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
  header { padding: 24px 32px; border-bottom: 1px solid var(--border); display:flex; align-items:center; gap: 18px; flex-wrap: wrap; }
  header h1 { margin:0; font-size: 18px; letter-spacing: 0.05em; text-transform: uppercase; }
  header .scope { color: var(--accent); font-weight: 800; letter-spacing: 0.18em; }
  header .live { display:inline-flex; align-items:center; gap:8px; color: var(--muted); font-size: 12px; }
  header .dot { width:8px; height:8px; border-radius:50%; background:#3ddc84; box-shadow:0 0 8px #3ddc84; }
  header nav { margin-left: auto; display: flex; gap: 8px; }
  header nav a {
    color: var(--muted);
    text-decoration: none;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  header nav a:hover { color: var(--accent); border-color: var(--accent); }
  main { max-width: 1100px; margin: 24px auto; padding: 0 32px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  section { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
  section h2 { margin: 0 0 12px; font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  label { display: block; font-size: 12px; color: var(--muted); margin-top: 12px; }
  input[type=text], textarea {
    width: 100%; box-sizing: border-box;
    padding: 10px 12px; margin-top: 6px;
    background: #0a0d12; color: var(--text);
    border: 1px solid var(--border); border-radius: 4px;
    font: 13px/1.4 ui-monospace, Menlo, Consolas, monospace;
  }
  textarea { min-height: 220px; resize: vertical; }
  button {
    margin-top: 14px;
    padding: 9px 18px;
    background: var(--accent); color: #0a0d12;
    border: none; border-radius: 4px;
    font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
    cursor: pointer;
  }
  button:hover { background: #ffe066; }
  .meta { color: var(--muted); font-size: 12px; }
  .meta code { color: var(--text); background:#0a0d12; padding: 2px 6px; border-radius: 3px; }
  a.link { color: var(--accent); text-decoration: none; }
  a.link:hover { text-decoration: underline; }
  .full { grid-column: 1 / -1; }
  .row { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: end; }
</style>
</head>
<body>
<header>
  <h1>Cricket overlay admin · <span class="scope">${escapeHtml(scopeLabel)}</span></h1>
  <span class="live"><span class="dot"></span>active match: <code>${escapeHtml(active ?? '— none —')}</code></span>
  <nav>
    ${otherScopes
      .map((s) => {
        const label = s ? s.toUpperCase() : 'DEFAULT';
        return `<a href="${urlForScope(s)}">${escapeHtml(label)}</a>`;
      })
      .join('')}
  </nav>
</header>
<main>
  <section>
    <h2>Active match — ${escapeHtml(scopeLabel)}</h2>
    <p class="meta">Set the Play-Cricket numeric match ID. Point OBS at <a class="link" href="${overlayActiveUrl}" target="_blank" rel="noopener">${overlayActiveUrl}</a> once and never edit OBS again.</p>
    <form method="POST" action="${adminPath}/set-active?key=${encodeURIComponent(key)}">
      <div class="row">
        <input type="text" name="matchId" placeholder="e.g. 7591652" value="${escapeHtml(active ?? '')}" />
        <button type="submit">Set active</button>
      </div>
    </form>
    <label>OBS URL (copy this once):</label>
    <input type="text" readonly value="${escapeHtml(url.origin)}${overlayActiveUrl}" />
  </section>

  <section>
    <h2>Quick links</h2>
    <p><a class="link" href="${prefix}/overlay/test?mock=1" target="_blank" rel="noopener">Mock overlay (for OBS testing)</a></p>
    <p><a class="link" href="${overlayActiveUrl}" target="_blank" rel="noopener">Live overlay (current active match)</a></p>
    <p><a class="link" href="/api/score/${escapeHtml(active ?? 'test')}" target="_blank" rel="noopener">Raw score JSON</a></p>
    <p class="meta">Tip: refresh OBS Browser Source after changing branding by tweaking the URL or removing/re-adding the source.</p>
  </section>

  <section class="full">
    <h2>Header logos — ${escapeHtml(scopeLabel)}</h2>
    <p class="meta">JSON object: <code>{ "logos": [{ "imageUrl": "https://...", "alt": "Club", "height": 84 }] }</code>. Logos render top-left of the overlay, in order. Leave the <code>logos</code> array empty for no header.</p>
    <form method="POST" action="${adminPath}/header?key=${encodeURIComponent(key)}">
      <textarea name="json">${escapeHtml(headerJson)}</textarea>
      <button type="submit">Save header</button>
    </form>
  </section>

  <section class="full">
    <h2>Sponsors — ${escapeHtml(scopeLabel)}</h2>
    <p class="meta">JSON array. Each entry: <code>{ "name": "...", "imageUrl": "...", "text": "...", "durationMs": 12000 }</code>. Rotates every <code>durationMs</code> (default 12s).</p>
    <form method="POST" action="${adminPath}/sponsors?key=${encodeURIComponent(key)}">
      <textarea name="json">${escapeHtml(sponsorsJson)}</textarea>
      <button type="submit">Save sponsors</button>
    </form>
  </section>

  <section class="full">
    <h2>Team branding — ${escapeHtml(scopeLabel)}</h2>
    <p class="meta">JSON object keyed by case-insensitive substring of the team name. Each value: <code>{ "primary": "#ffd23a", "secondary": "#000", "crestUrl": "https://..." }</code>. Substring match means a key like <code>"redhill"</code> would match "Redhill CC, 1st XI".</p>
    <form method="POST" action="${adminPath}/teams?key=${encodeURIComponent(key)}">
      <textarea name="json">${escapeHtml(teamsJson)}</textarea>
      <button type="submit">Save team branding</button>
    </form>
  </section>
</main>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
