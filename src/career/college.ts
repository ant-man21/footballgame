// The college career (phase 1): your QB arrives at the school he signed with
// and plays up to five years (four seasons of eligibility; a freshman who plays
// four games or fewer keeps the year: a redshirt). Every FBS school is in the
// league with its real conference; FCS schools are guests on FBS schedules.
// Each season: 12 games (conference games by rotation, non-conference games
// matched week by week by level, distance and prestige), a weekly top 25,
// conference championship games, the 12-team playoff (the five highest-ranked
// conference champions plus the next seven, the top four seeds get a bye) and
// bowl games for the other teams with 6+ wins. Your week works like high
// school: win the job (the QB battle), play your snaps, the rest is quick-simmed.
import type { TeamStats } from '../drive';
import { newStats } from '../drive';
import { Match } from '../match';
import { type RatingKey, type Roster, makeRoster } from '../ratings';
import type { Difficulty } from '../settings';
import { clamp } from '../util';
import type { Appearance, CareerSave, Role } from './career';
import { STATES } from './hsnames';
import {
  type CareerPlayer, type Focus, asRosterPlayer, checkAbility, displayName, gameXp, gradeGame, offseason, practice, qbNormOvr, qbOvr,
} from './player';
import { type Units, overtimeWinner, simGame, simToEnd, simUntil } from './quicksim';
import { COLLEGES, type College, college } from './recruiting';
import { Rng } from './rng';

export const COLLEGE_KEY = 'footballgame.college.v1';
export const COLLEGE_VERSION = 1;
/** College norms sit this far below the base game's (a QB norm of about 70 overall). */
export const COLLEGE_TIER = -6;
/** The most a rating can grow to in college. */
export const COLLEGE_CAP = 94;

export const P4_CONFS = new Set(['SEC', 'BIG TEN', 'ACC', 'BIG 12']);
export const REGULAR_WEEKS = 13;
export const CCG_WEEK = 14;
export const POST_WEEK = 15; // bowls and the playoff's first round; quarterfinals 16, semifinals 17, the title 18
export const LAST_WEEK = 18;
export type CRound = 'R1' | 'QF' | 'SF' | 'F';
export const CFP_ROUNDS: CRound[] = ['R1', 'QF', 'SF', 'F'];
export const CFP_NAMES: Record<CRound, string> = { R1: 'CFP FIRST ROUND', QF: 'CFP QUARTERFINAL', SF: 'CFP SEMIFINAL', F: 'NATIONAL CHAMPIONSHIP' };
const QF_BOWLS = ['ROSE BOWL', 'SUGAR BOWL', 'ORANGE BOWL', 'COTTON BOWL'];
const SF_BOWLS = ['FIESTA BOWL', 'PEACH BOWL'];
const BOWLS = ['CITRUS BOWL', 'ALAMO BOWL', 'GATOR BOWL', 'MUSIC CITY BOWL', 'LAS VEGAS BOWL', 'HOLIDAY BOWL', 'SUN BOWL', 'LIBERTY BOWL',
  'PINSTRIPE BOWL', 'TEXAS BOWL', 'DUKES MAYO BOWL', 'ARMED FORCES BOWL', 'BIRMINGHAM BOWL', 'MILITARY BOWL', 'FENWAY BOWL', 'INDEPENDENCE BOWL',
  'GUARANTEED RATE BOWL', 'HOLIDAY BOWL', 'FIRST RESPONDER BOWL', 'GASPARILLA BOWL', 'HAWAII BOWL', 'BOCA RATON BOWL', 'NEW MEXICO BOWL',
  'CURE BOWL', 'MYRTLE BEACH BOWL', 'FAMOUS IDAHO POTATO BOWL', 'CAMELLIA BOWL', 'NEW ORLEANS BOWL', 'FRISCO BOWL', 'LA BOWL', 'ARIZONA BOWL'];

/** A school's strength this season (rating points vs the college norm). */
export interface CTeam { id: string; off: number; def: number }

export interface CGame {
  week: number;
  home: string;
  away: string;
  hs?: number;
  as?: number;
  ot?: boolean;
  conf?: boolean; // a conference game
  ccg?: string; // a conference championship game (the conference)
  round?: CRound; // the playoff
  fcs?: boolean; // the FCS playoff (otherwise the College Football Playoff)
  bowl?: string; // the bowl's name (bowls and the playoff's quarterfinals / semifinals)
  neutral?: boolean;
  box?: { home: TeamStats; away: TeamStats };
}

/** One of your games. */
export interface CLog {
  week: number; opp: string; home: boolean; us: number; them: number; ot: boolean;
  kind: Appearance; label: string; title: string; // title: e.g. "SEC CHAMPIONSHIP", "WEEK 3"
  line: TeamStats; grade: number | null; battle: number | null;
  gains: Partial<Record<RatingKey, number>>; news: string[];
}

/** One season of your college career. */
export interface CSeason {
  year: number; cls: string; school: string; role: 'STARTER' | 'BACKUP'; gp: number; gs: number; stats: TeamStats;
  record: string; finish: string; rank: number | null; ovr: number; avg?: number; awards: string[]; redshirt: boolean;
}

export interface CollegeSave {
  v: number;
  seed: number;
  schoolId: string;
  walkOn: boolean;
  hs: { school: string; state: string; stars: number }; // where he came from
  player: CareerPlayer; // ratings carry over (player.seasons are his high school seasons)
  teams: Record<string, CTeam>;
  year: number; // 0 = his first year on campus
  elig: number; // seasons of eligibility used (4 at most)
  redshirted: boolean;
  week: number; // the next week to play (1-18)
  games: CGame[];
  focus: Focus;
  role: Role;
  battle: number; // the QB battle meter (0-100) while a backup
  starter: { name: string; ovr: number } | null;
  dry: number; // weeks in a row a backup didn't get in
  log: CLog[];
  poll: string[]; // the top 25 (school ids), after the latest week
  pollPrev?: string[];
  field?: string[]; // the playoff's 12 seeds (FCS: the 8-team FCS playoff)
  phase: 'season' | 'summary' | 'done';
  roster: Roster;
  defense: 'play' | 'sim';
  calls: 'coach' | 'you';
  quarter: number;
  difficulty: Difficulty;
  seasons: CSeason[];
  awards: string[];
  headlines: string[]; // the latest week's news from around the country (yours first)
}

