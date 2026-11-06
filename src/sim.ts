// The on-field simulation. No drawing or DOM here, so it can be stepped in tests.
import { CX, FIELD_LEFT, FIELD_RIGHT, LOS_Y, MAX_THROW, QB_DEPTH, ROUTE_COLORS, TIME_SCALE, YD, fx, fy } from './config';
import { CALLS, type Call, DEF_BASE, type DefId, type DefKind, ZONES, type ZoneDef, type ZoneKey, pickCall } from './defense/calls';
import { FORMATIONS, OL_DEPTH, OL_SPOTS, type SkillType } from './playbook/formations';
import type { Play } from './playbook/plays';
import { ROUTES, type RouteDef, routeYards } from './playbook/routes';
import { type Player, type RatingKey, type Roster, delta, playerFor } from './ratings';
import { type Vec, clamp, dist, lerp, moveToward, rand, unit } from './util';

export type Team = 'off' | 'def';
export type Kind = 'qb' | 'ol' | SkillType | DefKind;
export type Phase = 'presnap' | 'live' | 'air' | 'run' | 'done';
export type Result = 'catch' | 'int' | 'inc' | 'sack';
type Job = 'none' | 'route' | 'block' | 'lead' | 'rush' | 'man' | 'zone'; // lead = blocking downfield

/** Top speeds in yards per second. */
const SPEED: Record<Kind, number> = { qb: 0, ol: 6, wr: 8.0, te: 7.1, rb: 7.6, dl: 6.4, lb: 7.0, db: 7.7 };

// Catching
const CATCH_RADIUS = 7; // receivers attack the ball
/** How far a defender can reach to play the ball: quick throws are on top of him before he reacts. */
const defenderReach = (throwLen: number) => clamp(3.5 + throwLen / 45, 4, 6.5);
const BALL_HAWK = 22; // a receiver this close to the landing spot always goes for it
const BALL_READ = 0.25; // sim seconds for receivers to pick the ball up in the air

// Throwing
/**
 * How far off a throw can land (px), as the half-axes of an oval around the aim
 * point: 'along' the throw line (long/short) and 'lat' (left/right). Short throws
 * are on the money; deep balls can drift a few yards, mostly long or short.
 * The ball always lands inside this oval; pressure makes it bigger.
 */
export function throwSpread(d: number, pressured: boolean): { along: number; lat: number } {
  const e = (d * 0.02 + Math.max(0, d - 70) * 0.07) * (pressured ? 1.6 : 1);
  return { along: 1 + e * 1.6, lat: 1 + e * 0.9 };
}
const PRESSURE_DIST = 18; // a free rusher this close doubles the error

// Run after catch
const TACKLE_DIST = 5;
const FALL_FORWARD = 1; // yards a tackled runner falls forward
const BREAK_CHANCE: Partial<Record<Kind, number>> = { wr: 0.14, te: 0.18, rb: 0.2 };
const STUN_TIME = 0.7; // a defender who misses a tackle is out of the play this long
const SCREEN_DIST = 6; // a receiver this close to a pursuer slows him down
const USER_SPEED = 1.15; // your linebacker gets a little extra jump

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
  user: boolean; // the defender you control
  delay: number; // receivers: sim seconds before he releases into his route (screens sell a block first)
  blockTarget: Actor | null; // downfield blockers: the defender he's on
  leadReadyAt: number; // downfield blockers: when he starts looking for someone to block
  heldBy: Actor | null; // defenders: the blocker holding him
  heldUntil: number; // defenders: when he sheds that block
  keyDelay: number; // man on a running back: the read step before he reacts (is the back blocking or releasing?)
  pl: Player | undefined; // who this is (ratings)
  read: Vec; // man coverage: the defender's (lagging) read of his man's velocity
  leverage: number; // man coverage: +1 shades inside, -1 outside (decided each snap)
  cushion: number; // man coverage: yards off at the snap (press ~1, off ~5); closes as the route develops
}

type Shell = 'one' | 'two' | 'zero';
export interface ResetOptions {
  userDefender?: DefId | null; // the defender you control (on defense)
  teams?: { off: Roster; def: Roster }; // the rosters on the field (player ratings)
  cpuTeam?: Team | null; // which side the CPU controls (difficulty applies to it)
  tuning?: { speed: number; react: number; catchBonus: number };
  callBias?: (c: Call) => number; // weight the defensive call (the defense adapting to you)
  recognition?: number; // 0..1: how well the defense has your play scouted
  call?: Call; // a defensive call you picked (otherwise one is chosen)
  ballX?: number; // where the ball is spotted across the field (yards from the middle; hashes are +-HASH_YD)
  mirror?: boolean; // run the play to the other side
}

/** Hash marks: yards either side of the middle of the field. */
export const HASH_YD = 6.67;
const NO_TUNING = { speed: 1, react: 0, catchBonus: 0 };

export interface Ball {
  aim: Vec; // where the QB aimed
  from: Vec;
  to: Vec;
  peak: number;
  dur: number;
  t: number;
  carrier: Actor | null;
}

