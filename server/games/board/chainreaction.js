// Chain Reaction.
//
// Drop an orb into an empty cell or one of your own. When a cell holds as many
// orbs as it has neighbours it bursts, throwing one into each neighbour and
// turning them all your colour. Those may burst too. Last colour on the board
// wins.
//
// Two things make this harder to implement than it looks.
//
// The cascade can run for a very long time, and the reason is not a bug — a
// board that never settles is a board where one player already owns every cell,
// because that is the only way the orbs have nowhere to escape to. So the loop
// does not have a step limit bolted on as a safety net; it checks after each
// wave whether anybody else is left, and stops the moment the answer is no.
// The runaway *is* the win condition, and treating it as one removes the need
// to guess at a cap.
//
// And elimination has to wait for everybody's first turn. A player is out when
// they have no orbs, which is true of every player before they have played, so
// checking too early knocks out the entire table except whoever went first.

import { createBoardGame, inPlay, passTurn } from './kit.js';

/** How many neighbours a cell has, which is also what it takes to burst it. */
function capacityOf(cols, rows, x, y) {
  let n = 0;
  if (x > 0) n += 1;
  if (x < cols - 1) n += 1;
  if (y > 0) n += 1;
  if (y < rows - 1) n += 1;
  return n;
}

const neighbours = (cols, rows, i) => {
  const x = i % cols;
  const y = Math.floor(i / cols);
  const out = [];
  if (x > 0) out.push(i - 1);
  if (x < cols - 1) out.push(i + 1);
  if (y > 0) out.push(i - cols);
  if (y < rows - 1) out.push(i + cols);
  return out;
};

