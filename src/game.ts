// Ties everything together: a full game (Match), the huddle (calling plays on
// both sides of the ball), the clock between plays, timeouts, pause, input,
// aiming, the CPU quarterback when you're on defense, and drawing.
import { C, CX, FIELD_LEFT, FIELD_RIGHT, LOS_Y, PULL_POWER, RESULT_TIME, TIME_SCALE, W, YD, fx } from './config';
import { CpuQb, FG_MAX, callPlay, fgDistance, fourthDownCall } from './cpu';
import { type Call, beats, rushLabel } from './defense/calls';
import { drawText, textWidth } from './font';
import { type Units, simDrive } from './career/quicksim';
import { type TeamStats, rawFromSim } from './drive';
import { type Banner, Match, PLAY_CLOCK, type Side } from './match';
import { Menu, type MenuAction } from './menu';
import { PLAYS, type Play } from './playbook/plays';
import { DIFFICULTY_TUNING, SPEED_FACTOR, loadSettings, saveSettings } from './settings';
import { type Actor, HASH_YD, Sim, arcHeight, flightFor, throwSpread } from './sim';
import { type Facing, HD, type Pose, grassTile, hdBall, hdPlayer, identity } from './hd';
import { type Kit, shade } from './sprites';
import { type Vec, clamp, dist, lerp } from './util';
import { type Roster, loadRoster, makeRoster, saveRoster } from './ratings';
import { RosterView } from './roster';
import { PORTRAIT, type View } from './view';

export type AimMode = 'pull' | 'aim';
const SNAP_CATCH = 0.3; // sim seconds for the QB to catch the shotgun snap
const AIM_OFFSET = 10; // AIM mode: the landing spot sits this far above your finger (screen px)
const DEF_PRESNAP = 2.2; // seconds after you call your defense before the CPU snaps
const STICK_RANGE = 22; // joystick: drag this far (screen px) for full speed
const BETWEEN_RATE = 2.5; // game seconds that run off per real second between plays (clock running)
const USER_DEFENDER = 'MIKE';
/**
 * Simulated defense (career): how your defense fares on the other team's simulated drives
 * (bonus: rating points for your defense; runoff: seconds between their plays; formSd: how hot
 * or cold an opponent's offense runs from game to game). See scripts/balance/simdefense.cjs.
 */
export const SIM_DEF = { bonus: 4, runoff: 14, formSd: 4 };
type Rect = { x: number; y: number; w: number; h: number };
/** A standard normal random number. */
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random() * 0.999)) * Math.cos(Math.random() * Math.PI * 2);
const hit = (r: Rect, p: Vec) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;


type Screen = 'title' | 'huddle' | 'play' | 'banner' | 'final' | 'roster' | 'career';

/** A career game handed to the field: the match (maybe already in progress) and how to run it. */
export interface CareerGameSetup {
  match: Match;
  you: Roster; // your team, with your QB
  opp: Roster;
  units: Record<Side, Units>; // quick-sim strength (simulated opponent drives)
  simDefense: boolean; // simulate the other team's drives instead of playing the MIKE
  coachCalls: boolean; // the coach calls the plays; otherwise you call them in the huddle, as in an exhibition
  endAtHalf: boolean; // a two-minute drill: your stint ends at halftime
  label: string; // shown as you take the field
  kits?: Record<Side, Kit>; // the two schools' uniforms (otherwise blue vs red)
  form?: number; // simulated defense: the opponent offense's form this game (rating points), set when the game starts
  onDone: (m: Match, stint?: TeamStats) => void; // stint: your team's stats when your part ended early
}

/** The career screens (src/ui/career.ts) as the Game sees them. */
export interface Screens {
  tap(p: Vec, v: View): void;
  render(ctx: CanvasRenderingContext2D, v: View): void;
}

export class Game {
  settings = loadSettings();
  sim = new Sim();
  match = new Match('you');
  play: Play = PLAYS[0]; // your current offensive call
  flipped = false; // you flipped the play at the line (the strong side otherwise goes to the field)
  lastPlayId: string | null = null; // for SAME PLAY
  defCall: Call | null = null; // your defensive call (null = let the coordinator pick)
  lastCallId: string | null = null;
  menu: Menu | null = null; // the huddle, or settings from pause
  private huddleMenu: Menu | null = null; // remembered while settings are open
  mode: AimMode = this.settings.aim;
  team: Roster = loadRoster(); // your team (saved on this device)
  rosterView: RosterView | null = null; // the TEAM screen
  private rosterFrom: 'title' | 'pause' | 'career' = 'title';
  cpuTeam: Roster = makeRoster('CPU', DIFFICULTY_TUNING[this.settings.difficulty].strength);
  history: string[] = []; // your recent play calls: the defense notices repeats
  view: View = PORTRAIT;
  clock = 0;
  paused = false; // tests step the sim by hand
  pauseOpen = false; // the pause menu
  private confirmRestart = false;
  autoplay = false; // tests: the CPU brain plays your side too
  screen: Screen = 'title';
  banner: (Banner & { kind: 'play' | 'punt' | 'note' }) | null = null;
  private bannerAt = 0;
  toast: { text: string; color: string; until: number } | null = null;
  drag: { start: Vec; cur: Vec } | null = null; // offense: throw gesture (screen coordinates)
  stick: { origin: Vec; cur: Vec } | null = null; // defense: joystick (screen coordinates)
  cpuQb: CpuQb | null = null;
  private snapAt = 0;
  private queuedThrow: Vec | null = null; // released before the QB had the snap
  runoff = 0; // game seconds run off since the last play ended (the play clock)
  camY = 0; // how far (world px) the view has scrolled upfield to follow the ball
  careerGame: CareerGameSetup | null = null; // playing a career game (coach calls the plays)
  careerScreens: Screens | null = null; // the career hub and its screens (screen 'career')
  onCareer: (() => void) | null = null; // the title screen's CAREER button (set up in main.ts)
  /** Work that needs the finger to lift first (the clipboard needs a user activation): main.ts runs it on pointerup. */
  afterTap: (() => void) | null = null;
  confirmSim = false;

  // Field state captured for the coming snap, so the field doesn't jump while a banner is up.
  private fieldBallOn = 25;
  private lineToGain = 35;
  private attackingYours = false; // is the top end zone yours (CPU on offense)?

  constructor() { this.applySettings(); this.showTitle(); }

  /** The start screen: pick quarter length, difficulty, speed, aim mode; then KICKOFF. */
  showTitle(): void {
    this.screen = 'title';
    this.pauseOpen = false;
    this.menu = new Menu({ kind: 'offense', selectedId: null, settings: this.settings, title: true });
  }

  applySettings(): void {
    this.mode = this.settings.aim;
    this.sim.speedFactor = SPEED_FACTOR[this.settings.speed];
    saveSettings(this.settings);
  }

  /** How many of your last 8 calls were this play. */
  repeats(play: Play): number { return this.history.filter((id) => id === play.id).length; }

  get onOffense(): boolean { return this.match.offense === 'you'; }
  /** Kept for tests and older callers: the huddle menu is the "playbook". */
  get menuOpen(): boolean { return this.screen === 'huddle' || this.screen === 'title' || !!(this.menu && this.menu.showSettings); }

  setView(v: View): void {
    this.view = v; this.drag = null; this.stick = null;
    this.camY = Math.min(this.camY, this.camLimit());
    if (this.sim.phase === 'presnap' || this.screen !== 'play') this.camY = this.camBase();
  }

  /**
   * The camera never scrolls past the back of the end zone: near the goal line
   * the field shifts up so the end zone stays at the top of the screen.
   * This is the largest camY that keeps the end line at (or above) the top.
   */
  camLimit(): number {
    const v = this.view;
    const endLine = LOS_Y - (110 - this.fieldBallOn) * YD; // back of the end zone, world y
    const top = v.landscape ? 0 : 19; // below the portrait scoreboard
    return (top - v.oy) / v.s - endLine;
  }
  /** Where the camera rests before the snap: normally 0, shifted up in the red zone. */
  camBase(): number { return Math.min(0, this.camLimit()); }

