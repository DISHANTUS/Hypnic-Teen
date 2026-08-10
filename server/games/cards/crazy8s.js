// Crazy Eights, and Switch.
//
// Two games with one body. In both you match the top card by rank or by suit,
// and in both an eight is wild and lets you name the suit. Switch is the same
// game with teeth: twos make the next player pick up two, jacks skip them,
// queens turn the play around, and a pick-up can be passed on if you have a two
// of your own.
//
// They share a file because keeping them apart would mean maintaining the
// matching rule, the wild rule, the draw-and-reshuffle and the going-out rule
// twice, and the only real difference is a table of what special cards do.
//
// The rule worth being careful about is the reshuffle. When the deck runs out
// the discard pile comes back — but not the card on top of it, which is the
// card everybody is playing against. Sweep that into the deck and the game
// carries on looking completely normal while the thing being matched is now in
// somebody's hand.

import {
  createCardGame, dealAround, drawCards, goOut, finishOrder, nextSeat, passTurn, inPlay,
  rankOf, suitOf, sayCard, SUITS,
} from './kit.js';

/** What each special card does. Empty for Crazy Eights, which has none. */
const SWITCH_POWERS = { 2: 'draw2', J: 'skip', Q: 'reverse' };

const WILD = '8';

/** Everything the rules allow, in one place, for both games. */
function playable(state, card, powers) {
  const top = state.pile[state.pile.length - 1];
  if (!top) return true;
  if (state.pending > 0) {
    // Only another pick-up card passes it on. Everything else has to eat it.
    return powers[rankOf(card)] === 'draw2';
  }
  if (rankOf(card) === WILD) return true;
  return suitOf(card) === state.suit || rankOf(card) === rankOf(top);
}

function takeThePenalty(state, seat) {
  const owed = state.pending;
  drawCards(state, seat, owed);
  state.pending = 0;
  state.said = `${seat.name} picks up ${owed}.`;
  state.log.push(state.said);
  endTurn(state);
}

/** Hand on, skipping `skip` further seats. */
function endTurn(state, skip = 0) {
  state.drewThisTurn = false;
  let to = nextSeat(state);
  for (let i = 0; i < skip; i++) to = nextSeat(state, to);
  passTurn(state, to);
}

/**
 * A move, for either game.
 *
 * A plain function rather than a method on the spec so that the timeout can
 * call it too. The first version reached for it as `this.act`, which happened
 * to work only because the kit invokes the hook as a method — a dependency on
 * call syntax that would break the moment anything destructured the spec.
 */
function doAct(state, seat, action, powers) {
  if (state.seats[state.turn]?.id !== seat.id || seat.out) return;

  if (action.type === 'draw') {
    // One draw a turn, then you may play it or pass. Unlimited drawing would
    // let somebody empty the deck looking for a card.
    if (state.drewThisTurn) return;
    if (state.pending > 0) return takeThePenalty(state, seat);
    const got = drawCards(state, seat, 1);
    state.drewThisTurn = true;
    state.said = got.length ? `${seat.name} draws.` : 'Nothing left to draw.';
    if (!got.length) endTurn(state);
    state.dirty = true;
    return;
  }

  if (action.type === 'pass') {
    if (state.pending > 0) return takeThePenalty(state, seat);
    // Passing without drawing first is only allowed when there is nothing left
    // to draw — otherwise it is a way to skip your turn for free.
    if (!state.drewThisTurn && state.deck.length + state.pile.length > 1) return;
    state.said = `${seat.name} passes.`;
    endTurn(state);
    return;
  }

  if (action.type !== 'play') return;
  const card = String(action.card ?? '');
  if (!seat.hand.includes(card)) return;
  if (!playable(state, card, powers)) return;

  seat.hand.splice(seat.hand.indexOf(card), 1);
  state.pile.push(card);
  state.said = `${seat.name} plays the ${sayCard(card)}.`;

  if (rankOf(card) === WILD) {
    // Named suit, or the card's own if they said nothing sensible.
    state.suit = SUITS.includes(action.suit) ? action.suit : suitOf(card);
    state.said += ` Suit is now ${state.suit}.`;
  } else {
    state.suit = suitOf(card);
  }

  const power = powers[rankOf(card)];
  if (power === 'draw2') state.pending += 2;

  if (!seat.hand.length) {
    goOut(state, seat);
    if (inPlay(state).length <= 1) { state.dirty = true; return; }
  }

  if (power === 'reverse') {
    // Two-handed, a reverse is a skip — there is nobody else to turn towards,
    // so turning round would hand the turn straight back to the same player.
    if (inPlay(state).length === 2) { endTurn(state, 1); return; }
    state.direction = state.direction === 1 ? -1 : 1;
  }
  endTurn(state, power === 'skip' ? 1 : 0);
}

