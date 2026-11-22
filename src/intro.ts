// The pregame show (about 10 seconds, tap to skip): the camera sweeps down
// from the home stands with the matchup on a title card; the home team runs
// out of its tunnel and bursts through a paper banner, with smoke, fireworks
// and the crowd on its feet; then the coin toss at midfield. Drawn with the
// real field, stadium and player sprites; the Game hands over the camera.
import { drawBlimp } from './blimp';
import { C, LOS_Y, YD, fx } from './config';
import { drawText, glyphMask, textWidth } from './font';
import { HD, hdPlayer, identity } from './hd';
import type { Side } from './match';
import { type TeamColor, shade } from './sprites';
import { type Crowd, standsYd } from './stadium';
import type { View } from './view';

export interface IntroInfo {
  home: Side; // whose stadium (that team runs out)
  top: string; // the line over the matchup: the storyline, or the week
  big: boolean; // a big game: more fireworks
  names: Record<Side, string>; // school names (or YOU / CPU)
  mascots: Record<Side, string>;
  abbrs: Record<Side, string>;
  colors: Record<Side, [string, string]>;
  college?: boolean; // a college game: the blimp shot, a marching band, a bigger stadium
  tags?: Record<Side, string>; // under each badge on the title card, e.g. "NO.4 9-1"
}

/** What the intro needs from the Game. */
export interface IntroHost {
  view: View;
  sx(x: number): number;
  sy(y: number): number;
  /** Draws the field and stadium with the camera on this yard line (no scrimmage lines). */
  field(ctx: CanvasRenderingContext2D, camYard: number): void;
  /** The crowd (colours, how loud). */
  crowd(): Crowd;
}

/** College: the blimp shot before the camera comes down (seconds). */
const BLIMP = 3;
const BAND_YD = 74; // the band's formation, yards from the near goal line (the home team's end is at 100+)

// the timeline (seconds)
const PAN_END = 2.8, RUN_END = 6.6, TOSS_END = 10.2;
const CAM_START = 104, CAM_RUN = 86, CAM_TOSS = 58;
const TUNNEL_YD = 108, BANNER_YD = 104;
const TUNNEL_X = -15; // yards across: the tunnel sits off to the side of the goalpost
const RUN_SPEED = 8.5; // yards per second
const N_RUNNERS = 10;

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

interface Spark { x: number; y: number; vx: number; vy: number; life: number; color: string }
interface Rocket { x: number; y: number; vy: number; burstY: number; colors: string[]; done: boolean }
interface Puff { x: number; y: number; r: number; life: number }

export class Intro {
  t = 0;
  done = false;
  private sparks: Spark[] = [];
  private rockets: Rocket[] = [];
  private puffs: Puff[] = [];
  private nextRocket = PAN_END - 0.6;
  private nextPuff = PAN_END - 0.2;
  private bits: Spark[] = []; // torn banner paper
  private torn = false;
  private runners: { delay: number; lane: number; exitYd: number; num: number; skin: number; build: 'skill' | 'big' }[] = [];
  /** Seconds into the blimp shot (college games open with it; the rest of the show runs after). */
  pre = 0;
  private band: { x: number; yd: number }[] = [];

  constructor(public info: IntroInfo, public kits: Record<Side, TeamColor>, public receiving: Side) {
    for (let i = 0; i < N_RUNNERS; i++) {
      const id = identity(`${info.names[info.home]}${i}`, i % 4 === 3 ? 'ol' : 'wr');
      this.runners.push({
        delay: PAN_END + 0.15 + i * 0.12, lane: ((i % 2 ? 1 : -1) * (1 + (i >> 1) * 1.6)), exitYd: 92 - (i % 3) * 3,
        num: i === 0 ? 7 : id.num, skin: id.skin, build: i % 4 === 3 ? 'big' : 'skill',
      });
    }
    if (info.college) { // the band spells the school's letters on the field, one bandsman per pixel
      const mask = glyphMask(info.abbrs[info.home]), cols = mask[0].length;
      mask.forEach((row, r) => row.forEach((on, c) => {
        if (on) this.band.push({ x: (c - (cols - 1) / 2) * 2, yd: BAND_YD + (4 - r) * 2.3 });
      }));
    } else this.pre = BLIMP;
  }

  /** Still in the blimp shot? */
  get inBlimp(): boolean { return this.pre < BLIMP; }
  /** The card stunt in the stands: the blimp shot and the camera's sweep down. */
  get stunt(): boolean { return !!this.info.college && this.t < PAN_END; }

