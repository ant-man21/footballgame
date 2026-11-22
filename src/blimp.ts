// The blimp shot: the whole stadium from above, at night. A rounded bowl of
// fans on all four sides (the lower bowl, a club level of lit suites, the upper
// deck), the rim and light towers, the field in the middle with the home
// school's end zones and midfield logo. Drawn once per stadium on the HD grid
// and cached; each frame adds camera flashes in the stands and a slow zoom.
// Portrait shows the field top to bottom; landscape lays it across.
import { HD } from './hd';
import { drawText, glyphMask } from './font';
import { type Crowd, padColor } from './stadium';
import type { View } from './view';

const NEUTRAL = ['#c2c3c7', '#5f574f', '#fff1e8', '#1d2b53'];
const HALF_L = 60, HALF_W = 26.7; // the field (with end zones), yards from the middle
// the rings, in yards out from the field's edge
const APRON = 3, WALL = 4, LOWER = 16, CLUB = 18.5, UPPER = 30, RIM = 32;

function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const hex = (c: string) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

const LOT = 24; // yards of parking lot around the stadium
const CARS = [[150, 30, 40], [40, 60, 120], [180, 180, 185], [30, 32, 36], [120, 120, 125], [90, 20, 30], [200, 200, 205], [50, 90, 60]];

/** The ground around the stadium at night, seen from above. e = yards past the rim; L, X = field yards. */
function outside(e: number, L: number, X: number, x: number, y: number): number[] {
  const n = hash(x, y) * 6; // grain
  if (e < 2) return [44 + n, 45 + n, 52 + n]; // the concourse plaza
  if (e < LOT) {
    // stalls 2.7 yds wide in rows 5.5 deep, every third row an aisle
    const fl = L / 2.7, fx = X / 5.5, row = Math.floor(fx), stall = Math.floor(fl);
    const asphalt = [22 + n, 24 + n, 30 + n];
    if (((row % 3) + 3) % 3 === 2) return asphalt; // the aisle
    const u = fl - stall, w = fx - row;
    if (u < 0.1) return [78, 80, 88]; // a stall line
    const h = hash(stall * 13 + 7, row * 29 + 3);
    if (h < 0.62 && u > 0.22 && u < 0.92 && w > 0.12 && w < 0.88) { // a car, roof a shade lighter
      const c = CARS[Math.floor(h * 100) % CARS.length], roof = u > 0.38 && u < 0.76 && w > 0.3 && w < 0.7 ? 1.18 : 0.85;
      return c.map((v) => Math.min(255, v * roof * 0.7));
    }
    return asphalt;
  }
  // beyond the lots: dark grass and the tops of trees
  const t = hash(Math.floor(x / 5), Math.floor(y / 5));
  return t < 0.35 ? [10 + n, 30 + n, 18 + n] : [14 + n, 22 + n, 16 + n];
}

interface Shot { cv: HTMLCanvasElement; k: number; cx: number; cy: number; horiz: boolean; seats: { x: number; y: number }[] }
const cache = new Map<string, Shot>();