/** A game day ready to play. */
export interface CPlan {
  kind: Appearance; label: string; detail: string; title: string;
  match: Match; rec: CGame; opp: College; pre: TeamStats; endAtHalf: boolean;
  units: { you: Units; cpu: Units }; oppRoster: Roster;
}

const FBS = () => COLLEGES.filter((c) => c.division === 'FBS');
const FCS = () => COLLEGES.filter((c) => c.division === 'FCS');
const REGION_OF = new Map(STATES.map((st) => [st.id, st.region]));
export const played = (g: CGame) => g.hs !== undefined && g.as !== undefined;
export const winnerOf = (g: CGame) => (g.hs! > g.as! ? g.home : g.away);
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** A school's strength for the season: pulled toward its prestige, with turnover. */
function rollStrength(t: CTeam, c: College, rng: Rng, fresh: boolean): void {
  const target = (c.prestige - 55) / 6 - (c.division === 'FCS' ? 5 : 0);
  const base = fresh ? target + rng.range(-2.5, 2.5) : ((t.off + t.def) / 2) * 0.35 + target * 0.65 + rng.range(-2.5, 2.5);
  t.off = Math.round((base + rng.range(-2, 2)) * 10) / 10;
  t.def = Math.round((base + rng.range(-2, 2)) * 10) / 10;
}

/**
 * The regular season for every FBS school: 12 games in 13 weeks.
 * 1. Conference games (9 in the Power 4, 8 elsewhere, fewer in a small
 *    conference): rounds of a round robin over a shuffled order, on weeks
 *    picked for each conference between 4 and 13.
 * 2. Non-conference games fill each school to 12, week by week (weeks 1-3
 *    first, then the open weeks): the best available partner by level (Power 4
 *    schools buy games from the Group of 5), distance (same state, then the same
 *    region) and prestige, never a conference mate or a repeat. A Power 4 school
 *    plays at most one FCS team (often in week 1 or 2); FCS teams fill gaps.
 */
export function makeCollegeSchedule(rng: Rng): CGame[] {
  const fbs = FBS(), fcs = FCS(), all = [...fbs, ...fcs];
  const games: CGame[] = [];
  const busy = new Map<string, Set<number>>(all.map((c) => [c.id, new Set<number>()]));
  const count = new Map<string, number>(all.map((c) => [c.id, 0]));
  const homes = new Map<string, number>(all.map((c) => [c.id, 0]));
  const target = (c: College) => (c.division === 'FBS' ? 12 : 11); // FCS schools play 11
  const fcsGames = new Map<string, number>(fbs.map((c) => [c.id, 0]));
  const met = new Set<string>();
  const buys = new Map<string, number>(fbs.map((c) => [c.id, 0])); // Power 4 vs Group of 5 games
  const add = (week: number, a: string, b: string, conf: boolean) => {
    const ca = college(a)!, cb = college(b)!;
    // the bigger program hosts the buy game; otherwise whoever has fewer home games
    let home = a;
    if (cb.division === 'FCS') home = a;
    else if (ca.tier !== cb.tier && !conf) {
      const big = ca.tier === 'P4' ? a : cb.tier === 'P4' ? b : null;
      home = big && homes.get(big)! < 7 ? big : homes.get(a)! <= homes.get(b)! ? a : b; // the big program hosts (up to 7 home games)
      if (big) buys.set(big, buys.get(big)! + 1);
    }
    else home = homes.get(a)! < homes.get(b)! ? a : homes.get(a)! > homes.get(b)! ? b : rng.next() < 0.5 ? a : b;
    const away = home === a ? b : a;
    games.push({ week, home, away, conf: conf || undefined });
    for (const id of [a, b]) {
      busy.get(id)!.add(week);
      count.set(id, count.get(id)! + 1);
    }
    if (homes.has(home)) homes.set(home, homes.get(home)! + 1);
    met.add(pairKey(a, b));
  };
  const fcsFor = (a: College, week: number) => {
    const reg = REGION_OF.get(a.state);
    const open = fcs.filter((c) => !busy.get(c.id)!.has(week) && !met.has(pairKey(a.id, c.id)));
    const free = open.filter((c) => count.get(c.id)! < target(c));
    const pool = free.length ? free : open; // (an FCS school with a full schedule only as a last resort)
    const near = pool.filter((c) => REGION_OF.get(c.state) === reg);
    return near.length ? rng.pick(near) : pool.length ? rng.pick(pool) : null;
  };
  const playFcs = (week: number, a: College) => {
    const f = fcsFor(a, week);
    if (!f) return; // no FCS school is free that week
    add(week, a.id, f.id, false);
    fcsGames.set(a.id, fcsGames.get(a.id)! + 1);
  };

  // 1. conference games
  const confs = new Map<string, string[]>();
  for (const c of all) if (c.conference !== 'INDEPENDENT') confs.set(c.conference, [...(confs.get(c.conference) ?? []), c.id]);
  for (const [conf, list] of confs) {
    const ids: (string | null)[] = rng.shuffle([...list]);
    if (ids.length % 2) ids.push(null); // a bye
    const n = ids.length, k = Math.min(P4_CONFS.has(conf) ? 9 : 8, n - 1);
    const fixed = ids[0], rot = ids.slice(1);
    // each conference plays its rounds on its own weeks between 4 and 13 (so somebody is always open for the independents)
    const weeks = rng.shuffle([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]).slice(0, k).sort((x, y) => x - y);
    for (let round = 0; round < k; round++) {
      const line = [fixed, ...rot];
      for (let i = 0; i < n / 2; i++) {
        const a = line[i], b = line[n - 1 - i];
        if (a && b) add(weeks[round], a, b, true);
      }
      rot.unshift(rot.pop()!);
    }
  }
  // 2. non-conference games, week by week (FBS first: their FCS games fill FCS schedules too)
  const order = [1, 2, 3, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4];
  for (const week of order) {
    const pool = rng.shuffle(fbs.filter((c) => count.get(c.id)! < 12 && !busy.get(c.id)!.has(week)));
    while (pool.length) {
      const a = pool.shift()!;
      if (week <= 2 && a.tier === 'P4' && fcsGames.get(a.id)! === 0 && rng.next() < 0.45) { playFcs(week, a); continue; }
      let best = -1, bestS = -Infinity;
      pool.forEach((b, i) => {
        if ((b.conference === a.conference && a.conference !== 'INDEPENDENT') || met.has(pairKey(a.id, b.id))) return;
        const tiers = [a.tier, b.tier].sort().join('');
        const p4 = a.tier === 'P4' ? a : b.tier === 'P4' ? b : null;
        // a Power 4 school buys two or so games a year from the Group of 5, then plays its peers
        const fit = tiers === 'G5P4' ? (buys.get(p4!.id)! >= 2 ? 0.6 : 2.5) : tiers === 'P4P4' ? 1.6 : 2;
        const near = a.state === b.state ? 4 : REGION_OF.get(a.state) === REGION_OF.get(b.state) ? 1.5 : 0;
        const s = fit + near - Math.abs(a.prestige - b.prestige) / 30 + rng.next() * 2;
        if (s > bestS) { bestS = s; best = i; }
      });
      if (best >= 0) { add(week, a.id, pool[best].id, false); pool.splice(best, 1); }
      // independents have no conference weeks to fill: they take extra FCS games when nobody's free
      else if (fcsGames.get(a.id)! < (a.conference === 'INDEPENDENT' ? 2 : a.tier === 'P4' ? 1 : 2)) playFcs(week, a);
    }
  }
  // 3. FCS schools fill to 11 against each other (nearby first)
  for (const week of order) {
    const pool = rng.shuffle(fcs.filter((c) => count.get(c.id)! < 11 && !busy.get(c.id)!.has(week)));
    while (pool.length) {
      const a = pool.shift()!;
      let best = -1, bestS = -Infinity;
      pool.forEach((b, i) => {
        if (b.conference === a.conference || met.has(pairKey(a.id, b.id))) return;
        const sc = (a.state === b.state ? 4 : REGION_OF.get(a.state) === REGION_OF.get(b.state) ? 2 : 0) - Math.abs(a.prestige - b.prestige) / 30 + rng.next() * 2;
        if (sc > bestS) { bestS = sc; best = i; }
      });
      if (best >= 0) { add(week, a.id, pool[best].id, false); pool.splice(best, 1); }
    }
  }
  return games.sort((x, y) => x.week - y.week);
}

