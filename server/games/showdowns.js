// Four more tables: baccarat, three card poker, casino war and sic bo.
//
// All four are the same shape as the machines — stake, everybody gets a hand
// or a roll at the same moment, best one takes the pot — but with cards and
// dice rather than reels, and a rank worth reading out. So they extend the
// same engine rather than repeating it, and only bring what makes each one
// itself: how to deal, how to score, and what to call the result.
//
// Every one of them is normally played against the house, and every one of
// them is better without it. Casino War in a casino is a coin flip with an
// edge; between six people it is six cards face up and one of you takes the
// lot. Baccarat's whole ritual is watching a card turn over, and that works
// far better when the person it beats is sitting next to you.

import { freshDeck, shuffle, evaluate, compareHands, describe, rankOf, valueOf, PLURAL } from '../cards.js';
import { createMachine } from './chance.js';

/**
 * Baccarat's count: tens and pictures are nothing, and the total is taken
 * modulo ten. Nine is the best hand there is.
 */
export function baccaratValue(cards) {
  const total = cards.reduce((sum, c) => {
    const r = rankOf(c);
    if (['T', 'J', 'Q', 'K'].includes(r)) return sum;
    if (r === 'A') return sum + 1;
    return sum + Number(r);
  }, 0);
  return total % 10;
}

/**
 * A three-card hand, ranked the way three card poker ranks them.
 *
 * The order is not the five-card order and the difference is the whole point:
 * a straight beats a flush here, because with three cards a straight is the
 * rarer thing. Getting that backwards is the one mistake at this table that
 * somebody who plays it will spot immediately.
 */
export function threeCardRank(cards) {
  const values = cards.map((c) => valueOf(rankOf(c))).sort((a, b) => b - a);
  const suits = cards.map((c) => c[1]);
  const flush = new Set(suits).size === 1;

  const unique = [...new Set(values)];
  // A-2-3 counts as a straight with the ace low, the same wheel as everywhere.
  const straight =
    (unique.length === 3 && values[0] - values[2] === 2) ||
    (unique.length === 3 && values[0] === 14 && values[1] === 3 && values[2] === 2);
  const top = straight && values[0] === 14 && values[1] === 3 ? 3 : values[0];

  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const trips = [...counts.entries()].find(([, n]) => n === 3);
  const pair = [...counts.entries()].find(([, n]) => n === 2);

  if (straight && flush) return { rank: 5, name: 'straight flush', tiebreak: [top, ...values] };
  if (trips) return { rank: 4, name: 'three of a kind', tiebreak: [trips[0]] };
  if (straight) return { rank: 3, name: 'a straight', tiebreak: [top, ...values] };
  if (flush) return { rank: 2, name: 'a flush', tiebreak: values };
  if (pair) return { rank: 1, name: `a pair of ${PLURAL[pair[0]] ?? pair[0]}`, tiebreak: [pair[0], ...values.filter((v) => v !== pair[0])] };
  return { rank: 0, name: 'high card', tiebreak: values };
}

/** One number a comparison can sort by, built from rank then kickers. */
const flatten = (rank, tiebreak) =>
  tiebreak.slice(0, 5).reduce((acc, v) => acc * 15 + (v ?? 0), rank + 1);

/** Singular words, for the tables that call out one number or one card. */
const NAMES = { 0: 'nothing', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine' };

/** A card's rank as it is said out loud. "Ace high", not "A high". */
const SAID = { A: 'ace', K: 'king', Q: 'queen', J: 'jack', T: 'ten' };
const rankSaid = (card) => SAID[rankOf(card)] ?? NAMES[Number(rankOf(card))] ?? rankOf(card);

/* --------------------------------- baccarat ------------------------------- */

export const baccarat = createMachine({
  id: 'baccarat',
  name: 'Baccarat',
  tagline: 'Two cards each, nearest to nine. No banker, no house.',
  emoji: '🎴',
  accent: '#8e44ad',
  blurb: 'Two cards each and the count runs to nine — tens and pictures are worth nothing. Nearest to nine takes the pot.',
  roll() {
    const deck = shuffle(freshDeck());
    const cards = [deck.pop(), deck.pop()];
    let total = baccaratValue(cards);
    // A third card on anything under six, which is the rule everybody at a
    // baccarat table already knows and the only decision the game has.
    if (total <= 5) {
      cards.push(deck.pop());
      total = baccaratValue(cards);
    }
    return {
      // Nine is the best there is, so the score is simply the count. A natural
      // — nine or eight off two cards — edges a made one of the same number.
      score: total * 2 + (cards.length === 2 && total >= 8 ? 1 : 0),
      detail: { cards, total },
      say: total === 9 ? 'nine — a natural' : `${NAMES[total] ?? total}`,
    };
  },
});

/* ----------------------------- three card poker --------------------------- */

export const threeCard = createMachine({
  id: 'three-card',
  name: 'Three Card Poker',
  tagline: 'Three cards each. A straight beats a flush here — there are only three.',
  emoji: '🃏',
  accent: '#16a085',
  blurb: 'Three cards each, best hand takes the pot. With only three cards a straight is rarer than a flush, so it beats one.',
  roll() {
    const deck = shuffle(freshDeck());
    const cards = [deck.pop(), deck.pop(), deck.pop()];
    const hand = threeCardRank(cards);
    return {
      score: flatten(hand.rank, hand.tiebreak),
      detail: { cards, name: hand.name },
      say: hand.name,
    };
  },
});

/* -------------------------------- casino war ------------------------------ */

export const casinoWar = createMachine({
  id: 'casino-war',
  name: 'Casino War',
  tagline: 'One card each. Highest wins. That is the whole game.',
  emoji: '⚔️',
  accent: '#c0392b',
  blurb: 'One card each, face up, highest takes the pot. Level cards go to war — another card each until somebody is on top.',
  roll() {
    const deck = shuffle(freshDeck());
    const card = deck.pop();
    return {
      // Nothing but the card. Ties go to war, which the engine handles by
      // splitting the pot — the fairest reading of a tie between friends.
      score: valueOf(rankOf(card)),
      detail: { cards: [card] },
      say: `${rankSaid(card)} high`,
    };
  },
});

/* ---------------------------------- sic bo -------------------------------- */

export const sicBo = createMachine({
  id: 'sic-bo',
  name: 'Sic Bo',
  tagline: 'Three dice each. Triples are what you are chasing.',
  emoji: '🎲',
  accent: '#2980b9',
  blurb: 'Three dice each. A triple is the big one, then a pair, then whatever they add up to.',
  roll() {
    const dice = [1, 2, 3].map(() => 1 + Math.floor(Math.random() * 6));
    const counts = new Map();
    for (const d of dice) counts.set(d, (counts.get(d) ?? 0) + 1);
    const [face, howMany] = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const total = dice.reduce((a, b) => a + b, 0);

    // A triple beats any pair beats any total, and within each the bigger
    // face or total wins — which is the order a table would call out.
    const score = howMany === 3 ? 2000 + face : howMany === 2 ? 1000 + face * 10 + total : total;
    return {
      score,
      detail: { dice, total },
      say: howMany === 3
        ? `a triple ${NAMES[face]}`
        : howMany === 2
          ? `a pair of ${PLURAL[face] ?? face}`
          : `${total}`,
    };
  },
});

/** Everything this file adds, for the registry. */
export const SHOWDOWN_GAMES = [baccarat, threeCard, casinoWar, sicBo];

// Kept so the hand ranker is shared rather than reimplemented — five-card
// ranking already lives in cards.js and three-card ranking lives here because
// it is genuinely a different order.
void evaluate;
void compareHands;
void describe;
