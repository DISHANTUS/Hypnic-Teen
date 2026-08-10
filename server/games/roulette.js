// Roulette — one wheel, and no house.
//
// A real roulette table is you against the building, and the building always
// wins: that is what the zero is for. On a friends' arcade that is a slow way
// of taking everybody's evening away from them, so this has no house at all.
// Every chip staked on a spin goes into one pot, and the pot goes to whoever
// won. The chips move between the people at the table and nowhere else.
//
// That changes the payouts from fixed odds into shares of a pool, which is
// worth being precise about. Traditionally a single number pays 35 to 1, and
// the table can promise that because it is covering the loss out of its own
// pocket. Here the pot is the only money there is — so a winning bet's share
// is weighted by what it would traditionally have returned. A straight-up win
// is still worth thirty-six times what a red win is worth, chip for chip. It
// just comes out of the room rather than out of a building.
//
// And when nobody wins, the pot does not vanish. It rides on the next spin.
// A round where everybody backed red and black came up makes the next one
// worth playing for, which is a better answer than the house pocketing it.

import { stake, award, splitPot, balanceOf, MIN_BET } from '../chips.js';

/** A European wheel: one zero, not two. Two is the house being greedy. */
export const WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
  10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export const colourOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

/**
 * The bets you can place, and what each traditionally returns for one chip.
 *
 * `returns` is the whole amount back, not the profit — a red win hands you two
 * chips for one, a straight hands you thirty-six. Used as the weight when the
 * pot is shared out, so the shapes of the bets keep their relative worth.
 */
export const BETS = {
  straight: { label: 'A single number', returns: 36, needsNumber: true },
  red: { label: 'Red', returns: 2, hits: (n) => colourOf(n) === 'red' },
  black: { label: 'Black', returns: 2, hits: (n) => colourOf(n) === 'black' },
  odd: { label: 'Odd', returns: 2, hits: (n) => n !== 0 && n % 2 === 1 },
  even: { label: 'Even', returns: 2, hits: (n) => n !== 0 && n % 2 === 0 },
  low: { label: '1 to 18', returns: 2, hits: (n) => n >= 1 && n <= 18 },
  high: { label: '19 to 36', returns: 2, hits: (n) => n >= 19 && n <= 36 },
  dozen1: { label: 'First dozen', returns: 3, hits: (n) => n >= 1 && n <= 12 },
  dozen2: { label: 'Second dozen', returns: 3, hits: (n) => n >= 13 && n <= 24 },
  dozen3: { label: 'Third dozen', returns: 3, hits: (n) => n >= 25 && n <= 36 },
};

const PHASES = { brief: 16, bets: 30, spin: 7, payout: 9 };

/** Does this bet win on this number? */
export function wins(bet, number) {
  const kind = BETS[bet.kind];
  if (!kind) return false;
  if (kind.needsNumber) return bet.number === number;
  return kind.hits(number);
}

