// Ludo.
//
// Four tokens each, a fifty-two square circuit, and a six to get out of the
// yard. Everybody runs the same ring but each from their own corner, so a
// token's position is held as *how far it has come*, not as where it is on the
// board — the absolute square is worked out from that when it is needed.
//
// That is the one decision here worth writing down. Holding the absolute square
// instead would mean every rule needing to know how far the owner still has to
// go, which is the same number computed backwards, and getting it wrong by one
// puts somebody's home column on top of somebody else's. Relative position is
// the honest model: a token has come fifty-seven steps, and only the drawing
// cares which square that is.
//
// The safe squares are the eight starred ones — the four the players come out
// on and the four a quarter of the way past each — and a token on one cannot be
// sent home. Everything else is fair game, which is what stops a game of Ludo
// being a race nobody interferes with.

import { createBoardGame, inPlay, passTurn } from './kit.js';

/** The shared circuit. */
const RING = 52;
/** Where each colour comes out, a quarter turn apart. */
const STARTS = [0, 13, 26, 39];
/** How far along the ring before turning into your own column. */
const LAST_RING_STEP = 50;
/** Six squares of home column, and then home. */
const HOME = 57;

/**
 * The eight stars.
 *
 * The four starts, and the four eight squares along from each — which is where
 * the star sits on every board that has one. A token here cannot be sent home,
 * so these are the only places two colours can rest together.
 */
export const SAFE_SQUARES = new Set([...STARTS, ...STARTS.map((s) => (s + 8) % RING)]);

/** Which square of the ring a token is standing on, or null if it has turned in. */
export function ringSquare(seatNo, rel) {
  if (rel < 0 || rel > LAST_RING_STEP) return null;
  return (STARTS[seatNo % 4] + rel) % RING;
}

export const ludo = createBoardGame({
  id: 'ludo',
  name: 'Ludo',
  tagline: 'Four tokens, one ring, and a six to get out of the yard.',
  emoji: '🎯',
  accent: '#e67e22',
  face: 'ludo',
  minPlayers: 2,
  maxPlayers: 4,
  turnSeconds: 25,

  howToPlay: [
    'Four tokens each, all starting in your yard. Roll a six to bring one out.',
    'A six earns another roll — but three sixes in a row and the turn is forfeit.',
    'Land on somebody else and they go back to their yard. Not on a star, though.',
    'The eight starred squares are safe. Two colours can rest on one.',
    'Turn into your own home column at the end of the lap, and reach home on an exact roll.',
    'First to bring all four home wins.',
  ],

  options: {
    tokens: { label: 'Tokens each', kind: 'number', min: 1, max: 4, hardMax: 4, step: 1, default: 4 },
  },
  settings: (s) => ({ tokens: Math.max(1, Math.min(4, Number(s.tokens) || 4)) }),

  init(state) {
    state.tokens = [];
    state.sixes = 0;
  },

  setUp(state) {
    state.tokens = [];
    for (const seat of state.seats) {
      seat.home = 0;
      seat.sent = 0;
      for (let i = 0; i < state.settings.tokens; i++) {
        state.tokens.push({ seat: seat.seat, i, at: -1 });
      }
    }
    state.turn = 0;
    state.sixes = 0;
    state.rolled = null;
    state.said = 'Roll a six to come out.';
  },

  act(state, seat, action) {
    if (state.seats[state.turn]?.id !== seat.id) return;

    if (action.type === 'throw') {
      if (state.rolled) return;
      const value = 1 + Math.floor(Math.random() * 6);
      const grace = value === 6;
      state.rolled = { sticks: null, value, grace };
      state.said = `${seat.name} rolls ${value}.`;

      if (grace) {
        state.sixes += 1;
        // Three in a row and the whole turn goes. It is the oldest brake in
        // the game and without it a lucky streak never ends.
        if (state.sixes >= 3) {
          state.said = `${seat.name} rolls a third six — turn forfeit.`;
          state.log.push(state.said);
          state.sixes = 0;
          passTurn(state);
          return;
        }
      }

      const moves = legalMoves(state, seat, value);
      if (!moves.length) {
        state.log.push(`${state.said} Nothing to move.`);
        if (grace) { state.rolled = null; state.turnLeft = state.settings.turnSeconds; }
        else { state.sixes = 0; passTurn(state); }
      }
      state.dirty = true;
      return;
    }

    if (action.type === 'move') {
      if (!state.rolled) return;
      const which = Number(action.token);
      const move = legalMoves(state, seat, state.rolled.value).find((m) => m.token === which);
      if (!move) return;
      apply(state, seat, move);

      if (state.rolled.grace) {
        state.rolled = null;
        state.turnLeft = state.settings.turnSeconds;
        state.dirty = true;
      } else {
        state.sixes = 0;
        passTurn(state);
      }
    }
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat) return;
    if (!state.rolled) { ludo.__spec.act(state, seat, { type: 'throw' }); return; }
    const moves = legalMoves(state, seat, state.rolled.value);
    if (!moves.length) { passTurn(state); return; }
    // Prefer sending somebody home, then the furthest token — what a person
    // who had stopped paying attention would be told to do.
    const pick = moves.find((m) => m.sends) ?? [...moves].sort((a, b) => b.to - a.to)[0];
    state.log.push(`${seat.name} was away — moved on.`);
    ludo.__spec.act(state, seat, { type: 'move', token: pick.token });
  },

  isDone: (state) => state.seats.some((s) => (s.home ?? 0) >= state.settings.tokens)
    || inPlay(state).length <= 1,

  table(state) {
    return {
      ring: RING,
      starts: STARTS,
      safe: [...SAFE_SQUARES],
      homeAt: HOME,
      lastRingStep: LAST_RING_STEP,
      tokens: state.tokens.map((t) => ({
        seat: t.seat, i: t.i, at: t.at,
        square: ringSquare(t.seat, t.at),
        column: t.at > LAST_RING_STEP && t.at < HOME ? t.at - LAST_RING_STEP : null,
        home: t.at === HOME,
      })),
      yards: state.seats.map((s) => ({
        seat: s.seat, name: s.name,
        yard: state.tokens.filter((t) => t.seat === s.seat && t.at === -1).length,
        home: s.home ?? 0,
        sent: s.sent ?? 0,
      })),
      tokensEach: state.settings.tokens,
      sixes: state.sixes,
    };
  },

  mine(state, seat) {
    if (!seat) return { moves: [] };
    const value = state.rolled?.value ?? null;
    return {
      moves: value === null ? [] : legalMoves(state, seat, value),
      needsThrow: !state.rolled,
      yard: state.tokens.filter((t) => t.seat === seat.seat && t.at === -1).length,
      home: seat.home ?? 0,
    };
  },

  rank: (a, b) => (b.home ?? 0) - (a.home ?? 0) || (b.sent ?? 0) - (a.sent ?? 0),
});

