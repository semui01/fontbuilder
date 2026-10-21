import { CHAR_HINTS, PAGES, type CharPage } from './charset';
import { buildPdf, pdfString, type PdfPage } from './pdf';
import type { Point, Rect } from './types';

/*
 * Template geometry, in millimetres, relative to the top-left corner of the
 * "frame" spanned by the four black corner markers. The scanner uses the same
 * numbers, so the frame works whatever paper size or print scaling is used.
 */
export const FRAME_W = 180;
export const FRAME_H = 250;
export const MARKER_SIZE = 8;

/** Marker centres in frame coordinates, clockwise from top-left. */
export const MARKER_CENTERS: Point[] = [
  { x: MARKER_SIZE / 2, y: MARKER_SIZE / 2 },
  { x: FRAME_W - MARKER_SIZE / 2, y: MARKER_SIZE / 2 },
  { x: FRAME_W - MARKER_SIZE / 2, y: FRAME_H - MARKER_SIZE / 2 },
  { x: MARKER_SIZE / 2, y: FRAME_H - MARKER_SIZE / 2 },
];

export const GRID_COLS = 9;
export const GRID_ROWS = 9;
const GRID_TOP = 18;
const ROW_PITCH = 24.6;
const COL_PITCH = FRAME_W / GRID_COLS;
const LABEL_BAND = 4.4;
export const BOX_W = 18;
export const BOX_H = 19;
export const BOX_LINE = 0.3;
/** Guide offsets from the top of each box. */
export const CAP_OFFSET = 4.5;
export const X_HEIGHT_OFFSET = 7.5;
export const BASELINE_OFFSET = 14;

/** Page-number code: 8 squares, 4 bits of page id followed by their complement. */
export const CODE_SQUARE = 4;
const CODE_PITCH = 6;
const CODE_Y = FRAME_H - MARKER_SIZE / 2 - CODE_SQUARE / 2;
const CODE_X = FRAME_W / 2 - (CODE_PITCH * 7 + CODE_SQUARE) / 2;

export interface CellLayout {
  char: string;
  box: Rect;
  capY: number;
  xHeightY: number;
  baseY: number;
}

export function pageCells(page: CharPage): CellLayout[] {
  return page.chars.map((char, i) => {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    const box = {
      x: col * COL_PITCH + (COL_PITCH - BOX_W) / 2,
      y: GRID_TOP + row * ROW_PITCH + LABEL_BAND,
      w: BOX_W,
      h: BOX_H,
    };
    return {
      char,
      box,
      capY: box.y + CAP_OFFSET,
      xHeightY: box.y + X_HEIGHT_OFFSET,
      baseY: box.y + BASELINE_OFFSET,
    };
  });
}

export function codeSquares(): Rect[] {
  return Array.from({ length: 8 }, (_, i) => ({ x: CODE_X + i * CODE_PITCH, y: CODE_Y, w: CODE_SQUARE, h: CODE_SQUARE }));
}

export function pageCodeBits(pageId: number): number[] {
  const bits = [3, 2, 1, 0].map((shift) => (pageId >> shift) & 1);
  return [...bits, ...bits.map((b) => 1 - b)];
}

export function decodePageCode(bits: number[]): number | null {
  if (bits.length !== 8) return null;
  for (let i = 0; i < 4; i += 1) if (bits[i] === bits[i + 4]) return null;
  const id = bits.slice(0, 4).reduce((acc, b) => acc * 2 + b, 0);
  return PAGES.some((p) => p.id === id) ? id : null;
}

export type Paper = 'letter' | 'a4';

export const PAPER_SIZES: Record<Paper, { w: number; h: number; label: string }> = {
  letter: { w: 215.9, h: 279.4, label: 'US Letter' },
  a4: { w: 210, h: 297, label: 'A4' },
};

export type Primitive =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; strokeWidth?: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number; dash?: [number, number] }
  | { kind: 'text'; x: number; y: number; size: number; text: string; fill: string; bold?: boolean };

