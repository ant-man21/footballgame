// Player ratings (0-99) and team rosters.
//
// Every rating is judged against the norm for the player's position: a player
// rated exactly at his position's norm plays exactly like the game's base
// tuning, better players move away from that. So rosters change how players
// play without changing the overall balance.

import { DEF_BASE, type DefId } from './defense/calls';

export interface Ratings {
  spd: number; // speed
  hnd: number; // hands: catch reach, contested catches
  rte: number; // route running: sharper cuts (harder for man coverage to stay with)
  blk: number; // blocking: pass protection and downfield blocks
  elu: number; // elusiveness: breaking tackles after the catch
  acc: number; // QB accuracy: how tight the landing oval is
  arm: number; // QB arm: max distance and ball speed
  dec: number; // QB decisions (CPU): how patient / how good his reads are
  rsh: number; // pass rush: beating blocks
  cov: number; // coverage: reaction to the throw, reading cuts
  bsk: number; // ball skills: turning contested balls into picks
  tkl: number; // tackling
}
export type RatingKey = keyof Ratings;
export const RATING_KEYS: RatingKey[] = ['spd', 'hnd', 'rte', 'blk', 'elu', 'acc', 'arm', 'dec', 'rsh', 'cov', 'bsk', 'tkl'];

export type Pos = 'QB' | 'WR' | 'TE' | 'RB' | 'OL' | 'DL' | 'LB' | 'CB' | 'S' | 'NB';

/** The norm for each position (an average starter). Missing keys don't matter for that position. */
const NORMS: Record<Pos, Partial<Ratings>> = {
  QB: { acc: 78, arm: 78, dec: 76, spd: 60 },
  WR: { spd: 86, hnd: 78, rte: 78, elu: 74, blk: 55 },
  TE: { spd: 74, hnd: 76, rte: 70, elu: 66, blk: 72 },
  RB: { spd: 84, hnd: 70, rte: 66, elu: 80, blk: 66 },
  OL: { blk: 78, spd: 50 },
  DL: { rsh: 76, tkl: 72, spd: 64 },
  LB: { cov: 70, tkl: 80, rsh: 70, spd: 74, bsk: 58 },
  CB: { spd: 87, cov: 80, bsk: 70, tkl: 66 },
  S: { spd: 84, cov: 77, bsk: 72, tkl: 76 },
  NB: { spd: 85, cov: 78, bsk: 68, tkl: 68 },
};
/** Which ratings matter for a position's overall, and how much. */
const OVR_WEIGHTS: Record<Pos, Partial<Record<RatingKey, number>>> = {
  QB: { acc: 4, arm: 2, dec: 3, spd: 0.5 },
  WR: { spd: 3, hnd: 3, rte: 3, elu: 1 },
  TE: { hnd: 3, blk: 3, rte: 2, spd: 1 },
  RB: { spd: 3, elu: 3, hnd: 2, blk: 1 },
  OL: { blk: 5, spd: 0.5 },
  DL: { rsh: 4, tkl: 2, spd: 1 },
  LB: { tkl: 3, cov: 3, rsh: 1, spd: 2 },
  CB: { cov: 4, spd: 3, bsk: 2, tkl: 1 },
  S: { cov: 3, spd: 2, bsk: 2, tkl: 2 },
  NB: { cov: 4, spd: 3, bsk: 2, tkl: 1 },
};

export interface Player { slot: string; pos: Pos; name: string; r: Ratings; ovr: number }
export interface Roster { name: string; players: Player[] }

/** Slots on the field and their positions. Offense: QB, line, X/H/Y/Z/RB. Defense: the DEF_BASE ids plus a nickel. */
const OFF_SLOTS: [string, Pos][] = [
  ['QB', 'QB'], ['X', 'WR'], ['Z', 'WR'], ['H', 'WR'], ['Y', 'WR'], ['TE', 'TE'], ['RB', 'RB'],
  ['OL0', 'OL'], ['OL1', 'OL'], ['OL2', 'OL'], ['OL3', 'OL'], ['OL4', 'OL'],
];
const DEF_POS: Record<DefId, Pos> = {
  DE_L: 'DL', DT_L: 'DL', DT_R: 'DL', DE_R: 'DL', WILL: 'LB', MIKE: 'LB', SAM: 'LB', CB_L: 'CB', CB_R: 'CB', FS: 'S', SS: 'S',
};

