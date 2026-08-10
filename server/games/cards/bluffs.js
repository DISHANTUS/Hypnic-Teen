// Liar's Deck and Skull.
//
// Two bluffing games, and neither uses a normal pack — which is the point. In
// both, the deck is tiny and everybody knows exactly what is in it, so there is
// nothing to deduce and nowhere to hide except in what you are willing to claim.
//
// Skull is the older idea and the better one: you place a card face down, and
// the only way to win is to announce you can turn over a number of cards
// without hitting a skull — starting with your own. Everybody else may bid
// higher or pass, and the winner has to actually do it. The whole game is that
// your own pile is the first thing you have to turn over, so a bluffer is
// always the person most likely to be caught by their own card.
//
// Both are rebuilt here rather than reproduced: the mechanics are nobody's
// property, but the names, the artwork and the card text of the published
// versions are, so these use their own small decks and their own wording.

import { createCardGame, seatOf, inPlay, nextSeat, passTurn, goOut, finishOrder } from './kit.js';

/* ------------------------------ Liar's Deck ------------------------------- */

/**
 * A deck of twenty: six each of three ranks, plus two wild.
 *
 * Small on purpose. Everybody can hold the whole deck in their head, so a claim
 * of "three kings" when nine kings have already been played is a claim anybody
 * at the table can catch — the information is public and the only skill is
 * nerve.
 */
const LIAR_RANKS = ['K', 'Q', 'A'];
const liarDeck = () => {
  const cards = [];
  for (const rank of LIAR_RANKS) for (let i = 0; i < 6; i++) cards.push(`${rank}${i}`);
  cards.push('W0', 'W1');
  return cards;
};
const liarRank = (card) => card[0];

export const liarsdeck = createCardGame({
  id: 'liarsdeck',
  name: "Liar's Deck",
  tagline: 'Twenty cards, one table rank, and no room to hide.',
  emoji: '🎭',
  accent: '#c0392b',
  face: 'liars',
  minPlayers: 3,
  maxPlayers: 6,
  hands: 3,
  turnSeconds: 22,

  howToPlay: [
    'Twenty cards: six kings, six queens, six aces and two wild. Everybody knows exactly what is in the deck.',
    'One rank is called for the whole round. Put down one to three cards face down and say they are that rank.',
    'Anybody can call a liar. The cards get turned over.',
    'Whoever was wrong is out of the round — the liar if they lied, the caller if they did not.',
    'Wild cards count as anything, and there are only two of them.',
  ],

  init(state) {
    state.rank = 'K';
    state.claim = null;
    state.callWindow = 0;
    state.reveal = null;
    state.finished = [];
  },

  deal(state) {
    const deck = liarDeck().sort(() => Math.random() - 0.5);
    for (const s of state.seats) { s.hand = []; s.out = false; }
    let at = 0;
    while (deck.length && at < state.seats.length * 5) {
      state.seats[at % state.seats.length].hand.push(deck.pop());
      at += 1;
    }
    state.deck = deck;
    state.pile = [];
    state.rank = LIAR_RANKS[Math.floor(Math.random() * LIAR_RANKS.length)];
    state.claim = null;
    state.callWindow = 0;
    state.reveal = null;
    state.finished = [];
    state.turn = 0;
    state.said = `The table is on ${state.rank}.`;
  },

  act(state, seat, action) {
    if (action.type === 'play') {
      if (state.claim || seat.out) return;
      if (state.seats[state.turn]?.id !== seat.id) return;
      const cards = Array.isArray(action.cards) ? [...new Set(action.cards)] : [];
      if (!cards.length || cards.length > 3) return;
      if (!cards.every((c) => seat.hand.includes(c))) return;
      for (const c of cards) seat.hand.splice(seat.hand.indexOf(c), 1);
      state.claim = { by: seat.seat, byName: seat.name, count: cards.length, cards, rank: state.rank };
      state.callWindow = 6;
      state.turnLeft = 0;
      state.said = `${seat.name} says ${cards.length} × ${state.rank}.`;
      state.dirty = true;
      return;
    }

    if (action.type === 'call') {
      if (!state.claim || state.claim.by === seat.seat || seat.out) return;
      settleLiar(state, seat);
    }
  },

  tick(state, dt) {
    if (state.callWindow <= 0) return;
    state.callWindow -= dt;
    if (state.callWindow <= 0) settleLiar(state, null);
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat || seat.out || state.claim) return;
    if (!seat.hand.length) { passTurn(state); return; }
    liarsdeck.__spec.act(state, seat, { type: 'play', cards: [seat.hand[0]] });
  },

  handOver: (state) => inPlay(state).length <= 1,

  scoreHand(state) {
    const order = finishOrder(state);
    // Last one standing wins — this is an elimination game, so surviving is
    // the score and the order is reversed.
    const alive = inPlay(state)[0];
    for (const s of state.seats) {
      const place = order.indexOf(s.seat);
      s.score += Math.max(0, order.length - place - 1);
    }
    if (alive) { alive.score += 4; alive.won += 1; }
    state.said = alive ? `${alive.name} is the last one left.` : 'Everybody went out.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      rank: state.rank,
      pileSize: state.pile.length,
      // The claim, never what is under it.
      claim: state.claim && {
        by: state.claim.by, byName: state.claim.byName,
        count: state.claim.count, rank: state.claim.rank,
      },
      callWindow: Math.max(0, Math.ceil(state.callWindow)),
      reveal: state.reveal,
      deckIs: { K: 6, Q: 6, A: 6, wild: 2 },
      finished: state.finished,
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    return {
      holding: seat.hand.filter((c) => liarRank(c) === state.rank || liarRank(c) === 'W').length,
      canCall: Boolean(state.claim) && state.claim.by !== seat.seat && !seat.out,
    };
  },
});

