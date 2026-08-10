// Texas Hold'em — the table.
//
//   npm run test:holdem
//
// Two things in poker are hard and both fail silently.
//
// Side pots. Somebody all-in for 20 into a pot others are raising to 200 can
// only win the part everybody could match; the rest belongs to the players who
// could. Getting it wrong hands somebody else's chips to the short stack, and
// it is invisible until the one hand where it matters.
//
// And chips. However a hand goes — folds, all-ins, split pots, three side pots
// at once — what comes off the table has to equal what went on it. A table
// that quietly mints a chip inflates the room; one that eats a chip takes
// everybody's evening away a few at a time. Neither shows up as an error.
//
// So both are hammered over hundreds of hands rather than eyeballed once.

import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-holdem');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
process.env.DATA_DIR = TMP;

const game = (await import('../server/games/holdem.js')).default;
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
  const id = `Hypnic>Card${seq++}<Teen`;
  walletFor(id);
  award(id, 20000);
  return { id, name: `Card${seq}`, connected: true };
});

/** Everybody ready, everybody sat in, first hand dealt. */
function table(players = 3, settings = {}) {
  const cast = mk(players);
  const state = game.createState(cast, { settings: { hands: 50, bigBlind: 20, ...settings } });
  for (const p of cast) game.onAction(state, p, { type: 'briefed' }, api);
  return { state, cast };
}
const act = (state, cast, type, extra = {}) => {
  const me = state.players.find((p) => p.id === state.turnId);
  if (!me) return null;
  const who = cast.find((c) => c.id === me.id) ?? me;
  game.onAction(state, who, { type, ...extra }, api);
  return me;
};

console.log('\n  Texas Hold\'em\n');

/* -------------------------------- sitting in ------------------------------ */

{
  const { state, cast } = table(3);
  check('everybody is dealt in', state.hand === 1 && state.phase === 'play', `${state.phase} hand ${state.hand}`);
  check('and has two cards', state.players.every((p) => p.cards.length === 2),
    JSON.stringify(state.players.map((p) => p.cards.length)));
  check('the blinds are posted', state.players.filter((p) => p.bet > 0).length === 2,
    JSON.stringify(state.players.map((p) => p.bet)));
  check('there is a pot before anybody has acted', state.players.reduce((s, p) => s + p.bet, 0) === 30,
    String(state.players.reduce((s, p) => s + p.bet, 0)));
  check('somebody has to act', Boolean(state.turnId));

  const mine = game.serializeFor(state, cast[0].id);
  const theirs = game.serializeFor(state, cast[1].id);
  check('you can see your own cards', mine.you.cards.length === 2, JSON.stringify(mine.you.cards));
  check('and nobody else\'s',
    mine.players.filter((p) => p.id !== cast[0].id).every((p) => p.cards.every((c) => c === '??')),
    JSON.stringify(mine.players.map((p) => p.cards)));
  check('their view shows their own, not yours',
    theirs.you.cards.length === 2 && theirs.you.cards.join('') !== mine.you.cards.join(''));
  check('and the deck is never sent', !JSON.stringify(mine).includes('"deck"'));
}

/* ------------------------------- what you may do -------------------------- */

{
  const { state, cast } = table(3);
  const upNext = state.players.find((p) => p.id === state.turnId);
  const can = game.serializeFor(state, upNext.id).you.can;
  check('the player to act is told what they may do', Boolean(can), JSON.stringify(can));
  check('preflop they owe the big blind', can.call === 20, String(can.call));
  check('so they may not check', can.check === false);
  check('and a raise has a floor', can.raiseTo === 40, String(can.raiseTo));

  const notTheirTurn = state.players.find((p) => p.id !== state.turnId);
  check('anybody else is told nothing', game.serializeFor(state, notTheirTurn.id).you.can === null);

  // Acting out of turn does nothing at all.
  const before = JSON.stringify(state.players.map((p) => p.bet));
  game.onAction(state, cast.find((c) => c.id === notTheirTurn.id), { type: 'raise', to: 200 }, api);
  check('acting out of turn is ignored', JSON.stringify(state.players.map((p) => p.bet)) === before);
}

/* --------------------------- a hand played through ------------------------ */

{
  const { state, cast } = table(3);
  // Everybody calls to see a flop.
  act(state, cast, 'call');
  act(state, cast, 'call');
  act(state, cast, 'call');
  check('three callers see a flop', state.board.length === 3, `${state.board.length} on the board`);
  check('and the street moved on', state.street === 'flop', state.street);
  check('bets are swept into the pot', state.players.every((p) => p.bet === 0));
  check('the pot is what everybody put in', game.serialize(state).pot === 60,
    String(game.serialize(state).pot));

  act(state, cast, 'check');
  act(state, cast, 'check');
  act(state, cast, 'check');
  check('checking round moves to the turn', state.street === 'turn' && state.board.length === 4,
    `${state.street}, ${state.board.length}`);

  act(state, cast, 'check');
  act(state, cast, 'check');
  act(state, cast, 'check');
  check('and again to the river', state.street === 'river' && state.board.length === 5,
    `${state.street}, ${state.board.length}`);

  act(state, cast, 'check');
  act(state, cast, 'check');
  act(state, cast, 'check');
  check('a checked-down hand reaches a showdown', state.phase === 'showdown', state.phase);
  check('somebody won it', (state.showdown?.wins?.length ?? 0) >= 1, JSON.stringify(state.showdown?.wins));
  check('and the room is told what with', /takes/.test(state.showdown.said), state.showdown.said);
  check('the cards are turned over at a showdown',
    Object.keys(state.showdown.shown).length >= 2, JSON.stringify(Object.keys(state.showdown.shown).length));
}

