// A full game: 4 quarters, score, clock, and possession. Passing only, no
// kicks: a touchdown is worth 7, the other team then starts at its 25. On 4th
// down a team can punt (simulated).
import { C } from './config';
import { Drive, START_YARD, type TeamStats, newStats } from './drive';
import type { Sim } from './sim';
import { clamp, rand } from './util';

export type Side = 'you' | 'cpu';
export const QUARTER_SECONDS = 180;
const RUNOFF = 15; // seconds that run off between plays when the clock keeps going
const TD_POINTS = 7;

/** A result banner, written from your point of view (green/yellow = good for you). */
export interface Banner { headline: string; color: string; detail: string; note?: string }

const other = (s: Side): Side => (s === 'you' ? 'cpu' : 'you');
const fmtYds = (g: number) => (g > 0 ? `+${g} YDS` : g < 0 ? `${g} YDS` : 'NO GAIN');

export class Match {
  quarter = 1;
  clock = QUARTER_SECONDS;
  score: Record<Side, number> = { you: 0, cpu: 0 };
  stats: Record<Side, TeamStats> = { you: newStats(), cpu: newStats() };
  offense: Side;
  drive = new Drive();
  over = false;
  private firstOffense: Side;

  constructor(first: Side = 'you') {
    this.offense = first;
    this.firstOffense = first;
  }

  get defense(): Side { return other(this.offense); }
  get clockText(): string {
    const s = Math.max(0, Math.ceil(this.clock));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** Applies a finished play. playSeconds is how long the play itself took. */
  afterPlay(sim: Sim, playSeconds: number): Banner {
    const off = this.offense;
    const mine = off === 'you';
    const o = this.drive.apply(sim, this.stats[off]);
    const running = (o.result === 'catch' && !o.outOfBounds && o.event.kind === 'continue') || o.result === 'sack';
    const yds = fmtYds(o.gained);
    let b: Banner;

    switch (o.event.kind) {
      case 'td':
        this.score[off] += TD_POINTS;
        b = {
          headline: mine ? 'TOUCHDOWN!' : 'CPU TOUCHDOWN', color: mine ? C.yellow : C.red,
          detail: `${yds} - ${o.playsInDrive} PLAY DRIVE`, note: `${mine ? 'YOU' : 'CPU'} +${TD_POINTS}`,
        };
        this.changePossession(START_YARD);
        break;
      case 'int': {
        const at = o.event.atYard;
        const spot = at >= 100 ? 20 : clamp(Math.round(100 - at), 1, 99); // picked in the end zone: touchback
        b = { headline: mine ? 'INTERCEPTED!' : 'PICKED OFF!', color: mine ? C.red : C.green, detail: `TURNOVER - ${mine ? 'CPU' : 'YOUR'} BALL` };
        this.changePossession(spot);
        break;
      }
      case 'downs':
        b = { headline: 'TURNOVER ON DOWNS', color: mine ? C.red : C.green, detail: `${yds} - ${mine ? 'CPU' : 'YOUR'} BALL` };
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
    this.tick(playSeconds + (running ? RUNOFF : 0));
    return b;
  }

  /** The offense punts on 4th down. */
  punt(): Banner {
    const kicker = this.offense;
    const from = this.drive.ballOn;
    const dist = Math.round(rand(36, 50));
    const lands = from + dist;
    const spot = lands >= 100 ? 20 : Math.round(100 - lands); // into the end zone: touchback
    this.changePossession(spot);
    this.tick(8);
    const receiver = this.offense;
    return {
      headline: kicker === 'you' ? 'YOU PUNT' : 'CPU PUNTS', color: C.grey,
      detail: lands >= 100 ? `${dist} YD PUNT - TOUCHBACK` : `${dist} YD PUNT`,
      note: `${receiver === 'you' ? 'YOUR' : 'CPU'} BALL AT ${spot === 50 ? '50' : `${receiver === 'you' ? 'OWN' : 'THEIR'} ${spot}`}`,
    };
  }

  private changePossession(newBallOn: number): void {
    this.offense = other(this.offense);
    this.drive = new Drive(newBallOn);
  }

  private tick(seconds: number): void {
    this.clock -= seconds;
    if (this.clock > 0) return;
    if (this.quarter === 4) { this.clock = 0; this.over = true; return; }
    this.quarter++;
    this.clock = QUARTER_SECONDS;
    if (this.quarter === 3) { // halftime: the other team gets the ball first
      this.offense = other(this.firstOffense);
      this.drive = new Drive(START_YARD);
    }
  }
}
