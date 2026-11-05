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
const PLAYER_UP = [
  '..MMM..',
  '.HHHHH.',
  '.HHHHH.',
  'SJJJJJS',
  'SJJNJJS',
  '.JJJJJ.',
  '..P.P..',
];
const PLAYER_DOWN = [...PLAYER_UP].reverse();

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
const BIG_DOWN = [...BIG_UP].reverse();

const OFFENSE: Palette = { M: '#c2c3c7', H: '#1d2b53', S: '#1d6fb8', J: '#29adff', N: '#fff1e8', P: '#fff1e8' };
const QB: Palette = { ...OFFENSE, H: '#ffec27', N: '#1d2b53' };
const DEFENSE: Palette = { M: '#c2c3c7', H: '#7e2553', S: '#b8003a', J: '#ff004d', N: '#fff1e8', P: '#5f574f' };

const BALL = ['.BB.', 'BWWB', '.BB.'];

export type SpriteName = 'off' | 'offBig' | 'qb' | 'def' | 'defBig' | 'ball';
let cache: Record<SpriteName, HTMLCanvasElement> | null = null;

export function sprites(): Record<SpriteName, HTMLCanvasElement> {
  cache ??= {
    off: bake(PLAYER_UP, OFFENSE),
    offBig: bake(BIG_UP, OFFENSE),
    defBig: bake(BIG_DOWN, DEFENSE),
    qb: bake(PLAYER_UP, QB),
    def: bake(PLAYER_DOWN, DEFENSE),
    ball: bake(BALL, { B: '#ab5236', W: '#fff1e8' }),
  };
  return cache;
}

export function drawCentered(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, x: number, y: number): void {
  ctx.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height / 2));
}
