// What each ship looks like.
//
// A fleet of identical grey blocks is a spreadsheet, not a navy — you cannot
// tell at a glance whether the thing you just sank was the carrier or a
// submarine, which is the only fact that matters at the time. So each class
// gets a silhouette: drawn once here, used by the yard chips, the deployment
// grid and the radar, so all three agree about what a destroyer looks like.
//
// The shapes are normalised: every path is built for a hull running left to
// right inside a box of `len × 1`, in units of one cell. Whoever draws it
// scales and rotates.

export const HULLS = {
  carrier: {
    name: 'Carrier',
    // Flat-topped flight deck with an island offset to starboard.
    outline: (L) => [
      [0.06, 0.30], [L - 0.34, 0.24], [L - 0.06, 0.50],
      [L - 0.34, 0.76], [0.06, 0.70],
    ],
    detail: (L) => [
      { kind: 'deck', pts: [[0.18, 0.44], [L - 0.42, 0.44], [L - 0.42, 0.56], [0.18, 0.56]] },
      { kind: 'island', pts: [[L * 0.58, 0.20], [L * 0.72, 0.20], [L * 0.72, 0.40], [L * 0.58, 0.40]] },
    ],
  },
  battleship: {
    name: 'Battleship',
    // Sheer bow, superstructure amidships, turrets fore and aft.
    outline: (L) => [
      [0.08, 0.32], [L - 0.40, 0.22], [L - 0.05, 0.50],
      [L - 0.40, 0.78], [0.08, 0.68],
    ],
    detail: (L) => [
      { kind: 'island', pts: [[L * 0.40, 0.24], [L * 0.60, 0.24], [L * 0.60, 0.44], [L * 0.40, 0.44]] },
      { kind: 'turret', pts: [[L * 0.16, 0.40], [L * 0.30, 0.40], [L * 0.30, 0.60], [L * 0.16, 0.60]] },
      { kind: 'turret', pts: [[L * 0.70, 0.40], [L * 0.84, 0.40], [L * 0.84, 0.60], [L * 0.70, 0.60]] },
    ],
  },
  destroyer: {
    name: 'Destroyer',
    // Narrow, raked, one funnel. Fast-looking on purpose.
    outline: (L) => [
      [0.10, 0.36], [L - 0.34, 0.28], [L - 0.04, 0.50],
      [L - 0.34, 0.72], [0.10, 0.64],
    ],
    detail: (L) => [
      { kind: 'island', pts: [[L * 0.44, 0.30], [L * 0.58, 0.30], [L * 0.58, 0.46], [L * 0.44, 0.46]] },
    ],
  },
  submarine: {
    name: 'Submarine',
    // A rounded pressure hull with a conning tower. Barely breaks the surface.
    outline: (L) => [
      [0.14, 0.44], [0.28, 0.36], [L - 0.28, 0.36], [L - 0.08, 0.50],
      [L - 0.28, 0.64], [0.28, 0.64],
    ],
    detail: (L) => [
      { kind: 'tower', pts: [[L * 0.40, 0.22], [L * 0.60, 0.22], [L * 0.58, 0.40], [L * 0.42, 0.40]] },
    ],
  },
};

/** Lengths are unique per class, so a length names the hull on its own. */
export const CLASS_BY_LEN = { 4: 'carrier', 3: 'battleship', 2: 'destroyer', 1: 'submarine' };
export const hullFor = (shipOrLen) =>
  HULLS[typeof shipOrLen === 'object' ? (shipOrLen.cls ?? CLASS_BY_LEN[shipOrLen.len]) : CLASS_BY_LEN[shipOrLen]] ??
  HULLS.submarine;

/**
 * The hull as an SVG string, sized to `cell` pixels per grid square. Used for
 * the yard chips and the deployment grid, where DOM beats canvas — a hundred
 * tap targets is what buttons are for.
 *
 * @param {{len:number, cls?:string}} ship
 * @param {object} opts  cell size, orientation, and the two colours
 */
export function hullSvg(ship, { cell = 26, horizontal = true, fill = 'currentColor', line = 'rgba(0,0,0,0.45)' } = {}) {
  const hull = hullFor(ship);
  const L = ship.len;
  const w = L * cell;
  const h = cell;
  const path = (pts) => `${pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * cell).toFixed(1)} ${(y * cell).toFixed(1)}`).join(' ')} Z`;

  const parts = [`<path d="${path(hull.outline(L))}" fill="${fill}" stroke="${line}" stroke-width="1" stroke-linejoin="round"/>`];
  for (const d of hull.detail(L)) {
    parts.push(`<path d="${path(d.pts)}" fill="${line}" opacity="0.55"/>`);
  }

  // A vertical ship is the same drawing turned a quarter turn — one shape,
  // never two that can disagree.
  const transform = horizontal ? '' : ` transform="rotate(90 ${(h / 2).toFixed(1)} ${(h / 2).toFixed(1)})"`;
  const box = horizontal ? `0 0 ${w} ${h}` : `0 0 ${h} ${w}`;
  return `<svg class="hull" viewBox="${box}" width="${horizontal ? w : h}" height="${horizontal ? h : w}" preserveAspectRatio="none" aria-hidden="true"><g${transform}>${parts.join('')}</g></svg>`;
}

/**
 * One square's worth of a ship, for a grid built out of separate cells.
 *
 * The deployment board is a hundred buttons, so a ship cannot be one element
 * laid over the top — it would have to be repositioned on every reflow. Each
 * cell instead shows its own slice of the same drawing through a moved
 * viewBox, which means the hull lines up across cells for free, at any size,
 * and there is still exactly one definition of what a carrier looks like.
 *
 * @param {{len:number, cls?:string}} ship
 * @param {number} index  which square of the ship this is, from the bow
 */
export function hullSliceSvg(ship, index, { horizontal = true, fill = 'currentColor', line = 'rgba(0,0,0,0.45)' } = {}) {
  const cell = 100; // arbitrary internal units — the SVG scales to its box
  const hull = hullFor(ship);
  const L = ship.len;
  const path = (pts) => `${pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * cell).toFixed(1)} ${(y * cell).toFixed(1)}`).join(' ')} Z`;

  const parts = [`<path d="${path(hull.outline(L))}" fill="${fill}" stroke="${line}" stroke-width="2" stroke-linejoin="round"/>`];
  for (const d of hull.detail(L)) parts.push(`<path d="${path(d.pts)}" fill="${line}" opacity="0.55"/>`);

  const full = L * cell;
  const transform = horizontal ? '' : ` transform="rotate(90 ${cell / 2} ${cell / 2})"`;
  // Slide the window along the hull: sideways for a ship lying across the
  // board, downwards for one standing on end.
  const box = horizontal ? `${index * cell} 0 ${cell} ${cell}` : `0 ${index * cell} ${cell} ${cell}`;
  void full;
  return `<svg class="hull-slice" viewBox="${box}" preserveAspectRatio="none" aria-hidden="true"><g${transform}>${parts.join('')}</g></svg>`;
}
