// The stadium around the field, drawn on the HD grid (canvas pixels): stands
// with a crowd behind each end zone, the padded wall, goalposts, and in
// landscape the sideline stands behind the HUD panels. The crowd wears the home
// school's colours (a few visitors' too) and jumps when something big happens.
import { YD } from './config';
import { HD } from './hd';
import { deltaE, shade } from './sprites';

export interface Crowd {
  home: [string, string]; // school colours [primary, secondary]
  away: [string, string];
  hype: number; // 0 = sitting, 1 = going wild
  t: number; // seconds, for the animation
}

const FIELD = '#00873f';
const SKIN = ['#f1c7a1', '#d9a06f', '#a86d45', '#7a4b2e', '#5a3620'];
const HAIR = ['#1d1d24', '#3b2a20', '#5a3620', '#8a6a3a', '#1d1d24'];
const NEUTRAL = ['#c2c3c7', '#5f574f', '#fff1e8', '#1d2b53'];
const STEP = ['#2e3442', '#363d4d'];
const SEAT_W = 5; // canvas px per seat along a row
const ROWS = 14; // rows in the lower bowl; above it the upper concourse and the night

/** Stable pseudo-random number in [0, 1) for a seat. */
function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The home school's colour that shows against the grass (for the wall pads). */
export function padColor(c: Crowd): string {
  return deltaE(c.home[0], FIELD) > 25 ? c.home[0] : c.home[1];
}

interface Fan { shirt: string; head: string; ph: number; empty: boolean }
function fan(c: Crowd, row: number, seat: number, faces: boolean): Fan {
  const r = hash(row * 7 + 1, seat), q = hash(seat * 3 + 5, row);
  const shirt = r < 0.6 ? c.home[0] : r < 0.75 ? c.home[1] : r < 0.88 ? c.away[0] : NEUTRAL[Math.floor(q * 4)];
  const i = Math.floor(q * 5);
  return { shirt, head: faces ? SKIN[i] : HAIR[i], ph: hash(seat, row * 13 + 7), empty: q > 0.9 };
}

/** One fan, standing at canvas (x, y) = his feet, body 3 x 3, head 2 x 2. */
function drawFan(ctx: CanvasRenderingContext2D, f: Fan, x: number, y: number, c: Crowd): void {
  let up = 0, arms = false;
  if (c.hype > 0.05) { // jumping, out of step with each other
    up = Math.round(Math.max(0, Math.sin(c.t * 11 + f.ph * 6.283)) * 2 * c.hype);
    arms = f.ph < 0.55 && c.hype > 0.4;
  } else if ((c.t * 0.35 + f.ph) % 1 < 0.035) up = 1; // the odd fan fidgets
  const by = y - 3 - up;
  ctx.fillStyle = f.shirt; ctx.fillRect(x, by, 3, 3);
  ctx.fillStyle = f.head; ctx.fillRect(x + 0.5 | 0, by - 2, 2, 2);
  if (arms) { ctx.fillStyle = SKIN[Math.floor(f.ph * 5)]; ctx.fillRect(x - 1, by - 3, 1, 2); ctx.fillRect(x + 3, by - 3, 1, 2); }
}

/**
 * The stands behind an end zone. All positions in logical pixels except where
 * noted; endLine = screen y of the end line, dir = -1 (stands run up the
 * screen, the far end) or +1 (down, the near end). w = screen width.
 */
