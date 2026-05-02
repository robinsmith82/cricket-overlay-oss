export type MatchStatus = 'live' | 'break' | 'finished' | 'unknown';

export type Batter = {
  name: string;
  runs: number;
  balls: number;
  notOut: boolean;
  onStrike?: boolean;
};

export type Bowler = {
  name: string;
  overs: string;
  maidens: number;
  runs: number;
  wickets: number;
};

export type BallEvent = {
  runs: number;          // total runs off the ball (incl. extras)
  isWicket?: boolean;
  isFour?: boolean;
  isSix?: boolean;
  isWide?: boolean;
  isNoBall?: boolean;
};

export type LastDismissal = {
  batter: string;
  runs: number;
  balls: number;
  dismissalText: string;
};

export type Partnership = {
  runs: number;
  balls: number;
};

export type Powerplay = 'PP1' | 'PP2' | null;

export type Score = {
  matchId: string;
  fetchedAt: string;
  status: MatchStatus;
  innings: number;
  battingTeam: string;
  bowlingTeam: string;
  runs: number;
  wickets: number;
  overs: string;
  target?: number;
  oversTotal?: number;
  batters?: Batter[];
  bowler?: Bowler;
  recentBalls?: BallEvent[];
  lastDismissal?: LastDismissal;
  partnership?: Partnership;
  powerplay?: Powerplay;
  error?: string;
  stale?: boolean;
};

export type Env = {
  CRICKET_CACHE: KVNamespace;
  PLAY_CRICKET_API_TOKEN?: string;
  ADMIN_KEY?: string;
  ADMIN_KEY_3S?: string;
  ADMIN_KEY_4S?: string;
};
