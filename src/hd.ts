// HD pixel art: players, the ball and the grass drawn on a 3x finer pixel grid
// (HD = 3 canvas pixels per logical pixel). The HUD and text still draw in
// logical pixels, so they stay as chunky as before; only the field and the
// players gain detail. Players are a 3/4 top-down view (offense shows its
// backs and numbers, the defense shows facemasks) with poses and a run cycle.
import { C } from './config';
import { type Kit, type TeamColor, shade } from './sprites';

/** Canvas pixels per logical pixel. */
export const HD = 3;

export type Build = 'qb' | 'skill' | 'big';
/** up = his back to you (offense), down = facing you (defense), left/right = side view, running across. */
export type Facing = 'up' | 'down' | 'left' | 'right';
/** stand / run (with frame 0-3) / stance (3-point) / block / throw / hold / carry / catch / down (on the ground). */
export type Pose = 'stand' | 'run' | 'stance' | 'block' | 'throw' | 'hold' | 'carry' | 'catch' | 'down';

const OUTLINE = '#111d2b';
const SHOE = '#1d1d24';
const MASK = '#c2c3c7';
const BALL = '#9b4a2c', BALL_HI = '#c46a3f', LACE = '#fff1e8';
const INK = OUTLINE;
export const SKINS = ['#f1c7a1', '#d9a06f', '#a86d45', '#7a4b2e', '#5a3620'];

const DIGITS: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001110',
};

const DEFAULT_KITS: Record<'blue' | 'red', Kit> = {
  blue: { jersey: '#29adff', trim: '#fff1e8', helmet: '#1d2b53', pants: '#fff1e8' },
  red: { jersey: '#ff004d', trim: '#fff1e8', helmet: '#7e2553', pants: '#5f574f' },
};
const kitOf = (t: TeamColor): Kit => (typeof t === 'string' ? DEFAULT_KITS[t] : t);

interface Pal {
  helmet: string; helmetHi: string; helmetLo: string; stripe: string;
  jersey: string; jerseyHi: string; jerseyLo: string; num: string;
  pants: string; pantsLo: string; sock: string; skin: string;
}

const lum = (c: string) => { const n = parseInt(c.slice(1), 16); return 0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255); };
/** How well a number reads on a jersey (brightness difference). */
const contrast = (a: string, b: string) => Math.abs(lum(a) - lum(b));

function palette(t: TeamColor, build: Build, skin: string): Pal {
  const k = kitOf(t);
  const white = k.jersey === '#fff1e8';
  const helmet = build === 'qb' ? C.yellow : k.helmet; // the QB keeps his yellow helmet: you find him at a glance
  return {
    helmet, helmetHi: shade(helmet, 0.45), helmetLo: shade(helmet, -0.35), stripe: build === 'qb' ? k.helmet : k.trim,
    jersey: k.jersey, jerseyHi: shade(k.jersey, 0.3), jerseyLo: white ? '#c2c3c7' : shade(k.jersey, -0.3),
    num: [k.trim, '#fff1e8', '#111d2b'].reduce((best, c) => (contrast(c, k.jersey) > contrast(best, k.jersey) + 60 ? c : best)),
    pants: k.pants, pantsLo: shade(k.pants, -0.28), sock: white ? k.trim : k.jersey, skin,
  };
}

/** A small pixel grid with an automatic dark outline. */
class Grid {
  px: (string | null)[];
  hand: { x: number; y: number } | null = null; // where the ball goes when he has it
  constructor(public w: number, public h: number) { this.px = new Array(w * h).fill(null); }
  set(x: number, y: number, c: string): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: string): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  get(x: number, y: number): string | null {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x] : null;
  }
  outline(): void {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.get(x, y)) continue;
      if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push(y * this.w + x);
    }
    for (const i of add) this.px[i] = OUTLINE;
  }
  /** Darkens the edge pixels a touch: the shape reads without a black outline. */
  soften(): void {
    const edge: number[] = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (!this.get(x, y)) continue;
      if (!this.get(x - 1, y) || !this.get(x + 1, y) || !this.get(x, y + 1)) edge.push(y * this.w + x);
    }
    for (const i of edge) { const c = this.px[i]!; if (c !== SHOE && c !== INK) this.px[i] = shade(c, -0.18); }
  }
  /** Rotated a quarter turn (a player lying on the ground). */
  rotated(): Grid {
    const g = new Grid(this.h, this.w);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) g.set(this.h - 1 - y, x, this.get(x, y) ?? '');
    g.px = g.px.map((c) => c || null);
    return g;
  }
  /** Mirrored left to right (a side view facing the other way). */
  mirrored(): Grid {
    const g = new Grid(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) g.px[y * this.w + x] = this.get(this.w - 1 - x, y);
    g.hand = this.hand && { x: this.w - 1 - this.hand.x, y: this.hand.y };
    return g;
  }
  bake(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    const ctx = c.getContext('2d')!;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const p = this.get(x, y);
      if (p) { ctx.fillStyle = p; ctx.fillRect(x, y, 1, 1); }
    }
    return c;
  }
}

