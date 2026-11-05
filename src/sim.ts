// The on-field simulation. No drawing or DOM here, so it can be stepped in tests.
import { CX, FIELD_LEFT, FIELD_RIGHT, QB_DEPTH, ROUTE_COLORS, TIME_SCALE, YD, fx, fy } from './config';
import { CALLS, type Call, DEF_BASE, type DefId, type DefKind, ZONES, type ZoneDef, pickCall } from './defense/calls';
import { FORMATIONS, OL_DEPTH, OL_SPOTS, type SkillType } from './playbook/formations';
import type { Play } from './playbook/plays';
import { ROUTES, routeYards } from './playbook/routes';
import { type Vec, clamp, dist, lerp, moveToward, rand, unit } from './util';

export type Team = 'off' | 'def';
export type Kind = 'qb' | 'ol' | SkillType | DefKind;
export type Phase = 'presnap' | 'live' | 'air' | 'run' | 'done';
export type Result = 'catch' | 'int' | 'inc' | 'sack';
type Job = 'none' | 'route' | 'block' | 'rush' | 'man' | 'zone';

/** Top speeds in yards per second. */
const SPEED: Record<Kind, number> = { qb: 0, ol: 6, wr: 8.0, te: 7.1, rb: 7.6, dl: 6.4, lb: 7.0, db: 7.7 };

// Catching
const CATCH_RADIUS = 7; // receivers attack the ball
/** How far a defender can reach to play the ball: quick throws are on top of him before he reacts. */
const defenderReach = (throwLen: number) => clamp(3.5 + throwLen / 45, 4, 6.5);
const BALL_HAWK = 22; // receivers this close to the landing spot go get the ball...
const BALL_READ = 0.3; // ...once they've picked it up in the air (sim seconds)

// Throwing
// Landing-spot error (std dev, px): short throws are on the money, deep balls wander.
export const throwError = (d: number) => d * 0.02 + Math.max(0, d - 70) * 0.13;
const PRESSURE_DIST = 18; // a free rusher this close doubles the error

// Run after catch
const TACKLE_DIST = 6;
const BREAK_CHANCE: Partial<Record<Kind, number>> = { wr: 0.12, te: 0.15, rb: 0.18 };
const STUN_TIME = 0.7; // a defender who misses a tackle is out of the play this long
const SCREEN_DIST = 6; // a receiver this close to a pursuer slows him down

// Line play
const ENGAGE_DIST = 7.5;
const SACK_DIST = 6;
const BODY = 5; // players closer than this get pushed apart

export interface Actor {
  id: string;
  team: Team;
  kind: Kind;
  x: number;
  y: number;
  speed: number; // px per sim-second
  job: Job;
  // receivers
  color: string;
  path: Vec[];
  leg: number;
  end: 'stop' | 'continue';
  dir: Vec | null;
  // coverage
  man: Actor | null;
  zone: ZoneDef | null;
  goal: Vec; // where the defender thinks he should be (lags reality)
  react: number; // delay before breaking on a thrown ball
  // blockers
  assigned: Actor | null;
  engaged: Actor | null;
  beatenBy: Actor[];
  setSpot: Vec;
  // rushers
  engagedBy: Actor | null;
  shedAt: number; // sim time when the rusher beats his block
  burstAt: number; // sim time he started running free (ramps up to full speed)
  push: number; // px/s a blocked rusher drives the blocker back
  // run after catch
  vel: Vec;
  stunUntil: number;
  read: Vec; // man coverage: the defender's (lagging) read of his man's velocity
}

export interface Ball {
  aim: Vec; // where the QB aimed
  from: Vec;
  to: Vec;
  peak: number;
  dur: number;
  t: number;
  carrier: Actor | null;
}

/** Height of the ball above the ground at flight progress s (0..1). */
export const arcHeight = (peak: number, s: number) => 4 * peak * s * (1 - s);

export function flightFor(from: Vec, to: Vec): { dur: number; peak: number } {
  const d = dist(from, to);
  // deep balls hang in the air, giving defenders time to close
  return { dur: (0.35 + d / 150) * TIME_SCALE, peak: clamp(d * 0.28, 5, 56) };
}

