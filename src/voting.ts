// Crowdsourced ball-tag voting.
//
// Each ball can be voted on by anyone with the URL. Each voter is identified
// by a long-lived cookie (`cricket-voter`). Visiting `/tag/:id?key=<admin>`
// mints a second signed cookie (`cricket-scorer`) that weights that voter's
// votes 5× — distinguishing "the official scorer on the iPad" from "the dad
// on the boundary tagging on his phone for fun".
//
// Storage:
//   vote:{matchId}:{innings}:{over}.{ball}:{voterId}  → BallVote JSON
//   tag:{matchId}:{innings}:{over}.{ball}             → BallTag (canonical
//                                                        consensus, written
//                                                        every time a vote
//                                                        for that ball lands)
//
// The canonical key matches the schema the existing wagon-wheel / summary /
// archive code already reads, so adding voting didn't require rewriting any
// of those callers. The merged view is just "majority weighted vote, latest
// wins on ties".

import type { Env } from './types';
import type { BallTag, ShotType } from './archive';

// ---- Types ---------------------------------------------------------------

export type BallVote = {
  voterId: string;
  weight: number;        // 1 = anon, 5 = scorer
  zone: number;          // 0..8
  shot?: ShotType;
  ts: number;
};

export type VoterIdentity = {
  voterId: string;
  isScorer: boolean;
  setCookieHeaders: string[]; // any cookies we need to set on the response
};

// ---- Cookie helpers ------------------------------------------------------

