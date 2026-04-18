// Workout state machine + phase scheduler.
//
// Phases (in order per set):
//   PREP      – only before set 1, 3 s, 1 click/s
//   WORK      – cfg.workSec, click last 5 s, voice "Rep X, work"
//   REST      – cfg.restSec, voice "Rest"
//   (repeat WORK/REST cfg.tabatasPerSet times)
//   SETREST   – cfg.setRestSec (between sets only), voice "Rest" on entry
//               and "Set Y of M" at T-5 s (single announce if short), click last 3 s
//   DONE      – horn
//
// Timing source of truth: AudioContext.currentTime. rAF only updates UI.

import * as A from './audio.js';

export const PHASES = { PREP:'prep', WORK:'work', REST:'rest', SETREST:'setrest', DONE:'done' };

// How many seconds before SETREST ends to announce the next set.
// The "Set X of M" speech takes ~1.5s, then clicks at T-3, T-2, T-1.
const SETREST_LEAD_SEC = 5;
// Minimum setrest duration to split the announcement into "Rest" now +
// "Set X" near the end. Shorter rests get a single "Set X" at entry.
const SETREST_SPLIT_MIN = 12;

export class Workout {
  constructor(cfg, handlers) {
    this.cfg = cfg;
    this.on = handlers; // { onTick, onPhaseChange, onFinish }

    this.setIdx = 0;     // 0-based; UI shows +1
    this.repIdx = 0;     // 0-based; UI shows +1
    this.phase = null;
    this.phaseDur = 0;
    this.phaseStart = 0; // audioCtx time
    this.pausedAt = null;
    this.stopped = false;
    this._raf = 0;
    this._voiceTimer = null;
    this._setRestAnnounced = false;
  }

  _clearVoiceTimer() {
    if (this._voiceTimer) {
      clearTimeout(this._voiceTimer);
      this._voiceTimer = null;
    }
  }

  start() {
    // First phase: 3s prep, clicks only. "Set 1 of M" is spoken during
    // unlockAudio so it stays bound to the user gesture on iOS.
    this._enter(PHASES.PREP, 3, { clickEverySec: true });
  }

  pause() {
    if (this.pausedAt != null || this.stopped) return;
    this.pausedAt = A.now();
    cancelAnimationFrame(this._raf);
    this._clearVoiceTimer();
    A.endPhase(); // kill pending clicks / TTS
  }

  resume() {
    if (this.pausedAt == null || this.stopped) return;
    const remaining = this.phaseDur - (this.pausedAt - this.phaseStart);
    this.pausedAt = null;
    // Re-enter current phase with shortened duration, no re-announce.
    A.beginPhase();
    this._scheduleSounds(this.phase, remaining, { fromPauseResume: true });
    this.phaseStart = A.now();
    this.phaseDur = remaining;
    this._loop();
  }

