// Flavor for the high school career: the state poll, headlines from around the
// state, pregame storylines, the coach's keys to the game, your top target's
// line, the player of the game, and teammates who sign with colleges.
// Nothing here changes how games play out.
import type { TeamStats } from '../drive';
import type { Roster } from '../ratings';
import { clamp } from '../util';
import { type Region, randomName, seededName } from './hsnames';
import { Rng } from './rng';
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
    if (lo === 0) out.push({ p: 2, text: `${name(w)} BLANK ${name(l)}, ${score}` });
    if (box && (box.tds >= 6 || box.yards >= 450)) {
      const t = [`${name(w)} QB THROWS FOR ${box.yards} IN A ${margin >= 14 ? 'ROUT' : 'WIN'}`, `${name(w)} AIR IT OUT: ${box.tds} TD PASSES`,
        `${box.yards} YARDS: ${name(w)} QB LIGHTS UP ${name(l)}`][(g.week + w) % 3];
      out.push({ p: 2.5, text: t, big: true } as { p: number; text: string });
    }
    const streak = streakOf(games, w, week);
    if (streak >= 6 && !g.round) out.push({ p: 1, text: `${name(w)} WIN ${streak} STRAIGHT` });
  }
  const big = out.filter((h) => (h as { big?: boolean }).big).sort(() => Math.random() - 0.5).slice(1); // one big passing day a week
  return out.filter((h) => !big.includes(h)).sort((a, b) => b.p - a.p || Math.random() - 0.5).slice(0, 4).map((h) => h.text);
}

// ---------- pregame ----------

const TROPHIES = ['BELL', 'BOOT', 'AXE', 'JUG', 'CANNON', 'OLD OAK BUCKET'];
/** Your rival: a region opponent, fixed for the career. */
export function rivalOf(teams: Team[], mySchool: number, seed: number): number {
  const region = teams[mySchool].region;
  const others = teams.filter((t) => t.region === region && t.id !== mySchool).map((t) => t.id);
  return others[Math.abs(seed) % others.length];
}
export const rivalTrophy = (seed: number): string => `THE ${TROPHIES[Math.abs(seed >> 3) % TROPHIES.length]}`;
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

// ---------- your own news ----------

/** Headlines about you from this week's news (offers, stars, rankings, a big night). */
export function myHeadlines(first: string, last: string, news: string[], grade: number | null, line: TeamStats): string[] {
  const out: string[] = [];
  const offers = news.filter((n) => n.startsWith('OFFER: ')).map((n) => n.slice(7).replace(/!$/, ''));
  const star = news.find((n) => /^NOW A \d-STAR/.test(n));
  if (star) out.push(`${first} ${last} IS ${star.slice(0, -1)}`);
  if (offers.length > 1) out.push(`${last} PICKS UP ${offers.length} OFFERS, INCLUDING ${offers[0]}`);
  else if (offers.length) out.push(`${last} PICKS UP AN OFFER FROM ${offers[0]}`);
  const rank = news.find((n) => n.includes('QB IN THE NATION'));
  if (rank) { const m = rank.match(/NO\.(\d+) QB IN THE NATION/); if (m) out.push(`PREP ZONE RANKS ${last} NO.${m[1]} QB IN THE NATION`); }
  if (grade !== null && grade >= 88 && out.length < 2) out.push(`${last} SHINES: ${line.yards} YDS, ${line.tds} TD`);
  return out.slice(0, 2);
}

// ---------- game day: kickoff time and weather ----------