export default {
  id: 'roulette',
  name: 'Roulette',
  tagline: 'One wheel, no house. Every chip on the table goes to whoever wins it.',
  emoji: '🎡',
  accent: '#e0483d',
  client: 'roulette',
  minPlayers: 1,
  maxPlayers: 24,
  tickRate: 4,
  /** Played for chips, which the lobby says out loud before anybody sits down. */
  stakes: 'chips',

  howToPlay: [
    'Put chips on the table — a colour, a range, or a single number.',
    'There is no house. Everything staked on a spin goes into one pot.',
    'Whoever wins shares the pot, weighted the way roulette always has: a single number is worth far more than a colour.',
    'If nobody wins, the pot rides on the next spin.',
  ],

  options: {
    rounds: {
      label: 'Spins',
      hint: 'How many times the wheel goes round',
      kind: 'number',
      min: 1,
      max: 20,
      hardMax: 100,
      step: 1,
      default: 8,
    },
    betSeconds: {
      label: 'Seconds to bet',
      hint: 'How long the table is open each spin',
      kind: 'number',
      min: 8,
      max: 90,
      hardMax: 300,
      step: 1,
      default: PHASES.bets,
    },
    maxBet: {
      label: 'Most you can stake a spin',
      hint: 'Keeps one big wallet from owning the table',
      kind: 'number',
      min: 10,
      max: 1000,
      hardMax: 100000,
      step: 10,
      default: 200,
    },
  },

  createState(players, ctx = {}) {
    const settings = ctx.settings ?? {};
    return {
      settings: {
        rounds: Math.max(1, Math.min(100, Number(settings.rounds) || 8)),
        betSeconds: Math.max(8, Math.min(300, Number(settings.betSeconds) || PHASES.bets)),
        maxBet: Math.max(10, Math.min(100000, Number(settings.maxBet) || 200)),
      },
      phase: 'brief',
      round: 0,
      timeLeft: PHASES.brief,
      phaseTotal: PHASES.brief,
      briefed: [],
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        bot: Boolean(p.bot),
        connected: p.connected !== false,
        // Chips won here, so the table can show a night's damage. The wallet
        // itself is the real record; this is just the scoreboard.
        net: 0,
        bestWin: 0,
      })),
      /** This round's bets: { id, name, kind, number, amount }. */
      bets: [],
      /** Chips nobody won last round, riding on this one. */
      carried: 0,
      /** Set once the wheel has stopped. */
      result: null,
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
        bot: Boolean(player.bot),
        connected: true,
        net: 0,
        bestWin: 0,
      });
    }
    state.dirty = true;
  },

  onPlayerLeave(state, player) {
    const known = state.players.find((p) => p.id === player.id);
    if (known) known.connected = false;
    // Bets already on the table stay on the table. Taking them back when
    // somebody's phone drops would be a way to watch a spin and then decide.
    state.dirty = true;
  },

  onAction(state, player, action = {}) {
    const me = state.players.find((p) => p.id === player.id);
    if (!me) return;

    if (action.type === 'briefed' && state.phase === 'brief') {
      if (!state.briefed.includes(me.id)) state.briefed.push(me.id);
      state.dirty = true;
      if (everyoneReady(state)) openTable(state);
      return;
    }

    if (action.type === 'bet' && state.phase === 'bets') return placeBet(state, me, action);

    if (action.type === 'clear' && state.phase === 'bets') {
      // Everything back, and the table is theirs again. Only before the wheel
      // goes — after that the chips are in the pot and belong to the spin.
      const mine = state.bets.filter((b) => b.id === me.id);
      for (const b of mine) award(me.id, b.amount, 'roulette — taken back');
      state.bets = state.bets.filter((b) => b.id !== me.id);
      state.dirty = true;
      return;
    }
  },

  botAction() {
    // Nobody plays chips against a machine here. A CPU at a table where the
    // pot is the players' own chips is just a way of quietly deleting them.
    return null;
  },

  onTick(state, dt) {
    if (state.over) return;
    state.timeLeft -= dt;
    if (state.timeLeft > 0) return;

    if (state.phase === 'brief') return openTable(state);
    if (state.phase === 'bets') return spin(state);
    if (state.phase === 'spin') return settle(state);
    if (state.phase === 'payout') {
      if (state.round >= state.settings.rounds) {
        // Anything nobody ever won goes back where it came from rather than
        // evaporating. There is no house to keep it.
        refundCarried(state);
        state.over = true;
        state.phase = 'over';
        state.dirty = true;
        return;
      }
      return openTable(state);
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
      .sort((a, b) => b.net - a.net || b.bestWin - a.bestWin)
      .map((p, i) => ({ playerId: p.id, name: p.name, score: p.net, place: i + 1 }));
  },

  serialize(state) {
    return {
      phase: state.phase,
      rules: this.howToPlay,
      round: state.round,
      maxRounds: state.settings.rounds,
      timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
      phaseTotal: state.phaseTotal,
      maxBet: state.settings.maxBet,
      minBet: MIN_BET,
      wheel: WHEEL,
      // What is on the table. Public on purpose — watching somebody put their
      // whole balance on 17 is most of the fun of a roulette table.
      bets: state.bets.map((b) => ({ id: b.id, name: b.name, kind: b.kind, number: b.number, amount: b.amount })),
      pot: state.bets.reduce((sum, b) => sum + b.amount, 0) + state.carried,
      carried: state.carried,
      result: state.result,
      players: state.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        net: p.net,
      })),
      briefed: state.briefed,
      log: state.log.slice(-5),
    };
  },

  serializeFor(state, playerId) {
    return {
      ...this.serialize(state),
      you: {
        id: playerId,
        // Read from the wallet each time rather than tracked here, so the
        // number on screen is the real one even after a cage trip mid-match.
        chips: balanceOf(playerId),
        staked: state.bets.filter((b) => b.id === playerId).reduce((sum, b) => sum + b.amount, 0),
      },
    };
  },
};

/* -------------------------------- the table ------------------------------- */

const activePlayers = (state) => state.players.filter((p) => p.connected !== false);

function everyoneReady(state) {
  const active = activePlayers(state);
  return active.length > 0 && active.every((p) => state.briefed.includes(p.id));
}

function openTable(state) {
  state.round += 1;
  state.phase = 'bets';
  state.bets = [];
  state.result = null;
  state.phaseTotal = state.settings.betSeconds;
  state.timeLeft = state.settings.betSeconds;
  state.dirty = true;
}

