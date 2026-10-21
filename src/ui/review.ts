import { CHAR_HINTS, DIGITS, LOWERCASE, PAGES, UPPERCASE } from '../core/charset';
import { outlineToSvgPath } from '../core/outline';
import { byId, h } from './dom';
import type { FontController } from './fontController';
import type { AppState } from './state';

const SECTIONS: Array<{ title: string; chars: string[]; optional?: boolean }> = [
  { title: 'Capitals', chars: UPPERCASE },
  { title: 'Small letters', chars: LOWERCASE },
  { title: 'Numbers & punctuation', chars: [...DIGITS, ...PAGES[0].chars.filter((c) => !/[A-Za-z0-9]/.test(c))] },
  { title: 'Symbols & accented letters (optional)', chars: PAGES[1].chars, optional: true },
];

const ORIGIN_TEXT = {
  template: 'From your template photo.',
  photo: 'From your handwriting photo.',
  drawn: 'Drawn on screen.',
};

export function setupReview(state: AppState, fonts: FontController, drawInstead: (char: string) => void): () => void {
  const grid = byId('glyph-grid');
  const summary = byId('review-summary');
  const clearBox = byId('clear-all-box');
  const clearAll = byId<HTMLButtonElement>('clear-all');
  const clearConfirm = byId('clear-confirm');
  const dialog = byId<HTMLDialogElement>('glyph-dialog');
  let dialogChar = '';

  const openDialog = (char: string): void => {
    dialogChar = char;
    const src = state.glyphs.get(char);
    byId('glyph-dialog-title').textContent = `Character “${char}”${CHAR_HINTS[char] ? ` (${CHAR_HINTS[char]})` : ''}`;
    const preview = byId('glyph-dialog-preview');
    preview.replaceChildren();
    const outline = fonts.built?.outlines.get(char);
    if (src && outline) {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      const asc = 1000;
      const desc = 350;
      svg.setAttribute('viewBox', `${Math.min(0, outline.xMin - 60)} ${-asc} ${Math.max(outline.xMax + 60, 600)} ${asc + desc}`);
      const base = document.createElementNS(ns, 'line');
      Object.entries({ x1: -2000, x2: 4000, y1: 0, y2: 0, stroke: '#c4c9d6', 'stroke-width': 6 }).forEach(([k, v]) => base.setAttribute(k, String(v)));
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', outlineToSvgPath(outline));
      path.setAttribute('fill', '#1d2433');
      svg.append(base, path);
      preview.append(svg);
    } else {
      preview.append(h('p', { class: 'hint', text: src ? 'Building…' : 'Not added yet.' }));
    }
    byId('glyph-dialog-source').textContent = src
      ? ORIGIN_TEXT[src.origin]
      : fonts.built?.covered.has(char)
        ? 'Not written yet. The font borrows the other case for now.'
        : 'Not written yet. Apps will show a standard font for this character.';
    byId<HTMLButtonElement>('glyph-dialog-remove').hidden = !src;
    // Closing with Esc keeps the previous returnValue, so clear it first.
    dialog.returnValue = '';
    dialog.showModal();
  };

  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'remove') state.removeGlyph(dialogChar);
    if (dialog.returnValue === 'draw') drawInstead(dialogChar);
  });

  // An in-page confirmation: browser confirm() dialogs are blocked in some embeds.
  const showConfirm = (open: boolean): void => {
    clearAll.hidden = open;
    clearConfirm.hidden = !open;
    (open ? byId('clear-no') : clearAll).focus();
  };
  clearAll.addEventListener('click', () => showConfirm(true));
  byId('clear-no').addEventListener('click', () => showConfirm(false));
  byId('clear-yes').addEventListener('click', () => {
    clearAll.hidden = false;
    clearConfirm.hidden = true;
    state.clearGlyphs();
  });

  const render = (): void => {
    const covered = fonts.built?.covered;
    const basic = PAGES[0].chars;
    const have = basic.filter((c) => state.glyphs.has(c)).length;
    const extra = PAGES[1].chars.filter((c) => state.glyphs.has(c)).length;
    clearBox.hidden = state.glyphs.size === 0;
    if (clearBox.hidden) {
      clearAll.hidden = false;
      clearConfirm.hidden = true;
    }
    summary.textContent = state.glyphs.size
      ? `${have} of ${basic.length} basic characters${extra ? `, plus ${extra} extra` : ''}. Tap any character to check, redraw or remove it.`
      : 'Nothing yet. Add some handwriting above.';
    grid.replaceChildren(
      ...SECTIONS.filter((s) => !s.optional || s.chars.some((c) => state.glyphs.has(c)) || state.glyphs.size > 0).map((section) =>
        h(
          'div',
          { class: 'grid-section' },
          h('h3', { text: section.title }),
          h(
            'div',
            { class: 'glyphs' },
            ...section.chars.map((char) => {
              const own = state.glyphs.has(char);
              const borrowed = !own && covered?.has(char);
              return h(
                'button',
                {
                  class: `glyph${own || borrowed ? '' : ' missing'}`,
                  attrs: {
                    type: 'button',
                    title: own ? `${char}` : borrowed ? `${char} (borrowed from the other case)` : `${char} (missing)`,
                    'aria-label': `${char}${own ? '' : borrowed ? ', borrowed from the other case' : ', missing'}`,
                  },
                  on: { click: () => openDialog(char) },
                },
                h('span', { class: 'label', text: own ? '' : borrowed ? '↔' : '' }),
                h('span', { class: 'shown', text: char }),
              );
            }),
          ),
        ),
      ),
    );
  };
  return render;
}
