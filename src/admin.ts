import type { Env } from './types';
import {
  readBranding,
  writeSponsors,
  writeTeams,
  writeBrandingMeta,
  type Sponsor,
  type TeamBrand,
} from './branding';
import { discoverFixtures, type DiscoveredMatch } from './discovery';
import { readYouTube, writeYouTube, type YouTubeConfig } from './archive';
import { seedMockMatch } from './mock-seed';

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

  if (url.pathname.endsWith('/logs') || url.pathname.endsWith('/logs/')) {
    return renderLogsPage(env, url, scope);
  }

  if (request.method === 'POST') {
    return handleAdminPost(request, env, url, scope);
  }

  const [branding, active, fixtures, youtube] = await Promise.all([
    readBranding(env, scope),
    getActiveMatchId(env, scope),
    discoverFixtures(env).catch(() => [] as DiscoveredMatch[]),
    readYouTube(env, scope),
  ]);
  const key = adminKeyFor(env, scope) ?? '';
  return new Response(
    renderAdmin(active, branding.sponsors, branding.teams, key, scope, env, fixtures, youtube, branding),
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
  } else if (action === 'meta') {
    const footerText = String(form.get('footerText') ?? '').trim();
    const headerLogoUrl = String(form.get('headerLogoUrl') ?? '').trim();
    await writeBrandingMeta(env, {
      footerText: footerText || undefined,
      headerLogoUrl: headerLogoUrl || undefined,
    }, scope);
  } else if (action === 'youtube') {
    const url = String(form.get('url') ?? '');
    await writeYouTube(env, url, scope);
  } else if (action === 'mock-seed') {
    // Seed a fake match with synthetic events / tags / vibes so the v2
    // surfaces all populate without needing a live game. Default matchId
    // is `mock-demo` (per scope, so the 3s and 4s seeds don't collide).
    const matchId = (String(form.get('matchId') ?? '').trim()) || `mock-demo${scope ? '-' + scope : ''}`;
    const result = await seedMockMatch(env, matchId, scope);
    const adminPath = scope ? `/${scope}/admin` : '/admin';
    const key = adminKeyFor(env, scope) ?? '';
    const params = new URLSearchParams({ key, seeded: matchId, events: String(result.events), tags: String(result.tags), vibes: String(result.vibes) });
    return Response.redirect(`${url.origin}${adminPath}?${params.toString()}`, 303);
  }
  const adminPath = scope ? `/${scope}/admin` : '/admin';
  const key = adminKeyFor(env, scope) ?? '';
  return Response.redirect(`${url.origin}${adminPath}?key=${encodeURIComponent(key)}`, 303);
}

