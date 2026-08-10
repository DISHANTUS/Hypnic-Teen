// தாயம் — Thayam, or Dayam.
//
// A 7×7 board, six coins each, and a spiral from your own side of the outer
// ring all the way in to the centre. First to bring every coin home wins.
//
// The dice are two dayakattai — long four-sided sticks whose faces read one,
// two, three and blank. That is not a decoration, it is the whole feel of the
// game, because of what those two sticks can add up to:
//
//   both blank  →  twelve, once in sixteen throws
//   one blank   →  whatever the other says
//   otherwise   →  the sum, one to six
//
// So the possible throws are exactly 1, 2, 3, 4, 5, 6 and 12, with three the
// commonest and one — dayam itself, the throw that puts a coin on the board —
// coming up one time in eight. A pair of ordinary six-sided dice would give the
// same numbers a completely different shape and the game would not be this
// game. The sticks are simulated face by face rather than by picking from a
// table of totals, so the odds come out of the equipment rather than out of
// somebody's arithmetic.
//
// The rules below are the ones written down for this build. Where a regional
// variant would differ, the comment says which reading was taken.

import {
  createBoardGame, inPlay, nextSeat, passTurn, ringPath, startAt, cellKey,
} from './kit.js';

const SIZE = 7;
const MID = 3;

/** A throw that earns another throw. */
const GRACE = new Set([1, 5, 6, 12]);
/** The throw that puts your first coin on the board, and brings cut ones back. */
const DAYAM = 1;

/**
 * One stick: one, two, three, or blank.
 *
 * Rolled as a face rather than drawn from a distribution of totals, because the
 * distribution *is* the equipment — three is common because there are four ways
 * to make it, and twelve is rare because there is one.
 */
const stick = () => Math.floor(Math.random() * 4); // 0 = blank

export function throwSticks() {
  const a = stick();
  const b = stick();
  // Both blank is twelve, not nothing. It is the biggest throw in the game and
  // it comes off the two smallest faces, which is most of its charm.
  const value = a + b === 0 ? 12 : a + b;
  return { sticks: [a, b], value, grace: GRACE.has(value) };
}

/* --------------------------------- the board ------------------------------ */

/** The three rings and the centre, outermost first. */
const RINGS = [ringPath(0, SIZE - 1), ringPath(1, SIZE - 2), ringPath(2, SIZE - 3)];
const CENTRE = [MID, MID];

/**
 * Where each player comes on, one to a side.
 *
 * Their whole spiral is anchored to this: they lap the outer ring from their
 * own cross, step in to the cross on their own side of the next ring, lap that,
 * and so on. Four players therefore run four different paths over the same
 * squares, which is what makes the middle of the board dangerous.
 */
const ENTRIES = [
  [SIZE - 1, MID],  // bottom
  [MID, 0],         // left
  [0, MID],         // top
  [MID, SIZE - 1],  // right
];

/** The same side, one ring in. */
const inward = (entry, ring) => {
  const [r, c] = entry;
  if (r === 0) return [ring, MID];
  if (r === SIZE - 1) return [SIZE - 1 - ring, MID];
  if (c === 0) return [MID, ring];
  return [MID, SIZE - 1 - ring];
};

/** The full spiral for one player: 24 + 16 + 8 + the centre = 49 squares. */
function pathFor(seatNo) {
  const entry = ENTRIES[seatNo % ENTRIES.length];
  return [
    ...startAt(RINGS[0], entry),
    ...startAt(RINGS[1], inward(entry, 1)),
    ...startAt(RINGS[2], inward(entry, 2)),
    CENTRE,
  ];
}

const PATHS = [0, 1, 2, 3].map(pathFor);
const HOME = PATHS[0].length - 1;   // the centre, as a path index
/** Where the outer ring ends. Nothing crosses this without a kill. */
const FIRST_LAYER = RINGS[0].length;

/**
 * The nine crosses.
 *
 * Four on the outer ring where the players come on, four on the next ring in,
 * and the centre. A coin standing on one cannot be cut, and more than one coin
 * may stand there — which is the only reason a crowded board does not lock up.
 */
export const SAFE = new Set([
  ...ENTRIES.map(cellKey),
  ...ENTRIES.map((e) => cellKey(inward(e, 1))),
  cellKey(CENTRE),
]);

export const isSafe = (cell) => SAFE.has(cellKey(cell));

