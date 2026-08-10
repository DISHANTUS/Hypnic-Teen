// The Lottery — everybody buys in, one draw, and somebody's evening changes.
//
// A real lottery keeps most of what it takes; this one keeps nothing. Every
// chip spent on a ticket is in the pot, and the pot goes out on the draw, so
// what the room puts in is exactly what the room gets back. Which makes it a
// game about how many tickets to buy rather than a tax on hope.
//
// The prize is tiered the way people expect — match all six and you take the
// lot, match fewer and you share what is left — but every tier is a slice of
// the same pot, so a draw where nobody matches six pays the smaller tiers more
// rather than paying a building.
//
// The numbers are drawn on the server after the counter closes, and no ticket
// can be bought once it has. Both matter more here than at a card table: a
// client that learns the numbers a second early wins everything, once.

import { stake, award, splitPot, balanceOf, MIN_BET } from '../chips.js';

const PHASES = { brief: 14, buy: 45, draw: 12, payout: 14 };

/** How the pot is cut up. Anything no one matches rolls into the tier below. */
const TIERS = [
  { match: 6, share: 0.50, label: 'all six' },
  { match: 5, share: 0.25, label: 'five' },
  { match: 4, share: 0.15, label: 'four' },
  { match: 3, share: 0.10, label: 'three' },
];

export default {
  id: 'lottery',
  name: 'The Lottery',
  tagline: 'Six numbers, one draw, and every chip spent is in the pot.',
  emoji: '🎰',
  accent: '#f5b93b',
  client: 'lottery',
  minPlayers: 1,
  maxPlayers: 200,
  tickRate: 4,
  stakes: 'chips',

  howToPlay: [
    'Pick six numbers, or let the machine pick them. Buy as many tickets as you like.',
    'Every chip spent goes into the pot. Nothing is kept back — there is no house.',
    'Match all six and you take half the pot; five, four and three share the rest.',
    'A tier nobody matches rolls down to the one below, so the pot always goes out.',
  ],

  options: {
    draws: {
      label: 'Draws',
      hint: 'How many before the counter closes',
      kind: 'number',
      min: 1,
      max: 20,
      hardMax: 100,
      step: 1,
      default: 4,
    },
    ticket: {
      label: 'A ticket costs',
      kind: 'number',
      min: MIN_BET,
      max: 500,
      hardMax: 5000,
      step: 5,
      default: 20,
    },
    pool: {
      label: 'Numbers to pick from',
      hint: 'Fewer means more winners',
      kind: 'choice',
      default: '30',
      choices: [
        { id: '20', label: '1 to 20', note: 'somebody wins most draws' },
        { id: '30', label: '1 to 30', note: 'the usual' },
        { id: '45', label: '1 to 45', note: 'a real long shot' },
      ],
    },
    buySeconds: {
      label: 'Seconds at the counter',
      kind: 'number',
      min: 10,
      max: 180,
      hardMax: 600,
      step: 5,
      default: PHASES.buy,
    },
  },

  createState(players, ctx = {}) {
    const settings = ctx.settings ?? {};
    return {
      settings: {
        draws: Math.max(1, Math.min(100, Number(settings.draws) || 4)),
        ticket: Math.max(MIN_BET, Math.min(5000, Number(settings.ticket) || 20)),
        pool: Math.max(20, Math.min(45, Number(settings.pool) || 30)),
        buySeconds: Math.max(10, Math.min(600, Number(settings.buySeconds) || PHASES.buy)),
      },
      phase: 'brief',
      timeLeft: PHASES.brief,
      phaseTotal: PHASES.brief,
      briefed: [],
      round: 0,
      /** { id, name, numbers[] } — public, because half the fun is the room
       *  seeing that three people all backed the same six. */
      tickets: [],
      carried: 0,
      drawn: null,
      result: null,
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected !== false,
        net: 0,
        bestWin: 0,
      })),
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
      state.players.push({ id: player.id, name: player.name, connected: true, net: 0, bestWin: 0 });
    }
    state.dirty = true;
  },

  onPlayerLeave(state, player) {
    const me = state.players.find((p) => p.id === player.id);
    if (me) me.connected = false;
    // Tickets stay in the draw. They are paid for and they might win.
    state.dirty = true;
  },

  onAction(state, player, action = {}) {
    const me = state.players.find((p) => p.id === player.id);
    if (!me) return;

    if (action.type === 'briefed' && state.phase === 'brief') {
      if (!state.briefed.includes(me.id)) state.briefed.push(me.id);
      state.dirty = true;
      if (everyoneReady(state)) openCounter(state);
      return;
    }

    if (action.type === 'buy' && state.phase === 'buy') {
      const numbers = pickNumbers(action.numbers, state.settings.pool);
      if (!numbers) return;

      const taken = stake(me.id, state.settings.ticket, 'lottery — ticket');
      if (taken.error) return;

      state.tickets.push({ id: me.id, name: me.name, numbers });
      state.dirty = true;
      return;
    }
  },

  botAction: () => null,

  onTick(state, dt) {
    if (state.over) return;
    state.timeLeft -= dt;
    if (state.timeLeft > 0) return;

    if (state.phase === 'brief') return openCounter(state);
    if (state.phase === 'buy') return startDraw(state);
    if (state.phase === 'draw') return settle(state);
    if (state.phase === 'payout') {
      if (state.round >= state.settings.draws) return closeUp(state);
      return openCounter(state);
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
      maxRounds: state.settings.draws,
      timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
      phaseTotal: state.phaseTotal,
      ticketPrice: state.settings.ticket,
      pool: state.settings.pool,
      tiers: TIERS,
      tickets: state.tickets,
      pot: state.tickets.length * state.settings.ticket + state.carried,
      carried: state.carried,
      // Only ever set once the draw has happened. Sending it a moment early
      // would let one client buy the winning ticket.
      drawn: state.drawn,
      result: state.result,
      players: state.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected, net: p.net })),
      briefed: state.briefed,
      log: state.log.slice(-5),
    };
  },

  serializeFor(state, playerId) {
    return {
      ...this.serialize(state),
      you: {
        id: playerId,
        chips: balanceOf(playerId),
        tickets: state.tickets.filter((t) => t.id === playerId),
      },
    };
  },
};

