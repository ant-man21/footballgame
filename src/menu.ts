// The playbook menu: category tabs across the top, play cards with art below,
// pages when a category has more plays than fit, and a settings panel.
import { C } from './config';
import { drawText } from './font';
import { drawPlayArt } from './playart';
import { FORMATIONS } from './playbook/formations';
import { CATEGORIES, type CategoryId, PLAYS, type Play } from './playbook/plays';
import { DIFFICULTIES, SPEEDS, type Settings, cycle } from './settings';
import type { Vec } from './util';
import type { View } from './view';

type Rect = { x: number; y: number; w: number; h: number };
const hit = (r: Rect, p: Vec) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

export type MenuAction = { type: 'pick'; play: Play } | { type: 'close' } | { type: 'settings' } | null;

function box(ctx: CanvasRenderingContext2D, r: Rect, fill: string, border: string): void {
  ctx.fillStyle = border;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = fill;
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
}

type Option = { id: string; name: string };
const SETTING_ROWS: { key: keyof Settings; label: string; list: Option[] }[] = [
  { key: 'difficulty', label: 'DIFFICULTY', list: DIFFICULTIES },
  { key: 'speed', label: 'GAME SPEED', list: SPEEDS },
  { key: 'aim', label: 'AIM MODE', list: [{ id: 'pull', name: 'PULL' }, { id: 'aim', name: 'AIM' }] },
];

export class Menu {
  tab: CategoryId;
  page = 0;
  showSettings = false;

  constructor(public selectedId: string, private settings: Settings) {
    this.tab = PLAYS.find((p) => p.id === selectedId)?.category ?? CATEGORIES[0].id;
    const inTab = PLAYS.filter((p) => p.category === this.tab);
    this.page = Math.max(0, Math.floor(inTab.findIndex((p) => p.id === selectedId) / 6));
  }

  /** Card grid: 2 columns x 3 rows in portrait, 3 x 2 in landscape; pages beyond that. */
  layout(v: View) {
    const gap = 3;
    const cols = v.landscape ? 3 : 2, rows = v.landscape ? 2 : 3, per = cols * rows;
    const tabY = v.landscape ? 18 : 28, tabH = v.landscape ? 12 : 13;
    const tabW = Math.floor(((v.landscape ? 240 : v.w - 8) - gap * (CATEGORIES.length - 1)) / CATEGORIES.length);
    const tabX0 = Math.round((v.w - (tabW * CATEGORIES.length + gap * (CATEGORIES.length - 1))) / 2);
    const tabs = CATEGORIES.map((c, i) => ({ cat: c, r: { x: tabX0 + i * (tabW + gap), y: tabY, w: tabW, h: tabH } }));
    const top = tabY + tabH + 5, bottom = v.h - 22;
    const cw = Math.floor((v.w - 8 - 4 * (cols - 1)) / cols);
    const ch = Math.floor((bottom - top - 4 * (rows - 1)) / rows);
    const all = PLAYS.filter((p) => p.category === this.tab);
    const pages = Math.max(1, Math.ceil(all.length / per));
    const page = Math.min(this.page, pages - 1);
    const cards = all.slice(page * per, page * per + per).map((play, i) => ({
      play, r: { x: 4 + (i % cols) * (cw + 4), y: top + Math.floor(i / cols) * (ch + 4), w: cw, h: ch },
    }));
    const by = v.h - 18;
    const back = { x: Math.round(v.w / 2 - 62), y: by, w: 58, h: 14 };
    const settings = { x: Math.round(v.w / 2 + 4), y: by, w: 58, h: 14 };
    const prev = pages > 1 ? { x: 4, y: by, w: 22, h: 14 } : null;
    const next = pages > 1 ? { x: v.w - 26, y: by, w: 22, h: 14 } : null;
    return { tabs, cards, back, settings, prev, next, page, pages };
  }

  /** Settings panel rows: label plus < value > arrows. */
  settingsLayout(v: View) {
    const top = v.landscape ? 34 : 60, rowH = v.landscape ? 34 : 44;
    const w = Math.min(160, v.w - 16), x = Math.round((v.w - w) / 2);
    const rows = SETTING_ROWS.map((row, i) => {
      const y = top + i * rowH;
      return { row, y, left: { x, y: y + 9, w: 22, h: 16 }, right: { x: x + w - 22, y: y + 9, w: 22, h: 16 }, mid: x + w / 2 };
    });
    const done = { x: Math.round(v.w / 2 - 30), y: v.h - 18, w: 60, h: 14 };
    return { rows, done };
  }