export interface CStanding { id: string; w: number; l: number; cw: number; cl: number; pf: number; pa: number }

/** Records from every game played (overall) and conference games. */
export function collegeStandings(games: CGame[]): Map<string, CStanding> {
  const out = new Map<string, CStanding>();
  const get = (id: string) => { let s = out.get(id); if (!s) out.set(id, s = { id, w: 0, l: 0, cw: 0, cl: 0, pf: 0, pa: 0 }); return s; };
  for (const g of games) {
    if (!played(g)) continue;
    const h = get(g.home), a = get(g.away), hw = g.hs! > g.as!;
    h.pf += g.hs!; h.pa += g.as!; a.pf += g.as!; a.pa += g.hs!;
    if (hw) { h.w++; a.l++; } else { a.w++; h.l++; }
    if (g.conf) { if (hw) { h.cw++; a.cl++; } else { a.cw++; h.cl++; } }
  }
  return out;
}

const pct = (w: number, l: number) => (w + l ? w / (w + l) : 0);

/** A conference's table: conference record, overall record, head to head, point differential. */
export function confOrder(conf: string, games: CGame[]): CStanding[] {
  const st = collegeStandings(games.filter((g) => !g.round && !g.bowl && !g.ccg));
  const ids = COLLEGES.filter((c) => c.conference === conf).map((c) => c.id);
  const rows = ids.map((id) => st.get(id) ?? { id, w: 0, l: 0, cw: 0, cl: 0, pf: 0, pa: 0 });
  const h2h = (a: string, b: string) => {
    let n = 0;
    for (const g of games) {
      if (!played(g) || !g.conf) continue;
      if ((g.home === a && g.away === b) || (g.home === b && g.away === a)) n += winnerOf(g) === a ? 1 : -1;
    }
    return n;
  };
  return rows.sort((a, b) => pct(b.cw, b.cl) - pct(a.cw, a.cl) || pct(b.w, b.l) - pct(a.w, a.l) || h2h(b.id, a.id)
    || (b.pf - b.pa) - (a.pf - a.pa) || a.id.localeCompare(b.id));
}

/**
 * The top 25 (and the full order, for the playoff): winning above all, then
 * margin, how good the team is, the schedule it played, and a Power 4 and
 * conference title bump. Preseason: strength and prestige.
 */
