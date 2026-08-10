// Roulette — the table.
//
//   npm run test:roulette
//
// This one moves people's chips about, so the property that matters more than
// any rule is conservation: across a whole night, the chips that come off the
// table equal the chips that went onto it. A table that quietly creates chips
// inflates the room's economy; one that quietly destroys them takes everyone's
// evening away a few at a time, and neither shows up as an error.
//
// So the maths is hammered over hundreds of spins with the wallets checked
// before and after, rather than one hand eyeballed.

import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-roulette');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
process.env.DATA_DIR = TMP;

const game = (await import('../server/games/roulette.js')).default;
const { WHEEL, BETS, colourOf, wins } = await import('../server/games/roulette.js');
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
  const id = `Hypnic>Punter${seq++}<Teen`;
  walletFor(id);
  return { id, name: `Punter${seq}`, connected: true };
});

/** Past the rules and onto an open table. */
function open(players = 3, settings = {}) {
  const cast = mk(players);
  const state = game.createState(cast, { settings: { rounds: 8, maxBet: 1000, ...settings } });
  for (const p of cast) game.onAction(state, p, { type: 'briefed' }, api);
  return { state, cast };
}
const bet = (state, player, kind, amount, number = null) =>
  game.onAction(state, player, { type: 'bet', kind, amount, number }, api);

/** Runs the wheel to a chosen pocket, so a test can decide who wins. */
function spinTo(state, number) {
  game.onTick(state, 999, api); // bets -> spin
  state.pending = { number, at: WHEEL.indexOf(number) };
  game.onTick(state, 999, api); // spin -> payout
}

console.log('\n  Roulette\n');

/* ------------------------------- the wheel -------------------------------- */

{
  check('a European wheel, one zero', WHEEL.length === 37 && WHEEL.filter((n) => n === 0).length === 1,
    `${WHEEL.length} pockets`);
  check('every number from 0 to 36, once each',
    new Set(WHEEL).size === 37 && WHEEL.every((n) => n >= 0 && n <= 36));
  check('eighteen red and eighteen black',
    WHEEL.filter((n) => colourOf(n) === 'red').length === 18 &&
    WHEEL.filter((n) => colourOf(n) === 'black').length === 18);
  check('and the zero is green', colourOf(0) === 'green');

  // Every bet, against every pocket — the table of what beats what is the one
  // thing here that is easy to get subtly wrong and impossible to notice.
  const wrong = [];
  for (let n = 0; n <= 36; n++) {
    const red = colourOf(n) === 'red';
    const expect = {
      red, black: colourOf(n) === 'black',
      odd: n !== 0 && n % 2 === 1, even: n !== 0 && n % 2 === 0,
      low: n >= 1 && n <= 18, high: n >= 19 && n <= 36,
      dozen1: n >= 1 && n <= 12, dozen2: n >= 13 && n <= 24, dozen3: n >= 25 && n <= 36,
    };
    for (const [kind, want] of Object.entries(expect)) {
      if (wins({ kind }, n) !== want) wrong.push(`${kind} on ${n}`);
    }
    if (!wins({ kind: 'straight', number: n }, n)) wrong.push(`straight ${n} on itself`);
    if (wins({ kind: 'straight', number: (n + 1) % 37 }, n)) wrong.push(`straight ${(n + 1) % 37} on ${n}`);
  }
  check('every bet resolves correctly on all 37 pockets', wrong.length === 0, wrong.slice(0, 3).join(', '));

  // Zero is where a real table takes its cut. Here it just means the outside
  // bets all lose and the pot rides.
  check('zero loses every outside bet',
    ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen1', 'dozen2', 'dozen3']
      .every((kind) => !wins({ kind }, 0)));
  check('but somebody on zero still wins', wins({ kind: 'straight', number: 0 }, 0));
}

/* ------------------------------ placing chips ----------------------------- */

{
  const { state, cast } = open(2);
  const before = balanceOf(cast[0].id);

  bet(state, cast[0], 'red', 50);
  check('a bet lands on the table', state.bets.length === 1, JSON.stringify(state.bets));
  check('and the chips leave the wallet now, not at payout',
    balanceOf(cast[0].id) === before - 50, String(balanceOf(cast[0].id)));

  bet(state, cast[0], 'straight', 20, 17);
  check('you can back several things at once', state.bets.length === 2);

  game.onAction(state, cast[0], { type: 'clear' }, api);
  check('taking it all back before the spin returns everything',
    balanceOf(cast[0].id) === before, String(balanceOf(cast[0].id)));
  check('and clears the table of your chips', state.bets.filter((b) => b.id === cast[0].id).length === 0);

  // Nonsense.
  bet(state, cast[0], 'nonsense', 50);
  bet(state, cast[0], 'straight', 50, 99);
  bet(state, cast[0], 'red', -50);
  bet(state, cast[0], 'red', 0);
  check('nonsense bets are refused', state.bets.length === 0, JSON.stringify(state.bets));
  check('and none of it moved the wallet', balanceOf(cast[0].id) === before, String(balanceOf(cast[0].id)));

  // More than you have.
  bet(state, cast[0], 'red', before + 5000);
  check('you cannot stake what you do not have', state.bets.length === 0);
}

