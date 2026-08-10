// Texas Hold'em — the one where you play the people, not the house.
//
// Nothing on this floor is closer to what was asked for: everybody's chips are
// in the middle and one of them takes it. There is no dealer to beat and no
// edge working against the table, so a night of this is chips moving between
// friends and nothing else.
//
// The two things that are genuinely hard in poker, and where quiet bugs live:
//
//   side pots      somebody all-in for 20 into a pot three people are still
//                  raising cannot win the part they could not match. Getting
//                  this wrong hands somebody else's money to the short stack
//                  and it is invisible until the one hand it matters.
//   the betting    who acts, what they may do, and when the round is closed.
//                  A round that closes early skips somebody's turn; one that
//                  never closes hangs the table.
//
// Both are done here and nowhere else, and both are tested against chip
// conservation: whatever the hand does, what comes out equals what went in.

import { freshDeck, shuffle, evaluate, compareHands, describe } from '../cards.js';
import { stake, award, balanceOf, MIN_BET } from '../chips.js';

const PHASES = { brief: 18, act: 25, showdown: 12 };

/** Where the community cards are in a hand. */
const STREETS = ['preflop', 'flop', 'turn', 'river'];

export default {
  id: 'holdem',
  name: "Texas Hold'em",
  tagline: 'No dealer, no house. Everybody’s chips in the middle and one of you takes it.',
  emoji: '🃏',
  accent: '#2f9e63',
  client: 'holdem',
  minPlayers: 2,
  // A real table is nine or ten. Past that nobody gets a hand.
  maxPlayers: 10,
  tickRate: 4,
  stakes: 'chips',

  howToPlay: [
    'Two cards each, five in the middle. Best five of the seven wins.',
    'Bet, call, raise or fold — the pot is everybody’s chips and one of you takes it.',
    'All-in for less than the others? You can only win the part you could match. The rest is a side pot.',
    'There is no dealer and no house. Nothing is played against the room.',
  ],

  options: {
    hands: {
      label: 'Hands',
      hint: 'How many are dealt before the table closes',
      kind: 'number',
      min: 1,
      max: 40,
      hardMax: 200,
      step: 1,
      default: 10,
    },
    bigBlind: {
      label: 'Big blind',
      hint: 'The small blind is half of it',
      kind: 'number',
      min: MIN_BET * 2,
      max: 200,
      hardMax: 5000,
      step: 5,
      default: 20,
    },
    buyInBlinds: {
      label: 'Buy-in, in big blinds',
      hint: 'How deep everybody sits down',
      kind: 'number',
      min: 5,
      max: 100,
      hardMax: 500,
      step: 5,
      default: 20,
    },
    actSeconds: {
      label: 'Seconds to act',
      hint: 'Run out and you check, or fold if there is a bet',
      kind: 'number',
      min: 8,
      max: 120,
      hardMax: 600,
      step: 1,
      default: PHASES.act,
    },
  },

  createState(players, ctx = {}) {
    const settings = ctx.settings ?? {};
    const bigBlind = Math.max(MIN_BET * 2, Math.min(5000, Number(settings.bigBlind) || 20));

    return {
      settings: {
        hands: Math.max(1, Math.min(200, Number(settings.hands) || 10)),
        bigBlind,
        smallBlind: Math.max(MIN_BET, Math.floor(bigBlind / 2)),
        actSeconds: Math.max(8, Math.min(600, Number(settings.actSeconds) || PHASES.act)),
        buyInBlinds: Math.max(5, Math.min(500, Number(settings.buyInBlinds) || 20)),
      },
      phase: 'brief',
      timeLeft: PHASES.brief,
      phaseTotal: PHASES.brief,
      briefed: [],
      hand: 0,
      // Who is where round the table. The button moves one seat each hand.
      players: players.map((p, i) => ({
        id: p.id,
        name: p.name,
        seat: i,
        connected: p.connected !== false,
        // Chips in front of them for this hand. Taken from the wallet when
        // they sit in, handed back when the table closes.
        stack: 0,
        seated: false,
        cards: [],
        // This street's contribution. Reset each street; `committed` is the
        // whole hand, which is what side pots are built from.
        bet: 0,
        committed: 0,
        folded: false,
        allIn: false,
        acted: false,
        // What they have taken out of their wallet to sit here. How far up or
        // down somebody is gets worked out from this rather than accumulated
        // hand by hand, because a running total drifts and then disagrees with
        // the chips actually sitting in front of them.
        boughtIn: 0,
      })),
      button: 0,
      street: 'preflop',
      board: [],
      deck: [],
      pots: [],
      /** Highest bet this street, and the size of the last raise. */
      toCall: 0,
      lastRaise: 0,
      turnId: null,
      showdown: null,
      log: [],
      over: false,
      dirty: true,
    };
  },

  onPlayerJoin(state, player) {
    const known = state.players.find((p) => p.id === player.id);
    if (known) {
      known.connected = true;
      known.name = player.name;
    } else {
      state.players.push({
        id: player.id,
        name: player.name,
        seat: state.players.length,
        connected: true,
        stack: 0,
        seated: false,
        cards: [],
        bet: 0,
        committed: 0,
        folded: false,
        allIn: false,
        acted: false,
        boughtIn: 0,
      });
    }
    state.dirty = true;
  },

  onPlayerLeave(state, player) {
    const me = state.players.find((p) => p.id === player.id);
    if (!me) return;
    me.connected = false;
    // Chips already in the pot stay there — leaving mid-hand cannot be a way
    // to take a bet back. Whatever is still in front of them goes home when
    // the table closes.
    if (!me.folded && state.phase === 'play') fold(state, me, 'left the table');
    state.dirty = true;
  },

  onAction(state, player, action = {}) {
    const me = state.players.find((p) => p.id === player.id);
    if (!me) return;

    if (action.type === 'briefed' && state.phase === 'brief') {
      if (!state.briefed.includes(me.id)) state.briefed.push(me.id);
      state.dirty = true;
      if (everyoneReady(state)) startTable(state);
      return;
    }

    // Sitting in: chips come off the wallet and go in front of them.
    if (action.type === 'sit' && !me.seated) {
      const amount = Math.floor(Number(action.amount));
      const least = buyInFor(state);
      if (!Number.isFinite(amount) || amount < least) return;
      const taken = stake(me.id, amount, "hold'em — sitting in");
      if (taken.error) return;
      me.stack += amount;
      me.boughtIn += amount;
      me.seated = true;
      state.log.push(`${me.name} sat in with ${amount}.`);
      state.dirty = true;
      return;
    }

    if (state.phase !== 'play' || state.turnId !== me.id) return;
    if (action.type === 'fold') return fold(state, me, null) ?? advance(state);
    if (action.type === 'check' || action.type === 'call') return callOrCheck(state, me);
    if (action.type === 'raise') return raise(state, me, Math.floor(Number(action.to)));
  },

  botAction: () => null,

  onTick(state, dt) {
    if (state.over) return;
    state.timeLeft -= dt;
    if (state.timeLeft > 0) return;

    if (state.phase === 'brief') return startTable(state);

    if (state.phase === 'play') {
      // Out of time. Checking is free, so take it; otherwise fold rather than
      // spending somebody's chips for them.
      const me = state.players.find((p) => p.id === state.turnId);
      if (!me) return advance(state);
      if (me.bet >= state.toCall) callOrCheck(state, me);
      else fold(state, me, 'ran out of time') ?? advance(state);
      return;
    }

    if (state.phase === 'showdown') {
      if (state.hand >= state.settings.hands || seated(state).length < 2) return closeTable(state);
      return deal(state);
    }
  },

  isDirty(state) {
    const was = state.dirty;
    state.dirty = false;
    return was;
  },

  isOver: (state) => Boolean(state.over),

  results(state) {
    return [...state.players]
      .sort((a, b) => netOf(b) - netOf(a))
      .map((p, i) => ({ playerId: p.id, name: p.name, score: netOf(p), place: i + 1 }));
  },

  serialize(state) {
    return {
      phase: state.phase,
      rules: this.howToPlay,
      hand: state.hand,
      maxHands: state.settings.hands,
      timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
      phaseTotal: state.phaseTotal,
      blinds: { small: state.settings.smallBlind, big: state.settings.bigBlind },
      buyIn: buyInFor(state),
      street: state.street,
      board: state.board,
      pot: potTotal(state),
      toCall: state.toCall,
      turnId: state.turnId,
      button: state.button,
      // Everybody's chips and what they have in — but never their cards.
      players: state.players.map((p) => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        connected: p.connected,
        seated: p.seated,
        stack: p.stack,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        net: netOf(p),
        // Face down until a showdown says otherwise.
        cards: state.showdown?.shown?.[p.id] ?? (p.cards.length ? ['??', '??'] : []),
      })),
      showdown: state.showdown,
      briefed: state.briefed,
      log: state.log.slice(-6),
    };
  },

  /** Your own two cards, and nobody else's, ever. */
  serializeFor(state, playerId) {
    const me = state.players.find((p) => p.id === playerId);
    const shared = this.serialize(state);
    return {
      ...shared,
      you: {
        id: playerId,
        chips: balanceOf(playerId),
        seated: Boolean(me?.seated),
        stack: me?.stack ?? 0,
        cards: me?.cards ?? [],
        bet: me?.bet ?? 0,
        folded: Boolean(me?.folded),
        allIn: Boolean(me?.allIn),
        // What this player may actually do, worked out here so the buttons
        // cannot offer something the server will refuse.
        can: legalMoves(state, me),
        best: me?.cards?.length && state.board.length >= 3
          ? describe(evaluate([...me.cards, ...state.board]))
          : null,
      },
    };
  },
};