function makeActor(id: string, team: Team, kind: Kind, x: number, y: number): Actor {
  return {
    id, team, kind, x, y, speed: SPEED[kind] * YD, job: 'none',
    color: '', path: [], leg: 0, end: 'stop', dir: null,
    man: null, zone: null, goal: { x, y }, react: 0,
    assigned: null, engaged: null, beatenBy: [], setSpot: { x, y: y + 1.5 * YD },
    engagedBy: null, shedAt: Infinity, burstAt: 0, push: 0,
    vel: { x: 0, y: 0 }, stunUntil: 0, read: { x: 0, y: 0 },
  };
}

export class Sim {
  actors: Actor[] = [];
  phase: Phase = 'presnap';
  t = 0; // sim seconds since the snap
  airT = 0; // sim seconds since the throw
  ball: Ball | null = null;
  result: Result | null = null;
  carrier: Actor | null = null; // receiver running after the catch
  runT = 0; // sim seconds since the catch
  spotY = 0; // where the play ended (pixel y), for measuring the gain
  touchdown = false;
  outOfBounds = false;
  call: Call = CALLS[0];
  play!: Play;
  forceCall: string | null = null; // tests can pin a defensive call
  lastContest: { off: number | null; def: number | null; outcome: Result } | null = null;
  goalY = -1e9; // pixel y of the goal line we're attacking
  get endLineY() { return this.goalY - 10 * YD; }

  get qb(): Actor { return this.actors[0]; }
  get offense() { return this.actors.filter((a) => a.team === 'off'); }
  get defense() { return this.actors.filter((a) => a.team === 'def'); }
  get receivers() { return this.actors.filter((a) => a.job === 'route'); }
  get rushers() { return this.actors.filter((a) => a.job === 'rush'); }
  get blockers() { return this.actors.filter((a) => a.job === 'block'); }

  // ---------- setup ----------

  /** Sets up the next play. goalY is where the goal line is (pixel y). */
  reset(play: Play, goalY = this.goalY): void {
    this.play = play;
    this.goalY = goalY;
    this.carrier = null;
    this.runT = 0;
    this.touchdown = false;
    this.outOfBounds = false;
    this.call = CALLS.find((c) => c.id === this.forceCall) ?? pickCall();
    this.phase = 'presnap';
    this.t = 0;
    this.airT = 0;
    this.ball = null;
    this.result = null;

    const a: Actor[] = [makeActor('QB', 'off', 'qb', fx(0), fy(-QB_DEPTH))];
    OL_SPOTS.forEach((x, i) => {
      const ol = makeActor(`OL${i}`, 'off', 'ol', fx(x), fy(OL_DEPTH));
      ol.job = 'block';
      a.push(ol);
    });

    let colorIdx = 0;
    for (const spot of FORMATIONS[play.formation].skill) {
      const p = makeActor(spot.id, 'off', spot.type, fx(spot.x), fy(spot.d));
      const pr = play.routes.find((r) => r.who === spot.id);
      if (!pr || pr.route === 'block') {
        p.job = 'block';
      } else {
        const route = ROUTES[pr.route];
        p.job = 'route';
        p.end = route.end;
        p.color = ROUTE_COLORS[colorIdx++ % ROUTE_COLORS.length];
        p.path = routeYards(spot.x, spot.d, route, pr.flip).map((q) => ({
          x: clamp(fx(q.x), FIELD_LEFT + 2, FIELD_RIGHT - 2), y: Math.max(fy(q.d), this.endLineY + 2),
        }));
      }
      a.push(p);
    }

    // Against 3+ wide receivers the defense subs in a nickel back for the SAM linebacker.
    const wideouts = FORMATIONS[play.formation].skill.filter((sp) => sp.type === 'wr').length;
    for (const id of Object.keys(DEF_BASE) as DefId[]) {
      const b = DEF_BASE[id];
      const kind = id === 'SAM' && wideouts >= 3 ? 'db' : b.kind;
      a.push(makeActor(id, 'def', kind, fx(b.x), fy(b.d)));
    }
    this.actors = a;
    this.applyCall();
  }

