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

/** Perceptual colour difference (CIE76 delta E in Lab): ~25 is "similar", 50+ reads clearly apart. */
export function deltaE(a: string, b: string): number {
  const lab = (h: string) => {
    const [r, g, bl] = rgb(h).map((c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
    const x = t((0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.9505), y = t(0.2126 * r + 0.7152 * g + 0.0722 * bl), z = t((0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.089);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const p = lab(a), q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** The first candidate at least `min` apart from every colour in `from`, else the one furthest apart. */
function apart(cands: string[], from: string[], min: number): string {
  const gap = (c: string) => Math.min(...from.map((f) => deltaE(c, f)));
  return cands.find((c) => gap(c) >= min) ?? cands.reduce((best, c) => (gap(c) > gap(best) ? c : best));
}

/**
 * Uniforms for a game between two schools ([primary, secondary] colours): the
 * home team wears its colours, the visitors wear white with their colours as
 * trim. A jersey that would vanish into the green field uses the other school
 * colour. The visitors then make sure they can't be mistaken for the home team:
 * a jersey that clearly differs (white, their colours, a dark or light version,
 * or a neutral alternate), and a helmet and pants that differ too (two red
 * schools: red with white pants at home, all white with white helmets away).
 */
export function kitsFor(home: [string, string], away: [string, string]): { home: Kit; away: Kit } {
  const visible = (c: string) => colorDist(c, FIELD) >= 90;
  const pick = (p: string, s: string) => (visible(p) ? p : visible(s) ? s : shade(p, 0.45));
  const kit = (jersey: string, p: string, s: string): Kit => {
    const trim = colorDist(s, jersey) > 80 ? s : colorDist(p, jersey) > 80 ? p : shade(jersey, -0.45);
    return { jersey, trim, helmet: shade(colorDist(p, jersey) > 60 ? p : jersey, -0.2), pants: trim };
  };
  const h = kit(pick(home[0], home[1]), home[0], home[1]);
  const jerseys = [WHITE, pick(away[0], away[1]), away[0], away[1], shade(away[0], -0.55), shade(away[0], 0.55), '#1d2b53', '#111d2b', '#c8102e']
    .filter(visible);
  const a = kit(apart(jerseys, [h.jersey], 50), away[0], away[1]);
  // helmets and pants: the home team keeps its own, the visitors change theirs if they look alike
  if (deltaE(a.helmet, h.helmet) < 40) a.helmet = apart([a.jersey === WHITE ? '#e4e6ea' : shade(a.jersey, -0.2), shade(a.trim, -0.2), '#e4e6ea', '#1d2b53'], [h.helmet], 40);
  if (deltaE(a.pants, h.pants) < 40) a.pants = apart([a.jersey, a.trim, WHITE, '#5f574f'], [h.pants], 40);
  return { home: h, away: a };
}
