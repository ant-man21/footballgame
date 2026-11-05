import { ENDZONE_BOTTOM, FIELD_LEFT, FIELD_RIGHT, H, LOS_Y, MAX_THROW, PULL_POWER, QB_POS, W } from './config';
import { drawText } from './font';
import { drawCentered, sprites } from './sprites';

export type Vec = { x: number; y: number };
type Team = 'off' | 'def';
type Role = 'qb' | 'wr' | 'ol' | 'dl' | 'cb' | 's';
type Phase = 'presnap' | 'live' | 'air' | 'done';
export type AimMode = 'pull' | 'aim';

export interface Player {
  id: string;
  team: Team;
  role: Role;
  x: number;
  y: number;
  start: Vec;
  route: Vec[]; // waypoints, run in order after the snap
  leg: number; // index of the waypoint currently being run to
  speed: number; // pixels per second
  mark?: Player; // defender's man in coverage
  eligible: boolean; // can catch / intercept
}

interface Ball {
  from: Vec;
  to: Vec;
  peak: number; // max height in pixels
  dur: number; // flight time in seconds
  t: number;
  carrier: Player | null;
}

const PRESNAP_TIME = 0.8;
const RESULT_TIME = 1.6;
const CATCH_WINDOW = 0.78; // ball is catchable in the last part of its flight
const CATCH_HEIGHT = 12; // ...and only when it's this low
const CATCH_RADIUS: Record<Team, number> = { off: 7, def: 6 };

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function moveToward(p: Vec, target: Vec, maxStep: number): boolean {
  const d = dist(p, target);
  if (d <= maxStep) { p.x = target.x; p.y = target.y; return true; }
  p.x += ((target.x - p.x) / d) * maxStep;
  p.y += ((target.y - p.y) / d) * maxStep;
  return false;
}

/** Height of the ball above the ground at flight progress s (0..1). */
export function arcHeight(peak: number, s: number): number {
  return 4 * peak * s * (1 - s);
}

export function flightFor(from: Vec, to: Vec): { dur: number; peak: number } {
  const d = dist(from, to);
  return { dur: 0.35 + d / 250, peak: clamp(d * 0.28, 5, 56) };
}

export class Game {
  players: Player[] = [];
  phase: Phase = 'presnap';
  phaseT = 0;
  clock = 0;
  ball: Ball | null = null;
  mode: AimMode = 'pull';
  stats = { cmp: 0, int: 0, inc: 0 };
  message = '';
  messageColor = '#fff1e8';

  // Current drag gesture, in logical pixels.
  drag: { start: Vec; cur: Vec } | null = null;

  private field: HTMLCanvasElement;
  readonly modeButton = { x: W - 62, y: H - 16, w: 58, h: 12 };

  constructor() {
    this.field = drawField();
    this.reset();
  }

  get qb(): Player { return this.players.find((p) => p.role === 'qb')!; }

  reset(): void {
    const ps: Player[] = [];
    const add = (id: string, team: Team, role: Role, x: number, y: number, route: Vec[] = [], speed = 0) => {
      const p: Player = { id, team, role, x, y, start: { x, y }, route, leg: 0, speed, eligible: role === 'wr' || role === 'cb' || role === 's' };
      ps.push(p);
      return p;
    };
    add('qb', 'off', 'qb', QB_POS.x, QB_POS.y);
    for (const x of [76, 90, 104]) add(`ol${x}`, 'off', 'ol', x, LOS_Y + 6);
    for (const x of [83, 97]) add(`dl${x}`, 'def', 'dl', x, LOS_Y - 6);

    // Three receivers, each with a simple route.
    const wr1 = add('wr1', 'off', 'wr', 24, LOS_Y, [{ x: 24, y: 40 }], 46); // go
    const wr2 = add('wr2', 'off', 'wr', 120, LOS_Y + 2, [{ x: 120, y: 196 }, { x: 72, y: 120 }], 42); // post
    const wr3 = add('wr3', 'off', 'wr', 156, LOS_Y, [{ x: 156, y: 172 }, { x: 146, y: 186 }], 44); // curl

    for (const wr of [wr1, wr2, wr3]) {
      const cb = add(`cb-${wr.id}`, 'def', 'cb', wr.x, LOS_Y - 30, [], 36);
      cb.mark = wr;
    }
    add('s', 'def', 's', 90, 110, [], 34);

    this.players = ps;
    this.ball = null;
    this.drag = null;
    this.setPhase('presnap');
    this.flash('READY', '#fff1e8');
  }

  private setPhase(p: Phase): void { this.phase = p; this.phaseT = 0; }
  private flash(text: string, color: string): void { this.message = text; this.messageColor = color; }

  // ---------- input ----------

