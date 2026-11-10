// Small pixel pictures for the career screens: your QB's portrait, trophies,
// plaques, medals and game balls. Each is a grid of palette letters ('.' = clear).
import { C } from '../config';
import { drawText } from '../font';

export function pixelArt(ctx: CanvasRenderingContext2D, x: number, y: number, rows: string[], pal: Record<string, string>, scale = 1): void {
  rows.forEach((row, ry) => [...row].forEach((ch, rx) => {
    if (ch === '.' || !pal[ch]) return;
    ctx.fillStyle = pal[ch];
    ctx.fillRect(Math.round(x) + rx * scale, Math.round(y) + ry * scale, scale, scale);
  }));
}

// a QB from the chest up: helmet (h), stripe (s), face (f), mask (m), jersey (j), number (n)
const BUST = [
  '...hhhhh...', '..hhhhhhh..', '.hhhhhhhhs.', '.hhhhhhssss', '.hhhhhffmff', '.hhhhhffmff', '..hhhhfffm.', '...hh.fff..',
  '..jjjjjjjj.', '.jjjjjjjjjj', 'jjjjnjnjjjj', 'jjjjnjnjjjj', 'jjjjnjnjjjj', 'jjjjjjjjjjj',
];
export const BUST_W = 11, BUST_H = 14;
/** Your QB in school colours: the helmet in the accent colour, the jersey in the main one. */
export function qbBust(ctx: CanvasRenderingContext2D, x: number, y: number, colors: [string, string], scale = 1): void {
  pixelArt(ctx, x, y, BUST, { h: colors[1], s: C.white, f: '#e0a070', m: C.grey, j: colors[0], n: colors[1] === colors[0] ? C.white : colors[1] }, scale);
}

const GOLD = '#ffcc00', WOOD = '#7a3a26';
export const CUP = ['.gggggggg.', 'ggggggggggg', 'g.gggggggg.g', '..gggggggg..', '...gggggg...', '....gggg....', '.....gg.....', '.....gg.....', '....gggg....', '...bbbbbb...', '...bbbbbb...'];
export const PLAQUE = ['ssssssss', 'swwwwwws', 'swyyyyws', 'swwwwwws', 'swyyyyws', 'swwwwwws', 'ssssssss'];
export const MEDAL = ['r...r', '.r.r.', '..r..', '.ggg.', 'ggggg', 'ggggg', '.ggg.'];
export const BALL = ['...bbbb...', '.bbbbbbbb.', 'bbbwwwwbbb', 'bbbwbwbwbb', 'bbbbbbbbbb', '.bbbbbbbb.', '...bbbb...'];
export const TROPHY_PAL: Record<string, string> = { g: GOLD, b: WOOD, s: C.grey, w: '#3a3a4a', y: C.yellow, r: C.red };
export const BALL_PAL: Record<string, string> = { b: '#8a4b2a', w: C.white };
export const artW = (rows: string[]) => Math.max(...rows.map((r) => r.length));

// Mr. Football: a gold player on a wooden base
export const STATUE = ['....gg....', '...gggg...', '....gg....', '..gggggg..', '.g.gggg.g.', '...gggg...', '...g..g...', '..gg..gg..', '.bbbbbbbb.', '.bbbbbbbb.'];

// signing day: you without the helmet (hair h, face f, eyes e, mouth m, shirt j) and a college cap (crown c, logo s, brim b)
const KID = [
  '...hhhhh...', '..hhhhhhh..', '..hfffffh..', '..fefffef..', '..fffffff..', '..ffmmmff..', '...fffff...', '....fff....',
  '..jjjjjjj..', '.jjjjjjjjj.', 'jjjjjjjjjjj', 'jjjjjjjjjjj', 'jjjjjjjjjjj', 'jjjjjjjjjjj',
];
export function signee(ctx: CanvasRenderingContext2D, x: number, y: number, shirt: string, scale = 1): void {
  pixelArt(ctx, x, y, KID, { h: '#5a3a22', f: '#e0a070', e: C.ink, m: '#a05030', j: shirt }, scale);
}
const CAP = ['...cccccc.....', '..cccccccc....', '.ccccsscccc...', '.ccccsscccc...', '.cccccccccc...', '.ccccccccccbbb'];
export const CAP_W = 14, CAP_H = 6;
export function cap(ctx: CanvasRenderingContext2D, x: number, y: number, colors: [string, string], scale = 1): void {
  pixelArt(ctx, x, y, CAP, { c: colors[0], s: colors[1], b: colors[0] === '#000000' ? '#222222' : colors[0] }, scale);
}

/** A retired jersey in a frame: your number in your school's colours. */
export function framedJersey(ctx: CanvasRenderingContext2D, x: number, y: number, colors: [string, string], no: number): void {
  ctx.fillStyle = '#7a3a26'; ctx.fillRect(x, y, 32, 34);
  ctx.fillStyle = '#2a2236'; ctx.fillRect(x + 2, y + 2, 28, 30);
  const J = ['..jj....jj..', '.jjjjjjjjjj.', 'jjjjjjjjjjjj', 'jj.jjjjjj.jj', '...jjjjjj...', '...jjjjjj...', '...jjjjjj...'];
  pixelArt(ctx, x + 4, y + 6, J, { j: colors[0] }, 2);
  drawText(ctx, String(no), x + 16, y + 13, { align: 'center', color: colors[1] === colors[0] ? C.white : colors[1] });
}
