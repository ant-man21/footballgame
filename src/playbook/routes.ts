// Route library. Points are in yards relative to where the receiver lines up:
//   o = toward the receiver's own sideline (negative = toward the middle)
//   d = downfield
// 'continue' routes keep running in the direction of the last leg; 'stop' routes settle.

export interface RoutePt { o: number; d: number }
export interface RouteDef { name: string; pts: RoutePt[]; end: 'stop' | 'continue' }

export const ROUTES = {
  go:        { name: 'GO',        end: 'continue', pts: [{ o: 0, d: 40 }] },
  seam:      { name: 'SEAM',      end: 'continue', pts: [{ o: 0, d: 5 }, { o: -1.5, d: 40 }] },
  slant:     { name: 'SLANT',     end: 'continue', pts: [{ o: 0, d: 2 }, { o: -6, d: 8 }] },
  hitch:     { name: 'HITCH',     end: 'stop',     pts: [{ o: 0, d: 6 }, { o: 0.6, d: 5 }] },
  curl:      { name: 'CURL',      end: 'stop',     pts: [{ o: 0, d: 12 }, { o: -1.5, d: 10.5 }] },
  out:       { name: 'OUT',       end: 'continue', pts: [{ o: 0, d: 10 }, { o: 7, d: 10 }] },
  flat:      { name: 'FLAT',      end: 'continue', pts: [{ o: 1.5, d: 2 }, { o: 9, d: 3.5 }] },
  corner:    { name: 'CORNER',    end: 'continue', pts: [{ o: 0, d: 10 }, { o: 7, d: 18 }] },
  post:      { name: 'POST',      end: 'continue', pts: [{ o: 0, d: 10 }, { o: -7, d: 20 }] },
  dig:       { name: 'DIG',       end: 'continue', pts: [{ o: 0, d: 12 }, { o: -14, d: 12 }] },
  drag:      { name: 'DRAG',      end: 'continue', pts: [{ o: -2, d: 2 }, { o: -28, d: 5 }] },
  dragHigh:  { name: 'DRAG',      end: 'continue', pts: [{ o: -2, d: 3 }, { o: -28, d: 6.5 }] },
  swing:     { name: 'SWING',     end: 'continue', pts: [{ o: 3, d: -1 }, { o: 10, d: 1.5 }] },
  checkdown: { name: 'CHECKDOWN', end: 'stop',     pts: [{ o: 4.5, d: 2.5 }, { o: 3.5, d: 9 }] }, // outside the tackle, 4 yds past the line
  stick:     { name: 'STICK',     end: 'stop',     pts: [{ o: 0, d: 6 }, { o: 1.5, d: 6 }] },
  snag:      { name: 'SNAG',      end: 'stop',     pts: [{ o: 0, d: 4 }, { o: -2.5, d: 6 }] },
  speedOut:  { name: 'SPEED OUT', end: 'continue', pts: [{ o: 0, d: 5 }, { o: 7, d: 5 }] },
  in5:       { name: 'IN',        end: 'continue', pts: [{ o: 0, d: 5 }, { o: -10, d: 5 }] },
  sail:      { name: 'SAIL',      end: 'continue', pts: [{ o: 0, d: 9 }, { o: 8, d: 14 }] },
  cross:     { name: 'CROSS',     end: 'continue', pts: [{ o: 0, d: 4 }, { o: -22, d: 15 }] },
  deepOver:  { name: 'DEEP OVER', end: 'continue', pts: [{ o: 0, d: 7 }, { o: -26, d: 19 }] },
  wheel:     { name: 'WHEEL',     end: 'continue', pts: [{ o: 3, d: 1 }, { o: 6, d: 4 }, { o: 6.5, d: 40 }] },
  deepDig:   { name: 'DEEP DIG',  end: 'continue', pts: [{ o: 0, d: 15 }, { o: -14, d: 15 }] },
  skinnyPost:{ name: 'SKINNY',    end: 'continue', pts: [{ o: 0, d: 9 }, { o: -4, d: 24 }] },
  shallow:   { name: 'SHALLOW',   end: 'continue', pts: [{ o: -1, d: 1.5 }, { o: -26, d: 3 }] },
  // double moves: sell the short route, then take off
  sluggo:    { name: 'SLUGGO',    end: 'continue', pts: [{ o: 0, d: 2 }, { o: -2.5, d: 5 }, { o: -2.5, d: 6 }, { o: -1.5, d: 40 }] },
  outAndUp:  { name: 'OUT + UP',  end: 'continue', pts: [{ o: 0, d: 5 }, { o: 2.5, d: 5.5 }, { o: 3, d: 7 }, { o: 3, d: 40 }] },
  bomb:      { name: 'BOMB',      end: 'continue', pts: [{ o: 0, d: 10 }, { o: -10, d: 45 }] },
} satisfies Record<string, RouteDef>;

export type RouteKey = keyof typeof ROUTES;

/** A route as absolute yard coordinates (x across, d downfield) for a receiver at (x, d). */
export function routeYards(x: number, d: number, route: RouteDef, flip = false): { x: number; d: number }[] {
  const side = (x >= 0 ? 1 : -1) * (flip ? -1 : 1);
  return route.pts.map((p) => ({ x: x + p.o * side, d: d + p.d }));
}
