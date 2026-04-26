// UI wiring: settings, presets, workout screen, wake lock, service worker.

import * as A from './audio.js';
import { Workout, PHASES } from './workout.js';
import {
  loadPresets, savePreset, deletePreset, loadLast, saveLast, PRESETS_KEY
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
  btnTestVoice: $('#btn-test-voice'),
  btnTestClick: $('#btn-test-click'),
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
  workoutTitle: $('#workout-title'),
  workoutSummary: $('#workout-summary'),
  overallPercent: $('#overall-percent'),
  progressFill: $('#progress-fill'),
  nextLabel: $('#next-label'),
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

function validateNumbers(cfg) {
  const errors = [];
  if (!Number.isFinite(cfg.tabatasPerSet) || cfg.tabatasPerSet < 1) errors.push('Tabatas per set must be at least 1.');
  if (!Number.isFinite(cfg.sets) || cfg.sets < 1) errors.push('Sets must be at least 1.');
  if (!Number.isFinite(cfg.workSec) || cfg.workSec < 5) errors.push('Work seconds must be at least 5.');
  if (!Number.isFinite(cfg.restSec) || cfg.restSec < 3) errors.push('Rest seconds must be at least 3.');
  if (!Number.isFinite(cfg.setRestSec) || cfg.setRestSec < 5) errors.push('Between-set rest must be at least 5.');
  if (errors.length) throw new Error(errors.join(' '));
}

function validateForSave(cfg) {
  if (!cfg.name.trim()) throw new Error('Preset name is required.');
  validateNumbers(cfg);
}

function sanitizePreset(p) {
  if (!p || typeof p !== 'object') return null;
  const name = typeof p.name === 'string' ? p.name.trim().slice(0, 40) : '';
  if (!name) return null;
  const clean = {
    name,
    tabatasPerSet: +p.tabatasPerSet,
    sets:          +p.sets,
    workSec:       +p.workSec,
    restSec:       +p.restSec,
    setRestSec:    +p.setRestSec,
    voiceEnabled:  p.voiceEnabled !== false,
    clickEnabled:  p.clickEnabled !== false,
  };
  try { validateNumbers(clean); } catch { return null; }
  return clean;
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

let workoutTotalDuration = 0;
let phaseBaseElapsed = 0;

function refreshPresetList() {
  const presets = loadPresets();

  el.presetSelect.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '-- presets --';
  el.presetSelect.append(placeholder);
  for (const p of presets) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    el.presetSelect.append(opt);
  }

  el.presetList.replaceChildren();
  if (presets.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'no-presets';
    empty.textContent = 'No presets saved yet. Use settings to create one.';
    el.presetList.append(empty);
  } else {
    for (const p of presets) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-item';
      btn.dataset.name = p.name;
      btn.textContent = p.name;
      el.presetList.append(btn);
    }
  }
}

function totalWorkoutDuration(cfg) {
  const perSet = cfg.tabatasPerSet * (cfg.workSec + cfg.restSec) - cfg.restSec;
  return 3 + cfg.sets * perSet + (cfg.sets - 1) * cfg.setRestSec;
}

function phaseBaselineElapsed(phase, setIdx, repIdx, totalReps, totalSets, cfg) {
  if (phase === PHASES.PREP) return 0;
  const perSet = cfg.tabatasPerSet * cfg.workSec + (cfg.tabatasPerSet - 1) * cfg.restSec;
  // Elapsed at the start of set `setIdx` (0-based): 3s prep + all prior
  // sets AND their trailing setrests.
  const beforeThisSet = 3 + setIdx * (perSet + cfg.setRestSec);
  if (phase === PHASES.WORK) {
    return beforeThisSet + repIdx * (cfg.workSec + cfg.restSec);
  }
  if (phase === PHASES.REST) {
    // After rep `repIdx-1`: `repIdx` WORKs done plus `repIdx-1` RESTs done.
    return beforeThisSet + repIdx * cfg.workSec + Math.max(0, repIdx - 1) * cfg.restSec;
  }
  if (phase === PHASES.SETREST) {
    // setIdx was incremented before entering SETREST (setIdx=N = N sets
    // complete). beforeThisSet includes the setrest we haven't started
    // yet, so back it out.
    return beforeThisSet - cfg.setRestSec;
  }
  if (phase === PHASES.DONE) {
    // All sets done, no trailing setrest.
    return beforeThisSet - cfg.setRestSec;
  }
  return 0;
}

