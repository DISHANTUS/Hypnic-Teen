// The card room's shared machinery.
//
// Thirty card games sit on top of this, and almost all of what they have in
// common is the boring half: seats in an order, a hand each that only its owner
// may see, a turn that moves round, a deck that runs out, a score that carries
// between deals, and a clock so one person walking off with their phone does
// not freeze a table of six.
//
// What they do *not* have in common is the middle. Cheat plays face down and
// argues about it; Snap has no turns at all; Hearts wants a trick and a suit to
// follow; Go Fish wants to ask somebody a question. So this is a shell with a
// hole in it rather than an engine: it owns the shell, and every game fills the
// hole differently.
//
// The one rule it enforces on all of them is that a hand is private. Not
// "hidden in the client" — never sent. Every game here builds its public view
// from card *counts* and its private view from the cards themselves, because a
// card game where the table state carries everybody's hand is a card game where
// one open developer console ends the evening.

import { freshDeck, shuffle, rankOf, suitOf, SUIT_SIGN, RANKS, SUITS } from '../../cards.js';

export { freshDeck, shuffle, rankOf, suitOf, SUIT_SIGN, RANKS, SUITS };

export const PHASES = { brief: 18, between: 9, over: 6 };

/** A seat is a player plus everything a card game hangs off one. */
export function seatsFrom(players) {
  return players.map((p, i) => ({
    id: p.id,
    name: p.name,
    seat: i,
    connected: p.connected !== false,
    hand: [],
    score: 0,
    /** Wins this session, for the scoreboard when scores are all zero. */
    won: 0,
    out: false,
  }));
}

export const seatOf = (state, playerId) => state.seats.find((s) => s.id === playerId) ?? null;
export const inPlay = (state) => state.seats.filter((s) => !s.out);

/**
 * Whose turn is next.
 *
 * Skips anybody who is out, and honours direction so a game that reverses play
 * gets it for free. Returns the same seat back if it is the only one left,
 * rather than looping forever looking for another.
 */
export function nextSeat(state, from = state.turn) {
  const live = inPlay(state);
  if (live.length <= 1) return live[0]?.seat ?? from;
  const dir = state.direction === -1 ? -1 : 1;
  let at = from;
  for (let i = 0; i < state.seats.length + 1; i++) {
    at = (at + dir + state.seats.length) % state.seats.length;
    const seat = state.seats[at];
    if (seat && !seat.out) return at;
  }
  return from;
}

/** Deal `each` cards to every seat, round-robin the way a person would. */
export function dealAround(state, each) {
  for (let n = 0; n < each; n++) {
    for (const s of state.seats) {
      if (!state.deck.length) return;
      s.hand.push(state.deck.pop());
    }
  }
}

/** Deal what is left as evenly as it goes, which several of these want. */
export function dealAll(state) {
  let at = 0;
  while (state.deck.length) {
    state.seats[at % state.seats.length].hand.push(state.deck.pop());
    at += 1;
  }
}

/**
 * Draw, turning the pile back over when the deck runs out.
 *
 * Every shedding game needs this and every one of them gets it subtly wrong
 * the same way: reshuffling the *whole* discard pile, top card included, so the
 * card everybody is playing against silently becomes a card in somebody's hand.
 * The top stays where it is and only what is under it comes back.
 *
 * Returns what was actually drawn, which can be fewer than asked for — with
 * four players and a long game the cards genuinely can run out, and a caller
 * that assumed otherwise would deal from an empty deck forever.
 */
export function drawCards(state, seat, n = 1) {
  const got = [];
  for (let i = 0; i < n; i++) {
    if (!state.deck.length) {
      if (state.pile.length <= 1) break;
      const top = state.pile.pop();
      state.deck = shuffle(state.pile);
      state.pile = [top];
    }
    if (!state.deck.length) break;
    const card = state.deck.pop();
    seat.hand.push(card);
    got.push(card);
  }
  return got;
}

