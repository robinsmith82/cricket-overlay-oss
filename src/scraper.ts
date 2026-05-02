import type {
  BallEvent,
  Batter,
  Bowler,
  Env,
  LastDismissal,
  MatchStatus,
  Partnership,
  Powerplay,
  Score,
} from './types';
import { signRequest } from './signer';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const RV_BASE = 'https://api.resultsvault.co.uk/rv/';
const RV_MASTER_ENTITY_ID = 130000;
const RV_API_ID = 1003;

const SITE_API_BASE = 'https://www.play-cricket.com/api/v2/';

function mockRecentBalls(ballsTotal: number, wkts: number): BallEvent[] {
  // Deterministic 6-ball trail derived from the ball counter so it cycles
  // visibly. Uses a small palette of outcomes weighted to look real-ish.
  const out: BallEvent[] = [];
  for (let i = 5; i >= 0; i--) {
    const idx = ballsTotal - i;
    if (idx <= 0) continue;
    // Hash the index into one of a few outcomes.
    const r = ((idx * 2654435761) >>> 0) % 100;
    if (r < 38) out.push({ runs: 0 });
    else if (r < 60) out.push({ runs: 1 });
    else if (r < 75) out.push({ runs: 2 });
    else if (r < 82) out.push({ runs: 3 });
    else if (r < 90) out.push({ runs: 4, isFour: true });
    else if (r < 94) out.push({ runs: 6, isSix: true });
    else if (r < 96) out.push({ runs: 1, isWide: true });
    else if (r < 98) out.push({ runs: 1, isNoBall: true });
    else out.push({ runs: 0, isWicket: true });
  }
  // Sanity: keep wicket dot in trail only if wickets > 0
  if (wkts === 0) for (const b of out) if (b.isWicket) { b.isWicket = false; b.runs = 0; }
  return out;
}

export function generateMockScore(): Score {
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const balls = Math.floor((minutes * 60 + seconds) / 5);
  const overs = `${Math.floor(balls / 6)}.${balls % 6}`;
  const runs = Math.floor(balls * 1.4);
  const wickets = Math.min(Math.floor(balls / 25), 9);

  // Synthetic batters + bowler driven by the same wall-clock so the numbers
  // visibly tick up alongside the team total.
  const strikerRuns = Math.max(0, Math.floor(runs * 0.42));
  const strikerBalls = Math.max(0, Math.floor(balls * 0.55));
  const partnerRuns = Math.max(0, Math.floor(runs * 0.28));
  const partnerBalls = Math.max(0, Math.floor(balls * 0.4));
  const batters: Batter[] = [
    { name: 'R. SMITH', runs: strikerRuns, balls: strikerBalls, notOut: true, onStrike: true },
    { name: 'J. PATEL', runs: partnerRuns, balls: partnerBalls, notOut: true },
  ];
  const bowlerOversBalls = Math.max(0, Math.floor(balls / 3));
  const bowler: Bowler = {
    name: 'A. KHAN',
    overs: `${Math.floor(bowlerOversBalls / 6)}.${bowlerOversBalls % 6}`,
    maidens: Math.min(2, Math.floor(bowlerOversBalls / 18)),
    runs: Math.max(0, Math.floor(runs * 0.45)),
    wickets: Math.min(wickets, 3),
  };

  return {
    matchId: 'mock',
    fetchedAt: now.toISOString(),
    status: 'live',
    innings: 1,
    battingTeam: 'Hatherley & Reddings CC 4th XI',
    bowlingTeam: 'Cirencester CC 4th XI',
    runs,
    wickets,
    overs,
    oversTotal: 50,
    batters,
    bowler,
    recentBalls: mockRecentBalls(balls, wickets),
    partnership: { runs: strikerRuns + partnerRuns, balls: strikerBalls + partnerBalls },
    powerplay: Math.floor(balls / 6) < 10 ? 'PP1' : null,
    ...(wickets > 0
      ? {
          lastDismissal: {
            batter: 'M. JONES',
            runs: 23,
            balls: 18,
            dismissalText: 'c PATEL b KHAN',
          },
        }
      : {}),
  };
}

