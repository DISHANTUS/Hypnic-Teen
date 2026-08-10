// Cribbage.
//
// Six cards each, two of them thrown into the crib, a card cut to start. Then
// the pegging — cards played alternately onto a running total that may not pass
// thirty-one — and then the counting, which is the part everybody who plays
// this game can do in their head and will absolutely notice you getting wrong.
//
// So the counting is a separate, exhaustive function with its own tests. It is
// tempting to score a hand by pattern-matching the obvious shapes; that is how
// you end up missing that 5♠ 5♥ 5♦ J♣ with a 5♣ cut is twenty-nine, the best
// hand in the game. Instead every subset is checked for fifteens, every pair is
// counted, and runs are found by length so that a double run counts twice
// rather than once.
//
// The other thing worth being exact about is that the crib belongs to the
// dealer and is counted separately, which is why the deal has to move — a game
// where the same person always keeps the crib is not close.

import {
  createCardGame, shuffle, freshDeck, passTurn, inPlay,
  rankOf, suitOf, sayCard, RANKS,
} from './kit.js';

const at = (rank) => RANKS.indexOf(rank);
/** Face cards are ten for counting; the ace is one. */
export const pip = (card) => {
  const rank = rankOf(card);
  if (rank === 'A') return 1;
  if (['T', 'J', 'Q', 'K'].includes(rank)) return 10;
  return Number(rank);
};

/**
 * What a hand is worth, with the cut card.
 *
 * Exhaustive rather than clever. Every subset for fifteens, every pair, every
 * run length from five down. The classic twenty-nine hand only comes out right
 * if all three are counted independently and runs are counted by multiplicity.
 *
 * @param {string[]} hand  four cards
 * @param {string} cut     the starter
 * @param {boolean} isCrib flushes in the crib must match the cut too
 */
export function countHand(hand, cut, isCrib = false) {
  const all = [...hand, cut].filter(Boolean);
  const parts = [];
  let total = 0;

  // Fifteens: every subset that adds to fifteen, two points each.
  let fifteens = 0;
  for (let mask = 1; mask < (1 << all.length); mask++) {
    let sum = 0;
    for (let i = 0; i < all.length; i++) if (mask & (1 << i)) sum += pip(all[i]);
    if (sum === 15) fifteens += 1;
  }
  if (fifteens) { total += fifteens * 2; parts.push(`${fifteens} × fifteen = ${fifteens * 2}`); }

  // Pairs: every pair of equal rank, two points each. Three of a kind is three
  // pairs and therefore six, which falls out of counting them this way.
  let pairs = 0;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) if (rankOf(all[i]) === rankOf(all[j])) pairs += 1;
  }
  if (pairs) { total += pairs * 2; parts.push(`${pairs} pair${pairs === 1 ? '' : 's'} = ${pairs * 2}`); }

  // Runs: the longest run length that exists, counted once per distinct set of
  // cards making it. A double run of three is six, not three.
  for (let len = all.length; len >= 3; len--) {
    let runs = 0;
    const seen = new Set();
    for (let mask = 1; mask < (1 << all.length); mask++) {
      const picked = [];
      for (let i = 0; i < all.length; i++) if (mask & (1 << i)) picked.push(all[i]);
      if (picked.length !== len) continue;
      const order = picked.map((c) => at(rankOf(c))).sort((a, b) => a - b);
      if (new Set(order).size !== order.length) continue;
      if (!order.every((n, i) => i === 0 || n === order[i - 1] + 1)) continue;
      const key = [...picked].sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      runs += 1;
    }
    if (runs) {
      total += runs * len;
      parts.push(`${runs} run${runs === 1 ? '' : 's'} of ${len} = ${runs * len}`);
      break;   // only the longest counts
    }
  }

  // Flush: four in hand is four; with the cut as well it is five. In the crib
  // it only counts if the cut matches too.
  const suits = hand.map(suitOf);
  if (hand.length === 4 && new Set(suits).size === 1) {
    if (cut && suitOf(cut) === suits[0]) { total += 5; parts.push('flush of five = 5'); }
    else if (!isCrib) { total += 4; parts.push('flush of four = 4'); }
  }

  // His nobs: the jack of the cut's suit, in hand, is one.
  if (cut && hand.some((c) => rankOf(c) === 'J' && suitOf(c) === suitOf(cut))) {
    total += 1;
    parts.push('his nobs = 1');
  }

  return { points: total, parts };
}

