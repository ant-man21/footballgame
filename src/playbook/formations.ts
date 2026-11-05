// Formations: where the five eligible receivers line up. x is yards across
// (0 = middle, + = right), d is yards from the line (negative = behind it).

export type SkillType = 'wr' | 'te' | 'rb';
export interface Spot { id: string; type: SkillType; x: number; d: number }
export interface Formation { name: string; skill: Spot[] }

/** The offensive line, always the same: five linemen just behind the ball. */
export const OL_SPOTS = [-4.6, -2.3, 0, 2.3, 4.6];
export const OL_DEPTH = -0.9;

export const FORMATIONS = {
  spread: {
    name: 'SPREAD',
    skill: [
      { id: 'X', type: 'wr', x: -20, d: 0 },
      { id: 'H', type: 'wr', x: -12, d: -1 },
      { id: 'Y', type: 'wr', x: 12, d: -1 },
      { id: 'Z', type: 'wr', x: 20, d: 0 },
      { id: 'RB', type: 'rb', x: 2.5, d: -5 },
    ],
  },
  ace: {
    name: 'ACE',
    skill: [
      { id: 'X', type: 'wr', x: -20, d: 0 },
      { id: 'Y', type: 'te', x: -7.2, d: OL_DEPTH },
      { id: 'H', type: 'wr', x: 12, d: -1 },
      { id: 'Z', type: 'wr', x: 20, d: 0 },
      { id: 'RB', type: 'rb', x: 2.5, d: -5 },
    ],
  },
  trips: {
    name: 'TRIPS RT',
    skill: [
      { id: 'X', type: 'wr', x: -20, d: 0 },
      { id: 'Y', type: 'wr', x: 8, d: -1 },
      { id: 'H', type: 'wr', x: 14, d: -1 },
      { id: 'Z', type: 'wr', x: 20, d: 0 },
      { id: 'RB', type: 'rb', x: -2.5, d: -5 },
    ],
  },
} satisfies Record<string, Formation>;

export type FormationKey = keyof typeof FORMATIONS;
