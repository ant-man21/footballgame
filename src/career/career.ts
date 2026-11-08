// A high school career: three seasons (sophomore, junior, senior) at one
// school. As the backup you mostly watch, with scenario snaps some weeks
// (two-minute drill, relief, mop-up) that fill the QB battle meter; win it and
// you start. Each week: pick a practice focus, play (or watch) the game, the
// rest of the league is quick-simmed. 10 games, then an 8-team state playoff.
import type { TeamStats } from '../drive';
import { newStats } from '../drive';
import { type Side, Match } from '../match';
import { type RatingKey, type Roster, makeRoster } from '../ratings';
import { clamp } from '../util';
import { STATES, makeSchools } from './hsnames';
import {
  type GameRec, REGULAR_WEEKS, type Round, ROUND_NAMES, type Team, makeSchedule, nextRound, playoffField, played,
  regionOrder, standings, winnerOf,
} from './league';
import {
  type Archetype, type CareerPlayer, type Focus, HS_TIER, asRosterPlayer, createPlayer, gameXp, gradeGame, offseason,
  classNorm, practice, production, qbNormOvr, qbOvr, seasonProduction,
} from './player';
import { loadSettings } from '../settings';
import {
  MAX_VISITS, type RecruitState, SCORE_FORMULA, college, newRecruiting, officialVisit, pickScout, qbRank, recruitingWeek, rollNeeds,
  scoutReaction, starsFor, tvReaction, useDifficulty,
} from './recruiting';
import { type Units, overtimeWinner, simGame, simToEnd, simUntil } from './quicksim';
import { Rng, newSeed } from './rng';
import { CAREER_VERSION, saveCareer } from './save';

export const HS_YEARS = 3;
/** How much last season keeps counting toward your stars once this season is under way. */
const RESUME = 0.4;
const TEAMS = 16;

export type Role = 'backup' | 'starter';
export type Appearance = 'full' | 'scenario' | 'none';

/** What happened to you in one game. */
export interface WeekLog {
  week: number;
  round?: Round;
  opp: number;
  home: boolean;
  us: number;
  them: number;
  ot: boolean;
  kind: Appearance;
  label: string; // e.g. "MOP-UP DUTY"
  line: TeamStats; // your passing line
  grade: number | null;
  battle: number | null; // the QB battle meter after the game (backups)
  gains: Partial<Record<RatingKey, number>>; // rating points gained this week
  news: string[]; // e.g. "YOU WON THE STARTING JOB!"
  spotlight?: number; // how much this game's grade counts toward your stars (a recruiting site 2, TV 1.5)
}

export interface CareerSave {
  v: number;
  seed: number;
  state: string; // state id, e.g. 'TX'
  player: CareerPlayer;
  teams: Team[];
  schoolId: number;
  year: number; // 0 = sophomore .. 2 = senior
  week: number; // the next week to play (1-based; > REGULAR_WEEKS = playoffs)
  games: GameRec[]; // this season, playoffs added as they're set
  focus: Focus;
  role: Role;
  battle: number; // 0-100
  starter: { name: string; ovr: number } | null; // the QB ahead of you
  log: WeekLog[]; // your team's games this season
  events?: GameEvent[]; // this season's spotlight games (juniors and seniors)
  dry: number; // weeks in a row you didn't get in (backups)
  phase: 'season' | 'summary' | 'signing' | 'done'; // summary: the season is over, showing it; signing: signing day
  recruit: RecruitState; // colleges recruiting you
  recruitFeed: string[]; // recent recruiting news, newest first
  roster: Roster; // your team this season (the QB slot is filled with you when you play)
  defense: 'play' | 'sim'; // on game day: play the MIKE linebacker, or simulate the other team's drives
  calls: 'coach' | 'you'; // who calls the plays: the coach, or you in the huddle (like an exhibition game)
  quarter: number; // quarter length in seconds for this career's games
}

