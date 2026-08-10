// President.
//
// Play a set — one card, or two of a kind, or three, or four. Everybody after
// you must play the same number of cards, all of one rank, higher than yours,
// or pass. When everybody has passed the pile is swept away and whoever played
// last starts again with whatever they like.
//
// First out is President. Last out is not, and next hand they hand their two
// best cards to the President and get two junk ones back. That exchange is the
// whole social engine of the game — it is what makes winning compound and
// losing sting — so it is the part that has to survive somebody disconnecting
// between hands, which is why the ranks are recorded on the seats rather than
// worked out from the last hand's finishing order at the moment it is needed.

import {
  createCardGame, dealAll, goOut, finishOrder, nextSeat, passTurn, inPlay,
  rankOf, sayRank, RANKS,
} from './kit.js';

/** Twos are the highest card in this game, not the lowest. */
const power = (rank) => (rank === '2' ? 99 : RANKS.indexOf(rank));

export const president = createCardGame({
  id: 'president',
  name: 'President',
  tagline: 'Beat the set or pass. First out rules, last out pays for it.',
  emoji: '👑',
  accent: '#8e44ad',
  face: 'president',
  minPlayers: 3,
  maxPlayers: 8,
  hands: 4,
  turnSeconds: 25,

  howToPlay: [
    'Play a set — one card, a pair, three of a kind, four of a kind.',
    'Everybody after you must play the same number of cards, all the same rank, higher than yours. Or pass.',
    'Once everybody has passed, the pile is swept and whoever went last leads again with anything.',
    'Twos are the highest card in the game.',
    'First out is President. Last out hands their two best cards to the President next deal.',
  ],

  init(state) {
    state.set = null;        // { rank, count, by }
    state.passed = [];
    /** Swept piles. Out of play for the hand, but they still exist. */
    state.discard = [];
    state.finished = [];
    state.ranks = {};        // seat -> 'president' | 'scum' | null, from last hand
  },

  deal(state) {
    dealAll(state);
    state.set = null;
    state.passed = [];
    state.finished = [];
    state.discard = [];

    // The exchange. Only from the second hand on, because there is no
    // president until somebody has won one.
    const swaps = [];
    const pres = state.seats.find((s) => state.ranks[s.seat] === 'president');
    const scum = state.seats.find((s) => state.ranks[s.seat] === 'scum');
    if (pres && scum && pres !== scum) {
      const best = [...scum.hand].sort((a, b) => power(rankOf(b)) - power(rankOf(a))).slice(0, 2);
      const worst = [...pres.hand].sort((a, b) => power(rankOf(a)) - power(rankOf(b))).slice(0, 2);
      for (const c of best) { scum.hand.splice(scum.hand.indexOf(c), 1); pres.hand.push(c); }
      for (const c of worst) { pres.hand.splice(pres.hand.indexOf(c), 1); scum.hand.push(c); }
      swaps.push(`${scum.name} hands two up to ${pres.name}.`);
      state.log.push(swaps[0]);
    }

    // Whoever holds the three of clubs opens, as tradition has it.
    const opener = state.seats.find((s) => s.hand.includes('3c'));
    state.turn = opener?.seat ?? (pres?.seat ?? 0);
    state.said = swaps[0] ?? 'Lead a set.';
  },

  act(state, seat, action) {
    if (state.seats[state.turn]?.id !== seat.id || seat.out) return;

    if (action.type === 'pass') {
      // You cannot pass on your own lead — there is nothing to pass on, and
      // allowing it would let a table stall forever with an empty pile.
      if (!state.set) return;
      if (!state.passed.includes(seat.seat)) state.passed.push(seat.seat);
      state.said = `${seat.name} passes.`;
      afterMove(state);
      return;
    }

    if (action.type !== 'play') return;
    const cards = Array.isArray(action.cards) ? [...new Set(action.cards)] : [];
    if (!cards.length || cards.length > 4) return;
    if (!cards.every((c) => seat.hand.includes(c))) return;

    // All one rank. A "set" of mixed ranks is the single easiest thing to let
    // through by accident and it breaks the whole game.
    const rank = rankOf(cards[0]);
    if (!cards.every((c) => rankOf(c) === rank)) return;

    if (state.set) {
      if (cards.length !== state.set.count) return;
      if (power(rank) <= power(state.set.rank)) return;
    }

    for (const c of cards) seat.hand.splice(seat.hand.indexOf(c), 1);
    state.pile.push(...cards);
    state.set = { rank, count: cards.length, by: seat.seat };
    state.passed = [];
    state.said = `${seat.name} plays ${cards.length} × ${sayRank(rank)}.`;

    if (!seat.hand.length) {
      goOut(state, seat);
      if (inPlay(state).length <= 1) {
        // Whoever is left is last. Record it so the exchange has both ends.
        const last = inPlay(state)[0];
        if (last) goOut(state, last);
        rankThem(state);
        state.dirty = true;
        return;
      }
    }
    afterMove(state);
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat || seat.out) return;
    const best = bestPlay(state, seat);
    if (best) {
      state.log.push(`${seat.name} was away — played on.`);
      president.__spec.act(state, seat, { type: 'play', cards: best });
      return;
    }
    if (!state.set) { passTurn(state); return; }
    if (!state.passed.includes(seat.seat)) state.passed.push(seat.seat);
    state.log.push(`${seat.name} was away — passed.`);
    afterMove(state);
  },

  handOver: (state) => inPlay(state).length === 0,

  scoreHand(state) {
    rankThem(state);
    const order = finishOrder(state);
    order.forEach((seatNo, i) => {
      const s = state.seats.find((x) => x.seat === seatNo);
      if (!s) return;
      s.score += Math.max(0, order.length - i - 1) * 2;
      if (i === 0) { s.score += 4; s.won += 1; }
    });
    const pres = state.seats.find((s) => state.ranks[s.seat] === 'president');
    state.said = pres ? `${pres.name} is President.` : 'Hand over.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      set: state.set && {
        ...state.set,
        byName: state.seats.find((s) => s.seat === state.set.by)?.name ?? '',
      },
      passed: state.passed,
      pileSize: state.pile.length,
      finished: state.finished,
      ranks: state.seats.map((s) => ({ seat: s.seat, name: s.name, rank: state.ranks[s.seat] ?? null })),
    };
  },

  mine(state, seat) {
    if (!seat) return { playable: [] };
    // Which of your cards could start or beat the current set. Sets of two and
    // three are worked out by the client from this; what matters here is that
    // a card nobody could legally lead is dimmed.
    const need = state.set;
    const ok = seat.hand.filter((c) => {
      if (!need) return true;
      if (power(rankOf(c)) <= power(need.rank)) return false;
      // You must be able to make up the count from cards of this rank.
      return seat.hand.filter((x) => rankOf(x) === rankOf(c)).length >= need.count;
    });
    return { playable: ok, needCount: need?.count ?? 0 };
  },
});

