import { sanitizeFamilyName, type FontSettings } from '../core/font';
import { byId, debounce, downloadBlob } from './dom';
import type { FontController } from './fontController';
import type { AppState } from './state';

/** Renders the preview text in the handwriting font as a transparent PNG. */
async function textImage(text: string, family: string, color: string): Promise<Blob> {
  const size = 96;
  const lineHeight = size * 1.3;
  const lines = text.replace(/\s+$/, '').split('\n');
  const font = `${size}px "${family}"`;
  await document.fonts.load(font, text);
  const measure = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  measure.font = font;
  const pad = size * 0.3;
  const width = Math.ceil(Math.max(1, ...lines.map((l) => measure.measureText(l).width)) + pad * 2);
  const height = Math.ceil(lines.length * lineHeight + pad * 2);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, i) => ctx.fillText(line, pad, pad + size + i * lineHeight));
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png'),
  );
}

export function setupTuneAndUse(state: AppState, fonts: FontController): () => void {
  const text = byId<HTMLTextAreaElement>('preview-text');
  const size = byId<HTMLInputElement>('preview-size');
  const name = byId<HTMLInputElement>('font-name');
  const downloadFont = byId<HTMLButtonElement>('download-font');
  const copyImage = byId<HTMLButtonElement>('copy-image');
  const downloadImage = byId<HTMLButtonElement>('download-image');
  const imageStatus = byId('image-status');
  const snippet = byId('css-snippet');

  // Settings controls.
  const bindRange = (id: string, key: 'weight' | 'letterSpacing' | 'wordSpacing'): void => {
    const input = byId<HTMLInputElement>(id);
    input.value = String(state.settings[key]);
    input.addEventListener('input', () => {
      state.updateSettings({ [key]: Number(input.value) } as Partial<FontSettings>);
      fonts.schedule(key === 'weight' ? 250 : 120);
    });
  };
  bindRange('set-weight', 'weight');
  bindRange('set-letter', 'letterSpacing');
  bindRange('set-word', 'wordSpacing');
  const bindCheck = (id: string, key: 'normalizeSize' | 'alignBaseline' | 'fillMissingCase'): void => {
    const input = byId<HTMLInputElement>(id);
    input.checked = state.settings[key];
    input.addEventListener('change', () => {
      state.updateSettings({ [key]: input.checked } as Partial<FontSettings>);
      fonts.schedule(0);
    });
  };
  bindCheck('set-normalize', 'normalizeSize');
  bindCheck('set-baseline', 'alignBaseline');
  bindCheck('set-fillcase', 'fillMissingCase');

  // Preview text, size and ink colour.
  text.value = state.previewText;
  text.addEventListener(
    'input',
    debounce(() => {
      state.previewText = text.value;
      state.save();
    }, 500),
  );
  const applySize = (): void => {
    text.style.fontSize = `${size.value}px`;
  };
  size.addEventListener('input', applySize);
  applySize();
  let ink = '#1d2433';
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="ink"]')) {
    radio.addEventListener('change', () => {
      ink = radio.value;
      document.documentElement.style.setProperty('--ink', ink);
    });
  }

  // Name & downloads.
  name.value = state.settings.familyName;
  const updateSnippet = (): void => {
    const family = sanitizeFamilyName(name.value);
    snippet.textContent = `@font-face {\n  font-family: "${family}";\n  src: url("${family}.otf") format("opentype");\n}\n\n.handwriting {\n  font-family: "${family}", cursive;\n}`;
  };
  name.addEventListener('input', () => {
    state.updateSettings({ familyName: name.value });
    updateSnippet();
  });
  name.addEventListener('blur', () => {
    name.value = sanitizeFamilyName(name.value);
    state.updateSettings({ familyName: name.value });
    updateSnippet();
  });
  updateSnippet();

  downloadFont.addEventListener('click', () => {
    const built = fonts.buildNow();
    if (!built) return;
    const family = sanitizeFamilyName(state.settings.familyName);
    downloadBlob(new Blob([built.buffer], { type: 'font/otf' }), `${family}.otf`);
  });

  downloadImage.addEventListener('click', async () => {
    if (!fonts.family) return;
    try {
      const blob = await textImage(text.value, fonts.family, ink);
      downloadBlob(blob, `${sanitizeFamilyName(state.settings.familyName)}.png`);
      imageStatus.textContent = '';
    } catch (err) {
      imageStatus.textContent = err instanceof Error ? err.message : String(err);
    }
  });

  copyImage.addEventListener('click', async () => {
    if (!fonts.family) return;
    const family = fonts.family;
    try {
      if (!('ClipboardItem' in window) || !navigator.clipboard?.write) throw new Error('unsupported');
      // Safari needs the ClipboardItem created synchronously inside the click.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': textImage(text.value, family, ink) })]);
      imageStatus.textContent = 'Copied! Paste it into your email, signature or document.';
    } catch {
      imageStatus.textContent = "This browser can't copy images. Use “Download image” instead and insert the file.";
    }
  });

  return () => {
    const ready = Boolean(fonts.built);
    downloadFont.disabled = !ready;
    copyImage.disabled = !ready;
    downloadImage.disabled = !ready;
  };
}
