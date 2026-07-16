export type InterfaceDensity = 'comfortable' | 'compact';
export type InterfaceContrast = 'standard' | 'high';

export type InterfacePreferences = {
  density: InterfaceDensity;
  contrast: InterfaceContrast;
  reduceMotion: boolean;
};

const STORAGE_KEY = 'obs-live-studio:interface-preferences';

export const defaultInterfacePreferences: InterfacePreferences = {
  density: 'comfortable',
  contrast: 'standard',
  reduceMotion: false,
};

export function normalizeInterfacePreferences(value: unknown): InterfacePreferences {
  if (!value || typeof value !== 'object') return defaultInterfacePreferences;
  const candidate = value as Partial<InterfacePreferences>;
  return {
    density: candidate.density === 'compact' ? 'compact' : 'comfortable',
    contrast: candidate.contrast === 'high' ? 'high' : 'standard',
    reduceMotion: candidate.reduceMotion === true,
  };
}

export function readInterfacePreferences(): InterfacePreferences {
  if (typeof window === 'undefined') return defaultInterfacePreferences;
  try {
    return normalizeInterfacePreferences(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return defaultInterfacePreferences;
  }
}

export function applyInterfacePreferences(preferences: InterfacePreferences) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.density = preferences.density;
  document.documentElement.dataset.contrast = preferences.contrast;
  document.documentElement.dataset.motion = preferences.reduceMotion ? 'reduced' : 'standard';
}

export function saveInterfacePreferences(preferences: InterfacePreferences) {
  const normalized = normalizeInterfacePreferences(preferences);
  applyInterfacePreferences(normalized);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // The preference still applies for this page view when browser storage is unavailable.
    }
  }
  return normalized;
}

export function installInterfacePreferences() {
  applyInterfacePreferences(readInterfacePreferences());
}