  /** Where the ball would land for the current drag, or null if the drag is too small. */
  target(): Vec | null {
    if (!this.drag) return null;
    const { start, cur } = this.drag;
    const from = this.qb;
    let t: Vec;
    if (this.mode === 'pull') {
      const dx = start.x - cur.x;
      const dy = start.y - cur.y;
      if (Math.hypot(dx, dy) < 5) return null;
      t = { x: from.x + dx * PULL_POWER, y: from.y + dy * PULL_POWER };
    } else {
      t = { ...cur };
      if (dist(t, from) < 12) return null;
    }
    // Clamp to max distance and the field.
    const d = dist(t, from);
    if (d > MAX_THROW) {
      t.x = from.x + ((t.x - from.x) / d) * MAX_THROW;
      t.y = from.y + ((t.y - from.y) / d) * MAX_THROW;
    }
    t.x = clamp(t.x, FIELD_LEFT, FIELD_RIGHT);
    t.y = clamp(t.y, 4, H - 4);
    return t;
  }

  pointerDown(p: Vec): void {
    const b = this.modeButton;
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
      this.mode = this.mode === 'pull' ? 'aim' : 'pull';
      return;
    }
    if (this.phase === 'live') this.drag = { start: p, cur: p };
  }

  pointerMove(p: Vec): void {
    if (this.drag) this.drag.cur = p;
  }

  pointerUp(p: Vec): void {
    if (!this.drag) return;
    this.drag.cur = p;
    const to = this.target();
    this.drag = null;
    if (to && this.phase === 'live') this.throwTo(to);
  }

  throwTo(to: Vec): void {
    const from = { x: this.qb.x, y: this.qb.y - 3 };
    this.ball = { from, to, ...flightFor(from, to), t: 0, carrier: null };
    this.setPhase('air');
    this.message = '';
  }

  // ---------- simulation ----------

  update(dt: number): void {
    this.clock += dt;
    this.phaseT += dt;

    if (this.phase === 'presnap') {
      if (this.phaseT >= PRESNAP_TIME) { this.setPhase('live'); this.flash('HUT!', '#ffec27'); }
      return;
    }
    if (this.phase === 'live' && this.phaseT > 0.5 && this.message === 'HUT!') this.message = '';

    if (this.phase === 'done') {
      if (this.phaseT >= RESULT_TIME) this.reset();
      return;
    }

    const ball = this.ball;
    const landing = ball && !ball.carrier ? ball.to : null;

    for (const p of this.players) {
      const step = p.speed * dt;
      if (p.role === 'wr') {
        // Receivers near the landing spot come back to the ball.
        if (landing && dist(p, landing) < 26) moveToward(p, landing, step);
        else if (p.leg < p.route.length && moveToward(p, p.route[p.leg], step)) p.leg++;
      } else if (p.role === 'cb' && p.mark) {
        if (landing && dist(p, landing) < 44) moveToward(p, landing, step * 1.1);
        else moveToward(p, { x: p.mark.x, y: p.mark.y - 9 }, step); // trail with a cushion
      } else if (p.role === 's') {
        if (landing && dist(p, landing) < 90) moveToward(p, landing, step * 1.15);
        else {
          const wrs = this.players.filter((q) => q.role === 'wr');
          const deepest = wrs.reduce((a, b) => (a.y < b.y ? a : b));
          moveToward(p, { x: (deepest.x + 90) / 2, y: Math.min(110, deepest.y - 24) }, step);
        }
      }
      p.x = clamp(p.x, FIELD_LEFT, FIELD_RIGHT);
    }

    if (this.phase === 'air' && ball) this.updateBall(ball, dt);
  }

  private updateBall(ball: Ball, dt: number): void {
    ball.t += dt;
    const s = Math.min(1, ball.t / ball.dur);
    const pos = this.ballGround();
    const h = arcHeight(ball.peak, s);

    if (s >= CATCH_WINDOW && h <= CATCH_HEIGHT) {
      let best: Player | null = null;
      let bestD = Infinity;
      for (const p of this.players) {
        if (!p.eligible) continue;
        const d = dist(p, pos);
        if (d <= CATCH_RADIUS[p.team] && d < bestD) { best = p; bestD = d; }
      }
      if (best) {
        ball.carrier = best;
        if (best.team === 'off') { this.stats.cmp++; this.flash('CATCH!', '#00e436'); }
        else { this.stats.int++; this.flash('INTERCEPTED!', '#ff004d'); }
        this.setPhase('done');
        return;
      }
    }
    if (s >= 1) {
      this.stats.inc++;
      this.flash('INCOMPLETE', '#c2c3c7');
      this.setPhase('done');
    }
  }

  ballGround(): Vec {
    const b = this.ball!;
    if (b.carrier) return { x: b.carrier.x, y: b.carrier.y };
    const s = Math.min(1, b.t / b.dur);
    return { x: b.from.x + (b.to.x - b.from.x) * s, y: b.from.y + (b.to.y - b.from.y) * s };
  }

  // ---------- rendering ----------

  render(ctx: CanvasRenderingContext2D): void {
    const spr = sprites();
    ctx.drawImage(this.field, 0, 0);

    const sorted = [...this.players].sort((a, b) => a.y - b.y);
    for (const p of sorted) {
      // little drop shadow under each player
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(Math.round(p.x - 3), Math.round(p.y + 3), 7, 1);
      drawCentered(ctx, p.role === 'qb' ? spr.qb : p.team === 'off' ? spr.off : spr.def, p.x, p.y);
    }

    this.renderAim(ctx);
    this.renderBall(ctx);
    this.renderHud(ctx);
  }

  private renderAim(ctx: CanvasRenderingContext2D): void {
    const to = this.target();
    if (!to || !this.drag) return;

    if (this.mode === 'pull') {
      // faint "rubber band" showing the pull
      const { start, cur } = this.drag;
      const n = Math.max(1, Math.floor(dist(start, cur) / 3));
      ctx.fillStyle = 'rgba(255,241,232,0.35)';
      for (let i = 0; i <= n; i++) {
        const s = i / n;
        ctx.fillRect(Math.round(start.x + (cur.x - start.x) * s), Math.round(start.y + (cur.y - start.y) * s), 1, 1);
      }
    }

    const from = { x: this.qb.x, y: this.qb.y - 3 };
    const { peak } = flightFor(from, to);
    const steps = Math.max(6, Math.floor(dist(from, to) / 6));
    const march = (this.clock * 2) % 1; // dots march toward the target
    for (let i = 0; i < steps; i++) {
      const s = (i + march) / steps;
      const gx = from.x + (to.x - from.x) * s;
      const gy = from.y + (to.y - from.y) * s;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(Math.round(gx), Math.round(gy), 1, 1); // ground track
      ctx.fillStyle = '#fff1e8';
      ctx.fillRect(Math.round(gx), Math.round(gy - arcHeight(peak, s)), 2, 2); // arc
    }

    // landing reticle
    const x = Math.round(to.x), y = Math.round(to.y);
    ctx.fillStyle = '#ffec27';
    ctx.fillRect(x - 4, y, 3, 1); ctx.fillRect(x + 2, y, 3, 1);
    ctx.fillRect(x, y - 4, 1, 3); ctx.fillRect(x, y + 2, 1, 3);
  }

  private renderBall(ctx: CanvasRenderingContext2D): void {
    const b = this.ball;
    if (!b) return;
    const g = this.ballGround();
    const s = Math.min(1, b.t / b.dur);
    const h = b.carrier ? 0 : arcHeight(b.peak, s);
    if (!b.carrier) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(Math.round(g.x - 1), Math.round(g.y), 3, 1);
    }
    drawCentered(ctx, sprites().ball, g.x, g.y - h - (b.carrier ? 1 : 0));
  }

  private renderHud(ctx: CanvasRenderingContext2D): void {
    const { cmp, int, inc } = this.stats;
    drawText(ctx, `CMP ${cmp}  INT ${int}  INC ${inc}`, W / 2, 3, { align: 'center', shadow: '#000' });

    const b = this.modeButton;
    ctx.fillStyle = 'rgba(17,29,43,0.75)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#fff1e8';
    ctx.fillRect(b.x, b.y, b.w, 1); ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
    ctx.fillRect(b.x, b.y, 1, b.h); ctx.fillRect(b.x + b.w - 1, b.y, 1, b.h);
    drawText(ctx, `MODE ${this.mode.toUpperCase()}`, b.x + b.w / 2, b.y + 4, { align: 'center' });

    if (this.message) {
      drawText(ctx, this.message, W / 2, 150, { scale: 2, color: this.messageColor, shadow: '#000', align: 'center' });
    }
  }
}

