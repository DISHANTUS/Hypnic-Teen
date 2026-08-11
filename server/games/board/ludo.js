// Ludo.
//
// Tokens run a shared circuit, each colour from its own corner, and a six gets
// one out of the yard. A token's position is held as *how far it has come*, not
// as where it is on the board — the absolute square is worked out from that
// when it is needed.
//
// That is the one decision here worth writing down. Holding the absolute square
// instead would mean every rule needing to know how far the owner still has to
// go, which is the same number computed backwards, and getting it wrong by one
// puts somebody's home column on top of somebody else's. Relative position is
// the honest model: a token has come fifty-seven steps, and only the drawing
// cares which square that is.
//
// The board grows with the table. Four seats or fewer play the classic cross —
// four arms, a fifty-two square ring. Five or six play the six-armed board,
// which is the same game with a longer lap: every arm contributes thirteen
// squares whichever board it is, so the ring is arms × 13 and every other
// number falls out of that. Nothing else about the rules changes, which is the
// reason this is one game and not two.
//
// Teams are the other option. Partners sit opposite — seat k and seat k + half
// the table — and the pair wins together: every token of both colours home.
// You cannot send your own partner back to the yard, and your partner's token
// blocks you the way your own does. Everything else stays cut-throat.

import { createBoardGame, inPlay, passTurn } from './kit.js';

/** Thirteen ring squares per arm, on either board. */
const PER_ARM = 13;
/** Six steps of home column (five squares and the doorstep), then home. */
const COLUMN = 6;

/** Everything the geometry of one board follows from. */
export function boardOf(arms) {
  const ring = arms * PER_ARM;
  const starts = Array.from({ length: arms }, (_, k) => k * PER_ARM);
  return {
    arms,
    ring,
    starts,
    /** How far along the ring before turning into your own column. */
    lastRingStep: ring - 2,
    /** Rel-position that means "home". */
    home: ring - 2 + COLUMN + 1,
    /** The stars: each start, and the square eight past it. */
    safe: new Set([...starts, ...starts.map((s) => (s + 8) % ring)]),
  };
}

const geo = (state) => boardOf(state.settings.arms);

/** Which square of the ring a token is standing on, or null if it has turned in. */
export function ringSquare(board, seatNo, rel) {
  if (rel < 0 || rel > board.lastRingStep) return null;
  return (board.starts[seatNo % board.arms] + rel) % board.ring;
}

/** Your partner's seat, or -1 when playing solo. */
export function partnerOf(state, seatNo) {
  if (state.settings.mode !== 'teams') return -1;
  const n = state.seats.length;
  if (n < 4 || n % 2 !== 0) return -1;
  return (seatNo + n / 2) % n;
}

const sameSide = (state, a, b) => a === b || partnerOf(state, a) === b;