function build(v: View, c: Crowd, abbr: string): Shot {
  const W = Math.round(v.w * HD), H = Math.round(v.h * HD);
  const horiz = v.landscape;
  const lenPx = horiz ? W : H, widPx = horiz ? H : W;
  const k = Math.min((lenPx * 0.92) / (2 * (HALF_L + RIM)), (widPx * 0.96) / (2 * (HALF_W + RIM))); // canvas px per yard
  const cx = W / 2, cy = H / 2;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(W, H), px = img.data;
  const home0 = hex(c.home[0]), home1 = hex(c.home[1]), away0 = hex(c.away[0]);
  const neutral = NEUTRAL.map(hex), pad = hex(padColor(c));
  const seats: { x: number; y: number }[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // field-aligned coordinates (yards): L along the field, X across it
      const L = (horiz ? x - cx : cy - y) / k, X = (horiz ? y - cy : x - cx) / k;
      const dx = Math.max(Math.abs(L) - HALF_L, 0), dy = Math.max(Math.abs(X) - HALF_W, 0);
      const d = Math.hypot(dx, dy);
      let col: number[];
      if (dx === 0 && dy === 0) col = [0, 0, 0]; // the field: drawn below
      else if (d < APRON) col = [22, 92, 48]; // the sideline apron
      else if (d < WALL) col = pad;
      else if (d < CLUB && d >= LOWER) { // the club level: a band of suite windows, most of them lit
        const w = Math.floor((Math.atan2(X, L) + Math.PI) * 90 * (1 + d / 40));
        const mid = d > LOWER + 0.7 && d < CLUB - 0.7;
        col = mid && w % 2 === 0 ? (hash(w, 5) < 0.75 ? [255, 233, 168] : [58, 66, 85]) : [20, 27, 43];
      }
      else if (d < UPPER) {
        // fans: rows of seats; the card stunt turns rows into stripes of the school colours
        const row = Math.floor(d * 1.4), gx = x >> 1, gy = y >> 1, seat = gx * 977 + gy; // a fan per 2 x 2 canvas pixels
        const r = hash(gx * 7 + 1, gy), q = hash(gy * 3 + 5, gx);
        const upper = d >= CLUB;
        if (q > 0.95) col = [43, 50, 66]; // an empty seat
        else if (c.stunt && r < 0.93) col = Math.floor(row / 2) % 2 ? home1 : home0;
        else col = r < 0.55 ? home0 : r < 0.72 ? home1 : r < 0.85 ? away0 : neutral[Math.floor(q * 4)];
        const shadow = upper ? 0.55 + ((d - CLUB) / (UPPER - CLUB)) * 0.25 : 0.8 + (1 - (d - WALL) / (LOWER - WALL)) * 0.2;
        col = col.map((v) => v * shadow);
        if ((Math.floor(d * 1.4 * 4) & 3) === 0) col = col.map((v) => v * 0.7); // the step edge
        if (hash(seat, row * 13) < 0.002) seats.push({ x, y });
      } else if (d < RIM) col = [20, 27, 43];
      else col = outside(d - RIM, L, X, x, y); // looking down: the plaza, the parking lots, the trees
      const i = (y * W + x) * 4;
      px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // helpers in field yards
  const P = (L: number, X: number) => (horiz ? { x: cx + L * k, y: cy + X * k } : { x: cx + X * k, y: cy - L * k });
  const rect = (L0: number, X0: number, L1: number, X1: number, color: string) => {
    const a = P(L0, X0), b = P(L1, X1);
    ctx.fillStyle = color; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  };
  // the field: stripes, end zones in the home colours, yard lines, the logo at midfield
  for (let yd = -50; yd < 50; yd += 5) rect(yd, -HALF_W, yd + 5, HALF_W, (yd / 5) & 1 ? '#00873f' : '#00954a');
  rect(-60, -HALF_W, -50, HALF_W, c.home[0]); rect(50, -HALF_W, 60, HALF_W, c.home[0]);
  for (let yd = -50; yd <= 50; yd += 10) { const a = P(yd, -HALF_W), b = P(yd, HALF_W); ctx.fillStyle = 'rgba(255,241,232,0.8)'; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(1, Math.abs(b.x - a.x)), Math.max(1, Math.abs(b.y - a.y))); }
  ctx.strokeStyle = 'rgba(255,241,232,0.9)'; ctx.lineWidth = 1;
  { const a = P(-60, -HALF_W), b = P(60, HALF_W); ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x) - 1, Math.abs(b.y - a.y) - 1); }
  const m = P(0, 0), rr = 7 * k;
  ctx.fillStyle = c.home[0]; ctx.beginPath(); ctx.arc(m.x, m.y, rr, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = c.home[1]; ctx.stroke();
  const scale = Math.max(1, Math.floor((rr * 1.5) / (abbr.length * 4)));
  const lum = (h: string) => { const [r, g, b] = hex(h); return 0.3 * r + 0.59 * g + 0.11 * b; };
  const ink = Math.abs(lum(c.home[1]) - lum(c.home[0])) > 80 ? c.home[1] : lum(c.home[0]) > 140 ? '#111d2b' : '#fff1e8';
  drawText(ctx, abbr, m.x, m.y - (5 * scale) / 2, { align: 'center', scale, color: ink });
  // light towers at the corners, glowing
  for (const [sl, sx] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const p = P(sl * (HALF_L + RIM - 6), sx * (HALF_W + RIM - 6));
    const g = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, 60);
    g.addColorStop(0, 'rgba(255,241,200,0.45)'); g.addColorStop(1, 'rgba(255,241,200,0)');
    ctx.fillStyle = g; ctx.fillRect(p.x - 60, p.y - 60, 120, 120);
    ctx.fillStyle = '#fff6d5'; ctx.fillRect(Math.round(p.x) - 5, Math.round(p.y) - 3, 10, 6);
  }
  // lamps over the parking lots: warm pools of light on a grid
  for (let L = -(HALF_L + RIM + LOT); L <= HALF_L + RIM + LOT; L += 13) {
    for (let X = -(HALF_W + RIM + LOT); X <= HALF_W + RIM + LOT; X += 13) {
      const dx = Math.max(Math.abs(L) - HALF_L, 0), dy = Math.max(Math.abs(X) - HALF_W, 0), e = Math.hypot(dx, dy) - RIM;
      if (e < 4 || e > LOT - 2) continue;
      const p = P(L, X), r = 5 * k;
      if (p.x < -r || p.y < -r || p.x > W + r || p.y > H + r) continue;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, 'rgba(255,200,120,0.32)'); g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g; ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      ctx.fillStyle = '#ffe3a8'; ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
    }
  }
  return { cv, k, cx, cy, horiz, seats };
}

