import { describe, expect, it } from 'vitest';
import { PAGES } from '../src/core/charset';
import { scanTemplate, ScanError } from '../src/core/scan';
import { pageCells } from '../src/core/template';
import { countInk } from '../src/core/bitmap';
import { createGray } from '../src/core/image';
import { disc, renderPhoto, ring, stroke, type Ink } from './helpers/render';
import type { Point } from '../src/core/types';

/** Writes simple letter-like strokes into a few boxes of page 1. */
function handwriting(): { inks: Ink[]; written: string[] } {
  const cells = pageCells(PAGES[0]);
  const cell = (ch: string) => cells.find((c) => c.char === ch)!;
  const inks: Ink[] = [];
  const written: string[] = [];
  const I = cell('I');
  const cx = I.box.x + I.box.w / 2;
  inks.push(stroke([{ x: cx, y: I.capY }, { x: cx, y: I.baseY }]));
  written.push('I');
  const O = cell('O');
  const mid = (O.capY + O.baseY) / 2;
  inks.push(ring(O.box.x + O.box.w / 2, mid, (O.baseY - O.capY) / 2));
  written.push('O');
  const L = cell('L');
  inks.push(stroke([{ x: L.box.x + 5, y: L.capY }, { x: L.box.x + 5, y: L.baseY }, { x: L.box.x + 12, y: L.baseY }]));
  written.push('L');
  const dot = cell('.');
  inks.push(disc(dot.box.x + 8, dot.baseY - 0.6, 0.6));
  written.push('.');
  const g = cell('g');
  // A descender: bowl on the x-height band, tail below the baseline.
  inks.push(ring(g.box.x + 8, (g.xHeightY + g.baseY) / 2, (g.baseY - g.xHeightY) / 2));
  inks.push(stroke([{ x: g.box.x + 11.2, y: g.xHeightY }, { x: g.box.x + 11.2, y: g.baseY + 3.5 }, { x: g.box.x + 6, y: g.baseY + 3.5 }]));
  written.push('g');
  return { inks, written };
}

function photo(corners: Point[], seed = 3) {
  const { inks, written } = handwriting();
  return { image: renderPhoto(PAGES[0], inks, { width: 1100, height: 1450, corners, seed }), written };
}

describe('scanTemplate', () => {
  it('reads a skewed photo: page number, filled boxes and empty boxes', () => {
    const { image, written } = photo([
      { x: 120, y: 90 },
      { x: 985, y: 130 },
      { x: 1010, y: 1330 },
      { x: 90, y: 1300 },
    ]);
    const result = scanTemplate(image);
    expect(result.pageId).toBe(1);
    const found = result.cells.filter((c) => c.glyph).map((c) => c.char);
    expect(found.sort()).toEqual([...written].sort());

    const g = result.cells.find((c) => c.char === 'g')!.glyph!;
    // The tail of the g reaches below the baseline.
    expect(g.bitmap.height).toBeGreaterThan(g.baselineY + 10);
    const I = result.cells.find((c) => c.char === 'I')!.glyph!;
    // 9.5mm cap height → ~700 font units.
    const heightUnits = I.bitmap.height * I.unitsPerPx;
    expect(heightUnits).toBeGreaterThan(650);
    expect(heightUnits).toBeLessThan(820);
    expect(countInk(I.bitmap)).toBeGreaterThan(200);
  });

  it('handles a page photographed upside down', () => {
    const { image, written } = photo([
      { x: 1000, y: 1340 },
      { x: 110, y: 1320 },
      { x: 95, y: 110 },
      { x: 990, y: 95 },
    ]);
    const result = scanTemplate(image);
    expect(result.pageId).toBe(1);
    expect(result.cells.filter((c) => c.glyph).map((c) => c.char).sort()).toEqual([...written].sort());
  });

  it('handles a page photographed sideways', () => {
    const { inks, written } = handwriting();
    const image = renderPhoto(PAGES[0], inks, {
      width: 1450,
      height: 1100,
      corners: [
        { x: 1340, y: 100 },
        { x: 1350, y: 990 },
        { x: 100, y: 1000 },
        { x: 110, y: 110 },
      ],
      seed: 9,
    });
    const result = scanTemplate(image);
    expect(result.pageId).toBe(1);
    expect(result.cells.filter((c) => c.glyph).map((c) => c.char).sort()).toEqual([...written].sort());
  });

  it('explains when there is no template in the picture', () => {
    expect(() => scanTemplate(createGray(400, 300, 230))).toThrow(ScanError);
  });
});
