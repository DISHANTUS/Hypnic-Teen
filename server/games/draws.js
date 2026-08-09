// Keno, Bingo, and the two jackpot tables.
//
// Four more, and each one is here rather than folded into an existing engine
// because each has something the others do not: keno lets you choose how many
// spots to play, bingo needs a card and a draw that unfolds, and the jackpot
// tables need a pot that survives between rounds.

import { stake, award, splitPot, balanceOf, MIN_BET } from '../chips.js';
import { createMachine } from './chance.js';

const PHASES = { brief: 15, buy: 30, draw: 14, payout: 12 };

/* ---------------------------------- keno ---------------------------------- */

/**
 * How much a card is worth, by how many spots were played and how many hit.
 *
 * Real keno pays more for a hit on a longer card, because it is far harder —
 * five out of five is a much rarer thing than five out of ten. The weight is
 * what a card claims of the pot; nothing here is a fixed price, so the pot
 * always pays out exactly what went in.
 */
export function kenoWeight(spots, hits) {
  if (hits === 0) return spots >= 6 ? 1 : 0; // playing a long card and missing everything is its own kind of luck
  if (hits < Math.ceil(spots / 2)) return 0;
  // Steeply rewarding: the last hit on a card is worth far more than the first.
  return Math.round(Math.pow(hits, 2.2) * (1 + (hits === spots ? spots : 0)));
}

export const keno = {
  id: 'keno',
  name: 'Keno',
  tagline: 'Pick up to ten from eighty. Twenty come out.',
  emoji: '🔢',
  accent: '#d35400',
  client: 'keno',
  minPlayers: 1,
  maxPlayers: 60,
  tickRate: 4,
  stakes: 'chips',

  howToPlay: [
    'Pick between one and ten numbers from eighty. Twenty are drawn.',
    'A long card that comes in is worth far more than a short one — five from five beats five from ten.',
    'Every chip staked is in the pot. There is no house.',
    'Nobody hits anything and the pot rides on.',
  ],

  options: {
    rounds: { label: 'Draws', kind: 'number', min: 1, max: 30, hardMax: 200, step: 1, default: 8 },
    ante: { label: 'A card costs', kind: 'number', min: MIN_BET, max: 500, hardMax: 5000, step: 5, default: 20 },
    buySeconds: { label: 'Seconds to pick', kind: 'number', min: 10, max: 120, hardMax: 300, step: 5, default: PHASES.buy },
  },

  createState(players, ctx = {}) {
    const settings = ctx.settings ?? {};
    return {
      settings: {
        rounds: Math.max(1, Math.min(200, Number(settings.rounds) || 8)),
        ante: Math.max(MIN_BET, Math.min(5000, Number(settings.ante) || 20)),
        buySeconds: Math.max(10, Math.min(300, Number(settings.buySeconds) || PHASES.buy)),
      },
      phase: 'brief',
      round: 0,
      timeLeft: PHASES.brief,
      phaseTotal: PHASES.brief,
      briefed: [],
      /** { id, name, spots[] } */
      cards: [],
      carried: 0,
      drawn: null,
      result: null,
      players: players.map((p) => ({
        id: p.id, name: p.name, connected: p.connected !== false, net: 0, bestWin: 0,
      })),
      log: [],
      over: false,
      dirty: true,
    };
  },

  onPlayerJoin(state, player) {
    const known = state.players.find((p) => p.id === player.id);
    if (known) { known.connected = true; known.name = player.name; }
    else state.players.push({ id: player.id, name: player.name, connected: true, net: 0, bestWin: 0 });
    state.dirty = true;
  },
  onPlayerLeave(state, player) {
    const me = state.players.find((p) => p.id === player.id);
    if (me) me.connected = false;
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
      // One card each a draw. Choosing how many spots is the whole decision,
      // and buying ten cards of one spot each would sidestep it.
      if (state.cards.some((c) => c.id === me.id)) return;
      const spots = cleanSpots(action.spots);
      if (!spots.length) return;
      const taken = stake(me.id, state.settings.ante, 'keno');
      if (taken.error) return;
      state.cards.push({ id: me.id, name: me.name, spots });
      state.dirty = true;
    }
  },

  botAction: () => null,

  onTick(state, dt) {
    if (state.over) return;
    state.timeLeft -= dt;
    if (state.timeLeft > 0) return;
    if (state.phase === 'brief') return openCounter(state);
    if (state.phase === 'buy') return startDraw(state);
    if (state.phase === 'draw') return settleKeno(state);
    if (state.phase === 'payout') {
      if (state.round >= state.settings.rounds) return closeKeno(state);
      return openCounter(state);
    }
  },

  isDirty(state) { const was = state.dirty; state.dirty = false; return was; },
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
      ante: state.settings.ante,
      pool: 80,
      maxSpots: 10,
      cards: state.cards,
      pot: state.cards.length * state.settings.ante + state.carried,
      carried: state.carried,
      // Only once the draw has happened.
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
        card: state.cards.find((c) => c.id === playerId) ?? null,
      },
    };
  },
};

