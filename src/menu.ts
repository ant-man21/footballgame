// The playbook menu: category tabs across the top, play cards with art below.
import { C } from './config';
import { drawText } from './font';
import { drawPlayArt } from './playart';
import { FORMATIONS } from './playbook/formations';
import { CATEGORIES, type CategoryId, PLAYS, type Play } from './playbook/plays';
import type { Vec } from './util';
import type { View } from './view';

type Rect = { x: number; y: number; w: number; h: number };
const hit = (r: Rect, p: Vec) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

export type MenuAction = { type: 'pick'; play: Play } | { type: 'close' } | null;

function box(ctx: CanvasRenderingContext2D, r: Rect, fill: string, border: string): void {
  ctx.fillStyle = border;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = fill;
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
}

export class Menu {
  tab: CategoryId;
  constructor(public selectedId: string) {
    this.tab = PLAYS.find((p) => p.id === selectedId)?.category ?? CATEGORIES[0].id;
  }

  /** Card grid: 2 columns x 3 rows in portrait, 3 x 2 in landscape. */
  layout(v: View) {
    const gap = 3;
    const cols = v.landscape ? 3 : 2, rows = v.landscape ? 2 : 3;
    const tabY = v.landscape ? 18 : 28, tabH = v.landscape ? 12 : 13;
    const tabW = Math.floor(((v.landscape ? 210 : v.w - 8) - gap * (CATEGORIES.length - 1)) / CATEGORIES.length);
    const tabX0 = Math.round((v.w - (tabW * CATEGORIES.length + gap * (CATEGORIES.length - 1))) / 2);
    const tabs = CATEGORIES.map((c, i) => ({ cat: c, r: { x: tabX0 + i * (tabW + gap), y: tabY, w: tabW, h: tabH } }));
    const top = tabY + tabH + 5, bottom = v.h - 22;
    const cw = Math.floor((v.w - 8 - 4 * (cols - 1)) / cols);
    const ch = Math.floor((bottom - top - 4 * (rows - 1)) / rows);
    const plays = PLAYS.filter((p) => p.category === this.tab).slice(0, cols * rows);
    const cards = plays.map((play, i) => ({
      play, r: { x: 4 + (i % cols) * (cw + 4), y: top + Math.floor(i / cols) * (ch + 4), w: cw, h: ch },
    }));
    const back = { x: Math.round(v.w / 2 - 30), y: v.h - 18, w: 60, h: 14 };
    return { tabs, cards, back };
  }

  tap(p: Vec, v: View): MenuAction {
    const { tabs, cards, back } = this.layout(v);
    for (const t of tabs) if (hit(t.r, p)) { this.tab = t.cat.id; return null; }
    for (const c of cards) if (hit(c.r, p)) { this.selectedId = c.play.id; return { type: 'pick', play: c.play }; }
    if (hit(back, p)) return { type: 'close' };
    return null;
  }

  render(ctx: CanvasRenderingContext2D, v: View): void {
    ctx.fillStyle = 'rgba(17,29,43,0.96)';
    ctx.fillRect(0, 0, v.w, v.h);
    drawText(ctx, 'PLAYBOOK', v.w / 2, v.landscape ? 4 : 8, { scale: 2, color: C.yellow, shadow: C.navy, align: 'center' });

    const { tabs, cards, back } = this.layout(v);
    for (const t of tabs) {
      const on = t.cat.id === this.tab;
      box(ctx, t.r, on ? C.yellow : C.ink, on ? C.yellow : C.grey);
      drawText(ctx, t.cat.name, t.r.x + t.r.w / 2, t.r.y + 4, { align: 'center', color: on ? C.ink : C.grey });
    }

    for (const { play, r } of cards) {
      const picked = play.id === this.selectedId;
      box(ctx, r, C.navy, picked ? C.yellow : '#3b4a6b');
      if (picked) { // double border so the pick stands out
        ctx.fillStyle = C.yellow;
        ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, 1);
        ctx.fillRect(r.x + 1, r.y + r.h - 2, r.w - 2, 1);
      }
      const artH = r.h - 28;
      drawPlayArt(ctx, play, r.x + 3, r.y + 3, r.w - 6, artH);
      drawText(ctx, play.name, r.x + r.w / 2, r.y + artH + 7, { align: 'center' });
      drawText(ctx, play.vs, r.x + 4, r.y + artH + 18, { color: C.yellow });
      drawText(ctx, FORMATIONS[play.formation].name, r.x + r.w - 4, r.y + artH + 18, { align: 'right', color: C.grey });
    }

    box(ctx, back, C.ink, C.white);
    drawText(ctx, 'BACK', back.x + back.w / 2, back.y + 5, { align: 'center' });
  }
}
