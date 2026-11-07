// The huddle: call your play (offense) or your defense before every snap.
// Category tabs, cards with diagrams, pages when a tab has more than fit, quick
// buttons (same play / auto / punt), and a settings panel (opened from pause).
import { C } from './config';
import { drawCallArt } from './defart';
import { CALLS, type Call, DEF_CATEGORIES, callCategory, rushLabel } from './defense/calls';
import { drawText } from './font';
import { drawPlayArt } from './playart';
import { FORMATIONS } from './playbook/formations';
import { CATEGORIES, PLAYS, type Play } from './playbook/plays';
import { DIFFICULTIES, QUARTERS, SPEEDS, type Settings, cycle } from './settings';
import type { Vec } from './util';
import type { View } from './view';

type Rect = { x: number; y: number; w: number; h: number };
const hit = (r: Rect, p: Vec) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

export type MenuAction =
  | { type: 'pick'; play: Play }
  | { type: 'pickCall'; call: Call }
  | { type: 'same' } | { type: 'auto' } | { type: 'punt' }
  | { type: 'close' } | { type: 'settings' } | { type: 'start' } | { type: 'team' } | { type: 'career' }
  | null;

export interface MenuOptions {
  kind: 'offense' | 'defense';
  selectedId: string | null; // last call, highlighted
  settings: Settings;
  subtitle?: string; // e.g. "2ND & 7 - OWN 35 - Q2 1:48"
  fourthDown?: boolean; // offense: show PUNT
  settingsOnly?: boolean; // opened from pause: just the settings panel
  title?: boolean; // the start screen: PLAY NOW, CAREER, TEAM, SETTINGS (game options live in SETTINGS)
}

function box(ctx: CanvasRenderingContext2D, r: Rect, fill: string, border: string): void {
  ctx.fillStyle = border;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = fill;
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
}

type Option = { id: string; name: string };
const QUARTER_ROW: { key: keyof Settings; label: string; list: Option[] } = { key: 'quarter', label: 'QUARTER LENGTH', list: QUARTERS };
const SETTING_ROWS: { key: keyof Settings; label: string; list: Option[] }[] = [
  { key: 'difficulty', label: 'DIFFICULTY', list: DIFFICULTIES },
  { key: 'speed', label: 'GAME SPEED', list: SPEEDS },
  { key: 'aim', label: 'AIM MODE', list: [{ id: 'pull', name: 'PULL' }, { id: 'aim', name: 'AIM' }] },
];

type Item = { id: string; cat: string; play?: Play; call?: Call };

export class Menu {
  tab: string;
  page = 0;
  showSettings: boolean;
  private items: Item[];
  private cats: readonly { id: string; name: string }[];

  constructor(private o: MenuOptions) {
    this.showSettings = !!o.settingsOnly; // the title screen opens its settings with SETTINGS
    if (o.kind === 'offense') {
      this.cats = CATEGORIES;
      this.items = PLAYS.map((p) => ({ id: p.id, cat: p.category, play: p }));
    } else {
      this.cats = DEF_CATEGORIES;
      this.items = CALLS.map((c) => ({ id: c.id, cat: callCategory(c), call: c }));
    }
    this.tab = this.items.find((it) => it.id === o.selectedId)?.cat ?? this.cats[0].id;
    const inTab = this.items.filter((it) => it.cat === this.tab);
    this.page = Math.max(0, Math.floor(inTab.findIndex((it) => it.id === o.selectedId) / 6));
  }

  get selectedId(): string | null { return this.o.selectedId; }

