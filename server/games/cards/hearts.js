// Hearts.
//
// Follow the suit led if you can. Every heart is a point against you and the
// queen of spades is thirteen. Lowest score wins, so this is the one game in
// the room you are trying to lose.
//
// Three rules here are the ones every implementation gets wrong, so each is
// enforced on the server and each has a reason written next to it:
//
//   you may not lead hearts until they are broken
//   you may not throw a point on the very first trick
//   and if you take every single point, everybody else takes twenty-six
//
// That last one is why the scoring cannot just be "add up what you took".
// Shooting the moon turns the whole hand inside out, and a version without it
// is a version where the only strategy is to duck everything.

import {
  createCardGame, inPlay, dealAround, passTurn,
  rankOf, suitOf, sayCard, RANKS,
} from './kit.js';

const worth = (card) => (suitOf(card) === 'h' ? 1 : card === 'Qs' ? 13 : 0);
const high = (card) => RANKS.indexOf(rankOf(card));

export const hearts = createCardGame({
  id: 'hearts',
  name: 'Hearts',
  tagline: 'Every heart is a point against you. Lowest wins.',
  emoji: '💔',
  accent: '#8e44ad',
  face: 'hearts',
  minPlayers: 3,
  maxPlayers: 4,
  hands: 4,
  turnSeconds: 25,

  howToPlay: [
    'Follow the suit that was led if you have it. If you cannot, throw anything.',
    'Every heart costs you a point. The queen of spades costs thirteen.',
    'Nobody may lead a heart until one has been thrown on somebody else’s trick.',
    'Take every single point in a hand and it goes the other way — everybody else gets twenty-six.',
    'Lowest score at the end wins. You are trying to lose.',
  ],

  init(state) {
    state.trick = [];
    state.led = null;
    state.broken = false;
    state.taken = {};
    state.lastTrick = null;
  },

  deal(state) {
    const each = Math.floor(52 / state.seats.length);
    dealAround(state, each);
    // Three-handed leaves an odd card. It goes to the first trick's winner
    // rather than out of play, so the points in the pack always add to 26.
    state.spare = state.deck.splice(0, state.deck.length);
    state.trick = [];
    state.led = null;
    state.broken = false;
    state.taken = Object.fromEntries(state.seats.map((s) => [s.seat, []]));
    state.lastTrick = null;
    // Two of clubs leads, as it always has.
    const opener = state.seats.find((s) => s.hand.includes('2c'));
    state.turn = opener?.seat ?? 0;
    state.said = opener ? `${opener.name} leads with the two of clubs.` : 'Lead away.';
  },

  act(state, seat, action) {
    if (action.type !== 'play') return;
    if (state.seats[state.turn]?.id !== seat.id) return;
    const card = String(action.card ?? '');
    if (!seat.hand.includes(card)) return;
    if (!legal(state, seat, card)) return;
    put(state, seat, card);
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat?.hand.length) return;
    // Play the lowest legal card. Nothing clever, and never accidentally the
    // queen when something else would do.
    const ok = seat.hand.filter((c) => legal(state, seat, c));
    const pick = (ok.length ? ok : seat.hand)
      .sort((a, b) => worth(a) - worth(b) || high(a) - high(b))[0];
    state.log.push(`${seat.name} was away — played low.`);
    put(state, seat, pick);
  },

  handOver: (state) => state.seats.every((s) => s.hand.length === 0) && state.trick.length === 0,

  scoreHand(state) {
    const points = {};
    for (const s of state.seats) {
      points[s.seat] = (state.taken[s.seat] ?? []).reduce((sum, c) => sum + worth(c), 0);
    }
    const total = Object.values(points).reduce((a, b) => a + b, 0);
    const shooter = state.seats.find((s) => points[s.seat] === 26 && total === 26);

    if (shooter) {
      // Inside out. Everybody else takes the lot.
      for (const s of state.seats) s.score += s.seat === shooter.seat ? 0 : 26;
      shooter.won += 1;
      state.said = `${shooter.name} shot the moon. Everybody else takes twenty-six.`;
    } else {
      for (const s of state.seats) s.score += points[s.seat];
      const cleanest = Math.min(...state.seats.map((s) => points[s.seat]));
      for (const s of state.seats) if (points[s.seat] === cleanest) s.won += 1;
      state.said = state.seats
        .map((s) => `${s.name} ${points[s.seat]}`)
        .join(' · ');
    }
    state.log.push(state.said);
  },

  // In Hearts the lowest total wins, which is the opposite of every other
  // scoreboard in the studio — so the ordering has to be said explicitly or the
  // winner is announced as the loser.
  rank: (a, b) => a.score - b.score || b.won - a.won,

  table(state) {
    return {
      trick: state.trick.map((t) => ({ seat: t.seat, name: t.name, card: t.card })),
      led: state.led,
      broken: state.broken,
      lastTrick: state.lastTrick,
      lowestWins: true,
      taken: state.seats.map((s) => ({
        seat: s.seat, name: s.name,
        points: (state.taken[s.seat] ?? []).reduce((sum, c) => sum + worth(c), 0),
        hearts: (state.taken[s.seat] ?? []).filter((c) => suitOf(c) === 'h').length,
        queen: (state.taken[s.seat] ?? []).includes('Qs'),
      })),
    };
  },

  mine(state, seat) {
    if (!seat) return { playable: [] };
    // Worked out here so the client greys out exactly what the server would
    // refuse. Two places deciding what is legal is two places to disagree.
    return { playable: seat.hand.filter((c) => legal(state, seat, c)) };
  },
});