export function collegePoll(teams: Record<string, CTeam>, games: CGame[], division: 'FBS' | 'FCS' = 'FBS'): string[] {
  const list = COLLEGES.filter((c) => c.division === division);
  const st = collegeStandings(games);
  const strength = (id: string) => (teams[id] ? (teams[id].off + teams[id].def) / 2 : -6);
  const titles = new Map<string, number>();
  for (const g of games) if ((g.ccg || (g.fcs && g.round === 'F')) && played(g)) titles.set(winnerOf(g), 1);
  const sos = new Map<string, number>();
  for (const c of list) {
    const opps = games.filter((g) => played(g) && (g.home === c.id || g.away === c.id)).map((g) => (g.home === c.id ? g.away : g.home));
    if (!opps.length) { sos.set(c.id, 0); continue; }
    sos.set(c.id, opps.reduce((t, o) => { const s = st.get(o); return t + (s ? pct(s.w, s.l) * 8 : 0) + strength(o) * 0.4; }, 0) / opps.length);
  }
  const score = (c: College) => {
    const s = st.get(c.id), gp = s ? s.w + s.l : 0;
    if (!gp) return strength(c.id) + (c.tier === 'P4' ? 1.5 : 0) + c.prestige * 0.02;
    const margin = clamp((s!.pf - s!.pa) / gp, -24, 24);
    return pct(s!.w, s!.l) * 26 + margin * 0.18 + strength(c.id) * 0.45 + sos.get(c.id)! * 0.5 + (c.tier === 'P4' ? 1.5 : 0) + (titles.get(c.id) ?? 0) * 2.5;
  };
  return list.map((c) => ({ id: c.id, v: score(c) })).sort((a, b) => b.v - a.v).map((x) => x.id);
}

/** Conference championship games: the top two of each conference (not the independents). */
export function makeChampionships(games: CGame[]): CGame[] {
  const confs = [...new Set(FBS().map((c) => c.conference))].filter((x) => x !== 'INDEPENDENT'); // (FCS conferences have no title game)
  return confs.map((conf) => {
    const [a, b] = confOrder(conf, games);
    return { week: CCG_WEEK, home: a.id, away: b.id, conf: true, ccg: conf, neutral: true };
  });
}

/** The 12-team field: the five highest-ranked conference champions plus the next seven, seeded by the ranking. */
export function playoffField(order: string[], games: CGame[]): string[] {
  const champs = games.filter((g) => g.ccg && played(g)).map(winnerOf);
  const rankOf = (id: string) => order.indexOf(id);
  const auto = champs.sort((a, b) => rankOf(a) - rankOf(b)).slice(0, 5);
  const rest = order.filter((id) => !auto.includes(id)).slice(0, 7);
  return [...auto, ...rest].sort((a, b) => rankOf(a) - rankOf(b));
}

/** The playoff's first round (seeds 5-12; 1-4 have a bye) and the bowls for everyone else with 6+ wins. */
export function makePostseason(order: string[], field: string[], games: CGame[], rng: Rng): CGame[] {
  const out: CGame[] = [];
  for (const [hi, lo] of [[4, 11], [5, 10], [6, 9], [7, 8]]) out.push({ week: POST_WEEK, home: field[hi], away: field[lo], round: 'R1' });
  const st = collegeStandings(games);
  const eligible = order.filter((id) => !field.includes(id) && (st.get(id)?.w ?? 0) >= 6);
  const names = rng.shuffle([...BOWLS]);
  for (let i = 0; i + 1 < eligible.length && i / 2 < names.length; i += 2) {
    out.push({ week: POST_WEEK, home: eligible[i], away: eligible[i + 1], bowl: names[i / 2], neutral: true });
  }
  return out;
}

/** The next playoff round once one is complete (null if none). Quarterfinals: 1 v 8/9, 2 v 7/10, 3 v 6/11, 4 v 5/12. */
export function nextPlayoffRound(games: CGame[], field: string[]): CGame[] | null {
  const seed = (id: string) => field.indexOf(id);
  const cfp = games.filter((g) => !g.fcs);
  const r1 = cfp.filter((g) => g.round === 'R1'), qf = cfp.filter((g) => g.round === 'QF'), sf = cfp.filter((g) => g.round === 'SF');
  if (r1.length && r1.every(played) && !qf.length) {
    const winner = (a: number, b: number) => winnerOf(r1.find((g) => (seed(g.home) === a || seed(g.home) === b))!);
    return [[0, 7, 8], [1, 6, 9], [2, 5, 10], [3, 4, 11]].map(([top, a, b], i) =>
      ({ week: POST_WEEK + 1, home: field[top], away: winner(a, b), round: 'QF' as CRound, bowl: QF_BOWLS[i], neutral: true }));
  }
  if (qf.length && qf.every(played) && !sf.length) {
    const w = qf.map(winnerOf); // QF order: 1, 2, 3, 4 sides -> 1/4 side vs 2/3 side
    return [{ week: POST_WEEK + 2, home: w[0], away: w[3], round: 'SF', bowl: SF_BOWLS[0], neutral: true },
      { week: POST_WEEK + 2, home: w[1], away: w[2], round: 'SF', bowl: SF_BOWLS[1], neutral: true }];
  }
  if (sf.length && sf.every(played) && !cfp.some((g) => g.round === 'F')) {
    const [a, b] = sf.map(winnerOf);
    return [{ week: LAST_WEEK, home: seed(a) <= seed(b) ? a : b, away: seed(a) <= seed(b) ? b : a, round: 'F', neutral: true }];
  }
  return null;
}

/** The FCS playoff: the top 8 of the FCS ranking (QF week 15, SF 16, the title 17); the next round when one is done. */
export const FCS_ROUNDS: CRound[] = ['QF', 'SF', 'F'];
export function fcsPlayoff(games: CGame[], order: string[]): CGame[] | null {
  const fg = games.filter((g) => g.fcs);
  if (!fg.length) {
    const f = order.slice(0, 8);
    return [[0, 7], [3, 4], [1, 6], [2, 5]].map(([a, b]) => ({ week: POST_WEEK, home: f[a], away: f[b], round: 'QF' as CRound, fcs: true }));
  }
  for (const [i, round] of FCS_ROUNDS.entries()) {
    const these = fg.filter((g) => g.round === round), next = FCS_ROUNDS[i + 1];
    if (!next || fg.some((g) => g.round === next)) continue;
    if (!these.length || !these.every(played)) return null;
    const w = these.map(winnerOf), out: CGame[] = [];
    for (let k = 0; k < w.length; k += 2) out.push({ week: these[0].week + 1, home: w[k], away: w[k + 1], round: next, fcs: true, neutral: next === 'F' });
    return out;
  }
  return null;
}

