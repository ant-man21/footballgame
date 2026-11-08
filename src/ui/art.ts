// Small pixel pictures for the career screens: your QB's portrait, trophies,
// plaques, medals and game balls. Each is a grid of palette letters ('.' = clear).
import { C } from '../config';

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