  // world <-> screen
  sx = (x: number) => this.view.ox + x * this.view.s;
  sy = (y: number) => this.view.oy + (y + this.camY) * this.view.s;
  wx = (x: number) => (x - this.view.ox) / this.view.s;
  wy = (y: number) => (y - this.view.oy) / this.view.s - this.camY;

  get playsButton(): Rect {
    return this.view.landscape ? { x: 3, y: this.view.h - 16, w: this.view.panel - 6, h: 13 } : { x: 4, y: this.view.h - 16, w: 40, h: 12 };
  }
  get modeButton(): Rect {
    const v = this.view;
    return v.landscape ? { x: v.w - v.panel + 3, y: v.h - 16, w: v.panel - 6, h: 13 } : { x: v.w - 62, y: v.h - 16, w: 58, h: 12 };
  }
  get flipButton(): Rect {
    const v = this.view;
    return v.landscape ? { x: 3, y: v.h - 50, w: v.panel - 6, h: 13 } : { x: 4, y: v.h - 30, w: 40, h: 12 };
  }
  get pauseButton(): Rect {
    const v = this.view;
    return v.landscape ? { x: v.w - v.panel + 3, y: 3, w: v.panel - 6, h: 13 } : { x: v.w - 17, y: 2, w: 15, h: 15 };
  }
  /** Pause menu buttons. */
  get pauseButtons(): { resume: Rect; timeout: Rect; settings: Rect; team: Rect; restart: Rect; title: Rect } {
    const v = this.view, w = 96, x = Math.round(v.w / 2 - w / 2);
    const y0 = v.landscape ? 34 : 100, gap = v.landscape ? 19 : 26;
    const r = (i: number) => ({ x, y: y0 + i * gap, w, h: 16 });
    return { resume: r(0), timeout: r(1), settings: r(2), team: r(3), restart: r(4), title: r(5) };
  }

  private openRoster(from: 'title' | 'pause'): void {
    this.rosterFrom = from;
    this.rosterView = new RosterView(this.yourTeam, from === 'pause' ? this.cpuTeam : null, !this.careerGame);
    this.pauseOpen = false;
  }

  /** The TEAM screen for a career team (read-only). BACK returns to the career screens. */
  showRosterOf(team: Roster, opponent: Roster | null = null): void {
    this.rosterFrom = 'career';
    this.rosterView = new RosterView(team, opponent, false);
  }

  /** Your team on the field: the exhibition roster, or your career team. */
  get yourTeam(): Roster { return this.careerGame?.you ?? this.team; }

  /** Shows the career screens (hub etc.). */
  showCareer(screens: Screens): void {
    this.careerScreens = screens;
    this.careerGame = null;
    this.screen = 'career';
    this.menu = null;
    this.pauseOpen = false;
    this.banner = null;
  }

  /** Plays a career game: the coach calls the plays, you run them (and play the MIKE, unless the defense is simulated). */
  playCareerGame(setup: CareerGameSetup): void {
    this.careerGame = setup;
    setup.form ??= gauss() * SIM_DEF.formSd; // this week the other offense is hot, cold or in between
    this.match = setup.match;
    this.cpuTeam = setup.opp;
    this.history = [];
    this.lastPlayId = null;
    this.lastCallId = null;
    this.runoff = 0;
    this.pauseOpen = false;
    this.confirmSim = false;
    this.startHuddle();
    this.showToast(setup.label);
  }

  /** Your part of the career game is over: hand the match back. */
  private finishCareerGame(stint?: TeamStats): void {
    const cg = this.careerGame;
    if (!cg) return;
    this.careerGame = null;
    this.screen = 'career';
    this.menu = null;
    this.banner = null;
    this.pauseOpen = false;
    cg.onDone(this.match, stint);
  }

  newGame(): void {
    this.match = new Match('you', Number(this.settings.quarter) * 60);
    this.cpuTeam = makeRoster('CPU', DIFFICULTY_TUNING[this.settings.difficulty].strength); // a new opponent each game
    this.history = [];
    this.lastPlayId = null;
    this.lastCallId = null;
    this.runoff = 0;
    this.pauseOpen = false;
    this.startHuddle();
  }

  private situation(): string {
    const m = this.match, d = m.drive;
    const spot = this.onOffense ? d.spotText : flipSpot(d.spotText);
    return `${d.downText} - ${spot} - ${m.periodText}`;
  }

  private showToast(text: string, color: string = C.yellow): void {
    this.toast = { text, color, until: this.clock + 1.8 };
  }

  /** Between plays: call your play (offense) or your defense (defense). */
  startHuddle(): void {
    this.banner = null;
    this.queuedThrow = null;
    this.cpuQb = null;
    this.drag = null;
    this.stick = null;
    this.camY = 0;
    const m = this.match;
    if (m.over) { this.screen = 'final'; this.menu = null; return; }
    const cg = this.careerGame;
    if (cg?.endAtHalf && m.quarter >= 3) { this.finishCareerGame({ ...m.stats.you }); return; }
    const d = m.drive;
    this.fieldBallOn = d.ballOn;
    this.lineToGain = d.ballOn + d.toGo;
    this.attackingYours = !this.onOffense;
    this.camY = this.camBase();
    this.cpuTimeout();

    if (cg && !this.autoplay && this.careerHuddle(cg)) return;
    if (this.onOffense) {
      if (this.autoplay) {
        if (d.down === 4 && this.cpuFourthDown(m.score.you - m.score.cpu)) return;
        this.play = callPlay(d);
        this.setupSnap();
        return;
      }
      const fg = fgDistance(d.ballOn);
      this.menu = new Menu({
        kind: 'offense', selectedId: this.lastPlayId, settings: this.settings, subtitle: this.situation(),
        fourthDown: d.down === 4 && !m.ot && d.ballOn < 70, // no punting in their 30 (or in overtime)
        fieldGoal: d.down === 4 && m.ot < 3 && fg <= FG_MAX ? fg : null,
      });
    } else {
      if (d.down === 4 && this.cpuFourthDown(m.score.cpu - m.score.you)) return;
      if (this.autoplay) { this.defCall = null; this.setupSnap(); return; }
      this.menu = new Menu({ kind: 'defense', selectedId: this.lastCallId, settings: this.settings, subtitle: this.situation() });
    }
    this.screen = 'huddle';
  }

  /**
   * Career games: the coach calls the plays (and the defense), or the other team's drive is simulated.
   * Returns false when you call your own plays: the normal huddle takes over.
   */
  private careerHuddle(cg: CareerGameSetup): boolean {
    const m = this.match, d = m.drive;
    if (this.onOffense) {
      if (!cg.coachCalls) return false;
      if (d.down === 4 && this.cpuFourthDown(m.score.you - m.score.cpu)) return true;
      let play = callPlay(d);
      for (let i = 0; i < 3 && play.id === this.lastPlayId; i++) play = callPlay(d); // coach mixes it up
      this.play = play;
      this.flipped = false;
      this.lastPlayId = play.id;
      this.setupSnap();
      this.showToast(`COACH: ${play.name}`, C.white);
      return true;
    }
    if (cg.simDefense) {
      const before = m.score.cpu;
      // a simulated opponent drive: a run-heavy high school offense (the clock keeps running) against your
      // whole defense, so it scores at a football rate, not the arcade passing rate of a played drive
      const u = { you: { ...cg.units.you, def: cg.units.you.def + SIM_DEF.bonus }, cpu: { ...cg.units.cpu, off: cg.units.cpu.off + (cg.form ?? 0) } };
      const r = simDrive(m, u, { runoff: SIM_DEF.runoff });
      const name = m.names.cpu;
      const what = { td: 'TOUCHDOWN', fg: 'FIELD GOAL', fgmiss: 'MISSED FG', punt: 'PUNT', int: 'INTERCEPTED!', downs: 'STOPPED ON DOWNS', half: 'END OF HALF', end: 'END OF GAME' }[r.end];
      const good = r.end === 'int' || r.end === 'downs' || r.end === 'fgmiss';
      this.banner = {
        headline: `${name} DRIVE`, color: r.end === 'td' || r.end === 'fg' ? C.red : good ? C.green : C.grey,
        detail: `${what} - ${r.plays} PLAYS ${r.yards} YDS`,
        note: m.score.cpu > before ? `${name} +${m.score.cpu - before}` : m.over ? 'FINAL' : undefined, kind: 'note',
      };
      this.menu = null;
      this.screen = 'banner';
      this.bannerAt = this.clock;
      this.runoff = 0;
      return true;
    }
    if (!cg.coachCalls) return false;
    if (d.down === 4 && this.cpuFourthDown(m.score.cpu - m.score.you)) return true;
    this.defCall = null; // the coordinator's call; you play the MIKE
    this.setupSnap();
    return true;
  }

