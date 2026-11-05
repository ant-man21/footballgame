// Ties everything together: input, aiming, the playbook menu, the drive, and drawing.
import { C, FIELD_LEFT, FIELD_RIGHT, LOS_Y, MAX_THROW, PULL_POWER, RESULT_TIME, W, YD } from './config';
import { rushLabel } from './defense/calls';
import { Drive, type PlaySummary } from './drive';
import { drawText, textWidth } from './font';
import { Menu } from './menu';
import { PLAYS, type Play } from './playbook/plays';
import { type Actor, Sim, arcHeight, flightFor, throwSpread } from './sim';
import { drawCentered, sprites } from './sprites';
import { type Vec, clamp, dist, lerp } from './util';
import { PORTRAIT, type View } from './view';

export type AimMode = 'pull' | 'aim';
const SNAP_CATCH = 0.3; // sim seconds for the QB to catch the shotgun snap
const AIM_OFFSET = 10; // AIM mode: the landing spot sits this far above your finger (screen px)
type Rect = { x: number; y: number; w: number; h: number };
const hit = (r: Rect, p: Vec) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

export class Game {
  sim = new Sim();
  drive = new Drive();
  play: Play = PLAYS[0];
  menu = new Menu(this.play.id);
  menuOpen = true; // start on the playbook
  mode: AimMode = 'pull';
  view: View = PORTRAIT;
  clock = 0;
  doneAt = 0;
  paused = false; // tests step the sim by hand
  drag: { start: Vec; cur: Vec } | null = null; // screen coordinates
  private queuedThrow: Vec | null = null; // released before the QB had the snap
  summary: PlaySummary | null = null;
  camY = 0; // how far (world px) the view has scrolled upfield to follow the ball

  // Field state captured at the snap, so the field doesn't jump while the
  // result banner is up.
  private fieldBallOn = this.drive.ballOn;
  private lineToGain = this.drive.ballOn + this.drive.toGo;

  constructor() { this.nextPlay(); }

  setView(v: View): void { this.view = v; this.drag = null; }

  // world <-> screen
  sx = (x: number) => this.view.ox + x * this.view.s;
  sy = (y: number) => this.view.oy + (y + this.camY) * this.view.s;
  wx = (x: number) => (x - this.view.ox) / this.view.s;
  wy = (y: number) => (y - this.view.oy) / this.view.s - this.camY;

  get playsButton(): Rect {
    return this.view.landscape ? { x: 3, y: this.view.h - 16, w: this.view.panel - 6, h: 13 } : { x: 4, y: this.view.h - 16, w: 40, h: 12 };
  }
  get modeButton(): Rect {
    const v = this.view;
    return v.landscape ? { x: v.w - v.panel + 3, y: v.h - 16, w: v.panel - 6, h: 13 } : { x: v.w - 62, y: v.h - 16, w: 58, h: 12 };
  }

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