export function drawEndStands(ctx: CanvasRenderingContext2D, c: Crowd, endLine: number, dir: -1 | 1, w: number, h: number, s: number): void {
  const yd = YD * s * HD; // canvas px per yard
  const W = Math.ceil(w * HD), H = Math.ceil(h * HD);
  const base = Math.round(endLine * HD);
  const apron = Math.round(3 * yd), wall = Math.max(4, Math.round(0.9 * yd));
  const rowH = Math.max(8, Math.round(1.15 * yd));
  const at = (d: number) => base + dir * d; // canvas y at distance d beyond the end line
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // the wall: padding in the home colour, lit along the top
  const pad = padColor(c);
  const wy = Math.min(at(apron), at(apron + wall));
  if (wy < H && wy + wall > 0) {
    ctx.fillStyle = pad; ctx.fillRect(0, wy, W, wall);
    ctx.fillStyle = shade(pad, 0.35); ctx.fillRect(0, dir < 0 ? wy + wall - 1 : wy, W, 1);
    ctx.fillStyle = shade(pad, -0.4); ctx.fillRect(0, dir < 0 ? wy : wy + wall - 1, W, 1);
  }
  // the lower bowl: concrete steps, aisles, a seat for everyone
  const seats = Math.ceil(W / SEAT_W);
  for (let row = 0; row < ROWS; row++) {
    const d0 = apron + wall + row * rowH;
    const y = Math.min(at(d0), at(d0 + rowH));
    if (y > H || y + rowH < 0) continue;
    ctx.fillStyle = STEP[row & 1]; ctx.fillRect(0, y, W, rowH);
    ctx.fillStyle = '#4a5266'; ctx.fillRect(0, dir < 0 ? y + rowH - 1 : y, W, 1); // step edge
    for (let i = 0; i < seats; i++) {
      if (i % 26 === 13 || i % 26 === 14) { ctx.fillStyle = '#4a5266'; ctx.fillRect(i * SEAT_W, y, SEAT_W, rowH); continue; } // aisle
      const f = fan(c, row, i, dir < 0);
      if (f.empty) continue;
      drawFan(ctx, f, i * SEAT_W + 1, y + rowH - 2, c);
    }
  }
  // upper concourse, light towers and the night above
  const top = apron + wall + ROWS * rowH;
  const cy = Math.min(at(top), at(top + 6));
  ctx.fillStyle = '#1d2b53'; ctx.fillRect(0, cy, W, 6);
  ctx.fillStyle = pad; ctx.fillRect(0, dir < 0 ? cy + 5 : cy, W, 1);
  const sky = dir < 0 ? [0, cy] : [cy + 6, H];
  if (sky[1] > sky[0]) {
    ctx.fillStyle = '#0b1220'; ctx.fillRect(0, sky[0], W, sky[1] - sky[0]);
    for (const lx of [0.12, 0.5, 0.88]) { // light banks
      const x = Math.round(lx * W) - 9, ly = dir < 0 ? cy - 12 : cy + 12;
      if (ly < sky[0] || ly > sky[1]) continue;
      ctx.fillStyle = '#5f574f'; ctx.fillRect(x + 8, dir < 0 ? ly : cy + 6, 2, dir < 0 ? cy - ly : ly - cy - 6);
      ctx.fillStyle = '#fff1e8'; ctx.fillRect(x, ly - 4, 18, 5);
      ctx.fillStyle = 'rgba(255,241,232,0.08)'; ctx.fillRect(x - 6, ly - 8, 30, 13);
    }
  }
  ctx.restore();
}

/**
 * Landscape: sideline stands filling a side panel (behind the HUD, which dims
 * them). edge = screen x of the panel's field side; dir = -1 left, +1 right.
 * anchor = screen y of a fixed spot on the field, so the seats scroll with it.
 */
export function drawSideStands(ctx: CanvasRenderingContext2D, c: Crowd, edge: number, dir: -1 | 1, panel: number, h: number, anchor: number): void {
  const X = Math.round(edge * HD), P = Math.round(panel * HD), H = Math.ceil(h * HD);
  const x0 = dir < 0 ? X - P : X;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b1220'; ctx.fillRect(x0, 0, P, H);
  const wall = 4, colW = 9, seatH = 6;
  const pad = padColor(c);
  ctx.fillStyle = pad; ctx.fillRect(dir < 0 ? X - wall : X, 0, wall, H);
  const A = Math.round(anchor * HD);
  const first = Math.floor(-A / seatH) - 1, last = Math.ceil((H - A) / seatH) + 1;
  for (let col = 0; (col + 1) * colW + wall < P; col++) {
    const cx = dir < 0 ? X - wall - (col + 1) * colW : X + wall + col * colW;
    ctx.fillStyle = STEP[col & 1]; ctx.fillRect(cx, 0, colW, H);
    for (let j = first; j <= last; j++) {
      if (((j % 30) + 30) % 30 < 2) continue; // aisle
      const f = fan(c, col + 100 * (dir < 0 ? 1 : 2), j, true);
      if (f.empty) continue;
      drawFan(ctx, f, cx + 3, A + j * seatH + 4, c);
    }
  }
  ctx.restore();
}

/**
 * A goalpost on an end line, seen from above and behind: the post, a crossbar
 * the width of the uprights (18.5 ft) and the uprights rising up the screen,
 * with a shadow on the grass. Logical pixels (drawn through the HD transform).
 */
export function drawGoalpost(ctx: CanvasRenderingContext2D, cx: number, endLine: number, s: number): void {
  const half = 3.08 * YD * s; // half the crossbar
  const bar = endLine - 3 * s, top = bar - 12 * s;
  const px = 1 / HD; // one canvas pixel
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; // shadow: crossbar and uprights cast toward the lower right
  ctx.fillRect(cx - half + 2, endLine + 1, half * 2, px * 2);
  ctx.fillRect(cx - half + 2, endLine + 1, px * 2, 6 * s);
  ctx.fillRect(cx + half + 2, endLine + 1, px * 2, 6 * s);
  ctx.fillStyle = '#c9a400';
  ctx.fillRect(cx - px, bar, px * 3, endLine - bar + px * 2); // the post
  ctx.fillStyle = '#ffec27';
  ctx.fillRect(cx - px, bar, px * 2, endLine - bar);
  ctx.fillRect(cx - half, bar, half * 2, px * 2); // crossbar
  ctx.fillRect(cx - half, top, px * 2, bar - top + px * 2); // uprights
  ctx.fillRect(cx + half - px, top, px * 2, bar - top + px * 2);
  ctx.fillStyle = '#ff004d'; // wind flags
  ctx.fillRect(cx - half, top - px * 3, px * 3, px * 2);
  ctx.fillRect(cx + half - px, top - px * 3, px * 3, px * 2);
}
