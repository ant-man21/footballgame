// How the field (world coordinates: 180 x 320, the portrait layout) maps onto
// the screen. Portrait draws it 1:1. Landscape turns the phone sideways but
// keeps the play running up the screen: the field's width gets the long side,
// so everything is about 1.3x bigger, with the HUD in panels at the sides.
import { LOS_Y, QB_DEPTH, W, YD } from './config';

export interface View {
  landscape: boolean;
  w: number; // canvas size (logical pixels)
  h: number;
  s: number; // world -> screen scale
  ox: number; // screen x of world x = 0
  oy: number; // screen y of world y = 0 (before the camera scrolls)
  panel: number; // width of each side panel (landscape)
  camAnchor: number; // world y above which the camera starts following the ball
}

export const PORTRAIT: View = { landscape: false, w: 180, h: 320, s: 1, ox: 0, oy: 0, panel: 0, camAnchor: 130 };

const MIN_PANEL = 42;
const LS = (320 - MIN_PANEL * 2) / W; // field scale in landscape, ~1.31
const QB_SCREEN_Y = 166; // where the QB sits on a landscape screen

/**
 * Landscape view for a screen of the given aspect ratio (width / height).
 * The field is always the same size; wider phones just get wider side panels,
 * so there are no empty bars.
 */
export function landscapeView(aspect: number): View {
  const h = 180;
  const w = Math.round(Math.min(Math.max(h * aspect, 320), 440));
  const panel = Math.floor((w - W * LS) / 2);
  const oy = QB_SCREEN_Y - (LOS_Y + QB_DEPTH * YD) * LS;
  return { landscape: true, w, h, s: LS, ox: panel, oy, panel, camAnchor: (52 - oy) / LS };
}

export const LANDSCAPE: View = landscapeView(16 / 9);
