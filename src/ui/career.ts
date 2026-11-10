// The career screens: start (continue / new), create your QB, the weekly hub,
// game day, the week's result, schedule, standings (and the playoff bracket),
// stats, the season summary and the end of high school. Each screen lays
// itself out for portrait (180x320) and landscape (~400x180).
import { C } from '../config';
import { Career, type GamePlan, HS_YEARS, SITE_NAME, type WeekLog } from '../career/career';
import { STATES, randomName } from '../career/hsnames';
import { type GameRec, PLAYOFF_ROUNDS, REGION_NAMES, ROUND_NAMES, played, regionOrder, standings, winnerOf } from '../career/league';
import {
  ARCHETYPES, type Archetype, CLASS_NAMES, CLASS_SHORT, FOCUSES, displayName, jerseyNo, letterGrade, passerRating, qbOvr,
} from '../career/player';
import { type College, MAX_VISITS, TIER_NAMES, board, college, offerList, toNextStar, walkOns } from '../career/recruiting';
import { deleteCareer, loadCareer, saveCareer } from '../career/save';
import { frontPage, paperName, playersToWatch, pollRank, recText, rivalOf, rivalTrophy, statePoll, storyline, weatherText, yds } from '../career/news';
import { copyText, exportText } from './export';
import { type Kit, kitsFor } from '../sprites';
import type { TeamStats } from '../drive';
import type { Game } from '../game';
import type { IntroInfo } from '../intro';
import { DIFFICULTIES, type Difficulty, QUARTERS, cycle } from '../settings';
import { type Vec, clamp, lerp } from '../util';
import type { View } from '../view';
import { type Rect, accentOn, badge, contrast, badgeWidth, box, button, hit, inkOn, meter, screenBg, stars, stepper } from './kit';
import { BALL, BALL_PAL, BUST_H, BUST_W, CAP_H, CAP_W, CUP, MEDAL, PLAQUE, STATUE, TROPHY_PAL, artW, cap, framedJersey, pixelArt, qbBust, signee } from './art';
import { shade } from '../sprites';
import { drawText, textWidth } from '../font';

type Screen = 'start' | 'create' | 'hub' | 'gameplan' | 'banquet' | 'ceremony' | 'gameday' | 'result' | 'schedule' | 'standings' | 'stats' | 'summary' | 'recruiting' | 'signing' | 'done';