  skip() {
    if (this.stopped) return;
    if (this.pausedAt != null) { this.pausedAt = null; }
    cancelAnimationFrame(this._raf);
    this._clearVoiceTimer();
    A.endPhase();
    this._advance();
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this._raf);
    this._clearVoiceTimer();
    A.endPhase();
    this.on.onFinish?.({ aborted: true });
  }

  isPaused() { return this.pausedAt != null; }

  // ---- internals ----

  _enter(phase, duration, opts = {}) {
    this.phase = phase;
    this.phaseDur = duration;
    if (phase === PHASES.SETREST) this._setRestAnnounced = false;
    A.beginPhase();
    this._scheduleSounds(phase, duration, opts);
    this.phaseStart = A.now();
    this.on.onPhaseChange?.({
      phase, duration,
      setIdx: this.setIdx, repIdx: this.repIdx,
      totalSets: this.cfg.sets, totalReps: this.cfg.tabatasPerSet,
    });
    this._loop();
  }

  _scheduleSounds(phase, remaining, opts = {}) {
    const t0 = A.now() + 0.05; // small lead for scheduling
    const cfg = this.cfg;

    this._clearVoiceTimer();

    // Voice cue at phase entry (skip if this is a pause-resume).
    if (!opts.fromPauseResume && cfg.voiceEnabled) {
      if (phase === PHASES.WORK) {
        A.speak(`Rep ${this.repIdx + 1}, work`);
      } else if (phase === PHASES.REST) {
        A.speak('Rest');
      } else if (phase === PHASES.SETREST) {
        // Long between-set rest: announce "Rest" now, defer next-set cue
        // to T-SETREST_LEAD_SEC. Short rest: single announce like before.
        if (remaining >= SETREST_SPLIT_MIN) {
          A.speak('Rest');
        } else {
          A.speak(`Set ${this.setIdx + 1} of ${cfg.sets}`);
          this._setRestAnnounced = true;
        }
      } else if (phase === PHASES.DONE) {
        A.speak('Workout complete');
      }
    }

    // Deferred "Set X of M" for long setrest — also fires correctly after
    // a pause/resume because _scheduleSounds is re-called on resume.
    if (phase === PHASES.SETREST && cfg.voiceEnabled && !this._setRestAnnounced) {
      const leadMs = Math.max(0, (remaining - SETREST_LEAD_SEC) * 1000);
      this._voiceTimer = setTimeout(() => {
        this._voiceTimer = null;
        if (this.phase === PHASES.SETREST && this.pausedAt == null && !this.stopped) {
          this._setRestAnnounced = true;
          A.speak(`Set ${this.setIdx + 1} of ${this.cfg.sets}`);
        }
      }, leadMs);
    }

    // Horn on DONE
    if (phase === PHASES.DONE) {
      A.scheduleHorn(t0);
      return t0;
    }

    if (!cfg.clickEnabled) return t0;

    // Click schedules
    const schedClicks = (offsetsFromEnd) => {
      offsetsFromEnd.forEach(sec => {
        const when = t0 + (remaining - sec);
        if (when > A.now()) A.scheduleClick(when);
      });
    };

    if (phase === PHASES.PREP) {
      // 1 click/s for whole (short) prep
      for (let s = Math.floor(remaining); s >= 1; s--) schedClicks([s]);
    } else if (phase === PHASES.WORK) {
      schedClicks([5, 4, 3, 2, 1]);
    } else if (phase === PHASES.SETREST) {
      schedClicks([3, 2, 1]);
    }
    // REST: no clicks
    return t0;
  }

  _loop() {
    const tick = () => {
      if (this.stopped || this.pausedAt != null) return;
      const elapsed = A.now() - this.phaseStart;
      const remaining = Math.max(0, this.phaseDur - elapsed);
      this.on.onTick?.({
        phase: this.phase,
        remaining,
        duration: this.phaseDur,
        progress: this.phaseDur > 0 ? elapsed / this.phaseDur : 1,
      });
      if (remaining <= 0) {
        this._advance();
        return;
      }
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _advance() {
    if (this.stopped) return;
    const cfg = this.cfg;

    switch (this.phase) {
      case PHASES.PREP:
      case PHASES.SETREST:
        // Start the next set's first WORK
        this.repIdx = 0;
        this._enter(PHASES.WORK, cfg.workSec);
        return;

      case PHASES.WORK:
        // After work either REST (more reps coming) or short-circuit
        this.repIdx += 1;
        if (this.repIdx < cfg.tabatasPerSet) {
          this._enter(PHASES.REST, cfg.restSec);
        } else {
          // Set finished
          this.setIdx += 1;
          if (this.setIdx < cfg.sets) {
            this._enter(PHASES.SETREST, cfg.setRestSec);
          } else {
            this._enter(PHASES.DONE, 2.0);
            setTimeout(() => {
              if (this.stopped) return;
              this.stopped = true;
              this.on.onFinish?.({ aborted: false });
            }, 2200);
          }
        }
        return;

      case PHASES.REST:
        this._enter(PHASES.WORK, cfg.workSec);
        return;

      case PHASES.DONE:
        return;
    }
  }
}
