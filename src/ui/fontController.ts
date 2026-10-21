import { buildFont, OutlineCache, type BuiltFont } from '../core/font';
import { nextFrame } from './dom';
import type { AppState } from './state';

/**
 * Rebuilds the font whenever glyphs or settings change and installs it in the
 * page (via FontFace) so every preview uses it immediately.
 */
export class FontController {
  built: BuiltFont | null = null;
  /** CSS font-family of the currently loaded preview font. */
  family: string | null = null;
  private cache = new OutlineCache();
  private face: FontFace | null = null;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners: Array<(built: BuiltFont | null) => void> = [];

  constructor(
    private state: AppState,
    private status: HTMLElement,
  ) {}

  onBuilt(fn: (built: BuiltFont | null) => void): void {
    this.listeners.push(fn);
  }

  schedule(delay = 200): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.rebuild(), delay);
  }

  /** Builds a fresh font with the current settings (used for downloads). */
  buildNow(): BuiltFont | null {
    if (!this.state.glyphs.size) return null;
    return buildFont([...this.state.glyphs.values()], this.state.settings, this.cache);
  }

  private async rebuild(): Promise<void> {
    const seq = ++this.seq;
    if (!this.state.glyphs.size) {
      this.install(null, null);
      this.status.textContent = '';
      return;
    }
    this.status.textContent = 'Updating your font…';
    await nextFrame();
    if (seq !== this.seq) return;
    let built: BuiltFont;
    try {
      this.cache.retain(new Set([...this.state.glyphs.values()].map((g) => g.id)));
      built = buildFont([...this.state.glyphs.values()], this.state.settings, this.cache);
    } catch (err) {
      this.status.textContent = `Couldn't build the font: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    const family = `Handwriting Preview ${seq}`;
    const face = new FontFace(family, built.buffer);
    try {
      await face.load();
    } catch {
      this.status.textContent = "The browser couldn't load the font preview.";
      return;
    }
    if (seq !== this.seq) return;
    document.fonts.add(face);
    this.install(face, built);
    this.status.textContent = '';
  }

  private install(face: FontFace | null, built: BuiltFont | null): void {
    if (this.face) document.fonts.delete(this.face);
    this.face = face;
    this.built = built;
    this.family = face ? face.family : null;
    document.documentElement.style.setProperty('--hw-font', face ? `"${face.family}", system-ui` : 'system-ui');
    for (const fn of this.listeners) fn(built);
  }
}