  /** How loud the crowd is. */
  get hype(): number { return this.inBlimp ? 0.3 : this.t < PAN_END - 0.4 ? 0.15 : this.t < RUN_END ? 1 : 0.2; }

  /** The camera: the yard line at the scrimmage spot of the screen. */
  private cam(): number {
    const start = this.info.college ? CAM_START + 14 : CAM_START; // a college sweep starts up in the upper deck
    if (this.t < PAN_END) return start + (CAM_RUN - start) * ease(this.t / PAN_END);
    if (this.t < RUN_END) return CAM_RUN;
    return CAM_RUN + (CAM_TOSS - CAM_RUN) * ease((this.t - RUN_END) / 0.8);
  }

  skip(): void { this.done = true; }

  update(dt: number): void {
    if (this.inBlimp) { this.pre += dt; return; }
    this.t += dt;
    if (this.t >= TOSS_END) { this.done = true; return; }
    const colors = this.info.colors[this.info.home];
    // fireworks over the stands while the team runs out
    if (this.t >= this.nextRocket && this.t < RUN_END - 0.6) {
      this.nextRocket = this.t + (this.info.big ? 0.32 : 0.55) * (0.7 + Math.random() * 0.6);
      const sky = 110 + standsYd(this.info.college) + 2;
      this.rockets.push({
        x: (Math.random() - 0.5) * 50, y: sky, vy: 22 + Math.random() * 6, burstY: sky + 6 + Math.random() * 10,
        colors: [colors[0], colors[1], '#fff1e8', C.yellow].filter((c) => c), done: false,
      });
    }
    for (const r of this.rockets) {
      if (r.done) continue;
      r.y += r.vy * dt;
      if (r.y >= r.burstY) {
        r.done = true;
        const n = 34;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2, sp = 9 + Math.random() * 3;
          this.sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, color: r.colors[i % r.colors.length] });
        }
      }
    }
    this.rockets = this.rockets.filter((r) => !r.done);
    for (const s of this.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy -= 6 * dt; s.vx *= 0.97; s.vy *= 0.97; s.life -= dt * 0.9; }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    // smoke from the tunnel
    if (this.t >= this.nextPuff && this.t < PAN_END + 2.2) {
      this.nextPuff = this.t + 0.07;
      this.puffs.push({ x: TUNNEL_X + (Math.random() - 0.5) * 4, y: TUNNEL_YD - 0.5, r: 1.2, life: 1 });
    }
    for (const p of this.puffs) { p.y -= 1.2 * dt; p.x += (p.x - TUNNEL_X) * 0.8 * dt; p.r += 3.2 * dt; p.life -= dt * 0.55; }
    this.puffs = this.puffs.filter((p) => p.life > 0);
    // the banner tears when the first man gets there
    if (!this.torn && this.runnerAt(this.runners[0]).yd <= BANNER_YD) {
      this.torn = true;
      for (let i = 0; i < 40; i++) {
        const side = i % 2 ? 1 : -1;
        this.bits.push({ x: TUNNEL_X + side * Math.random() * 5, y: BANNER_YD, vx: side * (2 + Math.random() * 5), vy: (Math.random() - 0.3) * 6, life: 1, color: i % 3 ? colors[0] : colors[1] });
      }
    }
    for (const b of this.bits) { b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.92; b.vy *= 0.92; b.life -= dt * 0.6; }
    this.bits = this.bits.filter((b) => b.life > 0);
  }

  /** Where a runner is (lateral yards, yard line) and which way he's heading. */
  private runnerAt(r: Intro['runners'][number]): { x: number; yd: number; dx: number; dyd: number; on: boolean } {
    const d = (this.t - r.delay) * RUN_SPEED; // yards run
    if (d < 0) return { x: TUNNEL_X, yd: TUNNEL_YD, dx: 0, dyd: -1, on: false };
    const straight = TUNNEL_YD - BANNER_YD + 2; // out of the tunnel and through the banner
    if (d < straight) return { x: TUNNEL_X, yd: TUNNEL_YD - d, dx: 0, dyd: -1, on: true };
    // then fan out down the field, and peel off to the home sideline
    const e = d - straight, fanLen = BANNER_YD - 2 - r.exitYd;
    if (e < fanLen) {
      const toLane = Math.min(1, e / 6);
      return { x: TUNNEL_X + (5 + r.lane * 1.6) * toLane, yd: BANNER_YD - 2 - e, dx: e < 6 ? (5 + r.lane * 1.6) * 0.1 : 0, dyd: -1, on: true };
    }
    const e2 = (e - fanLen) * 1.4, x = TUNNEL_X + 5 + r.lane * 1.6 - e2; // a burst of speed to the sideline
    return { x, yd: r.exitYd - e2 * 0.12, dx: -1, dyd: -0.12, on: x > -34 };
  }

  render(ctx: CanvasRenderingContext2D, host: IntroHost): void {
    const v = host.view, s = v.s;
    if (this.inBlimp) { this.renderBlimp(ctx, host); return; }
    const cam = this.cam();
    host.field(ctx, cam);
    const X = (xYd: number) => host.sx(fx(xYd));
    const Y = (yd: number) => host.sy(LOS_Y - (yd - cam) * YD);
    const home = this.info.home, away: Side = home === 'you' ? 'cpu' : 'you';
    const hc = this.info.colors[home];

    // fireworks
    for (const p of this.sparks) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
      ctx.fillStyle = p.color;
      ctx.fillRect(X(p.x), Y(p.y), 3 / HD, 3 / HD);
      ctx.fillRect(X(p.x - p.vx * 0.05), Y(p.y - p.vy * 0.05), 2 / HD, 2 / HD); // trail
      ctx.fillRect(X(p.x - p.vx * 0.1), Y(p.y - p.vy * 0.1), 1 / HD, 1 / HD);
    }
    ctx.globalAlpha = 1;
    for (const r of this.rockets) { ctx.fillStyle = '#ffe9a8'; ctx.fillRect(X(r.x), Y(r.y), 2 / HD, 4 / HD); }

    if (this.t < RUN_END + 1) {
      // the inflatable tunnel: a tube in the home colour from the wall into the end zone
      const tx0 = X(TUNNEL_X - 2.4), tx1 = X(TUNNEL_X + 2.4), ty0 = Y(110 + 3.2), ty1 = Y(TUNNEL_YD);
      ctx.fillStyle = shade(hc[0], -0.2); ctx.fillRect(tx0, ty0, tx1 - tx0, ty1 - ty0);
      ctx.fillStyle = hc[0];
      for (let y = ty0; y < ty1; y += 2) ctx.fillRect(tx0, y, tx1 - tx0, 1); // ribs
      ctx.fillStyle = hc[1]; ctx.fillRect(tx0, ty0, 1, ty1 - ty0); ctx.fillRect(tx1 - 1, ty0, 1, ty1 - ty0);
      ctx.fillStyle = '#0b1220'; ctx.fillRect(tx0 + 1.5, ty1 - 2, tx1 - tx0 - 3, 2); // the mouth
      // smoke
      for (const p of this.puffs) {
        ctx.globalAlpha = p.life * 0.55;
        ctx.fillStyle = '#c2c3c7';
        ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), p.r * YD * s * 0.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // the band on the field (until the toss)
    if (this.band.length && this.t < RUN_END + 0.6) this.drawBand(ctx, X, Y, s);

    // the runners, the banner between them
    const people = this.runners.map((r) => ({ r, at: this.runnerAt(r) })).filter((p) => p.at.on).sort((a, b) => b.at.yd - a.at.yd);
    const drawRunner = ({ r, at }: (typeof people)[number]) => {
      const side = Math.abs(at.dx) > 0.6;
      const facing = side ? (at.dx < 0 ? 'left' : 'right') : 'down';
      const frame = Math.floor(((this.t - r.delay) * RUN_SPEED) / 1.1) & 3;
      const { img } = hdPlayer({ team: this.kits[home], build: r.build, facing, pose: 'run', frame, lean: 0, num: r.num, skin: r.skin });
      const w = (img.width / HD) * s, h = (img.height / HD) * s, x = X(at.x), y = Y(at.yd);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(x, y + h / 2 - 1.5, w * 0.36, s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.drawImage(img, Math.round((x - w / 2) * HD) / HD, Math.round((y - h / 2 - 1) * HD) / HD, w, h);
    };
    for (const p of people) if (p.at.yd > BANNER_YD) drawRunner(p);
    if (!this.torn && this.t < RUN_END) this.drawBanner(ctx, X, Y, s);
    for (const b of this.bits) {
      ctx.globalAlpha = Math.min(1, b.life * 1.5); ctx.fillStyle = b.color;
      ctx.fillRect(X(b.x), Y(b.y), 2 / HD, 2 / HD);
    }
    ctx.globalAlpha = 1;
    for (const p of people) if (p.at.yd <= BANNER_YD) drawRunner(p);

    // the coin toss at midfield
    if (this.t >= RUN_END + 0.3) this.drawToss(ctx, v, home, away);

    // captions
    if (this.t < PAN_END + 0.4) this.titleCard(ctx, v, home, away);
    else if (this.t < RUN_END - 0.3) this.caption(ctx, v, `HERE COME THE ${this.info.mascots[home]}`, this.t - PAN_END - 0.4);
    if (this.t > 0.6) drawText(ctx, 'TAP TO SKIP', v.w - 3, v.h - 8, { align: 'right', color: 'rgba(255,241,232,0.55)' });
  }

  /** The opening blimp shot: the whole stadium, a caption, the matchup. */
  private renderBlimp(ctx: CanvasRenderingContext2D, host: IntroHost): void {
    const v = host.view, home = this.info.home, away: Side = home === 'you' ? 'cpu' : 'you';
    drawBlimp(ctx, v, { ...host.crowd(), stunt: false }, this.info.abbrs[home], this.pre);
    const k = ease(this.pre / 0.5);
    ctx.globalAlpha = k;
    ctx.fillStyle = 'rgba(11,18,32,0.82)'; ctx.fillRect(0, 0, v.w, 22);
    ctx.fillStyle = C.yellow; ctx.fillRect(0, 22, v.w, 1);
    drawText(ctx, `LIVE FROM ${this.info.names[home]}`, v.w / 2, 4, { align: 'center', color: C.yellow });
    drawText(ctx, `${this.info.abbrs[away]} AT ${this.info.abbrs[home]} - ${this.info.top}`.slice(0, Math.floor(v.w / 4)), v.w / 2, 13, { align: 'center', color: C.white });
    ctx.globalAlpha = 1;
    if (this.pre > 0.6) drawText(ctx, 'TAP TO SKIP', v.w - 3, v.h - 8, { align: 'right', color: 'rgba(255,241,232,0.55)' });
  }

  /** The marching band: the school's letters on the field, in uniform, marking time; a drum major out front. */
  private drawBand(ctx: CanvasRenderingContext2D, X: (x: number) => number, Y: (y: number) => number, s: number): void {
    const [c0, c1] = this.info.colors[this.info.home], px = 2 / HD; // each bandsman about player size
    const lum = (h: string) => { const n = parseInt(h.slice(1), 16); return 0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255); };
    const hat = Math.abs(lum(c1) - lum(c0)) > 60 ? c1 : '#fff1e8';
    const step = Math.floor(this.t * 4) & 1; // marking time
    const fade = this.t > RUN_END ? Math.max(0, 1 - (this.t - RUN_END) / 0.6) : 1;
    ctx.globalAlpha = fade;
    const member = (x: number, y: number, i: number, major = false) => {
      const lift = (step + i) & 1 ? px : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x - px, y + 2 * px, 4 * px, px); // shadow
      ctx.fillStyle = '#1d1d24'; ctx.fillRect(x, y - lift, px, 2 * px); ctx.fillRect(x + 2 * px, y - (lift ? 0 : px), px, 2 * px); // legs
      ctx.fillStyle = major ? '#fff1e8' : c0; ctx.fillRect(x, y - 4 * px, 3 * px, 3 * px); // the coat
      ctx.fillStyle = '#fff1e8'; ctx.fillRect(x + px, y - 4 * px, px, 3 * px); // the cross belt
      ctx.fillStyle = hat; ctx.fillRect(x, y - 7 * px, 3 * px, 3 * px); // the shako
      ctx.fillStyle = major ? c0 : '#fff1e8'; ctx.fillRect(x + px, y - 9 * px, px, 2 * px); // the plume
      if (!major && i % 3 === 0) { ctx.fillStyle = '#ffec27'; ctx.fillRect(x + 3 * px, y - 4 * px, px, px); } // a horn catching the light
    };
    this.band.forEach((b, i) => member(X(b.x) - 1.5 * px, Y(b.yd), i));
    member(X(0) - 1.5 * px, Y(BAND_YD - 3), 0, true);
    ctx.globalAlpha = 1;
    void s;
  }

  private drawBanner(ctx: CanvasRenderingContext2D, X: (x: number) => number, Y: (y: number) => number, s: number): void {
    const hc = this.info.colors[this.info.home];
    const x0 = X(TUNNEL_X - 7), x1 = X(TUNNEL_X + 7), y = Y(BANNER_YD), h = 9 * s;
    // the two holders' poles
    ctx.fillStyle = '#c2c3c7'; ctx.fillRect(x0 - 1, y - h - 1, 1, h + 3); ctx.fillRect(x1, y - h - 1, 1, h + 3);
    const sway = Math.sin(this.t * 6) * 0.4;
    ctx.fillStyle = hc[0]; ctx.fillRect(x0, y - h + sway, x1 - x0, h);
    ctx.fillStyle = hc[1]; ctx.fillRect(x0, y - h + sway, x1 - x0, 1); ctx.fillRect(x0, y - 1 + sway, x1 - x0, 1);
    const text = `GO ${this.info.mascots[this.info.home]}`;
    const tw = textWidth(text);
    const fits = tw <= x1 - x0 - 4;
    drawText(ctx, fits ? text : this.info.abbrs[this.info.home], (x0 + x1) / 2, y - h + 2 + sway, { align: 'center', color: inkOn(hc[0], hc[1]) });
  }

  /**
   * The coin toss as a TV close-up: an inset over the field at three times the
   * size (one sprite pixel = one screen pixel), the two captains facing the
   * referee at the 50, the coin flipping up and landing, then the result.
   */
  private drawToss(ctx: CanvasRenderingContext2D, v: View, home: Side, away: Side): void {
    const age = this.t - (RUN_END + 0.3);
    const k = ease(age / 0.35);
    const bw = Math.min(v.w - 12, 168), bh = 84;
    const bx = Math.round((v.w - bw) / 2), by = Math.round((v.landscape ? 22 : 96) + (1 - k) * 30);
    ctx.globalAlpha = k;
    // the grass at midfield
    ctx.fillStyle = '#00873f'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = '#00954a'; ctx.fillRect(bx, by, bw, Math.round(bh * 0.35));
    const line = by + Math.round(bh * 0.66);
    ctx.fillStyle = C.white; ctx.fillRect(bx, line, bw, 2);
    ctx.fillStyle = '#00873f'; ctx.fillRect(bx + 6, line - 4, 17, 10); ctx.fillRect(bx + bw - 23, line - 4, 17, 10);
    drawText(ctx, '50', bx + 9, line - 2, { scale: 1, color: C.white }); drawText(ctx, '50', bx + bw - 20, line - 2, { scale: 1, color: C.white });
    // the captains and the referee, big
    const mid = bx + bw / 2;
    const put = (img: HTMLCanvasElement, x: number, feet: number) => {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(x, feet - 2, img.width * 0.32, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.drawImage(img, Math.round(x - img.width / 2), Math.round(feet - img.height + 1), img.width, img.height);
    };
    put(hdPlayer({ team: REF_KIT, build: 'skill', facing: 'down', pose: 'stand', frame: 0, lean: 0, num: 0, skin: 2, ref: true }).img, mid, line - 4);
    put(hdPlayer({ team: this.kits[home], build: 'skill', facing: 'right', pose: 'stand', frame: 0, lean: 0, num: 7, skin: 1 }).img, mid - 34, line + 6);
    put(hdPlayer({ team: this.kits[away], build: 'skill', facing: 'left', pose: 'stand', frame: 0, lean: 0, num: 11, skin: 3 }).img, mid + 34, line + 6);
    // the coin: up, flipping, and down on the grass
    const ct = this.t - (RUN_END + 1.0);
    if (ct > 0) {
      const f = Math.min(1, ct / 1.2), hgt = Math.sin(f * Math.PI) * 44;
      const x = mid + 9, y = line - 14 - hgt + f * 12;
      const flip = f < 1 ? Math.floor(ct * 16) % 4 : 0;
      const w = [4, 2, 1, 2][flip];
      ctx.fillStyle = flip === 2 ? '#8a6d00' : '#c9a400'; ctx.fillRect(Math.round(x - w / 2), y, w, 4);
      if (w >= 2) { ctx.fillStyle = C.yellow; ctx.fillRect(Math.round(x - w / 2), y, w - 1, 3); }
    }
    // the frame: a TV inset
    ctx.fillStyle = C.yellow;
    ctx.fillRect(bx - 1, by - 1, bw + 2, 1); ctx.fillRect(bx - 1, by + bh, bw + 2, 1);
    ctx.fillRect(bx - 1, by, 1, bh); ctx.fillRect(bx + bw, by, 1, bh);
    ctx.fillStyle = 'rgba(11,18,32,0.9)'; ctx.fillRect(bx, by, 46, 9);
    drawText(ctx, 'COIN TOSS', bx + 3, by + 2, { color: C.yellow });
    ctx.globalAlpha = 1;
    if (ct > 1.2) {
      const r = this.receiving, generic = this.info.names.you === 'YOU';
      const v1 = generic ? (r === 'you' ? 'YOU WIN THE TOSS' : 'CPU WINS THE TOSS') : `${this.info.abbrs[r]} WINS THE TOSS`;
      this.caption(ctx, v, v1, ct - 1.2, 'AND WILL RECEIVE');
    }
  }

  private titleCard(ctx: CanvasRenderingContext2D, v: View, home: Side, away: Side): void {
    const k = ease((this.t - 0.3) / 0.5) - ease((this.t - PAN_END) / 0.4);
    if (k <= 0) return;
    const y = v.landscape ? 54 : 112, h = 64;
    const off = (1 - k) * -v.w;
    ctx.fillStyle = 'rgba(11,18,32,0.86)';
    ctx.fillRect(off, y, v.w, h);
    ctx.fillStyle = C.yellow; ctx.fillRect(off, y, v.w, 1); ctx.fillRect(off, y + h - 1, v.w, 1);
    const mid = v.w / 2 + off;
    drawText(ctx, this.info.top, mid, y + 6, { align: 'center', color: C.yellow });
    // the two schools as badges: visitors at the home team
    const badge = (side: Side, cx: number) => {
      const [c0, c1] = this.info.colors[side];
      const t = this.info.abbrs[side], tw = textWidth(t, 2) + 8;
      ctx.fillStyle = c0; ctx.fillRect(Math.round(cx - tw / 2), y + 18, tw, 16);
      ctx.fillStyle = c1; ctx.fillRect(Math.round(cx - tw / 2), y + 32, tw, 2);
      drawText(ctx, t, cx, y + 21, { scale: 2, align: 'center', color: inkOn(c0, c1) });
    };
    badge(away, mid - 42);
    badge(home, mid + 42);
    const tags = this.info.tags;
    if (tags) {
      drawText(ctx, tags[away], mid - 42, y + 36, { align: 'center', color: C.yellow });
      drawText(ctx, tags[home], mid + 42, y + 36, { align: 'center', color: C.yellow });
    }
    drawText(ctx, 'AT', mid, y + 23, { scale: 1, align: 'center', color: C.grey });
    const line = `${this.info.mascots[away]} AT ${this.info.mascots[home]}`;
    drawText(ctx, textWidth(line) < v.w - 8 ? line : `${this.info.abbrs[away]} AT ${this.info.abbrs[home]}`, mid, y + (tags ? 46 : 44), { align: 'center', color: C.white });
    const sub = this.info.college ? (this.info.big ? 'SATURDAY NIGHT: THE WHOLE COUNTRY IS WATCHING' : 'COLLEGE FOOTBALL SATURDAY') : this.info.big ? 'BIG NIGHT UNDER THE LIGHTS' : 'KICKOFF IS MOMENTS AWAY';
    drawText(ctx, textWidth(sub) < v.w - 6 ? sub : 'PRIMETIME SATURDAY', mid, y + 55, { align: 'center', color: C.grey });
  }

  /** A lower-third caption that slides up. */
  private caption(ctx: CanvasRenderingContext2D, v: View, text: string, age: number, sub?: string): void {
    if (age < 0) return;
    const k = ease(age / 0.3), w = v.w, h = sub ? 22 : 13;
    const y = Math.round(v.h - (v.landscape ? 16 : 26) - h + (1 - k) * 12);
    ctx.globalAlpha = k;
    ctx.fillStyle = 'rgba(11,18,32,0.86)'; ctx.fillRect(0, y, w, h);
    ctx.fillStyle = C.yellow; ctx.fillRect(0, y, w, 1);
    drawText(ctx, text, w / 2, y + 4, { align: 'center', color: C.white });
    if (sub) drawText(ctx, sub, w / 2, y + 13, { align: 'center', color: C.yellow });
    ctx.globalAlpha = 1;
  }
}

const REF_KIT = { jersey: '#fff1e8', trim: '#111d2b', helmet: '#fff1e8', pants: '#1d1d24' };

/** Text colour for a school colour background. */
function inkOn(bg: string, alt: string): string {
  const lum = (c: string) => { const n = parseInt(c.slice(1), 16); return 0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255); };
  if (Math.abs(lum(alt) - lum(bg)) > 90) return alt;
  return lum(bg) > 140 ? '#111d2b' : '#fff1e8';
}

export const INTRO_LENGTH = TOSS_END;
