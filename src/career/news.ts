// Flavor for the high school career: the state poll, headlines from around the
// state, pregame storylines, the coach's keys to the game, your top target's
// line, the player of the game, and teammates who sign with colleges.
// Nothing here changes how games play out.
import type { TeamStats } from '../drive';
import type { Roster } from '../ratings';
import { clamp } from '../util';
import { type GameRec, type Round, type Team, played, standings, winnerOf } from './league';
import { type College, COLLEGES, affinityFor } from './recruiting';

// ---------- the state poll ----------

/** Every team ordered for the state poll: winning, margin, then how good they look on paper. */
export function statePoll(teams: Team[], games: GameRec[]): number[] {
  const st = standings(teams, games);
  const playoffWins = new Map<number, number>();
  for (const g of games) if (g.round && played(g)) playoffWins.set(winnerOf(g), (playoffWins.get(winnerOf(g)) ?? 0) + 1);
  const score = (t: Team) => {
    const s = st.get(t.id)!, gp = s.w + s.l + s.t;
    const pct = gp ? (s.w + s.t / 2) / gp : 0.5;
    const margin = gp ? clamp((s.pf - s.pa) / gp, -21, 21) : 0;
    return pct * 20 + margin * 0.2 + ((t.off + t.def) / 2) * (gp ? 0.35 : 1) + (playoffWins.get(t.id) ?? 0) * 2;
  };
  return [...teams].sort((a, b) => score(b) - score(a)).map((t) => t.id);
}

/** A team's place in the poll (1-based), or null outside the top 10. */
export const pollRank = (poll: number[] | undefined, id: number): number | null => {
  const i = poll ? poll.indexOf(id) : -1;
  return i >= 0 && i < 10 ? i + 1 : null;
};

// ---------- headlines ----------

const streakOf = (games: GameRec[], id: number, upTo: number): number => {
  let n = 0;
  const mine = games.filter((g) => played(g) && g.week <= upTo && (g.home === id || g.away === id)).sort((a, b) => b.week - a.week);
  for (const g of mine) { if (winnerOf(g) === id) n++; else break; }
  return n;
};

/** This week's headlines from around the state (your own game is the front page). */
export function headlines(teams: Team[], games: GameRec[], week: number, prevPoll: number[] | undefined, mySchool: number): string[] {
  const name = (id: number) => teams[id].name;
  const out: { p: number; text: string }[] = [];
  const roundName: Record<Round, string> = { QF: 'THE SEMIFINALS', SF: 'THE STATE TITLE GAME', F: '' };
  for (const g of games) {
    if (g.week !== week || !played(g) || g.home === mySchool || g.away === mySchool) continue;
    const w = winnerOf(g), l = w === g.home ? g.away : g.home;
    const hi = Math.max(g.hs!, g.as!), lo = Math.min(g.hs!, g.as!), margin = hi - lo, score = `${hi}-${lo}`;
    const rw = pollRank(prevPoll, w), rl = pollRank(prevPoll, l);
    const box = w === g.home ? g.box?.home : g.box?.away;
    if (g.round === 'F') { out.push({ p: 9, text: `${name(w)} WIN THE STATE TITLE, ${score}` }); continue; }
    if (g.round) out.push({ p: 4, text: `${name(w)} ADVANCE TO ${roundName[g.round]}` });
    if (rl && (!rw || rw > rl + 3)) out.push({ p: 6, text: `UPSET: ${name(w)} STUN NO.${rl} ${name(l)}, ${score}` });
    if (g.ot) out.push({ p: 3, text: `${name(w)} OUTLAST ${name(l)} IN OT, ${score}` });
    if (rw && margin >= 28) out.push({ p: 2, text: `NO.${rw} ${name(w)} ROLL PAST ${name(l)}, ${score}` });
    if (box && (box.tds >= 5 || box.yards >= 400)) out.push({ p: 2, text: `${name(w)} QB: ${box.yards} YDS, ${box.tds} TD IN A WIN` });
    const streak = streakOf(games, w, week);
    if (streak >= 6 && !g.round) out.push({ p: 1, text: `${name(w)} WIN ${streak} STRAIGHT` });
  }
  return out.sort((a, b) => b.p - a.p || Math.random() - 0.5).slice(0, 4).map((h) => h.text);
}

