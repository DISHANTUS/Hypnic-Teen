// Spades, Whist and Euchre.
//
// Three trick-taking games, and one honest question: why is Hearts not in here
// with them? Because Hearts is not really a trick-taking game — it is a game
// about *avoiding* what a trick contains, its scoring runs backwards, and
// shooting the moon turns the whole thing inside out. Folding it in would mean
// a factory full of `if (hearts)`, which is two games in a trenchcoat.
//
// These three genuinely are the same game underneath: bid or do not, follow the
// suit led, highest trump takes it or highest of the suit led if nobody trumped.
// What differs is the pack, how trump is decided, and how the score is worked
// out — so those are the three things a game here supplies.
//
// The rule that has to be enforced rather than trusted is following suit. It is
// the one every player knows and the one a client cannot be left to police,
// because renouncing when you could follow is not a rules mistake — it is the
// single most valuable illegal move in every game of this family.

import {
  createCardGame, dealAround, passTurn, inPlay,
  rankOf, suitOf, sayCard, SUITS, RANKS,
} from './kit.js';

const high = (card) => RANKS.indexOf(rankOf(card));

/* ------------------------------- the engine ------------------------------- */

/**
 * @param {object} spec
 * @param {() => string[]} [spec.pack]     a short pack, if not the full 52
 * @param {(state) => void} [spec.setTrump]
 * @param {(state) => void} [spec.score]
 * @param {boolean} [spec.bidding]
 */
function createTrickGame(spec) {
  return createCardGame({
    id: spec.id,
    name: spec.name,
    tagline: spec.tagline,
    emoji: spec.emoji,
    accent: spec.accent,
    face: 'tricks',
    minPlayers: spec.minPlayers ?? 4,
    maxPlayers: spec.maxPlayers ?? 4,
    hands: spec.hands ?? 4,
    turnSeconds: 25,
    howToPlay: spec.howToPlay,

    init(state) {
      state.trick = [];
      state.led = null;
      state.trump = null;
      state.tricks = {};
      state.bids = {};
      state.bidding = false;
      state.lastTrick = null;
    },

    deal(state) {
      if (spec.pack) {
        // A short pack has to replace the deck the shell already shuffled.
        state.deck = spec.pack();
      }
      const each = spec.each ? spec.each(state) : Math.floor(state.deck.length / state.seats.length);
      dealAround(state, each);
      state.trick = [];
      state.led = null;
      state.tricks = Object.fromEntries(state.seats.map((s) => [s.seat, 0]));
      state.bids = {};
      state.lastTrick = null;
      state.turn = state.hand % state.seats.length;   // the deal moves round
      spec.setTrump?.(state);
      state.bidding = Boolean(spec.bidding);
      state.said = state.bidding
        ? 'Say how many you will take.'
        : `Trump is ${state.trump ?? 'nothing'}. Lead away.`;
    },

    act(state, seat, action) {
      if (state.bidding) {
        if (action.type !== 'bid') return;
        const n = Math.floor(Number(action.tricks));
        if (!Number.isFinite(n) || n < 0 || n > seat.hand.length) return;
        state.bids[seat.seat] = n;
        state.said = `${seat.name} says ${n}.`;
        if (Object.keys(state.bids).length >= inPlay(state).length) {
          state.bidding = false;
          state.said = `Trump is ${state.trump}. Lead away.`;
        }
        state.dirty = true;
        return;
      }

      if (action.type !== 'play') return;
      if (state.seats[state.turn]?.id !== seat.id) return;
      const card = String(action.card ?? '');
      if (!seat.hand.includes(card)) return;
      if (!legal(state, seat, card)) return;
      put(state, seat, card);
    },

    timedOut(state) {
      if (state.bidding) {
        // Everybody who has not said anything says one. Bidding nothing is a
        // real bid with real consequences, so it must not be the default for
        // somebody who simply was not there.
        for (const s of inPlay(state)) if (state.bids[s.seat] === undefined) state.bids[s.seat] = 1;
        state.bidding = false;
        state.said = `Trump is ${state.trump}. Lead away.`;
        state.turnLeft = state.settings.turnSeconds;
        state.dirty = true;
        return;
      }
      const seat = state.seats[state.turn];
      if (!seat?.hand.length) return;
      const ok = seat.hand.filter((c) => legal(state, seat, c));
      const pick = (ok.length ? ok : seat.hand).sort((a, b) => powerOf(state, a) - powerOf(state, b))[0];
      state.log.push(`${seat.name} was away — played low.`);
      put(state, seat, pick);
    },

    handOver: (state) => !state.bidding && state.seats.every((s) => s.hand.length === 0) && state.trick.length === 0,

    scoreHand(state) {
      spec.score(state);
      state.log.push(state.said);
    },

    table(state) {
      return {
        trick: state.trick.map((t) => ({ seat: t.seat, name: t.name, card: t.card })),
        led: state.led,
        trump: state.trump,
        bidding: state.bidding,
        lastTrick: state.lastTrick,
        bids: state.seats.map((s) => ({
          seat: s.seat, name: s.name,
          bid: state.bids[s.seat] ?? null,
          took: state.tricks[s.seat] ?? 0,
        })),
      };
    },

    mine(state, seat) {
      if (!seat) return { playable: [] };
      // Worked out here so the client dims exactly what the server would
      // refuse. Two places deciding what is legal is two places to disagree.
      return {
        playable: state.bidding ? [] : seat.hand.filter((c) => legal(state, seat, c)),
        bid: state.bids[seat.seat] ?? null,
        took: state.tricks[seat.seat] ?? 0,
        maxBid: seat.hand.length,
      };
    },
  });
}