function nextPhaseLabel(phase, setIdx, repIdx, totalReps, totalSets, cfg) {
  const work = `Next: WORK ${cfg.workSec}s`;
  switch (phase) {
    case PHASES.PREP:
      return work;
    case PHASES.WORK:
      if (repIdx === totalReps - 1) {
        return setIdx === totalSets - 1
          ? 'Final rep — finish strong'
          : `Next: BREAK ${cfg.setRestSec}s`;
      }
      return `Next: REST ${cfg.restSec}s`;
    case PHASES.REST:
    case PHASES.SETREST:
      return work;
    case PHASES.DONE:
      return '';
    default:
      return '';
  }
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
  try {
    validateForSave(cfg);
  } catch (err) {
    alert(err.message);
    return;
  }
  savePreset(cfg);
  refreshPresetList();
  el.presetSelect.value = cfg.name;
});

// Recompute summary on any numeric change
['tabatas','sets','work','rest','setrest'].forEach(k =>
  el[k].addEventListener('input', updateSummary)
);

// Audio previews
el.btnTestVoice.addEventListener('click', async () => {
  await A.unlockAudio();
  A.speak('Rep 3, work');
});
el.btnTestClick.addEventListener('click', async () => {
  await A.unlockAudio();
  A.beginPhase();
  for (let i = 0; i < 3; i++) A.scheduleClick(A.now() + 0.05 + i * 0.5);
});

// ---- Start / workout ----
let workout = null;

// SW reload deferral: if a new SW activates mid-workout, don't yank the page.
// handleFinish flushes this after the workout ends.
let swReloaded = false;
let swReloadPending = false;
function maybeReloadForSW() {
  if (swReloadPending && !swReloaded) {
    swReloaded = true;
    location.reload();
  }
}