export type Sky = 'CLEAR' | 'CLOUDY' | 'RAIN' | 'WIND' | 'FOG' | 'SNOW';
export interface Weather { time: string; night: boolean; sky: Sky; temp: number }
const HEAT: Record<Region, [number, number]> = { // late-August temperature, degrees lost a week
  TEXAS: [96, 3], SOUTH: [91, 3], WEST: [86, 2.5], PLAINS: [86, 4], MIDWEST: [82, 4], NE: [80, 4],
};
/** Kickoff time and weather for a game (stable for a given career, season and week). */
export function weatherFor(seed: number, year: number, week: number, region: Region, round?: Round): Weather {
  const rng = new Rng(seed * 7 + year * 131 + week * 17);
  const x = rng.next();
  const time = round === 'F' ? 'SATURDAY 7:00 PM' : round === 'SF' ? 'SATURDAY 1:00 PM'
    : x < 0.8 ? 'FRIDAY 7:30 PM' : x < 0.9 ? 'THURSDAY 7:00 PM' : 'SATURDAY 2:00 PM';
  const night = time.endsWith('PM') && !time.includes(' 1:00') && !time.includes(' 2:00');
  const [base, drop] = HEAT[region];
  const temp = Math.round(base - drop * (week - 1) - (night ? 7 : 0) + rng.range(-6, 6));
  const r = rng.next();
  const sky: Sky = r < 0.13 ? (temp <= 33 ? 'SNOW' : 'RAIN') : r < 0.21 ? 'WIND' : r < 0.25 && night ? 'FOG' : r < 0.6 ? 'CLOUDY' : 'CLEAR';
  return { time, night, sky, temp };
}
export const weatherText = (w: Weather) =>
  `${w.time} - ${w.sky === 'CLEAR' ? (w.night ? 'CLEAR' : 'SUNNY') : w.sky}, ${w.temp} DEGREES`;

// ---------- rivalry week ----------

/** What the other side is saying before rivalry week. */
export function trashTalk(o: { seed: number; year: number; qb: string; you: string; trophy: string; lastYear: 'W' | 'L' | null }): string {
  const { qb, you, trophy, lastYear } = o;
  const lines = lastYear === 'L' ? [`${trophy} IS STAYING RIGHT WHERE IT IS.`, 'WE OWN THIS RIVALRY. SAME RESULT FRIDAY.']
    : lastYear === 'W' ? ['WE HAVE NOT FORGOTTEN LAST YEAR.', `${trophy} IS COMING BACK WITH US.`]
    : [`${you} IS ALL HYPE. WE WILL SEE FRIDAY.`, `${trophy} BELONGS TO US.`, 'STARS DO NOT MEAN ANYTHING ON FRIDAY NIGHT.'];
  return `${qb} (QB): ${lines[Math.abs(o.seed + o.year) % lines.length]}`;
}

// ---------- the awards banquet ----------

export interface Honoree { name: string; pos: string; school: string; you: boolean; line?: string }
export interface Banquet {
  mrFootball: Honoree; // the state's best player
  allStateQb: Honoree; // first-team all-state quarterback
  teammates: string[]; // your teammates on the all-state team, e.g. "WR C.FOSTER"
  coach?: string; // coach of the year (yours, after a state title)
  allAmerican?: { team: 'EAST' | 'WEST'; line: string; us: number; them: number; mvp: boolean }; // seniors: the all-star game
}
const short = () => { const n = randomName(); return `${n.first[0]}.${n.last}`; };
const POS_STAR = ['RB', 'LB', 'WR', 'DE', 'RB'];
const ri = (a: number, b: number) => Math.round(a + Math.random() * (b - a));
/** A star from another school, with the season that won it. */
const starOf = (school: string): Honoree => {
  const pos = POS_STAR[Math.floor(Math.random() * POS_STAR.length)];
  const line = pos === 'RB' ? `${yds(ri(1700, 2400))} RUSH YDS ${ri(20, 32)} TD` : pos === 'WR' ? `${ri(80, 105)} REC ${yds(ri(1400, 1900))} YDS ${ri(16, 24)} TD`
    : pos === 'DE' ? `${ri(15, 22)} SACKS ${ri(60, 85)} TKL` : `${ri(120, 160)} TKL ${ri(6, 11)} SACKS`;
  return { name: short(), pos, school, you: false, line };
};
export const coachOf = (school: string) => `COACH ${pickBy(school, ['HOLT', 'RAMSEY', 'DUNN', 'BECKER', 'SALAS', 'PRUITT', 'OKAFOR', 'LANE'])}`;
const pickBy = <T>(key: string, list: T[]): T => list[[...key].reduce((t, ch) => (t * 31 + ch.charCodeAt(0)) % 100003, 11) % list.length];

