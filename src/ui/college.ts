// The college career screens (phase 1): the hub, game day, the result, your
// schedule, the rankings (top 25, your conference, the playoff), stats, the
// game plan, the season summary and the end of college. The games themselves
// run through Game.playCareerGame, exactly like high school.
import { C } from '../config';
import {
  CFP_ROUNDS, type CLog, type CPlan, type CGame, type CollegeCareer, LAST_WEEK, confOrder, gameTitle, played, playoffField, saveCollege, winnerOf,
} from '../career/college';
import { FOCUSES, abilityOf, hasAbility, letterGrade, passerRating, qbOvr, RATING_NAMES } from '../career/player';
import { type TeamStats, newStats } from '../drive';
import { drawText, textWidth } from '../font';
import type { Game } from '../game';
import type { IntroInfo } from '../intro';
import { DIFFICULTIES, type Difficulty, cycle } from '../settings';
import { type Kit, kitsFor, shade } from '../sprites';
import type { Vec } from '../util';
import type { View } from '../view';
import { BUST_H, BUST_W, qbBust } from './art';
import { type Rect, accentOn, badge, badgeWidth, box, button, hit, inkOn, meter, screenBg, stepper } from './kit';

type Screen = 'hub' | 'gameday' | 'result' | 'schedule' | 'rankings' | 'stats' | 'plan' | 'summary' | 'done';
const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const gradeColor = (g: number) => (g >= 74 ? C.green : g >= 59 ? C.yellow : g >= 45 ? C.orange : C.red);
const passLine = (s: TeamStats) => `${s.cmp}/${s.att} ${s.yards} YDS ${s.tds} TD ${s.int} INT`;
const rushLine = (s: TeamStats) => ((s.rush ?? 0) ? `RUSH ${s.rush}-${s.ryds ?? 0}${(s.rtd ?? 0) ? ` ${s.rtd} TD` : ''}` : '');

export class CollegeScreens {
  career: CollegeCareer | null = null;
  screen: Screen = 'hub';
  tab: 'top25' | 'conf' | 'cfp' = 'top25';
  plan: CPlan | null = null;
  lastLog: CLog | null = null;
  battleBefore: number | null = null;

  constructor(private game: Game, private backToStart: () => void) {}

  /** Opens a college career (the hub, or the screen for its phase). */
  open(c: CollegeCareer): void {
    this.career = c;
    this.toHub();
  }

  toHub(): void {
    const c = this.career!;
    this.screen = c.s.phase === 'summary' ? 'summary' : c.s.phase === 'done' ? 'done' : 'hub';
    this.game.showCareer(this);
  }

  // ---------- game day ----------

  gameDay(): void {
    const c = this.career!;
    this.battleBefore = c.s.role === 'backup' ? c.s.battle : null;
    const plan = c.prepareGame();
    if (!plan) { this.toHub(); return; }
    this.plan = plan;
    if (plan.kind === 'none') { this.finish(); return; }
    this.screen = 'gameday';
  }

  play(): void {
    const c = this.career!, plan = this.plan!, sc = c.school, o = plan.opp, s = c.s;
    const home = plan.rec.home === s.schoolId && !plan.rec.neutral;
    const k = home || plan.rec.neutral ? kitsFor(sc.colors, o.colors) : kitsFor(o.colors, sc.colors);
    const kits: { you: Kit; cpu: Kit } = home || plan.rec.neutral ? { you: k.home, cpu: k.away } : { you: k.away, cpu: k.home };
    const shift = c.oppShift;
    this.game.playCareerGame({
      difficulty: s.difficulty,
      schools: { you: { name: sc.name, mascot: sc.mascot }, cpu: { name: o.name, mascot: o.mascot } },
      card: { story: plan.title, weather: 'SATURDAY' },
      match: plan.match, you: c.rosterWithYou(), opp: plan.oppRoster,
      units: { you: plan.units.you, cpu: { off: plan.units.cpu.off + shift, def: plan.units.cpu.def + shift } },
      kits,
      crowd: home || plan.rec.neutral ? { home: sc.colors, away: o.colors, homeName: sc.mascot, big: true, abbr: sc.abbr } : { home: o.colors, away: sc.colors, homeName: o.mascot, big: true, abbr: o.abbr },
      intro: this.introFor(plan, home),
      simDefense: s.defense === 'sim', coachCalls: s.calls !== 'you', endAtHalf: plan.endAtHalf, label: plan.label,
      onDone: (_m, stint) => this.finish(stint),
    });
  }

  private introFor(plan: CPlan, home: boolean): IntroInfo | undefined {
    const c = this.career!, m = plan.match, sc = c.school, o = plan.opp;
    if (m.quarter > 1 || m.clock < m.quarterSeconds || m.score.you + m.score.cpu > 0) return undefined;
    const big = !!(plan.rec.round || plan.rec.ccg || plan.rec.bowl || (c.rank(o.id) && c.rank(sc.id)));
    const tag = (id: string) => `${c.rank(id) ? `NO.${c.rank(id)} ` : ''}${c.record(id).text}`;
    return {
      home: home || plan.rec.neutral ? 'you' : 'cpu', top: plan.title, big, college: true,
      names: { you: sc.name, cpu: o.name }, mascots: { you: sc.mascot, cpu: o.mascot }, abbrs: { you: sc.abbr, cpu: o.abbr },
      colors: { you: sc.colors, cpu: o.colors }, tags: { you: tag(sc.id), cpu: tag(o.id) },
    };
  }