/** Whoever is standing on a ring square, whatever colour. */
function standingOn(state, square) {
  if (square === null) return [];
  return state.tokens.filter((t) => ringSquare(t.seat, t.at) === square);
}

export function legalMoves(state, seat, value) {
  const mine = state.tokens.filter((t) => t.seat === seat.seat);
  const out = [];

  // Out of the yard. Only ever on a six, and only if your own start is not
  // already blocked by your own token.
  if (value === 6) {
    const start = ringSquare(seat.seat, 0);
    const there = standingOn(state, start);
    const blockedByMe = there.some((t) => t.seat === seat.seat);
    const waiting = mine.find((t) => t.at === -1);
    if (waiting && !blockedByMe) {
      const enemy = there.find((t) => t.seat !== seat.seat);
      // The start is a star, so coming out never sends anybody home.
      out.push({ token: waiting.i, from: -1, to: 0, square: start, enters: true, sends: null });
    }
  }

  for (const token of mine) {
    if (token.at < 0 || token.at === HOME) continue;
    const to = token.at + value;
    // Home is reached exactly. Overshooting is not a move.
    if (to > HOME) continue;

    const square = ringSquare(seat.seat, to);
    const there = standingOn(state, square);

    // Your own token blocks you, except on a star where colours may share.
    if (square !== null && !SAFE_SQUARES.has(square) && there.some((t) => t.seat === seat.seat)) continue;

    const victim = square !== null && !SAFE_SQUARES.has(square)
      ? there.find((t) => t.seat !== seat.seat) ?? null
      : null;

    out.push({
      token: token.i,
      from: token.at,
      to,
      square,
      enters: false,
      sends: victim ? { seat: victim.seat, i: victim.i } : null,
    });
  }
  return out;
}

function apply(state, seat, move) {
  const token = state.tokens.find((t) => t.seat === seat.seat && t.i === move.token);
  if (!token) return;
  token.at = move.to;

  if (move.sends) {
    const victim = state.tokens.find((t) => t.seat === move.sends.seat && t.i === move.sends.i);
    if (victim) {
      victim.at = -1;
      seat.sent = (seat.sent ?? 0) + 1;
      const whose = state.seats.find((s) => s.seat === victim.seat);
      state.said = `${seat.name} sends ${whose?.name ?? 'somebody'} home.`;
      state.log.push(state.said);
    }
  } else if (move.enters) {
    state.said = `${seat.name} comes out.`;
  } else if (move.to === HOME) {
    seat.home = (seat.home ?? 0) + 1;
    state.said = `${seat.name} gets one home — ${seat.home} of ${state.settings.tokens}.`;
    state.log.push(state.said);
  }

  seat.score = (seat.home ?? 0) * 10 + (seat.sent ?? 0);
  state.dirty = true;
}

export default ludo;
