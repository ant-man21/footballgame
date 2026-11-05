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

export type TeamColor = 'blue' | 'red';
export type Build = 'qb' | 'skill' | 'big';

const cache = new Map<string, HTMLCanvasElement>();

/** A player sprite: team colour, build, which way he faces, and classic (7px) or slim (5px). */
export function playerSprite(team: TeamColor, build: Build, facing: 'up' | 'down', classic: boolean): HTMLCanvasElement {
  const key = `${team}/${build}/${facing}/${classic}`;
  let img = cache.get(key);
  if (!img) {
    let pal = team === 'blue' ? BLUE : RED;
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