function settleLiar(state, caller) {
  const claim = state.claim;
  if (!claim) return;
  state.pile.push(...claim.cards);
  const lied = claim.cards.some((c) => liarRank(c) !== claim.rank && liarRank(c) !== 'W');
  const player = state.seats.find((s) => s.seat === claim.by);

  if (!caller) {
    state.reveal = null;
    state.said = `${player?.name ?? 'They'} got away with it.`;
    state.claim = null;
    state.callWindow = 0;
    passTurn(state, nextSeat(state, claim.by));
    state.dirty = true;
    return;
  }

  const wrong = lied ? player : caller;
  state.reveal = {
    cards: claim.cards, rank: claim.rank, lied,
    byName: player?.name ?? '', callerName: caller.name, outName: wrong.name,
  };
  state.said = lied
    ? `${caller.name} was right — ${player?.name} is out.`
    : `They were real. ${caller.name} is out.`;
  state.log.push(state.said);
  goOut(state, wrong);

  state.claim = null;
  state.callWindow = 0;
  if (inPlay(state).length > 1) passTurn(state, wrong.out ? nextSeat(state, wrong.seat) : wrong.seat);
  state.dirty = true;
}

/* ---------------------------------- Skull --------------------------------- */

/**
 * Skull.
 *
 * Four cards each: three roses and one skull. Place them face down, then bid on
 * how many you can turn over without finding a skull — and your own pile is
 * where you have to start. That last rule is the entire game, and it is what
 * makes a bluff genuinely dangerous rather than free.
 */