const everyoneReady = (state) => {
  const list = state.players.filter((p) => p.connected !== false);
  return list.length > 0 && list.every((p) => state.briefed.includes(p.id));
};

/** Up to ten different numbers in range, however they arrived. */
function cleanSpots(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const clean = [...new Set(list.map((n) => Math.floor(Number(n))))]
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 80)
    .slice(0, 10);
  if (clean.length) return clean.sort((a, b) => a - b);
  // Nothing picked is a quick pick of five, not a refusal.
  const dip = new Set();
  while (dip.size < 5) dip.add(1 + Math.floor(Math.random() * 80));
  return [...dip].sort((a, b) => a - b);
}

function openCounter(state) {
  state.round += 1;
  state.phase = 'buy';
  state.cards = [];
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
  const pool = Array.from({ length: 80 }, (_, i) => i + 1);
  const drawn = [];
  for (let i = 0; i < 20; i++) drawn.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
  state.pending = drawn.sort((a, b) => a - b);
  state.dirty = true;
}

function settleKeno(state) {
  const drawn = state.pending ?? [];
  state.pending = null;
  state.drawn = drawn;

  const hits = new Set(drawn);
  const pot = state.cards.length * state.settings.ante + state.carried;

  const scored = state.cards.map((c) => {
    const got = c.spots.filter((n) => hits.has(n)).length;
    return { ...c, hits: got, weight: kenoWeight(c.spots.length, got) };
  });
  const winners = scored.filter((c) => c.weight > 0);

  const paid = [];
  if (winners.length && pot > 0) {
    for (const { id, chips } of splitPot(pot, winners.map((c) => ({ id: c.id, weight: c.weight })))) {
      award(id, chips, 'keno');
      const player = state.players.find((p) => p.id === id);
      if (player) player.bestWin = Math.max(player.bestWin, chips);
      paid.push({ id, name: player?.name ?? id, chips });
    }
    state.carried = 0;
  } else {
    state.carried = pot;
  }

  for (const c of state.cards) {
    const player = state.players.find((p) => p.id === c.id);
    if (player) player.net += (paid.find((x) => x.id === c.id)?.chips ?? 0) - state.settings.ante;
  }

  const best = scored.sort((a, b) => b.weight - a.weight)[0];
  state.result = {
    drawn,
    pot,
    paid: paid.sort((a, b) => b.chips - a.chips),
    carried: state.carried,
    cards: scored.map((c) => ({ id: c.id, name: c.name, spots: c.spots, hits: c.hits })),
    said: paid.length
      ? `${paid[0].name} takes ${paid[0].chips} — ${best.hits} of ${best.spots.length}.`
      : state.cards.length ? `Nobody hit enough. ${state.carried} rides on.` : 'Nobody played.',
  };
  state.log.push(state.result.said);

  state.phase = 'payout';
  state.phaseTotal = PHASES.payout;
  state.timeLeft = PHASES.payout;
  state.dirty = true;
}

