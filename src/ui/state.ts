import { decodeBitmap, encodeBitmap } from '../core/bitmap';
import { DEFAULT_SETTINGS, type FontSettings } from '../core/font';
import type { GlyphSource } from '../core/types';

export const DEFAULT_PREVIEW_TEXT =
  'The quick brown fox jumps over the lazy dog.\nThank you so much for everything! — Sam';

type Listener = () => void;

/** Everything the person has made so far. Saved in this browser only. */
export class AppState {
  glyphs = new Map<string, GlyphSource>();
  settings: FontSettings = { ...DEFAULT_SETTINGS };
  previewText = DEFAULT_PREVIEW_TEXT;
  private glyphListeners: Listener[] = [];
  private settingsListeners: Listener[] = [];

  onGlyphs(fn: Listener): void {
    this.glyphListeners.push(fn);
  }

  onSettings(fn: Listener): void {
    this.settingsListeners.push(fn);
  }

  addGlyphs(glyphs: GlyphSource[]): void {
    for (const g of glyphs) this.glyphs.set(g.char, g);
    this.emitGlyphs();
  }

  /**
   * Swaps in a re-read of an earlier upload: replaces the glyphs it added
   * before (`oldIds`) without overwriting letters added since by other means.
   * With no `oldIds` this is a plain add, where newer letters win.
   */
  replaceGlyphs(oldIds: string[], glyphs: GlyphSource[]): void {
    const old = new Set(oldIds);
    for (const g of glyphs) {
      const current = this.glyphs.get(g.char);
      if (!old.size || !current || old.has(current.id)) this.glyphs.set(g.char, g);
    }
    for (const [char, g] of this.glyphs) if (old.has(g.id)) this.glyphs.delete(char);
    this.emitGlyphs();
  }

  removeGlyph(char: string): void {
    this.glyphs.delete(char);
    this.emitGlyphs();
  }

  clearGlyphs(): void {
    this.glyphs.clear();
    this.emitGlyphs();
  }

  updateSettings(patch: Partial<FontSettings>): void {
    this.settings = { ...this.settings, ...patch };
    for (const fn of this.settingsListeners) fn();
    this.save();
  }

  private emitGlyphs(): void {
    for (const fn of this.glyphListeners) fn();
    this.save();
  }

  private static readonly KEY = 'fontbuilder:v1';

  save(): void {
    const payload = {
      settings: this.settings,
      previewText: this.previewText,
      glyphs: [...this.glyphs.values()].map((g) => ({ ...g, bitmap: encodeBitmap(g.bitmap) })),
    };
    try {
      localStorage.setItem(AppState.KEY, JSON.stringify(payload));
    } catch {
      // Storage full or unavailable (private browsing): the session still works, it just won't persist.
    }
  }

  load(): void {
    try {
      const raw = localStorage.getItem(AppState.KEY);
      if (!raw) return;
      const payload = JSON.parse(raw) as {
        settings?: Partial<FontSettings>;
        previewText?: string;
        glyphs?: Array<Omit<GlyphSource, 'bitmap'> & { bitmap: string }>;
      };
      this.settings = { ...DEFAULT_SETTINGS, ...payload.settings };
      if (typeof payload.previewText === 'string') this.previewText = payload.previewText;
      for (const g of payload.glyphs ?? []) this.glyphs.set(g.char, { ...g, bitmap: decodeBitmap(g.bitmap) });
    } catch {
      // Corrupt or old data: start fresh.
    }
  }
}
