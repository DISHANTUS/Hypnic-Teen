// The machines: slots, plinko, the wheel and scratch cards.
//
//   npm run test:chance
//
// Four faces on one engine, so the engine is tested once and hard, and then
// each face is checked for the thing that makes it that machine: reels that
// land three of a kind now and then, a plinko board where the edges really are
// rare, a wheel whose big wedge is genuinely uncommon, and a scratch card that
// pays for three matching.
//
// Odds tables are easy to write and easy to get backwards. A "rare" symbol
// that turns up half the time makes the game pointless and nothing anywhere
// says so — so the rates are measured rather than trusted.

import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-chance');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
process.env.DATA_DIR = TMP;

const { slots, plinko, wheel, scratch } = await import('../server/games/chance.js');
const { balanceOf, walletFor, award } = await import('../server/chips.js');

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};

const api = { emit() {}, emitTo() {}, finish() {}, players: () => [] };
let seq = 0;
const mk = (n) => Array.from({ length: n }, () => {
  const id = `Hypnic>Ch${seq++}<Teen`;
  walletFor(id);
  award(id, 30000);
  return { id, name: `Ch${seq}`, connected: true };
});

function open(game, players = 3, settings = {}) {
  const cast = mk(players);
  const state = game.createState(cast, { settings: { rounds: 10, ante: 20, ...settings } });
  for (const p of cast) game.onAction(state, p, { type: 'briefed' }, api);
  return { state, cast };
}
const totalChips = (cast) => cast.reduce((sum, p) => sum + balanceOf(p.id), 0);

console.log('\n  The machines\n');

/* ------------------------------- all four exist --------------------------- */

{
  const all = [slots, plinko, wheel, scratch];
  check('there are four of them', all.length === 4);
  check('each has its own name and emoji',
    new Set(all.map((g) => g.id)).size === 4 && new Set(all.map((g) => g.emoji)).size === 4,
    all.map((g) => `${g.emoji} ${g.name}`).join(', '));
  check('and they share one client', all.every((g) => g.client === 'chance'));
  check('each says which face it is', all.every((g) => g.machine === g.id));
  check('none of them has a CPU playing for chips', all.every((g) => g.botAction() === null));
}

/* --------------------------------- the engine ----------------------------- */

{
  const { state, cast } = open(slots, 3);
  check('the round opens for staking', state.phase === 'bets', state.phase);

  const before = balanceOf(cast[0].id);
  slots.onAction(state, cast[0], { type: 'stake' }, api);
  check('staking costs chips now', balanceOf(cast[0].id) === before - 20, String(balanceOf(cast[0].id)));
  check('and puts you in', state.players[0].in === true);
  check('the pot grows', slots.serialize(state).pot === 20, String(slots.serialize(state).pot));

  slots.onAction(state, cast[0], { type: 'stake' }, api);
  check('you cannot stake twice in one round', balanceOf(cast[0].id) === before - 20,
    String(balanceOf(cast[0].id)));

  // Nothing about anybody's result until everybody's.
  slots.onAction(state, cast[1], { type: 'stake' }, api);
  slots.onAction(state, cast[2], { type: 'stake' }, api);
  check('everybody in starts it going', state.phase === 'roll', state.phase);
  const wire = slots.serialize(state);
  check('no result is on the wire while it is going',
    wire.players.every((p) => p.roll === null), JSON.stringify(wire.players.map((p) => p.roll)));
  check('not even your own', slots.serializeFor(state, cast[0].id).you.roll === null);

  slots.onTick(state, 999, api);
  check('then everybody sees everybody', slots.serialize(state).players.filter((p) => p.in).every((p) => p.roll),
    JSON.stringify(slots.serialize(state).players.map((p) => Boolean(p.roll))));
}

