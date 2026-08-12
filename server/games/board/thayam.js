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

/**
 * THE BOARD. Everything about its shape is here and nowhere else.
 *
 * This is the one thing in the game that is not a rule — it is a drawing, and
 * drawings differ from family to family and village to village. So it is a
 * table rather than a computation: change these four values and the game
 * follows, with no geometry to re-derive and nothing else to touch.
 *
 *   cols, rows   how big the grid is
 *   crosses      the safe squares, as "row,col"
 *   entries      where each player comes on, in seat order
 *   route        the exact squares one player walks, entry first, centre last
 *
 * The route is given once, for the player who comes on at the bottom, and the
 * others are the same walk turned a quarter, a half and three quarters of the
 * way round. That holds for a square board with four-fold symmetry, which this
 * one has; if a board ever turns up that does not, every route can simply be
 * listed out and `routeFor` stops rotating.
 */
export const BOARD = {
  cols: 7,
  rows: 7,

  /**
   * Nine crosses, off a photograph of the real board.
   *
   * Four where the players come on — the middle of each outer side — four at
   * the corners of the ring inside that, and the middle. A coin on a cross
   * cannot be cut and any number may stand there, whoever they belong to, which
   * is the only reason a crowded board does not seize up.
   *
   * The inner four were on the wrong squares to begin with: the *midpoints* of
   * the inner ring rather than its corners. It looked plausible and it was the
   * difference between this board and a board.
   */
  crosses: [
    '6,3', '3,0', '0,3', '3,6',   // the four the players come on at
    '5,1', '5,5', '1,5', '1,1',   // the corners of the ring inside
    '3,3',                        // pazham, the middle
  ],

  /** Bottom, left, top, right — one player to a side. */
  entries: ['6,3', '3,0', '0,3', '3,6'],
};

const SIZE = BOARD.cols;
const MID = Math.floor(SIZE / 2);
const CENTRE = [MID, MID];

/**
 * The route, for the player who comes on at the bottom.
 *
 * A lap of the outer ring from their own cross, then in to the cross on their
 * own side of the next ring, a lap of that, then the innermost, then the
 * middle. Forty-nine squares.
 */
const RINGS = [ringPath(0, SIZE - 1), ringPath(1, SIZE - 2), ringPath(2, SIZE - 3)];

/**
 * Where a player turns in, one ring further down.
 *
 * Not the square directly inward from where they came on — the *corner* of the
 * next ring painted in that player's own colour. The real board says this twice
 * over and both readings agree, which is the only reason the direction of
 * travel is knowable at all:
 *
 *   The colours. Each player has two crosses painted alike, their entry on the
 *   outer side and the inner corner they turn in at. Bottom pairs with
 *   bottom-right, left with bottom-left, top with top-left, right with
 *   top-right.
 *
 *   The distance. A coin walks its whole lap and turns in from the square one
 *   short of the cross it came on at — 23 of the outer ring's 24. For all four
 *   players at once, that 23rd square touches their own coloured corner only if
 *   travel runs right along the top, down the right, left along the bottom and
 *   up the left. Clockwise. The other way round, not one of the four lands
 *   anywhere near its corner.
 *
 * So this table and `ringPath`'s direction are one fact stated in two places,
 * and the boardroom test checks both against each other.
 */
const inward = (entry, ring) => {
  const [r, c] = entry;
  if (c === 0) return [SIZE - 1 - ring, ring];                   // left  → bottom-left
  if (r === SIZE - 1) return [SIZE - 1 - ring, SIZE - 1 - ring];  // bottom → bottom-right
  if (c === SIZE - 1) return [ring, SIZE - 1 - ring];            // right → top-right
  return [ring, ring];                                            // top   → top-left
};

const ENTRIES = BOARD.entries.map((k) => k.split(',').map(Number));

function routeFor(seatNo) {
  const entry = ENTRIES[seatNo % ENTRIES.length];
  return [
    ...startAt(RINGS[0], entry),
    ...startAt(RINGS[1], inward(entry, 1)),
    ...startAt(RINGS[2], inward(entry, 2)),
    CENTRE,
  ];
}

const PATHS = [0, 1, 2, 3].map(routeFor);
const HOME = PATHS[0].length - 1;   // the centre, as a step along the route
/** Where the outer ring ends. Nothing crosses this without a kill. */
const FIRST_LAYER = RINGS[0].length;

export const SAFE = new Set(BOARD.crosses);
export const isSafe = (cell) => SAFE.has(cellKey(cell));

