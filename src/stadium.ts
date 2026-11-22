// The stadium around the field, drawn on the HD grid (canvas pixels): behind
// each end line a padded wall with the home school's name painted on it, a
// packed lower bowl of fans (darker toward the back), the facade, light towers
// and the night sky; goalposts on the end lines. The crowd wears the home
// school's colours (a few visitors' too) and jumps when something big happens.
// A college stadium is bigger: a club level with lit suites over the lower
// bowl, an upper deck above it, and a video board over the far end. A card
// stunt turns the rows into stripes of the school's colours.
import { YD } from './config';
import { drawText, textWidth } from './font';
import { HD } from './hd';
import { deltaE, shade } from './sprites';

export interface Crowd {
  home: [string, string]; // school colours [primary, secondary]
  away: [string, string];
  homeName: string; // painted on the end zone walls
  hype: number; // 0 = sitting, 1 = going wild
  t: number; // seconds, for the animation
  big?: boolean; // a college stadium: club level, upper deck, video board
  stunt?: boolean; // a card stunt: rows of the school's colours
}

const FIELD = '#00873f';
const SKIN = ['#f1c7a1', '#d9a06f', '#a86d45', '#7a4b2e', '#5a3620'];
const HAIR = ['#1d1d24', '#3b2a20', '#5a3620', '#8a6a3a', '#1d1d24'];
const NEUTRAL = ['#c2c3c7', '#5f574f', '#fff1e8', '#1d2b53'];
const SEAT = 4; // canvas px per seat along a row
const ROW = 7; // canvas px per row
const ROWS = 19; // rows in the bowl
const APRON_YD = 3, WALL_YD = 2.2, FACADE = 7;
const UPPER = 17; // rows in a college upper deck
const CLUB = 16; // canvas px of the club level (suites) between the decks
/** How far the stands reach behind an end line (yards), to the top of the facade. */
export const STANDS_YD = APRON_YD + WALL_YD + (ROWS * ROW + FACADE) / (YD * HD);
/** The same for a college stadium (the upper deck and the club level on top). */
export const BIG_STANDS_YD = STANDS_YD + (CLUB + UPPER * ROW) / (YD * HD);
export const standsYd = (big?: boolean) => (big ? BIG_STANDS_YD : STANDS_YD);

/** Stable pseudo-random number in [0, 1) for a seat. */
function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The home school's colour that shows against the grass. */
export function padColor(c: Crowd): string {
  return deltaE(c.home[0], FIELD) > 25 ? c.home[0] : c.home[1];
}

interface Fan { shirt: string; head: string; ph: number; empty: boolean }
function fan(c: Crowd, row: number, seat: number, faces: boolean): Fan {
  const r = hash(row * 7 + 1, seat), q = hash(seat * 3 + 5, row);
  const stripe = c.stunt && r < 0.93; // a card stunt: whole rows in one colour, alternating
  const shirt = stripe ? c.home[Math.floor(row / 2) % 2] : r < 0.55 ? c.home[0] : r < 0.72 ? c.home[1] : r < 0.85 ? c.away[0] : NEUTRAL[Math.floor(q * 4)];
  const i = Math.floor(q * 5);
  return { shirt, head: faces ? SKIN[i] : HAIR[i], ph: hash(seat, row * 13 + 7), empty: q > 0.94 };
}

/** One fan with his feet at canvas (x, y): body 3 x 3, head 2 x 2; up = how high he's jumping. */
function drawFan(ctx: CanvasRenderingContext2D, f: Fan, x: number, y: number, up: number, arms: boolean): void {
  const by = y - 3 - up;
  ctx.fillStyle = f.shirt; ctx.fillRect(x, by, 3, 3);
  ctx.fillStyle = f.head; ctx.fillRect(x, by - 2, 2, 2);
  if (arms) { ctx.fillStyle = f.shirt; ctx.fillRect(x - 1, by - 3, 1, 3); ctx.fillRect(x + 3, by - 3, 1, 3); }
}