// ---------- pregame ----------

const TROPHIES = ['BELL', 'BOOT', 'AXE', 'JUG', 'CANNON', 'OLD OAK BUCKET'];
/** Your rival: a region opponent, fixed for the career. */
export function rivalOf(teams: Team[], mySchool: number, seed: number): number {
  const region = teams[mySchool].region;
  const others = teams.filter((t) => t.region === region && t.id !== mySchool).map((t) => t.id);
  return others[Math.abs(seed) % others.length];
}
export const rivalTrophy = (seed: number) => `THE ${TROPHIES[Math.abs(seed >> 3) % TROPHIES.length]}`;
export const rivalryName = (seed: number) => `THE BATTLE FOR ${rivalTrophy(seed)}`;

export interface StoryInput {
  rec: GameRec; teams: Team[]; games: GameRec[]; mySchool: number; seed: number; year: number; poll?: number[];
}
/** The storyline for a game: playoff rounds, rivalry week, undefeated showdowns, top 10 clashes, senior night, homecoming. */
export function storyline(o: StoryInput): string | null {
  const { rec, teams, games, mySchool, seed, year, poll } = o;
  const opp = rec.home === mySchool ? rec.away : rec.home, home = rec.home === mySchool;
  const met = games.some((g) => !g.round && played(g) && ((g.home === mySchool && g.away === opp) || (g.away === mySchool && g.home === opp)));
  if (rec.round) {
    const round = { QF: 'STATE QUARTERFINAL', SF: 'STATE SEMIFINAL', F: 'STATE CHAMPIONSHIP' }[rec.round];
    return met ? `${round}: THE REMATCH` : round;
  }
  if (opp === rivalOf(teams, mySchool, seed)) return `RIVALRY WEEK: ${rivalryName(seed)}`;
  const st = standings(teams, games);
  const a = st.get(mySchool)!, b = st.get(opp)!;
  if (rec.week >= 4 && a.l === 0 && b.l === 0) return 'UNDEFEATED SHOWDOWN';
  const ra = pollRank(poll, mySchool), rb = pollRank(poll, opp);
  if (ra && rb) return `TOP 10 CLASH: NO.${ra} VS NO.${rb}`;
  const homeWeeks = games.filter((g) => !g.round && g.home === mySchool).map((g) => g.week).sort((x, y) => x - y);
  if (home && year >= 2 && rec.week === homeWeeks[homeWeeks.length - 1]) return 'SENIOR NIGHT';
  if (home && rec.week === homeWeeks.find((w) => w >= 5)) return 'HOMECOMING';
  return null;
}

/** The coach's keys to the game: two goals for your line, picked for the opponent. */
export interface Key { id: string; text: string }
const KEYS: Record<string, { text: string; ok: (l: TeamStats) => boolean }> = {
  ball: { text: 'PROTECT THE BALL: NO PICKS', ok: (l) => l.int === 0 },
  clean: { text: 'STAY CLEAN: 1 SACK OR LESS', ok: (l) => l.sacks <= 1 },
  eff: { text: 'BE EFFICIENT: 65% COMPLETIONS', ok: (l) => l.att > 0 && l.cmp / l.att >= 0.65 },
  deep: { text: 'ATTACK DOWNFIELD: 8 YDS A THROW', ok: (l) => l.att > 0 && l.yards / l.att >= 8 },
  finish: { text: 'FINISH DRIVES: 3 TOUCHDOWNS', ok: (l) => l.tds >= 3 },
};
export function keysFor(opp: Team, week: number): Key[] {
  const ids = opp.def >= 3 ? ['ball', 'eff'] : opp.def <= -3 ? ['deep', 'finish'] : opp.off >= 3 ? ['finish', 'ball']
    : [['clean', 'eff'], ['ball', 'deep'], ['eff', 'finish']][week % 3];
  return ids.map((id) => ({ id, text: KEYS[id].text }));
}
export const keyMet = (id: string, l: TeamStats) => KEYS[id]?.ok(l) ?? false;

