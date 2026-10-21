import { gaussianBlur } from './image';
import type { Bitmap } from './types';

export function createBitmap(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8Array(width * height) };
}

export function cropBitmap(b: Bitmap, x: number, y: number, w: number, h: number): Bitmap {
  const out = createBitmap(w, h);
  for (let yy = 0; yy < h; yy += 1) {
    const sy = y + yy;
    if (sy < 0 || sy >= b.height) continue;
    for (let xx = 0; xx < w; xx += 1) {
      const sx = x + xx;
      if (sx < 0 || sx >= b.width) continue;
      out.data[yy * w + xx] = b.data[sy * b.width + sx];
    }
  }
  return out;
}

export function padBitmap(b: Bitmap, pad: number): Bitmap {
  return cropBitmap(b, -pad, -pad, b.width + pad * 2, b.height + pad * 2);
}

export function countInk(b: Bitmap): number {
  let n = 0;
  for (let i = 0; i < b.data.length; i += 1) n += b.data[i];
  return n;
}

/** Bounding box of the ink, with exclusive x1/y1; null when the bitmap is empty. */
export function inkBounds(b: Bitmap): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = b.width;
  let y0 = b.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < b.height; y += 1) {
    for (let x = 0; x < b.width; x += 1) {
      if (!b.data[y * b.width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Trims empty space around the ink, keeping `pad` pixels; reports the offset of the new origin. */
export function trimBitmap(b: Bitmap, pad: number): { bitmap: Bitmap; offsetX: number; offsetY: number } | null {
  const bounds = inkBounds(b);
  if (!bounds) return null;
  const x = bounds.x0 - pad;
  const y = bounds.y0 - pad;
  return {
    bitmap: cropBitmap(b, x, y, bounds.x1 - bounds.x0 + pad * 2, bounds.y1 - bounds.y0 + pad * 2),
    offsetX: x,
    offsetY: y,
  };
}

// One-dimensional squared distance transform (Felzenszwalb & Huttenlocher).
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Squared Euclidean distance from every pixel to the nearest pixel whose value equals `target`. */
export function squaredDistanceTo(b: Bitmap, target: 0 | 1): Float64Array {
  const { width: w, height: h } = b;
  const INF = 1e20;
  const grid = new Float64Array(w * h);
  for (let i = 0; i < grid.length; i += 1) grid[i] = b.data[i] === target ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y += 1) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) f[x] = grid[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x += 1) grid[y * w + x] = d[x];
  }
  return grid;
}

/**
 * Makes strokes thicker (radius > 0) or thinner (radius < 0) by `radius`
 * pixels, keeping the bitmap size (pad first to leave room to grow).
 * Thinning never removes a stroke completely: pixels near the stroke's centre
 * line survive so letters keep their shape.
 */
export function adjustWeight(b: Bitmap, radius: number): Bitmap {
  if (Math.abs(radius) < 0.25) return b;
  if (radius > 0) {
    const dist = squaredDistanceTo(b, 1);
    const r2 = radius * radius;
    const out = createBitmap(b.width, b.height);
    for (let i = 0; i < dist.length; i += 1) out.data[i] = dist[i] <= r2 ? 1 : 0;
    return out;
  }
  const r = -radius;
  const minHalfWidth = 1.5;
  const { width: w, height: h } = b;
  const depth = squaredDistanceTo(b, 0).map(Math.sqrt);
  // Local stroke half-width: the deepest point within reach of each pixel.
  const halfWidth = maxFilter(depth, w, h, Math.ceil(r + minHalfWidth));
  const out = createBitmap(w, h);
  for (let i = 0; i < depth.length; i += 1) {
    if (!b.data[i]) continue;
    // Erode by `r`, but never past the point where the stroke gets thinner than the minimum.
    if (depth[i] > Math.min(r, halfWidth[i] - minHalfWidth)) out.data[i] = 1;
  }
  return out;
}

/** Separable square max filter. */
function maxFilter(src: Float64Array, w: number, h: number, radius: number): Float64Array {
  const tmp = new Float64Array(src.length);
  const out = new Float64Array(src.length);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      let m = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(w - 1, x + radius); k += 1) m = Math.max(m, src[y * w + k]);
      tmp[y * w + x] = m;
    }
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      let m = 0;
      for (let k = Math.max(0, y - radius); k <= Math.min(h - 1, y + radius); k += 1) m = Math.max(m, tmp[k * w + x]);
      out[y * w + x] = m;
    }
  return out;
}

/**
 * Resamples a bitmap by `scale`, smoothing jagged pixel edges on the way:
 * the 0/1 image is interpolated, blurred and re-thresholded at 50%.
 */
export function smoothResample(b: Bitmap, scale: number, sigma: number): Bitmap {
  const w = Math.max(1, Math.round(b.width * scale));
  const h = Math.max(1, Math.round(b.height * scale));
  const field = new Float32Array(w * h);
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= b.width || y >= b.height ? 0 : b.data[y * b.width + x];
  for (let y = 0; y < h; y += 1) {
    const sy = (y + 0.5) / scale - 0.5;
    const y0 = Math.floor(sy);
    const ty = sy - y0;
    for (let x = 0; x < w; x += 1) {
      const sx = (x + 0.5) / scale - 0.5;
      const x0 = Math.floor(sx);
      const tx = sx - x0;
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
      const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
      field[y * w + x] = top * (1 - ty) + bottom * ty;
    }
  }
  const blurred = gaussianBlur(field, w, h, sigma);
  const out = createBitmap(w, h);
  for (let i = 0; i < blurred.length; i += 1) out.data[i] = blurred[i] >= 0.5 ? 1 : 0;
  return out;
}

/** Compact run-length + base64 encoding, used to persist glyphs in localStorage. */
export function encodeBitmap(b: Bitmap): string {
  const bytes: number[] = [];
  const pushVarint = (n: number): void => {
    let v = n;
    while (v >= 0x80) {
      bytes.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    bytes.push(v);
  };
  pushVarint(b.width);
  pushVarint(b.height);
  let current = 0;
  let run = 0;
  for (let i = 0; i < b.data.length; i += 1) {
    if (b.data[i] === current) {
      run += 1;
    } else {
      pushVarint(run);
      current = b.data[i];
      run = 1;
    }
  }
  pushVarint(run);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBitmap(s: string): Bitmap {
  const binary = atob(s);
  let pos = 0;
  const readVarint = (): number => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = binary.charCodeAt(pos);
      pos += 1;
      result += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return result;
      shift += 7;
    }
  };
  const width = readVarint();
  const height = readVarint();
  const out = createBitmap(width, height);
  let i = 0;
  let value = 0;
  while (pos < binary.length && i < out.data.length) {
    const run = readVarint();
    if (value) out.data.fill(1, i, i + run);
    i += run;
    value = 1 - value;
  }
  return out;
}
