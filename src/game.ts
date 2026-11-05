// Ties everything together: input, aiming, the playbook menu, and drawing.
import {
  C, ENDZONE_BOTTOM, FIELD_LEFT, FIELD_RIGHT, H, LOS_Y, MAX_THROW, PULL_POWER, RESULT_TIME, W, YD,
} from './config';
import { rushLabel } from './defense/calls';
import { drawText } from './font';
import { Menu } from './menu';
import { PLAYS, type Play } from './playbook/plays';
import { type Actor, Sim, arcHeight, flightFor } from './sim';
import { drawCentered, sprites } from './sprites';
import { type Vec, clamp, dist } from './util';

export type AimMode = 'pull' | 'aim';
type Rect = { x: number; y: number; w: number; h: number };
const hit = (r: Rect, p: Vec) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

const RESULT_TEXT = {
  catch: ['CATCH!', C.green], int: ['INTERCEPTED!', C.red], inc: ['INCOMPLETE', C.grey], sack: ['SACK!', C.orange],
} as const;

export class Game {
  sim = new Sim();
  play: Play = PLAYS[0];
  menu = new Menu(this.play.id);
  menuOpen = true; // start on the playbook
  mode: AimMode = 'pull';
  clock = 0;
  doneAt = 0;
  paused = false; // tests step the sim by hand
  drag: { start: Vec; cur: Vec } | null = null;

  readonly playsButton: Rect = { x: 4, y: H - 16, w: 40, h: 12 };
  readonly modeButton: Rect = { x: W - 62, y: H - 16, w: 58, h: 12 };
  private field = drawField();

  constructor() { this.sim.reset(this.play); }

  pickPlay(play: Play): void {
    this.play = play;
    this.menu.selectedId = play.id;
    this.menuOpen = false;
    this.sim.reset(play);
  }

  // ---------- input ----------

  /** Where the ball would land for the current drag, or null if the drag is too small. */
  target(): Vec | null {
    if (!this.drag) return null;
    const { start, cur } = this.drag;
    const qb = this.sim.qb;
    let t: Vec;
    if (this.mode === 'pull') {
      const dx = start.x - cur.x, dy = start.y - cur.y;
      if (Math.hypot(dx, dy) < 5) return null;
      t = { x: qb.x + dx * PULL_POWER, y: qb.y + dy * PULL_POWER };
    } else {
      t = { ...cur };
      if (dist(t, qb) < 12) return null;
    }
    const d = dist(t, qb);
    if (d > MAX_THROW) {
      t.x = qb.x + ((t.x - qb.x) / d) * MAX_THROW;
      t.y = qb.y + ((t.y - qb.y) / d) * MAX_THROW;
    }
    t.x = clamp(t.x, FIELD_LEFT, FIELD_RIGHT);
    t.y = clamp(t.y, 4, H - 4);
    return t;
  }

  pointerDown(p: Vec): void {
    if (this.menuOpen) {
      const a = this.menu.tap(p);
      if (a?.type === 'pick') this.pickPlay(a.play);
      else if (a?.type === 'close') this.menuOpen = false;
      return;
    }
    const phase = this.sim.phase;
    if (hit(this.modeButton, p)) { this.mode = this.mode === 'pull' ? 'aim' : 'pull'; return; }
    if (hit(this.playsButton, p)) {
      if (phase !== 'live' && phase !== 'air') { this.menuOpen = true; this.menu = new Menu(this.play.id); }
      return;
    }
    if (phase === 'presnap') this.sim.snap();
    else if (phase === 'done') this.sim.reset(this.play);
    else if (phase === 'live') this.drag = { start: p, cur: p };
  }

  pointerMove(p: Vec): void {
    if (this.drag) this.drag.cur = p;
  }

  pointerUp(p: Vec): void {
    if (!this.drag) return;
    this.drag.cur = p;
    const to = this.target();
    this.drag = null;
    if (to) this.sim.throwTo(to);
  }

  // ---------- loop ----------

