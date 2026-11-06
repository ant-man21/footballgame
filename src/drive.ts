// Field position and downs for whichever team has the ball. Yard lines are
// measured from the offense's own goal line: 0 = their goal, 100 = the one
// they're attacking. The Match decides what happens on a change of possession.
import { LOS_Y, YD } from './config';
import type { Result, Sim } from './sim';

export const START_YARD = 25;

/** What a play did to the drive. */
export type DriveEvent =
  | { kind: 'continue' }
  | { kind: 'td' }
  | { kind: 'int'; atYard: number } // where the defender caught it (offense's yard line)
  | { kind: 'downs' };

export interface PlayOutcome {
  result: 'catch' | 'int' | 'inc' | 'sack';
  gained: number;
  firstDown: boolean;
  outOfBounds: boolean;
  event: DriveEvent;
  playsInDrive: number;
}

/** A finished play, however it was decided (the on-field sim, or the quick-sim). */
export interface PlayRaw {
  result: Result;
  yards: number; // where the play ended, in yards past the line of scrimmage (an interception: where it was caught)
  touchdown: boolean;
  outOfBounds: boolean;
}
export const rawFromSim = (sim: Sim): PlayRaw => ({
  result: sim.result!, yards: (LOS_Y - sim.spotY) / YD, touchdown: sim.touchdown, outOfBounds: sim.outOfBounds,
});

export interface TeamStats { plays: number; yards: number; tds: number; cmp: number; att: number; int: number; sacks: number }
export const newStats = (): TeamStats => ({ plays: 0, yards: 0, tds: 0, cmp: 0, att: 0, int: 0, sacks: 0 });

const ORD = ['', '1ST', '2ND', '3RD', '4TH'];

export class Drive {
  ballOn = START_YARD;
  down = 1;
  toGo = 10;
  plays = 0;
  ballX = 0; // where the next snap is spotted across the field (yards from the middle)

  constructor(ballOn = START_YARD) { this.ballOn = ballOn; }

  /** Pixel y of the goal line being attacked, with the line of scrimmage at LOS_Y. */
  get goalY(): number { return LOS_Y - (100 - this.ballOn) * YD; }

  get downText(): string {
    const goal = this.ballOn + this.toGo >= 100;
    return `${ORD[this.down]} & ${goal ? 'GOAL' : this.toGo}`;
  }

  get spotText(): string {
    const y = Math.round(this.ballOn);
    if (y === 50) return '50';
    return y < 50 ? `OWN ${y}` : `OPP ${100 - y}`;
  }

  /** Applies a finished play: updates field position and downs, and the offense's stats. */
  apply(p: PlayRaw, st: TeamStats): PlayOutcome {
    st.plays++;
    this.plays++;
    const r = p.result;
    if (r !== 'sack') st.att++;
    const base = { result: r, outOfBounds: p.outOfBounds, playsInDrive: this.plays };

    if (r === 'int') {
      st.int++;
      const atYard = this.ballOn + p.yards;
      return { ...base, gained: 0, firstDown: false, event: { kind: 'int', atYard } };
    }

    let gained = r === 'inc' ? 0 : Math.round(p.yards);
    if (r === 'sack') { st.sacks++; gained = Math.min(gained, -1); }
    if (r === 'catch') st.cmp++;
    gained = Math.max(gained, 1 - this.ballOn); // can't go back past our own 1

    if (p.touchdown || this.ballOn + gained >= 100) {
      gained = 100 - this.ballOn;
      st.yards += gained;
      st.tds++;
      return { ...base, gained, firstDown: false, event: { kind: 'td' } };
    }

    st.yards += gained;
    this.ballOn += gained;
    if (gained >= this.toGo) {
      this.down = 1;
      this.toGo = Math.min(10, 100 - this.ballOn);
      return { ...base, gained, firstDown: true, event: { kind: 'continue' } };
    }
    this.toGo -= gained;
    this.down++;
    if (this.down > 4) return { ...base, gained, firstDown: false, event: { kind: 'downs' } };
    return { ...base, gained, firstDown: false, event: { kind: 'continue' } };
  }
}
