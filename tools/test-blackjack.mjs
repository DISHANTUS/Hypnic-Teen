// Blackjack with no dealer.
//
//   npm run test:blackjack
//
// The rules are short, so most of this is the thing that is short in every
// casino game and wrong in most of them: the chips. Whatever the hand does —
// everybody bust, a three-way split, somebody leaving mid-hand, the table
// closing while an ante is on the felt — what comes off has to equal what
// went on.

import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-bj');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
process.env.DATA_DIR = TMP;

const game = (await import('../server/games/blackjack.js')).default;
const { balanceOf, walletFor, award } = await import('../server/chips.js');
const { blackjackValue } = await import('../server/cards.js');

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};

const api = { emit() {}, emitTo() {}, finish() {}, players: () => [] };
let seq = 0;
const mk = (n) => Array.from({ length: n }, () => {
  const id = `Hypnic>BJ${seq++}<Teen`;
  walletFor(id);
  award(id, 10000);
  return { id, name: `BJ${seq}`, connected: true };
});

/** Ready, anted, cards out. */
function dealt(players = 3, settings = {}) {
  const cast = mk(players);
  const state = game.createState(cast, { settings: { hands: 20, ante: 20, ...settings } });
  for (const p of cast) game.onAction(state, p, { type: 'briefed' }, api);
  for (const p of cast) game.onAction(state, p, { type: 'ante' }, api);
  return { state, cast };
}
const totalChips = (cast) => cast.reduce((sum, p) => sum + balanceOf(p.id), 0);

console.log('\n  Blackjack\n');

/* -------------------------------- the deal -------------------------------- */

{
  const { state, cast } = dealt(3);
  check('anteing up deals the hand', state.phase === 'play', state.phase);
  check('everybody has two cards', state.players.every((p) => p.cards.length === 2),
    JSON.stringify(state.players.map((p) => p.cards.length)));
  check('the pot is what everybody anted', game.serialize(state).pot === 60,
    String(game.serialize(state).pot));
  check('and it came off their wallets', totalChips(cast) === 3 * 10500 - 60, String(totalChips(cast)));

  // One card up, one down, until the reveal.
  const shared = game.serialize(state);
  check('only one card each is face up',
    shared.players.every((p) => p.cards.filter((c) => c === '??').length === 1),
    JSON.stringify(shared.players.map((p) => p.cards)));
  check('and nobody\'s total is sent early',
    shared.players.every((p) => p.total === null), JSON.stringify(shared.players.map((p) => p.total)));

  const mine = game.serializeFor(state, cast[0].id);
  check('you can see your own hand', mine.you.cards.length === 2 && !mine.you.cards.includes('??'),
    JSON.stringify(mine.you.cards));
  check('and you are told what it comes to', mine.you.total > 0, String(mine.you.total));
  check('the deck is never sent', !JSON.stringify(mine).includes('"deck"'));
}

/* ------------------------------- hit and stand ---------------------------- */

{
  const { state, cast } = dealt(3);
  const me = state.players[0];
  const before = me.cards.length;
  game.onAction(state, cast[0], { type: 'hit' }, api);
  check('hitting draws a card', me.cards.length === before + 1, String(me.cards.length));

  game.onAction(state, cast[0], { type: 'stand' }, api);
  check('standing ends your hand', me.stood === true);

  const after = me.cards.length;
  game.onAction(state, cast[0], { type: 'hit' }, api);
  check('and you cannot hit once you have stood', me.cards.length === after);
}

{
  // Twenty-one stands itself — there is nothing to gain by drawing.
  const { state, cast } = dealt(2);
  const me = state.players[0];
  me.cards = ['Th', '5d'];
  state.deck.push('6c');
  game.onAction(state, cast[0], { type: 'hit' }, api);
  check('drawing to exactly twenty-one stands you', me.stood === true && blackjackValue(me.cards).total === 21,
    `${blackjackValue(me.cards).total}, stood ${me.stood}`);
}

{
  // Bust is out.
  const { state, cast } = dealt(2);
  const me = state.players[0];
  me.cards = ['Th', 'Kd'];
  state.deck.push('9c');
  game.onAction(state, cast[0], { type: 'hit' }, api);
  check('going over twenty-one is bust', me.bust === true, String(blackjackValue(me.cards).total));
  check('and the table is told', /went bust/.test(state.log.join(' ')), state.log.slice(-1)[0]);
}

/* ----------------------------- who takes the pot -------------------------- */

{
  const { state, cast } = dealt(3);
  state.players[0].cards = ['Th', '9d']; // 19
  state.players[1].cards = ['Th', '8d']; // 18
  state.players[2].cards = ['Th', 'Kd']; // 20
  const before = balanceOf(cast[2].id);
  for (const p of cast) game.onAction(state, p, { type: 'stand' }, api);

  check('closest to twenty-one takes it', balanceOf(cast[2].id) === before + 60,
    `${balanceOf(cast[2].id) - before}`);
  check('and the table is told what with', /takes 60 with 20/.test(state.result.said), state.result.said);
}