  private def(id: DefId): Actor { return this.actors.find((x) => x.id === id)!; }

  private applyCall(): void {
    const call = this.call;
    for (const id of call.rush) this.def(id).job = 'rush';
    for (const [id, z] of Object.entries(call.zones)) {
      const d = this.def(id as DefId);
      d.job = 'zone';
      d.zone = ZONES[z];
    }

    // Man-to-man: corners take the widest receiver on their side, then the
    // rest are matched by position (DBs on wideouts, linebackers on backs/TEs).
    const pool = call.man.map((id) => this.def(id));
    const recs = [...this.receivers].sort((p, q) => Math.abs(q.x - CX) - Math.abs(p.x - CX));
    const take = (d: Actor, r: Actor) => {
      d.job = 'man';
      d.man = r;
      pool.splice(pool.indexOf(d), 1);
      recs.splice(recs.indexOf(r), 1);
    };
    const cbL = pool.find((d) => d.id === 'CB_L');
    const cbR = pool.find((d) => d.id === 'CB_R');
    const left = recs.filter((r) => r.x < CX).sort((p, q) => p.x - q.x)[0];
    const right = recs.filter((r) => r.x > CX).sort((p, q) => q.x - p.x)[0];
    if (cbL && left) take(cbL, left);
    if (cbR && right) take(cbR, right);
    const order: Kind[] = ['wr', 'te', 'rb'];
    recs.sort((p, q) => order.indexOf(p.kind) - order.indexOf(q.kind));
    for (const r of [...recs]) {
      if (!pool.length) break;
      const cost = (d: Actor) => {
        const mismatch = r.kind === 'wr' ? (d.kind === 'db' ? 0 : 20) : d.kind === 'lb' ? 0 : 8;
        return mismatch + Math.abs(fx(DEF_BASE[d.id as DefId].x) - r.x) / YD;
      };
      take(pool.reduce((best, d) => (cost(d) < cost(best) ? d : best)), r);
    }
    for (const d of pool) { d.job = 'zone'; d.zone = ZONES.robber; } // spare man defenders sit in the hole

    // Pre-snap alignment.
    for (const d of this.defense) {
      if (d.job === 'man' && d.man) {
        const r = d.man;
        if (r.kind === 'rb') continue; // backfield: stay at the base spot
        const inside = r.x < CX ? 1 : -1;
        const depth = d.kind === 'lb' ? 3.5 : call.id === 'c0' ? 2.5 : 4.5;
        d.x = r.x + inside * 0.8 * YD;
        d.y = fy(depth);
      } else if (d.job === 'zone' && d.zone) {
        const z = d.zone;
        if (d.id === 'CB_L' || d.id === 'CB_R') {
          const side = d.id === 'CB_L' ? -1 : 1;
          const wide = this.receivers.filter((r) => (r.x - CX) * side > 0).sort((p, q) => (q.x - p.x) * side)[0];
          if (wide) d.x = wide.x - side * 0.5 * YD;
          d.y = fy(z.deep ? 7 : 5);
        } else if (d.id === 'FS' || d.id === 'SS') {
          d.x = fx(z.x);
          d.y = fy(clamp(z.d, 6, 13));
        }
      }
      d.y = Math.max(d.y, this.endLineY + 2);
      d.goal = { x: d.x, y: d.y };
      // zone defenders watch the QB and break quickest; man defenders see the ball late
      d.react = d.job === 'man' ? (d.kind === 'db' ? rand(0.45, 0.6) : rand(0.55, 0.7))
        : d.kind === 'db' ? rand(0.12, 0.25) : rand(0.2, 0.35);
    }
  }

  // ---------- snap & throw ----------

