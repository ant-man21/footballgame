// Logical resolution: everything is drawn at this size and scaled up with
// nearest-neighbour filtering, which gives the chunky pixel-art look.
export const W = 180;
export const H = 320;

export const FIELD_LEFT = 6;
export const FIELD_RIGHT = W - 6;
export const CX = W / 2;
export const YD = 3.15; // pixels per yard: 168px field width ≈ 53.3 yards

export const LOS_Y = 210; // line of scrimmage (screen y; the field scrolls under it)
export const QB_DEPTH = 5; // shotgun, yards behind the line

/** Yards across (0 = middle of the field, + = right) to a pixel x. */
export const fx = (xYd: number) => CX + xYd * YD;
/** Yards downfield from the line of scrimmage (+ = toward the end zone) to a pixel y. */
export const fy = (dYd: number) => LOS_Y - dYd * YD;

// Game feel
export const TIME_SCALE = 1.2; // simulation runs this much faster than real time
export const MAX_THROW = 165; // longest throw, in pixels (~52 yards)
export const PULL_POWER = 2.2; // pull mode: target offset = drag distance * this
export const RESULT_TIME = 2.6; // seconds the result banner stays up
export const CAM_ANCHOR = 130; // camera follows a runner once he's above this screen y

// Colours (PICO-8-ish palette)
export const C = {
  white: '#fff1e8', yellow: '#ffec27', red: '#ff004d', green: '#00e436', grey: '#c2c3c7',
  darkGrey: '#5f574f', navy: '#1d2b53', blue: '#29adff', ink: '#111d2b', orange: '#ffa300', pink: '#ff77a8',
};
// One colour per receiver, used for routes on the field and in play art.
export const ROUTE_COLORS = [C.yellow, C.pink, C.orange, C.green, C.white];
