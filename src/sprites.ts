// Pixel-art sprites defined as character maps and baked into small canvases.
type Palette = Record<string, string>;

function bake(rows: string[], palette: Palette): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = rows[0].length;
  c.height = rows.length;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (palette[ch]) { ctx.fillStyle = palette[ch]; ctx.fillRect(x, y, 1, 1); }
  }));
  return c;
}

// Top-down player facing up the field: facemask (M) at the front.
// Kept small (5px, about 1.6 yards) so passing windows read clearly.
const PLAYER_UP = [
  '.MMM.',
  '.HHH.',
  'SJJJS',
  'SJNJS',
  '.JJJ.',
  '.P.P.',
];

// The original, chunkier 7px player, used in landscape where the field is bigger.
const CLASSIC_UP = [
  '..MMM..',
  '.HHHHH.',
  '.HHHHH.',
  'SJJJJJS',
  'SJJNJJS',
  '.JJJJJ.',
  '..P.P..',
];

// Linemen: same idea, wider shoulders.
const BIG_UP = [
  '...MMM...',
  '..HHHHH..',
  '..HHHHH..',
  'SSJJJJJSS',
  'SSJJNJJSS',
  '.JJJJJJJ.',
  '..PP.PP..',
];

// Team colours. You are always blue; the CPU is red. Either team can be on
// offense (facing up the screen) or defense (facing down).
const BLUE: Palette = { M: '#c2c3c7', H: '#1d2b53', S: '#1d6fb8', J: '#29adff', N: '#fff1e8', P: '#fff1e8' };
const RED: Palette = { M: '#c2c3c7', H: '#7e2553', S: '#b8003a', J: '#ff004d', N: '#fff1e8', P: '#5f574f' };

const BALL = ['.BB.', 'BWWB', '.BB.'];

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
export type Build = 'qb' | 'skill' | 'big';

const cache = new Map<string, HTMLCanvasElement>();

/** A player sprite: team colour, build, which way he faces, and classic (7px) or slim (5px). */
export function playerSprite(team: TeamColor, build: Build, facing: 'up' | 'down', classic: boolean): HTMLCanvasElement {
  const key = `${typeof team === 'string' ? team : `${team.jersey}${team.trim}${team.helmet}`}/${build}/${facing}/${classic}`;
  let img = cache.get(key);
  if (!img) {
    let pal = team === 'blue' ? BLUE : team === 'red' ? RED
      : { M: '#c2c3c7', H: team.helmet, S: team.trim, J: team.jersey, N: team.trim, P: team.pants };
    if (build === 'qb') pal = { ...pal, H: '#ffec27', N: '#1d2b53' };
    const up = build === 'big' ? BIG_UP : classic ? CLASSIC_UP : PLAYER_UP;
    img = bake(facing === 'up' ? up : [...up].reverse(), pal);
    cache.set(key, img);
  }
  return img;
}

let ball: HTMLCanvasElement | null = null;
export function ballSprite(): HTMLCanvasElement {
  ball ??= bake(BALL, { B: '#ab5236', W: '#fff1e8' });
  return ball;
}

export function drawCentered(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number): void {
  ctx.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height / 2));
}
