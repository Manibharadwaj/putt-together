// Tiny synth: all game audio generated with WebAudio oscillators —
// zero asset downloads and it never blocks the first paint.

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
  const a = ac();
  if (!a) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, a.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  osc.connect(g).connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + dur);
}

export const sfx = {
  putt(power: number) {
    tone(180 + power * 6, 0.08, 'triangle', 0.25);
  },
  bounce() {
    tone(240, 0.06, 'square', 0.12, 160);
  },
  splash() {
    tone(400, 0.35, 'sawtooth', 0.14, 60);
  },
  sink() {
    tone(523, 0.12, 'sine', 0.3);
    setTimeout(() => tone(659, 0.12, 'sine', 0.3), 110);
    setTimeout(() => tone(784, 0.22, 'sine', 0.3), 220);
  },
  ace() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      setTimeout(() => tone(f, 0.18, 'sine', 0.3), i * 90);
    });
  },
  click() {
    tone(600, 0.04, 'triangle', 0.1);
  },
};
