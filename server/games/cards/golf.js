// Golf.
//
// Six cards each, face down in two rows of three. Two get turned up to start.
// On your turn you take one card — off the deck or off the discard — and either
// swap it into your grid, turning up whatever it replaces, or throw it away and
// turn one of your own cards up instead. When everybody's six are up, lowest
// total wins.
//
// The thing that makes it a game rather than arithmetic is the column rule: two
// cards of the same rank in the same column cancel to nothing. So a card you
// would never want on its own becomes the best card on the table if it lands
// above or below its twin, and half of playing well is watching what other
// people are collecting rather than counting your own.
//
// The private half here is unusual: your own cards are as hidden from you as
// they are from everybody else until you turn them up. So the wire carries face
// values only for squares that are actually face up — for everybody, yourself
// included. A version that quietly told you your own face-down cards would be
// a version with no game in it at all.

import {
  createCardGame, shuffle, freshDeck, drawCards, passTurn, inPlay,
  rankOf, sayCard,
} from './kit.js';

const COLUMNS = 3;
const SLOTS = 6;

/**
 * What a card costs you.
 *
 * Kings are nothing, which is the traditional joke of the game — the biggest
 * card in the pack is the one you most want. Aces are one and everything else
 * is its face value, with the picture cards at ten.
 */
export function cost(card) {
  const rank = rankOf(card);
  if (rank === 'K') return 0;
  if (rank === 'A') return 1;
  if (['T', 'J', 'Q'].includes(rank)) return 10;
  return Number(rank);
}

/** A grid, with matching columns cancelled. */
export function scoreGrid(grid) {
  let total = 0;
  for (let col = 0; col < COLUMNS; col++) {
    const top = grid[col];
    const bottom = grid[col + COLUMNS];
    // A matched column is worth nothing at all — not the cards, not a penalty.
    if (top && bottom && rankOf(top) === rankOf(bottom)) continue;
    total += (top ? cost(top) : 0) + (bottom ? cost(bottom) : 0);
  }
  return total;
}

