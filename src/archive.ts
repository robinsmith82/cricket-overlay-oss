import type { Env } from './types';

export type YouTubeConfig = {
  url: string;
  videoId: string;
  startedAt: number;
};

export type ShotType =
  | 'drive'
  | 'cut'
  | 'pull'
  | 'sweep'
  | 'glance'
  | 'defence'
  | 'edge'
  | 'slog';

export const SHOT_TYPES: ShotType[] = ['drive', 'cut', 'pull', 'sweep', 'glance', 'defence', 'edge', 'slog'];

export type BallTag = {
  zone: number; // 0 = dot/no-shot, 1..8 = wagon-wheel sector clockwise from top (straight)
  taggedAt: number;
  shot?: ShotType;
};

export type TagMeta = {
  lastTaggedBall: string;  // e.g. "12.3"
  innings: number;
  updatedAt: number;
};

export const ZONE_LABELS = [
  'Dot',         // 0
  'Straight',    // 1 (mid-off / mid-on, down the ground)
  'Cover',       // 2
  'Point',       // 3
  'Third',       // 4 (behind square, off)
  'Fine',        // 5 (straight behind)
  'Fine leg',    // 6
  'Sq leg',      // 7
  'Midwicket',   // 8
] as const;

function youtubeKey(scope: string): string {
  return scope ? `youtube:${scope}` : 'youtube';
}

const YT_PATTERNS: RegExp[] = [
  /(?:youtube\.com\/watch\?(?:.*&)?v=)([a-zA-Z0-9_-]{11})/,
  /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  /(?:youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
  /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
];

export function extractYouTubeVideoId(url: string): string | null {
  for (const re of YT_PATTERNS) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

export async function readYouTube(env: Env, scope = ''): Promise<YouTubeConfig | null> {
  const raw = await env.CRICKET_CACHE.get(youtubeKey(scope));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as YouTubeConfig;
  } catch {
    return null;
  }
}

export async function writeYouTube(env: Env, url: string, scope = ''): Promise<YouTubeConfig | null> {
  const trimmed = url.trim();
  if (!trimmed) {
    await env.CRICKET_CACHE.delete(youtubeKey(scope));
    return null;
  }
  const videoId = extractYouTubeVideoId(trimmed);
  if (!videoId) return null;
  const config: YouTubeConfig = { url: trimmed, videoId, startedAt: Date.now() };
  await env.CRICKET_CACHE.put(youtubeKey(scope), JSON.stringify(config));
  return config;
}

// ---------- Ball tagging --------------------------------------------------

function tagKey(matchId: string, innings: number, over: number, ball: number): string {
  return `tag:${matchId}:${innings}:${over}.${ball}`;
}
function tagPrefix(matchId: string): string {
  return `tag:${matchId}:`;
}
function tagMetaKey(matchId: string): string {
  return `tag-meta:${matchId}`;
}

/** Parse "12.3" → {over:12, ball:3}. Returns null on garbage. */
export function parseOverBall(s: string): { over: number; ball: number } | null {
  const m = String(s).trim().match(/^(\d+)\.(\d+)$/);
  if (!m) return null;
  const over = parseInt(m[1], 10);
  const ball = parseInt(m[2], 10);
  if (!Number.isFinite(over) || !Number.isFinite(ball) || over < 0 || ball < 0 || ball > 9) return null;
  return { over, ball };
}

export async function writeBallTag(
  env: Env,
  matchId: string,
  innings: number,
  over: number,
  ball: number,
  zone: number,
  shot?: ShotType,
): Promise<BallTag> {
  if (!Number.isInteger(zone) || zone < 0 || zone > 8) {
    throw new Error(`invalid zone ${zone}`);
  }
  // Merge with any existing tag so a follow-up shot-type tap doesn't blow away the zone.
  const existingRaw = await env.CRICKET_CACHE.get(tagKey(matchId, innings, over, ball));
  const existing: BallTag | null = existingRaw ? safeJson<BallTag>(existingRaw) : null;
  const tag: BallTag = {
    zone,
    taggedAt: Date.now(),
    shot: shot ?? existing?.shot,
  };
  const meta: TagMeta = { lastTaggedBall: `${over}.${ball}`, innings, updatedAt: tag.taggedAt };
  await Promise.all([
    env.CRICKET_CACHE.put(tagKey(matchId, innings, over, ball), JSON.stringify(tag)),
    env.CRICKET_CACHE.put(tagMetaKey(matchId), JSON.stringify(meta)),
  ]);
  return tag;
}

function safeJson<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

export async function readBallTag(
  env: Env,
  matchId: string,
  innings: number,
  over: number,
  ball: number,
): Promise<BallTag | null> {
  const raw = await env.CRICKET_CACHE.get(tagKey(matchId, innings, over, ball));
  if (!raw) return null;
  try { return JSON.parse(raw) as BallTag; } catch { return null; }
}

export async function readTagMeta(env: Env, matchId: string): Promise<TagMeta | null> {
  const raw = await env.CRICKET_CACHE.get(tagMetaKey(matchId));
  if (!raw) return null;
  try { return JSON.parse(raw) as TagMeta; } catch { return null; }
}

/** Read every tag for a match. Used by overlay wagon-wheel inset and summary card. */
export async function readAllBallTags(
  env: Env,
  matchId: string,
): Promise<Array<{ innings: number; over: number; ball: number; tag: BallTag }>> {
  const out: Array<{ innings: number; over: number; ball: number; tag: BallTag }> = [];
  const list = await env.CRICKET_CACHE.list({ prefix: tagPrefix(matchId) });
  // Free-tier note: if a single match exceeds 1k ball tags this paginates.
  // Club innings ≤ 300 balls so we ignore the cursor for now.
  await Promise.all(list.keys.map(async (k) => {
    const m = k.name.match(/^tag:[^:]+:(\d+):(\d+)\.(\d+)$/);
    if (!m) return;
    const innings = parseInt(m[1], 10);
    const over = parseInt(m[2], 10);
    const ball = parseInt(m[3], 10);
    const raw = await env.CRICKET_CACHE.get(k.name);
    if (!raw) return;
    try {
      const tag = JSON.parse(raw) as BallTag;
      out.push({ innings, over, ball, tag });
    } catch { /* skip */ }
  }));
  out.sort((a, b) => (a.innings - b.innings) || (a.over - b.over) || (a.ball - b.ball));
  return out;
}
