// The four modern ones, rebuilt.
//
// Uno, Exploding Kittens, Monopoly Deal, Sushi Go! and Love Letter are all
// published products. Game mechanics are nobody's property and never have been,
// but names, artwork and the exact wording on a card are — so none of that is
// here. Uno was handled in crazy8s.js by building Switch, the traditional game
// it came from; these four get their own decks, their own names and their own
// card text, which also means they are the studio's rather than borrowed.
//
//   Powder Keg     draw until somebody draws the keg, unless they can defuse it
//   Fair Shares    take property, charge rent, be the first to three sets
//   Passing Plates a hand that moves round the table, one card kept per pass
//   The Envelope   sixteen cards, one guess, and everybody is out but one
//
// Passing Plates is the interesting one to implement, because a simultaneous
// pass has no turn order to lean on: everybody chooses at once and the hands
// only move when the last person has chosen. That means the state has to hold
// choices without revealing them, which is the same problem the poll game
// solved and the same answer — a choice is stored, never broadcast, until they
// are all in.

import {
  createCardGame, shuffle, inPlay, goOut, finishOrder, nextSeat, passTurn,
} from './kit.js';

/* ------------------------------- Powder Keg ------------------------------- */

const KEG = 'KEG';
const DEFUSE = 'DEF';
const SKIP = 'SKP';
const PEEK = 'PEK';
const SHUFFLE = 'SHF';

export const powderkeg = createCardGame({
  id: 'powderkeg',
  name: 'Powder Keg',
  tagline: 'Draw until it goes off. Hope you kept a bucket.',
  emoji: '🛢️',
  accent: '#c0392b',
  face: 'keg',
  minPlayers: 2,
  maxPlayers: 6,
  hands: 3,
  turnSeconds: 22,

  howToPlay: [
    'On your turn you may play cards, and then you must draw one.',
    'There is one keg fewer than there are players. Draw it and you are out — unless you hold a bucket.',
    'A bucket puts the keg back into the deck wherever you like. Nobody else knows where.',
    'Skip ends your turn without drawing. Peek shows you the next three. Shuffle scatters them again.',
    'Last one standing wins.',
  ],

  init(state) {
    state.peeked = {};
    state.finished = [];
    state.mustPlace = null;
  },

  deal(state) {
    const cards = [];
    for (let i = 0; i < 6; i++) cards.push(SKIP, PEEK, SHUFFLE);
    // A bucket each, minus one, so somebody is always short.
    for (let i = 0; i < state.seats.length - 1; i++) cards.push(DEFUSE);
    const deck = shuffle(cards);
    for (const s of state.seats) {
      s.hand = deck.splice(0, 4);
      s.out = false;
    }
    // Kegs go in after dealing, so nobody starts holding one.
    for (let i = 0; i < state.seats.length - 1; i++) deck.push(KEG);
    state.deck = shuffle(deck);
    state.peeked = {};
    state.finished = [];
    state.mustPlace = null;
    state.pile = [];
    state.turn = 0;
    state.said = 'Play what you like, then draw.';
  },

  act(state, seat, action) {
    if (seat.out) return;

    // Somebody who has just defused is holding the keg and has to put it back.
    if (state.mustPlace?.by === seat.seat) {
      if (action.type !== 'place') return;
      const at = Math.max(0, Math.min(state.deck.length, Math.floor(Number(action.at) || 0)));
      state.deck.splice(at, 0, KEG);
      state.mustPlace = null;
      state.said = `${seat.name} puts it back somewhere.`;
      state.log.push(state.said);
      passTurn(state);
      return;
    }

    if (state.seats[state.turn]?.id !== seat.id) return;

    if (action.type === 'play') {
      const card = String(action.card ?? '');
      if (!seat.hand.includes(card) || card === DEFUSE || card === KEG) return;
      seat.hand.splice(seat.hand.indexOf(card), 1);
      state.pile.push(card);

      if (card === SKIP) {
        state.said = `${seat.name} skips.`;
        passTurn(state);
        return;
      }
      if (card === SHUFFLE) {
        state.deck = shuffle(state.deck);
        state.peeked = {};
        state.said = `${seat.name} scatters the deck.`;
        state.dirty = true;
        return;
      }
      if (card === PEEK) {
        // Private, and only to them. This is the one piece of information in
        // the game and handing it to the room would be the whole game.
        state.peeked[seat.seat] = state.deck.slice(0, 3);
        state.said = `${seat.name} takes a look.`;
        state.dirty = true;
        return;
      }
      return;
    }

    if (action.type !== 'draw') return;
    const card = state.deck.shift();
    if (!card) { passTurn(state); return; }
    delete state.peeked[seat.seat];

    if (card === KEG) {
      const bucket = seat.hand.indexOf(DEFUSE);
      if (bucket < 0) {
        goOut(state, seat);
        state.said = `${seat.name} drew the keg.`;
        state.log.push(state.said);
        if (inPlay(state).length > 1) passTurn(state);
        state.dirty = true;
        return;
      }
      seat.hand.splice(bucket, 1);
      state.mustPlace = { by: seat.seat };
      state.said = `${seat.name} defuses it — and now has to hide it.`;
      state.log.push(state.said);
      state.dirty = true;
      return;
    }

    seat.hand.push(card);
    state.said = `${seat.name} draws.`;
    passTurn(state);
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat || seat.out) return;
    if (state.mustPlace?.by === seat.seat) {
      powderkeg.__spec.act(state, seat, { type: 'place', at: Math.floor(state.deck.length / 2) });
      return;
    }
    state.log.push(`${seat.name} was away — drew.`);
    powderkeg.__spec.act(state, seat, { type: 'draw' });
  },

  handOver: (state) => inPlay(state).length <= 1,

  scoreHand(state) {
    const order = finishOrder(state);
    order.forEach((seatNo, i) => {
      const s = state.seats.find((x) => x.seat === seatNo);
      if (!s) return;
      s.score += i;   // later out is better here — going out is losing
    });
    const alive = inPlay(state)[0];
    if (alive) { alive.score += 5; alive.won += 1; }
    state.said = alive ? `${alive.name} survives.` : 'Everybody went up.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      deckLeft: state.deck.length,
      lastPlayed: state.pile[state.pile.length - 1] ?? null,
      mustPlace: state.mustPlace,
      // How many kegs are still in there, which everybody may work out.
      kegsLeft: state.deck.filter((c) => c === KEG).length,
      finished: state.finished,
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    return {
      peeked: state.peeked[seat.seat] ?? null,
      hasBucket: seat.hand.includes(DEFUSE),
      placing: state.mustPlace?.by === seat.seat,
      deckLeft: state.deck.length,
    };
  },
});