  finish(stint?: TeamStats): void {
    const c = this.career!;
    this.lastLog = c.finishGame(this.plan!, stint);
    this.plan = null;
    this.screen = 'result';
    this.game.showCareer(this);
  }

  // ---------- layouts ----------

  hubLayout(v: View) {
    const land = v.landscape;
    if (land) {
      const lw = v.w / 2 - 9, rx = v.w / 2 + 3, rw = v.w / 2 - 9, half = (rw - 4) / 2;
      return {
        banner: 26, card: r(6, 30, lw, 46), you: r(6, 80, lw, 40), news: r(6, 124, lw, 24),
        schedule: r(rx, 30, half, 16), rankings: r(rx + half + 4, 30, half, 16), stats: r(rx, 50, half, 16), plan: r(rx + half + 4, 50, half, 16),
        team: r(rx, 70, half, 16), menu: r(rx + half + 4, 70, half, 16),
        focusY: 93, focusL: r(rx + 44, 90, 16, 12), focusR: r(rx + rw - 16, 90, 16, 12), focusX: rx,
        gameDay: r(rx, 108, rw, 36),
      };
    }
    const w = v.w - 12, x = 6, half = (w - 4) / 2;
    return {
      banner: 36, card: r(x, 42, w, 50), you: r(x, 96, w, 42), news: r(x, 142, w, 26),
      schedule: r(x, 172, half, 16), rankings: r(x + half + 4, 172, half, 16), stats: r(x, 192, half, 16), plan: r(x + half + 4, 192, half, 16),
      team: r(x, 212, half, 16), menu: r(x + half + 4, 212, half, 16),
      focusY: 237, focusL: r(x + 44, 234, 16, 12), focusR: r(x + w - 16, 234, 16, 12), focusX: x,
      gameDay: r(x, 252, w, 40),
    };
  }
  bottomButton(v: View): Rect { return r(v.w / 2 - 40, v.h - 20, 80, 16); }
  rankTabs(v: View) {
    const y = v.landscape ? 4 : 24, w = 56, x = v.w / 2 - (3 * w + 4) / 2;
    return { top25: r(x, y, w, 13), conf: r(x + w + 2, y, w, 13), cfp: r(x + 2 * (w + 2), y, w, 13), top: y + 20 };
  }
  planLayout(v: View) {
    const w = Math.min(v.w - 16, 220), x = (v.w - w) / 2, half = (w - 4) / 2, y0 = v.landscape ? 26 : 50;
    return {
      defPlay: r(x, y0 + 10, half, 16), defSim: r(x + half + 4, y0 + 10, half, 16),
      callsCoach: r(x, y0 + 46, half, 16), callsYou: r(x + half + 4, y0 + 46, half, 16),
      diffL: r(x, y0 + 82, 22, 16), diffR: r(x + w - 22, y0 + 82, 22, 16), x, w, y0,
    };
  }
  gamedayLayout(v: View) { return { go: r(v.w / 2 - 60, v.h - (v.landscape ? 44 : 64), 120, 22) }; }
  doneLayout(v: View) { return { menu: this.bottomButton(v) }; }

  // ---------- input ----------

  tap(p: Vec, v: View): void {
    const c = this.career;
    if (!c) return;
    const s = c.s;
    switch (this.screen) {
      case 'hub': {
        const L = this.hubLayout(v);
        if (hit(L.focusL, p)) { s.focus = cycle(FOCUSES, s.focus, -1) as typeof s.focus; saveCollege(s); }
        if (hit(L.focusR, p)) { s.focus = cycle(FOCUSES, s.focus, 1) as typeof s.focus; saveCollege(s); }
        if (hit(L.gameDay, p)) this.gameDay();
        if (hit(L.schedule, p)) this.screen = 'schedule';
        if (hit(L.rankings, p)) { this.screen = 'rankings'; this.tab = s.field ? 'cfp' : 'top25'; }
        if (hit(L.stats, p)) this.screen = 'stats';
        if (hit(L.plan, p)) this.screen = 'plan';
        if (hit(L.team, p)) this.game.showRosterOf(c.rosterWithYou());
        if (hit(L.menu, p)) this.backToStart();
        return;
      }
      case 'gameday':
        if (hit(this.gamedayLayout(v).go, p)) this.play();
        return;
      case 'result':
        if (hit(this.bottomButton(v), p)) this.toHub();
        return;
      case 'rankings': {
        const T = this.rankTabs(v);
        if (hit(T.top25, p)) this.tab = 'top25';
        if (hit(T.conf, p)) this.tab = 'conf';
        if (hit(T.cfp, p)) this.tab = 'cfp';
        if (hit(this.bottomButton(v), p)) this.screen = 'hub';
        return;
      }
      case 'plan': {
        const L = this.planLayout(v);
        if (hit(L.defPlay, p)) s.defense = 'play';
        if (hit(L.defSim, p)) s.defense = 'sim';
        if (hit(L.callsCoach, p)) s.calls = 'coach';
        if (hit(L.callsYou, p)) s.calls = 'you';
        if (hit(L.diffL, p)) s.difficulty = cycle(DIFFICULTIES, s.difficulty, -1) as Difficulty;
        if (hit(L.diffR, p)) s.difficulty = cycle(DIFFICULTIES, s.difficulty, 1) as Difficulty;
        saveCollege(s);
        if (hit(this.bottomButton(v), p)) this.screen = 'hub';
        return;
      }
      case 'summary':
        if (hit(this.bottomButton(v), p)) { c.nextSeason(); this.toHub(); }
        return;
      case 'done':
        if (hit(this.doneLayout(v).menu, p)) this.backToStart();
        return;
      default:
        if (hit(this.bottomButton(v), p)) this.screen = 'hub';
    }
  }