const r = (x: number, y: number, w: number, h: number): Rect => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
const cleanName = (s: string) => s.toUpperCase().replace(/[^A-Z' -]/g, '').trim().slice(0, 10);
const line = (s: TeamStats) => `${s.cmp}/${s.att}  ${s.yards} YDS  ${s.tds} TD  ${s.int} INT`;
const num = (n: number) => n.toLocaleString('en-US');
/** A stable pick from a list, by a string (so a screen redrawn every frame doesn't flicker). */
const pickBy = <T>(key: string, list: T[]): T => list[[...key].reduce((t, ch) => (t * 31 + ch.charCodeAt(0)) % 100003, 11) % list.length];
const PAPER = '#f3e7cf', PEN = '#2a2233', FADED = '#6b5f70', CASE_BG = '#1a1424', WOOD = '#ab5236', WOOD_DARK = '#7a3a26';
const DIFF_NOTE: Record<Difficulty, string> = {
  rookie: 'WEAKER TEAMS, EASIER STARS', pro: 'THE STANDARD CAREER', allpro: 'BETTER TEAMS, STARS ARE HARD',
};
const contrastOk = (col: string) => contrast(col, PAPER) >= 3; // readable on the yearbook / letter paper
const gradeColor = (g: number) => (g >= 74 ? C.green : g >= 59 ? C.yellow : g >= 45 ? C.white : C.orange);

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
  listPage = 0; // recruiting / signing day: which page of schools
  exportNote: { text: string; color: string; until: number } | null = null; // EXPORT SAVE feedback
  flash: { text: string; color: string; until: number } | null = null; // recruiting board: why a visit can't happen, etc.
  standingsTab: 'regions' | 'top10' | 'playoffs' = 'regions';
  statsTab: 'you' | 'team' | 'state' = 'you';
  private storyCache: { key: string; story: string | null } | null = null; // the hub's storyline for the next game
  // character creation
  first = 'JAKE';
  last = 'MOORE';
  stateIdx = STATES.findIndex((s) => s.id === 'TX');
  arch: Archetype = 'pocket';
  diff: Difficulty = 'pro';
  banquetSeen = -1; // the season whose awards night you've seen (it comes before the yearbook)
  ceremonyAt = 0; // signing day: when the hats went on the table

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
    this.diff = this.game.settings.difficulty;
    this.screen = 'create';
  }

  /** Tests: go to the screen for the career's phase. */
  toHubForTest(): void { this.toHub(); }

  private toHub(): void {
    const c = this.career!;
    const last = c.player.seasons[c.player.seasons.length - 1];
    this.screen = c.s.phase === 'summary' ? (last?.banquet && this.banquetSeen !== last.year ? 'banquet' : 'summary') : c.s.phase === 'signing' ? 'signing' : c.s.phase === 'done' ? 'done' : 'hub';
    this.pick = null;
    this.listPage = 0;
    this.game.showCareer(this);
  }

  // ---------- actions ----------

  /** Creates the career (tests call this directly). */
  create(first = this.first, last = this.last, stateId = STATES[this.stateIdx].id, arch = this.arch): Career {
    deleteCareer();
    this.career = Career.create(first, last, stateId, arch, Number(this.game.settings.quarter) * 60, this.diff);
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
    const c = this.career!, plan = this.plan!, sc = c.school;
    const shift = c.oppShift; // difficulty: how good the other teams play
    this.game.playCareerGame({
      difficulty: c.difficulty,
      schools: { you: { name: sc.name, mascot: sc.mascot }, cpu: { name: plan.opp.name, mascot: plan.opp.mascot } },
      card: { story: plan.rival ? `RIVALRY WEEK: ${c.trophy}` : plan.story, weather: weatherText(plan.weather) },
      weather: { sky: plan.weather.sky, night: plan.weather.night },
      match: plan.match, you: c.rosterWithYou(), opp: plan.oppRoster,
      units: { you: plan.units.you, cpu: { off: plan.units.cpu.off + shift, def: plan.units.cpu.def + shift } },
      kits: this.kits(plan),
      crowd: plan.rec.home === c.s.schoolId
        ? { home: c.school.colors, away: plan.opp.colors, homeName: c.school.mascot }
        : { home: plan.opp.colors, away: c.school.colors, homeName: plan.opp.mascot },
      intro: this.introFor(plan),
      simDefense: c.s.defense === 'sim', coachCalls: c.s.calls !== 'you', endAtHalf: plan.endAtHalf, label: plan.label,
      onDone: (_m, stint) => this.finish(stint),
    });
  }

  /** The pregame show: only for a game you start from the opening kickoff. */
  private introFor(plan: GamePlan): IntroInfo | undefined {
    const c = this.career!, m = plan.match, sc = c.school, o = plan.opp;
    if (m.quarter > 1 || m.clock < m.quarterSeconds || m.score.you + m.score.cpu > 0) return undefined;
    const ev = c.eventText(plan.rec);
    const story = plan.rival ? `RIVALRY WEEK: ${c.trophy}` : plan.story ?? (ev?.tag === 'ON TV' ? 'FRIDAY NIGHT LIVE' : null);
    return {
      home: plan.rec.home === c.s.schoolId ? 'you' : 'cpu', top: story ?? (plan.rec.round ? 'STATE PLAYOFFS' : `WEEK ${plan.rec.week}`), big: !!story,
      names: { you: sc.name, cpu: o.name }, mascots: { you: sc.mascot, cpu: o.mascot }, abbrs: { you: sc.abbr, cpu: o.abbr },
      colors: { you: sc.colors, cpu: o.colors },
    };
  }

  /** Uniforms: the home team in its colours, the visitors in white. */
  private kits(plan: GamePlan): { you: Kit; cpu: Kit } {
    const me = this.career!.school, home = plan.rec.home === this.career!.s.schoolId;
    const k = home ? kitsFor(me.colors, plan.opp.colors) : kitsFor(plan.opp.colors, me.colors);
    return home ? { you: k.home, cpu: k.away } : { you: k.away, cpu: k.home };
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
        if (hit(L.exp, p) && c) { this.confirmNew = false; this.game.afterTap = () => this.exportSave(); return; }
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
        if (hit(L.diffL, p)) this.diff = cycle(DIFFICULTIES, this.diff, -1) as Difficulty;
        if (hit(L.diffR, p)) this.diff = cycle(DIFFICULTIES, this.diff, 1) as Difficulty;
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
        if (hit(L.recruiting, p)) { this.screen = 'recruiting'; this.pick = null; this.listPage = 0; }
        if (hit(L.gamePlan, p)) this.screen = 'gameplan';
        if (hit(L.menu, p)) this.game.showTitle();
        return;
      }
      case 'gameplan': {
        if (!c) return;
        const L = this.gamePlanLayout(v);
        if (hit(L.defPlay, p)) { c.s.defense = 'play'; this.save(); }
        if (hit(L.defSim, p)) { c.s.defense = 'sim'; this.save(); }
        if (hit(L.callsCoach, p)) { c.s.calls = 'coach'; this.save(); }
        if (hit(L.callsYou, p)) { c.s.calls = 'you'; this.save(); }
        if (hit(L.diffL, p)) c.setDifficulty(cycle(DIFFICULTIES, c.difficulty, -1) as Difficulty);
        if (hit(L.diffR, p)) c.setDifficulty(cycle(DIFFICULTIES, c.difficulty, 1) as Difficulty);
        if (hit(this.bottomButton(v), p)) this.screen = 'hub';
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
        if (hit(L.tabT, p)) this.standingsTab = 'top10';
        if (hit(L.tabP, p) && c?.s.games.some((g) => g.round)) this.standingsTab = 'playoffs';
        if (hit(this.bottomButton(v), p)) this.screen = 'hub';
        return;
      }
      case 'stats': {
        const L = this.standingsLayout(v);
        if (hit(L.tabR, p)) this.statsTab = 'you';
        if (hit(L.tabT, p)) this.statsTab = 'team';
        if (hit(L.tabP, p)) this.statsTab = 'state';
        if (hit(this.bottomButton(v), p)) this.screen = 'hub';
        return;
      }
      case 'schedule':
        if (hit(this.bottomButton(v), p)) this.screen = 'hub';
        return;
      case 'summary':
        if (hit(this.bottomButton(v), p) && c) { c.nextSeason(); this.toHub(); }
        return;
      case 'recruiting': {
        if (!c) return;
        if (hit(this.bottomButton(v), p)) { this.screen = 'hub'; return; }
        if (this.pagerTap(p, v, this.recruitPages(v))) return;
        const rs = c.s.recruit;
        const A = this.recruitActions(v);
        if (A && this.pick && hit(A.visit, p)) {
          const why = c.visitBlocked(this.pick);
          if (why) this.flash = { text: why, color: C.orange, until: performance.now() + 2500 };
          else { const news = c.visit(this.pick)!; this.flash = { text: news[news.length - 1], color: news.some((n) => n.startsWith('OFFER')) ? C.green : C.white, until: performance.now() + 3500 }; }
          return;
        }
        if (A?.commit && this.pick && hit(A.commit, p)) { c.commit(rs.committed === this.pick ? null : this.pick); this.pick = null; return; }
        const row = this.recruitRows(v).find((x) => hit(x.r, p));
        this.pick = row && this.pick !== row.c.id ? row.c.id : null; // tap a school to pick it (again to let go)
        return;
      }
      case 'signing': {
        if (!c) return;
        if (this.pagerTap(p, v, this.signingPages(v))) return;
        const row = this.signingRows(v).find((x) => hit(x.r, p));
        if (!row) { this.pick = null; return; }
        if (this.pick !== row.c.id) { this.pick = row.c.id; return; }
        c.sign(row.c.id);
        this.pick = null;
        this.screen = 'ceremony';
        this.ceremonyAt = performance.now();
        return;
      }
      case 'ceremony':
        if (hit(this.bottomButton(v), p)) this.screen = 'done';
        return;
      case 'banquet':
        if (hit(this.bottomButton(v), p) && c) { this.banquetSeen = c.player.seasons[c.player.seasons.length - 1].year; this.screen = 'summary'; }
        return;
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

  /** EXPORT SAVE: copies the save as text (runs on the finger lifting, for the clipboard). */
  exportSave(): void {
    const text = exportText();
    copyText(text).then((ok) => {
      this.exportNote = ok
        ? { text: `SAVE COPIED (${Math.ceil(text.length / 1024)} KB)`, color: C.green, until: performance.now() + 6000 }
        : { text: 'COPY IT FROM THE BOX', color: C.yellow, until: performance.now() + 4000 };
    });
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
    const mid = v.w / 2, y = v.landscape ? 74 : 170;
    return { cont: r(mid - 60, y, 120, 20), fresh: r(mid - 60, y + 26, 120, 16), exp: r(mid - 60, y + 48, 120, 16), back: r(mid - 40, v.h - 20, 80, 16) };
  }

  createLayout(v: View) {
    if (v.landscape) {
      const lx = 12, rx = v.w / 2 + 6, cw = v.w / 2 - 18;
      return {
        nameY: 30, nameX: lx + cw / 2, reroll: r(lx, 50, cw / 2 - 2, 14), edit: r(lx + cw / 2 + 2, 50, cw / 2 - 2, 14),
        stateY: 76, stateL: r(lx, 86, 20, 16), stateR: r(lx + cw - 20, 86, 20, 16),
        archY: 30, archL: r(rx, 40, 20, 16), archR: r(rx + cw - 20, 40, 20, 16), archX: rx + cw / 2,
        diffY: 110, diffL: r(lx, 118, 20, 16), diffR: r(lx + cw - 20, 118, 20, 16),
        start: r(rx, v.h - 44, cw, 20), back: r(lx, v.h - 26, 60, 16), lx, rx, cw,
      };
    }
    const x = 10, cw = v.w - 20;
    return {
      nameY: 44, nameX: v.w / 2, reroll: r(x, 64, cw / 2 - 2, 14), edit: r(x + cw / 2 + 2, 64, cw / 2 - 2, 14),
      stateY: 94, stateL: r(x, 104, 22, 16), stateR: r(x + cw - 22, 104, 22, 16),
      archY: 134, archL: r(x, 144, 22, 16), archR: r(x + cw - 22, 144, 22, 16), archX: v.w / 2,
      diffY: 224, diffL: r(x, 232, 22, 16), diffR: r(x + cw - 22, 232, 22, 16),
      start: r(x + 10, v.h - 50, cw - 20, 22), back: r(v.w / 2 - 40, v.h - 22, 80, 16), lx: x, rx: x, cw,
    };
  }

  hubLayout(v: View) {
    if (v.landscape) {
      const lw = Math.floor(v.w * 0.56) - 6, rx = lw + 10, rw = v.w - rx - 4, half = Math.floor((rw - 4) / 2);
      return {
        banner: 26, left: { x: 4, w: lw }, strip: 31, card: { y: 46, h: 52 }, you: { y: 102, h: 40 }, ticker: r(4, 146, lw, 11),
        gameDay: r(rx, 31, rw, 28),
        schedule: r(rx, 64, half, 16), standings: r(rx + half + 4, 64, rw - half - 4, 16),
        stats: r(rx, 84, half, 16), team: r(rx + half + 4, 84, rw - half - 4, 16),
        recruiting: r(rx, 104, half, 16), gamePlan: r(rx + half + 4, 104, rw - half - 4, 16),
        focusY: 127, focusX: rx, focusL: r(rx + 38, 124, 16, 12), focusR: r(rx + rw - 16, 124, 16, 12),
        menu: r(rx, 146, 44, 13),
      };
    }
    const x = 4, w = v.w - 8, half = Math.floor((w - 4) / 2);
    return {
      banner: 40, left: { x, w }, strip: 46, card: { y: 61, h: 52 }, you: { y: 117, h: 40 }, ticker: r(0, 161, v.w, 11),
      schedule: r(x, 179, half, 18), standings: r(x + half + 4, 179, w - half - 4, 18),
      stats: r(x, 201, half, 18), team: r(x + half + 4, 201, w - half - 4, 18),
      recruiting: r(x, 223, half, 18), gamePlan: r(x + half + 4, 223, w - half - 4, 18),
      focusY: 249, focusX: x + 4, focusL: r(x + 42, 246, 16, 12), focusR: r(x + w - 16, 246, 16, 12),
      gameDay: r(x, 263, w, 30), menu: r(x, 300, 44, 14),
    };
  }

  gamePlanLayout(v: View) {
    const w = Math.min(v.w - 16, 220), x = (v.w - w) / 2, half = (w - 4) / 2;
    const y1 = v.landscape ? 24 : 46, y2 = v.landscape ? 70 : 120, y3 = v.landscape ? 116 : 194;
    return {
      defY: y1, callsY: y2, diffY: y3, descY: v.landscape ? 28 : 32,
      diffL: r(x, y3 + 10, 22, 16), diffR: r(x + w - 22, y3 + 10, 22, 16),
      defPlay: r(x, y1 + 10, half, 16), defSim: r(x + half + 4, y1 + 10, half, 16),
      callsCoach: r(x, y2 + 10, half, 16), callsYou: r(x + half + 4, y2 + 10, half, 16),
    };
  }

  gamedayLayout(v: View) { return { go: r(v.w / 2 - 55, v.h - (v.landscape ? 30 : 60), 110, 22) }; }

  standingsLayout(v: View) {
    const y = v.landscape ? 4 : 24;
    return { tabR: r(v.w / 2 - 86, y, 56, 13), tabT: r(v.w / 2 - 28, y, 56, 13), tabP: r(v.w / 2 + 30, y, 56, 13), top: y + 20 };
  }

  doneLayout(v: View) {
    if (v.landscape) { const x = v.w / 2 + 4, w = (v.w / 2 - 14) / 2; return { fresh: r(x, v.h - 20, w, 16), menu: r(x + w + 4, v.h - 20, w, 16) }; }
    const y = v.h - 20;
    return { fresh: r(6, y, 80, 16), menu: r(v.w - 86, y, 80, 16) };
  }

  // ---------- drawing ----------

  render(ctx: CanvasRenderingContext2D, v: View): void {
    screenBg(ctx, v.w, v.h);
    switch (this.screen) {
      case 'start': this.renderStart(ctx, v); break;
      case 'create': this.renderCreate(ctx, v); break;
      case 'hub': this.renderHub(ctx, v); break;
      case 'gameplan': this.renderGamePlan(ctx, v); break;
      case 'banquet': this.renderBanquet(ctx, v); break;
      case 'ceremony': this.renderCeremony(ctx, v); break;
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
    if (c) button(ctx, L.exp, 'EXPORT SAVE', C.blue);
    const note = this.exportNote;
    if (note && performance.now() < note.until) {
      drawText(ctx, note.text, v.w / 2, L.exp.y + 22, { align: 'center', color: note.color });
      if (note.color === C.green && !v.landscape) drawText(ctx, 'PASTE IT INTO YOUR CHAT', v.w / 2, L.exp.y + 31, { align: 'center', color: C.grey });
    }
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
    drawText(ctx, 'DIFFICULTY', L.lx + L.cw / 2, L.diffY, { align: 'center', color: C.grey });
    stepper(ctx, L.diffL, L.diffR, DIFFICULTIES.find((d) => d.id === this.diff)!.name, this.diff === 'allpro' ? C.orange : this.diff === 'rookie' ? C.green : C.white);
    drawText(ctx, DIFF_NOTE[this.diff], L.lx + L.cw / 2, L.diffL.y + 20, { align: 'center', color: C.darkGrey });
    button(ctx, L.start, 'START CAREER', C.green);
    button(ctx, L.back, 'BACK', C.grey);
  }

  private renderHub(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s, p = c.player, sc = c.school, L = this.hubLayout(v), land = v.landscape;
    const { x, w } = L.left;
    // the banner: your school's colours, your QB, the poll rank and record
    const fg = inkOn(sc.colors[0]), acc = accentOn(sc.colors);
    ctx.fillStyle = sc.colors[0]; ctx.fillRect(0, 0, v.w, L.banner);
    ctx.fillStyle = sc.colors[1]; ctx.fillRect(0, L.banner, v.w, 2);
    const bs = land ? 1 : 2, bw = BUST_W * bs + 4, bh = BUST_H * bs + 4;
    box(ctx, r(4, (L.banner - bh) / 2, bw, bh), shade(sc.colors[0], -0.45), sc.colors[1]);
    qbBust(ctx, 6, (L.banner - bh) / 2 + 2, sc.colors, bs);
    const rank = pollRank(s.poll, s.schoolId), st = standings(s.teams, s.games).get(s.schoolId)!;
    const tx = 4 + bw + 5, rankW = rank ? textWidth(`NO.${rank}`, 2) + 8 : 30;
    const nameScale = textWidth(sc.name, 2) <= v.w - tx - rankW - 4 ? 2 : 1;
    const state = STATES.find((q) => q.id === s.state)!.name;
    if (land) {
      drawText(ctx, sc.name, tx, nameScale === 2 ? 4 : 6, { scale: nameScale, color: fg, shadow: shade(sc.colors[0], -0.5) });
      drawText(ctx, `${sc.mascot} - ${state} - ${CLASS_NAMES[s.year]}`, tx, 17, { color: acc });
    } else {
      drawText(ctx, sc.name, tx, nameScale === 2 ? 6 : 8, { scale: nameScale, color: fg, shadow: shade(sc.colors[0], -0.5) });
      drawText(ctx, sc.mascot, tx, 19, { color: acc });
      drawText(ctx, `${state} - ${CLASS_NAMES[s.year]}`, tx, 29, { color: fg });
    }
    const rx = v.w - 5;
    if (rank) drawText(ctx, `NO.${rank}`, rx, land ? 3 : 6, { scale: 2, align: 'right', color: acc, shadow: shade(sc.colors[0], -0.5) });
    drawText(ctx, c.record().text, rx, land ? 17 : 19, { align: 'right', color: fg });
    if (!land) drawText(ctx, `${st.rw}-${st.rl} REG`, rx, 29, { align: 'right', color: fg });

    this.weekStrip(ctx, x, L.strip, w);
    this.nextGameCard(ctx, r(x, L.card.y, w, L.card.h));

    // you
    const Y = L.you.y;
    box(ctx, r(x, Y, w, L.you.h), C.navy, '#3b4a6b');
    drawText(ctx, `${p.first} ${p.last}`, x + 4, Y + 4);
    const backup = s.role === 'backup';
    drawText(ctx, backup ? `BACKUP - BEHIND ${s.starter?.name} (${s.starter?.ovr})` : ARCHETYPES.find((a) => a.id === p.archetype)!.name, x + 4, Y + 12, { color: C.grey });
    drawText(ctx, String(qbOvr(p)), x + w - 5, Y + 4, { scale: 2, align: 'right', color: C.yellow });
    drawText(ctx, 'OVR', x + w - 30, Y + 7, { align: 'right', color: C.grey });
    stars(ctx, x + 4, Y + 21, s.recruit.stars);
    if (s.recruit.stars < 5) meter(ctx, r(x + 42, Y + 22, 40, 4), toNextStar(s.recruit.score), C.yellow);
    const rk = c.rank();
    if (rk) drawText(ctx, rk.national > 999 ? 'NOT RANKED YET' : `NO.${rk.national} QB - NO.${rk.state} ${s.state}`, x + w - 4, Y + 21, { align: 'right', color: C.grey });
    if (backup) {
      drawText(ctx, 'QB BATTLE', x + 4, Y + 31, { color: C.grey });
      meter(ctx, r(x + 42, Y + 31, w - 66, 5), s.battle, s.battle >= 75 ? C.green : C.yellow);
      drawText(ctx, String(s.battle), x + w - 4, Y + 31, { align: 'right', color: C.yellow });
    } else drawText(ctx, `ACC ${p.r.acc}  ARM ${p.r.arm}  DEC ${p.r.dec}  SPD ${p.r.spd}`, x + 4, Y + 31, { color: C.darkGrey });

    this.ticker(ctx, L.ticker);

    // the buttons
    const rs = s.recruit, nOff = rs.offers.length;
    const tile = (rr: Rect, label: string, col: string, tag?: { text: string; fill: string; color: string }) => {
      button(ctx, rr, label, col);
      if (!tag) return;
      const tw = textWidth(tag.text) + 6, tr = r(rr.x + rr.w - tw - 2, rr.y - 4, tw, 9);
      box(ctx, tr, tag.fill, tag.fill === C.navy ? C.yellow : tag.fill);
      drawText(ctx, tag.text, tr.x + 3, tr.y + 2, { color: tag.color });
    };
    tile(L.schedule, 'SCHEDULE', C.white);
    tile(L.standings, c.isPlayoffs ? 'PLAYOFFS' : 'STANDINGS', C.white, rank ? { text: `NO.${rank}`, fill: C.navy, color: C.yellow } : undefined);
    tile(L.stats, 'STATS', C.white);
    tile(L.team, 'TEAM', C.blue);
    tile(L.recruiting, 'RECRUITING', C.yellow, rs.committed ? { text: college(rs.committed)!.abbr, fill: C.green, color: C.ink }
      : nOff ? { text: String(nOff), fill: C.red, color: C.white } : undefined);
    tile(L.gamePlan, 'GAME PLAN', C.grey);
    drawText(ctx, 'PRACTICE', L.focusX, L.focusY, { color: C.grey });
    stepper(ctx, L.focusL, L.focusR, FOCUSES.find((f) => f.id === s.focus)!.name, C.yellow);
    const g = c.nextGame, gd = L.gameDay;
    box(ctx, gd, g ? '#0b3d1d' : C.ink, g ? C.green : C.darkGrey);
    drawText(ctx, g ? 'GAME DAY' : 'NO GAME', gd.x + gd.w / 2, gd.y + 5, { scale: 2, align: 'center', color: g ? C.green : C.darkGrey });
    if (g) drawText(ctx, backup ? `${c.weekName} - ON THE BENCH` : `${c.weekName} - ${g.home === s.schoolId ? 'HOME' : 'AWAY'}`, gd.x + gd.w / 2, gd.y + gd.h - 9, { align: 'center', color: C.grey });
    button(ctx, L.menu, 'MENU', C.darkGrey);
    drawText(ctx, DIFFICULTIES.find((d) => d.id === c.difficulty)!.name, land ? L.menu.x + L.menu.w + 6 : v.w - 6, L.menu.y + 4, { align: land ? 'left' : 'right', color: c.difficulty === 'allpro' ? C.orange : C.darkGrey });
  }

  /** Your season at a glance: W / L for each week, this week lit, then the playoff rounds. */
  private weekStrip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
    const c = this.career!, s = c.s, me = s.schoolId;
    const mine = s.games.filter((g) => g.home === me || g.away === me);
    const reg = mine.filter((g) => !g.round).sort((a, b) => a.week - b.week);
    const pw = 14, cw = Math.min(14, Math.floor((w - 4 - PLAYOFF_ROUNDS.length * pw) / reg.length));
    const cell = (cx: number, cwid: number, label: string, kind: 'W' | 'L' | 'now' | 'next' | 'off') => {
      const rr = r(cx, y, cwid - 1, 11);
      const [fill, border, col] = kind === 'W' ? ['#0b3d1d', C.green, C.green] : kind === 'L' ? ['#4a0f1f', C.red, C.red]
        : kind === 'now' ? [C.yellow, C.yellow, C.ink] : kind === 'next' ? [C.ink, '#3b4a6b', C.darkGrey] : [C.ink, C.ink, '#3b4a6b'];
      box(ctx, rr, fill, border);
      drawText(ctx, label, rr.x + rr.w / 2 + 1, y + 3, { align: 'center', color: col });
    };
    const res = (g: GameRec) => (winnerOf(g) === me ? 'W' : 'L');
    let cx = x;
    for (const g of reg) {
      const now = !played(g) && g.week === s.week && s.phase === 'season';
      cell(cx, cw, played(g) ? res(g) : String(g.week), played(g) ? res(g) : now ? 'now' : 'next');
      if (c.isRival(g)) { ctx.fillStyle = C.orange; ctx.fillRect(cx, y + 12, cw - 1, 2); } // rivalry week
      cx += cw;
    }
    cx = x + w - PLAYOFF_ROUNDS.length * pw;
    const out = mine.some((g) => g.round && played(g) && winnerOf(g) !== me) || (s.week > reg.length && !mine.some((g) => g.round));
    for (const round of PLAYOFF_ROUNDS) {
      const g = mine.find((q) => q.round === round);
      cell(cx, pw, round, g ? (played(g) ? res(g) : 'now') : out ? 'off' : 'next');
      cx += pw;
    }
  }

  /** The next game: its storyline, both teams, any spotlight (a scout, the recruiting site, TV). */
  private nextGameCard(ctx: CanvasRenderingContext2D, rr: Rect): void {
    const c = this.career!, s = c.s, g = c.nextGame, sc = c.school;
    if (!g) {
      box(ctx, rr, C.navy, '#3b4a6b');
      drawText(ctx, 'SEASON OVER', rr.x + rr.w / 2, rr.y + 16, { align: 'center', color: C.grey, scale: 2 });
      drawText(ctx, c.finish(), rr.x + rr.w / 2, rr.y + 34, { align: 'center', color: C.yellow });
      return;
    }
    const key = `${s.year}:${s.week}:${s.log.length}`;
    if (this.storyCache?.key !== key) this.storyCache = { key, story: storyline({ rec: g, teams: s.teams, games: s.games, mySchool: s.schoolId, seed: s.seed, year: s.year, poll: s.poll }) };
    const rival = c.isRival(g);
    let story = rival ? `RIVALRY WEEK: ${c.trophy}` : this.storyCache.story;
    if (story && textWidth(story) > rr.w - 6 && story.includes(': ')) story = story.slice(story.indexOf(': ') + 2);
    const o = c.opponentOf(g), home = g.home === s.schoolId, mid = rr.x + rr.w / 2;
    const accent = rival ? C.orange : C.yellow;
    box(ctx, rr, rival ? '#3a1d1d' : C.navy, story ? accent : '#3b4a6b');
    ctx.fillStyle = story ? accent : '#3b4a6b'; ctx.fillRect(rr.x, rr.y, rr.w, 10);
    const head = story ?? `${c.weekName}${!g.round && o.region === sc.region && g.week > 3 ? ' - REGION GAME' : ''}`;
    drawText(ctx, head, mid, rr.y + 3, { align: 'center', color: story ? C.ink : C.white });
    const by = rr.y + 14, ow = badgeWidth(o.abbr, 2), mw = badgeWidth(sc.abbr, 2);
    badge(ctx, rr.x + 8, by, sc.abbr, sc.colors, 2);
    badge(ctx, rr.x + rr.w - 8 - ow, by, o.abbr, o.colors, 2);
    drawText(ctx, home ? 'VS' : 'AT', mid, by + 4, { scale: 2, align: 'center', color: C.grey });
    const tag = (id: number) => { const k = pollRank(s.poll, id); return `${k ? `NO.${k} ` : ''}${c.record(id).text}`; };
    drawText(ctx, tag(sc.id), rr.x + 8 + mw / 2, by + 21, { align: 'center', color: C.grey });
    drawText(ctx, tag(o.id), rr.x + rr.w - 8 - ow / 2, by + 21, { align: 'center', color: C.grey });
    const ev = c.eventText(g);
    if (ev) {
      const tw = textWidth(ev.tag) + 8, er = r(mid - tw / 2, by + 19, tw, 9);
      box(ctx, er, C.red, C.red);
      drawText(ctx, ev.tag, mid, er.y + 2, { align: 'center', color: C.white });
    }
    const ser = rival ? c.rivalSeries() : null;
    drawText(ctx, `${o.name} ${o.mascot}${ser && ser.w + ser.l ? `  -  SERIES ${ser.w}-${ser.l}` : ''}`, mid, rr.y + rr.h - 8, { align: 'center', color: rival ? C.orange : C.white });
  }

  /** The news ticker: headlines from around the state, scrolling. */
  private ticker(ctx: CanvasRenderingContext2D, rr: Rect): void {
    const c = this.career!, s = c.s;
    ctx.fillStyle = C.navy; ctx.fillRect(rr.x, rr.y, rr.w, rr.h);
    const lw = 30;
    ctx.fillStyle = C.red; ctx.fillRect(rr.x, rr.y, lw, rr.h);
    drawText(ctx, 'STATE', rr.x + lw / 2, rr.y + 3, { align: 'center' });
    const poll = s.poll ?? [];
    const items = s.headlines?.length ? s.headlines
      : [`PRESEASON POLL: ${poll.slice(0, 5).map((id, i) => `NO.${i + 1} ${c.team(id).name}`).join('  ')}`];
    const text = items.join('   -   ') + '   -   ';
    const tw = textWidth(text) + 4, x0 = rr.x + lw + 3, vw = rr.w - lw - 3;
    const off = Math.floor((performance.now() / 1000) * 16) % tw;
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, rr.y, vw, rr.h); ctx.clip();
    for (let k = 0; x0 - off + k * tw < x0 + vw; k++) drawText(ctx, text, x0 - off + k * tw, rr.y + 3);
    ctx.restore();
  }

  /** AWARDS NIGHT: the state's honors at the end of a season (before the yearbook). */
  private renderBanquet(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, p = c.player, sl = p.seasons[p.seasons.length - 1], b = sl.banquet!, land = v.landscape;
    ctx.fillStyle = '#16121f'; ctx.fillRect(0, 0, v.w, v.h);
    let y = this.title(ctx, v, 'AWARDS NIGHT');
    const state = STATES.find((q) => q.id === c.s.state)!.name;
    drawText(ctx, `${state} HIGH SCHOOL FOOTBALL - ${CLASS_NAMES[sl.year]} SEASON`, v.w / 2, y - (land ? 4 : 2), { align: 'center', color: C.grey });
    y += land ? 6 : 10;
    const colW = land ? v.w / 2 - 12 : v.w - 16, x = 8, bottom = this.bottomButton(v).y - 4;
    const card = (cx: number, cy: number, title: string, h: { name: string; pos: string; school: string; you: boolean; line?: string }, gold: boolean) => {
      box(ctx, r(cx, cy, colW, h.line ? 43 : 34), h.you ? '#2a2410' : C.navy, gold ? '#ffcc00' : '#3b4a6b');
      if (h.line) drawText(ctx, h.line, cx + colW / 2, cy + 35, { align: 'center', color: C.white });
      drawText(ctx, title, cx + colW / 2, cy + 4, { align: 'center', color: gold ? '#ffcc00' : C.grey });
      drawText(ctx, `${h.pos} ${h.name}`, cx + colW / 2, cy + 13, { align: 'center', scale: h.you && textWidth(`${h.pos} ${h.name}`, 2) < colW - 8 ? 2 : 1, color: h.you ? C.yellow : C.white });
      drawText(ctx, h.you ? `${h.school} - THAT'S YOU!` : h.school, cx + colW / 2, cy + 26, { align: 'center', color: h.you ? C.green : C.grey });
      return cy + (h.line ? 47 : 38);
    };
    const top = y;
    y = card(x, y, 'MR. FOOTBALL', b.mrFootball, true);
    pixelArt(ctx, x + 5, top + 7, STATUE, TROPHY_PAL, 2);
    y = card(x, y, 'ALL-STATE QUARTERBACK', b.allStateQb, false);
    let ox = x, oy = y + 2;
    if (land) { ox = v.w / 2 + 4; oy = top; }
    const list = (title: string, lines: string[], col: string) => {
      if (!lines.length || oy + 18 > bottom) return;
      drawText(ctx, title, ox + 2, oy, { color: C.yellow }); oy += 9;
      for (const t of lines) { if (oy + 8 > bottom) break; drawText(ctx, t, ox + 6, oy, { color: col }); oy += 8; }
      oy += 4;
    };
    const mine = p.awards.filter((a) => a.endsWith(`(${CLASS_SHORT[sl.year]})`)).map((a) => a.replace(/ \(..\)$/, ''));
    list('YOUR HONORS', mine.length ? mine : ['NONE THIS YEAR. NEXT YEAR.'], mine.length ? C.green : C.darkGrey);
    list('ALL-STATE TEAMMATES', b.teammates, C.white);
    if (b.coach) list('COACH OF THE YEAR', [`${b.coach} - ${c.school.name}`], C.white);
    if (b.allAmerican) {
      const a = b.allAmerican, won = a.us > a.them;
      list('ALL-AMERICAN BOWL', [`YOU PLAYED FOR THE ${a.team}`, a.line, `${a.team} ${won ? 'WINS' : 'LOSES'} ${Math.max(a.us, a.them)}-${Math.min(a.us, a.them)}${a.mvp ? ' - GAME MVP!' : ''}`], C.white);
    }
    button(ctx, this.bottomButton(v), 'YEARBOOK', C.green);
  }

  /** Signing day: the hats on the table, and the one you put on. */
  private renderCeremony(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s, p = c.player, sc = c.school, land = v.landscape;
    const signed = college(s.recruit.signed!)!;
    const others = s.recruit.offers.filter((id) => id !== signed.id).map((id) => college(id)!).sort((a, b) => b.prestige - a.prestige).slice(0, 2);
    const hats = [...others];
    hats.splice(Math.min(1, hats.length), 0, signed); // the pick sits in the middle (or first)
    const t = (performance.now() - this.ceremonyAt) / 1000;
    ctx.fillStyle = '#1b1530'; ctx.fillRect(0, 0, v.w, v.h);
    // the school gym: banners in your school's colours
    for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? sc.colors[0] : sc.colors[1]; ctx.fillRect(Math.round((v.w / 6) * i + 4), 0, Math.round(v.w / 6 - 8), land ? 8 : 14); }
    drawText(ctx, 'SIGNING DAY', v.w / 2, land ? 12 : 22, { scale: 2, align: 'center', color: C.yellow, shadow: C.navy });
    drawText(ctx, `${sc.name} HIGH SCHOOL GYM`, v.w / 2, land ? 25 : 37, { align: 'center', color: C.grey });
    const sc4 = land ? 3 : 4, kw = 11 * sc4, kx = v.w / 2 - kw / 2, ky = land ? 36 : 60;
    signee(ctx, kx, ky, sc.colors[0], sc4);
    const tableY = ky + 14 * sc4 - 4;
    ctx.fillStyle = '#7a3a26'; ctx.fillRect(v.w / 2 - 70, tableY, 140, 6);
    ctx.fillStyle = '#5a2a1c'; ctx.fillRect(v.w / 2 - 66, tableY + 6, 4, 14); ctx.fillRect(v.w / 2 + 62, tableY + 6, 4, 14);
    const hs = land ? 2 : 3, hw = CAP_W * hs, hh = CAP_H * hs;
    const lift = clamp((t - 1.6) / 0.9, 0, 1); // the pick rises to your head
    hats.forEach((h, i) => {
      const hx0 = v.w / 2 + (i - (hats.length - 1) / 2) * 46 - hw / 2, hy0 = tableY - hh;
      const pick = h.id === signed.id;
      const hx = pick ? lerp(hx0, v.w / 2 - hw / 2 + 2, lift) : hx0, hy = pick ? lerp(hy0, ky - hh + 3 * sc4, lift) : hy0;
      cap(ctx, hx, hy, h.colors, hs);
      if (!pick || lift < 1) drawText(ctx, h.abbr, hx0 + hw / 2, tableY + 9, { align: 'center', color: pick && lift > 0 ? C.darkGrey : C.white });
    });
    let y = tableY + 26;
    if (t < 1.6) drawText(ctx, 'THE DECISION...', v.w / 2, y, { align: 'center', color: C.grey });
    else if (lift >= 1) {
      drawText(ctx, `${p.first} ${p.last} SIGNS WITH`, v.w / 2, y, { align: 'center', color: C.white }); y += 10;
      const col = contrast(signed.colors[0], '#1b1530') >= 3 ? signed.colors[0] : signed.colors[1];
      drawText(ctx, signed.name, v.w / 2, y, { align: 'center', scale: textWidth(signed.name, 2) < v.w - 10 ? 2 : 1, color: col }); y += 13;
      drawText(ctx, `${signed.mascot} - ${signed.conference}`, v.w / 2, y, { align: 'center', color: C.grey });
      for (let i = 0; i < 40; i++) { // confetti in the school's colours
        const cxp = (i * 47.3 + t * 9) % v.w, cyp = ((i * 31.7 + (t - 2.5) * (30 + (i % 5) * 8)) % v.h + v.h) % v.h;
        ctx.fillStyle = i % 2 ? signed.colors[0] : signed.colors[1];
        ctx.fillRect(Math.round(cxp), Math.round(cyp), 2, 2);
      }
    }
    button(ctx, this.bottomButton(v), lift >= 1 ? 'CONTINUE' : 'SKIP', lift >= 1 ? C.green : C.grey);
  }

  /** GAME PLAN: how you play career games (the defense, who calls the plays). */
  private renderGamePlan(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s, L = this.gamePlanLayout(v);
    this.title(ctx, v, 'GAME PLAN');
    const opt = (rr: Rect, label: string, on: boolean) => {
      box(ctx, rr, on ? C.yellow : C.ink, on ? C.yellow : C.grey);
      drawText(ctx, label, rr.x + rr.w / 2, rr.y + 6, { align: 'center', color: on ? C.ink : C.grey });
    };
    const x = L.defPlay.x, w = L.defSim.x + L.defSim.w - x, chars = Math.floor(w / 4);
    drawText(ctx, 'DEFENSE', x, L.defY, { color: C.yellow });
    opt(L.defPlay, 'PLAY THE MIKE', s.defense === 'play'); opt(L.defSim, 'SIMULATED', s.defense === 'sim');
    let y = L.defY + L.descY;
    for (const t of wrap(s.defense === 'play' ? 'YOU PLAY MIDDLE LINEBACKER ON EVERY DEFENSIVE SNAP: DRAG TO TAKE OVER.' : 'THE OTHER TEAM\'S DRIVES ARE SIMULATED: YOU ONLY PLAY OFFENSE.', chars)) {
      drawText(ctx, t, x, y, { color: C.grey }); y += 8;
    }
    drawText(ctx, 'PLAY CALLING', x, L.callsY, { color: C.yellow });
    opt(L.callsCoach, 'COACH CALLS', s.calls !== 'you'); opt(L.callsYou, 'YOU CALL', s.calls === 'you');
    y = L.callsY + L.descY;
    for (const t of wrap(s.calls !== 'you' ? 'THE COACH CALLS EVERY PLAY, LIKE A REAL HIGH SCHOOL QB. TOUCH TO SNAP AND THROW.' : 'YOU PICK EVERY PLAY IN THE HUDDLE, ON OFFENSE AND DEFENSE.', chars)) {
      drawText(ctx, t, x, y, { color: C.grey }); y += 8;
    }
    drawText(ctx, 'DIFFICULTY', x, L.diffY, { color: C.yellow });
    stepper(ctx, L.diffL, L.diffR, DIFFICULTIES.find((d) => d.id === c.difficulty)!.name, c.difficulty === 'allpro' ? C.orange : c.difficulty === 'rookie' ? C.green : C.white);
    drawText(ctx, DIFF_NOTE[c.difficulty], x + w / 2, L.diffL.y + 20, { align: 'center', color: C.grey });
    if (!v.landscape) drawText(ctx, 'CHANGING IT RE-SCORES YOUR STARS NEXT GAME', x + w / 2, L.diffL.y + 29, { align: 'center', color: C.darkGrey });
    button(ctx, this.bottomButton(v), 'DONE', C.green);
  }

  private renderGameday(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, plan = this.plan!, m = plan.match, sc = c.school, o = plan.opp, s = c.s;
    const land = v.landscape, colW = land ? v.w / 2 - 8 : v.w - 8, x = 4, mid = x + colW / 2, chars = Math.floor(colW / 4) - 1;
    const y0 = this.title(ctx, v, plan.label, plan.kind === 'full' ? C.green : C.yellow);
    let y = y0;
    // the storyline: rivalry week, homecoming, a playoff round, TV
    const ev = plan.kind !== 'none' ? c.eventText(plan.rec) : null;
    const banner = plan.rival ? `RIVALRY WEEK: ${c.trophy}` : plan.story ?? (ev?.tag === 'ON TV' ? 'FRIDAY NIGHT LIVE' : null);
    if (banner) {
      const col = plan.rival ? C.orange : C.yellow;
      box(ctx, r(x, y - 2, colW, 12), plan.rival ? '#3a1d1d' : C.navy, col);
      drawText(ctx, banner, mid, y + 1, { align: 'center', color: col });
      y += 14;
    }
    if (plan.talk) { for (const t of wrap(plan.talk, chars)) { drawText(ctx, t, mid, y, { align: 'center', color: C.orange }); y += 8; } y += 2; }
    for (const t of wrap(plan.detail, chars)) { drawText(ctx, t, mid, y, { align: 'center', color: C.grey }); y += 9; }
    if (ev) for (const t of wrap(ev.text, chars)) { drawText(ctx, t, mid, y, { align: 'center', color: C.yellow }); y += 9; }
    y += land ? 4 : 8;
    // the matchup: badges, records, poll ranks
    const bw = badgeWidth(o.abbr, 2);
    badge(ctx, mid - 60, y, sc.abbr, sc.colors, 2);
    badge(ctx, mid + 60 - bw, y, o.abbr, o.colors, 2);
    const started = m.quarter > 1 || m.clock < m.quarterSeconds;
    drawText(ctx, started ? `${m.score.you} - ${m.score.cpu}` : 'VS', mid, y + 4, { scale: 2, align: 'center', color: started ? C.white : C.grey });
    y += 21;
    const tag = (id: number) => { const k = pollRank(s.poll, id); return `${k ? `NO.${k} ` : ''}${c.record(id).text}`; };
    drawText(ctx, sc.name, mid - 60 + badgeWidth(sc.abbr, 2) / 2, y, { align: 'center', color: C.white });
    drawText(ctx, o.name, mid + 60 - bw / 2, y, { align: 'center', color: C.white });
    y += 8;
    drawText(ctx, tag(sc.id), mid - 60 + badgeWidth(sc.abbr, 2) / 2, y, { align: 'center', color: C.grey });
    drawText(ctx, tag(o.id), mid + 60 - bw / 2, y, { align: 'center', color: C.grey });
    drawText(ctx, 'YOU', mid - 64, y - 23, { align: 'right', color: C.yellow });
    y += 11;
    drawText(ctx, started ? m.periodText : `${c.weekName} - ${plan.rec.home === s.schoolId ? 'HOME' : 'AWAY'}`, mid, y, { align: 'center', color: C.yellow });
    y += 9;
    if (!started) { drawText(ctx, weatherText(plan.weather), mid, y, { align: 'center', color: C.grey }); y += 9; }
    if (plan.rival) { const ser = c.rivalSeries(); if (ser.w + ser.l) { drawText(ctx, `SERIES ${ser.w}-${ser.l}`, mid, y, { align: 'center', color: C.orange }); y += 9; } }
    if (started) {
      drawText(ctx, `${m.offense === 'you' ? 'YOUR' : `${o.abbr}`} BALL - ${m.drive.downText} - ${m.offense === 'you' ? m.drive.spotText : m.drive.spotText.replace('OWN', 'THEIR').replace('OPP', 'YOUR')}`, mid, y, { align: 'center', color: C.grey });
      y += 10;
    }
    // players to watch and the coach's keys (the right column in landscape)
    let ox = x, oy = y + 6;
    if (land) { ox = v.w / 2 + 4; oy = y0; }
    const omid = ox + colW / 2;
    const mine = playersToWatch(c.rosterWithYou()), theirs = playersToWatch(plan.oppRoster);
    drawText(ctx, 'PLAYERS TO WATCH', omid, oy, { align: 'center', color: C.grey });
    oy += 10;
    for (const [ab, t, col] of [[sc.mascot, mine.qb, C.white], [o.mascot, theirs.qb, C.white], [sc.mascot, mine.def, C.grey], [o.mascot, theirs.def, C.grey]] as const) {
      drawText(ctx, ab, ox + 48, oy, { align: 'right', color: C.darkGrey });
      drawText(ctx, t, ox + 52, oy, { color: col });
      oy += 8;
    }
    if (plan.kind === 'full' || plan.keys.length) {
      oy += 5;
      drawText(ctx, "COACH'S KEYS", omid, oy, { align: 'center', color: C.grey });
      oy += 10;
      plan.keys.forEach((k, i) => { drawText(ctx, `${i + 1}. ${k.text}`, ox + 4, oy, { color: C.yellow }); oy += 8; });
    }
    oy += 5;
    const go = this.gamedayLayout(v).go;
    const tips = [
      c.s.calls === 'you' ? 'YOU CALL THE PLAYS IN THE HUDDLE.' : 'THE COACH CALLS THE PLAYS.',
      c.s.defense === 'play' ? 'ON DEFENSE YOU PLAY THE MIKE: DRAG TO TAKE OVER.' : 'THE OTHER TEAM\'S DRIVES ARE SIMULATED.',
    ];
    if (plan.endAtHalf) tips.push('YOUR STINT ENDS AT HALFTIME.');
    for (const t of tips) for (const l of wrap(t, chars)) {
      if (oy + 8 > go.y - 2) break;
      drawText(ctx, l, omid, oy, { align: 'center', color: C.darkGrey }); oy += 8;
    }
    button(ctx, go, plan.kind === 'full' ? 'KICKOFF' : 'TAKE THE FIELD', C.green);
  }


  private renderResult(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, l = this.lastLog!, o = c.team(l.opp), sc = c.school;
    const won = l.us > l.them, land = v.landscape;
    const colW = land ? v.w / 2 - 8 : v.w - 8, x = 4, mid = x + colW / 2, chars = Math.floor(colW / 4) - 1;
    const bottom = this.bottomButton(v).y - 3;
    const rule = (yy: number, xx = x) => { ctx.fillStyle = C.darkGrey; ctx.fillRect(xx, yy, colW, 1); };
    // the masthead
    let y = land ? 3 : 6;
    drawText(ctx, paperName(sc.name, sc.id), mid, y, { align: 'center' });
    y += 7; rule(y); y += 3;
    drawText(ctx, `${l.round ? ROUND_NAMES[l.round] : `WEEK ${l.week}`} - ${sc.name} ${l.home ? 'VS' : 'AT'} ${o.name}`, mid, y, { align: 'center', color: C.grey });
    y += 10;
    // the front page
    const playedIt = l.kind !== 'none' && l.grade !== null;
    let head = frontPage({ you: c.player.last, mascot: sc.mascot, oppMascot: o.mascot, us: l.us, them: l.them, ot: l.ot, played: playedIt, tds: l.line.tds, yards: l.line.yards });
    if (l.rival) { // rivalry week: who has the trophy now
      const before = c.player.seasons.length && c.s.phase === 'season' ? c.player.seasons[c.player.seasons.length - 1].rival : undefined;
      const sc2 = `${Math.max(l.us, l.them)}-${Math.min(l.us, l.them)}`;
      head = won ? `${sc.mascot} ${before === 'W' ? 'KEEP' : before === 'L' ? 'TAKE BACK' : 'WIN'} ${c.trophy}, ${sc2}` : `${o.mascot} TAKE ${c.trophy}, ${sc2}`;
    }
    for (const t of wrap(head, chars)) { drawText(ctx, t, mid, y, { align: 'center', color: C.yellow }); y += 8; }
    y += 3;
    drawText(ctx, `${l.us} - ${l.them}${l.ot ? ' OT' : ''}`, mid, y, { align: 'center', scale: 2, color: won ? C.green : C.red });
    const half = textWidth(`${l.us} - ${l.them}${l.ot ? ' OT' : ''}`, 2) / 2 + 6;
    drawText(ctx, sc.mascot, mid - half, y + 3, { align: 'right', color: C.white });
    drawText(ctx, o.mascot, mid + half, y + 3, { color: C.grey });
    y += 15;
    if (l.story) { drawText(ctx, l.story, mid, y, { align: 'center', color: C.grey }); y += 9; }
    if (l.kind === 'none') { drawText(ctx, `${l.label}: YOU DID NOT GET IN`, mid, y, { align: 'center', color: C.grey }); y += 10; }
    else {
      drawText(ctx, `${displayName(c.player)}: ${line(l.line)}`, mid, y, { align: 'center' });
      y += 9;
      if (l.grade !== null) { drawText(ctx, `GRADE ${letterGrade(l.grade)}`, mid, y, { align: 'center', color: gradeColor(l.grade), scale: 2 }); y += 15; }
    }
    if (l.battle !== null && this.battleBefore !== null) {
      const d = l.battle - this.battleBefore;
      drawText(ctx, `QB BATTLE ${this.battleBefore} -> ${l.battle} (${d >= 0 ? '+' : ''}${d})`, mid, y, { align: 'center', color: d >= 0 ? C.green : C.orange });
      y += 9;
      meter(ctx, r(mid - 50, y, 100, 5), l.battle, C.yellow);
      y += 8;
    }
    const gains = Object.entries(l.gains).filter(([, n]) => n).map(([k, n]) => `+${n} ${k.toUpperCase()}`);
    if (gains.length) { drawText(ctx, gains.join('  '), mid, y, { align: 'center', color: C.green }); y += 9; }
    const news = l.news.length > 3 ? [...l.news.slice(0, 2), `+${l.news.length - 2} MORE: SEE RECRUITING`] : l.news;
    for (const n of news) { drawText(ctx, n, mid, y, { align: 'center', color: n.startsWith('OFFER') ? C.green : C.yellow }); y += 9; }

    // the box score: your top target, the player of the game, the coach's keys (the right column in landscape)
    let ox = x, oy = y + 3;
    if (land) { ox = v.w / 2 + 4; oy = 4; }
    const omid = ox + colW / 2;
    if (l.target || l.potg || l.keys) {
      rule(oy, ox); oy += 4;
      if (l.target) {
        const t = l.target;
        drawText(ctx, `${t.pos} ${t.name}: ${t.rec} REC ${t.yds} YDS${t.td ? ` ${t.td} TD` : ''}`, omid, oy, { align: 'center' });
        oy += 9;
      }
      if (l.potg) { drawText(ctx, `PLAYER OF THE GAME: ${l.potg}`, omid, oy, { align: 'center', color: C.green }); oy += 9; }
      for (const k of l.keys ?? []) {
        drawText(ctx, k.ok ? 'MET' : 'MISSED', ox + 26, oy, { align: 'right', color: k.ok ? C.green : C.orange });
        drawText(ctx, k.text, ox + 30, oy, { color: C.grey });
        oy += 8;
      }
      oy += 2;
    }

    // around the state: the headlines, then the scores
    if (oy + 18 < bottom) {
      rule(oy, ox); oy += 4;
      drawText(ctx, 'AROUND THE STATE', omid, oy, { align: 'center', color: C.grey });
      oy += 10;
      for (const h of c.s.headlines ?? []) {
        const ls = wrap(h, chars);
        if (oy + ls.length * 8 > bottom) break;
        for (const t of ls) { drawText(ctx, t, ox + 2, oy, { color: C.white }); oy += 8; }
        oy += 2;
      }
      const others = c.s.games.filter((g) => g.week === l.week && played(g) && g.home !== c.s.schoolId && g.away !== c.s.schoolId);
      for (const g of others) {
        if (oy + 8 > bottom) break;
        const h = c.team(g.home), a = c.team(g.away), hw = g.hs! > g.as!;
        drawText(ctx, `${a.abbr} ${g.as}`, omid - 6, oy, { align: 'right', color: hw ? C.darkGrey : C.grey });
        drawText(ctx, `AT ${h.abbr} ${g.hs}${g.ot ? ' OT' : ''}`, omid + 2, oy, { color: hw ? C.grey : C.darkGrey });
        oy += 8;
      }
    }
    button(ctx, this.bottomButton(v), 'CONTINUE', C.green);
  }

  /** The state poll: the top 10 and how they moved this week. */
  private renderPoll(ctx: CanvasRenderingContext2D, v: View, top: number): void {
    const c = this.career!, s = c.s;
    const poll = s.poll ?? statePoll(s.teams, s.games), prev = s.pollPrev;
    const w = Math.min(v.w - 12, 200), x = (v.w - w) / 2, rowH = v.landscape ? 10 : 12;
    let y = top;
    const week = s.log.length ? s.log[s.log.length - 1] : null;
    drawText(ctx, week ? `STATE POLL AFTER ${week.round ? ROUND_NAMES[week.round] : `WEEK ${week.week}`}` : 'PRESEASON STATE POLL', v.w / 2, y, { align: 'center', color: C.yellow });
    y += rowH;
    poll.slice(0, 10).forEach((id, i) => {
      const t = c.team(id), mine = id === s.schoolId;
      if (mine) { ctx.fillStyle = C.navy; ctx.fillRect(x - 2, y - 2, w + 4, rowH - 1); }
      drawText(ctx, `${i + 1}`, x + 8, y, { align: 'right', color: C.grey });
      drawText(ctx, `${t.abbr} ${t.name}`, x + 14, y, { color: mine ? C.yellow : C.white });
      drawText(ctx, c.record(id).text, x + w - 24, y, { align: 'right', color: C.grey });
      if (prev) {
        const was = prev.indexOf(id) + 1, d = was - (i + 1);
        const [txt, col] = was > 10 ? ['NEW', C.yellow] : d > 0 ? [`+${d}`, C.green] : d < 0 ? [`${d}`, C.orange] : ['-', C.darkGrey];
        drawText(ctx, txt, x + w, y, { align: 'right', color: col });
      }
      y += rowH;
    });
    const mine = poll.indexOf(s.schoolId) + 1;
    y += 4;
    if (mine > 10) drawText(ctx, `${c.school.name}: NO.${mine} OF ${poll.length}`, v.w / 2, y, { align: 'center', color: C.grey });
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
      drawText(ctx, `${o.abbr} ${o.name}`, x + 30, y, { color: c.isRival(g) ? C.orange : o.region === c.school.region && !g.round && g.week > 3 ? C.white : C.grey });
      if (played(g)) {
        const us = home ? g.hs! : g.as!, them = home ? g.as! : g.hs!;
        drawText(ctx, `${us > them ? 'W' : 'L'} ${us}-${them}${g.ot ? ' OT' : ''}`, x + w, y, { align: 'right', color: us > them ? C.green : C.red });
      } else drawText(ctx, c.record(o.id).text, x + w, y, { align: 'right', color: C.darkGrey });
      y += rowH;
    }
    y += 4;
    drawText(ctx, `WHITE = REGION GAME  ORANGE = RIVAL (${c.trophy})`, v.w / 2, y, { align: 'center', color: C.darkGrey });
    button(ctx, this.bottomButton(v), 'BACK');
  }

  private renderStandings(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s, L = this.standingsLayout(v);
    if (!v.landscape) this.title(ctx, v, 'STANDINGS');
    const hasPO = s.games.some((g) => g.round);
    for (const [t, rect, label] of [['regions', L.tabR, 'REGIONS'], ['top10', L.tabT, 'TOP 10'], ['playoffs', L.tabP, 'PLAYOFFS']] as const) {
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
    } else if (this.standingsTab === 'top10') this.renderPoll(ctx, v, L.top);
    else {
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
    const L = this.standingsLayout(v);
    if (!v.landscape) this.title(ctx, v, 'STATS');
    for (const [t, rect, label] of [['you', L.tabR, 'YOU'], ['team', L.tabT, 'TEAM'], ['state', L.tabP, 'STATE']] as const) {
      const on = this.statsTab === t;
      box(ctx, rect, on ? C.yellow : C.ink, on ? C.yellow : C.grey);
      drawText(ctx, label, rect.x + rect.w / 2, rect.y + 4, { align: 'center', color: on ? C.ink : C.grey });
    }
    if (this.statsTab === 'team') this.renderTeamStats(ctx, v, L.top);
    else if (this.statsTab === 'state') this.renderStateStats(ctx, v, L.top);
    else this.renderMyStats(ctx, v, L.top);
    button(ctx, this.bottomButton(v), 'BACK');
  }

  /** TEAM: your teammates this season, receiving and defense. */
  private renderTeamStats(ctx: CanvasRenderingContext2D, v: View, top: number): void {
    const c = this.career!, t = c.teamTotals(), land = v.landscape;
    const colW = land ? (v.w - 24) / 2 : Math.min(v.w - 8, 200), bottom = this.bottomButton(v).y - 4;
    let x = land ? 8 : (v.w - colW) / 2, y = top;
    if (!t.rec.length && !t.def.length) { drawText(ctx, 'NO GAMES YET', v.w / 2, y + 10, { align: 'center', color: C.darkGrey }); return; }
    const head = (title: string, cols: string[]) => {
      drawText(ctx, title, x, y, { color: C.yellow });
      cols.forEach((h, i) => drawText(ctx, h, x + colW - (cols.length - 1 - i) * 26, y, { align: 'right', color: C.darkGrey }));
      y += 9;
    };
    const row = (name: string, vals: (string | number)[], hi: boolean) => {
      drawText(ctx, name, x, y, { color: hi ? C.white : C.grey });
      vals.forEach((n, i) => drawText(ctx, String(n), x + colW - (vals.length - 1 - i) * 26, y, { align: 'right', color: hi ? C.white : C.grey }));
      y += 8;
    };
    head('RECEIVING', ['REC', 'YDS', 'TD']);
    t.rec.slice(0, land ? 9 : 7).forEach((r, i) => row(`${r.pos} ${r.name}`, [r.rec, yds(r.yds), r.td], i === 0));
    if (land) { x = 16 + colW; y = top; } else y += 6;
    head('DEFENSE', ['TKL', 'SCK', 'INT']);
    for (const [i, d] of t.def.slice(0, land ? 9 : 8).entries()) { if (y + 8 > bottom) break; row(`${d.pos} ${d.name}`, [d.tkl, d.sacks, d.int], i === 0); }
  }

  /** STATE: the passing leaders and the best offenses and defenses. */
  private renderStateStats(ctx: CanvasRenderingContext2D, v: View, top: number): void {
    const c = this.career!, s = c.s, land = v.landscape, L = c.leaders();
    const colW = land ? (v.w - 24) / 2 : Math.min(v.w - 8, 200), bottom = this.bottomButton(v).y - 4;
    let x = land ? 8 : (v.w - colW) / 2, y = top;
    if (!L.length) { drawText(ctx, 'NO GAMES YET', v.w / 2, y + 10, { align: 'center', color: C.darkGrey }); return; }
    drawText(ctx, 'PASSING LEADERS', x, y, { color: C.yellow });
    drawText(ctx, 'YDS  TD', x + colW, y, { align: 'right', color: C.darkGrey });
    y += 9;
    L.slice(0, land ? 12 : 8).forEach((l, i) => {
      if (l.you) { ctx.fillStyle = C.navy; ctx.fillRect(x - 2, y - 2, colW + 4, 9); }
      const col = l.you ? C.yellow : C.white;
      drawText(ctx, `${i + 1}`, x + 6, y, { align: 'right', color: C.grey });
      drawText(ctx, `${l.name} ${c.team(l.school).abbr}`, x + 10, y, { color: col });
      drawText(ctx, yds(l.yds), x + colW - 18, y, { align: 'right', color: col });
      drawText(ctx, String(l.td), x + colW, y, { align: 'right', color: col });
      y += 9;
    });
    const mine = L.findIndex((l) => l.you);
    if (mine >= (land ? 12 : 8)) { drawText(ctx, `YOU: NO.${mine + 1} - ${yds(L[mine].yds)} YDS ${L[mine].td} TD`, x, y, { color: C.yellow }); y += 9; }
    if (land) { x = 16 + colW; y = top; } else y += 6;
    const st = standings(s.teams, s.games);
    const per = (id: number, k: 'pf' | 'pa') => { const t = st.get(id)!, gp = t.w + t.l + t.t; return gp ? t[k] / gp : 0; };
    const list = (title: string, k: 'pf' | 'pa', best: 1 | -1) => {
      if (y + 18 > bottom) return;
      drawText(ctx, title, x, y, { color: C.yellow }); y += 9;
      const ids = s.teams.map((t) => t.id).sort((a, b) => best * (per(b, k) - per(a, k)));
      for (const id of ids.slice(0, 5)) {
        if (y + 8 > bottom) break;
        const t = c.team(id), me = id === s.schoolId;
        drawText(ctx, `${t.abbr} ${t.name}`, x, y, { color: me ? C.yellow : C.white });
        drawText(ctx, per(id, k).toFixed(1), x + colW, y, { align: 'right', color: me ? C.yellow : C.grey });
        y += 8;
      }
      y += 4;
    };
    list('MOST POINTS A GAME', 'pf', 1);
    list('FEWEST ALLOWED', 'pa', -1);
  }

  /** YOU: your season, game log and career. */
  private renderMyStats(ctx: CanvasRenderingContext2D, v: View, top: number): void {
    const c = this.career!, s = c.s, p = c.player;
    let y = top;
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
      if (l.grade !== null) drawText(ctx, letterGrade(l.grade), x + w, y, { align: 'right', color: gradeColor(l.grade) });
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

  }

  private renderSummary(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s, p = c.player, sl = p.seasons[p.seasons.length - 1], sc = c.school, land = v.landscape;
    const onPaper = (col: string) => (contrastOk(col) ? col : PEN);
    const ink = onPaper(sc.colors[0]);
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, v.w, v.h);
    // the cover band
    const hh = land ? 24 : 26;
    ctx.fillStyle = sc.colors[0]; ctx.fillRect(0, 0, v.w, hh);
    ctx.fillStyle = sc.colors[1]; ctx.fillRect(0, hh, v.w, 2);
    drawText(ctx, 'YEARBOOK', v.w / 2, land ? 2 : 4, { scale: 2, align: 'center', color: accentOn(sc.colors), shadow: shade(sc.colors[0], -0.5) });
    drawText(ctx, `${sc.name} HIGH - ${CLASS_NAMES[sl.year]} YEAR`, v.w / 2, land ? 15 : 17, { align: 'center', color: inkOn(sc.colors[0]) });
    const colW = land ? v.w / 2 - 12 : v.w - 16, x = 8;
    // the photo
    let y = hh + 8;
    box(ctx, r(x, y, 52, 60), C.white, PEN);
    ctx.fillStyle = '#9fb7d8'; ctx.fillRect(x + 3, y + 3, 46, 46);
    qbBust(ctx, x + 9, y + 7, sc.colors, 3);
    drawText(ctx, displayName(p), x + 26, y + 52, { align: 'center', color: PEN });
    const ix = x + 58;
    drawText(ctx, `QB - NO.${jerseyNo(p)}`, ix, y + 2, { color: PEN });
    drawText(ctx, sl.gp ? `${sl.role}, ${sl.gp} GAME${sl.gp > 1 ? 'S' : ''}` : 'DID NOT PLAY', ix, y + 10, { color: FADED });
    stars(ctx, ix, y + 19, sl.stars);
    drawText(ctx, sl.record, ix, y + 29, { scale: 2, color: PEN });
    const awards = p.awards.filter((a) => a.endsWith(`(${CLASS_SHORT[sl.year]})`)).map((a) => a.replace(/ \(..\)$/, ''));
    if (awards.includes('REGION CHAMPION')) {
      const rx = ix + textWidth(sl.record, 2) + 4;
      drawText(ctx, 'REGION', rx, y + 29, { color: FADED }); drawText(ctx, 'CHAMPS', rx, y + 35, { color: FADED });
    }
    const fw = Math.min(colW - 58, 112), fr = r(ix, y + 45, fw, 13);
    box(ctx, fr, sc.colors[1], sc.colors[0]);
    drawText(ctx, sl.finish, fr.x + fr.w / 2, fr.y + 4, { align: 'center', color: inkOn(sc.colors[1]) });
    y += 68;
    const section = (title: string, sx: number, sy: number) => {
      ctx.fillStyle = PEN; ctx.fillRect(sx, sy, colW, 1);
      drawText(ctx, title, sx + colW / 2, sy + 4, { align: 'center', color: ink });
      return sy + 13;
    };
    // the season
    y = section('THE SEASON', x, y);
    const st = sl.stats, graded = s.log.filter((l) => l.grade !== null);
    const best = graded.length ? graded.reduce((a, b) => (b.grade! > a.grade! ? b : a)) : null;
    const rows: [string, string][] = sl.gp ? [
      ['PASSING', `${st.cmp}/${st.att}  ${num(st.yards)} YDS`],
      ['TOUCHDOWNS', `${st.tds} TD  ${st.int} INT`],
      ['RATING', `${passerRating(st).toFixed(1)}${sl.avg !== undefined ? `  GRADE ${letterGrade(sl.avg)}` : ''}`],
    ] : [['PASSING', 'DID NOT PLAY']];
    const tt = sl.team?.rec[0];
    if (tt) rows.push(['TOP TARGET', `${tt.pos} ${tt.name}`], ['', recText(tt)]);
    if (best) rows.push(['BEST GAME', `${best.round ? ROUND_NAMES[best.round] : `WK ${best.week}`} ${best.home ? 'VS' : 'AT'} ${c.team(best.opp).abbr}  ${letterGrade(best.grade!)}`]);
    for (const [a, b] of rows) { drawText(ctx, a, x + 2, y, { color: FADED }); drawText(ctx, b, x + colW - 2, y, { align: 'right', color: PEN }); y += 9; }
    // honors (the right column in landscape)
    let hx = x;
    if (land) { hx = v.w / 2 + 4; y = hh + 8; } else y += 4;
    y = section('HONORS', hx, y);
    const potg = s.log.filter((l) => l.potg?.endsWith('(QB)')).length;
    const honors = [...awards];
    if (sl.rival === 'W') honors.push(`RIVALRY WIN: ${rivalTrophy(s.seed)}`);
    if (potg) honors.push(`PLAYER OF THE GAME X${potg}`);
    if (!honors.length) honors.push(sl.year < HS_YEARS - 1 ? 'THE BEST IS YET TO COME' : 'FOUR QUARTERS, EVERY WEEK');
    const ribbon = [C.red, C.blue, '#2a8a3a', '#ffa300'];
    honors.slice(0, 4).forEach((h, i) => {
      ctx.fillStyle = ribbon[i % 4]; ctx.fillRect(hx + 4, y, 5, 7); ctx.fillRect(hx + 5, y + 7, 3, 2);
      drawText(ctx, h, hx + 14, y + 1, { color: PEN }); y += 11;
    });
    // teammates sign your yearbook
    y = section('SIGNED MY YEARBOOK', hx, y + 2) + 1;
    const coach = `COACH ${pickBy(sc.name, ['HOLT', 'RAMSEY', 'DUNN', 'BECKER', 'SALAS', 'PRUITT', 'OKAFOR', 'LANE'])}`;
    const committed = s.recruit.committed ? college(s.recruit.committed)!.abbr : null;
    const coachNote = sl.year === 0 ? (sl.role === 'BACKUP' ? 'YOUR TIME IS COMING. KEEP WORKING' : 'NOT BAD FOR A SOPHOMORE')
      : sl.year === 1 ? (sl.finish === 'STATE CHAMPIONS' ? 'NOW RUN IT BACK' : 'NEXT YEAR IS YOURS')
      : committed ? `PROUD OF YOU. GO GET EM AT ${committed}` : 'PROUD OF YOU, KID';
    const notes: { text: string; who: string }[] = (sl.signees ?? []).slice(0, land ? 2 : 2).map((t) => ({
      who: `${t.name} (${t.pos})`,
      text: pickBy(t.name, (['WR', 'TE', 'RB'].includes(t.pos)
        ? ['THANKS FOR ALL THE DIMES', 'KEEP SLINGING IT', 'BEST QB IN THE STATE', 'CATCH YOU ON SATURDAYS']
        : ['KEEP SLINGING IT', 'WE HAD YOUR BACK', 'BEST QB IN THE STATE', 'SEE YOU ON SATURDAYS'])) + `. ${t.school}!`,
    }));
    notes.push({ text: coachNote, who: coach });
    const pens = ['#2b59c3', '#c32b6b', '#2a8a3a'];
    const bottom = this.bottomButton(v).y - 3, chars = Math.floor((colW - 8) / 4);
    notes.forEach((n, i) => {
      const ls = wrap(n.text, chars);
      if (y + ls.length * 8 + 8 > bottom) return;
      for (const t of ls) { drawText(ctx, t, hx + 6, y, { color: pens[i % 3] }); y += 8; }
      drawText(ctx, `- ${n.who}`, hx + colW - 4, y, { align: 'right', color: FADED }); y += 11;
    });
    const b = this.bottomButton(v);
    box(ctx, b, PAPER, PEN);
    drawText(ctx, sl.year >= HS_YEARS - 1 ? 'SIGNING DAY' : 'OFF-SEASON', b.x + b.w / 2, b.y + 5, { align: 'center', color: PEN });
  }

  private renderDone(ctx: CanvasRenderingContext2D, v: View): void {
    const c = this.career!, s = c.s, p = c.player, land = v.landscape;
    ctx.fillStyle = CASE_BG; ctx.fillRect(0, 0, v.w, v.h);
    drawText(ctx, 'TROPHY CASE', v.w / 2, land ? 2 : 6, { scale: 2, align: 'center', color: C.yellow, shadow: C.navy });
    drawText(ctx, `${p.first} ${p.last} - ${c.school.name}`, v.w / 2, land ? 15 : 20, { align: 'center', color: C.grey });
    const colW = land ? v.w / 2 - 10 : v.w - 12, cx = 6;
    // the case: titles, plaques, medals, then game balls
    const cy = land ? 24 : 30, ch = land ? 128 : 150;
    box(ctx, r(cx, cy, colW, ch), '#2a2236', WOOD);
    const awards = p.awards.filter((a) => !a.startsWith('SIGNED'));
    const yearsOf = (name: string) => awards.filter((a) => a.startsWith(name)).map((a) => a.slice(-3, -1));
    const titles = yearsOf('STATE CHAMPION'), regions = yearsOf('REGION CHAMPION'), allState = yearsOf('ALL-STATE QB'), allRegion = yearsOf('ALL-REGION QB');
    const label = (ys: string[]) => (ys.length > 1 ? `X${ys.length}` : ys[0]);
    const mrFb = yearsOf('MR. FOOTBALL'), allAm = yearsOf('ALL-AMERICAN');
    const tds = p.seasons.reduce((t, sl) => t + sl.stats.tds, 0);
    const retired = mrFb.length > 0 || allAm.length > 0 || titles.length > 0 || tds >= 75; // your number goes on the wall
    const items: { art: string[] | null; top: string; sub: string }[] = [];
    if (retired) items.push({ art: null, top: `NO.${jerseyNo(p)}`, sub: 'RETIRED' });
    if (mrFb.length) items.push({ art: STATUE, top: 'MR FOOTBALL', sub: label(mrFb) });
    if (titles.length) items.push({ art: CUP, top: 'STATE', sub: `CHAMPS ${label(titles)}` });
    if (allAm.length) items.push({ art: MEDAL, top: 'ALL-AMER.', sub: label(allAm) });
    else if (allState.length) items.push({ art: MEDAL, top: 'ALL-STATE', sub: label(allState) });
    else if (allRegion.length) items.push({ art: MEDAL, top: 'ALL-REGION', sub: label(allRegion) });
    if (regions.length && items.length < 4) items.push({ art: PLAQUE, top: 'REGION', sub: label(regions) });
    items.splice(4);
    const s1 = cy + (land ? 50 : 62); // the first shelf
    if (items.length) items.forEach((it, i) => {
      const mx = cx + (colW * (i + 0.5)) / items.length;
      if (it.art) pixelArt(ctx, mx - (artW(it.art) * 3) / 2, s1 - 16 - it.art.length * 3, it.art, TROPHY_PAL, 3);
      else framedJersey(ctx, mx - 16, s1 - 52, c.school.colors, jerseyNo(p));
      drawText(ctx, it.top, mx, s1 - 14, { align: 'center', color: it.art === CUP || it.art === STATUE || !it.art ? C.yellow : C.grey });
      drawText(ctx, it.sub, mx, s1 - 7, { align: 'center', color: C.grey });
    });
    else drawText(ctx, 'ROOM FOR MORE HARDWARE', cx + colW / 2, s1 - 24, { align: 'center', color: C.darkGrey });
    ctx.fillStyle = WOOD; ctx.fillRect(cx, s1, colW, 5); ctx.fillStyle = WOOD_DARK; ctx.fillRect(cx, s1 + 5, colW, 1);
    drawText(ctx, 'GAME BALLS', cx + 6, s1 + 9, { color: C.grey });
    const balls = p.seasons.flatMap((sl) => (sl.balls ?? []).map((b) => ({ ...b, yr: CLASS_SHORT[sl.year] })))
      .sort((a, b) => b.grade - a.grade).slice(0, 4);
    const s2 = s1 + (land ? 50 : 56);
    if (balls.length) balls.forEach((b, i) => {
      const mx = cx + (colW * (i + 0.5)) / 4;
      pixelArt(ctx, mx - 15, s2 - 37, BALL, BALL_PAL, 3);
      drawText(ctx, `${letterGrade(b.grade)} ${b.yr}`, mx, s2 - 14, { align: 'center', color: C.green });
      drawText(ctx, b.label, mx, s2 - 7, { align: 'center', color: C.grey });
    });
    else drawText(ctx, 'EARN ONE WITH AN A GAME', cx + colW / 2, s2 - 24, { align: 'center', color: C.darkGrey });
    ctx.fillStyle = WOOD; ctx.fillRect(cx, s2, colW, 5); ctx.fillStyle = WOOD_DARK; ctx.fillRect(cx, s2 + 5, colW, 1);
    const rv = p.seasons.filter((sl) => sl.rival);
    if (rv.length) {
      const w = rv.filter((sl) => sl.rival === 'W').length, rid = rivalOf(s.teams, s.schoolId, s.seed);
      drawText(ctx, `${rivalTrophy(s.seed)}: ${w}-${rv.length - w} VS ${c.team(rid).name}`, cx + colW / 2, s2 + 9, { align: 'center', color: C.orange });
    }
    // career numbers and the letter of intent (the right column in landscape)
    let x = cx, y = cy + ch + 6;
    if (land) { x = v.w / 2 + 4; y = cy; }
    const tot = { plays: 0, yards: 0, tds: 0, cmp: 0, att: 0, int: 0, sacks: 0 } as TeamStats;
    let wins = 0;
    for (const sl of p.seasons) { for (const k of Object.keys(tot) as (keyof TeamStats)[]) tot[k] += sl.stats[k]; wins += +sl.record.split('-')[0]; }
    drawText(ctx, 'CAREER', x + 2, y, { color: C.yellow });
    y += 8;
    const tw = (colW - 9) / 4;
    ([[num(tot.yards), 'YARDS'], [String(tot.tds), 'TD'], [String(wins), 'WINS'], [tot.att ? passerRating(tot).toFixed(0) : '-', 'RATING']] as const).forEach(([a, b], i) => {
      const tr = r(x + i * (tw + 3), y, tw, 21);
      box(ctx, tr, C.navy, '#3b4a6b');
      drawText(ctx, a, tr.x + tr.w / 2, tr.y + 4, { align: 'center' });
      drawText(ctx, b, tr.x + tr.w / 2, tr.y + 12, { align: 'center', color: C.grey });
    });
    y += 27;
    const signed = s.recruit.signed ? college(s.recruit.signed) : null;
    if (signed) {
      const lr = r(x, y, colW, 60);
      box(ctx, lr, PAPER, '#ffcc00');
      const mid = lr.x + lr.w / 2;
      drawText(ctx, s.recruit.offers.includes(signed.id) ? 'NATIONAL LETTER OF INTENT' : 'PREFERRED WALK-ON', mid, lr.y + 5, { align: 'center', color: PEN });
      badge(ctx, mid - badgeWidth(signed.abbr, 2) / 2, lr.y + 14, signed.abbr, signed.colors, 2);
      drawText(ctx, `${signed.name} ${signed.mascot}`, mid, lr.y + 35, { align: 'center', color: contrastOk(signed.colors[0]) ? signed.colors[0] : PEN });
      drawText(ctx, `${signed.conference} - ${TIER_NAMES[signed.tier]}`, mid, lr.y + 43, { align: 'center', color: FADED });
      stars(ctx, mid - 17, lr.y + 51, s.recruit.stars);
    }
    const L = this.doneLayout(v);
    button(ctx, L.fresh, this.confirmNew ? 'SURE?' : 'NEW CAREER', this.confirmNew ? C.orange : C.white);
    button(ctx, L.menu, 'MENU', C.grey);
  }

  // ---------- recruiting ----------

  // Paging: < > at the bottom corners when a list has more schools than fit.
  pagerLayout(v: View) { return { prev: r(4, v.h - 20, 26, 16), next: r(v.w - 30, v.h - 20, 26, 16) }; }
  private pagerTap(p: Vec, v: View, pages: number): boolean {
    if (pages <= 1) return false;
    const L = this.pagerLayout(v);
    if (hit(L.prev, p)) { this.listPage = (this.listPage - 1 + pages) % pages; this.pick = null; return true; }
    if (hit(L.next, p)) { this.listPage = (this.listPage + 1) % pages; this.pick = null; return true; }
    return false;
  }
  private renderPager(ctx: CanvasRenderingContext2D, v: View, pages: number): void {
    if (pages <= 1) return;
    const L = this.pagerLayout(v);
    button(ctx, L.prev, '<', C.yellow);
    button(ctx, L.next, '>', C.yellow);
    drawText(ctx, `${Math.min(this.listPage, pages - 1) + 1}/${pages}`, v.w - 6, v.landscape ? 6 : 12, { align: 'right', color: C.yellow });
  }
  private page<T>(list: T[], per: number): T[] {
    const pages = Math.max(1, Math.ceil(list.length / per));
    const pg = Math.min(this.listPage, pages - 1);
    return list.slice(pg * per, pg * per + per);
  }

  private recruitPer(v: View): number { return v.landscape ? 10 : 12; }
  recruitPages(v: View): number { return Math.max(1, Math.ceil(board(this.career!.s.recruit, 999).length / this.recruitPer(v))); }
  /** The recruiting board's rows on this page (tap targets): offers first, then the schools most interested. */
  recruitRows(v: View): { c: College; r: Rect }[] {
    const rs = this.career!.s.recruit;
    const x = 4, w = v.landscape ? Math.floor(v.w * 0.6) - 8 : v.w - 8;
    const top = v.landscape ? 44 : 70, rowH = v.landscape ? 11 : 13;
    return this.page(board(rs, 999), this.recruitPer(v)).map((c, i) => ({ c, r: r(x, top + i * rowH, w, rowH - 1) }));
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

  /** The action bar for the picked school: VISIT, and COMMIT / DECOMMIT if it offered. */
  recruitActions(v: View): { visit: Rect; commit: Rect | null } | null {
    if (!this.pick || this.screen !== 'recruiting') return null;
    const rs = this.career!.s.recruit, offered = rs.offers.includes(this.pick);
    const x = v.landscape ? Math.floor(v.w * 0.6) + 2 : 4, w = v.landscape ? v.w - x - 4 : v.w - 8, y = v.h - 42, half = (w - 4) / 2;
    return { visit: r(x, y, offered ? half : w, 16), commit: offered ? r(x + half + 4, y, half, 16) : null };
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
    const left = MAX_VISITS - rs.visits.length;
    const status = rs.committed ? `COMMITTED: ${college(rs.committed)!.name}` : c.s.year === 0 ? 'OFFERS START IN YOUR JUNIOR YEAR'
      : `${rs.offers.length} OFFER${rs.offers.length === 1 ? '' : 'S'} - ${left} VISIT${left === 1 ? '' : 'S'} LEFT - TAP A SCHOOL`;
    drawText(ctx, status, x, y, { color: rs.committed ? C.green : C.grey });
    y += 10;
    const rk = c.rank();
    const rankText = !rk ? 'STARS MOVE WEEKLY: PLAY WELL AND WIN' : rk.national > 999 ? `${SITE_NAME}: UNRANKED QB` : `${SITE_NAME}: NO.${rk.national} QB NATIONALLY, NO.${rk.state} IN ${c.s.state}`;
    if (!v.landscape) drawText(ctx, rankText, x, y, { color: rk ? C.white : C.darkGrey });
    else drawText(ctx, rankText, Math.floor(v.w * 0.6) + 2, y0 + 10, { color: rk ? C.white : C.darkGrey });
    const rows = this.recruitRows(v);
    if (!rows.length) drawText(ctx, 'NO COLLEGES WATCHING YET', x, rows.length ? 0 : (v.landscape ? 44 : 70), { color: C.darkGrey });
    for (const { c: col, r: rr } of rows) {
      const offered = rs.offers.includes(col.id), committed = rs.committed === col.id, picked = this.pick === col.id;
      const tag = committed ? 'COMMITTED' : offered ? 'OFFER' : rs.visits.includes(col.id) ? 'VISITED' : undefined;
      this.collegeRow(ctx, col, rr, { interest: rs.interest[col.id] ?? 0, tag, tagColor: committed ? C.yellow : offered ? C.green : C.blue, picked });
    }
    // news
    const fx = v.landscape ? Math.floor(v.w * 0.6) + 2 : x;
    let fy = v.landscape ? y0 + 22 : 70 + 12 * 13 + 6;
    drawText(ctx, 'LATEST', fx, fy, { color: C.grey });
    fy += 9;
    const A = this.recruitActions(v);
    const maxN = A ? (v.landscape ? 8 : 3) : v.landscape ? 12 : 6; // room for the action bar and its message
    for (const n of c.s.recruitFeed.slice(0, maxN)) {
      drawText(ctx, n.length > (v.landscape ? 34 : 44) ? n.slice(0, v.landscape ? 34 : 44) : n, fx, fy, { color: n.startsWith('OFFER') || n.startsWith('COMMIT') ? C.green : C.white });
      fy += 8;
    }
    if (!c.s.recruitFeed.length) drawText(ctx, 'NOTHING YET', fx, fy, { color: C.darkGrey });
    if (A && this.pick) {
      const blocked = c.visitBlocked(this.pick);
      button(ctx, A.visit, `VISIT (${left} LEFT)`, blocked ? C.darkGrey : C.blue);
      if (A.commit) button(ctx, A.commit, rs.committed === this.pick ? 'DECOMMIT' : 'COMMIT', rs.committed === this.pick ? C.orange : C.green);
      const f = this.flash;
      if (f && performance.now() < f.until) drawText(ctx, f.text, A.visit.x, A.visit.y - 9, { color: f.color });
    }
    button(ctx, this.bottomButton(v), 'BACK');
    this.renderPager(ctx, v, this.recruitPages(v));
  }

  /** Signing day: your offers (committed school first, then the best programs), or walk-on spots if there are none. */
  private signingList(): College[] {
    const c = this.career!, rs = c.s.recruit;
    const list = rs.offers.length ? offerList(rs) : walkOns(rs, c.s.state);
    if (rs.committed) list.sort((a, b) => Number(b.id === rs.committed) - Number(a.id === rs.committed));
    return list;
  }
  private signingPer(v: View): number { return v.landscape ? 10 : 14; }
  signingPages(v: View): number { return Math.max(1, Math.ceil(this.signingList().length / this.signingPer(v))); }
  /** Signing day rows on this page (tap targets). */
  signingRows(v: View): { c: College; r: Rect }[] {
    const w = Math.min(v.w - 8, 240), x = (v.w - w) / 2;
    const top = v.landscape ? 44 : 78, rowH = v.landscape ? 11 : 14;
    return this.page(this.signingList(), this.signingPer(v)).map((col, i) => ({ c: col, r: r(x, top + i * rowH, w, rowH - 1) }));
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
    this.renderPager(ctx, v, this.signingPages(v));
  }
}
