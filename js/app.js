// UI wiring: settings, presets, workout screen, wake lock, service worker.

import * as A from './audio.js';
import { Workout, PHASES } from './workout.js';
import {
  DEFAULT_CONFIG, loadPresets, savePreset, deletePreset, loadLast, saveLast, PRESETS_KEY
} from './storage.js';

// ---- Elements ----
const $ = sel => document.querySelector(sel);
const screens = {
  settings: $('#screen-settings'),
  workout:  $('#screen-workout'),
};
const el = {
  presetSelect: $('#preset-select'),
  presetLoad:   $('#preset-load'),
  presetDelete: $('#preset-delete'),
  presetList:   $('#preset-list'),
  btnToggleSettings: $('#btn-toggle-settings'),
  settingsPanel: $('#settings-panel'),
  name: $('#cfg-name'),
  tabatas: $('#cfg-tabatas'),
  sets: $('#cfg-sets'),
  work: $('#cfg-work'),
  rest: $('#cfg-rest'),
  setrest: $('#cfg-setrest'),
  voice: $('#cfg-voice'),
  click: $('#cfg-click'),
  summary: $('#summary'),
  btnSave: $('#btn-save'),
  btnExport: $('#btn-export'),
  btnImport: $('#btn-import'),
  importFile: $('#import-file'),
  btnStart: $('#btn-start'),
  phaseLabel: $('#phase-label'),
  count: $('#count'),
  ring: $('#ring-progress'),
  metaRep: $('#meta-rep'),
  metaReps: $('#meta-reps'),
  metaSet: $('#meta-set'),
  metaSets: $('#meta-sets'),
  btnPause: $('#btn-pause'),
  btnSkip:  $('#btn-skip'),
  btnStop:  $('#btn-stop'),
};

const RING_CIRC = 2 * Math.PI * 92; // matches SVG r=92

// ---- Wake Lock ----
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch (e) { console.warn('Wake lock failed:', e); }
}
async function releaseWakeLock() {
  try { await wakeLock?.release(); } catch {}
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && screens.workout.classList.contains('active')) {
    requestWakeLock();
  }
});

// ---- Settings form ----
function readForm() {
  return {
    name: el.name.value.trim(),
    tabatasPerSet: +el.tabatas.value,
    sets: +el.sets.value,
    workSec: +el.work.value,
    restSec: +el.rest.value,
    setRestSec: +el.setrest.value,
    voiceEnabled: el.voice.checked,
    clickEnabled: el.click.checked,
  };
}

function writeForm(cfg) {
  el.name.value     = cfg.name || '';
  el.tabatas.value  = cfg.tabatasPerSet;
  el.sets.value     = cfg.sets;
  el.work.value     = cfg.workSec;
  el.rest.value     = cfg.restSec;
  el.setrest.value  = cfg.setRestSec;
  el.voice.checked  = cfg.voiceEnabled;
  el.click.checked  = cfg.clickEnabled;
  updateSummary();
}

function updateSummary() {
  const c = readForm();
  const perSet = c.tabatasPerSet * (c.workSec + c.restSec) - c.restSec; // last rest optional? keep it simple
  const total  = c.sets * perSet + (c.sets - 1) * c.setRestSec + 3; // +3s initial prep
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  el.summary.textContent =
    `${c.sets} sets × ${c.tabatasPerSet} tabatas • ` +
    `Total ≈ ${mm}:${String(ss).padStart(2,'0')}`;
}

function refreshPresetList() {
  const presets = loadPresets();
  el.presetSelect.innerHTML =
    '<option value="">-- presets --</option>' +
    presets.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
  el.presetList.innerHTML = presets.length ?
    presets.map(p => `<button class="preset-item" data-name="${p.name}">${p.name}</button>`).join('') :
    '<p class="no-presets">No presets saved yet. Use settings to create one.</p>';
}

// ---- Preset handlers ----
el.presetLoad.addEventListener('click', () => {
  const name = el.presetSelect.value;
  if (!name) return;
  const p = loadPresets().find(x => x.name === name);
  if (p) writeForm(p);
});

el.presetDelete.addEventListener('click', () => {
  const name = el.presetSelect.value;
  if (!name) return;
  if (!confirm(`Delete preset "${name}"?`)) return;
  deletePreset(name);
  refreshPresetList();
});

el.btnSave.addEventListener('click', () => {
  const cfg = readForm();
  if (!cfg.name) { alert('Give this preset a name first.'); return; }
  savePreset(cfg);
  refreshPresetList();
  el.presetSelect.value = cfg.name;
});

// Recompute summary on any numeric change
['tabatas','sets','work','rest','setrest'].forEach(k =>
  el[k].addEventListener('input', updateSummary)
);

// ---- Start / workout ----
let workout = null;