  // ---------- drawing ----------

  render(ctx: CanvasRenderingContext2D, v: View): void {
    screenBg(ctx, v.w, v.h);
    if (!this.career) return;
    switch (this.screen) {
      case 'hub': this.renderHub(ctx, v); break;
      case 'gameday': this.renderGameDay(ctx, v); break;
      case 'result': this.renderResult(ctx, v); break;
      case 'schedule': this.renderSchedule(ctx, v); break;
      case 'rankings': this.renderRankings(ctx, v); break;
      case 'stats': this.renderStats(ctx, v); break;
      case 'plan': this.renderPlan(ctx, v); break;
      case 'summary': this.renderSummary(ctx, v); break;
      case 'done': this.renderDone(ctx, v); break;
    }
  }

  private title(ctx: CanvasRenderingContext2D, v: View, text: string, color: string = C.yellow): number {
    drawText(ctx, text, v.w / 2, v.landscape ? 4 : 8, { scale: textWidth(text, 2) <= v.w - 8 ? 2 : 1, color, shadow: C.navy, align: 'center' });
    return v.landscape ? 20 : 26;
  }

  private renderHub(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s, p = c.player, sc = c.school, L = this.hubLayout(v), land = v.landscape;
    // the banner: school colours, your QB, rank and record
    const fg = inkOn(sc.colors[0]), acc = accentOn(sc.colors);
    ctx.fillStyle = sc.colors[0]; ctx.fillRect(0, 0, v.w, L.banner);
    ctx.fillStyle = sc.colors[1]; ctx.fillRect(0, L.banner, v.w, 2);
    const bs = land ? 1 : 2, bw = BUST_W * bs + 4, bh = BUST_H * bs + 4;
    box(ctx, r(4, (L.banner - bh) / 2, bw, bh), shade(sc.colors[0], -0.45), sc.colors[1]);
    qbBust(ctx, 6, (L.banner - bh) / 2 + 2, sc.colors, bs);
    const tx = 4 + bw + 5, rank = c.rank(sc.id), rec = c.record();
    const nameScale = textWidth(sc.name, 2) <= v.w - tx - 44 ? 2 : 1;
    drawText(ctx, sc.name, tx, land ? 4 : 6, { scale: nameScale, color: fg, shadow: shade(sc.colors[0], -0.5) });
    drawText(ctx, `${sc.mascot} - ${sc.conference}`, tx, land ? 16 : 20, { color: acc });
    if (!land) drawText(ctx, `${c.classLabel} - YEAR ${s.year + 1}${s.walkOn ? ' - WALK-ON' : ''}`, tx, 28, { color: fg });
    if (rank) drawText(ctx, `NO.${rank}`, v.w - 5, land ? 3 : 6, { scale: 2, align: 'right', color: acc, shadow: shade(sc.colors[0], -0.5) });
    drawText(ctx, `${rec.text} (${rec.cw}-${rec.cl})`, v.w - 5, land ? 17 : 20, { align: 'right', color: fg });

    // the next game
    const g = c.nextGame, cr = L.card;
    box(ctx, cr, C.navy, g?.round || g?.ccg || g?.bowl ? C.yellow : '#3b4a6b');
    if (g) {
      const o = c.team(c.opponentOf(g)), home = g.home === s.schoolId;
      drawText(ctx, gameTitle(g), cr.x + cr.w / 2, cr.y + 4, { align: 'center', color: C.yellow });
      const where = g.neutral ? 'VS' : home ? 'VS' : 'AT';
      const mid = cr.x + cr.w / 2;
      badge(ctx, mid - badgeWidth(sc.abbr, 2) - 14, cr.y + 14, sc.abbr, sc.colors, 2);
      drawText(ctx, where, mid, cr.y + 19, { align: 'center', color: C.grey });
      badge(ctx, mid + 14, cr.y + 14, o.abbr, o.colors, 2);
      drawText(ctx, `${c.label(o.id)} ${c.record(o.id).text}`, mid, cr.y + cr.h - 10, { align: 'center', color: C.white });
    } else drawText(ctx, c.s.phase === 'season' ? 'NO GAME' : c.finish(), cr.x + cr.w / 2, cr.y + 18, { align: 'center', color: C.grey });

    // you
    const Y = L.you;
    box(ctx, Y, C.navy, '#3b4a6b');
    drawText(ctx, `${p.first} ${p.last}`, Y.x + 4, Y.y + 4);
    drawText(ctx, String(qbOvr(p)), Y.x + Y.w - 5, Y.y + 4, { scale: 2, align: 'right', color: C.yellow });
    drawText(ctx, 'OVR', Y.x + Y.w - 30, Y.y + 7, { align: 'right', color: C.grey });
    const backup = s.role === 'backup';
    if (backup && s.starter) {
      drawText(ctx, `BACKUP - BEHIND ${s.starter.name} (${s.starter.ovr})`, Y.x + 4, Y.y + 13, { color: C.grey });
      drawText(ctx, 'QB BATTLE', Y.x + 4, Y.y + 25, { color: C.grey });
      meter(ctx, r(Y.x + 42, Y.y + 25, Y.w - 66, 5), s.battle, s.battle >= 75 ? C.green : C.yellow);
      drawText(ctx, String(s.battle), Y.x + Y.w - 4, Y.y + 25, { align: 'right', color: C.yellow });
    } else {
      const ab = abilityOf(p), got = hasAbility(p);
      drawText(ctx, 'STARTER', Y.x + 4, Y.y + 13, { color: C.green });
      drawText(ctx, got ? ab.name : `${ab.name} AT ${RATING_NAMES[ab.key]} ${ab.at}`, Y.x + 40, Y.y + 13, { color: got ? C.green : C.darkGrey });
      drawText(ctx, `ACC ${p.r.acc} ARM ${p.r.arm} DEC ${p.r.dec} SPD ${p.r.spd} ELU ${p.r.elu}`, Y.x + 4, Y.y + 25, { color: C.darkGrey });
    }
    if (land && backup) drawText(ctx, `${c.classLabel}${s.walkOn ? ' - WALK-ON' : ''}`, Y.x + 4, Y.y + 33, { color: C.darkGrey });

    // the news
    s.headlines.slice(0, 3).forEach((h, i) => drawText(ctx, h.slice(0, Math.floor(L.news.w / 4)), L.news.x + 2, L.news.y + 2 + i * 8, { color: i ? C.grey : C.white }));

    const tile = (rr: Rect, label: string, color: string = C.white) => button(ctx, rr, label, color);
    tile(L.schedule, 'SCHEDULE'); tile(L.rankings, s.field ? 'PLAYOFF' : 'RANKINGS'); tile(L.stats, 'STATS'); tile(L.plan, 'GAME PLAN', C.grey);
    tile(L.team, 'TEAM', C.blue); tile(L.menu, 'MENU', C.darkGrey);
    drawText(ctx, 'PRACTICE', L.focusX, L.focusY, { color: C.grey });
    stepper(ctx, L.focusL, L.focusR, FOCUSES.find((f) => f.id === s.focus)!.name, C.yellow);
    const gd = L.gameDay;
    box(ctx, gd, g ? '#0b3d1d' : C.ink, g ? C.green : C.darkGrey);
    drawText(ctx, 'GAME DAY', gd.x + gd.w / 2, gd.y + 6, { scale: 2, align: 'center', color: g ? C.green : C.darkGrey });
    if (g) drawText(ctx, backup ? `WEEK ${g.week} - ON THE BENCH` : `WEEK ${g.week} - ${g.neutral ? 'NEUTRAL SITE' : g.home === s.schoolId ? 'HOME' : 'AWAY'}`, gd.x + gd.w / 2, gd.y + gd.h - 10, { align: 'center', color: C.grey });
  }