  /** Where the ball would land (world coordinates) for the current drag, or null if the drag is too small. */
  target(): Vec | null {
    if (!this.drag) return null;
    const { start, cur } = this.drag;
    const qb = this.sim.qb;
    let t: Vec;
    if (this.mode === 'pull') {
      const dx = start.x - cur.x, dy = start.y - cur.y; // screen px; same feel in both orientations
      if (Math.hypot(dx, dy) < 5) return null;
      t = { x: qb.x + dx * PULL_POWER, y: qb.y + dy * PULL_POWER };
    } else {
      t = { x: this.wx(cur.x), y: this.wy(cur.y - AIM_OFFSET) }; // just above the finger
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
      const a = this.menu.tap(p, this.view);
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

    // camera follows the ball upfield: the runner, or a deep ball in the air
    const sim = this.sim;
    let focus: number | null = null;
    if (sim.carrier) focus = sim.carrier.y;
    else if (sim.phase === 'air' && sim.ball) focus = sim.ballGround().y - sim.ballHeight();
    if (focus !== null) {
      const want = Math.max(this.camY, this.view.camAnchor - focus, 0);
      this.camY = lerp(this.camY, want, Math.min(1, dt * 6));
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    drawField(ctx, this, this.fieldBallOn, this.lineToGain);
    this.renderRoutes(ctx);
    const spr = sprites();
    for (const p of [...sim.actors].sort((a, b) => a.y - b.y)) {
      const img = spriteFor(p, spr, this.view.landscape);
      const x = this.sx(p.x), y = this.sy(p.y);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(Math.round(x - img.width / 2), Math.round(y + img.height / 2), img.width, 1);
      drawCentered(ctx, img, x, y);
    }
    this.renderOffscreen(ctx);
    this.renderAim(ctx);
    this.renderBall(ctx);
    this.renderHud(ctx);
    if (this.menuOpen) this.menu.render(ctx, this.view);
  }

  /** Little arrows at the top edge for receivers who have run off the screen. */
  private renderOffscreen(ctx: CanvasRenderingContext2D): void {
    const top = this.view.landscape ? 0 : 20;
    for (const r of this.sim.receivers) {
      if (this.sy(r.y) >= top) continue;
      const x = Math.round(this.sx(r.x));
      ctx.fillStyle = r.color;
      ctx.fillRect(x, top + 1, 1, 1);
      ctx.fillRect(x - 1, top + 2, 3, 1);
      ctx.fillRect(x - 2, top + 3, 5, 1);
    }
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
        const n = Math.max(1, Math.floor((dist(prev, q) * this.view.s) / 3));
        for (let i = 0; i <= n; i++) {
          const x = prev.x + ((q.x - prev.x) * i) / n, y = prev.y + ((q.y - prev.y) * i) / n;
          ctx.fillRect(Math.round(this.sx(x)), Math.round(this.sy(y)), 1, 1);
        }
        prev = q;
      }
    }
    ctx.globalAlpha = 1;
  }

