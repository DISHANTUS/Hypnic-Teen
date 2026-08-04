// Ship Attack: the power system.
//
// Plain Battleship is mostly luck with a little deduction. These turn it into
// a game you can be *good* at, and the design rule for every one of them is
// that it must have a counter — a power with no answer is just a bigger gun.
//
//   Sonar      cheap information                 → beaten by Decoy
//   Recon      expensive, precise information    → beaten by Evade
//   Torpedo    punishes a guessed orientation    → beaten by spreading out
//   Salvo      raw tempo, drains the battery     → beaten by EMP timing
//   Decoy      makes enemy scans lie             → beaten by spending a shot
//   Evade      moves a ship out from under them  → beaten by hitting it first
//   EMP        denies the enemy a big turn       → beaten by spending early
//
// Energy is the whole economy: +2 a turn, cap 10, and an ordinary shot is
// free. So every turn asks the same question — shoot now, or bank it for
// something that wins the game two turns from now.

export const ENERGY_PER_TURN = 2;
export const ENERGY_CAP = 10;
export const ENERGY_START = 3;

export const POWERS = {
  sonar: {
    name: 'Sonar Sweep',
    icon: '📡',
    cost: 2,
    blurb: 'Counts ship parts in a 3×3. Cheap, and decoys can lie to it.',
    aim: 'cell',
  },
  recon: {
    name: 'Recon Flight',
    icon: '🛩',
    cost: 3,
    blurb: 'Exact count along a whole row or column. Never lies.',
    aim: 'line',
  },
  torpedo: {
    name: 'Torpedo Run',
    icon: '🚀',
    cost: 4,
    blurb: 'Three shots in a straight line. Devastating if you guessed the heading.',
    aim: 'line-short',
  },
  salvo: {
    name: 'Salvo',
    icon: '💥',
    cost: 5,
    blurb: 'Four shots, anywhere. Empties the battery.',
    aim: 'multi',
  },
  decoy: {
    name: 'Decoy Buoy',
    icon: '🎣',
    cost: 3,
    blurb: 'A false signature on your own sea. Enemy scans read it as a ship.',
    aim: 'own-cell',
  },
  evade: {
    name: 'Evasive Manoeuvre',
    icon: '🌀',
    cost: 4,
    blurb: 'Move one undamaged ship somewhere new. Ruins their deduction.',
    aim: 'own-ship',
  },
  emp: {
    name: 'EMP Burst',
    icon: '⚡',
    cost: 5,
    blurb: 'The enemy earns no energy next turn. Stops the big play.',
    aim: 'none',
  },
};

export const POWER_LIST = Object.entries(POWERS).map(([id, p]) => ({ id, ...p }));

/** What a player starts with, and what the lobby's Powers setting means. */
export function startingEnergy(mode) {
  if (mode === 'off') return 0;
  return mode === 'rich' ? ENERGY_START + 3 : ENERGY_START;
}

export function energyGain(mode) {
  if (mode === 'off') return 0;
  return mode === 'rich' ? ENERGY_PER_TURN + 1 : ENERGY_PER_TURN;
}

/**
 * Grants a player their turn's energy. Returns whether anything changed, so
 * the caller can decide whether the view needs pushing.
 */
export function grantEnergy(player, mode) {
  if (player.empUntilRound > (player.roundsSeen ?? 0)) return false; // jammed
  const before = player.energy;
  player.energy = Math.min(ENERGY_CAP, player.energy + energyGain(mode));
  return player.energy !== before;
}

export const canAfford = (player, powerId) =>
  POWERS[powerId] && player.energy >= POWERS[powerId].cost;

export function spend(player, powerId) {
  player.energy = Math.max(0, player.energy - POWERS[powerId].cost);
}

/**
 * The cells a torpedo run covers: three in a line from an origin. Kept here
 * rather than in the game module so the client can draw the same preview from
 * the same rule.
 */
export function torpedoCells(r, c, horizontal) {
  return Array.from({ length: 3 }, (_, i) => (horizontal ? { r, c: c + i } : { r: r + i, c }));
}

/**
 * What a scan reports. Decoys are why this is not simply "count the ships":
 * a scan sees signatures, and a signature can be a lie somebody paid for.
 */
export function scanCount(board, cells, decoys) {
  let n = 0;
  for (const { r, c } of cells) {
    if (r < 0 || r > 9 || c < 0 || c > 9) continue;
    if (board.grid[r][c] !== null) n += 1;
    else if (decoys?.has(`${r},${c}`)) n += 1;
  }
  return n;
}
