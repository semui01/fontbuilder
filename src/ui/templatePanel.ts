import { PAGES } from '../core/charset';
import { DEFAULT_INK_RATIO, scanTemplate } from '../core/scan';
import { PAPER_SIZES, templatePdf, templateSvg, type Paper } from '../core/template';
import type { GrayImage } from '../core/types';
import { byId, debounce, fileDrop, h, nextFrame } from './dom';
import { loadImageFile } from './imageio';
import { canPrint, describeOutcome, saveFile } from './platform';
import type { AppState } from './state';

interface Scan {
  name: string;
  gray: GrayImage;
  row: HTMLLIElement;
  /** Ids of the glyphs this scan added, so a re-scan can replace them. */
  glyphIds: string[];
}

/** Longest side photos are scaled to before reading; plenty for 10 px/mm boxes. */
const MAX_PHOTO_SIZE = 3200;
/** Keep only the most recent scans in memory for re-reading at a new sensitivity. */
const MAX_KEPT_SCANS = 6;

function selectedPages(): number[] {
  return byId<HTMLInputElement>('include-page2').checked ? [1, 2] : [1];
}

function printTemplate(paper: Paper): void {
  let frame = document.getElementById('print-frame') as HTMLIFrameElement | null;
  if (!frame) {
    frame = h('iframe', { class: 'print-frame', attrs: { id: 'print-frame', title: 'Template for printing', tabindex: -1, 'aria-hidden': 'true' } });
    document.body.append(frame);
  }
  const size = PAPER_SIZES[paper];
  const pages = PAGES.filter((p) => selectedPages().includes(p.id))
    .map((p) => `<div class="page">${templateSvg(p, paper)}</div>`)
    .join('');
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>Handwriting template</title><style>
    @page { size: ${size.w}mm ${size.h}mm; margin: 0; }
    html, body { margin: 0; }
    .page { width: ${size.w}mm; height: ${size.h}mm; overflow: hidden; page-break-after: always; break-after: page; }
    .page:last-child { page-break-after: auto; break-after: auto; }
    svg { display: block; }
  </style></head><body>${pages}</body></html>`;
  frame.onload = () => {
    frame?.contentWindow?.focus();
    frame?.contentWindow?.print();
  };
}

export function setupTemplatePanel(state: AppState): void {
  const paper = byId<HTMLSelectElement>('paper');
  const sensitivity = byId<HTMLInputElement>('ink-sensitivity');
  const results = byId('template-results');
  if (navigator.language && !/^en-(US|CA)|^es-(MX|US)/i.test(navigator.language)) paper.value = 'a4';

  const templateStatus = byId('template-status');
  byId('download-template').addEventListener('click', async () => {
    const pdf = templatePdf(selectedPages(), paper.value as Paper);
    templateStatus.textContent = describeOutcome(
      await saveFile(new Blob([pdf as BlobPart], { type: 'application/pdf' }), 'handwriting-template.pdf'),
    );
  });
  const printButton = byId('print-template');
  // Some hosts (e.g. an Artifact viewer) can't open the print dialog; the PDF covers printing there.
  printButton.hidden = !canPrint;
  printButton.addEventListener('click', () => printTemplate(paper.value as Paper));

  const scans: Scan[] = [];
  // Sensitivity slider: higher = more of the grey counts as ink.
  const inkRatio = (): number => Number(sensitivity.value) || DEFAULT_INK_RATIO;

  const read = (scan: Scan): void => {
    try {
      const result = scanTemplate(scan.gray, { inkRatio: inkRatio() });
      const glyphs = result.cells.flatMap((c) => (c.glyph ? [c.glyph] : []));
      state.replaceGlyphs(scan.glyphIds, glyphs);
      scan.glyphIds = glyphs.map((g) => g.id);
      const page = PAGES.find((p) => p.id === result.pageId);
      scan.row.className = 'ok';
      scan.row.textContent =
        glyphs.length > 0
          ? `${scan.name}: page ${result.pageId}, found ${glyphs.length} of ${page?.chars.length ?? 0} characters.`
          : `${scan.name}: page ${result.pageId} is empty. Fill in the boxes, then upload it again.`;
    } catch (err) {
      scan.row.className = 'error';
      scan.row.textContent = `${scan.name}: ${err instanceof Error ? err.message : String(err)}`;
    }
  };

  fileDrop(byId('template-drop'), byId<HTMLInputElement>('template-input'), async (files) => {
    for (const file of files) {
      const row = h('li', { text: `Reading ${file.name}…` });
      results.append(row);
      await nextFrame();
      try {
        const { gray } = await loadImageFile(file, MAX_PHOTO_SIZE);
        const scan: Scan = { name: file.name, gray, row, glyphIds: [] };
        scans.push(scan);
        if (scans.length > MAX_KEPT_SCANS) scans.shift();
        read(scan);
      } catch (err) {
        row.className = 'error';
        row.textContent = `${file.name}: ${err instanceof Error ? err.message : String(err)}`;
      }
      await nextFrame();
    }
  });

  sensitivity.addEventListener(
    'input',
    debounce(async () => {
      for (const scan of scans) {
        scan.row.textContent = `Re-reading ${scan.name}…`;
        await nextFrame();
        read(scan);
      }
    }, 400),
  );
}