  private renderGameDay(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, plan = this.plan!, sc = c.school, o = plan.opp, mid = v.w / 2;
    let y = this.title(ctx, v, 'GAME DAY');
    drawText(ctx, plan.title, mid, y, { align: 'center', color: C.yellow }); y += 14;
    badge(ctx, mid - badgeWidth(sc.abbr, 2) - 16, y, sc.abbr, sc.colors, 2);
    drawText(ctx, 'VS', mid, y + 5, { align: 'center', color: C.grey });
    badge(ctx, mid + 16, y, o.abbr, o.colors, 2);
    y += 22;
    drawText(ctx, `${c.label(sc.id)} ${c.record().text}`, mid, y, { align: 'center', color: C.white }); y += 9;
    drawText(ctx, `${c.label(o.id)} ${c.record(o.id).text}`, mid, y, { align: 'center', color: C.grey }); y += 16;
    drawText(ctx, plan.label, mid, y, { align: 'center', scale: 2, color: C.green }); y += 16;
    drawText(ctx, plan.detail, mid, y, { align: 'center', color: C.white }); y += 10;
    const m = plan.match;
    if (plan.kind === 'scenario') drawText(ctx, `${m.periodText} - ${m.names.you} ${m.score.you}  ${m.names.cpu} ${m.score.cpu}`, mid, y, { align: 'center', color: C.grey });
    button(ctx, this.gamedayLayout(v).go, 'TAKE THE FIELD', C.green);
  }

