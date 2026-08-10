// The Envelope, and Fair Shares.
//
// The last two rebuilds. Same rule as the others in designer.js: the mechanics
// are nobody's property, the names and card text are, so these have their own.
//
// The Envelope is a deduction game of sixteen cards where you hold exactly one.
// Everything anybody plays is public and the deck is known, so the whole game
// is arithmetic done out loud — which makes one implementation detail decisive:
// a card that is *held* must never reach anybody else, but a card that is
// *played* must reach everybody immediately. Get that boundary wrong in either
// direction and there is no game. Too tight and nobody can deduce anything; too
// loose and there is nothing to deduce.
//
// Fair Shares is a set-collecting game with money and rent. Its own decisive
// detail is that paying rent must come out of what you actually have, and if
// you cannot cover it you hand over everything — including property. A version
// that let you owe money would remove the only real threat in it.

import {
  createCardGame, shuffle, inPlay, goOut, finishOrder, passTurn,
} from './kit.js';

/* ------------------------------ The Envelope ------------------------------ */

/**
 * Sixteen cards, and everybody knows the list.
 *
 * Printed on the table deliberately — this is a deduction game and the deck
 * being public is what makes deduction possible. Hiding it would leave only
 * guessing.
 */
export const ENVELOPE_DECK = [
  { rank: 1, id: 'runner', name: 'Runner', many: 5, note: 'name a card in somebody’s hand — if you are right they are out' },
  { rank: 2, id: 'clerk', name: 'Clerk', many: 2, note: 'look at somebody’s hand' },
  { rank: 3, id: 'rival', name: 'Rival', many: 2, note: 'compare hands — the lower one is out' },
  { rank: 4, id: 'screen', name: 'Screen', many: 2, note: 'nothing can touch you until your next turn' },
  { rank: 5, id: 'courier', name: 'Courier', many: 2, note: 'somebody throws their hand away and draws again' },
  { rank: 6, id: 'minister', name: 'Minister', many: 1, note: 'swap hands with somebody' },
  { rank: 7, id: 'duchess', name: 'Duchess', many: 1, note: 'must be played if you also hold the Minister or the Courier' },
  { rank: 8, id: 'heir', name: 'Heir', many: 1, note: 'play this and you are out' },
];

const byId = Object.fromEntries(ENVELOPE_DECK.map((c) => [c.id, c]));
const cardRank = (card) => byId[String(card).split(':')[0]]?.rank ?? 0;
const cardId = (card) => String(card).split(':')[0];

function envelopeDeck() {
  const cards = [];
  for (const c of ENVELOPE_DECK) for (let i = 0; i < c.many; i++) cards.push(`${c.id}:${i}`);
  return shuffle(cards);
}