function gauss(): number {
  return Math.sqrt(-2 * Math.log(1 - Math.random() * 0.999)) * Math.cos(Math.random() * Math.PI * 2);
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
    vel: { x: 0, y: 0 }, stunUntil: 0, read: { x: 0, y: 0 }, user: false, leverage: 1, cushion: 1,
    delay: 0, blockTarget: null, leadReadyAt: 0, heldBy: null, heldUntil: 0, keyDelay: 0, pl: undefined,
  };
}

export class Sim {
  actors: Actor[] = [];
  phase: Phase = 'presnap';
  t = 0; // sim seconds since the snap
  airT = 0; // sim seconds since the throw
  intended: Actor | null = null; // receiver going for the thrown ball
  ball: Ball | null = null;
  result: Result | null = null;
  carrier: Actor | null = null; // receiver running after the catch
  runT = 0; // sim seconds since the catch
  private runStart = 0.4; // fraction of top speed the runner starts the run at
  spotY = 0; // where the play ended (pixel y), for measuring the gain
  touchdown = false;
  outOfBounds = false;
  call: Call = CALLS[0];
  play!: Play;
  forceCall: string | null = null; // tests can pin a defensive call
  speedFactor = 1; // game speed setting: scales the whole simulation together
  catchBias = 0; // difficulty: nudges contested catches toward (or away from) the receiver
  shell: Shell = 'one'; // what the safeties showed before the snap
  lastContest: { off: number | null; def: number | null; outcome: Result } | null = null;
  goalY = -1e9; // pixel y of the goal line we're attacking
  get endLineY() { return this.goalY - 10 * YD; }
  screenTarget: Actor | null = null; // the receiver a screen is for (blockers set up in front of him)
  ballX = 0; // where the ball is spotted across the field (yards from the middle)
  mirror = false; // the play is run to the other side
  private released = false; // screen linemen have released
  private qbSpot: Vec | null = null; // rollouts: where the QB is sprinting to
  /** A player's rating relative to his position's norm (0 = average starter). */
  rd(a: Actor | null | undefined, k: RatingKey): number { return a ? delta(a.pl, k) : 0; }
  /** QB accuracy: scales the landing oval. */
  get accFactor(): number { return clamp(1 - this.rd(this.qb, 'acc') * 0.008, 0.65, 1.4); }
  /** QB arm: the longest throw he can make. */
  get maxThrow(): number { return MAX_THROW * clamp(1 + this.rd(this.qb, 'arm') * 0.004, 0.85, 1.15); }
  /** Throwing on the run spreads the ball out a bit more. */
  get movingFactor(): number { return this.qbSpot && this.phase === 'live' && dist(this.qb, this.qbSpot) > 2 ? 1.25 : 1; }

  get qb(): Actor { return this.actors[0]; }
  get offense() { return this.actors.filter((a) => a.team === 'off'); }
  get defense() { return this.actors.filter((a) => a.team === 'def'); }
  get receivers() { return this.actors.filter((a) => a.job === 'route'); }
  get rushers() { return this.actors.filter((a) => a.job === 'rush'); }
  /** The defender you control, if you're on defense. */
  get user(): Actor | undefined { return this.actors.find((a) => a.user); }
  /** Rushers, plus your linebacker once he crosses the line (then the line blocks him too). */
  get passRushers(): Actor[] {
    const u = this.user;
    const r = this.rushers;
    return u && u.job !== 'rush' && u.y > LOS_Y - 2.5 * YD ? [...r, u] : r; // the line sees him coming
  }
  /** Joystick input for your defender: direction times strength (0..1). */
  userMove: Vec = { x: 0, y: 0 };
  /** Are you steering him right now? If not, he plays his assignment on his own. */
  userControl = false;
  private steering(a: Actor): boolean { return a.user && this.userControl; }
  get blockers() { return this.actors.filter((a) => a.job === 'block'); }

  // ---------- setup ----------

