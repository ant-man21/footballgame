// The playbook menu: category tabs across the top, play cards with art below.
import { C, H, W } from './config';
import { drawText } from './font';
import { drawPlayArt } from './playart';
import { FORMATIONS } from './playbook/formations';
import { CATEGORIES, type CategoryId, PLAYS, type Play } from './playbook/plays';
import type { Vec } from './util';

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

  private layout() {
    const gap = 3;
    const tw = Math.floor((W - 8 - gap * (CATEGORIES.length - 1)) / CATEGORIES.length);
    const tabs = CATEGORIES.map((c, i) => ({ cat: c, r: { x: 4 + i * (tw + gap), y: 28, w: tw, h: 13 } }));
    const plays = PLAYS.filter((p) => p.category === this.tab).slice(0, 4);
    const cards = plays.map((play, i) => ({
      play, r: { x: i % 2 ? 92 : 6, y: 48 + Math.floor(i / 2) * 110, w: 82, h: 104 },
    }));
    const back = { x: W / 2 - 30, y: H - 22, w: 60, h: 14 };
    return { tabs, cards, back };
  }

  tap(p: Vec): MenuAction {
    const { tabs, cards, back } = this.layout();
    for (const t of tabs) if (hit(t.r, p)) { this.tab = t.cat.id; return null; }
    for (const c of cards) if (hit(c.r, p)) { this.selectedId = c.play.id; return { type: 'pick', play: c.play }; }
    if (hit(back, p)) return { type: 'close' };
    return null;
  }

  render(ctx: CanvasRenderingContext2D, clock: number): void {
    ctx.fillStyle = 'rgba(17,29,43,0.94)';
    ctx.fillRect(0, 0, W, H);
    drawText(ctx, 'PLAYBOOK', W / 2, 8, { scale: 2, color: C.yellow, shadow: C.navy, align: 'center' });

    const { tabs, cards, back } = this.layout();
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
      drawPlayArt(ctx, play, r.x + 3, r.y + 3, r.w - 6, 60);
      drawText(ctx, play.name, r.x + r.w / 2, r.y + 68, { align: 'center' });
      drawText(ctx, play.vs, r.x + r.w / 2, r.y + 78, { align: 'center', color: C.yellow });
      drawText(ctx, FORMATIONS[play.formation].name, r.x + r.w / 2, r.y + 90, { align: 'center', color: C.grey });
    }

    if (Math.floor(clock * 2) % 2 === 0) drawText(ctx, 'TAP A PLAY', W / 2, H - 38, { align: 'center', color: C.grey });
    box(ctx, back, C.ink, C.white);
    drawText(ctx, 'BACK', back.x + back.w / 2, back.y + 5, { align: 'center' });
  }
}