function renderAdmin(
  active: string | null,
  sponsors: Sponsor[],
  teams: Record<string, TeamBrand>,
  key: string,
  scope: string,
  env: Env,
  fixtures: DiscoveredMatch[],
  youtube: YouTubeConfig | null,
  branding: { footerText?: string; headerLogoUrl?: string },
): string {
  const sponsorsJson = JSON.stringify(sponsors, null, 2);
  const teamsJson = JSON.stringify(teams, null, 2);
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
  .fixtures { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
  .fixture {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 14px;
    background: #0a0d12;
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .fixture.active { border-color: var(--accent); background: #1a1612; }
  .fix-meta { flex: 1; min-width: 0; }
  .fix-teams { font-size: 14px; font-weight: 700; color: var(--text); }
  .fix-teams .vs { color: var(--muted); font-weight: 500; margin: 0 6px; }
  .fix-sub { color: var(--muted); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 3px; }
  .fix-sub code { background: transparent; padding: 0; }
  .fixture button {
    margin: 0;
    padding: 6px 14px;
    font-size: 11px;
    flex-shrink: 0;
  }
  .fixture.active button { background: #2a2e36; color: var(--muted); cursor: default; }
</style>
</head>
<body>
<header>
  <h1>Cricket overlay admin · <span class="scope">${escapeHtml(scopeLabel)}</span></h1>
  <span class="live"><span class="dot"></span>active match: <code>${escapeHtml(active ?? '— none —')}</code></span>
  <nav>
    <a href="${adminPath}/logs?key=${encodeURIComponent(key)}">Logs</a>
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
    ${
      fixtures.length
        ? `<div class="fixtures">
        ${fixtures
          .map(
            (f) => `
          <form method="POST" action="${adminPath}/set-active?key=${encodeURIComponent(key)}" class="fixture ${f.matchId === active ? 'active' : ''}">
            <input type="hidden" name="matchId" value="${escapeHtml(f.matchId)}" />
            <div class="fix-meta">
              <div class="fix-teams">${escapeHtml(f.battingTeam)} <span class="vs">vs</span> ${escapeHtml(f.bowlingTeam)}</div>
              <div class="fix-sub"><code>${escapeHtml(f.matchId)}</code> · ${escapeHtml(f.status)}${f.matchId === active ? ' · <strong>active</strong>' : ''}</div>
            </div>
            <button type="submit">Set active</button>
          </form>`,
          )
          .join('')}
      </div>
      <p class="meta">Auto-discovered from the configured <code>DISCOVERY_HOME_URL</code>. Refreshes every 5 minutes; if you don't see what you expect, it'll catch up shortly.</p>`
        : `<p class="meta"><em>No discovered fixtures right now${env.DISCOVERY_HOME_URL ? " — the home page didn't return any match IDs" : ' — set the <code>DISCOVERY_HOME_URL</code> Worker var to enable fixture auto-discovery'}.</em></p>`
    }
    <p class="meta">Or paste a match ID manually:</p>
    <form method="POST" action="${adminPath}/set-active?key=${encodeURIComponent(key)}">
      <div class="row">
        <input type="text" name="matchId" placeholder="e.g. 7591652" value="${escapeHtml(active ?? '')}" />
        <button type="submit">Set active</button>
      </div>
    </form>
    <label>OBS URL (copy this once):</label>
    <input type="text" readonly value="${overlayActiveUrl}" />
    <p class="meta">Prefix with <code>https://&lt;your-worker&gt;.workers.dev</code> when pasting into OBS Browser Source.</p>
  </section>

  <section>
    <h2>Quick links</h2>
    <p><a class="link" href="${prefix}/overlay/test?mock=1" target="_blank" rel="noopener">Mock overlay (for OBS testing)</a></p>
    <p><a class="link" href="${overlayActiveUrl}" target="_blank" rel="noopener">Live overlay (current active match)</a></p>
    <p><a class="link" href="/api/score/${escapeHtml(active ?? 'test')}" target="_blank" rel="noopener">Raw score JSON</a></p>
    <p><a class="link" href="${prefix}/live" target="_blank" rel="noopener">Mobile spectator page</a> <span class="meta">— share this with parents (QR-friendly)</span></p>
    <p><a class="link" href="${prefix}/tag?key=${encodeURIComponent(key)}" target="_blank" rel="noopener">Wagon-wheel tagger</a> <span class="meta">— second iPad/phone, scorer-side</span></p>
    <p class="meta">Tip: refresh OBS Browser Source after changing branding by tweaking the URL or removing/re-adding the source.</p>
  </section>

  <section>
    <h2>YouTube live stream — ${escapeHtml(scopeLabel)}</h2>
    <p class="meta">Paste the YouTube URL when you start streaming. Used to deep-link replay clips for highlights and the WhatsApp summary card.</p>
    <form method="POST" action="${adminPath}/youtube?key=${encodeURIComponent(key)}">
      <label>Stream URL (youtube.com/watch?v=… · youtu.be/… · youtube.com/live/…)</label>
      <input type="text" name="url" placeholder="https://www.youtube.com/watch?v=…" value="${escapeHtml(youtube?.url ?? '')}" />
      <button type="submit">Save URL</button>
    </form>
    ${
      youtube
        ? `<p class="meta" style="margin-top:14px">Active: <code>${escapeHtml(youtube.videoId)}</code> · started ${escapeHtml(formatRelative(youtube.startedAt))} ago</p>`
        : `<p class="meta" style="margin-top:14px"><em>No stream URL set — highlights/summary won't have replay links.</em></p>`
    }
  </section>

  <section>
    <h2>Mock match seeder — ${escapeHtml(scopeLabel)}</h2>
    <p class="meta">Writes ~30 fake events, ~80 wagon-wheel tags, and ~50 vibe reactions against a mock match id so every v2 surface (highlights, summary, reel, share cards, embed/clip) lights up without a live game. Re-running clears and reseeds.</p>
    <form method="POST" action="${adminPath}/mock-seed?key=${encodeURIComponent(key)}">
      <label>Match id <span class="meta">(default: <code>mock-demo${scope ? '-' + scope : ''}</code>)</span></label>
      <input type="text" name="matchId" placeholder="mock-demo${scope ? '-' + scope : ''}" />
      <button type="submit">Seed mock match</button>
    </form>
    <p class="meta" style="margin-top:14px">After seeding, try:
      <a class="link" href="${prefix}/summary/mock-demo${scope ? '-' + scope : ''}">summary</a> ·
      <a class="link" href="${prefix}/highlights/mock-demo${scope ? '-' + scope : ''}">highlights</a> ·
      <a class="link" href="${prefix}/reel/mock-demo${scope ? '-' + scope : ''}">reel</a> ·
      <a class="link" href="${prefix}/live/mock-demo${scope ? '-' + scope : ''}">live</a>
    </p>
  </section>

  <section>
    <h2>Branding meta — ${escapeHtml(scopeLabel)}</h2>
    <p class="meta">Optional header logo (rendered top-left of the overlay) and footer text (rendered on share cards / summary page).</p>
    <form method="POST" action="${adminPath}/meta?key=${encodeURIComponent(key)}">
      <label>Header logo URL</label>
      <input type="text" name="headerLogoUrl" placeholder="https://..." value="${escapeHtml(branding.headerLogoUrl ?? '')}" />
      <label>Footer text</label>
      <input type="text" name="footerText" placeholder="e.g. yourclub.example.com" value="${escapeHtml(branding.footerText ?? '')}" />
      <button type="submit">Save branding meta</button>
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
    <p class="meta">JSON object keyed by case-insensitive substring of the team name. Each value: <code>{ "primary": "#ffd23a", "secondary": "#000", "crestUrl": "https://..." }</code>. Substring match means <code>"acme"</code> would match "Acme CC 1st XI" and "Acme Wanderers".</p>
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

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return `${Math.max(0, Math.floor(diffMs / 1000))}s`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h`;
  return `${Math.floor(diffMs / 86_400_000)}d`;
}

// ---------- Scrape log viewer ----------------------------------------------

type LogRow = {
  ts: number;
  match_id: string;
  source: string;
  ok: number;
  status: string | null;
  runs: number | null;
  wickets: number | null;
  overs: string | null;
  batting_team: string | null;
  changed: number;
  error: string | null;
};

async function renderLogsPage(env: Env, url: URL, scope: string): Promise<Response> {
  const key = adminKeyFor(env, scope) ?? '';
  const adminPath = scope ? `/${scope}/admin` : '/admin';
  const scopeLabel = scope ? scope.toUpperCase() : 'DEFAULT';

  const filterMatchId = url.searchParams.get('matchId') ?? (await getActiveMatchId(env, scope)) ?? '';
  const onlyChanges = url.searchParams.get('changes') === '1';
  const refresh = url.searchParams.get('refresh') === '1';

  let rows: LogRow[] = [];
  let queryError: string | null = null;
  if (!env.LOG_DB) {
    queryError = 'LOG_DB binding not configured. See wrangler.toml and migrations/0001_scrape_log.sql.';
  } else try {
    const db = env.LOG_DB;
    const stmt = filterMatchId
      ? db
          .prepare(
            `SELECT ts, match_id, source, ok, status, runs, wickets, overs, batting_team, changed, error
             FROM scrape_log
             WHERE match_id = ?1 ${onlyChanges ? 'AND changed = 1' : ''}
             ORDER BY id DESC LIMIT 500`,
          )
          .bind(filterMatchId)
      : db.prepare(
          `SELECT ts, match_id, source, ok, status, runs, wickets, overs, batting_team, changed, error
           FROM scrape_log
           ${onlyChanges ? 'WHERE changed = 1' : ''}
           ORDER BY id DESC LIMIT 500`,
        );
    const res = await stmt.all<LogRow>();
    rows = res.results ?? [];
  } catch (e) {
    queryError = e instanceof Error ? e.message : String(e);
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
${refresh ? '<meta http-equiv="refresh" content="5" />' : ''}
<title>Scrape log · ${escapeHtml(scopeLabel)}</title>
<style>
  :root { --bg:#0e1116; --panel:#161a22; --border:#232a35; --accent:#ffd23a; --text:#e8eaed; --muted:#8a93a4; --ok:#3ddc84; --err:#ff5d5d; --change:#ffd23a; }
  body { margin:0; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
  header { padding: 20px 32px; border-bottom: 1px solid var(--border); display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
  header h1 { margin:0; font-size: 16px; letter-spacing: 0.05em; text-transform: uppercase; }
  header .scope { color: var(--accent); font-weight: 800; letter-spacing: 0.18em; }
  header nav { margin-left:auto; display:flex; gap:8px; }
  header nav a { color: var(--muted); text-decoration:none; padding: 6px 12px; border:1px solid var(--border); border-radius:4px; font-size:12px; letter-spacing: 0.1em; text-transform: uppercase; }
  header nav a:hover { color: var(--accent); border-color: var(--accent); }
  .filters { padding: 14px 32px; border-bottom: 1px solid var(--border); background: var(--panel); display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
  .filters label { color: var(--muted); font-size: 12px; display:flex; align-items:center; gap:6px; }
  .filters input[type=text] { padding: 6px 10px; background:#0a0d12; color: var(--text); border:1px solid var(--border); border-radius:4px; font: 12px ui-monospace, Menlo, Consolas, monospace; min-width: 180px; }
  .filters button { padding: 6px 14px; background: var(--accent); color:#0a0d12; border:none; border-radius:4px; font-weight:700; letter-spacing:0.04em; text-transform: uppercase; cursor:pointer; font-size: 11px; }
  .scroll { max-height: calc(100vh - 130px); overflow-y: auto; }
  table { width:100%; border-collapse: collapse; }
  thead { position: sticky; top: 0; background: var(--panel); z-index: 1; }
  th, td { padding: 6px 12px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; font-variant-numeric: tabular-nums; }
  th { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  tr.err td { background: rgba(255, 93, 93, 0.08); }
  tr.changed td { background: rgba(255, 210, 58, 0.06); }
  tr.err.changed td { background: rgba(255, 93, 93, 0.10); }
  td.ok-cell { color: var(--ok); }
  td.err-cell { color: var(--err); }
  td.change-cell { color: var(--change); font-weight: 700; }
  td.muted { color: var(--muted); }
  .empty, .qerr { padding: 40px 32px; color: var(--muted); text-align: center; }
  .qerr { color: var(--err); font-family: ui-monospace, Menlo, monospace; font-size: 12px; text-align: left; padding: 16px 32px; }
  .qerr strong { display:block; margin-bottom: 6px; color: var(--err); }
</style>
</head>
<body>
<header>
  <h1>Scrape log · <span class="scope">${escapeHtml(scopeLabel)}</span></h1>
  <span style="color:var(--muted); font-size:12px;">${rows.length} row${rows.length === 1 ? '' : 's'}${filterMatchId ? ` for match <code style="color:var(--text);background:#0a0d12;padding:2px 6px;border-radius:3px;">${escapeHtml(filterMatchId)}</code>` : ' (all matches)'}</span>
  <nav>
    <a href="${adminPath}?key=${encodeURIComponent(key)}">← Back to admin</a>
  </nav>
</header>
<form class="filters" method="GET" action="${adminPath}/logs">
  <input type="hidden" name="key" value="${escapeHtml(key)}" />
  <label>Match ID
    <input type="text" name="matchId" value="${escapeHtml(filterMatchId)}" placeholder="(blank = all)" />
  </label>
  <label><input type="checkbox" name="changes" value="1" ${onlyChanges ? 'checked' : ''} /> Only changes</label>
  <label><input type="checkbox" name="refresh" value="1" ${refresh ? 'checked' : ''} /> Auto-refresh (5s)</label>
  <button type="submit">Apply</button>
</form>
${
  queryError
    ? `<div class="qerr"><strong>D1 query failed</strong>${escapeHtml(queryError)}<br><br>Have you created the database and applied the migration? See README.</div>`
    : rows.length === 0
      ? `<div class="empty">No log rows yet. Hit <code>/api/score/&lt;matchId&gt;</code> to generate some.</div>`
      : `<div class="scroll">
<table>
  <thead><tr>
    <th>When</th><th>Match</th><th>Source</th><th>OK</th><th>Status</th><th>Score</th><th>Batting</th><th>Δ</th><th>Error</th>
  </tr></thead>
  <tbody>
    ${rows
      .map((r) => {
        const cls = [r.ok === 0 ? 'err' : '', r.changed === 1 ? 'changed' : ''].filter(Boolean).join(' ');
        const score = r.ok === 0 ? '—' : `${r.runs ?? 0}/${r.wickets ?? 0} (${escapeHtml(r.overs ?? '0.0')})`;
        return `<tr class="${cls}">
          <td title="${new Date(r.ts).toISOString()}">${formatRelative(r.ts)} ago</td>
          <td><code>${escapeHtml(r.match_id)}</code></td>
          <td class="muted">${escapeHtml(r.source)}</td>
          <td class="${r.ok === 0 ? 'err-cell' : 'ok-cell'}">${r.ok === 0 ? '✗' : '✓'}</td>
          <td class="muted">${escapeHtml(r.status ?? '')}</td>
          <td>${score}</td>
          <td class="muted">${escapeHtml(r.batting_team ?? '')}</td>
          <td class="${r.changed === 1 ? 'change-cell' : 'muted'}">${r.changed === 1 ? '●' : '·'}</td>
          <td class="err-cell">${escapeHtml(r.error ?? '')}</td>
        </tr>`;
      })
      .join('')}
  </tbody>
</table>
</div>`
}
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
