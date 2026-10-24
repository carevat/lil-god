// Tiny synthesized audio: interface clicks, divine powers and a quiet ambient bed. All optional.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let ambient: { stop: () => void } | null = null;
let noiseBuf: AudioBuffer | null = null;

export type Sfx = 'click' | 'life' | 'nature' | 'rain' | 'lightning' | 'meteor' | 'impact' | 'alert' | 'error' | 'war' | 'build' | 'forge';

/** Must be called from a user gesture (browsers block audio before interaction). */
export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  if (!muted) startAmbient();
}

export function setAudioMuted(m: boolean) {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.05);
  if (m) { ambient?.stop(); ambient = null; } else if (ctx && !ambient) startAmbient();
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.15, slideTo?: number, delay = 0) {
  if (!ctx || !master || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur: number, gain = 0.2, freq = 1200, q = 0.7, type: BiquadFilterType = 'lowpass', delay = 0) {
  if (!ctx || !master || !noiseBuf || muted) return;
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t); s.stop(t + dur + 0.05);
}

export function sfx(kind: Sfx) {
  if (!ctx || muted) return;
  switch (kind) {
    case 'click': tone(660, 0.05, 'triangle', 0.05); break;
    case 'life': tone(392, 0.25, 'sine', 0.12); tone(523, 0.3, 'sine', 0.1, undefined, 0.09); tone(784, 0.4, 'sine', 0.08, undefined, 0.18); break;
    case 'forge': tone(300, 0.3, 'triangle', 0.1, 520); tone(600, 0.25, 'sine', 0.08, undefined, 0.12); break;
    case 'nature': tone(523, 0.3, 'sine', 0.08); tone(659, 0.35, 'sine', 0.07, undefined, 0.08); break;
    case 'rain': noise(1.2, 0.12, 4000, 0.5, 'highpass'); break;
    case 'lightning': noise(0.5, 0.35, 2500, 0.6, 'bandpass'); tone(90, 0.5, 'sawtooth', 0.12, 40); break;
    case 'meteor': noise(1.6, 0.2, 700, 0.7, 'lowpass'); tone(500, 1.6, 'sawtooth', 0.05, 90); break;
    case 'impact': noise(1.1, 0.5, 300, 0.7, 'lowpass'); tone(70, 0.9, 'sine', 0.3, 28); break;
    case 'alert': tone(330, 0.18, 'square', 0.06); tone(247, 0.3, 'square', 0.06, undefined, 0.2); break;
    case 'war': tone(196, 0.5, 'sawtooth', 0.08); tone(147, 0.8, 'sawtooth', 0.08, undefined, 0.4); break;
    case 'error': tone(180, 0.15, 'square', 0.05); break;
    case 'build': tone(440, 0.08, 'triangle', 0.06); break;
  }
}

function startAmbient() {
  if (!ctx || !master) return;
  const g = ctx.createGain();
  g.gain.value = 0.035;
  const a = ctx.createOscillator(), b = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain();
  a.type = 'sine'; b.type = 'sine'; a.frequency.value = 110; b.frequency.value = 164.8;
  lfo.frequency.value = 0.07; lg.gain.value = 0.02;
  lfo.connect(lg); lg.connect(g.gain);
  a.connect(g); b.connect(g); g.connect(master);
  a.start(); b.start(); lfo.start();
  ambient = { stop: () => { try { a.stop(); b.stop(); lfo.stop(); } catch { /* already stopped */ } g.disconnect(); } };
}