function placeBet(state, me, action) {
  const kind = String(action.kind ?? '');
  const spec = BETS[kind];
  if (!spec) return;

  const number = spec.needsNumber ? Math.floor(Number(action.number)) : null;
  if (spec.needsNumber && (!Number.isInteger(number) || number < 0 || number > 36)) return;

  const amount = Math.floor(Number(action.amount));
  if (!Number.isFinite(amount) || amount <= 0) return;

  // The table limit is per player per spin, counting everything they already
  // have down — otherwise it limits nothing.
  const already = state.bets.filter((b) => b.id === me.id).reduce((sum, b) => sum + b.amount, 0);
  if (already + amount > state.settings.maxBet) return;

  // The chips leave the wallet now, not when the wheel stops. A bet that is
  // only deducted at payout is a bet somebody can place twice.
  const taken = stake(me.id, amount, `roulette ${kind}`);
  if (taken.error) return;

  state.bets.push({ id: me.id, name: me.name, kind, number, amount });
  state.dirty = true;
}

function spin(state) {
  state.phase = 'spin';
  state.phaseTotal = PHASES.spin;
  state.timeLeft = PHASES.spin;

  // Decided the moment the wheel starts, and kept back until it stops. The
  // client is animating towards a number the server already chose — it cannot
  // be told early, because a client that knows where the ball lands is a
  // client that can still be placing bets.
  const at = Math.floor(Math.random() * WHEEL.length);
  state.pending = { number: WHEEL[at], at };
  state.dirty = true;
}

function settle(state) {
  const number = state.pending?.number ?? 0;
  const pocket = state.pending?.at ?? 0;
  state.pending = null;

  const pot = state.bets.reduce((sum, b) => sum + b.amount, 0) + state.carried;
  const winners = state.bets.filter((b) => wins(b, number));

  // What each person put down this spin. Several bets from one person are one
  // stake and, below, one claim — splitting per bet would pay them once per
  // chip on the table and the shares would stop adding up to the pot.
  const stakedBy = new Map();
  for (const b of state.bets) stakedBy.set(b.id, (stakedBy.get(b.id) ?? 0) + b.amount);

  const wonBy = new Map();
  if (winners.length && pot > 0) {
    // Weighted by what each bet would traditionally have returned, so a single
    // number is still worth thirty-six times a colour, chip for chip.
    const claimBy = new Map();
    for (const b of winners) {
      claimBy.set(b.id, (claimBy.get(b.id) ?? 0) + b.amount * BETS[b.kind].returns);
    }
    for (const { id, chips } of splitPot(pot, [...claimBy].map(([id, weight]) => ({ id, weight })))) {
      award(id, chips, `roulette — ${number}`);
      wonBy.set(id, chips);
    }
    state.carried = 0;
  } else {
    // Nobody won. The pot rides rather than disappearing — there is no house
    // to pocket it, and a bigger next spin is the better answer anyway.
    state.carried = pot;
  }

  // One line per player, once: what came back less what went down. Working it
  // out in several places is how a scoreboard ends up disagreeing with the
  // wallet it is supposed to be describing.
  const paid = [];
  for (const [id, staked] of stakedBy) {
    const chips = wonBy.get(id) ?? 0;
    const player = state.players.find((p) => p.id === id);
    if (player) {
      player.net += chips - staked;
      player.bestWin = Math.max(player.bestWin, chips);
    }
    if (chips > 0) paid.push({ id, name: player?.name ?? id, chips, staked });
  }

  state.result = {
    number,
    colour: colourOf(number),
    pocket,
    pot,
    paid: paid.sort((a, b) => b.chips - a.chips),
    carried: state.carried,
  };

  state.log.push(
    paid.length
      ? `${number} ${colourOf(number)} — ${paid[0].name} took ${paid[0].chips}.`
      : `${number} ${colourOf(number)} — nobody had it. ${state.carried} rides on.`
  );

  state.phase = 'payout';
  state.phaseTotal = PHASES.payout;
  state.timeLeft = PHASES.payout;
  state.dirty = true;
}

/** Chips nobody ever won go back to whoever last staked them. */
function refundCarried(state) {
  if (state.carried <= 0) return;
  const owed = new Map();
  for (const b of state.bets) owed.set(b.id, (owed.get(b.id) ?? 0) + b.amount);
  if (!owed.size) return;

  for (const { id, chips } of splitPot(state.carried, [...owed].map(([id, weight]) => ({ id, weight })))) {
    award(id, chips, 'roulette — table closed');
    const player = state.players.find((p) => p.id === id);
    if (player) player.net += chips;
  }
  state.log.push('Table closed. What nobody won went back.');
  state.carried = 0;
}
