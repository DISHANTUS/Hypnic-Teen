// Ship Attack — Battleship with intelligence resources.
//
// Every player gets their own 10×10 sea and the classic fleet. Teams alternate
// turns; a team wins when every enemy fleet is on the bottom. Works as 1v1,
// 2v2, 3v3 — team size is a lobby setting, not a rule baked in here.
//
// The fleet positions never leave this file. serializeFor() hands each player
// their own sea in full and everyone else's as only what they have discovered,
// so there is nothing in the browser to cheat with — which is also why this
// logic has to live on the server whatever ends up drawing it.
//
// Intel resources are the twist from the paper game: instead of only firing,
// you can spend a turn on reconnaissance.
//
//   Air photo   how many ship parts in one row or column
//   Satellite   how many ship parts in a 3×3 square
//   Spy         is there a ship part in this exact square
//   Defector    one enemy ship part, handed to you before the shooting starts

import {
  POWERS,
  POWER_LIST,
  startingEnergy,
  energyGain,
  canAfford,
  spend,
  torpedoCells,
  scanCount,
} from './battleship-powers.js';

const SIZE = 10;
const LETTERS = 'ABCDEFGHIJ';
/** How many rounds a wreck stays on the scope before the sea closes over it. */
const WRECK_ROUNDS = 2;
/**
 * The fleet, by class. Length is what the rules care about; the class is what
 * the player cares about — "I lost my carrier" lands, "I lost a 4" does not.
 * The client draws a different hull for each one.
 */
const CLASSES = {
  carrier: { len: 4, name: 'Carrier', blurb: 'Four decks of aircraft. Enormous, and impossible to hide for long.' },
  battleship: { len: 3, name: 'Battleship', blurb: 'Guns and armour. The backbone of the line.' },
  destroyer: { len: 2, name: 'Destroyer', blurb: 'Fast and small. Hard to find, quick to lose.' },
  submarine: { len: 1, name: 'Submarine', blurb: 'One square of trouble. Almost nothing to shoot at.' },
};

/** One of each hull, largest first — 10 ships, 20 cells. */
const FLEET_PLAN = [
  'carrier',
  'battleship', 'battleship',
  'destroyer', 'destroyer', 'destroyer',
  'submarine', 'submarine', 'submarine', 'submarine',
];
const FLEET = FLEET_PLAN.map((cls) => CLASSES[cls].len); // 20 cells, largest first
const FULL_TONNAGE = FLEET.reduce((n, len) => n + len, 0);

/**
 * You may sail with less than the full fleet. Fewer hulls is a smaller target,
 * but it is also fewer sinkings between you and defeat — so the tonnage left
 * in port is paid back as intel and energy. Floors stop the degenerate version
 * of the idea, where one submarine hides in a hundred squares all evening.
 */
const MIN_SHIPS = 2;
const MIN_TONNAGE = 5;

/** How long the rules stay up before deployment starts without you. */
const BRIEF_SECONDS = 30;
const TEAM_DEFS = [
  { id: 0, name: 'Blue Navy', color: '#4ad6ff' },
  { id: 1, name: 'Red Navy', color: '#ff5c8a' },
];

const key = (r, c) => `${r},${c}`;
const inBoard = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

/* ------------------------------- fleet setup ------------------------------ */

/** The 8 neighbours plus the cell itself — the no-touching rule's footprint. */
function halo(cells) {
  const out = new Set();
  for (const { r, c } of cells) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (inBoard(r + dr, c + dc)) out.add(key(r + dr, c + dc));
      }
    }
  }
  return out;
}

function shipCells(r, c, len, horizontal) {
  const cells = [];
  for (let i = 0; i < len; i++) cells.push(horizontal ? { r, c: c + i } : { r: r + i, c });
  return cells;
}

/**
 * Can this ship sit here? Always: inside the board, not on top of another.
 * Under the classic rule, also not touching one — not even at a corner. That
 * rule makes for a tidier hunt, but it also means half the squares silently
 * refuse your ship, which reads as a broken board rather than a rule. So it is
 * the host's choice, and moored-alongside is the default.
 */
function fits(board, cells, apart = false) {
  for (const { r, c } of cells) {
    if (!inBoard(r, c)) return false;
    if (board.grid[r][c] !== null) return false;
  }
  if (!apart) return true;
  for (const k of halo(cells)) {
    const [r, c] = k.split(',').map(Number);
    if (board.grid[r][c] !== null) return false;
  }
  return true;
}

function emptyBoard() {
  return {
    grid: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)),
    ships: [],
    shots: {}, // "r,c" -> 'hit' | 'miss', what has been fired at this sea
  };
}

function placeShip(board, cells, len, cls) {
  const ship = { id: board.ships.length, len, cls: cls ?? classOfLength(len), cells, hits: 0, sunk: false };
  for (const { r, c } of cells) board.grid[r][c] = ship.id;
  board.ships.push(ship);
  return ship;
}

/** Lengths are unique per class, so a length is enough to name the hull. */
const classOfLength = (len) =>
  Object.keys(CLASSES).find((cls) => CLASSES[cls].len === len) ?? 'submarine';

