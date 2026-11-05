import { H, W } from './config';
import { Game } from './game';
import { PLAYS } from './playbook/plays';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

const game = new Game();
(window as unknown as { __game: Game }).__game = game; // handles for automated tests
(window as unknown as { __plays: typeof PLAYS }).__plays = PLAYS;

function toLogical(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
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