/* --------------------------------- the table ------------------------------ */

/** Up or down against what they bought in for. */
const netOf = (p) => (p.cashedOut ?? p.stack) - p.boughtIn;

/** A stack worth sitting down with. Five big blinds is gone in one hand,
 *  and a table that closes after hand one is not a game. */
const buyInFor = (state) => state.settings.bigBlind * state.settings.buyInBlinds;

const seated = (state) => state.players.filter((p) => p.seated && p.stack > 0 && p.connected !== false);
const inHand = (state) => state.players.filter((p) => p.cards.length && !p.folded);
const canStillAct = (state) => inHand(state).filter((p) => !p.allIn);

function everyoneReady(state) {
  const active = state.players.filter((p) => p.connected !== false);
  return active.length > 0 && active.every((p) => state.briefed.includes(p.id));
}

function startTable(state) {
  state.phase = 'play';
  // Everybody buys in for the same starting stack unless they said otherwise.
  for (const p of state.players) {
    if (p.seated || p.connected === false) continue;
    const buyIn = buyInFor(state);
    const taken = stake(p.id, buyIn, "hold'em — sitting in");
    if (!taken.error) {
      p.stack += buyIn;
      p.boughtIn += buyIn;
      p.seated = true;
    }
  }
  if (seated(state).length < 2) return closeTable(state);
  deal(state);
}

