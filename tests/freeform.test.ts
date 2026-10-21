import { describe, expect, it } from 'vitest';
import { analyzePhoto, assignLabels, joinWithNext, photoGlyphs, type PhotoShape } from '../src/core/freeform';
import { createGray } from '../src/core/image';
import type { GrayImage } from '../src/core/types';
import { disc, ring, stroke, type Ink } from './helpers/render';

/** Paints inks (coordinates in pixels) onto lined paper. */
function paint(width: number, height: number, inks: Ink[], rules: number[] = []): GrayImage {
  const img = createGray(width, height, 238);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      let v = 238 - 20 * (x / width);
      if (rules.some((r) => Math.abs(y - r) < 1.5)) v = 175;
      for (const ink of inks) {
        if (x + 0.5 < ink.bbox.x0 || x + 0.5 > ink.bbox.x1 || y + 0.5 < ink.bbox.y0 || y + 0.5 > ink.bbox.y1) continue;
        if (ink.at(x + 0.5, y + 0.5)) v = 35;
      }
      img.data[y * width + x] = v;
    }
  return img;
}

/** "Hi" on the first line, "lo." on the second, written with a 4px pen on ruled paper. */
function sample(): GrayImage {
  const pen = 4;
  const inks: Ink[] = [
    // H, baseline 120, cap height 60
    stroke([{ x: 60, y: 60 }, { x: 60, y: 120 }], pen),
    stroke([{ x: 95, y: 60 }, { x: 95, y: 120 }], pen),
    stroke([{ x: 60, y: 90 }, { x: 95, y: 90 }], pen),
    // i with a dot
    stroke([{ x: 125, y: 82 }, { x: 125, y: 120 }], pen),
    disc(125, 70, 3.5),
    // l, o, period on line 2 (baseline 240)
    stroke([{ x: 60, y: 180 }, { x: 60, y: 240 }], pen),
    ring(100, 221, 19, pen),
    disc(140, 237, 3.5),
  ];
  return paint(260, 300, inks, [121, 241]);
}

const summary = (shapes: PhotoShape[]) => shapes.map((s) => `${s.line}:${s.label || '?'}`).join(' ');

describe('analyzePhoto', () => {
  it('finds letters in reading order, keeping dots with their letters and ignoring ruled lines', () => {
    const analysis = analyzePhoto(sample());
    expect(analysis.shapes).toHaveLength(5);
    expect(analysis.shapes.map((s) => s.line)).toEqual([0, 0, 1, 1, 1]);
    const i = analysis.shapes[1];
    expect(i.parts).toHaveLength(2);
    expect(i.y0).toBeLessThan(70);
  });

  it('labels shapes from the typed text, line by line', () => {
    const analysis = analyzePhoto(sample());
    const warnings = assignLabels(analysis.shapes, 'Hi\nlo.');
    expect(warnings).toEqual([]);
    expect(summary(analysis.shapes)).toBe('0:H 0:i 1:l 1:o 1:.');
  });

  it('warns when the text does not match what was found', () => {
    const analysis = analyzePhoto(sample());
    const warnings = assignLabels(analysis.shapes, 'Hi\nlo!.');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Line 2');
  });

  it('skips ignored shapes and can join pieces', () => {
    const analysis = analyzePhoto(sample());
    analysis.shapes[0].ignored = true;
    assignLabels(analysis.shapes, 'ilo.');
    expect(summary(analysis.shapes.filter((s) => !s.ignored))).toBe('0:i 1:l 1:o 1:.');
    const joined = joinWithNext(analysis.shapes, analysis.shapes[2].id);
    expect(joined).toHaveLength(4);
    expect(joined[2].parts.length).toBe(analysis.shapes[2].parts.length + analysis.shapes[3].parts.length);
  });
});

describe('photoGlyphs', () => {
  it('extracts glyphs positioned on their line baseline at a consistent scale', () => {
    const analysis = analyzePhoto(sample());
    assignLabels(analysis.shapes, 'Hi\nlo.');
    const glyphs = photoGlyphs(analysis);
    expect(glyphs.map((g) => g.char).sort()).toEqual(['.', 'H', 'i', 'l', 'o']);
    for (const g of glyphs) {
      const bottomUnits = (g.bitmap.height - 2 - g.baselineY) * g.unitsPerPx;
      // Everything here sits on the baseline (within a few % of the em).
      expect(Math.abs(bottomUnits), g.char).toBeLessThan(40);
    }
    const H = glyphs.find((g) => g.char === 'H')!;
    const o = glyphs.find((g) => g.char === 'o')!;
    const heightUnits = (g: typeof H) => (g.bitmap.height - 4) * g.unitsPerPx;
    // The o was written ~2/3 the height of the H.
    expect(heightUnits(o) / heightUnits(H)).toBeGreaterThan(0.5);
    expect(heightUnits(o) / heightUnits(H)).toBeLessThan(0.8);
  });
});