/* --------------------------------- the draw ------------------------------- */

const activePlayers = (state) => state.players.filter((p) => p.connected !== false);

function everyoneReady(state) {
  const list = activePlayers(state);
  return list.length > 0 && list.every((p) => state.briefed.includes(p.id));
}

/** Six different numbers in range, however they arrived. */
function pickNumbers(raw, pool) {
  const list = Array.isArray(raw) ? raw : [];
  const clean = [...new Set(list.map((n) => Math.floor(Number(n))))]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= pool);
  if (clean.length === 6) return clean.sort((a, b) => a - b);

  // Anything short or malformed becomes a lucky dip rather than a refusal.
  // Somebody who taps Buy without picking wants a ticket, not an error.
  const dip = new Set(clean.slice(0, 6));
  while (dip.size < 6) dip.add(1 + Math.floor(Math.random() * pool));
  return [...dip].sort((a, b) => a - b);
}

function openCounter(state) {
  state.round += 1;
  state.phase = 'buy';
  state.tickets = [];
  state.drawn = null;
  state.result = null;
  state.phaseTotal = state.settings.buySeconds;
  state.timeLeft = state.settings.buySeconds;
  state.dirty = true;
}

function startDraw(state) {
  state.phase = 'draw';
  state.phaseTotal = PHASES.draw;
  state.timeLeft = PHASES.draw;
  // Decided now, kept back until the balls have finished rolling. The counter
  // is already shut, so nobody can act on it either way — but a number on a
  // client is a number somebody can read.
  const pool = Array.from({ length: state.settings.pool }, (_, i) => i + 1);
  const drawn = [];
  for (let i = 0; i < 6; i++) {
    drawn.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
  }
  state.pending = drawn.sort((a, b) => a - b);
  state.dirty = true;
}