/* --------------------------------- the game -------------------------------- */

const TARGET = 61;   // once round the board rather than twice — a party length

export const cribbage = createCardGame({
  id: 'cribbage',
  name: 'Cribbage',
  tagline: 'Fifteen two, fifteen four, and a pair is six.',
  emoji: '🪵',
  accent: '#8e44ad',
  face: 'cribbage',
  minPlayers: 2,
  maxPlayers: 2,
  hands: 8,
  turnSeconds: 30,

  howToPlay: [
    'Six cards each. Throw two into the crib — the crib belongs to the dealer.',
    'A card is cut to start. Then play cards alternately onto a running total.',
    'Never go past thirty-one. Hitting fifteen or thirty-one exactly scores two.',
    'Then count your hand: every fifteen is two, every pair is two, runs score their length.',
    'First past sixty-one wins. The deal moves every hand.',
  ],

  init(state) {
    state.crib = [];
    state.cut = null;
    state.phase2 = 'throwing';    // throwing -> pegging -> counting
    state.run = [];               // cards played this pegging run
    state.total = 0;
    state.thrown = {};
    state.kept = {};
    state.saidCount = [];
    state.dealer = 0;
    state.go = [];
  },

  deal(state) {
    state.deck = shuffle(freshDeck());
    for (const s of state.seats) s.hand = state.deck.splice(0, 6);
    state.crib = [];
    state.cut = null;
    state.phase2 = 'throwing';
    state.run = [];
    state.total = 0;
    state.thrown = {};
    state.kept = {};
    state.saidCount = [];
    state.go = [];
    // The deal moves, because the crib is worth having and always having it
    // would decide the game before a card was played.
    state.dealer = (state.hand - 1) % state.seats.length;
    state.turn = (state.dealer + 1) % state.seats.length;
    state.said = 'Throw two into the crib.';
  },

  act(state, seat, action) {
    if (state.phase2 === 'throwing') {
      if (action.type !== 'throw') return;
      const cards = Array.isArray(action.cards) ? [...new Set(action.cards)] : [];
      if (cards.length !== 2 || !cards.every((c) => seat.hand.includes(c))) return;
      if (state.thrown[seat.seat]) return;
      for (const c of cards) seat.hand.splice(seat.hand.indexOf(c), 1);
      state.thrown[seat.seat] = cards;
      state.crib.push(...cards);
      state.kept[seat.seat] = [...seat.hand];
      state.said = `${seat.name} has thrown.`;
      state.dirty = true;

      if (Object.keys(state.thrown).length >= state.seats.length) {
        state.cut = state.deck.pop();
        state.phase2 = 'pegging';
        state.turn = (state.dealer + 1) % state.seats.length;
        // A jack cut is two for the dealer, before a card is played.
        if (rankOf(state.cut) === 'J') {
          const d = state.seats[state.dealer];
          d.score += 2;
          state.log.push(`${d.name} takes two for his heels.`);
        }
        state.said = `Cut: the ${sayCard(state.cut)}. Play to thirty-one.`;
      }
      return;
    }

    if (state.phase2 !== 'pegging') return;
    if (state.seats[state.turn]?.id !== seat.id) return;

    if (action.type === 'go') {
      if (seat.hand.some((c) => state.total + pip(c) <= 31)) return;   // you could play
      if (!state.go.includes(seat.seat)) state.go.push(seat.seat);
      state.said = `${seat.name} says go.`;
      afterPeg(state, seat, 0);
      return;
    }

    if (action.type !== 'play') return;
    const card = String(action.card ?? '');
    if (!seat.hand.includes(card)) return;
    if (state.total + pip(card) > 31) return;

    seat.hand.splice(seat.hand.indexOf(card), 1);
    state.run.push({ seat: seat.seat, card });
    state.total += pip(card);

    let got = 0;
    if (state.total === 15) got += 2;
    if (state.total === 31) got += 2;
    got += pegPairs(state);
    got += pegRun(state);
    if (got) {
      seat.score += got;
      state.log.push(`${seat.name} pegs ${got}.`);
    }
    state.said = `${seat.name} plays the ${sayCard(card)} — ${state.total}.`;
    afterPeg(state, seat, got);
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat) return;
    if (state.phase2 === 'throwing') {
      if (state.thrown[seat.seat]) return;
      cribbage.__spec.act(state, seat, { type: 'throw', cards: seat.hand.slice(0, 2) });
      return;
    }
    const can = seat.hand.filter((c) => state.total + pip(c) <= 31);
    if (can.length) cribbage.__spec.act(state, seat, { type: 'play', card: can[0] });
    else cribbage.__spec.act(state, seat, { type: 'go' });
  },

  handOver: (state) => state.phase2 === 'counting',

  scoreHand(state) {
    const said = [];
    // Non-dealer counts first — which matters when somebody is close to the
    // target, because the game ends the moment it is reached.
    const order = [
      ...state.seats.filter((s) => s.seat !== state.dealer),
      ...state.seats.filter((s) => s.seat === state.dealer),
    ];
    for (const s of order) {
      const kept = state.kept[s.seat] ?? [];
      const { points, parts } = countHand(kept, state.cut, false);
      s.score += points;
      said.push(`${s.name} ${points}`);
      state.saidCount.push({ name: s.name, points, parts, cards: kept, crib: false });
    }
    const dealer = state.seats[state.dealer];
    if (dealer) {
      const { points, parts } = countHand(state.crib, state.cut, true);
      dealer.score += points;
      said.push(`crib ${points}`);
      state.saidCount.push({ name: dealer.name, points, parts, cards: state.crib, crib: true });
    }
    const winner = state.seats.find((s) => s.score >= TARGET);
    if (winner) { winner.won += 1; state.over = true; }
    state.said = said.join(' · ');
    state.log.push(state.said);
  },

  table(state) {
    return {
      stage: state.phase2,
      crib: state.crib.length,
      cut: state.cut,
      total: state.total,
      run: state.run.map((r) => ({ seat: r.seat, card: r.card })),
      dealer: state.dealer,
      dealerName: state.seats[state.dealer]?.name ?? '',
      target: TARGET,
      counts: state.saidCount,
      thrown: state.seats.map((s) => ({ seat: s.seat, done: Boolean(state.thrown[s.seat]) })),
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    return {
      stage: state.phase2,
      // Which cards could legally go down without busting thirty-one.
      playable: state.phase2 === 'pegging'
        ? seat.hand.filter((c) => state.total + pip(c) <= 31)
        : seat.hand,
      mustSayGo: state.phase2 === 'pegging' && seat.hand.length > 0
        && !seat.hand.some((c) => state.total + pip(c) <= 31),
      isDealer: seat.seat === state.dealer,
      thrown: Boolean(state.thrown[seat.seat]),
    };
  },
});