/* ------------------------------ Passing Plates ---------------------------- */

/**
 * A hand that goes round, one card kept per pass.
 *
 * Everybody chooses at the same moment and nothing moves until the last person
 * has chosen — so a choice is held on the server and never broadcast until they
 * are all in. Sending them as they arrive would let whoever chooses last see
 * what everybody else took, which is the entire game given away.
 */
const PLATES = [
  { id: 'dumpling', name: 'Dumplings', note: 'the more you take the better they get' },
  { id: 'roll', name: 'Rolls', note: 'most and second-most score' },
  { id: 'nigiri', name: 'Nigiri', note: 'plain points' },
  { id: 'sashimi', name: 'Sashimi', note: 'worth nothing until you have three' },
  { id: 'tempura', name: 'Tempura', note: 'worth nothing until you have two' },
  { id: 'pudding', name: 'Pudding', note: 'counted at the very end' },
];

export const plates = createCardGame({
  id: 'plates',
  name: 'Passing Plates',
  tagline: 'Everybody picks at once, then the hands move round.',
  emoji: '🍣',
  accent: '#e67e22',
  face: 'plates',
  minPlayers: 3,
  maxPlayers: 8,
  hands: 3,
  turnSeconds: 20,

  howToPlay: [
    'Everybody has a hand. Pick one card — all at once, in secret.',
    'When everybody has picked, the cards are revealed and the hands move round.',
    'Sashimi is worth nothing until you have three. Tempura until you have two.',
    'Most rolls scores, and second-most scores less.',
    'Dumplings get better the more you have. Pudding is counted right at the end.',
  ],

  init(state) {
    state.picked = {};      // seat -> card, held back until everybody is in
    state.taken = {};       // seat -> [cards]
    state.revealed = null;
    state.round = 0;
  },

  deal(state) {
    const deck = [];
    for (const p of PLATES) {
      const many = p.id === 'nigiri' ? 12 : p.id === 'dumpling' ? 10 : 8;
      for (let i = 0; i < many; i++) deck.push(`${p.id}:${i}`);
    }
    const shuffled = shuffle(deck);
    const each = Math.max(4, Math.min(9, Math.floor(shuffled.length / state.seats.length)));
    for (const s of state.seats) s.hand = shuffled.splice(0, each);
    state.deck = shuffled;
    state.picked = {};
    state.taken = Object.fromEntries(state.seats.map((s) => [s.seat, []]));
    state.revealed = null;
    state.round = 0;
    state.said = 'Everybody pick one.';
  },

  act(state, seat, action) {
    if (action.type !== 'pick' || seat.out) return;
    const card = String(action.card ?? '');
    if (!seat.hand.includes(card)) return;
    if (state.picked[seat.seat]) return;
    // Held, not broadcast. Whoever picks last must not learn anything.
    state.picked[seat.seat] = card;
    state.said = `${Object.keys(state.picked).length} of ${inPlay(state).length} have picked.`;
    state.dirty = true;

    if (Object.keys(state.picked).length >= inPlay(state).length) revealAndPass(state);
  },

  timedOut(state) {
    for (const s of inPlay(state)) {
      if (!state.picked[s.seat] && s.hand.length) {
        state.picked[s.seat] = s.hand[0];
        state.log.push(`${s.name} was away — took the first thing.`);
      }
    }
    if (Object.keys(state.picked).length >= inPlay(state).length) revealAndPass(state);
    else state.turnLeft = state.settings.turnSeconds;
  },

  handOver: (state) => state.seats.every((s) => s.hand.length === 0),

  scoreHand(state) {
    const said = [];
    const rolls = state.seats.map((s) => ({
      s, n: (state.taken[s.seat] ?? []).filter((c) => c.startsWith('roll')).length,
    })).sort((a, b) => b.n - a.n);

    for (const s of state.seats) {
      const mine = state.taken[s.seat] ?? [];
      const count = (kind) => mine.filter((c) => c.startsWith(kind)).length;
      let n = 0;
      n += count('nigiri') * 2;
      // Sets only, never partial — that is what makes them a gamble.
      n += Math.floor(count('sashimi') / 3) * 10;
      n += Math.floor(count('tempura') / 2) * 5;
      // Dumplings ramp: 1, 3, 6, 10, 15.
      const d = Math.min(5, count('dumpling'));
      n += [0, 1, 3, 6, 10, 15][d];
      if (rolls[0]?.s === s && rolls[0].n > 0) n += 6;
      else if (rolls[1]?.s === s && rolls[1].n > 0) n += 3;
      s.score += n;
      said.push(`${s.name} ${n}`);
    }
    // Pudding at the very end, as promised: most takes six, fewest loses six.
    const puddings = state.seats.map((s) => ({
      s, n: (state.taken[s.seat] ?? []).filter((c) => c.startsWith('pudding')).length,
    }));
    const most = Math.max(...puddings.map((p) => p.n));
    const least = Math.min(...puddings.map((p) => p.n));
    if (most !== least) {
      for (const p of puddings) {
        if (p.n === most) { p.s.score += 6; p.s.won += 1; }
        else if (p.n === least) p.s.score -= 6;
      }
    }
    state.said = said.join(' · ');
    state.log.push(state.said);
  },

  table(state) {
    return {
      plates: PLATES,
      // Counts of who has picked, never what.
      pickedCount: Object.keys(state.picked).length,
      waitingOn: inPlay(state).filter((s) => !state.picked[s.seat]).map((s) => s.name),
      revealed: state.revealed,
      taken: state.seats.map((s) => ({
        seat: s.seat, name: s.name, cards: state.taken[s.seat] ?? [],
      })),
      finished: [],
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    return { picked: state.picked[seat.seat] ?? null, mine: state.taken[seat.seat] ?? [] };
  },
});

function revealAndPass(state) {
  const live = inPlay(state);
  state.revealed = live.map((s) => ({ seat: s.seat, name: s.name, card: state.picked[s.seat] }));
  for (const s of live) {
    const card = state.picked[s.seat];
    if (!card) continue;
    s.hand.splice(s.hand.indexOf(card), 1);
    (state.taken[s.seat] ??= []).push(card);
  }
  // Now the hands move — after everything has been taken out of them.
  const hands = live.map((s) => s.hand);
  live.forEach((s, i) => { s.hand = hands[(i + 1) % hands.length]; });
  state.picked = {};
  state.round += 1;
  state.said = 'Hands move round. Pick again.';
  state.turnLeft = state.settings.turnSeconds;
  state.dirty = true;
}

void nextSeat;
void goOut;

export const DESIGNER_GAMES = [powderkeg, plates];