/**
 * The end-of-season awards: Mr. Football (you, if you were the best player in the
 * state), the all-state QB, your teammates who made all-state, and for top senior
 * recruits the All-American game.
 */
export function banquet(o: {
  you: string; year: number; avg: number | null; gs: number; wins: number; champion: boolean; allState: boolean; finish: string;
  stars: number; nationalRank: number | null; school: Team; roster: Roster; teams: Team[]; poll?: number[]; champ: Team | null;
  leaders?: Leader[]; myLine?: string; teamRec?: RecLine[];
}): Banquet {
  const { you, year, avg, gs, wins, champion, school, roster } = o;
  const top = o.champ ?? o.teams[(o.poll ?? [])[0] ?? 0];
  const best = roster.players.filter((p) => p.slot !== 'QB').sort((a, b) => b.ovr - a.ovr);
  const mine = year >= 1 && gs >= 8 && avg !== null && (year === 2 || avg >= 88) && ((avg >= 80 && wins >= 9) || (champion && avg >= 74));
  const leaders = o.leaders ?? [], others = leaders.filter((l) => !l.you);
  const qbLine = (l: Leader) => passText(l);
  const topRec = o.teamRec?.[0];
  const champQb = others.find((l) => l.school === top.id);
  const mrFootball: Honoree = mine ? { name: you, pos: 'QB', school: school.name, you: true, line: o.myLine }
    : top.id === school.id ? (topRec ? { name: topRec.name, pos: topRec.pos, school: school.name, you: false, line: recText(topRec) }
      : { name: best[0].name, pos: best[0].pos, school: school.name, you: false })
      : champQb && Math.random() < 0.6 ? { name: champQb.name, pos: 'QB', school: top.name, you: false, line: qbLine(champQb) }
        : starOf(top.name);
  const bestQb = [...others].sort((a, b) => qbScore(b) - qbScore(a))[0];
  const other = o.teams.find((t) => t.id !== school.id && t.id === ((o.poll ?? [])[0] === school.id ? (o.poll ?? [])[1] : (o.poll ?? [])[0])) ?? top;
  const allStateQb: Honoree = o.allState ? { name: you, pos: 'QB', school: school.name, you: true, line: o.myLine }
    : bestQb ? { name: bestQb.name, pos: 'QB', school: o.teams[bestQb.school].name, you: false, line: qbLine(bestQb) }
      : { name: short(), pos: 'QB', school: other.name, you: false };
  const teammates = best.filter((p) => p.ovr >= (wins >= 6 ? 66 : 70)).slice(0, 3).map((p) => `${p.pos} ${p.name}`);
  const b: Banquet = { mrFootball, allStateQb, teammates };
  if (o.finish === 'STATE CHAMPIONS') b.coach = coachOf(school.name);
  if (year === 2 && (o.stars >= 5 || (o.stars >= 4 && (o.nationalRank ?? 999) <= 20))) {
    const att = Math.round(10 + Math.random() * 8), cmp = Math.round(att * (0.55 + Math.random() * 0.25));
    const yds = Math.round(cmp * (9 + Math.random() * 6)), td = Math.random() < 0.3 ? 2 : Math.random() < 0.6 ? 1 : 0;
    const us = 7 * Math.floor(1 + Math.random() * 4) + (Math.random() < 0.4 ? 3 : 0), them = 7 * Math.floor(Math.random() * 4) + (Math.random() < 0.4 ? 3 : 0);
    b.allAmerican = { team: Math.random() < 0.5 ? 'EAST' : 'WEST', line: `${cmp}/${att} ${yds} YDS ${td} TD`, us, them, mvp: td >= 2 && us > them };
  }
  return b;
}

// ---------- box scores ----------

/**
 * A simulated game's box score, made to read like real football. The quick-sim is
 * tuned to how the arcade game plays (auto-played QBs almost never take sacks and
 * complete ~70%), so other games' box scores add the incompletions and sacks a
 * real high school QB has. Completions, yards, touchdowns, picks (and so the score
 * and every result) stay exactly as played. edge: that offense minus the defense
 * it faced, in rating points.
 */