{
  // The table limit is per person per spin, counting what is already down.
  const { state, cast } = open(2, { maxBet: 100 });
  bet(state, cast[0], 'red', 60);
  bet(state, cast[0], 'black', 60);
  check('the table limit counts everything you already have down',
    state.bets.filter((b) => b.id === cast[0].id).reduce((s, b) => s + b.amount, 0) === 60,
    JSON.stringify(state.bets));
  bet(state, cast[1], 'red', 100);
  check('but it is per person, not per table', state.bets.length === 2);
}

/* --------------------- what goes on the table comes off ------------------- */

{
  // The property that matters. Hundreds of spins, wallets weighed before and
  // after: a table with no house must neither create nor destroy a chip.
  const { state, cast } = open(4, { rounds: 500, maxBet: 300 });
  for (const p of cast) award(p.id, 20000);
  const totalBefore = cast.reduce((sum, p) => sum + balanceOf(p.id), 0);

  const kinds = ['red', 'black', 'odd', 'even', 'low', 'high', 'dozen1', 'dozen2', 'dozen3', 'straight'];
  for (let round = 0; round < 400; round++) {
    for (const p of cast) {
      if (Math.random() < 0.25) continue;
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      bet(state, p, kind, 5 + Math.floor(Math.random() * 60), Math.floor(Math.random() * 37));
    }
    spinTo(state, WHEEL[Math.floor(Math.random() * WHEEL.length)]);
    game.onTick(state, 999, api); // payout -> next table
  }

  // Whatever is still riding belongs to somebody; hand it back the way closing
  // the table does, then weigh everything.
  state.round = state.settings.rounds;
  state.phase = 'payout';
  game.onTick(state, 999, api);

  const totalAfter = cast.reduce((sum, p) => sum + balanceOf(p.id), 0);
  check('four hundred spins neither create nor destroy a chip',
    totalAfter === totalBefore, `${totalBefore} in, ${totalAfter} out (${totalAfter - totalBefore})`);
  check('and nobody ended up owing anything', cast.every((p) => balanceOf(p.id) >= 0),
    JSON.stringify(cast.map((p) => balanceOf(p.id))));

  const netSum = state.players.reduce((sum, p) => sum + p.net, 0);
  check('the scoreboard agrees that it was a zero-sum night', netSum === 0, `net total ${netSum}`);
}

/* ------------------------------ sharing it out ---------------------------- */

{
  // One person on the number, everybody else on something that misses: the
  // number takes the lot, which is the whole point of a table with no house.
  //
  // Both losing bets have to genuinely lose. The first version of this put
  // somebody on black against a spin of 17 — which is black — so they won a
  // small share, correctly, and the test read it as a shortfall.
  const { state, cast } = open(3, { maxBet: 1000 });
  for (const p of cast) award(p.id, 5000);
  bet(state, cast[0], 'straight', 100, 17); // black, low, odd, second dozen
  bet(state, cast[1], 'red', 100);          // misses
  bet(state, cast[2], 'dozen3', 100);       // misses
  const had = balanceOf(cast[0].id);
  spinTo(state, 17);

  check('the pot is what everybody staked', state.result.pot === 300, String(state.result.pot));
  check('and the only winner takes all of it', balanceOf(cast[0].id) === had + 300,
    `${balanceOf(cast[0].id)} against ${had + 300}`);
  check('the result says what came up', state.result.number === 17 && state.result.colour === 'black',
    JSON.stringify(state.result.number));

  // And when a colour does also come in, it takes its share and no more.
  const two = open(2, { maxBet: 1000 });
  for (const p of two.cast) award(p.id, 5000);
  bet(two.state, two.cast[0], 'straight', 100, 17);
  bet(two.state, two.cast[1], 'black', 100); // 17 is black, so this wins too
  const straightHad = balanceOf(two.cast[0].id);
  const colourHad = balanceOf(two.cast[1].id);
  spinTo(two.state, 17);
  const straightGot = balanceOf(two.cast[0].id) - straightHad;
  const colourGot = balanceOf(two.cast[1].id) - colourHad;
  check('a colour that also comes in takes a share, not nothing', colourGot > 0, String(colourGot));
  check('but the number takes most of it', straightGot > colourGot * 10,
    `${straightGot} against ${colourGot}`);
  check('and the two of them are the whole pot', straightGot + colourGot === 200,
    String(straightGot + colourGot));
}