function settle(state) {
  const drawn = state.pending ?? [];
  state.pending = null;
  state.drawn = drawn;

  const pot = state.tickets.length * state.settings.ticket + state.carried;
  const hits = new Set(drawn);

  // Every ticket, and how many it matched.
  const scored = state.tickets.map((t) => ({
    ...t,
    matched: t.numbers.filter((n) => hits.has(n)).length,
  }));

  // Each tier's share, with anything nobody matched rolling into the tier
  // below rather than being kept. There is nobody to keep it.
  const paidBy = new Map();
  const tierRows = [];
  let spare = 0;
  for (const tier of TIERS) {
    const winners = scored.filter((t) => t.matched === tier.match);
    const chips = Math.floor(pot * tier.share) + spare;
    if (!winners.length) {
      spare = chips;
      tierRows.push({ ...tier, winners: 0, chips: 0 });
      continue;
    }
    spare = 0;
    // A ticket is a claim; two tickets from one person are two claims.
    const claims = winners.map((t) => ({ id: t.id, weight: 1 }));
    const merged = new Map();
    for (const c of claims) merged.set(c.id, (merged.get(c.id) ?? 0) + 1);
    for (const { id, chips: got } of splitPot(chips, [...merged].map(([id, weight]) => ({ id, weight })))) {
      paidBy.set(id, (paidBy.get(id) ?? 0) + got);
    }
    tierRows.push({ ...tier, winners: winners.length, chips });
  }

  // Rounding and the bottom tier's leftovers. Nothing may be left behind: the
  // pot is the room's own chips and there is no house to absorb the remainder.
  const handedOut = [...paidBy.values()].reduce((a, b) => a + b, 0);
  let leftover = pot - handedOut;

  if (leftover > 0) {
    const anyWinner = [...paidBy.keys()];
    if (anyWinner.length) {
      for (const { id, chips } of splitPot(leftover, anyWinner.map((id) => ({ id, weight: paidBy.get(id) })))) {
        paidBy.set(id, (paidBy.get(id) ?? 0) + chips);
      }
      leftover = 0;
    }
  }

  const paid = [];
  for (const [id, chips] of paidBy) {
    award(id, chips, 'lottery');
    const player = state.players.find((p) => p.id === id);
    if (player) player.bestWin = Math.max(player.bestWin, chips);
    paid.push({ id, name: state.players.find((p) => p.id === id)?.name ?? id, chips });
  }

  // Nobody matched anything: it rides on the next draw.
  state.carried = paid.length ? 0 : leftover;

  for (const p of state.players) {
    const spent = state.tickets.filter((t) => t.id === p.id).length * state.settings.ticket;
    p.net += (paidBy.get(p.id) ?? 0) - spent;
  }

  const top = scored.reduce((best, t) => (t.matched > (best?.matched ?? -1) ? t : best), null);
  state.result = {
    drawn,
    tiers: tierRows,
    paid: paid.sort((a, b) => b.chips - a.chips),
    pot,
    carried: state.carried,
    best: top ? { name: top.name, matched: top.matched, numbers: top.numbers } : null,
    said: paid.length
      ? `${paid[0].name} takes ${paid[0].chips}${paid.length > 1 ? ` — ${paid.length} winners` : ''}.`
      : state.tickets.length
        ? `Nobody matched three. ${state.carried} rides on.`
        : 'Nobody bought a ticket.',
  };
  state.log.push(`${drawn.join(' · ')} — ${state.result.said}`);

  state.phase = 'payout';
  state.phaseTotal = PHASES.payout;
  state.timeLeft = PHASES.payout;
  state.dirty = true;
}

/** Whatever never went out goes back to whoever last paid in. */
function closeUp(state) {
  if (state.carried > 0 && state.tickets.length) {
    const owed = new Map();
    for (const t of state.tickets) owed.set(t.id, (owed.get(t.id) ?? 0) + 1);
    for (const { id, chips } of splitPot(state.carried, [...owed].map(([id, weight]) => ({ id, weight })))) {
      award(id, chips, 'lottery — counter closed');
      const player = state.players.find((p) => p.id === id);
      if (player) player.net += chips;
    }
    state.carried = 0;
    state.log.push('Counter closed. What nobody won went back.');
  }
  state.over = true;
  state.phase = 'over';
  state.dirty = true;
}