function digits(g: Grid, n: number, cx: number, y: number, color: string): void {
  const s = String(n);
  const w = s.length * 4 - 1;
  let x = cx - Math.floor(w / 2);
  for (const ch of s) {
    const d = DIGITS[ch];
    for (let i = 0; i < 15; i++) if (d[i] === '1') g.set(x + (i % 3), y + Math.floor(i / 3), color);
    x += 4;
  }
}

export interface PlayerLook {
  team: TeamColor; build: Build; facing: Facing; pose: Pose;
  frame: number; // run cycle 0-3
  lean: -1 | 0 | 1; // moving sideways: head and shoulders lead
  num: number;
  skin: number; // index into SKINS
  ref?: boolean; // the referee: striped shirt, no number, no facemask
}

type Arm = 'down' | 'fwd' | 'back' | 'ground' | 'up' | 'high' | 'out' | 'tuck' | 'hold';

/**
 * Draws one player, front (facing down) or back (facing up): a big helmet,
 * wide shoulder pads, a short torso with the number, 2-pixel arms that hang
 * at his sides and swing, and short sturdy legs. Skill players are 15 sprite
 * pixels across the pads, linemen 19.
 */
function drawPlayer(l: PlayerLook): Grid {
  const big = l.build === 'big';
  const W = big ? 25 : 19, H = 26;
  const g = new Grid(W, H);
  const p = palette(l.team, l.build, SKINS[l.skin % SKINS.length]);
  const cx = Math.floor(W / 2);
  const front = l.facing === 'down';
  const pose = l.pose;
  const run = pose === 'run' || pose === 'carry';
  const f = l.frame & 3;
  const bob = run && (f === 1 || f === 3) ? -1 : 0;
  const crouch = pose === 'stance' ? 2 : pose === 'block' ? 1 : 0;
  const sw = big ? 9 : 7, tw = big ? 7 : 5, aw = big ? 3 : 2, pw = big ? 6 : 4, lw = big ? 5 : 4;
  const hy = 3 + bob + crouch, ty = hy + 6, py = ty + 7, ly = py + 3;
  const hx = cx + l.lean;
  const hand = shade(p.skin, -0.18);
  const spread = pose === 'stance' || pose === 'block' ? 1 : 0;

  // legs: a knee of pants, socks, cleats; striding legs reach and push
  for (const side of [-1, 1] as const) {
    let len = 2;
    if (run) {
      const reach = (f === 0 && side < 0) || (f === 2 && side > 0);
      const push = (f === 0 && side > 0) || (f === 2 && side < 0);
      if (reach) len = front ? 3 : 1;
      if (push) len = front ? 1 : 3;
    }
    const x = side < 0 ? cx - pw - spread : cx + pw - lw + 1 + spread;
    g.rect(x, ly, lw, 1, p.pants);
    g.rect(x, ly + 1, lw, len, p.sock);
    g.rect(side < 0 ? x : x + lw - 1, ly + 1, 1, len, shade(p.sock, -0.25));
    g.rect(x, ly + 1 + len, lw, 1, SHOE);
  }

  // pants with side stripes and a belt
  g.rect(cx - pw, py, pw * 2 + 1, 3, p.pants);
  g.rect(cx + pw - 1, py, 2, 3, p.pantsLo);
  g.rect(cx - pw, py, pw * 2 + 1, 1, shade(p.jersey, -0.35));
  g.rect(cx - pw, py + 1, 1, 2, p.stripe); g.rect(cx + pw, py + 1, 1, 2, p.stripe);

  // torso and number
  g.rect(cx - tw, ty + 1, tw * 2 + 1, 6, p.jersey);
  g.rect(cx + tw - 1, ty + 1, 2, 6, p.jerseyLo);
  if (!l.ref) digits(g, l.num, cx, ty + 2, p.num);

  // shoulder pads: wide and rounded, lit on top
  g.rect(cx - sw + 1, ty, sw * 2 - 1, 1, p.jerseyHi);
  g.rect(cx - sw, ty + 1, sw * 2 + 1, 2, p.jersey);
  g.rect(cx + sw - 1, ty + 1, 2, 2, p.jerseyLo);
  g.rect(cx - sw + 1, ty + 1, 2, 1, p.jerseyHi);

  // arms
  const arm = (side: -1 | 1, kind: Arm) => {
    const x = side < 0 ? cx - sw : cx + sw - aw + 1; // the arm's columns, outside the torso
    const sleeve = (y: number, h: number) => { g.rect(x, y, aw, h, p.jersey); g.rect(x, y + h - 1, aw, 1, p.stripe); };
    switch (kind) {
      case 'down': case 'fwd': case 'back': {
        const len = kind === 'down' ? 2 : (kind === 'fwd') === front ? 3 : 1;
        sleeve(ty + 1, 3); g.rect(x, ty + 4, aw, len, p.skin); g.rect(x, ty + 4 + len, aw, 1, hand);
        break;
      }
      case 'ground': sleeve(ty + 1, 3); g.rect(x, ty + 4, aw, ly + 2 - ty - 4, p.skin); g.rect(x, ly + 2, aw, 1, hand); break;
      case 'up': { // reaching up for the ball, both hands above the helmet
        const ax = side < 0 ? cx - sw + 1 : cx + sw - aw;
        g.rect(ax, ty - 2, aw, 3, p.jersey); g.rect(ax, ty - 2, aw, 1, p.stripe);
        g.rect(ax, hy - 1, aw, ty - 2 - (hy - 1), p.skin); g.rect(ax, hy - 3, aw, 2, hand);
        break;
      }
      case 'high': { // throwing arm cocked by the helmet
        const ax = cx + sw - aw;
        g.rect(ax, ty - 1, aw, 3, p.jersey); g.rect(ax, hy + 1, aw, ty - 1 - (hy + 1), p.skin); g.rect(ax, hy, aw, 1, hand);
        g.hand = { x: ax + aw - 1, y: hy - 1 };
        break;
      }
      case 'out': // arms out in front: engaging a block
        if (front) { sleeve(ty + 1, 2); g.rect(side < 0 ? cx - tw : cx + tw - 1, ty + 3, 2, 2, hand); g.rect(x, ty + 3, aw, 1, p.skin); }
        else { const ax = side < 0 ? cx - sw + 1 : cx + sw - aw; g.rect(ax, ty - 1, aw, 2, p.jersey); g.rect(ax, hy + 3, aw, 2, hand); }
        break;
      case 'tuck': case 'hold': { // forearm across the body: the ball goes in this hand
        sleeve(ty + 1, 3);
        const to = kind === 'hold' ? cx + side : cx + side * (tw - 2);
        const x0 = Math.min(x, to), x1 = Math.max(x + aw - 1, to);
        g.rect(x0, ty + 4, x1 - x0 + 1, 1, p.skin); g.rect(to, ty + 4, 1, 2, hand);
        if (kind === 'tuck' || side > 0) g.hand = { x: kind === 'hold' ? cx : to, y: ty + 4 };
        break;
      }
    }
  };
  const a = f === 0 ? ['back', 'fwd'] as const : f === 2 ? ['fwd', 'back'] as const : ['down', 'down'] as const;
  switch (pose) {
    case 'run': arm(-1, a[0]); arm(1, a[1]); break;
    case 'carry': arm(-1, a[0]); arm(1, 'tuck'); break;
    case 'stance': arm(-1, 'down'); arm(1, big ? 'ground' : 'down'); break;
    case 'block': arm(-1, 'out'); arm(1, 'out'); break;
    case 'catch': arm(-1, 'up'); arm(1, 'up'); break;
    case 'hold': arm(-1, 'hold'); arm(1, 'hold'); break;
    case 'throw': arm(-1, 'out'); arm(1, 'high'); break;
    default: arm(-1, 'down'); arm(1, 'down');
  }

  if (l.ref) { // referee stripes
    for (let y = ty; y < py; y++) for (let x = 0; x < W; x += 2) {
      const c = g.get(x, y);
      if (c === p.jersey || c === p.jerseyHi || c === p.jerseyLo) g.set(x, y, '#111d2b');
    }
  }
  // helmet: big and round, a stripe down the middle
  g.rect(hx - 2, hy, 5, 1, p.helmet);
  g.rect(hx - 3, hy + 1, 7, 1, p.helmet);
  g.rect(hx - 4, hy + 2, 9, 4, p.helmet);
  g.rect(hx - 3, hy + 6, 7, 1, p.helmetLo);
  g.rect(hx + 4, hy + 3, 1, 3, p.helmetLo); g.set(hx + 3, hy + 5, p.helmetLo);
  g.rect(hx - 2, hy + 1, 2, 1, p.helmetHi); g.set(hx - 3, hy + 2, p.helmetHi); g.set(hx - 3, hy + 3, p.helmetHi);
  if (front) {
    g.rect(hx, hy, 1, 3, p.stripe);
    g.rect(hx - 2, hy + 3, 5, 3, p.skin); // face
    g.set(hx - 1, hy + 3, INK); g.set(hx + 1, hy + 3, INK); // eyes
    if (!l.ref) {
      g.rect(hx - 3, hy + 4, 7, 1, MASK); // facemask
      g.rect(hx, hy + 4, 1, 3, MASK);
      g.rect(hx - 2, hy + 6, 5, 1, MASK);
    }
  } else {
    g.rect(hx, hy, 1, 6, p.stripe);
    g.set(hx - 4, hy + 5, MASK); g.set(hx + 4, hy + 5, MASK); // the mask shows at the sides
  }
  g.soften();
  return g;
}