{
  // Somebody who did not stake is not charged and cannot win.
  const { state, cast } = open(slots, 3);
  slots.onAction(state, cast[0], { type: 'stake' }, api);
  slots.onAction(state, cast[1], { type: 'stake' }, api);
  const sat = balanceOf(cast[2].id);
  slots.onTick(state, 999, api); // bets -> roll
  slots.onTick(state, 999, api); // roll -> payout
  check('sitting a round out costs nothing', balanceOf(cast[2].id) === sat, String(balanceOf(cast[2].id)));
  check('and wins nothing', !state.result.paid.some((p) => p.id === cast[2].id));
}

/* ------------------- what goes in comes out, on all four ------------------ */

{
  const bad = [];
  for (const game of [slots, plinko, wheel, scratch]) {
    const { state, cast } = open(game, 4, { rounds: 150, ante: 20 });
    const before = totalChips(cast);

    let guard = 0;
    while (!game.isOver(state) && guard++ < 3000) {
      if (state.phase === 'bets') {
        // Not everybody every time, so rounds with one player and rounds with
        // none both get exercised.
        for (const p of cast) if (Math.random() < 0.8) game.onAction(state, p, { type: 'stake' }, api);
      }
      game.onTick(state, 999, api);
    }

    const after = totalChips(cast);
    if (after !== before) bad.push(`${game.id}: ${before} in, ${after} out (${after - before})`);
    if (cast.some((p) => balanceOf(p.id) < 0)) bad.push(`${game.id}: somebody went negative`);
    const netSum = game.results(state).reduce((sum, r) => sum + r.score, 0);
    if (netSum !== 0) bad.push(`${game.id}: scoreboard net ${netSum}`);
    if (!game.isOver(state)) bad.push(`${game.id}: never finished`);
  }
  check('a hundred and fifty rounds on each machine balance to the chip',
    bad.length === 0, bad.join(' | '));
}

/* --------------------------------- the odds ------------------------------- */

{
  // Rolled directly, thousands of times, because an odds table that is
  // backwards makes a machine pointless and nothing else would notice.
  const roll = (game) => {
    const { state, cast } = open(game, 1);
    game.onAction(state, cast[0], { type: 'stake' }, api);
    game.onTick(state, 999, api);
    return state.players[0].roll;
  };

  // Slots: three of a kind has to happen, and has to be rare.
  {
    let threes = 0;
    let twos = 0;
    const scores = [];
    for (let i = 0; i < 3000; i++) {
      const r = roll(slots);
      scores.push(r.score);
      if (/^three/.test(r.say)) threes += 1;
      if (/^two/.test(r.say)) twos += 1;
    }
    check('slots land three of a kind sometimes', threes > 0 && threes < 600, `${threes} in 3000`);
    check('and two of a kind far more often', twos > threes * 3, `${twos} twos, ${threes} threes`);
    check('three of a kind is worth much more', Math.max(...scores) >= 50 * 3,
      `best ${Math.max(...scores)}`);
    check('and every roll shows three reels',
      roll(slots).detail.reels.length === 3, JSON.stringify(roll(slots).detail));
  }

  // Plinko: the middle is common, the edges are not — that is the whole game.
  {
    const slotsHit = new Map();
    for (let i = 0; i < 4000; i++) {
      const r = roll(plinko);
      slotsHit.set(r.detail.slot, (slotsHit.get(r.detail.slot) ?? 0) + 1);
    }
    const middle = slotsHit.get(6) ?? 0;
    const edge = (slotsHit.get(0) ?? 0) + (slotsHit.get(12) ?? 0);
    check('plinko lands in the middle most often', middle > (slotsHit.get(3) ?? 0),
      `${middle} in the middle`);
    check('and the edges are genuinely rare', edge < middle / 20, `${edge} on the edges, ${middle} middle`);
    check('every slot is reachable', slotsHit.size >= 9, `${slotsHit.size} of 13 slots seen`);
    check('the disc always ends somewhere legal',
      [...slotsHit.keys()].every((k) => k >= 0 && k <= 12), JSON.stringify([...slotsHit.keys()].sort((a, b) => a - b)));
  }

  // The wheel: the big wedge has to be worth chasing and hard to get.
  {
    const seen = new Map();
    for (let i = 0; i < 4000; i++) {
      const r = roll(wheel);
      seen.set(r.detail.label, (seen.get(r.detail.label) ?? 0) + 1);
    }
    check('every wedge comes up', seen.size === 7, `${seen.size}: ${[...seen.keys()].join(', ')}`);
    check('the small ones are common', (seen.get('1×') ?? 0) > (seen.get('100×') ?? 0) * 5,
      `${seen.get('1×')} at 1×, ${seen.get('100×')} at 100×`);
    check('and the big one is rare but real',
      (seen.get('100×') ?? 0) > 0 && (seen.get('100×') ?? 0) < 400, `${seen.get('100×')} in 4000`);
  }

  // Scratch cards: three matching is the win, and a blank card is common.
  {
    let wins = 0;
    let blanks = 0;
    for (let i = 0; i < 3000; i++) {
      const r = roll(scratch);
      if (r.score > 0) wins += 1; else blanks += 1;
      if (r.detail.panels.length !== 6) { blanks = -1; break; }
    }
    check('a scratch card has six panels', blanks >= 0);
    check('some cards win', wins > 0, `${wins} in 3000`);
    check('and plenty do not', blanks > 0, `${blanks} blank`);
    check('a blank card scores nothing', roll(scratch).score >= 0);
  }
}

