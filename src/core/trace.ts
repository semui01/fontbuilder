import type { Bitmap, Point } from './types';

/** Outline drawing commands (TrueType-style quadratic curves). */
export type Segment =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'Q'; cx: number; cy: number; x: number; y: number };

const EAST = 1;
const SOUTH = 2;
const WEST = 4;
const NORTH = 8;
const STEP: Record<number, [number, number]> = { [EAST]: [1, 0], [SOUTH]: [0, 1], [WEST]: [-1, 0], [NORTH]: [0, -1] };
const RIGHT_OF: Record<number, number> = { [EAST]: SOUTH, [SOUTH]: WEST, [WEST]: NORTH, [NORTH]: EAST };

/**
 * Traces the boundaries between ink and paper. Each contour is returned as the
 * midpoints of its pixel edges (which removes the staircase on diagonals), in
 * pixel coordinates with y pointing down. Outer boundaries wind with negative
 * shoelace area and holes with positive area. Diagonally touching pixels are
 * treated as connected.
 */
export function traceContours(b: Bitmap): Point[][] {
  const { width: w, height: h } = b;
  const vw = w + 1;
  const out = new Uint8Array(vw * (h + 1));
  const ink = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && b.data[y * w + x] === 1;
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      if (!ink(x, y)) continue;
      // Edges are directed so that ink is on the left when walking along them.
      if (!ink(x, y - 1)) out[y * vw + x + 1] |= WEST;
      if (!ink(x, y + 1)) out[(y + 1) * vw + x] |= EAST;
      if (!ink(x - 1, y)) out[y * vw + x] |= SOUTH;
      if (!ink(x + 1, y)) out[(y + 1) * vw + x + 1] |= NORTH;
    }

  const contours: Point[][] = [];
  for (let start = 0; start < out.length; start += 1) {
    const bits = out[start];
    // Start only at vertices with a single outgoing edge (never at a saddle).
    if (!bits || (bits & (bits - 1)) !== 0) continue;
    const points: Point[] = [];
    let cur = start;
    let dir = bits;
    for (;;) {
      out[cur] &= ~dir;
      const cx = cur % vw;
      const cy = (cur - cx) / vw;
      const [dx, dy] = STEP[dir];
      points.push({ x: cx + dx / 2, y: cy + dy / 2 });
      cur = (cy + dy) * vw + cx + dx;
      const next = out[cur];
      if (!next) break;
      dir = (next & (next - 1)) === 0 ? next : RIGHT_OF[dir];
    }
    contours.push(points);
  }
  return contours;
}

export function signedArea(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

/** Gaussian smoothing of a closed point sequence; removes pixel-level wobble. */
export function smoothClosed(pts: Point[], sigma: number): Point[] {
  const n = pts.length;
  if (sigma <= 0 || n < 5) return pts;
  const radius = Math.min(Math.floor((n - 1) / 2), Math.ceil(sigma * 2.5));
  const weights: number[] = [];
  let total = 0;
  for (let k = -radius; k <= radius; k += 1) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    weights.push(w);
    total += w;
  }
  return pts.map((_, i) => {
    let x = 0;
    let y = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const p = pts[(i + k + n) % n];
      const w = weights[k + radius];
      x += p.x * w;
      y += p.y * w;
    }
    return { x: x / total, y: y / total };
  });
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Ramer-Douglas-Peucker on an open polyline; keeps both endpoints. */
function simplifyOpen(pts: Point[], epsilon: number): Point[] {
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i += 1) {
      const d = distanceToSegment(pts[i], pts[a], pts[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplifies a closed polygon, splitting it at the point farthest from the first. */
export function simplifyClosed(pts: Point[], epsilon: number): Point[] {
  if (pts.length < 4) return pts;
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i += 1) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const first = simplifyOpen(pts.slice(0, far + 1), epsilon);
  const second = simplifyOpen([...pts.slice(far), pts[0]], epsilon);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

export interface CurveOptions {
  /** Turns sharper than this (radians) stay as hard corners. */
  cornerAngle: number;
  /** Turns sharper than this (radians) are rounded off with at most `maxRadius`. */
  roundAngle: number;
  /** Largest rounding radius used at noticeable turns, in pixels. */
  maxRadius: number;
}

export const DEFAULT_CURVE_OPTIONS: CurveOptions = {
  cornerAngle: (130 * Math.PI) / 180,
  roundAngle: (50 * Math.PI) / 180,
  maxRadius: 4,
};

/**
 * Converts a simplified polygon into a smooth closed outline: every vertex
 * becomes the control point of a quadratic curve, except very sharp corners.
 * Gentle curves are smoothed fully; sharper turns are rounded with a bounded
 * radius so long straight strokes keep their ends.
 */
export function polygonToCurves(poly: Point[], options: CurveOptions = DEFAULT_CURVE_OPTIONS): Segment[] {
  const n = poly.length;
  if (n < 3) return [];
  const into: Point[] = [];
  const outOf: Point[] = [];
  const corner: boolean[] = [];
  for (let i = 0; i < n; i += 1) {
    const prev = poly[(i + n - 1) % n];
    const v = poly[i];
    const next = poly[(i + 1) % n];
    const ax = v.x - prev.x;
    const ay = v.y - prev.y;
    const bx = next.x - v.x;
    const by = next.y - v.y;
    const lenIn = Math.hypot(ax, ay);
    const lenOut = Math.hypot(bx, by);
    const cos = (ax * bx + ay * by) / Math.max(1e-9, lenIn * lenOut);
    const turn = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (turn >= options.cornerAngle) {
      corner.push(true);
      into.push(v);
      outOf.push(v);
      continue;
    }
    let dIn = lenIn / 2;
    let dOut = lenOut / 2;
    if (turn > options.roundAngle) {
      const cap = options.maxRadius * Math.tan(turn / 2);
      dIn = Math.min(dIn, cap);
      dOut = Math.min(dOut, cap);
    }
    corner.push(false);
    into.push({ x: v.x - (ax / lenIn) * dIn, y: v.y - (ay / lenIn) * dIn });
    outOf.push({ x: v.x + (bx / lenOut) * dOut, y: v.y + (by / lenOut) * dOut });
  }

  const segs: Segment[] = [{ type: 'M', x: into[0].x, y: into[0].y }];
  for (let i = 0; i < n; i += 1) {
    if (corner[i]) {
      if (i > 0) segs.push({ type: 'L', x: poly[i].x, y: poly[i].y });
    } else {
      segs.push({ type: 'Q', cx: poly[i].x, cy: poly[i].y, x: outOf[i].x, y: outOf[i].y });
    }
    const next = (i + 1) % n;
    if (next !== 0 && Math.hypot(outOf[i].x - into[next].x, outOf[i].y - into[next].y) > 1e-3) {
      segs.push({ type: 'L', x: into[next].x, y: into[next].y });
    }
  }
  return segs;
}

/** Full tracing pipeline: bitmap → smooth closed outlines in pixel coordinates. */
export function traceBitmap(b: Bitmap, smoothing = 1.6, epsilon = 0.5, minArea = 3): Segment[][] {
  return traceContours(b)
    .filter((c) => Math.abs(signedArea(c)) >= minArea)
    .map((c) => simplifyClosed(smoothClosed(c, smoothing), epsilon))
    .filter((c) => c.length >= 3)
    .map((c) => polygonToCurves(c));
}
