import { createBitmap, countInk, cropBitmap, trimBitmap } from './bitmap';
import { CAP_HEIGHT, PAGES } from './charset';
import { filterComponents, labelComponents, type Component } from './components';
import { applyHomography, homographyFromPoints, type Homography } from './homography';
import { adaptiveThreshold, downscaleGray, gaussianBlur, percentile8, sampleBilinear } from './image';
import {
  BASELINE_OFFSET,
  BOX_LINE,
  CAP_OFFSET,
  MARKER_CENTERS,
  codeSquares,
  decodePageCode,
  pageCells,
  type CellLayout,
} from './template';
import { newId, type Bitmap, type GlyphSource, type GrayImage, type Point } from './types';

/** Resolution boxes are resampled at before tracing. */
export const PX_PER_MM = 10;
const UNITS_PER_MM = CAP_HEIGHT / (BASELINE_OFFSET - CAP_OFFSET);

export interface ScanOptions {
  /** A pixel counts as ink when darker than this fraction of the paper brightness around it. */
  inkRatio?: number;
}

export const DEFAULT_INK_RATIO = 0.62;

export interface ScannedCell {
  char: string;
  glyph: GlyphSource | null;
}

export interface ScanResult {
  pageId: number;
  cells: ScannedCell[];
  /** Frame millimetres → image pixels. */
  homography: Homography;
  markers: Point[];
}

export class ScanError extends Error {}

/**
 * Finds the four solid corner squares. Returns their centres in image
 * coordinates ordered top-left, top-right, bottom-right, bottom-left as they
 * appear in the image (the page itself may be rotated).
 */
export function findMarkers(gray: GrayImage): Point[] {
  const { width: w, height: h } = gray;
  const bin = adaptiveThreshold(gray, Math.max(w, h) / 6, 0.25);
  const { components } = labelComponents(bin);
  const imageArea = w * h;
  const candidates = components
    .filter((c) => {
      const bw = c.x1 - c.x0;
      const bh = c.y1 - c.y0;
      if (c.x0 === 0 || c.y0 === 0 || c.x1 === w || c.y1 === h) return false;
      if (c.area < imageArea * 0.00006 || c.area > imageArea * 0.03) return false;
      const aspect = bw / bh;
      if (aspect < 0.6 || aspect > 1 / 0.6) return false;
      return c.area / (bw * bh) > 0.68;
    })
    .sort((a, b) => b.area - a.area)
    .slice(0, 12);
  if (candidates.length < 4) {
    throw new ScanError(
      "Couldn't find the four black corner squares. Make sure the whole page is in the photo, flat and evenly lit.",
    );
  }

  let best: { score: number; pts: Component[] } | null = null;
  const n = candidates.length;
  for (let a = 0; a < n; a += 1)
    for (let b = a + 1; b < n; b += 1)
      for (let c = b + 1; c < n; c += 1)
        for (let d = c + 1; d < n; d += 1) {
          const set = [candidates[a], candidates[b], candidates[c], candidates[d]];
          const areas = set.map((s) => s.area);
          if (Math.max(...areas) / Math.min(...areas) > 3) continue;
          const ordered = orderQuad(set.map((s) => ({ x: s.cx, y: s.cy })));
          if (!ordered) continue;
          const area = polygonArea(ordered);
          if (area < imageArea * 0.08) continue;
          if (!best || area > best.score) best = { score: area, pts: set };
        }
  if (!best) {
    throw new ScanError(
      "Couldn't find the four black corner squares. Make sure the whole page is in the photo, flat and evenly lit.",
    );
  }
  return orderQuad(best.pts.map((s) => ({ x: s.cx, y: s.cy }))) as Point[];
}

/** Orders four points clockwise starting at the top-left; null if they don't form a convex quad. */
function orderQuad(pts: Point[]): Point[] | null {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...pts].sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx));
  let start = 0;
  for (let i = 1; i < 4; i += 1) if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
  const out = [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
  for (let i = 0; i < 4; i += 1) {
    const p = out[i];
    const q = out[(i + 1) % 4];
    const r = out[(i + 2) % 4];
    if ((q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x) <= 0) return null;
  }
  return out;
}

