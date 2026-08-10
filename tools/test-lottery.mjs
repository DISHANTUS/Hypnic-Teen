// The Lottery.
//
//   npm run test:lottery
//
// A lottery is the easiest place in a casino to lose chips by accident. The
// pot is cut into four tiers by percentage, percentages of an odd number leave
// remainders, and a tier nobody matches has to go somewhere. Any one of those
// quietly eats chips on most draws and nothing ever says so.
//
// So the whole thing is checked against one rule: every chip spent on a ticket
// comes back out to somebody.

import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-lot');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
process.env.DATA_DIR = TMP;

const game = (await import('../server/games/lottery.js')).default;
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
  const id = `Hypnic>Lot${seq++}<Teen`;
  walletFor(id);
  award(id, 50000);
  return { id, name: `Lot${seq}`, connected: true };
});

function counter(players = 3, settings = {}) {
  const cast = mk(players);
  const state = game.createState(cast, { settings: { draws: 5, ticket: 20, pool: 30, ...settings } });
  for (const p of cast) game.onAction(state, p, { type: 'briefed' }, api);
  return { state, cast };
}
const buy = (state, player, numbers) => game.onAction(state, player, { type: 'buy', numbers }, api);
/** Draws a chosen set rather than a random one. */
function drawTo(state, numbers) {
  game.onTick(state, 999, api); // buy -> draw
  state.pending = [...numbers].sort((a, b) => a - b);
  game.onTick(state, 999, api); // draw -> payout
}
const totalChips = (cast) => cast.reduce((sum, p) => sum + balanceOf(p.id), 0);

console.log('\n  The Lottery\n');

/* ------------------------------- buying in -------------------------------- */

{
  const { state, cast } = counter(3);
  check('the counter opens', state.phase === 'buy', state.phase);

  const before = balanceOf(cast[0].id);
  buy(state, cast[0], [1, 2, 3, 4, 5, 6]);
  check('a ticket costs chips now', balanceOf(cast[0].id) === before - 20, String(balanceOf(cast[0].id)));
  check('and goes in the draw', state.tickets.length === 1, JSON.stringify(state.tickets));
  check('the pot is what has been spent', game.serialize(state).pot === 20, String(game.serialize(state).pot));

  buy(state, cast[0], [1, 2, 3, 4, 5, 6]);
  check('you can buy as many as you like', state.tickets.length === 2);

  // Anything malformed becomes a lucky dip rather than an error — somebody
  // tapping Buy without picking wants a ticket.
  buy(state, cast[1], []);
  buy(state, cast[2], [1, 1, 1]);
  buy(state, cast[2], [99, 100, 101, 1, 2, 3]);
  check('a blank ticket is a lucky dip', state.tickets.length === 5, String(state.tickets.length));
  check('every ticket has six different numbers in range',
    state.tickets.every((t) => new Set(t.numbers).size === 6 && t.numbers.every((n) => n >= 1 && n <= 30)),
    JSON.stringify(state.tickets.map((t) => t.numbers)));
  check('and they are sorted, so a ticket reads like a ticket',
    state.tickets.every((t) => t.numbers.every((n, i) => i === 0 || n > t.numbers[i - 1])));

  // Nothing is bought once the counter shuts.
  game.onTick(state, 999, api);
  const held = state.tickets.length;
  buy(state, cast[0], [7, 8, 9, 10, 11, 12]);
  check('the counter really shuts', state.tickets.length === held, String(state.tickets.length));
}

/* ----------------------- the numbers stay on the server ------------------- */

{
  const { state, cast } = counter(2);
  buy(state, cast[0], [1, 2, 3, 4, 5, 6]);
  game.onTick(state, 999, api); // into the draw

  const wire = JSON.stringify(game.serialize(state));
  check('the numbers are not sent while the balls are rolling',
    !wire.includes('"pending"') && game.serialize(state).drawn === null,
    wire.slice(0, 100));
  check('nor to any one player', !JSON.stringify(game.serializeFor(state, cast[0].id)).includes('pending'));
  check('but everybody can see every ticket — that is the fun of it',
    game.serialize(state).tickets.length === 1);
}

/* --------------------------------- the tiers ------------------------------ */

{
  const { state, cast } = counter(3, { ticket: 100 });
  buy(state, cast[0], [1, 2, 3, 4, 5, 6]);   // all six
  buy(state, cast[1], [1, 2, 3, 4, 5, 7]);   // five
  buy(state, cast[2], [1, 2, 3, 4, 8, 9]);   // four
  const before = [0, 1, 2].map((i) => balanceOf(cast[i].id));
  drawTo(state, [1, 2, 3, 4, 5, 6]);

  const got = [0, 1, 2].map((i) => balanceOf(cast[i].id) - before[i]);
  check('matching all six pays the most', got[0] > got[1] && got[1] > got[2], JSON.stringify(got));
  check('and the whole pot goes out', got.reduce((a, b) => a + b, 0) === 300, String(got.reduce((a, b) => a + b, 0)));
  check('the draw is reported', JSON.stringify(state.result.drawn) === JSON.stringify([1, 2, 3, 4, 5, 6]),
    JSON.stringify(state.result.drawn));
  check('and so is who did best', state.result.best?.matched === 6, JSON.stringify(state.result.best));
}