/** Random legal fleet. Largest ships first, or the small ones box them out. */
function randomFleet(apart = false) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const board = emptyBoard();
    let ok = true;
    for (const cls of FLEET_PLAN) {
      const len = CLASSES[cls].len;
      let placed = false;
      for (let tries = 0; tries < 400 && !placed; tries++) {
        const horizontal = Math.random() < 0.5;
        const r = Math.floor(Math.random() * (horizontal ? SIZE : SIZE - len + 1));
        const c = Math.floor(Math.random() * (horizontal ? SIZE - len + 1 : SIZE));
        const cells = shipCells(r, c, len, horizontal);
        if (fits(board, cells, apart)) {
          placeShip(board, cells, len, cls);
          placed = true;
        }
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return board;
  }
  throw new Error('could not lay out a fleet'); // unreachable in practice
}

/**
 * Validates a fleet a player laid out themselves. Never trust the client.
 *
 * A short fleet is allowed — that is the sailing-light option — but you cannot
 * invent hulls the yard never built you, so the count of each class is capped
 * at what the plan hands out.
 */
function fleetFromLayout(layout, apart = false) {
  const board = emptyBoard();
  if (!Array.isArray(layout) || layout.length < MIN_SHIPS || layout.length > FLEET.length) return null;

  const allowance = new Map();
  for (const cls of FLEET_PLAN) allowance.set(CLASSES[cls].len, (allowance.get(CLASSES[cls].len) ?? 0) + 1);

  for (const piece of layout) {
    const r = Number(piece?.r);
    const c = Number(piece?.c);
    const len = Number(piece?.len);
    if (!Number.isInteger(r) || !Number.isInteger(c) || !Number.isInteger(len)) return null;
    const left = allowance.get(len);
    if (!left) return null; // a hull they do not have, or one too many of it
    allowance.set(len, left - 1);
    const cells = shipCells(r, c, len, Boolean(piece.horizontal));
    if (!fits(board, cells, apart)) return null;
    placeShip(board, cells, len);
  }

  if (tonnage(board) < MIN_TONNAGE) return null;
  return board;
}

const tonnage = (board) => board.ships.reduce((n, s) => n + s.len, 0);

/**
 * What the tonnage you left behind buys you. Sailing light is a smaller target
 * but a shorter road to defeat, so the difference comes back as intel and
 * energy — enough to be worth doing, capped so it never becomes the only move.
 */
function lightBonus(board) {
  const missing = Math.max(0, FULL_TONNAGE - tonnage(board));
  if (!missing) return { missing, energy: 0, perTurn: 0, spy: 0 };
  return {
    missing,
    energy: Math.min(6, Math.floor(missing / 3)),
    perTurn: Math.min(3, Math.floor(missing / 6)),
    spy: Math.min(4, Math.floor(missing / 4)),
  };
}

/* --------------------------------- intel ---------------------------------- */

const INTEL_KINDS = ['photo', 'satellite', 'spy'];

function countIn(board, cells) {
  let n = 0;
  for (const { r, c } of cells) {
    if (inBoard(r, c) && board.grid[r][c] !== null) n += 1;
  }
  return n;
}

function rowCells(r) {
  return Array.from({ length: SIZE }, (_, c) => ({ r, c }));
}
function colCells(c) {
  return Array.from({ length: SIZE }, (_, r) => ({ r, c }));
}
function squareCells(r, c) {
  const out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) out.push({ r: r + dr, c: c + dc });
  return out;
}

/* --------------------------------- turns ---------------------------------- */

const alive = (state) => state.players.filter((p) => p.connected !== false);
const teamPlayers = (state, team) => state.players.filter((p) => p.team === team);
const teamAfloat = (state, team) =>
  teamPlayers(state, team).some((p) => p.board.ships.some((s) => !s.sunk));

function nextTurn(state, { sameTeam = false } = {}) {
  const from = state.turnTeam;
  const to = sameTeam ? from : 1 - from;
  state.turnTeam = to;

  // Within a team, the trigger passes around so nobody is a spectator.
  const roster = teamPlayers(state, to).filter((p) => p.connected !== false);
  if (!roster.length) {
    state.turnPlayerId = null;
    return;
  }
  if (sameTeam && roster.some((p) => p.id === state.turnPlayerId)) {
    // A hit earns another shot — same gunner keeps firing, on a fresh clock.
    // Without the reset the extra shot inherited whatever was left of the old
    // turn, so a player who had spent twenty-five of their thirty seconds
    // lining up a hit was handed a "free shot" that expired before they could
    // take it. From their chair the reward for hitting looked like losing the
    // turn. The round does not advance, so this earns no extra energy.
    state.turnStarted = Date.now();
    state.turnLeft = state.settings.turnSeconds;
    state.dirty = true;
    return;
  }
  const at = roster.findIndex((p) => p.id === state.lastGunner?.[to]);
  const pick = roster[(at + 1) % roster.length];
  state.turnPlayerId = pick.id;
  state.lastGunner = { ...(state.lastGunner ?? {}), [to]: pick.id };
  state.turnStarted = Date.now();
  state.turnLeft = state.settings.turnSeconds;
  state.round = (state.round ?? 0) + 1;

  // Energy arrives with the turn, unless an EMP is still holding them down.
  // This is the whole economy: bank it, or spend it and hope.
  if (state.settings.powers !== 'off') {
    const gain = energyGain(state.settings.powers) + (pick.light?.perTurn ?? 0);
    // `>=`, not `>`: the round counter ticks over inside this very function,
    // so a jam set for "next round" would otherwise expire before it landed.
    if (pick.jammedUntil >= state.round) {
      say(state, `${pick.name} is jammed — no energy this turn.`, 'intel');
    } else {
      pick.energy = Math.min(10, pick.energy + gain);
    }
  }
}