  /** Card grid: 2 columns x 3 rows in portrait, 3 x 2 in landscape; pages beyond that. */
  layout(v: View) {
    const gap = 3;
    const cols = v.landscape ? 3 : 2, rows = v.landscape ? 2 : 3, per = cols * rows;
    const tabY = v.landscape ? 20 : 30, tabH = v.landscape ? 12 : 13;
    const n = this.cats.length;
    const tabW = Math.floor(((v.landscape ? 240 : v.w - 8) - gap * (n - 1)) / n);
    const tabX0 = Math.round((v.w - (tabW * n + gap * (n - 1))) / 2);
    const tabs = this.cats.map((c, i) => ({ cat: c, r: { x: tabX0 + i * (tabW + gap), y: tabY, w: tabW, h: tabH } }));
    const top = tabY + tabH + 4, bottom = v.h - 22;
    const cw = Math.floor((v.w - 8 - 4 * (cols - 1)) / cols);
    const ch = Math.floor((bottom - top - 4 * (rows - 1)) / rows);
    const all = this.items.filter((it) => it.cat === this.tab);
    const pages = Math.max(1, Math.ceil(all.length / per));
    const page = Math.min(this.page, pages - 1);
    const cards = all.slice(page * per, page * per + per).map((it, i) => ({
      it, r: { x: 4 + (i % cols) * (cw + 4), y: top + Math.floor(i / cols) * (ch + 4), w: cw, h: ch },
    }));
    // quick buttons along the bottom
    const by = v.h - 18;
    const labels: { type: 'same' | 'auto' | 'punt'; label: string }[] = [];
    if (this.o.kind === 'defense') labels.push({ type: 'auto', label: 'AUTO' });
    if (this.o.selectedId) labels.push({ type: 'same', label: this.o.kind === 'offense' ? 'SAME PLAY' : 'SAME CALL' });
    if (this.o.fourthDown) labels.push({ type: 'punt', label: 'PUNT' });
    const bw = 52, total = labels.length * bw + (labels.length - 1) * 4;
    const quick = labels.map((l, i) => ({ ...l, r: { x: Math.round(v.w / 2 - total / 2 + i * (bw + 4)), y: by, w: bw, h: 14 } }));
    const prev = pages > 1 ? { x: 4, y: by, w: 22, h: 14 } : null;
    const next = pages > 1 ? { x: v.w - 26, y: by, w: 22, h: 14 } : null;
    return { tabs, cards, quick, prev, next, page, pages };
  }

  /** The title screen's buttons, stacked in the middle. */
  titleLayout(v: View) {
    const w = v.landscape ? 150 : 128, x = Math.round((v.w - w) / 2);
    const y0 = v.landscape ? 60 : 136, big = v.landscape ? 22 : 26, small = v.landscape ? 18 : 20, gap = v.landscape ? 5 : 7;
    const play = { x, y: y0, w, h: big };
    const career = { x, y: play.y + big + gap, w, h: big };
    const half = (w - gap) / 2;
    const team = { x, y: career.y + big + gap, w: Math.floor(half), h: small };
    const settings = { x: x + Math.ceil(half) + gap, y: team.y, w: Math.floor(half), h: small };
    return { play, career, team, settings };
  }

  /** Settings panel rows: label plus < value > arrows. From the title screen it also has the quarter length. */
  settingsLayout(v: View) {
    const title = !!this.o.title;
    const list = title ? [QUARTER_ROW, ...SETTING_ROWS] : SETTING_ROWS;
    const top = title ? (v.landscape ? 26 : 56) : v.landscape ? 34 : 60;
    const rowH = title ? (v.landscape ? 31 : 48) : v.landscape ? 34 : 44;
    const w = Math.min(160, v.w - 16), x = Math.round((v.w - w) / 2);
    const rows = list.map((row, i) => {
      const y = top + i * rowH;
      return { row, y, left: { x, y: y + 9, w: 22, h: 16 }, right: { x: x + w - 22, y: y + 9, w: 22, h: 16 }, mid: x + w / 2 };
    });
    const mid = Math.round(v.w / 2);
    const done = title && !v.landscape ? { x: mid - 40, y: v.h - 40, w: 80, h: 18 } : { x: mid - 30, y: v.h - 18, w: 60, h: 14 };
    return { rows, done };
  }

