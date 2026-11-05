// Ties everything together: a full game (Match), input, aiming, the CPU
// quarterback when you're on defense, the playbook menu, and drawing.
import { C, FIELD_LEFT, FIELD_RIGHT, LOS_Y, MAX_THROW, PULL_POWER, RESULT_TIME, TIME_SCALE, W, YD } from './config';
import { CpuQb, callPlay, cpuGoesForIt } from './cpu';
import { DEF_BASE, beats, rushLabel } from './defense/calls';
import { drawText, textWidth } from './font';
import { type Banner, Match } from './match';
import { Menu } from './menu';
import { PLAYS, type Play } from './playbook/plays';
import { Sim, arcHeight, flightFor, throwSpread } from './sim';
import { ballSprite, drawCentered, playerSprite } from './sprites';
import { type Vec, clamp, dist, lerp, rand } from './util';
import { DIFFICULTY_TUNING, SPEED_FACTOR, loadSettings, saveSettings } from './settings';
import { PORTRAIT, type View } from './view';

export type AimMode = 'pull' | 'aim';
const SNAP_CATCH = 0.3; // sim seconds for the QB to catch the shotgun snap
const AIM_OFFSET = 10; // AIM mode: the landing spot sits this far above your finger (screen px)
const DEF_PRESNAP = 2.6; // seconds before the CPU snaps the ball when you're on defense
const STICK_RANGE = 22; // joystick: drag this far (screen px) for full speed
const USER_DEFENDER = 'MIKE';
type Rect = { x: number; y: number; w: number; h: number };
const hit = (r: Rect, p: Vec) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

/** Per-game speed ratings for a team: everyone is a few percent faster or slower. */
function makeRatings(): Record<string, number> {
  const r: Record<string, number> = {};
  for (const id of ['X', 'H', 'Y', 'Z', 'RB']) r[`off:${id}`] = rand(0.95, 1.05);
  for (const id of Object.keys(DEF_BASE)) r[`def:${id}`] = rand(0.95, 1.05);
  return r;
}
const pick = (r: Record<string, number>, prefix: string) =>
  Object.fromEntries(Object.entries(r).filter(([k]) => k.startsWith(prefix)));

export class Game {
  settings = loadSettings();
  sim = new Sim();
  match = new Match('you');
  play: Play = PLAYS[0]; // your selected play
  menu = new Menu(this.play.id, this.settings);
  menuOpen = true; // start on the playbook
  mode: AimMode = this.settings.aim;
  ratings = { you: makeRatings(), cpu: makeRatings() };
  history: string[] = []; // your recent play calls: the defense notices repeats
  view: View = PORTRAIT;
  clock = 0;
  paused = false; // tests step the sim by hand
  autoplay = false; // tests: the CPU brain plays your offense too
  screen: 'play' | 'banner' | 'final' = 'play';
  banner: (Banner & { kind: 'play' | 'punt' }) | null = null;
  private bannerAt = 0;
  drag: { start: Vec; cur: Vec } | null = null; // offense: throw gesture (screen coordinates)
  stick: { origin: Vec; cur: Vec } | null = null; // defense: joystick (screen coordinates)
  cpuQb: CpuQb | null = null;
  fourth: 'ask' | 'go' | null = null; // your 4th-down decision
  private snapAt = 0;
  private queuedThrow: Vec | null = null; // released before the QB had the snap
  camY = 0; // how far (world px) the view has scrolled upfield to follow the ball

  // Field state captured at the snap, so the field doesn't jump while the banner is up.
  private fieldBallOn = 25;
  private lineToGain = 35;
  private attackingYours = false; // is the top end zone yours (CPU on offense)?

  constructor() { this.applySettings(); this.nextPlay(); }

  applySettings(): void {
    this.mode = this.settings.aim;
    this.sim.speedFactor = SPEED_FACTOR[this.settings.speed];
    saveSettings(this.settings);
  }

  /** How many of your last 8 calls were this play. */
  repeats(play: Play): number { return this.history.filter((id) => id === play.id).length; }