export const skull = createCardGame({
  id: 'skull',
  name: 'Skull',
  tagline: 'Bid what you can turn over. Starting with your own.',
  emoji: '💀',
  accent: '#2c3e50',
  face: 'skull',
  minPlayers: 3,
  maxPlayers: 6,
  hands: 4,
  turnSeconds: 25,

  howToPlay: [
    'Four cards each: three roses and one skull. Place them face down in a pile in front of you.',
    'When you are ready, bid a number of cards you could turn over without hitting a skull.',
    'Everybody else bids higher or passes. Highest bid has to do it.',
    'You must turn over your own pile first — all of it — before touching anybody else’s.',
    'Turn over that many roses and you win a point. Hit a skull and you lose a card for good.',
  ],

  init(state) {
    state.stage = 'placing';    // placing -> bidding -> turning
    state.piles = {};           // seat -> cards placed, bottom first
    state.bid = null;           // { by, n }
    state.passed = [];
    state.turned = [];          // { seat, card }
    state.points = {};
    state.cardsLeft = {};
  },

  deal(state) {
    state.stage = 'placing';
    state.piles = {};
    state.bid = null;
    state.passed = [];
    state.turned = [];
    state.points = state.points ?? {};
    for (const s of state.seats) {
      const left = state.cardsLeft[s.seat] ?? 4;
      state.cardsLeft[s.seat] = left;
      // One skull among however many are left, which is what losing a card
      // actually costs you: the odds get worse, not just the count.
      s.hand = left > 0 ? ['SK', ...Array.from({ length: left - 1 }, (_, i) => `RO${i}`)] : [];
      state.piles[s.seat] = [];
      s.out = left === 0;
    }
    state.deck = [];
    state.turn = 0;
    state.said = 'Place a card face down.';
  },

  act(state, seat, action) {
    if (seat.out) return;

    if (state.stage === 'placing') {
      if (action.type === 'place') {
        const card = String(action.card ?? '');
        if (!seat.hand.includes(card)) return;
        seat.hand.splice(seat.hand.indexOf(card), 1);
        (state.piles[seat.seat] ??= []).push(card);
        state.said = `${seat.name} places one.`;
        state.dirty = true;
        return;
      }
      if (action.type === 'bid') {
        // You may only start the bidding once you have something down.
        if (!(state.piles[seat.seat] ?? []).length) return;
        const n = Math.floor(Number(action.n));
        const total = Object.values(state.piles).reduce((a, b) => a + b.length, 0);
        if (!Number.isFinite(n) || n < 1 || n > total) return;
        state.stage = 'bidding';
        state.bid = { by: seat.seat, byName: seat.name, n };
        state.passed = [];
        state.said = `${seat.name} bids ${n}.`;
        passTurn(state);
        return;
      }
      return;
    }

    if (state.stage === 'bidding') {
      if (action.type === 'bid') {
        const n = Math.floor(Number(action.n));
        const total = Object.values(state.piles).reduce((a, b) => a + b.length, 0);
        if (!Number.isFinite(n) || n <= (state.bid?.n ?? 0) || n > total) return;
        state.bid = { by: seat.seat, byName: seat.name, n };
        state.passed = [];
        state.said = `${seat.name} bids ${n}.`;
        passTurn(state);
        return;
      }
      if (action.type === 'pass') {
        if (state.bid?.by === seat.seat) return;
        if (!state.passed.includes(seat.seat)) state.passed.push(seat.seat);
        state.said = `${seat.name} passes.`;
        const live = inPlay(state).filter((s) => s.seat !== state.bid.by);
        if (state.passed.length >= live.length) {
          state.stage = 'turning';
          state.turned = [];
          state.turn = state.bid.by;
          state.said = `${state.bid.byName} must turn over ${state.bid.n}, starting with their own.`;
        } else {
          passTurn(state);
        }
        return;
      }
      return;
    }

    if (state.stage !== 'turning') return;
    if (action.type !== 'flip') return;
    if (state.bid?.by !== seat.seat) return;

    const from = Math.floor(Number(action.from));
    const mine = state.piles[seat.seat] ?? [];
    // Your own pile first, all of it. The rule the whole game rests on.
    if (mine.length && from !== seat.seat) return;

    const pile = state.piles[from];
    if (!pile?.length) return;
    const card = pile.pop();
    state.turned.push({ seat: from, card });

    if (card === 'SK') {
      // Caught. A card is lost for the rest of the game, which makes every
      // later round more dangerous for them.
      state.cardsLeft[seat.seat] = Math.max(0, (state.cardsLeft[seat.seat] ?? 4) - 1);
      state.said = `${seat.name} hits a skull and loses a card.`;
      state.log.push(state.said);
      endRound(state);
      return;
    }

    if (state.turned.length >= state.bid.n) {
      state.points[seat.seat] = (state.points[seat.seat] ?? 0) + 1;
      seat.score += 3;
      seat.won += 1;
      state.said = `${seat.name} turns over ${state.bid.n} and takes a point.`;
      state.log.push(state.said);
      endRound(state);
      return;
    }
    state.said = `${seat.name} turns a rose — ${state.turned.length} of ${state.bid.n}.`;
    state.dirty = true;
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat || seat.out) return;
    if (state.stage === 'placing' && seat.hand.length) {
      // Place a rose, never the skull, for somebody who is not there.
      const rose = seat.hand.find((c) => c !== 'SK') ?? seat.hand[0];
      skull.__spec.act(state, seat, { type: 'place', card: rose });
      return;
    }
    if (state.stage === 'bidding') { skull.__spec.act(state, seat, { type: 'pass' }); return; }
    if (state.stage === 'turning') {
      const mine = state.piles[seat.seat] ?? [];
      const from = mine.length ? seat.seat : inPlay(state).find((s) => (state.piles[s.seat] ?? []).length)?.seat;
      if (from !== undefined) skull.__spec.act(state, seat, { type: 'flip', from });
    }
  },

  handOver: (state) => state.stage === 'done',

  scoreHand(state) {
    const winners = state.seats.filter((s) => (state.points[s.seat] ?? 0) > 0);
    state.said = winners.length
      ? winners.map((s) => `${s.name} ${state.points[s.seat]}`).join(' · ')
      : 'Nobody made a bid.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      stage: state.stage,
      // Pile heights, never their contents — the entire game is not knowing.
      piles: state.seats.map((s) => ({
        seat: s.seat, name: s.name,
        height: (state.piles[s.seat] ?? []).length,
        left: state.cardsLeft[s.seat] ?? 4,
        points: state.points[s.seat] ?? 0,
        out: s.out,
      })),
      bid: state.bid,
      passed: state.passed,
      // Turned cards are public the instant they are turned. That is the risk.
      turned: state.turned,
      finished: [],
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    return {
      placed: (state.piles[seat.seat] ?? []).length,
      left: state.cardsLeft[seat.seat] ?? 4,
      // Your own pile, which you may look at — you put it there.
      myPile: state.piles[seat.seat] ?? [],
      isBidder: state.bid?.by === seat.seat,
      mustFlipOwn: state.stage === 'turning' && (state.piles[seat.seat] ?? []).length > 0,
    };
  },
});

function endRound(state) {
  state.stage = 'done';
  state.dirty = true;
}

void seatOf;

export const BLUFF_GAMES = [liarsdeck, skull];
