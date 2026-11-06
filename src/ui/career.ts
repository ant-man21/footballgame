// The career screens: start (continue / new), create your QB, the weekly hub,
// game day, the week's result, schedule, standings (and the playoff bracket),
// stats, the season summary and the end of high school. Each screen lays
// itself out for portrait (180x320) and landscape (~400x180).
import { C } from '../config';
import { Career, type GamePlan, HS_YEARS, type WeekLog } from '../career/career';
import { STATES, randomName } from '../career/hsnames';
import { type GameRec, PLAYOFF_ROUNDS, REGION_NAMES, ROUND_NAMES, played, regionOrder } from '../career/league';
import {
  ARCHETYPES, type Archetype, CLASS_NAMES, CLASS_SHORT, FOCUSES, displayName, passerRating, qbOvr,
} from '../career/player';
import { type College, TIER_NAMES, board, college, offerList, toNextStar, walkOns } from '../career/recruiting';
import { deleteCareer, loadCareer, saveCareer } from '../career/save';
import type { TeamStats } from '../drive';
import { drawText } from '../font';
import type { Game } from '../game';
import { QUARTERS, cycle } from '../settings';
import type { Vec } from '../util';
import type { View } from '../view';
import { type Rect, badge, badgeWidth, box, button, hit, meter, screenBg, stars, stepper } from './kit';

type Screen = 'start' | 'create' | 'hub' | 'gameday' | 'result' | 'schedule' | 'standings' | 'stats' | 'summary' | 'recruiting' | 'signing' | 'done';