  private renderResult(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, l = this.lastLog!, sc = c.school, o = c.team(l.opp), mid = v.w / 2;
    const won = l.us > l.them;
    let y = this.title(ctx, v, won ? 'WIN!' : 'LOSS', won ? C.green : C.red);
    drawText(ctx, l.title, mid, y, { align: 'center', color: C.yellow }); y += 12;
    drawText(ctx, `${sc.abbr} ${l.us} - ${o.abbr} ${l.them}${l.ot ? ' (OT)' : ''}`, mid, y, { align: 'center', scale: 2 }); y += 16;
    if (l.kind === 'none') { drawText(ctx, 'YOU DID NOT GET IN', mid, y, { align: 'center', color: C.grey }); y += 10; }
    else {
      drawText(ctx, passLine(l.line), mid, y, { align: 'center' }); y += 9;
      if (rushLine(l.line)) { drawText(ctx, rushLine(l.line), mid, y, { align: 'center', color: C.grey }); y += 9; }
      if (l.grade !== null) { drawText(ctx, `GRADE ${letterGrade(l.grade)}`, mid, y, { align: 'center', scale: 2, color: gradeColor(l.grade) }); y += 15; }
    }
    if (l.battle !== null && this.battleBefore !== null) {
      const d = l.battle - this.battleBefore;
      drawText(ctx, `QB BATTLE ${this.battleBefore} -> ${l.battle} (${d >= 0 ? '+' : ''}${d})`, mid, y, { align: 'center', color: d >= 0 ? C.green : C.orange }); y += 10;
    }
    const gains = Object.entries(l.gains).filter(([, n]) => n).map(([k, n]) => `${k.toUpperCase()} +${n}`);
    if (gains.length) { drawText(ctx, gains.join('  '), mid, y, { align: 'center', color: C.green }); y += 10; }
    y += 4;
    for (const n of [...l.news, ...c.s.headlines.filter((h) => !l.news.includes(h))].slice(0, v.landscape ? 5 : 9)) {
      drawText(ctx, n.slice(0, Math.floor((v.w - 8) / 4)), mid, y, { align: 'center', color: l.news.includes(n) ? C.yellow : C.grey }); y += 9;
    }
    button(ctx, this.bottomButton(v), 'CONTINUE', C.green);
  }

  private renderSchedule(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s;
    let y = this.title(ctx, v, 'SCHEDULE');
    const mine = s.games.filter((g) => c.mine(g)).sort((a, b) => a.week - b.week);
    const w = Math.min(v.w - 8, 260), x = (v.w - w) / 2, rowH = v.landscape ? 9 : 11;
    for (const g of mine) {
      const o = c.team(c.opponentOf(g)), home = g.home === s.schoolId, cur = g.week === s.week && !played(g);
      if (cur) { ctx.fillStyle = C.navy; ctx.fillRect(x - 2, y - 2, w + 4, rowH - 1); }
      const tag = g.round ? g.round : g.ccg ? 'CCG' : g.bowl ? 'BWL' : `W${g.week}`;
      drawText(ctx, tag, x, y, { color: g.round || g.ccg || g.bowl ? C.yellow : C.grey });
      drawText(ctx, g.neutral ? 'VS' : home ? 'VS' : 'AT', x + 18, y, { color: C.grey });
      drawText(ctx, c.label(o.id).slice(0, Math.floor((w - 90) / 4)), x + 30, y, { color: g.conf ? C.white : C.grey });
      if (played(g)) {
        const us = home ? g.hs! : g.as!, them = home ? g.as! : g.hs!;
        drawText(ctx, `${us > them ? 'W' : 'L'} ${us}-${them}${g.ot ? ' OT' : ''}`, x + w, y, { align: 'right', color: us > them ? C.green : C.red });
      } else drawText(ctx, c.record(o.id).text, x + w, y, { align: 'right', color: C.darkGrey });
      y += rowH;
    }
    y += 3;
    drawText(ctx, 'WHITE = CONFERENCE GAME', v.w / 2, y, { align: 'center', color: C.darkGrey });
    button(ctx, this.bottomButton(v), 'BACK');
  }

