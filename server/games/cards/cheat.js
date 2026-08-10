// Cheat.
//
// You must play the rank the table is on, whether or not you have it. Cards go
// down face down, you say what they are, and anybody may call you a liar. If
// they are right you take the pile; if they are wrong they do.
//
// The whole game is one design decision: **what went down is never sent to
// anybody.** Not greyed out on the client, not present-but-hidden in the state
// — the cards under the claim exist only on the server until somebody pays to
// see them. A version that shipped them and drew card backs would look
// identical and be no game at all, because one person with a console open would
// win every challenge for the rest of the night.
//
// The other decision worth writing down: a challenge is open to everybody at
// once for a few seconds, rather than going round asking. Cheat is a game about
// the moment somebody's face changes, and a polite queue kills it.

import {
  createCardGame, seatOf, inPlay, nextSeat, dealAll, passTurn,
  rankOf, sayRank, RANKS,
} from './kit.js';

/** How long everybody has to shout, once a claim is on the table. */
const CALL_SECONDS = 6;

export const cheat = createCardGame({
  id: 'cheat',
  name: 'Cheat',
  tagline: 'Play the rank whether you have it or not. Somebody will say so.',
  emoji: '🤥',
  accent: '#c0392b',
  face: 'cheat',
  minPlayers: 3,
  maxPlayers: 8,
  hands: 3,
  turnSeconds: 25,

  howToPlay: [
    'The table is on a rank. On your turn you put down one to four cards face down and say they are that rank.',
    'You almost certainly will not have them. Say it anyway.',
    'Anybody can call cheat for a few seconds after. The cards get turned over.',
    'Whoever was wrong picks up the whole pile — the liar if they lied, the caller if they did not.',
    'First to get rid of every card wins the hand.',
  ],

  init(state) {
    state.rank = 'A';
    /** { by, count, cards[], claim } — cards never leave this object. */
    state.claim = null;
    state.callWindow = 0;
    state.called = [];
    state.reveal = null;
  },

  deal(state) {
    dealAll(state);
    state.rank = RANKS[Math.floor(Math.random() * RANKS.length)];
    state.claim = null;
    state.callWindow = 0;
    state.called = [];
    state.reveal = null;
    state.pile = [];
    state.said = `The table is on ${sayRank(state.rank)}s.`;
    // Whoever holds the most cards starts, so the biggest hand gets first go.
    state.turn = [...state.seats].sort((a, b) => b.hand.length - a.hand.length)[0]?.seat ?? 0;
  },

  act(state, seat, action) {
    if (action.type === 'play') return play(state, seat, action);
    if (action.type === 'call') return call(state, seat);
    if (action.type === 'pass' && state.claim) return; // nothing to pass on
  },

  tick(state, dt) {
    if (state.callWindow <= 0) return;
    state.callWindow -= dt;
    if (state.callWindow <= 0) settle(state, null);
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat || state.claim) return;
    // A turn nobody took plays their lowest card, face down, as the rank. It is
    // exactly what a person who had stopped paying attention would do, and it
    // keeps the pile moving rather than stalling on somebody's dead phone.
    if (!seat.hand.length) { passTurn(state); return; }
    const card = [...seat.hand].sort((a, b) => RANKS.indexOf(rankOf(a)) - RANKS.indexOf(rankOf(b)))[0];
    play(state, seat, { type: 'play', cards: [card] }, true);
  },

  handOver: (state) => inPlay(state).some((s) => s.hand.length === 0 && !state.claim),

  scoreHand(state) {
    const done = state.seats.filter((s) => s.hand.length === 0);
    for (const s of done) { s.score += 5; s.won += 1; }
    // Everybody else loses a point a card, so being caught holding twenty at
    // the end is worse than being caught holding two.
    for (const s of state.seats) if (s.hand.length) s.score -= Math.min(10, s.hand.length);
    state.said = done.length ? `${done.map((s) => s.name).join(' and ')} went out.` : 'Nobody went out.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      rank: state.rank,
      pileSize: state.pile.length,
      // The claim, but never what is under it. `count` is public because
      // everybody watched them put that many down; `cards` is not, and is not
      // in this object at all rather than being deleted from it later.
      claim: state.claim && {
        by: state.claim.by,
        byName: state.seats.find((s) => s.seat === state.claim.by)?.name ?? '',
        count: state.claim.count,
        rank: state.claim.rank,
        forced: state.claim.forced,
      },
      callWindow: Math.max(0, Math.ceil(state.callWindow)),
      called: state.called,
      // Only ever set for the couple of seconds after a challenge resolves.
      reveal: state.reveal,
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    return {
      // What you could legally put down as the rank — a convenience, not a
      // restriction. You may play anything.
      holding: seat.hand.filter((c) => rankOf(c) === state.rank).length,
      canCall: Boolean(state.claim) && state.claim.by !== seat.seat && !state.called.includes(seat.seat),
    };
  },
});