export const envelope = createCardGame({
  id: 'envelope',
  name: 'The Envelope',
  tagline: 'Sixteen cards, one in your hand, and everybody is counting.',
  emoji: '✉️',
  accent: '#8e44ad',
  face: 'envelope',
  minPlayers: 2,
  maxPlayers: 6,
  hands: 5,
  turnSeconds: 25,

  howToPlay: [
    'You hold one card. On your turn draw a second and play one of them.',
    'Every card does something, and everything played goes face up where everyone can see.',
    'Name somebody’s card correctly with a Runner and they are out.',
    'The whole deck is printed on the table. Counting what has gone is the game.',
    'Last one left, or the highest card when the deck runs out, takes the round.',
  ],

  init(state) {
    state.discarded = [];   // public, in order
    state.screened = [];    // seats currently untouchable
    state.looked = {};      // seat -> what a Clerk showed them, privately
    state.finished = [];
    state.mustPlay = null;
  },

  deal(state) {
    const deck = envelopeDeck();
    // One card set aside face down, so the deck can never be fully deduced.
    state.burned = deck.pop();
    for (const s of state.seats) {
      s.hand = [deck.pop()].filter(Boolean);
      s.out = false;
    }
    state.deck = deck;
    state.discarded = [];
    state.screened = [];
    state.looked = {};
    state.finished = [];
    state.mustPlay = null;
    state.turn = state.hand % state.seats.length;
    state.said = 'Draw one, play one.';
    drawForTurn(state);
  },

  act(state, seat, action) {
    if (action.type !== 'play' || seat.out) return;
    if (state.seats[state.turn]?.id !== seat.id) return;
    if (seat.hand.length < 2) return;

    const card = String(action.card ?? '');
    if (!seat.hand.includes(card)) return;

    // The Duchess must go if you are also holding the Minister or the Courier.
    // Enforced, because it is the one rule people forget and it is the only
    // thing stopping the Heir being trivially safe.
    const ids = seat.hand.map(cardId);
    if (ids.includes('duchess') && (ids.includes('minister') || ids.includes('courier'))
        && cardId(card) !== 'duchess') return;

    seat.hand.splice(seat.hand.indexOf(card), 1);
    state.discarded.push({ seat: seat.seat, name: seat.name, card });
    // Playing is public the instant it happens. That is the information the
    // whole game runs on.
    state.said = `${seat.name} plays the ${byId[cardId(card)]?.name ?? card}.`;
    state.screened = state.screened.filter((n) => n !== seat.seat);

    applyEffect(state, seat, card, action);

    if (inPlay(state).length <= 1 || state.deck.length === 0) { state.dirty = true; return; }
    passTurn(state);
    drawForTurn(state);
    state.dirty = true;
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat || seat.out || seat.hand.length < 2) return;
    // Play the lower card, which is almost always the safe one and is never
    // the Heir.
    const pick = [...seat.hand].sort((a, b) => cardRank(a) - cardRank(b))[0];
    state.log.push(`${seat.name} was away — played low.`);
    envelope.__spec.act(state, seat, { type: 'play', card: pick, at: nextLiveSeat(state, seat), guess: 'runner' });
  },

  handOver: (state) => inPlay(state).length <= 1 || (state.deck.length === 0 && state.seats.every((s) => s.hand.length <= 1)),

  scoreHand(state) {
    const alive = inPlay(state);
    let winner = alive[0] ?? null;
    if (alive.length > 1) {
      // Deck ran out: highest card takes it.
      winner = [...alive].sort((a, b) => cardRank(b.hand[0]) - cardRank(a.hand[0]))[0];
    }
    if (winner) { winner.score += 3; winner.won += 1; }
    for (const s of state.seats) if (s !== winner && !s.out) s.score += 1;
    state.said = winner ? `${winner.name} takes the round.` : 'Nobody left standing.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      // The whole deck, printed, because deduction needs it.
      deckIs: ENVELOPE_DECK.map((c) => ({ id: c.id, name: c.name, rank: c.rank, many: c.many, note: c.note })),
      discarded: state.discarded.map((d) => ({ seat: d.seat, name: d.name, card: cardId(d.card) })),
      screened: state.screened,
      deckLeft: state.deck.length,
      finished: state.finished,
      alive: inPlay(state).map((s) => ({ seat: s.seat, name: s.name })),
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    return {
      // Only ever your own, and whatever a Clerk showed you privately.
      cards: seat.hand.map((c) => ({ code: c, id: cardId(c), name: byId[cardId(c)]?.name, rank: cardRank(c) })),
      looked: state.looked[seat.seat] ?? null,
      screened: state.screened.includes(seat.seat),
      targets: inPlay(state)
        .filter((s) => s.seat !== seat.seat && !state.screened.includes(s.seat))
        .map((s) => ({ seat: s.seat, name: s.name })),
    };
  },
});

const nextLiveSeat = (state, seat) =>
  inPlay(state).find((s) => s.seat !== seat.seat)?.seat ?? seat.seat;

function drawForTurn(state) {
  const seat = state.seats[state.turn];
  if (!seat || seat.out) return;
  if (!state.deck.length) return;
  seat.hand.push(state.deck.pop());
}

function applyEffect(state, seat, card, action) {
  const id = cardId(card);
  const targetSeat = Number(action.at);
  const target = state.seats.find((s) => s.seat === targetSeat && !s.out);
  const reachable = target && !state.screened.includes(target.seat) && target.seat !== seat.seat;

  if (id === 'heir') {
    // Play it and you are out. Which is why nobody ever wants to hold it.
    goOut(state, seat);
    state.said += ' And is out.';
    state.log.push(`${seat.name} played the Heir and is out.`);
    return;
  }
  if (id === 'screen') {
    state.screened.push(seat.seat);
    return;
  }
  if (!reachable) return;

  if (id === 'runner') {
    const guess = String(action.guess ?? '');
    // Naming a Runner is never allowed, or the commonest card would be a free
    // one-in-five shot every turn.
    if (guess === 'runner' || !byId[guess]) return;
    if (cardId(target.hand[0]) === guess) {
      state.discarded.push({ seat: target.seat, name: target.name, card: target.hand[0] });
      goOut(state, target);
      state.said += ` Names ${byId[guess].name} — ${target.name} is out.`;
      state.log.push(state.said);
    } else {
      state.said += ` Guesses ${byId[guess].name}. No.`;
    }
    return;
  }

  if (id === 'clerk') {
    // Private, and only to them.
    state.looked[seat.seat] = { of: target.name, card: cardId(target.hand[0]) };
    state.said += ` Looks at ${target.name}.`;
    return;
  }

  if (id === 'rival') {
    const mine = cardRank(seat.hand[0]);
    const theirs = cardRank(target.hand[0]);
    if (mine === theirs) { state.said += ' Level — nothing happens.'; return; }
    const loser = mine < theirs ? seat : target;
    state.discarded.push({ seat: loser.seat, name: loser.name, card: loser.hand[0] });
    goOut(state, loser);
    state.said += ` ${loser.name} is out.`;
    state.log.push(state.said);
    return;
  }

  if (id === 'courier') {
    const thrown = target.hand.pop();
    if (thrown) state.discarded.push({ seat: target.seat, name: target.name, card: thrown });
    if (cardId(thrown) === 'heir') {
      goOut(state, target);
      state.said += ` ${target.name} throws the Heir and is out.`;
      state.log.push(state.said);
      return;
    }
    const fresh = state.deck.pop() ?? state.burned;
    if (fresh) target.hand.push(fresh);
    state.said += ` ${target.name} throws theirs and draws again.`;
    return;
  }

  if (id === 'minister') {
    const mine = seat.hand;
    seat.hand = target.hand;
    target.hand = mine;
    state.said += ` Swaps with ${target.name}.`;
  }
}

