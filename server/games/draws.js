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
      /** Who owns the carry. Not state.cards — the last draw can sell nothing. */
      riders: [],
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
  if (state.cards.length) state.riders = state.cards.map((c) => ({ id: c.id, weight: 1 }));

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
  if (state.carried > 0 && state.riders.length) {
    for (const { id, chips } of splitPot(state.carried, state.riders)) {
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

/* --------------------------------- bingo ---------------------------------- */

/**
 * Bingo — a card each, numbers called one at a time, and you have to spot it.
 *
 * The card marks itself. That is deliberate: a call every second and a half
 * against a five by five grid is a test of thumbs, not of attention, and one
 * missed daub would put you out of the round with no way back. What you have to
 * do yourself is *claim* — nothing on this screen ever tells you that you have
 * a line, because seeing it is the entire game.
 *
 * Two prizes out of one pot, so there are two moments rather than one: the
 * first line, and then the full house at the end. Calling with nothing locks
 * your button for a few calls, which is enough to stop people mashing it.
 */
const BINGO_COLUMNS = ['B', 'I', 'N', 'G', 'O'];
const BINGO_PER_COLUMN = 10; // 1–10 under B, 11–20 under I, and so on
const BINGO_POOL = BINGO_COLUMNS.length * BINGO_PER_COLUMN;
const FREE_SQUARE = 12; // the middle of a five by five
/** Calls to sit out after calling with nothing. */
const FALSE_CALL_LOCKOUT = 3;
/** What the first line takes. The rest waits for the full house. */
const LINE_SHARE = 0.3;

/** Five across, five down, two corner to corner. */
const BINGO_LINES = (() => {
  const lines = [];
  for (let r = 0; r < 5; r++) lines.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  lines.push([0, 6, 12, 18, 24]);
  lines.push([4, 8, 12, 16, 20]);
  return lines;
})();

/** A card: five from each column's ten, and the middle given to you. */
export function dealBingoCard() {
  const cells = new Array(25).fill(null);
  for (let col = 0; col < BINGO_COLUMNS.length; col++) {
    const bag = Array.from({ length: BINGO_PER_COLUMN }, (_, i) => col * BINGO_PER_COLUMN + i + 1);
    for (let row = 0; row < 5; row++) {
      const at = row * 5 + col;
      if (at === FREE_SQUARE) continue;
      cells[at] = bag.splice(Math.floor(Math.random() * bag.length), 1)[0];
    }
  }
  return cells;
}

const marked = (n, called) => n === null || called.has(n);
export const hasLine = (cells, called) =>
  BINGO_LINES.some((line) => line.every((i) => marked(cells[i], called)));
export const hasFullHouse = (cells, called) => cells.every((n) => marked(n, called));

/**
 * What the caller says. The old names only ever covered a ninety ball book, so
 * the ones that fit are here and everything else gets its letter and number —
 * which is what a caller does anyway when there is no rhyme for it.
 */
const CALL_NAMES = {
  1: "Kelly's eye", 2: 'one little duck', 7: 'lucky seven', 8: 'garden gate',
  10: 'Downing Street', 11: 'legs eleven', 21: 'key of the door', 22: 'two little ducks',
  26: 'half a crown', 30: 'dirty Gertie', 33: 'all the threes', 39: 'steps',
  44: 'droopy drawers', 45: 'halfway there', 50: 'half a century',
};
export function callName(n) {
  const letter = BINGO_COLUMNS[Math.floor((n - 1) / BINGO_PER_COLUMN)];
  return CALL_NAMES[n] ? `${CALL_NAMES[n]} — ${letter} ${n}` : `${letter} ${n}`;
}

export const bingo = {
  id: 'bingo',
  name: 'Bingo',
  tagline: 'A card each, fifty numbers, and nobody tells you when you have it.',
  emoji: '🎱',
  accent: '#16a085',
  client: 'bingo',
  minPlayers: 1,
  maxPlayers: 60,
  tickRate: 4,
  stakes: 'chips',

  howToPlay: [
    'Buy a card. Numbers are called one at a time and your card marks itself.',
    'Spot a line — across, down or corner to corner — and hit Bingo before anyone else.',
    'The first line takes part of the pot. The rest waits for a full house.',
    'Calling with nothing locks your button for three calls, so look before you shout.',
  ],

  options: {
    rounds: { label: 'Games', kind: 'number', min: 1, max: 20, hardMax: 100, step: 1, default: 4 },
    ante: { label: 'A card costs', kind: 'number', min: MIN_BET, max: 500, hardMax: 5000, step: 5, default: 25 },
    callSeconds: { label: 'Seconds between calls', kind: 'number', min: 1, max: 8, hardMax: 20, step: 0.5, default: 1.8 },
    buySeconds: { label: 'Seconds to buy in', kind: 'number', min: 10, max: 120, hardMax: 300, step: 5, default: 20 },
  },

  createState(players, ctx = {}) {
    const settings = ctx.settings ?? {};
    return {
      settings: {
        rounds: Math.max(1, Math.min(100, Number(settings.rounds) || 4)),
        ante: Math.max(MIN_BET, Math.min(5000, Number(settings.ante) || 25)),
        callSeconds: Math.max(1, Math.min(20, Number(settings.callSeconds) || 1.8)),
        buySeconds: Math.max(10, Math.min(300, Number(settings.buySeconds) || 20)),
      },
      phase: 'brief',
      round: 0,
      timeLeft: PHASES.brief,
      phaseTotal: PHASES.brief,
      briefed: [],
      /** { id, name, cells[25], lockedUntil, falseCalls } */
      cards: [],
      bag: [],
      calls: [],
      sinceCall: 0,
      line: null,
      house: null,
      carried: 0,
      /** Who owns the carry, if there is one. See settleBingo. */
      riders: [],
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
      if (everyoneReady(state)) openBingo(state);
      return;
    }

    if (action.type === 'buy' && state.phase === 'buy') {
      if (state.cards.some((c) => c.id === me.id)) return;
      const taken = stake(me.id, state.settings.ante, 'bingo');
      if (taken.error) return;
      state.cards.push({ id: me.id, name: me.name, cells: dealBingoCard(), lockedUntil: 0, falseCalls: 0 });
      state.dirty = true;
      return;
    }

    if (action.type === 'claim' && state.phase === 'call') {
      const card = state.cards.find((c) => c.id === me.id);
      if (!card || state.calls.length < card.lockedUntil) return;

      const called = new Set(state.calls);
      const house = hasFullHouse(card.cells, called);
      const line = hasLine(card.cells, called);

      if (!state.house && house) {
        state.house = { id: me.id, name: me.name, at: state.calls.length };
        // A full house without a line claimed means nobody spotted theirs in
        // time — it is still a line, so it goes with the house rather than
        // being carried off the table.
        if (!state.line) state.line = { id: me.id, name: me.name, at: state.calls.length };
        state.log.push(`${me.name} has the full house on call ${state.calls.length}.`);
        settleBingo(state);
        return;
      }
      if (!state.line && line) {
        state.line = { id: me.id, name: me.name, at: state.calls.length };
        state.log.push(`${me.name} has a line on call ${state.calls.length}.`);
        state.dirty = true;
        return;
      }
      // Somebody beat you to it is not a mistake. Calling with nothing is.
      if (!line && !house) {
        card.lockedUntil = state.calls.length + FALSE_CALL_LOCKOUT;
        card.falseCalls += 1;
        state.log.push(`${me.name} called it early.`);
        state.dirty = true;
      }
    }
  },

  botAction: () => null,

  onTick(state, dt) {
    if (state.over) return;
    if (state.phase === 'call') return nextCall(state, dt);

    state.timeLeft -= dt;
    if (state.timeLeft > 0) return;
    if (state.phase === 'brief') return openBingo(state);
    if (state.phase === 'buy') return startCalling(state);
    if (state.phase === 'payout') {
      if (state.round >= state.settings.rounds) return closeBingo(state);
      return openBingo(state);
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
      columns: BINGO_COLUMNS,
      perColumn: BINGO_PER_COLUMN,
      pot: state.cards.length * state.settings.ante + state.carried,
      carried: state.carried,
      calls: state.calls,
      lastCall: state.calls.length ? state.calls[state.calls.length - 1] : null,
      lastCallSaid: state.calls.length ? callName(state.calls[state.calls.length - 1]) : '',
      callsLeft: state.bag.length,
      line: state.line,
      house: state.house,
      // Who is at the table, but never their cards — a card on the wire is a
      // card somebody can read the lines off, and spotting your own is the game.
      cards: state.cards.map((c) => ({ id: c.id, name: c.name, falseCalls: c.falseCalls })),
      result: state.result,
      players: state.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected, net: p.net })),
      briefed: state.briefed,
      log: state.log.slice(-5),
    };
  },

  serializeFor(state, playerId) {
    const card = state.cards.find((c) => c.id === playerId) ?? null;
    return {
      ...this.serialize(state),
      you: {
        id: playerId,
        chips: balanceOf(playerId),
        card: card ? card.cells : null,
        // Calls to sit out, so the button can say why it is dead rather than
        // just ignoring the tap.
        lockedFor: card ? Math.max(0, card.lockedUntil - state.calls.length) : 0,
      },
    };
  },
};

