// Past careers: a small record of every player you've had, kept in its own
// localStorage key so starting a new career never loses the old one. A career is
// archived when he signs (graduated); a pasted EXPORT SAVE of a finished career
// can be added too. Unfinished careers are not kept: PAST CAREERS shows the
// active career (live, from its save) and the finished ones.
import type { TeamStats } from '../drive';
import type { CareerSave } from './career';
import { rivalOf, rivalTrophy } from './news';
import { qbOvr } from './player';

export const HISTORY_KEY = 'footballgame.history.v1';

export interface CareerRecord {
  id: number; // the career's seed (one record per career)
  first: string; last: string; archetype: string; state: string;
  school: { name: string; mascot: string; abbr: string; colors: [string, string] };
  difficulty: string;
  growth: number; // development speed (revealed once he's done)
  status: 'graduated' | 'unfinished' | 'active'; // 'unfinished' only in old lists (dropped on load); 'active' = the career in progress, never stored
  seasons: { year: number; role: string; gp: number; gs: number; record: string; finish: string; stats: TeamStats; stars: number; ovr: number; avg?: number }[];
  awards: string[];
  offers: string[]; // college ids
  signed?: { id: string; walkOn: boolean };
  stars: number; ovr: number;
  rival?: { trophy: string; vs: string; w: number; l: number };
  saved: string; // when it was archived (ISO date)
}

export function loadHistory(): CareerRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((r) => r && typeof r.id === 'number' && r.first && r.status === 'graduated') : [];
  } catch { return []; }
}

function saveHistory(list: CareerRecord[]): void {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* full / private mode */ }
}

/** A career's record (from its save). */
export function recordFrom(s: CareerSave, difficulty = 'pro'): CareerRecord {
  const p = s.player, sc = s.teams[s.schoolId], r = s.recruit;
  const res = p.seasons.map((sl) => sl.rival).filter(Boolean);
  const rid = rivalOf(s.teams, s.schoolId, s.seed);
  return {
    id: s.seed, first: p.first, last: p.last, archetype: p.archetype, state: s.state,
    school: { name: sc.name, mascot: sc.mascot, abbr: sc.abbr, colors: sc.colors },
    difficulty: s.difficulty ?? difficulty, growth: p.growth,
    status: s.phase === 'done' ? 'graduated' : 'unfinished',
    seasons: p.seasons.map((sl) => ({ year: sl.year, role: sl.role, gp: sl.gp, gs: sl.gs, record: sl.record, finish: sl.finish, stats: sl.stats, stars: sl.stars, ovr: sl.ovr, avg: sl.avg })),
    awards: p.awards.filter((a) => !a.startsWith('SIGNED')),
    offers: r ? [...r.offers] : [],
    signed: r?.signed ? { id: r.signed, walkOn: !r.offers.includes(r.signed) } : undefined,
    stars: r?.stars ?? 1, ovr: qbOvr(p),
    rival: res.length ? { trophy: rivalTrophy(s.seed), vs: s.teams[rid].name, w: res.filter((x) => x === 'W').length, l: res.filter((x) => x === 'L').length } : undefined,
    saved: new Date().toISOString(),
  };
}

/** Adds or updates a finished career's record (unfinished ones are not kept). */
export function archive(rec: CareerRecord): void {
  if (rec.status !== 'graduated') return;
  const list = loadHistory();
  const i = list.findIndex((x) => x.id === rec.id);
  if (i >= 0) list[i] = rec; else list.unshift(rec);
  saveHistory(list);
}

/** A pasted EXPORT SAVE (or a bare career save) as a record; null if it isn't one. */
export function recordFromText(text: string): CareerRecord | null {
  try {
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    const o = JSON.parse(text.slice(a, b + 1));
    const s = (o && o.career ? o.career : o) as CareerSave;
    if (!s || !s.player || !Array.isArray(s.teams) || typeof s.seed !== 'number') return null;
    return recordFrom(s, o.settings?.difficulty ?? 'pro');
  } catch { return null; }
}

/** Development speed in words. */
export const growthLabel = (g: number) => (g >= 1.08 ? 'FAST LEARNER' : g <= 0.92 ? 'LATE BLOOMER' : 'STEADY');