/** A spotlight game: a college scout in the stands, the recruiting site evaluating you, or a TV game. */
export type EventKind = 'scout' | 'site' | 'tv';
export interface GameEvent { week: number; kind: EventKind; school?: string }
export const SITE_NAME = 'PREP ZONE';

/** A game day ready to play: the match (maybe already in progress) and how you're in it. */
export interface GamePlan {
  kind: Appearance;
  label: string; // shown when you take the field
  detail: string;
  match: Match;
  rec: GameRec;
  opp: Team;
  pre: TeamStats; // your team's stats before you came in
  endAtHalf: boolean; // two-minute drill: you play to halftime, then the starter is back
  units: Record<Side, Units>; // quick-sim strength with you at QB
}

const STARTER_FIRST = 'ABCDEFGHJKLMNPRSTW';
const STARTER_LAST = ['BAKER', 'COLLINS', 'DUNN', 'EVANS', 'FISHER', 'GRIFFIN', 'HUNT', 'JENKINS', 'KELLY', 'LYNCH', 'MURPHY', 'PARKER', 'RYAN', 'SIMS', 'TUCKER', 'WOODS'];

export class Career {
  constructor(public s: CareerSave) {
    useDifficulty(loadSettings().difficulty); // star steps follow the difficulty setting
    if (!s.recruit) this.catchUpRecruiting(); // a save from before recruiting existed
    if (!s.events && s.phase === 'season') this.scheduleEvents(s.week); // a save from before events: the rest of this season
    else if ((s.recruit.formula ?? 1) < SCORE_FORMULA) { // scored by an older formula: re-score once
      if (s.phase === 'season' && !s.recruit.signed) {
        s.recruit.score = this.recruitScore();
        s.recruit.stars = starsFor(s.recruit.score);
      }
      s.recruit.formula = SCORE_FORMULA;
      saveCareer(s);
    }
  }

  static create(first: string, last: string, stateId: string, archetype: Archetype, quarterSeconds: number): Career {
    const seed = newSeed();
    const rng = new Rng(seed);
    const state = STATES.find((x) => x.id === stateId) ?? STATES[0];
    const ids = makeSchools(state, TEAMS, rng);
    const teams: Team[] = ids.map((idn, i) => {
      const prestige = Math.round(clamp(rng.range(15, 90), 0, 100));
      return { ...idn, id: i, region: i < TEAMS / 2 ? 0 : 1, prestige, off: 0, def: 0 };
    });
    for (const t of teams) rollStrength(t, rng, true);
    // your school: a middle-of-the-pack program, so there's something to build
    const mid = [...teams].sort((a, b) => Math.abs(a.prestige - 50) - Math.abs(b.prestige - 50)).slice(0, 4);
    const school = rng.pick(mid);
    const player = createPlayer(first, last, archetype);
    const s: CareerSave = {
      v: CAREER_VERSION, seed, state: state.id, player, teams, schoolId: school.id, year: 0, week: 1,
      games: [], focus: 'acc', role: 'backup', battle: 15, starter: null, log: [], dry: 0, phase: 'season',
      roster: makeRoster(school.name, 0, HS_TIER), recruit: newRecruiting(), recruitFeed: [], defense: 'play', calls: 'coach', quarter: quarterSeconds,
    };
    const c = new Career(s);
    c.startSeason(new Rng(seed + 1));
    return c;
  }

  // ---------- lookups ----------
  get player(): CareerPlayer { return this.s.player; }
  get school(): Team { return this.team(this.s.schoolId); }
  team(id: number): Team { return this.s.teams[id]; }
  get isPlayoffs(): boolean { return this.s.week > REGULAR_WEEKS; }
  /** Your game this week (null if your season is over). */
  get nextGame(): GameRec | null {
    if (this.s.phase !== 'season') return null;
    return this.s.games.find((g) => g.week === this.s.week && (g.home === this.s.schoolId || g.away === this.s.schoolId) && !played(g)) ?? null;
  }
  opponentOf(g: GameRec): Team { return this.team(g.home === this.s.schoolId ? g.away : g.home); }
  record(id = this.s.schoolId): { w: number; l: number; t: number; text: string } {
    const st = standings(this.s.teams, this.s.games).get(id)!;
    return { w: st.w, l: st.l, t: st.t, text: `${st.w}-${st.l}${st.t ? `-${st.t}` : ''}` };
  }
  get weekName(): string {
    const g = this.nextGame;
    if (g?.round) return ROUND_NAMES[g.round];
    return this.isPlayoffs ? 'PLAYOFFS' : `WEEK ${this.s.week}`;
  }

