import type { Env } from './types';
import { readTagMeta, ZONE_LABELS, SHOT_TYPES, type ShotType } from './archive';
import { castBallVote, checkRateLimit, resolveVoter } from './voting';

const SCOPE_LABELS: Record<string, string> = {
  '3s': '3rd XI',
  '4s': '4th XI',
};

const SCORER_VOTE_WEIGHT = 5;

export async function handleTaggerPost(request: Request, env: Env, _url: URL, scope: string, matchId: string): Promise<Response> {
  // Open tagger: anyone can vote. Scorer cookie weights the vote 5×.
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!(await checkRateLimit(env, ip))) {
    return new Response(JSON.stringify({ ok: false, error: 'rate_limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '5' },
    });
  }

  const voter = await resolveVoter(request, env, scope);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jerr('bad_json', voter.setCookieHeaders);
  }
  const innings = Number(body?.innings);
  const over = Number(body?.over);
  const ball = Number(body?.ball);
  const zone = Number(body?.zone);
  const rawShot = typeof body?.shot === 'string' ? body.shot.toLowerCase() : undefined;
  const shot: ShotType | undefined = rawShot && (SHOT_TYPES as string[]).includes(rawShot) ? (rawShot as ShotType) : undefined;
  if (!Number.isFinite(innings) || innings < 1 || innings > 4) return jerr('bad_innings', voter.setCookieHeaders);
  if (!Number.isFinite(over) || over < 0) return jerr('bad_over', voter.setCookieHeaders);
  if (!Number.isFinite(ball) || ball < 0 || ball > 9) return jerr('bad_ball', voter.setCookieHeaders);
  if (!Number.isInteger(zone) || zone < 0 || zone > 8) return jerr('bad_zone', voter.setCookieHeaders);
  try {
    const weight = voter.isScorer ? SCORER_VOTE_WEIGHT : 1;
    const { tag, voteCount } = await castBallVote(env, matchId, innings, over, ball, voter.voterId, weight, zone, shot);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    const res = new Response(JSON.stringify({
      ok: true,
      tag,
      ballKey: `${over}.${ball}`,
      voteCount,
      scorer: voter.isScorer,
    }), { headers });
    for (const cookie of voter.setCookieHeaders) res.headers.append('Set-Cookie', cookie);
    return res;
  } catch (e) {
    return jerr(e instanceof Error ? e.message : 'write_failed', voter.setCookieHeaders);
  }
}

