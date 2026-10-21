import { createBitmap, trimBitmap } from './bitmap';
import { CAP_HEIGHT, CAP_HEIGHT_REFERENCE, X_HEIGHT, X_HEIGHT_REFERENCE, sitsOnBaseline } from './charset';
import { labelComponents, type Component } from './components';
import { adaptiveThreshold, percentile8, sampleBilinear } from './image';
import { newId, type Bitmap, type GlyphSource, type GrayImage } from './types';

/** One letter-like shape found in a photo of handwriting. */
export interface PhotoShape {
  id: number;
  /** Bounding box in image pixels; x1/y1 exclusive. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Connected-component labels that make up the shape (e.g. the stem and dot of an "i"). */
  parts: number[];
  line: number;
  /** The character it represents; empty when unknown. */
  label: string;
  ignored: boolean;
}

export interface PhotoAnalysis {
  gray: GrayImage;
  /** Component label image matching `gray`. */
  labels: Int32Array;
  shapes: PhotoShape[];
}

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Clears long, thin horizontal or vertical runs: the rules of lined or squared paper. */
export function removeRuledLines(b: Bitmap): Bitmap {
  const { width: w, height: h } = b;
  const hRun = new Int32Array(w * h);
  const vRun = new Int32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    let x = 0;
    while (x < w) {
      if (!b.data[y * w + x]) {
        x += 1;
        continue;
      }
      let e = x;
      while (e < w && b.data[y * w + e]) e += 1;
      for (let k = x; k < e; k += 1) hRun[y * w + k] = e - x;
      x = e;
    }
  }
  for (let x = 0; x < w; x += 1) {
    let y = 0;
    while (y < h) {
      if (!b.data[y * w + x]) {
        y += 1;
        continue;
      }
      let e = y;
      while (e < h && b.data[e * w + x]) e += 1;
      for (let k = y; k < e; k += 1) vRun[k * w + x] = e - y;
      y = e;
    }
  }
  const maxThickness = Math.max(3, Math.round(Math.max(w, h) * 0.003));
  // A rule row/column is mostly thin, elongated ink. Thresholding often breaks
  // a rule into pieces next to letters, so detect whole rows, then clear thin
  // ink anywhere along them. Letter strokes crossing a rule are thick in the
  // crossing direction and survive.
  const ruleRow = new Uint8Array(h);
  const ruleCol = new Uint8Array(w);
  const rowCount = new Int32Array(h);
  const colCount = new Int32Array(w);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!b.data[i]) continue;
      if (vRun[i] <= maxThickness && hRun[i] >= maxThickness * 2) rowCount[y] += 1;
      if (hRun[i] <= maxThickness && vRun[i] >= maxThickness * 2) colCount[x] += 1;
    }
  for (let y = 0; y < h; y += 1) ruleRow[y] = rowCount[y] >= w * 0.25 ? 1 : 0;
  for (let x = 0; x < w; x += 1) ruleCol[x] = colCount[x] >= h * 0.25 ? 1 : 0;
  const out = createBitmap(w, h);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!b.data[i]) continue;
      const onRule = (ruleRow[y] && vRun[i] <= maxThickness) || (ruleCol[x] && hRun[i] <= maxThickness);
      out.data[i] = onRule ? 0 : 1;
    }
  return out;
}

/** Finds letter shapes in a photo or scan of handwriting and sorts them into reading order. */
export function analyzePhoto(gray: GrayImage): PhotoAnalysis {
  const { width: w, height: h } = gray;
  const ink = removeRuledLines(adaptiveThreshold(gray, Math.max(15, Math.round(Math.max(w, h) / 12)), 0.2));
  const { labels, components } = labelComponents(ink);

  const sizable = components.filter((c) => c.area >= 6);
  const typicalArea = median(sizable.map((c) => c.area));
  const minArea = Math.max(6, typicalArea * 0.03);
  const kept = components.filter((c) => {
    if (c.area < minArea) return false;
    if (c.x0 === 0 || c.y0 === 0 || c.x1 === w || c.y1 === h) return false;
    if (c.x1 - c.x0 > w * 0.5 || c.y1 - c.y0 > h * 0.5) return false;
    return true;
  });
  const typicalHeight = median(kept.filter((c) => c.area >= typicalArea * 0.3).map((c) => c.y1 - c.y0)) || 1;

  // Union parts stacked above each other: dots on i/j, colons, accents, "=".
  const parent = kept.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) {
      const next = parent[i];
      parent[i] = r;
      i = next;
    }
    return r;
  };
  for (let i = 0; i < kept.length; i += 1) {
    for (let j = i + 1; j < kept.length; j += 1) {
      const a = kept[i];
      const b = kept[j];
      const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const narrower = Math.min(a.x1 - a.x0, b.x1 - b.x0);
      if (overlap < narrower * 0.5) continue;
      const gap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
      if (gap > typicalHeight * 0.6) continue;
      parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Component[]>();
  kept.forEach((c, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), c]);
  });
  const shapes: PhotoShape[] = [...groups.values()].map((parts, i) => ({
    id: i,
    x0: Math.min(...parts.map((p) => p.x0)),
    y0: Math.min(...parts.map((p) => p.y0)),
    x1: Math.max(...parts.map((p) => p.x1)),
    y1: Math.max(...parts.map((p) => p.y1)),
    parts: parts.map((p) => p.label),
    line: 0,
    label: '',
    ignored: false,
  }));
  return { gray, labels, shapes: orderShapes(shapes) };
}