el.btnStart.addEventListener('click', async () => {
  // Guard against rapid double-tap: the handler is async, so a second tap
  // before the first completes would create a second Workout, orphan the
  // first (still running its rAF loop), and fire duplicate callbacks.
  if (workout) return;
  const cfg = readForm();
  try {
    validateNumbers(cfg);
  } catch (err) {
    alert(err.message);
    return;
  }
  saveLast(cfg);

  // CRITICAL: unlock audio inside the tap handler. Speak "Set 1 of M"
  // here so the first utterance is gesture-bound (iOS requirement).
  await A.unlockAudio(cfg.voiceEnabled ? `Set 1 of ${cfg.sets}` : null);
  await requestWakeLock();

  workoutTotalDuration = totalWorkoutDuration(cfg);
  phaseBaseElapsed = 0;

  showScreen('workout');
  setPhaseClass('prep');
  el.workoutTitle.textContent = cfg.name || 'Custom workout';
  el.workoutSummary.textContent = `${cfg.sets} sets × ${cfg.tabatasPerSet} tabatas · ${formatDuration(totalWorkoutDuration(cfg))}`;
  el.metaReps.textContent = cfg.tabatasPerSet;
  el.metaSets.textContent = cfg.sets;
  el.overallPercent.textContent = `0% · 0:00 / ${formatDuration(workoutTotalDuration)}`;
  el.progressFill.style.width = '0%';
  el.nextLabel.textContent = `Next: WORK ${cfg.workSec}s`;

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

// Hold Stop for 1s to confirm.
const STOP_HOLD_MS = 1000;
let stopHoldTimer = null;
function beginStopHold(e) {
  if (!workout || stopHoldTimer) return;
  e.preventDefault();
  el.btnStop.classList.add('holding');
  stopHoldTimer = setTimeout(() => {
    stopHoldTimer = null;
    el.btnStop.classList.remove('holding');
    workout?.stop();
  }, STOP_HOLD_MS);
}
function cancelStopHold() {
  if (!stopHoldTimer) return;
  clearTimeout(stopHoldTimer);
  stopHoldTimer = null;
  el.btnStop.classList.remove('holding');
}
el.btnStop.addEventListener('pointerdown', beginStopHold);
el.btnStop.addEventListener('pointerup', cancelStopHold);
el.btnStop.addEventListener('pointerleave', cancelStopHold);
el.btnStop.addEventListener('pointercancel', cancelStopHold);
// Suppress the default click (we own the gesture).
el.btnStop.addEventListener('click', (e) => e.preventDefault());

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
        const clean = sanitizePreset(preset);
        if (clean && !merged.find(p => p.name === clean.name)) {
          merged.push(clean);
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
const SETTINGS_OPEN_KEY = 'tabata.settingsOpen.v1';
function applySettingsOpen(open) {
  el.settingsPanel.classList.toggle('collapsed', !open);
  el.btnToggleSettings.textContent = open ? '⚙️ Hide Settings' : '⚙️ Customize Settings';
}
applySettingsOpen(localStorage.getItem(SETTINGS_OPEN_KEY) === '1');
el.btnToggleSettings.addEventListener('click', () => {
  const open = el.settingsPanel.classList.contains('collapsed');
  applySettingsOpen(open);
  localStorage.setItem(SETTINGS_OPEN_KEY, open ? '1' : '0');
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
  el.nextLabel.textContent = nextPhaseLabel(phase, setIdx, repIdx, totalReps, totalSets, workout.cfg);
  phaseBaseElapsed = phaseBaselineElapsed(phase, setIdx, repIdx, totalReps, totalSets, workout.cfg);
}

function formatDuration(totalSeconds) {
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function handleTick({ phase, remaining, progress, duration }) {
  // Count: show ceil so "20" appears the full first second
  const shown = Math.max(0, Math.ceil(remaining));
  el.count.textContent = shown;
  // Ring fills from empty → full over the phase
  const offset = RING_CIRC * (1 - progress);
  el.ring.setAttribute('stroke-dashoffset', offset.toFixed(1));

  const elapsed = Math.min(workoutTotalDuration, phaseBaseElapsed + (duration * progress));
  const pct = workoutTotalDuration > 0
    ? Math.min(100, Math.max(0, Math.round((elapsed / workoutTotalDuration) * 100)))
    : 0;
  el.overallPercent.textContent =
    `${pct}% · ${formatDuration(Math.round(elapsed))} / ${formatDuration(workoutTotalDuration)}`;
  el.progressFill.style.width = `${pct}%`;
  el.progressFill.parentElement?.setAttribute('aria-valuenow', String(pct));
}

function handleFinish({ aborted }) {
  releaseWakeLock();
  workout = null;
  setTimeout(() => {
    showScreen('settings');
    maybeReloadForSW();
  }, aborted ? 100 : 1200);
}

function labelFor(phase) {
  switch (phase) {
    case PHASES.PREP:    return 'GET READY';
    case PHASES.WORK:    return 'WORK';
    case PHASES.REST:    return 'REST';
    case PHASES.SETREST: return 'BREAK';
    case PHASES.DONE:    return 'DONE';
    default: return '';
  }
}

function setPhaseClass(phase) {
  for (const cls of [...document.body.classList]) {
    if (cls.startsWith('phase-')) document.body.classList.remove(cls);
  }
  document.body.classList.add(`phase-${phase}`);
}

function showScreen(name) {
  Object.entries(screens).forEach(([k, node]) =>
    node.classList.toggle('active', k === name));
}

// ---- Service worker ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const promote = (sw) => sw.postMessage('SKIP_WAITING');
      if (reg.waiting) promote(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            promote(sw);
          }
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (swReloaded) return;
        // Don't yank the page mid-workout. Defer until handleFinish.
        if (workout) { swReloadPending = true; return; }
        swReloaded = true;
        location.reload();
      });
    } catch (err) {
      console.warn('SW registration failed:', err);
    }
  });
}

// ---- Boot ----
refreshPresetList();
writeForm(loadLast());