/** Thick pixel line (legs in the side view). */
function limb(g: Grid, x0: number, y0: number, x1: number, y1: number, w: number, c: string): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n);
    g.rect(x, y, w, 1, c);
  }
}

/**
 * Side view, facing right (mirrored for left): the helmet in profile with the
 * facemask out front, leaning into the run, 2-pixel arms pumping and legs that
 * scissor through a 4-frame stride.
 */
function drawSide(l: PlayerLook): Grid {
  const big = l.build === 'big';
  const W = big ? 25 : 19, H = 26;
  const g = new Grid(W, H);
  const p = palette(l.team, l.build, SKINS[l.skin % SKINS.length]);
  const cx = Math.floor(W / 2) - 1;
  const pose = l.pose;
  const f = l.frame & 3;
  const moving = pose === 'run' || pose === 'carry' || pose === 'catch';
  const bob = moving && (f === 1 || f === 3) ? -1 : 0;
  const hy = 3 + bob + (pose === 'block' ? 1 : 0), ty = hy + 6, py = ty + 7, ly = py + 3;
  const d = big ? 6 : 4; // half body depth
  const lw = big ? 4 : 3;
  const lean = pose === 'block' ? 2 : moving ? 1 : 0;
  const hand = shade(p.skin, -0.18);
  const farSock = shade(p.sock, -0.3), farPants = shade(p.pants, -0.3), farSkin = shade(p.skin, -0.3), farJersey = shade(p.jersey, -0.35);

  // legs: far leg first (darker), near leg over it
  type Leg = [number, number, number]; // foot x, foot y, knee x
  const leg = (near: boolean, [fx, fy, kx]: Leg) => {
    const hip = cx - 1;
    limb(g, hip, ly, kx, ly + 1, lw, near ? p.pants : farPants);
    limb(g, kx, ly + 2, fx, fy - 1, lw, near ? p.sock : farSock);
    g.rect(fx, fy, lw + 1, 1, SHOE);
  };
  const reach: Leg = [cx + 3, ly + 4, cx + 1], push: Leg = [cx - 5, ly + 3, cx - 2];
  const plant: Leg = [cx - 1, ly + 4, cx - 1], tuck: Leg = [cx - 4, ly + 2, cx + 1];
  const stand: [Leg, Leg] = [[cx - 3, ly + 4, cx - 2], [cx, ly + 4, cx]];
  const [far, near]: [Leg, Leg] = !moving ? stand : f === 0 ? [push, reach] : f === 2 ? [reach, push] : f === 1 ? [tuck, plant] : [plant, tuck];
  leg(false, far); leg(true, near);

  // pants
  g.rect(cx - d, py, d * 2 + 1, 3, p.pants);
  g.rect(cx - d, py, d * 2 + 1, 1, shade(p.jersey, -0.35));
  g.rect(cx - d, py + 1, 1, 2, p.pantsLo);
  g.rect(cx, py + 1, 1, 2, p.stripe);

  // far arm, behind the body: swings opposite the near one
  const swing = f === 0 ? 1 : f === 2 ? -1 : 0; // near arm forward on 0, back on 2
  if (pose === 'run') g.rect(cx - 2 * swing + lean, ty + 4, 2, 2, farSkin);
  if (pose === 'run' || pose === 'carry') g.rect(cx - 1 + lean, ty + 1, 2, 2, farJersey);

  // torso and pads, leaning into the run
  for (let r = 0; r < 7; r++) {
    const off = r < 3 ? lean : r < 5 ? Math.min(lean, 1) : 0;
    g.rect(cx - d + off, ty + r, d * 2 + 1, 1, p.jersey);
    g.set(cx - d + off, ty + r, p.jerseyLo);
  }
  g.rect(cx - d - 1 + lean, ty, d * 2 + 3, 2, p.jersey); // pads stick out front and back
  g.rect(cx - d + lean, ty, d * 2 + 1, 1, p.jerseyHi);

  // near arm (2 wide): sleeve at the shoulder, then the forearm
  const sx = cx - 1 + lean;
  const sleeve = () => { g.rect(sx, ty + 1, 2, 3, p.jersey); g.rect(sx, ty + 3, 2, 1, p.stripe); };
  switch (pose) {
    case 'carry': // ball tucked high and tight
      sleeve(); g.rect(sx + 2, ty + 3, 2, 2, p.skin); g.set(sx + 4, ty + 3, hand);
      g.hand = { x: sx + 3, y: ty + 3 };
      break;
    case 'block':
      g.rect(sx, ty + 1, 2, 2, p.jersey); g.rect(sx + 2, ty + 1, 3, 2, p.skin); g.rect(sx + 5, ty, 1, 3, hand);
      break;
    case 'catch':
      g.rect(sx + 1, ty - 2, 2, 3, p.jersey); g.rect(sx + 2, hy - 1, 2, ty - 2 - (hy - 1), p.skin); g.rect(sx + 2, hy - 3, 2, 2, hand);
      break;
    case 'run': {
      sleeve();
      const fx = sx + 2 * swing;
      g.rect(fx, ty + 4, 2, 2, p.skin); g.rect(fx + (swing > 0 ? 1 : 0), ty + 6, swing ? 1 : 2, 1, hand);
      break;
    }
    default: sleeve(); g.rect(sx, ty + 4, 2, 2, p.skin); g.rect(sx, ty + 6, 2, 1, hand);
  }

  // helmet in profile: a dome, the stripe front to back, the cage out front
  const hx = cx + lean;
  g.rect(hx - 2, hy, 4, 1, p.helmet);
  g.rect(hx - 3, hy + 1, 6, 1, p.helmet);
  g.rect(hx - 4, hy + 2, 8, 4, p.helmet);
  g.rect(hx - 3, hy + 6, 5, 1, p.helmetLo);
  g.rect(hx - 4, hy + 4, 1, 2, p.helmetLo);
  g.rect(hx - 2, hy, 3, 1, p.stripe); g.rect(hx - 3, hy + 1, 1, 1, p.stripe);
  g.rect(hx - 1, hy + 1, 2, 1, p.helmetHi); g.set(hx - 2, hy + 2, p.helmetHi);
  g.set(hx - 1, hy + 4, p.helmetLo); // ear hole
  g.rect(hx + 2, hy + 3, 2, 3, p.skin); // face behind the cage
  g.set(hx + 2, hy + 3, INK); // eye
  g.rect(hx + 4, hy + 3, 1, 4, MASK); // facemask cage
  g.rect(hx + 2, hy + 5, 2, 1, MASK);
  g.soften();
  return g;
}