/** Drawing instructions for one template page, in frame millimetres. */
export function pagePrimitives(page: CharPage): Primitive[] {
  const out: Primitive[] = [];
  for (const c of MARKER_CENTERS) {
    out.push({ kind: 'rect', x: c.x - MARKER_SIZE / 2, y: c.y - MARKER_SIZE / 2, w: MARKER_SIZE, h: MARKER_SIZE, fill: '#000' });
  }
  out.push({ kind: 'text', x: 12, y: 5.2, size: 4.2, text: 'Handwriting font template', fill: '#000', bold: true });
  out.push({
    kind: 'text',
    x: 12,
    y: 10.2,
    size: 3,
    text: `Page ${page.id} of ${PAGES.length} — ${page.title}`,
    fill: '#333',
  });
  out.push({
    kind: 'text',
    x: 12,
    y: 14.6,
    size: 2.5,
    text: 'Use a dark pen. Write one character per box, sitting on the dotted baseline. Keep all four black squares in the photo.',
    fill: '#555',
  });

  for (const cell of pageCells(page)) {
    const { box } = cell;
    out.push({ kind: 'text', x: box.x + 0.3, y: box.y - 1.2, size: 3.4, text: cell.char, fill: '#222', bold: true });
    const hint = CHAR_HINTS[cell.char];
    if (hint) out.push({ kind: 'text', x: box.x + 3.6, y: box.y - 1.2, size: 2.2, text: hint, fill: '#777' });
    out.push({ kind: 'line', x1: box.x + 0.8, y1: cell.xHeightY, x2: box.x + box.w - 0.8, y2: cell.xHeightY, stroke: '#cfcfcf', strokeWidth: 0.2, dash: [0.3, 1.5] });
    out.push({ kind: 'line', x1: box.x + 0.8, y1: cell.baseY, x2: box.x + box.w - 0.8, y2: cell.baseY, stroke: '#b8b8b8', strokeWidth: 0.25, dash: [0.5, 1] });
    // Baseline ticks sit just outside the box so they never end up in the scan.
    out.push({ kind: 'line', x1: box.x - 0.9, y1: cell.baseY, x2: box.x - 0.15, y2: cell.baseY, stroke: '#000', strokeWidth: 0.3 });
    out.push({ kind: 'line', x1: box.x + box.w + 0.15, y1: cell.baseY, x2: box.x + box.w + 0.9, y2: cell.baseY, stroke: '#000', strokeWidth: 0.3 });
    out.push({ kind: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, stroke: '#000', strokeWidth: BOX_LINE });
  }

  const bits = pageCodeBits(page.id);
  codeSquares().forEach((sq, i) => {
    if (bits[i]) out.push({ kind: 'rect', ...sq, fill: '#000' });
    else out.push({ kind: 'rect', ...sq, stroke: '#000', strokeWidth: 0.2 });
  });
  out.push({ kind: 'text', x: 12, y: FRAME_H - 3, size: 2.5, text: `Page ${page.id}`, fill: '#555' });
  return out;
}

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmt = (n: number): string => (Math.round(n * 1000) / 1000).toString();

/** An SVG of a template page centred on the given paper, sized in millimetres. */
export function templateSvg(page: CharPage, paper: Paper = 'letter'): string {
  const size = PAPER_SIZES[paper];
  const ox = (size.w - FRAME_W) / 2;
  const oy = (size.h - FRAME_H) / 2;
  const parts: string[] = [];
  for (const p of pagePrimitives(page)) {
    if (p.kind === 'rect') {
      parts.push(
        `<rect x="${fmt(p.x + ox)}" y="${fmt(p.y + oy)}" width="${fmt(p.w)}" height="${fmt(p.h)}" fill="${p.fill ?? 'none'}"${
          p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.strokeWidth ?? 0.3}"` : ''
        }/>`,
      );
    } else if (p.kind === 'line') {
      parts.push(
        `<line x1="${fmt(p.x1 + ox)}" y1="${fmt(p.y1 + oy)}" x2="${fmt(p.x2 + ox)}" y2="${fmt(p.y2 + oy)}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}"${
          p.dash ? ` stroke-dasharray="${p.dash.join(' ')}"` : ''
        }/>`,
      );
    } else {
      parts.push(
        `<text x="${fmt(p.x + ox)}" y="${fmt(p.y + oy)}" font-size="${p.size}" fill="${p.fill}"${p.bold ? ' font-weight="bold"' : ''}>${escapeXml(p.text)}</text>`,
      );
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}mm" height="${size.h}mm" viewBox="0 0 ${size.w} ${size.h}" ` +
    `font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [number, number, number];
}

/** A printable PDF with the requested template pages. */
export function templatePdf(pageIds: number[], paper: Paper = 'letter'): Uint8Array {
  const size = PAPER_SIZES[paper];
  const k = 72 / 25.4;
  const ox = (size.w - FRAME_W) / 2;
  const oy = (size.h - FRAME_H) / 2;
  const X = (x: number): string => fmt((x + ox) * k);
  const Y = (y: number): string => fmt((size.h - (y + oy)) * k);
  const color = (hex: string, op: 'rg' | 'RG'): string => `${hexToRgb(hex).map(fmt).join(' ')} ${op}`;

  const pages: PdfPage[] = PAGES.filter((p) => pageIds.includes(p.id)).map((page) => {
    const ops: string[] = [];
    for (const p of pagePrimitives(page)) {
      if (p.kind === 'rect') {
        const rect = `${X(p.x)} ${Y(p.y + p.h)} ${fmt(p.w * k)} ${fmt(p.h * k)} re`;
        if (p.fill) ops.push(`${color(p.fill, 'rg')} ${rect} f`);
        if (p.stroke) ops.push(`[] 0 d ${fmt((p.strokeWidth ?? 0.3) * k)} w ${color(p.stroke, 'RG')} ${rect} S`);
      } else if (p.kind === 'line') {
        const dash = p.dash ? `[${p.dash.map((d) => fmt(d * k)).join(' ')}] 0 d` : '[] 0 d';
        ops.push(`${dash} ${fmt(p.strokeWidth * k)} w ${color(p.stroke, 'RG')} ${X(p.x1)} ${Y(p.y1)} m ${X(p.x2)} ${Y(p.y2)} l S`);
      } else {
        ops.push(`${color(p.fill, 'rg')} BT /${p.bold ? 'F2' : 'F1'} ${fmt(p.size * k)} Tf ${X(p.x)} ${Y(p.y)} Td ${pdfString(p.text)} Tj ET`);
      }
    }
    return { width: size.w * k, height: size.h * k, content: ops.join('\n') };
  });
  return buildPdf(pages);
}