export const chainreaction = createBoardGame({
  id: 'chainreaction',
  name: 'Chain Reaction',
  tagline: 'Fill a cell past its corners and it bursts — and takes the neighbours with it.',
  emoji: '💥',
  accent: '#e84393',
  face: 'chain',
  minPlayers: 2,
  // Eight, like the game everybody knows. The cascade is what makes a crowd
  // worth having — one orb in the wrong corner can hand the board to somebody
  // who has not moved yet.
  maxPlayers: 8,
  turnSeconds: 20,

  howToPlay: [
    'Tap an empty cell, or one of your own, to drop an orb in it.',
    'A cell bursts when it holds as many orbs as it has neighbours — two in a corner, three on an edge, four in the middle.',
    'A burst throws one orb into each neighbour and turns them all your colour.',
    'Those neighbours may burst too. That is the whole game.',
    'Corners are cheap to fill and hard to take. Start there.',
    'Lose every orb on the board and you are out. Last colour standing wins.',
  ],

  // The host sets the size of their own board and the length of their own turn.
  // The sliders cover what people actually want; the typed box goes further,
  // because "however you like" is the point of a house rule and three-by-three
  // is a perfectly good ninety-second game.
  options: {
    cols: { label: 'Columns', kind: 'number', min: 3, max: 12, hardMax: 24, step: 1, default: 6 },
    rows: { label: 'Rows', kind: 'number', min: 3, max: 16, hardMax: 30, step: 1, default: 8 },
    turnSeconds: { label: 'Seconds a turn', kind: 'number', min: 3, max: 120, hardMax: 600, step: 1, default: 20 },
  },
  settings: (s) => ({
    cols: Math.max(3, Math.min(24, Number(s.cols) || 6)),
    rows: Math.max(3, Math.min(30, Number(s.rows) || 8)),
  }),

  init(state) {
    state.cells = [];
    state.played = [];
    state.bursting = null;
    state.moveNo = 0;
    state.result = null;
  },

  setUp(state) {
    const { cols, rows } = state.settings;
    // { n, owner } — owner is a seat number, or null when the cell is empty.
    state.cells = Array.from({ length: cols * rows }, () => ({ n: 0, owner: null }));
    state.played = [];
    state.bursting = null;
    state.moveNo = 0;
    state.result = null;
    state.turn = 0;
    state.said = 'Drop one anywhere.';
  },

  act(state, seat, action) {
    if (state.result) return;
    if (action.type !== 'drop') return;
    if (state.seats[state.turn]?.id !== seat.id || seat.out) return;

    const { cols, rows } = state.settings;
    const at = Number(action.at);
    if (!Number.isInteger(at) || at < 0 || at >= cols * rows) return;

    const cell = state.cells[at];
    // Your own, or nobody's. Never anybody else's — that is the whole
    // restriction the game has and everything else follows from it.
    if (cell.owner !== null && cell.owner !== seat.seat) return;

    cell.n += 1;
    cell.owner = seat.seat;
    if (!state.played.includes(seat.seat)) state.played.push(seat.seat);
    // Stamped per move so a client can tell a fresh cascade from a repeat of
    // the state it is already showing. Without it, every state push during an
    // animation would restart the animation.
    state.moveNo = (state.moveNo ?? 0) + 1;

    const waves = settle(state, seat.seat);
    state.said = waves > 1
      ? `${seat.name} sets off ${waves} waves.`
      : `${seat.name} drops one in.`;
    if (waves > 2) state.log.push(state.said);

    // Nobody is out until everybody has had a go, or the second player is
    // eliminated before they have played a single orb.
    if (state.played.length >= inPlay(state).length) {
      for (const s of state.seats) {
        if (s.out) continue;
        if (!state.cells.some((c) => c.owner === s.seat)) {
          s.out = true;
          state.log.push(`${s.name} is wiped out.`);
        }
      }
    }

    const left = state.seats.filter((s) => !s.out);
    if (left.length <= 1) {
      state.result = { winner: left[0]?.name ?? null, seat: left[0]?.seat ?? null };
      for (const s of state.seats) {
        s.score = state.cells.filter((c) => c.owner === s.seat).length;
        if (left[0] && s.seat === left[0].seat) { s.score += 100; s.won = 1; }
      }
      state.said = left[0] ? `${left[0].name} owns the board.` : 'Nobody is left.';
      state.log.push(state.said);
      state.dirty = true;
      return;
    }

    for (const s of state.seats) s.score = state.cells.filter((c) => c.owner === s.seat).length;
    passTurn(state);
  },

  timedOut(state) {
    if (state.result) return;
    const seat = state.seats[state.turn];
    if (!seat || seat.out) return;
    const { cols, rows } = state.settings;
    // Somewhere legal, preferring a corner, which is what anybody would be
    // told to do and is the least damaging choice to make on their behalf.
    const legal = state.cells
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.owner === null || c.owner === seat.seat)
      .sort((a, b) =>
        capacityOf(cols, rows, a.i % cols, Math.floor(a.i / cols)) -
        capacityOf(cols, rows, b.i % cols, Math.floor(b.i / cols)));
    if (!legal.length) { passTurn(state); return; }
    state.log.push(`${seat.name} was away — one was dropped for them.`);
    chainreaction.__spec.act(state, seat, { type: 'drop', at: legal[0].i });
  },

  isDone: (state) => Boolean(state.result),

  table(state) {
    const { cols, rows } = state.settings;
    return {
      cols,
      rows,
      cells: state.cells.map((c, i) => ({
        n: c.n,
        owner: c.owner,
        // Sent rather than recomputed, so the client can show a cell about to
        // go without reimplementing the geometry and getting an edge wrong.
        cap: capacityOf(cols, rows, i % cols, Math.floor(i / cols)),
      })),
      counts: state.seats.map((s) => ({
        seat: s.seat, name: s.name, out: s.out,
        orbs: state.cells.filter((c) => c.owner === s.seat).reduce((n, c) => n + c.n, 0),
        cells: state.cells.filter((c) => c.owner === s.seat).length,
      })),
      result: state.result,
      played: state.played,
      // The cascade, wave by wave, for the client to play out. The cells above
      // are already the settled board — this is how it got there.
      bursting: state.bursting,
      moveNo: state.moveNo ?? 0,
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    return {
      seat: seat.seat,
      yourTurn: !state.result && state.seats[state.turn]?.id === seat.id,
      out: Boolean(seat.out),
      // Where you may drop. Worked out here so the board lights up exactly what
      // the server would take.
      canDrop: state.result || seat.out
        ? []
        : state.cells
            .map((c, i) => (c.owner === null || c.owner === seat.seat ? i : -1))
            .filter((i) => i >= 0),
    };
  },

  rank: (a, b) => b.score - a.score,
});