/** Players to watch: a team's QB and its best defender. */
export function playersToWatch(r: Roster): { qb: string; def: string } {
  const qb = r.players.find((p) => p.slot === 'QB')!;
  const defs = r.players.filter((p) => ['DL', 'LB', 'CB', 'S', 'NB'].includes(p.pos)).sort((a, b) => b.ovr - a.ovr);
  const d = defs[0];
  return { qb: `QB ${qb.name} ${qb.ovr}`, def: `${d.pos} ${d.name} ${d.ovr}` };
}

// ---------- postgame ----------

/** Your favorite target: the best receiver on your team. */
export function topTarget(r: Roster): { name: string; pos: string } {
  const rec = r.players.filter((p) => p.pos === 'WR' || p.pos === 'TE').sort((a, b) => b.ovr - a.ovr)[0];
  return { name: rec.name, pos: rec.pos };
}
export interface TargetLine { name: string; pos: string; rec: number; yds: number; td: number }
/** His share of your passing line tonight (a third or so of the catches, yards and touchdowns). */
export function targetLine(r: Roster, l: TeamStats): TargetLine {
  const t = topTarget(r), share = 0.3 + Math.random() * 0.12;
  let td = 0;
  for (let i = 0; i < l.tds; i++) if (Math.random() < share + 0.05) td++;
  return { ...t, rec: Math.round(l.cmp * share), yds: Math.max(0, Math.round(l.yards * share * 1.08)), td };
}

/** The front-page headline for your game. */
export function frontPage(o: { you: string; mascot: string; oppMascot: string; us: number; them: number; ot: boolean; played: boolean; tds: number; yards: number }): string {
  const { you, mascot, oppMascot, us, them, ot, played: p, tds, yards } = o;
  const score = `${Math.max(us, them)}-${Math.min(us, them)}`;
  if (us < them) return p && tds >= 3 ? `${you}'S ${tds} TDS NOT ENOUGH AS ${oppMascot} TOP ${mascot}, ${score}` : `${oppMascot} HOLD OFF ${mascot}, ${score}`;
  const verb = ot ? 'OUTLAST' : us - them >= 21 ? 'ROLL PAST' : us - them >= 8 ? 'BEAT' : 'EDGE';
  if (!p) return `${mascot} ${verb} ${oppMascot}, ${score}`;
  if (tds >= 3) return `${you} THROWS ${tds} TDS AS ${mascot} ${verb} ${oppMascot}, ${score}`;
  if (yards >= 300) return `${you} PASSES FOR ${yards} AS ${mascot} ${verb} ${oppMascot}, ${score}`;
  return `${mascot} ${verb} ${oppMascot}, ${score}`;
}

const PAPERS = ['GAZETTE', 'TRIBUNE', 'HERALD', 'COURIER', 'DAILY NEWS', 'TIMES'];
export const paperName = (town: string, id: number) => `THE ${town} ${PAPERS[id % PAPERS.length]}`;

// ---------- teammates who sign ----------

export interface Signee { name: string; pos: string; school: string }
/**
 * This year's seniors who sign with colleges: the best few players on the team
 * (not the QB), at a level that matches them. Good teams send more.
 */
export function teammateSignees(r: Roster, homeState: string, teamStrength: number): Signee[] {
  const n = clamp(Math.round(1.5 + teamStrength * 0.25 + Math.random() * 1.5), 1, 4);
  const best = r.players.filter((p) => p.slot !== 'QB').sort((a, b) => b.ovr - a.ovr).slice(0, n);
  const taken = new Set<string>();
  return best.map((p) => {
    const tier = p.ovr >= 72 ? 'P4' : p.ovr >= 66 ? 'G5' : 'FCS';
    const pool = COLLEGES.filter((c) => c.tier === tier && !taken.has(c.id));
    const c = weighted(pool, (x) => affinityFor(x, homeState));
    taken.add(c.id);
    return { name: p.name, pos: p.pos, school: c.name };
  });
}

function weighted(pool: College[], w: (c: College) => number): College {
  let x = Math.random() * pool.reduce((t, c) => t + w(c) ** 3, 0);
  for (const c of pool) { x -= w(c) ** 3; if (x <= 0) return c; }
  return pool[0];
}
