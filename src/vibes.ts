// Per-ball "vibe" reactions — emoji counters keyed by (matchId, innings,
// over, ball, emoji). One KV entry per (ball, emoji) is the simplest
// schema; a small fixed set of emojis caps total writes.
//
// Read paths return both per-ball totals (for the spectator clip strip) and
// match-wide totals (for /reel ranking).

import type { Env } from './types';

export const VIBES = ['🔥', '😮', '🎯', '👏', '😂'] as const;
export type Vibe = (typeof VIBES)[number];

function vibeKey(matchId: string, innings: number, over: number, ball: number, emoji: string): string {
  return `vibe:${matchId}:${innings}:${over}.${ball}:${emoji}`;
}
function vibePrefix(matchId: string): string {
  return `vibe:${matchId}:`;
}

/** Increment one emoji counter for one ball. Returns the new total. */
export async function bumpVibe(
  env: Env,
  matchId: string,
  innings: number,
  over: number,
  ball: number,
  emoji: Vibe,
): Promise<number> {
  const k = vibeKey(matchId, innings, over, ball, emoji);
  const raw = await env.CRICKET_CACHE.get(k);
  const n = raw ? (parseInt(raw, 10) || 0) : 0;
  const next = n + 1;
  await env.CRICKET_CACHE.put(k, String(next));
  return next;
}

export type VibeMap = Record<string, Record<string, number>>; // "i:o.b" → emoji → count

/** Read every vibe counter for a match. Used by spectator + reel pages. */
export async function readAllVibes(env: Env, matchId: string): Promise<VibeMap> {
  const list = await env.CRICKET_CACHE.list({ prefix: vibePrefix(matchId) });
  const out: VibeMap = {};
  await Promise.all(list.keys.map(async (k) => {
    // Pattern: vibe:{matchId}:{innings}:{over}.{ball}:{emoji}
    // We can't naively split on ":" because emoji may contain bytes that
    // happen to be `:` in some encodings (none of our chosen ones do, but
    // defensive). Slice off the prefix, then take the substring before the
    // last ":" as the ball key, and the rest as emoji.
    const tail = k.name.slice(vibePrefix(matchId).length); // "1:14.3:🔥"
    const lastColon = tail.lastIndexOf(':');
    if (lastColon < 0) return;
    const ballPart = tail.slice(0, lastColon); // "1:14.3"
    const emoji = tail.slice(lastColon + 1);
    const raw = await env.CRICKET_CACHE.get(k.name);
    const n = raw ? (parseInt(raw, 10) || 0) : 0;
    if (!n) return;
    out[ballPart] ??= {};
    out[ballPart][emoji] = n;
  }));
  return out;
}

/** Sum all vibe counts on one ball — used by reel ranking. */
export function totalVibesOnBall(map: VibeMap, innings: number, over: number, ball: number): number {
  const m = map[`${innings}:${over}.${ball}`];
  if (!m) return 0;
  let n = 0;
  for (const v of Object.values(m)) n += v;
  return n;
}