function openBingo(state) {
  state.round += 1;
  state.phase = 'buy';
  state.cards = [];
  state.calls = [];
  state.bag = [];
  state.line = null;
  state.house = null;
  state.result = null;
  state.phaseTotal = state.settings.buySeconds;
  state.timeLeft = state.settings.buySeconds;
  state.dirty = true;
}

function startCalling(state) {
  state.phase = 'call';
  const bag = Array.from({ length: BINGO_POOL }, (_, i) => i + 1);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  state.bag = bag;
  state.calls = [];
  // Half a beat before the first number, so the room can look up from buying
  // without the table appearing to have stalled.
  state.sinceCall = -state.settings.callSeconds / 2;
  state.phaseTotal = BINGO_POOL * state.settings.callSeconds;
  state.timeLeft = state.phaseTotal;
  state.dirty = true;
}

function nextCall(state, dt) {
  state.sinceCall += dt;
  state.timeLeft = state.bag.length * state.settings.callSeconds;
  if (state.sinceCall < state.settings.callSeconds) return;
  state.sinceCall = 0;

  // Out of numbers with the house unclaimed: the round ends where it stands.
  if (!state.bag.length) return settleBingo(state);
  state.calls.push(state.bag.pop());
  state.dirty = true;
}

function settleBingo(state) {
  const pot = state.cards.length * state.settings.ante + state.carried;
  // Split into two prizes by subtraction rather than two roundings, so the
  // halves are always exactly the pot however it divides.
  const linePrize = Math.floor(pot * LINE_SHARE);
  const housePrize = pot - linePrize;

  const paid = [];
  let rides = 0;
  const pay = (who, chips, what) => {
    if (chips <= 0) return;
    if (!who) { rides += chips; return; }
    award(who.id, chips, `bingo — ${what}`);
    const player = state.players.find((p) => p.id === who.id);
    if (player) player.bestWin = Math.max(player.bestWin, chips);
    paid.push({ id: who.id, name: who.name, chips, what });
  };
  pay(state.line, linePrize, 'a line');
  pay(state.house, housePrize, 'full house');
  state.carried = rides;

  // Whoever paid into the pot that is now riding owns it. Recorded here rather
  // than read off state.cards when the book closes, because the last game of
  // the night can sell nothing at all — and then the closing refund would find
  // an empty table and the carry would simply cease to exist.
  if (state.cards.length) state.riders = state.cards.map((c) => ({ id: c.id, weight: 1 }));

  for (const c of state.cards) {
    const player = state.players.find((p) => p.id === c.id);
    if (!player) continue;
    const won = paid.filter((x) => x.id === c.id).reduce((sum, x) => sum + x.chips, 0);
    player.net += won - state.settings.ante;
  }

  state.result = {
    pot,
    calls: state.calls.length,
    line: state.line,
    house: state.house,
    paid: paid.sort((a, b) => b.chips - a.chips),
    carried: state.carried,
    said: state.house
      ? `${state.house.name} takes the full house on ${state.calls.length} calls.`
      : state.line
        ? `${state.line.name} got a line. Nobody filled a card — ${state.carried} rides on.`
        : state.cards.length ? `Nobody called. ${state.carried} rides on.` : 'Nobody played.',
  };
  state.log.push(state.result.said);

  state.phase = 'payout';
  state.phaseTotal = PHASES.payout;
  state.timeLeft = PHASES.payout;
  state.dirty = true;
}

function closeBingo(state) {
  // Whatever nobody won goes back to the people who paid it in.
  if (state.carried > 0 && state.riders.length) {
    for (const { id, chips } of splitPot(state.carried, state.riders)) {
      award(id, chips, 'bingo — closed');
      const player = state.players.find((p) => p.id === id);
      if (player) player.net += chips;
    }
    state.carried = 0;
    state.log.push('Book closed. What nobody won went back.');
  }
  state.over = true;
  state.phase = 'over';
  state.dirty = true;
}

export const DRAW_GAMES = [keno, bingo, progressive, jackpot];
