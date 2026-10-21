import { createBitmap } from '../../src/core/bitmap';
import type { Bitmap, GlyphSource } from '../../src/core/types';

/** Rasterises a shape given as an inside-test on pixel centres. */
export function bitmapFrom(width: number, height: number, inside: (x: number, y: number) => boolean): Bitmap {
  const b = createBitmap(width, height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) b.data[y * width + x] = inside(x + 0.5, y + 0.5) ? 1 : 0;
  return b;
}

let n = 0;

/** A glyph whose bitmap is `height` px tall and sits on the baseline (unless `drop` px lower). */
export function glyph(char: string, bitmap: Bitmap, opts: { unitsPerPx?: number; drop?: number } = {}): GlyphSource {
  n += 1;
  return {
    id: `test-${n}`,
    char,
    bitmap,
    unitsPerPx: opts.unitsPerPx ?? 7,
    baselineY: bitmap.height - 2 - (opts.drop ?? 0),
    origin: 'drawn',
  };
}

/** A vertical bar, like a written "I" or "l". */
export const bar = (h = 104, w = 12): Bitmap => bitmapFrom(w + 4, h + 4, (x, y) => x >= 2 && x <= w + 2 && y >= 2 && y <= h + 2);

/** A ring, like a written "O". */
export const ringBitmap = (r = 50, stroke = 10): Bitmap =>
  bitmapFrom(2 * r + 4, 2 * r + 4, (x, y) => Math.abs(Math.hypot(x - r - 2, y - r - 2) - (r - stroke / 2)) <= stroke / 2);

export const dotBitmap = (r = 6): Bitmap => bitmapFrom(2 * r + 4, 2 * r + 4, (x, y) => Math.hypot(x - r - 2, y - r - 2) <= r);