/**
 * Somebody has emptied their hand.
 *
 * Recorded in the order it happened rather than as a flag, because in every
 * game of this family the *order* is the result — first out is the president
 * and last out is not, and a set of booleans cannot tell you which was which.
 */
export function goOut(state, seat) {
  if (seat.out) return;
  seat.out = true;
  (state.finished ??= []).push(seat.seat);
  state.log.push(`${seat.name} is out.`);
}

/** Finishing order, with anybody still holding cards on the end. */
export function finishOrder(state) {
  const done = state.finished ?? [];
  const rest = state.seats.filter((s) => !done.includes(s.seat)).map((s) => s.seat);
  return [...done, ...rest];
}

/** Take a named card out of a hand. Returns false if it was never there. */
export function playFrom(seat, card) {
  const at = seat.hand.indexOf(card);
  if (at < 0) return false;
  seat.hand.splice(at, 1);
  return true;
}

/** Every card of a rank, out of a hand at once — Go Fish and Old Maid want this. */
export function pullRank(seat, rank) {
  const got = seat.hand.filter((c) => rankOf(c) === rank);
  seat.hand = seat.hand.filter((c) => rankOf(c) !== rank);
  return got;
}

/** How many of each rank, which is most of what a matching game needs to know. */
export function rankCounts(hand) {
  const by = new Map();
  for (const c of hand) by.set(rankOf(c), (by.get(rankOf(c)) ?? 0) + 1);
  return by;
}

/** "the seven of hearts", for a log line people actually read. */
const SAY_RANK = {
  A: 'ace', K: 'king', Q: 'queen', J: 'jack', T: 'ten',
  9: 'nine', 8: 'eight', 7: 'seven', 6: 'six', 5: 'five', 4: 'four', 3: 'three', 2: 'two',
};
const SAY_SUIT = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
export const sayCard = (card) => `${SAY_RANK[rankOf(card)]} of ${SAY_SUIT[suitOf(card)]}`;
export const sayRank = (rank) => SAY_RANK[rank] ?? rank;

const everyoneReady = (state) => {
  const here = state.seats.filter((s) => s.connected);
  return here.length > 0 && here.every((s) => state.briefed.includes(s.id));
};

/**
 * Build a card game from the parts that make it different from the others.
 *
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.name
 * @param {string} spec.tagline
 * @param {string} spec.emoji
 * @param {string} spec.accent
 * @param {string} spec.face            which middle the shared client draws
 * @param {number} spec.minPlayers
 * @param {number} spec.maxPlayers
 * @param {string[]} spec.howToPlay
 * @param {object} [spec.options]       merged on top of the common ones
 * @param {number} [spec.turnSeconds]   0 for a game with no turns
 * @param {(state) => void} spec.deal   set the table up for one hand
 * @param {(state, seat, action) => void} spec.act
 * @param {(state) => void} [spec.tick] anything that happens on its own
 * @param {(state) => void} [spec.timedOut] when somebody's turn runs out
 * @param {(state) => boolean} spec.handOver
 * @param {(state) => void} [spec.scoreHand]
 * @param {(state) => object} spec.table  the public middle
 * @param {(state, seat) => object} [spec.mine] the private part, per seat
 * @param {(a, b) => number} [spec.rank]  how to order the final scoreboard
 */
