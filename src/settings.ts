// Player settings, remembered on this device.

export type Difficulty = 'rookie' | 'pro' | 'allpro';
export type Speed = 'slow' | 'normal' | 'fast';
export type AimPref = 'pull' | 'aim';
export type QuarterLen = '1' | '1.5' | '2' | '2.5' | '3' | '3.5' | '4'; // minutes

export interface Settings { difficulty: Difficulty; speed: Speed; aim: AimPref; quarter: QuarterLen }

export const DIFFICULTIES: { id: Difficulty; name: string }[] = [
  { id: 'rookie', name: 'ROOKIE' }, { id: 'pro', name: 'PRO' }, { id: 'allpro', name: 'ALL-PRO' },
];
export const QUARTERS: { id: QuarterLen; name: string }[] = (['1', '1.5', '2', '2.5', '3', '3.5', '4'] as QuarterLen[])
  .map((id) => { const s = Math.round(Number(id) * 60); return { id, name: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }; });
export const SPEEDS: { id: Speed; name: string }[] = [
  { id: 'slow', name: 'SLOW' }, { id: 'normal', name: 'NORMAL' }, { id: 'fast', name: 'FAST' },
];

/**
 * How the CPU-controlled team plays at each difficulty. Mostly it's the CPU
 * roster's strength (rating points vs an average team); a little help on
 * contested catches and a pickier CPU quarterback on the easier levels.
 */
export const DIFFICULTY_TUNING: Record<Difficulty, { strength: number; speed: number; react: number; catchBonus: number; qbPicky: number }> = {
  rookie: { strength: -6, speed: 1, react: 0, catchBonus: 0.05, qbPicky: 5 },
  pro: { strength: 0, speed: 1, react: 0, catchBonus: 0.01, qbPicky: 2 },
  allpro: { strength: 5, speed: 1, react: 0, catchBonus: 0, qbPicky: 0 },
};

/** Game speed scales the whole simulation together, so timing feels the same, just slower or faster. */
export const SPEED_FACTOR: Record<Speed, number> = { slow: 0.82, normal: 1, fast: 1.15 };

const KEY = 'footballgame.settings';
const DEFAULTS: Settings = { difficulty: 'pro', speed: 'normal', aim: 'pull', quarter: '2.5' };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULTS, ...JSON.parse(raw) } as Settings;
      if (!QUARTERS.some((q) => q.id === s.quarter)) s.quarter = DEFAULTS.quarter; // older saves (5 or 8 min)
      return s;
    }
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
