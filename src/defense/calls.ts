// Defensive calls: who rushes the QB, who plays man-to-man, who plays a zone.
// A call is picked at random before each snap.

export type DefId = 'DE_L' | 'DT_L' | 'DT_R' | 'DE_R' | 'WILL' | 'MIKE' | 'SAM' | 'CB_L' | 'CB_R' | 'FS' | 'SS';
export type DefKind = 'dl' | 'lb' | 'db';

/** Base alignment in yards (x across, d off the ball). DBs get moved by the call. */
export const DEF_BASE: Record<DefId, { x: number; d: number; kind: DefKind }> = {
  DE_L: { x: -6.4, d: 1, kind: 'dl' },
  DT_L: { x: -1.6, d: 1, kind: 'dl' },
  DT_R: { x: 1.6, d: 1, kind: 'dl' },
  DE_R: { x: 6.4, d: 1, kind: 'dl' },
  WILL: { x: -4.5, d: 5, kind: 'lb' },
  MIKE: { x: 0, d: 5.5, kind: 'lb' },
  SAM: { x: 4.5, d: 5, kind: 'lb' },
  CB_L: { x: -18, d: 6, kind: 'db' },
  CB_R: { x: 18, d: 6, kind: 'db' },
  FS: { x: -6, d: 12, kind: 'db' },
  SS: { x: 6, d: 12, kind: 'db' },
};

/**
 * A zone is an area of the field to guard (yards). The defender drops to the
 * landmark (x, d) and plays whoever enters the box [x-wx, x+wx] x [dmin, dmax].
 * Deep zones stay on top of the deepest threat; underneath zones squeeze the nearest.
 */
export interface ZoneDef {
  name: string; x: number; wx: number; d: number; dmin: number; dmax: number; deep: boolean;
  wide?: boolean; // flat defenders take the widest threat instead of the nearest
  spy?: boolean; // shadows the quarterback instead of an area
}

const deep = (name: string, x: number, wx: number, d: number, dmin = 10): ZoneDef => ({ name, x, wx, d, dmin, dmax: 50, deep: true });
const under = (name: string, x: number, wx: number, d: number, dmin: number, dmax: number, wide = false): ZoneDef =>
  ({ name, x, wx, d, dmin, dmax, deep: false, wide });

export const ZONES = {
  deepMiddle: deep('DEEP MIDDLE', 0, 16, 15),
  deepHalfL: deep('DEEP HALF', -13, 13.5, 17),
  deepHalfR: deep('DEEP HALF', 13, 13.5, 17),
  deep3L: deep('DEEP THIRD', -18, 9, 15),
  deep3M: deep('DEEP THIRD', 0, 9, 16),
  deep3R: deep('DEEP THIRD', 18, 9, 15),
  deep4L1: deep('DEEP QUARTER', -19.5, 7, 15, 7),
  deep4L2: deep('DEEP QUARTER', -6.5, 6.5, 16, 7),
  deep4R2: deep('DEEP QUARTER', 6.5, 6.5, 16, 7),
  deep4R1: deep('DEEP QUARTER', 19.5, 7, 15, 7),
  flatL: under('FLAT', -19, 7, 4, 0, 13, true),
  flatR: under('FLAT', 19, 7, 4, 0, 13, true),
  curlFlatL: under('CURL FLAT', -15, 10, 7, 1, 13, true),
  curlFlatR: under('CURL FLAT', 15, 10, 7, 1, 13, true),
  hookL: under('HOOK', -7, 6, 9, 3, 14),
  hookR: under('HOOK', 7, 6, 9, 3, 14),
  midHook: under('MIDDLE HOOK', 0, 6, 10, 3, 15),
  robber: under('ROBBER', 0, 8, 12, 6, 18),
  tampaMiddle: deep('DEEP MIDDLE', 0, 7, 14, 8), // Tampa 2: the MIKE runs the deep middle
  spy: { ...under('QB SPY', 0, 20, 6, 2, 10), spy: true },
} satisfies Record<string, ZoneDef>;
export type ZoneKey = keyof typeof ZONES;

export interface Call {
  id: string;
  name: string; // what it's called in the defensive playbook
  coverage: string; // e.g. 'COVER 3'
  family: 'man' | 'zone';
  shell: 'one' | 'two' | 'zero'; // safeties' true look (they may disguise it)
  press?: number; // chance each man corner presses (default 0.45)
  weight: number; // how often it gets picked
  rush: DefId[];
  man: DefId[]; // man-to-man defenders, matched to receivers at the snap
  zones: Partial<Record<DefId, ZoneKey>>;
}

const DL: DefId[] = ['DE_L', 'DT_L', 'DT_R', 'DE_R'];