/**
 * Burst everything that is over its capacity, and keep going.
 *
 * Returns how many waves it took, which is worth knowing: one is an ordinary
 * move, five is the thing people play this game for.
 *
 * The loop stops when nothing is over capacity — or when only one player has
 * anything left, which is the case where it would otherwise never stop. A board
 * owned entirely by one colour has nowhere to throw an orb that is not its own,
 * so the cascade feeds itself forever. That is not a runaway to guard against
 * with a step limit; it is the game being over.
 */
/**
 * How many waves of a cascade are kept for the client to play back.
 *
 * Twenty-four is not a guess about correctness, it is a guess about attention:
 * the client plays a frame every ninety milliseconds, so this is already better
 * than two seconds of explosion, and past that a cascade is a blur rather than
 * a thing you are following. It also bounds the payload, which matters more
 * than it looks — the whole board rides in every frame and the state is
 * serialised once per player, so eight people watching a long chain on a big
 * board is the worst case the wire ever sees.
 *
 * Nothing reaches it in practice. A cascade ends the moment one colour is left,
 * and the longest measured is nineteen waves on a board primed to burst in
 * every cell.
 */
const FILMED = 24;

/**
 * How many frames this board can afford.
 *
 * The whole board rides in every frame and the state is serialised once per
 * player, so frames × cells × players is what actually goes down the wire. A
 * six-by-eight board can have all twenty-four; a twenty-four-by-thirty one —
 * which a host may now ask for — gets two, because 720 cells times 24 frames
 * times eight people is a video, not a game state.
 *
 * Two is the floor rather than something more generous on purpose: a short film
 * is not a broken one. The client plays what it is given and then lands on the
 * board the server actually settled on, so the worst a tight budget costs is
 * some of the middle of the explosion — never the outcome.
 */
const framesFor = (cells) => Math.max(2, Math.min(FILMED, Math.floor(1500 / Math.max(1, cells))));

function settle(state, owner) {
  const { cols, rows } = state.settings;
  const budget = framesFor(cols * rows);
  const film = [];
  let waves = 0;
  let cut = 0;

  for (;;) {
    const over = state.cells
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => c.n >= capacityOf(cols, rows, i % cols, Math.floor(i / cols)));
    if (!over.length) break;

    waves += 1;
    // Which cells are about to go, recorded *before* they go — the flash
    // belongs on the cell that burst, not on the neighbours it fed.
    const bursting = over.map(({ i }) => i);

    // A whole wave at once, so the order cells are visited in cannot change
    // the outcome — which it would if each burst were applied as it was found.
    for (const { c, i } of over) {
      c.n -= capacityOf(cols, rows, i % cols, Math.floor(i / cols));
      if (c.n === 0) c.owner = null;
      for (const j of neighbours(cols, rows, i)) {
        state.cells[j].n += 1;
        state.cells[j].owner = owner;
      }
    }

    // The board after this wave, so the client can play the cascade rather than
    // cut to the end of it. Watching the chain propagate is the entire game —
    // sending only the final board is like reporting a firework as a noise.
    if (film.length < budget) {
      film.push({ burst: bursting, cells: state.cells.map((c) => ({ n: c.n, owner: c.owner })) });
    } else {
      cut += 1;
    }

    // The only way out of a cascade that feeds itself.
    const colours = new Set(state.cells.filter((c) => c.n > 0).map((c) => c.owner));
    if (colours.size <= 1) break;
  }

  // A cascade long enough to be trimmed is rare and worth admitting to rather
  // than hiding — the client says so instead of quietly skipping to the end.
  state.bursting = film.length ? { film, cut, waves } : null;
  return waves;
}

export { capacityOf, neighbours };
export default chainreaction;