export function createCardGame(spec) {
  const turnSeconds = spec.turnSeconds ?? 25;

  return {
    /**
     * The parts the game filled in, reachable for testing.
     *
     * Scoring a hand is the one thing worth checking directly rather than by
     * playing to the end of one: shooting the moon in Hearts turns the whole
     * scoreboard inside out and takes a very specific set of thirteen hearts
     * and a queen to reach, which is not something to wait around for.
     */
    __spec: spec,
    id: spec.id,
    name: spec.name,
    tagline: spec.tagline,
    emoji: spec.emoji,
    accent: spec.accent,
    client: '_cards',
    face: spec.face ?? spec.id,
    room: 'cards',
    minPlayers: spec.minPlayers,
    maxPlayers: spec.maxPlayers,
    tickRate: 4,
    howToPlay: spec.howToPlay,

    options: {
      hands: { label: 'Hands', kind: 'number', min: 1, max: 20, hardMax: 100, step: 1, default: spec.hands ?? 3 },
      ...(turnSeconds
        ? { turnSeconds: { label: 'Seconds a turn', kind: 'number', min: 5, max: 120, hardMax: 300, step: 5, default: turnSeconds } }
        : {}),
      ...(spec.options ?? {}),
    },

    createState(players, ctx = {}) {
      const settings = ctx.settings ?? {};
      const state = {
        settings: {
          hands: Math.max(1, Math.min(100, Number(settings.hands) || spec.hands || 3)),
          // Zero means this game has no turns, and it has to survive to here.
          // The `|| 25` on the end used to swallow it, so Snap, Slapjack, War,
          // Speed, Spoons and both Solitaires each started every hand with a
          // 25-second turn clock that nothing ever decremented and nothing ever
          // fired. The client already knows to say "everybody at once" and draw
          // no bar when there is no turn — it was simply never told.
          turnSeconds: turnSeconds === 0
            ? 0
            : Math.max(5, Math.min(300, Number(settings.turnSeconds) || turnSeconds)),
          ...(spec.settings ? spec.settings(settings) : {}),
        },
        phase: 'brief',
        timeLeft: PHASES.brief,
        phaseTotal: PHASES.brief,
        briefed: [],
        hostId: ctx.room?.hostId ?? players[0]?.id ?? null,
        hand: 0,
        seats: seatsFrom(players),
        deck: [],
        pile: [],
        turn: 0,
        direction: 1,
        /** Counted down only while somebody actually owes a move. */
        turnLeft: 0,
        said: '',
        log: [],
        over: false,
        dirty: true,
      };
      spec.init?.(state);
      return state;
    },

    onPlayerJoin(state, player) {
      const known = seatOf(state, player.id);
      if (known) { known.connected = true; known.name = player.name; }
      else {
        // Late arrivals get a seat but no cards until the next hand — dealing
        // into a hand in progress would either give them a losing position or
        // take cards off somebody else.
        state.seats.push({
          id: player.id, name: player.name, seat: state.seats.length,
          connected: true, hand: [], score: 0, won: 0, out: true,
        });
        state.log.push(`${player.name} sits down — in from the next hand.`);
      }
      if (!state.hostId) state.hostId = player.id;
      state.dirty = true;
    },

    onPlayerLeave(state, player) {
      const seat = seatOf(state, player.id);
      if (seat) seat.connected = false;
      if (state.hostId === player.id) state.hostId = state.seats.find((s) => s.connected)?.id ?? null;
      // A turn owed by somebody who has gone is a table that never moves again.
      if (state.seats[state.turn]?.id === player.id) state.turnLeft = 0;
      state.dirty = true;
    },

    onAction(state, player, action = {}) {
      const seat = seatOf(state, player.id);
      if (!seat) return;

      if (action.type === 'briefed' && state.phase === 'brief') {
        if (!state.briefed.includes(seat.id)) state.briefed.push(seat.id);
        state.dirty = true;
        if (everyoneReady(state)) startHand(state, spec);
        return;
      }
      if (state.phase !== 'play') return;
      spec.act(state, seat, action);
    },

    botAction: () => null,

    onTick(state, dt) {
      if (state.over) return;

      if (state.phase === 'brief') {
        state.timeLeft -= dt;
        if (state.timeLeft <= 0) startHand(state, spec);
        return;
      }

      if (state.phase === 'between') {
        state.timeLeft -= dt;
        if (state.timeLeft <= 0) {
          if (state.hand >= state.settings.hands) return finish(state);
          startHand(state, spec);
        }
        return;
      }

      if (state.phase !== 'play') return;
      spec.tick?.(state, dt);
      if (state.phase !== 'play') return;

      // Counted down here and *not* broadcast every tick. The clock on screen
      // runs itself forward from the last state it was sent — see turnclock.mjs
      // and the note on isDirty in party.js. Pushing a frame a second per room
      // is bandwidth this studio decided long ago not to spend.
      if (turnSeconds > 0 && state.turnLeft > 0) {
        state.turnLeft -= dt;
        if (state.turnLeft <= 0) {
          // Something has to happen or the table stops. Every game says what.
          spec.timedOut?.(state);
          state.dirty = true;
        }
      }

      if (spec.handOver(state)) endHand(state, spec);
    },

    isDirty(state) { const was = state.dirty; state.dirty = false; return was; },
    isOver: (state) => Boolean(state.over),

    results(state) {
      const order = spec.rank ?? ((a, b) => b.score - a.score || b.won - a.won);
      return [...state.seats].sort(order).map((s, i) => ({
        playerId: s.id, name: s.name, score: s.score, place: i + 1,
      }));
    },

    serialize(state) {
      return {
        phase: state.phase,
        face: spec.face ?? spec.id,
        rules: spec.howToPlay,
        hand: state.hand,
        maxHands: state.settings.hands,
        timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
        phaseTotal: state.phaseTotal,
        turn: state.turn,
        turnName: state.seats[state.turn]?.name ?? '',
        turnLeft: Math.max(0, Math.ceil(state.turnLeft)),
        direction: state.direction,
        said: state.said,
        // Counts, never cards. This is the line that keeps a hand private, and
        // it is here rather than in each game so that no game can forget it.
        seats: state.seats.map((s) => ({
          id: s.id, name: s.name, seat: s.seat, connected: s.connected,
          cards: s.hand.length, score: s.score, won: s.won, out: s.out,
        })),
        deckLeft: state.deck.length,
        briefed: state.briefed,
        hostId: state.hostId,
        log: state.log.slice(-4),
        ...(spec.table?.(state) ?? {}),
      };
    },

    serializeFor(state, playerId) {
      const seat = seatOf(state, playerId);
      return {
        ...this.serialize(state),
        you: {
          id: playerId,
          seat: seat?.seat ?? -1,
          hand: seat ? [...seat.hand] : [],
          yourTurn: state.phase === 'play' && state.seats[state.turn]?.id === playerId,
          isHost: playerId === state.hostId,
          out: Boolean(seat?.out),
          ...(spec.mine?.(state, seat) ?? {}),
        },
      };
    },
  };
}

/* ------------------------------ the shell's own ---------------------------- */

function startHand(state, spec) {
  state.hand += 1;
  state.phase = 'play';
  state.deck = shuffle(freshDeck());
  state.pile = [];
  state.said = '';
  state.direction = 1;
  for (const s of state.seats) {
    s.hand = [];
    // Anybody who sat down mid-hand is dealt in now.
    s.out = false;
  }
  spec.deal(state);
  state.turnLeft = state.settings.turnSeconds;
  state.dirty = true;
}

function endHand(state, spec) {
  spec.scoreHand?.(state);
  state.phase = 'between';
  state.phaseTotal = PHASES.between;
  state.timeLeft = PHASES.between;
  state.turnLeft = 0;
  state.dirty = true;
}

function finish(state) {
  state.over = true;
  state.phase = 'over';
  state.dirty = true;
}

/** Hand the turn on and restart that seat's clock. Games call this constantly. */
export function passTurn(state, to = null) {
  state.turn = to === null ? nextSeat(state) : to;
  state.turnLeft = state.settings.turnSeconds;
  state.dirty = true;
}

/** For the tests, which drive hands rather than waiting for them. */
export const __shell = { startHand, endHand, finish };