/** Which square a coin is standing on, by its own route. */
const cellOf = (coin) => cellKey(PATHS[coin.seat % 4][coin.at]);

/**
 * Shut out for good — no cuts, and nothing left anywhere that they could cut.
 *
 * A player who has never cut cannot leave the outer ring, and the only way to
 * cut is to land on somebody out there with them. So once every other coin on
 * the board is already inside — where they cannot follow — the door is not shut
 * for now, it is shut forever. Coins still in hand do not count as safe: they
 * come back out onto the ring, and a coin coming back out is a target.
 *
 * This is what makes the blockade win real rather than a formality. Without it
 * the table would sit there throwing sticks at a game that was already decided.
 */
function shutOut(state, seat) {
  if ((seat.cuts ?? 0) > 0) return false;
  return !state.coins.some((c) => c.seat !== seat.seat && c.at < FIRST_LAYER);
}

/** The one player left who can still reach the middle, if there is exactly one. */
function blockadeWinner(state) {
  if (state.seats.length < 2) return null;
  const alive = state.seats.filter((s) => !s.out && !shutOut(state, s));
  if (alive.length !== 1) return null;
  // Somebody has to have actually got inside — otherwise this fires on a board
  // where everyone is simply still in hand at the start.
  const win = alive[0];
  if (!state.coins.some((c) => c.seat === win.seat && c.at >= FIRST_LAYER)) return null;
  return win;
}

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
    'Coins go round clockwise, a full lap of the outer ring, and turn inward at the corner cross painted your colour.',
    'Only one coin may stand on a plain square, even your own. A cross holds as many as you like.',
    'Land on somebody else off a cross and you cut them — that coin goes back to their hand, and you throw again.',
    'You cannot leave the outer ring until you have cut somebody. A coin that gets all the way round without one stops on the square before its own cross and stays there, dead, until somebody of yours draws blood.',
    'So if a rival gets every coin inside while you have never cut, you can never follow — and they have won, centre or no centre.',
    'Inside, two of your coins standing on the same cross may be paired. A pair moves half as far, so only even throws move it — and only another pair can cut it.',
    'Bring all your coins to the centre. You need the exact throw to land on it.',
  ],

  options: {
    coins: { label: 'Coins each', kind: 'number', min: 2, max: 6, hardMax: 6, step: 1, default: 6 },
  },
  settings: (s) => ({ coins: Math.max(2, Math.min(6, Number(s.coins) || 6)) }),

  init(state) {
    state.linger = 0;
    state.lingerThen = null;
    state.coins = [];
    state.rolled = null;
    state.graceLeft = 0;
    state.mustMove = false;
    state.blockade = null;
  },

  setUp(state) {
    const n = state.settings.coins;
    state.coins = [];
    for (const seat of state.seats) {
      seat.cuts = 0;
      seat.home = 0;
      for (let i = 0; i < n; i++) {
        // -1 is in hand. Everything starts there; dayam is the only way out.
        // `pair` holds the other coin's index once two are joined, or null.
        state.coins.push({ seat: seat.seat, i, at: -1, pair: null });
      }
    }
    state.turn = 0;
    state.rolled = null;
    state.blockade = null;
    state.said = 'Throw a one to come on.';
  },

  tick(state, dt) {
    // The pause after a wasted throw, so the sticks are seen before the turn
    // moves on. In tick rather than a timer so an unwatched room still runs.
    if (state.linger > 0) {
      if (!state.rolled) { state.linger = 0; }
      else {
        state.linger -= dt;
        if (state.linger <= 0) {
          state.linger = 0;
          if (state.lingerThen === 'again') {
            state.rolled = null;
            state.turnLeft = state.settings.turnSeconds;
            state.dirty = true;
          } else {
            passTurn(state);
          }
        }
      }
    }

    // Checked on the clock rather than after a move, because the thing that
    // shuts the last door is somebody *else's* coin going inside, not your own.
    if (state.blockade !== null) return;
    const win = blockadeWinner(state);
    if (!win) return;
    state.blockade = win.seat;
    win.won = 1;
    state.said = `${win.name} is inside and nobody else ever cut anybody — nobody can follow.`;
    state.log.push(state.said);
    state.dirty = true;
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
        //
        // Either way the sticks stay on screen for a beat first. Clearing them
        // in the same action as the throw meant no client ever received a
        // state in which they existed — you threw, and the turn moved on
        // without the sticks ever landing.
        state.log.push(`${state.said} Nothing to move.`);
        state.linger = 1.4;
        state.lingerThen = out.grace ? 'again' : 'pass';
      }
      state.dirty = true;
      return;
    }

    // Joining two coins in the inner circle, and separating them again.
    //
    // Pairing is a declaration rather than a move: it does not use the throw,
    // because a player who paid a whole turn for it and then had to wait for an
    // even number would effectively lose two.
    if (action.type === 'pair') {
      const a = state.coins.find((c) => c.seat === seat.seat && c.i === Number(action.coins?.[0]));
      const b = state.coins.find((c) => c.seat === seat.seat && c.i === Number(action.coins?.[1]));
      if (!a || !b || a === b) return;
      if (a.pair !== null || b.pair !== null) return;
      // Both inside, on the same square, and that square a cross. Two of your
      // coins can only ever share a plain square if something else has already
      // gone wrong — one to a plain square is the rule — so this is belt and
      // braces, but it is also the rule as it is actually spoken: you pair on a
      // mala, standing together on safe ground.
      if (a.at < FIRST_LAYER || b.at < FIRST_LAYER) return;
      if (a.at !== b.at || a.at === HOME) return;
      if (!SAFE.has(cellOf(a))) return;
      a.pair = b.i;
      b.pair = a.i;
      state.said = `${seat.name} pairs two coins.`;
      state.log.push(state.said);
      state.dirty = true;
      return;
    }

    if (action.type === 'unpair') {
      const a = state.coins.find((c) => c.seat === seat.seat && c.i === Number(action.coin));
      if (!a || a.pair === null) return;
      const b = state.coins.find((c) => c.seat === seat.seat && c.i === a.pair);
      a.pair = null;
      if (b) b.pair = null;
      state.said = `${seat.name} separates a pair.`;
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

      const cutsBefore = seat.cuts ?? 0;
      apply(state, seat, coin, move);
      // Cutting somebody earns a throw of its own, on top of whatever the
      // dice said. It is the reward that makes the war rule worth obeying —
      // without it, the throw that finally opens your way inward costs you the
      // rest of your turn.
      const cutSomebody = (seat.cuts ?? 0) > cutsBefore;

      // A grace throw earns another. Anything else ends the turn.
      if (state.rolled.grace || cutSomebody) {
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
    if (state.linger > 0) return;   // the wasted throw is still being shown
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
    || state.blockade !== null
    || inPlay(state).length <= 1,

  table(state) {
    return {
      size: SIZE,
      // Who, if anybody, has won by shutting everybody else out of the middle,
      // so the board can say why it stopped rather than just stopping.
      blockade: state.blockade,
      shutOut: state.seats.filter((s) => shutOut(state, s)).map((s) => s.seat),
      // Every square that is a cross, so the client draws the board rather
      // than being told where to put nine X marks.
      safe: [...SAFE],
      centre: cellKey(CENTRE),
      coins: state.coins.map((c) => ({
        seat: c.seat, i: c.i, at: c.at, pair: c.pair,
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
    const blocked = [];
    const moves = value === null ? [] : legalMoves(state, seat, value, blocked);
    // Which of your coins could be joined right now: two of yours, inside, on
    // the same square, neither already paired.
    const inside = state.coins.filter((c) =>
      c.seat === seat.seat && c.at >= FIRST_LAYER && c.at !== HOME && c.pair === null
      && SAFE.has(cellOf(c)));
    const canPair = [];
    for (let a = 0; a < inside.length; a++) {
      for (let b = a + 1; b < inside.length; b++) {
        if (inside[a].at === inside[b].at) canPair.push([inside[a].i, inside[b].i]);
      }
    }
    return {
      blocked,
      canPair,
      pairs: state.coins
        .filter((c) => c.seat === seat.seat && c.pair !== null && c.pair > c.i)
        .map((c) => [c.i, c.pair]),
      // Worked out on the server so the client highlights exactly what the
      // server would accept. Two places deciding what is legal is two places
      // to disagree, and here they would disagree about whose coin dies.
      moves,
      needsThrow: !state.rolled,
      cuts: seat.cuts ?? 0,
      canLeaveFirstLayer: (seat.cuts ?? 0) > 0,
      // Not "you cannot get in yet" but "you cannot get in, ever". Worth saying
      // out loud — a player staring at a coin that will not move deserves to
      // know which of the two it is.
      shutOut: shutOut(state, seat),
      inHand: state.coins.filter((c) => c.seat === seat.seat && c.at === -1).length,
      home: seat.home ?? 0,
    };
  },

  rank: (a, b) => (b.won ?? 0) - (a.won ?? 0)
    || (b.home ?? 0) - (a.home ?? 0)
    || (b.cuts ?? 0) - (a.cuts ?? 0),
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
export function legalMoves(state, seat, value, blocked = []) {
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
    // A pair moves as one thing, so it is offered once — under the lower of the
    // two indexes — rather than twice under each coin.
    if (coin.pair !== null && coin.pair < coin.i) continue;

    // Paired coins move at half rate: one step costs a point for each of them.
    // So a two moves a pair one square, a four moves it two, and an odd throw
    // cannot move a pair at all — which is the whole trade.
    const paired = coin.pair !== null;
    if (paired && value % 2 !== 0) continue;
    const steps = paired ? value / 2 : value;

    const to = coin.at + steps;
    // Exact throw to come home. Overshooting is simply not a move.
    if (to > HOME) continue;
    // The war rule: nothing leaves the outer ring until this player has cut
    // somebody. Written as the destination crossing the boundary rather than
    // the coin's current ring, so a big throw cannot jump the gate.
    //
    // Recorded rather than silently skipped. A player whose only coin is stuck
    // at the gate sees "nothing that throw can move" and has no idea why, which
    // is the difference between a rule and a bug as far as they can tell.
    if (coin.at < FIRST_LAYER && to >= FIRST_LAYER && (seat.cuts ?? 0) === 0) {
      blocked.push({ coin: coin.i, from: coin.at, to, why: 'gate' });
      continue;
    }

    const cell = cellKey(PATHS[seat.seat % 4][to]);
    const safe = SAFE.has(cell);
    const sitting = to === HOME ? null : occupant(state, cell);

    if (sitting && !safe) {
      // Your own coin blocks you — one to a plain square, even your own. A pair
      // of your own is the same wall.
      if (sitting.seat === seat.seat) continue;
      // A pair can only be cut by a pair.
      //
      // Inferred rather than stated: pairing as described is nothing but cost —
      // half speed, and every odd throw wasted — so if a pair could still be cut
      // by a single coin there would be no reason on earth to make one. Safety
      // is what buys the slowness.
      if (sitting.pair !== null && !paired) {
        blocked.push({ coin: coin.i, from: coin.at, to, why: 'pair' });
        continue;
      }
      out.push({
        coin: coin.i, from: coin.at, to, cell, enters: false, paired,
        cuts: { seat: sitting.seat, i: sitting.i, pair: sitting.pair },
      });
      continue;
    }
    if (sitting && safe && sitting.seat === seat.seat && to !== HOME) {
      // A cross holds as many as you like, including your own.
      out.push({ coin: coin.i, from: coin.at, to, cell, enters: false, paired, cuts: null });
      continue;
    }
    out.push({ coin: coin.i, from: coin.at, to, cell, enters: false, paired, cuts: null });
  }
  return out;
}

function apply(state, seat, coin, move) {
  coin.at = move.to;
  // A pair moves as one, so its partner goes with it.
  if (coin.pair !== null) {
    const mate = state.coins.find((c) => c.seat === coin.seat && c.i === coin.pair);
    if (mate) mate.at = move.to;
  }

  if (move.cuts) {
    const victim = state.coins.find((c) => c.seat === move.cuts.seat && c.i === move.cuts.i);
    if (victim) {
      victim.at = -1;
      // Cutting a pair sends both of them back and separates them.
      if (victim.pair !== null) {
        const other = state.coins.find((c) => c.seat === victim.seat && c.i === victim.pair);
        if (other) { other.at = -1; other.pair = null; }
        victim.pair = null;
      }
      seat.cuts = (seat.cuts ?? 0) + 1;
      const whose = state.seats.find((s) => s.seat === victim.seat);
      state.said = `${seat.name} cuts ${whose?.name ?? 'somebody'}.`;
      state.log.push(state.said);
    }
  } else if (move.enters) {
    state.said = `${seat.name} comes on.`;
  } else if (move.to === HOME) {
    // A pair arriving home is two coins home, and it stops being a pair.
    if (coin.pair !== null) {
      const mate = state.coins.find((c) => c.seat === coin.seat && c.i === coin.pair);
      if (mate) { mate.pair = null; seat.home = (seat.home ?? 0) + 1; }
      coin.pair = null;
    }
    seat.home = (seat.home ?? 0) + 1;
    seat.score = seat.home * 10 + (seat.cuts ?? 0);
    state.said = `${seat.name} brings one home — ${seat.home} of ${state.settings.coins}.`;
    state.log.push(state.said);
    if (seat.home >= state.settings.coins) seat.won = 1;
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
