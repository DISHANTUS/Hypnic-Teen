// The studio opening.
//
// One continuous take, rendered in Blender (tools/intro-film.py): a night, a
// saucer, a tractor beam. Our guy floats up through it — his coffee floating
// up beside him — plucks the mug out of the air, drinks, and the beam cuts.
// He falls, tumbling in one unbroken motion into the studio logo. Hypnic, as
// in the hypnic jerk: that falling feeling right before sleep.
//
// Warm ivory ink on deep charcoal, one fixed look in both themes — idents
// live on dark. The score is synthesised live over the top through the same
// kit as the games: the video file itself is silent, which also keeps
// autoplay legal everywhere.
//
// Plays once per session, any tap skips it, reduced-motion gets the poster.

import { Sound } from './sound.js';

// Bump FILM_VERSION whenever the film is re-rendered: it busts the browser's
// five-minute media cache and re-arms the once-per-session flag, so a new cut
// actually reaches people instead of hiding behind the old one.
const FILM_VERSION = 8;
const SEEN_KEY = `htfw:intro:f${FILM_VERSION}`;
const FILM = `/media/intro.mp4?v=${FILM_VERSION}`;
const POSTER = `/media/intro-poster.png?v=${FILM_VERSION}`;

/* --------------------------------- score ---------------------------------- */

// Only make noise when the context is actually running. Scheduling into a
// suspended context queues everything up and dumps it on the first tap.
const canHear = () => Sound.ctx && Sound.ctx.state === 'running' && !Sound.muted;

// The saucer's hum runs for seconds, so its nodes are kept where a skip can
// silence them — unlike the short tones, which just ring out.
const humNodes = [];

function stopHum() {
  for (const node of humNodes.splice(0)) {
    try { node.stop(); } catch { /* already ended */ }
  }
}

