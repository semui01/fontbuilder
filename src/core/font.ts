import * as opentype from 'opentype.js';
import {
  ALL_CHARS,
  CAP_HEIGHT,
  CAP_HEIGHT_REFERENCE,
  UNITS_PER_EM,
  X_HEIGHT,
  X_HEIGHT_REFERENCE,
  codepointHex,
  isLetter,
  sitsOnBaseline,
} from './charset';
import { outlineGlyph, transformOutline, type GlyphOutline } from './outline';
import type { GlyphSource } from './types';

export interface FontSettings {
  familyName: string;
  /** Stroke thickness change in font units (negative = thinner). */
  weight: number;
  /** Space added on each side of every character, in font units. */
  letterSpacing: number;
  /** Width of the space character, in font units. */
  wordSpacing: number;
  /** Scale everything so capitals come out at a standard height. */
  normalizeSize: boolean;
  /** Sit letters exactly on the baseline (fixes letters written slightly too high or low). */
  alignBaseline: boolean;
  /** Use capitals for missing lowercase letters and vice versa. */
  fillMissingCase: boolean;
}

export const DEFAULT_SETTINGS: FontSettings = {
  familyName: 'My Handwriting',
  weight: 0,
  letterSpacing: 30,
  wordSpacing: 300,
  normalizeSize: true,
  alignBaseline: true,
  fillMissingCase: true,
};

/** Caches traced outlines; tracing is the slow part of building a font. */
export class OutlineCache {
  private map = new Map<string, GlyphOutline>();

  get(src: GlyphSource, weight: number): GlyphOutline {
    const key = `${src.id}|${weight}`;
    let o = this.map.get(key);
    if (!o) {
      o = outlineGlyph(src, weight);
      this.map.set(key, o);
    }
    return o;
  }

  /** Drops entries for glyphs that no longer exist. */
  retain(ids: Set<string>): void {
    for (const key of this.map.keys()) if (!ids.has(key.split('|')[0])) this.map.delete(key);
  }
}

export interface BuiltFont {
  font: opentype.Font;
  buffer: ArrayBuffer;
  /** Final outlines per character, in font units. */
  outlines: Map<string, GlyphOutline>;
  /** Characters that ended up in the font (including derived ones). */
  covered: Set<string>;
}

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function sanitizeFamilyName(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9 \-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
    .trim();
  return cleaned || DEFAULT_SETTINGS.familyName;
}

function glyphName(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  return cp > 0xffff ? `u${codepointHex(ch)}` : `uni${codepointHex(ch)}`;
}

function toPath(o: GlyphOutline): opentype.Path {
  const path = new opentype.Path();
  for (const contour of o.contours) {
    for (const s of contour) {
      if (s.type === 'M') path.moveTo(s.x, s.y);
      else if (s.type === 'L') path.lineTo(s.x, s.y);
      else path.quadraticCurveTo(s.cx, s.cy, s.x, s.y);
    }
    path.close();
  }
  return path;
}

function notdefGlyph(): opentype.Glyph {
  const path = new opentype.Path();
  path.moveTo(60, 0);
  path.lineTo(440, 0);
  path.lineTo(440, CAP_HEIGHT);
  path.lineTo(60, CAP_HEIGHT);
  path.close();
  path.moveTo(110, 50);
  path.lineTo(110, CAP_HEIGHT - 50);
  path.lineTo(390, CAP_HEIGHT - 50);
  path.lineTo(390, 50);
  path.close();
  return new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path });
}