{
  // A tier nobody matched rolls down rather than being kept.
  const { state, cast } = counter(2, { ticket: 100 });
  buy(state, cast[0], [1, 2, 3, 10, 11, 12]); // three
  buy(state, cast[1], [1, 2, 3, 20, 21, 22]); // three
  const before = totalChips(cast);
  drawTo(state, [1, 2, 3, 4, 5, 6]);

  check('with only threes, they still take the whole pot',
    totalChips(cast) === before + 200, `${totalChips(cast) - before} of 200`);
  check('the tiers above are shown as empty',
    state.result.tiers.filter((t) => t.winners === 0).length === 3,
    JSON.stringify(state.result.tiers.map((t) => t.winners)));
}

{
  // Nobody matched three: it rides.
  const { state, cast } = counter(2, { ticket: 50 });
  buy(state, cast[0], [10, 11, 12, 13, 14, 15]);
  buy(state, cast[1], [16, 17, 18, 19, 20, 21]);
  drawTo(state, [1, 2, 3, 4, 5, 6]);
  check('a draw nobody matched pays nobody', state.result.paid.length === 0);
  check('and the pot rides on', state.carried === 100, String(state.carried));

  game.onTick(state, 999, api); // payout -> next counter
  buy(state, cast[0], [1, 2, 3, 4, 5, 6]);
  check('the carried chips are in the next pot', game.serialize(state).pot === 150,
    String(game.serialize(state).pot));
}

/* ------------------- every chip spent comes back out, always -------------- */

{
  // The property that matters. Hundreds of draws, random tickets, random
  // numbers, with the wallets weighed before and after.
  const { state, cast } = counter(5, { draws: 300, ticket: 20, pool: 20 });
  const before = totalChips(cast);

  let guard = 0;
  while (!game.isOver(state) && guard++ < 4000) {
    if (state.phase === 'buy') {
      for (const p of cast) {
        const howMany = Math.floor(Math.random() * 3);
        for (let i = 0; i < howMany; i++) {
          const nums = new Set();
          while (nums.size < 6) nums.add(1 + Math.floor(Math.random() * 20));
          buy(state, p, [...nums]);
        }
      }
    }
    game.onTick(state, 999, api);
  }

  check('a long session finishes', game.isOver(state), `${state.phase} after ${guard} steps, draw ${state.round}`);
  check('three hundred draws neither create nor destroy a chip',
    totalChips(cast) === before, `${before} in, ${totalChips(cast)} out (${totalChips(cast) - before})`);
  check('and nobody ended up owing anything', cast.every((p) => balanceOf(p.id) >= 0));

  const table = game.results(state);
  check('the scoreboard is a zero-sum night',
    table.reduce((sum, r) => sum + r.score, 0) === 0,
    `net total ${table.reduce((sum, r) => sum + r.score, 0)}`);
}

/* ---------------------------- awkward pot sizes --------------------------- */

{
  // A pot that divides into nothing tidy. The four tiers are 50/25/15/10 of a
  // number that is not divisible by anything, and the remainder has to land
  // somewhere rather than evaporating.
  let worst = null;
  for (let price = 5; price <= 45 && !worst; price += 2) {
    for (let n = 1; n <= 7 && !worst; n++) {
      const { state, cast } = counter(2, { ticket: price, draws: 1 });
      const spent = [];
      for (let i = 0; i < n; i++) {
        buy(state, cast[0], [1, 2, 3, 10, 11, 12]);
        spent.push(price);
      }
      const before = totalChips(cast);
      drawTo(state, [1, 2, 3, 4, 5, 6]);
      const back = totalChips(cast) - before;
      if (back !== n * price) worst = `${n} tickets at ${price} paid back ${back}`;
    }
  }
  check('every awkward pot size still pays out in full', !worst, worst ?? '');
}

/* ---------------------------- closing the counter ------------------------- */

{
  const { state, cast } = counter(2, { draws: 1, ticket: 50 });
  const before = totalChips(cast);
  buy(state, cast[0], [10, 11, 12, 13, 14, 15]);
  buy(state, cast[1], [16, 17, 18, 19, 20, 21]);
  drawTo(state, [1, 2, 3, 4, 5, 6]); // nobody matches, so it rides
  game.onTick(state, 999, api);      // and the counter closes on it

  check('closing the counter gives back what nobody won',
    totalChips(cast) === before, `${before} then ${totalChips(cast)}`);
  check('and it is over', game.isOver(state), state.phase);
}

/* --------------------------------- nonsense ------------------------------- */

{
  const { state, cast } = counter(2);
  const before = totalChips(cast);
  game.onAction(state, { id: 'ghost', name: 'Ghost' }, { type: 'buy', numbers: [1, 2, 3, 4, 5, 6] }, api);
  game.onAction(state, cast[0], { type: 'nonsense' }, api);
  check('somebody not in the room cannot buy a ticket', state.tickets.length === 0);
  check('and nothing moved', totalChips(cast) === before);
  check('there is no CPU quietly buying tickets', game.botAction() === null);
}

rmSync(TMP, { recursive: true, force: true });

const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — every chip spent comes back out\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