/**
 * Draws the blimp shot over the whole screen. t = seconds into the shot (the zoom and the flashes).
 * band: the home band marches on from the sideline and spells the school's letters (halftime).
 */
export function drawBlimp(ctx: CanvasRenderingContext2D, v: View, c: Crowd, abbr: string, t: number, opts: { band?: boolean } = {}): void {
  const key = `${v.w}x${v.h}|${c.home}|${c.away}|${abbr}|${!!c.stunt}`;
  let shot = cache.get(key);
  if (!shot) { if (cache.size > 6) cache.clear(); shot = build(v, c, abbr); cache.set(key, shot); }
  const e = Math.min(1, t / 7), z = 1 + (e * e * (3 - 2 * e)) * 0.08; // a slow, eased push in
  const W = shot.cv.width, H = shot.cv.height;
  const S = (x: number, y: number) => ({ x: W / 2 + (x - W / 2) * z, y: H / 2 + (y - H / 2) * z }); // the zoom
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // smoothing on while it scales, so the push in glides instead of rows of pixels popping
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(shot.cv, (W - W * z) / 2, (H - H * z) / 2, W * z, H * z);
  ctx.imageSmoothingEnabled = false;
  if (opts.band) drawBand(ctx, shot, c, abbr, t, S);
  // camera flashes around the bowl
  const n = shot.seats.length;
  for (let i = 0; i < 14 && n; i++) {
    const s = shot.seats[Math.floor(hash(Math.floor(t * 9), i * 31) * n)], p = S(s.x, s.y);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
  }
  ctx.restore();
}

const BAND_L = 22; // the formation's middle, yards from midfield (portrait; landscape spells along the field, so further out)

/** The band from the blimp: a dot per bandsman in the school's colours, marching on in columns, then marking time. */
function drawBand(ctx: CanvasRenderingContext2D, shot: Shot, c: Crowd, abbr: string, t: number, S: (x: number, y: number) => { x: number; y: number }): void {
  const mask = glyphMask(abbr), rows = mask.length, cols = mask[0]?.length ?? 0;
  const { k, cx, cy, horiz } = shot;
  // field yards -> canvas pixels (before the zoom)
  const P = (L: number, X: number) => (horiz ? { x: cx + L * k, y: cy + X * k } : { x: cx + X * k, y: cy - L * k });
  const side = -(HALF_W + 2); // they come on from the near sideline
  const gap = Math.min(3, (horiz ? 38 : 46) / Math.max(cols, 1)), rgap = 3.4; // yards between bandsmen (wider letters fit the field)
  const BL = horiz ? 28 : BAND_L;
  const sz = Math.max(3, Math.round(k * 1.1));
  // the uniform colour that shows on the grass
  const grass = [0, 140, 70], far = (h: string) => { const [r, g, b] = hex(h); return Math.hypot(r - grass[0], g - grass[1], b - grass[2]); };
  const [suit, plume] = far(c.home[0]) >= 120 || far(c.home[0]) >= far(c.home[1]) ? [c.home[0], c.home[1]] : [c.home[1], c.home[0]];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      if (!mask[r][col]) continue;
      // along the field: the letter columns (portrait: across the screen); across it: the rows
      const along = horiz ? (col - (cols - 1) / 2) * gap : (r - (rows - 1) / 2) * -rgap;
      const across = horiz ? (r - (rows - 1) / 2) * rgap : (col - (cols - 1) / 2) * gap;
      const L = BL + along;
      const p = Math.min(1, Math.max(0, (t - 0.4 - col * 0.05) / 2.2)), ep = p * p * (3 - 2 * p);
      const X = side + (across - side) * ep;
      const step = p < 1 ? Math.sin(t * 14 + i) * 0.35 : Math.floor(t * 4 + i) % 2 ? 0.2 : -0.2; // marching, then marking time
      const q = S(P(L + step, X).x, P(L + step, X).y);
      const bx = Math.round(q.x - sz / 2), by = Math.round(q.y - sz / 2);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(bx + 1, by + 1, sz, sz); // a shadow on the grass
      ctx.fillStyle = suit; ctx.fillRect(bx, by, sz, sz);
      ctx.fillStyle = plume; ctx.fillRect(bx + 1, by, sz - 2, 1); // the plume
      i++;
    }
  }
  // the drum major out front, in white
  const dm = Math.min(1, Math.max(0, (t - 0.2) / 2.2)), de = dm * dm * (3 - 2 * dm);
  const front = -((rows - 1) / 2) * rgap - 3.5;
  const dq = horiz ? P(BL - ((cols - 1) / 2) * gap - 3.5, side + (0 - side) * de) : P(BL + front, side + (0 - side) * de);
  const d = S(dq.x, dq.y);
  ctx.fillStyle = '#fff1e8';
  ctx.fillRect(Math.round(d.x - sz / 2), Math.round(d.y - sz), sz, sz + 1);
}
