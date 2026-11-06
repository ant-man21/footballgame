// A league: teams in two regions, a 10-game schedule (3 non-region games, then
// a 7-game region round robin), standings with tiebreakers, and an 8-team
// playoff (top 4 of each region, crossed over) for the state title.
import type { TeamStats } from '../drive';
import type { SchoolIdentity } from './hsnames';
import { Rng } from './rng';

export interface Team extends SchoolIdentity {
  id: number;
  region: number; // 0 or 1
  prestige: number; // 0-100: programs that win keep winning (it pulls strength toward it each off-season)
  off: number; // this season's unit strength, rating points vs the tier norm (0 = average)
  def: number;
}

export type Round = 'QF' | 'SF' | 'F';
export interface GameRec {
  week: number; // 1-based
  home: number; // team ids
  away: number;
  hs?: number; // final score (undefined = not played yet)
  as?: number;
  ot?: boolean;
  round?: Round;
  box?: { home: TeamStats; away: TeamStats };
}

export const REGULAR_WEEKS = 10;
export const PLAYOFF_ROUNDS: Round[] = ['QF', 'SF', 'F'];
export const ROUND_NAMES: Record<Round, string> = { QF: 'QUARTERFINAL', SF: 'SEMIFINAL', F: 'STATE TITLE' };
export const REGION_NAMES = ['NORTH', 'SOUTH'];

/** The regular season schedule for 16 teams (8 per region). */
export function makeSchedule(teams: Team[], rng: Rng): GameRec[] {
  const regions = [0, 1].map((r) => rng.shuffle(teams.filter((t) => t.region === r).map((t) => t.id)));
  const games: GameRec[] = [];
  // weeks 1-3: non-region games, each team in region 0 against a different region-1 team each week
  const offsets = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7]).slice(0, 3);
  offsets.forEach((k, w) => {
    for (let i = 0; i < 8; i++) {
      const a = regions[0][i], b = regions[1][(i + k) % 8];
      games.push((i + w) % 2 ? { week: w + 1, home: a, away: b } : { week: w + 1, home: b, away: a });
    }
  });
  // weeks 4-10: region round robin (circle method)
  for (const ids of regions) {
    const n = ids.length, fixed = ids[0], rot = ids.slice(1);
    for (let round = 0; round < n - 1; round++) {
      const line = [fixed, ...rot];
      for (let i = 0; i < n / 2; i++) {
        const a = line[i], b = line[n - 1 - i];
        const home = (round + i) % 2 ? a : b;
        games.push({ week: 4 + round, home, away: home === a ? b : a });
      }
      rot.unshift(rot.pop()!);
    }
  }
  return games.sort((x, y) => x.week - y.week);
}

export interface Standing { id: number; w: number; l: number; t: number; rw: number; rl: number; rt: number; pf: number; pa: number }

export const played = (g: GameRec) => g.hs !== undefined && g.as !== undefined;

/** Regular season records. */
export function standings(teams: Team[], games: GameRec[]): Map<number, Standing> {
  const out = new Map<number, Standing>();
  for (const t of teams) out.set(t.id, { id: t.id, w: 0, l: 0, t: 0, rw: 0, rl: 0, rt: 0, pf: 0, pa: 0 });
  const region = new Map(teams.map((t) => [t.id, t.region]));
  for (const g of games) {
    if (g.round || !played(g)) continue;
    const h = out.get(g.home)!, a = out.get(g.away)!;
    const inRegion = region.get(g.home) === region.get(g.away);
    h.pf += g.hs!; h.pa += g.as!; a.pf += g.as!; a.pa += g.hs!;
    const res = g.hs! > g.as! ? 1 : g.hs! < g.as! ? -1 : 0;
    for (const [s, r] of [[h, res], [a, -res]] as [Standing, number][]) {
      if (r > 0) { s.w++; if (inRegion) s.rw++; } else if (r < 0) { s.l++; if (inRegion) s.rl++; } else { s.t++; if (inRegion) s.rt++; }
    }
  }
  return out;
}

const pct = (w: number, l: number, t: number) => (w + l + t ? (w + t / 2) / (w + l + t) : 0);

/** A region's teams in order: region record, overall record, head to head, point differential, points scored. */
export function regionOrder(teams: Team[], games: GameRec[], region: number): Standing[] {
  const st = standings(teams, games);
  const list = teams.filter((t) => t.region === region).map((t) => st.get(t.id)!);
  const h2h = (a: number, b: number) => {
    let n = 0;
    for (const g of games) {
      if (g.round || !played(g)) continue;
      if (g.home === a && g.away === b) n += Math.sign(g.hs! - g.as!);
      if (g.home === b && g.away === a) n += Math.sign(g.as! - g.hs!);
    }
    return n;
  };
  return list.sort((a, b) =>
    pct(b.rw, b.rl, b.rt) - pct(a.rw, a.rl, a.rt) || pct(b.w, b.l, b.t) - pct(a.w, a.l, a.t)
    || h2h(b.id, a.id) || (b.pf - b.pa) - (a.pf - a.pa) || b.pf - a.pf || a.id - b.id);
}

/** Quarterfinals: the top 4 of each region, crossed over (N1 v S4, S2 v N3, S1 v N4, N2 v S3). Higher seed at home. */
export function playoffField(teams: Team[], games: GameRec[]): GameRec[] {
  const [n, s] = [0, 1].map((r) => regionOrder(teams, games, r).slice(0, 4).map((x) => x.id));
  const w = REGULAR_WEEKS + 1;
  return [
    { week: w, round: 'QF', home: n[0], away: s[3] }, { week: w, round: 'QF', home: s[1], away: n[2] },
    { week: w, round: 'QF', home: s[0], away: n[3] }, { week: w, round: 'QF', home: n[1], away: s[2] },
  ];
}

export const winnerOf = (g: GameRec) => (g.hs! > g.as! ? g.home : g.away);

/** The next round's games once a round is complete (null if there is no next round). */
export function nextRound(games: GameRec[], seedOf: (id: number) => number): GameRec[] | null {
  for (const [i, round] of PLAYOFF_ROUNDS.entries()) {
    const these = games.filter((g) => g.round === round);
    if (!these.length || !these.every(played)) return null;
    const next = PLAYOFF_ROUNDS[i + 1];
    if (!next) return null;
    if (games.some((g) => g.round === next)) continue;
    const week = these[0].week + 1, out: GameRec[] = [];
    for (let k = 0; k < these.length; k += 2) {
      const a = winnerOf(these[k]), b = winnerOf(these[k + 1]);
      const [home, away] = seedOf(a) <= seedOf(b) ? [a, b] : [b, a];
      out.push({ week, round: next, home, away });
    }
    return out;
  }
  return null;
}
