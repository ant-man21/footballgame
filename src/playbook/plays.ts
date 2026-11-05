import type { FormationKey } from './formations';
import type { RouteKey } from './routes';

// The playbook. Plays are grouped into categories so the menu can grow:
// add a category here and plays that use it, and the menu picks them up.

export type CategoryId = 'quick' | 'core' | 'shots';
export const CATEGORIES: { id: CategoryId; name: string }[] = [
  { id: 'quick', name: 'QUICK' },
  { id: 'core', name: 'CORE' },
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
    id: 'mesh', name: 'MESH', category: 'core', formation: 'spread', vs: 'VS MAN',
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
    id: 'four-verts', name: 'FOUR VERTS', category: 'shots', formation: 'spread', vs: 'VS COVER 3',
    routes: [
      { who: 'X', route: 'go' }, { who: 'H', route: 'seam' },
      { who: 'Y', route: 'seam' }, { who: 'Z', route: 'go' },
      { who: 'RB', route: 'checkdown' },
    ],
  },
];