const r = (x: number, y: number, w: number, h: number): Rect => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
const cleanName = (s: string) => s.toUpperCase().replace(/[^A-Z' -]/g, '').trim().slice(0, 10);
const line = (s: TeamStats) => `${s.cmp}/${s.att}  ${s.yards} YDS  ${s.tds} TD  ${s.int} INT`;
const gradeColor = (g: number) => (g >= 75 ? C.green : g >= 60 ? C.yellow : g >= 45 ? C.white : C.orange);

/** Splits text into lines of at most n characters. */
function wrap(text: string, n: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) {
    if (cur && (cur + ' ' + w).length > n) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

export class CareerScreens {
  screen: Screen = 'start';
  career: Career | null = null;
  plan: GamePlan | null = null;
  lastLog: WeekLog | null = null;
  battleBefore: number | null = null;
  confirmNew = false;
  pick: string | null = null; // recruiting / signing day: the school tapped once (tap again to confirm)
  standingsTab: 'regions' | 'playoffs' = 'regions';
  // character creation
  first = 'JAKE';
  last = 'MOORE';
  stateIdx = STATES.findIndex((s) => s.id === 'TX');
  arch: Archetype = 'pocket';

  constructor(private game: Game) {}

  /** From the title screen's CAREER button. */
  open(): void {
    const saved = loadCareer();
    this.career = saved ? new Career(saved) : null;
    this.confirmNew = false;
    if (!this.career) this.newCreate();
    else this.screen = 'start';
    this.game.showCareer(this);
  }

  private newCreate(): void {
    const n = randomName();
    this.first = n.first; this.last = n.last;
    this.screen = 'create';
  }

  /** Tests: go to the screen for the career's phase. */
  toHubForTest(): void { this.toHub(); }

  private toHub(): void {
    const c = this.career!;
    this.screen = c.s.phase === 'summary' ? 'summary' : c.s.phase === 'signing' ? 'signing' : c.s.phase === 'done' ? 'done' : 'hub';
    this.pick = null;
    this.game.showCareer(this);
  }

  // ---------- actions ----------

  /** Creates the career (tests call this directly). */
  create(first = this.first, last = this.last, stateId = STATES[this.stateIdx].id, arch = this.arch): Career {
    deleteCareer();
    this.career = Career.create(first, last, stateId, arch, Number(this.game.settings.quarter) * 60);
    this.screen = 'hub';
    return this.career;
  }

  /** GAME DAY: sets up the week's game; a week on the sideline goes straight to its result. */
  gameDay(): void {
    const c = this.career!;
    this.battleBefore = c.s.role === 'backup' ? c.s.battle : null;
    const plan = c.prepareGame();
    if (!plan) { this.toHub(); return; }
    this.plan = plan;
    if (plan.kind === 'none') { this.finish(); return; }
    this.screen = 'gameday';
  }

  /** TAKE THE FIELD */
  play(): void {
    const c = this.career!, plan = this.plan!;
    const shift = { rookie: -3, pro: 0, allpro: 3 }[this.game.settings.difficulty]; // difficulty: how good the other teams play
    this.game.playCareerGame({
      match: plan.match, you: c.rosterWithYou(), opp: c.opponentRoster(plan.opp, shift),
      units: { you: plan.units.you, cpu: { off: plan.units.cpu.off + shift, def: plan.units.cpu.def + shift } },
      simDefense: c.s.defense === 'sim', coachCalls: c.s.calls !== 'you', endAtHalf: plan.endAtHalf, label: plan.label,
      onDone: (_m, stint) => this.finish(stint),
    });
  }

  /** The game is over (or your part of it): record it and show the week's result. */
  finish(stint?: TeamStats): void {
    const c = this.career!, plan = this.plan!;
    this.lastLog = c.finishGame(plan, stint);
    this.plan = null;
    this.screen = 'result';
    this.game.showCareer(this);
  }

  // ---------- input ----------

  tap(p: Vec, v: View): void {
    const c = this.career;
    switch (this.screen) {
      case 'start': {
        const L = this.startLayout(v);
        if (hit(L.cont, p) && c) { this.toHub(); return; }
        if (hit(L.fresh, p)) { if (this.confirmNew || !c) this.newCreate(); else this.confirmNew = true; return; }
        if (hit(L.back, p)) this.game.showTitle();
        return;
      }
      case 'create': {
        const L = this.createLayout(v);
        if (hit(L.reroll, p)) { const n = randomName(); this.first = n.first; this.last = n.last; }
        if (hit(L.edit, p)) this.editName();
        if (hit(L.stateL, p)) this.stateIdx = (this.stateIdx - 1 + STATES.length) % STATES.length;
        if (hit(L.stateR, p)) this.stateIdx = (this.stateIdx + 1) % STATES.length;
        if (hit(L.archL, p)) this.arch = cycle(ARCHETYPES, this.arch, -1) as Archetype;
        if (hit(L.archR, p)) this.arch = cycle(ARCHETYPES, this.arch, 1) as Archetype;
        if (hit(L.start, p)) this.create();
        if (hit(L.back, p)) { if (this.career) this.screen = 'start'; else this.game.showTitle(); }
        return;
      }
      case 'hub': {
        if (!c) return;
        const L = this.hubLayout(v);
        if (hit(L.focusL, p)) { c.s.focus = cycle(FOCUSES, c.s.focus, -1) as typeof c.s.focus; this.save(); }
        if (hit(L.focusR, p)) { c.s.focus = cycle(FOCUSES, c.s.focus, 1) as typeof c.s.focus; this.save(); }
        if (hit(L.gameDay, p)) this.gameDay();
        if (hit(L.schedule, p)) this.screen = 'schedule';
        if (hit(L.standings, p)) { this.screen = 'standings'; this.standingsTab = c.isPlayoffs ? 'playoffs' : 'regions'; }
        if (hit(L.stats, p)) this.screen = 'stats';
        if (hit(L.team, p)) this.game.showRosterOf(c.rosterWithYou());
        if (hit(L.recruiting, p)) { this.screen = 'recruiting'; this.pick = null; }
        if (hit(L.defense, p)) { c.s.defense = c.s.defense === 'play' ? 'sim' : 'play'; this.save(); }
        if (hit(L.calls, p)) { c.s.calls = c.s.calls === 'you' ? 'coach' : 'you'; this.save(); }
        if (hit(L.menu, p)) this.game.showTitle();
        return;
      }
      case 'gameday': {
        const L = this.gamedayLayout(v);
        if (hit(L.go, p)) this.play();
        return;
      }
      case 'result': {
        if (hit(this.bottomButton(v), p)) this.toHub();
        return;
      }
      case 'standings': {
        const L = this.standingsLayout(v);
        if (hit(L.tabR, p)) this.standingsTab = 'regions';
        if (hit(L.tabP, p) && c?.s.games.some((g) => g.round)) this.standingsTab = 'playoffs';
        if (hit(this.bottomButton(v), p)) this.screen = 'hub';
        return;
      }
      case 'schedule': case 'stats':
        if (hit(this.bottomButton(v), p)) this.screen = 'hub';
        return;
      case 'summary':
        if (hit(this.bottomButton(v), p) && c) { c.nextSeason(); this.toHub(); }
        return;
      case 'recruiting': {
        if (!c) return;
        if (hit(this.bottomButton(v), p)) { this.screen = 'hub'; return; }
        const row = this.recruitRows(v).find((x) => hit(x.r, p));
        if (!row) { this.pick = null; return; }
        const rs = c.s.recruit, id = row.c.id;
        if (!rs.offers.includes(id)) { this.pick = null; return; }
        if (this.pick !== id) { this.pick = id; return; }
        c.commit(rs.committed === id ? null : id);
        this.pick = null;
        return;
      }
      case 'signing': {
        if (!c) return;
        const row = this.signingRows(v).find((x) => hit(x.r, p));
        if (!row) { this.pick = null; return; }
        if (this.pick !== row.c.id) { this.pick = row.c.id; return; }
        c.sign(row.c.id);
        this.pick = null;
        this.screen = 'done';
        return;
      }
      case 'done': {
        const L = this.doneLayout(v);
        if (hit(L.fresh, p)) { if (this.confirmNew) { this.confirmNew = false; this.newCreate(); } else this.confirmNew = true; }
        if (hit(L.menu, p)) this.game.showTitle();
        return;
      }
    }
  }

  private save(): void {
    // the career saves itself after every week; small changes (focus, defense) save here
    if (this.career) saveCareer(this.career.s);
  }

  private editName(): void {
    try {
      const raw = window.prompt('YOUR NAME (FIRST LAST)', `${this.first} ${this.last}`);
      if (!raw) return;
      const parts = raw.trim().split(/\s+/);
      const f = cleanName(parts[0] ?? ''), l = cleanName(parts.slice(1).join(' '));
      if (f) this.first = f;
      if (l) this.last = l;
    } catch { /* no prompt available */ }
  }

  // ---------- layouts ----------

  private bottomButton(v: View): Rect { return r(v.w / 2 - 40, v.h - 20, 80, 16); }

  startLayout(v: View) {
    const mid = v.w / 2, y = v.landscape ? 96 : 170;
    return { cont: r(mid - 60, y, 120, 20), fresh: r(mid - 60, y + 26, 120, 16), back: r(mid - 40, v.h - 20, 80, 16) };
  }

  createLayout(v: View) {
    if (v.landscape) {
      const lx = 12, rx = v.w / 2 + 6, cw = v.w / 2 - 18;
      return {
        nameY: 30, nameX: lx + cw / 2, reroll: r(lx, 50, cw / 2 - 2, 14), edit: r(lx + cw / 2 + 2, 50, cw / 2 - 2, 14),
        stateY: 76, stateL: r(lx, 86, 20, 16), stateR: r(lx + cw - 20, 86, 20, 16),
        archY: 30, archL: r(rx, 40, 20, 16), archR: r(rx + cw - 20, 40, 20, 16), archX: rx + cw / 2,
        start: r(rx, v.h - 44, cw, 20), back: r(lx, v.h - 40, 60, 16), lx, rx, cw,
      };
    }
    const x = 10, cw = v.w - 20;
    return {
      nameY: 44, nameX: v.w / 2, reroll: r(x, 64, cw / 2 - 2, 14), edit: r(x + cw / 2 + 2, 64, cw / 2 - 2, 14),
      stateY: 94, stateL: r(x, 104, 22, 16), stateR: r(x + cw - 22, 104, 22, 16),
      archY: 134, archL: r(x, 144, 22, 16), archR: r(x + cw - 22, 144, 22, 16), archX: v.w / 2,
      start: r(x + 10, v.h - 50, cw - 20, 22), back: r(v.w / 2 - 40, v.h - 22, 80, 16), lx: x, rx: x, cw,
    };
  }

  hubLayout(v: View) {
    if (v.landscape) {
      const lw = Math.floor(v.w * 0.55) - 6, rx = lw + 10, rw = v.w - rx - 4, half = (rw - 4) / 2;
      return {
        left: { x: 4, w: lw }, focusY: 4, focusL: r(rx, 12, 20, 16), focusR: r(rx + rw - 20, 12, 20, 16),
        gameDay: r(rx, 34, rw, 22), schedule: r(rx, 62, half, 16), standings: r(rx + half + 4, 62, half, 16),
        stats: r(rx, 82, half, 16), team: r(rx + half + 4, 82, half, 16), recruiting: r(rx, 102, rw, 16),
        defense: r(rx, 126, half, 14), calls: r(rx + half + 4, 126, half, 14), menu: r(rx + rw / 2 - 30, v.h - 18, 60, 14),
        panels: { head: 4, next: 26, depth: 64, you: 96 },
      };
    }
    const x = 4, w = v.w - 8, half = (w - 4) / 2;
    return {
      left: { x, w }, focusY: 171, focusL: r(x, 179, 22, 16), focusR: r(x + w - 22, 179, 22, 16),
      gameDay: r(x, 199, w, 22), schedule: r(x, 225, half, 16), standings: r(x + half + 4, 225, half, 16),
      stats: r(x, 244, half, 16), team: r(x + half + 4, 244, half, 16), recruiting: r(x, 263, w, 16),
      defense: r(x, 284, half, 14), calls: r(x + half + 4, 284, half, 14), menu: r(v.w / 2 - 30, 303, 60, 14),
      panels: { head: 4, next: 30, depth: 76, you: 120 },
    };
  }

  gamedayLayout(v: View) { return { go: r(v.w / 2 - 55, v.h - (v.landscape ? 30 : 60), 110, 22) }; }

  standingsLayout(v: View) {
    const y = v.landscape ? 4 : 24;
    return { tabR: r(v.w / 2 - 72, y, 70, 13), tabP: r(v.w / 2 + 2, y, 70, 13), top: y + 20 };
  }

  doneLayout(v: View) {
    const y = v.h - 22;
    return { fresh: r(v.w / 2 - 84, y, 80, 16), menu: r(v.w / 2 + 4, y, 80, 16) };
  }

  // ---------- drawing ----------

  render(ctx: CanvasRenderingContext2D, v: View): void {
    screenBg(ctx, v.w, v.h);
    switch (this.screen) {
      case 'start': this.renderStart(ctx, v); break;
      case 'create': this.renderCreate(ctx, v); break;
      case 'hub': this.renderHub(ctx, v); break;
      case 'gameday': this.renderGameday(ctx, v); break;
      case 'result': this.renderResult(ctx, v); break;
      case 'schedule': this.renderSchedule(ctx, v); break;
      case 'standings': this.renderStandings(ctx, v); break;
      case 'stats': this.renderStats(ctx, v); break;
      case 'summary': this.renderSummary(ctx, v); break;
      case 'recruiting': this.renderRecruiting(ctx, v); break;
      case 'signing': this.renderSigning(ctx, v); break;
      case 'done': this.renderDone(ctx, v); break;
    }
  }

  private title(ctx: CanvasRenderingContext2D, v: View, text: string, color: string = C.yellow): number {
    drawText(ctx, text, v.w / 2, v.landscape ? 4 : 8, { scale: 2, color, shadow: C.navy, align: 'center' });
    return v.landscape ? 20 : 26;
  }

  private renderStart(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career;
    let y = this.title(ctx, v, 'CAREER');
    drawText(ctx, 'HIGH SCHOOL - COLLEGE - NFL', v.w / 2, y, { align: 'center', color: C.grey });
    y += v.landscape ? 14 : 30;
    if (c) {
      const p = c.player, sc = c.school;
      drawText(ctx, `${p.first} ${p.last}`, v.w / 2, y, { scale: 2, align: 'center' });
      y += 14;
      drawText(ctx, `${CLASS_NAMES[c.s.year]} QB - ${sc.name} ${sc.mascot}`, v.w / 2, y, { align: 'center', color: C.grey });
      y += 10;
      drawText(ctx, c.s.phase === 'done' ? 'HIGH SCHOOL CAREER COMPLETE' : `${c.weekName} - ${c.record().text}`, v.w / 2, y, { align: 'center', color: C.grey });
    }
    const L = this.startLayout(v);
    if (c) button(ctx, L.cont, 'CONTINUE', C.green);
    button(ctx, L.fresh, this.confirmNew ? 'TAP AGAIN: ERASES SAVE' : 'NEW CAREER', this.confirmNew ? C.orange : C.white);
    button(ctx, L.back, 'BACK', C.grey);
  }

  private renderCreate(ctx: CanvasRenderingContext2D, v: View): void {
    this.title(ctx, v, 'NEW CAREER');
    const L = this.createLayout(v);
    const st = STATES[this.stateIdx], a = ARCHETYPES.find((x) => x.id === this.arch)!;
    drawText(ctx, 'YOUR QUARTERBACK', L.nameX, L.nameY - 10, { align: 'center', color: C.grey });
    const nm = `${this.first} ${this.last}`;
    drawText(ctx, nm, L.nameX, L.nameY, { scale: nm.length > 14 ? 1 : 2, align: 'center', color: C.white });
    button(ctx, L.reroll, 'NEW NAME', C.white);
    button(ctx, L.edit, 'TYPE NAME', C.white);
    drawText(ctx, 'HOME STATE', L.lx + L.cw / 2, L.stateY, { align: 'center', color: C.grey });
    stepper(ctx, L.stateL, L.stateR, st.name);
    drawText(ctx, 'STYLE', L.archX, L.archY, { align: 'center', color: C.grey });
    stepper(ctx, L.archL, L.archR, a.name, C.yellow);
    let y = L.archL.y + 22;
    drawText(ctx, a.note, L.archX, y, { align: 'center', color: C.grey });
    y += 10;
    const b = a.base;
    drawText(ctx, `ACC ${b.acc}  ARM ${b.arm}  DEC ${b.dec}`, L.archX, y, { align: 'center' });
    y += 14;
    for (const t of wrap('START AS A SOPHOMORE BACKUP. EARN THE JOB, WIN STATE, GET RECRUITED.', v.landscape ? 34 : 40)) {
      drawText(ctx, t, L.archX, y, { align: 'center', color: C.grey }); y += 8;
    }
    const q = QUARTERS.find((x) => x.id === this.game.settings.quarter)?.name ?? '';
    drawText(ctx, `${q} QUARTERS (SET ON THE TITLE SCREEN)`, L.archX, y + 4, { align: 'center', color: C.darkGrey });
    button(ctx, L.start, 'START CAREER', C.green);
    button(ctx, L.back, 'BACK', C.grey);
  }

  private renderHub(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s, p = c.player, sc = c.school, L = this.hubLayout(v);
    const { x, w } = L.left, P = L.panels;
    // header: school and year
    badge(ctx, x, P.head, sc.abbr, sc.colors);
    const bx = x + badgeWidth(sc.abbr) + 4;
    drawText(ctx, `${sc.name} ${sc.mascot}`, bx, P.head + 2, { color: C.white });
    const st = STATES.find((q) => q.id === s.state)!;
    drawText(ctx, `${st.name} - ${CLASS_NAMES[s.year]} - YEAR ${s.year + 1}/${HS_YEARS}`, x, P.head + 13, { color: C.grey });
    drawText(ctx, c.record().text, x + w, P.head + 13, { align: 'right', color: C.yellow });

    // next game
    const g = c.nextGame;
    box(ctx, r(x, P.next, w, 34), C.navy, '#3b4a6b');
    if (g) {
      const o = c.opponentOf(g), home = g.home === s.schoolId;
      drawText(ctx, c.weekName, x + 4, P.next + 4, { color: C.yellow });
      drawText(ctx, `${home ? 'VS' : 'AT'} ${o.name} ${o.mascot}`, x + 4, P.next + 14);
      drawText(ctx, `${c.record(o.id).text} - ${REGION_NAMES[o.region]}${g.round ? '' : o.region === sc.region && g.week > 3 ? ' REGION GAME' : ''}`, x + 4, P.next + 24, { color: C.grey });
      badge(ctx, x + w - badgeWidth(o.abbr) - 4, P.next + 4, o.abbr, o.colors);
    } else drawText(ctx, 'SEASON OVER', x + 4, P.next + 4, { color: C.grey });

    // depth chart
    box(ctx, r(x, P.depth, w, P.you - P.depth - 4), C.navy, '#3b4a6b');
    if (s.role === 'starter') {
      drawText(ctx, 'STARTING QB', x + 4, P.depth + 4, { color: C.green });
      drawText(ctx, s.year >= HS_YEARS - 1 ? 'SENIOR YEAR: THE TEAM IS YOURS' : 'YOU WON THE JOB', x + 4, P.depth + 14, { color: C.grey });
    } else {
      drawText(ctx, `BACKUP QB - BEHIND ${s.starter?.name} (${s.starter?.ovr})`, x + 4, P.depth + 4);
      drawText(ctx, 'QB BATTLE', x + 4, P.depth + 15, { color: C.grey });
      meter(ctx, r(x + 42, P.depth + 14, w - 66, 7), s.battle, s.battle >= 75 ? C.green : C.yellow);
      drawText(ctx, String(s.battle), x + w - 4, P.depth + 15, { align: 'right', color: C.yellow });
      if (!v.landscape) drawText(ctx, s.year === 0 ? 'HE IS A SENIOR: EARN TRUST FOR NEXT YEAR' : 'FILL IT TO WIN THE JOB', x + 4, P.depth + 26, { color: C.darkGrey });
    }

    // you
    const yh = 46;
    box(ctx, r(x, P.you, w, yh), C.navy, '#3b4a6b');
    drawText(ctx, `${p.first} ${p.last}`, x + 4, P.you + 4);
    drawText(ctx, ARCHETYPES.find((a) => a.id === p.archetype)!.name, x + 4, P.you + 13, { color: C.grey });
    drawText(ctx, String(qbOvr(p)), x + w - 6, P.you + 4, { scale: 2, align: 'right', color: C.yellow });
    drawText(ctx, 'OVR', x + w - 34, P.you + 7, { align: 'right', color: C.grey });
    drawText(ctx, `ACC ${p.r.acc}  ARM ${p.r.arm}  DEC ${p.r.dec}  SPD ${p.r.spd}`, x + 4, P.you + 24);
    drawText(ctx, 'RECRUIT', x + 4, P.you + yh - 10, { color: C.grey });
    stars(ctx, x + 36, P.you + yh - 10, s.recruit.stars);
    meter(ctx, r(x + 76, P.you + yh - 10, 40, 5), toNextStar(s.recruit.score), C.yellow);
    if (s.recruit.stars < 5) drawText(ctx, `TO ${s.recruit.stars + 1}`, x + 120, P.you + yh - 10, { color: C.darkGrey });

    // practice + buttons
    const fr = L.focusL;
    drawText(ctx, 'PRACTICE FOCUS', (fr.x + L.focusR.x + L.focusR.w) / 2, L.focusY, { align: 'center', color: C.grey });
    stepper(ctx, L.focusL, L.focusR, FOCUSES.find((f) => f.id === s.focus)!.name, C.yellow);
    const backup = s.role === 'backup';
    button(ctx, L.gameDay, g ? (backup ? 'GAME DAY (ON THE BENCH)' : 'GAME DAY') : 'NO GAME', g ? C.green : C.darkGrey);
    button(ctx, L.schedule, 'SCHEDULE');
    button(ctx, L.standings, c.isPlayoffs ? 'PLAYOFFS' : 'STANDINGS');
    button(ctx, L.stats, 'STATS');
    button(ctx, L.team, 'TEAM', C.blue);
    const rs = s.recruit, nOff = rs.offers.length;
    button(ctx, L.recruiting, rs.committed ? `RECRUITING - COMMITTED: ${college(rs.committed)!.abbr}` : nOff ? `RECRUITING - ${nOff} OFFER${nOff > 1 ? 'S' : ''}` : 'RECRUITING', C.yellow);
    button(ctx, L.defense, s.defense === 'play' ? 'DEF: PLAY MIKE' : 'DEF: SIMULATED', C.grey);
    button(ctx, L.calls, s.calls === 'you' ? 'PLAYS: YOU CALL' : 'PLAYS: COACH', s.calls === 'you' ? C.yellow : C.grey);
    button(ctx, L.menu, 'MENU', C.grey);
  }

  private renderGameday(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, plan = this.plan!, m = plan.match, sc = c.school;
    let y = this.title(ctx, v, plan.label, plan.kind === 'full' ? C.green : C.yellow);
    for (const t of wrap(plan.detail, v.landscape ? 60 : 40)) { drawText(ctx, t, v.w / 2, y, { align: 'center', color: C.grey }); y += 9; }
    y += v.landscape ? 6 : 20;
    const mid = v.w / 2;
    badge(ctx, mid - 60, y, sc.abbr, sc.colors, 2);
    badge(ctx, mid + 60 - badgeWidth(plan.opp.abbr, 2), y, plan.opp.abbr, plan.opp.colors, 2);
    drawText(ctx, `${m.score.you} - ${m.score.cpu}`, mid, y + 4, { scale: 2, align: 'center' });
    y += 26;
    const started = m.quarter > 1 || m.clock < m.quarterSeconds;
    drawText(ctx, started ? `Q${m.quarter} ${m.clockText}` : `${c.weekName} - ${plan.rec.home === c.s.schoolId ? 'HOME' : 'AWAY'}`, mid, y, { align: 'center', color: C.yellow });
    y += 10;
    if (started) {
      drawText(ctx, `${m.offense === 'you' ? 'YOUR' : `${plan.opp.abbr}`} BALL - ${m.drive.downText} - ${m.offense === 'you' ? m.drive.spotText : m.drive.spotText.replace('OWN', 'THEIR').replace('OPP', 'YOUR')}`, mid, y, { align: 'center', color: C.grey });
      y += 10;
    }
    y += 6;
    const tips = [
      c.s.calls === 'you' ? 'YOU CALL THE PLAYS IN THE HUDDLE. TOUCH TO SNAP, AIM AND THROW.' : 'THE COACH CALLS THE PLAYS. TOUCH TO SNAP, AIM AND THROW.',
      c.s.defense === 'play' ? 'ON DEFENSE YOU PLAY THE MIKE: DRAG TO TAKE OVER.' : 'THE OTHER TEAM\'S DRIVES ARE SIMULATED.',
    ];
    if (plan.endAtHalf) tips.push('YOUR STINT ENDS AT HALFTIME.');
    for (const t of tips) for (const l of wrap(t, v.landscape ? 70 : 42)) { drawText(ctx, l, mid, y, { align: 'center', color: C.darkGrey }); y += 8; }
    button(ctx, this.gamedayLayout(v).go, plan.kind === 'full' ? 'KICKOFF' : 'TAKE THE FIELD', C.green);
  }

  private renderResult(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, l = this.lastLog!, o = c.team(l.opp), sc = c.school;
    const won = l.us > l.them;
    const y0 = this.title(ctx, v, won ? 'WIN' : 'LOSS', won ? C.green : C.red);
    const colW = v.landscape ? v.w / 2 - 8 : v.w - 8, x = 4, mid = x + colW / 2;
    let y = y0;
    drawText(ctx, `${sc.abbr} ${l.us} - ${o.abbr} ${l.them}${l.ot ? ' (OT)' : ''}`, mid, y, { align: 'center', scale: v.landscape ? 1 : 2 });
    y += v.landscape ? 10 : 16;
    drawText(ctx, `${l.round ? ROUND_NAMES[l.round] : `WEEK ${l.week}`} - ${l.home ? 'VS' : 'AT'} ${o.name}`, mid, y, { align: 'center', color: C.grey });
    y += 14;
    drawText(ctx, l.label, mid, y, { align: 'center', color: C.yellow });
    y += 10;
    if (l.kind === 'none') { drawText(ctx, 'YOU DID NOT GET IN', mid, y, { align: 'center', color: C.grey }); y += 10; }
    else {
      drawText(ctx, line(l.line), mid, y, { align: 'center' });
      y += 10;
      if (l.grade !== null) { drawText(ctx, `GRADE ${l.grade}`, mid, y, { align: 'center', color: gradeColor(l.grade) }); y += 10; }
    }
    if (l.battle !== null && this.battleBefore !== null) {
      y += 2;
      const d = l.battle - this.battleBefore;
      drawText(ctx, `QB BATTLE ${this.battleBefore} -> ${l.battle} (${d >= 0 ? '+' : ''}${d})`, mid, y, { align: 'center', color: d >= 0 ? C.green : C.orange });
      y += 9;
      meter(ctx, r(mid - 50, y, 100, 6), l.battle, C.yellow);
      y += 10;
    }
    const gains = Object.entries(l.gains).filter(([, n]) => n).map(([k, n]) => `+${n} ${k.toUpperCase()}`);
    if (gains.length) { drawText(ctx, gains.join('  '), mid, y + 2, { align: 'center', color: C.green }); y += 12; }
    const news = l.news.length > 4 ? [...l.news.slice(0, 3), `+${l.news.length - 3} MORE: SEE RECRUITING`] : l.news;
    for (const n of news) { drawText(ctx, n, mid, y + 2, { align: 'center', color: n.startsWith('OFFER') ? C.green : C.yellow }); y += 10; }

    // around the state
    let ox = x, oy = y + 8;
    if (v.landscape) { ox = v.w / 2 + 4; oy = y0; }
    drawText(ctx, 'AROUND THE STATE', ox + colW / 2, oy, { align: 'center', color: C.grey });
    oy += 10;
    const others = c.s.games.filter((g) => g.week === l.week && played(g) && g.home !== c.s.schoolId && g.away !== c.s.schoolId);
    const maxRows = Math.floor((v.h - 26 - oy) / 8);
    for (const g of others.slice(0, maxRows)) {
      const h = c.team(g.home), a = c.team(g.away), hw = g.hs! > g.as!;
      drawText(ctx, `${a.abbr} ${g.as}`, ox + colW / 2 - 6, oy, { align: 'right', color: hw ? C.grey : C.white });
      drawText(ctx, `AT ${h.abbr} ${g.hs}${g.ot ? ' OT' : ''}`, ox + colW / 2 + 2, oy, { color: hw ? C.white : C.grey });
      oy += 8;
    }
    button(ctx, this.bottomButton(v), 'CONTINUE', C.green);
  }

  private renderSchedule(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s;
    let y = this.title(ctx, v, 'SCHEDULE');
    const mine = s.games.filter((g) => g.home === s.schoolId || g.away === s.schoolId);
    const w = Math.min(v.w - 8, 220), x = (v.w - w) / 2;
    const rowH = v.landscape ? 10 : 12;
    for (const g of mine) {
      const o = c.opponentOf(g), home = g.home === s.schoolId, cur = g.week === s.week && !played(g);
      if (cur) { ctx.fillStyle = C.navy; ctx.fillRect(x - 2, y - 2, w + 4, rowH - 1); }
      drawText(ctx, g.round ?? `W${g.week}`, x, y, { color: g.round ? C.yellow : C.grey });
      drawText(ctx, home ? 'VS' : 'AT', x + 18, y, { color: C.grey });
      drawText(ctx, `${o.abbr} ${o.name}`, x + 30, y, { color: o.region === c.school.region && !g.round && g.week > 3 ? C.white : C.grey });
      if (played(g)) {
        const us = home ? g.hs! : g.as!, them = home ? g.as! : g.hs!;
        drawText(ctx, `${us > them ? 'W' : 'L'} ${us}-${them}${g.ot ? ' OT' : ''}`, x + w, y, { align: 'right', color: us > them ? C.green : C.red });
      } else drawText(ctx, c.record(o.id).text, x + w, y, { align: 'right', color: C.darkGrey });
      y += rowH;
    }
    y += 4;
    drawText(ctx, 'WHITE = REGION GAME', v.w / 2, y, { align: 'center', color: C.darkGrey });
    button(ctx, this.bottomButton(v), 'BACK');
  }

  private renderStandings(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s, L = this.standingsLayout(v);
    if (!v.landscape) this.title(ctx, v, 'STANDINGS');
    const hasPO = s.games.some((g) => g.round);
    for (const [t, rect, label] of [['regions', L.tabR, 'REGIONS'], ['playoffs', L.tabP, 'PLAYOFFS']] as const) {
      const on = this.standingsTab === t;
      box(ctx, rect, on ? C.yellow : C.ink, on ? C.yellow : hasPO || t === 'regions' ? C.grey : C.darkGrey);
      drawText(ctx, label, rect.x + rect.w / 2, rect.y + 4, { align: 'center', color: on ? C.ink : hasPO || t === 'regions' ? C.grey : C.darkGrey });
    }
    if (this.standingsTab === 'regions') {
      const regular = s.games.filter((g) => !g.round);
      const colW = v.landscape ? (v.w - 28) / 2 : Math.min(v.w - 8, 176);
      [0, 1].forEach((reg) => {
        const x = v.landscape ? 8 + reg * (colW + 12) : (v.w - colW) / 2;
        let y = v.landscape ? L.top : L.top + reg * 88;
        drawText(ctx, `${REGION_NAMES[reg]} REGION`, x, y, { color: C.yellow });
        drawText(ctx, 'ALL  REG', x + colW, y, { align: 'right', color: C.darkGrey });
        y += 9;
        regionOrder(s.teams, regular, reg).forEach((st, i) => {
          const t = c.team(st.id), mine = st.id === s.schoolId;
          if (mine) { ctx.fillStyle = C.navy; ctx.fillRect(x - 2, y - 2, colW + 4, 9); }
          const col = i < 4 ? C.white : C.grey;
          drawText(ctx, `${i + 1} ${t.abbr} ${t.name}`, x, y, { color: mine ? C.yellow : col });
          drawText(ctx, `${st.w}-${st.l}${st.t ? `-${st.t}` : ''}`, x + colW - 28, y, { align: 'right', color: col });
          drawText(ctx, `${st.rw}-${st.rl}`, x + colW, y, { align: 'right', color: C.grey });
          y += 9;
        });
      });
      const y = v.landscape ? v.h - 32 : L.top + 178;
      drawText(ctx, 'TOP 4 IN EACH REGION MAKE THE PLAYOFFS', v.w / 2, y, { align: 'center', color: C.darkGrey });
    } else {
      let y = L.top;
      const w = v.landscape ? Math.min(v.w - 16, 260) : 120, x = (v.w - w) / 2;
      for (const round of PLAYOFF_ROUNDS) {
        const gs = s.games.filter((g) => g.round === round);
        if (!gs.length) continue;
        drawText(ctx, ROUND_NAMES[round], x, y, { color: C.yellow });
        y += 9;
        for (const g of gs) { this.bracketRow(ctx, g, x, y, w); y += 9; }
        y += 4;
      }
      const champ = c.champion;
      if (champ) drawText(ctx, `STATE CHAMPION: ${champ.name} ${champ.mascot}`, v.w / 2, y + 2, { align: 'center', color: C.green });
    }
    button(ctx, this.bottomButton(v), 'BACK');
  }

  private bracketRow(ctx: CanvasRenderingContext2D, g: GameRec, x: number, y: number, w: number): void {
    const c = this.career!, h = c.team(g.home), a = c.team(g.away);
    const done = played(g), hw = done && g.hs! > g.as!;
    const col = (id: number, win: boolean) => (id === c.s.schoolId ? C.yellow : !done ? C.white : win ? C.white : C.darkGrey);
    const wide = w >= 190; // full names fit
    drawText(ctx, wide ? `${h.abbr} ${h.name}` : h.abbr, x, y, { color: col(h.id, hw) });
    drawText(ctx, done ? `${g.hs}-${g.as}${g.ot ? ' OT' : ''}` : 'VS', x + w / 2, y, { align: 'center', color: C.grey });
    drawText(ctx, wide ? `${a.name} ${a.abbr}` : a.abbr, x + w, y, { align: 'right', color: col(a.id, done && !hw) });
  }

  private renderStats(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s, p = c.player;
    let y = this.title(ctx, v, 'STATS');
    const w = Math.min(v.w - 8, 230), x = (v.w - w) / 2;
    const tot = s.log.reduce((t, l) => { for (const k of Object.keys(t) as (keyof TeamStats)[]) t[k] += l.line[k]; return t; },
      { plays: 0, yards: 0, tds: 0, cmp: 0, att: 0, int: 0, sacks: 0 } as TeamStats);
    drawText(ctx, `${CLASS_NAMES[s.year]} SEASON`, x, y, { color: C.yellow });
    y += 9;
    const pct = tot.att ? Math.round((100 * tot.cmp) / tot.att) : 0;
    drawText(ctx, `${line(tot)}  ${pct}%  RTG ${passerRating(tot).toFixed(1)}`, x, y);
    y += 12;
    drawText(ctx, 'GAME LOG', x, y, { color: C.grey });
    y += 9;
    const rows = v.landscape ? 7 : 13;
    for (const l of s.log.slice(-rows)) {
      const o = c.team(l.opp);
      drawText(ctx, `${l.round ?? `W${l.week}`} ${l.home ? 'VS' : 'AT'} ${o.abbr}`, x, y, { color: C.grey });
      drawText(ctx, `${l.us > l.them ? 'W' : 'L'} ${l.us}-${l.them}`, x + 44, y, { color: l.us > l.them ? C.green : C.red });
      drawText(ctx, l.kind === 'none' ? 'DNP' : `${l.line.cmp}/${l.line.att} ${l.line.yards} ${l.line.tds}TD ${l.line.int}I`, x + 84, y);
      if (l.grade !== null) drawText(ctx, String(l.grade), x + w, y, { align: 'right', color: gradeColor(l.grade) });
      y += 8;
    }
    if (!s.log.length) { drawText(ctx, 'NO GAMES YET', x, y, { color: C.darkGrey }); y += 8; }
    y += 6;
    if (p.seasons.length) {
      drawText(ctx, 'CAREER', x, y, { color: C.grey });
      y += 9;
      for (const sl of p.seasons) {
        drawText(ctx, `${CLASS_SHORT[sl.year]} ${sl.record}`, x, y, { color: C.grey });
        drawText(ctx, `${sl.stats.cmp}/${sl.stats.att} ${sl.stats.yards} YDS ${sl.stats.tds} TD ${sl.stats.int} INT`, x + 36, y);
        stars(ctx, x + w - 34, y, sl.stars);
        y += 8;
      }
    }
    button(ctx, this.bottomButton(v), 'BACK');
  }

  private renderSummary(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, p = c.player, sl = p.seasons[p.seasons.length - 1];
    let y = this.title(ctx, v, `${CLASS_SHORT[sl.year]} SEASON`);
    const mid = v.w / 2;
    drawText(ctx, `${sl.school} - ${sl.record}`, mid, y, { align: 'center' }); y += 10;
    drawText(ctx, sl.finish, mid, y, { align: 'center', color: sl.finish === 'STATE CHAMPIONS' ? C.green : C.yellow }); y += 14;
    drawText(ctx, `${displayName(p)}: ${sl.role} - ${sl.gp} GAMES, ${sl.gs} STARTS`, mid, y, { align: 'center', color: C.grey }); y += 10;
    drawText(ctx, line(sl.stats), mid, y, { align: 'center' }); y += 10;
    drawText(ctx, `OVR ${sl.ovr}`, mid, y, { align: 'center', color: C.yellow }); y += 12;
    drawText(ctx, 'RECRUITING', mid - 22, y, { align: 'right', color: C.grey });
    stars(ctx, mid - 16, y, sl.stars); y += 12;
    const awards = p.awards.filter((a) => a.endsWith(`(${CLASS_SHORT[sl.year]})`));
    for (const a of awards) { drawText(ctx, a, mid, y, { align: 'center', color: C.green }); y += 9; }
    const champ = c.champion;
    if (champ) { y += 4; drawText(ctx, `STATE CHAMPION: ${champ.name}`, mid, y, { align: 'center', color: C.grey }); y += 10; }
    y += 4;
    const rs = c.s.recruit;
    drawText(ctx, rs.committed ? `COMMITTED TO ${college(rs.committed)!.name}` : `${rs.offers.length} COLLEGE OFFER${rs.offers.length === 1 ? '' : 'S'}`, mid, y, { align: 'center', color: C.yellow });
    y += 12;
    const next = sl.year >= HS_YEARS - 1 ? 'NEXT: SIGNING DAY' : `NEXT: ${CLASS_NAMES[sl.year + 1]} YEAR`;
    drawText(ctx, next, mid, y, { align: 'center', color: C.grey });
    button(ctx, this.bottomButton(v), sl.year >= HS_YEARS - 1 ? 'SIGNING DAY' : 'OFF-SEASON', C.green);
  }

  private renderDone(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, p = c.player;
    let y = this.title(ctx, v, 'GRADUATED');
    const mid = v.w / 2, w = Math.min(v.w - 8, 200), x = mid - w / 2;
    drawText(ctx, `${p.first} ${p.last} - ${c.school.name}`, mid, y, { align: 'center' }); y += 12;
    const tot = { plays: 0, yards: 0, tds: 0, cmp: 0, att: 0, int: 0, sacks: 0 } as TeamStats;
    for (const sl of p.seasons) {
      drawText(ctx, `${CLASS_SHORT[sl.year]} ${sl.record} ${sl.finish}`, x, y, { color: C.grey });
      stars(ctx, x + w - 34, y, sl.stars);
      y += 8;
      for (const k of Object.keys(tot) as (keyof TeamStats)[]) tot[k] += sl.stats[k];
    }
    y += 4;
    drawText(ctx, `CAREER: ${line(tot)}`, mid, y, { align: 'center' }); y += 12;
    for (const a of p.awards.filter((x) => !x.startsWith('SIGNED')).slice(v.landscape ? -3 : -6)) { drawText(ctx, a, mid, y, { align: 'center', color: C.green }); y += 8; }
    y += 6;
    const signed = c.s.recruit.signed ? college(c.s.recruit.signed) : null;
    if (signed) {
      drawText(ctx, 'SIGNED WITH', mid, y, { align: 'center', color: C.grey }); y += 10;
      badge(ctx, mid - badgeWidth(signed.abbr, 2) / 2, y, signed.abbr, signed.colors, 2); y += 22;
      drawText(ctx, `${signed.name} ${signed.mascot}`, mid, y, { align: 'center', color: C.yellow }); y += 9;
      drawText(ctx, `${signed.conference} - ${TIER_NAMES[signed.tier]}`, mid, y, { align: 'center', color: C.grey }); y += 12;
    }
    drawText(ctx, 'THE COLLEGE CAREER IS COMING NEXT', mid, y, { align: 'center', color: C.darkGrey });
    const L = this.doneLayout(v);
    button(ctx, L.fresh, this.confirmNew ? 'SURE?' : 'NEW CAREER', this.confirmNew ? C.orange : C.white);
    button(ctx, L.menu, 'MENU', C.grey);
  }

  // ---------- recruiting ----------

  /** The recruiting board's rows (tap targets). */
  recruitRows(v: View): { c: College; r: Rect }[] {
    const rs = this.career!.s.recruit;
    const x = 4, w = v.landscape ? Math.floor(v.w * 0.6) - 8 : v.w - 8;
    const top = v.landscape ? 44 : 70, rowH = v.landscape ? 11 : 13, n = v.landscape ? 10 : 12;
    return board(rs, n).map((c, i) => ({ c, r: r(x, top + i * rowH, w, rowH - 1) }));
  }

  /** A college row: [badge] NAME ... TIER [interest meter or a tag]. */
  private collegeRow(ctx: CanvasRenderingContext2D, c: College, rr: Rect, opts: { interest?: number; tag?: string; tagColor?: string; picked?: boolean }): void {
    if (opts.picked) box(ctx, rr, C.navy, C.yellow);
    const y = rr.y + Math.floor((rr.h - 5) / 2);
    badge(ctx, rr.x + 1, rr.y + Math.floor((rr.h - 9) / 2), c.abbr, c.colors);
    const nx = rr.x + 26, right = rr.x + rr.w - 2;
    const maxChars = Math.floor((rr.w - 26 - 58) / 4);
    drawText(ctx, c.name.length > maxChars ? c.name.slice(0, maxChars) : c.name, nx, y, { color: C.white });
    drawText(ctx, c.tier, right - 40, y, { align: 'right', color: c.tier === 'P4' ? C.yellow : c.tier === 'G5' ? C.white : C.grey });
    if (opts.tag) drawText(ctx, opts.tag, right, y, { align: 'right', color: opts.tagColor ?? C.green });
    else if (opts.interest !== undefined) meter(ctx, r(right - 34, y, 34, 5), opts.interest, C.blue);
  }

  private renderRecruiting(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, rs = c.s.recruit;
    const y0 = this.title(ctx, v, 'RECRUITING');
    const x = 4;
    let y = y0;
    stars(ctx, x, y, rs.stars);
    drawText(ctx, `${rs.stars}-STAR QB`, x + 38, y, { color: C.yellow });
    meter(ctx, r(x + 82, y, 50, 5), toNextStar(rs.score), C.yellow);
    if (rs.stars < 5) drawText(ctx, `TO ${rs.stars + 1} STARS`, x + 136, y, { color: C.darkGrey });
    y += 10;
    const status = rs.committed ? `COMMITTED: ${college(rs.committed)!.name}` : c.s.year === 0 ? 'OFFERS START IN YOUR JUNIOR YEAR'
      : `${rs.offers.length} OFFER${rs.offers.length === 1 ? '' : 'S'} - TAP AN OFFER TWICE TO COMMIT`;
    drawText(ctx, status, x, y, { color: rs.committed ? C.green : C.grey });
    y += 10;
    if (!v.landscape) drawText(ctx, 'STARS MOVE WEEKLY: PLAY WELL AND WIN', x, y, { color: C.darkGrey });
    const rows = this.recruitRows(v);
    if (!rows.length) drawText(ctx, 'NO COLLEGES WATCHING YET', x, rows.length ? 0 : (v.landscape ? 44 : 70), { color: C.darkGrey });
    for (const { c: col, r: rr } of rows) {
      const offered = rs.offers.includes(col.id), committed = rs.committed === col.id, picked = this.pick === col.id;
      const tag = picked ? (committed ? 'DECOMMIT?' : 'COMMIT?') : committed ? 'COMMITTED' : offered ? 'OFFER' : undefined;
      this.collegeRow(ctx, col, rr, { interest: rs.interest[col.id] ?? 0, tag, tagColor: picked ? C.orange : committed ? C.yellow : C.green, picked });
    }
    // news
    const fx = v.landscape ? Math.floor(v.w * 0.6) + 2 : x;
    let fy = v.landscape ? y0 + 22 : 70 + 12 * 13 + 6;
    drawText(ctx, 'LATEST', fx, fy, { color: C.grey });
    fy += 9;
    const maxN = v.landscape ? 12 : 6;
    for (const n of c.s.recruitFeed.slice(0, maxN)) {
      drawText(ctx, n.length > (v.landscape ? 34 : 44) ? n.slice(0, v.landscape ? 34 : 44) : n, fx, fy, { color: n.startsWith('OFFER') || n.startsWith('COMMIT') ? C.green : C.white });
      fy += 8;
    }
    if (!c.s.recruitFeed.length) drawText(ctx, 'NOTHING YET', fx, fy, { color: C.darkGrey });
    button(ctx, this.bottomButton(v), 'BACK');
  }

  /** Signing day rows: your offers, or walk-on spots if there are none. */
  signingRows(v: View): { c: College; r: Rect }[] {
    const c = this.career!, rs = c.s.recruit;
    const list = rs.offers.length ? offerList(rs) : walkOns(rs, c.s.state);
    if (rs.committed) list.sort((a, b) => Number(b.id === rs.committed) - Number(a.id === rs.committed));
    const w = Math.min(v.w - 8, 240), x = (v.w - w) / 2;
    const top = v.landscape ? 44 : 78, rowH = v.landscape ? 11 : 14, n = v.landscape ? 11 : 15;
    return list.slice(0, n).map((col, i) => ({ c: col, r: r(x, top + i * rowH, w, rowH - 1) }));
  }

  private renderSigning(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, rs = c.s.recruit;
    let y = this.title(ctx, v, 'SIGNING DAY', C.green);
    const mid = v.w / 2;
    stars(ctx, mid - 52, y, rs.stars);
    drawText(ctx, `${rs.stars}-STAR QB - ${rs.offers.length} OFFER${rs.offers.length === 1 ? '' : 'S'}`, mid - 14, y, { color: C.yellow });
    y += 11;
    drawText(ctx, rs.offers.length ? 'TAP A SCHOOL TWICE TO SIGN' : 'NO OFFERS. PREFERRED WALK-ON SPOTS:', mid, y, { align: 'center', color: C.grey });
    y += 9;
    if (rs.committed && !v.landscape) drawText(ctx, `YOU ARE COMMITTED TO ${college(rs.committed)!.name}`, mid, y, { align: 'center', color: C.darkGrey });
    for (const { c: col, r: rr } of this.signingRows(v)) {
      const picked = this.pick === col.id;
      this.collegeRow(ctx, col, rr, { tag: picked ? 'SIGN?' : col.id === rs.committed ? 'COMMITTED' : rs.offers.length ? 'OFFER' : 'WALK-ON', tagColor: picked ? C.orange : col.id === rs.committed ? C.yellow : rs.offers.length ? C.green : C.grey, picked });
    }
  }
}
