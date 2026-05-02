import type { Env } from './types';

export type Sponsor = {
  name: string;
  imageUrl?: string;
  text?: string;
  durationMs?: number;
};

export type TeamBrand = {
  primary?: string;    // accent stripe colour
  secondary?: string;  // unused for now, future gradient stop
  crestUrl?: string;   // logo URL for the team
};

export type HeaderLogo = {
  imageUrl: string;
  alt?: string;
  height?: number; // px, default 84
};

export type HeaderConfig = {
  logos?: HeaderLogo[];
};

export type BrandingConfig = {
  sponsors: Sponsor[];
  teams: Record<string, TeamBrand>;
  header?: HeaderConfig;
};

function sponsorsKey(scope: string): string {
  return scope ? `branding:sponsors:${scope}` : 'branding:sponsors';
}
function teamsKey(scope: string): string {
  return scope ? `branding:teams:${scope}` : 'branding:teams';
}
function headerKey(scope: string): string {
  return scope ? `branding:header:${scope}` : 'branding:header';
}

const EMPTY: BrandingConfig = { sponsors: [], teams: {}, header: { logos: [] } };

export async function readBranding(env: Env, scope = ''): Promise<BrandingConfig> {
  try {
    const [sponsorsRaw, teamsRaw, headerRaw] = await Promise.all([
      env.CRICKET_CACHE.get(sponsorsKey(scope)),
      env.CRICKET_CACHE.get(teamsKey(scope)),
      env.CRICKET_CACHE.get(headerKey(scope)),
    ]);
    const sponsors = sponsorsRaw ? (JSON.parse(sponsorsRaw) as Sponsor[]) : [];
    const teams = teamsRaw ? (JSON.parse(teamsRaw) as Record<string, TeamBrand>) : {};
    const header = headerRaw ? (JSON.parse(headerRaw) as HeaderConfig) : { logos: [] };
    return { sponsors, teams, header };
  } catch {
    return EMPTY;
  }
}

export async function writeSponsors(env: Env, sponsors: Sponsor[], scope = ''): Promise<void> {
  await env.CRICKET_CACHE.put(sponsorsKey(scope), JSON.stringify(sponsors));
}

export async function writeTeams(env: Env, teams: Record<string, TeamBrand>, scope = ''): Promise<void> {
  await env.CRICKET_CACHE.put(teamsKey(scope), JSON.stringify(teams));
}

export async function writeHeader(env: Env, header: HeaderConfig, scope = ''): Promise<void> {
  await env.CRICKET_CACHE.put(headerKey(scope), JSON.stringify(header));
}
