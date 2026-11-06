// A full game: 4 quarters, score, clock, possession, and timeouts. Passing
// only, no kicks: a touchdown is worth 7, the other team then starts at its
// 25. On 4th down a team can punt (simulated).
//
// Clock: it runs during plays. After a catch in bounds or a sack it keeps
// running between plays (the game ticks it while you huddle, up to a 25-second
// play clock), so hurrying up saves time. Incompletions, out of bounds, scores
// and turnovers stop it. It stops at the two-minute warning in Q2 and Q4, and
// a timeout stops it.
import { C } from './config';
import { Drive, type PlayRaw, START_YARD, type TeamStats, newStats } from './drive';
import { clamp, rand } from './util';

export type Side = 'you' | 'cpu';
export const QUARTER_SECONDS = 180;
export const PLAY_CLOCK = 25; // most seconds that can run off between plays
const TD_POINTS = 7;
const TIMEOUTS = 3; // per team, per half
const OT_YARD = 75; // overtime possessions start at the other team's 25

/** A result banner, written from your point of view (green/yellow = good for you). */
export interface Banner { headline: string; color: string; detail: string; note?: string }

/** A game picked up in the middle: used for scenario snaps (mop-up, relief, two-minute drill). */
export interface Situation {
  quarter: number;
  clock: number; // seconds left in the quarter
  score: Record<Side, number>;
  offense: Side;
  ballOn: number;
  down?: number;
  toGo?: number;
  ballX?: number;
  timeouts?: Record<Side, number>;
  firstOffense?: Side; // who had the ball first (the other team gets it after halftime)
  stats?: Record<Side, TeamStats>; // what has happened so far
}

const other = (s: Side): Side => (s === 'you' ? 'cpu' : 'you');
const fmtYds = (g: number) => (g > 0 ? `+${g} YDS` : g < 0 ? `${g} YDS` : 'NO GAIN');

export class Match {
  quarter = 1;
  clock: number;
  score: Record<Side, number> = { you: 0, cpu: 0 };
  stats: Record<Side, TeamStats> = { you: newStats(), cpu: newStats() };
  offense: Side;
  drive = new Drive();
  over = false;
  clockRunning = false; // is the clock running between plays?
  timeouts: Record<Side, number> = { you: TIMEOUTS, cpu: TIMEOUTS };
  names: Record<Side, string> = { you: 'YOU', cpu: 'CPU' }; // how the banners name each team
  /**
   * Overtime (college style, no kicks): tied after four quarters, each team gets
   * a possession from the 25 with no clock; after both have had it, the leader
   * wins, otherwise another round (the other team goes first). 0 = regulation.
   */
  ot = 0;
  private otPoss = 0; // possessions finished in this overtime round
  private otFirst: Side = 'you';
  private warned = new Set<number>(); // quarters that have had their two-minute warning
  private firstOffense: Side;

  constructor(first: Side = 'you', readonly quarterSeconds = QUARTER_SECONDS) {
    this.offense = first;
    this.firstOffense = first;
    this.clock = quarterSeconds;
  }

  /** A game in progress: the quarter, clock, score, field position and down you pick it up at. */
  static fromSituation(s: Situation, quarterSeconds = QUARTER_SECONDS): Match {
    const m = new Match(s.firstOffense ?? (s.quarter >= 3 ? other(s.offense) : s.offense), quarterSeconds);
    m.quarter = s.quarter;
    m.clock = Math.min(s.clock, quarterSeconds);
    m.score = { ...s.score };
    m.offense = s.offense;
    m.drive = new Drive(s.ballOn);
    if (s.down) m.drive.down = s.down;
    if (s.toGo) m.drive.toGo = Math.min(s.toGo, 100 - s.ballOn);
    else m.drive.toGo = Math.min(10, 100 - s.ballOn);
    m.drive.ballX = s.ballX ?? 0;
    if (s.timeouts) m.timeouts = { ...s.timeouts };
    if (s.stats) m.stats = { you: { ...s.stats.you }, cpu: { ...s.stats.cpu } };
    for (const q of [2, 4]) if (s.quarter > q || (s.quarter === q && m.clock <= 120)) m.warned.add(q);
    return m;
  }