el.btnStart.addEventListener('click', async () => {
  const cfg = readForm();
  if (cfg.sets < 1 || cfg.tabatasPerSet < 1) { alert('Need ≥1 set and ≥1 tabata.'); return; }
  saveLast(cfg);

  // CRITICAL: unlock audio inside the tap handler.
  await A.unlockAudio();
  await requestWakeLock();

  showScreen('workout');
  setPhaseClass('prep');
  el.metaReps.textContent = cfg.tabatasPerSet;
  el.metaSets.textContent = cfg.sets;

  workout = new Workout(cfg, {
    onPhaseChange: handlePhaseChange,
    onTick: handleTick,
    onFinish: handleFinish,
  });
  workout.start();

  el.btnPause.textContent = 'Pause';
});

el.btnPause.addEventListener('click', () => {
  if (!workout) return;
  if (workout.isPaused()) {
    workout.resume();
    el.btnPause.textContent = 'Pause';
  } else {
    workout.pause();
    el.btnPause.textContent = 'Resume';
  }
});

el.btnSkip.addEventListener('click', () => workout?.skip());

el.btnStop.addEventListener('click', () => {
  if (!workout) return;
  if (!confirm('Stop workout?')) return;
  workout.stop();
});

// ---- Export/Import presets ----
el.btnExport.addEventListener('click', () => {
  const presets = loadPresets();
  const data = JSON.stringify(presets, null, 2);
  const blob = new Blob([data], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tabata-presets.json';
  a.click();
  URL.revokeObjectURL(url);
});

el.btnImport.addEventListener('click', () => {
  el.importFile.click();
});

el.importFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error('Invalid format');
      const existing = loadPresets();
      const merged = [...existing];
      let added = 0;
      for (const preset of imported) {
        if (preset.name && !merged.find(p => p.name === preset.name)) {
          merged.push(preset);
          added++;
        }
      }
      merged.sort((a, b) => a.name.localeCompare(b.name));
      localStorage.setItem(PRESETS_KEY, JSON.stringify(merged));
      refreshPresetList();
      alert(`Imported ${imported.length} presets, added ${added} new`);
    } catch (err) {
      alert('Error importing: ' + err.message);
    }
  };
  reader.readAsText(file);
});

// ---- Preset list click ----
el.presetList.addEventListener('click', (e) => {
  if (e.target.classList.contains('preset-item')) {
    const name = e.target.dataset.name;
    const p = loadPresets().find(x => x.name === name);
    if (p) writeForm(p);
  }
});

// ---- Settings toggle ----
el.btnToggleSettings.addEventListener('click', () => {
  el.settingsPanel.classList.toggle('collapsed');
  el.btnToggleSettings.textContent = el.settingsPanel.classList.contains('collapsed') ? '⚙️ Customize Settings' : '⚙️ Hide Settings';
});

// ---- Workout callbacks ----
function handlePhaseChange({ phase, duration, setIdx, repIdx, totalReps, totalSets }) {
  setPhaseClass(phase);
  el.phaseLabel.textContent = labelFor(phase);
  el.metaRep.textContent  = (phase === PHASES.SETREST || phase === PHASES.PREP)
    ? '–'
    : Math.min(repIdx + 1, totalReps);
  el.metaReps.textContent = totalReps;
  el.metaSet.textContent  = Math.min(setIdx + 1, totalSets);
  el.metaSets.textContent = totalSets;
}

function handleTick({ phase, remaining, progress }) {
  // Count: show ceil so "20" appears the full first second
  const shown = Math.max(0, Math.ceil(remaining));
  el.count.textContent = shown;
  // Ring fills from empty → full over the phase
  const offset = RING_CIRC * (1 - progress);
  el.ring.setAttribute('stroke-dashoffset', offset.toFixed(1));
}

function handleFinish({ aborted }) {
  releaseWakeLock();
  workout = null;
  setTimeout(() => showScreen('settings'), aborted ? 100 : 1200);
}

function labelFor(phase) {
  switch (phase) {
    case PHASES.PREP:    return 'GET READY';
    case PHASES.WORK:    return 'WORK';
    case PHASES.REST:    return 'REST';
    case PHASES.SETREST: return 'SET REST';
    case PHASES.DONE:    return 'DONE';
    default: return '';
  }
}

function setPhaseClass(phase) {
  document.body.className = document.body.className
    .split(' ').filter(c => !c.startsWith('phase-')).join(' ').trim();
  document.body.classList.add(`phase-${phase}`);
}

function showScreen(name) {
  Object.entries(screens).forEach(([k, node]) =>
    node.classList.toggle('active', k === name));
}

// ---- Service worker ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err =>
      console.warn('SW registration failed:', err));
  });
}

// ---- Boot ----
refreshPresetList();
writeForm(loadLast());
