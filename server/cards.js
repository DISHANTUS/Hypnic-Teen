// A deck, and what a poker hand is worth.
//
// Hand ranking is the one piece of this whole floor that has a right answer
// somebody at the table already knows. If a full house loses to a flush once,
// nobody trusts the game again — and unlike a layout bug there is no arguing
// about it. So it is written plainly, checked against every category, and the
// comparison is a straight list compare rather than a clever score.
//
// Seven cards in, best five out. Rather than trying all twenty-one
// combinations, each category is looked for directly, in order, and the first
// one found is the answer — a hand that contains a straight flush cannot be
// better as anything else.

export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_SIGN = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

/** 2 is 2, ace is 14. Ace-low straights are handled where they come up. */
export const valueOf = (rank) => RANKS.indexOf(rank) + 2;

/** A card is a two-character string: rank then suit. 'As', 'Td', '7h'. */
export const cardOf = (rank, suit) => `${rank}${suit}`;
export const rankOf = (card) => card[0];
export const suitOf = (card) => card[1];

export function freshDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push(cardOf(rank, suit));
  return deck;
}

/**
 * Fisher-Yates, off the platform's own randomness.
 *
 * Nothing here is trying to be cryptographically unguessable — it is a card
 * game between friends — but the deck is shuffled on the server and never
 * leaves it until a card is dealt, which is the part that actually matters.
 */
