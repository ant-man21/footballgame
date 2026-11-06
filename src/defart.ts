// Chalkboard diagrams for defensive calls, drawn from the call data against a
// generic spread formation: deep zones in blue, underneath zones in yellow, man
// defenders tied to their receiver, rushers with arrows at the QB.
import { C } from './config';
import { type Call, DEF_BASE, type DefId, ZONES } from './defense/calls';
import { FORMATIONS, OL_DEPTH, OL_SPOTS } from './playbook/formations';
import { pixelLine } from './playart';
import { clamp } from './util';

export function drawCallArt(ctx: CanvasRenderingContext2D, call: Call, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#0b3d2e';
  ctx.fillRect(x, y, w, h);
  const sx = w / 52, sy = (h - 4) / 29;
  const losY = y + h - Math.round(6.5 * sy);
  const maxD = (losY - y - 3) / sy;
  const px = (xYd: number) => Math.round(x + w / 2 + clamp(xYd, -25, 25) * sx);
  const py = (d: number) => Math.round(losY - clamp(d, -7, maxD) * sy);

  ctx.fillStyle = 'rgba(255,241,232,0.35)';
  for (let i = x + 1; i < x + w - 1; i += 2) ctx.fillRect(i, losY, 1, 1);

  // the offense (grey): spread formation
  const skill = FORMATIONS.spread.skill;
  ctx.fillStyle = '#5f574f';
  for (const ox of OL_SPOTS) ctx.fillRect(px(ox) - 1, py(OL_DEPTH), 2, 2);
  for (const sp of skill) ctx.fillRect(px(sp.x) - 1, py(sp.d) - 1, 2, 2);
  ctx.fillRect(px(0) - 1, py(-5), 2, 2);

  // zones first (so the dots draw on top)
  for (const [id, zk] of Object.entries(call.zones)) {
    const z = ZONES[zk!];
    const zx0 = px(z.x - z.wx * 0.7), zx1 = px(z.x + z.wx * 0.7);
    const zy = py(z.d);
    const zh = Math.max(3, Math.round((z.deep ? 3 : 2) * sy));
    ctx.fillStyle = z.deep ? 'rgba(41,173,255,0.35)' : 'rgba(255,236,39,0.3)';
    ctx.fillRect(zx0, zy - zh, zx1 - zx0, zh * 2);
    const b = DEF_BASE[id as DefId];
    ctx.fillStyle = z.deep ? C.blue : C.yellow;
    pixelLine(ctx, px(b.x), py(b.d), px(z.x), zy);
  }
  // man: tie each man defender to a receiver (outside first, then slots, then the back)
  const order = ['X', 'Z', 'Y', 'H', 'RB'];
  call.man.forEach((id, i) => {
    const b = DEF_BASE[id];
    const r = skill.find((sp) => sp.id === order[i]);
    if (!r) return;
    ctx.fillStyle = C.pink;
    const x0 = px(b.x), y0 = py(b.d), x1 = px(r.x), y1 = py(r.d + 1.5);
    const n = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0) / 2));
    for (let k = 0; k <= n; k += 2) ctx.fillRect(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), 1, 1);
  });
  // rushers: arrow at the QB
  for (const id of call.rush) {
    const b = DEF_BASE[id];
    const x0 = px(b.x), y0 = py(b.d), x1 = px(b.x * 0.4), y1 = py(-3.5);
    ctx.fillStyle = C.red;
    pixelLine(ctx, x0, y0, x1, y1);
    ctx.fillRect(x1 - 1, y1, 3, 1);
  }
  // the defenders
  for (const id of Object.keys(DEF_BASE) as DefId[]) {
    const b = DEF_BASE[id];
    ctx.fillStyle = id === 'MIKE' ? C.yellow : C.red; // you're the MIKE
    ctx.fillRect(px(b.x) - 1, py(b.d) - 1, 3, 3);
    if (id === 'MIKE') { ctx.fillStyle = C.red; ctx.fillRect(px(b.x), py(b.d), 1, 1); }
  }
}