export const CALLS: Call[] = [
  {
    id: 'c0', name: 'ZERO BLITZ', coverage: 'COVER 0', family: 'man', shell: 'zero', weight: 0.8,
    rush: [...DL, 'MIKE', 'WILL'], man: ['CB_L', 'CB_R', 'SS', 'FS', 'SAM'], zones: {},
  },
  {
    id: 'c1-blitz', name: 'COVER 1 BLITZ', coverage: 'COVER 1', family: 'man', shell: 'one', weight: 1.1,
    rush: [...DL, 'MIKE'], man: ['CB_L', 'CB_R', 'SS', 'SAM', 'WILL'], zones: { FS: 'deepMiddle' },
  },
  {
    id: 'c1', name: 'COVER 1 ROBBER', coverage: 'COVER 1', family: 'man', shell: 'one', weight: 1.1,
    rush: [...DL], man: ['CB_L', 'CB_R', 'SS', 'SAM', 'WILL'], zones: { FS: 'deepMiddle', MIKE: 'robber' },
  },
  {
    id: 'c2', name: 'COVER 2', coverage: 'COVER 2', family: 'zone', shell: 'two', weight: 1.2,
    rush: [...DL], man: [],
    zones: { FS: 'deepHalfL', SS: 'deepHalfR', CB_L: 'flatL', CB_R: 'flatR', WILL: 'hookL', MIKE: 'midHook', SAM: 'hookR' },
  },
  {
    id: 'c2-drop', name: 'COVER 2 DROP 8', coverage: 'COVER 2', family: 'zone', shell: 'two', weight: 0.5,
    rush: ['DE_L', 'DT_R', 'DE_R'], man: [],
    zones: { FS: 'deepHalfL', SS: 'deepHalfR', CB_L: 'flatL', CB_R: 'flatR', WILL: 'hookL', MIKE: 'midHook', SAM: 'hookR', DT_L: 'robber' },
  },
  {
    id: 'c3', name: 'COVER 3', coverage: 'COVER 3', family: 'zone', shell: 'one', weight: 1.4,
    rush: [...DL], man: [],
    zones: { CB_L: 'deep3L', FS: 'deep3M', CB_R: 'deep3R', WILL: 'curlFlatL', MIKE: 'hookL', SAM: 'hookR', SS: 'curlFlatR' },
  },
  {
    id: 'c3-fire', name: 'FIRE ZONE', coverage: 'COVER 3', family: 'zone', shell: 'one', weight: 0.9,
    rush: [...DL, 'MIKE'], man: [],
    zones: { CB_L: 'deep3L', FS: 'deep3M', CB_R: 'deep3R', WILL: 'curlFlatL', SAM: 'midHook', SS: 'curlFlatR' },
  },
  {
    id: 'c4', name: 'QUARTERS', coverage: 'COVER 4', family: 'zone', shell: 'two', weight: 1,
    rush: [...DL], man: [],
    zones: { CB_L: 'deep4L1', FS: 'deep4L2', SS: 'deep4R2', CB_R: 'deep4R1', WILL: 'curlFlatL', MIKE: 'midHook', SAM: 'curlFlatR' },
  },
  {
    id: 'c4-drop', name: 'QUARTERS DROP 8', coverage: 'COVER 4', family: 'zone', shell: 'two', weight: 0.7,
    rush: ['DE_L', 'DT_L', 'DT_R'], man: [],
    zones: { CB_L: 'deep4L1', FS: 'deep4L2', SS: 'deep4R2', CB_R: 'deep4R1', WILL: 'curlFlatL', MIKE: 'hookL', SAM: 'curlFlatR', DE_R: 'hookR' },
  },
  {
    id: 'c2-man', name: '2 MAN UNDER', coverage: 'COVER 2 MAN', family: 'man', shell: 'two', weight: 0.9,
    rush: [...DL], man: ['CB_L', 'CB_R', 'SAM', 'WILL', 'MIKE'], zones: { FS: 'deepHalfL', SS: 'deepHalfR' },
  },
  {
    id: 'c6', name: 'COVER 6', coverage: 'COVER 6', family: 'zone', shell: 'two', weight: 0.8,
    rush: [...DL], man: [],
    zones: { CB_L: 'deep4L1', FS: 'deep4L2', SS: 'deepHalfR', CB_R: 'flatR', WILL: 'curlFlatL', MIKE: 'midHook', SAM: 'hookR' },
  },
  {
    id: 'tampa2', name: 'TAMPA 2', coverage: 'TAMPA 2', family: 'zone', shell: 'two', weight: 0.7,
    rush: [...DL], man: [],
    zones: { FS: 'deepHalfL', SS: 'deepHalfR', MIKE: 'tampaMiddle', CB_L: 'flatL', CB_R: 'flatR', WILL: 'hookL', SAM: 'hookR' },
  },
  {
    id: 'c1-press', name: 'COVER 1 PRESS', coverage: 'COVER 1', family: 'man', shell: 'one', weight: 0.7, press: 0.95,
    rush: [...DL], man: ['CB_L', 'CB_R', 'SS', 'SAM', 'WILL'], zones: { FS: 'deepMiddle', MIKE: 'robber' },
  },
  {
    id: 'c1-lurk', name: 'COVER 1 LURK', coverage: 'COVER 1', family: 'man', shell: 'one', weight: 0.6,
    rush: [...DL], man: ['CB_L', 'CB_R', 'SAM', 'WILL', 'MIKE'], zones: { FS: 'deepMiddle', SS: 'robber' },
  },
  {
    id: 'c1-spy', name: 'COVER 1 SPY', coverage: 'COVER 1', family: 'man', shell: 'one', weight: 0.5,
    rush: [...DL], man: ['CB_L', 'CB_R', 'SS', 'SAM', 'WILL'], zones: { FS: 'deepMiddle', MIKE: 'spy' },
  },
  {
    id: 'sim-pressure', name: 'SIM PRESSURE', coverage: 'COVER 3', family: 'zone', shell: 'one', weight: 0.6,
    rush: ['DE_L', 'DT_L', 'DT_R', 'WILL'], man: [],
    zones: { CB_L: 'deep3L', FS: 'deep3M', CB_R: 'deep3R', DE_R: 'curlFlatR', SS: 'curlFlatL', MIKE: 'hookL', SAM: 'hookR' },
  },
  {
    id: 'c3-buzz', name: 'COVER 3 BUZZ', coverage: 'COVER 3', family: 'zone', shell: 'one', weight: 0.8,
    rush: [...DL], man: [],
    zones: { CB_L: 'deep3L', FS: 'deep3M', CB_R: 'deep3R', SS: 'hookR', SAM: 'curlFlatR', MIKE: 'hookL', WILL: 'curlFlatL' },
  },
  {
    id: 'nickel-fire', name: 'NICKEL FIRE', coverage: 'COVER 3', family: 'zone', shell: 'one', weight: 0.7,
    rush: [...DL, 'SAM'], man: [],
    zones: { CB_L: 'deep3L', FS: 'deep3M', CB_R: 'deep3R', SS: 'curlFlatR', WILL: 'curlFlatL', MIKE: 'midHook' },
  },
  {
    id: 'c4-blitz', name: 'QUARTERS BLITZ', coverage: 'COVER 4', family: 'zone', shell: 'two', weight: 0.6,
    rush: [...DL, 'WILL'], man: [],
    zones: { CB_L: 'deep4L1', FS: 'deep4L2', SS: 'deep4R2', CB_R: 'deep4R1', MIKE: 'midHook', SAM: 'curlFlatR' },
  },
];

