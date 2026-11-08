// Team uniforms. The player sprites themselves are drawn in hd.ts.
/** A uniform from a school's colours (career games); see kitsFor(). */
export interface Kit { jersey: string; trim: string; helmet: string; pants: string }
export type TeamColor = 'blue' | 'red' | Kit;

const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const colorDist = (a: string, b: string) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
/** Darker (f < 0) or lighter (f > 0) version of a colour. */
export const shade = (c: string, f: number) => hex(rgb(c).map((v) => (f < 0 ? v * (1 + f) : v + (255 - v) * f)));
const FIELD = '#00873f', WHITE = '#fff1e8';

/**
 * Uniforms for a game between two schools ([primary, secondary] colours): the
 * home team wears its colours, the visitors wear white with their colours as
 * trim. A jersey that would vanish into the green field uses the other school
 * colour; if the two teams would still look alike, the visitors wear colour.
 */
export function kitsFor(home: [string, string], away: [string, string]): { home: Kit; away: Kit } {
  const visible = (c: string) => colorDist(c, FIELD) >= 90;
  const pick = (p: string, s: string) => (visible(p) ? p : visible(s) ? s : shade(p, 0.45));
  const homeJersey = pick(home[0], home[1]);
  const kit = (jersey: string, p: string, s: string): Kit => {
    const trim = colorDist(s, jersey) > 80 ? s : colorDist(p, jersey) > 80 ? p : shade(jersey, -0.45);
    return { jersey, trim, helmet: shade(colorDist(p, jersey) > 60 ? p : jersey, -0.2), pants: trim };
  };
  const awayJersey = colorDist(homeJersey, WHITE) < 130 ? pick(away[0], away[1]) : WHITE;
  return { home: kit(homeJersey, home[0], home[1]), away: kit(awayJersey, away[0], away[1]) };
}
