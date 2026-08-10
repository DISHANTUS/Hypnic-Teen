// Canasta.
//
// Melds are by rank only — no runs — and twos are wild and can stand in for
// anything. Seven cards of one rank is a canasta, and you may not go out until
// you have one. That last rule is what makes the game long and what makes it
// Canasta: without it everybody would lay three of something and leave.
//
// Two decisions worth writing down.
//
// A meld may never be more than half wild. Three natural cards and four twos is
// not a canasta, it is a shrug — and without the cap the correct play is always
// to hoard twos and buy a win, which is not a game. The cap is checked on every
// change to a meld rather than only when it is laid, because laying three
// naturals and then adding four wilds one at a time is the same thing done
// slowly.
//
// And the discard pile is taken whole, not one card at a time. That is the
// engine of the whole game — the pile grows all round the table and whoever can
// finally claim it gets an enormous hand — so the rule for claiming it has to
// be exact: you must be able to use the top card immediately, with two natural
// cards of that rank already in your hand.

import {
  createCardGame, dealAround, drawCards, goOut, passTurn, inPlay,
  rankOf, sayRank, sayCard, shuffle, freshDeck,
} from './kit.js';

const WILD = '2';
const isWild = (card) => rankOf(card) === WILD;

/** What a card is worth when it is counted. */
export function worth(card) {
  const rank = rankOf(card);
  if (rank === WILD) return 20;
  if (rank === 'A') return 20;
  if (['8', '9', 'T', 'J', 'Q', 'K'].includes(rank)) return 10;
  return 5;
}

/** A meld is legal if it is three or more of one rank and less than half wild. */
export function legalMeld(cards) {
  if (cards.length < 3) return false;
  const wilds = cards.filter(isWild);
  const naturals = cards.filter((c) => !isWild(c));
  if (naturals.length < 2) return false;
  // Never more wilds than naturals. Hoarding twos must not be a strategy.
  if (wilds.length > naturals.length) return false;
  if (wilds.length > 3) return false;
  const rank = rankOf(naturals[0]);
  return naturals.every((c) => rankOf(c) === rank);
}

const meldRank = (cards) => rankOf(cards.find((c) => !isWild(c)) ?? cards[0]);
const isCanasta = (cards) => cards.length >= 7;

