// Visual effects — confetti, floating score, flashes, shakes.
//
// Everything is plain DOM plus CSS keyframes: no canvas, no library, and each
// effect cleans itself up. Every function is a no-op under
// prefers-reduced-motion, so the games stay fully playable without them.

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const CONFETTI_COLORS = ['#f97a5a', '#ffc93c', '#2de2e6', '#7c6cf0', '#3ddc97', '#ff3d6e'];

/**
 * Bursts confetti inside a container. The container needs `position` set —
 * every piece is absolutely positioned within it.
 */
export function confetti(container, { count = 40, colors = CONFETTI_COLORS, spread = 60 } = {}) {
  if (reduceMotion || !container) return;
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';

  for (let i = 0; i < count; i++) {
    const bit = document.createElement('i');
    const angle = (Math.random() - 0.5) * spread;
    bit.style.setProperty('--x', `${angle}vw`);
    bit.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
    bit.style.setProperty('--d', `${900 + Math.random() * 900}ms`);
    bit.style.setProperty('--delay', `${Math.random() * 220}ms`);
    bit.style.background = colors[i % colors.length];
    bit.style.left = `${45 + Math.random() * 10}%`;
    if (Math.random() < 0.35) bit.style.borderRadius = '50%';
    layer.appendChild(bit);
  }

  container.appendChild(layer);
  setTimeout(() => layer.remove(), 2400);
}

/** A "+10" that drifts up off an element and fades. */
export function floatText(anchor, text, variant = 'gain') {
  if (reduceMotion || !anchor) return;
  const rect = anchor.getBoundingClientRect();
  const node = document.createElement('div');
  node.className = `float-text ${variant}`;
  node.textContent = text;
  node.style.left = `${rect.left + rect.width / 2}px`;
  node.style.top = `${rect.top}px`;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 1300);
}

/** Briefly tints an element — used to confirm a correct or wrong answer. */
export function flash(element, variant = 'good') {
  if (reduceMotion || !element) return;
  const cls = `flash-${variant}`;
  element.classList.remove(cls);
  void element.offsetWidth; // restart the animation
  element.classList.add(cls);
  setTimeout(() => element.classList.remove(cls), 700);
}

export function shake(element) {
  if (reduceMotion || !element) return;
  element.classList.remove('fx-shake');
  void element.offsetWidth;
  element.classList.add('fx-shake');
  setTimeout(() => element.classList.remove('fx-shake'), 500);
}

/** A short pulse on a container — used when a round flips to reveal. */
export function pulse(element) {
  if (reduceMotion || !element) return;
  element.classList.remove('fx-pulse');
  void element.offsetWidth;
  element.classList.add('fx-pulse');
  setTimeout(() => element.classList.remove('fx-pulse'), 600);
}

export const motionReduced = reduceMotion;