  tap(p: Vec, v: View): MenuAction {
    if (this.o.title && !this.showSettings) {
      const L = this.titleLayout(v);
      if (hit(L.play, p)) return { type: 'start' };
      if (hit(L.career, p)) return { type: 'career' };
      if (hit(L.team, p)) return { type: 'team' };
      if (hit(L.settings, p)) this.showSettings = true;
      return null;
    }
    if (this.showSettings) {
      const { rows, done } = this.settingsLayout(v);
      for (const r of rows) {
        const dir = hit(r.left, p) ? -1 : hit(r.right, p) ? 1 : 0;
        if (!dir) continue;
        const s = this.o.settings as unknown as Record<string, string>;
        s[r.row.key] = cycle(r.row.list, s[r.row.key], dir);
        return { type: 'settings' };
      }
      if (hit(done, p)) {
        if (this.o.title) { this.showSettings = false; return { type: 'settings' }; } // back to the title screen
        if (this.o.settingsOnly) return { type: 'close' };
        this.showSettings = false;
      }
      return null;
    }
    const { tabs, cards, quick, prev, next, page, pages } = this.layout(v);
    for (const t of tabs) if (hit(t.r, p)) { this.tab = t.cat.id; this.page = 0; return null; }
    for (const c of cards) {
      if (!hit(c.r, p)) continue;
      this.o.selectedId = c.it.id;
      return c.it.play ? { type: 'pick', play: c.it.play } : { type: 'pickCall', call: c.it.call! };
    }
    if (prev && hit(prev, p)) { this.page = (page - 1 + pages) % pages; return null; }
    if (next && hit(next, p)) { this.page = (page + 1) % pages; return null; }
    for (const q of quick) if (hit(q.r, p)) return { type: q.type };
    return null;
  }

  render(ctx: CanvasRenderingContext2D, v: View): void {
    if (this.o.title && !this.showSettings) { this.renderTitle(ctx, v); return; }
    ctx.fillStyle = 'rgba(17,29,43,0.96)';
    ctx.fillRect(0, 0, v.w, v.h);
    if (this.showSettings) { this.renderSettings(ctx, v); return; }
    const offense = this.o.kind === 'offense';
    drawText(ctx, offense ? 'CALL A PLAY' : 'CALL A DEFENSE', v.w / 2, v.landscape ? 3 : 6, { scale: 2, color: offense ? C.yellow : C.red, shadow: C.navy, align: 'center' });
    if (this.o.subtitle) drawText(ctx, this.o.subtitle, v.w / 2, v.landscape ? 14 : 21, { align: 'center', color: C.grey });

    const { tabs, cards, quick, prev, next, page, pages } = this.layout(v);
    for (const t of tabs) {
      const on = t.cat.id === this.tab;
      box(ctx, t.r, on ? C.yellow : C.ink, on ? C.yellow : C.grey);
      drawText(ctx, t.cat.name, t.r.x + t.r.w / 2, t.r.y + Math.floor((t.r.h - 5) / 2), { align: 'center', color: on ? C.ink : C.grey });
    }

    for (const { it, r } of cards) {
      const picked = it.id === this.o.selectedId;
      box(ctx, r, C.navy, picked ? C.yellow : '#3b4a6b');
      if (picked) { // double border so the last call stands out
        ctx.fillStyle = C.yellow;
        ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, 1);
        ctx.fillRect(r.x + 1, r.y + r.h - 2, r.w - 2, 1);
      }
      const artH = r.h - 28;
      if (it.play) {
        drawPlayArt(ctx, it.play, r.x + 3, r.y + 3, r.w - 6, artH);
        drawText(ctx, it.play.name, r.x + r.w / 2, r.y + artH + 7, { align: 'center' });
        drawText(ctx, it.play.vs, r.x + 4, r.y + artH + 18, { color: C.yellow });
        drawText(ctx, FORMATIONS[it.play.formation].name, r.x + r.w - 4, r.y + artH + 18, { align: 'right', color: C.grey });
      } else if (it.call) {
        drawCallArt(ctx, it.call, r.x + 3, r.y + 3, r.w - 6, artH);
        drawText(ctx, it.call.name, r.x + r.w / 2, r.y + artH + 7, { align: 'center' });
        drawText(ctx, rushLabel(it.call), r.x + 4, r.y + artH + 18, { color: it.call.rush.length >= 5 ? C.orange : C.yellow });
        drawText(ctx, it.call.family === 'man' ? 'MAN' : 'ZONE', r.x + r.w - 4, r.y + artH + 18, { align: 'right', color: C.grey });
      }
    }

