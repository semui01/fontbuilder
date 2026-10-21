import { describe, expect, it } from 'vitest';
import * as opentype from 'opentype.js';
import { buildFont, DEFAULT_SETTINGS, OutlineCache, sanitizeFamilyName } from '../src/core/font';
import { outlineGlyph } from '../src/core/outline';
import { bar, dotBitmap, glyph, ringBitmap } from './helpers/glyphs';

const sources = () => [
  glyph('I', bar(100)),
  glyph('O', ringBitmap(50)),
  glyph('l', bar(100)),
  glyph('o', ringBitmap(34, 8)),
  glyph('.', dotBitmap(6)),
  glyph('-', bar(8, 40)),
  glyph("'", bar(30, 8), { drop: -70 }),
  glyph('"', bar(30, 20), { drop: -70 }),
];

describe('outlineGlyph', () => {
  it('traces a ring into an outer contour and a hole with opposite winding', () => {
    const o = outlineGlyph(glyph('O', ringBitmap(50)), 0);
    expect(o.contours).toHaveLength(2);
    const area = (segs: (typeof o.contours)[number]) => {
      const pts = segs.map((s) => ({ x: s.x, y: s.y }));
      let a = 0;
      for (let i = 0; i < pts.length; i += 1) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        a += p.x * q.y - q.x * p.y;
      }
      return a / 2;
    };
    const areas = o.contours.map(area);
    // y-up coordinates: outer counter-clockwise (positive), hole clockwise (negative).
    expect(Math.max(...areas)).toBeGreaterThan(0);
    expect(Math.min(...areas)).toBeLessThan(0);
    // ~100 px * 7 units/px across.
    expect(o.xMax - o.xMin).toBeGreaterThan(650);
    expect(o.xMax - o.xMin).toBeLessThan(760);
    expect(o.yMin).toBeGreaterThan(-30);
    expect(o.yMin).toBeLessThan(30);
  });

  it('makes strokes heavier or lighter with the weight setting', () => {
    const src = glyph('I', bar(100, 12));
    const normal = outlineGlyph(src, 0);
    const bold = outlineGlyph(src, 30);
    const light = outlineGlyph(src, -20);
    const width = (o: typeof normal) => o.xMax - o.xMin;
    expect(width(bold)).toBeGreaterThan(width(normal) + 40);
    expect(width(light)).toBeLessThan(width(normal) - 20);
    expect(light.contours.length).toBe(1);
  });
});

describe('buildFont', () => {
  it('produces a font that parses back with the expected characters', () => {
    const built = buildFont(sources(), { ...DEFAULT_SETTINGS, familyName: 'Test Hand' });
    const parsed = opentype.parse(built.buffer);
    expect(parsed.names.fontFamily.en).toBe('Test Hand');
    expect(parsed.unitsPerEm).toBe(1000);
    for (const ch of ['I', 'O', 'l', 'o', '.', '-', ' ']) {
      expect(parsed.charToGlyphIndex(ch), ch).toBeGreaterThan(0);
    }
    const O = parsed.charToGlyph('O');
    const box = O.getBoundingBox();
    // Normalised so capitals are ~700 units tall and sit on the baseline.
    expect(box.y2 - box.y1).toBeGreaterThan(640);
    expect(box.y2 - box.y1).toBeLessThan(760);
    expect(Math.abs(box.y1)).toBeLessThan(15);
    expect(O.advanceWidth!).toBeGreaterThan(box.x2 - box.x1);
  });

  it('adds characters that apps substitute automatically', () => {
    const built = buildFont(sources(), DEFAULT_SETTINGS);
    const parsed = opentype.parse(built.buffer);
    // Smart quotes, dashes, ellipsis, no-break space.
    for (const ch of ['‘', '’', '“', '”', '–', '—', '…', ' ']) {
      expect(parsed.charToGlyphIndex(ch), `U+${ch.codePointAt(0)!.toString(16)}`).toBeGreaterThan(0);
    }
    expect(parsed.charToGlyph('—').advanceWidth!).toBeGreaterThan(parsed.charToGlyph('-').advanceWidth!);
  });

  it('fills missing lowercase from capitals only when asked', () => {
    const withFill = opentype.parse(buildFont(sources(), DEFAULT_SETTINGS).buffer);
    expect(withFill.charToGlyphIndex('i')).toBe(withFill.charToGlyphIndex('I'));
    const without = opentype.parse(buildFont(sources(), { ...DEFAULT_SETTINGS, fillMissingCase: false }).buffer);
    expect(without.charToGlyphIndex('i')).toBe(0);
  });

  it('keeps floating marks off the baseline', () => {
    const parsed = opentype.parse(buildFont(sources(), DEFAULT_SETTINGS).buffer);
    expect(parsed.charToGlyph("'").getBoundingBox().y1).toBeGreaterThan(300);
  });

  it('applies letter and word spacing', () => {
    const tight = opentype.parse(buildFont(sources(), { ...DEFAULT_SETTINGS, letterSpacing: 0, wordSpacing: 200 }).buffer);
    const loose = opentype.parse(buildFont(sources(), { ...DEFAULT_SETTINGS, letterSpacing: 80, wordSpacing: 500 }).buffer);
    expect(loose.charToGlyph('I').advanceWidth! - tight.charToGlyph('I').advanceWidth!).toBe(160);
    expect(tight.charToGlyph(' ').advanceWidth).toBe(200);
    expect(loose.charToGlyph(' ').advanceWidth).toBe(500);
  });

  it('reuses traced outlines across rebuilds', () => {
    const cache = new OutlineCache();
    const srcs = sources();
    buildFont(srcs, DEFAULT_SETTINGS, cache);
    const t0 = performance.now();
    buildFont(srcs, { ...DEFAULT_SETTINGS, letterSpacing: 10 }, cache);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('sanitizeFamilyName', () => {
  it('keeps names that every OS accepts', () => {
    expect(sanitizeFamilyName('  Sam’s   Hand!! ')).toBe('Sams Hand');
    expect(sanitizeFamilyName('***')).toBe('My Handwriting');
    expect(sanitizeFamilyName('a'.repeat(50))).toHaveLength(31);
  });
});