/* ------------------------------- Fair Shares ------------------------------ */

const SETS = [
  { id: 'brown', name: 'Brown', need: 2, rent: [1, 2] },
  { id: 'blue', name: 'Blue', need: 2, rent: [3, 8] },
  { id: 'pink', name: 'Pink', need: 3, rent: [1, 2, 4] },
  { id: 'orange', name: 'Orange', need: 3, rent: [1, 3, 5] },
  { id: 'red', name: 'Red', need: 3, rent: [2, 3, 6] },
  { id: 'green', name: 'Green', need: 3, rent: [2, 4, 7] },
];
const setById = Object.fromEntries(SETS.map((s) => [s.id, s]));

/** Cards are "kind:detail:n" so a code always says what it is. */
const kindOf = (card) => String(card).split(':')[0];
const detailOf = (card) => String(card).split(':')[1];

function sharesDeck() {
  const cards = [];
  for (const s of SETS) for (let i = 0; i < s.need + 1; i++) cards.push(`prop:${s.id}:${i}`);
  for (let i = 0; i < 20; i++) cards.push(`cash:${(i % 4) + 1}:${i}`);
  for (const s of SETS) for (let i = 0; i < 2; i++) cards.push(`rent:${s.id}:${i}`);
  return shuffle(cards);
}

