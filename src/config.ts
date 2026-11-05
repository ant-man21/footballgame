// Logical resolution: everything is drawn at this size and scaled up with
// nearest-neighbour filtering, which gives the chunky pixel-art look.
export const W = 180;
export const H = 320;

export const FIELD_LEFT = 6;
export const FIELD_RIGHT = W - 6;
export const ENDZONE_BOTTOM = 26;
export const LOS_Y = 252; // line of scrimmage
export const QB_POS = { x: 90, y: 284 };

export const MAX_THROW = 230; // longest throw, in pixels
export const PULL_POWER = 2.6; // pull mode: target offset = drag distance * this
