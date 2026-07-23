// Tiny WebAudio UI sounds — no assets, console-style ticks.
let ctx = null;
let enabled = true;

function ac() {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

export function setSfxEnabled(v) { enabled = v; }

function blip(freq, dur, type = 'sine', gainPeak = 0.06) {
  if (!enabled) return;
  try {
    const a = ac();
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, a.currentTime);
    gain.gain.linearRampToValueAtTime(gainPeak, a.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    osc.connect(gain).connect(a.destination);
    osc.start();
    osc.stop(a.currentTime + dur + 0.02);
  } catch { /* audio unavailable — never break UI */ }
}

export const sfx = {
  move: () => blip(880, 0.07, 'sine', 0.035),
  confirm: () => { blip(660, 0.09, 'sine', 0.05); setTimeout(() => blip(990, 0.12, 'sine', 0.05), 60); },
  cancel: () => blip(330, 0.1, 'sine', 0.045),
  open: () => { blip(520, 0.1, 'sine', 0.04); setTimeout(() => blip(780, 0.14, 'sine', 0.04), 70); },
  error: () => { blip(220, 0.16, 'square', 0.03); },
};
