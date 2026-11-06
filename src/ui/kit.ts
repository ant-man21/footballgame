// Small drawing helpers for the menu-style screens: boxes, buttons, team
// badges, meters and star ratings, all in the pixel style of the rest.
import { C } from '../config';
import { drawText, textWidth } from '../font';
import type { Vec } from '../util';

export type Rect = { x: number; y: number; w: number; h: number };
export const hit = (r: Rect | null | undefined, p: Vec) => !!r && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

export function box(ctx: CanvasRenderingContext2D, r: Rect, fill: string, border: string): void {
  ctx.fillStyle = border;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = fill;
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
}

export function button(ctx: CanvasRenderingContext2D, r: Rect, label: string, color: string = C.white, fill: string = C.ink): void {
  box(ctx, r, fill, color);
  drawText(ctx, label, r.x + r.w / 2, r.y + Math.floor((r.h - 5) / 2), { align: 'center', color });
}

/** A < value > picker row. */
export function stepper(ctx: CanvasRenderingContext2D, left: Rect, right: Rect, value: string, color: string = C.white): void {
  button(ctx, left, '<', C.yellow);
  button(ctx, right, '>', C.yellow);
  drawText(ctx, value, (left.x + left.w + right.x) / 2, left.y + Math.floor((left.h - 5) / 2), { align: 'center', color });
}

/** A team's badge: its colours and abbreviation (stands in for a logo). */
export function badge(ctx: CanvasRenderingContext2D, x: number, y: number, abbr: string, colors: [string, string], scale = 1): void {
  const w = textWidth(abbr, scale) + 6 * scale, h = 9 * scale;
  ctx.fillStyle = colors[1];
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
  ctx.fillStyle = colors[0];
  ctx.fillRect(Math.round(x) + scale, Math.round(y) + scale, w - 2 * scale, h - 2 * scale);
  drawText(ctx, abbr, x + 3 * scale, y + 2 * scale, { color: colors[1], scale });
}
export const badgeWidth = (abbr: string, scale = 1) => textWidth(abbr, scale) + 6 * scale;

/** A horizontal meter, 0-100. */
export function meter(ctx: CanvasRenderingContext2D, r: Rect, value: number, color: string): void {
  box(ctx, r, C.ink, C.darkGrey);
  ctx.fillStyle = color;
  ctx.fillRect(r.x + 1, r.y + 1, Math.round(((r.w - 2) * Math.max(0, Math.min(100, value))) / 100), r.h - 2);
}

const STAR = ['00100', '01110', '11111', '01110', '01010'];
/** n of 5 stars. */
export function stars(ctx: CanvasRenderingContext2D, x: number, y: number, n: number): void {
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < n ? C.yellow : C.darkGrey;
    STAR.forEach((row, ry) => [...row].forEach((c, rx) => { if (c === '1') ctx.fillRect(x + i * 7 + rx, y + ry, 1, 1); }));
  }
}

export function screenBg(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, 0, w, h);
}