  get onOffense(): boolean { return this.match.offense === 'you'; }

  setView(v: View): void { this.view = v; this.drag = null; this.stick = null; }

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
  /** 4th-down buttons, centred over the field. */
  get fourthButtons(): { go: Rect; punt: Rect } {
    const mid = this.view.landscape ? this.view.w / 2 : W / 2;
    const y = this.view.landscape ? 60 : 120;
    return { go: { x: Math.round(mid - 62), y, w: 58, h: 16 }, punt: { x: Math.round(mid + 4), y, w: 58, h: 16 } };
  }

  newGame(): void {
    this.match = new Match('you');
    this.ratings = { you: makeRatings(), cpu: makeRatings() };
    this.history = [];
    this.screen = 'play';
    this.nextPlay();
  }

  /** Sets up the next snap (or a CPU punt). */
  nextPlay(): void {
    this.banner = null;
    this.queuedThrow = null;
    this.cpuQb = null;
    this.drag = null;
    this.stick = null;
    this.camY = 0;
    const m = this.match;
    if (m.over) { this.screen = 'final'; return; }
    this.screen = 'play';
    const d = m.drive;
    this.fieldBallOn = d.ballOn;
    this.lineToGain = d.ballOn + d.toGo;
    this.attackingYours = !this.onOffense;
    if (this.onOffense) {
      this.fourth = d.down === 4 ? 'ask' : null;
      if (this.autoplay) this.play = callPlay(d); // tests: call plays like the CPU does
      // The defense adapts: the more you lean on a play, the more it calls
      // coverages that beat it, and the quicker it jumps it.
      const reps = this.repeats(this.play);
      const vs = this.play.vs;
      this.sim.reset(this.play, d.goalY, {
        ratings: { ...pick(this.ratings.you, 'off:'), ...pick(this.ratings.cpu, 'def:') },
        cpuTeam: 'def', tuning: DIFFICULTY_TUNING[this.settings.difficulty],
        callBias: reps >= 2 ? (c) => (beats(vs, c) ? 1 / (1 + reps * 0.8) : 1) : undefined,
        recognition: clamp((reps - 1) / 4, 0, 1),
      });
    } else {
      this.fourth = null;
      if (d.down === 4 && !cpuGoesForIt(d, m.score.cpu - m.score.you, m.quarter, m.clock)) { this.showPunt(); return; }
      this.sim.reset(callPlay(d), d.goalY, {
        userDefender: USER_DEFENDER,
        ratings: { ...pick(this.ratings.cpu, 'off:'), ...pick(this.ratings.you, 'def:') },
        cpuTeam: 'off', tuning: DIFFICULTY_TUNING[this.settings.difficulty],
      });
      this.snapAt = this.clock + DEF_PRESNAP;
    }
  }

  private showPunt(): void {
    this.banner = { ...this.match.punt(), kind: 'punt' };
    this.screen = 'banner';
    this.bannerAt = this.clock;
  }

  pickPlay(play: Play): void {
    this.play = play;
    this.menu.selectedId = play.id;
    this.menuOpen = false;
    if (this.onOffense && this.screen === 'play' && this.sim.phase === 'presnap') this.nextPlay();
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
      else if (a?.type === 'settings') this.applySettings();
      return;
    }
    if (this.screen === 'final') { this.newGame(); return; }
    if (this.screen === 'banner') { this.nextPlay(); return; }

    const phase = this.sim.phase;
    if (!this.onOffense) { this.stick = { origin: p, cur: p }; return; } // defense: joystick anywhere

