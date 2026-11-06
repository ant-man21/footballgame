// The CPU quarterback (and play caller) for when you're on defense. It reads
// receivers one at a time, like a real progression, and throws to the first
// one who's open enough. Where it's looking is shown on screen as the "eyes"
// arrow, so a linebacker can jump the read.
import { FIELD_LEFT, FIELD_RIGHT } from './config';
import type { Drive } from './drive';
import { PLAYS, type Play } from './playbook/plays';
import { type Actor, type Sim, flightFor } from './sim';
import { type Vec, clamp, dist, rand } from './util';

/** Where a receiver will be after `secs` sim-seconds if he keeps running his route. */
export function predict(r: Actor, secs: number, endLineY: number): Vec {
  let pos = { x: r.x, y: r.y }, left = r.speed * secs, leg = r.leg, dir = r.dir;
  while (left > 0 && leg < r.path.length) {
    const q = r.path[leg], d = dist(pos, q);
    if (d > left) { pos = { x: pos.x + ((q.x - pos.x) / d) * left, y: pos.y + ((q.y - pos.y) / d) * left }; left = 0; break; }
    if (d > 0) dir = { x: (q.x - pos.x) / d, y: (q.y - pos.y) / d };
    pos = { ...q };
    left -= d;
    leg++;
  }
  if (left > 0 && r.end === 'continue' && dir) {
    pos = { x: clamp(pos.x + dir.x * left, FIELD_LEFT + 2, FIELD_RIGHT - 2), y: Math.max(endLineY + 2, pos.y + dir.y * left) };
  }
  return pos;
}

/** Where to lead a receiver, and how open that spot is (px to spare over the closest defender). */
export function readReceiver(sim: Sim, r: Actor): { to: Vec; margin: number } {
  const from = { x: sim.qb.x, y: sim.qb.y - 3 };
  let to = { x: r.x, y: r.y };
  for (let i = 0; i < 4; i++) to = predict(r, flightFor(from, to).dur, sim.endLineY);
  if (dist(from, to) > sim.maxThrow) return { to, margin: -999 };
  const dur = flightFor(from, to).dur;
  let margin = Infinity;
  for (const d of sim.defense) {
    if (d.job === 'rush' && !d.user) continue;
    margin = Math.min(margin, dist(d, to) - d.speed * Math.max(0, dur - 0.3));
  }
  return { to, margin };
}

export class CpuQb {
  eyes: Actor | null = null;
  /** Where he's looking, as an angle that turns smoothly (for the eyes arrow). */
  eyeAngle = -Math.PI / 2;
  /** Set once he's decided: he locks onto the receiver for a beat before letting it go. */
  windup: { r: Actor; until: number } | null = null;
  private order: Actor[];
  private idx: number;
  private readStart = 0;
  private readLen = rand(0.7, 1.0);
  private patience = rand(2.6, 3.6); // sim seconds before he just gets rid of it
  private lastT = 0;

  /** picky: extra margin (px) he wants before throwing; higher = a more cautious, easier QB. */
  private acc: number;
  constructor(sim: Sim, private picky = 0) {
    // his ratings: decisions make him more (or less) willing to pull the trigger; accuracy tightens his aim
    this.picky = picky - sim.rd(sim.qb, 'dec') * 0.15;
    this.acc = sim.accFactor;
    this.order = sim.play.routes
      .map((pr) => sim.receivers.find((a) => a.id === pr.who))
      .filter((a): a is Actor => !!a);
    this.idx = Math.random() < 0.3 && this.order.length > 1 ? 1 : 0;
  }

  /** Called every frame while the play is live; returns a throw target when he lets it go. */
  update(sim: Sim): Vec | null {
    if (sim.phase !== 'live' || !this.order.length) return null;
    const t = sim.t;
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    this.turnEyes(sim, dt);

    if (this.windup) { // locked on: throw when the windup is done, led to where he is now
      this.eyes = this.windup.r;
      if (t < this.windup.until) return null;
      const to = readReceiver(sim, this.windup.r).to;
      this.windup = null;
      return this.aim(to);
    }

    const r = this.order[this.idx];
    this.eyes = r;
    if (t < 0.7) return null; // catching the snap, settling his feet
    const settled = t - this.readStart > 0.3; // he has to actually look at a man before throwing to him
    const read = readReceiver(sim, r);
    const need = (t < 1.6 ? 10 : t < 2.4 ? 5 : 1) + this.picky; // pickier early, less so as the pocket collapses
    if (settled && read.margin > need) return this.commit(r, t);
    if (t - this.readStart > this.readLen) { // next read
      this.idx = (this.idx + 1) % this.order.length;
      this.readStart = t;
      this.readLen = rand(0.6, 0.9);
    }
    if ((sim.pressured && t > 1.2) || t > this.patience) {
      // out of time: best available
      let best = read, bestR = r;
      for (const o of this.order) {
        const rr = readReceiver(sim, o);
        if (rr.margin > best.margin) { best = rr; bestR = o; }
      }
      return this.commit(bestR, t, sim.pressured ? 0.15 : 0.25);
    }
    return null;
  }

  private commit(r: Actor, t: number, wind = rand(0.28, 0.38)): null {
    this.windup = { r, until: t + wind };
    this.eyes = r;
    return null;
  }

  /** The eyes arrow sweeps toward whoever he's reading, rather than jumping. */
  private turnEyes(sim: Sim, dt: number): void {
    if (!this.eyes) return;
    const want = Math.atan2(this.eyes.y - sim.qb.y, this.eyes.x - sim.qb.x);
    let d = want - this.eyeAngle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const step = (this.windup ? 14 : 5) * dt; // radians per sim-second
    this.eyeAngle += clamp(d, -step, step);
  }

  private aim(to: Vec): Vec {
    const a = Math.random() * Math.PI * 2, m = Math.abs(rand(-1, 1)) * 3 * this.acc;
    return { x: to.x + Math.cos(a) * m, y: to.y + Math.sin(a) * m };
  }
}

/** CPU play calling: quick game when it's short, more shots when it's long. */
export function callPlay(drive: Drive): Play {
  const weights: Record<string, number> =
    drive.toGo <= 4 ? { quick: 3, crossers: 2, core: 1, shots: 0.5 }
    : drive.toGo >= 10 ? { quick: 1, crossers: 1.5, core: 2, shots: 1.2 }
    : { quick: 1.5, crossers: 1.5, core: 1.5, shots: 0.8 };
  const pool = PLAYS.map((p) => ({ p, w: weights[p.category] ?? 1 }));
  let x = Math.random() * pool.reduce((s, e) => s + e.w, 0);
  for (const e of pool) { x -= e.w; if (x <= 0) return e.p; }
  return pool[0].p;
}

/** Should the CPU go for it on 4th down? (Otherwise it punts.) */
export function cpuGoesForIt(drive: Drive, cpuLead: number, quarter: number, clock: number): boolean {
  if (quarter === 4 && cpuLead < 0 && clock < 150) return true; // desperate
  if (drive.toGo <= 2 && drive.ballOn >= 45) return true;
  if (drive.toGo <= 4 && drive.ballOn >= 65) return true;
  return false;
}
