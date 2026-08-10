// Snap.
//
// Cards turn over onto one pile on their own. When two in a row match, the
// first person to hit the button takes the pile. Hit it when they do not match
// and you pay a card to everybody.
//
// This is the only shape in the card room with no turns in it, and it is where
// a multiplayer version is either fair or worthless. Two things make it fair.
//
// The flip is on the server's clock, not on anybody's. Nobody turns the card
// over, so nobody sees it a frame early, and everybody's screen learns about it
// from the same broadcast.
//
// And the winner is decided by when the *server* heard the shout, not by any
// timestamp the client sends. A client-supplied "I pressed at 1.2s" would be
// worth exactly as much as the honesty of whoever edited it. That does mean the
// player on the worst connection is at a real disadvantage — which is true of
// the physical game too, where it is called sitting further from the table.

import { createCardGame, inPlay, freshDeck, shuffle, rankOf, sayCard } from './kit.js';

/** How long a matching pair stays snappable before the moment passes. */
const WINDOW = 2.2;

export const snap = createCardGame({
  id: 'snap',
  name: 'Snap',
  tagline: 'Two the same and the first hand down takes the lot.',
  emoji: '👋',
  accent: '#e67e22',
  face: 'snap',
  minPlayers: 2,
  maxPlayers: 10,
  hands: 1,
  // No turns, so no turn clock.
  turnSeconds: 0,

  howToPlay: [
    'Cards turn over onto the middle by themselves. Watch them.',
    'When the new card matches the one under it, hit SNAP.',
    'The fastest hand takes the whole pile.',
    'Snap when they do not match and you pay a card to everyone else.',
    'Whoever has the most cards when the deck runs out wins.',
  ],

  options: {
    flipSeconds: {
      label: 'Seconds between cards', kind: 'number',
      min: 0.6, max: 4, hardMax: 8, step: 0.2, default: 1.5,
    },
  },
  settings: (s) => ({
    flipSeconds: Math.max(0.6, Math.min(8, Number(s.flipSeconds) || 1.5)),
  }),

  init(state) {
    state.face = null;
    state.under = null;
    state.matching = false;
    state.sinceFlip = 0;
    state.window = 0;
    state.tookPile = null;
    state.wrong = [];
  },

  deal(state) {
    // One pack, dealt nowhere: in this game the deck is the middle and the
    // hands are what you have won, which is the reverse of every other table
    // in this room.
    state.deck = shuffle(freshDeck());
    for (const s of state.seats) s.hand = [];
    state.pile = [];
    state.face = null;
    state.under = null;
    state.matching = false;
    state.sinceFlip = 0;
    state.window = 0;
    state.tookPile = null;
    state.wrong = [];
    state.said = 'Watch the middle.';
  },

  act(state, seat, action) {
    if (action.type !== 'snap' || seat.out) return;

    if (!state.matching || state.window <= 0) {
      // Wrong. A card to everybody else, from whatever you have won so far.
      const others = inPlay(state).filter((s) => s.seat !== seat.seat);
      let paid = 0;
      for (const other of others) {
        if (!seat.hand.length) break;
        other.hand.push(seat.hand.pop());
        paid += 1;
      }
      state.wrong = [...state.wrong.slice(-3), { name: seat.name, paid }];
      state.said = paid
        ? `${seat.name} snapped at nothing — ${paid} away.`
        : `${seat.name} snapped at nothing, and had nothing to pay.`;
      state.dirty = true;
      return;
    }

    // Right, and first. The window shuts on the same tick so a second shout
    // arriving a millisecond later finds nothing to win.
    const won = state.pile.length;
    seat.hand.push(...state.pile);
    state.pile = [];
    state.matching = false;
    state.window = 0;
    state.under = null;
    state.face = null;
    state.tookPile = { name: seat.name, cards: won };
    state.said = `${seat.name} takes ${won}.`;
    state.log.push(state.said);
    state.dirty = true;
  },

  tick(state, dt) {
    if (state.window > 0) {
      state.window -= dt;
      if (state.window <= 0) {
        // Nobody saw it. The pair stands but is no longer worth anything, which
        // is what stops a slow table being decided by one lucky glance.
        state.matching = false;
        state.said = 'Missed it.';
        state.dirty = true;
      }
      return;
    }

    state.sinceFlip += dt;
    if (state.sinceFlip < state.settings.flipSeconds) return;
    state.sinceFlip = 0;

    if (!state.deck.length) return;
    const card = state.deck.pop();
    state.under = state.face;
    state.face = card;
    state.pile.push(card);
    state.matching = Boolean(state.under) && rankOf(state.under) === rankOf(card);
    state.window = state.matching ? WINDOW : 0;
    state.tookPile = null;
    if (state.matching) state.said = 'Now!';
    state.dirty = true;
  },

  // Over when the deck is out and the last window has closed, so a pair on the
  // very last card is still winnable.
  handOver: (state) => state.deck.length === 0 && state.window <= 0 && !state.matching,

  scoreHand(state) {
    const best = Math.max(...state.seats.map((s) => s.hand.length));
    for (const s of state.seats) {
      s.score += s.hand.length;
      if (s.hand.length === best && best > 0) s.won += 1;
    }
    const winners = state.seats.filter((s) => s.hand.length === best && best > 0);
    state.said = winners.length
      ? `${winners.map((s) => s.name).join(' and ')} finished with ${best}.`
      : 'Nobody took a single pile.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      // The card on top is public the moment it is flipped — everybody is
      // meant to see it, that is the game.
      faceUp: state.face,
      faceSaid: state.face ? sayCard(state.face) : '',
      under: state.under,
      matching: state.matching,
      window: Math.max(0, Math.round(state.window * 10) / 10),
      pileSize: state.pile.length,
      // Named for what it is rather than "taken", which Hearts already uses on
      // its own state to mean the cards a seat has won. Two games sharing one
      // key for two different things had the census counting a player's name
      // as two cards, and the client firing a win noise for a shape it could
      // not read.
      tookPile: state.tookPile,
      wrong: state.wrong,
      flipSeconds: state.settings.flipSeconds,
    };
  },

  mine(state, seat) {
    return { pile: seat?.hand.length ?? 0 };
  },

  rank: (a, b) => b.score - a.score,
});

export default snap;