/** Groups shapes into text lines and sorts them top-to-bottom, left-to-right. */
export function orderShapes(shapes: PhotoShape[]): PhotoShape[] {
  interface Line {
    members: PhotoShape[];
    top: number;
    bottom: number;
  }
  const lines: Line[] = [];
  const byHeight = [...shapes].sort((a, b) => b.y1 - b.y0 - (a.y1 - a.y0));
  for (const s of byHeight) {
    let best: Line | null = null;
    let bestOverlap = 0;
    for (const line of lines) {
      const overlap = Math.min(s.y1, line.bottom) - Math.max(s.y0, line.top);
      const ratio = overlap / Math.max(1, Math.min(s.y1 - s.y0, line.bottom - line.top));
      if (ratio > bestOverlap) {
        bestOverlap = ratio;
        best = line;
      }
    }
    if (best && bestOverlap >= 0.3) {
      best.members.push(s);
      best.top = median(best.members.map((m) => m.y0));
      best.bottom = median(best.members.map((m) => m.y1));
    } else {
      lines.push({ members: [s], top: s.y0, bottom: s.y1 });
    }
  }
  lines.sort((a, b) => a.top + a.bottom - (b.top + b.bottom));
  const ordered: PhotoShape[] = [];
  lines.forEach((line, index) => {
    line.members.sort((a, b) => a.x0 + a.x1 - (b.x0 + b.x1));
    for (const m of line.members) ordered.push({ ...m, line: index });
  });
  return ordered;
}

/**
 * Labels shapes with the characters of `text` (what the person says they
 * wrote), in reading order. When the number of text lines matches the number
 * of detected lines, each line is matched separately so one miscount doesn't
 * shift everything after it. Returns human-readable warnings.
 */
export function assignLabels(shapes: PhotoShape[], text: string): string[] {
  const warnings: string[] = [];
  const active = shapes.filter((s) => !s.ignored);
  for (const s of shapes) s.label = '';
  const textLines = text
    .split(/\r?\n/)
    .map((l) => Array.from(l.replace(/\s+/g, '')))
    .filter((l) => l.length > 0);
  const lineIds = [...new Set(active.map((s) => s.line))];
  if (textLines.length === lineIds.length && lineIds.length > 1) {
    lineIds.forEach((lineId, i) => {
      const members = active.filter((s) => s.line === lineId);
      const chars = textLines[i];
      members.forEach((s, k) => {
        s.label = chars[k] ?? '';
      });
      if (members.length !== chars.length) {
        warnings.push(
          `Line ${i + 1}: found ${members.length} shapes but your text has ${chars.length} characters.`,
        );
      }
    });
  } else {
    const chars = textLines.flat();
    active.forEach((s, k) => {
      s.label = chars[k] ?? '';
    });
    if (chars.length && active.length !== chars.length) {
      warnings.push(`Found ${active.length} shapes but your text has ${chars.length} characters.`);
    }
  }
  return warnings;
}

/** Merges a shape with the next shape on the same line (for letters that came out in pieces). */
export function joinWithNext(shapes: PhotoShape[], id: number): PhotoShape[] {
  const i = shapes.findIndex((s) => s.id === id);
  if (i < 0) return shapes;
  const a = shapes[i];
  const j = shapes.findIndex((s, k) => k > i && s.line === a.line && !s.ignored);
  if (j < 0) return shapes;
  const b = shapes[j];
  const merged: PhotoShape = {
    ...a,
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
    parts: [...a.parts, ...b.parts],
  };
  return shapes.flatMap((s, k) => (k === i ? [merged] : k === j ? [] : [s]));
}

/**
 * Turns labelled shapes into glyphs. Each line's baseline and scale are
 * estimated from the letters on it, so different lines written at slightly
 * different sizes still produce a consistent font. When a character appears
 * more than once, the most typical-sized sample wins.
 */