/** The bowl (steps and fans) for one end, cached while the crowd sits still. */
const bowls = new Map<string, HTMLCanvasElement>();
function bowl(c: Crowd, W: number, faces: boolean, live: boolean, rows = ROWS, first = 0, dark = 0): HTMLCanvasElement {
  const key = `${c.home}${c.away}${W}${faces}${rows}${first}${!!c.stunt}`;
  let cv = live ? null : bowls.get(key) ?? null;
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = W; cv.height = rows * ROW + 4;
  const ctx = cv.getContext('2d')!;
  const seats = Math.ceil(W / SEAT);
  for (let r = 0; r < rows; r++) { // row 0 = the front row, drawn at the bottom of this canvas
    const row = first + r;
    const y = cv.height - (r + 1) * ROW;
    ctx.fillStyle = row & 1 ? '#262c3a' : '#2b3242'; ctx.fillRect(0, y, W, ROW);
    ctx.fillStyle = '#3a4255'; ctx.fillRect(0, y + ROW - 1, W, 1); // the step's edge
    for (let i = 0; i < seats; i++) {
      if (i % 48 === 24) { ctx.fillStyle = '#3a4255'; ctx.fillRect(i * SEAT, y, SEAT, ROW); continue; } // a stairway
      const f = fan(c, row, i, faces);
      if (f.empty) continue;
      let up = 0, arms = false;
      if (live) {
        up = Math.round(Math.max(0, Math.sin(c.t * 11 + f.ph * 6.283)) * 2 * c.hype);
        arms = f.ph < 0.6 && c.hype > 0.35;
      }
      drawFan(ctx, f, i * SEAT + 1 + (row & 1) * 2, y + ROW - 1, up, arms);
    }
    ctx.fillStyle = `rgba(8,12,22,${dark + (r / rows) * 0.45})`; ctx.fillRect(0, y - 3, W, ROW + 3); // the back rows sit in shadow
  }
  if (!live) bowls.set(key, cv);
  return cv;
}

/**
 * The stands behind an end zone. endLine = screen y (logical) of the end line;
 * dir = -1: the stands rise up the screen (the far end), +1: down (the near end).
 */