  private renderAim(ctx: CanvasRenderingContext2D): void {
    const to = this.target();
    if (!to || !this.drag) return;
    const s = this.view.s;
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
    const steps = Math.max(6, Math.floor((dist(from, to) * s) / 6));
    const march = (this.clock * 2) % 1;
    for (let i = 0; i < steps; i++) {
      const f = (i + march) / steps;
      const gx = this.sx(from.x + (to.x - from.x) * f), gy = this.sy(from.y + (to.y - from.y) * f);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(Math.round(gx), Math.round(gy), 1, 1);
      ctx.fillStyle = C.white;
      ctx.fillRect(Math.round(gx), Math.round(gy - arcHeight(peak, f) * s), 2, 2);
    }
    // Landing oval: the ball will come down somewhere inside it. It stretches
    // along the throw line with distance and grows under pressure (orange).
    const pressured = this.sim.pressured;
    const sp = throwSpread(dist(from, to), pressured);
    const along = sp.along * s, lat = sp.lat * s;
    const u = { x: (to.x - from.x) / (dist(from, to) || 1), y: (to.y - from.y) / (dist(from, to) || 1) };
    const x = Math.round(this.sx(to.x)), y = Math.round(this.sy(to.y));
    ctx.fillStyle = pressured ? C.orange : C.yellow;
    const n = Math.max(14, Math.round((along + lat) * 2.5));
    for (let i = 0; i < n; i += 2) { // dotted outline
      const t = (i / n) * Math.PI * 2;
      const a = Math.cos(t) * along, b = Math.sin(t) * lat;
      ctx.fillRect(Math.round(x + u.x * a - u.y * b), Math.round(y + u.y * a + u.x * b), 1, 1);
    }
    ctx.fillRect(x - 1, y, 3, 1); // aim point
    ctx.fillRect(x, y - 1, 1, 3);
    if (along > 6) { // faint fill so the big ovals read as an area
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      ctx.ellipse(x, y, along, lat, Math.atan2(u.y, u.x), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private renderBall(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    if (!sim.ball) return;
    const g = sim.ballGround();
    const h = sim.ballHeight() * this.view.s;
    const x = this.sx(g.x), y = this.sy(g.y);
    if (!sim.ball.carrier) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(Math.round(x - 1), Math.round(y), 3, 1);
    }
    drawCentered(ctx, sprites().ball, x + (sim.ball.carrier ? 2 : 0), y - h - (sim.ball.carrier ? 1 : 0));
  }

  private renderHud(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    const v = this.view;
    const dr = this.drive;
    const st = dr.stats;
    const showDown = sim.phase !== 'done'; // during the banner the drive has already moved on
    const ypp = dr.yardsPerPlay.toFixed(1);
    const ppt = st.tds ? dr.playsPerTd.toFixed(1) : '-';
    const live = sim.phase === 'live' || sim.phase === 'air' || sim.phase === 'run';
    const fieldMid = v.landscape ? v.w / 2 : W / 2;

    if (v.landscape) {
      // side panels: scoreboard on the left, controls on the right
      ctx.fillStyle = C.ink;
      ctx.fillRect(0, 0, v.panel, v.h);
      ctx.fillRect(v.w - v.panel, 0, v.panel, v.h);
      const lx = 3;
      if (showDown) {
        drawText(ctx, dr.downText, lx, 5, { color: C.yellow });
        drawText(ctx, dr.spotText, lx, 13);
      }
      drawText(ctx, `TD ${st.tds}`, lx, 30, { color: C.grey });
      drawText(ctx, 'YDS/PLAY', lx, 40, { color: C.grey });
      drawText(ctx, ypp, lx, 47);
      drawText(ctx, 'PLAYS/TD', lx, 57, { color: C.grey });
      drawText(ctx, ppt, lx, 64);
      drawText(ctx, 'PLAY', lx, v.h - 34, { color: C.grey });
      drawText(ctx, this.play.name, lx, v.h - 26, { color: C.yellow });
      button(ctx, this.playsButton, 'PLAYS', live ? C.darkGrey : C.white);
      drawText(ctx, 'MODE', v.w - v.panel / 2, v.h - 26, { align: 'center', color: C.grey });
      button(ctx, this.modeButton, this.mode.toUpperCase(), C.white);
    } else {
      ctx.fillStyle = 'rgba(17,29,43,0.88)';
      ctx.fillRect(0, 0, v.w, 19);
      if (showDown) {
        drawText(ctx, dr.downText, 5, 3, { color: C.yellow });
        drawText(ctx, dr.spotText, v.w - 5, 3, { align: 'right' });
      }
      drawText(ctx, `TD ${st.tds}  YDS/PLAY ${ypp}  PLAYS/TD ${ppt}`, v.w / 2, 11, { align: 'center', color: C.grey });
      button(ctx, this.playsButton, 'PLAYS', live ? C.darkGrey : C.white);
      button(ctx, this.modeButton, `MODE ${this.mode.toUpperCase()}`, C.white);
      drawText(ctx, this.play.name, (this.playsButton.x + this.playsButton.w + this.modeButton.x) / 2, v.h - 12,
        { align: 'center', color: C.yellow, shadow: '#000' });
    }

    if (sim.phase === 'presnap' && !this.menuOpen && Math.floor(this.clock * 2.5) % 2 === 0) {
      const y = v.landscape ? 4 : this.sy(LOS_Y) + 40;
      drawText(ctx, 'TOUCH TO SNAP + THROW', fieldMid, y, { align: 'center', color: C.white, shadow: '#000' });
    }

    const s = this.summary;
    if (sim.phase === 'done' && s) {
      const y = v.landscape ? 40 : 96;
      const bw = v.landscape ? v.w - v.panel * 2 - 20 : v.w - 20;
      ctx.fillStyle = 'rgba(17,29,43,0.88)';
      ctx.fillRect(Math.round(fieldMid - bw / 2), y - 6, bw, 48);
      drawText(ctx, s.headline, fieldMid, y, { scale: 2, color: s.color, shadow: '#000', align: 'center' });
      drawText(ctx, s.detail, fieldMid, y + 16, { align: 'center', color: C.white });
      drawText(ctx, `${sim.call.coverage} - ${rushLabel(sim.call)}`, fieldMid, y + 28, { align: 'center', color: C.grey });
    }
  }
}

/** Landscape has room for the original chunky players; portrait uses slimmer ones. */
function spriteFor(p: Actor, spr: ReturnType<typeof sprites>, landscape: boolean): HTMLCanvasElement {
  if (p.kind === 'qb') return landscape ? spr.qbL : spr.qb;
  if (p.team === 'off') return p.kind === 'ol' ? spr.offBig : landscape ? spr.offL : spr.off;
  return p.kind === 'dl' ? spr.defBig : landscape ? spr.defL : spr.def;
}

function button(ctx: CanvasRenderingContext2D, b: Rect, label: string, color: string): void {
  ctx.fillStyle = 'rgba(17,29,43,0.8)';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = color;
  ctx.fillRect(b.x, b.y, b.w, 1); ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
  ctx.fillRect(b.x, b.y, 1, b.h); ctx.fillRect(b.x + b.w - 1, b.y, 1, b.h);
  drawText(ctx, label, b.x + b.w / 2, b.y + Math.floor((b.h - 5) / 2), { align: 'center', color });
}

/**
 * Draws the visible part of a real 100-yard field. ballOn is the line of
 * scrimmage (yards from our goal line), which sits at world y LOS_Y.
 */
function drawField(ctx: CanvasRenderingContext2D, g: Game, ballOn: number, lineToGain: number): void {
  const v = g.view;
  const yOf = (yard: number) => Math.round(g.sy(LOS_Y - (yard - ballOn) * YD));
  const left = Math.round(g.sx(FIELD_LEFT)), right = Math.round(g.sx(FIELD_RIGHT));
  const fw = right - left;
  ctx.fillStyle = '#0a5c36';
  ctx.fillRect(0, 0, v.w, v.h);

  // 5-yard mowing stripes and end zones
  for (let yard = -10; yard < 110; yard += 5) {
    const top = yOf(yard + 5), bottom = yOf(yard);
    if (bottom < 0 || top > v.h) continue;
    if (yard < 0) ctx.fillStyle = '#7e2553';
    else if (yard >= 100) ctx.fillStyle = C.navy;
    else ctx.fillStyle = Math.floor(yard / 5) % 2 ? '#00873f' : '#00954a';
    ctx.fillRect(left, top, fw, bottom - top);
  }
  const ez = yOf(105);
  if (ez > -10 && ez < v.h + 10) drawText(ctx, 'END ZONE', g.sx(W / 2), ez - 5, { scale: 2, color: C.blue, align: 'center' });

  // yard lines, numbers, hash marks
  ctx.fillStyle = C.white;
  for (let yard = 0; yard <= 100; yard += 5) {
    const y = yOf(yard);
    if (y < -8 || y > v.h + 8) continue;
    ctx.fillRect(left, y, fw, yard % 50 === 0 ? 2 : 1); // goal lines and midfield are thicker
    if (yard % 10 === 0 && yard > 0 && yard < 100) {
      const label = String(yard <= 50 ? yard : 100 - yard);
      const tw = textWidth(label);
      for (const x of [left + Math.round(12 * v.s), right - Math.round(12 * v.s) - tw]) {
        ctx.fillStyle = Math.floor(yard / 5) % 2 ? '#00873f' : '#00954a';
        ctx.fillRect(x - 1, y - 3, tw + 2, 7); // gap in the line behind the number
        drawText(ctx, label, x, y - 2, { color: C.white });
      }
      ctx.fillStyle = C.white;
    }
  }
  const hashL = Math.round(g.sx(66)), hashR = Math.round(g.sx(112));
  for (let yard = 1; yard < 100; yard++) {
    if (yard % 5 === 0) continue;
    const y = yOf(yard);
    if (y < 0 || y > v.h) continue;
    ctx.fillRect(hashL, y, 2, 1);
    ctx.fillRect(hashR, y, 2, 1);
    ctx.fillRect(left, y, 1, 1);
    ctx.fillRect(right - 1, y, 1, 1);
  }
  ctx.fillRect(left - 1, 0, 1, v.h);
  ctx.fillRect(right, 0, 1, v.h);

  // line of scrimmage (blue) and line to gain (yellow)
  ctx.fillStyle = C.blue;
  ctx.fillRect(left, yOf(ballOn), fw, 1);
  if (lineToGain < 100) {
    ctx.fillStyle = C.yellow;
    ctx.fillRect(left, yOf(lineToGain), fw, 1);
  }
}
