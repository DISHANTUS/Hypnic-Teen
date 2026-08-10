// Sevens.
//
// The whole pack goes out and the sevens go down first. After that you may only
// add the card immediately above or below one already on the table, in the same
// suit — so the eight and six of hearts once the seven of hearts is down, then
// the nine and the five, and so on out to the ace and the two.
//
// The rule that makes it a game rather than a queue: **if you can play, you
// must.** Passing when something would go is not allowed, and that turns the
// whole thing into a problem about which of your legal moves opens the fewest
// doors for everybody else. Holding the seven of a suit you are long in is the
// single strongest thing you can do, and it is only strong because passing is
// not an option.
//
// Enforced on the server, obviously. A client that merely greys out the pass
// button is a client one keypress away from breaking the only rule that matters.

import {
  createCardGame, dealAll, goOut, finishOrder, nextSeat, passTurn, inPlay,
  rankOf, suitOf, sayCard, SUITS, RANKS,
} from './kit.js';

const at = (rank) => RANKS.indexOf(rank);
const SEVEN = at('7');

export const sevens = createCardGame({
  id: 'sevens',
  name: 'Sevens',
  tagline: 'Build out from the sevens. If you can play, you must.',
  emoji: '7️⃣',
  accent: '#2c3e50',
  face: 'sevens',
  minPlayers: 3,
  maxPlayers: 8,
  hands: 3,
  turnSeconds: 25,

  howToPlay: [
    'The sevens go down first. Everything builds out from them, in suit.',
    'Once the seven of hearts is down you may add the six or the eight, then the five or the nine, and on out.',
    'If you have a card that will go, you must play it. Passing is only for when you truly cannot.',
    'Sitting on a seven blocks a whole suit — which is exactly why you cannot pass instead.',
    'First to empty their hand wins.',
  ],

  init(state) {
    // Per suit, the span already on the table as [lowest, highest] indexes.
    state.rows = {};
    state.finished = [];
    state.passes = 0;
  },

  deal(state) {
    dealAll(state);
    state.rows = Object.fromEntries(SUITS.map((s) => [s, null]));
    state.finished = [];
    state.passes = 0;
    state.pile = [];
    // Whoever has the seven of diamonds opens with it.
    const opener = state.seats.find((s) => s.hand.includes('7d'));
    state.turn = opener?.seat ?? 0;
    state.said = opener ? `${opener.name} starts with the seven of diamonds.` : 'Lay a seven.';
  },

  act(state, seat, action) {
    if (state.seats[state.turn]?.id !== seat.id || seat.out) return;

    if (action.type === 'pass') {
      // The one rule. Somebody with a legal card cannot choose to sit on it.
      if (seat.hand.some((c) => fits(state, c))) return;
      state.passes += 1;
      state.said = `${seat.name} cannot go.`;
      passTurn(state);
      return;
    }

    if (action.type !== 'play') return;
    const card = String(action.card ?? '');
    if (!seat.hand.includes(card) || !fits(state, card)) return;

    seat.hand.splice(seat.hand.indexOf(card), 1);
    lay(state, card);
    state.passes = 0;
    state.said = `${seat.name} lays the ${sayCard(card)}.`;

    if (!seat.hand.length) {
      goOut(state, seat);
      if (inPlay(state).length <= 1) {
        const last = inPlay(state)[0];
        if (last) goOut(state, last);
        state.dirty = true;
        return;
      }
    }
    passTurn(state);
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat || seat.out) return;
    const can = seat.hand.filter((c) => fits(state, c));
    if (can.length) {
      // Play the card furthest from a seven, which is the least useful one to
      // hold and therefore what somebody not paying attention loses least by.
      const pick = can.sort((a, b) => Math.abs(at(rankOf(b)) - SEVEN) - Math.abs(at(rankOf(a)) - SEVEN))[0];
      state.log.push(`${seat.name} was away — laid one.`);
      sevens.__spec.act(state, seat, { type: 'play', card: pick });
      return;
    }
    state.passes += 1;
    state.log.push(`${seat.name} was away, and could not go anyway.`);
    passTurn(state);
  },

  handOver: (state) => inPlay(state).length === 0,

  scoreHand(state) {
    const order = finishOrder(state);
    order.forEach((seatNo, i) => {
      const s = state.seats.find((x) => x.seat === seatNo);
      if (!s) return;
      s.score += Math.max(0, order.length - i - 1) * 2;
      if (i === 0) { s.score += 3; s.won += 1; }
    });
    const first = state.seats.find((x) => x.seat === order[0]);
    state.said = first ? `${first.name} got out first.` : 'Hand over.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      // The layout, as the span each suit currently covers. The client draws
      // the run from this rather than being sent every card on the table.
      rows: SUITS.map((suit) => {
        const row = state.rows[suit];
        return {
          suit,
          low: row ? RANKS[row[0]] : null,
          high: row ? RANKS[row[1]] : null,
          cards: row ? RANKS.slice(row[0], row[1] + 1).map((r) => `${r}${suit}`) : [],
        };
      }),
      passes: state.passes,
      finished: state.finished,
    };
  },

  mine(state, seat) {
    if (!seat) return { playable: [], mustPlay: false };
    const playable = seat.hand.filter((c) => fits(state, c));
    // Said outright, so the client can put the reason on the pass button
    // rather than just refusing the press.
    return { playable, mustPlay: playable.length > 0 };
  },
});

/** Whether a card can go down right now. */
function fits(state, card) {
  const suit = suitOf(card);
  const i = at(rankOf(card));
  const row = state.rows[suit];
  if (!row) return i === SEVEN;          // only the seven opens a suit
  return i === row[0] - 1 || i === row[1] + 1;
}

function lay(state, card) {
  const suit = suitOf(card);
  const i = at(rankOf(card));
  const row = state.rows[suit];
  if (!row) { state.rows[suit] = [i, i]; return; }
  state.rows[suit] = [Math.min(row[0], i), Math.max(row[1], i)];
}

export default sevens;
