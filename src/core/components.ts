import { createBitmap } from './bitmap';
import type { Bitmap } from './types';

export interface Component {
  /** Label value in the label image (1-based). */
  label: number;
  area: number;
  /** Bounding box; x1/y1 are exclusive. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
}

export interface Labeling {
  /** 0 = paper, otherwise the component's label. */
  labels: Int32Array;
  components: Component[];
}

/** 8-connected component labelling of the ink in a bitmap. */
export function labelComponents(b: Bitmap): Labeling {
  const { width: w, height: h, data } = b;
  const labels = new Int32Array(w * h);
  const components: Component[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < data.length; start += 1) {
    if (!data[start] || labels[start]) continue;
    const label = components.length + 1;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    while (top > 0) {
      const i = stack[--top];
      const x = i % w;
      const y = (i - x) / w;
      area += 1;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x >= x1) x1 = x + 1;
      if (y < y0) y0 = y;
      if (y >= y1) y1 = y + 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (data[j] && !labels[j]) {
            labels[j] = label;
            stack[top++] = j;
          }
        }
      }
    }
    components.push({ label, area, x0, y0, x1, y1, cx: sx / area + 0.5, cy: sy / area + 0.5 });
  }
  return { labels, components };
}

/** Returns a bitmap containing only the components for which `keep` returns true. */
export function filterComponents(b: Bitmap, keep: (c: Component) => boolean): Bitmap {
  const { labels, components } = labelComponents(b);
  const keepLabel = new Uint8Array(components.length + 1);
  for (const c of components) keepLabel[c.label] = keep(c) ? 1 : 0;
  const out = createBitmap(b.width, b.height);
  for (let i = 0; i < labels.length; i += 1) out.data[i] = keepLabel[labels[i]];
  return out;
}