/** A game's name for the screens. */
export function gameTitle(g: CGame): string {
  if (g.fcs) return g.round === 'F' ? 'FCS NATIONAL CHAMPIONSHIP' : g.round === 'SF' ? 'FCS PLAYOFF SEMIFINAL' : 'FCS PLAYOFF QUARTERFINAL';
  if (g.round === 'F') return CFP_NAMES.F;
  if (g.round) return `${CFP_NAMES[g.round]}${g.bowl ? ` - ${g.bowl}` : ''}`;
  if (g.bowl) return g.bowl;
  if (g.ccg) return `${g.ccg} CHAMPIONSHIP`;
  return `WEEK ${g.week}${g.conf ? '' : ' - NON-CONFERENCE'}`;
}

const CLASS = ['FR', 'SO', 'JR', 'SR'];
const STARTER_FIRST = 'ABCDEFGHJKLMNPRSTW';
const STARTER_LAST = ['ALLEN', 'BRADY', 'COOK', 'DIXON', 'ELLIOTT', 'FIELDS', 'GRANT', 'HOWARD', 'IRVING', 'JORDAN', 'KING', 'LEWIS', 'MASON', 'NOLAN', 'PAYNE', 'REESE', 'SANDERS', 'TURNER', 'WALLACE', 'YOUNG'];

export class CollegeCareer {
  constructor(public s: CollegeSave) {}

  /** A graduated high school career signs in: his first year on campus. */
  static fromHighSchool(hs: CareerSave): CollegeCareer {
    const id = hs.recruit.signed!;
    const seed = (hs.seed ^ 0x2c011e9e) | 0;
    const rng = new Rng(seed);
    const teams: Record<string, CTeam> = {};
    for (const c of COLLEGES) { const t = { id: c.id, off: 0, def: 0 }; rollStrength(t, c, rng, true); teams[c.id] = t; }
    const player = JSON.parse(JSON.stringify(hs.player)) as CareerPlayer;
    const s: CollegeSave = {
      v: COLLEGE_VERSION, seed, schoolId: id, walkOn: !hs.recruit.offers.includes(id),
      hs: { school: hs.teams[hs.schoolId].name, state: hs.state, stars: hs.recruit.stars },
      player, teams, year: 0, elig: 0, redshirted: false, week: 1, games: [], focus: 'acc', role: 'backup', battle: 0,
      starter: null, dry: 0, log: [], poll: [], phase: 'season', roster: makeRoster(college(id)!.name, 0, COLLEGE_TIER),
      defense: hs.defense, calls: hs.calls, quarter: hs.quarter, difficulty: hs.difficulty ?? 'pro', seasons: [], awards: [], headlines: [],
    };
    const c = new CollegeCareer(s);
    c.startSeason(new Rng(seed + 1));
    saveCollege(s);
    return c;
  }

  // ---------- lookups ----------
  get player(): CareerPlayer { return this.s.player; }
  get school(): College { return college(this.s.schoolId)!; }
  get conf(): string { return this.school.conference; }
  get fcs(): boolean { return this.school.division === 'FCS'; }
  /** The ranking for your division (FBS or FCS). */
  private poll(): string[] { return collegePoll(this.s.teams, this.s.games, this.fcs ? 'FCS' : 'FBS'); }
  team(id: string): College { return college(id)!; }
  get oppShift(): number { return { rookie: -3, pro: 0, allpro: 3 }[this.s.difficulty] ?? 0; }
  /** FR / RS FR / SO ... */
  get classLabel(): string { return `${this.s.redshirted ? 'RS ' : ''}${CLASS[Math.min(3, this.s.elig)]}`; }
  get nextGame(): CGame | null {
    if (this.s.phase !== 'season') return null;
    return this.s.games.find((g) => g.week === this.s.week && this.mine(g) && !played(g)) ?? null;
  }
  mine(g: CGame): boolean { return g.home === this.s.schoolId || g.away === this.s.schoolId; }
  opponentOf(g: CGame): string { return g.home === this.s.schoolId ? g.away : g.home; }
  record(id = this.s.schoolId): { w: number; l: number; cw: number; cl: number; text: string } {
    const st = collegeStandings(this.s.games).get(id) ?? { w: 0, l: 0, cw: 0, cl: 0 };
    return { w: st.w, l: st.l, cw: st.cw, cl: st.cl, text: `${st.w}-${st.l}` };
  }
  /** A school's place in the top 25 (null if unranked). */
  rank(id: string): number | null { const i = this.s.poll.indexOf(id); return i >= 0 && i < 25 ? i + 1 : null; }
  /** A team's name with its ranking: "NO.4 ALABAMA". */
  label(id: string): string { const r = this.rank(id); return `${r ? `NO.${r} ` : ''}${this.team(id).name}`; }
  units(id: string, qb?: number): Units {
    const t = this.s.teams[id], edge = qb === undefined ? 0 : (qb - qbNormOvr(COLLEGE_TIER)) * 0.5;
    return { off: t.off + edge, def: t.def };
  }
  get starterOvr(): number { return this.s.role === 'starter' || !this.s.starter ? qbOvr(this.player) : this.s.starter.ovr; }
  rosterWithYou(): Roster {
    const r = this.s.roster;
    return { ...r, players: r.players.map((p) => (p.slot === 'QB' ? asRosterPlayer(this.player) : p)) };
  }

  // ---------- the season ----------