  /** Late in a half, a trailing CPU uses its timeouts to save the clock. */
  private cpuTimeout(): void {
    const m = this.match;
    const late = (m.quarter === 2 || m.quarter === 4) && m.clock < 120 && m.clockRunning;
    const trailing = m.quarter === 4 ? m.score.cpu < m.score.you : !this.onOffense; // before half: only to drive
    if (late && trailing && m.timeouts.cpu > 0 && m.timeout('cpu')) {
      this.showToast(`CPU TIMEOUT (${m.timeouts.cpu} LEFT)`, C.red);
    }
  }

  /** Lines everyone up for the snap with the calls made in the huddle. */
  private setupSnap(keepCall = false): void {
    const d = this.match.drive;
    this.menu = null;
    this.screen = 'play';
    // Plays point their strong side to the field (the wide side of a hash); FLIP mirrors that.
    const toField = d.ballX > 0.5;
    if (this.onOffense) {
      // The defense adapts: the more you lean on a play, the more it calls
      // coverages that beat it, and the quicker it jumps it.
      const reps = this.repeats(this.play);
      const vs = this.play.vs;
      this.sim.reset(this.play, d.goalY, {
        teams: { off: this.yourTeam, def: this.cpuTeam },
        cpuTeam: 'def', tuning: DIFFICULTY_TUNING[this.settings.difficulty],
        callBias: reps >= 2 ? (c) => (beats(vs, c) ? 1 / (1 + reps * 0.8) : 1) : undefined,
        recognition: clamp((reps - 1) / 4, 0, 1),
        ballX: d.ballX, mirror: toField !== this.flipped,
        call: keepCall ? this.sim.call : undefined,
      });
    } else {
      this.sim.reset(callPlay(d), d.goalY, {
        userDefender: USER_DEFENDER,
        teams: { off: this.cpuTeam, def: this.yourTeam },
        cpuTeam: 'off', tuning: DIFFICULTY_TUNING[this.settings.difficulty],
        call: this.defCall ?? undefined,
        ballX: d.ballX, mirror: toField !== (Math.random() < 0.2),
      });
      this.snapAt = this.clock + DEF_PRESNAP;
    }
  }

  /** 4th down decided by the CPU or your coach: punts or kicks (true), or goes for it (false). */
  private cpuFourthDown(lead: number): boolean {
    const m = this.match;
    const call = fourthDownCall(m.drive, lead, m.quarter, m.clock, m.ot);
    if (call === 'punt') { this.showPunt(); return true; }
    if (call === 'fg') { this.showFieldGoal(); return true; }
    return false;
  }

  /** A field goal try (simulated). */
  private showFieldGoal(): void {
    this.menu = null;
    this.banner = { ...this.match.fieldGoal(), kind: 'punt' };
    this.screen = 'banner';
    this.bannerAt = this.clock;
    this.runoff = 0;
  }

  private showPunt(): void {
    this.menu = null;
    this.banner = { ...this.match.punt(), kind: 'punt' };
    this.screen = 'banner';
    this.bannerAt = this.clock;
    this.runoff = 0;
  }

  /** Pick a play from code (tests) or the huddle. */
  pickPlay(play: Play): void {
    this.play = play;
    this.flipped = false;
    this.lastPlayId = play.id;
    if (this.onOffense && (this.screen === 'huddle' || (this.screen === 'play' && this.sim.phase === 'presnap'))) this.setupSnap();
  }

  private huddleAction(a: MenuAction): void {
    if (!a) return;
    switch (a.type) {
      case 'pick': this.pickPlay(a.play); break;
      case 'pickCall': this.defCall = a.call; this.lastCallId = a.call.id; this.setupSnap(); break;
      case 'auto': this.defCall = null; this.setupSnap(); break;
      case 'same':
        if (this.onOffense) { const p = PLAYS.find((x) => x.id === this.lastPlayId); if (p) this.pickPlay(p); }
        else this.setupSnap(); // keeps the last defensive call
        break;
      case 'punt': this.showPunt(); break;
      case 'fg': this.showFieldGoal(); break;
    }
  }

  // ---------- input ----------

  /** Where the ball would land (world coordinates) for the current drag, or null if the drag is too small. */
  target(): Vec | null {
    if (!this.drag) return null;
    const { start, cur } = this.drag;
    const qb = this.sim.qb;
    let t: Vec;
    if (this.mode === 'pull') {
      const dx = start.x - cur.x, dy = start.y - cur.y; // screen px; same feel in both orientations
      if (Math.hypot(dx, dy) < 5) return null;
      t = { x: qb.x + dx * PULL_POWER, y: qb.y + dy * PULL_POWER };
    } else {
      t = { x: this.wx(cur.x), y: this.wy(cur.y - AIM_OFFSET) }; // just above the finger
      if (dist(t, qb) < 12) return null;
    }
    const d = dist(t, qb);
    const max = this.sim.maxThrow; // your QB's arm
    if (d > max) {
      t.x = qb.x + ((t.x - qb.x) / d) * max;
      t.y = qb.y + ((t.y - qb.y) / d) * max;
    }
    t.x = clamp(t.x, FIELD_LEFT, FIELD_RIGHT);
    return t;
  }

  private canTimeout(): boolean {
    const live = this.sim.phase === 'live' || this.sim.phase === 'air' || this.sim.phase === 'run';
    return !(this.screen === 'play' && live) && this.screen !== 'final' && this.match.timeouts.you > 0;
  }

  pointerDown(p: Vec): void {
    if (this.screen === 'career' && this.careerScreens && !this.rosterView) { this.careerScreens.tap(p, this.view); return; }
    if (this.rosterView) { // the TEAM screen
      const a = this.rosterView.tap(p, this.view);
      if (a === 'new') { this.team = makeRoster('YOU'); saveRoster(this.team); this.rosterView.team = this.team; }
      if (a === 'back') { this.rosterView = null; if (this.rosterFrom === 'pause') this.pauseOpen = true; }
      return;
    }
    if (this.screen === 'title' && this.menu) {
      const a = this.menu.tap(p, this.view);
      if (a?.type === 'settings') this.applySettings();
      if (a?.type === 'team') this.openRoster('title');
      if (a?.type === 'start') { this.applySettings(); this.newGame(); }
      if (a?.type === 'career') { this.applySettings(); this.onCareer?.(); }
      return;
    }
    // settings opened from the pause menu
    if (this.menu?.showSettings) {
      const a = this.menu.tap(p, this.view);
      if (a?.type === 'settings') this.applySettings();
      if (a?.type === 'close') { this.menu = this.huddleMenu; this.huddleMenu = null; }
      return;
    }
    if (this.pauseOpen) { this.pauseTap(p); return; }
    if (this.screen !== 'final' && hit(this.pauseButton, p)) { this.pauseOpen = true; this.confirmRestart = false; return; }

    if (this.screen === 'huddle' && this.menu) { this.huddleAction(this.menu.tap(p, this.view)); return; }
    if (this.screen === 'final') { if (this.careerGame) this.finishCareerGame(); else this.newGame(); return; }
    if (this.screen === 'banner') { this.afterBanner(); return; }

    const phase = this.sim.phase;
    if (!this.onOffense) { this.stick = { origin: p, cur: p }; return; } // defense: joystick anywhere

    if (hit(this.modeButton, p)) { this.settings.aim = this.mode === 'pull' ? 'aim' : 'pull'; this.applySettings(); return; }
    if (hit(this.playsButton, p) && !this.careerGame?.coachCalls) { // back to the huddle to change the call
      if (phase === 'presnap') this.startHuddle();
      return;
    }
    if (phase === 'presnap' && hit(this.flipButton, p)) { this.flipped = !this.flipped; this.setupSnap(true); return; }
    // One touch does it all: the touch snaps the ball and starts the aim.
    if (phase === 'presnap') this.snap();
    if (this.sim.phase === 'live') this.drag = { start: p, cur: p };
  }

