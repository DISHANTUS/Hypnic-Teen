// Betting on one shared thing: craps and the horses.
//
// Roulette already works this way — everybody puts chips on the same event,
// the event happens, and the pot goes to whoever backed it — and these two are
// the same game with a different event in the middle. So the shape is written
// once here rather than three times.
//
// The payout is a pool share, not fixed odds. A real book can promise 6 to 1
// on a horse because it covers the loss out of its own pocket; here the pot is
// the only money there is, so a winning bet's share is weighted by what it
// would traditionally have returned. The relative worth of the bets survives,
// and the total paid out is exactly the total staked.
//
// Everything about chips, pots, carry-over and closing up is here. A table
// only has to say what its bets are, how to run the event, and which bets the
// result pays.

import { stake, award, splitPot, balanceOf, MIN_BET } from '../chips.js';

const PHASES = { brief: 16, bets: 26, run: 8, payout: 10 };

/**
 * @param {object} table
 * @param {string} table.id
 * @param {Record<string, {label:string, returns:number, note?:string}>} table.bets
 *        What can be backed, and what one chip on it would traditionally
 *        return in total — two for an even-money bet, not one.
 * @param {() => object} table.run       decides the event
 * @param {(bet, outcome) => boolean} table.wins
 * @param {(outcome) => string} table.say
 */