/** Pairs made by the cards at the end of the current run. */
function pegPairs(state) {
  const cards = state.run.map((r) => r.card);
  let same = 1;
  for (let i = cards.length - 2; i >= 0; i--) {
    if (rankOf(cards[i]) === rankOf(cards[cards.length - 1])) same += 1;
    else break;
  }
  return same === 2 ? 2 : same === 3 ? 6 : same === 4 ? 12 : 0;
}

/** The longest run ending at the last card played. Order does not matter. */
function pegRun(state) {
  const cards = state.run.map((r) => r.card);
  for (let len = cards.length; len >= 3; len--) {
    const tail = cards.slice(-len).map((c) => at(rankOf(c))).sort((a, b) => a - b);
    if (new Set(tail).size !== tail.length) continue;
    if (tail.every((n, i) => i === 0 || n === tail[i - 1] + 1)) return len;
  }
  return 0;
}

function afterPeg(state, seat, got) {
  const others = state.seats.filter((s) => s.seat !== seat.seat);
  const anyoneCanPlay = state.seats.some((s) => s.hand.some((c) => state.total + pip(c) <= 31));

  if (!anyoneCanPlay) {
    // Last card down takes one, unless they already had thirty-one for two.
    if (state.total !== 31 && state.run.length) {
      const last = state.seats.find((s) => s.seat === state.run[state.run.length - 1].seat);
      if (last) { last.score += 1; state.log.push(`${last.name} takes one for last.`); }
    }
    state.run = [];
    state.total = 0;
    state.go = [];
  }
  void got;

  if (state.seats.every((s) => s.hand.length === 0)) {
    state.phase2 = 'counting';
    state.dirty = true;
    return;
  }
  // Hand on to somebody who can actually play.
  let to = state.turn;
  for (let i = 0; i < state.seats.length; i++) {
    to = (to + 1) % state.seats.length;
    const s = state.seats[to];
    if (s.hand.some((c) => state.total + pip(c) <= 31)) break;
  }
  passTurn(state, to);
  void others;
  void inPlay;
}

export default cribbage;