export function drawEndStands(ctx: CanvasRenderingContext2D, c: Crowd, endLine: number, dir: -1 | 1, w: number, h: number, s: number): void {
  const yd = YD * s * HD;
  const W = Math.ceil(w * HD), H = Math.ceil(h * HD);
  const base = Math.round(endLine * HD);
  const apron = Math.round(APRON_YD * yd), wall = Math.round(WALL_YD * yd);
  const at = (d: number) => base + dir * d; // canvas y at distance d behind the end line
  const span = (d0: number, d1: number) => [Math.min(at(d0), at(d1)), Math.abs(d1 - d0)] as const;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const pad = padColor(c);

  // the bowl
  const [by, bh] = span(apron + wall, apron + wall + ROWS * ROW);
  if (by < H && by + bh > 0) {
    const img = bowl(c, W, dir < 0, c.hype > 0.05);
    if (dir < 0) ctx.drawImage(img, 0, by + bh - img.height); // front row against the wall
    else { ctx.save(); ctx.translate(0, by + img.height); ctx.scale(1, -1); ctx.drawImage(img, 0, 0); ctx.restore(); }
  }
  // a college stadium: the club level (suites) and the upper deck above the lower bowl
  let top = apron + wall + ROWS * ROW;
  if (c.big) {
    const [cy] = span(top, top + CLUB);
    ctx.fillStyle = '#141b2b'; ctx.fillRect(0, cy, W, CLUB);
    ctx.fillStyle = pad; ctx.fillRect(0, dir < 0 ? cy + CLUB - 2 : cy, W, 2); // the band in the school colour
    for (let x = 3; x < W - 8; x += 11) { // suite windows, some lit
      ctx.fillStyle = hash(x, 77) < 0.7 ? '#ffe9a8' : '#3a4255';
      ctx.fillRect(x, cy + (dir < 0 ? 4 : 6), 8, 5);
    }
    top += CLUB;
    const [uy, uh] = span(top, top + UPPER * ROW);
    if (uy < H && uy + uh > 0) {
      const img = bowl(c, W, dir < 0, c.hype > 0.05, UPPER, ROWS, 0.15);
      if (dir < 0) ctx.drawImage(img, 0, uy + uh - img.height);
      else { ctx.save(); ctx.translate(0, uy + img.height); ctx.scale(1, -1); ctx.drawImage(img, 0, 0); ctx.restore(); }
    }
    top += UPPER * ROW;
  }
  // the facade along the top of the bowl, and the night beyond it
  const [fy] = span(top, top + FACADE);
  ctx.fillStyle = '#141b2b'; ctx.fillRect(0, fy, W, FACADE);
  ctx.fillStyle = pad; ctx.fillRect(0, dir < 0 ? fy + FACADE - 2 : fy, W, 2);
  for (let x = 6; x < W; x += 14) { ctx.fillStyle = '#ffe9a8'; ctx.fillRect(x, fy + (dir < 0 ? 2 : 3), 2, 1); } // lights under the roof
  const sky = dir < 0 ? [0, fy] : [fy + FACADE, H];
  if (sky[1] > sky[0]) {
    const grad = ctx.createLinearGradient(0, dir < 0 ? fy : fy + FACADE, 0, dir < 0 ? fy - 160 : fy + FACADE + 160);
    grad.addColorStop(0, '#1b2740'); grad.addColorStop(1, '#070b14');
    ctx.fillStyle = grad; ctx.fillRect(0, sky[0], W, sky[1] - sky[0]);
    for (let i = 0; i < 40; i++) { // stars
      const x = Math.floor(hash(i, 9) * W), d = 30 + hash(i, 4) * 400, y = dir < 0 ? fy - d : fy + FACADE + d;
      if (y < sky[0] || y > sky[1]) continue;
      ctx.fillStyle = hash(i, 2) < 0.3 ? '#fff1e8' : '#5f6b85'; ctx.fillRect(x, y, 1, 1);
    }
    if (c.big && dir < 0) { // the video board over the far end
      const bw = Math.min(W - 40, 150 * HD / 3 * 2), bh = 30, bx = Math.round((W - bw) / 2), byy = fy - bh - 14;
      ctx.fillStyle = '#3a4255'; ctx.fillRect(bx + 10, byy + bh, 3, 14); ctx.fillRect(bx + bw - 13, byy + bh, 3, 14);
      ctx.fillStyle = '#0b1220'; ctx.fillRect(bx - 2, byy - 2, bw + 4, bh + 4);
      ctx.fillStyle = pad; ctx.fillRect(bx, byy, bw, bh);
      ctx.fillStyle = shade(pad, -0.35); ctx.fillRect(bx, byy + bh - 8, bw, 8);
      ctx.setTransform(HD, 0, 0, HD, 0, 0);
      const word = c.homeName;
      drawText(ctx, word, (bx + bw / 2) / HD, (byy + 5) / HD, { align: 'center', color: '#fff1e8' });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    for (const lx of [0.14, 0.86]) { // light towers
      const x = Math.round(lx * W), top = dir < 0 ? fy - 46 : fy + FACADE + 30;
      if (dir < 0) { ctx.fillStyle = '#3a4255'; ctx.fillRect(x - 1, top, 2, fy - top); }
      else { ctx.fillStyle = '#3a4255'; ctx.fillRect(x - 1, fy + FACADE, 2, top - fy - FACADE); }
      const g = ctx.createRadialGradient(x, top, 2, x, top, 34);
      g.addColorStop(0, 'rgba(255,241,200,0.35)'); g.addColorStop(1, 'rgba(255,241,200,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 34, top - 34, 68, 68);
      ctx.fillStyle = '#2b3242'; ctx.fillRect(x - 10, top - 5, 21, 9);
      ctx.fillStyle = '#fff6d5';
      for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) ctx.fillRect(x - 9 + i * 4, top - 4 + j * 4, 3, 3);
    }
  }
  // the wall: dark padding, a stripe in the home colour, the school's name painted on
  const [wy] = span(apron, apron + wall);
  if (wy < H && wy + wall > 0) {
    ctx.fillStyle = '#1d2b53'; ctx.fillRect(0, wy, W, wall);
    ctx.fillStyle = pad; ctx.fillRect(0, dir < 0 ? wy + wall - 2 : wy, W, 2);
    ctx.fillStyle = shade('#1d2b53', 0.25); ctx.fillRect(0, dir < 0 ? wy : wy + wall - 1, W, 1);
    ctx.setTransform(HD, 0, 0, HD, 0, 0);
    const name = c.homeName, tw = textWidth(name);
    const ty = Math.round((wy + (dir < 0 ? 0 : 2) + (wall - 2 - 5 * HD) / 2) / HD); // centred between the stripe and the edge
    for (let x = ((w / 2 - tw / 2) % (tw + 40)) - (tw + 40); x < w; x += tw + 40) {
      drawText(ctx, name, x, ty, { color: '#fff1e8' });
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