function jerr(error: string, setCookies: string[] = []): Response {
  const res = new Response(JSON.stringify({ ok: false, error }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  for (const cookie of setCookies) res.headers.append('Set-Cookie', cookie);
  return res;
}

export async function renderTaggerPage(
  env: Env,
  scope: string,
  matchId: string,
  isScorer: boolean,
): Promise<string> {
  const safeId = matchId.replace(/[^a-zA-Z0-9_-]/g, '');
  const meta = await readTagMeta(env, matchId);
  const scopeLabel = SCOPE_LABELS[scope] ?? '';
  const isMock = matchId === 'test' || matchId === 'mock';
  const labelsJson = JSON.stringify(ZONE_LABELS);
  const shotsJson = JSON.stringify(SHOT_TYPES);
  const lastTagged = meta ? `${meta.innings}:${meta.lastTaggedBall}` : '';
  // Cookie-authenticated scorer mode just sets a header badge — the POST
  // itself uses the cookie, no `?key=` smuggled into the URL.
  const postPath = `${scope ? '/' + scope : ''}/tag/${encodeURIComponent(safeId)}/zone`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
<meta name="theme-color" content="#0e1116" />
<title>Tag · ${escapeHtml(scopeLabel || 'Cricket')}</title>
<style>
  :root {
    --bg: #0e1116;
    --panel: #161a22;
    --border: #232a35;
    --accent: #ffd23a;
    --text: #e8eaed;
    --muted: #8a93a4;
    --good: #3ddc84;
    --bad: #ff4d6d;
    --zone: #1c2230;
    --zone-hover: #2a3140;
    --zone-tagged: #ffd23a;
  }
  * { box-sizing: border-box; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); height: 100%; overflow: hidden; }
  body {
    font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    user-select: none;
    -webkit-user-select: none;
  }

  header {
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  header .scope { font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); font-weight: 800; }
  header .ball-pill {
    background: rgba(255,210,58,0.12);
    color: var(--accent);
    padding: 4px 10px;
    border-radius: 4px;
    font-weight: 800;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.05em;
  }
  header .scorer-badge {
    background: rgba(61, 220, 132, 0.14);
    color: var(--good);
    padding: 4px 8px;
    border-radius: 4px;
    font-weight: 800;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  header .scorer-badge.crowd {
    background: rgba(138, 147, 164, 0.14);
    color: var(--muted);
  }
  header .toast {
    margin-left: auto;
    color: var(--good);
    font-size: 12px;
    opacity: 0;
    transition: opacity .25s ease;
  }
  header .toast.show { opacity: 1; }
  header .toast.bad { color: var(--bad); }

  .ctx {
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
    font-size: 12px;
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    min-height: 30px;
    align-items: center;
  }
  .ctx .striker { color: var(--text); font-weight: 700; }
  .ctx .bowler { color: var(--text); font-weight: 700; }

  main {
    position: absolute;
    top: 80px; bottom: 0; left: 0; right: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding: 8px;
    gap: 10px;
  }
  .wheel-wrap {
    position: relative;
    width: 100%;
    max-width: 480px;
    aspect-ratio: 1 / 1;
    flex: 1 1 auto;
    min-height: 0;
  }
  .shot-strip {
    width: 100%;
    max-width: 540px;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
    padding: 4px 6px 8px;
  }
  .shot-chip {
    flex: 1 1 0;
    min-width: 64px;
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--muted);
    padding: 10px 8px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    transition: all .12s ease;
  }
  .shot-chip:hover, .shot-chip:active { border-color: var(--accent); color: var(--text); }
  .shot-chip.tagged { background: var(--accent); color: #0a0d12; border-color: var(--accent); }
  .shot-chip:disabled { opacity: 0.35; cursor: not-allowed; }
  svg.wheel { width: 100%; height: 100%; display: block; }
  svg.wheel .wedge {
    fill: var(--zone);
    stroke: var(--bg);
    stroke-width: 2;
    cursor: pointer;
    transition: fill .12s ease;
  }
  svg.wheel .wedge:hover, svg.wheel .wedge:active { fill: var(--zone-hover); }
  svg.wheel .wedge.tagged { fill: var(--zone-tagged); }
  svg.wheel .wedge-label {
    fill: var(--text);
    font-weight: 700;
    font-size: 14px;
    text-anchor: middle;
    pointer-events: none;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  svg.wheel .dot-circle {
    fill: var(--zone);
    stroke: var(--bg);
    stroke-width: 2;
    cursor: pointer;
  }
  svg.wheel .dot-circle:hover, svg.wheel .dot-circle:active { fill: var(--zone-hover); }
  svg.wheel .dot-circle.tagged { fill: var(--zone-tagged); }
  svg.wheel .dot-label {
    fill: var(--text);
    font-weight: 800;
    font-size: 18px;
    text-anchor: middle;
    pointer-events: none;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  svg.wheel .bowler-marker {
    fill: var(--accent);
    font-size: 11px;
    text-anchor: middle;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    pointer-events: none;
  }
  .undo-btn {
    position: absolute;
    bottom: 8px; right: 8px;
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--muted);
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .undo-btn:hover { color: var(--text); }
</style>
</head>
<body>
<header>
  <span class="scope">Tagger${scopeLabel ? ' · ' + escapeHtml(scopeLabel) : ''}</span>
  ${isScorer ? '<span class="scorer-badge" title="Your votes count 5×">SCORER ×5</span>' : '<span class="scorer-badge crowd" title="Anyone can tag — open mode">CROWD</span>'}
  <span class="ball-pill" id="ball-pill">—</span>
  <span class="toast" id="toast"></span>
</header>
<div class="ctx">
  <span><span class="striker" id="striker">—</span></span>
  <span>vs <span class="bowler" id="bowler">—</span></span>
  <span id="last-tagged" style="margin-left:auto"></span>
</div>
<main>
  <div class="wheel-wrap">
    <svg class="wheel" viewBox="0 0 400 400">
      <text class="bowler-marker" x="200" y="14">↑ Bowler</text>
      <!-- 8 wedges, generated client-side for label simplicity -->
      <g id="wedges"></g>
      <circle class="dot-circle" id="dot-zone" data-zone="0" cx="200" cy="200" r="48"></circle>
      <text class="dot-label" x="200" y="206">DOT</text>
    </svg>
    <button class="undo-btn" id="undo-btn" type="button" title="Re-tag the last ball">Re-tag last</button>
  </div>
  <div class="shot-strip" id="shot-strip"></div>
</main>
<script>
(function(){
  var MATCH_ID = ${JSON.stringify(safeId)};
  var IS_MOCK = ${JSON.stringify(isMock)};
  var POST_PATH = ${JSON.stringify(postPath)};
  var LABELS = ${labelsJson};
  var SHOTS = ${shotsJson};
  var INITIAL_LAST_TAGGED = ${JSON.stringify(lastTagged)};
  var POLL_MS = 5000;

  var currentScore = null;          // last fetched Score
  var currentBall = null;           // {over, ball, innings} of the ball-to-tag
  var taggedBalls = {};             // "innings:over.ball" → { zone, shot? }, in-session memory
  if (INITIAL_LAST_TAGGED) taggedBalls[INITIAL_LAST_TAGGED] = { zone: -1 }; // mark as tagged

  function $(id){ return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; });
  }

  // 8 wedges, 45° each, clockwise from top.
  // Convention: wedge 1 = "Straight" (top), wedge 2 = "Cover" (upper right), ...
  function buildWedges() {
    var g = $('wedges');
    var cx = 200, cy = 200, r = 180, inner = 50;
    var startDeg = -22.5; // wedge 1 spans -22.5° .. +22.5° (top)
    var html = '';
    for (var i = 0; i < 8; i++) {
      var a0 = (startDeg + i * 45) * Math.PI / 180;
      var a1 = (startDeg + (i+1) * 45) * Math.PI / 180;
      var x0 = cx + r * Math.sin(a0), y0 = cy - r * Math.cos(a0);
      var x1 = cx + r * Math.sin(a1), y1 = cy - r * Math.cos(a1);
      // Outer arc + line back to center: wedge w/o inner hole, the dot circle masks the middle.
      var path = 'M' + cx + ' ' + cy + ' L' + x0.toFixed(2) + ' ' + y0.toFixed(2) +
                 ' A' + r + ' ' + r + ' 0 0 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' Z';
      // Label position: midpoint of wedge at radius (r+inner)/2.
      var mid = (a0 + a1) / 2;
      var lr = (r + inner) / 2 + 18;
      var lx = cx + lr * Math.sin(mid);
      var ly = cy - lr * Math.cos(mid) + 4;
      var zoneNum = i + 1;
      html += '<path class="wedge" data-zone="' + zoneNum + '" d="' + path + '"></path>';
      html += '<text class="wedge-label" x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '">' + escapeHtml(LABELS[zoneNum]) + '</text>';
    }
    g.innerHTML = html;
  }

  function setBallContext(score) {
    currentScore = score;
    var parts = (score.overs || '0.0').split('.');
    var over = parseInt(parts[0], 10) || 0;
    var ballPart = parseInt(parts[1], 10) || 0;
    var innings = score.innings || 1;
    // The ball that was just bowled is the one displayed (overs reflects balls completed).
    // Special-case "0.0" before the first delivery — nothing to tag yet.
    if (over === 0 && ballPart === 0) {
      currentBall = null;
      $('ball-pill').textContent = '—';
    } else {
      // Map "12.3" → over 12, ball 3 (the 3rd delivery of the 13th over).
      currentBall = { innings: innings, over: over, ball: ballPart === 0 ? 6 : ballPart };
      // If ball=0 it means the over just ended (e.g. "13.0" after 6 balls of over 13) — show as previous over's 6th ball.
      if (ballPart === 0) currentBall = { innings: innings, over: over - 1, ball: 6 };
      $('ball-pill').textContent = innings + '·' + currentBall.over + '.' + currentBall.ball;
    }

    var b = (score.batters && score.batters[0]) || {};
    $('striker').textContent = b.name || '—';
    $('bowler').textContent = (score.bowler && score.bowler.name) || '—';

    // Reset wedge highlights based on whether THIS ball is already tagged in-session.
    var key = currentBall ? (currentBall.innings + ':' + currentBall.over + '.' + currentBall.ball) : '';
    var rec = key ? taggedBalls[key] : null;
    var alreadyTagged = !!rec;
    var taggedZone = rec ? rec.zone : -2;
    var taggedShot = rec ? rec.shot : '';
    document.querySelectorAll('.wedge').forEach(function(w){ w.classList.toggle('tagged', alreadyTagged && Number(w.dataset.zone) === taggedZone); });
    $('dot-zone').classList.toggle('tagged', alreadyTagged && taggedZone === 0);
    document.querySelectorAll('.shot-chip').forEach(function(c){ c.classList.toggle('tagged', alreadyTagged && c.dataset.shot === taggedShot); });
    var shotsEnabled = alreadyTagged && taggedZone >= 0;
    document.querySelectorAll('.shot-chip').forEach(function(c){ c.disabled = !shotsEnabled; });
    $('last-tagged').textContent = key && alreadyTagged ? (taggedShot ? 'tagged · ' + taggedShot : 'tagged · pick shot') : '';
  }

  function showToast(msg, bad) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.classList.add('show');
    setTimeout(function(){ t.classList.remove('show'); }, 1800);
  }

  function postTag(zone, shot, ui) {
    if (!currentBall) { showToast('No ball yet', true); return; }
    var key = currentBall.innings + ':' + currentBall.over + '.' + currentBall.ball;
    var rec = taggedBalls[key] || { zone: zone };
    if (typeof zone === 'number') rec.zone = zone;
    if (shot) rec.shot = shot;
    taggedBalls[key] = rec;
    if (ui && ui.zoneTarget) {
      document.querySelectorAll('.wedge').forEach(function(w){ w.classList.remove('tagged'); });
      $('dot-zone').classList.remove('tagged');
      ui.zoneTarget.classList.add('tagged');
      document.querySelectorAll('.shot-chip').forEach(function(c){ c.disabled = false; });
    }
    if (ui && ui.shotTarget) {
      document.querySelectorAll('.shot-chip').forEach(function(c){ c.classList.remove('tagged'); });
      ui.shotTarget.classList.add('tagged');
    }
    var payload = JSON.stringify({
      innings: currentBall.innings, over: currentBall.over, ball: currentBall.ball,
      zone: rec.zone,
      shot: rec.shot || undefined,
    });
    fetch(POST_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      cache: 'no-store',
    }).then(function(r){ return r.json(); }).then(function(j){
      if (j.ok) {
        var label = (typeof rec.zone === 'number' && rec.zone >= 0) ? LABELS[rec.zone] : '';
        var suffix = rec.shot ? ' · ' + rec.shot : '';
        showToast('Tagged ' + currentBall.over + '.' + currentBall.ball + ' → ' + label + suffix);
      } else {
        showToast('Save failed: ' + (j.error || ''), true);
      }
    }).catch(function(){ showToast('Network error', true); });
  }

  function buildShotChips() {
    var s = $('shot-strip');
    var html = '';
    for (var i = 0; i < SHOTS.length; i++) {
      html += '<button class="shot-chip" type="button" data-shot="' + SHOTS[i] + '" disabled>' + SHOTS[i] + '</button>';
    }
    s.innerHTML = html;
  }

  function bind() {
    document.querySelectorAll('.wedge').forEach(function(w){
      w.addEventListener('click', function(){
        var z = Number(this.dataset.zone);
        postTag(z, undefined, { zoneTarget: this });
      });
    });
    $('dot-zone').addEventListener('click', function(){ postTag(0, undefined, { zoneTarget: this }); });
    document.querySelectorAll('.shot-chip').forEach(function(c){
      c.addEventListener('click', function(){
        if (this.disabled) return;
        postTag(undefined, this.dataset.shot, { shotTarget: this });
      });
    });
    $('undo-btn').addEventListener('click', function(){
      if (!currentBall) return;
      var key = currentBall.innings + ':' + currentBall.over + '.' + currentBall.ball;
      delete taggedBalls[key];
      document.querySelectorAll('.wedge').forEach(function(w){ w.classList.remove('tagged'); });
      $('dot-zone').classList.remove('tagged');
      document.querySelectorAll('.shot-chip').forEach(function(c){ c.classList.remove('tagged'); c.disabled = true; });
      $('last-tagged').textContent = '';
      showToast('Re-tag enabled');
    });
  }

  function fetchScore() {
    var url = '/api/score/' + encodeURIComponent(MATCH_ID) + (IS_MOCK ? '?mock=1' : '');
    fetch(url, { cache: 'no-store' })
      .then(function(r){ return r.json(); })
      .then(setBallContext)
      .catch(function(){ /* ignore */ });
  }

  buildWedges();
  buildShotChips();
  bind();
  fetchScore();
  setInterval(fetchScore, POLL_MS);
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