  private startSeason(rng: Rng): void {
    const s = this.s, sc = this.school;
    s.games = makeCollegeSchedule(rng);
    s.week = 1; s.log = []; s.dry = 0; s.field = undefined; s.pollPrev = undefined;
    s.poll = this.poll();
    s.phase = 'season';
    const me = s.teams[sc.id];
    s.roster = makeRoster(sc.name, (me.off + me.def) / 2, COLLEGE_TIER);
    const mine = displayName(this.player);
    for (const pl of s.roster.players) if (pl.name === mine) pl.name = `${pl.name[0]}.${rng.pick(STARTER_LAST)}`;
    if (s.role !== 'starter') {
      // the QB ahead of you: better at a better program; a returning starter if you were behind him last year
      const norm = qbNormOvr(COLLEGE_TIER), prog = (sc.prestige - 60) / 12;
      const returning = s.starter && rng.next() < 0.5;
      const ovr = returning ? s.starter!.ovr + rng.int(1, 3) : Math.round(norm + prog + rng.range(0, 4));
      const name = returning ? s.starter!.name : `${STARTER_FIRST[rng.int(0, STARTER_FIRST.length - 1)]}.${rng.pick(STARTER_LAST)}`;
      s.starter = { name, ovr };
      s.battle = s.year === 0 ? (s.walkOn ? 5 : 20) : Math.round(clamp(s.battle * 0.7 + 15, 15, 75));
      if (qbOvr(this.player) >= ovr + 4 && s.year > 0) { s.role = 'starter'; s.starter = null; } // you've passed him in the off-season
    }
    s.headlines = [`${sc.name} OPENS NO.${s.poll.indexOf(sc.id) + 1} IN THE PRESEASON POLL`];
    this.skipByes([]);
  }

  /** Sets up this week's game: a starter plays it all; a backup watches until a moment he's needed. */
  prepareGame(): CPlan | null {
    const rec = this.nextGame;
    if (!rec) return null;
    const s = this.s, oppId = this.opponentOf(rec), opp = this.team(oppId);
    const youU = this.units(s.schoolId, qbOvr(this.player)), oppU = this.units(oppId);
    const m = new Match(Math.random() < 0.5 ? 'you' : 'cpu', s.quarter);
    m.names = { you: this.school.abbr, cpu: opp.abbr };
    const t = s.teams[oppId], oppRoster = makeRoster(opp.name, (t.off + t.def) / 2 + this.oppShift, COLLEGE_TIER);
    const title = gameTitle(rec);
    const plan = (kind: Appearance, label: string, detail: string, endAtHalf = false): CPlan =>
      ({ kind, label, detail, title, match: m, rec, opp, pre: { ...m.stats.you }, endAtHalf, units: { you: youU, cpu: oppU }, oppRoster });
    if (s.role === 'starter') return plan('full', 'YOU START', `${this.school.mascot} VS ${opp.mascot}`);
    const withStarter = { you: this.units(s.schoolId, this.starterOvr), cpu: oppU };
    const meter = s.battle / 100;
    simUntil(m, withStarter, (x) => x.quarter >= 3 || (x.quarter === 2 && x.clock <= 120));
    if (!m.over && m.quarter === 2 && Math.random() < 0.05 + meter * 0.06) return plan('scenario', 'TWO-MINUTE DRILL', 'THE STARTER IS SHAKEN UP. FINISH THE HALF', true);
    simUntil(m, withStarter, (x) => x.quarter >= 3);
    const lead = () => m.score.you - m.score.cpu;
    if (!m.over && Math.random() < 0.04 + (lead() <= -14 ? 0.15 : 0) + meter * 0.12) {
      return plan('scenario', 'RELIEF', lead() < 0 ? 'THE STARTER IS STRUGGLING. THE 2ND HALF IS YOURS' : 'COACH WANTS A LOOK AT YOU. THE 2ND HALF IS YOURS');
    }
    simUntil(m, withStarter, (x) => x.quarter >= 4);
    if (!m.over && (Math.abs(lead()) >= 21 || (s.dry >= 3 && Math.random() < 0.5))) {
      return plan('scenario', 'MOP-UP DUTY', Math.abs(lead()) >= 21 ? 'THE GAME IS DECIDED. THE 4TH QUARTER IS YOURS' : 'COACH WANTS TO SEE YOU IN THE 4TH QUARTER');
    }
    simToEnd(m, withStarter);
    return plan('none', 'ON THE SIDELINE', 'YOU DID NOT GET IN THIS WEEK');
  }

  /** After your part: finish the game, record it, run the rest of the week and move on. */
  finishGame(plan: CPlan, stint?: TeamStats): CLog {
    const s = this.s, m = plan.match, rec = plan.rec;
    const after = stint ? { ...stint } : { ...m.stats.you };
    if (!m.over) simToEnd(m, { you: this.units(s.schoolId, this.starterOvr), cpu: plan.units.cpu });
    let us = m.score.you, them = m.score.cpu, ot = m.ot > 0;
    if (us === them) { ot = true; if (overtimeWinner(plan.units.you, plan.units.cpu) === 'a') us += 7; else them += 7; }
    const home = rec.home === s.schoolId;
    rec.hs = home ? us : them; rec.as = home ? them : us; rec.ot = ot;
    rec.box = home ? { home: { ...m.stats.you }, away: { ...m.stats.cpu } } : { home: { ...m.stats.cpu }, away: { ...m.stats.you } };
    const line = plan.kind === 'none' ? newStats() : diffStats(after, plan.pre);
    const won = us > them;
    const grade = plan.kind === 'none' ? null : gradeGame(line, plan.kind === 'full' ? won : null);
    const gains: Partial<Record<RatingKey, number>> = {};
    const add = (g: Partial<Record<RatingKey, number>>) => { for (const [k, n] of Object.entries(g) as [RatingKey, number][]) gains[k] = (gains[k] ?? 0) + n; };
    add(practice(this.player, s.focus, COLLEGE_CAP));
    if (grade !== null) add(gameXp(this.player, grade, line.att + line.sacks + (line.rush ?? 0), line.rush ?? 0, COLLEGE_CAP));
    const news: string[] = [];
    const earned = checkAbility(this.player);
    if (earned) news.push(earned);
    let battle: number | null = null;
    if (s.role === 'backup' && s.starter) {
      const w = grade === null ? 0 : clamp((line.att + line.sacks) / 10, 0.3, 1.2);
      const delta = (grade === null ? 0 : (grade - 50) * 0.7 * w) + 4 + (qbOvr(this.player) - s.starter.ovr) * 0.5;
      s.battle = Math.round(clamp(s.battle + delta, 0, 100));
      battle = s.battle;
      if (s.battle >= 100) { s.role = 'starter'; news.push('YOU WON THE STARTING JOB!'); s.starter = null; }
      s.dry = plan.kind === 'none' ? s.dry + 1 : 0;
    }
    const log: CLog = { week: rec.week, opp: plan.opp.id, home, us, them, ot, kind: plan.kind, label: plan.label, title: plan.title, line, grade, battle, gains, news };
    s.log.push(log);
    if (rec.round === 'F' && won) news.push('NATIONAL CHAMPIONS!');
    else if (rec.ccg && won) news.push(`${rec.ccg} CHAMPIONS!`);
    else if (rec.bowl && !rec.round && won) news.push(`${rec.bowl} CHAMPIONS!`);
    this.simWeek(rec.week);
    this.advance(news);
    saveCollege(s);
    return log;
  }