  private renderRankings(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, T = this.rankTabs(v), land = v.landscape;
    if (!land) this.title(ctx, v, 'RANKINGS');
    for (const [t, rect, label] of [['top25', T.top25, 'TOP 25'], ['conf', T.conf, c.conf.length > 8 ? 'CONF' : c.conf], ['cfp', T.cfp, 'PLAYOFF']] as const) {
      const on = this.tab === t;
      box(ctx, rect, on ? C.yellow : C.ink, on ? C.yellow : C.grey);
      drawText(ctx, label, rect.x + rect.w / 2, rect.y + 4, { align: 'center', color: on ? C.ink : C.grey });
    }
    if (this.tab === 'top25') this.renderTop25(ctx, v, T.top);
    else if (this.tab === 'conf') this.renderConf(ctx, v, T.top);
    else this.renderPlayoff(ctx, v, T.top);
    button(ctx, this.bottomButton(v), 'BACK');
  }

  private renderTop25(ctx: CanvasRenderingContext2D, v: View, top: number): void {
    const c = this.career!, s = c.s, land = v.landscape, cols = land ? 2 : 1, per = Math.ceil(25 / cols);
    const w = land ? Math.min((v.w - 24) / 2, 180) : Math.min(v.w - 12, 176);
    const div = c.fcs ? 'FCS ' : '';
    drawText(ctx, s.week <= 1 ? `PRESEASON ${div}TOP 25` : s.phase !== 'season' ? `FINAL ${div}TOP 25` : `${div}TOP 25 BEFORE WEEK ${Math.min(s.week, LAST_WEEK)}`, v.w / 2, top, { align: 'center', color: C.yellow });
    s.poll.slice(0, 25).forEach((id, i) => {
      const col = Math.floor(i / per), x = land ? v.w / 2 - w - 6 + col * (w + 12) : (v.w - w) / 2, y = top + 10 + (i % per) * 9;
      const mine = id === s.schoolId, t = c.team(id);
      if (mine) { ctx.fillStyle = C.navy; ctx.fillRect(x - 2, y - 2, w + 4, 8); }
      drawText(ctx, `${i + 1}`, x + 8, y, { align: 'right', color: C.grey });
      drawText(ctx, t.name.slice(0, Math.floor((w - 64) / 4)), x + 12, y, { color: mine ? C.yellow : t.conference === c.conf ? C.white : C.grey });
      drawText(ctx, c.record(id).text, x + w - 18, y, { align: 'right', color: C.grey });
      const was = s.pollPrev ? s.pollPrev.indexOf(id) + 1 : 0, d = was - (i + 1);
      if (s.pollPrev) {
        const [txt, cl] = !was || was > 25 ? ['NEW', C.yellow] : d > 0 ? [`+${d}`, C.green] : d < 0 ? [`${d}`, C.orange] : ['-', C.darkGrey];
        drawText(ctx, txt, x + w, y, { align: 'right', color: cl });
      }
    });
  }

  private renderConf(ctx: CanvasRenderingContext2D, v: View, top: number): void {
    const c = this.career!, s = c.s, w = Math.min(v.w - 12, 200), x = (v.w - w) / 2;
    const rows = confOrder(c.conf, s.games), rowH = v.landscape ? 8 : 9;
    drawText(ctx, `${c.conf} STANDINGS`, v.w / 2, top, { align: 'center', color: C.yellow });
    drawText(ctx, 'CONF  ALL', x + w, top + 9, { align: 'right', color: C.darkGrey });
    rows.forEach((st, i) => {
      const y = top + 18 + i * rowH, mine = st.id === s.schoolId;
      if (mine) { ctx.fillStyle = C.navy; ctx.fillRect(x - 2, y - 2, w + 4, rowH - 1); }
      drawText(ctx, `${i + 1} ${c.label(st.id)}`.slice(0, Math.floor((w - 50) / 4)), x, y, { color: mine ? C.yellow : i < 2 ? C.white : C.grey });
      drawText(ctx, `${st.cw}-${st.cl}`, x + w - 28, y, { align: 'right', color: C.white });
      drawText(ctx, `${st.w}-${st.l}`, x + w, y, { align: 'right', color: C.grey });
    });
  }

  private renderPlayoff(ctx: CanvasRenderingContext2D, v: View, top: number): void {
    const c = this.career!, s = c.s, land = v.landscape;
    if (c.fcs) { this.renderFcsPlayoff(ctx, v, top); return; }
    const field = s.field ?? playoffField(s.poll, s.games).slice(0, 12);
    drawText(ctx, s.field ? 'COLLEGE FOOTBALL PLAYOFF' : 'PROJECTED PLAYOFF FIELD', v.w / 2, top, { align: 'center', color: C.yellow });
    const w = land ? Math.min((v.w - 24) / 2, 170) : Math.min(v.w - 12, 176);
    let x = land ? v.w / 2 - w - 6 : (v.w - w) / 2, y = top + 11;
    field.forEach((id, i) => {
      const mine = id === s.schoolId;
      drawText(ctx, `${i + 1} ${c.team(id).name}`.slice(0, Math.floor((w - 30) / 4)), x, y, { color: mine ? C.yellow : i < 4 ? C.white : C.grey });
      drawText(ctx, c.record(id).text, x + w, y, { align: 'right', color: C.grey });
      y += 8;
    });
    if (!s.field) { drawText(ctx, 'TOP 4 SEEDS GET A BYE. FIVE CONFERENCE', v.w / 2, y + 4, { align: 'center', color: C.darkGrey }); drawText(ctx, 'CHAMPIONS ARE IN.', v.w / 2, y + 12, { align: 'center', color: C.darkGrey }); return; }
    if (land) { x = v.w / 2 + 6; y = top + 11; } else y += 6;
    for (const round of CFP_ROUNDS) {
      const gs = s.games.filter((g) => g.round === round && !g.fcs);
      if (!gs.length) continue;
      drawText(ctx, round === 'F' ? 'TITLE' : round, x, y, { color: C.yellow }); y += 8;
      for (const g of gs) { this.bracketRow(ctx, g, x, y, w); y += 8; }
      y += 2;
    }
  }