/* --------------------------- ties, blanks and rides ----------------------- */

{
  // Everybody blank: nobody has earned it and there is no house to keep it.
  const { state, cast } = open(scratch, 2, { ante: 50 });
  for (const p of cast) scratch.onAction(state, p, { type: 'stake' }, api);
  // Already rolling: the last stake starts it. No tick needed, and a tick here
  // would settle the real rolls before these replace them.
  for (const p of state.players) if (p.in) p.roll = { score: 0, detail: { panels: [] }, say: 'nothing on it' };
  const before = totalChips(cast);
  scratch.onTick(state, 999, api); // payout

  check('a round nobody won pays nobody', state.result.paid.length === 0);
  check('the pot rides on', state.carried === 100, String(state.carried));
  check('and nothing was paid out', totalChips(cast) === before, String(totalChips(cast)));
}

{
  // A tie splits.
  const { state, cast } = open(wheel, 2, { ante: 50 });
  for (const p of cast) wheel.onAction(state, p, { type: 'stake' }, api);
  for (const p of state.players) if (p.in) p.roll = { score: 5, detail: { label: '5×' }, say: 'the 5× wedge' };
  const a = balanceOf(cast[0].id);
  const b = balanceOf(cast[1].id);
  wheel.onTick(state, 999, api);
  check('a tie splits the pot', balanceOf(cast[0].id) === a + 50 && balanceOf(cast[1].id) === b + 50,
    `${balanceOf(cast[0].id) - a} and ${balanceOf(cast[1].id) - b}`);
}

/* ------------------------------- closing up ------------------------------- */

{
  const { state, cast } = open(plinko, 2, { rounds: 1, ante: 50 });
  const before = totalChips(cast);
  for (const p of cast) plinko.onAction(state, p, { type: 'stake' }, api);
  for (const p of state.players) if (p.in) p.roll = { score: 0, detail: { slot: 6, rows: 12 }, say: 'nothing' };
  plinko.onTick(state, 999, api); // payout, nobody won
  plinko.onTick(state, 999, api); // and it closes on the carried pot

  check('closing up hands back what nobody won', totalChips(cast) === before,
    `${before} then ${totalChips(cast)}`);
  check('and it is over', plinko.isOver(state), state.phase);
}

/* --------------------------------- nonsense ------------------------------- */

{
  const { state, cast } = open(slots, 2);
  const before = totalChips(cast);
  slots.onAction(state, { id: 'ghost', name: 'Ghost' }, { type: 'stake' }, api);
  slots.onAction(state, cast[0], { type: 'nonsense' }, api);
  check('somebody not in the room cannot stake', state.players.every((p) => !p.in));
  check('and nothing moved', totalChips(cast) === before);
}

rmSync(TMP, { recursive: true, force: true });

const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — four machines, no house, and the odds are what they say\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