export const canasta = createCardGame({
  id: 'canasta',
  name: 'Canasta',
  tagline: 'Seven of a kind, and you cannot leave without one.',
  emoji: '🧺',
  accent: '#c0392b',
  face: 'rummy',
  minPlayers: 2,
  maxPlayers: 4,
  hands: 2,
  turnSeconds: 40,

  howToPlay: [
    'Melds are three or more of one rank. There are no runs.',
    'Twos are wild, but a meld can never be more than half wild.',
    'Seven of a rank is a canasta — and you cannot go out until you have one.',
    'You may take the whole discard pile, but only if you can use the top card at once with two of that rank already in hand.',
    'Aces and twos are twenty, eights up are ten, everything else is five.',
  ],

  init(state) {
    state.melds = {};          // seat -> [{ cards[] }]
    state.drewThisTurn = false;
    state.finished = [];
    state.tookPileThisTurn = false;
  },

  deal(state) {
    // Two packs, because one is not enough for sevens of a rank to happen.
    state.deck = shuffle([...freshDeck(), ...freshDeck()]);
    dealAround(state, 11);
    state.melds = Object.fromEntries(state.seats.map((s) => [s.seat, []]));
    state.drewThisTurn = false;
    state.tookPileThisTurn = false;
    state.finished = [];
    state.pile = [state.deck.pop()];
    state.turn = state.hand % state.seats.length;
    state.said = 'Draw, meld, discard.';
  },

  act(state, seat, action) {
    if (state.seats[state.turn]?.id !== seat.id || seat.out) return;

    if (action.type === 'draw') {
      if (state.drewThisTurn) return;
      drawCards(state, seat, 1);
      state.drewThisTurn = true;
      state.said = `${seat.name} draws.`;
      state.dirty = true;
      return;
    }

    if (action.type === 'takePile') {
      if (state.drewThisTurn || !state.pile.length) return;
      const top = state.pile[state.pile.length - 1];
      if (isWild(top)) return;                       // a wild on top freezes it
      // Two naturals of that rank in hand, right now. The whole pile turns on
      // this one condition, so it is checked here and nowhere else.
      const naturals = seat.hand.filter((c) => rankOf(c) === rankOf(top) && !isWild(c));
      if (naturals.length < 2) return;

      const taken = state.pile.length;
      seat.hand.push(...state.pile);
      state.pile = [];
      state.drewThisTurn = true;
      state.tookPileThisTurn = true;
      // Lay the meld the claim was made on straight away, so the claim cannot
      // be made and then quietly not honoured.
      const meld = [top, ...naturals.slice(0, 2)];
      for (const c of meld) seat.hand.splice(seat.hand.indexOf(c), 1);
      (state.melds[seat.seat] ??= []).push({ cards: meld });
      state.said = `${seat.name} takes the whole pile — ${taken} cards.`;
      state.log.push(state.said);
      state.dirty = true;
      return;
    }

    if (action.type === 'meld') {
      if (!state.drewThisTurn) return;
      const cards = Array.isArray(action.cards) ? [...new Set(action.cards)] : [];
      if (!cards.every((c) => seat.hand.includes(c))) return;
      if (!legalMeld(cards)) return;
      for (const c of cards) seat.hand.splice(seat.hand.indexOf(c), 1);
      (state.melds[seat.seat] ??= []).push({ cards });
      state.said = `${seat.name} melds ${cards.length} × ${sayRank(meldRank(cards))}.`;
      state.dirty = true;
      return;
    }

    if (action.type === 'add') {
      if (!state.drewThisTurn) return;
      const card = String(action.card ?? '');
      const mine = state.melds[seat.seat] ?? [];
      const meld = mine[Number(action.meld)];
      if (!meld || !seat.hand.includes(card)) return;
      // Re-checked against the whole meld, so four wilds cannot be added one at
      // a time to something that was legal when it was laid.
      if (!legalMeld([...meld.cards, card])) return;
      seat.hand.splice(seat.hand.indexOf(card), 1);
      meld.cards.push(card);
      state.said = isCanasta(meld.cards)
        ? `${seat.name} completes a canasta!`
        : `${seat.name} adds to the ${sayRank(meldRank(meld.cards))}s.`;
      if (isCanasta(meld.cards)) state.log.push(state.said);
      state.dirty = true;
      return;
    }

    if (action.type === 'discard') {
      if (!state.drewThisTurn) return;
      const card = String(action.card ?? '');
      if (!seat.hand.includes(card)) return;
      seat.hand.splice(seat.hand.indexOf(card), 1);
      state.pile.push(card);
      state.drewThisTurn = false;
      state.tookPileThisTurn = false;
      state.said = `${seat.name} throws the ${sayCard(card)}.`;

      // Going out needs a canasta. Emptying your hand without one is not a win
      // and must not end the hand.
      if (!seat.hand.length) {
        const has = (state.melds[seat.seat] ?? []).some((m) => isCanasta(m.cards));
        if (has) { goOut(state, seat); state.said = `${seat.name} goes out.`; state.log.push(state.said); }
        else {
          // Give them a card back rather than leave them stuck with nothing to
          // do on every future turn.
          drawCards(state, seat, 1);
          state.said = `${seat.name} is empty but has no canasta — drew again.`;
        }
      }
      if (inPlay(state).length > 1) passTurn(state);
      state.dirty = true;
    }
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat || seat.out) return;
    if (!state.drewThisTurn) { drawCards(state, seat, 1); state.drewThisTurn = true; state.dirty = true; return; }
    // Throw the cheapest thing, which is the least damaging default.
    const worst = [...seat.hand].sort((a, b) => worth(a) - worth(b))[0];
    if (!worst) return;
    state.log.push(`${seat.name} was away — threw one.`);
    canasta.__spec.act(state, seat, { type: 'discard', card: worst });
  },

  handOver: (state) => inPlay(state).length <= 1 || state.deck.length === 0,

  scoreHand(state) {
    const said = [];
    for (const s of state.seats) {
      const melds = state.melds[s.seat] ?? [];
      const onTable = melds.reduce((sum, m) => sum + m.cards.reduce((n, c) => n + worth(c), 0), 0);
      const canastas = melds.filter((m) => isCanasta(m.cards)).length;
      const held = s.hand.reduce((n, c) => n + worth(c), 0);
      // Five hundred a canasta is what makes the whole game about getting one.
      const total = onTable + canastas * 500 - held;
      s.score += total;
      if (canastas > 0) s.won += canastas;
      said.push(`${s.name} ${total}`);
    }
    state.said = said.join(' · ');
    state.log.push(state.said);
  },

  table(state) {
    return {
      melds: state.seats.flatMap((s) =>
        (state.melds[s.seat] ?? []).map((m, i) => ({
          at: i, by: s.seat, byName: s.name, cards: m.cards,
          canasta: isCanasta(m.cards),
          rank: meldRank(m.cards),
        }))),
      top: state.pile[state.pile.length - 1] ?? null,
      pileSize: state.pile.length,
      // Whether the pile is claimable at all, which everybody can work out
      // anyway and which is the single most watched thing on the table.
      frozen: state.pile.length > 0 && isWild(state.pile[state.pile.length - 1]),
      drewThisTurn: state.drewThisTurn,
      finished: state.finished,
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    const top = state.pile[state.pile.length - 1];
    const naturals = top && !isWild(top)
      ? seat.hand.filter((c) => rankOf(c) === rankOf(top) && !isWild(c)).length
      : 0;
    return {
      mustDraw: !state.drewThisTurn,
      canTakePile: !state.drewThisTurn && naturals >= 2,
      myMelds: (state.melds[seat.seat] ?? []).map((m, i) => ({
        at: i, cards: m.cards, canasta: isCanasta(m.cards), rank: meldRank(m.cards),
      })),
      hasCanasta: (state.melds[seat.seat] ?? []).some((m) => isCanasta(m.cards)),
      wilds: seat.hand.filter(isWild).length,
    };
  },
});

export default canasta;
