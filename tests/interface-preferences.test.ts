import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyInterfacePreferences,
  defaultInterfacePreferences,
  normalizeInterfacePreferences,
  readInterfacePreferences,
  saveInterfacePreferences,
} from '../apps/web/src/preferences.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('interface preferences', () => {
  it('normalizes unknown or malformed values to safe defaults', () => {
    expect(normalizeInterfacePreferences(null)).toEqual(defaultInterfacePreferences);
    expect(normalizeInterfacePreferences({ density: 'tiny', contrast: 'neon', reduceMotion: 'yes' })).toEqual(
      defaultInterfacePreferences,
    );
    expect(normalizeInterfacePreferences({ density: 'compact', contrast: 'high', reduceMotion: true })).toEqual({
      density: 'compact',
      contrast: 'high',
      reduceMotion: true,
    });
  });

  it('survives unavailable browser storage', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('storage disabled');
        },
      },
    });

    expect(readInterfacePreferences()).toEqual(defaultInterfacePreferences);
  });

  it('applies and persists normalized settings', () => {
    const dataset: Record<string, string> = {};
    const setItem = vi.fn();
    vi.stubGlobal('document', { documentElement: { dataset } });
    vi.stubGlobal('window', { localStorage: { setItem } });

    const saved = saveInterfacePreferences({ density: 'compact', contrast: 'high', reduceMotion: true });

    expect(saved).toEqual({ density: 'compact', contrast: 'high', reduceMotion: true });
    expect(dataset).toEqual({ density: 'compact', contrast: 'high', motion: 'reduced' });
    expect(setItem).toHaveBeenCalledWith('obs-live-studio:interface-preferences', JSON.stringify(saved));

    applyInterfacePreferences(defaultInterfacePreferences);
    expect(dataset).toEqual({ density: 'comfortable', contrast: 'standard', motion: 'standard' });
  });
});