    for (const q of quick) {
      const color = q.type === 'punt' ? C.white : C.green;
      box(ctx, q.r, C.ink, color);
      drawText(ctx, q.label, q.r.x + q.r.w / 2, q.r.y + 5, { align: 'center', color });
    }
    if (prev && next) {
      box(ctx, prev, C.ink, C.yellow);
      drawText(ctx, '<', prev.x + prev.w / 2, prev.y + 5, { align: 'center', color: C.yellow });
      box(ctx, next, C.ink, C.yellow);
      drawText(ctx, '>', next.x + next.w / 2, next.y + 5, { align: 'center', color: C.yellow });
      drawText(ctx, `${page + 1}/${pages}`, v.w - 6, v.landscape ? 14 : 21, { align: 'right', color: C.yellow });
    }
  }

  /** The title screen: the name over the field, four buttons, and the current settings in one quiet line. */
  private renderTitle(ctx: CanvasRenderingContext2D, v: View): void {
    ctx.fillStyle = 'rgba(17,29,43,0.82)'; // the field shows through
    ctx.fillRect(0, 0, v.w, v.h);
    const mid = v.w / 2, ty = v.landscape ? 14 : 52;
    drawText(ctx, 'FOOTBALL', mid, ty, { scale: 4, color: C.yellow, shadow: C.red, align: 'center' });
    ctx.fillStyle = C.red;
    ctx.fillRect(Math.round(mid - 70), ty + 26, 140, 1);
    drawText(ctx, 'PASS-FIRST POCKET GRIDIRON', mid, ty + 31, { align: 'center', color: C.grey });
    const L = this.titleLayout(v);
    const btn = (r: Rect, label: string, color: string, scale = 1) => {
      box(ctx, r, C.ink, color);
      drawText(ctx, label, r.x + r.w / 2, r.y + Math.floor((r.h - 5 * scale) / 2), { align: 'center', color, scale });
    };
    btn(L.play, 'PLAY NOW', C.green, 2);
    btn(L.career, 'CAREER', C.yellow, 2);
    btn(L.team, 'TEAM', C.blue);
    btn(L.settings, 'SETTINGS', C.white);
    const st = this.o.settings;
    const name = (list: Option[], id: string) => list.find((x) => x.id === id)?.name ?? '';
    const summary = `${name(DIFFICULTIES, st.difficulty)} - ${name(QUARTERS, st.quarter)} QUARTERS - ${st.aim.toUpperCase()} AIM`;
    drawText(ctx, summary, mid, v.landscape ? v.h - 12 : v.h - 28, { align: 'center', color: C.darkGrey });
    drawText(ctx, `BUILD ${__BUILD__}`, v.w - 3, v.h - 8, { align: 'right', color: C.darkGrey });
  }

  private renderSettings(ctx: CanvasRenderingContext2D, v: View): void {
    const title = !!this.o.title;
    drawText(ctx, 'SETTINGS', v.w / 2, v.landscape ? 6 : 20, { scale: 2, color: C.yellow, shadow: C.navy, align: 'center' });
    const { rows, done } = this.settingsLayout(v);
    const s = this.o.settings as unknown as Record<string, string>;
    for (const r of rows) {
      drawText(ctx, r.row.label, r.mid, r.y, { align: 'center', color: C.grey });
      const cur = r.row.list.find((x) => x.id === s[r.row.key]);
      box(ctx, r.left, C.ink, C.yellow);
      drawText(ctx, '<', r.left.x + r.left.w / 2, r.left.y + 6, { align: 'center', color: C.yellow });
      box(ctx, r.right, C.ink, C.yellow);
      drawText(ctx, '>', r.right.x + r.right.w / 2, r.right.y + 6, { align: 'center', color: C.yellow });
      drawText(ctx, cur?.name ?? '', r.mid, r.left.y + 3, { scale: 2, align: 'center' });
    }
    const note = this.o.settings.difficulty === 'rookie' ? 'SLOWER DEFENDERS, MORE CATCHES'
      : this.o.settings.difficulty === 'pro' ? 'A LITTLE HELP' : 'NO HELP';
    const diffRow = rows.find((r) => r.row.key === 'difficulty')!;
    if (!v.landscape || !title) drawText(ctx, note, v.w / 2, diffRow.y + 28, { align: 'center', color: C.grey });
    box(ctx, done, C.ink, C.white);
    drawText(ctx, 'DONE', done.x + done.w / 2, done.y + Math.floor((done.h - 5) / 2), { align: 'center' });
  }
}