export const fairshares = createCardGame({
  id: 'fairshares',
  name: 'Fair Shares',
  tagline: 'Collect three sets. Charge rent. Pay up or hand over the deeds.',
  emoji: '🏘️',
  accent: '#16a085',
  face: 'shares',
  minPlayers: 2,
  maxPlayers: 5,
  hands: 2,
  turnSeconds: 35,

  howToPlay: [
    'Draw two, then play up to three cards.',
    'Property goes in front of you. Cash goes in your bank.',
    'A rent card charges everybody for a colour you own — the more of that colour you have, the more it costs.',
    'If you cannot pay out of your bank, you hand over property instead.',
    'First to three complete sets wins.',
  ],

  init(state) {
    state.props = {};
    state.bank = {};
    state.played = 0;
    state.owed = null;
    state.finished = [];
  },

  deal(state) {
    state.deck = sharesDeck();
    for (const s of state.seats) { s.hand = state.deck.splice(0, 5); s.out = false; }
    state.props = Object.fromEntries(state.seats.map((s) => [s.seat, []]));
    state.bank = Object.fromEntries(state.seats.map((s) => [s.seat, []]));
    state.played = 0;
    state.owed = null;
    state.finished = [];
    state.turn = state.hand % state.seats.length;
    state.said = 'Draw two, play up to three.';
  },

  act(state, seat, action) {
    // Settling a debt comes before anything else, for anybody who owes.
    if (state.owed && state.owed.from === seat.seat) {
      if (action.type !== 'pay') return;
      return pay(state, seat, action);
    }
    if (state.seats[state.turn]?.id !== seat.id || state.owed) return;

    if (action.type === 'draw') {
      if (state.played > 0) return;
      const got = state.deck.splice(0, 2);
      seat.hand.push(...got);
      state.played = 0.5;   // marks "has drawn" without counting as a play
      state.said = `${seat.name} draws two.`;
      state.dirty = true;
      return;
    }

    if (action.type === 'end') {
      state.played = 0;
      passTurn(state);
      return;
    }

    if (action.type !== 'play') return;
    if (state.played < 0.5 || state.played >= 3.5) return;
    const card = String(action.card ?? '');
    if (!seat.hand.includes(card)) return;

    const kind = kindOf(card);
    if (kind === 'prop' || kind === 'cash') {
      seat.hand.splice(seat.hand.indexOf(card), 1);
      (kind === 'prop' ? state.props[seat.seat] : state.bank[seat.seat]).push(card);
      state.played += 1;
      state.said = `${seat.name} plays ${kind === 'prop' ? setById[detailOf(card)]?.name : 'cash'}.`;
      if (completeSets(state, seat.seat) >= 3) {
        goOut(state, seat);
        state.said = `${seat.name} has three sets and wins.`;
        state.log.push(state.said);
      }
      state.dirty = true;
      return;
    }

    if (kind === 'rent') {
      const colour = detailOf(card);
      const owned = (state.props[seat.seat] ?? []).filter((c) => detailOf(c) === colour).length;
      if (!owned) return;                       // you cannot charge for what you do not own
      seat.hand.splice(seat.hand.indexOf(card), 1);
      state.played += 1;
      const set = setById[colour];
      const amount = set.rent[Math.min(owned, set.rent.length) - 1];
      const debtor = inPlay(state).find((s) => s.seat !== seat.seat);
      if (!debtor) { state.dirty = true; return; }
      state.owed = { from: debtor.seat, to: seat.seat, amount, colour };
      state.said = `${seat.name} charges ${debtor.name} ${amount} for ${set.name}.`;
      state.log.push(state.said);
      state.dirty = true;
    }
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat) return;
    if (state.owed?.from === seat.seat) {
      fairshares.__spec.act(state, seat, { type: 'pay', cards: [] });
      return;
    }
    if (state.played < 0.5) { fairshares.__spec.act(state, seat, { type: 'draw' }); return; }
    fairshares.__spec.act(state, seat, { type: 'end' });
  },

  handOver: (state) => inPlay(state).length <= 1 || state.deck.length === 0,

  scoreHand(state) {
    for (const s of state.seats) {
      const sets = completeSets(state, s.seat);
      s.score += sets * 5 + (state.bank[s.seat] ?? []).length;
      if (sets >= 3) s.won += 1;
    }
    const best = state.seats.map((s) => ({ s, n: completeSets(state, s.seat) })).sort((a, b) => b.n - a.n)[0];
    state.said = best ? `${best.s.name} finished with ${best.n} set${best.n === 1 ? '' : 's'}.` : 'Hand over.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      sets: SETS,
      boards: state.seats.map((s) => ({
        seat: s.seat, name: s.name,
        props: state.props[s.seat] ?? [],
        bank: (state.bank[s.seat] ?? []).reduce((n, c) => n + Number(detailOf(c)), 0),
        complete: completeSets(state, s.seat),
      })),
      owed: state.owed,
      played: Math.floor(state.played),
      deckLeft: state.deck.length,
      finished: state.finished,
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    return {
      owes: state.owed?.from === seat.seat ? state.owed : null,
      mustDraw: state.played < 0.5,
      playsLeft: Math.max(0, 3 - Math.floor(state.played)),
    };
  },
});

/**
 * Pay what you owe, out of what you actually have.
 *
 * If the bank cannot cover it, property goes instead — and if there is nothing
 * at all, the debt is simply written off. Letting somebody owe would remove the
 * only real threat in the game; letting them owe *forever* would stall it.
 */
function pay(state, seat, action) {
  const debt = state.owed;
  const creditor = state.seats.find((s) => s.seat === debt.to);
  const chosen = Array.isArray(action.cards) ? action.cards : [];

  const bank = state.bank[seat.seat] ?? [];
  const props = state.props[seat.seat] ?? [];
  let paid = 0;
  const handedOver = [];

  const give = (card, from) => {
    const at = from.indexOf(card);
    if (at < 0) return;
    from.splice(at, 1);
    handedOver.push(card);
    paid += kindOf(card) === 'cash' ? Number(detailOf(card)) : 2;
  };

  for (const c of chosen) {
    if (paid >= debt.amount) break;
    if (bank.includes(c)) give(c, bank);
    else if (props.includes(c)) give(c, props);
  }
  // Nothing chosen, or not enough: take from the bank, then property.
  while (paid < debt.amount && bank.length) give(bank[0], bank);
  while (paid < debt.amount && props.length) give(props[0], props);

  for (const c of handedOver) {
    (kindOf(c) === 'cash' ? state.bank[creditor.seat] : state.props[creditor.seat]).push(c);
  }
  state.said = handedOver.length
    ? `${seat.name} pays ${paid}.`
    : `${seat.name} has nothing to pay with.`;
  state.log.push(state.said);
  state.owed = null;

  if (completeSets(state, creditor.seat) >= 3) {
    goOut(state, creditor);
    state.log.push(`${creditor.name} has three sets and wins.`);
  }
  state.dirty = true;
}

function completeSets(state, seatNo) {
  const props = state.props[seatNo] ?? [];
  let n = 0;
  for (const set of SETS) {
    if (props.filter((c) => detailOf(c) === set.id).length >= set.need) n += 1;
  }
  return n;
}

void finishOrder;

export const LAST_GAMES = [envelope, fairshares];
