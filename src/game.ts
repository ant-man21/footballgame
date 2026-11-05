// Ties everything together: input, aiming, the playbook menu, the drive, and drawing.
import {
  C, CAM_ANCHOR, FIELD_LEFT, FIELD_RIGHT, H, LOS_Y, MAX_THROW, PULL_POWER, RESULT_TIME, W, YD,
} from './config';
import { rushLabel } from './defense/calls';
import { Drive, type PlaySummary } from './drive';
import { drawText, textWidth } from './font';
import { Menu } from './menu';
import { PLAYS, type Play } from './playbook/plays';
import { type Actor, Sim, arcHeight, flightFor, throwError } from './sim';
import { drawCentered, sprites } from './sprites';
import { type Vec, clamp, dist, lerp } from './util';

export type AimMode = 'pull' | 'aim';
const SNAP_CATCH = 0.3; // sim seconds for the QB to catch the shotgun snap
type Rect = { x: number; y: number; w: number; h: number };
const hit = (r: Rect, p: Vec) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

export class Game {
  sim = new Sim();
  drive = new Drive();
  play: Play = PLAYS[0];
  menu = new Menu(this.play.id);
  menuOpen = true; // start on the playbook
  mode: AimMode = 'pull';
  clock = 0;
  doneAt = 0;
  paused = false; // tests step the sim by hand
  drag: { start: Vec; cur: Vec } | null = null;
  private queuedThrow: Vec | null = null; // released before the QB had the snap
  summary: PlaySummary | null = null;
  camY = 0; // how far the view has scrolled upfield to follow a runner

  // Field state captured at the snap, so the field doesn't jump while the
  // result banner is up.
  private fieldBallOn = this.drive.ballOn;
  private lineToGain = this.drive.ballOn + this.drive.toGo;

  readonly playsButton: Rect = { x: 4, y: H - 16, w: 40, h: 12 };
  readonly modeButton: Rect = { x: W - 62, y: H - 16, w: 58, h: 12 };

  constructor() { this.nextPlay(); }

  nextPlay(): void {
    this.summary = null;
    this.queuedThrow = null;
    this.camY = 0;
    this.fieldBallOn = this.drive.ballOn;
    this.lineToGain = this.drive.ballOn + this.drive.toGo;
    this.sim.reset(this.play, this.drive.goalY);
  }

