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

export type BrandingConfig = {
  sponsors: Sponsor[];
  teams: Record<string, TeamBrand>;
  /** Optional footer text used by share cards and the summary page (e.g. your worker domain). */
  footerText?: string;
  /** Optional URL of a header logo (e.g. your club crest) shown on the overlay's left side. */
  headerLogoUrl?: string;
};

// Scoped KV keys: branding:sponsors  → default scope
//                 branding:sponsors:3s → 3rd XI scope
function sponsorsKey(scope: string): string {
  return scope ? `branding:sponsors:${scope}` : 'branding:sponsors';
}
function teamsKey(scope: string): string {
  return scope ? `branding:teams:${scope}` : 'branding:teams';
}
function metaKey(scope: string): string {
  return scope ? `branding:meta:${scope}` : 'branding:meta';
}

type BrandingMeta = { footerText?: string; headerLogoUrl?: string };

const EMPTY: BrandingConfig = { sponsors: [], teams: {} };

export async function readBranding(env: Env, scope = ''): Promise<BrandingConfig> {
  try {
    const [sponsorsRaw, teamsRaw, metaRaw] = await Promise.all([
      env.CRICKET_CACHE.get(sponsorsKey(scope)),
      env.CRICKET_CACHE.get(teamsKey(scope)),
      env.CRICKET_CACHE.get(metaKey(scope)),
    ]);
    const sponsors = sponsorsRaw ? (JSON.parse(sponsorsRaw) as Sponsor[]) : [];
    const teams = teamsRaw ? (JSON.parse(teamsRaw) as Record<string, TeamBrand>) : {};
    const meta = metaRaw ? (JSON.parse(metaRaw) as BrandingMeta) : {};
    return { sponsors, teams, footerText: meta.footerText, headerLogoUrl: meta.headerLogoUrl };
  } catch {
    return EMPTY;
  }
}

export async function writeBrandingMeta(env: Env, meta: BrandingMeta, scope = ''): Promise<void> {
  await env.CRICKET_CACHE.put(metaKey(scope), JSON.stringify(meta));
}

export async function writeSponsors(env: Env, sponsors: Sponsor[], scope = ''): Promise<void> {
  await env.CRICKET_CACHE.put(sponsorsKey(scope), JSON.stringify(sponsors));
}

export async function writeTeams(env: Env, teams: Record<string, TeamBrand>, scope = ''): Promise<void> {
  await env.CRICKET_CACHE.put(teamsKey(scope), JSON.stringify(teams));
}