/**
 * One shell into one square. Shared by ordinary fire, torpedo runs and
 * salvos, so a hit means exactly the same thing however it was delivered.
 * Returns what happened; the caller decides whose turn it is next.
 */
function shell(state, shooter, target, r, c, api) {
  if (!inBoard(r, c)) return 'invalid';
  const k = key(r, c);
  if (target.board.shots[k]) return 'repeat';

  const shipId = target.board.grid[r][c];
  if (shipId === null) {
    target.board.shots[k] = 'miss';
    api?.emit('splash', { by: shooter.id, targetId: target.id, r, c, hit: false });
    return 'miss';
  }

  target.board.shots[k] = 'hit';
  const ship = target.board.ships[shipId];
  ship.hits += 1;
  const sunk = ship.hits >= ship.len;
  if (sunk) {
    ship.sunk = true;
    // Wreckage is visible for a couple of rounds, then she is gone — a sea
    // permanently littered with old kills stops being a puzzle.
    ship.sunkRound = state.round;
  }
  api?.emit('splash', { by: shooter.id, targetId: target.id, r, c, hit: true, sunk });
  return sunk ? 'sunk' : 'hit';
}

/**
 * Runs one power. Returns falsy if the aim was illegal (nothing is spent),
 * 'keep' if the player holds their turn, or true if the turn passes.
 *
 * Deliberately blunt about who learns what: a scan writes into the scanner's
 * own notes, never into shared state, so buying information is worth something.
 */
function applyPower(state, me, target, id, action, api) {
  const r = Number(action.r);
  const c = Number(action.c);

  switch (id) {
    case 'sonar': {
      if (!inBoard(r, c)) return false;
      // Counts signatures, not ships — which is exactly what a decoy exploits.
      const n = scanCount(target.board, squareCells(r, c), new Set(target.decoys));
      me.notes.push({
        kind: 'sonar', enemyId: target.id, r, c, count: n,
        text: `Sonar — 3×3 around ${label(r, c)} of ${target.name}: ${n} contact${n === 1 ? '' : 's'}.`,
      });
      say(state, `${me.name} swept ${target.name}'s water with sonar.`, 'intel');
      return true;
    }

    case 'recon': {
      const isRow = action.axis === 'row';
      const idx = Number(action.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= SIZE) return false;
      // A recon flight sees hulls, so decoys cannot fool it. That is what the
      // extra energy buys.
      const n = countIn(target.board, isRow ? rowCells(idx) : colCells(idx));
      me.notes.push({
        kind: 'recon', enemyId: target.id, axis: isRow ? 'row' : 'col', index: idx, count: n,
        text: `Recon — ${isRow ? `row ${LETTERS[idx]}` : `column ${idx + 1}`} of ${target.name}: ${n} part${n === 1 ? '' : 's'}.`,
      });
      say(state, `${me.name} flew recon over ${target.name}.`, 'intel');
      return true;
    }

    case 'torpedo': {
      if (!inBoard(r, c)) return false;
      const cells = torpedoCells(r, c, action.axis !== 'col');
      let hits = 0;
      let sank = false;
      for (const cell of cells) {
        const outcome = shell(state, me, target, cell.r, cell.c, api);
        if (outcome === 'hit') hits += 1;
        if (outcome === 'sunk') {
          hits += 1;
          sank = true;
        }
      }
      say(
        state,
        hits
          ? `${me.name} ran torpedoes across ${target.name} — ${hits} hit${hits === 1 ? '' : 's'}${sank ? ', a ship went down' : ''}.`
          : `${me.name}'s torpedoes ran wide.`,
        hits ? (sank ? 'sunk' : 'hit') : 'miss'
      );
      checkVictory(state, me, target, api);
      return true;
    }

    case 'salvo': {
      const shots = Array.isArray(action.cells) ? action.cells.slice(0, 4) : [];
      if (shots.length < 1) return false;
      let hits = 0;
      let sank = false;
      for (const cell of shots) {
        const outcome = shell(state, me, target, Number(cell?.r), Number(cell?.c), api);
        if (outcome === 'hit') hits += 1;
        if (outcome === 'sunk') {
          hits += 1;
          sank = true;
        }
      }
      say(
        state,
        `${me.name} loosed a salvo at ${target.name} — ${hits} of ${shots.length} found steel${sank ? ', and one went under' : ''}.`,
        hits ? (sank ? 'sunk' : 'hit') : 'miss'
      );
      checkVictory(state, me, target, api);
      return true;
    }

    case 'decoy': {
      if (!inBoard(r, c)) return false;
      const k = key(r, c);
      // A decoy on top of a real hull would be wasted, and one on a square
      // already shot at fools nobody.
      if (me.board.grid[r][c] !== null || me.board.shots[k] || me.decoys.includes(k)) return false;
      me.decoys.push(k);
      say(state, `${me.name} dropped a decoy buoy.`, 'intel');
      return 'keep'; // defensive: it does not cost you the shot
    }

    case 'evade': {
      const ship = me.board.ships[Number(action.shipId)];
      if (!ship || ship.sunk || ship.hits > 0) return false; // damaged ships cannot run
      const horizontal = Boolean(action.horizontal);
      const cells = shipCells(Number(action.r), Number(action.c), ship.len, horizontal);

      // Lift the ship out before testing the new berth, or it collides with
      // the hole it just left.
      for (const cell of ship.cells) me.board.grid[cell.r][cell.c] = null;
      const ok = fits(me.board, cells) && cells.every(({ r: rr, c: cc }) => !me.board.shots[key(rr, cc)]);
      if (!ok) {
        for (const cell of ship.cells) me.board.grid[cell.r][cell.c] = ship.id;
        return false;
      }
      ship.cells = cells;
      for (const cell of cells) me.board.grid[cell.r][cell.c] = ship.id;
      say(state, `${me.name} slipped a ship to new water.`, 'intel');
      return 'keep';
    }

    case 'emp': {
      for (const foe of state.players.filter((p) => p.team === target.team)) {
        foe.jammedUntil = state.round + 1;
      }
      say(state, `${me.name} fired an EMP — ${state.teams[target.team].name} is jammed.`, 'intel');
      return true;
    }

    default:
      return false;
  }
}