  /** Quick-sim strength of a team, with a QB of this overall if it's yours. */
  units(t: Team, qb?: number): Units {
    const qbEdge = qb === undefined ? 0 : (qb - qbNormOvr(HS_TIER)) * 0.5;
    return { off: t.off + qbEdge, def: t.def };
  }
  get starterOvr(): number { return this.s.role === 'starter' || !this.s.starter ? qbOvr(this.player) : this.s.starter.ovr; }

  /** Your team for a game, with you at quarterback. */
  rosterWithYou(): Roster {
    const r = this.s.roster;
    return { ...r, players: r.players.map((p) => (p.slot === 'QB' ? asRosterPlayer(this.player) : p)) };
  }
  opponentRoster(t: Team, strengthShift = 0): Roster {
    return makeRoster(t.name, (t.off + t.def) / 2 + strengthShift, HS_TIER);
  }

  // ---------- the season ----------

  private startSeason(rng: Rng): void {
    const s = this.s;
    s.games = makeSchedule(s.teams, rng);
    s.week = 1;
    s.log = [];
    s.dry = 0;
    this.scheduleEvents();
    s.phase = 'season';
    const school = this.school;
    s.roster = makeRoster(school.name, (school.off + school.def) / 2, HS_TIER);
    if (s.year >= HS_YEARS - 1) { s.role = 'starter'; s.starter = null; }
    else if (s.role !== 'starter') {
      // a senior ahead of you on the depth chart
      const name = `${STARTER_FIRST[rng.int(0, STARTER_FIRST.length - 1)]}.${rng.pick(STARTER_LAST)}`;
      const ovr = Math.round(qbNormOvr(HS_TIER) + (s.year === 0 ? rng.range(2, 6) : rng.range(-1, 4)));
      s.starter = { name, ovr };
      s.battle = s.year === 0 ? 15 : Math.round(clamp(s.battle * 0.8 + 15, 25, 75)); // the coaches remember last year
    }
    saveCareer(s);
  }

  /** Sets up this week's game. For a backup most of it is simulated, maybe up to a moment you come in. */
  prepareGame(): GamePlan | null {
    const rec = this.nextGame;
    if (!rec) return null;
    const opp = this.opponentOf(rec);
    const me = this.school;
    const youU = this.units(me, qbOvr(this.player)), oppU = this.units(opp);
    const m = new Match(Math.random() < 0.5 ? 'you' : 'cpu', this.s.quarter);
    m.names = { you: me.abbr, cpu: opp.abbr };
    const plan = (kind: Appearance, label: string, detail: string, endAtHalf = false): GamePlan =>
      ({ kind, label, detail, match: m, rec, opp, pre: { ...m.stats.you }, endAtHalf, units: { you: youU, cpu: oppU } });
    if (this.s.role === 'starter') return plan('full', 'YOU START', `${me.mascot} VS ${opp.mascot}`);

    // backup: the starter plays (simulated) until something gets you in
    const withStarter = { you: this.units(me, this.starterOvr), cpu: oppU };
    const meter = this.s.battle / 100;
    simUntil(m, withStarter, (x) => x.quarter >= 3 || (x.quarter === 2 && x.clock <= 120));
    if (!m.over && m.quarter === 2 && Math.random() < 0.06 + meter * 0.06) {
      return plan('scenario', 'TWO-MINUTE DRILL', 'THE STARTER IS SHAKEN UP. FINISH THE HALF', true);
    }
    simUntil(m, withStarter, (x) => x.quarter >= 3);
    const lead = () => m.score.you - m.score.cpu;
    if (!m.over && Math.random() < 0.06 + (lead() <= -10 ? 0.18 : 0) + meter * 0.12) {
      return plan('scenario', 'RELIEF', lead() < 0 ? 'THE STARTER IS STRUGGLING. THE 2ND HALF IS YOURS' : 'COACH WANTS A LOOK AT YOU. THE 2ND HALF IS YOURS');
    }
    simUntil(m, withStarter, (x) => x.quarter >= 4);
    if (!m.over && (Math.abs(lead()) >= 17 || (this.s.dry >= 2 && Math.random() < 0.6))) {
      return plan('scenario', 'MOP-UP DUTY', Math.abs(lead()) >= 17 ? 'THE GAME IS DECIDED. THE 4TH QUARTER IS YOURS' : 'COACH WANTS TO SEE YOU IN THE 4TH QUARTER');
    }
    simToEnd(m, withStarter);
    return plan('none', 'ON THE SIDELINE', 'YOU DID NOT GET IN THIS WEEK');
  }

