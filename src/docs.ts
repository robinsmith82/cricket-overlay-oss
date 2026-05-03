// Serves the non-technical spec at /docs.
//
// The .md file at the repo root is the single source of truth — wrangler
// bundles it as a raw text import via the [[rules]] block in wrangler.toml.
// We render it inside a <pre> block so the heavy ASCII-art diagrams line up.
import nonTechSpecMd from '../non_tech_spec.md';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function renderNonTechSpec(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Cricket overlay — plain English spec</title>
<style>
  :root { --bg:#0e1116; --panel:#161a22; --border:#232a35; --accent:#ffd23a; --text:#e8eaed; --muted:#8a93a4; }
  body { margin:0; background: var(--bg); color: var(--text); font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  header { padding: 20px 32px; border-bottom: 1px solid var(--border); display:flex; align-items:center; gap: 18px; flex-wrap: wrap; }
  header h1 { margin:0; font-size: 16px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--accent); }
  header a { color: var(--muted); text-decoration: none; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; }
  header a:hover { color: var(--accent); }
  main { max-width: 980px; margin: 0 auto; padding: 28px 32px 80px; }
  pre {
    margin: 0;
    font: 13px/1.55 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    color: var(--text);
    white-space: pre-wrap;
    word-wrap: break-word;
    tab-size: 2;
  }
</style>
</head>
<body>
<header>
  <h1>Cricket overlay — plain English spec</h1>
  <a href="/">← back to overlay</a>
</header>
<main><pre>${escapeHtml(nonTechSpecMd)}</pre></main>
</body>
</html>`;
}