  private simGameRec(g: CGame): void {
    const uh = this.units(g.home, g.home === this.s.schoolId ? this.starterOvr : undefined);
    const ua = this.units(g.away, g.away === this.s.schoolId ? this.starterOvr : undefined);
    const m = simGame(uh, ua, this.s.quarter);
    let hs = m.score.you, as = m.score.cpu;
    g.ot = m.ot > 0 || hs === as;
    if (hs === as) { if (overtimeWinner(uh, ua) === 'a') hs += 7; else as += 7; }
    g.hs = hs; g.as = as;
  }

  /** Every other game of the week. */
  private simWeek(week: number): void {
    for (const g of this.s.games) if (g.week === week && !played(g)) this.simGameRec(g);
  }

  /**
   * On to the next week: championship week after the regular season, the
   * playoff field and the bowls after that, the next playoff rounds. Weeks
   * without a game for you (a bye, or your season is over) are simulated.
   */
  private advance(news: string[]): void {
    const s = this.s;
    s.week++;
    this.addPostseason(news);
    this.skipByes(news);
    s.pollPrev = s.poll;
    s.poll = this.poll();
    s.headlines = [...news, ...this.aroundTheCountry()].slice(0, 6);
  }

  /** Builds the postseason games when their week comes. */
  private addPostseason(news: string[]): void {
    const s = this.s, me = s.schoolId;
    if (s.week === CCG_WEEK && !s.games.some((g) => g.ccg)) {
      const ccg = makeChampionships(s.games);
      s.games.push(...ccg);
      const mine = ccg.find((g) => this.mine(g));
      if (mine) news.push(`YOU'RE IN THE ${mine.ccg} CHAMPIONSHIP!`);
    }
    if (s.week === POST_WEEK && !s.field) {
      const order = collegePoll(s.teams, s.games, 'FBS');
      s.field = playoffField(order, s.games);
      s.games.push(...makePostseason(order, s.field, s.games, new Rng(s.seed + s.year * 31 + 7)));
      const seed = s.field.indexOf(me);
      if (this.fcs) { /* the FCS playoff is set below */ } else if (seed >= 0) news.push(`IN THE COLLEGE FOOTBALL PLAYOFF: NO.${seed + 1} SEED${seed < 4 ? ' (A BYE)' : ''}!`);
      else { const b = s.games.find((g) => g.bowl && !g.round && this.mine(g)); news.push(b ? `BOWL BID: THE ${b.bowl}` : 'NO BOWL THIS YEAR'); }
    }
    if (s.week > POST_WEEK && s.field) {
      const nr = nextPlayoffRound(s.games, s.field);
      if (nr) s.games.push(...nr);
    }
    // the FCS playoff (top 8 of the FCS ranking)
    if (s.week >= POST_WEEK && s.week <= POST_WEEK + 2) {
      const fp = fcsPlayoff(s.games, collegePoll(s.teams, s.games, 'FCS'));
      if (fp) {
        s.games.push(...fp);
        if (this.fcs && fp.some((g) => this.mine(g)) && fp[0].round === 'QF') news.push('IN THE FCS PLAYOFF!');
      }
    }
  }

  /** Simulates weeks with no game for you (byes, or once your season is over) and ends the season after the title game. */
  private skipByes(news: string[]): void {
    const s = this.s;
    let guard = 0;
    while (s.phase === 'season' && !this.nextGame && guard++ < 30) {
      if (s.week > LAST_WEEK || (s.week === LAST_WEEK && s.games.some((g) => g.round === 'F' && played(g)))) { this.endSeason(news); return; }
      const hasGames = s.games.some((g) => g.week === s.week);
      if (s.week <= REGULAR_WEEKS && hasGames && !news.includes('BYE WEEK')) news.push('BYE WEEK');
      this.simWeek(s.week);
      s.week++;
      this.addPostseason(news);
    }
  }

  /** The week's notable results: ranked teams losing, the playoff, the title. */
  private aroundTheCountry(): string[] {
    const s = this.s, wk = s.week - 1, out: string[] = [];
    const prev = s.pollPrev ?? s.poll;
    const rk = (id: string) => { const i = prev.indexOf(id); return i >= 0 && i < 25 ? i + 1 : null; };
    for (const g of s.games) {
      if (g.week !== wk || !played(g) || this.mine(g)) continue;
      const w = winnerOf(g), l = w === g.home ? g.away : g.home, score = `${Math.max(g.hs!, g.as!)}-${Math.min(g.hs!, g.as!)}`;
      if (g.round === 'F') out.push(`${this.team(w).name} WIN THE NATIONAL TITLE, ${score}`);
      else if (g.ccg) out.push(`${this.team(w).name} WIN THE ${g.ccg}, ${score}`);
      else if (rk(l) && (!rk(w) || rk(w)! > rk(l)! + 5)) out.push(`UPSET: ${this.team(w).name} STUN NO.${rk(l)} ${this.team(l).name}, ${score}`);
    }
    return out.slice(0, 4);
  }