  /**
   * After you've played your part. stint: your team's stats when you came off
   * (the two-minute drill) - otherwise you finished the game. Finishes the game
   * (simulating whatever is left), records it, sims the rest of the week and moves on.
   */
  finishGame(plan: GamePlan, stint?: TeamStats): WeekLog {
    const s = this.s, m = plan.match, me = this.school;
    const after = stint ? { ...stint } : { ...m.stats.you };
    if (!m.over) simToEnd(m, { you: this.units(me, this.starterOvr), cpu: plan.units.cpu });
    let us = m.score.you, them = m.score.cpu, ot = m.ot > 0;
    if (us === them) { // still tied (only if a game was cut short): settle it
      ot = true;
      if (overtimeWinner(plan.units.you, plan.units.cpu) === 'a') us += 7; else them += 7;
    }
    const rec = plan.rec, home = rec.home === s.schoolId;
    rec.hs = home ? us : them; rec.as = home ? them : us; rec.ot = ot;
    rec.box = home ? { home: { ...m.stats.you }, away: { ...m.stats.cpu } } : { home: { ...m.stats.cpu }, away: { ...m.stats.you } };

    const line = plan.kind === 'none' ? newStats() : diff(after, plan.pre);
    const won = us > them;
    const grade = plan.kind === 'none' ? null : gradeGame(line, plan.kind === 'full' ? won : null);
    const gains: Partial<Record<RatingKey, number>> = {};
    const add = (g: Partial<Record<RatingKey, number>>) => { for (const [k, n] of Object.entries(g) as [RatingKey, number][]) gains[k] = (gains[k] ?? 0) + n; };
    add(practice(this.player, s.focus));
    if (grade !== null) add(gameXp(this.player, grade, line.att + line.sacks));
    const news: string[] = [];

    let battle: number | null = null;
    if (s.role === 'backup' && s.starter) {
      const w = grade === null ? 0 : clamp((line.att + line.sacks) / 10, 0.3, 1.2);
      const delta = (grade === null ? 0 : (grade - 50) * 0.7 * w) + (s.year === 0 ? 2 : 6) + (qbOvr(this.player) - s.starter.ovr) * 0.5;
      s.battle = Math.round(clamp(s.battle + delta, 0, s.year === 0 ? 90 : 100));
      battle = s.battle;
      if (s.year > 0 && s.battle >= 100) {
        s.role = 'starter';
        news.push('YOU WON THE STARTING JOB!');
        s.starter = null;
      }
      s.dry = plan.kind === 'none' ? s.dry + 1 : 0;
    }
    const ev = this.eventFor(rec);
    const log: WeekLog = {
      week: rec.week, round: rec.round, opp: plan.opp.id, home, us, them, ot, kind: plan.kind, label: plan.label,
      line, grade, battle, gains, news,
    };
    if (ev && grade !== null && ev.kind !== 'scout') log.spotlight = ev.kind === 'site' ? 2 : 1.5;
    s.log.push(log);
    if (ev && grade === null) news.push(ev.kind === 'scout' ? 'THE SCOUT SAW YOU ON THE SIDELINE' : ev.kind === 'tv' ? 'ON TV, BUT YOU DID NOT PLAY' : `${SITE_NAME} CAME, BUT YOU DID NOT PLAY`);
    else if (ev?.kind === 'scout' && ev.school && grade !== null) news.push(...scoutReaction(s.recruit, college(ev.school)!, grade));
    else if (ev?.kind === 'tv' && grade !== null) news.push(...tvReaction(s.recruit, grade));
    this.recruitingUpdate(news, 1);
    if (ev?.kind === 'site' && grade !== null) {
      const rk = qbRank(s.recruit, s.state);
      news.push(rk.national > 999 ? `${SITE_NAME}: NOT RANKED YET` : `${SITE_NAME}: NO.${rk.national} QB IN THE NATION, NO.${rk.state} IN ${s.state}`);
    }
    this.simWeek(rec.week);
    this.advance(news);
    saveCareer(s);
    return log;
  }

