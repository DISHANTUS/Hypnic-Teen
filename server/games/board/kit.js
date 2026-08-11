// The board room's shared machinery.
//
// Chess, Ludo, Snakes and Ladders, Shogi and Thayam have almost nothing in
// common in the middle and the same shell around the edges: seats in an order,
// a turn that moves, a clock so one person wandering off does not freeze a
// table of four, and a board that only the server is allowed to change.
//
// That last part is the whole reason these are not client-side toys. A board
// game where the browser decides what is a legal move is a board game where one
// person with a console wins every time — and unlike a card game there is no
// hidden information to hide behind, so the only defence is that the server
// simply refuses. Every game here works the same way: the client sends what it
// would like to do, the server decides whether that is a move.


export const PHASES = { brief: 20, between: 8 };

/** A seat is a player plus whatever the game hangs off one. */
export function seatsFrom(players) {
  return players.map((p, i) => ({
    id: p.id,
    name: p.name,
    seat: i,
    connected: p.connected !== false,
    score: 0,
    won: 0,
    out: false,
  }));
}

export const seatOf = (state, playerId) => state.seats.find((s) => s.id === playerId) ?? null;
export const inPlay = (state) => state.seats.filter((s) => !s.out);

/** Whose turn is next, skipping anybody who has finished or gone. */
export function nextSeat(state, from = state.turn) {
  const live = inPlay(state);
  if (live.length <= 1) return live[0]?.seat ?? from;
  let at = from;
  for (let i = 0; i < state.seats.length + 1; i++) {
    at = (at + 1) % state.seats.length;
    if (state.seats[at] && !state.seats[at].out) return at;
  }
  return from;
}

/** Hand the turn on and restart that seat's clock. */
export function passTurn(state, to = null) {
  state.turn = to === null ? nextSeat(state) : to;
  state.turnLeft = state.settings.turnSeconds;
  state.rolled = null;
  state.dirty = true;
}

/* ------------------------------ ring geometry ----------------------------- */

/**
 * One lap of a square ring, clockwise on screen, as [row, col] pairs.
 *
 * Clockwise where row zero is the top means starting at the top-left and going
 * *right* along the top edge first, then down the right, left along the bottom,
 * and up the left. This is the single easiest thing here to get backwards, and
 * it was backwards for a while: the direction is not a matter of taste, it is
 * fixed by where each player has to turn inward, which the board itself states
 * in colour. See `inward` in thayam.js.
 */
export function ringPath(lo, hi) {
  const cells = [];
  for (let c = lo; c < hi; c++) cells.push([lo, c]);
  for (let r = lo; r < hi; r++) cells.push([r, hi]);
  for (let c = hi; c > lo; c--) cells.push([hi, c]);
  for (let r = hi; r > lo; r--) cells.push([r, lo]);
  return cells;
}

/** Rotate a cycle so it begins at a given cell. */
export function startAt(cells, target) {
  const at = cells.findIndex(([r, c]) => r === target[0] && c === target[1]);
  if (at < 0) return cells;
  return [...cells.slice(at), ...cells.slice(0, at)];
}

export const cellKey = ([r, c]) => `${r},${c}`;

const everyoneReady = (state) => {
  const here = state.seats.filter((s) => s.connected);
  return here.length > 0 && here.every((s) => state.briefed.includes(s.id));
};

/**
 * Build a board game from the parts that make it different from the others.
 *
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.face          which middle the shared client draws
 * @param {(state) => void} spec.setUp
 * @param {(state, seat, action) => void} spec.act
 * @param {(state) => void} [spec.timedOut]
 * @param {(state) => boolean} spec.isDone
 * @param {(state) => object} spec.table
 * @param {(state, seat) => object} [spec.mine]
 */