  private pauseTap(p: Vec): void {
    const b = this.pauseButtons;
    if (hit(b.resume, p)) this.pauseOpen = false;
    else if (hit(b.timeout, p) && this.canTimeout()) {
      this.match.timeout('you');
      this.runoff = 0;
      this.showToast(`TIMEOUT (${this.match.timeouts.you} LEFT)`, C.blue);
      this.pauseOpen = false;
    } else if (hit(b.settings, p)) {
      this.huddleMenu = this.menu;
      this.menu = new Menu({ kind: 'offense', selectedId: null, settings: this.settings, settingsOnly: true });
      this.pauseOpen = false;
    } else if (this.careerGame && hit(b.restart, p)) { // career: simulate the rest of the game
      if (this.confirmSim) this.simRestOfCareerGame();
      else this.confirmSim = true;
    } else if (hit(b.restart, p)) {
      if (this.confirmRestart) this.newGame();
      else this.confirmRestart = true;
    } else if (hit(b.title, p) && !this.careerGame) this.showTitle();
    else if (hit(b.team, p)) this.openRoster('pause');
  }

  pointerMove(p: Vec): void {
    if (this.drag) this.drag.cur = p;
    if (this.stick) this.stick.cur = p;
  }

  pointerUp(p: Vec): void {
    this.stick = null;
    if (!this.drag) return;
    this.drag.cur = p;
    const to = this.target();
    this.drag = null;
    if (!to) return;
    if (this.sim.t < SNAP_CATCH) this.queuedThrow = to; // goes out as soon as he has the ball
    else this.sim.throwTo(to);
  }

  private snap(): void {
    this.sim.snap();
    this.runoff = 0;
    if (this.onOffense) this.history = [...this.history, this.play.id].slice(-8);
    if (!this.onOffense) this.cpuQb = new CpuQb(this.sim, DIFFICULTY_TUNING[this.settings.difficulty].qbPicky);
    else if (this.autoplay) this.cpuQb = new CpuQb(this.sim);
  }

  /** Career: leave the field; the rest of the game is simulated. */
  simRestOfCareerGame(): void {
    const cg = this.careerGame;
    if (!cg) return;
    const stint = { ...this.match.stats.you };
    this.finishCareerGame(stint);
  }

  private afterBanner(): void {
    if (this.match.over) { this.screen = 'final'; this.banner = null; return; }
    this.startHuddle();
  }

  // ---------- loop ----------

  update(dt: number): void {
    this.clock += dt;
    if (this.paused || this.pauseOpen || this.rosterView || (this.screen !== 'title' && this.menu?.showSettings)) return;
    if (this.screen === 'final' || this.screen === 'title' || this.screen === 'career') return;
    const sim = this.sim;

    // Between plays the clock keeps running (if it's running), up to the play clock.
    const between = this.screen === 'huddle' || this.screen === 'banner' || (this.screen === 'play' && sim.phase === 'presnap');
    if (between && this.match.clockRunning && this.runoff < PLAY_CLOCK) {
      const step = Math.min(dt * BETWEEN_RATE, PLAY_CLOCK - this.runoff);
      this.runoff += step;
      const ev = this.match.tickBetween(step);
      if (ev === 'warning') this.showToast('TWO-MINUTE WARNING');
      if (ev === 'quarter') this.quarterEndedBetweenPlays();
    }

    if (this.screen === 'banner') {
      if (this.clock - this.bannerAt > RESULT_TIME) this.afterBanner();
      return;
    }
    if (this.screen !== 'play') return;

    if (sim.phase === 'presnap') {
      if (!this.onOffense && this.clock >= this.snapAt) this.snap();
      if (this.onOffense && this.autoplay) this.snap();
    }

    // your linebacker follows the joystick
    if (this.stick) {
      const dx = this.stick.cur.x - this.stick.origin.x, dy = this.stick.cur.y - this.stick.origin.y;
      const len = Math.hypot(dx, dy);
      const mag = len < 3 ? 0 : Math.min(1, len / STICK_RANGE);
      sim.userMove = len ? { x: (dx / len) * mag, y: (dy / len) * mag } : { x: 0, y: 0 };
    } else sim.userMove = { x: 0, y: 0 };
    sim.userControl = !!this.stick; // let go and he plays his assignment

    const wasDone = sim.phase === 'done';
    sim.update(dt);
    if (this.cpuQb && sim.phase === 'live') {
      const to = this.cpuQb.update(sim);
      if (to) sim.throwTo(to);
    }
    if (this.queuedThrow && sim.t >= SNAP_CATCH) { sim.throwTo(this.queuedThrow); this.queuedThrow = null; }
    if (sim.phase !== 'live') { this.drag = null; this.queuedThrow = null; } // sacked mid-drag
    if (!wasDone && sim.phase === 'done') {
      const q = this.match.quarter;
      const offenseBefore = this.match.offense;
      const spot = this.spotAfter(sim);
      const b = this.match.afterPlay(rawFromSim(sim), sim.t / TIME_SCALE);
      // next snap: where the play ended (on the hash if it ended outside it); the middle after a change of possession,
      // except an interception or turnover on downs, spotted from the other side's view
      const halftime = q === 2 && this.match.quarter === 3;
      if (!halftime && !this.match.ot) { // (overtime possessions start in the middle)
        if (this.match.offense === offenseBefore) this.match.drive.ballX = spot;
        else if (sim.result === 'int' || b.headline === 'TURNOVER ON DOWNS') this.match.drive.ballX = -spot; // their view is flipped
        // (after a touchdown the new drive starts in the middle)
      }
      if (this.match.over) b.note = 'FINAL';
      else if (this.match.quarter !== q) b.note = this.match.ot ? 'TIED: OVERTIME!' : q === 2 ? 'HALFTIME' : `END OF Q${q}`;
      this.banner = { ...b, kind: 'play' };
      this.screen = 'banner';
      this.bannerAt = this.clock;
      this.runoff = 0;
    }

    // camera follows the ball upfield: the runner, or a deep ball in the air
    let focus: number | null = null;
    if (sim.carrier) focus = sim.carrier.y;
    else if (sim.phase === 'air' && sim.ball) focus = sim.ballGround().y - sim.ballHeight();
    if (focus !== null) {
      const want = Math.min(Math.max(this.camY, this.view.camAnchor - focus, this.camBase()), this.camLimit());
      this.camY = lerp(this.camY, want, Math.min(1, dt * 6));
    }
  }

  /** Where (across the field) the next snap goes after this play: the hash rule. */
  private spotAfter(sim: Sim): number {
    let px: number | null = null;
    if (sim.result === 'catch' || sim.result === 'int') px = sim.ball?.carrier?.x ?? null;
    else if (sim.result === 'sack') px = sim.qb.x;
    if (px === null) return this.match.drive.ballX; // incomplete: same spot
    const x = (px - CX) / YD;
    return Math.abs(x) > HASH_YD ? Math.sign(x) * HASH_YD : Math.round(x * 10) / 10;
  }