  /** Every other game of the week. */
  private simWeek(week: number): void {
    for (const g of this.s.games) {
      if (g.week !== week || played(g)) continue;
      this.simRec(g);
    }
  }

  private simRec(g: GameRec): void {
    const h = this.team(g.home), a = this.team(g.away);
    const uh = this.units(h, g.home === this.s.schoolId ? this.starterOvr : undefined);
    const ua = this.units(a, g.away === this.s.schoolId ? this.starterOvr : undefined);
    const m = simGame(uh, ua, this.s.quarter);
    let hs = m.score.you, as = m.score.cpu;
    g.ot = m.ot > 0 || hs === as;
    if (hs === as) { if (overtimeWinner(uh, ua) === 'a') hs += 7; else as += 7; }
    g.hs = hs; g.as = as;
    g.box = { home: { ...m.stats.you }, away: { ...m.stats.cpu } };
  }

  /** Next week: sets up the playoffs after the regular season, sims the rest once you're out, ends the season. */
  private advance(news: string[]): void {
    const s = this.s;
    s.week++;
    if (s.week === REGULAR_WEEKS + 1 && !s.games.some((g) => g.round)) {
      const field = playoffField(s.teams, s.games);
      s.games.push(...field);
      const inIt = field.some((g) => g.home === s.schoolId || g.away === s.schoolId);
      news.push(inIt ? 'YOU MADE THE STATE PLAYOFFS!' : 'NO PLAYOFFS THIS YEAR');
    }
    // the next rounds of the playoffs, and the rest of them once you're out
    for (;;) {
      const seeds = this.seeds();
      const nr = nextRound(s.games, (id) => seeds.get(id) ?? 99);
      if (nr) s.games.push(...nr);
      if (this.isPlayoffs && !this.nextGame) {
        const left = s.games.filter((g) => g.round && !played(g));
        if (!left.length) break;
        const wk = Math.min(...left.map((g) => g.week));
        this.simWeek(wk);
        continue;
      }
      break;
    }
    if (this.isPlayoffs && !this.nextGame && s.games.filter((g) => g.round).every(played)) this.endSeason(news);
  }

  /** Playoff seeds: 1-4 in each region, by the regular season. */
  private seeds(): Map<number, number> {
    const out = new Map<number, number>();
    for (const r of [0, 1]) regionOrder(this.s.teams, this.s.games.filter((g) => !g.round), r).forEach((st, i) => out.set(st.id, i + 1));
    return out;
  }

