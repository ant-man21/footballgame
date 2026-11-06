// Chalkboard-style play diagrams for the playbook menu, drawn from the same
// play data the game runs, so the art always matches the play.
import { C, ROUTE_COLORS } from './config';
import { FORMATIONS, OL_DEPTH, OL_SPOTS } from './playbook/formations';
import type { Play } from './playbook/plays';
import { ROUTES, type RouteDef, routeYards } from './playbook/routes';
import { clamp } from './util';

export function pixelLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function drawPlayArt(ctx: CanvasRenderingContext2D, play: Play, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#0b3d2e';
  ctx.fillRect(x, y, w, h);

  // Diagrams are schematic: the full width across, but stretched vertically
  // so short routes still read clearly (about 22 yards downfield fit).
  const sx = w / 52; // 26 yards each side of the ball
  const sy = (h - 4) / 29;
  const losY = y + h - Math.round(6.5 * sy);
  const maxD = (losY - y - 3) / sy;
  const px = (xYd: number) => x + w / 2 + clamp(xYd, -25, 25) * sx;
  const py = (d: number) => losY - clamp(d, -7, maxD) * sy;

  ctx.fillStyle = 'rgba(255,241,232,0.35)';
  for (let i = x + 1; i < x + w - 1; i += 2) ctx.fillRect(i, losY, 1, 1);

  let colorIdx = 0;
  for (const spot of FORMATIONS[play.formation].skill) {
    const pr = play.routes.find((r) => r.who === spot.id);
    const ax = Math.round(px(spot.x)), ay = Math.round(py(spot.d));
    if (pr?.route === 'stalk') {
      // stalk block: a short line up to the defender with a bar
      ctx.fillStyle = C.grey;
      pixelLine(ctx, ax, ay - 2, ax, ay - 6);
      pixelLine(ctx, ax - 2, ay - 6, ax + 2, ay - 6);
      ctx.fillRect(ax - 1, ay - 1, 3, 3);
      continue;
    }
    if (!pr || pr.route === 'block') {
      // pass protection: a short "T"
      ctx.fillStyle = C.grey;
      pixelLine(ctx, ax, ay - 2, ax, ay - 4);
      pixelLine(ctx, ax - 2, ay - 4, ax + 2, ay - 4);
      ctx.fillRect(ax - 1, ay - 1, 3, 3);
      continue;
    }
    const color = ROUTE_COLORS[colorIdx++ % ROUTE_COLORS.length];
    const route: RouteDef = ROUTES[pr.route];
    const pts = [{ x: spot.x, d: spot.d }, ...routeYards(spot.x, spot.d, route, pr.flip)];
    if (route.end === 'continue') {
      const a = pts[pts.length - 2], b = pts[pts.length - 1];
      const len = Math.hypot(b.x - a.x, b.d - a.d) || 1;
      pts.push({ x: b.x + ((b.x - a.x) / len) * 3, d: b.d + ((b.d - a.d) / len) * 3 });
    }
    ctx.fillStyle = color;
    for (let i = 1; i < pts.length; i++) pixelLine(ctx, px(pts[i - 1].x), py(pts[i - 1].d), px(pts[i].x), py(pts[i].d));

    // end cap: arrow for routes that keep going, a bar for routes that settle
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const ex = px(b.x), ey = py(b.d);
    let vx = ex - px(a.x), vy = ey - py(a.d);
    const vl = Math.hypot(vx, vy) || 1;
    vx /= vl; vy /= vl;
    const nx = -vy, ny = vx;
    if (route.end === 'continue') {
      pixelLine(ctx, ex - vx * 2 + nx * 2, ey - vy * 2 + ny * 2, ex, ey);
      pixelLine(ctx, ex - vx * 2 - nx * 2, ey - vy * 2 - ny * 2, ex, ey);
    } else {
      pixelLine(ctx, ex + nx * 2, ey + ny * 2, ex - nx * 2, ey - ny * 2);
    }
    ctx.fillRect(ax - 1, ay - 1, 3, 3);
  }

  ctx.fillStyle = C.grey;
  OL_SPOTS.forEach((ox, i) => {
    const x0 = Math.round(px(ox)), y0 = Math.round(py(OL_DEPTH));
    ctx.fillRect(x0 - 1, y0 - 1, 2, 2);
    if (play.screen?.release.includes(i)) pixelLine(ctx, x0, y0 - 2, x0 + (ox >= 0 ? 2 : -2), y0 - 5); // releases downfield
  });
  ctx.fillStyle = C.yellow;
  const qx = Math.round(px(0)), qy = Math.round(py(-5));
  if (play.rollout) { // the QB's sprint-out path
    const ex = Math.round(px(play.rollout === 'right' ? 8 : -8)), ey = Math.round(py(-6.5));
    pixelLine(ctx, qx, qy, ex, ey);
  }
  ctx.fillRect(qx - 1, qy - 1, 3, 3);
}
