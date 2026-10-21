import { describe, expect, it } from 'vitest';
import { PAGES } from '../src/core/charset';
import { decodePageCode, GRID_COLS, GRID_ROWS, pageCells, pageCodeBits, templatePdf, templateSvg } from '../src/core/template';
import { applyHomography, homographyFromPoints } from '../src/core/homography';
import { decodeBitmap, encodeBitmap } from '../src/core/bitmap';
import { dotBitmap, ringBitmap } from './helpers/glyphs';

describe('template pages', () => {
  it('fit every character in the grid, with no duplicates', () => {
    for (const page of PAGES) expect(page.chars.length).toBeLessThanOrEqual(GRID_COLS * GRID_ROWS);
    const all = PAGES.flatMap((p) => p.chars);
    expect(new Set(all).size).toBe(all.length);
    expect(pageCells(PAGES[0]).at(-1)!.box.y + 19).toBeLessThan(242);
  });

  it('page codes round-trip and reject garbage', () => {
    for (const page of PAGES) expect(decodePageCode(pageCodeBits(page.id))).toBe(page.id);
    expect(decodePageCode([1, 1, 1, 1, 1, 1, 1, 1])).toBeNull();
    expect(decodePageCode([0, 0, 0, 0, 1, 1, 1, 1])).toBeNull();
  });

  it('renders as SVG and as a valid-looking PDF', () => {
    expect(templateSvg(PAGES[0], 'a4')).toContain('viewBox="0 0 210 297"');
    const pdf = new TextDecoder('latin1').decode(templatePdf([1, 2], 'letter'));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('/Count 2');
    // Every xref offset points at the start of its object.
    const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    const offsets = pdf
      .slice(xrefAt)
      .split('\n')
      .filter((l) => / 00000 n $/.test(l))
      .map((l) => Number(l.slice(0, 10)));
    offsets.forEach((off, i) => expect(pdf.slice(off, off + 10)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
    // Characters outside ASCII are encoded as WinAnsi bytes, parentheses escaped.
    expect(pdf).toContain('(\\()');
    expect(pdf).toContain(`(${String.fromCharCode(0x80)})`);
  });
});

describe('homography', () => {
  it('maps the four source points onto the destination points', () => {
    const src = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }];
    const dst = [{ x: 5, y: 7 }, { x: 103, y: 12 }, { x: 98, y: 230 }, { x: 2, y: 210 }];
    const h = homographyFromPoints(src, dst);
    src.forEach((p, i) => {
      const q = applyHomography(h, p.x, p.y);
      expect(q.x).toBeCloseTo(dst[i].x, 6);
      expect(q.y).toBeCloseTo(dst[i].y, 6);
    });
  });
});

describe('bitmap encoding', () => {
  it('round-trips', () => {
    for (const b of [ringBitmap(40), dotBitmap(3)]) {
      const back = decodeBitmap(encodeBitmap(b));
      expect(back.width).toBe(b.width);
      expect(back.height).toBe(b.height);
      expect(Array.from(back.data)).toEqual(Array.from(b.data));
    }
  });
});