/** True when the shot ended the match, having declared the winner. */
function checkVictory(state, shooter, target, api) {
  if (teamAfloat(state, target.team)) return false;
  state.winner = shooter.team;
  state.over = true;
  state.phase = 'over';
  say(state, `${state.teams[shooter.team].name} wins the sea.`, 'win');
  api?.finish();
  return true;
}

function say(state, text, tone = 'info') {
  state.log.push({ text, tone, at: Date.now() });
  if (state.log.length > 40) state.log.shift();
  state.dirty = true;
}

/* ------------------------------- the module ------------------------------- */

export default {
  id: 'battleship',
  name: 'Ship Attack',
  tagline: 'Hide your fleet. Read the sea. Sink theirs first.',
  emoji: '🚢',
  accent: '#4ad6ff',
  client: 'battleship',
  minPlayers: 2,
  maxPlayers: 12,
  tickRate: 2,

  // Every other game on the site opens with its rules and a stopped clock.
  // This one used to drop you straight into a deployment timer and expect you
  // to work out what a decoy was while it ran.
  howToPlay: [
    'Lay out your fleet, then hunt theirs. First side with nothing left afloat loses.',
    'Hit a ship and you fire again — keep hitting and the turn never leaves you.',
    'Every turn banks energy. Spend it on sonar, torpedoes, decoys and jamming instead of an ordinary shot.',
    'You may sail with fewer ships. A smaller fleet is harder to find, and the tonnage you leave in port comes back as intel and energy.',
  ],

  // Everything the host can tune before Start. The lobby builds its own
  // controls from this — no lobby code knows what a battleship is.
  options: {
    teamSize: {
      label: 'Players per side',
      hint: '1v1, 2v2, 3v3 — the room splits evenly',
      kind: 'number',
      min: 1,
      max: 6,
      step: 1,
      default: 1,
    },
    turnSeconds: {
      label: 'Seconds per turn',
      hint: 'How long you get to fire',
      kind: 'number',
      min: 10,
      max: 90,
      step: 5,
      default: 30,
    },
    placeSeconds: {
      label: 'Seconds to deploy',
      hint: 'Time to lay out your fleet',
      kind: 'number',
      min: 20,
      max: 180,
      step: 10,
      default: 60,
    },
    intel: {
      label: 'Intel resources',
      hint: 'Recon instead of firing',
      kind: 'choice',
      default: 'standard',
      choices: [
        { id: 'off', label: 'Off', note: 'pure gunnery' },
        { id: 'standard', label: 'Standard', note: '1 photo · 1 satellite · 2 spies' },
        { id: 'rich', label: 'Rich', note: 'double, plus a defector' },
      ],
    },
    powers: {
      label: 'Powers',
      hint: 'Energy each turn to spend on torpedoes, decoys, jamming',
      kind: 'choice',
      default: 'standard',
      choices: [
        { id: 'off', label: 'Off', note: 'gunnery only' },
        { id: 'standard', label: 'Standard', note: '+2 energy a turn' },
        { id: 'rich', label: 'Loaded', note: '+3 a turn, bigger start' },
      ],
    },
    extraOnHit: {
      label: 'Extra shot on a hit',
      hint: 'Classic rule — keep firing while you keep hitting',
      kind: 'toggle',
      default: true,
    },
    spacing: {
      label: 'Ships must not touch',
      hint: 'Classic rule. Off means you can moor them alongside',
      kind: 'toggle',
      default: false,
    },
    sailLight: {
      label: 'Allow short fleets',
      hint: 'Leave ships in port for extra intel and energy',
      kind: 'toggle',
      default: true,
    },
  },

  createState(players, ctx = {}) {
    const settings = {
      teamSize: 1,
      turnSeconds: 30,
      placeSeconds: 60,
      intel: 'standard',
      powers: 'standard',
      extraOnHit: true,
      spacing: false,
      sailLight: true,
      ...(ctx.settings ?? {}),
    };

    const intelPack =
      settings.intel === 'off'
        ? { photo: 0, satellite: 0, spy: 0, defector: 0 }
        : settings.intel === 'rich'
          ? { photo: 2, satellite: 2, spy: 4, defector: 1 }
          : { photo: 1, satellite: 1, spy: 2, defector: 0 };

    // Split the room into two sides as evenly as the count allows, in blocks
    // of teamSize so friends who joined together end up together.
    const state = {
      settings,
      // The rules first, with nothing running. Deployment starts when the room
      // says it has read them, or after BRIEF_SECONDS for anyone who has not.
      phase: 'brief',
      timeLeft: BRIEF_SECONDS,
      teams: TEAM_DEFS.map((t) => ({ ...t })),
      players: players.map((p, i) => ({
        id: p.id,
        name: p.name,
        team: Math.floor(i / Math.max(1, settings.teamSize)) % 2,
        board: randomFleet(settings.spacing), // a legal fleet from the first frame; they can redo it
        placed: false,
        briefed: false,
        light: { missing: 0, energy: 0, perTurn: 0, spy: 0 },
        intel: { ...intelPack },
        found: {}, // enemyId -> { "r,c": true } discovered by intel, not by firing
        notes: [], // intel readings, for their own eyes
        energy: startingEnergy(settings.powers),
        decoys: [], // "r,c" on their own sea that reads as a ship to enemy scans
        jammedUntil: 0, // round number until which they earn no energy
        connected: true,
      })),
      turnTeam: 0,
      turnPlayerId: null,
      turnLeft: settings.turnSeconds,
      round: 0,
      lastGunner: {},
      log: [],
      winner: null,
      over: false,
      dirty: true,
    };

    // The defector talks before the shooting starts.
    if (intelPack.defector) {
      for (const p of state.players) {
        const enemy = state.players.find((e) => e.team !== p.team);
        if (!enemy) continue;
        const parts = [];
        for (let r = 0; r < SIZE; r++) {
          for (let c = 0; c < SIZE; c++) if (enemy.board.grid[r][c] !== null) parts.push({ r, c });
        }
        const spot = parts[Math.floor(Math.random() * parts.length)];
        if (spot) {
          p.found[enemy.id] = { [key(spot.r, spot.c)]: true };
          p.notes.push({ kind: 'defector', enemyId: enemy.id, text: `A defector marked a ship part on ${enemy.name}'s sea.` });
        }
      }
    }

    say(state, 'Deploy your fleet, or sail with the one you were dealt.');
    return state;
  },

  onPlayerJoin(state, player) {
    const existing = state.players.find((p) => p.id === player.id);
    if (existing) {
      existing.connected = true;
      state.dirty = true;
      return;
    }
    // Late arrivals fill the thinner side.
    const team = teamPlayers(state, 0).length <= teamPlayers(state, 1).length ? 0 : 1;
    state.players.push({
      id: player.id,
      name: player.name,
      team,
      board: randomFleet(),
      placed: state.phase !== 'place',
      intel: { photo: 0, satellite: 0, spy: 0, defector: 0 },
      found: {},
      notes: [],
      connected: true,
    });
    state.dirty = true;
  },

  onPlayerLeave(state, player) {
    const p = state.players.find((x) => x.id === player.id);
    if (!p) return;
    p.connected = false;
    state.dirty = true;
    // Don't leave the game waiting on someone who walked out.
    if (state.phase === 'battle' && state.turnPlayerId === p.id) nextTurn(state);
  },

  onAction(state, player, action, api) {
    const me = state.players.find((p) => p.id === player.id);
    if (!me || state.over) return;

    /* ---- the briefing ---- */
    if (state.phase === 'brief') {
      if (action?.type === 'ready') {
        me.briefed = true;
        state.dirty = true;
      }
      return;
    }

    /* ---- deployment ---- */
    if (state.phase === 'place') {
      if (action?.type === 'layout') {
        const board = fleetFromLayout(action.ships, state.settings.spacing);
        if (!board) return; // silently ignore an illegal fleet; the client also checks
        // A short fleet is only allowed if the host allowed it.
        if (board.ships.length < FLEET.length && !state.settings.sailLight) return;
        me.board = board;
        me.light = lightBonus(board);
        state.dirty = true;
        return;
      }
      if (action?.type === 'shuffle') {
        me.board = randomFleet(state.settings.spacing);
        me.light = lightBonus(me.board);
        state.dirty = true;
        return;
      }
      if (action?.type === 'ready') {
        if (me.placed) return; // a client that re-sends must not re-announce
        me.placed = true;
        // Sailing light is public — the other side deserves to know they are
        // hunting a smaller fleet, and the player deserves the credit.
        const short = FLEET.length - me.board.ships.length;
        say(
          state,
          short
            ? `${me.name} is at battle stations with ${me.board.ships.length} ships — ${short} left in port.`
            : `${me.name} is at battle stations.`
        );
        return;
      }
      return;
    }

    if (state.phase !== 'battle') return;
    if (state.turnPlayerId !== me.id) return;

    // Decoy and Evade act on your own sea, so they arrive with no enemy named.
    // Demanding a target before dispatching rejected them outright.
    const selfAimed = action?.type === 'power' && (action.power === 'decoy' || action.power === 'evade');
    const target = selfAimed
      ? me
      : state.players.find((p) => p.id === action?.targetId);
    if (!target || (!selfAimed && target.team === me.team)) return;

    /* ---- firing ---- */
    if (action.type === 'fire') {
      const r = Number(action.r);
      const c = Number(action.c);
      const outcome = shell(state, me, target, r, c, api);
      if (outcome === 'invalid' || outcome === 'repeat') return;

      if (outcome === 'miss') {
        say(state, `${me.name} fired at ${target.name} ${label(r, c)} — miss.`, 'miss');
        nextTurn(state);
      } else {
        say(
          state,
          outcome === 'sunk'
            ? `${me.name} SANK a ship of ${target.name}!`
            : `${me.name} hit ${target.name} at ${label(r, c)}.`,
          outcome
        );
        if (checkVictory(state, me, target, api)) return;
        nextTurn(state, { sameTeam: state.settings.extraOnHit });
      }
      state.dirty = true;
      return;
    }

    /* ---- powers ---- */
    if (action.type === 'power') {
      const id = String(action.power ?? '');
      const power = POWERS[id];
      if (!power || state.settings.powers === 'off') return;
      if (!canAfford(me, id)) return;

      const done = applyPower(state, me, target, id, action, api);
      if (!done) return;

      spend(me, id);
      state.dirty = true;
      if (state.over) return;
      // Only Evade and Decoy leave you where you were; everything else is an
      // attack or a scan, and costs the turn like any other action.
      nextTurn(state, { sameTeam: done === 'keep' });
      return;
    }

    /* ---- reconnaissance ---- */
    if (action.type === 'intel') {
      const kind = String(action.kind ?? '');
      if (!INTEL_KINDS.includes(kind)) return;
      if ((me.intel[kind] ?? 0) <= 0) return;

      let note = null;
      if (kind === 'photo') {
        const isRow = action.axis === 'row';
        const idx = Number(action.index);
        if (!Number.isInteger(idx) || idx < 0 || idx >= SIZE) return;
        const cells = isRow ? rowCells(idx) : colCells(idx);
        const n = countIn(target.board, cells);
        note = {
          kind: 'photo',
          enemyId: target.id,
          axis: isRow ? 'row' : 'col',
          index: idx,
          count: n,
          text: `Air photo — ${isRow ? `row ${'ABCDEFGHIJ'[idx]}` : `column ${idx + 1}`} of ${target.name}: ${n} part${n === 1 ? '' : 's'}.`,
        };
      } else if (kind === 'satellite') {
        const r = Number(action.r);
        const c = Number(action.c);
        if (!inBoard(r, c)) return;
        const n = countIn(target.board, squareCells(r, c));
        note = { kind: 'satellite', enemyId: target.id, r, c, count: n, text: `Satellite — 3×3 around ${label(r, c)} of ${target.name}: ${n} part${n === 1 ? '' : 's'}.` };
      } else if (kind === 'spy') {
        const r = Number(action.r);
        const c = Number(action.c);
        if (!inBoard(r, c)) return;
        const has = target.board.grid[r][c] !== null;
        me.found[target.id] = { ...(me.found[target.id] ?? {}), [key(r, c)]: has };
        note = { kind: 'spy', enemyId: target.id, r, c, has, text: `Spy — ${label(r, c)} of ${target.name}: ${has ? 'ship' : 'open sea'}.` };
      }

      me.intel[kind] -= 1;
      if (note) me.notes.push(note);
      say(state, `${me.name} spent a turn on ${kind === 'photo' ? 'an air photo' : `a ${kind}`}.`, 'intel');
      nextTurn(state);
      state.dirty = true;
    }
  },

  /**
   * The CPU admiral. Two modes, which is how humans actually play:
   *
   *   hunt    nothing wounded — search on a parity lattice, because the
   *           smallest ship is 1 but most are longer, so checking every
   *           square is wasted effort early on
   *   target  something is wounded — work outwards from the hits, and once
   *           two hits line up, follow that line to the end
   *
   * It reads only what it has actually discovered: its own shot record. It
   * never looks at the enemy grid, so it can be beaten.
   */
  botAction(state, bot) {
    const me = state.players.find((p) => p.id === bot.id);
    if (!me || state.over) return null;

    // A CPU has no rules to read and a fleet already laid out, so it waves
    // both screens through. Without this a solo player sits out the whole
    // briefing timer waiting for an opponent who was never going to press it.
    if (state.phase === 'brief') return me.briefed ? null : { type: 'ready' };
    if (state.phase === 'place') return me.placed ? null : { type: 'ready' };
    if (state.phase !== 'battle' || state.turnPlayerId !== bot.id) return null;

    // Prefer a target already bleeding, else the enemy with the most left.
    const enemies = state.players.filter((p) => p.team !== me.team && p.board.ships.some((s) => !s.sunk));
    if (!enemies.length) return null;
    const wounded = enemies.find((e) =>
      e.board.ships.some((s) => !s.sunk && s.hits > 0)
    );
    const target = wounded ?? enemies[0];

    const shots = target.board.shots;
    const open = (r, c) => inBoard(r, c) && !shots[key(r, c)];

    // --- target mode: finish what has been started -------------------------
    const live = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (shots[key(r, c)] !== 'hit') continue;
        const ship = target.board.ships[target.board.grid[r][c]];
        if (ship && !ship.sunk) live.push({ r, c });
      }
    }

    if (live.length) {
      // Two hits in a row point along a ship — extend that line first.
      for (const a of live) {
        for (const b of live) {
          if (a === b) continue;
          if (a.r === b.r && Math.abs(a.c - b.c) === 1) {
            const cs = live.filter((h) => h.r === a.r).map((h) => h.c);
            const lo = Math.min(...cs) - 1;
            const hi = Math.max(...cs) + 1;
            if (open(a.r, hi)) return { type: 'fire', targetId: target.id, r: a.r, c: hi };
            if (open(a.r, lo)) return { type: 'fire', targetId: target.id, r: a.r, c: lo };
          }
          if (a.c === b.c && Math.abs(a.r - b.r) === 1) {
            const rs = live.filter((h) => h.c === a.c).map((h) => h.r);
            const lo = Math.min(...rs) - 1;
            const hi = Math.max(...rs) + 1;
            if (open(hi, a.c)) return { type: 'fire', targetId: target.id, r: hi, c: a.c };
            if (open(lo, a.c)) return { type: 'fire', targetId: target.id, r: lo, c: a.c };
          }
        }
      }
      // A lone hit: try its four neighbours.
      for (const hit of live) {
        const around = [
          { r: hit.r - 1, c: hit.c },
          { r: hit.r + 1, c: hit.c },
          { r: hit.r, c: hit.c - 1 },
          { r: hit.r, c: hit.c + 1 },
        ].filter((p) => open(p.r, p.c));
        if (around.length) {
          const pick = around[Math.floor(Math.random() * around.length)];
          return { type: 'fire', targetId: target.id, r: pick.r, c: pick.c };
        }
      }
    }

    // --- intel: worth a turn while the sea is still mostly unknown ---------
    const fired = Object.keys(shots).length;
    if (fired < 30 && (me.intel.photo ?? 0) > 0 && Math.random() < 0.4) {
      return { type: 'intel', kind: 'photo', targetId: target.id, axis: 'row', index: Math.floor(Math.random() * SIZE) };
    }

    // --- hunt mode: parity lattice, then anything left --------------------
    const lattice = [];
    const rest = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!open(r, c)) continue;
        // A square a spy already proved empty is not worth a shell.
        if (me.found[target.id]?.[key(r, c)] === false) continue;
        ((r + c) % 2 === 0 ? lattice : rest).push({ r, c });
      }
    }
    // A square intel marked as a ship jumps the queue.
    const tipped = [...lattice, ...rest].find((p) => me.found[target.id]?.[key(p.r, p.c)] === true);
    const pool = tipped ? [tipped] : lattice.length ? lattice : rest;
    if (!pool.length) return null;
    const shot = pool[Math.floor(Math.random() * pool.length)];
    return { type: 'fire', targetId: target.id, r: shot.r, c: shot.c };
  },

  onTick(state, dt) {
    if (state.over) return;

    if (state.phase === 'brief') {
      state.timeLeft -= dt;
      const everyone = alive(state);
      if (state.timeLeft <= 0 || (everyone.length > 0 && everyone.every((p) => p.briefed))) {
        state.phase = 'place';
        state.timeLeft = state.settings.placeSeconds;
        state.dirty = true;
      }
      return;
    }

    if (state.phase === 'place') {
      state.timeLeft -= dt;
      const everyone = alive(state);
      const allReady = everyone.length > 0 && everyone.every((p) => p.placed);
      if (state.timeLeft <= 0 || allReady) {
        // Anyone who ran out the clock sails with the fleet they were given.
        for (const p of state.players) {
          p.placed = true;
          // The tonnage left in port is paid out now, once, so it is on the
          // board before the first shell rather than trickling in.
          p.light = lightBonus(p.board);
          if (p.light.missing) {
            p.energy += p.light.energy;
            p.intel.spy += p.light.spy;
            say(
              state,
              `${p.name} sails light — ${p.board.ships.length} ships, +${p.light.energy} energy` +
                `${p.light.spy ? `, +${p.light.spy} spies` : ''}${p.light.perTurn ? `, +${p.light.perTurn} a turn` : ''}.`,
              'intel'
            );
          }
        }
        state.phase = 'battle';
        state.turnTeam = 1; // nextTurn flips it, so Blue opens fire
        nextTurn(state);
        say(state, 'Battle stations. Blue Navy opens fire.', 'phase');
        state.dirty = true;
      }
      return;
    }

    if (state.phase === 'battle') {
      state.turnLeft -= dt;
      if (state.turnLeft <= 0) {
        const who = state.players.find((p) => p.id === state.turnPlayerId);
        say(state, `${who?.name ?? 'Someone'} ran out of time.`, 'miss');
        nextTurn(state);
        state.dirty = true;
      }
    }
  },

  isOver(state) {
    return Boolean(state.over);
  },

  results(state) {
    // Everyone on the winning side ranks above everyone on the losing side;
    // within a side, the better gunner ranks higher.
    const scored = state.players.map((p) => {
      const enemyBoards = state.players.filter((e) => e.team !== p.team);
      const hits = enemyBoards.reduce(
        (n, e) => n + Object.values(e.board.shots).filter((s) => s === 'hit').length,
        0
      );
      const survived = p.board.ships.filter((s) => !s.sunk).length;
      const won = state.winner === p.team;
      return {
        playerId: p.id,
        name: p.name,
        score: (won ? 100 : 0) + survived * 5 + Math.round(hits / Math.max(1, teamPlayers(state, p.team).length)),
        team: p.team,
      };
    });
    return scored
      .sort((a, b) => b.score - a.score)
      .map((row, i) => ({ ...row, place: i + 1 }));
  },

  /** The shared view — no fleet positions anywhere in here. */
  serialize(state) {
    return {
      phase: state.phase,
      size: SIZE,
      fleet: FLEET,
      // The yard's manifest, so the client can name and draw each hull without
      // a copy of the fleet list going stale next to this one.
      classes: CLASSES,
      fleetPlan: FLEET_PLAN,
      rules: this.howToPlay,
      sailLight: state.settings.sailLight,
      minShips: MIN_SHIPS,
      minTonnage: MIN_TONNAGE,
      spacing: state.settings.spacing,
      teams: state.teams.map((t) => ({
        ...t,
        afloat: teamPlayers(state, t.id).reduce(
          (n, p) => n + p.board.ships.filter((s) => !s.sunk).length,
          0
        ),
      })),
      players: state.players.map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        placed: p.placed,
        briefed: p.briefed,
        connected: p.connected,
        light: p.light?.missing ? { ...p.light } : null,
        sunk: p.board.ships.filter((s) => s.sunk).length,
        total: p.board.ships.length,
      })),
      turnTeam: state.turnTeam,
      turnPlayerId: state.turnPlayerId,
      round: state.round,
      powersOn: state.settings.powers !== 'off',
      // The briefing and the deployment share a countdown field; only the
      // battle reads its clock from the turn.
      timeLeft: Math.max(0, Math.ceil(state.phase === 'battle' ? state.turnLeft : state.timeLeft)),
      turnTotal:
        state.phase === 'brief'
          ? BRIEF_SECONDS
          : state.phase === 'place'
            ? state.settings.placeSeconds
            : state.settings.turnSeconds,
      winner: state.winner,
      log: state.log.slice(-8),
    };
  },

  /**
   * What one player is allowed to see: their own sea completely, every other
   * sea only as far as it has been shot at, spied on, or sunk.
   */
  serializeFor(state, playerId) {
    const view = this.serialize(state);
    const me = state.players.find((p) => p.id === playerId);
    if (!me) return view;

    view.you = {
      id: me.id,
      team: me.team,
      placed: me.placed,
      briefed: me.briefed,
      light: { ...(me.light ?? { missing: 0, energy: 0, perTurn: 0, spy: 0 }) },
      intel: { ...me.intel },
      notes: me.notes.slice(-12),
      isTurn: state.turnPlayerId === me.id,
      energy: me.energy,
      jammed: me.jammedUntil >= state.round,
      decoys: [...me.decoys], // your own lies are visible to you
      // What is affordable right now, so the client never offers a button
      // that the server would refuse.
      powers:
        state.settings.powers === 'off'
          ? []
          : POWER_LIST.map((p) => ({ ...p, ready: me.energy >= p.cost })),
      // Own sea, in full — ships and incoming fire.
      board: {
        ships: me.board.ships.map((s) => ({
          id: s.id,
          len: s.len,
          cls: s.cls,
          cells: s.cells,
          sunk: s.sunk,
          // Your own wrecks fade off your scope on the same clock.
          gone: s.sunk && state.round - (s.sunkRound ?? 0) > WRECK_ROUNDS,
        })),
        shots: { ...me.board.shots },
      },
    };

    view.seas = state.players
      .filter((p) => p.id !== me.id)
      .map((p) => {
        const mine = p.team === me.team;
        const revealed = {};
        // A kill shows as wreckage for WRECK_ROUNDS, then the sea closes over
        // it. The hits that sank her stay — those were earned.
        const wrecks = [];
        for (const ship of p.board.ships) {
          if (!ship.sunk) continue;
          const age = state.round - (ship.sunkRound ?? 0);
          if (age > WRECK_ROUNDS) continue;
          wrecks.push({ cells: ship.cells, len: ship.len, age });
          for (const cell of ship.cells) revealed[key(cell.r, cell.c)] = 'sunk';
        }
        // Intel this player personally bought.
        for (const [k, has] of Object.entries(me.found[p.id] ?? {})) {
          if (has && !revealed[k]) revealed[k] = 'intel';
        }
        return {
          id: p.id,
          name: p.name,
          team: p.team,
          ally: mine,
          // Allies show each other everything; enemies show only what was found.
          ships: mine ? p.board.ships.map((s) => ({ id: s.id, len: s.len, cells: s.cells, sunk: s.sunk })) : null,
          shots: { ...p.board.shots },
          revealed,
          wrecks,
          afloat: p.board.ships.filter((s) => !s.sunk).length,
        };
      });

    return view;
  },

  isDirty(state) {
    const was = state.dirty;
    state.dirty = false;
    return Boolean(was);
  },
};

function label(r, c) {
  return `${LETTERS[r]}${c + 1}`;
}
