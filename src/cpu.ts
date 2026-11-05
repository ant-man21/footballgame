// The CPU quarterback (and play caller) for when you're on defense. It reads
// receivers one at a time, like a real progression, and throws to the first
// one who's open enough. Where it's looking is shown on screen as the "eyes"
// arrow, so a linebacker can jump the read.
import { FIELD_LEFT, FIELD_RIGHT, MAX_THROW } from './config';
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
  if (dist(from, to) > MAX_THROW) return { to, margin: -999 };
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
  private order: Actor[];
  private idx: number;
  private readStart = 0;
  private readLen = rand(0.5, 0.8);
  private patience = rand(2.6, 3.6); // sim seconds before he just gets rid of it

  /** picky: extra margin (px) he wants before throwing; higher = a more cautious, easier QB. */
  constructor(sim: Sim, private picky = 0) {
    this.order = sim.play.routes
      .map((pr) => sim.receivers.find((a) => a.id === pr.who))
      .filter((a): a is Actor => !!a);
    this.idx = Math.random() < 0.3 && this.order.length > 1 ? 1 : 0;
  }

  /** Called every frame while the play is live; returns a throw target when he lets it go. */
  update(sim: Sim): Vec | null {
    if (sim.phase !== 'live' || !this.order.length) return null;
    const t = sim.t;
    const r = this.order[this.idx];
    this.eyes = r;
    if (t < 0.7) return null; // catching the snap, settling his feet
    const read = readReceiver(sim, r);
    const need = (t < 1.6 ? 10 : t < 2.4 ? 5 : 1) + this.picky; // pickier early, less so as the pocket collapses
    if (read.margin > need) return this.aim(read.to);
    if (t - this.readStart > this.readLen) { // next read
      this.idx = (this.idx + 1) % this.order.length;
      this.readStart = t;
      this.readLen = rand(0.45, 0.75);
    }
    if ((sim.pressured && t > 1.2) || t > this.patience) {
      // out of time: best available
      let best = read, bestR = r;
      for (const o of this.order) {
        const rr = readReceiver(sim, o);
        if (rr.margin > best.margin) { best = rr; bestR = o; }
      }
      this.eyes = bestR;
      return this.aim(best.to);
    }
    return null;
  }

  private aim(to: Vec): Vec {
    const a = Math.random() * Math.PI * 2, m = Math.abs(rand(-1, 1)) * 3;
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