function deal(state) {
  state.hand += 1;
  // Said here rather than only in startTable. Without it the second hand was
  // dealt while the phase still read 'showdown', so the showdown branch of the
  // tick dealt again — and each redeal reset everybody's bet to zero, which
  // quietly destroyed the blinds that had just been posted.
  state.phase = 'play';
  state.street = 'preflop';
  state.board = [];
  state.pots = [];
  state.showdown = null;
  state.deck = shuffle(freshDeck());

  const players = seated(state);
  for (const p of state.players) {
    p.cards = [];
    p.bet = 0;
    p.committed = 0;
    p.folded = !players.includes(p);
    p.allIn = false;
    p.acted = false;
  }

  // The button moves one live seat each hand, so the blinds go round.
  state.button = nextSeated(state, state.button);

  for (let i = 0; i < 2; i++) for (const p of players) p.cards.push(state.deck.pop());

  // Heads-up the button is the small blind; at a fuller table it is the two
  // seats after. Both are the real rule, and getting it wrong is the kind of
  // thing one player at the table will notice immediately.
  const small = players.length === 2 ? state.button : nextSeated(state, state.button);
  const big = nextSeated(state, small);
  post(state, playerAtSeat(state, small), state.settings.smallBlind);
  post(state, playerAtSeat(state, big), state.settings.bigBlind);

  state.toCall = state.settings.bigBlind;
  state.lastRaise = state.settings.bigBlind;
  state.turnId = playerAtSeat(state, nextSeated(state, big))?.id ?? null;
  state.phaseTotal = state.settings.actSeconds;
  state.timeLeft = state.settings.actSeconds;
  state.log.push(`Hand ${state.hand} — blinds ${state.settings.smallBlind}/${state.settings.bigBlind}.`);
  state.dirty = true;
}

const playerAtSeat = (state, seat) => state.players.find((p) => p.seat === seat) ?? null;

/** The next seat round the table that is actually playing. */
function nextSeated(state, fromSeat) {
  const players = seated(state).sort((a, b) => a.seat - b.seat);
  if (!players.length) return fromSeat;
  const after = players.find((p) => p.seat > fromSeat);
  return (after ?? players[0]).seat;
}