  /** Sets up the next play. goalY is where the goal line is (pixel y). */
  reset(play: Play, goalY = this.goalY, opts: ResetOptions = {}): void {
    const { userDefender = null, teams, cpuTeam = null, tuning = NO_TUNING, callBias, recognition = 0 } = opts;
    this.play = play;
    this.ballX = clamp(opts.ballX ?? 0, -HASH_YD, HASH_YD);
    this.mirror = !!opts.mirror;
    const bx = this.ballX, m = this.mirror ? -1 : 1;
    this.screenTarget = null;
    this.released = false;
    // rollouts sprint out; screens drift back to let the rush come and buy room
    const rollSide = (play.rollout === 'right' ? 1 : -1) * m;
    this.qbSpot = play.rollout ? { x: fx(clamp(bx + rollSide * 8, -20, 20)), y: fy(-6.5) }
      : play.screen ? { x: fx(bx), y: fy(-8.5) } : null;
    this.catchBias = cpuTeam === 'def' ? tuning.catchBonus : cpuTeam === 'off' ? -tuning.catchBonus : 0;
    this.goalY = goalY;
    this.carrier = null;
    this.runT = 0;
    this.touchdown = false;
    this.outOfBounds = false;
    this.call = CALLS.find((c) => c.id === this.forceCall) ?? opts.call ?? pickCall(callBias);
    this.phase = 'presnap';
    this.t = 0;
    this.airT = 0;
    this.intended = null;
    this.ball = null;
    this.result = null;

    const a: Actor[] = [makeActor('QB', 'off', 'qb', fx(bx), fy(-QB_DEPTH))];
    if (play.rollout) a[0].speed = 6.2 * YD; // sprints out
    else if (play.screen) a[0].speed = 4.5 * YD; // drifts back
    OL_SPOTS.forEach((x, i) => {
      const ol = makeActor(`OL${i}`, 'off', 'ol', fx(x + bx), fy(OL_DEPTH));
      ol.job = 'block';
      a.push(ol);
    });

    let colorIdx = 0;
    for (const spot of FORMATIONS[play.formation].skill) {
      // Inside players move with the ball; wide receivers stay near the numbers
      // (so on a hash the short side isn't jammed against the sideline).
      const sx = spot.x * m;
      const shortSide = Math.sign(sx) === Math.sign(bx); // the side the ball is shifted toward
      const k = Math.abs(sx) <= 9 ? 1 : Math.abs(sx) < 15 ? 0.7 : shortSide ? 0 : 0.3;
      const ax = clamp(sx + bx * k, -24.5, 24.5);
      const p = makeActor(spot.id, 'off', spot.type, fx(ax), fy(spot.d));
      const pr = play.routes.find((r) => r.who === spot.id);
      if (!pr || pr.route === 'block') {
        p.job = 'block';
      } else if (pr.route === 'stalk') {
        p.job = 'lead'; // blocks the defender over him
        p.leadReadyAt = 0.2;
      } else {
        const route: RouteDef = ROUTES[pr.route];
        p.job = 'route';
        p.end = route.end;
        p.delay = route.delay ?? 0;
        if (pr.route === 'screenRB' || pr.route === 'bubble' || pr.route === 'tunnel') this.screenTarget = p;
        p.color = ROUTE_COLORS[colorIdx++ % ROUTE_COLORS.length];
        const depth = rand(0.93, 1.07); // a little variety in how deep he runs it
        // routes break toward his own side of the formation, even if the hash put him across the middle
        const side = Math.sign(sx) || 1, crossed = (Math.sign(ax) || side) !== side;
        p.path = routeYards(ax, spot.d, route, !!pr.flip !== crossed).map((q) => ({
          x: clamp(fx(q.x), FIELD_LEFT + 2, FIELD_RIGHT - 2),
          y: Math.max(fy(spot.d + (q.d - spot.d) * depth), this.endLineY + 2),
        }));
      }
      a.push(p);
    }

    // Against 3+ wide receivers the defense subs in a nickel back for the SAM linebacker.
    const wideouts = FORMATIONS[play.formation].skill.filter((sp) => sp.type === 'wr').length;
    for (const id of Object.keys(DEF_BASE) as DefId[]) {
      const b = DEF_BASE[id];
      const kind = id === 'SAM' && wideouts >= 3 ? 'db' : b.kind;
      a.push(makeActor(id, 'def', kind, fx(b.x + bx * (b.kind === 'db' ? 0.3 : 1)), fy(b.d))); // the box shifts with the ball
    }
    this.actors = a;
    // who's who: ratings from the rosters (speed applies right away; the rest where they matter)
    const teOnField = FORMATIONS[play.formation].skill.some((sp) => sp.id === 'Y' && sp.type === 'te');
    for (const p of a) {
      if (teams) p.pl = playerFor(p.team === 'off' ? teams.off : teams.def, p.team, p.id, { te: teOnField, nickel: wideouts >= 3 });
      p.speed *= 1 + this.rd(p, 'spd') * 0.004;
      if (cpuTeam === p.team && (p.team === 'def' ? p.kind !== 'dl' : p.job === 'route')) p.speed *= tuning.speed;
    }
    this.applyCall();
    for (const d of this.defense) {
      if (cpuTeam === 'def') d.react += tuning.react;
      d.react *= 1 - 0.35 * recognition; // they've seen this play before: quicker to jump it
    }
    this.userMove = { x: 0, y: 0 };
    this.userControl = false;
    if (userDefender) {
      const u = this.def(userDefender);
      u.user = true;
      u.push = 2.6; // drives a blocker back if he's caught in one
    }
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
    const recs = [...this.receivers].sort((p, q) => Math.abs(q.x - fx(this.ballX)) - Math.abs(p.x - fx(this.ballX)));
    const take = (d: Actor, r: Actor) => {
      d.job = 'man';
      d.man = r;
      pool.splice(pool.indexOf(d), 1);
      recs.splice(recs.indexOf(r), 1);
    };
    const cbL = pool.find((d) => d.id === 'CB_L');
    const cbR = pool.find((d) => d.id === 'CB_R');
    const mid = fx(this.ballX); // sides are measured from the ball, not the middle of the field
    const left = recs.filter((r) => r.x < mid).sort((p, q) => p.x - q.x)[0];
    const right = recs.filter((r) => r.x > mid).sort((p, q) => q.x - p.x)[0];
    if (cbL && left) take(cbL, left);
    if (cbR && right) take(cbR, right);
    const order: Kind[] = ['wr', 'te', 'rb'];
    recs.sort((p, q) => order.indexOf(p.kind) - order.indexOf(q.kind));
    for (const r of [...recs]) {
      if (!pool.length) break;
      const cost = (d: Actor) => {
        const mismatch = r.kind === 'wr' ? (d.kind === 'db' ? 0 : 20) : d.kind === 'lb' ? 0 : 8;
        return mismatch + Math.abs(fx(DEF_BASE[d.id as DefId].x + this.ballX) - r.x) / YD;
      };
      take(pool.reduce((best, d) => (cost(d) < cost(best) ? d : best)), r);
    }
    // Spare man defenders (their man stayed in to block): linebackers add on to the
    // rush ("green dog"); spare DBs spread out to the open areas instead of stacking up.
    const spare: ZoneKey[] = ['robber', 'hookL', 'hookR'];
    let si = 0;
    for (const d of pool) {
      if (d.kind === 'lb' || d.kind === 'dl') d.job = 'rush';
      else { d.job = 'zone'; d.zone = ZONES[spare[si++ % spare.length]]; }
    }

    // Pre-snap alignment. The defense lines up to the formation, and the
    // safeties show a shell (one-high, two-high, or zero) that is usually,
    // but not always, what they really play: they rotate after the snap.
    const shown: Shell = call.shell === 'zero'
      ? (Math.random() < 0.5 ? 'zero' : 'one')
      : Math.random() < 0.35 ? (call.shell === 'one' ? 'two' : 'one') : call.shell;
    this.shell = shown;
    const ballPx = fx(this.ballX); // sides and strength are measured from the ball
    const sideRecs = (side: number) => this.receivers.filter((r) => (r.x - ballPx) * side > 0).sort((p, q) => Math.abs(q.x - ballPx) - Math.abs(p.x - ballPx));
    const strength = Math.sign(sideRecs(1).length - sideRecs(-1).length); // +1 = more receivers to the right
    for (const d of this.defense) {
      if (d.job === 'man' && d.man) {
        const r = d.man;
        if (r.kind === 'rb') {
          // On a back, a linebacker has to read him first (blocking or releasing?): a beat late.
          d.keyDelay = rand(0.55, 0.85);
        } else {
          // Technique varies snap to snap, and you can read it before the snap:
          // inside leverage takes away slants, outside takes away outs; press
          // fights the release, off coverage gives up the short stuff.
          d.leverage = Math.random() < 0.55 ? 1 : -1;
          const press = d.kind === 'db' && Math.random() < (call.press ?? (call.id === 'c0' ? 0.75 : 0.45));
          d.cushion = d.kind === 'lb' ? 2.5 : press ? 1 : rand(4, 6);
          const side = (r.x < ballPx ? 1 : -1) * d.leverage;
          d.x = r.x + side * 0.8 * YD;
          d.y = fy(d.cushion);
        }
      } else if (d.job === 'zone' && d.zone) {
        const z = d.zone;
        const zside = Math.sign(z.x) || (d.x < CX ? -1 : 1);
        if (d.id === 'CB_L' || d.id === 'CB_R') {
          const side = d.id === 'CB_L' ? -1 : 1;
          const wide = sideRecs(side)[0];
          if (wide) d.x = wide.x - side * 0.5 * YD;
          d.y = fy(z.deep ? rand(5, 8) : rand(3, 6)); // sometimes a press look, then bail
        } else if (!z.deep && z.wide && d.kind !== 'dl') {
          // flat / curl-flat defenders: apex over the slot (#2), or walk out if there isn't one
          const two = sideRecs(zside)[1];
          d.x = two ? lerp(two.x, fx(zside * 4.6 + this.ballX), 0.4) : fx(z.x * 0.7 + this.ballX * 0.6);
          d.y = fy(two ? 5 : 6);
        } else if (!z.deep && d.kind === 'lb') {
          d.x = fx(DEF_BASE[d.id as DefId].x + strength * 1.5 + this.ballX); // slide toward the strength
        }
      }
      if (d.id === 'FS' || d.id === 'SS') this.alignSafety(d, shown, strength);
      d.y = Math.max(d.y, this.endLineY + 2);
      d.goal = { x: d.x, y: d.y };
      // zone defenders watch the QB and break quickest; man defenders see the ball late
      d.react = (d.job === 'man' ? (d.kind === 'db' ? rand(0.45, 0.6) : rand(0.55, 0.7))
        : d.kind === 'db' ? rand(0.12, 0.25) : rand(0.3, 0.45)) * clamp(1 - this.rd(d, 'cov') * 0.006, 0.8, 1.2);
    }
  }

