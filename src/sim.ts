// The on-field simulation. No drawing or DOM here, so it can be stepped in tests.
import { CX, FIELD_LEFT, FIELD_RIGHT, QB_DEPTH, ROUTE_COLORS, TIME_SCALE, YD, fx, fy } from './config';
import { CALLS, type Call, DEF_BASE, type DefId, type DefKind, ZONES, type ZoneDef, pickCall } from './defense/calls';
import { FORMATIONS, OL_DEPTH, OL_SPOTS, type SkillType } from './playbook/formations';
import type { Play } from './playbook/plays';
import { ROUTES, routeYards } from './playbook/routes';
import { type Vec, clamp, dist, lerp, moveToward, rand, unit } from './util';

export type Team = 'off' | 'def';
export type Kind = 'qb' | 'ol' | SkillType | DefKind;
export type Phase = 'presnap' | 'live' | 'air' | 'done';
export type Result = 'catch' | 'int' | 'inc' | 'sack';
type Job = 'none' | 'route' | 'block' | 'rush' | 'man' | 'zone';

/** Top speeds in yards per second. */
const SPEED: Record<Kind, number> = { qb: 0, ol: 6, wr: 8.6, te: 7.6, rb: 8.2, dl: 6.6, lb: 7.2, db: 8.1 };

// Catching
const CATCH_WINDOW = 0.9; // ball is catchable only at the very end of its flight...
const CATCH_HEIGHT = 8; // ...when it's this low (so undercutting a throw takes real position)
const CATCH_RADIUS: Record<Team, number> = { off: 9, def: 6 }; // receivers attack the ball
const BALL_HAWK = 28; // receivers this close to the landing spot go get the ball

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
}

export interface Ball {
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
  return { dur: (0.4 + d / 200) * TIME_SCALE, peak: clamp(d * 0.28, 5, 56) };
}

function makeActor(id: string, team: Team, kind: Kind, x: number, y: number): Actor {
  return {
    id, team, kind, x, y, speed: SPEED[kind] * YD, job: 'none',
    color: '', path: [], leg: 0, end: 'stop', dir: null,
    man: null, zone: null, goal: { x, y }, react: 0,
    assigned: null, engaged: null, beatenBy: [], setSpot: { x, y: y + 1.5 * YD },
    engagedBy: null, shedAt: Infinity, burstAt: 0, push: 0,
  };
}

export class Sim {
  actors: Actor[] = [];
  phase: Phase = 'presnap';
  t = 0; // sim seconds since the snap
  airT = 0; // sim seconds since the throw
  ball: Ball | null = null;
  result: Result | null = null;
  call: Call = CALLS[0];
  play!: Play;
  stats = { cmp: 0, int: 0, inc: 0, sack: 0 };
  forceCall: string | null = null; // tests can pin a defensive call

  get qb(): Actor { return this.actors[0]; }
  get offense() { return this.actors.filter((a) => a.team === 'off'); }
  get defense() { return this.actors.filter((a) => a.team === 'def'); }
  get receivers() { return this.actors.filter((a) => a.job === 'route'); }
  get rushers() { return this.actors.filter((a) => a.job === 'rush'); }
  get blockers() { return this.actors.filter((a) => a.job === 'block'); }

  // ---------- setup ----------

