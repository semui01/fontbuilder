import type { Bitmap, GrayImage } from './types';

export function createGray(width: number, height: number, fill = 255): GrayImage {
  const data = new Uint8ClampedArray(width * height);
  data.fill(fill);
  return { width, height, data };
}

/** Converts RGBA pixels to luminance. Transparent pixels are treated as white paper. */
export function rgbaToGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < out.length; i += 1, j += 4) {
    const a = rgba[j + 3] / 255;
    const lum = 0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2];
    out[i] = lum * a + 255 * (1 - a);
  }
  return { width, height, data: out };
}

/** Area-averaging downscale so the longest side is at most `maxDim`. */
export function downscaleGray(img: GrayImage, maxDim: number): { image: GrayImage; scale: number } {
  const longest = Math.max(img.width, img.height);
  if (longest <= maxDim) return { image: img, scale: 1 };
  const scale = maxDim / longest;
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const sum = new Float64Array(w * h);
  const count = new Uint32Array(w * h);
  const xMap = new Int32Array(img.width);
  for (let x = 0; x < img.width; x += 1) xMap[x] = Math.min(w - 1, Math.floor((x * w) / img.width));
  for (let y = 0; y < img.height; y += 1) {
    const dy = Math.min(h - 1, Math.floor((y * h) / img.height)) * w;
    const row = y * img.width;
    for (let x = 0; x < img.width; x += 1) {
      const d = dy + xMap[x];
      sum[d] += img.data[row + x];
      count[d] += 1;
    }
  }
  const data = new Uint8ClampedArray(w * h);
  for (let i = 0; i < data.length; i += 1) data[i] = count[i] ? sum[i] / count[i] : 255;
  return { image: { width: w, height: h, data }, scale: w / img.width };
}

/** Bilinear sample; anything outside the image reads as white paper. */
export function sampleBilinear(img: GrayImage, x: number, y: number): number {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const p = (xx: number, yy: number): number =>
    xx < 0 || yy < 0 || xx >= img.width || yy >= img.height ? 255 : img.data[yy * img.width + xx];
  const top = p(x0, y0) * (1 - tx) + p(x0 + 1, y0) * tx;
  const bottom = p(x0, y0 + 1) * (1 - tx) + p(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Separable Gaussian blur of a float field (edges are clamped). */
export function gaussianBlur(src: Float32Array, width: number, height: number, sigma: number): Float32Array {
  if (sigma <= 0) return src.slice();
  const radius = Math.max(1, Math.ceil(sigma * 2.5));
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    total += v;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= total;

  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        acc += src[row + xx] * kernel[k + radius];
      }
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let acc = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        acc += tmp[yy * width + x] * kernel[k + radius];
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

/** p-th percentile (0..1) of 8-bit values, via a histogram. */
export function percentile8(values: ArrayLike<number>, p: number): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i += 1) hist[Math.max(0, Math.min(255, Math.round(values[i])))] += 1;
  const target = p * values.length;
  let acc = 0;
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

/**
 * Bradley-Roth adaptive threshold: a pixel is ink when it is darker than the
 * mean of its `windowSize` neighbourhood by more than `t` (0..1). Copes with
 * uneven lighting in phone photos.
 */
export function adaptiveThreshold(img: GrayImage, windowSize: number, t: number): Bitmap {
  const { width: w, height: h, data } = img;
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < w; x += 1) {
      rowSum += data[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + rowSum;
    }
  }
  const half = Math.max(1, Math.floor(windowSize / 2));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w, x + half + 1);
      const count = (x1 - x0) * (y1 - y0);
      const sum =
        integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      if (data[y * w + x] * count < sum * (1 - t)) out[y * w + x] = 1;
    }
  }
  return { width: w, height: h, data: out };
}
