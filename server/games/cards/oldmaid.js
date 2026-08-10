// Old Maid.
//
// One queen comes out of the pack, so one queen has no partner. Everybody
// discards the pairs they were dealt, then takes turns drawing blind from the
// player on their left. Pairs go down as they form. Whoever is holding the odd
// queen when everything else has paired is the Old Maid.
//
// The single thing this game needs from an implementation is that a draw is
// genuinely blind. The card being taken must be chosen by *position* in a hand
// the taker cannot see, and that means the position has to be meaningful — so a
// hand is shuffled every time it is drawn from. Without that, the order is
// whatever order cards happened to arrive in, which is the order everybody
// watched them arrive in, and the whole game collapses: you would always know
// which card is the one they just picked up.

import {
  createCardGame, dealAll, shuffle, nextSeat, passTurn, inPlay, goOut, finishOrder,
  rankCounts, pullRank, rankOf, sayRank,
} from './kit.js';

export const oldmaid = createCardGame({
  id: 'oldmaid',
  name: 'Old Maid',
  tagline: 'One queen has no partner. Do not be holding her.',
  emoji: '👵',
  accent: '#9b59b6',
  face: 'oldmaid',
  minPlayers: 3,
  maxPlayers: 8,
  hands: 3,
  turnSeconds: 20,

  howToPlay: [
    'One queen is taken out of the pack, so one queen has no partner.',
    'Put down every pair you were dealt.',
    'On your turn, take a card at random from the player on your left. You cannot see their hand.',
    'Pairs go down the moment they form.',
    'Whoever is left holding the odd queen at the end is the Old Maid.',
  ],

  init(state) {
    state.pairs = {};
    state.finished = [];
    state.lastDraw = null;
    state.maid = null;
  },

  deal(state) {
    // The odd queen. Taken out before dealing so the count is genuinely odd.
    const drop = state.deck.findIndex((c) => c === 'Qs');
    if (drop >= 0) state.deck.splice(drop, 1);

    dealAll(state);
    state.pairs = Object.fromEntries(state.seats.map((s) => [s.seat, []]));
    state.finished = [];
    state.lastDraw = null;
    state.maid = null;
    for (const s of state.seats) layDownPairs(state, s);
    // Anybody dealt straight out of the game goes out before the first turn.
    for (const s of state.seats) if (!s.hand.length) goOut(state, s);
    state.turn = inPlay(state)[0]?.seat ?? 0;
    state.said = 'Draw from the player on your left.';
  },

  act(state, seat, action) {
    if (action.type !== 'draw') return;
    if (state.seats[state.turn]?.id !== seat.id || seat.out) return;

    const from = state.seats.find((s) => s.seat === nextSeat(state, seat.seat));
    if (!from || from.seat === seat.seat || !from.hand.length) { passTurn(state); return; }

    // Shuffled before the pick, so position carries no information. Without
    // this the cards sit in the order everybody watched them arrive in.
    from.hand = shuffle(from.hand);
    const at = Math.max(0, Math.min(from.hand.length - 1, Math.floor(Number(action.at) || 0)));
    const card = from.hand.splice(at, 1)[0];
    seat.hand.push(card);

    state.lastDraw = { by: seat.name, from: from.name, paired: false };
    const before = (state.pairs[seat.seat] ?? []).length;
    layDownPairs(state, seat);
    state.lastDraw.paired = (state.pairs[seat.seat] ?? []).length > before;
    state.said = state.lastDraw.paired
      ? `${seat.name} drew from ${from.name} and paired it.`
      : `${seat.name} drew from ${from.name}.`;

    for (const s of [seat, from]) if (!s.hand.length) goOut(state, s);
    passTurn(state);
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat || seat.out) return;
    state.log.push(`${seat.name} was away — drew anyway.`);
    oldmaid.__spec.act(state, seat, { type: 'draw', at: 0 });
  },

  handOver: (state) => inPlay(state).length <= 1,

  scoreHand(state) {
    const left = inPlay(state)[0];
    state.maid = left ? { seat: left.seat, name: left.name } : null;
    const order = finishOrder(state);
    order.forEach((seatNo, i) => {
      const s = state.seats.find((x) => x.seat === seatNo);
      if (!s) return;
      // Everybody who got out scores; the one holding her does not.
      if (left && s.seat === left.seat) return;
      s.score += Math.max(1, order.length - i);
      if (i === 0) s.won += 1;
    });
    state.said = left ? `${left.name} is the Old Maid.` : 'Everybody got out.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      pairs: state.seats.map((s) => ({
        seat: s.seat, name: s.name, count: (state.pairs[s.seat] ?? []).length,
      })),
      lastDraw: state.lastDraw,
      maid: state.maid,
      // Who you will be drawing from, so the table reads as a circle.
      drawFrom: nextSeat(state),
      finished: state.finished,
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    const from = state.seats.find((s) => s.seat === nextSeat(state, seat.seat));
    // How many cards are on offer — a count, never the cards.
    return { drawing: from ? { name: from.name, cards: from.hand.length } : null };
  },
});

/** Any two of a rank go down straight away. */
function layDownPairs(state, seat) {
  for (const [rank, n] of rankCounts(seat.hand)) {
    const pairs = Math.floor(n / 2);
    if (!pairs) continue;
    const all = pullRank(seat, rank);
    // Put back the odd one if there was one — three of a rank is one pair and
    // a spare, not one and a half.
    for (let i = pairs * 2; i < all.length; i++) seat.hand.push(all[i]);
    for (let i = 0; i < pairs; i++) (state.pairs[seat.seat] ??= []).push(rank);
    state.log.push(`${seat.name} puts down the ${sayRank(rank)}s.`);
  }
  void rankOf;
}

export default oldmaid;