/** Blinds, and any forced bet. Short stacks post what they have and are in. */
function post(state, player, amount) {
  if (!player) return;
  const put = Math.min(amount, player.stack);
  player.stack -= put;
  player.bet += put;
  player.committed += put;
  if (player.stack === 0) player.allIn = true;
}

function fold(state, me, why) {
  me.folded = true;
  me.acted = true;
  if (why) state.log.push(`${me.name} ${why}.`);
  state.dirty = true;
  return null;
}

function callOrCheck(state, me) {
  const owed = Math.max(0, state.toCall - me.bet);
  const put = Math.min(owed, me.stack);
  me.stack -= put;
  me.bet += put;
  me.committed += put;
  if (me.stack === 0 && put > 0) me.allIn = true;
  me.acted = true;
  state.dirty = true;
  advance(state);
}

function raise(state, me, to) {
  const least = state.toCall + state.lastRaise;
  // Going all-in for less than a full raise is allowed; it simply does not
  // reopen the betting for anybody who has already acted.
  const allIn = to >= me.bet + me.stack;
  if (!allIn && (!Number.isFinite(to) || to < least)) return;

  const target = allIn ? me.bet + me.stack : to;
  const put = target - me.bet;
  if (put <= 0 || put > me.stack) return;

  me.stack -= put;
  me.bet += put;
  me.committed += put;
  if (me.stack === 0) me.allIn = true;

  const isFullRaise = target >= least;
  if (target > state.toCall) {
    if (isFullRaise) state.lastRaise = target - state.toCall;
    state.toCall = target;
    // A full raise puts the decision back to everybody still in.
    if (isFullRaise) for (const p of inHand(state)) if (p !== me && !p.allIn) p.acted = false;
  }
  me.acted = true;
  state.log.push(`${me.name} ${allIn ? 'is all in for' : 'raised to'} ${target}.`);
  state.dirty = true;
  advance(state);
}

/** What this player may do right now, so the buttons cannot lie. */
function legalMoves(state, me) {
  if (!me || state.phase !== 'play' || state.turnId !== me.id) return null;
  const owed = Math.max(0, state.toCall - me.bet);
  return {
    fold: true,
    check: owed === 0,
    call: owed > 0 ? Math.min(owed, me.stack) : 0,
    // The least you may raise to, and the most.
    raiseTo: state.toCall + state.lastRaise,
    allInTo: me.bet + me.stack,
    canRaise: me.stack > owed,
  };
}

/**
 * Moves the turn on, or closes the street.
 *
 * A street is done when everybody still able to act has acted and matched the
 * bet. Getting this wrong in either direction is bad in a way players notice:
 * closing early skips somebody, never closing hangs the table.
 */
function advance(state) {
  const live = inHand(state);

  // Everybody else folded. No cards need showing.
  if (live.length <= 1) return finishHand(state, live);

  const able = canStillAct(state);
  const settled = able.every((p) => p.acted && (p.bet === state.toCall || p.allIn));

  if (!settled) {
    const next = nextToAct(state);
    if (next) {
      state.turnId = next.id;
      state.phaseTotal = state.settings.actSeconds;
      state.timeLeft = state.settings.actSeconds;
      state.dirty = true;
      return;
    }
  }

  // Street over. Everything on the table goes into the pots.
  collect(state);

  // Nobody left who can bet: run the rest of the board out and show.
  if (able.length <= 1) {
    while (state.board.length < 5) burnAndTurn(state);
    return finishHand(state, live);
  }

  const at = STREETS.indexOf(state.street);
  if (at >= STREETS.length - 1) return finishHand(state, live);

  state.street = STREETS[at + 1];
  burnAndTurn(state);

  for (const p of live) { p.bet = 0; p.acted = false; }
  state.toCall = 0;
  state.lastRaise = state.settings.bigBlind;
  // After the flop the first live seat left of the button speaks first.
  const first = state.players
    .filter((p) => live.includes(p))
    .sort((a, b) => a.seat - b.seat)
    .find((p) => p.seat > state.button) ?? live.sort((a, b) => a.seat - b.seat)[0];
  state.turnId = canStillAct(state).length ? first.id : null;
  state.phaseTotal = state.settings.actSeconds;
  state.timeLeft = state.settings.actSeconds;
  state.dirty = true;
}

function burnAndTurn(state) {
  const want = state.board.length === 0 ? 3 : 1;
  state.deck.pop(); // burn, the way it is done
  for (let i = 0; i < want; i++) state.board.push(state.deck.pop());
}