  snap(): void {
    if (this.phase !== 'presnap') return;
    this.phase = 'live';
    this.t = 0;

    // Protection: each blocker takes the nearest rusher; the RB (if he stays
    // in) picks up whoever is left. Anyone left over comes free.
    const rushers = this.rushers;
    const ol = this.blockers.filter((b) => b.kind === 'ol');
    const backs = this.blockers.filter((b) => b.kind !== 'ol');
    // Linemen are picked up first, so the man who comes free is a blitzer
    // from depth (more time to get the ball out), not a lineman on the ball.
    const pairs: [Actor, Actor, number][] = [];
    for (const b of ol) {
      for (const r of rushers) pairs.push([b, r, Math.abs(b.x - r.x) + 0.3 * Math.abs(b.y - r.y) + (r.kind === 'lb' ? 40 : 0)]);
    }
    pairs.sort((p, q) => p[2] - q[2]);
    const taken = new Set<Actor>();
    for (const [b, r] of pairs) {
      if (b.assigned || taken.has(r)) continue;
      b.assigned = r;
      taken.add(r);
    }
    for (const b of backs) {
      const left = rushers.filter((r) => !taken.has(r)).sort((p, q) => dist(b, p) - dist(b, q))[0];
      if (left) { b.assigned = left; taken.add(left); }
    }
    for (const r of rushers) {
      r.push = r.kind === 'lb' ? 2.6 : 3.6; // px/s a blocked rusher drives back
      r.burstAt = r.kind === 'lb' ? 0.3 : 0.1; // blitzers read before they go
    }
  }

  /** Is a free rusher bearing down on the QB? Throws get less accurate. */
  get pressured(): boolean {
    return this.rushers.some((r) => !r.engagedBy && dist(r, this.qb) < PRESSURE_DIST);
  }

  throwTo(aim: Vec, accurate = false): void {
    if (this.phase !== 'live') return;
    const from = { x: this.qb.x, y: this.qb.y - 3 };
    // longer throws (and throws under pressure) wander off target
    const sd = accurate ? 0 : throwError(dist(from, aim)) * (this.pressured ? 2 : 1);
    const a = Math.random() * Math.PI * 2;
    const r = sd * Math.sqrt(-2 * Math.log(1 - Math.random() * 0.999));
    const to = { x: clamp(aim.x + Math.cos(a) * r, FIELD_LEFT, FIELD_RIGHT), y: aim.y + Math.sin(a) * r };
    this.ball = { aim, from, to, ...flightFor(from, to), t: 0, carrier: null };
    this.phase = 'air';
    this.airT = 0;
  }

  // ---------- simulation ----------

  update(dtReal: number): void {
    if (this.phase !== 'live' && this.phase !== 'air' && this.phase !== 'run') return;
    const dt = dtReal * TIME_SCALE;
    this.t += dt;
    if (this.phase === 'run') { this.updateRun(dt); return; }
    if (this.phase === 'air') this.airT += dt;

    this.updateReceivers(dt);
    this.updateLine(dt);
    this.updateCoverage(dt);
    this.separate();

    if (this.phase === 'live' && this.rushers.some((r) => dist(r, this.qb) < SACK_DIST)) {
      this.finish('sack', this.qb.y);
      return;
    }
    if (this.phase === 'air' && this.ball) this.updateBall(this.ball, dt);
  }

  private landing(): Vec | null {
    return this.ball && !this.ball.carrier ? this.ball.to : null;
  }

  private updateReceivers(dt: number): void {
    const landing = this.landing();
    const release = clamp(0.35 + this.t / 0.9, 0.35, 1); // receivers build up speed off the line
    for (const p of this.receivers) {
      const step = p.speed * dt * release;
      const x0 = p.x, y0 = p.y;
      if (landing && this.airT >= BALL_READ && dist(p, landing) < BALL_HAWK) moveToward(p, landing, step);
      else this.followRoute(p, step);
      if (dt > 0) p.vel = { x: (p.x - x0) / dt, y: (p.y - y0) / dt };
    }
  }

  private followRoute(p: Actor, step: number): void {
    if (p.leg < p.path.length) {
      p.dir = unit(p, p.path[p.leg]);
      if (moveToward(p, p.path[p.leg], step)) p.leg++;
    } else if (p.end === 'continue' && p.dir) {
      p.x = clamp(p.x + p.dir.x * step, FIELD_LEFT + 2, FIELD_RIGHT - 2);
      p.y = Math.max(this.endLineY + 2, p.y + p.dir.y * step);
    }
  }