{
  // Blackjack beats a twenty-one made the long way — the one rule from the
  // real game worth keeping, or being dealt it is worth nothing.
  const { state, cast } = dealt(2);
  state.players[0].cards = ['Ah', 'Kd'];        // blackjack
  state.players[1].cards = ['7h', '7d', '7c'];  // twenty-one, three cards
  const before = balanceOf(cast[0].id);
  for (const p of cast) game.onAction(state, p, { type: 'stand' }, api);
  check('blackjack beats a made twenty-one', balanceOf(cast[0].id) === before + 40,
    `${balanceOf(cast[0].id) - before}`);
  check('and it is called blackjack', /blackjack/.test(state.result.said), state.result.said);
}

{
  // A tie splits.
  const { state, cast } = dealt(2);
  state.players[0].cards = ['Th', '9d'];
  state.players[1].cards = ['9h', 'Td'];
  const a = balanceOf(cast[0].id);
  const b = balanceOf(cast[1].id);
  for (const p of cast) game.onAction(state, p, { type: 'stand' }, api);
  check('a tie splits the pot', balanceOf(cast[0].id) === a + 20 && balanceOf(cast[1].id) === b + 20,
    `${balanceOf(cast[0].id) - a} and ${balanceOf(cast[1].id) - b}`);
  check('which is everybody getting their ante back', state.players.every((p) => p.net === 0),
    JSON.stringify(state.players.map((p) => p.net)));
}

{
  // Everybody bust: nobody has earned it and there is no house to keep it.
  const { state, cast } = dealt(2);
  for (const p of state.players) { p.cards = ['Th', 'Kd', '5c']; p.bust = true; }
  const before = totalChips(cast);
  game.onTick(state, 999, api);
  check('everybody bust means nobody wins', state.result.paid.length === 0, JSON.stringify(state.result.paid));
  check('and the pot rides on', state.carried === 40, String(state.carried));
  check('nothing was paid out', totalChips(cast) === before, String(totalChips(cast)));

  // Next hand, and somebody takes the lot.
  game.onTick(state, 999, api); // reveal -> bets
  for (const p of cast) game.onAction(state, p, { type: 'ante' }, api);
  check('the carried chips are in the next pot', game.serialize(state).pot === 80,
    String(game.serialize(state).pot));
}

/* --------------------- what goes on the table comes off ------------------- */

{
  const cast = mk(4);
  const state = game.createState(cast, { settings: { hands: 120, ante: 20 } });
  for (const p of cast) game.onAction(state, p, { type: 'briefed' }, api);
  const before = totalChips(cast);

  let guard = 0;
  while (!game.isOver(state) && guard++ < 4000) {
    if (state.phase === 'bets') {
      for (const p of cast) game.onAction(state, p, { type: 'ante' }, api);
    } else if (state.phase === 'play') {
      for (const p of cast) {
        const me = state.players.find((x) => x.id === p.id);
        if (!me || me.stood || me.bust) continue;
        const total = blackjackValue(me.cards).total;
        // Play roughly, including badly — a table only ever tested with
        // sensible play never sees five-card hands or a whole table bust.
        game.onAction(state, p, { type: total < 17 || Math.random() < 0.25 ? 'hit' : 'stand' }, api);
      }
      if (state.phase === 'play') game.onTick(state, 999, api);
    } else {
      game.onTick(state, 999, api);
    }
  }

  check('a long session finishes', game.isOver(state), `${state.phase} after ${guard} steps, hand ${state.hand}`);
  check('a hundred hands neither create nor destroy a chip', totalChips(cast) === before,
    `${before} in, ${totalChips(cast)} out (${totalChips(cast) - before})`);
  check('and nobody ended up owing anything', cast.every((p) => balanceOf(p.id) >= 0));
  const table = game.results(state);
  check('the scoreboard is a zero-sum night',
    table.reduce((sum, r) => sum + r.score, 0) === 0,
    `net total ${table.reduce((sum, r) => sum + r.score, 0)}`);
}

/* --------------------------- the table closing early ---------------------- */

{
  // The one that leaks if nobody is looking: the table closes while an ante is
  // on the felt for a hand that never gets dealt.
  const cast = mk(2);
  const state = game.createState(cast, { settings: { hands: 5, ante: 20 } });
  for (const p of cast) game.onAction(state, p, { type: 'briefed' }, api);
  const before = totalChips(cast);

  // One antes, the other does not, and the clock runs out.
  game.onAction(state, cast[0], { type: 'ante' }, api);
  check('one ante is on the felt', totalChips(cast) === before - 20, String(totalChips(cast)));
  game.onTick(state, 999, api);
  check('a table that cannot deal closes', game.isOver(state), state.phase);
  check('and gives back an ante for a hand nobody played', totalChips(cast) === before,
    `${before} then ${totalChips(cast)}`);
}

/* --------------------------- nonsense from a client ----------------------- */

{
  const { state, cast } = dealt(2);
  const before = JSON.stringify(state.players.map((p) => p.cards.length));
  game.onAction(state, { id: 'ghost', name: 'Ghost' }, { type: 'hit' }, api);
  game.onAction(state, cast[0], { type: 'nonsense' }, api);
  game.onAction(state, cast[0], { type: 'ante' }, api); // already in, and wrong phase
  check('nonsense changes nothing', JSON.stringify(state.players.map((p) => p.cards.length)) === before);
  check('and nobody is charged twice for an ante',
    state.players.every((p) => p.ante === 20), JSON.stringify(state.players.map((p) => p.ante)));
  check('there is no CPU quietly playing for chips', game.botAction() === null);
}

rmSync(TMP, { recursive: true, force: true });

const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — no dealer, and the chips balance\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