  update(dt: number): void {
    this.clock += dt;
    if (this.menuOpen || this.paused) return;
    const wasDone = this.sim.phase === 'done';
    this.sim.update(dt);
    if (this.sim.phase !== 'live') this.drag = null; // sacked mid-drag
    if (!wasDone && this.sim.phase === 'done') this.doneAt = this.clock;
    if (this.sim.phase === 'done' && this.clock - this.doneAt > RESULT_TIME) this.sim.reset(this.play);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    ctx.drawImage(this.field, 0, 0);
    this.renderRoutes(ctx);

    const spr = sprites();
    for (const p of [...sim.actors].sort((a, b) => a.y - b.y)) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(Math.round(p.x - 3), Math.round(p.y + 3), 7, 1);
      drawCentered(ctx, spriteFor(p, spr), p.x, p.y);
    }

    this.renderAim(ctx);
    this.renderBall(ctx);
    this.renderHud(ctx);
    if (this.menuOpen) this.menu.render(ctx, this.clock);
  }

  /** Faint route lines: strong before the snap, a light reminder after. */
  private renderRoutes(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    if (sim.phase === 'done') return;
    ctx.globalAlpha = sim.phase === 'presnap' ? 0.55 : 0.18;
    for (const r of sim.receivers) {
      ctx.fillStyle = r.color;
      let prev: Vec = r; // draw from where he is now to the rest of the route
      const pts = r.path.slice(r.leg);
      for (const q of pts) {
        const n = Math.max(1, Math.floor(dist(prev, q) / 3));
        for (let i = 0; i <= n; i++) {
          ctx.fillRect(Math.round(prev.x + ((q.x - prev.x) * i) / n), Math.round(prev.y + ((q.y - prev.y) * i) / n), 1, 1);
        }
        prev = q;
      }
      if (r.end === 'continue' && r.path.length) {
        const a = r.path.length > 1 ? r.path[r.path.length - 2] : r;
        const b = r.path[r.path.length - 1];
        const d = dist(a, b) || 1;
        ctx.fillRect(Math.round(b.x + ((b.x - a.x) / d) * 4), Math.round(b.y + ((b.y - a.y) / d) * 4), 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  private renderAim(ctx: CanvasRenderingContext2D): void {
    const to = this.target();
    if (!to || !this.drag) return;
    if (this.mode === 'pull') {
      const { start, cur } = this.drag;
      const n = Math.max(1, Math.floor(dist(start, cur) / 3));
      ctx.fillStyle = 'rgba(255,241,232,0.35)';
      for (let i = 0; i <= n; i++) {
        ctx.fillRect(Math.round(start.x + ((cur.x - start.x) * i) / n), Math.round(start.y + ((cur.y - start.y) * i) / n), 1, 1);
      }
    }
    const qb = this.sim.qb;
    const from = { x: qb.x, y: qb.y - 3 };
    const { peak } = flightFor(from, to);
    const steps = Math.max(6, Math.floor(dist(from, to) / 6));
    const march = (this.clock * 2) % 1;
    for (let i = 0; i < steps; i++) {
      const s = (i + march) / steps;
      const gx = from.x + (to.x - from.x) * s, gy = from.y + (to.y - from.y) * s;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(Math.round(gx), Math.round(gy), 1, 1);
      ctx.fillStyle = C.white;
      ctx.fillRect(Math.round(gx), Math.round(gy - arcHeight(peak, s)), 2, 2);
    }
    const x = Math.round(to.x), y = Math.round(to.y);
    ctx.fillStyle = C.yellow;
    ctx.fillRect(x - 4, y, 3, 1); ctx.fillRect(x + 2, y, 3, 1);
    ctx.fillRect(x, y - 4, 1, 3); ctx.fillRect(x, y + 2, 1, 3);
  }

  private renderBall(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    if (!sim.ball) return;
    const g = sim.ballGround();
    const h = sim.ballHeight();
    if (!sim.ball.carrier) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(Math.round(g.x - 1), Math.round(g.y), 3, 1);
    }
    drawCentered(ctx, sprites().ball, g.x, g.y - h - (sim.ball.carrier ? 1 : 0));
  }

  private renderHud(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    const { cmp, int, inc, sack } = sim.stats;
    drawText(ctx, `CMP ${cmp} INT ${int} INC ${inc} SCK ${sack}`, W / 2, 3, { align: 'center', shadow: '#000' });

    const live = sim.phase === 'live' || sim.phase === 'air';
    button(ctx, this.playsButton, 'PLAYS', live ? C.darkGrey : C.white);
    button(ctx, this.modeButton, `MODE ${this.mode.toUpperCase()}`, C.white);
    drawText(ctx, this.play.name, (this.playsButton.x + this.playsButton.w + this.modeButton.x) / 2, H - 12,
      { align: 'center', color: C.yellow, shadow: '#000' });

    if (sim.phase === 'presnap' && !this.menuOpen && Math.floor(this.clock * 2.5) % 2 === 0) {
      drawText(ctx, 'TAP TO SNAP', W / 2, LOS_Y + 34, { scale: 1, align: 'center', color: C.white, shadow: '#000' });
    }

    if (sim.phase === 'done' && sim.result) {
      const [text, color] = RESULT_TEXT[sim.result];
      const y = 120;
      ctx.fillStyle = 'rgba(17,29,43,0.85)';
      ctx.fillRect(14, y - 6, W - 28, 40);
      drawText(ctx, text, W / 2, y, { scale: 2, color, shadow: '#000', align: 'center' });
      drawText(ctx, sim.call.coverage, W / 2, y + 16, { align: 'center', color: C.white });
      drawText(ctx, rushLabel(sim.call), W / 2, y + 24, { align: 'center', color: C.grey });
    }
  }
}

function spriteFor(p: Actor, spr: ReturnType<typeof sprites>): HTMLCanvasElement {
  if (p.kind === 'qb') return spr.qb;
  if (p.team === 'off') return p.kind === 'ol' ? spr.offBig : spr.off;
  return p.kind === 'dl' ? spr.defBig : spr.def;
}

function button(ctx: CanvasRenderingContext2D, b: Rect, label: string, color: string): void {
  ctx.fillStyle = 'rgba(17,29,43,0.8)';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = color;
  ctx.fillRect(b.x, b.y, b.w, 1); ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
  ctx.fillRect(b.x, b.y, 1, b.h); ctx.fillRect(b.x + b.w - 1, b.y, 1, b.h);
  drawText(ctx, label, b.x + b.w / 2, b.y + 4, { align: 'center', color });
}

function drawField(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0a5c36';
  ctx.fillRect(0, 0, W, H);

  // 5-yard stripes measured from the line of scrimmage
  const five = 5 * YD;
  for (let i = -3; i * five + ENDZONE_BOTTOM < H; i++) {
    const y0 = Math.round(LOS_Y - Math.round((LOS_Y - ENDZONE_BOTTOM) / five) * five + i * five);
    const y1 = Math.round(y0 + five);
    if (y1 <= ENDZONE_BOTTOM) continue;
    ctx.fillStyle = i % 2 ? '#00873f' : '#00954a';
    ctx.fillRect(FIELD_LEFT, Math.max(y0, ENDZONE_BOTTOM), FIELD_RIGHT - FIELD_LEFT, y1 - Math.max(y0, ENDZONE_BOTTOM));
    ctx.fillStyle = C.white;
    if (y0 >= ENDZONE_BOTTOM) ctx.fillRect(FIELD_LEFT, y0, FIELD_RIGHT - FIELD_LEFT, 1);
  }
  ctx.fillStyle = C.navy;
  ctx.fillRect(FIELD_LEFT, 0, FIELD_RIGHT - FIELD_LEFT, ENDZONE_BOTTOM);
  drawText(ctx, 'END ZONE', W / 2, 11, { scale: 2, color: C.blue, align: 'center' });

  ctx.fillStyle = C.white;
  ctx.fillRect(FIELD_LEFT - 1, 0, 1, H);
  ctx.fillRect(FIELD_RIGHT, 0, 1, H);
  ctx.fillRect(FIELD_LEFT, ENDZONE_BOTTOM, FIELD_RIGHT - FIELD_LEFT, 1);
  for (let y = ENDZONE_BOTTOM + YD; y < H; y += YD) {
    ctx.fillRect(66, Math.round(y), 2, 1);
    ctx.fillRect(112, Math.round(y), 2, 1);
  }
  ctx.fillStyle = C.blue;
  ctx.fillRect(FIELD_LEFT, LOS_Y, FIELD_RIGHT - FIELD_LEFT, 1);
  return c;
}