export function photoGlyphs(analysis: PhotoAnalysis, inkRatio = 0.7): GlyphSource[] {
  const { gray, labels } = analysis;
  const usable = analysis.shapes.filter((s) => !s.ignored && s.label);
  const lineIds = [...new Set(usable.map((s) => s.line))];
  const lineScale = new Map<number, number | null>();
  const lineBaseline = new Map<number, number>();
  for (const lineId of lineIds) {
    const members = usable.filter((s) => s.line === lineId);
    const onBase = members.filter((s) => sitsOnBaseline(s.label));
    lineBaseline.set(lineId, median((onBase.length ? onBase : members).map((s) => s.y1)));
    const xs = members.filter((s) => X_HEIGHT_REFERENCE.has(s.label)).map((s) => s.y1 - s.y0);
    const caps = members.filter((s) => CAP_HEIGHT_REFERENCE.has(s.label)).map((s) => s.y1 - s.y0);
    lineScale.set(lineId, xs.length ? X_HEIGHT / median(xs) : caps.length ? CAP_HEIGHT / median(caps) : null);
  }
  const known = [...lineScale.values()].filter((v): v is number => v !== null);
  const fallbackScale = known.length ? median(known) : CAP_HEIGHT / Math.max(1, median(usable.map((s) => s.y1 - s.y0)));

  const candidates: Array<{ glyph: GlyphSource; heightUnits: number }> = [];
  for (const shape of usable) {
    const unitsPerSrcPx = lineScale.get(shape.line) ?? fallbackScale;
    const up = Math.min(4, Math.max(1, unitsPerSrcPx / 6));
    const pad = 3;
    const cx0 = shape.x0 - pad;
    const cy0 = shape.y0 - pad;
    const cw = shape.x1 - shape.x0 + pad * 2;
    const ch = shape.y1 - shape.y0 + pad * 2;

    // Mask of this shape's own parts (slightly grown) so neighbouring letters don't leak in.
    const partSet = new Set(shape.parts);
    const mask = new Uint8Array(cw * ch);
    const grow = 2;
    for (let y = 0; y < ch; y += 1)
      for (let x = 0; x < cw; x += 1) {
        const sx = cx0 + x;
        const sy = cy0 + y;
        if (sx < 0 || sy < 0 || sx >= gray.width || sy >= gray.height) continue;
        if (!partSet.has(labels[sy * gray.width + sx])) continue;
        for (let dy = -grow; dy <= grow; dy += 1)
          for (let dx = -grow; dx <= grow; dx += 1) {
            const mx = x + dx;
            const my = y + dy;
            if (mx >= 0 && my >= 0 && mx < cw && my < ch) mask[my * cw + mx] = 1;
          }
      }

    const local: number[] = [];
    for (let y = Math.max(0, cy0 - 4 * pad); y < Math.min(gray.height, cy0 + ch + 4 * pad); y += 1)
      for (let x = Math.max(0, cx0 - 4 * pad); x < Math.min(gray.width, cx0 + cw + 4 * pad); x += 1)
        local.push(gray.data[y * gray.width + x]);
    const threshold = percentile8(local, 0.9) * inkRatio;

    const ow = Math.round(cw * up);
    const oh = Math.round(ch * up);
    const bmp = createBitmap(ow, oh);
    for (let v = 0; v < oh; v += 1)
      for (let u = 0; u < ow; u += 1) {
        const lx = (u + 0.5) / up;
        const ly = (v + 0.5) / up;
        if (!mask[Math.min(ch - 1, Math.floor(ly)) * cw + Math.min(cw - 1, Math.floor(lx))]) continue;
        if (sampleBilinear(gray, cx0 + lx, cy0 + ly) < threshold) bmp.data[v * ow + u] = 1;
      }
    const trimmed = trimBitmap(bmp, 2);
    if (!trimmed) continue;
    const unitsPerPx = unitsPerSrcPx / up;
    candidates.push({
      glyph: {
        id: newId('p'),
        char: shape.label,
        bitmap: trimmed.bitmap,
        unitsPerPx,
        baselineY: ((lineBaseline.get(shape.line) ?? shape.y1) - cy0) * up - trimmed.offsetY,
        origin: 'photo',
      },
      heightUnits: (shape.y1 - shape.y0) * unitsPerSrcPx,
    });
  }

  const byChar = new Map<string, typeof candidates>();
  for (const c of candidates) byChar.set(c.glyph.char, [...(byChar.get(c.glyph.char) ?? []), c]);
  return [...byChar.values()].map((samples) => {
    const typical = median(samples.map((s) => s.heightUnits));
    return samples.reduce((best, s) =>
      Math.abs(s.heightUnits - typical) < Math.abs(best.heightUnits - typical) ? s : best,
    ).glyph;
  });
}
