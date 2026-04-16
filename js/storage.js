// Preset + last-used config persistence.

const PRESETS_KEY = 'tabata.presets.v1';
const LAST_KEY    = 'tabata.last.v1';

export const DEFAULT_CONFIG = {
  name: '',
  tabatasPerSet: 6,
  sets: 8,
  workSec: 20,
  restSec: 10,
  setRestSec: 30,
  voiceEnabled: true,
  clickEnabled: true,
};

export function loadPresets() {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function savePreset(cfg) {
  if (!cfg.name?.trim()) throw new Error('Preset needs a name');
  const presets = loadPresets().filter(p => p.name !== cfg.name);
  presets.push({ ...cfg });
  presets.sort((a, b) => a.name.localeCompare(b.name));
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  return presets;
}

export function deletePreset(name) {
  const presets = loadPresets().filter(p => p.name !== name);
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
  return presets;
}

export function loadLast() {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : { ...DEFAULT_CONFIG };
  } catch { return { ...DEFAULT_CONFIG }; }
}

export function saveLast(cfg) {
  localStorage.setItem(LAST_KEY, JSON.stringify(cfg));
}
