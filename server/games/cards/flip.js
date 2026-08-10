// The flip-and-react games: Snap, Slapjack, and War.
//
// Cards turn over onto the middle on the server's clock. Nobody turns them,
// which is the whole reason a multiplayer version of these is fair — nobody
// sees a card a frame before anybody else, and every screen learns about it
// from the same broadcast.
//
// The winner of a race is decided by when the *server* heard the shout, never
// by anything the client claims about its own timing. A client-supplied "I
// pressed at 1.2s" is worth exactly as much as the honesty of whoever edited
// it. That does put the player on the worst connection at a real disadvantage,
// which is also true of the physical game, where it is called sitting further
// from the table.
//
// Snap and Slapjack differ by one predicate — is this pair a match, is this
// card a jack — so they are one factory rather than two files that would drift.
// War is here too because it is the same shape with the reaction taken out: the
// cards decide it themselves, and the only thing a player does is watch.

import {
  createCardGame, inPlay, freshDeck, shuffle, rankOf, sayCard, goOut, finishOrder, RANKS,
} from './kit.js';

/** How long a live moment stays winnable before it passes. */
const WINDOW = 2.2;

/**
 * @param {object} spec
 * @param {(card, under) => boolean} spec.trigger  what makes the moment live
 * @param {string} spec.cue                        what to shout
 */
function createFlipGame(spec) {
  return createCardGame({
    id: spec.id,
    name: spec.name,
    tagline: spec.tagline,
    emoji: spec.emoji,
    accent: spec.accent,
    face: 'snap',
    minPlayers: 2,
    maxPlayers: 10,
    hands: 1,
    turnSeconds: 0,
    howToPlay: spec.howToPlay,

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
      // The deck is the middle and a hand is what you have won, which is the
      // reverse of every other table in this room.
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
        // Wrong. A card to everybody else, out of whatever you have won.
        const others = inPlay(state).filter((s) => s.seat !== seat.seat);
        let paid = 0;
        for (const other of others) {
          if (!seat.hand.length) break;
          other.hand.push(seat.hand.pop());
          paid += 1;
        }
        state.wrong = [...state.wrong.slice(-3), { name: seat.name, paid }];
        state.said = paid
          ? `${seat.name} went at nothing — ${paid} away.`
          : `${seat.name} went at nothing, and had nothing to pay.`;
        state.dirty = true;
        return;
      }

      // Right, and first. The window shuts on the same tick, so a second shout
      // a millisecond later finds nothing left to win.
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
          // Nobody saw it. The moment stands but is no longer worth anything,
          // which is what stops a slow table turning on one lucky glance.
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
      state.matching = spec.trigger(card, state.under);
      state.window = state.matching ? WINDOW : 0;
      state.tookPile = null;
      if (state.matching) state.said = spec.cue;
      state.dirty = true;
    },

    // Over when the deck is out and the last window has shut, so a live moment
    // on the very last card is still winnable.
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
        // Public the moment it is flipped — everybody is meant to see it.
        faceUp: state.face,
        faceSaid: state.face ? sayCard(state.face) : '',
        under: state.under,
        matching: state.matching,
        cue: spec.cue,
        window: Math.max(0, Math.round(state.window * 10) / 10),
        pileSize: state.pile.length,
        // Named for what it is rather than "taken", which Hearts uses on its
        // own state to mean the cards a seat has won.
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
}

export const snap = createFlipGame({
  id: 'snap',
  name: 'Snap',
  tagline: 'Two the same and the first hand down takes the lot.',
  emoji: '👋',
  accent: '#e67e22',
  cue: 'Now!',
  trigger: (card, under) => Boolean(under) && rankOf(under) === rankOf(card),
  howToPlay: [
    'Cards turn over onto the middle by themselves. Watch them.',
    'When the new card matches the one under it, hit SNAP.',
    'The fastest hand takes the whole pile.',
    'Snap when they do not match and you pay a card to everyone else.',
    'Whoever has the most cards when the deck runs out wins.',
  ],
});

export const slapjack = createFlipGame({
  id: 'slapjack',
  name: 'Slapjack',
  tagline: 'Nothing matters but the jacks. Get there first.',
  emoji: '🖐️',
  accent: '#c0392b',
  cue: 'Jack!',
  // The one difference between this and Snap, which is why they share a body.
  trigger: (card) => rankOf(card) === 'J',
  howToPlay: [
    'Cards turn over onto the middle by themselves.',
    'The instant a jack lands, slap it.',
    'The fastest hand takes the whole pile.',
    'Slap anything that is not a jack and you pay a card to everyone else.',
    'Most cards when the deck runs out wins.',
  ],
});

/* ----------------------------------- War ---------------------------------- */