  /** The clock ran out while you were huddling: end of the quarter (or half, or game). */
  private quarterEndedBetweenPlays(): void {
    const m = this.match;
    const q = m.over ? 4 : m.quarter - 1;
    const headline = m.over ? 'FINAL' : m.ot ? 'OVERTIME' : q === 2 ? 'HALFTIME' : `END OF Q${q}`;
    this.menu = null;
    this.banner = { headline, color: C.yellow, detail: `${m.names.you} ${m.score.you} - ${m.names.cpu} ${m.score.cpu}`, kind: 'note' };
    if (m.ot) this.banner.note = `EACH TEAM GETS IT AT THE 25 - ${m.offense === 'you' ? 'YOU GO' : `${m.names.cpu} GOES`} FIRST`;
    this.screen = 'banner';
    this.bannerAt = this.clock;
    this.runoff = 0;
  }

  // ---------- drawing ----------

  render(ctx: CanvasRenderingContext2D): void {
    if (this.rosterView) { this.rosterView.render(ctx, this.view); return; }
    if (this.screen === 'career' && this.careerScreens) { this.careerScreens.render(ctx, this.view); return; }
    if (this.screen === 'title' && this.menu) {
      drawField(ctx, this, 36, 200, false); // a field behind the title (between the end zones)
      this.menu.render(ctx, this.view);
      return;
    }
    if (this.screen === 'huddle' && this.menu) {
      this.menu.render(ctx, this.view);
      this.renderPauseButton(ctx);
      this.renderToast(ctx);
      if (this.pauseOpen) this.renderPause(ctx);
      return;
    }
    drawField(ctx, this, this.fieldBallOn, this.lineToGain, this.attackingYours);
    if (this.screen === 'play' || this.banner?.kind === 'play') {
      if (this.onOffense || this.screen === 'banner') this.renderRoutes(ctx);
      this.renderPlayers(ctx);
      this.renderEyes(ctx);
      this.renderOffscreen(ctx);
      this.renderAim(ctx);
      this.renderBall(ctx);
    }
    this.renderHud(ctx);
    this.renderStick(ctx);
    this.renderToast(ctx);
    if (this.screen === 'final') this.renderFinal(ctx);
    if (this.pauseOpen) this.renderPause(ctx);
    if (this.menu?.showSettings) this.menu.render(ctx, this.view);
  }

  private renderPauseButton(ctx: CanvasRenderingContext2D): void {
    const b = this.pauseButton;
    if (this.view.landscape) { button(ctx, b, 'PAUSE', C.white); return; }
    ctx.fillStyle = 'rgba(17,29,43,0.9)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = C.white;
    ctx.fillRect(b.x + 4, b.y + 4, 2, 7); // "II"
    ctx.fillRect(b.x + 9, b.y + 4, 2, 7);
  }

  private renderToast(ctx: CanvasRenderingContext2D): void {
    const t = this.toast;
    if (!t || this.clock > t.until) return;
    const v = this.view, mid = v.landscape ? v.w / 2 : W / 2, y = v.landscape ? 16 : 34;
    const tw = textWidth(t.text) + 10;
    ctx.fillStyle = 'rgba(17,29,43,0.92)';
    ctx.fillRect(Math.round(mid - tw / 2), y - 3, tw, 11);
    drawText(ctx, t.text, mid, y, { align: 'center', color: t.color });
  }

  private renderPause(ctx: CanvasRenderingContext2D): void {
    const v = this.view, m = this.match;
    ctx.fillStyle = 'rgba(17,29,43,0.93)';
    ctx.fillRect(0, 0, v.w, v.h);
    drawText(ctx, 'PAUSED', v.w / 2, v.landscape ? 10 : 60, { scale: 2, color: C.yellow, align: 'center' });
    drawText(ctx, `${m.names.you} ${m.score.you} - ${m.names.cpu} ${m.score.cpu}   ${m.periodText}`, v.w / 2, v.landscape ? 26 : 80, { align: 'center', color: C.grey });
    const b = this.pauseButtons;
    button(ctx, b.resume, 'RESUME', C.green);
    button(ctx, b.timeout, `TIMEOUT (${m.timeouts.you} LEFT)`, this.canTimeout() ? C.white : C.darkGrey);
    button(ctx, b.settings, 'SETTINGS', C.white);
    button(ctx, b.team, 'TEAM', C.blue);
    if (this.careerGame) {
      button(ctx, b.restart, this.confirmSim ? 'TAP AGAIN TO SIM' : 'SIM REST OF GAME', this.confirmSim ? C.orange : C.white);
    } else {
      button(ctx, b.restart, this.confirmRestart ? 'TAP AGAIN TO RESTART' : 'RESTART GAME', this.confirmRestart ? C.orange : C.white);
      button(ctx, b.title, 'MAIN MENU', C.white);
    }
  }

  /** Per-player animation: where he was last frame, how fast he's moving, how far through his stride. */
  private anim = new WeakMap<Actor, { x: number; y: number; t: number; vx: number; vy: number; stride: number; side: boolean }>();
  /** Screen spot of the ball carrier's (or the QB's) ball hand this frame: the ball is drawn there. */
  private ballHand: Vec | null = null;

  private poseFor(p: Actor, speed: number): Pose {
    const sim = this.sim;
    if (sim.phase === 'presnap') return p.kind === 'ol' || p.kind === 'dl' ? 'stance' : 'stand';
    if (sim.phase === 'done') {
      const tackled = sim.result === 'sack' ? sim.qb : sim.result === 'catch' && !sim.touchdown && !sim.outOfBounds ? sim.carrier : null;
      if (p === tackled) return 'down';
      return speed > 8 ? 'run' : 'stand';
    }
    if (p === sim.qb) {
      if (sim.phase === 'air' && sim.airT < 0.3) return 'throw'; // follow-through
      if (sim.phase === 'live') return this.cpuQb?.windup && !this.onOffense ? 'throw' : speed > 8 ? 'carry' : 'hold';
    }
    if (sim.phase === 'run' && p === sim.carrier) return 'carry';
    if (sim.phase === 'air' && sim.ball) { // hands up as the ball arrives
      const left = sim.ball.dur - sim.ball.t;
      if (left < 0.45 && dist(p, sim.ball.to) < 9 * YD && (p === sim.intended || p.team === 'def')) return 'catch';
    }
    if (p.engaged || p.engagedBy || p.heldBy || (p.job === 'block' && speed < 20)) return 'block';
    return speed > 8 ? 'run' : 'stand';
  }