function build({ id, name, tagline, emoji, accent, powers, howToPlay }) {
  return createCardGame({
    id, name, tagline, emoji, accent,
    face: 'crazy8s',
    minPlayers: 2,
    maxPlayers: 8,
    hands: 3,
    turnSeconds: 25,
    howToPlay,

    init(state) {
      state.suit = null;
      state.pending = 0;   // cards owed by the next player, Switch only
      state.finished = [];
      state.drewThisTurn = false;
    },

    deal(state) {
      dealAround(state, state.seats.length > 5 ? 5 : 7);
      state.finished = [];
      state.pending = 0;
      state.drewThisTurn = false;
      // Turn one over to start, but never a wild — a game that opens on an
      // eight has no suit to match and the first player could play anything.
      let first = state.deck.pop();
      let guard = 0;
      while (rankOf(first) === WILD && guard++ < 60) {
        state.deck.unshift(first);
        first = state.deck.pop();
      }
      state.pile = [first];
      state.suit = suitOf(first);
      state.turn = 0;
      state.said = `Match the ${sayCard(first)}.`;
    },

    act: (state, seat, action) => doAct(state, seat, action, powers),

    timedOut(state) {
      const seat = state.seats[state.turn];
      if (!seat || seat.out) return;
      if (state.pending > 0) return takeThePenalty(state, seat);
      const can = seat.hand.find((c) => playable(state, c, powers));
      if (can) {
        state.log.push(`${seat.name} was away — played on.`);
        doAct(state, seat, { type: 'play', card: can, suit: suitOf(can) }, powers);
        return;
      }
      drawCards(state, seat, 1);
      state.log.push(`${seat.name} was away — drew.`);
      endTurn(state);
    },

    handOver: (state) => inPlay(state).length <= 1,

    scoreHand(state) {
      // Points by finishing order, so coming second still beats coming last.
      const order = finishOrder(state);
      order.forEach((seatNo, i) => {
        const s = state.seats.find((x) => x.seat === seatNo);
        if (!s) return;
        s.score += Math.max(0, order.length - i - 1) * 2;
        if (i === 0) { s.score += 3; s.won += 1; }
      });
      const first = state.seats.find((x) => x.seat === order[0]);
      state.said = first ? `${first.name} went out first.` : 'Nobody went out.';
      state.log.push(state.said);
    },

    table(state) {
      return {
        top: state.pile[state.pile.length - 1] ?? null,
        suit: state.suit,
        pending: state.pending,
        wild: WILD,
        powers,
        finished: state.finished,
        drewThisTurn: state.drewThisTurn,
      };
    },

    mine(state, seat) {
      if (!seat) return { playable: [] };
      // Under a pending pick-up the only legal card is one that passes it on.
      return { playable: seat.hand.filter((c) => playable(state, c, powers)) };
    },
  });
}

export const crazy8s = build({
  id: 'crazy8s',
  name: 'Crazy Eights',
  tagline: 'Match the suit or the number. Eights are wild.',
  emoji: '🎱',
  accent: '#16a085',
  powers: {},
  howToPlay: [
    'Play a card that matches the top of the pile by suit or by number.',
    'An eight is wild — play one and say which suit everybody is on now.',
    'Nothing to play? Draw one. If it still will not go, pass.',
    'First to get rid of every card wins the hand.',
  ],
});

export const switchGame = build({
  id: 'switch',
  name: 'Switch',
  tagline: 'Crazy Eights with teeth. Twos bite, jacks skip, queens turn it round.',
  emoji: '🔀',
  accent: '#d35400',
  powers: SWITCH_POWERS,
  howToPlay: [
    'Match the top card by suit or by number. Eights are wild.',
    'A two makes the next player pick up two — unless they have a two of their own to pass it on with.',
    'A jack skips the next player. A queen turns the play around.',
    'Nothing to play? Draw one, then pass if it still will not go.',
    'First to get rid of every card wins the hand.',
  ],
});

export default crazy8s;