    if (hit(this.modeButton, p)) { this.settings.aim = this.mode === 'pull' ? 'aim' : 'pull'; this.applySettings(); return; }
    if (hit(this.playsButton, p)) {
      if (phase === 'presnap') { this.menuOpen = true; this.menu = new Menu(this.play.id, this.settings); }
      return;
    }
    if (this.fourth === 'ask') {
      const b = this.fourthButtons;
      if (hit(b.go, p)) this.fourth = 'go';
      else if (hit(b.punt, p)) this.showPunt();
      return;
    }
    // One touch does it all: the touch snaps the ball and starts the aim.
    if (phase === 'presnap') this.snap();
    if (this.sim.phase === 'live') this.drag = { start: p, cur: p };
  }

  pointerMove(p: Vec): void {
    if (this.drag) this.drag.cur = p;
    if (this.stick) this.stick.cur = p;
  }

  pointerUp(p: Vec): void {
    this.stick = null;
    if (!this.drag) return;
    this.drag.cur = p;
    const to = this.target();
    this.drag = null;
    if (!to) return;
    if (this.sim.t < SNAP_CATCH) this.queuedThrow = to; // goes out as soon as he has the ball
    else this.sim.throwTo(to);
  }

  private snap(): void {
    this.sim.snap();
    if (this.onOffense) this.history = [...this.history, this.play.id].slice(-8);
    if (!this.onOffense) this.cpuQb = new CpuQb(this.sim, DIFFICULTY_TUNING[this.settings.difficulty].qbPicky);
    else if (this.autoplay) this.cpuQb = new CpuQb(this.sim);
  }

  // ---------- loop ----------

  update(dt: number): void {
    this.clock += dt;
    if (this.menuOpen || this.paused) return;
    if (this.screen === 'banner') {
      if (this.clock - this.bannerAt > RESULT_TIME) this.nextPlay();
      return;
    }
    if (this.screen === 'final') return;

    const sim = this.sim;
    if (sim.phase === 'presnap') {
      if (!this.onOffense && this.clock >= this.snapAt) this.snap();
      if (this.onOffense && this.autoplay) {
        if (this.fourth === 'ask') {
          const m = this.match;
          if (cpuGoesForIt(m.drive, m.score.you - m.score.cpu, m.quarter, m.clock)) this.fourth = 'go';
          else { this.showPunt(); return; }
        }
        this.snap();
      }
    }

    // your linebacker follows the joystick
    if (this.stick) {
      const dx = this.stick.cur.x - this.stick.origin.x, dy = this.stick.cur.y - this.stick.origin.y;
      const len = Math.hypot(dx, dy);
      const mag = len < 3 ? 0 : Math.min(1, len / STICK_RANGE);
      sim.userMove = len ? { x: (dx / len) * mag, y: (dy / len) * mag } : { x: 0, y: 0 };
    } else sim.userMove = { x: 0, y: 0 };
    sim.userControl = !!this.stick; // let go and he plays his assignment

    const wasDone = sim.phase === 'done';
    sim.update(dt);
    if (this.cpuQb && sim.phase === 'live') {
      const to = this.cpuQb.update(sim);
      if (to) sim.throwTo(to);
    }
    if (this.queuedThrow && sim.t >= SNAP_CATCH) { sim.throwTo(this.queuedThrow); this.queuedThrow = null; }
    if (sim.phase !== 'live') { this.drag = null; this.queuedThrow = null; } // sacked mid-drag
    if (!wasDone && sim.phase === 'done') {
      const q = this.match.quarter;
      const b = this.match.afterPlay(sim, sim.t / TIME_SCALE);
      if (this.match.over) b.note = 'FINAL';
      else if (this.match.quarter !== q) b.note = q === 2 ? 'HALFTIME' : `END OF Q${q}`;
      this.banner = { ...b, kind: 'play' };
      this.screen = 'banner';
      this.bannerAt = this.clock;
    }

    // camera follows the ball upfield: the runner, or a deep ball in the air
    let focus: number | null = null;
    if (sim.carrier) focus = sim.carrier.y;
    else if (sim.phase === 'air' && sim.ball) focus = sim.ballGround().y - sim.ballHeight();
    if (focus !== null) {
      const want = Math.max(this.camY, this.view.camAnchor - focus, 0);
      this.camY = lerp(this.camY, want, Math.min(1, dt * 6));
    }
  }

  // ---------- drawing ----------

  render(ctx: CanvasRenderingContext2D): void {
    drawField(ctx, this, this.fieldBallOn, this.lineToGain, this.attackingYours);
    if (this.screen !== 'banner' || this.banner?.kind === 'play') {
      if (this.onOffense || this.screen === 'banner') this.renderRoutes(ctx);
      this.renderPlayers(ctx);
      this.renderEyes(ctx);
      this.renderOffscreen(ctx);
      this.renderAim(ctx);
      this.renderBall(ctx);
    }
    this.renderHud(ctx);
    this.renderStick(ctx);
    if (this.screen === 'final') this.renderFinal(ctx);
    if (this.menuOpen) this.menu.render(ctx, this.view);
  }

  private renderPlayers(ctx: CanvasRenderingContext2D): void {
    const offColor = this.attackingYours ? 'red' : 'blue';
    const defColor = this.attackingYours ? 'blue' : 'red';
    for (const p of [...this.sim.actors].sort((a, b) => a.y - b.y)) {
      const build = p.kind === 'qb' ? 'qb' : p.kind === 'ol' || p.kind === 'dl' ? 'big' : 'skill';
      const img = p.team === 'off'
        ? playerSprite(offColor, build, 'up', this.view.landscape)
        : playerSprite(defColor, build, 'down', this.view.landscape);
      const x = this.sx(p.x), y = this.sy(p.y);
      ctx.fillStyle = p.user ? C.yellow : 'rgba(0,0,0,0.25)';
      ctx.fillRect(Math.round(x - img.width / 2), Math.round(y + img.height / 2), img.width, 1);
      drawCentered(ctx, img, x, y);
      if (p.user) { // a little marker over your linebacker
        const mx = Math.round(x), my = Math.round(y - img.height / 2 - 4);
        ctx.fillStyle = C.yellow;
        ctx.fillRect(mx - 2, my, 5, 1);
        ctx.fillRect(mx - 1, my + 1, 3, 1);
        ctx.fillRect(mx, my + 2, 1, 1);
      }
    }
  }

  /** Defense: where the CPU quarterback is looking. */
  private renderEyes(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    const eyes = this.cpuQb?.eyes;
    if (this.onOffense || !eyes || sim.phase !== 'live') return;
    const qx = this.sx(sim.qb.x), qy = this.sy(sim.qb.y);
    const ex = this.sx(eyes.x), ey = this.sy(eyes.y);
    const d = Math.hypot(ex - qx, ey - qy) || 1;
    const ux = (ex - qx) / d, uy = (ey - qy) / d;
    const len = Math.min(26, d - 4);
    ctx.fillStyle = C.yellow;
    for (let i = 5; i < len; i += 2) ctx.fillRect(Math.round(qx + ux * i), Math.round(qy + uy * i), 1, 1);
    const tx = qx + ux * len, ty = qy + uy * len;
    for (const side of [-1, 1]) {
      for (let k = 1; k <= 3; k++) {
        ctx.fillRect(Math.round(tx - ux * k + -uy * side * k), Math.round(ty - uy * k + ux * side * k), 1, 1);
      }
    }
  }

  /** Little arrows at the top edge for receivers who have run off the screen. */
  private renderOffscreen(ctx: CanvasRenderingContext2D): void {
    const top = this.view.landscape ? 0 : 20;
    for (const r of this.sim.receivers) {
      if (this.sy(r.y) >= top) continue;
      const x = Math.round(this.sx(r.x));
      ctx.fillStyle = this.onOffense ? r.color : C.red;
      ctx.fillRect(x, top + 1, 1, 1);
      ctx.fillRect(x - 1, top + 2, 3, 1);
      ctx.fillRect(x - 2, top + 3, 5, 1);
    }
  }

  /** Faint route lines for your plays: strong before the snap, a light reminder after. */
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
    drawCentered(ctx, ballSprite(), x + (sim.ball.carrier ? 2 : 0), y - h - (sim.ball.carrier ? 1 : 0));
  }

  /** Defense: the joystick under your thumb. */
  private renderStick(ctx: CanvasRenderingContext2D): void {
    if (!this.stick || this.onOffense) return;
    const { origin: o, cur } = this.stick;
    ctx.fillStyle = 'rgba(255,241,232,0.45)';
    for (let i = 0; i < 24; i += 2) {
      const a = (i / 24) * Math.PI * 2;
      ctx.fillRect(Math.round(o.x + Math.cos(a) * STICK_RANGE), Math.round(o.y + Math.sin(a) * STICK_RANGE), 1, 1);
    }
    const dx = cur.x - o.x, dy = cur.y - o.y, len = Math.hypot(dx, dy) || 1;
    const k = Math.min(len, STICK_RANGE) / len;
    ctx.fillStyle = 'rgba(255,236,39,0.8)';
    ctx.fillRect(Math.round(o.x + dx * k) - 2, Math.round(o.y + dy * k) - 2, 5, 5);
  }

  /** Your assignment in the defensive call, shown before the snap. */
  private assignment(): string {
    const u = this.sim.user;
    if (!u) return '';
    if (u.job === 'rush') return 'BLITZ!';
    if (u.job === 'man' && u.man) return `MAN ON ${u.man.id === 'RB' ? 'THE RB' : u.man.kind === 'te' ? 'THE TE' : `#${u.man.id}`}`;
    if (u.job === 'zone' && u.zone) return `${u.zone.name} ZONE`;
    return '';
  }

  private renderHud(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    const v = this.view;
    const m = this.match;
    const d = m.drive;
    const offense = this.onOffense;
    const showDown = this.screen === 'play';
    const fieldMid = v.landscape ? v.w / 2 : W / 2;
    const live = sim.phase === 'live' || sim.phase === 'air' || sim.phase === 'run';
    const q = m.over ? 'FINAL' : `Q${m.quarter} ${m.clockText}`;

    if (v.landscape) {
      ctx.fillStyle = C.ink;
      ctx.fillRect(0, 0, v.panel, v.h);
      ctx.fillRect(v.w - v.panel, 0, v.panel, v.h);
      const lx = 3;
      drawText(ctx, `YOU ${m.score.you}`, lx, 5, { color: C.blue });
      drawText(ctx, `CPU ${m.score.cpu}`, lx, 13, { color: C.red });
      drawText(ctx, q, lx, 23);
      drawText(ctx, offense ? 'OFFENSE' : 'DEFENSE', lx, 37, { color: offense ? C.blue : C.red });
      if (showDown) {
        drawText(ctx, d.downText, lx, 45, { color: C.yellow });
        drawText(ctx, offense ? d.spotText : flipSpot(d.spotText), lx, 53);
      }
      if (offense) {
        drawText(ctx, 'PLAY', lx, v.h - 34, { color: C.grey });
        drawText(ctx, this.play.name, lx, v.h - 26, { color: C.yellow });
        button(ctx, this.playsButton, 'PLAYS', live || this.fourth === 'ask' ? C.darkGrey : C.white);
        drawText(ctx, 'MODE', v.w - v.panel / 2, v.h - 26, { align: 'center', color: C.grey });
        button(ctx, this.modeButton, this.mode.toUpperCase(), C.white);
      } else {
        drawText(ctx, 'YOU: MIKE', lx, v.h - 34, { color: C.yellow });
        drawText(ctx, 'DRAG TO', v.w - v.panel + 3, v.h - 26, { color: C.grey });
        drawText(ctx, 'TAKE OVER', v.w - v.panel + 3, v.h - 18, { color: C.grey });
      }
    } else {
      ctx.fillStyle = 'rgba(17,29,43,0.9)';
      ctx.fillRect(0, 0, v.w, 19);
      drawText(ctx, `YOU ${m.score.you}`, 5, 3, { color: C.blue });
      drawText(ctx, `CPU ${m.score.cpu}`, 45, 3, { color: C.red });
      drawText(ctx, q, v.w - 5, 3, { align: 'right' });
      if (showDown) {
        drawText(ctx, d.downText, 5, 11, { color: C.yellow });
        drawText(ctx, offense ? d.spotText : flipSpot(d.spotText), 45, 11);
      }
      drawText(ctx, offense ? 'OFFENSE' : 'DEFENSE', v.w - 5, 11, { align: 'right', color: offense ? C.blue : C.red });
      if (offense) {
        button(ctx, this.playsButton, 'PLAYS', live || this.fourth === 'ask' ? C.darkGrey : C.white);
        button(ctx, this.modeButton, `MODE ${this.mode.toUpperCase()}`, C.white);
        drawText(ctx, this.play.name, (this.playsButton.x + this.playsButton.w + this.modeButton.x) / 2, v.h - 12,
          { align: 'center', color: C.yellow, shadow: '#000' });
      } else {
        drawText(ctx, 'YOU: MIKE LB - DRAG TO TAKE OVER', v.w / 2, v.h - 12, { align: 'center', color: C.yellow, shadow: '#000' });
      }
    }

    // pre-snap prompts
    if (this.screen === 'play' && sim.phase === 'presnap' && !this.menuOpen) {
      const y = v.landscape ? 4 : this.sy(LOS_Y) + 40;
      if (offense && this.fourth === 'ask') {
        const b = this.fourthButtons;
        ctx.fillStyle = 'rgba(17,29,43,0.88)';
        ctx.fillRect(b.go.x - 6, b.go.y - 16, b.punt.x + b.punt.w - b.go.x + 12, 38);
        drawText(ctx, `4TH & ${d.toGo} - GO OR PUNT?`, fieldMid, b.go.y - 11, { align: 'center', color: C.yellow });
        button(ctx, b.go, 'GO FOR IT', C.green);
        button(ctx, b.punt, 'PUNT', C.white);
      } else if (offense) {
        if (Math.floor(this.clock * 2.5) % 2 === 0) drawText(ctx, 'TOUCH TO SNAP + THROW', fieldMid, y, { align: 'center', color: C.white, shadow: '#000' });
        if (this.repeats(this.play) >= 3) {
          drawText(ctx, "THEY'VE SEEN THIS PLAY", fieldMid, y + 9, { align: 'center', color: C.orange, shadow: '#000' });
        }
      } else if (!offense) {
        const left = Math.max(0, Math.ceil(this.snapAt - this.clock));
        const ty = v.landscape ? 4 : 24;
        drawText(ctx, `${sim.call.coverage} - YOU: ${this.assignment()}`, fieldMid, ty, { align: 'center', color: C.yellow, shadow: '#000' });
        drawText(ctx, `SNAP IN ${left}`, fieldMid, ty + 8, { align: 'center', color: C.white, shadow: '#000' });
      }
    }

    const b = this.banner;
    if (this.screen === 'banner' && b) {
      const y = v.landscape ? 40 : 96;
      const bw = v.landscape ? v.w - v.panel * 2 - 20 : v.w - 20;
      const lines = 1 + (b.kind === 'play' ? 1 : 0) + (b.note ? 1 : 0);
      ctx.fillStyle = 'rgba(17,29,43,0.9)';
      ctx.fillRect(Math.round(fieldMid - bw / 2), y - 6, bw, 28 + lines * 10);
      drawText(ctx, b.headline, fieldMid, y, { scale: 2, color: b.color, shadow: '#000', align: 'center' });
      drawText(ctx, b.detail, fieldMid, y + 16, { align: 'center', color: C.white });
      let ly = y + 26;
      if (b.note) { drawText(ctx, b.note, fieldMid, ly, { align: 'center', color: C.yellow }); ly += 10; }
      if (b.kind === 'play') {
        drawText(ctx, `${sim.call.coverage} - ${rushLabel(sim.call)}`, fieldMid, ly, { align: 'center', color: C.grey });
      }
    }
  }

  private renderFinal(ctx: CanvasRenderingContext2D): void {
    const v = this.view;
    const m = this.match;
    ctx.fillStyle = 'rgba(17,29,43,0.95)';
    ctx.fillRect(0, 0, v.w, v.h);
    const mid = v.w / 2;
    let y = v.landscape ? 14 : 70;
    drawText(ctx, 'FINAL', mid, y, { scale: 2, color: C.yellow, align: 'center' });
    y += 18;
    drawText(ctx, `YOU ${m.score.you}  -  CPU ${m.score.cpu}`, mid, y, { scale: 2, align: 'center' });
    y += 18;
    const res = m.score.you > m.score.cpu ? ['YOU WIN!', C.green] : m.score.you < m.score.cpu ? ['CPU WINS', C.red] : ['TIE GAME', C.grey];
    drawText(ctx, res[0], mid, y, { align: 'center', color: res[1] });
    y += 16;
    for (const side of ['you', 'cpu'] as const) {
      const st = m.stats[side];
      const ypp = st.plays ? (st.yards / st.plays).toFixed(1) : '0.0';
      const ppt = st.tds ? (st.plays / st.tds).toFixed(1) : '-';
      drawText(ctx, side === 'you' ? 'YOUR OFFENSE' : 'CPU OFFENSE', mid, y, { align: 'center', color: side === 'you' ? C.blue : C.red });
      drawText(ctx, `${st.cmp}/${st.att}  ${st.yards} YDS  ${st.tds} TD  ${st.int} INT`, mid, y + 8, { align: 'center' });
      drawText(ctx, `YDS/PLAY ${ypp}  PLAYS/TD ${ppt}  SACKS ${st.sacks}`, mid, y + 16, { align: 'center', color: C.grey });
      y += 28;
    }
    if (Math.floor(this.clock * 2) % 2 === 0) drawText(ctx, 'TAP FOR A NEW GAME', mid, y + 4, { align: 'center', color: C.yellow });
  }
}

