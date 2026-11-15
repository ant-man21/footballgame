// A full game: 4 quarters, score, clock, possession, and timeouts. The plays
// are passes; kicks are simulated. A touchdown is worth 6, then a try: kick the
// extra point (simulated) or go for two (one play from the 3). Then a kickoff
// (simulated return, or an onside kick). A ball carrier downed in his own end
// zone is a safety: 2 points, then a free kick. On 4th down a team can punt
// (with a return, a fair catch, the odd muff or block) or kick a field goal.
//
// Choices: `asks(side)` says which team decides for itself (you, when you call
// your own plays): its try waits for kickExtraPoint() or a play (two points),
// and its kickoffs wait for kickoff(onside). Everyone else uses the CPU's charts.
//
// Clock: it runs during plays. After a catch in bounds or a sack it keeps
// running between plays (the game ticks it while you huddle, up to a 25-second
// play clock), so hurrying up saves time. Incompletions, out of bounds, scores
// and turnovers stop it. It stops at the two-minute warning in Q2 and Q4, and
// a timeout stops it.
import { C } from './config';
import { Drive, type PlayRaw, START_YARD, type TeamStats, newStats } from './drive';
import { fgDistance, fgOdds, onsideCall, twoPointCall } from './cpu';
import { clamp, rand } from './util';

