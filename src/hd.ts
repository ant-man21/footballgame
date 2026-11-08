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
export type Facing = 'up' | 'down';
/** stand / run (with frame 0-3) / stance (3-point) / block / throw / hold / carry / catch / down (on the ground). */
export type Pose = 'stand' | 'run' | 'stance' | 'block' | 'throw' | 'hold' | 'carry' | 'catch' | 'down';

const OUTLINE = '#111d2b';
const SHOE = '#1d1d24';
const MASK = '#c2c3c7';
const BALL = '#9b4a2c', BALL_HI = '#c46a3f', LACE = '#fff1e8';
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

function football(g: Grid, x: number, y: number, laces: boolean): void { // 4 x 3 at (x, y)
  g.rect(x + 1, y, 2, 1, BALL); g.rect(x, y + 1, 4, 1, BALL); g.rect(x + 1, y + 2, 2, 1, BALL);
  g.set(x + 1, y, BALL_HI);
  if (laces) g.set(x + 2, y + 1, LACE);
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
    case 'carry': arm(-1, swing[0] as 'down'); arm(1, 'tuck'); football(g, cx + 1, ty + 2, false); break;
    case 'stance': arm(-1, 'down'); arm(1, big ? 'ground' : 'down'); break;
    case 'block': arm(-1, 'out'); arm(1, 'out'); break;
    case 'catch': arm(-1, 'up'); arm(1, 'up'); break;
    case 'hold': arm(-1, 'tuck'); arm(1, 'tuck'); football(g, cx - 1, ty + 2, true); break;
    case 'throw':
      arm(-1, 'out'); arm(1, 'high');
      football(g, sx + sw, ty - 7, true);
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

const cache = new Map<string, HTMLCanvasElement>();
const teamKey = (t: TeamColor) => (typeof t === 'string' ? t : `${t.jersey}${t.trim}${t.helmet}${t.pants}`);

/** A baked HD player (sprite pixels = canvas pixels; draw it at 1/HD logical px per pixel). */
export function hdPlayer(l: PlayerLook): HTMLCanvasElement {
  const run = l.pose === 'run' || l.pose === 'carry';
  const key = `${teamKey(l.team)}/${l.build}/${l.facing}/${l.pose}/${run ? l.frame & 3 : 0}/${l.lean}/${l.num}/${l.skin}`;
  let img = cache.get(key);
  if (!img) {
    if (l.pose === 'down') {
      const g = drawPlayer({ ...l, pose: 'stand', lean: 0 }).rotated();
      img = g.bake();
    } else img = drawPlayer(l).bake();
    cache.set(key, img);
  }
  return img;
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