/** Builds an OpenType (CFF) font from handwritten glyphs. */
export function buildFont(sources: GlyphSource[], settings: FontSettings, cache = new OutlineCache()): BuiltFont {
  const raw = new Map<string, GlyphOutline>();
  for (const src of sources) {
    const o = cache.get(src, settings.weight);
    if (o.contours.length) raw.set(src.char, o);
  }

  let scale = 1;
  if (settings.normalizeSize) {
    const caps = [...raw].filter(([c]) => CAP_HEIGHT_REFERENCE.has(c)).map(([, o]) => o.yMax - o.yMin);
    const xs = [...raw].filter(([c]) => X_HEIGHT_REFERENCE.has(c)).map(([, o]) => o.yMax - o.yMin);
    if (caps.length >= 2) scale = CAP_HEIGHT / median(caps);
    else if (xs.length >= 2) scale = X_HEIGHT / median(xs);
    scale = Math.min(2.5, Math.max(0.4, scale));
  }

  const ls = settings.letterSpacing;
  const outlines = new Map<string, GlyphOutline>();
  const advances = new Map<string, number>();
  for (const [ch, o] of raw) {
    const scaled = transformOutline(o, scale, 0, 0);
    const dy = settings.alignBaseline && sitsOnBaseline(ch) ? -scaled.yMin : 0;
    const placed = transformOutline(scaled, 1, ls - scaled.xMin, dy);
    outlines.set(ch, placed);
    advances.set(ch, Math.max(0, Math.round(scaled.xMax - scaled.xMin + 2 * ls)));
  }

  // Derived characters that apps substitute automatically (smart quotes, dashes, ellipsis).
  const derive = (target: string, from: string, xScale = 1): void => {
    if (outlines.has(target)) return;
    const base = outlines.get(from);
    if (!base) return;
    const inkW = base.xMax - base.xMin;
    const stretched = transformOutline(base, 1, 0, 0);
    stretched.contours = stretched.contours.map((segs) =>
      segs.map((s) => {
        const sx = (x: number): number => base.xMin + (x - base.xMin) * xScale;
        return s.type === 'Q' ? { ...s, cx: sx(s.cx), x: sx(s.x) } : { ...s, x: sx(s.x) };
      }),
    );
    stretched.xMax = base.xMin + inkW * xScale;
    outlines.set(target, stretched);
    advances.set(target, Math.round(inkW * xScale + 2 * ls));
  };
  derive('–', '-', 1.6); // en dash
  derive('—', '-', 2.8); // em dash
  if (!outlines.has('…') && outlines.has('.')) {
    const dot = outlines.get('.') as GlyphOutline;
    const step = advances.get('.') as number;
    const contours = [0, 1, 2].flatMap((i) => transformOutline(dot, 1, i * step, 0).contours);
    outlines.set('…', { ...dot, contours, xMax: dot.xMax + 2 * step });
    advances.set('…', step * 3);
  }

  const glyphs: opentype.Glyph[] = [notdefGlyph()];
  const space = new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: Math.max(50, Math.round(settings.wordSpacing)), path: new opentype.Path() });
  space.addUnicode(0xa0);
  glyphs.push(space);
  const byChar = new Map<string, opentype.Glyph>();
  const order = [...ALL_CHARS, ...[...outlines.keys()].filter((c) => !ALL_CHARS.includes(c))];
  for (const ch of order) {
    const o = outlines.get(ch);
    if (!o) continue;
    const g = new opentype.Glyph({
      name: glyphName(ch),
      unicode: ch.codePointAt(0),
      advanceWidth: advances.get(ch) ?? 0,
      path: toPath(o),
    });
    glyphs.push(g);
    byChar.set(ch, g);
  }

  const covered = new Set(byChar.keys());
  const alias = (target: string, from: string): void => {
    const g = byChar.get(from);
    if (!g || covered.has(target)) return;
    g.addUnicode(target.codePointAt(0) as number);
    covered.add(target);
  };
  alias('‘', "'");
  alias('’', "'");
  alias('“', '"');
  alias('”', '"');
  if (settings.fillMissingCase) {
    for (const ch of ALL_CHARS) {
      if (!isLetter(ch) || covered.has(ch)) continue;
      const other = ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase();
      if (other.length === 1) alias(ch, other);
    }
  }

  // Line spacing: room above capitals for accents and ascenders, below for descenders.
  let top = 0;
  let bottom = 0;
  let inkTop = 0;
  let inkBottom = 0;
  for (const [ch, o] of outlines) {
    inkTop = Math.max(inkTop, o.yMax);
    inkBottom = Math.min(inkBottom, o.yMin);
    if (!isLetter(ch) && !/[0-9]/.test(ch)) continue;
    top = Math.max(top, o.yMax);
    bottom = Math.min(bottom, o.yMin);
  }
  const ascender = Math.round(Math.min(1100, Math.max(900, top)));
  const descender = Math.round(Math.max(-400, Math.min(-280, bottom)));

  const familyName = sanitizeFamilyName(settings.familyName);
  // @types/opentype.js mistypes weightClass as a string; the runtime wants a number.
  const options = {
    familyName,
    styleName: 'Regular',
    postScriptName: `${familyName.replace(/[^A-Za-z0-9]/g, '') || 'Handwriting'}-Regular`,
    designer: 'Handwritten with Fontbuilder',
    version: 'Version 1.000',
    description: 'A font made from handwriting with Fontbuilder.',
    unitsPerEm: UNITS_PER_EM,
    ascender,
    descender,
    weightClass: 400,
    glyphs,
    tables: {
      // Windows clips anything outside these and uses them for line height, so
      // cover both the line box and every bit of ink.
      os2: {
        usWinAscent: Math.ceil(Math.max(ascender, inkTop)),
        usWinDescent: Math.ceil(Math.max(-descender, -inkBottom)),
      },
    },
  } as unknown as opentype.FontConstructorOptions;
  const font = new opentype.Font(options);
  const buffer = font.toArrayBuffer();
  covered.add(' ');
  return { font, buffer, outlines, covered };
}
