import { analyzePhoto, assignLabels, joinWithNext, photoGlyphs, type PhotoAnalysis, type PhotoShape } from '../core/freeform';
import { byId, debounce, fileDrop, h, nextFrame } from './dom';
import { loadImageFile } from './imageio';
import type { AppState } from './state';

/** Photos are analysed at this size; enough for letters, quick enough for phones. */
const MAX_PHOTO_SIZE = 2000;
const MAX_CARDS = 300;

export function setupPhotoPanel(state: AppState): void {
  const work = byId('photo-work');
  const view = byId<HTMLCanvasElement>('photo-canvas');
  const text = byId<HTMLTextAreaElement>('photo-text');
  const status = byId('photo-status');
  const warningsEl = byId('photo-warnings');
  const cards = byId('photo-cards');
  const addButton = byId<HTMLButtonElement>('photo-add');

  let analysis: PhotoAnalysis | null = null;
  let source: HTMLCanvasElement | null = null;

  const usable = (): PhotoShape[] => analysis?.shapes.filter((s) => !s.ignored && s.label) ?? [];

  const drawOverlay = (): void => {
    if (!analysis || !source) return;
    view.width = source.width;
    view.height = source.height;
    const ctx = view.getContext('2d') as CanvasRenderingContext2D;
    ctx.drawImage(source, 0, 0);
    const unit = Math.max(1, source.width / 600);
    ctx.lineWidth = 2 * unit;
    ctx.font = `bold ${Math.round(14 * unit)}px system-ui, sans-serif`;
    for (const s of analysis.shapes) {
      ctx.strokeStyle = s.ignored ? 'rgba(120,120,120,0.6)' : s.label ? '#1d7a45' : '#d9822b';
      ctx.strokeRect(s.x0 - 2, s.y0 - 2, s.x1 - s.x0 + 4, s.y1 - s.y0 + 4);
      if (s.label && !s.ignored) {
        const w = ctx.measureText(s.label).width + 6 * unit;
        ctx.fillStyle = '#1d7a45';
        ctx.fillRect(s.x0 - 2, s.y0 - 2 - 18 * unit, w, 18 * unit);
        ctx.fillStyle = '#fff';
        ctx.fillText(s.label, s.x0 + unit, s.y0 - 6 * unit);
      }
    }
  };

  const updateButton = (): void => {
    const n = new Set(usable().map((s) => s.label)).size;
    addButton.disabled = n === 0;
    addButton.textContent = n ? `Add ${n} letter${n === 1 ? '' : 's'} to my font` : 'Add letters to my font';
  };

  const thumb = (s: PhotoShape): HTMLCanvasElement => {
    const pad = 4;
    const c = document.createElement('canvas');
    c.width = s.x1 - s.x0 + pad * 2;
    c.height = s.y1 - s.y0 + pad * 2;
    if (source) (c.getContext('2d') as CanvasRenderingContext2D).drawImage(source, s.x0 - pad, s.y0 - pad, c.width, c.height, 0, 0, c.width, c.height);
    return c;
  };

  const renderCards = (): void => {
    cards.replaceChildren();
    if (!analysis) return;
    let line = -1;
    for (const s of analysis.shapes.slice(0, MAX_CARDS)) {
      if (s.line !== line) {
        line = s.line;
        cards.append(h('div', { class: 'shape-line', text: `Line ${line + 1}` }));
      }
      const input = h('input', {
        attrs: { value: s.label, maxlength: 2, 'aria-label': 'Character', autocomplete: 'off', spellcheck: 'false' },
        on: {
          input: (e) => {
            const el = e.target as HTMLInputElement;
            const chars = Array.from(el.value.trim());
            s.label = chars.at(-1) ?? '';
            el.value = s.label;
            drawOverlay();
            updateButton();
          },
        },
      });
      cards.append(
        h(
          'div',
          { class: `shape${s.ignored ? ' ignored' : ''}` },
          h('div', { class: 'thumb' }, thumb(s)),
          input,
          h(
            'div',
            { class: 'shape-actions' },
            h('button', {
              text: 'Join',
              attrs: { type: 'button', title: 'Join with the next shape on this line' },
              on: {
                click: () => {
                  if (!analysis) return;
                  analysis.shapes = joinWithNext(analysis.shapes, s.id);
                  relabel();
                },
              },
            }),
            h('button', {
              text: s.ignored ? 'Use' : 'Skip',
              attrs: { type: 'button' },
              on: {
                click: () => {
                  s.ignored = !s.ignored;
                  relabel();
                },
              },
            }),
          ),
        ),
      );
    }
    if (analysis.shapes.length > MAX_CARDS) {
      cards.append(h('p', { class: 'hint shape-line', text: `Showing the first ${MAX_CARDS} of ${analysis.shapes.length} shapes.` }));
    }
  };

  const relabel = (): void => {
    if (!analysis) return;
    const warnings = assignLabels(analysis.shapes, text.value);
    warningsEl.replaceChildren(...warnings.map((w) => h('li', { text: w })));
    if (warnings.length) {
      warningsEl.append(
        h('li', {
          text: 'Check the boxes below: join letters that came out in pieces, skip smudges, or fix the text. Joined-up handwriting can’t be split into letters.',
        }),
      );
    }
    const lines = new Set(analysis.shapes.map((s) => s.line)).size;
    status.textContent = `Found ${analysis.shapes.length} shapes on ${lines} line${lines === 1 ? '' : 's'}.`;
    renderCards();
    drawOverlay();
    updateButton();
  };

  fileDrop(byId('photo-drop'), byId<HTMLInputElement>('photo-input'), async ([file]) => {
    work.hidden = false;
    status.textContent = 'Looking for letters…';
    cards.replaceChildren();
    warningsEl.replaceChildren();
    await nextFrame();
    try {
      const loaded = await loadImageFile(file, MAX_PHOTO_SIZE);
      source = loaded.canvas;
      analysis = analyzePhoto(loaded.gray);
      if (!analysis.shapes.length) {
        status.textContent = 'No letters found. Try a sharper, brighter photo with dark ink.';
        drawOverlay();
        return;
      }
      relabel();
      text.focus();
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    }
  });

  text.addEventListener('input', debounce(relabel, 300));

  addButton.addEventListener('click', async () => {
    if (!analysis) return;
    addButton.disabled = true;
    status.textContent = 'Adding letters…';
    await nextFrame();
    const glyphs = photoGlyphs(analysis);
    state.addGlyphs(glyphs);
    status.textContent = `Added ${glyphs.length} letter${glyphs.length === 1 ? '' : 's'} to your font. See step 2 below.`;
    updateButton();
  });
}
