// Melds: sets, runs, and what a hand is worth when it cannot make any.
//
// Rummy, Gin and Canasta all turn on the same two shapes — three or more of a
// rank, or three or more in sequence in one suit — and on the same awkward
// question underneath them: given ten cards, what is the *best* way to arrange
// them? That question is the whole reason this file exists separately.
//
// A greedy answer is wrong in a way nobody would ever notice from the outside
// and everybody would feel. Take 5♣ 6♣ 7♣ 7♦ 7♥: a greedy pass that grabs the
// set of sevens first leaves 5♣ 6♣ stranded and calls it eleven points of
// deadwood; taking the run first leaves 7♦ 7♥ and calls it fourteen. Neither is
// obviously the loser, but in Gin the difference decides whether somebody is
// allowed to knock at all — and a player who can count to ten will know the
// screen is lying to them.
//
// So the layout is searched rather than guessed. A ten card hand has few enough
// candidate melds that trying every combination is instant, and being exactly
// right about it is worth more than being clever.

import { rankOf, suitOf, RANKS } from './kit.js';

const at = (rank) => RANKS.indexOf(rank);

/**
 * What a card is worth as deadwood.
 *
 * Aces are one and faces are ten, which is the Rummy family's convention and
 * not the same as the ace-high ordering used for runs. Both are true at once
 * and mixing them up is a classic way to get scoring subtly wrong.
 */
export function pointsOf(card) {
  const rank = rankOf(card);
  if (rank === 'A') return 1;
  if (['T', 'J', 'Q', 'K'].includes(rank)) return 10;
  return Number(rank);
}

export const handPoints = (cards) => cards.reduce((sum, c) => sum + pointsOf(c), 0);

/** Three or more of one rank. */
export function isSet(cards) {
  if (cards.length < 3) return false;
  const rank = rankOf(cards[0]);
  if (!cards.every((c) => rankOf(c) === rank)) return false;
  // No two of the same card — matters once a game uses two packs.
  return new Set(cards).size === cards.length;
}

/** Three or more in sequence, all one suit. Aces are low here, as they run. */
export function isRun(cards) {
  if (cards.length < 3) return false;
  const suit = suitOf(cards[0]);
  if (!cards.every((c) => suitOf(c) === suit)) return false;
  const order = [...cards].map((c) => at(rankOf(c))).sort((a, b) => a - b);
  if (new Set(order).size !== order.length) return false;
  return order.every((n, i) => i === 0 || n === order[i - 1] + 1);
}

export const isMeld = (cards) => isSet(cards) || isRun(cards);

/**
 * Every meld that could be made from a hand.
 *
 * Only minimal-length runs and sets are generated plus their extensions, which
 * keeps the list short enough to search exhaustively without missing anything:
 * a longer run is always reachable by extending a shorter one.
 */
export function candidateMelds(hand) {
  const out = [];

  // Sets.
  const byRank = new Map();
  for (const c of hand) {
    if (!byRank.has(rankOf(c))) byRank.set(rankOf(c), []);
    byRank.get(rankOf(c)).push(c);
  }
  for (const cards of byRank.values()) {
    if (cards.length >= 3) {
      // Every three, and the whole four if there is one.
      for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
          for (let k = j + 1; k < cards.length; k++) out.push([cards[i], cards[j], cards[k]]);
        }
      }
      if (cards.length >= 4) out.push([...cards]);
    }
  }

  // Runs.
  const bySuit = new Map();
  for (const c of hand) {
    if (!bySuit.has(suitOf(c))) bySuit.set(suitOf(c), []);
    bySuit.get(suitOf(c)).push(c);
  }
  for (const cards of bySuit.values()) {
    const sorted = [...cards].sort((a, b) => at(rankOf(a)) - at(rankOf(b)));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 2; j < sorted.length; j++) {
        const run = sorted.slice(i, j + 1);
        if (isRun(run)) out.push(run);
        else break;
      }
    }
  }
  return out;
}

/**
 * The arrangement that leaves the least behind.
 *
 * Exhaustive over candidate melds, which sounds expensive and is not: a ten
 * card hand rarely has more than a dozen candidates and they conflict heavily,
 * so the search collapses almost immediately. Being exactly right here is the
 * difference between a legal knock and an illegal one.
 *
 * @returns {{ melds: string[][], deadwood: string[], points: number }}
 */
export function bestLayout(hand) {
  const candidates = candidateMelds(hand);
  let best = { melds: [], deadwood: [...hand], points: handPoints(hand) };

  const search = (from, used, taken) => {
    const left = hand.filter((c) => !used.has(c));
    const points = handPoints(left);
    if (points < best.points) best = { melds: [...taken], deadwood: left, points };
    if (points === 0) return true;   // nothing can beat this

    for (let i = from; i < candidates.length; i++) {
      const meld = candidates[i];
      if (meld.some((c) => used.has(c))) continue;
      for (const c of meld) used.add(c);
      taken.push(meld);
      const done = search(i + 1, used, taken);
      taken.pop();
      for (const c of meld) used.delete(c);
      if (done) return true;
    }
    return false;
  };

  search(0, new Set(), []);
  return best;
}

/**
 * Can this card be added to an existing meld on the table?
 *
 * Laying off is what keeps a losing hand interesting — it is the one thing you
 * can do when you cannot go out yourself.
 */
export function extends_(meld, card) {
  if (meld.includes(card)) return false;
  return isMeld([...meld, card]);
}

/** Sort a hand the way a person holds one: by suit, then in order. */
export function tidy(hand) {
  return [...hand].sort((a, b) =>
    suitOf(a).localeCompare(suitOf(b)) || at(rankOf(a)) - at(rankOf(b)));
}