export const golf = createCardGame({
  id: 'golf',
  name: 'Golf',
  tagline: 'Six cards, lowest wins, and a matched column is worth nothing.',
  emoji: '⛳',
  accent: '#27ae60',
  face: 'golf',
  minPlayers: 2,
  maxPlayers: 6,
  hands: 3,
  turnSeconds: 30,

  howToPlay: [
    'Six cards each, face down in two rows of three. Two are turned up to start.',
    'Take a card off the deck or the discard pile.',
    'Swap it into your grid — whatever it replaces gets turned up — or throw it away and turn one of your own up instead.',
    'Two of the same rank in the same column cancel to nothing.',
    'Kings are worth nothing. Lowest total when all six are up wins.',
  ],

  init(state) {
    state.grids = {};      // seat -> [6 cards]
    state.up = {};         // seat -> [6 booleans]
    state.held = null;     // { by, card, from }
    state.finished = [];
    state.closing = null;  // whoever turned their last card up
  },

  deal(state) {
    state.deck = shuffle(freshDeck());
    state.grids = {};
    state.up = {};
    for (const s of state.seats) {
      s.hand = [];         // the hand is the grid here, not a fan of cards
      state.grids[s.seat] = state.deck.splice(0, SLOTS);
      state.up[s.seat] = new Array(SLOTS).fill(false);
      // Two turned up to start, so nobody begins completely blind.
      state.up[s.seat][0] = true;
      state.up[s.seat][SLOTS - 1] = true;
    }
    state.pile = [state.deck.pop()];
    state.held = null;
    state.finished = [];
    state.closing = null;
    state.turn = state.hand % state.seats.length;
    state.said = 'Take one, then swap it or throw it.';
  },

  act(state, seat, action) {
    if (state.seats[state.turn]?.id !== seat.id || seat.out) return;

    if (action.type === 'take') {
      if (state.held) return;
      if (action.from === 'discard' && state.pile.length) {
        state.held = { by: seat.seat, card: state.pile.pop(), from: 'discard' };
        state.said = `${seat.name} takes the ${sayCard(state.held.card)}.`;
      } else {
        const got = drawCards(state, seat, 1);
        if (!got.length) return;
        // Straight back out of the hand and into the middle — the hand array is
        // not used by this game and leaving it there would confuse the count.
        seat.hand.splice(seat.hand.indexOf(got[0]), 1);
        state.held = { by: seat.seat, card: got[0], from: 'deck' };
        state.said = `${seat.name} draws.`;
      }
      state.dirty = true;
      return;
    }

    if (action.type === 'swap') {
      if (!state.held || state.held.by !== seat.seat) return;
      const at = Math.floor(Number(action.at));
      if (!(at >= 0 && at < SLOTS)) return;
      const grid = state.grids[seat.seat];
      const out = grid[at];
      grid[at] = state.held.card;
      state.up[seat.seat][at] = true;      // whatever you put down, you see
      state.pile.push(out);
      state.held = null;
      state.said = `${seat.name} swaps in the ${sayCard(grid[at])}.`;
      afterMove(state, seat);
      return;
    }

    if (action.type === 'throw') {
      if (!state.held || state.held.by !== seat.seat) return;
      // Throwing away means turning one of your own up instead — you may not
      // simply pass, or a player could sit on four face-down cards forever.
      const at = Math.floor(Number(action.at));
      const up = state.up[seat.seat];
      if (!(at >= 0 && at < SLOTS) || up[at]) return;
      state.pile.push(state.held.card);
      state.held = null;
      up[at] = true;
      state.said = `${seat.name} throws it and turns one up.`;
      afterMove(state, seat);
    }
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat || seat.out) return;
    if (!state.held) { golf.__spec.act(state, seat, { type: 'take', from: 'deck' }); return; }
    const up = state.up[seat.seat];
    const down = up.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    state.log.push(`${seat.name} was away — turned one up.`);
    if (down.length) golf.__spec.act(state, seat, { type: 'throw', at: down[0] });
    else golf.__spec.act(state, seat, { type: 'swap', at: 0 });
  },

  handOver: (state) => state.seats.every((s) => (state.up[s.seat] ?? []).every(Boolean)),

  scoreHand(state) {
    const totals = state.seats.map((s) => ({ s, n: scoreGrid(state.grids[s.seat] ?? []) }));
    const best = Math.min(...totals.map((t) => t.n));
    for (const { s, n } of totals) {
      // Lowest wins, so the score carried is the total and the ordering is
      // reversed — the same trap Hearts has, and worth naming twice.
      s.score += n;
      if (n === best) s.won += 1;
    }
    state.said = totals.map((t) => `${t.s.name} ${t.n}`).join(' · ');
    state.log.push(state.said);
  },

  // Lowest total wins, which is the opposite of most of this room.
  rank: (a, b) => a.score - b.score || b.won - a.won,

  table(state) {
    return {
      lowestWins: true,
      // Face values only for squares that are actually turned up — for
      // everybody, including their owner.
      grids: state.seats.map((s) => ({
        seat: s.seat, name: s.name,
        slots: (state.grids[s.seat] ?? []).map((card, i) => ({
          at: i,
          card: state.up[s.seat]?.[i] ? card : null,
        })),
        showing: (state.up[s.seat] ?? []).filter(Boolean).length,
      })),
      columns: COLUMNS,
      top: state.pile[state.pile.length - 1] ?? null,
      held: state.held ? { by: state.held.by, card: state.held.card, from: state.held.from } : null,
      finished: state.finished,
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    return {
      // Your own total so far, counting only what you have actually seen.
      showing: scoreGrid((state.grids[seat.seat] ?? []).map((c, i) => (state.up[seat.seat]?.[i] ? c : null))),
      faceDown: (state.up[seat.seat] ?? []).filter((v) => !v).length,
      holding: state.held?.by === seat.seat ? state.held.card : null,
    };
  },
});

function afterMove(state, seat) {
  // A grid that is fully up ends that player's involvement, but the hand runs
  // on until everybody is up — otherwise finishing first would be a penalty.
  if ((state.up[seat.seat] ?? []).every(Boolean) && !state.closing) {
    state.closing = seat.name;
    state.log.push(`${seat.name} is all up.`);
  }
  if (inPlay(state).length > 1) passTurn(state);
  state.dirty = true;
}

export default golf;
