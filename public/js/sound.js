// Sound, synthesised at runtime.
//
// Not one audio file ships with the studio. Every cue below is built from
// oscillators and noise through the Web Audio API, which means: nothing to
// download on college WiFi, nothing to cache, no licensing, and each sound is
// a few numbers you can tune instead of an asset you have to re-record.
//
// Browsers refuse to make noise before the user interacts with the page, so the
// context is created lazily and resumed on the first gesture.

const KEY = 'htfw:muted';
const NOTE = { C4: 261.6, E4: 329.6, G4: 392.0, A4: 440.0, C5: 523.3, E5: 659.3, G5: 784.0, C6: 1046.5 };

class SoundKit {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = localStorage.getItem(KEY) === '1';
    this.listeners = new Set();
  }

  /** Called on the first real gesture — before that, browsers stay silent. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
  }

  setMuted(muted) {
    this.muted = muted;
    localStorage.setItem(KEY, muted ? '1' : '0');
    if (this.master) {
      // Ramp rather than jump, so muting mid-cue doesn't click.
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.5, this.ctx.currentTime + 0.05);
    }
    for (const fn of this.listeners) fn(muted);
  }

  toggle() {
    this.unlock();
    this.setMuted(!this.muted);
    if (!this.muted) this.play('click');
    return this.muted;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** One shaped oscillator. `slide` bends the pitch over the note's life. */
  tone({ freq = 440, dur = 0.12, type = 'sine', gain = 0.3, slide = 0, delay = 0, attack = 0.005 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);

    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(env).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Filtered noise — used for whooshes and buzzes. */
  noise({ dur = 0.2, gain = 0.15, from = 1200, to = 300, delay = 0, q = 1 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const frames = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter).connect(env).connect(this.master);
    src.start(t0);
  }

  /** A run of notes, evenly spaced. */
  arp(freqs, { step = 0.08, dur = 0.16, type = 'triangle', gain = 0.25 } = {}) {
    freqs.forEach((freq, i) => this.tone({ freq, dur, type, gain, delay: i * step }));
  }

  play(cue, opts = {}) {
    if (!this.ctx) return;
    switch (cue) {
      case 'click':
        return this.tone({ freq: 660, dur: 0.05, type: 'square', gain: 0.12, slide: -180 });
      case 'back':
        return this.tone({ freq: 420, dur: 0.06, type: 'square', gain: 0.1, slide: -120 });
      case 'pick':
        return this.tone({ freq: 540, dur: 0.09, type: 'triangle', gain: 0.22, slide: 160 });
      case 'join':
        return this.arp([NOTE.C5, NOTE.G5], { step: 0.07, dur: 0.13, gain: 0.2 });
      case 'leave':
        return this.arp([NOTE.G4, NOTE.C4], { step: 0.07, dur: 0.14, gain: 0.16 });
      case 'chat':
        return this.tone({ freq: 880, dur: 0.05, type: 'sine', gain: 0.1 });

      case 'start':
        this.noise({ dur: 0.45, gain: 0.1, from: 300, to: 2600 });
        return this.arp([NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5], { step: 0.09, dur: 0.2, gain: 0.22 });

      case 'phase':
        return this.tone({ freq: 520, dur: 0.14, type: 'sine', gain: 0.16, slide: 200 });

      case 'spin':
        // Glass on a table: a scrape that starts fast and runs down as the
        // bottle gives up, under a falling tone so it lands rather than stops.
        this.noise({ dur: 4.0, gain: 0.055, from: 2400, to: 260 });
        return this.tone({ freq: 340, dur: 3.8, type: 'triangle', gain: 0.07, slide: -230 });
      case 'tick':
        return this.tone({ freq: 1100, dur: 0.035, type: 'square', gain: 0.07 });
      case 'tick-urgent':
        return this.tone({ freq: 1500, dur: 0.045, type: 'square', gain: 0.13 });

      case 'correct':
        return this.arp([NOTE.C5, NOTE.E5, NOTE.G5], { step: 0.07, dur: 0.18, gain: 0.26 });
      case 'wrong':
        this.tone({ freq: 200, dur: 0.18, type: 'sawtooth', gain: 0.18, slide: -80 });
        return this.tone({ freq: 150, dur: 0.2, type: 'square', gain: 0.1, delay: 0.04 });

      case 'reveal':
        this.noise({ dur: 0.35, gain: 0.11, from: 2200, to: 400 });
        return this.arp([NOTE.G4, NOTE.C5, NOTE.E5], { step: 0.06, dur: 0.24, gain: 0.2 });

      case 'orb':
        // Pitch rises with the orb's value so a big one sounds like a big one.
        return this.tone({ freq: 700 + (opts.value ?? 1) * 180, dur: 0.07, type: 'triangle', gain: 0.16, slide: 240 });

      case 'unlock':
        return this.arp([NOTE.E5, NOTE.G5, NOTE.C6], { step: 0.06, dur: 0.3, type: 'sine', gain: 0.24 });

      case 'win':
        this.noise({ dur: 0.5, gain: 0.08, from: 400, to: 3000 });
        return this.arp([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], { step: 0.11, dur: 0.42, gain: 0.28 });
      case 'lose':
        return this.arp([NOTE.G4, NOTE.E4, NOTE.C4], { step: 0.13, dur: 0.36, type: 'sine', gain: 0.2 });

      default:
        return undefined;
    }
  }
}

export const Sound = new SoundKit();

// The first gesture unlocks audio; after that the listeners are pointless.
const wake = () => Sound.unlock();
for (const evt of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(evt, wake, { once: true, passive: true });
}
