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
  prod?: number; // recruiting production at the season's end (see production()); older saves estimate it
  signees?: { name: string; pos: string; school: string }[]; // teammates (seniors) who signed with colleges
  avg?: number; // average game grade
  balls?: { grade: number; label: string }[]; // game balls: games graded A or better
  rival?: 'W' | 'L'; // the rivalry game
  banquet?: import('./news').Banquet; // the end-of-season awards
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
/** Your jersey number (from your name, so it never changes). */
export const jerseyNo = (p: CareerPlayer) => [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19][[...(p.first + p.last)].reduce((t, ch) => (t * 31 + ch.charCodeAt(0)) % 100003, 7) % 18];

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

/** Recruiting score per win as the starter (see production). */
export const WIN_VALUE = 1.2;

/** Grade points a sack costs (see gradeGame). */
export const SACK_COST = 1;

/**
 * A game grade as a letter. An average game in this game grades ~60, a B-; a
 * strong one (75) an A-; 90+ an A+; below ~40 a D or worse.
 */
export function letterGrade(g: number): string {
  const steps: [number, string][] = [[90, 'A+'], [80, 'A'], [74, 'A-'], [69, 'B+'], [64, 'B'], [59, 'B-'], [55, 'C+'], [50, 'C'], [45, 'C-'], [40, 'D+'], [35, 'D'], [30, 'D-']];
  for (const [min, l] of steps) if (g >= min) return l;
  return 'F';
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
 * A sack costs 1 point (its lost yards already lower yards per throw in the
 * passer rating; at 3 a sack outweighed 4 points of completion percentage).
 */
export function gradeGame(s: TeamStats, won: boolean | null): number {
  if (!s.att && !s.sacks) return 50;
  let g = clamp((passerRating(s) - 40) * 0.85, 0, 100);
  g -= s.sacks * SACK_COST;
  if (won !== null) g += won ? 5 : -3;
  const weight = clamp((s.att + s.sacks) / 12, 0, 1);
  return Math.round(clamp(50 + (g - 50) * weight, 0, 100));
}

/** What a solid QB of your class looks like (overall), rising through the year (year 0 = sophomore, week 1-14). */
export const classNorm = (year: number, week = 1) => qbNormOvr(HS_TIER) - 4 + (year + clamp((week - 1) / 14, 0, 1)) * 4;

/**
 * Production for recruiting: how you played (grades count fully once you've
 * started 5 games), wins as the starter, playoff wins and a state title.
 */
export function production(avgGrade: number, starts: number, winsAsStarter: number, playoffWins: number, champion: boolean): number {
  // wins count as a winning rate on a 10-game pace: 7-0 reads like 10-0, not like 7 of 10
  const seen = clamp(starts / 5, 0.3, 1);
  const pace = starts ? (winsAsStarter / starts) * 10 : 0;
  return (avgGrade - 55) * 0.5 * seen + pace * WIN_VALUE * seen + playoffWins * 1.5 + (champion ? 4 : 0);
}

/** A finished season's production (for saves from before recruiting tracked it week by week). */
export function seasonProduction(sl: SeasonLine): number {
  if (sl.prod !== undefined) return sl.prod;
  // An estimate from the season summary (saves from before seasons stored it): the playoffs are
  // read from the finish, and a mid-season starter is assumed to have started the playoff games.
  const [w, l] = sl.record.split('-').map(Number);
  const games = Math.max(1, w + l);
  const poWins = sl.finish === 'STATE CHAMPIONS' ? 3 : sl.finish === 'STATE RUNNER-UP' ? 2 : sl.finish === 'LOST IN THE SEMIFINAL' ? 1 : 0;
  const poGames = sl.finish === 'MISSED THE PLAYOFFS' ? 0 : sl.finish === 'LOST IN THE QUARTERFINAL' ? 1 : sl.finish === 'LOST IN THE SEMIFINAL' ? 2 : 3;
  const poStarts = Math.min(poGames, sl.gs);
  const regWins = Math.round(w * clamp((sl.gs - poStarts) / games, 0, 1));
  const poWinsStarted = Math.min(poWins, poStarts);
  // a season's average game grade: the season's passer rating, sacks spread over the games, the win bonus
  const perGameSacks = sl.stats.sacks / Math.max(1, sl.gp);
  const winBonus = (5 * (w + poWins) - 3 * (l + poGames - poWins)) / Math.max(1, games + poGames);
  const grade = sl.stats.att ? clamp((passerRating(sl.stats) - 40) * 0.85, 0, 100) - perGameSacks * SACK_COST + winBonus : 55;
  return production(grade, sl.gs, regWins + poWinsStarted, poWinsStarted, sl.finish === 'STATE CHAMPIONS' && sl.gs >= 5);
}