export async function scrapeMatch(matchId: string, env: Env): Promise<Score> {
  if (env.PLAY_CRICKET_API_TOKEN) {
    return scrapeViaSiteAPI(matchId, env.PLAY_CRICKET_API_TOKEN);
  }
  return scrapeViaResultsVault(matchId, env);
}

function failedScore(matchId: string, error: string): Score {
  return {
    matchId,
    fetchedAt: new Date().toISOString(),
    status: 'unknown',
    innings: 1,
    battingTeam: '',
    bowlingTeam: '',
    runs: 0,
    wickets: 0,
    overs: '0.0',
    error,
  };
}

// ---------- ResultsVault path (no token) -----------------------------------

async function rvFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-IAS-API-REQUEST': signRequest(),
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
}

async function resolveRvMatchId(externalId: string, env: Env): Promise<number | null> {
  const cacheKey = `rvmap:${externalId}`;
  const cached = await env.CRICKET_CACHE.get(cacheKey);
  if (cached) {
    const n = Number(cached);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const url = `${RV_BASE}mappings/4/12/${encodeURIComponent(externalId)}/?sportid=1&apiid=${RV_API_ID}`;
  const res = await rvFetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as { object_id1?: number };
  const rvId = json.object_id1 && json.object_id1 > 0 ? json.object_id1 : null;
  if (rvId) await env.CRICKET_CACHE.put(cacheKey, String(rvId));
  return rvId;
}

type RVPlayerPerf = {
  __type?: string;
  player_id?: number;
  player_name?: string;
  number?: number | null;
  // Batting fields
  balls?: number | null;
  runs?: number | null;
  fours?: number | null;
  sixes?: number | null;
  dismissal_id?: number | null;
  dismissal_text?: string | null;
  // Bowling fields
  overs?: number | null;
  maidens?: number | null;
  wickets?: number | null;
  wides?: number | null;
  no_balls?: number | null;
};

type RVInnings = {
  innings_number: number;
  innings_order: number;
  runs: number;
  wickets: number;
  overs_bowled: number;
  status: number;
  PlayerPerfs?: RVPlayerPerf[];
};

type RVTeam = {
  is_home: boolean;
  team_name: string;
  match_score_text: string;
  result_id?: number;
  Innings: RVInnings[];
};

type RVBall = {
  runs?: number | null;
  ball_runs?: number | null;
  total_runs?: number | null;
  extras?: number | null;
  byes?: number | null;
  leg_byes?: number | null;
  wides?: number | null;
  no_balls?: number | null;
  is_wicket?: boolean | null;
  dismissal_id?: number | null;
  is_four?: boolean | null;
  is_six?: boolean | null;
  ball_count?: number | null;
  over_number?: number | null;
  ball_number?: number | null;
  inst_num?: number | null;
};

type RVMatchConfig = {
  max_overs?: number | null;
  balls_per_over?: number | null;
};

type RVMatch = {
  external_match_id: number;
  match_id: number;
  status_id: number;
  match_format_id?: number;
  home_name: string;
  away_name: string;
  score_text: string;
  MatchTeams: RVTeam[];
  MatchConfig?: RVMatchConfig;
};

function rvStatus(statusId: number): MatchStatus {
  // 0  = scheduled / not started
  // 30 = in progress (best guess from observed data)
  // 60 = finished
  if (statusId === 0) return 'unknown';
  if (statusId >= 60) return 'finished';
  return 'live';
}

function formatOvers(oversBowled: number | null | undefined): string {
  if (typeof oversBowled !== 'number' || !Number.isFinite(oversBowled)) return '0.0';
  // ResultsVault stores overs as "<overs>.<balls>" decimal where balls < 6.
  // E.g. 14.2 means 14 overs and 2 balls. Render as-is, capped at 1dp.
  const overs = Math.floor(oversBowled);
  const balls = Math.round((oversBowled - overs) * 10);
  const safeBalls = Math.max(0, Math.min(5, balls));
  return `${overs}.${safeBalls}`;
}

function isBattingPerf(p: RVPlayerPerf): boolean {
  if (typeof p.__type === 'string') return p.__type.startsWith('Batting');
  // Fallback: a batter has a faced-balls count or a dismissal record.
  return p.balls != null || p.dismissal_id != null || p.dismissal_text != null;
}

function isBowlingPerf(p: RVPlayerPerf): boolean {
  if (typeof p.__type === 'string') return p.__type.startsWith('Bowling');
  // Fallback: a bowler has overs bowled (non-null) and no batting-only fields.
  return p.overs != null && p.dismissal_id == null && p.dismissal_text == null;
}

function extractBatters(perfs: RVPlayerPerf[] | undefined): Batter[] {
  if (!perfs || perfs.length === 0) return [];
  const batting = perfs.filter(isBattingPerf);
  const notOut = batting.filter((p) => p.dismissal_id == null && (p.dismissal_text == null || p.dismissal_text === ''));
  notOut.sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
  // Highest batting position numbers are most recent in the order — current pair.
  const top = notOut.slice(0, 2);
  return top.map((p, i) => ({
    name: (p.player_name ?? '').toUpperCase(),
    runs: p.runs ?? 0,
    balls: p.balls ?? 0,
    notOut: true,
    onStrike: i === 0,
  }));
}

function extractLastDismissal(perfs: RVPlayerPerf[] | undefined): LastDismissal | undefined {
  if (!perfs || perfs.length === 0) return undefined;
  const dismissed = perfs.filter(
    (p) => isBattingPerf(p) && p.dismissal_id != null && p.dismissal_id > 0,
  );
  if (dismissed.length === 0) return undefined;
  // Most recent dismissal = highest fow_order if present, else last in list.
  dismissed.sort((a, b) => ((b as any).fow_order ?? 0) - ((a as any).fow_order ?? 0));
  const d = dismissed[0];
  return {
    batter: (d.player_name ?? '').toUpperCase(),
    runs: d.runs ?? 0,
    balls: d.balls ?? 0,
    dismissalText: (d.dismissal_text ?? '').trim(),
  };
}

function computePartnership(batters: Batter[], totalRuns: number): Partnership | undefined {
  if (!batters || batters.length === 0) return undefined;
  // First-pass approximation: when both batters at the crease, the partnership
  // runs equal their two contributions. Refines further with ball-by-ball data
  // (TODO once we see real getballs payloads).
  const runs = batters.reduce((acc, b) => acc + (b.runs ?? 0), 0);
  const balls = batters.reduce((acc, b) => acc + (b.balls ?? 0), 0);
  // Cap by team total to avoid weird states (extras can make individual sums exceed).
  return { runs: Math.min(runs, totalRuns), balls };
}

function computePowerplay(matchFormatId: number | undefined, oversBowled: number): Powerplay {
  if (typeof oversBowled !== 'number') return null;
  // Simple defaults until we learn the league's format codes.
  // T20 (format_id 2 in our sample) → PP overs 0-6.
  // 50-over → PP1 overs 0-10.
  if (matchFormatId === 2) return oversBowled < 6 ? 'PP1' : null;
  if (oversBowled < 10) return 'PP1';
  return null;
}

function extractBowler(perfs: RVPlayerPerf[] | undefined): Bowler | undefined {
  if (!perfs || perfs.length === 0) return undefined;
  const bowling = perfs.filter(isBowlingPerf);
  if (bowling.length === 0) return undefined;
  // Heuristic: the current bowler is whoever has the most overs in this list,
  // tie-broken by appearance order (last entry wins). With ball-by-ball data
  // we'd pick the bowler of the most recent ball — TODO when getballs lands.
  const current = bowling.reduce((best, p) =>
    (p.overs ?? 0) >= (best.overs ?? 0) ? p : best,
  bowling[0]);
  return {
    name: (current.player_name ?? '').toUpperCase(),
    overs: formatOvers(current.overs ?? 0),
    maidens: current.maidens ?? 0,
    runs: current.runs ?? 0,
    wickets: current.wickets ?? 0,
  };
}

async function fetchRecentBalls(rvMatchId: number, resultId: number, inningsNumber: number): Promise<BallEvent[]> {
  try {
    const url = `${RV_BASE}${RV_MASTER_ENTITY_ID}/matches/${rvMatchId}/?action=getballs&sportid=1&apiid=${RV_API_ID}&resultid=${resultId}&inningsnumber=${inningsNumber}`;
    const res = await rvFetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as RVBall[] | { Balls?: RVBall[] };
    const balls = Array.isArray(json) ? json : json.Balls ?? [];
    if (!balls.length) return [];
    // Take the last 6 in chronological order (assumed appended order).
    const tail = balls.slice(-6);
    return tail.map((b) => {
      const runs = b.total_runs ?? b.ball_runs ?? b.runs ?? 0;
      const isWicket = !!(b.is_wicket || (b.dismissal_id != null && b.dismissal_id > 0));
      const isFour = !!b.is_four || runs === 4;
      const isSix = !!b.is_six || runs === 6;
      const isWide = (b.wides ?? 0) > 0;
      const isNoBall = (b.no_balls ?? 0) > 0;
      return { runs, isWicket, isFour, isSix, isWide, isNoBall };
    });
  } catch {
    return [];
  }
}

function pickCurrentInnings(teams: RVTeam[]): { batting: RVTeam; bowling: RVTeam; innings: RVInnings | null } | null {
  if (teams.length < 2) return null;
  // Prefer the most recent innings_order across all teams, where status === 1
  // (open innings). Fall back to the highest innings_order regardless of status.
  let best: { team: RVTeam; innings: RVInnings } | null = null;
  for (const t of teams) {
    for (const i of t.Innings || []) {
      if (!best || i.innings_order > best.innings.innings_order) {
        best = { team: t, innings: i };
      }
    }
  }
  if (!best) return { batting: teams[0], bowling: teams[1], innings: null };
  const batting = best.team;
  const bowling = teams.find((t) => t !== batting) ?? teams[1];
  return { batting, bowling, innings: best.innings };
}

async function scrapeViaResultsVault(matchId: string, env: Env): Promise<Score> {
  try {
    const rvId = await resolveRvMatchId(matchId, env);
    if (!rvId) return failedScore(matchId, 'mapping_missing');
    const url = `${RV_BASE}${RV_MASTER_ENTITY_ID}/matches/${rvId}/?strmflg=3&apiid=${RV_API_ID}`;
    const res = await rvFetch(url);
    if (!res.ok) return failedScore(matchId, `rv_${res.status}`);
    const m = (await res.json()) as RVMatch;
    const picked = pickCurrentInnings(m.MatchTeams || []);
    if (!picked) return failedScore(matchId, 'no_teams');
    const innings = picked.innings;
    const battingTeam = picked.batting.team_name || (picked.batting.is_home ? m.home_name : m.away_name);
    const bowlingTeam = picked.bowling.team_name || (picked.bowling.is_home ? m.home_name : m.away_name);
    const status = rvStatus(m.status_id);

    const inningsNumber = innings?.innings_number ?? 1;
    const target =
      inningsNumber >= 2
        ? deriveTarget(m.MatchTeams || [], picked.batting)
        : undefined;

    const batters = extractBatters(innings?.PlayerPerfs);
    const bowler = extractBowler(innings?.PlayerPerfs);

    // Fire-and-forget recent-balls fetch when the batting team has a result_id.
    let recentBalls: BallEvent[] | undefined;
    if (innings && picked.batting.result_id) {
      const balls = await fetchRecentBalls(rvId, picked.batting.result_id, innings.innings_number);
      if (balls.length) recentBalls = balls;
    }

    const oversTotal =
      typeof m.MatchConfig?.max_overs === 'number' && m.MatchConfig.max_overs > 0
        ? m.MatchConfig.max_overs
        : undefined;

    const lastDismissal = extractLastDismissal(innings?.PlayerPerfs);
    const partnership = computePartnership(batters, innings?.runs ?? 0);
    const powerplay = computePowerplay(m.match_format_id, innings?.overs_bowled ?? 0);

    return {
      matchId,
      fetchedAt: new Date().toISOString(),
      status,
      innings: inningsNumber,
      battingTeam,
      bowlingTeam,
      runs: innings?.runs ?? 0,
      wickets: innings?.wickets ?? 0,
      overs: formatOvers(innings?.overs_bowled),
      ...(typeof target === 'number' ? { target } : {}),
      ...(typeof oversTotal === 'number' ? { oversTotal } : {}),
      ...(batters.length ? { batters } : {}),
      ...(bowler ? { bowler } : {}),
      ...(recentBalls ? { recentBalls } : {}),
      ...(lastDismissal ? { lastDismissal } : {}),
      ...(partnership ? { partnership } : {}),
      ...(powerplay ? { powerplay } : {}),
    };
  } catch (e) {
    return failedScore(matchId, e instanceof Error ? e.message : 'rv_error');
  }
}

function deriveTarget(teams: RVTeam[], batting: RVTeam): number | undefined {
  const otherInnings = teams
    .filter((t) => t !== batting)
    .flatMap((t) => t.Innings || [])
    .reduce((acc, i) => acc + (i.runs ?? 0), 0);
  return otherInnings > 0 ? otherInnings + 1 : undefined;
}

// ---------- Site API v2 path (with token) ----------------------------------
//
// Shape inferred from Play-Cricket's published Site API v2 docs (match_detail).
// Untested without a real token — adjust field names once we have a sample
// response. The structure here is intentionally defensive: every accessor
// has a fallback so a renamed field returns parse_failed rather than throwing.

type SiteAPIInnings = {
  innings_number?: number;
  team_batting_name?: string;
  runs?: number;
  wickets?: number;
  overs?: string | number;
};

type SiteAPIMatch = {
  id?: number;
  status?: string;
  match_status?: string;
  home_team_name?: string;
  away_team_name?: string;
  innings?: SiteAPIInnings[];
};

type SiteAPIResponse = {
  match_details?: SiteAPIMatch[];
};

async function scrapeViaSiteAPI(matchId: string, token: string): Promise<Score> {
  try {
    const url = `${SITE_API_BASE}match_detail.json?match_id=${encodeURIComponent(matchId)}&api_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return failedScore(matchId, `site_api_${res.status}`);
    const json = (await res.json()) as SiteAPIResponse;
    const match = json.match_details?.[0];
    if (!match) return failedScore(matchId, 'site_api_no_match');

    const innings = (match.innings || []).slice().sort(
      (a, b) => (b.innings_number ?? 0) - (a.innings_number ?? 0),
    );
    const current = innings[0];
    if (!current) return failedScore(matchId, 'site_api_no_innings');

    const battingTeam = current.team_batting_name ?? '';
    const bowlingTeam =
      [match.home_team_name, match.away_team_name].find((n) => n && n !== battingTeam) ?? '';

    const inningsNumber = current.innings_number ?? 1;
    const oversRaw = current.overs;
    const overs =
      typeof oversRaw === 'number' ? formatOvers(oversRaw) : String(oversRaw ?? '0.0');

    const previous = innings.find((i) => (i.innings_number ?? 0) < inningsNumber);
    const target =
      inningsNumber >= 2 && previous && typeof previous.runs === 'number'
        ? previous.runs + 1
        : undefined;

    return {
      matchId,
      fetchedAt: new Date().toISOString(),
      status: siteAPIStatus(match.status ?? match.match_status),
      innings: inningsNumber,
      battingTeam,
      bowlingTeam,
      runs: current.runs ?? 0,
      wickets: current.wickets ?? 0,
      overs,
      ...(typeof target === 'number' ? { target } : {}),
    };
  } catch (e) {
    return failedScore(matchId, e instanceof Error ? e.message : 'site_api_error');
  }
}

function siteAPIStatus(s: string | undefined): MatchStatus {
  if (!s) return 'unknown';
  const lower = s.toLowerCase();
  if (lower.includes('finished') || lower.includes('result') || lower.includes('complete')) return 'finished';
  if (lower.includes('live') || lower.includes('progress') || lower.includes('innings')) return 'live';
  if (lower.includes('break') || lower.includes('interval') || lower.includes('tea') || lower.includes('lunch')) return 'break';
  return 'unknown';
}