/** Everything the rules forbid, in one place. */
function legal(state, seat, card) {
  const leading = state.trick.length === 0;
  const first = state.seats.every((s) => s.hand.length + (state.taken[s.seat]?.length ?? 0) >= 0) && isFirstTrick(state);

  if (leading) {
    if (first) return card === '2c';
    if (suitOf(card) === 'h' && !state.broken) {
      // Unless hearts are all you have left, in which case you must.
      return seat.hand.every((c) => suitOf(c) === 'h');
    }
    return true;
  }

  const must = state.led;
  const canFollow = seat.hand.some((c) => suitOf(c) === must);
  if (canFollow && suitOf(card) !== must) return false;

  // Nothing that costs a point on the opening trick — otherwise the player to
  // the left of the two of clubs can hand the queen straight to whoever leads.
  if (first && worth(card) > 0) {
    const clean = seat.hand.filter((c) => worth(c) === 0 && (!canFollow || suitOf(c) === must));
    if (clean.length) return false;
  }
  return true;
}

const isFirstTrick = (state) =>
  Object.values(state.taken).every((t) => t.length === 0);

function put(state, seat, card) {
  seat.hand.splice(seat.hand.indexOf(card), 1);
  if (!state.trick.length) state.led = suitOf(card);
  if (suitOf(card) === 'h') state.broken = true;
  state.trick.push({ seat: seat.seat, name: seat.name, card });
  state.said = `${seat.name} plays the ${sayCard(card)}.`;
  state.dirty = true;

  if (state.trick.length < inPlay(state).length) {
    passTurn(state);
    return;
  }

  // Highest of the suit led takes it, and everything in it.
  const best = state.trick
    .filter((t) => suitOf(t.card) === state.led)
    .sort((a, b) => high(b.card) - high(a.card))[0];
  const winner = state.seats.find((s) => s.seat === best.seat);
  const cards = state.trick.map((t) => t.card);
  // The odd cards from a three-handed deal ride on the first trick.
  if (state.spare?.length) { cards.push(...state.spare); state.spare = []; }
  (state.taken[winner.seat] ??= []).push(...cards);

  const cost = cards.reduce((sum, c) => sum + worth(c), 0);
  state.lastTrick = {
    cards: state.trick.map((t) => ({ name: t.name, card: t.card })),
    winner: winner.name, points: cost,
  };
  state.said = cost
    ? `${winner.name} takes it — and ${cost} point${cost === 1 ? '' : 's'} with it.`
    : `${winner.name} takes it, clean.`;

  state.trick = [];
  state.led = null;
  passTurn(state, winner.seat);
}

export default hearts;