export const thayam = createBoardGame({
  id: 'thayam',
  name: 'Thayam',
  tagline: 'தாயம் — six coins, one spiral, and you must draw blood to get inside.',
  emoji: '🐚',
  accent: '#c0392b',
  face: 'thayam',
  minPlayers: 2,
  maxPlayers: 4,
  turnSeconds: 30,

  howToPlay: [
    'Two long sticks are thrown. They read one, two, three or blank — both blank is twelve.',
    'Throw a one — dayam — to bring your first coin on. After that, a one or a five brings any coin on.',
    'One, five, six and twelve all earn you another throw.',
    'Only one coin may stand on a plain square, even your own. A cross holds as many as you like.',
    'Land on somebody else off a cross and you cut them — that coin goes back to their hand.',
    'You cannot leave the outer ring until you have cut somebody. It is a war, not a race.',
    'Bring all your coins to the centre. You need the exact throw to land on it.',
  ],

  options: {
    coins: { label: 'Coins each', kind: 'number', min: 2, max: 6, hardMax: 6, step: 1, default: 6 },
  },
  settings: (s) => ({ coins: Math.max(2, Math.min(6, Number(s.coins) || 6)) }),

  init(state) {
    state.coins = [];
    state.rolled = null;
    state.graceLeft = 0;
    state.mustMove = false;
  },

  setUp(state) {
    const n = state.settings.coins;
    state.coins = [];
    for (const seat of state.seats) {
      seat.cuts = 0;
      seat.home = 0;
      for (let i = 0; i < n; i++) {
        // -1 is in hand. Everything starts there; dayam is the only way out.
        state.coins.push({ seat: seat.seat, i, at: -1 });
      }
    }
    state.turn = 0;
    state.rolled = null;
    state.said = 'Throw a one to come on.';
  },

  act(state, seat, action) {
    if (state.seats[state.turn]?.id !== seat.id) return;

    if (action.type === 'throw') {
      if (state.rolled) return;                  // one throw at a time
      const out = throwSticks();
      state.rolled = out;
      const moves = legalMoves(state, seat, out.value);
      state.said = `${seat.name} throws ${out.value === 12 ? 'twelve — both blank' : out.value}.`;
      if (!moves.length) {
        // Nothing to do with it. A grace throw still earns another, which is
        // the difference between a bad throw and a wasted turn.
        state.log.push(`${state.said} Nothing to move.`);
        if (out.grace) { state.rolled = null; state.turnLeft = state.settings.turnSeconds; }
        else passTurn(state);
      }
      state.dirty = true;
      return;
    }

    if (action.type === 'move') {
      if (!state.rolled) return;
      const value = state.rolled.value;
      const which = Number(action.coin);
      const coin = state.coins.find((c) => c.seat === seat.seat && c.i === which);
      if (!coin) return;
      const moves = legalMoves(state, seat, value);
      const move = moves.find((m) => m.coin === which);
      if (!move) return;

      apply(state, seat, coin, move);

      // A grace throw earns another. Anything else ends the turn.
      if (state.rolled.grace) {
        state.rolled = null;
        state.turnLeft = state.settings.turnSeconds;
        state.dirty = true;
      } else {
        passTurn(state);
      }
    }
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat) return;
    if (!state.rolled) {
      // Throw for them rather than skipping — a skipped throw is a turn nobody
      // can get back, and being away should cost tempo, not the game.
      thayam.__spec.act(state, seat, { type: 'throw' });
      if (!state.rolled) return;
    }
    const moves = legalMoves(state, seat, state.rolled.value);
    if (!moves.length) { passTurn(state); return; }
    // The furthest coin, which is the least interesting choice and therefore
    // the fairest one to make on somebody's behalf.
    const best = [...moves].sort((a, b) => b.to - a.to)[0];
    state.log.push(`${seat.name} was away — moved on.`);
    thayam.__spec.act(state, seat, { type: 'move', coin: best.coin });
  },

  isDone: (state) => state.seats.some((s) => s.home >= state.settings.coins)
    || inPlay(state).length <= 1,

  table(state) {
    return {
      size: SIZE,
      // Every square that is a cross, so the client draws the board rather
      // than being told where to put nine X marks.
      safe: [...SAFE],
      centre: cellKey(CENTRE),
      coins: state.coins.map((c) => ({
        seat: c.seat, i: c.i, at: c.at,
        cell: c.at < 0 ? null : cellKey(PATHS[c.seat % 4][c.at]),
        home: c.at === HOME,
      })),
      // Each player's own spiral, so the client can trace the line for
      // whoever is looking at it.
      paths: state.seats.map((s) => PATHS[s.seat % 4].map(cellKey)),
      cuts: state.seats.map((s) => ({ seat: s.seat, name: s.name, cuts: s.cuts ?? 0, home: s.home ?? 0 })),
      coinsEach: state.settings.coins,
      firstLayer: FIRST_LAYER,
      dayam: DAYAM,
    };
  },

  mine(state, seat) {
    if (!seat) return { moves: [] };
    const value = state.rolled?.value ?? null;
    return {
      // Worked out on the server so the client highlights exactly what the
      // server would accept. Two places deciding what is legal is two places
      // to disagree, and here they would disagree about whose coin dies.
      moves: value === null ? [] : legalMoves(state, seat, value),
      needsThrow: !state.rolled,
      cuts: seat.cuts ?? 0,
      canLeaveFirstLayer: (seat.cuts ?? 0) > 0,
      inHand: state.coins.filter((c) => c.seat === seat.seat && c.at === -1).length,
      home: seat.home ?? 0,
    };
  },

  rank: (a, b) => (b.home ?? 0) - (a.home ?? 0) || (b.cuts ?? 0) - (a.cuts ?? 0),
});