function closeKeno(state) {
  if (state.carried > 0 && state.cards.length) {
    const owed = new Map();
    for (const c of state.cards) owed.set(c.id, (owed.get(c.id) ?? 0) + 1);
    for (const { id, chips } of splitPot(state.carried, [...owed].map(([id, weight]) => ({ id, weight })))) {
      award(id, chips, 'keno — closed');
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

/* -------------------------- progressive slots ----------------------------- */

/**
 * Slots with a jackpot that grows until somebody hits three sevens.
 *
 * A slice of every stake goes into it and stays there between rounds, so the
 * longer the room plays without hitting it the bigger it gets. That is the
 * whole appeal of a progressive machine, and it costs nothing here because the
 * slice is the room's own chips being held rather than a house taking a cut.
 */
const PROG_SYMBOLS = [
  { sym: '🍒', weight: 30, worth: 1 },
  { sym: '🍋', weight: 26, worth: 2 },
  { sym: '🔔', weight: 20, worth: 3 },
  { sym: '⭐', weight: 14, worth: 5 },
  { sym: '💎', weight: 8, worth: 10 },
  { sym: '7️⃣', weight: 4, worth: 20 },
];

function spinReels() {
  const pick = () => {
    const total = PROG_SYMBOLS.reduce((s, r) => s + r.weight, 0);
    let n = Math.random() * total;
    for (const row of PROG_SYMBOLS) { n -= row.weight; if (n <= 0) return row; }
    return PROG_SYMBOLS[PROG_SYMBOLS.length - 1];
  };
  return [pick(), pick(), pick()];
}

export const progressive = createMachine({
  id: 'progressive',
  name: 'Progressive Slots',
  tagline: 'A jackpot that grows every round until three sevens land.',
  emoji: '💰',
  accent: '#f39c12',
  blurb: 'Three reels, and a jackpot that grows out of every stake until somebody lands three sevens and takes the lot.',
  /** A tenth of every stake is held back for whoever hits it. */
  jackpotShare: 0.1,
  jackpotWhen: (roll) => roll.detail.reels.every((s) => s === '7️⃣'),
  roll() {
    const reels = spinReels();
    const syms = reels.map((r) => r.sym);
    const counts = new Map();
    for (const r of reels) counts.set(r.sym, (counts.get(r.sym) ?? 0) + 1);
    const [topSym, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const worth = PROG_SYMBOLS.find((s) => s.sym === topSym).worth;
    const score = topCount === 3 ? worth * 50 : topCount === 2 ? worth * 5 : worth;
    return {
      score,
      detail: { reels: syms },
      say: topCount === 3 ? `three ${topSym}` : topCount === 2 ? `two ${topSym}` : `${topSym} high`,
    };
  },
});

/* -------------------------------- jackpot --------------------------------- */

/**
 * Everybody throws in what they like, and one of them takes the lot.
 *
 * Your chance of winning is exactly your share of the pot, which is the
 * fairest gamble there is and the only one on this floor with no rules at all.
 * Staking more does not improve the rate — it buys more of the same pot — so
 * there is nothing to learn and nothing to be beaten by.
 */
export const jackpot = {
  id: 'jackpot',
  name: 'Jackpot',
  tagline: 'Throw in what you like. One of you walks away with all of it.',
  emoji: '🏆',
  accent: '#9b59b6',
  client: 'jackpot',
  minPlayers: 2,
  maxPlayers: 60,
  tickRate: 4,
  stakes: 'chips',

  howToPlay: [
    'Throw in as much or as little as you like.',
    'One winner takes the whole pot.',
    'Your chance is exactly your share of it — a tenth of the pot is a one in ten chance.',
    'No house, no edge, and nothing to work out.',
  ],

  options: {
    rounds: { label: 'Rounds', kind: 'number', min: 1, max: 30, hardMax: 200, step: 1, default: 6 },
    maxBet: { label: 'Most you can throw in', kind: 'number', min: 10, max: 5000, hardMax: 100000, step: 10, default: 500 },
    betSeconds: { label: 'Seconds to throw in', kind: 'number', min: 8, max: 120, hardMax: 300, step: 1, default: 25 },
  },

  createState(players, ctx = {}) {
    const settings = ctx.settings ?? {};
    return {
      settings: {
        rounds: Math.max(1, Math.min(200, Number(settings.rounds) || 6)),
        maxBet: Math.max(10, Math.min(100000, Number(settings.maxBet) || 500)),
        betSeconds: Math.max(8, Math.min(300, Number(settings.betSeconds) || 25)),
      },
      phase: 'brief',
      round: 0,
      timeLeft: PHASES.brief,
      phaseTotal: PHASES.brief,
      briefed: [],
      /** id -> chips thrown in this round. */
      stakes: {},
      result: null,
      players: players.map((p) => ({
        id: p.id, name: p.name, connected: p.connected !== false, net: 0, bestWin: 0,
      })),
      log: [],
      over: false,
      dirty: true,
    };
  },

  onPlayerJoin(state, player) {
    const known = state.players.find((p) => p.id === player.id);
    if (known) { known.connected = true; known.name = player.name; }
    else state.players.push({ id: player.id, name: player.name, connected: true, net: 0, bestWin: 0 });
    state.dirty = true;
  },
  onPlayerLeave(state, player) {
    const me = state.players.find((p) => p.id === player.id);
    if (me) me.connected = false;
    state.dirty = true;
  },

  onAction(state, player, action = {}) {
    const me = state.players.find((p) => p.id === player.id);
    if (!me) return;

    if (action.type === 'briefed' && state.phase === 'brief') {
      if (!state.briefed.includes(me.id)) state.briefed.push(me.id);
      state.dirty = true;
      if (everyoneReady(state)) openJackpot(state);
      return;
    }

    if (action.type === 'throw' && state.phase === 'bets') {
      const amount = Math.floor(Number(action.amount));
      if (!Number.isFinite(amount) || amount <= 0) return;
      const already = state.stakes[me.id] ?? 0;
      if (already + amount > state.settings.maxBet) return;
      const taken = stake(me.id, amount, 'jackpot');
      if (taken.error) return;
      state.stakes[me.id] = already + amount;
      state.dirty = true;
    }
  },

  botAction: () => null,

  onTick(state, dt) {
    if (state.over) return;
    state.timeLeft -= dt;
    if (state.timeLeft > 0) return;
    if (state.phase === 'brief') return openJackpot(state);
    if (state.phase === 'bets') return drawJackpot(state);
    if (state.phase === 'payout') {
      if (state.round >= state.settings.rounds) { state.over = true; state.phase = 'over'; state.dirty = true; return; }
      return openJackpot(state);
    }
  },

  isDirty(state) { const was = state.dirty; state.dirty = false; return was; },
  isOver: (state) => Boolean(state.over),

  results(state) {
    return [...state.players]
      .sort((a, b) => b.net - a.net || b.bestWin - a.bestWin)
      .map((p, i) => ({ playerId: p.id, name: p.name, score: p.net, place: i + 1 }));
  },

  serialize(state) {
    const pot = Object.values(state.stakes).reduce((a, b) => a + b, 0);
    return {
      phase: state.phase,
      rules: this.howToPlay,
      round: state.round,
      maxRounds: state.settings.rounds,
      timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
      phaseTotal: state.phaseTotal,
      maxBet: state.settings.maxBet,
      pot,
      // Everybody's share, which is literally their chance. Public, because
      // watching your slice shrink as somebody else piles in is the game.
      shares: Object.entries(state.stakes).map(([id, chips]) => ({
        id,
        name: state.players.find((p) => p.id === id)?.name ?? id,
        chips,
        percent: pot > 0 ? Math.round((chips / pot) * 1000) / 10 : 0,
      })).sort((a, b) => b.chips - a.chips),
      result: state.result,
      players: state.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected, net: p.net })),
      briefed: state.briefed,
      log: state.log.slice(-5),
    };
  },

  serializeFor(state, playerId) {
    const pot = Object.values(state.stakes).reduce((a, b) => a + b, 0);
    return {
      ...this.serialize(state),
      you: {
        id: playerId,
        chips: balanceOf(playerId),
        staked: state.stakes[playerId] ?? 0,
        chance: pot > 0 ? Math.round(((state.stakes[playerId] ?? 0) / pot) * 1000) / 10 : 0,
      },
    };
  },
};

function openJackpot(state) {
  state.round += 1;
  state.phase = 'bets';
  state.stakes = {};
  state.result = null;
  state.phaseTotal = state.settings.betSeconds;
  state.timeLeft = state.settings.betSeconds;
  state.dirty = true;
}

function drawJackpot(state) {
  const entries = Object.entries(state.stakes).filter(([, n]) => n > 0);
  const pot = entries.reduce((sum, [, n]) => sum + n, 0);

  if (!entries.length || pot <= 0) {
    state.result = { pot: 0, winner: null, said: 'Nobody threw anything in.' };
    state.phase = 'payout';
    state.phaseTotal = PHASES.payout;
    state.timeLeft = PHASES.payout;
    state.dirty = true;
    return;
  }

  // A ticket per chip. Somebody with a tenth of the pot wins a tenth of the
  // time — no weighting to explain and nothing to get subtly wrong.
  let ticket = Math.floor(Math.random() * pot);
  let winner = entries[0][0];
  for (const [id, chips] of entries) {
    if (ticket < chips) { winner = id; break; }
    ticket -= chips;
  }

  award(winner, pot, 'jackpot');
  for (const [id, chips] of entries) {
    const player = state.players.find((p) => p.id === id);
    if (!player) continue;
    player.net += (id === winner ? pot : 0) - chips;
    if (id === winner) player.bestWin = Math.max(player.bestWin, pot);
  }

  const name = state.players.find((p) => p.id === winner)?.name ?? winner;
  const share = Math.round(((state.stakes[winner] ?? 0) / pot) * 1000) / 10;
  state.result = {
    pot,
    winner,
    winnerName: name,
    chance: share,
    said: `${name} takes all ${pot} — on a ${share}% chance.`,
  };
  state.log.push(state.result.said);

  state.phase = 'payout';
  state.phaseTotal = PHASES.payout;
  state.timeLeft = PHASES.payout;
  state.dirty = true;
}

export const DRAW_GAMES = [keno, progressive, jackpot];
