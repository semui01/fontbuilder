import { createBitmap, trimBitmap } from '../core/bitmap';
import { ALL_CHARS, CAP_HEIGHT } from '../core/charset';
import { BASELINE_OFFSET, BOX_H, CAP_OFFSET, X_HEIGHT_OFFSET } from '../core/template';
import { newId, type Point } from '../core/types';
import { byId } from './dom';
import type { AppState } from './state';

// Same proportions as a template box, so drawn and scanned letters match.
const SIZE = 400;
const CAP_Y = (CAP_OFFSET / BOX_H) * SIZE;
const X_Y = (X_HEIGHT_OFFSET / BOX_H) * SIZE;
const BASE_Y = (BASELINE_OFFSET / BOX_H) * SIZE;

interface Stroke {
  width: number;
  points: Point[];
}

function strokePath(ctx: CanvasRenderingContext2D, s: Stroke): void {
  const p = s.points;
  ctx.lineWidth = s.width;
  ctx.beginPath();
  ctx.moveTo(p[0].x, p[0].y);
  if (p.length === 1) {
    ctx.lineTo(p[0].x + 0.01, p[0].y);
  } else {
    // Smooth the pointer samples with quadratic curves through their midpoints.
    for (let i = 1; i < p.length - 1; i += 1) {
      ctx.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
    }
    ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
  }
  ctx.stroke();
}

export interface DrawPanel {
  /** Selects the character to draw next. */
  select(char: string): void;
}

export function setupDrawPanel(state: AppState): DrawPanel {
  const canvas = byId<HTMLCanvasElement>('draw-canvas');
  const charInput = byId<HTMLInputElement>('draw-char');
  const pen = byId<HTMLInputElement>('draw-pen');
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const strokes: Stroke[] = [];
  let current: Stroke | null = null;

  const scale = window.devicePixelRatio > 1 ? 2 : 1;
  canvas.width = SIZE * scale;
  canvas.height = SIZE * scale;

  const redraw = (): void => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    const guide = (y: number, color: string, dash: number[], width = 1.5): void => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(SIZE, y);
      ctx.stroke();
      ctx.restore();
    };
    guide(CAP_Y, '#d6d9e2', [2, 6]);
    guide(X_Y, '#c4c9d6', [8, 6]);
    guide(BASE_Y, '#8f98ad', [], 2);
    ctx.fillStyle = '#c4c9d6';
    ctx.font = '600 120px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 0.35;
    ctx.fillText(charInput.value, SIZE - 14, BASE_Y);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#1d2433';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of strokes) strokePath(ctx, s);
    if (current) strokePath(ctx, current);
  };

  const toPoint = (e: PointerEvent): Point => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * SIZE, y: ((e.clientY - r.top) / r.height) * SIZE };
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    current = { width: Number(pen.value), points: [toPoint(e)] };
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    for (const ev of e.getCoalescedEvents?.() ?? [e]) current.points.push(toPoint(ev));
    redraw();
  });
  const finish = (): void => {
    if (current) strokes.push(current);
    current = null;
    redraw();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  const nextMissing = (): string => ALL_CHARS.find((c) => !state.glyphs.has(c)) ?? ALL_CHARS[0];

  const select = (char: string): void => {
    charInput.value = char;
    strokes.length = 0;
    redraw();
  };

  charInput.addEventListener('input', () => {
    const chars = Array.from(charInput.value.trim());
    charInput.value = chars.at(-1) ?? '';
    redraw();
  });
  byId('draw-next').addEventListener('click', () => select(nextMissing()));
  byId('draw-undo').addEventListener('click', () => {
    strokes.pop();
    redraw();
  });
  byId('draw-clear').addEventListener('click', () => {
    strokes.length = 0;
    redraw();
  });
  byId('draw-save').addEventListener('click', () => {
    const char = charInput.value;
    if (!char || !strokes.length) {
      charInput.focus();
      return;
    }
    // Render the strokes alone (no guides) at 1:1 and keep the ink.
    const off = document.createElement('canvas');
    off.width = SIZE;
    off.height = SIZE;
    const octx = off.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    octx.strokeStyle = '#000';
    octx.lineCap = 'round';
    octx.lineJoin = 'round';
    for (const s of strokes) strokePath(octx, s);
    const { data } = octx.getImageData(0, 0, SIZE, SIZE);
    const bmp = createBitmap(SIZE, SIZE);
    for (let i = 0; i < bmp.data.length; i += 1) bmp.data[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
    const trimmed = trimBitmap(bmp, 2);
    if (!trimmed) return;
    state.addGlyphs([
      {
        id: newId('d'),
        char,
        bitmap: trimmed.bitmap,
        unitsPerPx: CAP_HEIGHT / (BASE_Y - CAP_Y),
        baselineY: BASE_Y - trimmed.offsetY,
        origin: 'drawn',
      },
    ]);
    select(nextMissing());
  });

  select(nextMissing());
  return { select };
}