/* -------------------------------- the rules ------------------------------- */

/** Which coin, if any, is standing on a cell. */
function occupant(state, cell) {
  return state.coins.find((c) => c.at >= 0 && c.at !== HOME && cellKey(PATHS[c.seat % 4][c.at]) === cell) ?? null;
}

/**
 * Everything this player could do with this throw.
 *
 * One list, used by the client to light up coins, by the server to check what
 * comes back, and by the timeout to pick something. Three callers, one answer.
 */
export function legalMoves(state, seat, value) {
  const mine = state.coins.filter((c) => c.seat === seat.seat);
  const onBoard = mine.filter((c) => c.at >= 0 && c.at !== HOME);
  const out = [];

  // Coming on. The first coin needs a dayam; once anybody of yours is on the
  // board — or has already come home — a five will do it too.
  const started = mine.some((c) => c.at >= 0);
  const canEnter = value === DAYAM || (started && value === 5);
  if (canEnter && mine.some((c) => c.at === -1)) {
    const entry = cellKey(PATHS[seat.seat % 4][0]);
    // The entry is a cross, so it can never be blocked and never be a cut.
    const coin = mine.find((c) => c.at === -1);
    out.push({ coin: coin.i, from: -1, to: 0, cell: entry, enters: true, cuts: null });
  }

  for (const coin of onBoard) {
    const to = coin.at + value;
    // Exact throw to come home. Overshooting is simply not a move.
    if (to > HOME) continue;
    // The war rule: nothing leaves the outer ring until this player has cut
    // somebody. Written as the destination crossing the boundary rather than
    // the coin's current ring, so a big throw cannot jump the gate.
    if (coin.at < FIRST_LAYER && to >= FIRST_LAYER && (seat.cuts ?? 0) === 0) continue;

    const cell = cellKey(PATHS[seat.seat % 4][to]);
    const safe = SAFE.has(cell);
    const sitting = to === HOME ? null : occupant(state, cell);

    if (sitting && !safe) {
      // Your own coin blocks you — one to a plain square, even your own.
      if (sitting.seat === seat.seat) continue;
      out.push({ coin: coin.i, from: coin.at, to, cell, enters: false, cuts: { seat: sitting.seat, i: sitting.i } });
      continue;
    }
    if (sitting && safe && sitting.seat === seat.seat && to !== HOME) {
      // A cross holds as many as you like, including your own.
      out.push({ coin: coin.i, from: coin.at, to, cell, enters: false, cuts: null });
      continue;
    }
    out.push({ coin: coin.i, from: coin.at, to, cell, enters: false, cuts: null });
  }
  return out;
}

function apply(state, seat, coin, move) {
  coin.at = move.to;

  if (move.cuts) {
    const victim = state.coins.find((c) => c.seat === move.cuts.seat && c.i === move.cuts.i);
    if (victim) {
      victim.at = -1;
      seat.cuts = (seat.cuts ?? 0) + 1;
      const whose = state.seats.find((s) => s.seat === victim.seat);
      state.said = `${seat.name} cuts ${whose?.name ?? 'somebody'}.`;
      state.log.push(state.said);
    }
  } else if (move.enters) {
    state.said = `${seat.name} comes on.`;
  } else if (move.to === HOME) {
    seat.home = (seat.home ?? 0) + 1;
    seat.score = seat.home * 10 + (seat.cuts ?? 0);
    state.said = `${seat.name} brings one home — ${seat.home} of ${state.settings.coins}.`;
    state.log.push(state.said);
  } else {
    state.said = `${seat.name} moves ${move.to - move.from}.`;
  }

  // Score is the thing the leaderboard reads, so keep it current rather than
  // working it out at the end from a board that has moved on.
  seat.score = (seat.home ?? 0) * 10 + (seat.cuts ?? 0);
  state.dirty = true;
}

void nextSeat;

export default thayam;
