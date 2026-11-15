// The national high school poll (flavor only, never changes a result): about 40
// national powers from other states, each with a strength and a season of
// simulated results (a light model, not the quick-sim), ranked together with
// your state's teams by record, margin and strength. A team from a football
// state gets a bump; a small state's team needs to dominate to get in.
import { clamp } from '../util';
import { STATES, makeSchools } from './hsnames';
import { type GameRec, type Team, played, standings, winnerOf } from './league';
import { Rng } from './rng';

export interface NatTeam {
  name: string; mascot: string; abbr: string; state: string; colors: [string, string];
  str: number; // rating points vs the high school norm (your league's teams sit around -6..+7)
  base: number; // the program's level (str is pulled toward it each year)
  w: number; l: number; pf: number; pa: number;
  po: number; // playoff wins
  out?: boolean; // knocked out of its state playoffs
}
export interface Nation { week: number; year: number; teams: NatTeam[]; poll?: string[]; prev?: string[] }

export const NATIONAL_SIZE = 25;
const POWER_STATES = ['TX', 'FL', 'GA', 'CA', 'OH', 'AL', 'LA'];
const GOOD_STATES = ['PA', 'NJ', 'MS', 'SC', 'TN', 'NC', 'VA', 'MI', 'IL', 'AZ', 'MD', 'OK', 'UT', 'KY', 'WA', 'NV'];
const SMALL_STATES = ['ME', 'VT', 'NH', 'RI', 'DE', 'WY', 'ND', 'SD', 'AK', 'HI', 'MT', 'ID', 'WV', 'NM'];

/** How much a state's football counts in the national poll. */
export const stateBoost = (st: string) => (POWER_STATES.includes(st) ? 1.5 : SMALL_STATES.includes(st) ? -2.5 : GOOD_STATES.includes(st) ? 0.5 : -1);

/** The national powers for a career (none from your own state: your state's teams are your league). */
export function makeNation(seed: number, home: string): Nation {
  const rng = new Rng(seed ^ 0x5eed);
  const pool = [...POWER_STATES, ...POWER_STATES, ...POWER_STATES, ...GOOD_STATES, ...GOOD_STATES, ...STATES.map((s) => s.id)].filter((x) => x !== home);
  const teams: NatTeam[] = [];
  const names = new Set<string>();
  let guard = 0;
  while (teams.length < 40 && guard++ < 400) {
    const st = rng.pick(pool), def = STATES.find((x) => x.id === st)!;
    const [idn] = makeSchools(def, 1, rng);
    if (!idn || names.has(idn.name)) continue;
    names.add(idn.name);
    const base = Math.round((rng.range(4, 11) + stateBoost(st)) * 10) / 10; // the best programs are in the football states
    teams.push({ ...idn, state: st, str: base + rng.range(-2, 2), base, w: 0, l: 0, pf: 0, pa: 0, po: 0 });
  }
  return { week: 0, year: 0, teams };
}

/** A new season: records reset, strength turns over. */
export function nationNewSeason(n: Nation, seed: number, year: number): void {
  const rng = new Rng(seed + 977 * (year + 1));
  n.week = 0; n.year = year; n.prev = undefined;
  for (const t of n.teams) {
    t.str = Math.round((t.str * 0.4 + t.base * 0.6 + rng.range(-2.5, 2.5)) * 10) / 10;
    t.w = 0; t.l = 0; t.pf = 0; t.pa = 0; t.po = 0; t.out = false;
  }
}

/** Plays the national teams' games through `week` (weeks 1-10 the regular season, 11-14 their state playoffs). */
export function nationUpTo(n: Nation, week: number, seed: number): void {
  while (n.week < Math.min(week, 14)) {
    n.week++;
    const rng = new Rng(seed + n.year * 1009 + n.week * 31);
    for (const t of n.teams) {
      if (n.week > 10) {
        if (t.out || (n.week === 11 && t.w < 6)) { t.out = true; continue; }
      }
      const opp = n.week > 10 ? t.str - 1.5 + rng.range(-3, 3) : t.str * 0.35 + rng.range(-4.5, 4.5);
      const p = 1 / (1 + Math.exp(-(t.str - opp) / 3));
      const won = rng.next() < p;
      const margin = Math.round(clamp(3 + Math.abs(t.str - opp) * 2.5 + rng.range(-6, 18), 1, 49));
      const pts = Math.round(rng.range(17, 45));
      if (won) { t.w++; t.pf += pts; t.pa += Math.max(0, pts - margin); if (n.week > 10) t.po++; }
      else { t.l++; t.pa += pts; t.pf += Math.max(0, pts - margin); if (n.week > 10) t.out = true; }
    }
  }
}

const score = (pct: number, margin: number, str: number, gp: number, po: number, boost: number) =>
  pct * 20 + clamp(margin, -21, 21) * 0.2 + str * (gp ? 0.35 : 1) + po * 2 + boost;

/** The national top 25: keys 'N<i>' (national powers) and 'S<id>' (your state's teams). */
export function nationalPoll(n: Nation, teams: Team[], games: GameRec[], state: string): string[] {
  const st = standings(teams, games);
  const po = new Map<number, number>();
  for (const g of games) if (g.round && played(g)) po.set(winnerOf(g), (po.get(winnerOf(g)) ?? 0) + 1);
  const rows: { key: string; v: number }[] = n.teams.map((t, i) => {
    const gp = t.w + t.l;
    return { key: `N${i}`, v: score(gp ? t.w / gp : 0.5, gp ? (t.pf - t.pa) / gp : 0, t.str, gp, t.po, stateBoost(t.state)) };
  });
  for (const t of teams) {
    const s = st.get(t.id)!, gp = s.w + s.l + s.t;
    rows.push({ key: `S${t.id}`, v: score(gp ? (s.w + s.t / 2) / gp : 0.5, gp ? (s.pf - s.pa) / gp : 0, (t.off + t.def) / 2, gp, po.get(t.id) ?? 0, stateBoost(state)) });
  }
  return rows.sort((a, b) => b.v - a.v).slice(0, NATIONAL_SIZE).map((r) => r.key);
}

export interface NatRow { key: string; name: string; abbr: string; state: string; record: string; colors: [string, string]; local: boolean; id?: number }
/** A poll entry in words. */
export function natRow(key: string, n: Nation, teams: Team[], games: GameRec[], state: string): NatRow {
  if (key[0] === 'S') {
    const id = Number(key.slice(1)), t = teams[id], s = standings(teams, games).get(id)!;
    const pw = games.filter((g) => g.round && played(g) && winnerOf(g) === id).length;
    const pl = games.filter((g) => g.round && played(g) && (g.home === id || g.away === id) && winnerOf(g) !== id).length;
    return { key, name: t.name, abbr: t.abbr, state, record: `${s.w + pw}-${s.l + pl}`, colors: t.colors, local: true, id };
  }
  const t = n.teams[Number(key.slice(1))];
  return { key, name: t.name, abbr: t.abbr, state: t.state, record: `${t.w}-${t.l}`, colors: t.colors, local: false };
}

/** A team's national rank (1-based), or null outside the top 25. */
export const natRank = (poll: string[] | undefined, id: number): number | null => {
  const i = poll ? poll.indexOf(`S${id}`) : -1;
  return i >= 0 ? i + 1 : null;
};
