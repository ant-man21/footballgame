// Your player: a quarterback with a career. Ratings use the same 0-99 scale as
// every roster (ratings.ts); high school is a lower tier (HS_TIER), so a
// sophomore starts in the 50s and an average high school starter sits ~62.
import type { TeamStats } from '../drive';
import { type Player, type RatingKey, type Ratings, RATING_KEYS, normFor, overall } from '../ratings';
import { clamp, rand } from '../util';

export const HS_TIER = -16; // high school norms sit this far below the base game's
export const HS_CAP = 86; // the most a rating can grow to in high school
export const CLASS_NAMES = ['SOPHOMORE', 'JUNIOR', 'SENIOR'];
export const CLASS_SHORT = ['SO', 'JR', 'SR'];

export type Archetype = 'pocket' | 'gunslinger' | 'manager';
export const ARCHETYPES: { id: Archetype; name: string; note: string; base: Partial<Ratings> }[] = [
  { id: 'pocket', name: 'POCKET PASSER', note: 'ACCURATE, READS THE FIELD', base: { acc: 60, dec: 58, arm: 54, spd: 50 } },
  { id: 'gunslinger', name: 'GUNSLINGER', note: 'BIG ARM, TAKES CHANCES', base: { arm: 62, acc: 55, dec: 52, spd: 53 } },
  { id: 'manager', name: 'GAME MANAGER', note: 'SMART, PROTECTS THE BALL', base: { dec: 62, acc: 57, arm: 52, spd: 50 } },
];

export type Focus = 'acc' | 'arm' | 'dec';
export const FOCUSES: { id: Focus; name: string }[] = [
  { id: 'acc', name: 'ACCURACY' }, { id: 'arm', name: 'ARM' }, { id: 'dec', name: 'READS' },
];

/** One season of your career. */
export interface SeasonLine {
  year: number; // 0 = sophomore
  school: string;
  role: 'BACKUP' | 'STARTER';
  gp: number; // games you played in
  gs: number; // games you started
  stats: TeamStats; // your passing line
  record: string; // the team's record, e.g. "9-1"
  finish: string; // e.g. "STATE CHAMPIONS", "LOST IN SEMIFINAL", "MISSED PLAYOFFS"
  ovr: number; // your overall at season's end
  stars: number;
}

export interface CareerPlayer {
  first: string;
  last: string;
  archetype: Archetype;
  r: Ratings;
  xp: Partial<Record<RatingKey, number>>; // progress toward the next point in each rating
  growth: number; // hidden: how fast this player develops (0.85-1.15)
  seasons: SeasonLine[];
  awards: string[];
}

export function createPlayer(first: string, last: string, archetype: Archetype): CareerPlayer {
  const a = ARCHETYPES.find((x) => x.id === archetype)!;
  const r = {} as Ratings;
  for (const k of RATING_KEYS) r[k] = Math.round((a.base[k] ?? 45) + rand(-2, 2));
  return { first, last, archetype, r, xp: {}, growth: rand(0.85, 1.15), seasons: [], awards: [] };
}

export const displayName = (p: CareerPlayer) => `${p.first[0]}.${p.last}`;
export const qbOvr = (p: CareerPlayer) => overall('QB', p.r);

/** Your player as a roster player (the QB slot). */
export const asRosterPlayer = (p: CareerPlayer): Player => ({ slot: 'QB', pos: 'QB', name: displayName(p), r: { ...p.r }, ovr: qbOvr(p) });

/** The overall of an average QB at a tier. */
export const qbNormOvr = (tier: number) => {
  const r = {} as Ratings;
  for (const k of RATING_KEYS) r[k] = normFor('QB', k, tier);
  return overall('QB', r);
};

/** Adds progress to a rating; whole points roll over into the rating. Growth slows near the cap. */
export function addXp(p: CareerPlayer, k: RatingKey, amount: number, cap = HS_CAP): number {
  const slow = clamp((cap - p.r[k]) / 20, 0.15, 1);
  let x = (p.xp[k] ?? 0) + amount * p.growth * slow;
  let gained = 0;
  while (x >= 1 && p.r[k] < cap) { p.r[k]++; x -= 1; gained++; }
  p.xp[k] = p.r[k] >= cap ? 0 : x;
  return gained;
}

/** A week of practice: most of it goes into the focus. Returns the points gained per rating. */
export function practice(p: CareerPlayer, focus: Focus): Partial<Record<RatingKey, number>> {
  const out: Partial<Record<RatingKey, number>> = {};
  for (const k of ['acc', 'arm', 'dec'] as RatingKey[]) {
    const n = addXp(p, k, k === focus ? rand(0.35, 0.6) : rand(0.05, 0.12));
    if (n) out[k] = n;
  }
  return out;
}

/** Playing time teaches too: a good game more than a bad one. */
export function gameXp(p: CareerPlayer, grade: number, snaps: number): Partial<Record<RatingKey, number>> {
  const out: Partial<Record<RatingKey, number>> = {};
  const w = clamp(snaps / 25, 0.2, 1) * (0.25 + grade / 200);
  for (const k of ['acc', 'dec'] as RatingKey[]) { const n = addXp(p, k, w * rand(0.4, 0.7)); if (n) out[k] = n; }
  return out;
}

/** Off-season: a year older, stronger, better. */
export function offseason(p: CareerPlayer): void {
  for (const k of ['acc', 'arm', 'dec'] as RatingKey[]) addXp(p, k, rand(1, 3));
  addXp(p, 'spd', rand(0, 1.5));
}

/** NFL-style passer rating (0-158.3). */
export function passerRating(s: TeamStats): number {
  if (!s.att) return 0;
  const c = (x: number) => clamp(x, 0, 2.375);
  const a = c((s.cmp / s.att - 0.3) * 5), b = c((s.yards / s.att - 3) * 0.25), t = c((s.tds / s.att) * 20), i = c(2.375 - (s.int / s.att) * 25);
  return ((a + b + t + i) / 6) * 100;
}

/**
 * A game grade (0-100) from your line. An average line in this game (70%, 8 a
 * throw, a TD every dozen attempts, few picks) grades about 60. Few attempts
 * pull the grade toward 50; sacks and a loss cost a little, a win helps.
 */
export function gradeGame(s: TeamStats, won: boolean | null): number {
  if (!s.att && !s.sacks) return 50;
  let g = clamp((passerRating(s) - 40) * 0.85, 0, 100);
  g -= s.sacks * 3;
  if (won !== null) g += won ? 5 : -3;
  const weight = clamp((s.att + s.sacks) / 12, 0, 1);
  return Math.round(clamp(50 + (g - 50) * weight, 0, 100));
}

/** Recruiting stars (1-5): how good you are for your class, what you've done, and how your team did. */
export function starRating(p: CareerPlayer, year: number, seasonGrade: number, wins: number, started: boolean): number {
  const classNorm = qbNormOvr(HS_TIER) - 4 + year * 4; // what a solid QB of your class looks like
  const score = (qbOvr(p) - classNorm) * 2.2 + (seasonGrade - 55) * (started ? 0.5 : 0.15) + (started ? wins * 0.8 : 0);
  return score >= 32 ? 5 : score >= 22 ? 4 : score >= 10 ? 3 : score >= 0 ? 2 : 1;
}