export type Side = 'you' | 'cpu';
export const QUARTER_SECONDS = 180;
export const PLAY_CLOCK = 25; // most seconds that can run off between plays
const TD_POINTS = 6;
const PAT_ODDS = 0.92; // the extra point is simulated
const TIMEOUTS = 3; // per team, per half
const OT_YARD = 75; // overtime possessions start at the other team's 25
const SHOOTOUT_POINTS = 2; // ...worth 2
const SHOOTOUT_YARD = 95; // from the 3rd overtime: one play from the 5 (a shootout, like college's two-point tries)
const TRY_YARD = 97; // a two-point try is snapped from the 3 (high school and college)
const TOUCHBACK = 25;

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
const addNote = (b: Banner, t: string) => { b.note = b.note ? `${b.note} - ${t}` : t; };
/** A yard line from a team's own view, in words. */
const spotWords = (y: number) => (y === 50 ? 'THE 50' : y < 50 ? `OWN ${y}` : `OPP ${100 - y}`);

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
  /** A try in progress: the team that just scored (the ball at the 3). */
  tryFor: Side | null = null;
  /** The team trying hasn't decided yet: kick the extra point, or snap it (two points). */
  tryChoice = false;
  /** A kickoff waiting for the kicking team's choice (deep or onside). */
  kickoffBy: Side | null = null;
  private kickFree = false; // the kick after a safety (from the 20: no touchbacks, a better return)
  /** Which teams make their own try and kickoff choices (the rest use the CPU's charts). */
  asks: ((side: Side) => boolean) | null = null;
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
    if (this.tryFor) return this.tryResult(p);
    const off = this.offense;
    const mine = off === 'you';
    const N = this.names;
    const o = this.drive.apply(p, this.stats[off]);
    const running = ((o.result === 'catch' || o.result === 'run') && !o.outOfBounds && o.event.kind === 'continue') || o.result === 'sack';
    const yds = fmtYds(o.gained);
    let b: Banner;
    let warning = false, ticked = false;
    // a score: the play's time runs first (a try or a kickoff still comes if the clock runs out)
    const scoreTick = () => { ticked = true; warning = this.ot ? false : this.tick(playSeconds); };

    switch (o.event.kind) {
      case 'td': {
        if (this.ot >= 3) { // a shootout score is worth 2, no try
          this.score[off] += SHOOTOUT_POINTS;
          b = { headline: mine ? 'GOOD!' : `${N.cpu} SCORES`, color: mine ? C.yellow : C.red, detail: 'TWO-POINT SHOOTOUT', note: `${mine ? N.you : N.cpu} +${SHOOTOUT_POINTS}` };
          break;
        }
        b = {
          headline: mine ? 'TOUCHDOWN!' : `${N.cpu} TOUCHDOWN`, color: mine ? C.yellow : C.red,
          detail: `${yds} - ${o.playsInDrive} PLAY DRIVE`,
        };
        this.tryFor = off; // holds the end of the period
        scoreTick();
        this.touchdown(off, b);
        break;
      }
      case 'safety': {
        const def = other(off);
        this.score[def] += 2;
        b = { headline: 'SAFETY!', color: mine ? C.red : C.green, detail: `DOWNED IN THE END ZONE - ${mine ? N.cpu : N.you} +2`, note: undefined };
        this.kickoffBy = off; // holds the end of the period
        scoreTick();
        this.afterScore(off, b, true); // the team that gave it up kicks
        break;
      }
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
        const ran = r === 'run', gain = o.gained > 0;
        const headline = ran ? (gain ? (mine ? 'QB KEEPER!' : `${N.cpu} QB RUNS`) : 'STUFFED!') : mine
          ? (r === 'catch' ? 'CATCH!' : r === 'sack' ? 'SACK!' : 'INCOMPLETE')
          : (r === 'catch' ? 'CAUGHT' : r === 'sack' ? 'SACK!' : 'INCOMPLETE');
        const good = ran ? gain === mine : mine ? r === 'catch' : r !== 'catch';
        const color = r === 'inc' ? (mine ? C.grey : C.green) : good ? C.green : mine ? C.orange : C.red;
        b = { headline, color, detail: `${yds}${o.firstDown ? ' - FIRST DOWN' : o.outOfBounds ? ' - OUT' : ''}` };
      }
    }
    if (this.ot) { // overtime: no clock; a possession ends with a score, a pick or on downs (one play in a shootout)
      if (this.ot >= 3 ? !this.tryFor : o.event.kind === 'int' || o.event.kind === 'downs') this.otPossessionOver(off, b);
      this.clockRunning = false;
      return b;
    }
    const q = this.quarter;
    if (!ticked) warning = this.tick(playSeconds);
    this.clockRunning = running && this.quarter === q && !warning && !this.pending;
    if (warning) addNote(b, 'TWO-MINUTE WARNING');
    return b;
  }

  /** A try or a kickoff is waiting (the period can't end yet). */
  get pending(): boolean { return this.tryFor !== null || this.kickoffBy !== null; }

  /** Six points: set up the try (decided by the CPU's chart unless this team decides for itself). */
  private touchdown(side: Side, b: Banner): void {
    this.score[side] += TD_POINTS;
    this.offense = side;
    this.tryFor = side;
    this.tryChoice = false;
    this.drive = new Drive(TRY_YARD);
    this.drive.isTry = true;
    const who = side === 'you' ? this.names.you : this.names.cpu;
    if (this.ot >= 2) { addNote(b, `${who} +6 - MUST GO FOR 2`); return; }
    if (this.asks?.(side)) { this.tryChoice = true; addNote(b, `${who} +6 - KICK OR GO FOR 2`); return; }
    if (twoPointCall(this.score[side] - this.score[other(side)], this.quarter, this.ot)) { addNote(b, `${who} +6 - GOING FOR 2`); return; }
    const x = this.kickExtraPoint();
    addNote(b, `${who} +${x.headline.includes('GOOD!') ? 7 : 6} - XP ${x.headline.includes('GOOD!') ? 'GOOD' : 'NO GOOD'}`);
    if (x.note) addNote(b, x.note);
  }

  /** The try: kick the extra point (simulated). */
  kickExtraPoint(): Banner {
    const side = this.tryFor ?? this.offense, mine = side === 'you';
    const good = Math.random() < PAT_ODDS;
    if (good) this.score[side] += 1;
    this.tryFor = null;
    this.tryChoice = false;
    const b: Banner = { headline: good ? 'EXTRA POINT GOOD!' : 'EXTRA POINT NO GOOD', color: good === mine ? C.green : C.red, detail: `${this.names.you} ${this.score.you} - ${this.names.cpu} ${this.score.cpu}` };
    this.afterScore(side, b);
    return b;
  }

  /** The two-point try's play. */
  private tryResult(p: PlayRaw): Banner {
    const off = this.offense, mine = off === 'you', N = this.names;
    const o = this.drive.apply(p, newStats()); // tries don't count in the stats
    const good = o.event.kind === 'td';
    if (good) this.score[off] += 2;
    this.tryFor = null;
    this.tryChoice = false;
    const b: Banner = {
      headline: good ? (mine ? 'TWO POINTS!' : `${N.cpu} CONVERTS`) : mine ? 'NO GOOD' : 'STOPPED!',
      color: good === mine ? C.green : C.red,
      detail: good ? 'TWO-POINT CONVERSION GOOD' : 'TWO-POINT TRY FAILS',
      note: good ? `${mine ? N.you : N.cpu} +2` : undefined,
    };
    this.clockRunning = false;
    this.afterScore(off, b);
    return b;
  }

  /** After points: the kickoff (the scoring team kicks; after a safety, the team that gave it up), or the next overtime possession. */
  private afterScore(kicker: Side, b: Banner, free = false): void {
    this.kickoffBy = null;
    this.clockRunning = false;
    if (this.ot) { this.otPossessionOver(this.offense, b); return; }
    if (this.clock <= 0) { // the clock ran out on the scoring play: the try is done, now the period ends
      const halfOver = this.quarter === 2 || this.quarter === 4;
      this.endPeriod();
      if (halfOver) return; // no kickoff: halftime, the end of the game or overtime
    }
    this.kickoffBy = kicker;
    this.kickFree = free;
    if (this.asks?.(kicker)) return; // waits for kickoff()
    const k = this.kickoff(onsideCall(this.score[kicker] - this.score[other(kicker)], this.quarter, this.clock, this.quarterSeconds));
    addNote(b, k.note ?? k.detail);
  }

  /** The kickoff (or the free kick after a safety): deep with a simulated return, or onside. */
  kickoff(onside: boolean): Banner {
    const kicker = this.kickoffBy ?? this.defense, rec = other(kicker), free = this.kickFree;
    this.kickoffBy = null;
    this.kickFree = false;
    const N = this.names, name = (sd: Side) => (sd === 'you' ? N.you : N.cpu), yours = (sd: Side) => (sd === 'you' ? 'YOUR' : N.cpu);
    this.clockRunning = false;
    if (onside) {
      // everyone expects it late in a game; as a surprise it works far more often
      const expected = this.quarter === 4 && this.score[kicker] < this.score[rec];
      const got = Math.random() < (expected ? 0.15 : 0.45);
      this.offense = got ? kicker : rec;
      this.drive = new Drive(got ? 51 : 49);
      this.tick(3);
      const mine = kicker === 'you';
      return {
        headline: got ? (mine ? 'ONSIDE KICK - YOURS!' : `${name(kicker)} RECOVERS!`) : 'ONSIDE KICK FAILS',
        color: got === mine ? C.green : C.red, detail: `${got ? name(kicker) : name(rec)} RECOVERS`, note: `${yours(this.offense)} BALL AT ${spotWords(this.drive.ballOn)}`,
      };
    }
    let spot: number, secs = 5, detail: string;
    if (!free && Math.random() < 0.35) { spot = TOUCHBACK; secs = 0; detail = 'TOUCHBACK'; }
    else {
      let ret = rand(15, 32) + (free ? 12 : 0);
      if (Math.random() < 0.06) ret += rand(15, 35); // a big return
      spot = clamp(Math.round(ret), 5, 99);
      detail = `RETURNED TO THE ${spot === 50 ? '50' : spot < 50 ? spot : 100 - spot}`;
      if (Math.random() < 0.007) { // all the way
        this.offense = rec;
        this.tryFor = rec;
        this.tick(11);
        const b: Banner = { headline: rec === 'you' ? 'KICK RETURN TD!' : `${name(rec)} RETURN TD`, color: rec === 'you' ? C.yellow : C.red, detail: `${free ? 'FREE KICK' : 'KICKOFF'} RETURNED ALL THE WAY` };
        this.touchdown(rec, b);
        return b;
      }
    }
    this.offense = rec;
    this.drive = new Drive(spot);
    this.tick(secs);
    return { headline: `${free ? 'FREE KICK' : 'KICKOFF'}`, color: C.grey, detail, note: `${yours(rec)} BALL AT ${spotWords(spot)}` };
  }

  /** Makes any choice that's waiting with the CPU's charts (the quick-sim, or when nobody is asked anymore). */
  autoDecide(): Banner | null {
    if (this.tryChoice && this.tryFor) {
      this.tryChoice = false;
      const side = this.tryFor;
      if (this.ot >= 2 || twoPointCall(this.score[side] - this.score[other(side)], this.quarter, this.ot)) return null; // snap it
      return this.kickExtraPoint();
    }
    if (this.kickoffBy) {
      const k = this.kickoffBy;
      return this.kickoff(onsideCall(this.score[k] - this.score[other(k)], this.quarter, this.clock, this.quarterSeconds));
    }
    return null;
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
      this.drive = this.otDrive();
      note(`${this.offense === 'you' ? 'YOUR' : this.names.cpu} TURN${this.ot >= 3 ? ': ONE PLAY' : ' AT THE 25'}`);
      return;
    }
    if (this.score.you !== this.score.cpu) { this.over = true; note('FINAL (OT)'); return; }
    this.ot++;
    this.otPoss = 0;
    this.otFirst = other(this.otFirst);
    this.offense = this.otFirst;
    this.drive = this.otDrive();
    this.timeouts = { you: 1, cpu: 1 };
    note(this.ot === 3 ? 'OT3: 2-POINT SHOOTOUT' : `STILL TIED: OT${this.ot}`);
  }

  /** An overtime possession: from the 25, or one play from the 5 from the 3rd overtime on. */
  private otDrive(): Drive {
    return new Drive(this.ot >= 3 ? SHOOTOUT_YARD : OT_YARD);
  }

  /** The offense punts on 4th down: a fair catch, downed, returned; now and then muffed or blocked. */
  punt(): Banner {
    const kicker = this.offense, rec = other(kicker), from = this.drive.ballOn;
    const N = this.names, name = (sd: Side) => (sd === 'you' ? N.you : N.cpu);
    const head = kicker === 'you' ? 'YOU PUNT' : `${N.cpu} PUNTS`;
    const done = (b: Banner) => { this.tick(6); this.clockRunning = false; return b; };
    if (Math.random() < 0.01) { // blocked
      this.changePossession(clamp(Math.round(100 - (from - 8)), 1, 99));
      return done({ headline: 'PUNT BLOCKED!', color: kicker === 'you' ? C.red : C.green, detail: `${name(rec)} BALL`, note: `${rec === 'you' ? 'YOUR' : N.cpu} BALL AT ${spotWords(this.drive.ballOn)}` });
    }
    const dist = Math.round(rand(38, 54));
    const lands = from + dist;
    if (lands >= 100) { // into the end zone: touchback
      this.changePossession(20);
      return done({ headline: head, color: C.grey, detail: `${dist} YD PUNT - TOUCHBACK`, note: `${rec === 'you' ? 'YOUR' : N.cpu} BALL AT OWN 20` });
    }
    const k = Math.random();
    if (k < 0.015) { // muffed: the kicking team falls on it
      this.drive = new Drive(Math.round(lands));
      return done({ headline: 'MUFFED PUNT!', color: kicker === 'you' ? C.green : C.red, detail: `${name(kicker)} RECOVERS`, note: `${kicker === 'you' ? 'YOUR' : N.cpu} BALL AT ${spotWords(this.drive.ballOn)}` });
    }
    let ret = 0, how: string;
    if (k < 0.33) how = 'FAIR CATCH';
    else if (k < 0.45) how = lands > 85 ? 'DOWNED INSIDE THE 15' : 'OUT OF BOUNDS';
    else {
      ret = rand(0, 11);
      if (Math.random() < 0.06) ret += rand(12, 35);
      if (Math.random() < 0.008) { // returned for a touchdown
        this.offense = rec;
        this.tryFor = rec;
        this.tick(10);
        const b: Banner = { headline: rec === 'you' ? 'PUNT RETURN TD!' : `${name(rec)} RETURN TD`, color: rec === 'you' ? C.yellow : C.red, detail: `${dist} YD PUNT RETURNED ALL THE WAY` };
        this.touchdown(rec, b);
        return b;
      }
      ret = Math.round(ret);
      how = ret ? `${ret} YD RETURN` : 'NO RETURN';
    }
    const spot = clamp(Math.round(100 - lands + ret), 1, 99);
    this.changePossession(spot);
    return done({ headline: head, color: C.grey, detail: `${dist} YD PUNT - ${how}`, note: `${rec === 'you' ? 'YOUR' : N.cpu} BALL AT ${spotWords(spot)}` });
  }

  /** The offense kicks a field goal (simulated): 3 points, or the other team's ball at the spot of the kick. */
  fieldGoal(): Banner {
    const kicker = this.offense, mine = kicker === 'you', from = this.drive.ballOn;
    const dist = fgDistance(from);
    const good = Math.random() < fgOdds(dist);
    const who = mine ? this.names.you : this.names.cpu;
    if (good) this.score[kicker] += 3;
    const b: Banner = {
      headline: good ? (mine ? 'FIELD GOAL!' : `${this.names.cpu} FIELD GOAL`) : 'NO GOOD!',
      color: good === mine ? C.green : C.red,
      detail: `${dist} YARD FIELD GOAL${good ? '' : ' - MISSED'}`,
      note: good ? `${who} +3` : undefined,
    };
    if (this.ot) { this.otPossessionOver(kicker, b); return b; }
    if (good) { // then the kickoff
      this.kickoffBy = kicker; // holds the end of the period
      this.tick(5);
      this.afterScore(kicker, b);
      return b;
    }
    this.changePossession(Math.max(20, 100 - (from - 7))); // a miss: their ball at the spot of the kick
    this.tick(5);
    this.clockRunning = false;
    return b;
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
    this.clock = 0;
    if (this.pending) return warning; // a try or a kickoff first (afterScore ends the period)
    this.endPeriod();
    return false;
  }

  /** The clock hit 0: the next quarter, halftime, overtime or the final. */
  private endPeriod(): void {
    if (this.quarter === 4) {
      this.clock = 0;
      if (this.score.you === this.score.cpu) this.startOvertime(); // tied: overtime
      else this.over = true;
      return;
    }
    this.quarter++;
    this.clock = this.quarterSeconds;
    if (this.quarter === 3) { // halftime: the other team gets the ball first, timeouts reset
      this.offense = other(this.firstOffense);
      this.drive = new Drive(START_YARD);
      this.timeouts = { you: TIMEOUTS, cpu: TIMEOUTS };
    }
  }
}
