// Shared game runtime: canvas sizing, a frame loop, and one input layer that
// makes keyboard (PC) and touch (Android) produce exactly the same values.

/**
 * Canvas that keeps a fixed world size and letterboxes it into whatever screen
 * it lands on, so a phone and a laptop see identical gameplay.
 */
export function createStage(canvas, world = { w: 1000, h: 600 }) {
  const ctx = canvas.getContext('2d');
  const stage = { canvas, ctx, world, scale: 1, offsetX: 0, offsetY: 0 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    stage.scale = Math.min(rect.width / world.w, rect.height / world.h);
    stage.offsetX = (rect.width - world.w * stage.scale) / 2;
    stage.offsetY = (rect.height - world.h * stage.scale) / 2;
    stage.cssWidth = rect.width;
    stage.cssHeight = rect.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Wrap drawing so game code can use plain world coordinates. */
  stage.drawWorld = (fn) => {
    ctx.save();
    ctx.translate(stage.offsetX, stage.offsetY);
    ctx.scale(stage.scale, stage.scale);
    fn(ctx);
    ctx.restore();
  };

  stage.clear = (color = '#0b0a1a') => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, stage.cssWidth, stage.cssHeight);
  };

  /** Screen (client) point -> world point. */
  stage.toWorld = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - stage.offsetX) / stage.scale,
      y: (clientY - rect.top - stage.offsetY) / stage.scale,
    };
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  window.addEventListener('orientationchange', resize);
  resize();

  stage.destroy = () => {
    observer.disconnect();
    window.removeEventListener('orientationchange', resize);
  };

  return stage;
}

/** requestAnimationFrame loop with a clamped delta. */
export function createLoop(onFrame) {
  let running = false;
  let last = 0;
  let handle = 0;

  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    onFrame(dt, now);
    handle = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      handle = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(handle);
    },
  };
}

const KEY_VECTORS = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};

/**
 * Unified input. `axis()` returns a normalised {x,y} from either WASD/arrows or
 * the on-screen stick; `pressed(name)` covers keyboard + on-screen buttons.
 *
 * @param {HTMLElement} root      element that hosts the touch controls
 * @param {{buttons?: {id:string,label:string,key?:string}[], stick?: boolean}} opts
 */
export function createInput(root, opts = {}) {
  const keys = new Set();
  const buttonsDown = new Set();
  const taps = new Set();
  const stick = { active: false, x: 0, y: 0, pointerId: null };
  const listeners = new Set();

  const onKeyDown = (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (KEY_VECTORS[e.code] || e.code === 'Space') e.preventDefault();
    fire({ type: 'down', code: e.code });
  };
  const onKeyUp = (e) => {
    keys.delete(e.code);
    fire({ type: 'up', code: e.code });
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function fire(evt) {
    for (const fn of listeners) fn(evt);
  }

  const touchLayer = document.createElement('div');
  touchLayer.className = 'touch-controls';
  const isTouch = matchMedia('(hover: none)').matches || 'ontouchstart' in window;
  touchLayer.hidden = !isTouch;
  root.appendChild(touchLayer);

  if (opts.stick !== false) {
    const pad = document.createElement('div');
    pad.className = 'stick-pad';
    pad.innerHTML = '<div class="stick-base"></div><div class="stick-knob"></div>';
    const knob = pad.querySelector('.stick-knob');
    touchLayer.appendChild(pad);

    const RADIUS = 52;
    const update = (e) => {
      const rect = pad.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        dx = (dx / len) * RADIUS;
        dy = (dy / len) * RADIUS;
      }
      stick.x = dx / RADIUS;
      stick.y = dy / RADIUS;
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    pad.addEventListener('pointerdown', (e) => {
      stick.active = true;
      stick.pointerId = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      update(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (stick.active && e.pointerId === stick.pointerId) update(e);
    });
    const release = (e) => {
      if (e.pointerId !== stick.pointerId) return;
      stick.active = false;
      stick.x = stick.y = 0;
      knob.style.transform = 'translate(0px, 0px)';
    };
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);
  }

  if (opts.buttons?.length) {
    const group = document.createElement('div');
    group.className = 'button-pad';
    for (const btn of opts.buttons) {
      const el = document.createElement('button');
      el.className = 'game-btn';
      el.type = 'button';
      el.textContent = btn.label;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        buttonsDown.add(btn.id);
        taps.add(btn.id);
        fire({ type: 'down', code: btn.key ?? btn.id, button: btn.id });
      });
      const up = () => {
        buttonsDown.delete(btn.id);
        fire({ type: 'up', code: btn.key ?? btn.id, button: btn.id });
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('pointercancel', up);
      group.appendChild(el);
    }
    touchLayer.appendChild(group);
  }

  return {
    /** Normalised direction, magnitude <= 1. */
    axis() {
      if (stick.active) {
        const len = Math.hypot(stick.x, stick.y);
        return len > 1 ? { x: stick.x / len, y: stick.y / len } : { x: stick.x, y: stick.y };
      }
      let x = 0;
      let y = 0;
      for (const code of keys) {
        const v = KEY_VECTORS[code];
        if (v) {
          x += v[0];
          y += v[1];
        }
      }
      const len = Math.hypot(x, y);
      return len > 1 ? { x: x / len, y: y / len } : { x, y };
    },
    pressed(idOrCode) {
      return keys.has(idOrCode) || buttonsDown.has(idOrCode);
    },
    /** True once per press - use for fire/jump style actions. */
    consumeTap(id) {
      if (!taps.has(id)) return false;
      taps.delete(id);
      return true;
    },
    onKey(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      touchLayer.remove();
      listeners.clear();
    },
  };
}

/**
 * Smooths server snapshots. Games render `interp.get()` instead of the raw
 * state so 20 ticks/sec still looks like 60fps.
 */
export function createInterpolator(delayMs = 100) {
  const buffer = [];
  return {
    push(state) {
      buffer.push({ at: performance.now(), state });
      if (buffer.length > 20) buffer.shift();
    },
    /** @returns {{a:any,b:any,t:number}|null} two snapshots + blend factor */
    sample() {
      if (buffer.length === 0) return null;
      const target = performance.now() - delayMs;
      if (buffer.length === 1) return { a: buffer[0].state, b: buffer[0].state, t: 0 };
      for (let i = buffer.length - 1; i > 0; i--) {
        if (buffer[i - 1].at <= target && buffer[i].at >= target) {
          const span = buffer[i].at - buffer[i - 1].at || 1;
          return { a: buffer[i - 1].state, b: buffer[i].state, t: (target - buffer[i - 1].at) / span };
        }
      }
      const last = buffer[buffer.length - 1];
      return { a: last.state, b: last.state, t: 0 };
    },
    latest() {
      return buffer[buffer.length - 1]?.state ?? null;
    },
  };
}

export const lerp = (a, b, t) => a + (b - a) * t;
