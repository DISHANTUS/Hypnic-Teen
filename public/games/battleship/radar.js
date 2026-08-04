// The radar scope.
//
// A PPI display — the round green screen with a bar sweeping round it — with
// the battle grid laid over the top, which is how the game stays playable
// while looking like the real thing. The sweep is what makes it feel alive:
// a contact does not simply sit there lit, it *flares* as the beam crosses it
// and then decays, so the screen is always breathing.
//
// Everything is drawn from the server's view. The renderer never decides what
// is on the sea, only how to show what it was told.

// The silhouettes come from hulls.js, shared with the yard chips and the
// deployment grid — three places drawing a carrier three ways is how they
// end up disagreeing about what a carrier is.
import { hullFor } from './hulls.js';

const TAU = Math.PI * 2;
const SIZE = 10;

// Phosphor greens, plus the two colours that mean something has happened.
const INK = {
  scope: '#04140c',
  ring: 'rgba(74, 240, 160, 0.20)',
  grid: 'rgba(74, 240, 160, 0.10)',
  label: 'rgba(120, 255, 190, 0.55)',
  sweep: 'rgba(74, 240, 160, 0.85)',
  friend: '#4af0a0',
  hit: '#ff5c6a',
  sunk: '#ff2d55',
  miss: 'rgba(120, 200, 170, 0.35)',
  ghost: 'rgba(90, 200, 255, 0.75)',
  aim: 'rgba(255, 220, 120, 0.9)',
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {() => object} readView   latest server view, pulled each frame
 * @param {(r:number,c:number)=>void} onPick
 */
export function createRadar(canvas, { readView, onPick, mine = false }) {
  const ctx = canvas.getContext('2d');
  let raf = null;
  let sweep = 0;              // radians
  let hover = null;           // {r,c} under the pointer
  let aim = null;             // {mode, cells} preview from an armed power
  const flashes = [];         // transient impacts

  /* ------------------------------- geometry ------------------------------ */

  // The grid is square, the scope is round: the grid is inscribed so its
  // corners just touch the inner ring.
  const layout = () => {
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2 - 6;
    const grid = radius * 1.42;      // inscribed square's side
    const cell = grid / SIZE;
    return { cx, cy, radius, grid, cell, x0: cx - grid / 2, y0: cy - grid / 2 };
  };

  const cellCentre = (r, c) => {
    const L = layout();
    return { x: L.x0 + (c + 0.5) * L.cell, y: L.y0 + (r + 0.5) * L.cell, L };
  };

  const cellAt = (px, py) => {
    const L = layout();
    const c = Math.floor((px - L.x0) / L.cell);
    const r = Math.floor((py - L.y0) / L.cell);
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE ? { r, c } : null;
  };

  /** How lit a contact is: bright as the beam passes, fading behind it. */
  function sweepGlow(x, y, L) {
    const angle = Math.atan2(y - L.cy, x - L.cx);
    let behind = sweep - angle;
    while (behind < 0) behind += TAU;
    while (behind > TAU) behind -= TAU;
    // A short bright tail, then a long dim one — like real phosphor.
    if (behind < 0.35) return 1;
    if (behind < 2.2) return 0.35 + 0.65 * (1 - (behind - 0.35) / 1.85);
    return 0.28;
  }

  /* -------------------------------- drawing ------------------------------ */

  function drawScope(L) {
    ctx.fillStyle = INK.scope;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, L.radius, 0, TAU);
    ctx.fill();

    // range rings
    ctx.strokeStyle = INK.ring;
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, (L.radius * i) / 4, 0, TAU);
      ctx.stroke();
    }
    // bearing ticks every 30°
    for (let a = 0; a < 360; a += 30) {
      const rad = (a * Math.PI) / 180;
      const inner = L.radius * (a % 90 === 0 ? 0.88 : 0.94);
      ctx.beginPath();
      ctx.moveTo(L.cx + Math.cos(rad) * inner, L.cy + Math.sin(rad) * inner);
      ctx.lineTo(L.cx + Math.cos(rad) * L.radius, L.cy + Math.sin(rad) * L.radius);
      ctx.stroke();
    }
    // crosshair
    ctx.beginPath();
    ctx.moveTo(L.cx - L.radius, L.cy);
    ctx.lineTo(L.cx + L.radius, L.cy);
    ctx.moveTo(L.cx, L.cy - L.radius);
    ctx.lineTo(L.cx, L.cy + L.radius);
    ctx.stroke();
  }

  function drawGrid(L) {
    ctx.strokeStyle = INK.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= SIZE; i++) {
      const t = L.x0 + i * L.cell;
      ctx.beginPath();
      ctx.moveTo(t, L.y0);
      ctx.lineTo(t, L.y0 + L.grid);
      ctx.stroke();
      const u = L.y0 + i * L.cell;
      ctx.beginPath();
      ctx.moveTo(L.x0, u);
      ctx.lineTo(L.x0 + L.grid, u);
      ctx.stroke();
    }
    ctx.fillStyle = INK.label;
    ctx.font = `${Math.max(8, L.cell * 0.34)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < SIZE; i++) {
      ctx.fillText('ABCDEFGHIJ'[i], L.x0 - L.cell * 0.42, L.y0 + (i + 0.5) * L.cell);
      ctx.fillText(String(i + 1), L.x0 + (i + 0.5) * L.cell, L.y0 - L.cell * 0.42);
    }
  }

  function drawSweep(L) {
    // the leading bar
    const grad = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, L.radius);
    grad.addColorStop(0, 'rgba(74, 240, 160, 0.30)');
    grad.addColorStop(1, 'rgba(74, 240, 160, 0)');

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(L.cx, L.cy);
    ctx.arc(L.cx, L.cy, L.radius, sweep - 0.55, sweep);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = INK.sweep;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(L.cx, L.cy);
    ctx.lineTo(L.cx + Math.cos(sweep) * L.radius, L.cy + Math.sin(sweep) * L.radius);
    ctx.stroke();
  }

  function blip(x, y, size, colour, glow) {
    ctx.save();
    ctx.globalAlpha = glow;
    ctx.shadowBlur = 14 * glow;
    ctx.shadowColor = colour;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function cross(x, y, size, colour, glow) {
    ctx.save();
    ctx.globalAlpha = glow;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - size, y - size);
    ctx.lineTo(x + size, y + size);
    ctx.moveTo(x + size, y - size);
    ctx.lineTo(x - size, y + size);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * A hull, drawn along the cells it occupies: a squared stern, straight
   * sides, and a bow that comes to a point. Contacts on a real scope have
   * shape and heading, not a dot per square — this is what makes a 4-cell
   * carrier read as a different thing from four patrol boats.
   */
  function hullPath(cells, L, inset = 0.30, cls = null) {
    const rows = cells.map((c) => c.r);
    const cols = cells.map((c) => c.c);
    const horizontal = new Set(rows).size === 1;
    const r0 = Math.min(...rows);
    const c0 = Math.min(...cols);
    const len = cells.length;

    // The whole hull in cell space, then rotated for a vertical ship.
    const long = L.cell * len;

    const cx = L.x0 + (c0 + (horizontal ? len / 2 : 0.5)) * L.cell;
    const cy = L.y0 + (r0 + (horizontal ? 0.5 : len / 2)) * L.cell;

    // The same silhouettes the yard and the deployment grid use, so the ship
    // you laid down is the ship you see on your own scope. hulls.js draws in
    // a box of len × 1 with the bow to the right; this shifts that to the
    // origin and scales it, then the rotation below handles a vertical ship.
    const shape = hullFor({ len, cls });
    const scale = L.cell * (1 - inset * 2) / 0.4; // beam of the drawn hull ≈ 0.4
    void scale;
    const pts = shape.outline(len).map(([x, y]) => [
      x * L.cell - long / 2,
      (y - 0.5) * L.cell * (1 - inset),
    ]);

    ctx.beginPath();
    pts.forEach(([px, py], i) => {
      const x = horizontal ? cx + px : cx - py;
      const y = horizontal ? cy + py : cy + px;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    return { cx, cy };
  }

  function drawHull(cells, L, colour, { fill = true, dashed = false, alphaScale = 1, cls = null } = {}) {
    const { cx, cy } = hullPath(cells, L, 0.30, cls);
    const glow = sweepGlow(cx, cy, L) * alphaScale;
    ctx.save();
    ctx.globalAlpha = glow;
    ctx.shadowBlur = 12 * glow;
    ctx.shadowColor = colour;
    if (dashed) ctx.setLineDash([4, 3]);
    if (fill) {
      ctx.fillStyle = colour;
      ctx.globalAlpha = glow * 0.35;
      ctx.fill();
      ctx.globalAlpha = glow;
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();
  }

  function drawContacts(view, L) {
    const sea = mine ? view.you : view.seas?.find((s) => s.id === canvasTarget());
    if (!sea) return;

    const shots = sea.shots ?? sea.board?.shots ?? {};
    const ships = mine
      ? view.you.board.ships
      : sea.ships ?? null;
    const revealed = sea.revealed ?? {};
    const decoys = mine ? view.you.decoys ?? [] : [];
    const wrecks = sea.wrecks ?? [];

    // Your own hulls, or an ally's, drawn as ships rather than dots.
    if (ships) {
      for (const ship of ships) {
        if (ship.gone) continue; // sunk long enough ago to be off the scope
        if (ship.sunk) {
          drawWreck(ship.cells, L, 0);
          continue;
        }
        drawHull(ship.cells, L, INK.friend, { cls: ship.cls });
      }
    }

    // Enemy wrecks: broken up, fading as they settle.
    for (const wreck of wrecks) {
      if (ships) continue; // an ally's own ships already drew them
      drawWreck(wreck.cells, L, wreck.age ?? 0);
    }

    // decoys: hollow, so you can tell your own lie from your own steel
    for (const k of decoys) {
      const [r, c] = k.split(',').map(Number);
      const { x, y } = cellCentre(r, c);
      ctx.save();
      ctx.globalAlpha = sweepGlow(x, y, L) * 0.8;
      ctx.strokeStyle = INK.ghost;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, y, L.cell * 0.30, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    // what has been fired at this sea
    for (const [k, kind] of Object.entries(shots)) {
      const [r, c] = k.split(',').map(Number);
      const { x, y } = cellCentre(r, c);
      const glow = sweepGlow(x, y, L);
      if (kind === 'hit') blip(x, y, L.cell * 0.26, INK.hit, glow);
      else cross(x, y, L.cell * 0.16, INK.miss, glow * 0.8);
    }

    // intel marks — wrecks are drawn as hulls above, not as dots
    for (const [k, kind] of Object.entries(revealed)) {
      if (shots[k] || kind === 'sunk') continue;
      const [r, c] = k.split(',').map(Number);
      const { x, y } = cellCentre(r, c);
      const glow = sweepGlow(x, y, L);
      {
        ctx.save();
        ctx.globalAlpha = glow * 0.9;
        ctx.strokeStyle = INK.ghost;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(x, y, L.cell * 0.26, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /**
   * A wreck: the hull broken into pieces that drift apart and dim as she
   * settles. `age` is rounds since she went down — by the time the server
   * stops sending her, she has visibly gone.
   */
  function drawWreck(cells, L, age) {
    const fade = Math.max(0.15, 1 - age * 0.38);
    const drift = L.cell * 0.10 * age;
    const rows = cells.map((c) => c.r);
    const horizontal = new Set(rows).size === 1;

    for (let i = 0; i < cells.length; i++) {
      const { x, y } = cellCentre(cells[i].r, cells[i].c);
      // pieces slide apart along the hull's axis, alternating sides
      const push = (i - (cells.length - 1) / 2) * 0.5 + (i % 2 ? drift : -drift);
      const px = horizontal ? x + push : x + (i % 2 ? drift : -drift);
      const py = horizontal ? y + (i % 2 ? drift : -drift) : y + push;
      const glow = sweepGlow(px, py, L) * fade;

      ctx.save();
      ctx.globalAlpha = glow;
      ctx.strokeStyle = INK.sunk;
      ctx.lineWidth = 1.6;
      const s = L.cell * 0.20;
      ctx.beginPath();
      ctx.moveTo(px - s, py - s * 0.5);
      ctx.lineTo(px + s * 0.4, py - s);
      ctx.lineTo(px + s, py + s * 0.4);
      ctx.lineTo(px - s * 0.3, py + s);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawAim(L) {
    const cells = aim?.cells ?? (hover ? [hover] : []);
    if (!cells.length) return;
    ctx.save();
    ctx.strokeStyle = INK.aim;
    ctx.lineWidth = 1.6;
    for (const { r, c } of cells) {
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) continue;
      const x = L.x0 + c * L.cell;
      const y = L.y0 + r * L.cell;
      ctx.strokeRect(x + 1, y + 1, L.cell - 2, L.cell - 2);
    }
    ctx.restore();
  }

  function drawFlashes(L, dt) {
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.t += dt;
      const life = f.t / f.dur;
      if (life >= 1) {
        flashes.splice(i, 1);
        continue;
      }
      const { x, y } = cellCentre(f.r, f.c);
      const grow = L.cell * (0.3 + life * 1.6);
      ctx.save();
      ctx.globalAlpha = (1 - life) * (f.hit ? 1 : 0.6);
      ctx.strokeStyle = f.hit ? INK.hit : INK.miss;
      ctx.lineWidth = f.hit ? 3 : 1.5;
      ctx.beginPath();
      ctx.arc(x, y, grow, 0, TAU);
      ctx.stroke();
      if (f.hit) {
        // a second, faster ring makes an impact feel like an impact
        ctx.globalAlpha = (1 - life) * 0.7;
        ctx.beginPath();
        ctx.arc(x, y, grow * 0.55, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* --------------------------------- loop -------------------------------- */

  let targetId = null;
  const canvasTarget = () => targetId;

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    // One revolution every four seconds — fast enough to feel live, slow
    // enough that the decay tail is readable.
    sweep = (sweep + dt * (TAU / 4)) % TAU;

    const view = readView();
    const L = layout();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawScope(L);
    drawGrid(L);
    if (view) drawContacts(view, L);
    drawSweep(L);
    drawAim(L);
    drawFlashes(L, dt);

    raf = requestAnimationFrame(frame);
  }

  /* -------------------------------- events ------------------------------- */

  const toLocal = (e) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const onMove = (e) => {
    const { x, y } = toLocal(e);
    hover = cellAt(x, y);
  };
  const onLeave = () => (hover = null);
  const onClick = (e) => {
    const { x, y } = toLocal(e);
    const cell = cellAt(x, y);
    if (cell) onPick?.(cell.r, cell.c);
  };

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('click', onClick);

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(200, Math.round(rect.width * dpr));
    canvas.height = canvas.width; // the scope is square
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  raf = requestAnimationFrame(frame);

  return {
    setTarget(id) {
      targetId = id;
    },
    setAim(cells) {
      aim = cells?.length ? { cells } : null;
    },
    impact(r, c, hit) {
      flashes.push({ r, c, hit, t: 0, dur: hit ? 0.75 : 0.5 });
    },
    hovered: () => hover,
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('click', onClick);
    },
  };
}