  private updateLine(dt: number): void {
    const qb = this.qb;
    const blockers = this.blockers;

    for (const r of this.rushers) {
      const b = r.engagedBy;
      if (b) {
        const helpers = blockers.filter((h) => h !== b && h.engaged === r);
        if (helpers.length) r.shedAt += dt * 0.6; // double teams slow the rusher down
        if (this.t >= r.shedAt) {
          // rusher wins: blockers lose him
          for (const h of [b, ...helpers]) { h.engaged = null; h.beatenBy.push(r); }
          r.engagedBy = null;
          r.burstAt = this.t; // has to get around the blocker before he's at full speed
          continue;
        }
        const u = unit(r, qb);
        const push = r.push * (helpers.length ? 0.35 : 1) * (b.kind === 'ol' ? 1 : 1.6);
        r.x += u.x * push * dt;
        r.y += u.y * push * dt;
        b.x = r.x + u.x * 6;
        b.y = r.y + u.y * 6;
        helpers.forEach((h, i) => {
          const ang = (i % 2 ? -1 : 1) * 0.8;
          h.x = r.x + (u.x * Math.cos(ang) - u.y * Math.sin(ang)) * 6;
          h.y = r.y + (u.x * Math.sin(ang) + u.y * Math.cos(ang)) * 6;
        });
      } else {
        // Free (or not yet blocked): run at the QB, steering round bodies in the way.
        const u = unit(r, qb);
        const dir = { ...u };
        for (const bl of blockers) {
          if (!bl.beatenBy.includes(r)) continue; // only dodge blockers already beaten
          const d = dist(r, bl);
          if (d > 10 || (bl.x - r.x) * u.x + (bl.y - r.y) * u.y <= 0) continue;
          const side = (bl.x - r.x) * -u.y + (bl.y - r.y) * u.x > 0 ? -1 : 1;
          dir.x += -u.y * side * 1.2;
          dir.y += u.x * side * 1.2;
        }
        const n = Math.hypot(dir.x, dir.y) || 1;
        const ramp = clamp((this.t - r.burstAt) / 0.6, 0, 1); // accelerate from a standstill
        const step = r.speed * dt * ramp;
        r.x += (dir.x / n) * step;
        r.y += (dir.y / n) * step;
      }
    }

    for (const b of blockers) {
      if (b.engaged) continue; // placed by the rusher above
      let r = b.assigned && !b.beatenBy.includes(b.assigned) ? b.assigned : null;
      if (!r) {
        // help: the nearby rusher with the fewest blockers on him
        const load = (x: Actor) => blockers.filter((h) => h.engaged === x || h.assigned === x).length;
        r = this.rushers
          .filter((x) => !b.beatenBy.includes(x) && dist(x, b) < 40)
          .sort((p, q) => load(p) * 30 + dist(b, p) - (load(q) * 30 + dist(b, q)))[0] ?? null;
        if (r) b.assigned = r;
      }
      if (!r) { moveToward(b, b.setSpot, b.speed * dt); continue; }
      const u = unit(qb, r);
      const want = { x: qb.x + u.x * clamp(dist(qb, r) - 6, 9, 60), y: qb.y + u.y * clamp(dist(qb, r) - 6, 9, 60) };
      moveToward(b, want, b.speed * dt);
      const inFront = (b.x - r.x) * (qb.x - r.x) + (b.y - r.y) * (qb.y - r.y) > 0;
      const helping = r.engagedBy && r.engagedBy !== b;
      if ((dist(b, r) <= ENGAGE_DIST && inFront) || (helping && dist(b, r) <= ENGAGE_DIST + 3)) {
        b.engaged = r;
        if (!r.engagedBy) {
          r.engagedBy = b;
          const fresh = r.shedAt === Infinity;
          const [lo, hi] = r.kind === 'lb' ? [1.2, 2.4] : Math.abs(r.x - CX) > 4 * YD ? [1.9, 3.6] : [2.2, 4.1];
          const t = fresh ? rand(lo, hi) : rand(0.8, 1.6); // re-blocked rushers shed faster
          r.shedAt = this.t + t * (b.kind === 'ol' ? 1 : 0.55);
        }
      }
    }
  }