  /** Where a safety stands before the snap for the shell being shown. */
  private alignSafety(d: Actor, shell: Shell, strength: number): void {
    const fsSide = d.id === 'FS' ? -1 : 1;
    const bx = this.ballX * 0.4;
    if (shell === 'two') { d.x = fx(fsSide * rand(8, 11) + bx); d.y = fy(rand(11, 13)); return; }
    if (shell === 'one' && d.id === 'FS') { d.x = fx(rand(-2, 2) + bx); d.y = fy(rand(12, 14)); return; }
    // down safety (SS in one-high, both in zero): over the slot to the strength, or in the box
    const side = shell === 'zero' ? fsSide : (strength || 1);
    const bp = fx(this.ballX);
    const slot = this.receivers.filter((r) => (r.x - bp) * side > 0).sort((p, q) => Math.abs(p.x - bp) - Math.abs(q.x - bp))[0];
    d.x = slot ? lerp(slot.x, fx(side * 4.6 + this.ballX), 0.3) : fx(side * 6 + this.ballX);
    d.y = fy(rand(6, 8));
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
    return this.passRushers.some((r) => !r.engagedBy && dist(r, this.qb) < PRESSURE_DIST);
  }

  throwTo(aim: Vec, accurate = false): void {
    if (this.phase !== 'live') return;
    const from = { x: this.qb.x, y: this.qb.y - 3 };
    // Longer throws (and throws under pressure) drift, mostly long or short,
    // but always inside the oval the player sees while aiming.
    let to = { ...aim };
    if (!accurate) {
      const sp = throwSpread(dist(from, aim), this.pressured);
      const along = sp.along * this.movingFactor * this.accFactor, lat = sp.lat * this.movingFactor * this.accFactor;
      const u = unit(from, aim);
      let a = 0, b = 0;
      for (let i = 0; i < 12; i++) { // centre-weighted, truncated to the oval
        a = gauss() * 0.5; b = gauss() * 0.5;
        if (a * a + b * b <= 1) break;
      }
      const n = Math.hypot(a, b);
      if (n > 1) { a /= n; b /= n; }
      to = { x: aim.x + u.x * a * along - u.y * b * lat, y: aim.y + u.y * a * along + u.x * b * lat };
    }
    to.x = clamp(to.x, FIELD_LEFT, FIELD_RIGHT);
    this.ball = { aim, from, to, ...flightFor(from, to), t: 0, carrier: null };
    this.phase = 'air';
    this.airT = 0;
    this.intended = null;
  }

