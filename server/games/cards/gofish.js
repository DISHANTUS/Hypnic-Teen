// Go Fish.
//
// Ask somebody for a rank. If they have any they hand over all of them and you
// go again; if they do not you take one off the deck and it is the next
// person's turn. Four of a kind is a book and goes down in front of you.
//
// The rule that makes it a game rather than a guessing exercise is that you may
// only ask for a rank you already hold. So every question tells the table
// something true about your hand, and a good player is mostly remembering what
// other people have asked for. That means the *asking* has to be public — who
// asked whom for what, kept where everyone can see it — while the hands stay
// private. Both halves matter: publish the hands and there is nothing to
// remember, hide the questions and there is nothing to remember either.

import {
  createCardGame, seatOf, inPlay, nextSeat, dealAround, passTurn,
  rankOf, sayRank, pullRank, rankCounts,
} from './kit.js';

export const gofish = createCardGame({
  id: 'gofish',
  name: 'Go Fish',
  tagline: 'Ask for what you already hold. Remember what everybody else asked for.',
  emoji: '🐟',
  accent: '#2980b9',
  face: 'gofish',
  minPlayers: 2,
  maxPlayers: 6,
  hands: 2,
  turnSeconds: 30,

  howToPlay: [
    'Ask one person for one rank — but only a rank you are already holding.',
    'If they have any, they hand over every one and you go again.',
    'If they do not, they say go fish and you take one off the deck.',
    'Four of a kind is a book. Put it down in front of you.',
    'Most books when the cards run out wins.',
  ],

  init(state) {
    /** Every question asked this hand, in order. The memory game lives here. */
    state.asks = [];
    state.books = {};
  },

  deal(state) {
    // Fewer players means longer hands, which is the traditional fix for a
    // two-hander being over in a minute.
    dealAround(state, state.seats.length <= 3 ? 7 : 5);
    state.asks = [];
    state.books = Object.fromEntries(state.seats.map((s) => [s.seat, []]));
    for (const s of state.seats) layDownBooks(state, s);
    state.turn = 0;
    state.said = 'Ask somebody for a rank you are holding.';
  },

  act(state, seat, action) {
    if (action.type !== 'ask') return;
    if (state.seats[state.turn]?.id !== seat.id) return;

    const target = state.seats.find((s) => s.seat === Number(action.of));
    const rank = String(action.rank ?? '');
    if (!target || target.seat === seat.seat || target.out) return;
    // Only what you hold. Checked here rather than trusted from the client,
    // because this one rule is the entire information game.
    if (!seat.hand.some((c) => rankOf(c) === rank)) return;

    const got = pullRank(target, rank);
    state.asks.push({
      by: seat.seat, byName: seat.name,
      of: target.seat, ofName: target.name,
      rank, got: got.length,
    });

    if (got.length) {
      seat.hand.push(...got);
      state.said = `${seat.name} took ${got.length} ${sayRank(rank)}${got.length === 1 ? '' : 's'} off ${target.name}.`;
      layDownBooks(state, seat);
      refill(state, target);
      // Asked right, ask again — but not if that emptied you.
      if (seat.hand.length) { state.turnLeft = state.settings.turnSeconds; state.dirty = true; return; }
      refill(state, seat);
      passTurn(state);
      return;
    }

    state.said = `${target.name} says go fish.`;
    if (state.deck.length) {
      const drawn = state.deck.pop();
      seat.hand.push(drawn);
      layDownBooks(state, seat);
      // Fishing the very card you asked for is the best thing that happens in
      // this game, and it deserves saying out loud.
      if (rankOf(drawn) === rank) {
        state.said = `${target.name} says go fish — and ${seat.name} fished it anyway.`;
        state.log.push(state.said);
      }
    }
    refill(state, seat);
    passTurn(state);
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat) return;
    // Ask somebody at random for something you actually hold, which is what the
    // rules allow and no worse than a distracted person would manage.
    const rank = seat.hand.length ? rankOf(seat.hand[Math.floor(Math.random() * seat.hand.length)]) : null;
    const others = inPlay(state).filter((s) => s.seat !== seat.seat && s.hand.length);
    if (!rank || !others.length) { passTurn(state); return; }
    const of = others[Math.floor(Math.random() * others.length)];
    state.log.push(`${seat.name} was away — asked anyway.`);
    gofish.onAction(state, { id: seat.id }, { type: 'ask', of: of.seat, rank });
  },

  handOver(state) {
    const booked = Object.values(state.books).reduce((sum, b) => sum + b.length, 0);
    return booked >= 13 || (state.deck.length === 0 && inPlay(state).every((s) => s.hand.length === 0));
  },

  scoreHand(state) {
    const counts = state.seats.map((s) => (state.books[s.seat] ?? []).length);
    const best = Math.max(0, ...counts);
    for (const s of state.seats) {
      const mine = (state.books[s.seat] ?? []).length;
      s.score += mine;
      if (mine === best && best > 0) s.won += 1;
    }
    const winners = state.seats.filter((s) => (state.books[s.seat] ?? []).length === best && best > 0);
    state.said = winners.length
      ? `${winners.map((s) => s.name).join(' and ')} with ${best} book${best === 1 ? '' : 's'}.`
      : 'No books at all.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      // Public on purpose: remembering these is most of the skill.
      asks: state.asks.slice(-8),
      books: state.seats.map((s) => ({
        seat: s.seat, name: s.name, ranks: state.books[s.seat] ?? [],
      })),
    };
  },

  mine(state, seat) {
    if (!seat) return { canAsk: [] };
    // The ranks you are allowed to ask for, worked out here so the client can
    // simply draw them rather than reimplement the rule and get it wrong.
    return { canAsk: [...rankCounts(seat.hand).keys()] };
  },
});

/** Any four of a kind goes down in front of you, immediately. */
function layDownBooks(state, seat) {
  for (const [rank, n] of rankCounts(seat.hand)) {
    if (n < 4) continue;
    pullRank(seat, rank);
    (state.books[seat.seat] ??= []).push(rank);
    state.log.push(`${seat.name} books the ${sayRank(rank)}s.`);
  }
}

/**
 * A hand that has run dry gets topped up while there is a deck.
 *
 * Without this, emptying your hand puts you out of the game with cards still on
 * the table — you can no longer ask for anything, because you can only ask for
 * what you hold.
 */
function refill(state, seat) {
  while (!seat.hand.length && state.deck.length) {
    seat.hand.push(state.deck.pop());
    layDownBooks(state, seat);
  }
}

export default gofish;