  private updateCoverage(dt: number): void {
    const landing = this.landing();
    for (const d of this.defense) {
      if (d.job !== 'man' && d.job !== 'zone') continue;
      const range = d.kind === 'lb' ? 36 : d.kind === 'dl' ? 26 : d.zone?.deep ? 75 : 45;
      const sees = landing && this.airT >= d.react;
      if (sees && d.job === 'man' && d.man && dist(d.man, landing) < 24) {
        // ball is coming to my man: race him to the spot and contest the catch
        d.goal = { ...landing };
      } else if (sees && dist(d, landing) < range) {
        d.goal = { ...landing }; // zone defenders (or a man defender nearby) jump the throw
      } else {
        let raw: Vec;
        let k: number;
        if (d.job === 'man' && d.man) {
          // Mirror the receiver using a lagging read of where he's heading:
          // straight routes stay covered; sharp cuts buy separation.
          const m = d.man;
          const f = Math.min(1, 3 * dt); // lower = slower to read cuts
          d.read = { x: lerp(d.read.x, m.vel.x, f), y: lerp(d.read.y, m.vel.y, f) };
          const inside = m.x < CX ? 1 : -1;
          // in phase: inside and level with him (deep help is the safety's job)
          raw = { x: m.x + d.read.x * 0.15 + inside * 0.6 * YD, y: m.y + d.read.y * 0.15 - 0.3 * YD };
          k = 10;
        } else {
          raw = this.zoneTarget(d.zone!);
          k = 3.5;
        }
        const f = Math.min(1, k * dt);
        d.goal = { x: lerp(d.goal.x, raw.x, f), y: lerp(d.goal.y, raw.y, f) };
      }
      d.goal.y = Math.max(d.goal.y, this.endLineY + 2); // nobody drops out the back of the end zone
      moveToward(d, d.goal, d.speed * dt);
    }
  }

  private zoneTarget(z: ZoneDef): Vec {
    const x0 = fx(z.x - z.wx), x1 = fx(z.x + z.wx);
    const top = fy(z.dmax), bottom = fy(z.dmin);
    const land = { x: fx(z.x), y: fy(z.d) };
    const inLane = this.receivers.filter((r) => r.x > x0 - 4 && r.x < x1 + 4);
    const threats = inLane.filter((r) => r.y > top && r.y < bottom + 6);
    if (z.deep) {
      if (!threats.length) return land;
      // stay deeper than the deepest threat, splitting them if there are two
      const deepest = Math.min(...threats.map((t) => t.y));
      const xs = threats.map((t) => t.x);
      const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
      const deepX = threats.find((t) => t.y === deepest)!.x;
      return { x: clamp(lerp(mid, deepX, 0.5), x0, x1), y: Math.min(land.y, deepest - 2 * YD) }; // lean to the deepest
    }
    if (!threats.length) {
      // nobody here: sink toward the nearest route in my lane, staying in the zone
      const near = inLane.reduce<Actor | null>((p, q) => (!p || dist(q, land) < dist(p, land) ? q : p), null);
      if (!near) return land;
      return { x: lerp(land.x, clamp(near.x, x0, x1), 0.75), y: lerp(land.y, clamp(near.y, top, bottom), 0.75) };
    }
    const t = z.wide
      ? threats.reduce((p, q) => (Math.abs(q.x - CX) > Math.abs(p.x - CX) ? q : p)) // widest
      : threats.reduce((p, q) => (dist(q, land) < dist(p, land) ? q : p)); // nearest
    // sit in the zone and shade toward the threat, rather than attaching to him
    const shade = { x: lerp(land.x, t.x, 0.6), y: lerp(land.y, t.y - 0.8 * YD, 0.6) };
    return { x: clamp(shade.x, x0, x1), y: clamp(shade.y, top, bottom) };
  }