  tap(p: Vec, v: View): MenuAction {
    if (this.showSettings) {
      const { rows, done } = this.settingsLayout(v);
      for (const r of rows) {
        const dir = hit(r.left, p) ? -1 : hit(r.right, p) ? 1 : 0;
        if (!dir) continue;
        const s = this.settings as unknown as Record<string, string>;
        s[r.row.key] = cycle(r.row.list, s[r.row.key], dir);
        return { type: 'settings' };
      }
      if (hit(done, p)) this.showSettings = false;
      return null;
    }
    const { tabs, cards, back, settings, prev, next, page, pages } = this.layout(v);
    for (const t of tabs) if (hit(t.r, p)) { this.tab = t.cat.id; this.page = 0; return null; }
    for (const c of cards) if (hit(c.r, p)) { this.selectedId = c.play.id; return { type: 'pick', play: c.play }; }
    if (prev && hit(prev, p)) { this.page = (page - 1 + pages) % pages; return null; }
    if (next && hit(next, p)) { this.page = (page + 1) % pages; return null; }
    if (hit(settings, p)) { this.showSettings = true; return null; }
    if (hit(back, p)) return { type: 'close' };
    return null;
  }

  render(ctx: CanvasRenderingContext2D, v: View): void {
    ctx.fillStyle = 'rgba(17,29,43,0.96)';
    ctx.fillRect(0, 0, v.w, v.h);
    if (this.showSettings) { this.renderSettings(ctx, v); return; }
    drawText(ctx, 'PLAYBOOK', v.w / 2, v.landscape ? 4 : 8, { scale: 2, color: C.yellow, shadow: C.navy, align: 'center' });

    const { tabs, cards, back, settings, prev, next, page, pages } = this.layout(v);
    for (const t of tabs) {
      const on = t.cat.id === this.tab;
      box(ctx, t.r, on ? C.yellow : C.ink, on ? C.yellow : C.grey);
      drawText(ctx, t.cat.name, t.r.x + t.r.w / 2, t.r.y + Math.floor((t.r.h - 5) / 2), { align: 'center', color: on ? C.ink : C.grey });
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
    box(ctx, settings, C.ink, C.grey);
    drawText(ctx, 'SETTINGS', settings.x + settings.w / 2, settings.y + 5, { align: 'center', color: C.grey });
    if (prev && next) {
      box(ctx, prev, C.ink, C.yellow);
      drawText(ctx, '<', prev.x + prev.w / 2, prev.y + 5, { align: 'center', color: C.yellow });
      box(ctx, next, C.ink, C.yellow);
      drawText(ctx, '>', next.x + next.w / 2, next.y + 5, { align: 'center', color: C.yellow });
      drawText(ctx, `PAGE ${page + 1}/${pages}`, v.w - 6, v.landscape ? 6 : 12, { align: 'right', color: C.yellow });
    }
  }

  private renderSettings(ctx: CanvasRenderingContext2D, v: View): void {
    drawText(ctx, 'SETTINGS', v.w / 2, v.landscape ? 6 : 20, { scale: 2, color: C.yellow, shadow: C.navy, align: 'center' });
    const { rows, done } = this.settingsLayout(v);
    const s = this.settings as unknown as Record<string, string>;
    for (const r of rows) {
      drawText(ctx, r.row.label, r.mid, r.y, { align: 'center', color: C.grey });
      const cur = r.row.list.find((x) => x.id === s[r.row.key]);
      box(ctx, r.left, C.ink, C.yellow);
      drawText(ctx, '<', r.left.x + r.left.w / 2, r.left.y + 6, { align: 'center', color: C.yellow });
      box(ctx, r.right, C.ink, C.yellow);
      drawText(ctx, '>', r.right.x + r.right.w / 2, r.right.y + 6, { align: 'center', color: C.yellow });
      drawText(ctx, cur?.name ?? '', r.mid, r.left.y + 3, { scale: 2, align: 'center' });
    }
    const note = this.settings.difficulty === 'rookie' ? 'SLOWER DEFENDERS, MORE CATCHES'
      : this.settings.difficulty === 'pro' ? 'A LITTLE HELP' : 'NO HELP';
    drawText(ctx, note, v.w / 2, rows[0].y + 28, { align: 'center', color: C.grey });
    box(ctx, done, C.ink, C.white);
    drawText(ctx, 'DONE', done.x + done.w / 2, done.y + 5, { align: 'center' });
  }
}