function polygonArea(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

function meanOfRect(gray: GrayImage, h: Homography, x: number, y: number, w: number, hh: number): number {
  let sum = 0;
  const steps = 7;
  for (let j = 0; j < steps; j += 1)
    for (let i = 0; i < steps; i += 1) {
      const p = applyHomography(h, x + ((i + 0.5) * w) / steps, y + ((j + 0.5) * hh) / steps);
      sum += sampleBilinear(gray, p.x, p.y);
    }
  return sum / (steps * steps);
}

/** Reads the page-number squares at the bottom of the frame. */
export function readPageCode(gray: GrayImage, h: Homography): number | null {
  const inset = 0.8;
  const values = codeSquares().map((sq) => meanOfRect(gray, h, sq.x + inset, sq.y + inset, sq.w - 2 * inset, sq.h - 2 * inset));
  const sorted = [...values].sort((a, b) => a - b);
  const dark = (sorted[0] + sorted[1] + sorted[2] + sorted[3]) / 4;
  const light = (sorted[4] + sorted[5] + sorted[6] + sorted[7]) / 4;
  if (light - dark < light * 0.25) return null;
  const mid = (dark + light) / 2;
  return decodePageCode(values.map((v) => (v < mid ? 1 : 0)));
}

/**
 * Finds a box border line near `expected` (in region pixels) by looking for a
 * row/column that is mostly ink. Returns the first pixel inside the box, or
 * null when no clear line is visible.
 */
function findBorder(
  bin: Bitmap,
  vertical: boolean,
  expected: number,
  inward: 1 | -1,
  spanStart: number,
  spanEnd: number,
): number | null {
  const search = 2 * PX_PER_MM;
  const limit = vertical ? bin.width : bin.height;
  const frac = (pos: number): number => {
    if (pos < 0 || pos >= limit) return 0;
    let ink = 0;
    for (let s = spanStart; s < spanEnd; s += 1) ink += vertical ? bin.data[s * bin.width + pos] : bin.data[pos * bin.width + s];
    return ink / Math.max(1, spanEnd - spanStart);
  };
  const from = Math.round(expected - search);
  const to = Math.round(expected + search);
  const fracs: number[] = [];
  for (let pos = from; pos <= to; pos += 1) fracs.push(frac(pos));
  const peakFrac = Math.max(...fracs);
  if (peakFrac < 0.5) return null;
  // Of the strong lines, take the one closest to where the border should be.
  let peak = from;
  for (let pos = from; pos <= to; pos += 1) {
    if (fracs[pos - from] >= peakFrac * 0.85 && Math.abs(pos - expected) < Math.abs(peak - expected)) peak = pos;
  }
  if (fracs[peak - from] < peakFrac * 0.85) peak = from + fracs.indexOf(peakFrac);
  let pos = peak;
  while (frac(pos + inward) >= peakFrac * 0.3 && Math.abs(pos - peak) < PX_PER_MM) pos += inward;
  return pos + inward;
}

/** Resamples one template box, finds its ink and returns it as a glyph (null when empty). */
export function extractCell(gray: GrayImage, h: Homography, cell: CellLayout, inkRatio = DEFAULT_INK_RATIO): GlyphSource | null {
  const margin = 2;
  const rx = cell.box.x - margin;
  const ry = cell.box.y - margin;
  const W = Math.round((cell.box.w + margin * 2) * PX_PER_MM);
  const H = Math.round((cell.box.h + margin * 2) * PX_PER_MM);
  const raw = new Float32Array(W * H);
  for (let v = 0; v < H; v += 1)
    for (let u = 0; u < W; u += 1) {
      const p = applyHomography(h, rx + (u + 0.5) / PX_PER_MM, ry + (v + 0.5) / PX_PER_MM);
      raw[v * W + u] = sampleBilinear(gray, p.x, p.y);
    }
  const paper = percentile8(raw, 0.9);
  const threshold = paper * inkRatio;
  // When the photo has fewer pixels per mm than we resample at, blur more so
  // the enlarged pixels don't turn into jagged edges.
  const c0 = applyHomography(h, cell.box.x, cell.box.y);
  const c1 = applyHomography(h, cell.box.x + cell.box.w, cell.box.y + cell.box.h);
  const sourcePxPerMm = Math.hypot(c1.x - c0.x, c1.y - c0.y) / Math.hypot(cell.box.w, cell.box.h);
  const smooth = gaussianBlur(raw, W, H, 0.6 * Math.max(1, PX_PER_MM / Math.max(1, sourcePxPerMm)));
  const bin = createBitmap(W, H);
  for (let i = 0; i < smooth.length; i += 1) bin.data[i] = smooth[i] < threshold ? 1 : 0;

  // Re-locate the printed box so small registration errors (paper curl, lens
  // distortion) don't leave border fragments in the glyph.
  const m = margin * PX_PER_MM;
  const bw = cell.box.w * PX_PER_MM;
  const bh = cell.box.h * PX_PER_MM;
  const left = findBorder(bin, true, m, 1, Math.round(m + bh * 0.15), Math.round(m + bh * 0.85));
  const right = findBorder(bin, true, m + bw, -1, Math.round(m + bh * 0.15), Math.round(m + bh * 0.85));
  const top = findBorder(bin, false, m, 1, Math.round(m + bw * 0.15), Math.round(m + bw * 0.85));
  const bottom = findBorder(bin, false, m + bh, -1, Math.round(m + bw * 0.15), Math.round(m + bw * 0.85));
  const halfLine = (BOX_LINE / 2) * PX_PER_MM;
  const innerLeft = left ?? m + halfLine + 1;
  const innerRight = right ?? m + bw - halfLine - 1;
  const innerTop = top ?? m + halfLine + 1;
  const innerBottom = bottom ?? m + bh - halfLine - 1;
  const pxPerMm = top !== null && bottom !== null ? (innerBottom - innerTop) / (cell.box.h - BOX_LINE) : PX_PER_MM;
  const baselineInRegion = innerTop + (BASELINE_OFFSET - BOX_LINE / 2) * pxPerMm;

  const inset = Math.round(0.5 * PX_PER_MM);
  const x0 = Math.round(innerLeft) + inset;
  const y0 = Math.round(innerTop) + inset;
  const x1 = Math.round(innerRight) - inset;
  const y1 = Math.round(innerBottom) - inset;
  if (x1 - x0 < PX_PER_MM * 5 || y1 - y0 < PX_PER_MM * 5) return null;
  const interior = cropBitmap(bin, x0, y0, x1 - x0, y1 - y0);
  const iw = interior.width;
  const ih = interior.height;
  const minArea = 12 * (pxPerMm / PX_PER_MM) ** 2;
  const cleaned = filterComponents(interior, (c) => {
    if (c.area < minArea) return false;
    const cw = c.x1 - c.x0;
    const ch = c.y1 - c.y0;
    const touchesEdge = c.x0 === 0 || c.y0 === 0 || c.x1 === iw || c.y1 === ih;
    // Leftover slivers of the printed border hug an edge and are long and thin.
    if (touchesEdge && ((ch <= 5 && cw >= iw * 0.25) || (cw <= 5 && ch >= ih * 0.25))) return false;
    return true;
  });
  if (countInk(cleaned) < 30) return null;
  const trimmed = trimBitmap(cleaned, 2);
  if (!trimmed) return null;
  return {
    id: newId('t'),
    char: cell.char,
    bitmap: trimmed.bitmap,
    unitsPerPx: UNITS_PER_MM / pxPerMm,
    baselineY: baselineInRegion - y0 - trimmed.offsetY,
    origin: 'template',
  };
}

/** Finds the page, works out its orientation and number, and extracts every box. */
export function scanTemplate(gray: GrayImage, options: ScanOptions = {}): ScanResult {
  const { image: small, scale } = downscaleGray(gray, 1400);
  const corners = findMarkers(small).map((p) => ({ x: p.x / scale, y: p.y / scale }));
  for (let rotation = 0; rotation < 4; rotation += 1) {
    const dst = MARKER_CENTERS.map((_, k) => corners[(k + rotation) % 4]);
    let h: Homography;
    try {
      h = homographyFromPoints(MARKER_CENTERS, dst);
    } catch {
      continue;
    }
    const pageId = readPageCode(gray, h);
    if (pageId === null) continue;
    const page = PAGES.find((p) => p.id === pageId);
    if (!page) continue;
    const cells = pageCells(page).map((cell) => ({
      char: cell.char,
      glyph: extractCell(gray, h, cell, options.inkRatio ?? DEFAULT_INK_RATIO),
    }));
    return { pageId, cells, homography: h, markers: dst };
  }
  throw new ScanError(
    "Found the corner squares but couldn't read the page number at the bottom. Retake the photo straight on, without glare.",
  );
}