/** How long each battle sits on screen before the next one. */
const BEAT = 2.6;
const high = (card) => RANKS.indexOf(rankOf(card));

/**
 * War.
 *
 * The only game in the room with no decision in it at all — you cannot play it
 * badly and you cannot play it well. That is not a reason to leave it out: what
 * it has instead is somebody down to three cards drawing an ace, and a room
 * that has stopped talking about anything else. So it is built as something to
 * watch rather than something to do, and the tension is in the pacing.
 */
export const war = createCardGame({
  id: 'war',
  name: 'War',
  tagline: 'Highest card takes them. Nothing to decide and nowhere to hide.',
  emoji: '⚔️',
  accent: '#7f8c8d',
  face: 'war',
  minPlayers: 2,
  maxPlayers: 6,
  hands: 1,
  turnSeconds: 0,

  howToPlay: [
    'The pack is split between you. Everybody turns one card at a time.',
    'Highest card takes every card on the table.',
    'A tie is war — three cards face down each, then one more to settle it.',
    'Run out of cards and you are out.',
    'There is nothing to decide. That is the game.',
  ],

  init(state) {
    state.battle = [];
    state.spoils = [];
    state.since = 0;
    state.warDepth = 0;
    state.finished = [];
    state.lastBattle = null;
  },

  deal(state) {
    const deck = shuffle(freshDeck());
    let at = 0;
    for (const s of state.seats) s.hand = [];
    while (deck.length) {
      state.seats[at % state.seats.length].hand.push(deck.pop());
      at += 1;
    }
    state.deck = [];
    state.battle = [];
    state.spoils = [];
    state.since = 0;
    state.warDepth = 0;
    state.finished = [];
    state.lastBattle = null;
    state.said = 'Turn them over.';
  },

  act() { /* nothing to do, on purpose */ },

  tick(state, dt) {
    state.since += dt;
    if (state.since < BEAT) return;
    state.since = 0;

    const live = inPlay(state).filter((s) => s.hand.length);
    for (const s of inPlay(state)) {
      if (!s.hand.length) goOut(state, s);
    }
    if (live.length <= 1) { state.dirty = true; return; }

    // Everybody turns one over.
    state.battle = live.map((s) => ({ seat: s.seat, name: s.name, card: s.hand.pop() }));
    state.spoils.push(...state.battle.map((b) => b.card));

    const best = Math.max(...state.battle.map((b) => high(b.card)));
    const tied = state.battle.filter((b) => high(b.card) === best);

    if (tied.length > 1) {
      // War. Three face down each from whoever tied, then round again.
      state.warDepth += 1;
      for (const t of tied) {
        const s = state.seats.find((x) => x.seat === t.seat);
        for (let i = 0; i < 3 && s.hand.length > 1; i++) state.spoils.push(s.hand.pop());
      }
      state.said = `War! ${tied.map((t) => t.name).join(' and ')} are level on ${rankOf(tied[0].card)}.`;
      state.log.push(state.said);
      state.dirty = true;
      return;
    }

    const winner = state.seats.find((s) => s.seat === tied[0].seat);
    // Won cards go to the bottom, shuffled, so the same run cannot repeat.
    winner.hand.unshift(...shuffle(state.spoils));
    state.lastBattle = {
      cards: state.battle,
      winner: winner.name,
      taken: state.spoils.length,
      war: state.warDepth > 0,
    };
    state.said = state.warDepth
      ? `${winner.name} wins the war and takes ${state.spoils.length}.`
      : `${winner.name} takes ${state.spoils.length}.`;
    if (state.warDepth) state.log.push(state.said);
    state.spoils = [];
    state.warDepth = 0;
    state.dirty = true;
  },

  handOver: (state) => inPlay(state).filter((s) => s.hand.length).length <= 1,

  scoreHand(state) {
    // Whoever holds the most cards at the end. Going out early is the loss.
    const ranked = [...state.seats].sort((a, b) => b.hand.length - a.hand.length);
    ranked.forEach((s, i) => {
      s.score += Math.max(0, ranked.length - i - 1) * 2;
      if (i === 0 && s.hand.length) { s.score += 4; s.won += 1; }
    });
    state.said = ranked[0]?.hand.length
      ? `${ranked[0].name} ends with ${ranked[0].hand.length}.`
      : 'Everybody ran out at once.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      battle: state.battle,
      spoils: state.spoils.length,
      warDepth: state.warDepth,
      lastBattle: state.lastBattle,
      nextIn: Math.max(0, Math.round((BEAT - state.since) * 10) / 10),
      finished: state.finished,
    };
  },

  mine(state, seat) {
    return { left: seat?.hand.length ?? 0 };
  },

  rank: (a, b) => b.score - a.score,
});

export default snap;
