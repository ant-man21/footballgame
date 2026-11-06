// The quick-sim: plays a game (or part of one) in milliseconds from two teams'
// unit ratings. It drives a real Match with made-up play outcomes, so the clock
// rules, downs, punts, possession and stats are exactly the played game's.
// Calibrated against auto-played games (scripts/balance/quicksim.cjs).
import { cpuGoesForIt } from '../cpu';
import { type Side, Match } from '../match';
import { clamp, rand } from '../util';

/** A team's strength in rating points vs the norm for its tier (0 = an average team). */
export interface Units { off: number; def: number }

export interface SimOptions {
  /** Average game seconds that run off between plays while the clock runs. Auto-play ~6; people huddle longer. */
  runoff?: number;
}
/** What a person playing tends to burn between plays (coach-called plays, no huddle screen). */
export const HUMAN_RUNOFF = 11;

const EDGE_MAX = 15;

/**
 * One play by the team with the ball. edge: its offense minus the defense it
 * faces, in rating points. Returns false if the game is over.
 */
export function simPlay(m: Match, u: Record<Side, Units>, o: SimOptions = {}): boolean {
  if (m.over) return false;
  const off = m.offense, def = m.defense, d = m.drive;
  if (d.down === 4) {
    const lead = m.score[off] - m.score[def];
    if (!cpuGoesForIt(d, lead, m.quarter, m.clock)) { m.punt(); return !m.over; }
  }
  const e = clamp(u[off].off - u[def].def, -EDGE_MAX, EDGE_MAX);
  const toGoal = 100 - d.ballOn;
  const r = Math.random();
  const pSack = 0.006 * clamp(1 - e * 0.05, 0.4, 2);
  const pInt = 0.018 * clamp(1 - e * 0.07, 0.35, 2.2);
  const pCmp = clamp(0.7 + e * 0.011, 0.45, 0.86);
  let secs: number;
  if (r < pSack) {
    m.afterPlay({ result: 'sack', yards: -rand(3, 8), touchdown: false, outOfBounds: false }, rand(3, 4.5));
  } else if (r < pSack + pInt) {
    m.afterPlay({ result: 'int', yards: Math.min(toGoal + 5, rand(6, 28)), touchdown: false, outOfBounds: false }, rand(3, 5));
  } else if (Math.random() < pCmp) {
    const k = Math.random();
    let yds = k < 0.5 ? rand(2, 10) : k < 0.85 ? rand(8, 19) : k < 0.96 ? rand(17, 34) : rand(30, 70);
    yds *= clamp(1 + e * 0.018, 0.65, 1.35);
    const td = yds >= toGoal;
    secs = 2.6 + Math.min(yds, toGoal) * 0.08;
    m.afterPlay({ result: 'catch', yards: td ? toGoal : yds, touchdown: td, outOfBounds: !td && Math.random() < 0.18 }, secs);
  } else {
    m.afterPlay({ result: 'inc', yards: 0, touchdown: false, outOfBounds: false }, rand(2.2, 3.4));
  }
  if (m.clockRunning && !m.over) m.tickBetween((o.runoff ?? HUMAN_RUNOFF) * rand(0.6, 1.4));
  return !m.over;
}

/** Plays on until the game is over. */
export function simToEnd(m: Match, u: Record<Side, Units>, o: SimOptions = {}): void {
  let guard = 0;
  while (!m.over && guard++ < 2000) simPlay(m, u, o);
}

/** Plays on until stop() says so (checked before every play) or the game ends. */
export function simUntil(m: Match, u: Record<Side, Units>, stop: (m: Match) => boolean, o: SimOptions = {}): void {
  let guard = 0;
  while (!m.over && !stop(m) && guard++ < 2000) simPlay(m, u, o);
}

export type DriveEnd = 'td' | 'punt' | 'int' | 'downs' | 'half' | 'end';
export interface DriveSummary { team: Side; end: DriveEnd; plays: number; yards: number; secs: number; startOn: number }

/** Simulates the rest of the current drive: until the ball changes hands, the half ends or the game ends. */
export function simDrive(m: Match, u: Record<Side, Units>, o: SimOptions = {}): DriveSummary {
  const team = m.offense, startOn = m.drive.ballOn, half = m.quarter <= 2 ? 1 : 2;
  const t0 = elapsed(m), score0 = m.score[team], int0 = m.stats[team].int, yds0 = m.stats[team].yards, plays0 = m.stats[team].plays;
  let punted = false;
  let guard = 0;
  while (!m.over && m.offense === team && (m.quarter <= 2 ? 1 : 2) === half && guard++ < 200) {
    const down4 = m.drive.down === 4;
    const before = m.stats[team].plays;
    simPlay(m, u, o);
    if (down4 && m.stats[team].plays === before) punted = true;
  }
  const halfOver = (m.quarter <= 2 ? 1 : 2) !== half;
  const end: DriveEnd = m.score[team] > score0 ? 'td' : m.stats[team].int > int0 ? 'int' : punted ? 'punt'
    : m.over ? 'end' : halfOver ? 'half' : 'downs';
  return { team, end, plays: m.stats[team].plays - plays0, yards: m.stats[team].yards - yds0, secs: elapsed(m) - t0, startOn };
}

/** Game seconds played so far. */
export const elapsed = (m: Match) => (m.quarter - 1) * m.quarterSeconds + (m.quarterSeconds - m.clock);

/** A whole game between two teams ('you' = home here). Ties are left to the caller (overtime). */
export function simGame(home: Units, away: Units, quarterSeconds: number, o: SimOptions = {}): Match {
  const m = new Match(Math.random() < 0.5 ? 'you' : 'cpu', quarterSeconds);
  simToEnd(m, { you: home, cpu: away }, o);
  return m;
}

/** Overtime for a tie (no kicks, so a coin flip weighted by strength): returns the winner. */
export function overtimeWinner(a: Units, b: Units): 'a' | 'b' {
  const edge = (a.off - b.def) - (b.off - a.def);
  return Math.random() < clamp(0.5 + edge * 0.02, 0.2, 0.8) ? 'a' : 'b';
}