  pickPlay(play: Play): void {
    this.play = play;
    this.menu.selectedId = play.id;
    this.menuOpen = false;
    if (this.sim.phase === 'presnap' || this.sim.phase === 'done') this.nextPlay();
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
      t = { x: cur.x, y: cur.y - this.camY };
      if (dist(t, qb) < 12) return null;
    }
    const d = dist(t, qb);
    if (d > MAX_THROW) {
      t.x = qb.x + ((t.x - qb.x) / d) * MAX_THROW;
      t.y = qb.y + ((t.y - qb.y) / d) * MAX_THROW;
    }
    t.x = clamp(t.x, FIELD_LEFT, FIELD_RIGHT);
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
      if (phase === 'presnap' || phase === 'done') { this.menuOpen = true; this.menu = new Menu(this.play.id); }
      return;
    }
    if (phase === 'done') { this.nextPlay(); return; }
    // One touch does it all: the touch snaps the ball and starts the aim.
    if (phase === 'presnap') this.sim.snap();
    if (this.sim.phase === 'live') this.drag = { start: p, cur: p };
  }

  pointerMove(p: Vec): void {
    if (this.drag) this.drag.cur = p;
  }

  pointerUp(p: Vec): void {
    if (!this.drag) return;
    this.drag.cur = p;
    const to = this.target();
    this.drag = null;
    if (!to) return;
    if (this.sim.t < SNAP_CATCH) this.queuedThrow = to; // goes out as soon as he has the ball
    else this.sim.throwTo(to);
  }

  // ---------- loop ----------

  update(dt: number): void {
    this.clock += dt;
    if (this.menuOpen || this.paused) return;
    const wasDone = this.sim.phase === 'done';
    this.sim.update(dt);
    if (this.queuedThrow && this.sim.t >= SNAP_CATCH) { this.sim.throwTo(this.queuedThrow); this.queuedThrow = null; }
    if (this.sim.phase !== 'live') { this.drag = null; this.queuedThrow = null; } // sacked mid-drag
    if (!wasDone && this.sim.phase === 'done') {
      this.doneAt = this.clock;
      this.summary = this.drive.apply(this.sim);
    }
    if (this.sim.phase === 'done' && this.clock - this.doneAt > RESULT_TIME) this.nextPlay();

    // camera follows the runner upfield
    const c = this.sim.carrier;
    if (c) this.camY = lerp(this.camY, Math.max(0, CAM_ANCHOR - c.y), Math.min(1, dt * 6));
  }

  render(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    const cam = Math.round(this.camY);
    drawField(ctx, this.fieldBallOn, this.lineToGain, cam);

    ctx.save();
    ctx.translate(0, cam);
    this.renderRoutes(ctx);
    const spr = sprites();
    for (const p of [...sim.actors].sort((a, b) => a.y - b.y)) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(Math.round(p.x - 3), Math.round(p.y + 3), 7, 1);
      drawCentered(ctx, spriteFor(p, spr), p.x, p.y);
    }
    this.renderAim(ctx);
    this.renderBall(ctx);
    ctx.restore();

    this.renderHud(ctx);
    if (this.menuOpen) this.menu.render(ctx);
  }

  /** Faint route lines: strong before the snap, a light reminder after. */
  private renderRoutes(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    if (sim.phase === 'done' || sim.phase === 'run') return;
    ctx.globalAlpha = sim.phase === 'presnap' ? 0.55 : 0.18;
    for (const r of sim.receivers) {
      ctx.fillStyle = r.color;
      let prev: Vec = r; // from where he is now through the rest of the route
      for (const q of r.path.slice(r.leg)) {
        const n = Math.max(1, Math.floor(dist(prev, q) / 3));
        for (let i = 0; i <= n; i++) {
          ctx.fillRect(Math.round(prev.x + ((q.x - prev.x) * i) / n), Math.round(prev.y + ((q.y - prev.y) * i) / n), 1, 1);
        }
        prev = q;
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
    // reticle; it opens up on long throws and under pressure (less accurate)
    const spread = 2 + Math.round(throwError(dist(from, to)) * (this.sim.pressured ? 2 : 1));
    const x = Math.round(to.x), y = Math.round(to.y);
    ctx.fillStyle = this.sim.pressured ? C.orange : C.yellow;
    ctx.fillRect(x - spread - 2, y, 3, 1); ctx.fillRect(x + spread, y, 3, 1);
    ctx.fillRect(x, y - spread - 2, 1, 3); ctx.fillRect(x, y + spread, 1, 3);
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
    drawCentered(ctx, sprites().ball, g.x + (sim.ball.carrier ? 3 : 0), g.y - h - (sim.ball.carrier ? 1 : 0));
  }

  private renderHud(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    const dr = this.drive;
    const st = dr.stats;

    // scoreboard strip
    ctx.fillStyle = 'rgba(17,29,43,0.88)';
    ctx.fillRect(0, 0, W, 19);
    const showDown = sim.phase !== 'done'; // during the banner the drive has already moved on
    if (showDown) {
      drawText(ctx, dr.downText, 5, 3, { color: C.yellow });
      drawText(ctx, dr.spotText, W - 5, 3, { align: 'right' });
    }
    const ypp = dr.yardsPerPlay.toFixed(1);
    const ppt = st.tds ? dr.playsPerTd.toFixed(1) : '-';
    drawText(ctx, `TD ${st.tds}  YDS/PLAY ${ypp}  PLAYS/TD ${ppt}`, W / 2, 11, { align: 'center', color: C.grey });

    const live = sim.phase === 'live' || sim.phase === 'air' || sim.phase === 'run';
    button(ctx, this.playsButton, 'PLAYS', live ? C.darkGrey : C.white);
    button(ctx, this.modeButton, `MODE ${this.mode.toUpperCase()}`, C.white);
    drawText(ctx, this.play.name, (this.playsButton.x + this.playsButton.w + this.modeButton.x) / 2, H - 12,
      { align: 'center', color: C.yellow, shadow: '#000' });

    if (sim.phase === 'presnap' && !this.menuOpen && Math.floor(this.clock * 2.5) % 2 === 0) {
      drawText(ctx, 'TOUCH TO SNAP + THROW', W / 2, LOS_Y + 40, { align: 'center', color: C.white, shadow: '#000' });
    }

    const s = this.summary;
    if (sim.phase === 'done' && s) {
      const y = 96;
      ctx.fillStyle = 'rgba(17,29,43,0.88)';
      ctx.fillRect(10, y - 6, W - 20, 48);
      drawText(ctx, s.headline, W / 2, y, { scale: 2, color: s.color, shadow: '#000', align: 'center' });
      drawText(ctx, s.detail, W / 2, y + 16, { align: 'center', color: C.white });
      drawText(ctx, `${sim.call.coverage} - ${rushLabel(sim.call)}`, W / 2, y + 28, { align: 'center', color: C.grey });
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

/**
 * Draws the visible part of a real 100-yard field. ballOn is the line of
 * scrimmage (yards from our goal line), which always sits at LOS_Y on screen
 * before the camera scrolls.
 */
function drawField(ctx: CanvasRenderingContext2D, ballOn: number, lineToGain: number, cam: number): void {
  const yOf = (yard: number) => Math.round(LOS_Y - (yard - ballOn) * YD + cam);
  const fw = FIELD_RIGHT - FIELD_LEFT;
  ctx.fillStyle = '#0a5c36';
  ctx.fillRect(0, 0, W, H);

  // 5-yard mowing stripes and end zones
  for (let yard = -10; yard < 110; yard += 5) {
    const top = yOf(yard + 5), bottom = yOf(yard);
    if (bottom < 0 || top > H) continue;
    if (yard < 0) ctx.fillStyle = '#7e2553';
    else if (yard >= 100) ctx.fillStyle = C.navy;
    else ctx.fillStyle = Math.floor(yard / 5) % 2 ? '#00873f' : '#00954a';
    ctx.fillRect(FIELD_LEFT, top, fw, bottom - top);
  }
  const ez = yOf(105);
  if (ez > -10 && ez < H + 10) drawText(ctx, 'END ZONE', W / 2, ez - 5, { scale: 2, color: C.blue, align: 'center' });

  // yard lines, numbers, hash marks
  ctx.fillStyle = C.white;
  for (let yard = 0; yard <= 100; yard += 5) {
    const y = yOf(yard);
    if (y < -8 || y > H + 8) continue;
    ctx.fillRect(FIELD_LEFT, y, fw, yard % 50 === 0 ? 2 : 1); // goal lines and midfield are thicker
    if (yard % 10 === 0 && yard > 0 && yard < 100) {
      const label = String(yard <= 50 ? yard : 100 - yard);
      const tw = textWidth(label);
      for (const x of [FIELD_LEFT + 12, FIELD_RIGHT - 12 - tw]) {
        ctx.fillStyle = Math.floor(yard / 5) % 2 ? '#00873f' : '#00954a';
        ctx.fillRect(x - 1, y - 3, tw + 2, 7); // gap in the line behind the number
        drawText(ctx, label, x, y - 2, { color: C.white });
      }
      ctx.fillStyle = C.white;
    }
  }
  for (let yard = 1; yard < 100; yard++) {
    if (yard % 5 === 0) continue;
    const y = yOf(yard);
    if (y < 0 || y > H) continue;
    ctx.fillRect(66, y, 2, 1);
    ctx.fillRect(112, y, 2, 1);
    ctx.fillRect(FIELD_LEFT, y, 1, 1);
    ctx.fillRect(FIELD_RIGHT - 1, y, 1, 1);
  }
  ctx.fillRect(FIELD_LEFT - 1, 0, 1, H);
  ctx.fillRect(FIELD_RIGHT, 0, 1, H);

  // line of scrimmage (blue) and line to gain (yellow)
  ctx.fillStyle = C.blue;
  ctx.fillRect(FIELD_LEFT, yOf(ballOn), fw, 1);
  if (lineToGain < 100) {
    ctx.fillStyle = C.yellow;
    ctx.fillRect(FIELD_LEFT, yOf(lineToGain), fw, 1);
  }
}