export const ludo = createBoardGame({
  id: 'ludo',
  name: 'Ludo',
  tagline: 'Four tokens, one ring, and a six to get out of the yard.',
  emoji: '🎯',
  accent: '#e67e22',
  face: 'ludo',
  minPlayers: 2,
  maxPlayers: 6,
  turnSeconds: 25,

  howToPlay: [
    'Four tokens each, all starting in your yard. Roll a six to bring one out.',
    'A six earns another roll — but three sixes in a row and the turn is forfeit.',
    'Land on somebody else and they go back to their yard. Not on a star, though.',
    'The starred squares are safe. Two colours can rest on one.',
    'Turn into your own home column at the end of the lap, and reach home on an exact roll.',
    'Five or six players get the six-armed board — a longer lap, same rules.',
    'In teams, partners sit opposite and win together. You cannot cut your partner.',
    'First to bring all four home wins — or in teams, all eight.',
  ],

  options: {
    tokens: { label: 'Tokens each', kind: 'number', min: 1, max: 4, hardMax: 4, step: 1, default: 4 },
    mode: {
      label: 'Playing',
      kind: 'choice',
      default: 'solo',
      choices: [
        { id: 'solo', label: 'Everyone for themselves' },
        { id: 'teams', label: 'Teams', note: 'partners opposite — needs 4 or 6 players' },
      ],
    },
  },
  settings: (s, players) => ({
    tokens: Math.max(1, Math.min(4, Number(s.tokens) || 4)),
    // The board is decided by the table, not by a knob: the classic cross up
    // to four, the six-armed board past that. A knob would allow four people
    // on a six-arm board, which is a lap and a half of empty road.
    arms: (players?.length ?? 4) > 4 ? 6 : 4,
    // Teams need an even table of at least four; anything else quietly plays
    // solo rather than refusing to start over a dropdown.
    mode: s.mode === 'teams' && (players?.length ?? 0) >= 4 && (players?.length ?? 0) % 2 === 0
      ? 'teams' : 'solo',
  }),

  init(state) {
    state.tokens = [];
    state.sixes = 0;
  },

  setUp(state) {
    state.tokens = [];
    for (const seat of state.seats) {
      seat.home = 0;
      seat.sent = 0;
      seat.team = partnerOf(state, seat.seat) >= 0
        ? Math.min(seat.seat, partnerOf(state, seat.seat)) : seat.seat;
      for (let i = 0; i < state.settings.tokens; i++) {
        state.tokens.push({ seat: seat.seat, i, at: -1 });
      }
    }
    state.turn = 0;
    state.sixes = 0;
    state.rolled = null;
    state.said = state.settings.mode === 'teams'
      ? 'Teams: you and the seat opposite. Roll a six to come out.'
      : 'Roll a six to come out.';
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

  isDone(state) {
    if (inPlay(state).length <= 1) return true;
    const need = state.settings.tokens;
    if (state.settings.mode === 'teams') {
      // A team is home when every token of both colours is.
      const byTeam = new Map();
      for (const s of state.seats) {
        byTeam.set(s.team, (byTeam.get(s.team) ?? 0) + (s.home ?? 0));
      }
      const teamSize = state.seats.length / (new Set(state.seats.map((s) => s.team)).size || 1);
      return [...byTeam.values()].some((n) => n >= need * teamSize);
    }
    return state.seats.some((s) => (s.home ?? 0) >= need);
  },

  table(state) {
    const board = geo(state);
    return {
      arms: board.arms,
      ring: board.ring,
      starts: board.starts,
      safe: [...board.safe],
      homeAt: board.home,
      lastRingStep: board.lastRingStep,
      mode: state.settings.mode,
      tokens: state.tokens.map((t) => ({
        seat: t.seat, i: t.i, at: t.at,
        square: ringSquare(board, t.seat, t.at),
        column: t.at > board.lastRingStep && t.at < board.home ? t.at - board.lastRingStep : null,
        home: t.at === board.home,
      })),
      yards: state.seats.map((s) => ({
        seat: s.seat, name: s.name, team: s.team,
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
      partner: partnerOf(state, seat.seat),
    };
  },

  rank: (a, b) => (b.home ?? 0) - (a.home ?? 0) || (b.sent ?? 0) - (a.sent ?? 0),
});

/** Whoever is standing on a ring square, whatever colour. */
function standingOn(state, board, square) {
  if (square === null) return [];
  return state.tokens.filter((t) => ringSquare(board, t.seat, t.at) === square);
}

export function legalMoves(state, seat, value) {
  const board = geo(state);
  const mine = state.tokens.filter((t) => t.seat === seat.seat);
  const out = [];

  // Out of the yard. Only ever on a six, and only if your own start is not
  // already blocked by your own side.
  if (value === 6) {
    const start = ringSquare(board, seat.seat, 0);
    const there = standingOn(state, board, start);
    const blocked = there.some((t) => sameSide(state, seat.seat, t.seat));
    const waiting = mine.find((t) => t.at === -1);
    if (waiting && !blocked) {
      // The start is a star, so coming out never sends anybody home.
      out.push({ token: waiting.i, from: -1, to: 0, square: start, enters: true, sends: null });
    }
  }

  for (const token of mine) {
    if (token.at < 0 || token.at === board.home) continue;
    const to = token.at + value;
    // Home is reached exactly. Overshooting is not a move.
    if (to > board.home) continue;

    const square = ringSquare(board, seat.seat, to);
    const there = standingOn(state, board, square);

    // Your own side blocks you, except on a star where colours may share.
    if (square !== null && !board.safe.has(square)
      && there.some((t) => sameSide(state, seat.seat, t.seat))) continue;

    // Only ever a stranger. A partner can never be cut, which the block above
    // already guarantees — landing on them is not a move at all.
    const victim = square !== null && !board.safe.has(square)
      ? there.find((t) => !sameSide(state, seat.seat, t.seat)) ?? null
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
  const board = geo(state);
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
  } else if (move.to === board.home) {
    seat.home = (seat.home ?? 0) + 1;
    state.said = `${seat.name} gets one home — ${seat.home} of ${state.settings.tokens}.`;
    state.log.push(state.said);
  }

  seat.score = (seat.home ?? 0) * 10 + (seat.sent ?? 0);
  state.dirty = true;
}

/** The classic four-arm constants, kept for every test that speaks them. */
const CLASSIC = boardOf(4);
export const SAFE_SQUARES = CLASSIC.safe;

export default ludo;
