// The career save: one JSON blob in localStorage with a version number.
// Bump CAREER_VERSION when the shape changes and add a step to migrate().
import type { CareerSave } from './career';

export const CAREER_KEY = 'footballgame.career.v1';
export const CAREER_VERSION = 1;

export function loadCareer(): CareerSave | null {
  try {
    const raw = localStorage.getItem(CAREER_KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch { return null; }
}

export function saveCareer(s: CareerSave): void {
  try { localStorage.setItem(CAREER_KEY, JSON.stringify(s)); } catch { /* private mode / full */ }
}

export function deleteCareer(): void {
  try { localStorage.removeItem(CAREER_KEY); } catch { /* ignore */ }
}

/** Brings an older save up to date; null if it can't be read. */
export function migrate(s: { v?: number } & Record<string, unknown>): CareerSave | null {
  if (!s || typeof s !== 'object' || typeof s.v !== 'number') return null;
  // (future: if (s.v === 1) { ...; s.v = 2; })
  if (s.v !== CAREER_VERSION) return null;
  const c = s as unknown as CareerSave;
  if (!c.player || !Array.isArray(c.teams) || !Array.isArray(c.games)) return null;
  return c;
}