  /** The FCS playoff: the top 8 (projected until the regular season ends) and the bracket. */
  private renderFcsPlayoff(ctx: CanvasRenderingContext2D, v: View, top: number): void {
    const c = this.career!, s = c.s, w = Math.min(v.w - 12, 176), x = (v.w - w) / 2;
    const games = s.games.filter((g) => g.fcs);
    drawText(ctx, games.length ? 'FCS PLAYOFF' : 'PROJECTED FCS PLAYOFF (TOP 8)', v.w / 2, top, { align: 'center', color: C.yellow });
    let y = top + 11;
    if (!games.length) {
      s.poll.slice(0, 8).forEach((id, i) => {
        drawText(ctx, `${i + 1} ${c.team(id).name}`, x, y, { color: id === s.schoolId ? C.yellow : C.white });
        drawText(ctx, c.record(id).text, x + w, y, { align: 'right', color: C.grey }); y += 9;
      });
      return;
    }
    for (const round of ['QF', 'SF', 'F'] as const) {
      const gs = games.filter((g) => g.round === round);
      if (!gs.length) continue;
      drawText(ctx, round === 'F' ? 'TITLE' : round, x, y, { color: C.yellow }); y += 9;
      for (const g of gs) { this.bracketRow(ctx, g, x, y, w); y += 9; }
      y += 3;
    }
  }

  private bracketRow(ctx: CanvasRenderingContext2D, g: CGame, x: number, y: number, w: number): void {
    const c = this.career!, done = played(g), win = done ? winnerOf(g) : null;
    const col = (id: string) => (id === c.s.schoolId ? C.yellow : !done || win === id ? C.white : C.darkGrey);
    drawText(ctx, c.team(g.home).abbr, x, y, { color: col(g.home) });
    drawText(ctx, done ? `${g.hs}-${g.as}` : 'VS', x + w / 2, y, { align: 'center', color: C.grey });
    drawText(ctx, c.team(g.away).abbr, x + w, y, { align: 'right', color: col(g.away) });
  }

  private renderStats(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s;
    let y = this.title(ctx, v, 'STATS');
    const w = Math.min(v.w - 8, 230), x = (v.w - w) / 2;
    const tot = s.log.reduce((t, l) => { for (const k of Object.keys(t) as (keyof TeamStats)[]) t[k] += l.line[k] ?? 0; return t; }, newStats());
    drawText(ctx, `${c.classLabel} SEASON - ${c.school.name}`, x, y, { color: C.yellow }); y += 9;
    const pct = tot.att ? Math.round((100 * tot.cmp) / tot.att) : 0;
    drawText(ctx, `${passLine(tot)} ${pct}% RTG ${passerRating(tot).toFixed(1)}`, x, y); y += 9;
    drawText(ctx, rushLine(tot) || 'RUSH NONE YET', x, y, { color: rushLine(tot) ? C.white : C.darkGrey }); y += 12;
    drawText(ctx, 'GAME LOG', x, y, { color: C.grey }); y += 9;
    for (const l of s.log.slice(v.landscape ? -6 : -12)) {
      drawText(ctx, c.team(l.opp).abbr, x, y, { color: C.grey });
      drawText(ctx, `${l.us > l.them ? 'W' : 'L'} ${l.us}-${l.them}`, x + 16, y, { color: l.us > l.them ? C.green : C.red });
      drawText(ctx, l.kind === 'none' ? 'DNP' : `${l.line.cmp}/${l.line.att} ${l.line.yards} ${l.line.tds}TD ${l.line.int}I${l.line.rush ? ` R${l.line.ryds ?? 0}` : ''}`, x + 58, y);
      if (l.grade !== null) drawText(ctx, letterGrade(l.grade), x + w, y, { align: 'right', color: gradeColor(l.grade) });
      y += 8;
    }
    if (!s.log.length) { drawText(ctx, 'NO GAMES YET', x, y, { color: C.darkGrey }); y += 8; }
    y += 5;
    drawText(ctx, 'COLLEGE CAREER', x, y, { color: C.grey }); y += 9;
    for (const sl of s.seasons) {
      drawText(ctx, `${sl.cls} ${sl.record}`, x, y, { color: C.grey });
      drawText(ctx, `${sl.stats.cmp}/${sl.stats.att} ${sl.stats.yards} YDS ${sl.stats.tds} TD${sl.redshirt ? ' (RS)' : ''}`, x + 44, y); y += 8;
    }
    drawText(ctx, `HIGH SCHOOL: ${s.hs.school} (${s.hs.state}) - ${s.hs.stars} STARS`, x, y + 2, { color: C.darkGrey });
    button(ctx, this.bottomButton(v), 'BACK');
  }

