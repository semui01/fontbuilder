export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 8-bit grayscale image: 0 = black, 255 = white. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Binary image: 1 = ink, 0 = paper. */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

export type GlyphOrigin = 'template' | 'photo' | 'drawn';

/** One handwritten character, ready to be traced into a font outline. */
export interface GlyphSource {
  /** Unique id; traced outlines are cached by it. */
  id: string;
  char: string;
  bitmap: Bitmap;
  /** Font units per bitmap pixel. */
  unitsPerPx: number;
  /** Bitmap row (may be fractional) that sits on the baseline. */
  baselineY: number;
  origin: GlyphOrigin;
}

let idCounter = 0;

export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