export function dressBox(st: TeamStats, edge: number): TeamStats {
  const e = clamp(edge, -12, 12);
  const pct = clamp(0.61 + e * 0.009, 0.45, 0.74); // completion rate: good offenses hit more
  const att = Math.max(st.att, Math.round(st.cmp / pct + (Math.random() - 0.5) * 3));
  const meanSacks = 1.7 * clamp(1 - e * 0.06, 0.4, 2); // weak lines give up more
  let sacks = 0;
  for (let i = 0; i < 30; i++) if (Math.random() < meanSacks / 30) sacks++;
  return { ...st, att, sacks: st.sacks + sacks, plays: st.plays + (att - st.att) + sacks };
}

// ---------- player stats ----------

export interface RecLine { name: string; pos: string; rec: number; yds: number; td: number }
export interface DefLine { name: string; pos: string; tkl: number; sacks: number; int: number }
export interface TeamLines { rec: RecLine[]; def: DefLine[] }

const pickW = <T>(xs: T[], w: (x: T) => number): T => {
  let r = Math.random() * xs.reduce((t, x) => t + w(x), 0);
  for (const x of xs) { r -= w(x); if (r <= 0) return x; }
  return xs[xs.length - 1];
};

/** Your team's passing line split among its receivers (the best receiver gets the most looks). */
export function receivingSplit(r: Roster, l: TeamStats): RecLine[] {
  const cands = r.players.filter((p) => ['X', 'Z', 'H', 'Y', 'TE', 'RB'].includes(p.slot));
  if (!l.cmp || !cands.length) return [];
  const top = topTarget(r).name;
  const look = (p: typeof cands[number]) => (p.pos === 'WR' ? 1 : p.pos === 'TE' ? 0.55 : 0.45) * clamp(1 + (p.ovr - 60) * 0.05, 0.5, 2) * (p.name === top ? 1.35 : 1);
  const out = new Map(cands.map((p) => [p.name, { name: p.name, pos: p.pos, rec: 0, yds: 0, td: 0 }]));
  for (let i = 0; i < l.cmp; i++) out.get(pickW(cands, look).name)!.rec++;
  const lines = [...out.values()].filter((x) => x.rec > 0);
  const raw = lines.map((x) => x.rec * (x.pos === 'WR' ? 1.08 : x.pos === 'TE' ? 0.85 : 0.65) * (0.75 + Math.random() * 0.5));
  const sum = raw.reduce((t, x) => t + x, 0) || 1;
  lines.forEach((x, i) => { x.yds = Math.round((raw[i] / sum) * Math.max(0, l.yards)); });
  const best = lines.reduce((a, b) => (b.yds > a.yds ? b : a));
  best.yds += Math.max(0, l.yards) - lines.reduce((t, x) => t + x.yds, 0); // rounding
  for (let i = 0; i < l.tds; i++) pickW(lines, (x) => x.yds + 10).td++;
  return lines.sort((a, b) => b.yds - a.yds);
}

/** Your defense's day from the other team's line: tackles, sacks and picks. */
export function defenseSplit(r: Roster, opp: TeamStats): DefLine[] {
  const d = r.players.filter((p) => ['DL', 'LB', 'CB', 'S', 'NB'].includes(p.pos));
  const out = new Map(d.map((p) => [p.name, { name: p.name, pos: p.pos, tkl: 0, sacks: 0, int: 0 }]));
  const f = (v: number, mid: number) => clamp(1 + (v - mid) * 0.03, 0.5, 1.8);
  const tackles = Math.max(0, opp.cmp - opp.tds) + Math.round(opp.cmp * 0.25);
  for (let i = 0; i < tackles; i++) out.get(pickW(d, (p) => ((({ LB: 1.3, S: 1, CB: 0.8, NB: 0.7, DL: 0.45 }) as Record<string, number>)[p.pos] ?? 0.5) * f(p.r.tkl, 55)).name)!.tkl++;
  for (let i = 0; i < opp.sacks; i++) { const x = out.get(pickW(d, (p) => (p.pos === 'DL' ? 1 : p.pos === 'LB' ? 0.35 : 0.03) * f(p.r.rsh, 55)).name)!; x.sacks++; x.tkl++; }
  for (let i = 0; i < opp.int; i++) out.get(pickW(d, (p) => (p.pos === 'CB' || p.pos === 'S' ? 1 : p.pos === 'NB' ? 0.8 : p.pos === 'LB' ? 0.25 : 0.02) * f(p.r.cov, 55)).name)!.int++;
  return [...out.values()].filter((x) => x.tkl || x.sacks || x.int).sort((a, b) => b.tkl + b.sacks * 3 + b.int * 4 - (a.tkl + a.sacks * 3 + a.int * 4));
}

