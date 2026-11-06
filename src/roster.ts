// The TEAM screen: your roster, with each player's overall and the ratings that
// matter most for his position. NEW TEAM rolls a fresh roster (tap twice).
import { C } from './config';
import { drawText } from './font';
import { type Player, type Pos, type RatingKey, type Roster, teamOvr } from './ratings';
import type { Vec } from './util';
import type { View } from './view';

type Rect = { x: number; y: number; w: number; h: number };
const hit = (r: Rect, p: Vec) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

const KEY_RATINGS: Record<Pos, RatingKey[]> = {
  QB: ['acc', 'arm', 'dec'], WR: ['spd', 'hnd', 'rte'], TE: ['hnd', 'blk', 'rte'], RB: ['spd', 'elu', 'hnd'],
  OL: ['blk'], DL: ['rsh', 'tkl', 'spd'], LB: ['tkl', 'cov', 'spd'], CB: ['cov', 'spd', 'bsk'], S: ['cov', 'tkl', 'bsk'], NB: ['cov', 'spd', 'bsk'],
};
const OFFENSE_POS: Pos[] = ['QB', 'WR', 'TE', 'RB', 'OL'];

function box(ctx: CanvasRenderingContext2D, r: Rect, fill: string, border: string): void {
  ctx.fillStyle = border;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = fill;
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
}

const ovrColor = (v: number) => (v >= 85 ? C.green : v >= 78 ? C.yellow : v >= 70 ? C.white : C.grey);

export class RosterView {
  tab: 'offense' | 'defense' = 'offense';
  confirmNew = false;
  constructor(public team: Roster, private opponent: Roster | null, private canReroll = true) {}

  layout(v: View) {
    const tabW = 70, tabY = v.landscape ? 18 : 34;
    const tabs = [
      { id: 'offense' as const, r: { x: Math.round(v.w / 2 - tabW - 2), y: tabY, w: tabW, h: 13 } },
      { id: 'defense' as const, r: { x: Math.round(v.w / 2 + 2), y: tabY, w: tabW, h: 13 } },
    ];
    const by = v.h - 18;
    const back = { x: Math.round(v.w / 2 - 62), y: by, w: 58, h: 14 };
    const fresh = { x: Math.round(v.w / 2 + 4), y: by, w: 58, h: 14 };
    return { tabs, back, fresh, listY: tabY + 24 };
  }

  /** Returns 'back' when you leave, 'new' when you roll a new team. */
  tap(p: Vec, v: View): 'back' | 'new' | null {
    const { tabs, back, fresh } = this.layout(v);
    for (const t of tabs) if (hit(t.r, p)) { this.tab = t.id; this.confirmNew = false; return null; }
    if (hit(back, p)) return 'back';
    if (hit(fresh, p) && this.canReroll) {
      if (this.confirmNew) { this.confirmNew = false; return 'new'; }
      this.confirmNew = true;
    }
    return null;
  }

  render(ctx: CanvasRenderingContext2D, v: View): void {
    ctx.fillStyle = 'rgba(17,29,43,0.97)';
    ctx.fillRect(0, 0, v.w, v.h);
    drawText(ctx, 'YOUR TEAM', v.w / 2, v.landscape ? 2 : 8, { scale: 2, color: C.blue, shadow: C.navy, align: 'center' });
    const sub = `OVR ${teamOvr(this.team)}` + (this.opponent ? `   VS ${this.opponent.name.length <= 10 ? this.opponent.name : 'OPP'} ${teamOvr(this.opponent)}` : '');
    if (v.landscape) drawText(ctx, sub, v.w - 6, 5, { align: 'right', color: C.grey }); // beside the title
    else drawText(ctx, sub, v.w / 2, 24, { align: 'center', color: C.grey });

    const { tabs, back, fresh, listY } = this.layout(v);
    for (const t of tabs) {
      const on = t.id === this.tab;
      box(ctx, t.r, on ? C.yellow : C.ink, on ? C.yellow : C.grey);
      drawText(ctx, t.id.toUpperCase(), t.r.x + t.r.w / 2, t.r.y + 4, { align: 'center', color: on ? C.ink : C.grey });
    }

    const players = this.team.players.filter((p) => OFFENSE_POS.includes(p.pos) === (this.tab === 'offense'));
    const rowH = v.landscape ? 9 : 11;
    const x0 = Math.round(v.w / 2 - 74);
    players.forEach((p, i) => this.row(ctx, p, x0, listY + i * rowH));
    drawText(ctx, 'OVR', x0 + 60, listY - 8, { color: C.darkGrey });

    box(ctx, back, C.ink, C.white);
    drawText(ctx, 'BACK', back.x + back.w / 2, back.y + 5, { align: 'center' });
    if (this.canReroll) {
      box(ctx, fresh, C.ink, this.confirmNew ? C.orange : C.grey);
      drawText(ctx, this.confirmNew ? 'SURE?' : 'NEW TEAM', fresh.x + fresh.w / 2, fresh.y + 5, { align: 'center', color: this.confirmNew ? C.orange : C.grey });
    }
  }

  private row(ctx: CanvasRenderingContext2D, p: Player, x: number, y: number): void {
    drawText(ctx, p.pos, x, y, { color: C.grey });
    drawText(ctx, p.name, x + 12, y);
    const t = this.team.tier ?? 0; // colours are relative to the level of play
    drawText(ctx, String(p.ovr), x + 60, y, { color: ovrColor(p.ovr - t) });
    KEY_RATINGS[p.pos].forEach((k, i) => {
      const val = p.r[k];
      drawText(ctx, `${k.toUpperCase()}${val}`, x + 74 + i * 26, y, { color: val - t >= 85 ? C.green : val - t < 65 ? C.grey : C.white });
    });
  }
}