  /** Keep bodies from overlapping. Engaged blocks and the QB are left alone. */
  private separate(): void {
    const a = this.actors;
    for (let i = 0; i < a.length; i++) {
      for (let j = i + 1; j < a.length; j++) {
        const p = a[i], q = a[j];
        if (p.engaged === q || q.engaged === p || p.engagedBy === q || q.engagedBy === p) continue;
        if ((p.kind === 'qb' && q.job === 'rush') || (q.kind === 'qb' && p.job === 'rush')) continue;
        if (p === this.carrier || q === this.carrier) continue;
        const d = dist(p, q);
        if (d >= BODY || d < 1e-6) continue;
        const push = (BODY - d) / d;
        const dx = (q.x - p.x) * push, dy = (q.y - p.y) * push;
        // The QB doesn't get moved. While routes are being run, defenders give
        // way to receivers (no shoving a man off his route); once the ball is
        // in the air they fight for position equally.
        const routes = this.phase === 'live';
        const pw = p.kind === 'qb' || (routes && p.job === 'route' && q.team === 'def') ? 0
          : q.kind === 'qb' || (routes && q.job === 'route' && p.team === 'def') ? 1 : 0.5;
        p.x -= dx * pw; p.y -= dy * pw;
        q.x += dx * (1 - pw); q.y += dy * (1 - pw);
      }
    }
  }

  private updateBall(ball: Ball, dt: number): void {
    ball.t += dt;
    const s = Math.min(1, ball.t / ball.dur);
    const pos = this.ballGround();
    // The catch is decided where the ball comes down: whoever is at the spot
    // when it gets there. (Defenders jump routes by breaking to that spot.)
    if (s >= 1) {
      // nearest receiver and nearest defender who can reach the ball
      const reach = { off: CATCH_RADIUS, def: defenderReach(dist(ball.from, ball.to)) };
      const nearest = (team: Team) => {
        let best: Actor | null = null, bestD = Infinity;
        for (const p of this.actors) {
          if (p.team !== team) continue;
          const eligible = team === 'off' ? p.job === 'route' : p.job === 'man' || p.job === 'zone';
          const d = dist(p, pos);
          if (eligible && d <= reach[team] && d < bestD) { best = p; bestD = d; }
        }
        return { p: best, d: bestD };
      };
      const o = nearest('off'), d = nearest('def');
      let outcome: Result | null = null;
      const roll = Math.random();
      if (o.p && !d.p) outcome = 'catch';
      else if (d.p && !o.p) outcome = roll < 0.18 ? 'int' : 'inc'; // defenders drop plenty
      else if (o.p && d.p) {
        // contested: who is really closer to the ball decides it, and the
        // longer the ball hangs, the more time the defender has to play it
        const edge = d.d - o.d; // px the receiver is closer by
        const hang = clamp(1.25 - dist(ball.from, ball.to) / 220, 0.45, 1);
        if (edge >= 3) outcome = roll < 0.68 * hang ? 'catch' : roll < 0.98 ? 'inc' : 'int';
        else if (edge >= 0) outcome = roll < 0.45 * hang ? 'catch' : roll < 0.96 ? 'inc' : 'int';
        else if (edge > -2) outcome = roll < 0.3 * hang ? 'catch' : roll < 0.94 ? 'inc' : 'int';
        else outcome = roll < 0.18 ? 'int' : 'inc';
      }
      if (outcome) this.lastContest = { off: o.p ? o.d : null, def: d.p ? d.d : null, outcome }; // for tuning
      if (outcome === 'catch' && o.p) { this.startRun(o.p); return; }
      if (outcome === 'int' && d.p) { ball.carrier = d.p; this.finish('int', d.p.y); return; }
      this.finish('inc', this.qb.y); // nobody there, or knocked away
    }
  }

  private finish(r: Result, spotY: number): void {
    this.result = r;
    this.spotY = spotY;
    this.phase = 'done';
  }

  // ---------- run after catch ----------

  private startRun(c: Actor): void {
    this.ball!.carrier = c;
    this.carrier = c;
    this.result = 'catch';
    this.runT = 0;
    const d = c.dir ?? { x: 0, y: -1 };
    c.vel = { x: d.x * c.speed, y: d.y * c.speed };
    if (c.y <= this.goalY) { this.touchdown = true; this.finish('catch', c.y); return; }
    // the line play is over: everyone turns and chases
    for (const a of this.actors) { a.engaged = null; a.engagedBy = null; }
    for (const d2 of this.defense) d2.react = rand(0.05, 0.25) + (d2.job === 'rush' ? 0.2 : 0);
    this.phase = 'run';
  }