export function createPoolTable(table) {
  const activePlayers = (state) => state.players.filter((p) => p.connected !== false);

  function everyoneReady(state) {
    const list = activePlayers(state);
    return list.length > 0 && list.every((p) => state.briefed.includes(p.id));
  }

  function openTable(state) {
    state.round += 1;
    state.phase = 'bets';
    state.bets = [];
    state.outcome = null;
    state.result = null;
    state.phaseTotal = state.settings.betSeconds;
    state.timeLeft = state.settings.betSeconds;
    state.dirty = true;
  }

  function startRun(state) {
    state.phase = 'run';
    state.phaseTotal = PHASES.run;
    state.timeLeft = PHASES.run;
    // Decided the moment the table shuts, held back until it has finished
    // happening. The client is animating towards something already chosen —
    // it cannot be told early, because a client that knows the result is a
    // client that could still be betting.
    state.pending = table.run(state);
    state.dirty = true;
  }

  function settle(state) {
    const outcome = state.pending;
    state.pending = null;
    state.outcome = outcome;

    const pot = state.bets.reduce((sum, b) => sum + b.amount, 0) + state.carried;
    const winners = state.bets.filter((b) => table.wins(b, outcome));

    const stakedBy = new Map();
    for (const b of state.bets) stakedBy.set(b.id, (stakedBy.get(b.id) ?? 0) + b.amount);

    const wonBy = new Map();
    if (winners.length && pot > 0) {
      const claimBy = new Map();
      for (const b of winners) {
        const worth = table.bets[b.kind]?.returns ?? 2;
        claimBy.set(b.id, (claimBy.get(b.id) ?? 0) + b.amount * worth);
      }
      for (const { id, chips } of splitPot(pot, [...claimBy].map(([id, weight]) => ({ id, weight })))) {
        award(id, chips, table.id);
        wonBy.set(id, chips);
      }
      state.carried = 0;
    } else {
      // Nobody backed it. There is no house to pocket the pot, so it rides.
      state.carried = pot;
    }

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
      outcome,
      pot,
      paid: paid.sort((a, b) => b.chips - a.chips),
      carried: state.carried,
      said: paid.length
        ? `${table.say(outcome)} — ${paid[0].name} takes ${paid[0].chips}.`
        : `${table.say(outcome)} — nobody had it. ${state.carried} rides on.`,
    };
    state.log.push(state.result.said);

    state.phase = 'payout';
    state.phaseTotal = PHASES.payout;
    state.timeLeft = PHASES.payout;
    state.dirty = true;
  }

  /** Whatever nobody won goes back to whoever last staked it. */
  function closeUp(state) {
    if (state.carried > 0 && state.bets.length) {
      const owed = new Map();
      for (const b of state.bets) owed.set(b.id, (owed.get(b.id) ?? 0) + b.amount);
      for (const { id, chips } of splitPot(state.carried, [...owed].map(([id, weight]) => ({ id, weight })))) {
        award(id, chips, `${table.id} — closed`);
        const player = state.players.find((p) => p.id === id);
        if (player) player.net += chips;
      }
      state.carried = 0;
      state.log.push('Table closed. What nobody won went back.');
    }
    state.over = true;
    state.phase = 'over';
    state.dirty = true;
  }

  return {
    id: table.id,
    name: table.name,
    tagline: table.tagline,
    emoji: table.emoji,
    accent: table.accent,
    client: table.client ?? 'pool',
    pool: table.id,
    minPlayers: 1,
    maxPlayers: 40,
    tickRate: 4,
    stakes: 'chips',

    howToPlay: [
      table.blurb,
      'Everything staked goes into one pot. There is no house.',
      'Whoever backed it shares the pot, weighted the way the bet has always been priced.',
      'If nobody backs it, the pot rides on the next one.',
    ],

    options: {
      rounds: {
        label: table.roundWord ?? 'Rounds',
        hint: 'How many before the table closes',
        kind: 'number',
        min: 1, max: 30, hardMax: 200, step: 1, default: 8,
      },
      betSeconds: {
        label: 'Seconds to bet',
        kind: 'number',
        min: 8, max: 90, hardMax: 300, step: 1, default: PHASES.bets,
      },
      maxBet: {
        label: 'Most you can stake a round',
        hint: 'Keeps one big wallet from owning the table',
        kind: 'number',
        min: 10, max: 1000, hardMax: 100000, step: 10, default: 200,
      },
    },

    createState(players, ctx = {}) {
      const settings = ctx.settings ?? {};
      return {
        settings: {
          rounds: Math.max(1, Math.min(200, Number(settings.rounds) || 8)),
          betSeconds: Math.max(8, Math.min(300, Number(settings.betSeconds) || PHASES.bets)),
          maxBet: Math.max(10, Math.min(100000, Number(settings.maxBet) || 200)),
        },
        pool: table.id,
        phase: 'brief',
        round: 0,
        timeLeft: PHASES.brief,
        phaseTotal: PHASES.brief,
        briefed: [],
        players: players.map((p) => ({
          id: p.id,
          name: p.name,
          connected: p.connected !== false,
          net: 0,
          bestWin: 0,
        })),
        bets: [],
        carried: 0,
        outcome: null,
        result: null,
        log: [],
        over: false,
        dirty: true,
        ...(table.extraState?.() ?? {}),
      };
    },

    onPlayerJoin(state, player) {
      const known = state.players.find((p) => p.id === player.id);
      if (known) {
        known.connected = true;
        known.name = player.name;
      } else {
        state.players.push({ id: player.id, name: player.name, connected: true, net: 0, bestWin: 0 });
      }
      state.dirty = true;
    },

    onPlayerLeave(state, player) {
      const me = state.players.find((p) => p.id === player.id);
      if (me) me.connected = false;
      // Bets already down stay down. Leaving cannot be a way to watch the
      // result and then decide.
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

      if (action.type === 'bet' && state.phase === 'bets') {
        const kind = String(action.kind ?? '');
        if (!table.bets[kind]) return;

        const amount = Math.floor(Number(action.amount));
        if (!Number.isFinite(amount) || amount <= 0) return;

        // The limit counts everything already down, or it limits nothing.
        const already = state.bets.filter((b) => b.id === me.id).reduce((sum, b) => sum + b.amount, 0);
        if (already + amount > state.settings.maxBet) return;

        // Chips leave now, not at payout. A bet only deducted when it wins is
        // a bet somebody can place twice.
        const taken = stake(me.id, amount, `${table.id} ${kind}`);
        if (taken.error) return;

        state.bets.push({ id: me.id, name: me.name, kind, amount });
        state.dirty = true;
        return;
      }

      if (action.type === 'clear' && state.phase === 'bets') {
        for (const b of state.bets.filter((b) => b.id === me.id)) {
          award(me.id, b.amount, `${table.id} — taken back`);
        }
        state.bets = state.bets.filter((b) => b.id !== me.id);
        state.dirty = true;
      }
    },

    botAction: () => null,

    onTick(state, dt) {
      if (state.over) return;
      state.timeLeft -= dt;
      if (state.timeLeft > 0) return;

      if (state.phase === 'brief') return openTable(state);
      if (state.phase === 'bets') return startRun(state);
      if (state.phase === 'run') return settle(state);
      if (state.phase === 'payout') {
        if (state.round >= state.settings.rounds) return closeUp(state);
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
        pool: table.id,
        rules: this.howToPlay,
        round: state.round,
        maxRounds: state.settings.rounds,
        timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
        phaseTotal: state.phaseTotal,
        maxBet: state.settings.maxBet,
        minBet: MIN_BET,
        // What can be backed, so the client builds its board from the table
        // rather than from its own idea of what craps is.
        board: Object.entries(table.bets).map(([kind, spec]) => ({
          kind, label: spec.label, returns: spec.returns, note: spec.note ?? null,
        })),
        // Public on purpose — watching the table fill up is most of the fun.
        bets: state.bets.map((b) => ({ id: b.id, name: b.name, kind: b.kind, amount: b.amount })),
        pot: state.bets.reduce((sum, b) => sum + b.amount, 0) + state.carried,
        carried: state.carried,
        outcome: state.outcome,
        result: state.result,
        players: state.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected, net: p.net })),
        briefed: state.briefed,
        log: state.log.slice(-5),
        ...(table.extraView?.(state) ?? {}),
      };
    },

    serializeFor(state, playerId) {
      return {
        ...this.serialize(state),
        you: {
          id: playerId,
          chips: balanceOf(playerId),
          staked: state.bets.filter((b) => b.id === playerId).reduce((sum, b) => sum + b.amount, 0),
          bets: state.bets.filter((b) => b.id === playerId),
        },
      };
    },
  };
}
