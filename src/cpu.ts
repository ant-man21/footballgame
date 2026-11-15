// The CPU quarterback (and play caller) for when you're on defense. It reads
// receivers one at a time, like a real progression, and throws to the first
// one who's open enough. Where it's looking is shown on screen as the "eyes"
// arrow, so a linebacker can jump the read.
import { FIELD_LEFT, FIELD_RIGHT } from './config';
import type { Drive } from './drive';
import { PLAYS, type Play } from './playbook/plays';
import { ROUTES, type RouteKey } from './playbook/routes';
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
  for (let i = 0; i < 4; i++) to = predict(r, flightFor(from, to, sim.zip).dur, sim.endLineY);
  if (dist(from, to) > sim.maxThrow) return { to, margin: -999 };
  const dur = flightFor(from, to, sim.zip).dur;
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
/** How deep each route in a play goes (yards past the line, where it ends up), for play calling. */
const depthsOf = (p: Play): number[] => p.routes.filter((r) => r.route !== 'block' && r.route !== 'stalk')
  .map((r) => Math.max(...ROUTES[r.route as RouteKey].pts.map((q) => q.d)));
const PROFILE = new Map(PLAYS.map((p) => [p.id, depthsOf(p)]));

/**
 * The CPU's (and your coach's) play call for the down and distance. Plays are
 * weighed by how many routes get past the sticks without being a prayer: 3rd
 * and 15 calls routes at 15-27 yards (no flat routes, no screens); 3rd and 2
 * calls quick, short routes (and maybe a sneak), never a deep shot. 1st and 2nd
 * down mix it up. Deep shots are for long yardage, 2nd down shots, or the end
 * of a half.
 */
export function callPlay(drive: Drive, late = false): Play {
  const toGo = drive.toGo, down = drive.down, goal = drive.ballOn + toGo >= 100, room = 100 - drive.ballOn;
  const pool = PLAYS.map((p) => {
    const ds = PROFILE.get(p.id)!;
    const reach = ds.filter((d) => d >= toGo && d <= toGo + 12 && d <= room + 8).length; // routes that move the sticks
    let w: number;
    if (p.run === 'sneak') w = toGo <= 1 ? (down >= 3 ? 4 : 1.5) : 0;
    else if (p.run === 'draw') w = toGo >= 7 && down <= 2 && !goal ? 0.5 : down <= 2 ? 0.1 : 0;
    else if (late) w = p.category === 'shots' ? 3 : reach + 0.2; // the clock is running out: go get it
    else if (down >= 3) {
      if (toGo <= 3) w = p.category === 'shots' ? 0 : p.category === 'screen' ? 0.3 : ds.filter((d) => d >= toGo && d <= 8).length;
      else if (toGo >= 8) w = p.category === 'screen' || p.category === 'quick' ? 0 : reach * (p.category === 'shots' && toGo < 18 ? 0.5 : 1);
      else w = reach + (p.category === 'shots' ? -1 : 0);
    } else {
      const base: Record<string, number> = { quick: 1.2, core: 1.5, crossers: 1.3, shots: down === 2 && toGo <= 5 ? 1.2 : 0.6, screen: 0.6, run: 0 };
      w = (base[p.category] ?? 1) * (toGo >= 12 ? (p.category === 'screen' || p.category === 'quick' ? 0.5 : 1.2) : 1) + reach * 0.2;
    }
    if (goal && room <= 12 && (p.category === 'shots' || p.category === 'screen')) w *= 0.2; // in close: no bombs, no room for screens
    return { p, w: Math.max(0, w) };
  });
  let x = Math.random() * pool.reduce((t, e) => t + e.w, 0);
  for (const e of pool) { x -= e.w; if (x <= 0) return e.p; }
  return pool.find((e) => e.w > 0)?.p ?? PLAYS[0];
}

/** Field goal distance (yards) from a yard line: the end zone plus the hold, 7 yards back. */
export const fgDistance = (ballOn: number) => Math.round(100 - ballOn + 17);
/** The longest field goal anyone tries. */
export const FG_MAX = 55;
/** Chance a field goal is good: ~95% from 20 yards, ~75% from 30, ~55% from 40, ~35% from 50. */
export const fgOdds = (dist: number) => clamp(0.95 - (dist - 20) * 0.019, 0.05, 0.97);

/**
 * After a touchdown: go for two? lead = the scoring team's lead with the 6
 * points, before the try. The standard chart, from the 4th quarter on; from the
 * 2nd overtime every try is for two (college rules).
 */
export function twoPointCall(lead: number, quarter: number, ot = 0): boolean {
  if (ot >= 2) return true;
  if (ot || quarter < 4) return false;
  return [-2, -5, -9, -10, -13, -16, 1, 5, 12].includes(lead);
}

/** Kickoff: onside? lead = the kicking team's lead. Late and down two scores or less; very rarely as a surprise. */
export function onsideCall(lead: number, quarter: number, clock: number, quarterSeconds: number): boolean {
  if (quarter === 4 && lead < 0 && lead >= -16 && clock < Math.min(150, quarterSeconds * 0.6)) return true;
  return Math.random() < 0.01;
}

/**
 * 4th down for the CPU (or your coach): go for it, kick a field goal or punt.
 * No punting inside the other team's 30. Late in the game, trailing, only kick
 * if 3 points ties or wins it. In overtime there's no punting; from the third
 * overtime (the two-point shootout) it's go only.
 */
export function fourthDownCall(drive: Drive, lead: number, quarter: number, clock: number, ot = 0): 'go' | 'fg' | 'punt' {
  if (ot >= 3) return 'go';
  const inRange = fgDistance(drive.ballOn) <= 50;
  if (ot) return inRange && drive.toGo > 2 ? 'fg' : 'go';
  if (quarter === 4 && lead < 0 && clock < 150) return lead >= -3 && inRange ? 'fg' : 'go'; // need points now
  if (drive.ballOn >= 70) return drive.toGo <= 2 && Math.random() < 0.5 ? 'go' : inRange ? 'fg' : 'go'; // no punting in their 30
  if (inRange && drive.toGo > 2) return 'fg';
  if (drive.toGo <= 2 && drive.ballOn >= 45) return 'go';
  if (drive.toGo <= 4 && drive.ballOn >= 65) return 'go';
  return 'punt';
}