  /** How your season ended, in words. */
  finish(): string {
    const s = this.s, mine = s.games.filter((g) => g.round && (g.home === s.schoolId || g.away === s.schoolId));
    if (!mine.length) return 'MISSED THE PLAYOFFS';
    const last = mine[mine.length - 1];
    if (!played(last)) return 'IN THE PLAYOFFS';
    if (winnerOf(last) === s.schoolId) return last.round === 'F' ? 'STATE CHAMPIONS' : 'IN THE PLAYOFFS';
    return last.round === 'F' ? 'STATE RUNNER-UP' : `LOST IN THE ${ROUND_NAMES[last.round!]}`;
  }

  get champion(): Team | null {
    const f = this.s.games.find((g) => g.round === 'F');
    return f && played(f) ? this.team(winnerOf(f)) : null;
  }

  private endSeason(news: string[]): void {
    const s = this.s, p = this.player;
    const line = newStats();
    let gp = 0, gs = 0, gradeSum = 0, graded = 0;
    for (const l of s.log) {
      if (l.kind !== 'none') gp++;
      if (l.kind === 'full') gs++;
      for (const k of Object.keys(line) as (keyof TeamStats)[]) line[k] += l.line[k];
      if (l.grade !== null) { gradeSum += l.grade; graded++; }
    }
    const avg = graded ? gradeSum / graded : 50;
    const rec = this.record();
    const finish = this.finish();
    const stars = s.recruit.stars;
    const region = regionOrder(s.teams, s.games.filter((g) => !g.round), this.school.region);
    const awards: string[] = [];
    if (finish === 'STATE CHAMPIONS') awards.push('STATE CHAMPION');
    if (region[0].id === s.schoolId) awards.push('REGION CHAMPION');
    if (gs >= 6 && avg >= 72) awards.push('ALL-STATE QB');
    else if (gs >= 6 && avg >= 62) awards.push('ALL-REGION QB');
    p.awards.push(...awards.map((a) => `${a} (${['SO', 'JR', 'SR'][s.year]})`));
    p.seasons.push({
      year: s.year, school: this.school.name, role: gs >= 5 ? 'STARTER' : 'BACKUP', gp, gs, stats: line,
      record: rec.text, finish, ovr: qbOvr(p), stars, prod: Math.round(this.productionNow() * 10) / 10,
    });
    news.push(`SEASON OVER: ${finish}`);
    s.phase = 'summary';
  }

  /** From the season summary: the off-season, then the next season (or the end of high school). */
  nextSeason(): void {
    const s = this.s;
    if (s.phase !== 'summary') return;
    if (s.year >= HS_YEARS - 1) { // the weeks before signing day: late offers for late bloomers
      this.recruitingUpdate([], 4);
      s.phase = 'signing';
      saveCareer(s);
      return;
    }
    const rng = new Rng(s.seed + 100 * (s.year + 2));
    offseason(this.player);
    rollNeeds(s.recruit);
    for (const t of s.teams) {
      const st = standings(s.teams, s.games).get(t.id)!;
      t.prestige = Math.round(clamp(t.prestige * 0.85 + (st.w / Math.max(1, st.w + st.l)) * 100 * 0.15, 0, 100));
      rollStrength(t, rng, false);
    }
    s.year++;
    this.startSeason(rng);
    this.recruitingUpdate([], 4); // the summer: camps, visits, film
    saveCareer(s);
  }

  // ---------- recruiting ----------

  // ---------- events ----------

  /**
   * This season's spotlight games (juniors and seniors), from week `from` on:
   * two scout games, one or two recruiting site evaluations (two as a senior),
   * one or two TV games. Playoff semifinals and the state title are always on TV.
   */
  private scheduleEvents(from = 1): void {
    const s = this.s;
    s.events = [];
    if (s.year < 1) return;
    const weeks = Array.from({ length: REGULAR_WEEKS - from + 1 }, (_, i) => from + i).sort(() => Math.random() - 0.5);
    const kinds: EventKind[] = ['scout', 'scout', 'site', ...(s.year >= 2 ? ['site' as EventKind] : []), 'tv', ...(Math.random() < 0.5 ? ['tv' as EventKind] : [])];
    kinds.forEach((kind, i) => { if (i < weeks.length) s.events!.push({ week: weeks[i], kind }); });
    s.events.sort((a, b) => a.week - b.week);
  }