  /** How your season ended, in words. */
  finish(): string {
    const s = this.s, mine = s.games.filter((g) => this.mine(g) && played(g));
    const f = mine.find((g) => g.round === 'F');
    if (f) return winnerOf(f) === s.schoolId ? `${f.fcs ? 'FCS ' : ''}NATIONAL CHAMPIONS` : `${f.fcs ? 'FCS ' : ''}NATIONAL RUNNER-UP`;
    const po = mine.filter((g) => g.round);
    if (po.length) return `LOST IN THE ${gameTitle(po[po.length - 1]).replace(/ - .*/, '')}`;
    const bowl = mine.find((g) => g.bowl);
    if (bowl) return winnerOf(bowl) === s.schoolId ? `WON THE ${bowl.bowl}` : `LOST THE ${bowl.bowl}`;
    const ccg = mine.find((g) => g.ccg);
    if (ccg) return winnerOf(ccg) === s.schoolId ? `${ccg.ccg} CHAMPIONS` : `LOST THE ${ccg.ccg} TITLE GAME`;
    if (this.fcs) return 'MISSED THE FCS PLAYOFF';
    return this.record().w >= 6 ? 'NO BOWL' : 'MISSED A BOWL';
  }

  private endSeason(news: string[]): void {
    const s = this.s, p = this.player;
    const line = newStats();
    let gp = 0, gs = 0, sum = 0, n = 0;
    for (const l of s.log) {
      if (l.kind !== 'none') gp++;
      if (l.kind === 'full') gs++;
      for (const k of Object.keys(line) as (keyof TeamStats)[]) line[k] += l.line[k] ?? 0;
      if (l.grade !== null) { sum += l.grade; n++; }
    }
    const avg = n ? sum / n : 50;
    const finalOrder = this.poll();
    const rank = finalOrder.indexOf(s.schoolId) + 1;
    const awards: string[] = [];
    const mine = s.games.filter((g) => this.mine(g) && played(g));
    const fin = this.finish();
    if (fin.endsWith('NATIONAL CHAMPIONS')) awards.push(fin.replace('CHAMPIONS', 'CHAMPION'));
    if (mine.some((g) => g.ccg && winnerOf(g) === s.schoolId) || (this.fcs && confOrder(this.conf, s.games)[0]?.id === s.schoolId)) awards.push(`${this.conf} CHAMPION`);
    if (mine.some((g) => g.round)) awards.push(this.fcs ? 'FCS PLAYOFF' : 'COLLEGE FOOTBALL PLAYOFF');
    const bowl = mine.find((g) => g.bowl && !g.round && winnerOf(g) === s.schoolId);
    if (bowl) awards.push(`${bowl.bowl} CHAMPION`);
    if (this.fcs) { if (gs >= 9 && avg >= 80 && rank <= 10) awards.push('WALTER PAYTON AWARD'); } // the FCS player of the year
    else if (gs >= 11 && avg >= 86 && rank <= 6) awards.push('HEISMAN TROPHY');
    else if (gs >= 10 && avg >= 80 && rank <= 12) awards.push('HEISMAN FINALIST');
    if (gs >= 10 && avg >= 82) awards.push('ALL-AMERICAN');
    if (gs >= 6 && avg >= 76) awards.push(`1ST TEAM ALL-${this.conf}`);
    else if (gs >= 6 && avg >= 68) awards.push(`2ND TEAM ALL-${this.conf}`);
    // a freshman who played four games or fewer keeps the year
    const redshirt = !s.redshirted && gp <= 4;
    const cls = this.classLabel;
    s.seasons.push({
      year: s.year, cls, school: this.school.name, role: gs >= 5 ? 'STARTER' : 'BACKUP', gp, gs, stats: line, record: this.record().text,
      finish: fin, rank: rank <= 25 ? rank : null, ovr: qbOvr(p), avg: n ? Math.round(avg) : undefined, awards, redshirt,
    });
    s.awards.push(...awards.map((a) => `${a} (${cls})`));
    if (redshirt) { s.redshirted = true; news.push('REDSHIRT YEAR: YOU KEEP YOUR ELIGIBILITY'); } else s.elig++;
    news.push(`SEASON OVER: ${fin}`);
    s.phase = 'summary';
  }

  /** From the season summary: the off-season, then the next season (or the end of college). */
  nextSeason(): void {
    const s = this.s;
    if (s.phase !== 'summary') return;
    if (s.elig >= 4 || s.year >= 4) { s.phase = 'done'; saveCollege(s); return; }
    const rng = new Rng(s.seed + 100 * (s.year + 2));
    offseason(this.player, COLLEGE_CAP);
    const earned = checkAbility(this.player);
    const st = collegeStandings(s.games);
    for (const c of COLLEGES) {
      const t = s.teams[c.id], r = st.get(c.id);
      // winning programs lift their level a little (prestige stays the data's)
      const lift = r ? (pct(r.w, r.l) - 0.5) * 2 : 0;
      rollStrength(t, c, rng, false);
      t.off = Math.round((t.off + lift) * 10) / 10; t.def = Math.round((t.def + lift) * 10) / 10;
    }
    s.year++;
    this.startSeason(rng);
    if (earned) s.headlines.unshift(earned);
    saveCollege(s);
  }
}

function diffStats(a: TeamStats, b: TeamStats): TeamStats {
  const out = newStats();
  for (const k of Object.keys(out) as (keyof TeamStats)[]) out[k] = Math.max(0, (a[k] ?? 0) - (b[k] ?? 0));
  return out;
}

// ---------- the save ----------

export function loadCollege(): CollegeSave | null {
  try {
    const raw = localStorage.getItem(COLLEGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as CollegeSave;
    return s && s.v === COLLEGE_VERSION && s.player && s.teams && Array.isArray(s.games) ? s : null;
  } catch { return null; }
}
export function saveCollege(s: CollegeSave): void {
  try { localStorage.setItem(COLLEGE_KEY, JSON.stringify(s)); } catch { /* private mode / full */ }
}