{
  // Everybody folds to one. No cards need showing.
  const { state, cast } = table(3);
  act(state, cast, 'fold');
  act(state, cast, 'fold');
  check('folding round hands it to the last one standing', state.phase === 'showdown', state.phase);
  check('and nobody has to show', Object.keys(state.showdown.shown).length === 0,
    JSON.stringify(state.showdown.shown));
  check('the winner takes the blinds', state.showdown.wins[0].chips === 30,
    String(state.showdown.wins[0].chips));
}

/* ------------------------------- the side pot ----------------------------- */

{
  // The hand poker code gets wrong. A short stack all-in for a little, two
  // others betting far past it: the short stack can only win what everybody
  // could match.
  const { state, cast } = table(3, { bigBlind: 20 });

  // Give one of them a tiny stack so their all-in is genuinely short.
  const short = state.players.find((p) => p.id === state.turnId);
  short.stack = 15;

  act(state, cast, 'raise', { to: 1000 });        // short shoves what they have
  check('a short stack all-in goes in for what it has', short.allIn === true && short.stack === 0,
    `${short.stack} left`);

  act(state, cast, 'call');
  act(state, cast, 'call');

  // Play it out.
  let guard = 0;
  while (state.phase === 'play' && guard++ < 40) act(state, cast, 'check') ?? act(state, cast, 'call');

  check('the hand finished', state.phase === 'showdown', state.phase);
  const wonByShort = (state.showdown.wins.find((w) => w.id === short.id)?.chips ?? 0);
  check('the short stack can never win more than everybody matched',
    wonByShort <= short.committed * 3,
    `won ${wonByShort} having committed ${short.committed}`);
}

/* ---------------- what goes on the table comes off it, always ------------- */

{
  // The property that matters. Hundreds of hands, played roughly, with the
  // wallets weighed before and after.
  const { state, cast } = table(4, { hands: 200, bigBlind: 20 });
  // Everything anybody's chips could be sitting in. The first version of this
  // counted wallets and stacks only, and by the time it ran the blinds for
  // hand one were already posted — so it started thirty chips light and read
  // a perfectly balanced table as a leak.
  const onTable = () =>
    state.players.reduce((sum, p) => sum + p.stack + p.bet, 0)
    + state.pots.reduce((sum, pot) => sum + pot.chips, 0);
  const before = cast.reduce((sum, p) => sum + balanceOf(p.id), 0) + onTable();

  let guard = 0;
  while (!game.isOver(state) && guard++ < 6000) {
    if (state.phase === 'play') {
      const me = state.players.find((p) => p.id === state.turnId);
      if (!me) { game.onTick(state, 999, api); continue; }
      const can = game.serializeFor(state, me.id).you.can;
      const roll = Math.random();
      if (!can) { game.onTick(state, 999, api); continue; }
      if (roll < 0.15) act(state, cast, 'fold');
      else if (roll < 0.75) act(state, cast, can.check ? 'check' : 'call');
      else if (can.canRaise) act(state, cast, 'raise', { to: Math.random() < 0.2 ? can.allInTo : can.raiseTo });
      else act(state, cast, can.check ? 'check' : 'call');
    } else {
      game.onTick(state, 999, api);
    }
  }

  check('a long session finishes', game.isOver(state), `${state.phase} after ${guard} steps, hand ${state.hand}`);

  const after = cast.reduce((sum, p) => sum + balanceOf(p.id), 0);
  check('hundreds of hands neither create nor destroy a chip', after === before,
    `${before} in, ${after} out (${after - before})`);
  check('and nobody ended up owing anything', cast.every((p) => balanceOf(p.id) >= 0),
    JSON.stringify(cast.map((p) => balanceOf(p.id))));

  const table2 = game.results(state);
  check('the scoreboard is a zero-sum night',
    table2.reduce((sum, r) => sum + r.score, 0) === 0,
    `net total ${table2.reduce((sum, r) => sum + r.score, 0)}`);
  check('everybody is placed', table2.length === 4 && table2[0].place === 1);
}

/* --------------------------- nonsense from a client ----------------------- */

{
  const { state, cast } = table(3);
  const me = state.players.find((p) => p.id === state.turnId);
  const before = JSON.stringify({ bets: state.players.map((p) => p.bet), turn: state.turnId });

  const who = cast.find((c) => c.id === me.id);
  game.onAction(state, who, { type: 'raise', to: 5 }, api);       // below the floor
  game.onAction(state, who, { type: 'raise', to: -100 }, api);
  game.onAction(state, who, { type: 'raise', to: 'lots' }, api);
  game.onAction(state, who, { type: 'nonsense' }, api);
  game.onAction(state, { id: 'ghost', name: 'Ghost' }, { type: 'fold' }, api);
  check('every kind of nonsense is ignored',
    JSON.stringify({ bets: state.players.map((p) => p.bet), turn: state.turnId }) === before);

  // A raise beyond the stack becomes exactly all-in rather than being refused
  // or, worse, going through.
  game.onAction(state, who, { type: 'raise', to: 999999 }, api);
  check('a raise past your stack is simply all-in', me.allIn === true && me.stack === 0,
    `${me.stack} left, all-in ${me.allIn}`);
}

/* ---------------------------- leaving mid-hand ---------------------------- */

{
  const { state, cast } = table(3);
  const victim = state.players.find((p) => p.id !== state.turnId && p.bet > 0);
  const inPot = victim.bet;
  game.onPlayerLeave(state, { id: victim.id });
  check('somebody leaving mid-hand is folded, not refunded',
    victim.folded === true && victim.bet === inPot,
    `${victim.bet} still in`);
  void cast;
}

rmSync(TMP, { recursive: true, force: true });

const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — the table balances, hand after hand\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
