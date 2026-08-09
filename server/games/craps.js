// Craps and the horses — two shared events, one pool each.
//
// Both are the same shape as roulette: everybody backs something, one thing
// happens, and whoever called it shares the pot. Neither has a house, so the
// odds are pool shares weighted by what each bet has always been worth rather
// than fixed prices somebody has to cover.

import { createPoolTable } from './pools.js';

/* ---------------------------------- craps --------------------------------- */

const die = () => 1 + Math.floor(Math.random() * 6);
const roll = () => {
  const a = die();
  const b = die();
  return { dice: [a, b], total: a + b, hard: a === b };
};

/**
 * A come-out roll, and then the point if there is one.
 *
 * The point phase is the whole game — a seven wins on the come-out and loses
 * on every roll after it, which is the only rule in craps everybody knows and
 * the one a shortened version throws away. So the whole hand is rolled here
 * and the client replays it.
 */
function shootCraps() {
  const rolls = [roll()];
  const comeOut = rolls[0].total;

  if ([7, 11].includes(comeOut)) return { rolls, comeOut, point: null, pass: true, reason: 'a natural' };
  if ([2, 3, 12].includes(comeOut)) return { rolls, comeOut, point: null, pass: false, reason: 'craps' };

  const point = comeOut;
  // Rolling until the point or a seven. Bounded, because an unlucky sequence
  // could in principle run a very long time and nobody wants to watch it.
  for (let i = 0; i < 60; i++) {
    const next = roll();
    rolls.push(next);
    if (next.total === point) return { rolls, comeOut, point, pass: true, reason: `the point, ${point}` };
    if (next.total === 7) return { rolls, comeOut, point, pass: false, reason: 'seven out' };
  }
  return { rolls, comeOut, point, pass: false, reason: 'seven out' };
}

const FIELD = new Set([2, 3, 4, 9, 10, 11, 12]);

export const craps = createPoolTable({
  id: 'craps',
  name: 'Craps',
  tagline: 'One shooter, everybody betting. Pass or don’t, and no house either way.',
  emoji: '🎲',
  accent: '#e67e22',
  client: 'pool',
  roundWord: 'Shoots',
  blurb: 'One shooter rolls for the whole table. Back the pass line, the field, a total, or the shooter to seven out.',

  bets: {
    pass: { label: 'Pass line', returns: 2, note: '7 or 11 now, or the point before a seven' },
    dontPass: { label: 'Don’t pass', returns: 2, note: 'craps now, or a seven before the point' },
    field: { label: 'Field', returns: 2, note: '2, 3, 4, 9, 10, 11 or 12 on the come-out' },
    anyCraps: { label: 'Any craps', returns: 8, note: '2, 3 or 12 on the come-out' },
    yo: { label: 'Yo — eleven', returns: 16, note: 'exactly 11 on the come-out' },
    snakeEyes: { label: 'Snake eyes', returns: 31, note: 'double one on the come-out' },
    hardWay: { label: 'A hard way', returns: 5, note: 'the come-out is a double' },
  },

  run: () => shootCraps(),

  wins(bet, outcome) {
    const first = outcome.rolls[0];
    switch (bet.kind) {
      case 'pass': return outcome.pass === true;
      case 'dontPass': return outcome.pass === false;
      case 'field': return FIELD.has(outcome.comeOut);
      case 'anyCraps': return [2, 3, 12].includes(outcome.comeOut);
      case 'yo': return outcome.comeOut === 11;
      case 'snakeEyes': return outcome.comeOut === 2;
      case 'hardWay': return first.hard === true;
      default: return false;
    }
  },

  say: (outcome) => {
    const first = outcome.rolls[0];
    const rolled = `${first.dice[0]}-${first.dice[1]}`;
    if (!outcome.point) return `${rolled} — ${outcome.reason}`;
    const last = outcome.rolls[outcome.rolls.length - 1];
    return `${rolled}, point ${outcome.point}, then ${last.dice[0]}-${last.dice[1]} — ${outcome.reason}`;
  },
});

/* ------------------------------- horse racing ----------------------------- */

/**
 * Six runners, each with its own form.
 *
 * The favourite really is faster and the outsider really is slower — a race
 * where every horse is identical is a six-sided die with a picture on it, and
 * the whole point of backing an outsider is that it might come in.
 */
// The spread between them is deliberately narrow. The first version ran the
// favourite at 15 and the outsider at 9, which over thirty strides is a gap no
// amount of luck closes — the outsider did not win once in three thousand
// races. A 16-to-1 runner that cannot win is worse than not having one.
export const RUNNERS = [
  { id: 'h1', name: 'Monsoon Runner', speed: 11.0, returns: 3 },
  { id: 'h2', name: 'Chai Express', speed: 10.6, returns: 4 },
  { id: 'h3', name: 'Last Bench', speed: 10.2, returns: 5 },
  { id: 'h4', name: 'Hostel Ghost', speed: 9.8, returns: 7 },
  { id: 'h5', name: 'Autorickshaw', speed: 9.4, returns: 9 },
  { id: 'h6', name: 'Attendance Shortage', speed: 9.0, returns: 12 },
];

/** How far the track is, in strides. */
const FURLONGS = 30;

/**
 * Runs the race, stride by stride, and keeps the whole thing.
 *
 * Kept rather than just the winner, so the client can replay it — a result
 * that simply appears is a lottery draw, and half of a race is watching one
 * horse come through on the outside.
 */
function runRace() {
  const positions = Object.fromEntries(RUNNERS.map((h) => [h.id, 0]));
  const frames = [];

  for (let step = 0; step < 40; step++) {
    for (const h of RUNNERS) {
      // Its own pace, plus enough luck that the favourite is not a certainty
      // and the outsider is not a decoration. The noise is large next to the
      // gap in form on purpose: over thirty strides the difference between
      // best and worst is about five, and a stride's luck swings three.
      positions[h.id] += Math.max(0, h.speed / 10 + (Math.random() - 0.35) * 3);
    }
    frames.push(Object.fromEntries(RUNNERS.map((h) => [h.id, Math.min(FURLONGS, Math.round(positions[h.id] * 10) / 10)])));
    if (RUNNERS.some((h) => positions[h.id] >= FURLONGS)) break;
  }

  const order = [...RUNNERS].sort((a, b) => positions[b.id] - positions[a.id]);
  return {
    frames,
    finish: order.map((h) => ({ id: h.id, name: h.name })),
    winner: order[0].id,
    winnerName: order[0].name,
  };
}

export const horses = createPoolTable({
  id: 'horses',
  name: 'Horse Racing',
  tagline: 'Six runners, one race, and the pot goes to whoever backed the winner.',
  emoji: '🐎',
  accent: '#27ae60',
  client: 'pool',
  roundWord: 'Races',
  blurb: 'Six runners with real form. Back one — the outsiders pay far more, and sometimes they come in.',

  bets: Object.fromEntries(
    RUNNERS.map((h) => [h.id, { label: h.name, returns: h.returns, note: `${h.returns - 1} to 1` }])
  ),

  run: () => runRace(),
  wins: (bet, outcome) => bet.kind === outcome.winner,
  say: (outcome) => `${outcome.winnerName} takes it`,
});

export const POOL_GAMES = [craps, horses];