function nextToAct(state) {
  const order = inHand(state).filter((p) => !p.allIn).sort((a, b) => a.seat - b.seat);
  if (!order.length) return null;
  const fromSeat = state.players.find((p) => p.id === state.turnId)?.seat ?? -1;
  return order.find((p) => p.seat > fromSeat && needsToAct(state, p))
    ?? order.find((p) => needsToAct(state, p))
    ?? null;
}

const needsToAct = (state, p) => !p.acted || p.bet < state.toCall;

/**
 * Sweeps this street's bets into pots.
 *
 * This is where side pots come from, and where poker code usually goes wrong.
 * Somebody all-in for 20 into a pot others are raising to 200 can only win the
 * part everybody could match — 20 from each — and the rest is a separate pot
 * they are not in. Built by taking layers off at each all-in amount.
 */
function collect(state) {
  const contributors = state.players.filter((p) => p.bet > 0);
  if (!contributors.length) return;

  const levels = [...new Set(contributors.map((p) => p.bet))].sort((a, b) => a - b);
  let taken = 0;
  for (const level of levels) {
    const layer = level - taken;
    const inLayer = contributors.filter((p) => p.bet >= level);
    const chips = layer * inLayer.length;
    if (chips <= 0) { taken = level; continue; }

    // Only players who were not folded can win a pot they are in.
    const eligible = inLayer.filter((p) => !p.folded).map((p) => p.id);
    const existing = state.pots.find((pot) => sameSet(pot.eligible, eligible));
    if (existing) existing.chips += chips;
    else state.pots.push({ chips, eligible });
    taken = level;
  }
  for (const p of state.players) p.bet = 0;
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const potTotal = (state) =>
  state.pots.reduce((sum, p) => sum + p.chips, 0) + state.players.reduce((sum, p) => sum + p.bet, 0);

function finishHand(state, live) {
  collect(state);

  const shown = {};
  const ranked = live.map((p) => ({
    player: p,
    hand: p.cards.length && state.board.length === 5 ? evaluate([...p.cards, ...state.board]) : null,
  }));

  const wins = [];
  for (const pot of state.pots) {
    const runners = ranked.filter((r) => pot.eligible.includes(r.player.id));
    if (!runners.length) continue;

    let best = [runners[0]];
    for (const r of runners.slice(1)) {
      if (!r.hand || !best[0].hand) { if (!best[0].hand) best = [r]; continue; }
      const cmp = compareHands(r.hand, best[0].hand);
      if (cmp > 0) best = [r];
      else if (cmp === 0) best.push(r);
    }

    // A split pot that does not divide evenly leaves a chip or two over; they
    // go to the earliest seat, which is the ordinary rule and, more to the
    // point, never loses one.
    const each = Math.floor(pot.chips / best.length);
    let left = pot.chips - each * best.length;
    for (const r of best.sort((a, b) => a.player.seat - b.player.seat)) {
      const extra = left > 0 ? 1 : 0;
      left -= extra;
      r.player.stack += each + extra;
      wins.push({ id: r.player.id, name: r.player.name, chips: each + extra, hand: r.hand ? describe(r.hand) : null });
    }
    // Cards go face up only where more than one person was still in it.
    if (runners.length > 1) for (const r of runners) shown[r.player.id] = r.player.cards;
  }

  state.pots = [];
  state.showdown = {
    board: state.board,
    shown,
    wins,
    said: wins.length === 1
      ? `${wins[0].name} takes ${wins[0].chips}${wins[0].hand ? ` with ${wins[0].hand.toLowerCase()}` : ''}.`
      : wins.map((w) => `${w.name} takes ${w.chips}`).join(' · '),
  };
  state.log.push(state.showdown.said);
  state.turnId = null;
  state.phase = 'showdown';
  state.phaseTotal = PHASES.showdown;
  state.timeLeft = PHASES.showdown;
  state.dirty = true;
}

/** Everybody's chips go home. Nothing is left on the table. */
function closeTable(state) {
  for (const p of state.players) {
    // Frozen before the stack is emptied, or the scoreboard would say
    // everybody finished exactly as far down as they bought in for.
    p.cashedOut = p.stack;
    if (p.stack > 0) {
      award(p.id, p.stack, "hold'em — cashing out");
      p.stack = 0;
    }
    p.seated = false;
  }
  state.over = true;
  state.phase = 'over';
  state.turnId = null;
  state.log.push('Table closed. Everybody cashed out.');
  state.dirty = true;
}