/**
 * What suit a card counts as, which is not always the one printed on it.
 *
 * Euchre moves one jack into the trump suit outright, so a player asked to
 * follow diamonds while hearts are trump may not play the jack of diamonds —
 * it is a heart now. Every suit question in this file goes through here.
 */
const suitAs = (state, card) => (state.asSuit ? state.asSuit(state, card) : suitOf(card));
const powerOf = (state, card) => (state.asPower ? state.asPower(state, card) : high(card));

/** Follow the suit led if you can. The one rule worth enforcing here. */
function legal(state, seat, card) {
  if (!state.trick.length) return true;
  const must = state.led;
  if (suitAs(state, card) === must) return true;
  return !seat.hand.some((c) => suitAs(state, c) === must);
}

function put(state, seat, card) {
  seat.hand.splice(seat.hand.indexOf(card), 1);
  if (!state.trick.length) state.led = suitAs(state, card);
  state.trick.push({ seat: seat.seat, name: seat.name, card });
  state.said = `${seat.name} plays the ${sayCard(card)}.`;
  state.dirty = true;

  if (state.trick.length < inPlay(state).length) { passTurn(state); return; }

  // Highest trump takes it; failing that, highest of the suit led.
  const trumped = state.trick.filter((t) => suitAs(state, t.card) === state.trump);
  const pool = trumped.length ? trumped : state.trick.filter((t) => suitAs(state, t.card) === state.led);
  const best = [...pool].sort((a, b) => powerOf(state, b.card) - powerOf(state, a.card))[0];
  const winner = state.seats.find((s) => s.seat === best.seat);

  state.tricks[winner.seat] = (state.tricks[winner.seat] ?? 0) + 1;
  state.lastTrick = {
    cards: state.trick.map((t) => ({ name: t.name, card: t.card })),
    winner: winner.name,
    trumped: trumped.length > 0,
  };
  state.said = trumped.length
    ? `${winner.name} trumps it.`
    : `${winner.name} takes it.`;
  state.trick = [];
  state.led = null;
  passTurn(state, winner.seat);
}

/* --------------------------------- Spades --------------------------------- */

export const spades = createTrickGame({
  id: 'spades',
  name: 'Spades',
  tagline: 'Say how many you will take, then take exactly that many.',
  emoji: '♠️',
  accent: '#2c3e50',
  bidding: true,
  minPlayers: 3,
  maxPlayers: 4,
  hands: 4,
  howToPlay: [
    'Spades are always trump. Nothing else ever is.',
    'Before play, say how many tricks you will take.',
    'Follow the suit led if you can. Highest spade takes it, or highest of the suit led.',
    'Make your bid exactly and you score ten a trick. Miss it and you lose ten a trick.',
    'Taking more than you said is not a win — it is one point each and it will cost you later.',
  ],
  setTrump(state) { state.trump = 's'; },
  score(state) {
    const said = [];
    for (const s of state.seats) {
      const bid = state.bids[s.seat] ?? 0;
      const took = state.tricks[s.seat] ?? 0;
      if (took >= bid) {
        // Bid made. Overtricks are worth almost nothing, which is the whole
        // shape of the game: you are trying to be exact, not greedy.
        s.score += bid * 10 + (took - bid);
        if (took === bid) s.won += 1;
      } else {
        s.score -= bid * 10;
      }
      said.push(`${s.name} ${took}/${bid}`);
    }
    state.said = said.join(' · ');
  },
});

/* --------------------------------- Whist ---------------------------------- */

