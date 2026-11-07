import * as quicksim from './career/quicksim';
import * as recruiting from './career/recruiting';
import { predict, readReceiver } from './cpu';
import { Game, SIM_DEF } from './game';
import { PLAYS } from './playbook/plays';
import { CareerScreens } from './ui/career';
import { watchForUpdates } from './update';
import { PORTRAIT, landscapeView } from './view';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const game = new Game();
(window as unknown as { __game: Game }).__game = game; // handles for automated tests
(window as unknown as { __plays: typeof PLAYS }).__plays = PLAYS;
(window as unknown as { __cpu: unknown }).__cpu = { readReceiver, predict };
(window as unknown as { __quicksim: unknown }).__quicksim = quicksim;
(window as unknown as { __recruiting: unknown }).__recruiting = recruiting;
(window as unknown as { __simDef: unknown }).__simDef = SIM_DEF;
const careerScreens = new CareerScreens(game);
game.onCareer = () => careerScreens.open();
(window as unknown as { __careerUI: CareerScreens }).__careerUI = careerScreens;

/** Portrait or landscape follows the screen: turn the phone and the game turns with it. */
function fit(): void {
  const aspect = window.innerWidth / window.innerHeight;
  const v = aspect > 1 ? landscapeView(aspect) : PORTRAIT;
  if (v.landscape !== game.view.landscape || canvas.width !== v.w) {
    game.setView(v);
    canvas.width = v.w;
    canvas.height = v.h;
  }
  const scale = Math.min(window.innerWidth / v.w, window.innerHeight / v.h);
  canvas.style.width = `${Math.floor(v.w * scale)}px`;
  canvas.style.height = `${Math.floor(v.h * scale)}px`;
  ctx.imageSmoothingEnabled = false;
}
fit();
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', () => setTimeout(fit, 100));

function toLogical(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * game.view.w, y: ((e.clientY - r.top) / r.height) * game.view.h };
}

let activePointer: number | null = null;
canvas.addEventListener('pointerdown', (e) => {
  if (activePointer !== null) return; // ignore extra fingers
  activePointer = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  game.pointerDown(toLogical(e));
  e.preventDefault();
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === activePointer) game.pointerMove(toLogical(e));
});
const end = (e: PointerEvent) => {
  if (e.pointerId !== activePointer) return;
  activePointer = null;
  game.pointerUp(toLogical(e));
};
canvas.addEventListener('pointerup', end);
canvas.addEventListener('pointercancel', end);
document.addEventListener('contextmenu', (e) => e.preventDefault());

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  game.render(ctx);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// a newer deploy reloads the app, but only on a menu (the title or the career screens), never mid-game
watchForUpdates(() => game.screen === 'title' || (game.screen === 'career' && !game.rosterView));
