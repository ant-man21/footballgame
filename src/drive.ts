// Field position, downs and distance, and the running stat line.
// Yard lines are measured from our own goal line: 0 = our goal, 100 = theirs.
import { C, LOS_Y, YD } from './config';
import type { Sim } from './sim';

export const START_YARD = 25;

export interface PlaySummary {
  headline: string;
  color: string;
  detail: string; // e.g. "+12 YDS - FIRST DOWN"
  gained: number;
}

const ORD = ['', '1ST', '2ND', '3RD', '4TH'];

export class Drive {
  ballOn = START_YARD;
  down = 1;
  toGo = 10;
  stats = { plays: 0, yards: 0, tds: 0, drives: 1, turnovers: 0, cmp: 0, att: 0, int: 0, sacks: 0 };
  private playsThisDrive = 0;

  /** Pixel y of the goal line we're attacking, with the line of scrimmage at LOS_Y. */
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

  get yardsPerPlay(): number { return this.stats.plays ? this.stats.yards / this.stats.plays : 0; }
  get playsPerTd(): number { return this.stats.tds ? this.stats.plays / this.stats.tds : 0; }

  /** Applies a finished play to the drive and describes what happened. */
  apply(sim: Sim): PlaySummary {
    const st = this.stats;
    st.plays++;
    this.playsThisDrive++;
    const r = sim.result!;
    if (r !== 'sack') st.att++;

    if (r === 'int') {
      st.int++;
      st.turnovers++;
      this.newDrive();
      return { headline: 'INTERCEPTED!', color: C.red, detail: 'TURNOVER', gained: 0 };
    }

    let gained = r === 'inc' ? 0 : Math.round((LOS_Y - sim.spotY) / YD);
    if (r === 'sack') { st.sacks++; gained = Math.min(gained, -1); }
    if (r === 'catch') st.cmp++;
    gained = Math.max(gained, 1 - this.ballOn); // can't go back past our own 1

    if (sim.touchdown || this.ballOn + gained >= 100) {
      gained = 100 - this.ballOn;
      st.yards += gained;
      st.tds++;
      const n = this.playsThisDrive;
      this.newDrive();
      return { headline: 'TOUCHDOWN!', color: C.yellow, detail: `+${gained} YDS - ${n} PLAY DRIVE`, gained };
    }

    st.yards += gained;
    this.ballOn += gained;
    const yds = gained > 0 ? `+${gained} YDS` : gained < 0 ? `${gained} YDS` : 'NO GAIN';
    const headline = r === 'catch' ? 'CATCH!' : r === 'sack' ? 'SACK!' : 'INCOMPLETE';
    const color = r === 'catch' ? C.green : r === 'sack' ? C.orange : C.grey;

    if (gained >= this.toGo) {
      this.down = 1;
      this.toGo = Math.min(10, 100 - this.ballOn);
      return { headline, color, detail: `${yds} - FIRST DOWN`, gained };
    }
    this.toGo -= gained;
    this.down++;
    if (this.down > 4) {
      st.turnovers++;
      this.newDrive();
      return { headline, color, detail: `${yds} - TURNOVER ON DOWNS`, gained };
    }
    const oob = sim.outOfBounds ? ' - OUT' : '';
    return { headline, color, detail: r === 'inc' ? yds : `${yds}${oob}`, gained };
  }

  private newDrive(): void {
    this.ballOn = START_YARD;
    this.down = 1;
    this.toGo = 10;
    this.playsThisDrive = 0;
    this.stats.drives++;
  }
}