export function shuffle(deck) {
  const out = [...deck];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Hand categories, worst to best. The number is what gets compared first. */
export const CATEGORY = {
  high: 0,
  pair: 1,
  twoPair: 2,
  trips: 3,
  straight: 4,
  flush: 5,
  fullHouse: 6,
  quads: 7,
  straightFlush: 8,
};

const CATEGORY_NAME = {
  0: 'High card',
  1: 'A pair',
  2: 'Two pair',
  3: 'Three of a kind',
  4: 'A straight',
  5: 'A flush',
  6: 'A full house',
  7: 'Four of a kind',
  8: 'A straight flush',
};

/** Counts of each rank value, highest count first then highest value. */
function byCount(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
}

/**
 * The top of a straight in these values, or 0.
 *
 * The ace-low wheel — A2345 — is the exception everybody forgets. An ace is
 * worth fourteen everywhere else, so it is added as a one here and the run is
 * looked for again.
 */
function straightTop(values) {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  const withWheel = unique.includes(14) ? [...unique, 1] : unique;
  let run = 1;
  for (let i = 1; i < withWheel.length; i++) {
    if (withWheel[i] === withWheel[i - 1] - 1) {
      run += 1;
      if (run >= 5) return withWheel[i] + 4;
    } else if (withWheel[i] !== withWheel[i - 1]) {
      run = 1;
    }
  }
  return 0;
}

/**
 * What a hand of five to seven cards is worth.
 *
 * @returns {{ category: number, name: string, tiebreak: number[], cards: string[] }}
 *   `tiebreak` is compared left to right after the category, which is all the
 *   comparison anybody needs — no scores to overflow, no magic constants.
 */
export function evaluate(cards) {
  const values = cards.map((c) => valueOf(rankOf(c)));
  const suits = cards.map((c) => suitOf(c));

  const suitCounts = new Map();
  for (const s of suits) suitCounts.set(s, (suitCounts.get(s) ?? 0) + 1);
  const flushSuit = [...suitCounts.entries()].find(([, n]) => n >= 5)?.[0] ?? null;

  // A straight flush is a straight among the flush cards only — the flush
  // suit's own run, not any run in the hand.
  if (flushSuit) {
    const flushValues = cards.filter((c) => suitOf(c) === flushSuit).map((c) => valueOf(rankOf(c)));
    const top = straightTop(flushValues);
    if (top) {
      return finish(CATEGORY.straightFlush, [top], cards);
    }
  }

  const counts = byCount(values);
  const [topValue, topCount] = counts[0];

  if (topCount === 4) {
    const kicker = counts.slice(1).map(([v]) => v).sort((a, b) => b - a)[0] ?? 0;
    return finish(CATEGORY.quads, [topValue, kicker], cards);
  }

  if (topCount === 3) {
    const pair = counts.slice(1).find(([, n]) => n >= 2)?.[0];
    if (pair !== undefined) return finish(CATEGORY.fullHouse, [topValue, pair], cards);
  }

  if (flushSuit) {
    const best = cards
      .filter((c) => suitOf(c) === flushSuit)
      .map((c) => valueOf(rankOf(c)))
      .sort((a, b) => b - a)
      .slice(0, 5);
    return finish(CATEGORY.flush, best, cards);
  }

  const top = straightTop(values);
  if (top) return finish(CATEGORY.straight, [top], cards);

  if (topCount === 3) {
    const kickers = counts.slice(1).map(([v]) => v).sort((a, b) => b - a).slice(0, 2);
    return finish(CATEGORY.trips, [topValue, ...kickers], cards);
  }

  if (topCount === 2) {
    const pairs = counts.filter(([, n]) => n === 2).map(([v]) => v).sort((a, b) => b - a);
    if (pairs.length >= 2) {
      const kicker = values.filter((v) => v !== pairs[0] && v !== pairs[1]).sort((a, b) => b - a)[0] ?? 0;
      return finish(CATEGORY.twoPair, [pairs[0], pairs[1], kicker], cards);
    }
    const kickers = values.filter((v) => v !== topValue).sort((a, b) => b - a).slice(0, 3);
    return finish(CATEGORY.pair, [topValue, ...kickers], cards);
  }

  return finish(CATEGORY.high, [...values].sort((a, b) => b - a).slice(0, 5), cards);
}

function finish(category, tiebreak, cards) {
  return { category, name: CATEGORY_NAME[category], tiebreak, cards };
}

/**
 * Compares two evaluated hands. Positive if a wins, 0 if they are level.
 *
 * Level is a real outcome and has to be said so: two players holding the same
 * two pair with the same kicker split the pot, and a comparison that quietly
 * preferred one of them would take somebody's chips for no reason.
 */
export function compareHands(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < len; i++) {
    const x = a.tiebreak[i] ?? 0;
    const y = b.tiebreak[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * Rank values as the words people say. 13 is "kings", not thirteen.
 *
 * Shared, because every table that names a hand needs it and the one that did
 * not have it read out "a pair of 13s" at a poker table.
 */
export const PLURAL = {
  2: 'twos', 3: 'threes', 4: 'fours', 5: 'fives', 6: 'sixes', 7: 'sevens',
  8: 'eights', 9: 'nines', 10: 'tens', 11: 'jacks', 12: 'queens', 13: 'kings', 14: 'aces',
};

/** A hand's name, with what it is made of — "Two pair, kings and fours". */
export function describe(hand) {
  const word = PLURAL;
  const [a, b] = hand.tiebreak;
  switch (hand.category) {
    case CATEGORY.straightFlush: return `Straight flush, ${word[a] ?? a} high`;
    case CATEGORY.quads: return `Four ${word[a]}`;
    case CATEGORY.fullHouse: return `Full house, ${word[a]} over ${word[b]}`;
    case CATEGORY.flush: return `Flush, ${word[a]} high`;
    case CATEGORY.straight: return `Straight, ${word[a] ?? a} high`;
    case CATEGORY.trips: return `Three ${word[a]}`;
    case CATEGORY.twoPair: return `Two pair, ${word[a]} and ${word[b]}`;
    case CATEGORY.pair: return `A pair of ${word[a]}`;
    default: return `${(word[a] ?? '').replace(/s$/, '') || 'Nothing'} high`;
  }
}

/* --------------------------------- blackjack ------------------------------ */

/**
 * What a blackjack hand is worth, with aces counted the way a person does.
 *
 * An ace is eleven until that busts you, then it is one. Counting all aces as
 * eleven and subtracting ten per ace while over does exactly that, and handles
 * a hand with three of them without a special case.
 */
export function blackjackValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    const r = rankOf(card);
    if (r === 'A') { aces += 1; total += 11; }
    else if (['T', 'J', 'Q', 'K'].includes(r)) total += 10;
    else total += Number(r);
  }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return { total, soft: aces > 0, bust: total > 21 };
}

/** Two cards making exactly 21 — beats any other 21. */
export const isBlackjack = (cards) => cards.length === 2 && blackjackValue(cards).total === 21;
