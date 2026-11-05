export type Vec = { x: number; y: number };

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export function unit(from: Vec, to: Vec): Vec {
  const d = dist(from, to);
  return d < 1e-6 ? { x: 0, y: 0 } : { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
}

/** Moves p toward target by at most maxStep. Returns true when it arrives. */
export function moveToward(p: Vec, target: Vec, maxStep: number): boolean {
  const d = dist(p, target);
  if (d <= maxStep) { p.x = target.x; p.y = target.y; return true; }
  p.x += ((target.x - p.x) / d) * maxStep;
  p.y += ((target.y - p.y) / d) * maxStep;
  return false;
}