{
  // Two on the same colour split it in proportion to what they staked.
  const { state, cast } = open(3, { maxBet: 1000 });
  for (const p of cast) award(p.id, 5000);
  bet(state, cast[0], 'red', 100);
  bet(state, cast[1], 'red', 200);
  bet(state, cast[2], 'black', 300);
  const a = balanceOf(cast[0].id);
  const b = balanceOf(cast[1].id);
  spinTo(state, 3); // red

  check('two winners split the pot by what they staked',
    balanceOf(cast[0].id) - a === 200 && balanceOf(cast[1].id) - b === 400,
    `${balanceOf(cast[0].id) - a} and ${balanceOf(cast[1].id) - b} out of 600`);
}

{
  // A number and a colour both winning: the number is worth far more per chip,
  // exactly as roulette has always priced it.
  const { state, cast } = open(2, { maxBet: 1000 });
  for (const p of cast) award(p.id, 5000);
  bet(state, cast[0], 'straight', 100, 3);
  bet(state, cast[1], 'red', 100);
  const a = balanceOf(cast[0].id);
  const b = balanceOf(cast[1].id);
  spinTo(state, 3);
  const gotA = balanceOf(cast[0].id) - a;
  const gotB = balanceOf(cast[1].id) - b;
  check('a single number is worth far more than a colour, chip for chip',
    gotA > gotB * 10, `${gotA} against ${gotB}`);
  check('and between them they take the whole pot', gotA + gotB === 200, `${gotA + gotB}`);
}

/* -------------------------- nobody won, so it rides ----------------------- */

{
  const { state, cast } = open(2, { maxBet: 1000 });
  for (const p of cast) award(p.id, 5000);
  bet(state, cast[0], 'red', 100);
  bet(state, cast[1], 'red', 100);
  spinTo(state, 0); // green, so both lose

  check('when nobody wins the pot rides on', state.carried === 200, String(state.carried));
  check('and the table says so', /rides on/.test(state.log.slice(-1)[0] ?? ''), state.log.slice(-1)[0]);

  game.onTick(state, 999, api); // next table
  bet(state, cast[0], 'black', 50);
  spinTo(state, 2); // black
  check('the next winner takes the carried pot too', state.result.pot === 250, String(state.result.pot));
  check('and nothing is left riding', state.carried === 0, String(state.carried));
}

/* -------------------------------- the shape ------------------------------- */

{
  const { state, cast } = open(2);
  bet(state, cast[0], 'red', 50);
  game.onTick(state, 999, api); // into the spin

  const wire = JSON.stringify(game.serialize(state));
  check('the number is not sent while the wheel is turning',
    !wire.includes('"pending"'), wire.slice(0, 120));
  check('nor to a single player', !JSON.stringify(game.serializeFor(state, cast[0].id)).includes('pending'));
  check('but who has bet what is public — that is the fun of it',
    game.serialize(state).bets.length === 1);
  check('a player is told their own balance', game.serializeFor(state, cast[0].id).you.chips >= 0);
  check('and what they have on the table', game.serializeFor(state, cast[0].id).you.staked === 50);
}

/* -------------------------------- closing up ------------------------------ */

{
  const { state, cast } = open(2, { rounds: 1, maxBet: 1000 });
  for (const p of cast) award(p.id, 2000);
  const before = cast.reduce((sum, p) => sum + balanceOf(p.id), 0);
  bet(state, cast[0], 'red', 100);
  bet(state, cast[1], 'red', 100);
  spinTo(state, 0); // nobody wins, so it all rides
  game.onTick(state, 999, api); // and the table closes on it

  check('the table closing hands back what nobody won',
    cast.reduce((sum, p) => sum + balanceOf(p.id), 0) === before,
    `${before} then ${cast.reduce((sum, p) => sum + balanceOf(p.id), 0)}`);
  check('and it is over', game.isOver(state), state.phase);

  const table = game.results(state);
  check('everybody is placed', table.length === 2 && table[0].place === 1);
}

/* ------------------------------ nobody at all ----------------------------- */

{
  // A spin with no bets must not divide by zero or pay anybody.
  const { state } = open(2, { maxBet: 1000 });
  spinTo(state, 7);
  check('a spin nobody bet on settles quietly', state.result.pot === 0 && state.result.paid.length === 0,
    JSON.stringify(state.result));
  check('and there is no CPU quietly playing for chips', game.botAction() === null);
}

rmSync(TMP, { recursive: true, force: true });

const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — the table neither creates nor destroys a chip\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