const cache = new Map<string, { img: HTMLCanvasElement; hand: { x: number; y: number } | null }>();
const teamKey = (t: TeamColor) => (typeof t === 'string' ? t : `${t.jersey}${t.trim}${t.helmet}${t.pants}`);

const SIDE_POSES: Pose[] = ['run', 'carry', 'block', 'catch', 'stand'];

/**
 * A baked HD player (sprite pixels = canvas pixels; draw it at 1/HD logical px
 * per pixel) and where his ball hand is, in sprite pixels, if he has the ball.
 */
export function hdPlayer(l: PlayerLook): { img: HTMLCanvasElement; hand: { x: number; y: number } | null } {
  const side = l.facing === 'left' || l.facing === 'right';
  const look = side && !SIDE_POSES.includes(l.pose) ? { ...l, facing: 'up' as Facing } : l;
  const run = look.pose === 'run' || look.pose === 'carry' || (side && look.pose === 'catch');
  const key = `${teamKey(look.team)}/${look.build}/${look.facing}/${look.pose}/${run ? look.frame & 3 : 0}/${look.lean}/${look.num}/${look.skin}/${look.ref ? 'ref' : ''}`;
  let hit = cache.get(key);
  if (!hit) {
    let g: Grid;
    if (look.pose === 'down') g = drawPlayer({ ...look, facing: 'up', pose: 'stand', lean: 0 }).rotated();
    else if (look.facing === 'right') g = drawSide(look);
    else if (look.facing === 'left') g = drawSide(look).mirrored();
    else g = drawPlayer(look);
    hit = { img: g.bake(), hand: g.hand };
    cache.set(key, hit);
  }
  return hit;
}

