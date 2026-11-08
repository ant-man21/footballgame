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
}

/**
 * Draws one player. Sizes (in sprite pixels, before the outline): skill players
 * are 11 wide at the shoulders and about 19 tall, linemen 15 wide.
 */
function drawPlayer(l: PlayerLook): Grid {
  const big = l.build === 'big';
  const W = big ? 21 : 17, H = 24;
  const g = new Grid(W, H);
  const p = palette(l.team, l.build, SKINS[l.skin % SKINS.length]);
  const cx = Math.floor(W / 2);
  const front = l.facing === 'down';
  const pose = l.pose;
  const run = pose === 'run' || pose === 'carry';
  const f = l.frame & 3;
  const bob = run && (f === 1 || f === 3) ? -1 : 0;
  const crouch = pose === 'stance' ? 3 : pose === 'block' ? 1 : 0;
  const lean = l.lean;

  const sw = big ? 7 : 5; // half shoulder width
  const tw = big ? 5 : 4; // half torso width
  const hy = 1 + bob + crouch; // helmet top
  const ty = hy + 6; // shoulders
  const py = ty + 6; // pants
  const ly = py + 3; // legs

  // legs and shoes (drawn first so the body overlaps them)
  const legW = big ? 4 : 3;
  const legGap = big ? 1 : 1;
  const stanceWide = pose === 'stance' || pose === 'block' ? 1 : 0;
  for (const side of [-1, 1] as const) {
    let len = 3; // sock length
    if (run) { // stride: one leg reaches, the other pushes off
      const reach = (f === 0 && side < 0) || (f === 2 && side > 0);
      const push = (f === 0 && side > 0) || (f === 2 && side < 0);
      len = reach ? (front ? 4 : 2) : push ? (front ? 2 : 4) : 3;
    }
    const lx = side < 0 ? cx - legGap - legW + 1 - stanceWide : cx + legGap + stanceWide;
    const top = ly;
    g.rect(lx, top, legW, len - 1, p.pants); // thigh
    g.rect(lx, top + len - 1, legW, 2, p.sock);
    if (side > 0) g.set(lx + legW - 1, top + len - 1, shade(p.sock, -0.25));
    g.rect(lx, top + len + 1, legW, 1, SHOE);
  }

  // pants
  const pw = big ? 5 : 4;
  g.rect(cx - pw + 1, py, pw * 2 - 1, 3, p.pants);
  g.rect(cx + pw - 2, py, 1, 3, p.pantsLo);
  g.set(cx - pw + 1, py, p.stripe); g.set(cx - pw + 1, py + 1, p.stripe); // pant stripes
  g.set(cx + pw - 1, py, p.stripe); g.set(cx + pw - 1, py + 1, p.stripe);
  g.rect(cx - pw + 1, py, pw * 2 - 1, 1, p.pantsLo); // belt line
  g.set(cx, py, p.stripe);

  // torso and shoulder pads
  const sx = cx + lean;
  g.rect(cx - tw, ty + 2, tw * 2 + 1, 4, p.jersey);
  g.rect(sx - sw, ty, sw * 2 + 1, 2, p.jersey);
  g.rect(sx - sw + 1, ty, sw * 2 - 1, 1, p.jerseyHi); // pads catch the light
  g.rect(cx + tw - 1, ty + 2, 2, 4, p.jerseyLo); // shaded side
  g.rect(cx - tw, ty + 5, tw * 2 + 1, 1, p.jerseyLo);
  digits(g, l.num, cx + (lean > 0 ? 1 : 0), ty + (front ? 1 : 1), p.num);

  // arms
  const arm = (side: -1 | 1, kind: 'down' | 'swing-f' | 'swing-b' | 'up' | 'out' | 'ground' | 'tuck' | 'high') => {
    const ax = sx + side * (sw + 1);
    switch (kind) {
      case 'down': g.rect(ax, ty + 1, 1, 2, p.jersey); g.rect(ax, ty + 3, 1, 2, p.skin); break;
      case 'swing-f': g.rect(ax, ty + 1, 1, 2, p.jersey); g.rect(ax, ty + 3, 1, 3, p.skin); break;
      case 'swing-b': g.rect(ax, ty, 1, 2, p.jersey); g.rect(ax, ty + 2, 1, 1, p.skin); break;
      case 'ground': g.rect(ax, ty + 1, 1, 2, p.jersey); g.rect(ax, ty + 3, 1, 6, p.skin); g.set(ax, ty + 9, p.skin); break;
      case 'tuck': g.rect(ax, ty + 1, 1, 2, p.jersey); g.rect(ax - side, ty + 3, 1, 1, p.skin); break;
      case 'out': // hands out front: punch / engage
        g.rect(ax, ty, 1, 2, p.jersey);
        if (front) { g.rect(ax - side, ty + 2, 1, 1, p.jersey); g.rect(ax - side * 2, ty + 3, 2, 1, p.skin); }
        else { g.rect(ax, ty - 2, 1, 2, p.skin); g.set(ax - side, ty - 3, p.skin); }
        break;
      case 'up': // reaching for a ball
        g.rect(ax, ty - 2, 1, 3, p.jersey); g.rect(ax - side, ty - 5, 1, 3, p.skin); g.rect(ax - side, ty - 6, 1, 1, p.skin);
        break;
      case 'high': // throwing arm cocked back over the shoulder
        g.rect(ax, ty - 1, 1, 2, p.jersey); g.rect(ax, ty - 4, 1, 3, p.skin);
        break;
    }
  };
  const swing = f === 0 ? ['swing-b', 'swing-f'] : f === 2 ? ['swing-f', 'swing-b'] : ['down', 'down'];
  switch (pose) {
    case 'run': arm(-1, swing[0] as 'down'); arm(1, swing[1] as 'down'); break;
    case 'carry': arm(-1, swing[0] as 'down'); arm(1, 'tuck'); g.hand = { x: cx + 2, y: ty + 3 }; break;
    case 'stance': arm(-1, 'down'); arm(1, big ? 'ground' : 'down'); break;
    case 'block': arm(-1, 'out'); arm(1, 'out'); break;
    case 'catch': arm(-1, 'up'); arm(1, 'up'); break;
    case 'hold': arm(-1, 'tuck'); arm(1, 'tuck'); g.hand = { x: cx, y: ty + 3 }; break;
    case 'throw':
      arm(-1, 'out'); arm(1, 'high');
      g.hand = { x: sx + sw + 1, y: ty - 5 };
      break;
    default: arm(-1, 'down'); arm(1, 'down');
  }

  // helmet
  const hx = cx + lean * 2;
  g.rect(hx - 2, hy, 5, 1, p.helmet);
  g.rect(hx - 3, hy + 1, 7, 4, p.helmet);
  g.rect(hx - 2, hy + 5, 5, 1, p.helmetLo);
  g.rect(hx + 2, hy + 2, 1, 3, p.helmetLo);
  g.set(hx - 2, hy + 1, p.helmetHi); g.set(hx - 1, hy + 1, p.helmetHi); g.set(hx - 2, hy + 2, p.helmetHi);
  if (front) {
    g.rect(hx - 2, hy + 3, 5, 2, p.skin); // face
    g.set(hx - 1, hy + 3, OUTLINE); g.set(hx + 1, hy + 3, OUTLINE); // eyes
    g.rect(hx - 2, hy + 4, 5, 1, MASK); // facemask bar
    g.set(hx, hy + 5, MASK); g.set(hx - 2, hy + 5, MASK); g.set(hx + 2, hy + 5, MASK);
    g.set(hx, hy, p.stripe); g.set(hx, hy + 1, p.stripe); g.set(hx, hy + 2, p.stripe);
  } else {
    g.set(hx, hy, p.stripe); g.set(hx, hy + 1, p.stripe); g.set(hx, hy + 2, p.stripe); g.set(hx, hy + 3, p.stripe); g.set(hx, hy + 4, p.stripe);
    g.set(hx - 3, hy + 4, MASK); g.set(hx + 3, hy + 4, MASK); // the mask peeks out at the sides
    g.rect(hx - 1, hy + 6, 3, 1, p.skin); // neck
  }

  g.outline();
  return g;
}