/**
 * Everybody but the last player has passed, so the pile goes.
 *
 * Counted against the players still holding cards rather than against the seat
 * count — somebody going out mid-round would otherwise leave the table waiting
 * forever for a pass from a person with nothing to pass with.
 */
function afterMove(state) {
  const live = inPlay(state);
  const stillIn = live.filter((s) => !state.passed.includes(s.seat));
  if (state.set && stillIn.length <= 1) {
    const leader = stillIn[0] ?? state.seats.find((s) => s.seat === state.set.by);
    state.discard.push(...state.pile);
    state.pile = [];
    state.set = null;
    state.passed = [];
    state.said = `Pile cleared — ${leader?.name ?? 'lead'} again.`;
    passTurn(state, leader && !leader.out ? leader.seat : nextSeat(state));
    return;
  }
  let to = nextSeat(state);
  // Skip anybody who has already passed this round.
  for (let i = 0; i < state.seats.length && state.passed.includes(to); i++) to = nextSeat(state, to);
  passTurn(state, to);
}

/** The lowest legal set, for somebody who is not there. */
function bestPlay(state, seat) {
  const byRank = new Map();
  for (const c of seat.hand) {
    if (!byRank.has(rankOf(c))) byRank.set(rankOf(c), []);
    byRank.get(rankOf(c)).push(c);
  }
  const want = state.set?.count ?? 1;
  const options = [...byRank.entries()]
    .filter(([rank, cards]) => cards.length >= want && (!state.set || power(rank) > power(state.set.rank)))
    .sort((a, b) => power(a[0]) - power(b[0]));
  return options.length ? options[0][1].slice(0, want) : null;
}

/** Who is President and who is Scum, from how the hand finished. */
function rankThem(state) {
  const order = finishOrder(state);
  state.ranks = {};
  if (order.length >= 2) {
    state.ranks[order[0]] = 'president';
    state.ranks[order[order.length - 1]] = 'scum';
  }
}

export default president;
