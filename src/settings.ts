// Player settings, remembered on this device.

export type Difficulty = 'rookie' | 'pro' | 'allpro';
export type Speed = 'slow' | 'normal' | 'fast';
export type AimPref = 'pull' | 'aim';

export interface Settings { difficulty: Difficulty; speed: Speed; aim: AimPref }

export const DIFFICULTIES: { id: Difficulty; name: string }[] = [
  { id: 'rookie', name: 'ROOKIE' }, { id: 'pro', name: 'PRO' }, { id: 'allpro', name: 'ALL-PRO' },
];
export const SPEEDS: { id: Speed; name: string }[] = [
  { id: 'slow', name: 'SLOW' }, { id: 'normal', name: 'NORMAL' }, { id: 'fast', name: 'FAST' },
];

/** How the CPU-controlled team plays at each difficulty. */
export const DIFFICULTY_TUNING: Record<Difficulty, { speed: number; react: number; catchBonus: number; qbPicky: number }> = {
  rookie: { speed: 0.93, react: 0.1, catchBonus: 0.08, qbPicky: 6 },
  pro: { speed: 0.97, react: 0.04, catchBonus: 0.03, qbPicky: 3 },
  allpro: { speed: 1, react: 0, catchBonus: 0, qbPicky: 0 },
};

/** Game speed scales the whole simulation together, so timing feels the same, just slower or faster. */
export const SPEED_FACTOR: Record<Speed, number> = { slow: 0.82, normal: 1, fast: 1.15 };

const KEY = 'footballgame.settings';
const DEFAULTS: Settings = { difficulty: 'pro', speed: 'normal', aim: 'pull' };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* private mode etc. */ }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function cycle<T extends { id: string }>(list: T[], cur: string, dir: number): T['id'] {
  const i = list.findIndex((x) => x.id === cur);
  return list[(i + dir + list.length) % list.length].id;
}