/** Defensive playbook categories. */
export const DEF_CATEGORIES = [
  { id: 'zone', name: 'ZONE' }, { id: 'man', name: 'MAN' }, { id: 'blitz', name: 'BLITZ' },
] as const;
export type DefCategory = (typeof DEF_CATEGORIES)[number]['id'];
export const callCategory = (c: Call): DefCategory => (c.rush.length >= 5 ? 'blitz' : c.family);

/** Picks a call at random; bias (if given) re-weights calls, e.g. to counter a play you keep running. */
export function pickCall(bias?: (c: Call) => number): Call {
  const w = (c: Call) => c.weight * (bias ? bias(c) : 1);
  const total = CALLS.reduce((s, c) => s + w(c), 0);
  let r = Math.random() * total;
  for (const c of CALLS) { r -= w(c); if (r <= 0) return c; }
  return CALLS[CALLS.length - 1];
}

/** Does a play built to beat `vs` (its playbook label, e.g. 'VS COVER 2') beat this call? */
export function beats(vs: string, c: Call): boolean {
  switch (vs) {
    case 'VS BLITZ': return c.rush.length >= 5;
    case 'VS MAN': case 'LAST PLAY': return c.family === 'man';
    case 'VS ZONE': return c.family === 'zone';
    case 'VS SOFT': return c.family === 'zone' && c.rush.length <= 4;
    case 'VS COVER 1': return c.coverage === 'COVER 1';
    case 'VS COVER 2': return c.coverage === 'COVER 2' || c.coverage === 'TAMPA 2';
    case 'VS COVER 3': return c.coverage === 'COVER 3';
    case 'VS COVER 4': return c.coverage === 'COVER 4' || c.coverage === 'COVER 6';
    default: return false;
  }
}

export function rushLabel(call: Call): string {
  const n = call.rush.length;
  return n >= 5 ? `${n}-MAN BLITZ` : `${n}-MAN RUSH`;
}