function play(state, seat, action, forced = false) {
  if (state.claim) return;                       // a claim is already on the table
  if (state.seats[state.turn]?.id !== seat.id) return;
  const wanted = Array.isArray(action.cards) ? [...new Set(action.cards)] : [];
  if (!wanted.length || wanted.length > 4) return;
  if (!wanted.every((c) => seat.hand.includes(c))) return;

  for (const c of wanted) seat.hand.splice(seat.hand.indexOf(c), 1);
  state.claim = { by: seat.seat, count: wanted.length, cards: wanted, rank: state.rank, forced };
  state.called = [];
  state.callWindow = CALL_SECONDS;
  state.turnLeft = 0;
  state.said = `${seat.name} says ${wanted.length} ${sayRank(state.rank)}${wanted.length === 1 ? '' : 's'}.`;
  state.dirty = true;
}

function call(state, seat) {
  if (!state.claim || state.claim.by === seat.seat) return;
  if (state.called.includes(seat.seat)) return;
  state.called.push(seat.seat);
  // The first shout ends it. Waiting out the window after somebody has called
  // would only let people pile on once the risk is already taken.
  settle(state, seat);
}

/**
 * Turn them over, or let them lie.
 *
 * @param {object|null} caller  the seat that shouted, or null if nobody did
 */
function settle(state, caller) {
  const claim = state.claim;
  if (!claim) return;
  const liar = claim.cards.some((c) => rankOf(c) !== claim.rank);
  const player = state.seats.find((s) => s.seat === claim.by);

  state.pile.push(...claim.cards);

  if (!caller) {
    // Nobody said anything. The cards stay face down forever — this is the one
    // path where a lie is never found out, and it has to leave no trace in the
    // state or a client could diff its way to the truth.
    state.reveal = null;
    state.said = `${player?.name ?? 'They'} got away with it. Maybe.`;
    state.claim = null;
    state.callWindow = 0;
    state.called = [];
    advanceRank(state);
    passTurn(state, nextSeat(state, claim.by));
    state.dirty = true;
    return;
  }

  const wrong = liar ? player : caller;
  const cards = [...state.pile];
  wrong.hand.push(...cards);
  state.pile = [];

  state.reveal = {
    cards: claim.cards,
    rank: claim.rank,
    lied: liar,
    byName: player?.name ?? '',
    callerName: caller.name,
    picksUp: wrong.name,
    count: cards.length,
  };
  state.said = liar
    ? `${caller.name} was right — ${player?.name} takes ${cards.length}.`
    : `They really were ${sayRank(claim.rank)}s. ${caller.name} takes ${cards.length}.`;
  state.log.push(state.said);

  state.claim = null;
  state.callWindow = 0;
  state.called = [];
  advanceRank(state);
  // Whoever picked up starts the next one, which is the traditional rule and
  // also stops the same person being challenged twice in a row.
  passTurn(state, wrong.seat);
  state.dirty = true;
}

/** The table climbs a rank each round, wrapping at the ace. */
function advanceRank(state) {
  state.rank = RANKS[(RANKS.indexOf(state.rank) + 1) % RANKS.length];
}

export default cheat;