  /** The spotlight for a game (the scout's school is picked when the week comes, so it fits who you are then). */
  eventFor(g: GameRec): GameEvent | null {
    const s = this.s;
    if (g.round === 'SF' || g.round === 'F') return { week: g.week, kind: 'tv' };
    if (g.round) return null;
    const ev = s.events?.find((e) => e.week === g.week) ?? null;
    if (ev?.kind === 'scout' && !ev.school) {
      const c = pickScout(s.recruit, s.state);
      if (c) ev.school = c.id; else ev.kind = 'site';
      saveCareer(s);
    }
    return ev;
  }

  /** The event coming up this week, in words for the hub and game day (null = none). */
  eventText(g: GameRec | null): { tag: string; text: string } | null {
    const ev = g ? this.eventFor(g) : null;
    if (!ev) return null;
    if (ev.kind === 'scout') { const c = college(ev.school!)!; return { tag: `${c.abbr} SCOUT`, text: `A ${c.name} SCOUT IS IN THE STANDS` }; }
    if (ev.kind === 'site') return { tag: SITE_NAME, text: `${SITE_NAME} IS HERE TO EVALUATE YOU: THIS GAME COUNTS DOUBLE` };
    return { tag: 'ON TV', text: 'THIS GAME IS ON TV: COLLEGES ARE WATCHING' };
  }

  /** Your QB ranking (juniors and seniors). */
  rank(): { national: number; state: number } | null { return this.s.year >= 1 ? qbRank(this.s.recruit, this.s.state) : null; }

  /** This season's production so far (grades, wins as the starter, playoff wins, a title). */
  productionNow(): number {
    const s = this.s;
    const graded = s.log.filter((l) => l.grade !== null);
    const starts = s.log.filter((l) => l.kind === 'full');
    // spotlight games (the recruiting site, TV) weigh more in the average
    const wsum = graded.reduce((t, l) => t + (l.spotlight ?? 1), 0);
    const avg = graded.length ? graded.reduce((t, l) => t + l.grade! * (l.spotlight ?? 1), 0) / wsum : 55;
    const champ = starts.some((l) => l.round === 'F' && l.us > l.them);
    return production(avg, starts.length, starts.filter((l) => l.us > l.them).length,
      starts.filter((l) => l.round && l.us > l.them).length, champ);
  }

  /** Your recruiting score right now: your ratings for your class, plus how you're playing (this season, then last). */
  recruitScore(): number {
    const s = this.s, p = this.player;
    const talent = (qbOvr(p) - classNorm(s.year, s.week)) * 2.2;
    const graded = s.log.filter((l) => l.grade !== null);
    const now = this.productionNow();
    const last = p.seasons[p.seasons.length - 1];
    const prev = last ? seasonProduction(last) : 0;
    // early in a season last season carries the score; it stays on the resume (RESUME) all year
    const w = clamp(graded.length / 6, 0, 1);
    return Math.round((talent + w * now + ((1 - w) + w * RESUME) * prev) * 10) / 10;
  }

  /** Re-scores you and runs weeks of college interest; adds the news. */
  private recruitingUpdate(news: string[], weeks: number): void {
    const s = this.s, r = s.recruit;
    const before = r.stars;
    useDifficulty(loadSettings().difficulty);
    r.score = this.recruitScore();
    r.stars = starsFor(r.score);
    if (r.stars !== before && before > 0) news.push(r.stars > before ? `NOW A ${r.stars}-STAR RECRUIT!` : `DOWN TO ${r.stars} STARS`);
    for (let i = 0; i < weeks; i++) news.push(...recruitingWeek(r, s.state, s.year >= 1));
    const fresh = news.filter((n) => n.startsWith('OFFER') || n.includes('STAR'));
    s.recruitFeed = [...fresh.reverse(), ...s.recruitFeed].slice(0, 10);
  }

