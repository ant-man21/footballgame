// A small seeded random number generator (mulberry32), so a career's league
// (schools, schedules) comes out the same from its saved seed.
export class Rng {
  constructor(private s: number) {}
  /** 0 <= x < 1 */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number { return lo + this.next() * (hi - lo); }
  int(lo: number, hi: number): number { return Math.floor(this.range(lo, hi + 1)); } // inclusive
  pick<T>(a: readonly T[]): T { return a[Math.floor(this.next() * a.length)]; }
  shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
}

export const newSeed = () => (Math.random() * 2 ** 31) | 0;