const score = {
  // A low bed under the whole first act — the felt-not-heard weight that
  // separates a title card from a web page.
  pad() {
    if (!canHear()) return;
    const ctx = Sound.ctx;
    const t0 = ctx.currentTime;
    const dur = 4.9;
    for (const [freq, gain] of [[55, 0.05], [55.4, 0.035], [110, 0.022]]) {
      const osc = ctx.createOscillator();
      osc.type = freq > 100 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(gain, t0 + 1.6);
      env.gain.setValueAtTime(gain, t0 + dur - 0.8);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(env).connect(Sound.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
      humNodes.push(osc);
    }
  },
  stroll() {
    if (!canHear()) return;
    [659.3, 987.8, 784, 1174.7].forEach((freq, i) =>
      Sound.tone({ freq, dur: 0.55, type: 'sine', gain: 0.09, delay: i * 0.45, attack: 0.02 })
    );
  },
  // The classic saucer sound: a wavering theremin, held until the beam dies.
  ufo() {
    if (!canHear()) return;
    const ctx = Sound.ctx;
    const t0 = ctx.currentTime;
    const dur = 3.9;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 320;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const wobble = ctx.createGain();
    wobble.gain.value = 42;
    lfo.connect(wobble).connect(osc.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.07, t0 + 0.6);
    env.gain.setValueAtTime(0.07, t0 + dur - 0.25);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env).connect(Sound.master);
    osc.start(t0);
    lfo.start(t0);
    osc.stop(t0 + dur + 0.05);
    lfo.stop(t0 + dur + 0.05);
    humNodes.push(osc, lfo);
  },
  beamOn() {
    if (!canHear()) return;
    Sound.noise({ dur: 0.5, gain: 0.07, from: 500, to: 3200, q: 2 });
    [1046.5, 1318.5, 1568].forEach((freq, i) =>
      Sound.tone({ freq, dur: 0.5, type: 'sine', gain: 0.06, delay: 0.08 + i * 0.09 })
    );
  },
  lift() {
    if (!canHear()) return;
    Sound.tone({ freq: 330, dur: 1.3, type: 'sine', gain: 0.07, slide: 380, attack: 0.3 });
  },
  sip() {
    if (!canHear()) return;
    [900, 1050, 1200].forEach((freq, i) =>
      Sound.tone({ freq, dur: 0.3, type: 'sine', gain: 0.05, delay: i * 0.3 })
    );
    Sound.noise({ dur: 0.12, gain: 0.05, from: 900, to: 500, delay: 0.45 });
  },
  // The beam dies: a stuttering power-down.
  cut() {
    if (!canHear()) return;
    stopHum();
    Sound.tone({ freq: 500, dur: 0.09, type: 'square', gain: 0.07 });
    Sound.tone({ freq: 380, dur: 0.09, type: 'square', gain: 0.06, delay: 0.09 });
    Sound.tone({ freq: 640, dur: 0.5, type: 'triangle', gain: 0.1, slide: -520, delay: 0.18 });
  },
  fall() {
    if (!canHear()) return;
    Sound.tone({ freq: 700, dur: 0.8, type: 'triangle', gain: 0.13, slide: -520 });
    Sound.noise({ dur: 1.0, gain: 0.12, from: 1800, to: 180, q: 0.8 });
  },
  // The landing. A braam — the trailer chord: stacked detuned saws through a
  // low-pass, swelling in — under the warm chord and sparkle. This is the
  // moment the logo locks, and it should hit in the chest.
  sting() {
    if (!canHear()) return;
    const ctx = Sound.ctx;
    const t0 = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.connect(Sound.master);
    for (const [freq, gain] of [[55, 0.10], [55.35, 0.08], [82.4, 0.07], [82.9, 0.05], [110, 0.05]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(gain, t0 + 0.09);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
      osc.connect(env).connect(lp);
      osc.start(t0);
      osc.stop(t0 + 2.5);
      humNodes.push(osc);
    }
    Sound.tone({ freq: 42, dur: 0.6, type: 'sine', gain: 0.34, slide: -14 });
    Sound.noise({ dur: 0.7, gain: 0.1, from: 2500, to: 400, q: 0.7 });
    Sound.tone({ freq: 220, dur: 1.5, type: 'sine', gain: 0.15, attack: 0.03 });
    Sound.tone({ freq: 329.6, dur: 1.5, type: 'sine', gain: 0.11, attack: 0.04 });
    Sound.tone({ freq: 440, dur: 1.4, type: 'sine', gain: 0.09, attack: 0.04 });
    [659.3, 880, 1046.5, 1318.5].forEach((freq, i) =>
      Sound.tone({ freq, dur: 0.6, type: 'sine', gain: 0.13, delay: 0.2 + i * 0.09 })
    );
  },
};

// When each cue lands, in seconds of film time. Mirrors tools/intro-film.py.
const BEATS = [
  [0.0, score.pad],
  [0.0, score.stroll],
  [0.9, score.ufo],
  [1.85, score.beamOn],
  [2.2, score.lift],
  [3.9, score.sip],
  [4.72, score.cut],
  [5.05, score.fall],
  [6.2, score.sting],   // the exact frame the logo locks and the camera kicks
];
const BRAND_AT = 6.45;
const HOLD_AFTER_END = 1.1;

/* -------------------------------- playback -------------------------------- */

let playing = null;

/**
 * Plays the opening. Resolves once it has fully left the screen.
 * Any tap or Escape skips straight out.
 */
export function playIntro({ force = false } = {}) {
  if (playing) return playing;
  if (!force && sessionStorage.getItem(SEEN_KEY)) return Promise.resolve();
  sessionStorage.setItem(SEEN_KEY, '1');

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.createElement('div');
  root.className = 'studio-intro';
  root.innerHTML = `
    <video class="si-film" muted playsinline preload="auto" poster="${POSTER}" src="${FILM}"></video>
    <div class="si-brand">
      <b>HYPNIC TEEN</b>
      <small>STUDIO</small>
      <em>imagination is the limit</em>
    </div>
    <button class="si-skip btn btn-ghost btn-sm" type="button">Skip</button>
  `;
  document.body.appendChild(root);

  const film = root.querySelector('.si-film');

  // The page underneath keeps its scrollbar otherwise, and a scrollbar
  // through a title card breaks the spell.
  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';

  // Browsers only let us make noise after a gesture; try, accept silence.
  Sound.unlock();
  Sound.ctx?.resume?.().catch(() => {});

  let done = false;
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));

  playing = new Promise((resolve) => {
    const finish = () => {
      if (done) return;
      done = true;
      for (const t of timers) clearTimeout(t);
      stopHum();
      film.pause?.();
      root.classList.add('done');
      document.documentElement.style.overflow = prevOverflow;
      setTimeout(() => {
        root.remove();
        removeEventListener('keydown', onKey);
        playing = null;
        resolve();
      }, 520);
    };

    const onKey = (e) => e.key === 'Escape' && finish();
    addEventListener('keydown', onKey);
    root.addEventListener('pointerdown', finish);

    // No film, for whatever reason — the poster and the words still say who
    // we are. Never a blank white screen.
    const still = () => {
      root.classList.add('still', 'brand');
      score.sting();
      at(2100, finish);
    };

    if (reduce) {
      still();
      return;
    }

    film.addEventListener('error', still, { once: true });
    at(4000, () => {
      // Autoplay never started — treat it like a missing film.
      if (!done && film.currentTime === 0) still();
    });

    film.play().then(() => {
      for (const [t, cue] of BEATS) at(t * 1000, cue);
      at(BRAND_AT * 1000, () => root.classList.add('brand'));
      film.addEventListener('ended', () => at(HOLD_AFTER_END * 1000, finish), { once: true });
    }).catch(still);
  });

  return playing;
}

/** The once-per-session boot call. */
export function maybePlayIntro() {
  return playIntro({ force: false });
}