const VOTER_COOKIE = 'cricket-voter';
const SCORER_COOKIE = 'cricket-scorer';
const SCORER_TTL_S = 30 * 24 * 60 * 60; // 30 days
const VOTER_TTL_S = 365 * 24 * 60 * 60; // 1 year

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function makeCookie(name: string, value: string, maxAgeS: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeS}; HttpOnly; SameSite=Lax`;
}

function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

// ---- HMAC scorer signature ----------------------------------------------

function b64url(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64url(sig);
}

function adminKeyForScope(env: Env, scope: string): string | undefined {
  if (scope === '3s') return env.ADMIN_KEY_3S;
  if (scope === '4s') return env.ADMIN_KEY_4S;
  return env.ADMIN_KEY;
}

/** Mint a signed scorer cookie when `?key=` matches an admin secret. */
export async function mintScorerCookieIfAuth(env: Env, scope: string, providedKey: string | null): Promise<string | null> {
  if (!providedKey) return null;
  const expected = adminKeyForScope(env, scope);
  if (!expected || providedKey !== expected) return null;
  const exp = Date.now() + SCORER_TTL_S * 1000;
  const payload = `${scope}:${exp}`;
  const sig = await hmac(expected, payload);
  return makeCookie(SCORER_COOKIE, `${payload}.${sig}`, SCORER_TTL_S);
}

/** Verify the scorer cookie. Mismatched scope or bad signature → false. */
async function verifyScorerCookie(env: Env, scope: string, raw: string | undefined): Promise<boolean> {
  if (!raw) return false;
  const dot = raw.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const [cookieScope, expStr] = payload.split(':');
  // The cookie must match the scope it was minted for: a scorer cookie for
  // `3s` does not weight votes on `4s`. Same admin key, but different role.
  if (cookieScope !== scope) return false;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = adminKeyForScope(env, scope);
  if (!expected) return false;
  const want = await hmac(expected, payload);
  return want === sig;
}

// ---- Voter identity ------------------------------------------------------

function randomId(): string {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Resolve voter identity from the request. Issues a fresh anonymous cookie if missing. */
export async function resolveVoter(request: Request, env: Env, scope: string): Promise<VoterIdentity> {
  const cookies = parseCookies(request.headers.get('cookie'));
  const setCookieHeaders: string[] = [];

  let voterId = cookies[VOTER_COOKIE];
  if (!voterId || voterId.length < 8) {
    voterId = randomId();
    setCookieHeaders.push(makeCookie(VOTER_COOKIE, voterId, VOTER_TTL_S));
  }

  const isScorer = await verifyScorerCookie(env, scope, cookies[SCORER_COOKIE]);
  return { voterId, isScorer, setCookieHeaders };
}

export function clearScorerCookieHeader(): string {
  return clearCookie(SCORER_COOKIE);
}

// ---- Rate limiting -------------------------------------------------------

const RATE_LIMIT_PER_MIN = 60;
const RATE_LIMIT_PER_SEC = 2;

/**
 * Returns true if the request is under both per-second and per-minute caps.
 * Cheap KV-counter approach: bucket key has the current second/minute baked
 * in, with a TTL just past the bucket lifetime. Two reads + two writes per
 * vote — fine for free tier at club volumes.
 */
export async function checkRateLimit(env: Env, ip: string): Promise<boolean> {
  if (!ip) return true; // no IP — Cloudflare always sets cf-connecting-ip; if missing, don't block
  const now = Date.now();
  const sec = Math.floor(now / 1000);
  const min = Math.floor(now / 60_000);

  const secKey = `rl-s:${ip}:${sec}`;
  const minKey = `rl-m:${ip}:${min}`;
  const [secRaw, minRaw] = await Promise.all([
    env.CRICKET_CACHE.get(secKey),
    env.CRICKET_CACHE.get(minKey),
  ]);
  const secCount = secRaw ? parseInt(secRaw, 10) || 0 : 0;
  const minCount = minRaw ? parseInt(minRaw, 10) || 0 : 0;
  if (secCount >= RATE_LIMIT_PER_SEC) return false;
  if (minCount >= RATE_LIMIT_PER_MIN) return false;
  await Promise.all([
    env.CRICKET_CACHE.put(secKey, String(secCount + 1), { expirationTtl: 5 }),
    env.CRICKET_CACHE.put(minKey, String(minCount + 1), { expirationTtl: 90 }),
  ]);
  return true;
}

// ---- Vote storage --------------------------------------------------------

function voteKey(matchId: string, innings: number, over: number, ball: number, voterId: string): string {
  return `vote:${matchId}:${innings}:${over}.${ball}:${voterId}`;
}
function votePrefixForBall(matchId: string, innings: number, over: number, ball: number): string {
  return `vote:${matchId}:${innings}:${over}.${ball}:`;
}
function tagKey(matchId: string, innings: number, over: number, ball: number): string {
  return `tag:${matchId}:${innings}:${over}.${ball}`;
}
function tagMetaKey(matchId: string): string {
  return `tag-meta:${matchId}`;
}

function safeJson<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

/** Read all per-voter votes for one ball. */
export async function readVotesForBall(
  env: Env,
  matchId: string,
  innings: number,
  over: number,
  ball: number,
): Promise<BallVote[]> {
  const list = await env.CRICKET_CACHE.list({ prefix: votePrefixForBall(matchId, innings, over, ball) });
  const votes: BallVote[] = [];
  await Promise.all(list.keys.map(async (k) => {
    const raw = await env.CRICKET_CACHE.get(k.name);
    if (!raw) return;
    const v = safeJson<BallVote>(raw);
    if (v) votes.push(v);
  }));
  return votes;
}

/**
 * Cast (or replace) a single voter's vote for a ball, then recompute the
 * weighted consensus zone/shot and write it to the canonical `tag:` key.
 *
 * Idempotent on identical input from the same voter — the consensus is the
 * same set of votes, so the canonical tag is unchanged.
 */
export async function castBallVote(
  env: Env,
  matchId: string,
  innings: number,
  over: number,
  ball: number,
  voterId: string,
  weight: number,
  zone: number,
  shot?: ShotType,
): Promise<{ tag: BallTag; voteCount: number }> {
  if (!Number.isInteger(zone) || zone < 0 || zone > 8) throw new Error(`invalid zone ${zone}`);
  if (!voterId) throw new Error('missing voterId');
  const w = Math.max(1, Math.floor(weight));
  const ts = Date.now();
  const myVote: BallVote = { voterId, weight: w, zone, shot, ts };

  // Persist this voter's vote, then list all votes for the ball.
  await env.CRICKET_CACHE.put(voteKey(matchId, innings, over, ball, voterId), JSON.stringify(myVote));
  const votes = await readVotesForBall(env, matchId, innings, over, ball);

  // Weighted consensus: sum weights per zone, latest wins on tie.
  const zoneWeights: number[] = new Array(9).fill(0);
  let latestPerZone: number[] = new Array(9).fill(0);
  const shotWeights: Record<string, number> = {};
  let latestShotTs = 0;
  let latestShot: ShotType | undefined;
  for (const v of votes) {
    zoneWeights[v.zone] = (zoneWeights[v.zone] ?? 0) + v.weight;
    if (v.ts > latestPerZone[v.zone]) latestPerZone[v.zone] = v.ts;
    if (v.shot) {
      shotWeights[v.shot] = (shotWeights[v.shot] ?? 0) + v.weight;
      if (v.ts > latestShotTs) { latestShotTs = v.ts; latestShot = v.shot; }
    }
  }

  let bestZone = 0;
  let bestZoneScore = -1;
  let bestZoneTs = 0;
  for (let i = 0; i < 9; i++) {
    if (zoneWeights[i] > bestZoneScore || (zoneWeights[i] === bestZoneScore && latestPerZone[i] > bestZoneTs)) {
      bestZone = i;
      bestZoneScore = zoneWeights[i];
      bestZoneTs = latestPerZone[i];
    }
  }
  let bestShot: ShotType | undefined;
  let bestShotScore = -1;
  for (const [s, sw] of Object.entries(shotWeights)) {
    if (sw > bestShotScore || (sw === bestShotScore && s === latestShot)) {
      bestShot = s as ShotType;
      bestShotScore = sw;
    }
  }

  const tag: BallTag = { zone: bestZone, taggedAt: ts, shot: bestShot };
  await Promise.all([
    env.CRICKET_CACHE.put(tagKey(matchId, innings, over, ball), JSON.stringify(tag)),
    env.CRICKET_CACHE.put(tagMetaKey(matchId), JSON.stringify({ lastTaggedBall: `${over}.${ball}`, innings, updatedAt: ts })),
  ]);

  return { tag, voteCount: votes.length };
}