function drawField(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0a5c36';
  ctx.fillRect(0, 0, W, H);

  // mowing stripes, 16px = 5 yards
  for (let y = ENDZONE_BOTTOM; y < H; y += 16) {
    ctx.fillStyle = ((y - ENDZONE_BOTTOM) / 16) % 2 ? '#00873f' : '#00954a';
    ctx.fillRect(FIELD_LEFT, y, FIELD_RIGHT - FIELD_LEFT, 16);
  }
  // end zone
  ctx.fillStyle = '#1d2b53';
  ctx.fillRect(FIELD_LEFT, 0, FIELD_RIGHT - FIELD_LEFT, ENDZONE_BOTTOM);
  drawText(ctx, 'END ZONE', W / 2, 12, { scale: 2, color: '#29adff', align: 'center' });

  ctx.fillStyle = '#fff1e8';
  // sidelines
  ctx.fillRect(FIELD_LEFT - 1, 0, 1, H);
  ctx.fillRect(FIELD_RIGHT, 0, 1, H);
  // yard lines + hashes
  for (let y = ENDZONE_BOTTOM; y < H; y += 16) ctx.fillRect(FIELD_LEFT, y, FIELD_RIGHT - FIELD_LEFT, 1);
  for (let y = ENDZONE_BOTTOM + 3; y < H; y += 3.2) {
    ctx.fillRect(66, Math.round(y), 2, 1);
    ctx.fillRect(112, Math.round(y), 2, 1);
  }
  // line of scrimmage
  ctx.fillStyle = '#29adff';
  ctx.fillRect(FIELD_LEFT, LOS_Y, FIELD_RIGHT - FIELD_LEFT, 1);
  return c;
}