export const whist = createTrickGame({
  id: 'whist',
  name: 'Whist',
  tagline: 'No bidding, no fuss. The last card dealt decides trump.',
  emoji: '🃏',
  accent: '#27ae60',
  bidding: false,
  minPlayers: 3,
  maxPlayers: 4,
  hands: 4,
  howToPlay: [
    'No bidding. Just take as many tricks as you can.',
    'The last card dealt is turned face up and its suit is trump for the hand.',
    'Follow the suit led if you can. Highest trump takes it, or highest of the suit led.',
    'A point a trick above six. Simple and very old.',
  ],
  each: (state) => Math.floor(51 / state.seats.length),
  setTrump(state) {
    // The last card of the deal is turned up and stays up. Traditional, and it
    // means trump is known to everybody before a single card is played.
    const turned = state.deck.pop();
    state.trump = turned ? suitOf(turned) : SUITS[0];
    state.turnedUp = turned ?? null;
  },
  score(state) {
    const said = [];
    // Six tricks are "the book" and score nothing. Everything above counts.
    const par = Math.floor((52 / state.seats.length) / 2);
    for (const s of state.seats) {
      const took = state.tricks[s.seat] ?? 0;
      s.score += Math.max(0, took - par);
      said.push(`${s.name} ${took}`);
    }
    const best = Math.max(...state.seats.map((s) => state.tricks[s.seat] ?? 0));
    for (const s of state.seats) if ((state.tricks[s.seat] ?? 0) === best) s.won += 1;
    state.said = said.join(' · ');
  },
});

/* --------------------------------- Euchre --------------------------------- */

/**
 * Euchre's short pack, and its one genuinely strange rule.
 *
 * The jack of the trump suit is the highest card in the game, and the *other*
 * jack of the same colour stops being its own suit and becomes trump too. So
 * when hearts are trump the jack of diamonds is a heart, and a player holding
 * it who is asked to follow diamonds may not play it — it is not a diamond any
 * more. Getting this wrong does not crash anything; it just means the game is
 * not Euchre.
 */
const SAME_COLOUR = { s: 'c', c: 's', h: 'd', d: 'h' };
const euchrePack = () => {
  const cards = [];
  for (const suit of SUITS) for (const rank of ['9', 'T', 'J', 'Q', 'K', 'A']) cards.push(`${rank}${suit}`);
  return cards.sort(() => Math.random() - 0.5);
};

export const euchre = createTrickGame({
  id: 'euchre',
  name: 'Euchre',
  tagline: 'Twenty-four cards, and the jacks are not what they look like.',
  emoji: '🎴',
  accent: '#8e44ad',
  bidding: false,
  minPlayers: 4,
  maxPlayers: 4,
  hands: 5,
  howToPlay: [
    'Only the nine up to the ace — twenty-four cards, five each.',
    'The jack of trump is the highest card in the game.',
    'The other jack of the same colour becomes trump too, and stops being its own suit.',
    'Follow the suit led if you can. Highest trump takes it.',
    'Most tricks takes the hand. Take all five and it is worth double.',
  ],
  pack: euchrePack,
  each: () => 5,
  setTrump(state) {
    const turned = state.deck.pop();
    state.trump = turned ? suitOf(turned) : SUITS[0];
    state.turnedUp = turned ?? null;
    state.leftBower = `J${SAME_COLOUR[state.trump]}`;
    // Both of these are set on the state rather than baked into the engine,
    // because they are true of this game and no other one in the file.
    state.asSuit = (st, card) => (card === st.leftBower ? st.trump : suitOf(card));
    state.asPower = (st, card) => {
      if (card === `J${st.trump}`) return 100;    // the right bower, highest card in the game
      if (card === st.leftBower) return 99;        // and its partner, just under it
      return high(card);
    };
  },
  score(state) {
    const counts = state.seats.map((s) => state.tricks[s.seat] ?? 0);
    const best = Math.max(...counts);
    const said = [];
    for (const s of state.seats) {
      const took = state.tricks[s.seat] ?? 0;
      // All five is a march and worth double, which is the one bit of drama
      // in a game otherwise decided by threes.
      s.score += took === 5 ? 10 : took === best ? 3 : took;
      if (took === best) s.won += 1;
      said.push(`${s.name} ${took}`);
    }
    state.said = counts.includes(5)
      ? `A march! ${state.seats.find((s) => (state.tricks[s.seat] ?? 0) === 5)?.name} took all five.`
      : said.join(' · ');
  },
});

export const TRICK_GAMES = [spades, whist, euchre];