/** Thick pixel line (legs and arms in the side view). */
function limb(g: Grid, x0: number, y0: number, x1: number, y1: number, w: number, c: string): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n);
    g.rect(x, y, w, 1, c);
  }
}

/**
 * Side view, facing right (mirrored for left): a profile with the facemask in
 * front, a forward lean, and legs that scissor through a 4-frame stride.
 */
function drawSide(l: PlayerLook): Grid {
  const big = l.build === 'big';
  const W = big ? 21 : 17, H = 24;
  const g = new Grid(W, H);
  const p = palette(l.team, l.build, SKINS[l.skin % SKINS.length]);
  const cx = Math.floor(W / 2) - 1;
  const pose = l.pose;
  const f = l.frame & 3;
  const bob = f === 1 || f === 3 ? -1 : 0;
  const hy = 1 + bob + (pose === 'block' ? 1 : 0);
  const ty = hy + 6, py = ty + 6, ly = py + 3;
  const half = big ? 3 : 2; // half body depth (narrower than the shoulders seen from behind)
  const lw = big ? 3 : 2; // leg thickness
  const sockFar = shade(p.sock, -0.3), pantsFar = shade(p.pants, -0.3);

  // legs: far leg first (darker), near leg over it
  const leg = (near: boolean, footX: number, footY: number, kneeX: number) => {
    const pc = near ? p.pants : pantsFar, sc = near ? p.sock : sockFar;
    const hipX = cx - 1 + (near ? 0 : -1);
    limb(g, hipX, ly, kneeX, ly + 2, lw, pc);
    limb(g, kneeX, ly + 2, footX, footY - 1, lw, sc);
    g.rect(footX, footY, lw + 1, 1, SHOE); // cleat points forward
  };
  const stride = pose === 'run' || pose === 'carry' || pose === 'catch';
  type Leg = [number, number, number]; // foot x, foot y, knee x
  const front: Leg = [cx + 3, ly + 5, cx + 2], back: Leg = [cx - 5, ly + 4, cx - 3];
  const plant: Leg = [cx, ly + 5, cx], swing: Leg = [cx - 3, ly + 3, cx + 1];
  let near: Leg, far: Leg;
  if (!stride) { near = [cx + 1, ly + 5, cx]; far = [cx - 2, ly + 5, cx - 2]; }
  else if (f === 0) { near = front; far = back; }
  else if (f === 2) { near = back; far = front; }
  else if (f === 1) { near = plant; far = swing; }
  else { near = swing; far = plant; }
  leg(false, ...far);
  leg(true, ...near);

  // pants
  g.rect(cx - half, py, half * 2 + 1, 3, p.pants);
  g.rect(cx - half, py, half * 2 + 1, 1, p.pantsLo);
  g.rect(cx - 1, py + 1, 1, 2, p.stripe); // side stripe

  // far arm (behind the body)
  const armFar = shade(p.jersey, -0.35), skinFar = shade(p.skin, -0.25);
  const swingF = f === 0 ? 1 : f === 2 ? -1 : 0; // near arm forward on 0, back on 2
  if (pose === 'run') { limb(g, cx, ty + 1, cx - 3 * swingF, ty + 3, 1, armFar); g.set(cx - 3 * swingF, ty + 4, skinFar); }

  // torso: leaning into the run
  const lean = pose === 'block' ? 2 : 1;
  for (let r = 0; r < 6; r++) {
    const off = Math.round(lean * (1 - r / 5));
    g.rect(cx - half + off, ty + r, half * 2 + 1, 1, p.jersey);
    g.set(cx - half + off, ty + r, p.jerseyLo); // back
  }
  g.rect(cx - half + lean - 1, ty, half * 2 + 3, 2, p.jersey); // shoulder pad
  g.rect(cx - half + lean, ty, half * 2 + 1, 1, p.jerseyHi);
  g.rect(cx + lean - 1, ty + 2, 3, 1, p.stripe); // sleeve stripe
  g.rect(cx - half, ty + 5, half * 2 + 1, 1, p.jerseyLo);

  // near arm
  const sh = { x: cx + lean, y: ty + 1 };
  switch (pose) {
    case 'carry': // ball tucked high and tight
      limb(g, sh.x, sh.y, sh.x + 1, sh.y + 2, 1, p.jersey); g.set(sh.x + 2, sh.y + 3, p.skin);
      g.hand = { x: sh.x + 2, y: sh.y + 2 };
      break;
    case 'block':
      limb(g, sh.x, sh.y, sh.x + 3, sh.y + 1, 1, p.jersey); g.rect(sh.x + 4, sh.y, 1, 2, p.skin);
      break;
    case 'catch':
      limb(g, sh.x, sh.y, sh.x + 2, sh.y - 3, 1, p.jersey); g.rect(sh.x + 3, sh.y - 5, 1, 2, p.skin);
      break;
    default: {
      const hx = sh.x + 3 * swingF;
      limb(g, sh.x, sh.y, hx, sh.y + 2, 1, p.jersey); g.rect(hx, sh.y + 3, 1, 1, p.skin);
    }
  }

  // helmet in profile: a dome, the stripe running front to back, the facemask cage out front
  const hx = cx + lean; // middle of the helmet shell
  g.rect(hx - 2, hy, 5, 1, p.helmet);
  g.rect(hx - 3, hy + 1, 7, 3, p.helmet);
  g.rect(hx - 3, hy + 4, 6, 1, p.helmet);
  g.rect(hx - 2, hy + 5, 4, 1, p.helmetLo);
  g.set(hx - 3, hy + 4, p.helmetLo); g.set(hx - 3, hy + 3, p.helmetLo); // back of the shell in shade
  g.rect(hx - 2, hy, 4, 1, p.stripe); g.set(hx - 3, hy + 1, p.stripe); // stripe over the crown
  g.set(hx - 1, hy + 1, p.helmetHi); g.set(hx, hy + 1, p.helmetHi); g.set(hx + 1, hy + 1, p.helmetHi);
  g.set(hx - 1, hy + 3, p.helmetLo); // ear hole
  g.rect(hx + 3, hy + 2, 1, 3, p.skin); // face behind the cage
  g.set(hx + 3, hy + 2, INK); // eye
  g.rect(hx + 4, hy + 2, 1, 4, MASK); // facemask cage
  g.rect(hx + 3, hy + 4, 2, 1, MASK);
  g.set(hx + 3, hy + 5, MASK);
  g.rect(hx - 1, hy + 6, 2, 1, p.skin); // neck

  g.outline();
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
  const key = `${teamKey(look.team)}/${look.build}/${look.facing}/${look.pose}/${run ? look.frame & 3 : 0}/${look.lean}/${look.num}/${look.skin}`;
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
