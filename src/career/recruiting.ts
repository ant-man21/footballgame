// Recruiting: colleges recruiting you. Your recruiting score (and stars) moves
// every week from your ratings for your class, how you're playing, and how your
// team is winning. Colleges whose level matches you take interest week by week
// (more if you're in their state and they need a quarterback); enough interest
// and they offer. Commit any time to a school that offered; you sign on signing
// day after your senior season. Colleges come from src/data/colleges.json.
import data from '../data/colleges.json';
import type { Difficulty } from '../settings';
import { clamp, rand } from '../util';

export type Tier = 'P4' | 'G5' | 'FCS';
export interface College {
  id: string;
  name: string;
  abbr: string;
  mascot: string;
  conference: string;
  division: 'FBS' | 'FCS';
  tier: Tier;
  prestige: number; // 1-100
  state: string;
  colors: [string, string];
  logo?: string;
}
export const COLLEGES: College[] = (data as unknown as { colleges: College[] }).colleges;
const BY_ID = new Map(COLLEGES.map((c) => [c.id, c]));
export const college = (id: string): College | undefined => BY_ID.get(id);
export const TIER_NAMES: Record<Tier, string> = { P4: 'POWER 4', G5: 'GROUP OF 5', FCS: 'FCS' };

/**
 * The recruiting score each star starts at (2, 3, 4, 5 stars), per difficulty.
 * Tuned so a person's season (grades ~65 a game) lands about a quarter of
 * careers at 4+ stars on PRO: a 7-0 defending champion is a 4-star, a title
 * run with better grades is a 5-star, a lazy season stays a 3-star.
 */
export const STAR_STEPS_BY_DIFFICULTY: Record<Difficulty, number[]> = {
  rookie: [3, 11, 23, 40],
  pro: [5, 14, 28, 46],
  allpro: [8, 18, 33, 52],
};
let steps = STAR_STEPS_BY_DIFFICULTY.pro;
/** Which difficulty's star steps to use (the career calls this from the current settings). */
export function useDifficulty(d: Difficulty): void { steps = STAR_STEPS_BY_DIFFICULTY[d] ?? STAR_STEPS_BY_DIFFICULTY.pro; }
export const starsFor = (score: number) => (score >= steps[3] ? 5 : score >= steps[2] ? 4 : score >= steps[1] ? 3 : score >= steps[0] ? 2 : 1);

/**
 * Colleges' bars (bar()) are on the original score scale, where the star steps
 * were 0 / 10 / 22 / 32. This maps a score onto that scale through the star
 * steps, so an N-star draws the same schools on any difficulty or formula.
 */
const OLD_STEPS = [0, 10, 22, 32];
export function barScale(score: number): number {
  if (score <= steps[0]) return OLD_STEPS[0] + (score - steps[0]);
  for (let i = 1; i < steps.length; i++) {
    if (score <= steps[i]) {
      const f = (score - steps[i - 1]) / (steps[i] - steps[i - 1]);
      return OLD_STEPS[i - 1] + f * (OLD_STEPS[i] - OLD_STEPS[i - 1]);
    }
  }
  return OLD_STEPS[3] + (score - steps[3]) * ((OLD_STEPS[3] - OLD_STEPS[2]) / (steps[3] - steps[2]));
}

/** How far you are from the next star (0-100), for a progress bar. */
export function toNextStar(score: number): number {
  const s = starsFor(score);
  if (s >= 5) return 100;
  const lo = s === 1 ? steps[0] - 10 : steps[s - 2], hi = steps[s - 1];
  return clamp(((score - lo) / (hi - lo)) * 100, 0, 100);
}

/**
 * The recruiting score a college wants from its quarterback. Power 4 schools
 * want 3 to 5 stars (the blue bloods 5), Group of 5 schools 2 to 3, FCS 1 to 2.
 */
export function bar(c: College): number {
  if (c.tier === 'P4') return 8 + (c.prestige - 55) * 0.55; // 55 -> 8, 75 -> 19, 98 -> 31.7
  if (c.tier === 'G5') return 0 + (c.prestige - 20) * 0.3; // 20 -> 0, 60 -> 12
  return -10 + c.prestige * 0.25; // 12 -> -7, 50 -> 2.5
}

export interface RecruitState {
  score: number;
  stars: number;
  interest: Record<string, number>; // college id -> 0-100
  need: Record<string, number>; // college id -> how badly it needs a QB this year (0.15-1)
  offers: string[]; // college ids, in the order they came
  committed: string | null;
  signed: string | null;
  visits: string[]; // official visits taken (college ids)
  formula?: number; // which version of the recruiting score this was computed with (see SCORE_FORMULA)
  lastVisit: string; // "year-week" of the last visit (one a week)
}

/** Bump when the recruiting score changes: saves scored by an older formula are re-scored once on load. */
export const SCORE_FORMULA = 4;