let balls: HTMLCanvasElement[] | null = null;
/** The ball in flight, in 4 spin frames (8 x 6 sprite pixels). */
export function hdBall(frame: number): HTMLCanvasElement {
  balls ??= [0, 1, 2, 3].map((f) => {
    const g = new Grid(8, 6);
    g.rect(2, 1, 4, 1, BALL); g.rect(1, 2, 6, 2, BALL); g.rect(2, 4, 4, 1, BALL);
    g.rect(2, 2, 2, 1, BALL_HI);
    g.set(1, 2, LACE); g.set(6, 2, LACE); g.set(1, 3, LACE); g.set(6, 3, LACE); // white stripes at the tips
    if (f !== 3) { const lx = 2 + f; g.set(lx, 2, LACE); g.set(lx + 1, 2, LACE); } // laces roll round as it spins
    g.outline();
    return g.bake();
  });
  return balls[frame & 3];
}

let grass: HTMLCanvasElement | null = null;
/** A tile of grass texture (canvas pixels, drawn as a translucent overlay on the mowing stripes). */
export function grassTile(): HTMLCanvasElement {
  if (grass) return grass;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 520; i++) { // blades: short vertical strokes, light and dark
    const x = Math.floor(rnd() * 64), y = Math.floor(rnd() * 64);
    const light = rnd() < 0.5;
    ctx.fillStyle = light ? 'rgba(160,255,170,0.10)' : 'rgba(0,30,10,0.13)';
    ctx.fillRect(x, y, 1, rnd() < 0.6 ? 2 : 1);
  }
  for (let i = 0; i < 40; i++) { // a few darker clumps
    const x = Math.floor(rnd() * 64), y = Math.floor(rnd() * 64);
    ctx.fillStyle = 'rgba(0,40,15,0.12)';
    ctx.fillRect(x, y, 2, 2);
  }
  grass = c;
  return c;
}

/** A stable jersey number and skin tone for a player (from his name and position). */
export function identity(name: string, kind: string): { num: number; skin: number } {
  let h = 2166136261;
  for (const ch of name + kind) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const ranges: Record<string, [number, number]> = {
    qb: [1, 19], wr: [1, 19], rb: [20, 49], te: [80, 89], ol: [50, 79], dl: [90, 99], lb: [40, 59], db: [20, 39],
  };
  const [lo, hi] = ranges[kind] ?? [1, 99];
  return { num: lo + (h % (hi - lo + 1)), skin: (h >>> 8) % SKINS.length };
}