/** The drive's spot text is from the offense's side; flip it for the CPU's drives. */
function flipSpot(t: string): string {
  return t.startsWith('OWN') ? t.replace('OWN', 'CPU') : t.startsWith('OPP') ? t.replace('OPP', 'YOUR') : t;
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
 * scrimmage (yards from the offense's goal line), which sits at world y LOS_Y.
 * attackingYours: the CPU has the ball, so the end zone at the top is yours.
 */
function drawField(ctx: CanvasRenderingContext2D, g: Game, ballOn: number, lineToGain: number, attackingYours: boolean): void {
  const v = g.view;
  const yOf = (yard: number) => Math.round(g.sy(LOS_Y - (yard - ballOn) * YD));
  const left = Math.round(g.sx(FIELD_LEFT)), right = Math.round(g.sx(FIELD_RIGHT));
  const fw = right - left;
  const yourZone = C.navy, cpuZone = '#7e2553';
  ctx.fillStyle = '#0a5c36';
  ctx.fillRect(0, 0, v.w, v.h);

  // 5-yard mowing stripes and end zones
  for (let yard = -10; yard < 110; yard += 5) {
    const top = yOf(yard + 5), bottom = yOf(yard);
    if (bottom < 0 || top > v.h) continue;
    if (yard < 0) ctx.fillStyle = attackingYours ? cpuZone : yourZone;
    else if (yard >= 100) ctx.fillStyle = attackingYours ? yourZone : cpuZone;
    else ctx.fillStyle = Math.floor(yard / 5) % 2 ? '#00873f' : '#00954a';
    ctx.fillRect(left, top, fw, bottom - top);
  }
  const ez = yOf(105);
  if (ez > -10 && ez < v.h + 10) {
    drawText(ctx, attackingYours ? 'YOU' : 'CPU', g.sx(W / 2), ez - 5, { scale: 2, color: attackingYours ? C.blue : C.pink, align: 'center' });
  }

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