  private renderPlayers(ctx: CanvasRenderingContext2D): void {
    const kits = this.careerGame?.kits;
    const offColor = kits ? (this.attackingYours ? kits.cpu : kits.you) : this.attackingYours ? 'red' : 'blue';
    const defColor = kits ? (this.attackingYours ? kits.you : kits.cpu) : this.attackingYours ? 'blue' : 'red';
    const s = this.view.s;
    this.ballHand = null;
    for (const p of [...this.sim.actors].sort((a, b) => a.y - b.y)) {
      const build = p.kind === 'qb' ? 'qb' : p.kind === 'ol' || p.kind === 'dl' ? 'big' : 'skill';
      // movement since the last frame drives the run cycle, the lean and which way he faces
      let a = this.anim.get(p);
      if (!a) { a = { x: p.x, y: p.y, t: this.clock, vx: 0, vy: 0, stride: Math.random() * 4, side: false }; this.anim.set(p, a); }
      const dt = this.clock - a.t;
      if (dt > 0) {
        const k = Math.min(1, dt * 12);
        a.vx += ((p.x - a.x) / dt - a.vx) * k;
        a.vy += ((p.y - a.y) / dt - a.vy) * k;
        a.stride += Math.hypot(p.x - a.x, p.y - a.y) / (1.1 * YD); // a frame every ~1.1 yards
        a.x = p.x; a.y = p.y; a.t = this.clock;
      }
      const speed = Math.hypot(a.vx, a.vy);
      const pose = this.poseFor(p, speed);
      // running across the field: the side view (with a little hysteresis so he doesn't flicker on diagonals)
      const moving = pose === 'run' || pose === 'carry' || pose === 'catch';
      const ax = Math.abs(a.vx), ay = Math.abs(a.vy);
      if (!moving || speed < 12) a.side = false;
      else if (ax > ay * 1.3) a.side = true;
      else if (ay > ax * 0.9) a.side = false;
      let facing: Facing = p.team === 'off' ? 'up' : 'down';
      if (a.side) facing = a.vx > 0 ? 'right' : 'left';
      else if (pose === 'run' && speed > 12 && ay > ax * 0.7) facing = a.vy < 0 ? 'up' : 'down'; // turned to run
      const lean = !a.side && (pose === 'run' || pose === 'carry') ? (a.vx > 14 && ax > ay * 0.6 ? 1 : a.vx < -14 && ax > ay * 0.6 ? -1 : 0) : 0;
      const id = identity(p.pl?.name ?? p.id, p.kind);
      const { img, hand } = hdPlayer({ team: p.team === 'off' ? offColor : defColor, build, facing, pose, frame: Math.floor(a.stride) & 3, lean, num: id.num, skin: id.skin });
      const x = this.sx(p.x), y = this.sy(p.y);
      const w = (img.width / HD) * s, h = (img.height / HD) * s;
      const px = Math.round((x - w / 2) * HD) / HD, py = Math.round((y - h / 2 - 1) * HD) / HD;
      // shadow under his feet
      ctx.fillStyle = p.user ? 'rgba(255,236,39,0.55)' : 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(Math.round(x * HD) / HD, py + h - 1 / HD * 2, w * 0.42, 1.1 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(img, px, py, w, h);
      const sim = this.sim;
      if (hand && (p === sim.ball?.carrier || (p === sim.qb && !sim.ball))) this.ballHand = { x: px + ((hand.x + 0.5) / HD) * s, y: py + ((hand.y + 0.5) / HD) * s };
      if (p.user) { // a little marker over your linebacker
        const mx = Math.round(x), my = Math.round(py - 4);
        ctx.fillStyle = C.yellow;
        ctx.fillRect(mx - 2, my, 5, 1);
        ctx.fillRect(mx - 1, my + 1, 3, 1);
        ctx.fillRect(mx, my + 2, 1, 1);
      }
    }
  }

  /** Defense: where the CPU quarterback is looking. Turns orange when he's about to throw. */
  private renderEyes(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    const qb = this.cpuQb;
    if (this.onOffense || !qb?.eyes || sim.phase !== 'live') return;
    const qx = this.sx(sim.qb.x), qy = this.sy(sim.qb.y);
    const ux = Math.cos(qb.eyeAngle), uy = Math.sin(qb.eyeAngle);
    const len = 26;
    ctx.fillStyle = qb.windup ? C.orange : C.yellow;
    for (let i = 5; i < len; i += qb.windup ? 1 : 2) ctx.fillRect(Math.round(qx + ux * i), Math.round(qy + uy * i), 1, 1);
    const tx = qx + ux * len, ty = qy + uy * len;
    for (const side of [-1, 1]) {
      for (let k = 1; k <= 3; k++) {
        ctx.fillRect(Math.round(tx - ux * k + -uy * side * k), Math.round(ty - uy * k + ux * side * k), 1, 1);
      }
    }
  }

  /** Little arrows at the top edge for receivers who have run off the screen. */
  private renderOffscreen(ctx: CanvasRenderingContext2D): void {
    const top = this.view.landscape ? 0 : 20;
    for (const r of this.sim.receivers) {
      if (this.sy(r.y) >= top) continue;
      const x = Math.round(this.sx(r.x));
      ctx.fillStyle = this.onOffense ? r.color : C.red;
      ctx.fillRect(x, top + 1, 1, 1);
      ctx.fillRect(x - 1, top + 2, 3, 1);
      ctx.fillRect(x - 2, top + 3, 5, 1);
    }
  }

  /** Faint route lines for your plays: strong before the snap, a light reminder after. */
  private renderRoutes(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    if (sim.phase === 'done' || sim.phase === 'run') return;
    ctx.globalAlpha = sim.phase === 'presnap' ? 0.55 : 0.18;
    for (const r of sim.receivers) {
      ctx.fillStyle = r.color;
      let prev: Vec = r; // from where he is now through the rest of the route
      for (const q of r.path.slice(r.leg)) {
        const n = Math.max(1, Math.floor((dist(prev, q) * this.view.s) / 3));
        for (let i = 0; i <= n; i++) {
          const x = prev.x + ((q.x - prev.x) * i) / n, y = prev.y + ((q.y - prev.y) * i) / n;
          ctx.fillRect(Math.round(this.sx(x)), Math.round(this.sy(y)), 1, 1);
        }
        prev = q;
      }
    }
    ctx.globalAlpha = 1;
  }

  private renderAim(ctx: CanvasRenderingContext2D): void {
    const to = this.target();
    if (!to || !this.drag) return;
    const s = this.view.s;
    if (this.mode === 'pull') {
      const { start, cur } = this.drag;
      const n = Math.max(1, Math.floor(dist(start, cur) / 3));
      ctx.fillStyle = 'rgba(255,241,232,0.35)';
      for (let i = 0; i <= n; i++) {
        ctx.fillRect(Math.round(start.x + ((cur.x - start.x) * i) / n), Math.round(start.y + ((cur.y - start.y) * i) / n), 1, 1);
      }
    }
    const qb = this.sim.qb;
    const from = { x: qb.x, y: qb.y - 3 };
    const { peak } = flightFor(from, to);
    const steps = Math.max(6, Math.floor((dist(from, to) * s) / 6));
    const march = (this.clock * 2) % 1;
    for (let i = 0; i < steps; i++) {
      const f = (i + march) / steps;
      const gx = this.sx(from.x + (to.x - from.x) * f), gy = this.sy(from.y + (to.y - from.y) * f);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(Math.round(gx), Math.round(gy), 1, 1);
      ctx.fillStyle = C.white;
      ctx.fillRect(Math.round(gx), Math.round(gy - arcHeight(peak, f) * s), 2, 2);
    }
    // Landing oval: the ball will come down somewhere inside it. It stretches
    // along the throw line with distance and grows under pressure (orange).
    const pressured = this.sim.pressured;
    const sp = throwSpread(dist(from, to), pressured);
    const k = this.sim.movingFactor * this.sim.accFactor; // throwing on the run spreads it; accuracy tightens it
    const along = sp.along * s * k, lat = sp.lat * s * k;
    const u = { x: (to.x - from.x) / (dist(from, to) || 1), y: (to.y - from.y) / (dist(from, to) || 1) };
    const x = Math.round(this.sx(to.x)), y = Math.round(this.sy(to.y));
    ctx.fillStyle = pressured ? C.orange : C.yellow;
    const n = Math.max(14, Math.round((along + lat) * 2.5));
    for (let i = 0; i < n; i += 2) { // dotted outline
      const t = (i / n) * Math.PI * 2;
      const a = Math.cos(t) * along, b = Math.sin(t) * lat;
      ctx.fillRect(Math.round(x + u.x * a - u.y * b), Math.round(y + u.y * a + u.x * b), 1, 1);
    }
    ctx.fillRect(x - 1, y, 3, 1); // aim point
    ctx.fillRect(x, y - 1, 1, 3);
    if (along > 6) { // faint fill so the big ovals read as an area
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      ctx.ellipse(x, y, along, lat, Math.atan2(u.y, u.x), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private renderBall(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim, s = this.view.s;
    const draw = (img: HTMLCanvasElement, x: number, y: number) => {
      const bw = (img.width / HD) * s, bh = (img.height / HD) * s;
      ctx.drawImage(img, Math.round((x - bw / 2) * HD) / HD, Math.round((y - bh / 2) * HD) / HD, bw, bh);
    };
    // in someone's hands: the one ball, drawn at his ball hand (sprites have no ball of their own)
    if (!sim.ball || sim.ball.carrier) {
      if (this.ballHand) draw(hdBall(0), this.ballHand.x, this.ballHand.y);
      return;
    }
    const g = sim.ballGround();
    const h = sim.ballHeight() * s;
    const x = this.sx(g.x), y = this.sy(g.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(Math.round(x - 1), Math.round(y), 3, 1);
    draw(hdBall(Math.floor(sim.airT * 14)), x, y - h);
  }

  /** Defense: the joystick under your thumb. */
  private renderStick(ctx: CanvasRenderingContext2D): void {
    if (!this.stick || this.onOffense) return;
    const { origin: o, cur } = this.stick;
    ctx.fillStyle = 'rgba(255,241,232,0.45)';
    for (let i = 0; i < 24; i += 2) {
      const a = (i / 24) * Math.PI * 2;
      ctx.fillRect(Math.round(o.x + Math.cos(a) * STICK_RANGE), Math.round(o.y + Math.sin(a) * STICK_RANGE), 1, 1);
    }
    const dx = cur.x - o.x, dy = cur.y - o.y, len = Math.hypot(dx, dy) || 1;
    const k = Math.min(len, STICK_RANGE) / len;
    ctx.fillStyle = 'rgba(255,236,39,0.8)';
    ctx.fillRect(Math.round(o.x + dx * k) - 2, Math.round(o.y + dy * k) - 2, 5, 5);
  }

  /** Your assignment in the defensive call, shown before the snap. */
  private assignment(): string {
    const u = this.sim.user;
    if (!u) return '';
    if (u.job === 'rush') return 'BLITZ!';
    if (u.job === 'man' && u.man) return `MAN ON ${u.man.id === 'RB' ? 'THE RB' : u.man.kind === 'te' ? 'THE TE' : `#${u.man.id}`}`;
    if (u.job === 'zone' && u.zone) return `${u.zone.name} ZONE`;
    return '';
  }

  private renderHud(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim;
    const v = this.view;
    const m = this.match;
    const d = m.drive;
    const offense = this.onOffense;
    const showDown = this.screen === 'play';
    const fieldMid = v.landscape ? v.w / 2 : W / 2;
    const live = sim.phase === 'live' || sim.phase === 'air' || sim.phase === 'run';
    const q = m.over ? (m.ot ? 'FINAL OT' : 'FINAL') : m.periodText;
    const playClock = m.clockRunning && this.screen !== 'final' ? Math.max(0, Math.ceil(PLAY_CLOCK - this.runoff)) : null;
    const pips = (x: number, y: number, n: number, color: string) => {
      for (let i = 0; i < 3; i++) { ctx.fillStyle = i < n ? color : C.darkGrey; ctx.fillRect(x + i * 4, y, 3, 2); }
    };

    if (v.landscape) {
      ctx.fillStyle = C.ink;
      ctx.fillRect(0, 0, v.panel, v.h);
      ctx.fillRect(v.w - v.panel, 0, v.panel, v.h);
      const lx = 3;
      drawText(ctx, `${m.names.you} ${m.score.you}`, lx, 5, { color: C.blue });
      pips(lx + 30, 7, m.timeouts.you, C.blue);
      drawText(ctx, `${m.names.cpu} ${m.score.cpu}`, lx, 13, { color: C.red });
      pips(lx + 30, 15, m.timeouts.cpu, C.red);
      drawText(ctx, q, lx, 23);
      if (playClock !== null) drawText(ctx, `PLAY CLK ${playClock}`, lx, 31, { color: playClock <= 5 ? C.orange : C.grey });
      drawText(ctx, offense ? 'OFFENSE' : 'DEFENSE', lx, 41, { color: offense ? C.blue : C.red });
      if (showDown) {
        drawText(ctx, d.downText, lx, 49, { color: C.yellow });
        drawText(ctx, offense ? d.spotText : flipSpot(d.spotText), lx, 57);
      }
      if (offense) {
        drawText(ctx, 'PLAY', lx, v.h - 34, { color: C.grey });
        drawText(ctx, this.play.name, lx, v.h - 26, { color: C.yellow });
        button(ctx, this.playsButton, this.careerGame?.coachCalls ? 'COACH' : 'PLAYS', live || this.careerGame?.coachCalls ? C.darkGrey : C.white);
        if (sim.phase === 'presnap') button(ctx, this.flipButton, this.flipped ? 'FLIPPED' : 'FLIP', this.flipped ? C.yellow : C.white);
        drawText(ctx, 'MODE', v.w - v.panel / 2, v.h - 26, { align: 'center', color: C.grey });
        button(ctx, this.modeButton, this.mode.toUpperCase(), C.white);
      } else {
        drawText(ctx, 'YOU: MIKE', lx, v.h - 34, { color: C.yellow });
        drawText(ctx, 'DRAG TO', v.w - v.panel + 3, v.h - 26, { color: C.grey });
        drawText(ctx, 'TAKE OVER', v.w - v.panel + 3, v.h - 18, { color: C.grey });
      }
    } else {
      ctx.fillStyle = 'rgba(17,29,43,0.9)';
      ctx.fillRect(0, 0, v.w, 19);
      drawText(ctx, `${m.names.you} ${m.score.you}`, 5, 3, { color: C.blue });
      pips(5, 9, m.timeouts.you, C.blue);
      drawText(ctx, `${m.names.cpu} ${m.score.cpu}`, 45, 3, { color: C.red });
      pips(45, 9, m.timeouts.cpu, C.red);
      drawText(ctx, q, v.w - 21, 3, { align: 'right' });
      if (playClock !== null) drawText(ctx, `:${String(playClock).padStart(2, '0')}`, v.w - 21, 11, { align: 'right', color: playClock <= 5 ? C.orange : C.grey });
      if (showDown) {
        drawText(ctx, d.downText, 85, 3, { color: C.yellow });
        drawText(ctx, offense ? d.spotText : flipSpot(d.spotText), 85, 11);
      }
      if (offense) {
        button(ctx, this.playsButton, this.careerGame?.coachCalls ? 'COACH' : 'PLAYS', live || this.careerGame?.coachCalls ? C.darkGrey : C.white);
        if (sim.phase === 'presnap') button(ctx, this.flipButton, this.flipped ? 'FLIPPED' : 'FLIP', this.flipped ? C.yellow : C.white);
        button(ctx, this.modeButton, `MODE ${this.mode.toUpperCase()}`, C.white);
        drawText(ctx, this.play.name, (this.playsButton.x + this.playsButton.w + this.modeButton.x) / 2, v.h - 12,
          { align: 'center', color: C.yellow, shadow: '#000' });
      } else {
        drawText(ctx, 'YOU: MIKE LB - DRAG TO TAKE OVER', v.w / 2, v.h - 12, { align: 'center', color: C.yellow, shadow: '#000' });
      }
    }
    if (this.screen !== 'final') this.renderPauseButton(ctx);

    // pre-snap prompts
    if (this.screen === 'play' && sim.phase === 'presnap') {
      const y = v.landscape ? 4 : this.sy(LOS_Y) + 40;
      if (offense) {
        if (Math.floor(this.clock * 2.5) % 2 === 0) drawText(ctx, 'TOUCH TO SNAP + THROW', fieldMid, y, { align: 'center', color: C.white, shadow: '#000' });
        if (this.repeats(this.play) >= 3) {
          drawText(ctx, "THEY'VE SEEN THIS PLAY", fieldMid, y + 9, { align: 'center', color: C.orange, shadow: '#000' });
        }
      } else {
        const ty = v.landscape ? 4 : 24;
        drawText(ctx, `${sim.call.name} - YOU: ${this.assignment()}`, fieldMid, ty, { align: 'center', color: C.yellow, shadow: '#000' });
      }
    }

    const b = this.banner;
    if (this.screen === 'banner' && b) {
      const y = v.landscape ? 40 : 96;
      const bw = v.landscape ? v.w - v.panel * 2 - 20 : v.w - 20;
      const lines = 1 + (b.kind === 'play' ? 1 : 0) + (b.note ? 1 : 0);
      ctx.fillStyle = 'rgba(17,29,43,0.9)';
      ctx.fillRect(Math.round(fieldMid - bw / 2), y - 6, bw, 28 + lines * 10);
      drawText(ctx, b.headline, fieldMid, y, { scale: 2, color: b.color, shadow: '#000', align: 'center' });
      drawText(ctx, b.detail, fieldMid, y + 16, { align: 'center', color: C.white });
      let ly = y + 26;
      if (b.note) { drawText(ctx, b.note, fieldMid, ly, { align: 'center', color: C.yellow }); ly += 10; }
      if (b.kind === 'play') {
        drawText(ctx, `${sim.call.name} - ${rushLabel(sim.call)}`, fieldMid, ly, { align: 'center', color: C.grey });
      }
    }
  }

  private renderFinal(ctx: CanvasRenderingContext2D): void {
    const v = this.view;
    const m = this.match;
    ctx.fillStyle = 'rgba(17,29,43,0.95)';
    ctx.fillRect(0, 0, v.w, v.h);
    const mid = v.w / 2;
    let y = v.landscape ? 14 : 70;
    drawText(ctx, m.ot ? `FINAL - ${m.periodText}` : 'FINAL', mid, y, { scale: 2, color: C.yellow, align: 'center' });
    y += 18;
    drawText(ctx, `${m.names.you} ${m.score.you}  -  ${m.names.cpu} ${m.score.cpu}`, mid, y, { scale: 2, align: 'center' });
    y += 18;
    const res = m.score.you > m.score.cpu ? ['YOU WIN!', C.green] : m.score.you < m.score.cpu ? [`${m.names.cpu} WINS`, C.red]
      : [this.careerGame ? 'TIED - OVERTIME' : 'TIE GAME', C.grey];
    drawText(ctx, res[0], mid, y, { align: 'center', color: res[1] });
    y += 16;
    for (const side of ['you', 'cpu'] as const) {
      const st = m.stats[side];
      const ypp = st.plays ? (st.yards / st.plays).toFixed(1) : '0.0';
      const ppt = st.tds ? (st.plays / st.tds).toFixed(1) : '-';
      drawText(ctx, side === 'you' ? 'YOUR OFFENSE' : `${m.names.cpu} OFFENSE`, mid, y, { align: 'center', color: side === 'you' ? C.blue : C.red });
      drawText(ctx, `${st.cmp}/${st.att}  ${st.yards} YDS  ${st.tds} TD  ${st.int} INT`, mid, y + 8, { align: 'center' });
      drawText(ctx, `YDS/PLAY ${ypp}  PLAYS/TD ${ppt}  SACKS ${st.sacks}`, mid, y + 16, { align: 'center', color: C.grey });
      y += 28;
    }
    if (Math.floor(this.clock * 2) % 2 === 0) drawText(ctx, this.careerGame ? 'TAP TO CONTINUE' : 'TAP FOR A NEW GAME', mid, y + 4, { align: 'center', color: C.yellow });
  }
}

/** The drive's spot text is from the offense's side; flip it for the CPU's drives. */
function flipSpot(t: string): string {
  return t.startsWith('OWN') ? t.replace('OWN', 'CPU') : t.startsWith('OPP') ? t.replace('OPP', 'YOUR') : t;
}

function button(ctx: CanvasRenderingContext2D, b: Rect, label: string, color: string): void {
  ctx.fillStyle = 'rgba(17,29,43,0.8)';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = color;
  ctx.fillRect(b.x, b.y, b.w, 1); ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
  ctx.fillRect(b.x, b.y, 1, b.h); ctx.fillRect(b.x + b.w - 1, b.y, 1, b.h);
  drawText(ctx, label, b.x + b.w / 2, b.y + Math.floor((b.h - 5) / 2), { align: 'center', color });
}

/**
 * Draws the visible part of a real 100-yard field. ballOn is the line of
 * scrimmage (yards from the offense's goal line), which sits at world y LOS_Y.
 * attackingYours: the CPU has the ball, so the end zone at the top is yours.
 */
let grassPattern: CanvasPattern | null = null;

function drawField(ctx: CanvasRenderingContext2D, g: Game, ballOn: number, lineToGain: number, attackingYours: boolean): void {
  const v = g.view;
  const yOf = (yard: number) => Math.round(g.sy(LOS_Y - (yard - ballOn) * YD));
  const left = Math.round(g.sx(FIELD_LEFT)), right = Math.round(g.sx(FIELD_RIGHT));
  const fw = right - left;
  const kits = g.careerGame?.kits; // career games: the end zones in the schools' colours
  const zone = (k: Kit) => shade(k.jersey === '#fff1e8' ? k.trim : k.jersey, -0.45);
  const yourZone = kits ? zone(kits.you) : C.navy, cpuZone = kits ? zone(kits.cpu) : '#7e2553';
  ctx.fillStyle = '#0a5c36';
  ctx.fillRect(0, 0, v.w, v.h);

  // 5-yard mowing stripes and end zones
  for (let yard = -10; yard < 110; yard += 5) {
    const top = yOf(yard + 5), bottom = yOf(yard);
    if (bottom < 0 || top > v.h) continue;
    if (yard < 0) ctx.fillStyle = attackingYours ? cpuZone : yourZone;
    else if (yard >= 100) ctx.fillStyle = attackingYours ? yourZone : cpuZone;
    else ctx.fillStyle = Math.floor(yard / 5) % 2 ? '#00873f' : '#00954a';
    ctx.fillRect(left, top, fw, bottom - top);
  }
  // HD grass: a fine texture over the stripes, anchored to the field so it scrolls with it
  grassPattern ??= ctx.createPattern(grassTile(), 'repeat');
  if (grassPattern) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const t = grassTile();
    grassPattern.setTransform(new DOMMatrix([1, 0, 0, 1, 0, ((yOf(0) * HD) % t.height + t.height) % t.height]));
    ctx.fillStyle = grassPattern;
    ctx.fillRect(0, 0, v.w * HD, v.h * HD);
    ctx.restore();
  }
  const ez = yOf(105);
  if (ez > -10 && ez < v.h + 10) {
    drawText(ctx, attackingYours ? g.match.names.you : g.match.names.cpu, g.sx(W / 2), ez - 5, { scale: 2, color: attackingYours ? C.blue : C.pink, align: 'center' });
  }

  // yard lines, numbers, hash marks
  ctx.fillStyle = C.white;
  for (let yard = 0; yard <= 100; yard += 5) {
    const y = yOf(yard);
    if (y < -8 || y > v.h + 8) continue;
    ctx.fillRect(left, y, fw, yard % 50 === 0 ? 2 : 1); // goal lines and midfield are thicker
    if (yard % 10 === 0 && yard > 0 && yard < 100) {
      const label = String(yard <= 50 ? yard : 100 - yard);
      const tw = textWidth(label);
      for (const x of [left + Math.round(12 * v.s), right - Math.round(12 * v.s) - tw]) {
        ctx.fillStyle = Math.floor(yard / 5) % 2 ? '#00873f' : '#00954a';
        ctx.fillRect(x - 1, y - 3, tw + 2, 7); // gap in the line behind the number
        drawText(ctx, label, x, y - 2, { color: C.white });
      }
      ctx.fillStyle = C.white;
    }
  }
  const hashL = Math.round(g.sx(fx(-HASH_YD))) - 1, hashR = Math.round(g.sx(fx(HASH_YD)));
  for (let yard = 1; yard < 100; yard++) {
    if (yard % 5 === 0) continue;
    const y = yOf(yard);
    if (y < 0 || y > v.h) continue;
    ctx.fillRect(hashL, y, 2, 1);
    ctx.fillRect(hashR, y, 2, 1);
    ctx.fillRect(left, y, 1, 1);
    ctx.fillRect(right - 1, y, 1, 1);
  }
  ctx.fillRect(left - 1, 0, 1, v.h);
  ctx.fillRect(right, 0, 1, v.h);

  // line of scrimmage (blue) and line to gain (yellow)
  ctx.fillStyle = C.blue;
  ctx.fillRect(left, yOf(ballOn), fw, 1);
  if (lineToGain < 100) {
    ctx.fillStyle = C.yellow;
    ctx.fillRect(left, yOf(lineToGain), fw, 1);
  }
}