  private updateRun(dt: number): void {
    const c = this.carrier!;
    this.runT += dt;
    const defenders = this.defense;
    const active = defenders.filter((d) => this.t >= d.stunUntil);

    // Carrier: head upfield, bending away from nearby tacklers and the sideline.
    const want = { x: 0, y: -1 };
    for (const d of active) {
      const dd = dist(d, c);
      if (dd > 30 || d.y > c.y + 12) continue; // only worry about those in front or beside
      const away = unit(d, c);
      const w = ((30 - dd) / 30) * 1.6;
      want.x += away.x * w;
      want.y += away.y * w * 0.4; // sidestep more than retreat
    }
    if (c.x < FIELD_LEFT + 10) want.x += (FIELD_LEFT + 10 - c.x) / 10;
    if (c.x > FIELD_RIGHT - 10) want.x -= (c.x - (FIELD_RIGHT - 10)) / 10;
    want.y = Math.min(want.y, -0.35); // always keep going forward
    const wl = Math.hypot(want.x, want.y);
    const turn = Math.min(1, 5 * dt);
    const speed = c.speed * 0.88 * clamp(0.4 + this.runT / 0.6, 0.4, 1); // gathers himself after the catch
    c.vel = {
      x: lerp(c.vel.x, (want.x / wl) * speed, turn),
      y: lerp(c.vel.y, (want.y / wl) * speed, turn),
    };
    const vl = Math.hypot(c.vel.x, c.vel.y) || 1;
    c.x += (c.vel.x / vl) * speed * dt;
    c.y += (c.vel.y / vl) * speed * dt;

    if (c.y <= this.goalY) { this.touchdown = true; this.finish('catch', c.y); return; }
    if (c.x < FIELD_LEFT || c.x > FIELD_RIGHT) { this.outOfBounds = true; this.finish('catch', c.y); return; }

    // Other receivers try to get in the way of the nearest pursuers.
    const screened = new Set<Actor>();
    const pursuers = [...active].sort((p, q) => dist(p, c) - dist(q, c));
    for (const r of this.receivers) {
      if (r === c) continue;
      const target = pursuers.find((d) => !screened.has(d) && dist(d, r) < 45);
      if (!target) { moveToward(r, { x: r.x, y: c.y - 10 }, r.speed * 0.5 * dt); continue; }
      screened.add(target);
      moveToward(r, { x: lerp(target.x, c.x, 0.3), y: lerp(target.y, c.y, 0.3) }, r.speed * dt);
    }

    // Defenders take a pursuit angle (aim where he's going) and try to tackle.
    for (const d of active) {
      if (this.runT < d.react) continue;
      const lead = clamp(dist(d, c) / d.speed, 0, 0.8);
      const aim = { x: c.x + c.vel.x * lead, y: c.y + c.vel.y * lead };
      const blocked = this.receivers.some((r) => r !== c && dist(r, d) < SCREEN_DIST);
      moveToward(d, aim, d.speed * dt * (blocked ? 0.35 : 1));
      if (dist(d, c) < TACKLE_DIST) {
        if (Math.random() < (BREAK_CHANCE[c.kind] ?? 0.15)) {
          d.stunUntil = this.t + STUN_TIME; // broken tackle!
        } else {
          this.finish('catch', c.y);
          return;
        }
      }
    }
    this.separate();
  }


  ballGround(): Vec {
    const b = this.ball!;
    if (b.carrier) return { x: b.carrier.x, y: b.carrier.y };
    const s = Math.min(1, b.t / b.dur);
    return { x: lerp(b.from.x, b.to.x, s), y: lerp(b.from.y, b.to.y, s) };
  }

  ballHeight(): number {
    const b = this.ball!;
    return b.carrier ? 0 : arcHeight(b.peak, Math.min(1, b.t / b.dur));
  }
}