const FIRST = 'ABCDEFGHJKLMNPRSTVW';
const LAST = ['MOORE', 'HAYES', 'PRICE', 'BROOKS', 'WARD', 'FOSTER', 'GRAY', 'BELL', 'REED', 'COLE', 'LANE', 'WEST', 'PAGE',
  'STONE', 'NASH', 'BURKE', 'HALE', 'CROSS', 'FORD', 'DEAN', 'MARSH', 'POPE', 'HART', 'RHODES', 'BOONE', 'CASH', 'DRAKE',
  'FROST', 'GAINES', 'HOLT', 'KNOX', 'LOWE', 'MAYS', 'NOLAN', 'OWENS', 'PRUITT', 'QUINN', 'RIDLEY', 'SHAW', 'TATE', 'VANCE',
  'WADE', 'YATES', 'ZANE', 'BLAKE', 'CRUZ', 'DIAZ', 'ELLIS', 'FLYNN', 'GREER'];

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const clampR = (v: number) => Math.max(40, Math.min(99, Math.round(v)));

function overall(pos: Pos, r: Ratings): number {
  const w = OVR_WEIGHTS[pos];
  let s = 0, n = 0;
  for (const [k, wt] of Object.entries(w) as [RatingKey, number][]) { s += r[k] * wt; n += wt; }
  return Math.round(s / n);
}

function makePlayer(slot: string, pos: Pos, strength: number, used: Set<string>): Player {
  const norm = NORMS[pos];
  const r = {} as Ratings;
  const talent = rnd(-6, 6); // some players are just better
  for (const k of RATING_KEYS) r[k] = clampR((norm[k] ?? 55) + strength + talent + rnd(-6, 6));
  let name = '';
  do { name = `${FIRST[Math.floor(Math.random() * FIRST.length)]}.${LAST[Math.floor(Math.random() * LAST.length)]}`; } while (used.has(name));
  used.add(name);
  return { slot, pos, name, r, ovr: overall(pos, r) };
}

/** A new roster. strength shifts every rating (0 = league average starters). */
export function makeRoster(name: string, strength = 0): Roster {
  const used = new Set<string>();
  const players = [
    ...OFF_SLOTS.map(([slot, pos]) => makePlayer(slot, pos, strength, used)),
    ...(Object.keys(DEF_BASE) as DefId[]).map((id) => makePlayer(id, DEF_POS[id], strength, used)),
    makePlayer('NB', 'NB', strength, used),
  ];
  return { name, players };
}

export const teamOvr = (t: Roster) => Math.round(t.players.reduce((s, p) => s + p.ovr, 0) / t.players.length);

/** How far a rating is from the norm for this player's position (in rating points). */
export function delta(p: Player | undefined, k: RatingKey): number {
  if (!p) return 0;
  return p.r[k] - (NORMS[p.pos][k] ?? 55);
}

/**
 * The player in a given spot on the field. Offense: the formation spot id
 * (X/H/Y/Z/RB; an in-line Y is the tight end) or OLn / QB. Defense: the DEF id,
 * with the nickel back playing SAM against 3+ receivers.
 */
export function playerFor(t: Roster, side: 'off' | 'def', id: string, opts: { te?: boolean; nickel?: boolean } = {}): Player | undefined {
  let slot = id;
  if (side === 'off' && id === 'Y' && opts.te) slot = 'TE';
  if (side === 'def' && id === 'SAM' && opts.nickel) slot = 'NB';
  return t.players.find((p) => p.slot === slot);
}

const KEY = 'footballgame.roster';
export function loadRoster(): Roster {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const t = JSON.parse(raw) as Roster;
      if (t.players?.length === 24) return t;
    }
  } catch { /* fall through */ }
  const t = makeRoster('YOU');
  saveRoster(t);
  return t;
}
export function saveRoster(t: Roster): void {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* ignore */ }
}