  /** Why you can't take an official visit right now (null = you can). */
  visitBlocked(id: string): string | null {
    const s = this.s, r = s.recruit;
    if (r.signed || s.phase === 'signing' || s.phase === 'done') return 'RECRUITING IS OVER';
    if (s.year < 1) return 'VISITS START IN YOUR JUNIOR YEAR';
    if (r.visits.length >= MAX_VISITS) return 'NO OFFICIAL VISITS LEFT';
    if (r.visits.includes(id)) return 'ALREADY VISITED';
    if (r.lastVisit === `${s.year}-${s.week}`) return 'ONE VISIT A WEEK';
    return null;
  }

  /** Take an official visit (see officialVisit). Returns the news, or null if you can't. */
  visit(id: string): string[] | null {
    const c = college(id);
    if (!c || this.visitBlocked(id)) return null;
    const s = this.s;
    s.recruit.lastVisit = `${s.year}-${s.week}`;
    const news = officialVisit(s.recruit, c);
    s.recruitFeed = [...[...news].reverse(), ...s.recruitFeed].slice(0, 10);
    saveCareer(s);
    return news;
  }

  /** Commit to a school that offered (or take back a commitment with null). */
  commit(id: string | null): void {
    const r = this.s.recruit;
    if (r.signed || (id && !r.offers.includes(id))) return;
    r.committed = id;
    this.s.recruitFeed = [id ? `COMMITTED TO ${college(id)!.name}` : 'DECOMMITTED', ...this.s.recruitFeed].slice(0, 10);
    saveCareer(this.s);
  }

  /** Signing day: sign with a school (an offer, or a walk-on spot). High school is over. */
  sign(id: string): void {
    const r = this.s.recruit;
    if (this.s.phase !== 'signing' || !college(id)) return;
    r.signed = id;
    r.committed = id;
    this.player.awards.push(`SIGNED: ${college(id)!.name}${r.offers.includes(id) ? '' : ' (WALK-ON)'}`);
    this.s.phase = 'done';
    saveCareer(this.s);
  }

  /** Saves from before recruiting: start it and give it the weeks it missed. */
  private catchUpRecruiting(): void {
    const s = this.s;
    s.recruit = newRecruiting();
    s.recruitFeed = [];
    const r = s.recruit;
    r.score = this.recruitScore();
    r.stars = starsFor(r.score);
    const weeksThisYear = s.phase === 'season' ? s.week - 1 : 14;
    // sophomore weeks: noticed, no offers; then every summer and junior/senior week can bring offers
    const soWeeks = s.year === 0 ? weeksThisYear : 11;
    const offerWeeks = s.year === 0 ? 0 : s.year === 1 ? 4 + weeksThisYear : 4 + 11 + 4 + weeksThisYear;
    for (let i = 0; i < soWeeks; i++) recruitingWeek(r, s.state, false);
    const news: string[] = [];
    for (let i = 0; i < offerWeeks; i++) news.push(...recruitingWeek(r, s.state, true));
    s.recruitFeed = news.filter((n) => n.startsWith('OFFER')).reverse().slice(0, 10);
    if (s.phase === 'done' && !r.signed) s.phase = 'signing'; // graduated before signing day existed
    saveCareer(s);
  }
}

/** A team's strength for the season: pulled toward its prestige, with turnover from graduation. */
function rollStrength(t: Team, rng: Rng, fresh: boolean): void {
  const target = (t.prestige - 50) / 7;
  const base = fresh ? target + rng.range(-3, 3) : ((t.off + t.def) / 2) * 0.35 + target * 0.65 + rng.range(-3, 3);
  t.off = Math.round((base + rng.range(-2, 2)) * 10) / 10;
  t.def = Math.round((base + rng.range(-2, 2)) * 10) / 10;
}

function diff(a: TeamStats, b: TeamStats): TeamStats {
  const out = newStats();
  for (const k of Object.keys(out) as (keyof TeamStats)[]) out[k] = Math.max(0, a[k] - b[k]);
  return out;
}

