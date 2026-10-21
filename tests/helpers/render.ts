import { applyHomography, homographyFromPoints } from '../../src/core/homography';
import { pagePrimitives, FRAME_H, FRAME_W, type Primitive } from '../../src/core/template';
import type { CharPage } from '../../src/core/charset';
import type { GrayImage, Point } from '../../src/core/types';

/** Something that puts ink on the page: returns ink coverage 0..1 at a point in frame mm. */
export interface Ink {
  bbox: { x0: number; y0: number; x1: number; y1: number };
  level: number; // 0 = black, 1 = paper
  at(x: number, y: number): boolean;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Brightness (0..1) of a grey hex colour such as #000 or #b8b8b8. */
const gray = (hex: string): number => {
  const h = hex.replace('#', '');
  return parseInt(h.length === 3 ? h[0] + h[0] : h.slice(0, 2), 16) / 255;
};

export function primitiveInks(prims: Primitive[]): Ink[] {
  const out: Ink[] = [];
  for (const p of prims) {
    if (p.kind === 'rect') {
      if (p.fill) {
        out.push({
          bbox: { x0: p.x, y0: p.y, x1: p.x + p.w, y1: p.y + p.h },
          level: gray(p.fill),
          at: (x, y) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h,
        });
      }
      if (p.stroke) {
        const hw = (p.strokeWidth ?? 0.3) / 2;
        out.push({
          bbox: { x0: p.x - hw, y0: p.y - hw, x1: p.x + p.w + hw, y1: p.y + p.h + hw },
          level: gray(p.stroke),
          at: (x, y) =>
            x >= p.x - hw &&
            x <= p.x + p.w + hw &&
            y >= p.y - hw &&
            y <= p.y + p.h + hw &&
            !(x > p.x + hw && x < p.x + p.w - hw && y > p.y + hw && y < p.y + p.h - hw),
        });
      }
    } else if (p.kind === 'line') {
      const hw = p.strokeWidth / 2;
      out.push({
        bbox: { x0: Math.min(p.x1, p.x2) - hw, y0: Math.min(p.y1, p.y2) - hw, x1: Math.max(p.x1, p.x2) + hw, y1: Math.max(p.y1, p.y2) + hw },
        level: gray(p.stroke),
        at: (x, y) => distToSegment(x, y, p.x1, p.y1, p.x2, p.y2) <= hw,
      });
    }
  }
  return out;
}

/** A pen stroke along a polyline (frame mm). */
export function stroke(points: Point[], width = 0.7): Ink {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const hw = width / 2;
  return {
    bbox: { x0: Math.min(...xs) - hw, y0: Math.min(...ys) - hw, x1: Math.max(...xs) + hw, y1: Math.max(...ys) + hw },
    level: 0.12,
    at: (x, y) => {
      for (let i = 0; i + 1 < points.length; i += 1) {
        if (distToSegment(x, y, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y) <= hw) return true;
      }
      return false;
    },
  };
}

export function ring(cx: number, cy: number, r: number, width = 0.7): Ink {
  return {
    bbox: { x0: cx - r - width, y0: cy - r - width, x1: cx + r + width, y1: cy + r + width },
    level: 0.12,
    at: (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r) <= width / 2,
  };
}

export function disc(cx: number, cy: number, r: number): Ink {
  return {
    bbox: { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r },
    level: 0.12,
    at: (x, y) => Math.hypot(x - cx, y - cy) <= r,
  };
}

export interface PhotoOptions {
  width: number;
  height: number;
  /** Where the four frame corners (TL, TR, BR, BL of the frame) land in the image. */
  corners: Point[];
  noise?: number;
  seed?: number;
}

/**
 * Renders a template page plus handwriting as a fake phone photo: perspective,
 * a lighting gradient, a dark table around the paper and sensor noise.
 */
export function renderPhoto(page: CharPage, extra: Ink[], options: PhotoOptions): GrayImage {
  const inks = [...primitiveInks(pagePrimitives(page).filter((p) => p.kind !== 'text')), ...extra];
  const frameCorners = [
    { x: 0, y: 0 },
    { x: FRAME_W, y: 0 },
    { x: FRAME_W, y: FRAME_H },
    { x: 0, y: FRAME_H },
  ];
  const imgToFrame = homographyFromPoints(options.corners, frameCorners);

  const bucket = 10;
  const cols = Math.ceil((FRAME_W + 40) / bucket);
  const rows = Math.ceil((FRAME_H + 40) / bucket);
  const grid: Ink[][] = Array.from({ length: cols * rows }, () => []);
  for (const ink of inks) {
    for (let by = Math.floor((ink.bbox.y0 + 20) / bucket); by <= Math.floor((ink.bbox.y1 + 20) / bucket); by += 1)
      for (let bx = Math.floor((ink.bbox.x0 + 20) / bucket); bx <= Math.floor((ink.bbox.x1 + 20) / bucket); bx += 1)
        if (bx >= 0 && by >= 0 && bx < cols && by < rows) grid[by * cols + bx].push(ink);
  }

  let seed = options.seed ?? 1;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const data = new Uint8ClampedArray(options.width * options.height);
  const ss = [0.25, 0.75];
  for (let py = 0; py < options.height; py += 1) {
    for (let px = 0; px < options.width; px += 1) {
      let acc = 0;
      for (const sy of ss)
        for (const sx of ss) {
          const f = applyHomography(imgToFrame, px + sx, py + sy);
          const onPaper = f.x >= -15 && f.x <= FRAME_W + 15 && f.y >= -15 && f.y <= FRAME_H + 15;
          if (!onPaper) {
            acc += 70;
            continue;
          }
          const paper = 205 + 40 * (px / options.width) + 5 * (py / options.height);
          let level = 1;
          const bx = Math.floor((f.x + 20) / bucket);
          const by = Math.floor((f.y + 20) / bucket);
          if (bx >= 0 && by >= 0 && bx < cols && by < rows) {
            for (const ink of grid[by * cols + bx]) if (ink.level < level && ink.at(f.x, f.y)) level = ink.level;
          }
          acc += paper * level;
        }
      data[py * options.width + px] = acc / 4 + ((rand() - 0.5) * 2 * (options.noise ?? 6));
    }
  }
  return { width: options.width, height: options.height, data };
}