  reset(play: Play): void {
    this.play = play;
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
          x: clamp(fx(q.x), FIELD_LEFT + 2, FIELD_RIGHT - 2), y: fy(q.d),
        }));
      }
      a.push(p);
    }

    for (const id of Object.keys(DEF_BASE) as DefId[]) {
      const b = DEF_BASE[id];
      a.push(makeActor(id, 'def', b.kind, fx(b.x), fy(b.d)));
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
      d.goal = { x: d.x, y: d.y };
      // man defenders have their back to the ball, so they see it later
      d.react = (d.kind === 'db' ? rand(0.25, 0.4) : rand(0.35, 0.5)) + (d.job === 'man' ? 0.2 : 0);
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

  throwTo(to: Vec): void {
    if (this.phase !== 'live') return;
    const from = { x: this.qb.x, y: this.qb.y - 3 };
    this.ball = { from, to, ...flightFor(from, to), t: 0, carrier: null };
    this.phase = 'air';
    this.airT = 0;
  }

  // ---------- simulation ----------

  update(dtReal: number): void {
    if (this.phase !== 'live' && this.phase !== 'air') return;
    const dt = dtReal * TIME_SCALE;
    this.t += dt;
    if (this.phase === 'air') this.airT += dt;

    this.updateReceivers(dt);
    this.updateLine(dt);
    this.updateCoverage(dt);
    this.separate();

    if (this.phase === 'live' && this.rushers.some((r) => dist(r, this.qb) < SACK_DIST)) {
      this.finish('sack');
      return;
    }
    if (this.phase === 'air' && this.ball) this.updateBall(this.ball, dt);
  }

  private landing(): Vec | null {
    return this.ball && !this.ball.carrier ? this.ball.to : null;
  }

  private updateReceivers(dt: number): void {
    const landing = this.landing();
    for (const p of this.receivers) {
      const step = p.speed * dt;
      if (landing && dist(p, landing) < BALL_HAWK) { moveToward(p, landing, step); continue; }
      if (p.leg < p.path.length) {
        p.dir = unit(p, p.path[p.leg]);
        if (moveToward(p, p.path[p.leg], step)) p.leg++;
      } else if (p.end === 'continue' && p.dir) {
        p.x = clamp(p.x + p.dir.x * step, FIELD_LEFT + 2, FIELD_RIGHT - 2);
        p.y = Math.max(6, p.y + p.dir.y * step);
      }
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
          const [lo, hi] = r.kind === 'lb' ? [1.6, 3.0] : Math.abs(r.x - CX) > 4 * YD ? [2.7, 4.8] : [3.0, 5.4];
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
      const range = d.kind === 'lb' ? 32 : d.kind === 'dl' ? 26 : d.zone?.deep ? 70 : 40;
      const sees = landing && this.airT >= d.react;
      if (sees && d.job === 'man' && d.man && dist(d.man, landing) < 24) {
        // ball is coming to my man: play through him and contest the catch
        d.goal = { x: lerp(d.man.x, landing.x, 0.4), y: lerp(d.man.y, landing.y, 0.4) };
      } else if (sees && dist(d, landing) < range) {
        d.goal = { ...landing }; // zone defenders (or a man defender nearby) jump the throw
      } else {
        let raw: Vec;
        let k: number;
        if (d.job === 'man' && d.man) {
          const m = d.man;
          const inside = m.x < CX ? 1 : -1;
          raw = { x: m.x + inside * 0.5 * YD, y: m.y - 1.2 * YD };
          k = 3.2; // lower = slower to react to cuts = more separation
        } else {
          raw = this.zoneTarget(d.zone!);
          k = 3.5;
        }
        const f = Math.min(1, k * dt);
        d.goal = { x: lerp(d.goal.x, raw.x, f), y: lerp(d.goal.y, raw.y, f) };
      }
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
      return { x: clamp(mid, x0, x1), y: Math.min(land.y, deepest - 3 * YD) };
    }
    if (!threats.length) {
      // nobody here: sink toward the nearest route in my lane, staying in the zone
      const near = inLane.reduce<Actor | null>((p, q) => (!p || dist(q, land) < dist(p, land) ? q : p), null);
      if (!near) return land;
      return { x: lerp(land.x, clamp(near.x, x0, x1), 0.5), y: lerp(land.y, clamp(near.y, top, bottom), 0.5) };
    }
    const t = z.wide
      ? threats.reduce((p, q) => (Math.abs(q.x - CX) > Math.abs(p.x - CX) ? q : p)) // widest
      : threats.reduce((p, q) => (dist(q, land) < dist(p, land) ? q : p)); // nearest
    return { x: clamp(t.x, x0, x1), y: clamp(t.y - 0.8 * YD, top, bottom) };
  }

  /** Keep bodies from overlapping. Engaged blocks and the QB are left alone. */
  private separate(): void {
    const a = this.actors;
    for (let i = 0; i < a.length; i++) {
      for (let j = i + 1; j < a.length; j++) {
        const p = a[i], q = a[j];
        if (p.engaged === q || q.engaged === p || p.engagedBy === q || q.engagedBy === p) continue;
        if ((p.kind === 'qb' && q.job === 'rush') || (q.kind === 'qb' && p.job === 'rush')) continue;
        const d = dist(p, q);
        if (d >= BODY || d < 1e-6) continue;
        const push = (BODY - d) / d;
        const dx = (q.x - p.x) * push, dy = (q.y - p.y) * push;
        const pw = p.kind === 'qb' ? 0 : q.kind === 'qb' ? 1 : 0.5;
        p.x -= dx * pw; p.y -= dy * pw;
        q.x += dx * (1 - pw); q.y += dy * (1 - pw);
      }
    }
  }

  private updateBall(ball: Ball, dt: number): void {
    ball.t += dt;
    const s = Math.min(1, ball.t / ball.dur);
    const pos = this.ballGround();
    if (s >= CATCH_WINDOW && arcHeight(ball.peak, s) <= CATCH_HEIGHT) {
      // nearest receiver and nearest defender who can reach the ball
      const nearest = (team: Team) => {
        let best: Actor | null = null, bestD = Infinity;
        for (const p of this.actors) {
          if (p.team !== team) continue;
          const eligible = team === 'off' ? p.job === 'route' : p.job === 'man' || p.job === 'zone';
          const d = dist(p, pos);
          if (eligible && d <= CATCH_RADIUS[team] && d < bestD) { best = p; bestD = d; }
        }
        return { p: best, d: bestD };
      };
      const o = nearest('off'), d = nearest('def');
      let outcome: Result | null = null;
      if (o.p && !d.p) outcome = 'catch';
      else if (d.p && !o.p) outcome = Math.random() < 0.7 ? 'int' : 'inc'; // some drops
      else if (o.p && d.p) {
        // contested: the defender needs real position to pick it off
        if (d.d + 2 < o.d) outcome = Math.random() < 0.4 ? 'int' : 'inc';
        else outcome = Math.random() < 0.65 ? 'catch' : 'inc';
      }
      if (outcome) {
        if (outcome !== 'inc') ball.carrier = outcome === 'catch' ? o.p : d.p;
        this.finish(outcome);
        return;
      }
    }
    if (s >= 1) this.finish('inc');
  }

  private finish(r: Result): void {
    this.result = r;
    this.phase = 'done';
    this.stats[r === 'catch' ? 'cmp' : r]++;
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
