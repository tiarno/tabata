// All audio: synthesized click, synthesized horn, and TTS voice.
// One AudioContext per session, all phase audio routed through a disposable
// phaseGain so a pause/skip/stop can cancel scheduled sounds instantly.

let ctx = null;
let phaseGain = null;
let unlocked = false;

function ensureCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

// Must be called from a user gesture (tap) to satisfy iOS autoplay policy.
export async function unlockAudio() {
  ensureCtx();
  if (ctx.state === 'suspended') await ctx.resume();

  // 1-sample silent buffer unlocks WebAudio on iOS
  const buf = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);

  // Warm up SpeechSynthesis so the first real utterance isn't delayed.
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  unlocked = true;
}

export function isUnlocked() { return unlocked; }

export function now() { return ensureCtx().currentTime; }

// Begin a new phase: fresh gain node for isolated cancel.
export function beginPhase() {
  endPhase();
  phaseGain = ensureCtx().createGain();
  phaseGain.gain.value = 1;
  phaseGain.connect(ctx.destination);
}

// Cancel all scheduled-but-not-yet-played audio in this phase.
export function endPhase() {
  if (phaseGain) {
    try { phaseGain.disconnect(); } catch {}
    phaseGain = null;
  }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// A short, pleasant click (1 kHz tone, ~30 ms exp decay).
export function scheduleClick(when) {
  if (!phaseGain) return;
  const osc = ctx.createOscillator();
  const g   = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = 1000;
  g.gain.setValueAtTime(0.001, when);
  g.gain.exponentialRampToValueAtTime(0.4, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
  osc.connect(g).connect(phaseGain);
  osc.start(when);
  osc.stop(when + 0.05);
}

// Air-horn style tone: layered saws + noise burst, ~1.6 s.
export function scheduleHorn(when) {
  if (!phaseGain) return;
  const dur = 1.6;

  // Two detuned sawtooth layers for body
  const freqs = [196, 246.94]; // G3 + B3 (major third)
  freqs.forEach(f => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f, when);
    osc.frequency.linearRampToValueAtTime(f * 0.98, when + dur);
    g.gain.setValueAtTime(0.001, when);
    g.gain.exponentialRampToValueAtTime(0.25, when + 0.05);
    g.gain.setValueAtTime(0.25, when + dur - 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(g).connect(phaseGain);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  });

  // Highpass noise burst at the attack for the characteristic blare
  const noiseLen = 0.3;
  const buf = ctx.createBuffer(1, ctx.sampleRate * noiseLen, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1500;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.15, when);
  ng.gain.exponentialRampToValueAtTime(0.001, when + noiseLen);
  noise.connect(hp).connect(ng).connect(phaseGain);
  noise.start(when);
  noise.stop(when + noiseLen);
}

// TTS via SpeechSynthesis. Speaks immediately; caller manages timing.
export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  u.pitch = 1.0;
  u.volume = 1.0;
  // Pick an English voice if available (iOS sometimes defaults to system)
  const voices = speechSynthesis.getVoices();
  const en = voices.find(v => /en[-_]US/i.test(v.lang)) ||
             voices.find(v => /^en/i.test(v.lang));
  if (en) u.voice = en;
  speechSynthesis.speak(u);
}
