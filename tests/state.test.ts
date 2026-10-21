import { beforeEach, describe, expect, it } from 'vitest';
import { AppState } from '../src/ui/state';
import { bar, glyph } from './helpers/glyphs';

// Minimal localStorage for the Node test environment.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe('AppState', () => {
  it('re-reading a scan replaces its own letters but keeps newer ones', () => {
    const state = new AppState();
    const scanA = glyph('A', bar());
    const scanB = glyph('B', bar());
    state.replaceGlyphs([], [scanA, scanB]);
    const drawnA = glyph('A', bar(80));
    state.addGlyphs([drawnA]);

    const rescanA = glyph('A', bar());
    // The re-read no longer finds B (e.g. lower sensitivity).
    state.replaceGlyphs([scanA.id, scanB.id], [rescanA]);
    expect(state.glyphs.get('A')!.id).toBe(drawnA.id);
    expect(state.glyphs.has('B')).toBe(false);
  });

  it('persists glyphs and settings across reloads', () => {
    const state = new AppState();
    state.addGlyphs([glyph('Q', bar(60))]);
    state.updateSettings({ familyName: 'Saved Hand', weight: 15 });
    const reloaded = new AppState();
    reloaded.load();
    expect(reloaded.settings.familyName).toBe('Saved Hand');
    expect(reloaded.settings.weight).toBe(15);
    const q = reloaded.glyphs.get('Q')!;
    expect(Array.from(q.bitmap.data)).toEqual(Array.from(state.glyphs.get('Q')!.bitmap.data));
  });
});
