// Spoons.
//
// Four cards each. Cards flow round the circle continuously — you take from the
// person on your right and pass one to the person on your left, as fast or as
// slowly as you like. Get four of a kind and grab a spoon. The moment the first
// one goes, everybody grabs, and there is one spoon fewer than there are people.
// Whoever is left empty-handed is out, a spoon is taken away, and it goes again.
//
// The reason this works online at all is that the grabbing is the part that
// needs to be fair, and grabbing is exactly the part a server can arbitrate
// perfectly: spoons are handed out in the order the requests arrive and the
// last one is refused. The passing does not need to be fair — it is meant to be
// a scramble.
//
// The cruel, correct rule is that you do not have to have four of a kind to
// grab. Once anybody has taken one, the table is on, and somebody who was not
// watching loses to somebody who was. Enforcing "only with four of a kind"
// would remove the entire second half of the game.

import { createCardGame, shuffle, freshDeck, inPlay, goOut, rankCounts, sayRank } from './kit.js';

export const spoons = createCardGame({
  id: 'spoons',
  name: 'Spoons',
  tagline: 'Four of a kind and grab. Once one goes, everybody goes.',
  emoji: '🥄',
  accent: '#f39c12',
  face: 'spoons',
  minPlayers: 3,
  maxPlayers: 8,
  // One hand is one full elimination round down to a winner.
  hands: 1,
  turnSeconds: 0,

  howToPlay: [
    'Four cards each. Take from your right, pass one to your left, as fast as you like.',
    'Four of a kind? Grab a spoon.',
    'The moment anybody grabs, everybody grabs — and there is one spoon fewer than there are people.',
    'You do not need four of a kind to grab. You need to be watching.',
    'Last one without a spoon is out. Then it goes again with one spoon fewer.',
  ],

  init(state) {
    state.spoons = 0;
    state.grabbed = [];        // seat numbers, in the order they arrived
    state.grabbing = false;
    state.incoming = {};       // seat -> cards waiting to be picked up
    state.round = 0;
    state.knockedOut = null;
  },

  deal(state) {
    startRound(state, inPlay(state));
    state.said = 'Pass to your left. Four of a kind and grab.';
  },

  act(state, seat, action) {
    if (seat.out) return;

    if (action.type === 'grab') {
      // Not gated on having four of a kind. Once the table is on, being fast
      // is the whole skill — and the first grab is what turns it on.
      if (!state.grabbing) {
        const four = [...rankCounts(seat.hand).values()].some((n) => n >= 4);
        if (!four) return;
        state.grabbing = true;
        state.said = `${seat.name} grabs! Everybody go!`;
        state.log.push(state.said);
      }
      if (state.grabbed.includes(seat.seat)) return;
      if (state.grabbed.length >= state.spoons) return;   // they are all gone
      state.grabbed.push(seat.seat);
      state.dirty = true;
      if (state.grabbed.length >= state.spoons) settle(state);
      return;
    }

    if (action.type !== 'pass') return;
    const card = String(action.card ?? '');
    if (!seat.hand.includes(card)) return;
    // Only ever pass down to four. Passing while short would empty a hand.
    if (seat.hand.length <= 4) return;

    seat.hand.splice(seat.hand.indexOf(card), 1);
    const left = leftOf(state, seat);
    if (left) (state.incoming[left.seat] ??= []).push(card);
    else state.pile.push(card);   // the last seat passes out of the game
    state.dirty = true;
  },

  tick(state) {
    if (state.grabbing) return;
    // Deliver whatever is waiting. Doing it on the tick rather than on the pass
    // means a hand never grows past five, so there is always exactly one card
    // to decide about.
    for (const s of inPlay(state)) {
      const queue = state.incoming[s.seat];
      if (!queue?.length) continue;
      if (s.hand.length > 4) continue;
      s.hand.push(queue.shift());
      state.dirty = true;
    }
    // Keep the circle fed from the deck.
    const first = inPlay(state)[0];
    if (first && first.hand.length <= 4 && state.deck.length) {
      first.hand.push(state.deck.pop());
      state.dirty = true;
    }
  },

  handOver: (state) => inPlay(state).length <= 1,

  scoreHand(state) {
    const left = inPlay(state)[0];
    for (const s of state.seats) {
      // Everybody scores by how long they lasted, which is recorded as they go.
      s.score += s.lasted ?? 0;
    }
    if (left) { left.score += 5; left.won += 1; }
    state.said = left ? `${left.name} is the last one standing.` : 'Everybody went at once.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      spoons: state.spoons,
      grabbed: state.grabbed.map((seatNo) => ({
        seat: seatNo, name: state.seats.find((s) => s.seat === seatNo)?.name ?? '',
      })),
      grabbing: state.grabbing,
      round: state.round,
      knockedOut: state.knockedOut,
      // Counts only. What is coming round is the thing you are not supposed to
      // know until it arrives.
      waiting: state.seats.map((s) => ({
        seat: s.seat, incoming: (state.incoming[s.seat] ?? []).length,
      })),
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    const counts = [...rankCounts(seat.hand).entries()].sort((a, b) => b[1] - a[1]);
    return {
      // Said outright, because in the real game it is the thing you can see at
      // a glance and here it is four codes in a row on a small screen.
      best: counts[0] ? { rank: counts[0][0], say: sayRank(counts[0][0]), of: counts[0][1] } : null,
      hasFour: Boolean(counts[0] && counts[0][1] >= 4),
      gotSpoon: state.grabbed.includes(seat.seat),
    };
  },

  rank: (a, b) => b.score - a.score,
});

const leftOf = (state, seat) => {
  const live = inPlay(state);
  if (live.length < 2) return null;
  const at = live.findIndex((s) => s.seat === seat.seat);
  return live[(at + 1) % live.length];
};

/** Deal a fresh round for whoever is left, with one spoon fewer than that. */
function startRound(state, players) {
  state.round += 1;
  state.deck = shuffle(freshDeck());
  state.pile = [];
  state.incoming = {};
  state.grabbed = [];
  state.grabbing = false;
  state.knockedOut = null;
  state.spoons = Math.max(1, players.length - 1);
  for (const s of players) {
    s.hand = state.deck.splice(0, 4);
    state.incoming[s.seat] = [];
  }
  // The first player is dealt the extra card that starts everything moving.
  if (players[0] && state.deck.length) players[0].hand.push(state.deck.pop());
}

/** All the spoons are gone. Whoever missed out is out. */
function settle(state) {
  const live = inPlay(state);
  const missed = live.filter((s) => !state.grabbed.includes(s.seat));
  for (const s of missed) {
    s.lasted = live.length;
    goOut(state, s);
  }
  state.knockedOut = missed.map((s) => s.name);
  state.said = missed.length
    ? `${missed.map((s) => s.name).join(' and ')} missed out.`
    : 'Everybody got one.';
  state.log.push(state.said);

  const left = inPlay(state);
  for (const s of left) s.lasted = Math.max(s.lasted ?? 0, live.length);
  if (left.length > 1) startRound(state, left);
  state.dirty = true;
}

export default spoons;