  private renderPlan(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s, L = this.planLayout(v);
    this.title(ctx, v, 'GAME PLAN');
    const pick = (rr: Rect, label: string, on: boolean) => button(ctx, rr, label, on ? C.green : C.grey, on ? '#0b3d1d' : C.ink);
    drawText(ctx, 'DEFENSE', L.x, L.y0, { color: C.grey });
    pick(L.defPlay, 'PLAY THE MIKE', s.defense === 'play'); pick(L.defSim, 'SIMULATED', s.defense === 'sim');
    drawText(ctx, 'PLAYS', L.x, L.y0 + 36, { color: C.grey });
    pick(L.callsCoach, 'COACH CALLS', s.calls === 'coach'); pick(L.callsYou, 'YOU CALL', s.calls === 'you');
    drawText(ctx, 'DIFFICULTY', L.x, L.y0 + 72, { color: C.grey });
    stepper(ctx, L.diffL, L.diffR, DIFFICULTIES.find((d) => d.id === s.difficulty)!.name, s.difficulty === 'allpro' ? C.orange : C.white);
    button(ctx, this.bottomButton(v), 'BACK');
  }

  private renderSummary(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s, sl = s.seasons[s.seasons.length - 1], mid = v.w / 2;
    if (!sl) return;
    let y = this.title(ctx, v, 'SEASON OVER');
    drawText(ctx, `${sl.cls} YEAR AT ${sl.school}`, mid, y, { align: 'center', color: C.grey }); y += 12;
    drawText(ctx, `${sl.record}${sl.rank ? ` - FINAL NO.${sl.rank}` : ''}`, mid, y, { align: 'center', scale: 2 }); y += 16;
    drawText(ctx, sl.finish, mid, y, { align: 'center', color: C.yellow }); y += 14;
    drawText(ctx, `${sl.role} - ${sl.gp} GAMES, ${sl.gs} STARTS${sl.avg !== undefined ? ` - ${letterGrade(sl.avg)}` : ''}`, mid, y, { align: 'center', color: C.grey }); y += 9;
    drawText(ctx, passLine(sl.stats), mid, y, { align: 'center' }); y += 9;
    if (rushLine(sl.stats)) { drawText(ctx, rushLine(sl.stats), mid, y, { align: 'center', color: C.grey }); y += 9; }
    y += 6;
    for (const a of sl.awards) { drawText(ctx, a, mid, y, { align: 'center', color: a.startsWith('HEISMAN') || a.startsWith('NATIONAL') ? C.yellow : C.green }); y += 9; }
    if (sl.redshirt) { drawText(ctx, 'REDSHIRT: THE YEAR DOES NOT COUNT', mid, y, { align: 'center', color: C.blue }); y += 9; }
    const last = s.elig >= 4 || s.year >= 4;
    drawText(ctx, last ? 'YOUR COLLEGE CAREER IS OVER' : `NEXT: ${c.classLabel} SEASON (OVR ${qbOvr(c.player)})`, mid, y + 6, { align: 'center', color: C.grey });
    button(ctx, this.bottomButton(v), last ? 'FINISH' : 'NEXT SEASON', C.green);
  }

  private renderDone(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s, p = c.player, mid = v.w / 2;
    let y = this.title(ctx, v, 'COLLEGE CAREER');
    drawText(ctx, `${p.first} ${p.last} - ${c.school.name}`, mid, y, { align: 'center', color: C.grey }); y += 12;
    const tot = s.seasons.reduce((t, sl) => { for (const k of Object.keys(t) as (keyof TeamStats)[]) t[k] += sl.stats[k] ?? 0; return t; }, newStats());
    drawText(ctx, `${tot.yards} YDS ${tot.tds} TD ${tot.int} INT`, mid, y, { align: 'center', scale: 1 }); y += 9;
    if (tot.rush) { drawText(ctx, `RUSH ${tot.rush}-${tot.ryds} ${tot.rtd} TD`, mid, y, { align: 'center', color: C.grey }); y += 9; }
    y += 4;
    for (const sl of s.seasons) { drawText(ctx, `${sl.cls} ${sl.record} - ${sl.finish}`.slice(0, Math.floor((v.w - 8) / 4)), mid, y, { align: 'center', color: C.white }); y += 8; }
    y += 6;
    for (const a of s.awards.slice(0, v.landscape ? 4 : 10)) { drawText(ctx, a, mid, y, { align: 'center', color: C.green }); y += 8; }
    drawText(ctx, 'NEXT: THE NFL DRAFT (COMING SOON)', mid, y + 6, { align: 'center', color: C.yellow });
    button(ctx, this.doneLayout(v).menu, 'MENU', C.grey);
  }
}