  // ---------- simulation ----------

  update(dtReal: number): void {
    const dt = dtReal * TIME_SCALE * this.speedFactor;
    if (this.phase === 'presnap') { this.updateUser(dt); return; } // you can line up before the snap
    if (this.phase !== 'live' && this.phase !== 'air' && this.phase !== 'run') return;
    this.t += dt;
    if (this.phase === 'run') { this.updateUser(dt); this.updateLead(dt); this.updateRun(dt); return; }
    if (this.phase === 'air') this.airT += dt;

    this.updateQb(dt);
    this.updateReceivers(dt);
    this.updateUser(dt);
    this.releaseScreen();
    this.updateLine(dt);
    this.updateLead(dt);
    this.updateCoverage(dt);
    this.separate();

    if (this.phase === 'live' && this.passRushers.some((r) => dist(r, this.qb) < SACK_DIST)) {
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
    // Once the ball is read, the intended receiver (the one who can get to
    // the spot) runs to it, pacing himself to arrive in stride. That's what
    // makes leading a receiver work.
    if (landing && this.airT >= BALL_READ && !this.intended) this.intended = this.pickIntended(landing);
    const remain = this.ball ? Math.max(0.05, this.ball.dur - this.ball.t) : 1;
    for (const p of this.receivers) {
      const step = p.speed * dt * release;
      const x0 = p.x, y0 = p.y;
      if (landing && p === this.intended) {
        const pace = clamp(dist(p, landing) / remain, p.speed * 0.8, p.speed); // keep running, ease off only a little
        moveToward(p, landing, pace * dt * release);
      } else this.followRoute(p, step);
      if (dt > 0) p.vel = { x: (p.x - x0) / dt, y: (p.y - y0) / dt };
    }
  }

  /** The receiver who can reach the landing spot soonest, if anyone can get there in time. */
  private pickIntended(landing: Vec): Actor | null {
    const remain = Math.max(0.05, this.ball!.dur - this.ball!.t);
    let best: Actor | null = null, bestSlack = Infinity;
    for (const p of this.receivers) {
      const d = dist(p, landing);
      const slack = d / p.speed - remain; // <= 0 means he gets there before the ball
      if ((slack <= 0.2 || d < BALL_HAWK) && slack < bestSlack) { best = p; bestSlack = slack; }
    }
    return best;
  }

  private followRoute(p: Actor, step: number): void {
    if (this.t < p.delay) return; // still selling the block
    if (p.leg < p.path.length) {
      p.dir = unit(p, p.path[p.leg]);
      if (moveToward(p, p.path[p.leg], step)) p.leg++;
    } else if (p.end === 'continue' && p.dir) {
      p.x = clamp(p.x + p.dir.x * step, FIELD_LEFT + 2, FIELD_RIGHT - 2);
      p.y = Math.max(this.endLineY + 2, p.y + p.dir.y * step);
    }
  }

  /** Rollouts: the QB sprints out toward his spot (until he throws). */
  private updateQb(dt: number): void {
    if (!this.qbSpot || this.phase !== 'live') return;
    const ramp = clamp(this.t / 0.5, 0.3, 1);
    moveToward(this.qb, this.qbSpot, this.qb.speed * ramp * dt);
  }

  /** Screens: the chosen linemen let their man go and release downfield. */
  private releaseScreen(): void {
    const sc = this.play.screen;
    if (!sc || this.released || this.t < sc.at) return;
    this.released = true;
    for (const i of sc.release) {
      const b = this.actors.find((x) => x.id === `OL${this.mirror ? 4 - i : i}`);
      if (!b || b.job !== 'block') continue;
      if (b.engaged && b.engaged.engagedBy === b) {
        b.engaged.engagedBy = null;
        b.engaged.burstAt = this.t; // let go: he has to get going again
      }
      b.engaged = null;
      b.assigned = null;
      b.job = 'lead';
      b.leadReadyAt = this.t;
    }
  }

  /**
   * Downfield blocking (screens, stalk blocks, and after the catch): each
   * blocker picks the nearest free defender to the ball, gets between him and
   * the ball, and holds him for a second or two (a held defender barely moves
   * and can't make the play).
   */
  private updateLead(dt: number): void {
    const leads = this.actors.filter((a) => a.job === 'lead');
    if (!leads.length) return;
    const focus = this.carrier ?? this.screenTarget;
    const taken = new Set<Actor>();
    for (const b of leads) if (b.blockTarget) taken.add(b.blockTarget);
    for (const b of leads) {
      const t = b.blockTarget;
      if (t && t.heldBy === b && this.t < t.heldUntil) { // stay on him, between him and the ball
        const u = unit(t, focus ?? b);
        moveToward(b, { x: t.x + u.x * 5, y: t.y + u.y * 5 }, b.speed * 2 * dt);
        continue;
      }
      if (t && t.heldBy === b) t.heldBy = null; // he shed it
      if (t) taken.delete(t);
      b.blockTarget = null;
      if (this.t < b.leadReadyAt) continue;
      const ref = focus ?? b;
      const d = this.defense
        .filter((x) => x.job !== 'rush' && !x.heldBy && !taken.has(x) && dist(x, ref) < 60)
        .sort((p, q) => dist(p, ref) - dist(q, ref))[0];
      if (!d) { if (focus) moveToward(b, { x: focus.x, y: focus.y - 8 }, b.speed * 0.6 * dt); continue; }
      taken.add(d);
      moveToward(b, { x: lerp(d.x, ref.x, 0.3), y: lerp(d.y, ref.y, 0.3) }, b.speed * dt);
      if (dist(b, d) < 6) {
        d.heldBy = b;
        d.heldUntil = this.t + rand(1.2, 2.4) * (b.kind === 'ol' ? 0.8 : 0.35) // receivers' stalk blocks are brief
          * clamp(1 + this.rd(b, 'blk') * 0.012, 0.7, 1.3) / clamp(1 + this.rd(d, 'tkl') * 0.008, 0.8, 1.2);
        b.blockTarget = d;
      }
    }
  }

  /** Is this defender tied up in a downfield block right now? */
  private held(d: Actor): boolean { return !!d.heldBy && this.t < d.heldUntil; }
  /** How much a block slows him: linemen engulf, receivers just get in the way. */
  private holdFactor(d: Actor): number { return !this.held(d) ? 1 : d.heldBy!.kind === 'ol' ? 0.25 : 0.5; }

  /** Your defender goes where the joystick points (unless he's tied up in a block). */
  private updateUser(dt: number): void {
    const u = this.user;
    if (!u || !this.userControl || u.engagedBy || this.t < u.stunUntil) return;
    const m = this.userMove;
    const inTraffic = u.y > LOS_Y - 2 * YD; // no extra burst in the trenches
    const step = u.speed * (inTraffic ? 0.95 : USER_SPEED) * dt;
    u.x = clamp(u.x + m.x * step, FIELD_LEFT + 2, FIELD_RIGHT - 2);
    u.y = Math.max(this.endLineY + 2, u.y + m.y * step);
    if (this.phase === 'presnap') u.y = Math.min(u.y, fy(1)); // stay on your side of the ball
  }

  private updateLine(dt: number): void {
    const qb = this.qb;
    const blockers = this.blockers;
    const rushers = this.passRushers;

    for (const r of rushers) {
      if (this.steering(r) && !r.engagedBy) continue; // you steer yourself; the line can still pick you up
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
        // blockers slide into position in front of him (no snapping)
        const slide = b.speed * 2.5 * dt;
        moveToward(b, { x: r.x + u.x * 6, y: r.y + u.y * 6 }, slide);
        helpers.forEach((h, i) => {
          const ang = (i % 2 ? -1 : 1) * 0.8;
          moveToward(h, {
            x: r.x + (u.x * Math.cos(ang) - u.y * Math.sin(ang)) * 6,
            y: r.y + (u.x * Math.sin(ang) + u.y * Math.cos(ang)) * 6,
          }, slide);
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

    const load = (x: Actor) => blockers.filter((h) => h.engaged === x || h.assigned === x).length;
    for (const b of blockers) {
      // a lineman helping on a double team peels off to pick up a free rusher coming at him
      if (b.engaged && b.engaged.engagedBy !== b) {
        const free = rushers.find((x) => !x.engagedBy && load(x) === 0 && !b.beatenBy.includes(x) && dist(x, b) < 24);
        if (free) { b.engaged = null; b.assigned = free; }
      }
      if (b.engaged) continue; // placed by the rusher above
      let r = b.assigned && !b.beatenBy.includes(b.assigned) ? b.assigned : null;
      if (!r) {
        // help: the nearby rusher with the fewest blockers on him
        r = rushers
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
          const matchup = clamp(1 + this.rd(b, 'blk') * 0.012, 0.7, 1.3) / clamp(1 + this.rd(r, 'rsh') * 0.012, 0.7, 1.3);
          r.shedAt = this.t + t * (b.kind === 'ol' ? 1 : 0.55) * matchup;
        }
      }
    }
  }

  private updateCoverage(dt: number): void {
    const landing = this.landing();
    for (const d of this.defense) {
      if (this.steering(d) || (d.job !== 'man' && d.job !== 'zone')) continue;
      const range = d.kind === 'lb' ? 30 : d.kind === 'dl' ? 24 : d.zone?.deep ? 100 : 45;
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
          const onBack = m.kind === 'rb';
          const read = clamp(1 + this.rd(d, 'cov') * 0.012, 0.7, 1.3) / clamp(1 + this.rd(m, 'rte') * 0.012, 0.7, 1.3);
          const f = Math.min(1, (onBack ? 1.2 : 3) * read * dt); // lower = slower to read cuts (backs are hard to stay with)
          d.read = { x: lerp(d.read.x, m.vel.x, f), y: lerp(d.read.y, m.vel.y, f) };
          const side = (m.x < fx(this.ballX) ? 1 : -1) * d.leverage; // leverage is inside/outside relative to the ball
          // keep his leverage; an off cushion closes as the route develops
          const cush = 0.3 + Math.max(0, d.cushion - 0.3) * Math.max(0, 1 - this.t / 2.2);
          raw = { x: m.x + d.read.x * 0.15 + side * 0.6 * YD, y: m.y + d.read.y * 0.15 - cush * YD };
          if (onBack) raw.y -= 1.5 * YD; // plays the back from depth (protecting against the deep release)
          if (onBack && this.t < d.keyDelay) raw = { x: d.x, y: d.y }; // still reading the back
          k = 10;
        } else {
          raw = this.zoneTarget(d.zone!);
          k = 3.5;
        }
        const f = Math.min(1, k * dt);
        d.goal = { x: lerp(d.goal.x, raw.x, f), y: lerp(d.goal.y, raw.y, f) };
      }
      d.goal.y = Math.max(d.goal.y, this.endLineY + 2); // nobody drops out the back of the end zone
      const driving = landing && this.airT >= d.react && d.zone?.deep; // deep help drives on the ball
      moveToward(d, d.goal, d.speed * dt * (driving ? 1.25 : 1) * this.holdFactor(d));
    }
  }

  private zoneTarget(z: ZoneDef): Vec {
    if (z.spy) return { x: this.qb.x, y: Math.min(this.qb.y - 6 * YD, LOS_Y - 2 * YD) }; // mirror the QB from 6 yards
    const shift = this.ballX * (z.deep || z.wide ? 0.35 : 0.9); // zones slide toward the ball (deep and flat ones less)
    const x0 = fx(z.x - z.wx + shift), x1 = fx(z.x + z.wx + shift);
    const top = fy(z.dmax), bottom = fy(z.dmin);
    const land = { x: fx(z.x + shift), y: fy(z.d) };
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
      if (near) return { x: lerp(land.x, clamp(near.x, x0, x1), 0.75), y: lerp(land.y, clamp(near.y, top, bottom), 0.75) };
      // nothing in my lane either: don't just stand there, lean toward the nearest route anywhere
      const any = this.receivers.reduce<Actor | null>((p, q) => (!p || dist(q, land) < dist(p, land) ? q : p), null);
      if (!any || dist(any, land) > 28 * YD) return land;
      return { x: clamp(lerp(land.x, any.x, 0.4), x0 - 8, x1 + 8), y: clamp(lerp(land.y, any.y, 0.4), top, bottom) };
    }
    const t = z.wide
      ? threats.reduce((p, q) => (Math.abs(q.x - CX) > Math.abs(p.x - CX) ? q : p)) // widest
      : threats.reduce((p, q) => (dist(q, land) < dist(p, land) ? q : p)); // nearest
    // sit in the zone and shade toward the threat, rather than attaching to him
    // (flat defenders widen more gradually: they sink under the curl first)
    const k = z.wide ? 0.35 : 0.45; // hold the spot; lean toward the route
    const shade = { x: lerp(land.x, t.x, k), y: lerp(land.y, t.y - 0.8 * YD, k) };
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
        if ((p.blockTarget === q && q.heldBy === p) || (q.blockTarget === p && p.heldBy === q)) continue; // locked in a block
        // the receiver going for the ball and defenders can both get to it; the catch decides
        if (this.phase === 'air' && (p === this.intended || q === this.intended)) continue;
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
      const defReach = defenderReach(dist(ball.from, ball.to));
      const reachOf = (p: Actor) => p.team === 'off' ? CATCH_RADIUS * clamp(1 + this.rd(p, 'hnd') * 0.006, 0.85, 1.15) : defReach;
      const nearest = (team: Team) => {
        let best: Actor | null = null, bestD = Infinity;
        for (const p of this.actors) {
          if (p.team !== team) continue;
          const eligible = team === 'off' ? p.job === 'route' : (p.user || p.job === 'man' || p.job === 'zone') && !this.held(p);
          const d = dist(p, pos);
          if (eligible && d <= reachOf(p) && d < bestD) { best = p; bestD = d; }
        }
        return { p: best, d: bestD };
      };
      const o = nearest('off'), d = nearest('def');
      let outcome: Result | null = null;
      const roll = Math.random();
      if (o.p && !d.p) outcome = 'catch';
      else if (d.p && !o.p) outcome = roll < 0.12 * clamp(1 + this.rd(d.p, 'bsk') * 0.03, 0.4, 1.8) ? 'int' : 'inc'; // defenders drop plenty
      else if (o.p && d.p) {
        // Contested: the closer the receiver is to the ball than the defender
        // (edge, px), the likelier the catch; the longer the ball hangs, the
        // more time the defender has to play it.
        const edge = d.d - o.d;
        const hang = clamp(1.45 - dist(ball.from, ball.to) / 150, 0.4, 1.2); // quick throws favour the receiver
        const pCatch = clamp(0.55 + edge * 0.06, 0.12, 0.85) * hang + this.catchBias
          + this.rd(o.p, 'hnd') * 0.004 - this.rd(d.p, 'cov') * 0.002;
        const pInt = clamp(0.02 + Math.max(0, -edge) * 0.02, 0.02, 0.12) * clamp(1 + this.rd(d.p, 'bsk') * 0.03, 0.4, 1.8);
        outcome = roll < pCatch ? 'catch' : roll < pCatch + pInt ? 'int' : 'inc';
      }
      if (outcome) this.lastContest = { off: o.p ? o.d : null, def: d.p ? d.d : null, outcome }; // for tuning
      if (outcome === 'catch' && o.p) { this.startRun(o.p); return; }
      // linebackers and linemen have worse hands: half their picks are drops
      if (outcome === 'int' && d.p && d.p.kind !== 'db' && Math.random() < 0.5) outcome = 'inc';
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
    if (Math.hypot(c.vel.x, c.vel.y) < 1) { const d = c.dir ?? { x: 0, y: -1 }; c.vel = { x: d.x * c.speed, y: d.y * c.speed }; }
    if (c.y <= this.goalY) { this.touchdown = true; this.finish('catch', c.y); return; }
    // the line play is over: everyone turns and chases
    for (const a of this.actors) { a.engaged = null; a.engagedBy = null; }
    for (const d2 of this.defense) d2.react = rand(0.12, 0.3) + (d2.job === 'rush' ? 0.2 : 0); // read the catch
    // caught in stride? he keeps most of his speed
    // caught in stride he keeps most of his speed; an over-the-shoulder deep ball costs some
    const moving = Math.hypot(c.vel.x, c.vel.y) > c.speed * 0.5;
    const deepBall = dist(this.ball!.from, this.ball!.to) > 20 * YD;
    this.runStart = moving && !deepBall ? 0.6 : 0.35;
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
    const speed = c.speed * 0.92 * clamp(this.runStart + this.runT / 0.5, 0, 1); // gathers himself after the catch
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
      if (!this.steering(d)) { // (unless you're chasing him yourself)
        if (this.runT < d.react) continue;
        const lead = clamp(dist(d, c) / d.speed, 0, 0.8);
        const aim = { x: c.x + c.vel.x * lead, y: c.y + c.vel.y * lead };
        const blocked = this.receivers.some((r) => r !== c && dist(r, d) < SCREEN_DIST);
        moveToward(d, aim, d.speed * dt * (this.held(d) ? this.holdFactor(d) : blocked ? 0.55 : 1));
      }
      if (this.held(d)) continue; // blocked: can't make the tackle
      if (dist(d, c) < TACKLE_DIST) {
        const brk = (BREAK_CHANCE[c.kind] ?? 0.15) * clamp(1 + this.rd(c, 'elu') * 0.025, 0.5, 1.6) * clamp(1 - this.rd(d, 'tkl') * 0.02, 0.5, 1.5);
        if (Math.random() < brk) {
          d.stunUntil = this.t + STUN_TIME; // broken tackle!
        } else {
          this.finish('catch', Math.max(c.y - FALL_FORWARD * YD, this.goalY + 1)); // falls forward
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