/** Season totals from game lines (players matched by name). */
export function sumLines(games: (TeamLines | undefined)[]): TeamLines {
  const rec = new Map<string, RecLine>(), def = new Map<string, DefLine>();
  for (const g of games) {
    if (!g) continue;
    for (const x of g.rec) { const t = rec.get(x.name) ?? { name: x.name, pos: x.pos, rec: 0, yds: 0, td: 0 }; t.rec += x.rec; t.yds += x.yds; t.td += x.td; rec.set(x.name, t); }
    for (const x of g.def) { const t = def.get(x.name) ?? { name: x.name, pos: x.pos, tkl: 0, sacks: 0, int: 0 }; t.tkl += x.tkl; t.sacks += x.sacks; t.int += x.int; def.set(x.name, t); }
  }
  return {
    rec: [...rec.values()].sort((a, b) => b.yds - a.yds),
    def: [...def.values()].sort((a, b) => b.tkl + b.sacks * 3 + b.int * 4 - (a.tkl + a.sacks * 3 + a.int * 4)),
  };
}

export const yds = (n: number) => n.toLocaleString('en-US');
export const recText = (x: RecLine) => `${x.rec} REC ${yds(x.yds)} YDS ${x.td} TD`;
export const passText = (x: { cmp: number; att: number; yds: number; td: number }) => `${x.cmp}/${x.att} ${yds(x.yds)} YDS ${x.td} TD`;

// ---------- around the state: every school's quarterback ----------

/** Each school's starting QB this season (the same name all season: players to watch, leaders, awards). */
export function teamQb(seed: number, year: number, teamId: number): string {
  const rng = new Rng(seed * 13 + year * 977 + teamId * 7919 + 5);
  const n = seededName(() => rng.next());
  return `${n.first[0]}.${n.last}`;
}

export interface Leader { name: string; school: number; you: boolean; gp: number; cmp: number; att: number; yds: number; td: number; int: number }
/** The state's passing leaders this season, from every box score (you from your own games). */
export function stateLeaders(o: { teams: Team[]; games: GameRec[]; mySchool: number; me: string; myLine: TeamStats; myGp: number; seed: number; year: number }): Leader[] {
  const out: Leader[] = [];
  for (const t of o.teams) {
    if (t.id === o.mySchool) {
      if (o.myLine.att) out.push({ name: o.me, school: t.id, you: true, gp: o.myGp, cmp: o.myLine.cmp, att: o.myLine.att, yds: o.myLine.yards, td: o.myLine.tds, int: o.myLine.int });
      continue;
    }
    const L: Leader = { name: teamQb(o.seed, o.year, t.id), school: t.id, you: false, gp: 0, cmp: 0, att: 0, yds: 0, td: 0, int: 0 };
    for (const g of o.games) {
      if (!g.box || !played(g) || (g.home !== t.id && g.away !== t.id)) continue;
      const b = g.home === t.id ? g.box.home : g.box.away;
      L.gp++; L.cmp += b.cmp; L.att += b.att; L.yds += b.yards; L.td += b.tds; L.int += b.int;
    }
    if (L.gp) out.push(L);
  }
  return out.sort((a, b) => b.yds - a.yds);
}
const qbScore = (l: Leader) => l.yds + 25 * l.td - 40 * l.int;
