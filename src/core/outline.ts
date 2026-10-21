import { adjustWeight, padBitmap, smoothResample } from './bitmap';
import { traceBitmap, type Segment } from './trace';
import type { GlyphSource } from './types';

/** A traced glyph in font units: y points up from the baseline. */
export interface GlyphOutline {
  contours: Segment[][];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Target tracing resolution in font units per pixel. */
const TRACE_UNITS_PER_PX = 5;

/**
 * Traces a handwritten glyph into a vector outline.
 * @param weight stroke thickness change in font units (negative = thinner)
 */
export function outlineGlyph(src: GlyphSource, weight = 0): GlyphOutline {
  const radius = weight / src.unitsPerPx;
  const pad = 4 + Math.ceil(Math.max(0, radius));
  let bmp = padBitmap(src.bitmap, pad);
  bmp = adjustWeight(bmp, radius);
  const q = Math.min(4, Math.max(1, src.unitsPerPx / TRACE_UNITS_PER_PX));
  bmp = smoothResample(bmp, q, Math.max(0.8, q * 0.5));
  const unitsPerPx = src.unitsPerPx / q;
  const baseline = (src.baselineY + pad) * q;
  const tx = (x: number): number => (x - pad * q) * unitsPerPx;
  const ty = (y: number): number => (baseline - y) * unitsPerPx;

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  const grow = (x: number, y: number): void => {
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  };
  const contours = traceBitmap(bmp).map((segs) =>
    segs.map((s): Segment => {
      if (s.type === 'Q') {
        const out = { type: 'Q' as const, cx: tx(s.cx), cy: ty(s.cy), x: tx(s.x), y: ty(s.y) };
        // Quadratic curves stay inside their control hull, so this bounds the ink (slightly generously).
        grow(out.x, out.y);
        grow(out.cx, out.cy);
        return out;
      }
      const out = { type: s.type, x: tx(s.x), y: ty(s.y) };
      grow(out.x, out.y);
      return out;
    }),
  );
  if (!contours.length) return { contours, xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
  return { contours, xMin, xMax, yMin, yMax };
}

/** Applies scale-then-translate to an outline. */
export function transformOutline(o: GlyphOutline, scale: number, dx: number, dy: number): GlyphOutline {
  const X = (x: number): number => x * scale + dx;
  const Y = (y: number): number => y * scale + dy;
  return {
    contours: o.contours.map((segs) =>
      segs.map((s) =>
        s.type === 'Q' ? { type: 'Q', cx: X(s.cx), cy: Y(s.cy), x: X(s.x), y: Y(s.y) } : { type: s.type, x: X(s.x), y: Y(s.y) },
      ),
    ),
    xMin: X(o.xMin),
    xMax: X(o.xMax),
    yMin: Y(o.yMin),
    yMax: Y(o.yMax),
  };
}

/** SVG path data (y flipped so it can be drawn directly in a y-down viewBox). */
export function outlineToSvgPath(o: GlyphOutline): string {
  const f = (n: number): string => (Math.round(n * 10) / 10).toString();
  return o.contours
    .map(
      (segs) =>
        segs
          .map((s) => (s.type === 'Q' ? `Q${f(s.cx)} ${f(-s.cy)} ${f(s.x)} ${f(-s.y)}` : `${s.type}${f(s.x)} ${f(-s.y)}`))
          .join('') + 'Z',
    )
    .join('');
}