export function createBoardGame(spec) {
  const turnSeconds = spec.turnSeconds ?? 30;

  // A game may widen or narrow its own clock, and if it does, the clamp has to
  // follow the declaration. Otherwise the setup screen offers a range the
  // server quietly refuses — a host types 600, sees 600, and gets 300.
  const clock = spec.options?.turnSeconds;
  const clockLo = clock?.min ?? 10;
  const clockHi = clock?.hardMax ?? clock?.max ?? 300;

  return {
    __spec: spec,
    id: spec.id,
    name: spec.name,
    tagline: spec.tagline,
    emoji: spec.emoji,
    accent: spec.accent,
    client: '_board',
    face: spec.face ?? spec.id,
    room: 'board',
    minPlayers: spec.minPlayers,
    maxPlayers: spec.maxPlayers,
    tickRate: 4,
    howToPlay: spec.howToPlay,

    options: {
      turnSeconds: { label: 'Seconds a turn', kind: 'number', min: 10, max: 180, hardMax: 300, step: 5, default: turnSeconds },
      ...(spec.options ?? {}),
    },

    createState(players, ctx = {}) {
      const settings = ctx.settings ?? {};
      const state = {
        settings: {
          turnSeconds: Math.max(clockLo, Math.min(clockHi, Number(settings.turnSeconds) || turnSeconds)),
          ...(spec.settings ? spec.settings(settings, players) : {}),
        },
        phase: 'brief',
        timeLeft: PHASES.brief,
        phaseTotal: PHASES.brief,
        briefed: [],
        hostId: ctx.room?.hostId ?? players[0]?.id ?? null,
        seats: seatsFrom(players),
        turn: 0,
        turnLeft: 0,
        rolled: null,
        said: '',
        log: [],
        over: false,
        dirty: true,
      };
      spec.init?.(state);
      return state;
    },

    onPlayerJoin(state, player) {
      const known = seatOf(state, player.id);
      if (known) { known.connected = true; known.name = player.name; }
      // Nobody joins a board game in progress — the board was set up for the
      // people who were here, and adding a colour halfway through would mean
      // re-cutting the board underneath everybody.
      state.dirty = true;
    },

    onPlayerLeave(state, player) {
      const seat = seatOf(state, player.id);
      if (seat) seat.connected = false;
      if (state.hostId === player.id) state.hostId = state.seats.find((s) => s.connected)?.id ?? null;
      if (state.seats[state.turn]?.id === player.id) state.turnLeft = 0;
      state.dirty = true;
    },

    onAction(state, player, action = {}) {
      const seat = seatOf(state, player.id);
      if (!seat) return;

      if (action.type === 'briefed' && state.phase === 'brief') {
        if (!state.briefed.includes(seat.id)) state.briefed.push(seat.id);
        state.dirty = true;
        if (everyoneReady(state)) begin(state, spec);
        return;
      }
      if (state.phase !== 'play') return;
      spec.act(state, seat, action);
    },

    botAction: () => null,

    onTick(state, dt) {
      if (state.over) return;

      if (state.phase === 'brief') {
        state.timeLeft -= dt;
        if (state.timeLeft <= 0) begin(state, spec);
        return;
      }
      if (state.phase !== 'play') return;

      spec.tick?.(state, dt);
      if (state.phase !== 'play') return;

      // Counted down here and *not* broadcast every tick. The clock on screen
      // runs itself forward from the last state it was sent — see turnclock.mjs
      // and the note on isDirty in party.js. Pushing a frame a second per room
      // is bandwidth this studio decided long ago not to spend.
      if (state.turnLeft > 0) {
        state.turnLeft -= dt;
        if (state.turnLeft <= 0) {
          spec.timedOut?.(state);
          state.dirty = true;
        }
      }
      if (spec.isDone(state)) finish(state);
    },

    isDirty(state) { const was = state.dirty; state.dirty = false; return was; },
    isOver: (state) => Boolean(state.over),

    results(state) {
      const order = spec.rank ?? ((a, b) => b.score - a.score || b.won - a.won);
      return [...state.seats].sort(order).map((s, i) => ({
        playerId: s.id, name: s.name, score: s.score, place: i + 1,
      }));
    },

    serialize(state) {
      return {
        phase: state.phase,
        face: spec.face ?? spec.id,
        rules: spec.howToPlay,
        timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
        phaseTotal: state.phaseTotal,
        turn: state.turn,
        turnName: state.seats[state.turn]?.name ?? '',
        turnLeft: Math.max(0, Math.ceil(state.turnLeft)),
        rolled: state.rolled,
        said: state.said,
        seats: state.seats.map((s) => ({
          id: s.id, name: s.name, seat: s.seat, connected: s.connected,
          score: s.score, won: s.won, out: s.out,
        })),
        briefed: state.briefed,
        hostId: state.hostId,
        log: state.log.slice(-4),
        ...(spec.table?.(state) ?? {}),
      };
    },

    serializeFor(state, playerId) {
      const seat = seatOf(state, playerId);
      return {
        ...this.serialize(state),
        you: {
          id: playerId,
          seat: seat?.seat ?? -1,
          yourTurn: state.phase === 'play' && state.seats[state.turn]?.id === playerId,
          isHost: playerId === state.hostId,
          ...(spec.mine?.(state, seat) ?? {}),
        },
      };
    },
  };
}

function begin(state, spec) {
  state.phase = 'play';
  spec.setUp(state);
  state.turnLeft = state.settings.turnSeconds;
  state.phaseTotal = state.settings.turnSeconds;
  state.dirty = true;
}

function finish(state) {
  state.over = true;
  state.phase = 'over';
  state.dirty = true;
}

export const __shell = { begin, finish };