  /** Who had the ball first (the other team receives after halftime). */
  get receivedFirst(): Side { return this.firstOffense; }

  get defense(): Side { return other(this.offense); }
  /** "Q3 1:45", or "OT" / "OT2" in overtime. */
  get periodText(): string { return this.ot ? `OT${this.ot > 1 ? this.ot : ''}` : `Q${this.quarter} ${this.clockText}`; }
  get clockText(): string {
    const s = Math.max(0, Math.ceil(this.clock));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** Applies a finished play. playSeconds is how long the play itself took. */
  afterPlay(p: PlayRaw, playSeconds: number): Banner {
    const off = this.offense;
    const mine = off === 'you';
    const N = this.names;
    const o = this.drive.apply(p, this.stats[off]);
    const running = (o.result === 'catch' && !o.outOfBounds && o.event.kind === 'continue') || o.result === 'sack';
    const yds = fmtYds(o.gained);
    let b: Banner;

    switch (o.event.kind) {
      case 'td':
        this.score[off] += TD_POINTS;
        b = {
          headline: mine ? 'TOUCHDOWN!' : `${N.cpu} TOUCHDOWN`, color: mine ? C.yellow : C.red,
          detail: `${yds} - ${o.playsInDrive} PLAY DRIVE`, note: `${mine ? N.you : N.cpu} +${TD_POINTS}`,
        };
        this.changePossession(START_YARD);
        break;
      case 'int': {
        const at = o.event.atYard;
        const spot = at >= 100 ? 20 : clamp(Math.round(100 - at), 1, 99); // picked in the end zone: touchback
        b = { headline: mine ? 'INTERCEPTED!' : 'PICKED OFF!', color: mine ? C.red : C.green, detail: `TURNOVER - ${mine ? `${N.cpu}` : 'YOUR'} BALL` };
        this.changePossession(spot);
        break;
      }
      case 'downs':
        b = { headline: 'TURNOVER ON DOWNS', color: mine ? C.red : C.green, detail: `${yds} - ${mine ? N.cpu : 'YOUR'} BALL` };
        this.changePossession(100 - this.drive.ballOn);
        break;
      default: {
        const r = o.result;
        const headline = mine
          ? (r === 'catch' ? 'CATCH!' : r === 'sack' ? 'SACK!' : 'INCOMPLETE')
          : (r === 'catch' ? 'CAUGHT' : r === 'sack' ? 'SACK!' : 'INCOMPLETE');
        const good = mine ? r === 'catch' : r !== 'catch';
        const color = r === 'inc' ? (mine ? C.grey : C.green) : good ? C.green : mine ? C.orange : C.red;
        b = { headline, color, detail: `${yds}${o.firstDown ? ' - FIRST DOWN' : o.outOfBounds ? ' - OUT' : ''}` };
      }
    }
    if (this.ot) { // overtime: no clock; a possession ends with a score, a pick or on downs
      if (o.event.kind !== 'continue') this.otPossessionOver(off, b);
      this.clockRunning = false;
      return b;
    }
    const q = this.quarter;
    const warning = this.tick(playSeconds);
    this.clockRunning = running && this.quarter === q && !warning;
    if (warning) b.note = 'TWO-MINUTE WARNING';
    return b;
  }

  private startOvertime(): void {
    this.ot = 1;
    this.otPoss = 0;
    this.quarter = 5;
    this.clock = 0;
    this.otFirst = Math.random() < 0.5 ? 'you' : 'cpu'; // the coin toss
    this.offense = this.otFirst;
    this.drive = new Drive(OT_YARD);
    this.timeouts = { you: 1, cpu: 1 };
    this.clockRunning = false;
  }

  private otPossessionOver(had: Side, b: Banner): void {
    this.otPoss++;
    const note = (t: string) => { b.note = b.note ? `${b.note} - ${t}` : t; };
    if (this.otPoss === 1) {
      this.offense = other(had);
      this.drive = new Drive(OT_YARD);
      note(`${this.offense === 'you' ? 'YOUR' : this.names.cpu} TURN AT THE 25`);
      return;
    }
    if (this.score.you !== this.score.cpu) { this.over = true; note('FINAL (OT)'); return; }
    this.ot++;
    this.otPoss = 0;
    this.otFirst = other(this.otFirst);
    this.offense = this.otFirst;
    this.drive = new Drive(OT_YARD);
    this.timeouts = { you: 1, cpu: 1 };
    note(`STILL TIED: OT${this.ot}`);
  }

  /** The offense punts on 4th down. */
  punt(): Banner {
    const kicker = this.offense;
    const from = this.drive.ballOn;
    const dist = Math.round(rand(36, 50));
    const lands = from + dist;
    const spot = lands >= 100 ? 20 : Math.round(100 - lands); // into the end zone: touchback
    this.changePossession(spot);
    this.tick(6);
    this.clockRunning = false;
    const receiver = this.offense;
    return {
      headline: kicker === 'you' ? 'YOU PUNT' : `${this.names.cpu} PUNTS`, color: C.grey,
      detail: lands >= 100 ? `${dist} YD PUNT - TOUCHBACK` : `${dist} YD PUNT`,
      note: `${receiver === 'you' ? 'YOUR' : this.names.cpu} BALL AT ${spot === 50 ? '50' : `${receiver === 'you' ? 'OWN' : 'THEIR'} ${spot}`}`,
    };
  }

  private changePossession(newBallOn: number): void {
    this.offense = other(this.offense);
    this.drive = new Drive(newBallOn);
  }

  /**
   * Time running off between plays (only while the clock is running).
   * Returns what happened, if anything: the two-minute warning or the end of a quarter.
   */
  tickBetween(seconds: number): 'warning' | 'quarter' | null {
    if (!this.clockRunning || this.over || this.ot) return null;
    const q = this.quarter;
    const warning = this.tick(seconds, true);
    if (this.quarter !== q || this.over) { this.clockRunning = false; return 'quarter'; }
    if (warning) { this.clockRunning = false; return 'warning'; }
    return null;
  }

  /** Calls a timeout (between plays). Returns false if the team has none left. */
  timeout(side: Side): boolean {
    if (this.timeouts[side] <= 0 || this.over) return false;
    this.timeouts[side]--;
    this.clockRunning = false;
    return true;
  }

  /** Runs the clock; true if that crossed the two-minute warning. */
  private tick(seconds: number, stopAtWarning = false): boolean {
    if (this.ot) return false; // no clock in overtime
    const before = this.clock;
    this.clock -= seconds;
    let warning = false;
    if ((this.quarter === 2 || this.quarter === 4) && before > 120 && this.clock <= 120 && !this.warned.has(this.quarter)) {
      this.warned.add(this.quarter);
      warning = true;
      if (stopAtWarning) this.clock = 120; // between plays the clock stops right at 2:00
    }
    if (this.clock > 0) return warning;
    if (this.quarter === 4) {
      this.clock = 0;
      if (this.score.you === this.score.cpu) this.startOvertime(); // tied: overtime
      else this.over = true;
      return false;
    }
    this.quarter++;
    this.clock = this.quarterSeconds;
    if (this.quarter === 3) { // halftime: the other team gets the ball first, timeouts reset
      this.offense = other(this.firstOffense);
      this.drive = new Drive(START_YARD);
      this.timeouts = { you: TIMEOUTS, cpu: TIMEOUTS };
    }
    return false;
  }
}
