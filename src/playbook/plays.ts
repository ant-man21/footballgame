import type { FormationKey } from './formations';
import type { RouteKey } from './routes';

// The playbook. Plays are grouped into categories so the menu can grow:
// add a category here and plays that use it, and the menu picks them up.

export type CategoryId = 'quick' | 'core' | 'crossers' | 'shots';
export const CATEGORIES: { id: CategoryId; name: string }[] = [
  { id: 'quick', name: 'QUICK' },
  { id: 'core', name: 'CORE' },
  { id: 'crossers', name: 'CROSSERS' },
  { id: 'shots', name: 'SHOTS' },
];

export interface PlayRoute {
  who: string; // formation spot id
  route: RouteKey | 'block';
  flip?: boolean; // run the route toward the other side
}

export interface Play {
  id: string;
  name: string;
  category: CategoryId;
  formation: FormationKey;
  vs: string; // what it is good against, shown on the card
  routes: PlayRoute[];
}

export const PLAYS: Play[] = [
  {
    id: 'slant-flat', name: 'SLANT FLAT', category: 'quick', formation: 'spread', vs: 'VS BLITZ',
    routes: [
      { who: 'X', route: 'slant' }, { who: 'H', route: 'flat' },
      { who: 'Y', route: 'flat' }, { who: 'Z', route: 'slant' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'curl-flat', name: 'CURL FLAT', category: 'quick', formation: 'ace', vs: 'VS ZONE',
    routes: [
      { who: 'X', route: 'curl' }, { who: 'Y', route: 'flat' },
      { who: 'H', route: 'flat' }, { who: 'Z', route: 'curl' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'mesh', name: 'MESH', category: 'crossers', formation: 'spread', vs: 'VS MAN',
    routes: [
      { who: 'X', route: 'corner' }, { who: 'H', route: 'drag' },
      { who: 'Y', route: 'dragHigh' }, { who: 'Z', route: 'dig' },
      { who: 'RB', route: 'swing' },
    ],
  },
  {
    id: 'smash', name: 'SMASH', category: 'core', formation: 'spread', vs: 'VS COVER 2',
    routes: [
      { who: 'X', route: 'hitch' }, { who: 'H', route: 'corner' },
      { who: 'Y', route: 'corner' }, { who: 'Z', route: 'hitch' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'stick', name: 'STICK', category: 'quick', formation: 'trips', vs: 'VS COVER 3',
    routes: [
      { who: 'X', route: 'slant' }, { who: 'Y', route: 'flat' },
      { who: 'H', route: 'stick' }, { who: 'Z', route: 'go' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'quick-outs', name: 'QUICK OUTS', category: 'quick', formation: 'spread', vs: 'VS SOFT',
    routes: [
      { who: 'X', route: 'speedOut' }, { who: 'H', route: 'snag' },
      { who: 'Y', route: 'snag' }, { who: 'Z', route: 'speedOut' },
      { who: 'RB', route: 'checkdown' },
    ],
  },
  {
    id: 'flood', name: 'FLOOD', category: 'core', formation: 'trips', vs: 'VS COVER 3',
    routes: [
      { who: 'X', route: 'dig' }, { who: 'Y', route: 'flat' },
      { who: 'H', route: 'sail' }, { who: 'Z', route: 'go' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'y-cross', name: 'Y CROSS', category: 'crossers', formation: 'ace', vs: 'VS MAN',
    routes: [
      { who: 'X', route: 'go' }, { who: 'Y', route: 'cross' },
      { who: 'H', route: 'flat' }, { who: 'Z', route: 'curl' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'levels', name: 'LEVELS', category: 'core', formation: 'trips', vs: 'VS ZONE',
    routes: [
      { who: 'X', route: 'curl' }, { who: 'Y', route: 'in5' },
      { who: 'H', route: 'dig' }, { who: 'Z', route: 'go' },
      { who: 'RB', route: 'checkdown' },
    ],
  },
  {
    id: 'yankee', name: 'YANKEE', category: 'shots', formation: 'ace', vs: 'VS COVER 1',
    routes: [
      { who: 'X', route: 'post' }, { who: 'Y', route: 'block' },
      { who: 'H', route: 'flat' }, { who: 'Z', route: 'deepOver' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'post-wheel', name: 'POST WHEEL', category: 'shots', formation: 'spread', vs: 'VS MAN',
    routes: [
      { who: 'X', route: 'post' }, { who: 'H', route: 'wheel' },
      { who: 'Y', route: 'flat' }, { who: 'Z', route: 'curl' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'spacing', name: 'SPACING', category: 'quick', formation: 'trips', vs: 'VS ZONE',
    routes: [
      { who: 'X', route: 'slant' }, { who: 'Y', route: 'flat' },
      { who: 'H', route: 'snag' }, { who: 'Z', route: 'hitch' },
      { who: 'RB', route: 'checkdown' },
    ],
  },
  {
    id: 'snag', name: 'SNAG', category: 'quick', formation: 'trips', vs: 'VS COVER 3',
    routes: [
      { who: 'X', route: 'hitch' }, { who: 'Y', route: 'flat' },
      { who: 'H', route: 'snag' }, { who: 'Z', route: 'corner' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'dagger', name: 'DAGGER', category: 'core', formation: 'spread', vs: 'VS COVER 1',
    routes: [
      { who: 'X', route: 'deepDig' }, { who: 'H', route: 'seam' },
      { who: 'Y', route: 'flat' }, { who: 'Z', route: 'curl' },
      { who: 'RB', route: 'checkdown' },
    ],
  },
  {
    id: 'drive', name: 'DRIVE', category: 'crossers', formation: 'ace', vs: 'VS MAN',
    routes: [
      { who: 'X', route: 'go' }, { who: 'Y', route: 'shallow' },
      { who: 'H', route: 'flat' }, { who: 'Z', route: 'dig' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'double-post', name: 'DOUBLE POST', category: 'shots', formation: 'spread', vs: 'VS COVER 3',
    routes: [
      { who: 'X', route: 'post' }, { who: 'H', route: 'skinnyPost' },
      { who: 'Y', route: 'flat' }, { who: 'Z', route: 'curl' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'sluggo', name: 'SLUGGO', category: 'shots', formation: 'spread', vs: 'VS MAN',
    routes: [
      { who: 'X', route: 'sluggo' }, { who: 'H', route: 'flat' },
      { who: 'Y', route: 'curl' }, { who: 'Z', route: 'sluggo' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'out-and-up', name: 'OUT AND UP', category: 'shots', formation: 'trips', vs: 'VS MAN',
    routes: [
      { who: 'X', route: 'outAndUp' }, { who: 'Y', route: 'drag' },
      { who: 'H', route: 'curl' }, { who: 'Z', route: 'outAndUp' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'scissors', name: 'SCISSORS', category: 'shots', formation: 'spread', vs: 'VS COVER 4',
    routes: [
      { who: 'X', route: 'post' }, { who: 'H', route: 'corner' },
      { who: 'Y', route: 'flat' }, { who: 'Z', route: 'curl' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'hail-mary', name: 'HAIL MARY', category: 'shots', formation: 'spread', vs: 'LAST PLAY',
    routes: [
      { who: 'X', route: 'bomb' }, { who: 'H', route: 'seam' },
      { who: 'Y', route: 'seam' }, { who: 'Z', route: 'bomb' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'hitch-seam', name: 'HITCH SEAM', category: 'quick', formation: 'spread', vs: 'VS COVER 3',
    routes: [
      { who: 'X', route: 'hitch' }, { who: 'H', route: 'seam' },
      { who: 'Y', route: 'seam' }, { who: 'Z', route: 'hitch' },
      { who: 'RB', route: 'checkdown' },
    ],
  },
  {
    id: 'mills', name: 'MILLS', category: 'core', formation: 'spread', vs: 'VS COVER 4',
    routes: [
      { who: 'X', route: 'dig' }, { who: 'H', route: 'post' },
      { who: 'Y', route: 'flat' }, { who: 'Z', route: 'curl' },
      { who: 'RB', route: 'checkdown' },
    ],
  },
  {
    id: 'shallow', name: 'SHALLOW', category: 'crossers', formation: 'trips', vs: 'VS ZONE',
    routes: [
      { who: 'X', route: 'go' }, { who: 'Y', route: 'shallow' },
      { who: 'H', route: 'dig' }, { who: 'Z', route: 'curl' },
      { who: 'RB', route: 'checkdown' },
    ],
  },
  {
    id: 'texas', name: 'TEXAS', category: 'crossers', formation: 'ace', vs: 'VS MAN',
    routes: [
      { who: 'X', route: 'go' }, { who: 'Y', route: 'seam' },
      { who: 'H', route: 'flat' }, { who: 'Z', route: 'dig' },
      { who: 'RB', route: 'angle' },
    ],
  },
  {
    id: 'corner-post', name: 'CORNER POST', category: 'shots', formation: 'spread', vs: 'VS COVER 3',
    routes: [
      { who: 'X', route: 'cornerPost' }, { who: 'H', route: 'seam' },
      { who: 'Y', route: 'flat' }, { who: 'Z', route: 'curl' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'deep-cross', name: 'DEEP CROSS', category: 'shots', formation: 'trips', vs: 'VS COVER 1',
    routes: [
      { who: 'X', route: 'post' }, { who: 'Y', route: 'deepOver' },
      { who: 'H', route: 'flat' }, { who: 'Z', route: 'go' },
      { who: 'RB', route: 'block' },
    ],
  },
  {
    id: 'four-verts', name: 'FOUR VERTS', category: 'shots', formation: 'spread', vs: 'VS COVER 3',
    routes: [
      { who: 'X', route: 'go' }, { who: 'H', route: 'seam' },
      { who: 'Y', route: 'seam' }, { who: 'Z', route: 'go' },
      { who: 'RB', route: 'checkdown' },
    ],
  },
];