/** Official visits: five in a career, juniors and seniors, one a week. */
export const MAX_VISITS = 5;

/**
 * An official visit: the school gets a long look at you. Interest jumps; half the
 * time they leave sold on you as their quarterback (they need one now); and if
 * you're at their level they may offer on the spot. Returns the news.
 */
export function officialVisit(r: RecruitState, c: College): string[] {
  const news: string[] = [`OFFICIAL VISIT: ${c.name}`];
  r.visits.push(c.id);
  r.interest[c.id] = Math.min(100, (r.interest[c.id] ?? 0) + 30);
  if (Math.random() < 0.5) r.need[c.id] = Math.max(r.need[c.id] ?? 0, 0.6);
  const S = barScale(r.score), gap = S - bar(c);
  if (!r.offers.includes(c.id) && gap >= -4 && gap <= offerReach(S) + 4 && (r.need[c.id] ?? 0) >= 0.5 && Math.random() < 0.45) {
    r.offers.push(c.id);
    news.push(`OFFER: ${c.name}!`);
  } else if (!r.offers.includes(c.id)) news.push(gap < -4 ? 'GREAT VISIT, BUT THEY WANT MORE' : 'GREAT VISIT: THEY ARE INTERESTED');
  return news;
}

export function newRecruiting(): RecruitState {
  const r: RecruitState = { score: 0, stars: 1, interest: {}, need: {}, offers: [], committed: null, signed: null, visits: [], lastVisit: '', formula: SCORE_FORMULA };
  rollNeeds(r);
  return r;
}

/** Each year about one in five colleges is really after a quarterback (need >= 0.5); the rest just keep an eye out. */
export function rollNeeds(r: RecruitState): void {
  for (const c of COLLEGES) r.need[c.id] = Math.random() < NEED_SHARE ? rand(0.6, 1) : rand(0.15, 0.4);
}
const NEED_SHARE = 0.2;
const OFFER_CHANCE = 0.07; // per week, once a school is interested enough
/** A school offers when your score is between 2 under its bar and this far over it (better players hear from more schools). */
const offerReach = (score: number) => 5 + Math.max(0, score) * 0.3;

/**
 * A week of recruiting. Returns news ("OFFER: OREGON"). canOffer: juniors and
 * seniors get offers; sophomores only get noticed.
 */
export function recruitingWeek(r: RecruitState, homeState: string, canOffer: boolean): string[] {
  const news: string[] = [];
  const S = barScale(r.score); // on the colleges' bar scale
  for (const c of COLLEGES) {
    const T = bar(c), gap = S - T;
    let v = r.interest[c.id] ?? 0;
    if (gap < -6) v *= 0.9; // you're not at their level (yet)
    else {
      let gain = (4 + gap * 0.8 + rand(0, 4)) * (r.need[c.id] ?? 0.5);
      if (c.state === homeState) gain *= 1.4; // in-state schools watch you closest
      if (gap > 14) gain *= 0.3; // you're out of their league: they'd love to, but don't bother much
      if (r.committed && r.committed !== c.id) gain *= 0.4; // you're committed elsewhere
      v += Math.max(0, gain);
    }
    v = clamp(v, 0, canOffer ? 100 : 30); // sophomores only get noticed
    r.interest[c.id] = Math.round(v * 10) / 10;
    if (canOffer && !r.offers.includes(c.id) && v >= 60 && gap >= -2 && gap <= offerReach(S)
      && (r.need[c.id] ?? 0) >= 0.5 && Math.random() < OFFER_CHANCE) {
      r.offers.push(c.id);
      news.push(`OFFER: ${c.name}!`);
    }
  }
  return news;
}

/** The schools showing the most interest, best first (offers on top). */
export function board(r: RecruitState, n: number): College[] {
  return COLLEGES.filter((c) => (r.interest[c.id] ?? 0) >= 5 || r.offers.includes(c.id))
    .sort((a, b) => Number(r.offers.includes(b.id)) - Number(r.offers.includes(a.id))
      || (b.id === r.committed ? 1 : 0) - (a.id === r.committed ? 1 : 0)
      || (r.interest[b.id] ?? 0) - (r.interest[a.id] ?? 0) || b.prestige - a.prestige)
    .slice(0, n);
}

/** Offers, best program first. */
export const offerList = (r: RecruitState) => r.offers.map((id) => college(id)!).filter(Boolean).sort((a, b) => b.prestige - a.prestige);

/** No offers on signing day: schools that would take you as a preferred walk-on (the closest ones above your level). */
export function walkOns(r: RecruitState, homeState: string): College[] {
  const S = barScale(r.score); // on the colleges' bar scale
  const key = (c: College) => Math.abs(bar(c) - S - 3) - (c.state === homeState ? 2 : 0);
  return [...COLLEGES].sort((a, b) => key(a) - key(b)).slice(0, 4);
}
