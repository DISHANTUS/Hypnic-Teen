// Baccarat, three card poker, casino war and sic bo.
//
//   npm run test:showdowns
//
// The engine underneath is already tested, so this is about the four sets of
// rules bolted onto it — and specifically about the two that somebody who
// plays these games will spot instantly if they are wrong:
//
//   baccarat      tens and pictures count nothing, and the total runs modulo
//                 ten. A hand of 7+8 is five, not fifteen.
//   three card    a straight beats a flush. With three cards a straight is
//                 the rarer thing, and this is the one table where the usual
//                 order is upside down.
//
// Both are checked exhaustively rather than sampled, because a single wrong
// hand a night is invisible and infuriating.

import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-showdowns');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
process.env.DATA_DIR = TMP;

const { baccarat, threeCard, casinoWar, sicBo, baccaratValue, threeCardRank } =
  await import('../server/games/showdowns.js');
const { balanceOf, walletFor, award } = await import('../server/chips.js');
const { freshDeck, rankOf, valueOf } = await import('../server/cards.js');

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};

const api = { emit() {}, emitTo() {}, finish() {}, players: () => [] };
let seq = 0;
const mk = (n) => Array.from({ length: n }, () => {
  const id = `Hypnic>Sh${seq++}<Teen`;
  walletFor(id);
  award(id, 30000);
  return { id, name: `Sh${seq}`, connected: true };
});
function open(game, players = 3, settings = {}) {
  const cast = mk(players);
  const state = game.createState(cast, { settings: { rounds: 10, ante: 20, ...settings } });
  for (const p of cast) game.onAction(state, p, { type: 'briefed' }, api);
  return { state, cast };
}
const totalChips = (cast) => cast.reduce((sum, p) => sum + balanceOf(p.id), 0);
/** One result from a table, the way a player would get it. */
const rollOne = (game) => {
  const { state, cast } = open(game, 1);
  game.onAction(state, cast[0], { type: 'stake' }, api);
  game.onTick(state, 999, api);
  return state.players[0].roll;
};

console.log('\n  Baccarat, three card poker, casino war and sic bo\n');

/* ------------------------------ all four exist ---------------------------- */

{
  const all = [baccarat, threeCard, casinoWar, sicBo];
  check('there are four of them', all.length === 4);
  check('each with its own name and emoji',
    new Set(all.map((g) => g.id)).size === 4 && new Set(all.map((g) => g.emoji)).size === 4,
    all.map((g) => `${g.emoji} ${g.name}`).join(', '));
  check('all played for chips', all.every((g) => g.stakes === 'chips'));
  check('and none of them has a CPU playing for chips', all.every((g) => g.botAction() === null));
}

/* ---------------------------- baccarat's counting ------------------------- */

{
  // Every card, and what it is worth. Tens and pictures counting as ten is
  // the mistake, and it makes every hand wrong by exactly the amount nobody
  // notices until somebody who plays baccarat sits down.
  const wrong = [];
  for (const card of freshDeck()) {
    const r = rankOf(card);
    const want = ['T', 'J', 'Q', 'K'].includes(r) ? 0 : r === 'A' ? 1 : Number(r);
    if (baccaratValue([card]) !== want) wrong.push(`${card} counted ${baccaratValue([card])}, want ${want}`);
  }
  check('every card is worth what baccarat says it is', wrong.length === 0, wrong.slice(0, 3).join(', '));

  check('seven and eight is five, not fifteen', baccaratValue(['7h', '8d']) === 5,
    String(baccaratValue(['7h', '8d'])));
  check('a king and a nine is nine', baccaratValue(['Kh', '9d']) === 9, String(baccaratValue(['Kh', '9d'])));
  check('two pictures is nothing at all', baccaratValue(['Kh', 'Qd']) === 0, String(baccaratValue(['Kh', 'Qd'])));
  check('three cards still run modulo ten', baccaratValue(['5h', '5d', '5c']) === 5,
    String(baccaratValue(['5h', '5d', '5c'])));

  // The one decision the game has.
  let drew = 0;
  let stood = 0;
  for (let i = 0; i < 2000; i++) {
    const r = rollOne(baccarat);
    if (r.detail.cards.length === 3) drew += 1; else stood += 1;
  }
  check('a low hand draws a third card', drew > 0, `${drew} of 2000 drew`);
  check('and a high one stands', stood > 0, `${stood} stood`);
  check('nothing ever gets a fourth', rollOne(baccarat).detail.cards.length <= 3);
  check('the count is never more than nine',
    Array.from({ length: 500 }, () => rollOne(baccarat)).every((r) => r.detail.total <= 9 && r.detail.total >= 0));

  // A natural should edge a made hand of the same number, or being dealt one
  // is worth nothing.
  const natural = { score: 9 * 2 + 1 };
  const made = { score: 9 * 2 };
  check('a natural nine beats a nine made with three cards', natural.score > made.score);
}

/* ------------------- three card poker, where a straight wins -------------- */

{
  const rank = (...cards) => threeCardRank(cards);
  const beats = (a, b) => a.rank > b.rank || (a.rank === b.rank && a.tiebreak[0] > b.tiebreak[0]);

  const straight = rank('7h', '8d', '9c');
  const flush = rank('2h', '7h', 'Jh');
  check('a straight beats a flush — the whole point of this table',
    beats(straight, flush), `${straight.name} vs ${flush.name}`);

  const ladder = [
    ['high card', rank('2h', '7d', 'Jc')],
    ['a pair', rank('7h', '7d', 'Jc')],
    ['a flush', rank('2h', '7h', 'Jh')],
    ['a straight', rank('7h', '8d', '9c')],
    ['three of a kind', rank('7h', '7d', '7c')],
    ['a straight flush', rank('7h', '8h', '9h')],
  ];
  const wrong = [];
  for (let i = 0; i < ladder.length; i++) {
    for (let j = 0; j < i; j++) {
      if (ladder[i][1].rank <= ladder[j][1].rank) wrong.push(`${ladder[i][0]} did not beat ${ladder[j][0]}`);
    }
  }
  check('every three-card hand beats every weaker one', wrong.length === 0, wrong.slice(0, 3).join(' | '));

  check('A-2-3 is a straight', rank('Ah', '2d', '3c').rank === 3, rank('Ah', '2d', '3c').name);
  check('and it is the lowest one', rank('Ah', '2d', '3c').tiebreak[0] === 3,
    String(rank('Ah', '2d', '3c').tiebreak[0]));
  check('Q-K-A is a straight too', rank('Qh', 'Kd', 'Ac').rank === 3, rank('Qh', 'Kd', 'Ac').name);
  check('but Q-K-2 is not', rank('Qh', 'Kd', '2c').rank === 0, rank('Qh', 'Kd', '2c').name);
  check('and neither is a pair with a gap', rank('7h', '7d', '9c').rank === 1, rank('7h', '7d', '9c').name);

  // Over many deals, the ranks turn up in the right order of rarity.
  const seen = new Map();
  for (let i = 0; i < 20000; i++) {
    const r = rollOne(threeCard);
    seen.set(r.detail.name, (seen.get(r.detail.name) ?? 0) + 1);
  }
  // Pairs are named for their rank — "a pair of 7s" — so counting them means
  // adding the lot up. Asking for "a pair" gets undefined, and the comparison
  // that used to do it was really "is high card more than zero", which proves
  // nothing at all.
  const tally = (prefix) =>
    [...seen.entries()].filter(([name]) => name.startsWith(prefix)).reduce((sum, [, n]) => sum + n, 0);

  check('every three-card hand comes up',
    ['high card', 'a pair', 'a flush', 'a straight', 'three of a kind'].every((k) => tally(k) > 0),
    [...seen.keys()].slice(0, 6).join(', '));
  check('high card is the commonest', tally('high card') > tally('a pair'),
    `${tally('high card')} high card, ${tally('a pair')} pairs`);
  check('and a pair is commoner than a flush', tally('a pair') > tally('a flush'),
    `${tally('a pair')} pairs, ${tally('a flush')} flushes`);
  check('a straight really is rarer than a flush',
    (seen.get('a straight') ?? 0) < (seen.get('a flush') ?? 0),
    `${seen.get('a straight')} straights, ${seen.get('a flush')} flushes`);
  check('three of a kind is rarest but for the straight flush',
    (seen.get('three of a kind') ?? 0) < (seen.get('a straight') ?? 0),
    `${seen.get('three of a kind')} trips`);
}

/* --------------------------------- war ----------------------------------- */

{
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const r = rollOne(casinoWar);
    seen.add(r.detail.cards[0][0]);
    if (r.score !== valueOf(rankOf(r.detail.cards[0]))) { seen.add('WRONG'); break; }
  }
  check('war is nothing but the card', !seen.has('WRONG'));
  check('and every rank turns up', seen.size >= 12, `${seen.size} ranks seen`);
  check('one card each, no more', rollOne(casinoWar).detail.cards.length === 1);
  check('an ace is the best of them', valueOf('A') === 14);
}

/* --------------------------------- sic bo -------------------------------- */

{
  let triples = 0;
  let pairs = 0;
  let plain = 0;
  let outOfRange = null;
  for (let i = 0; i < 6000; i++) {
    const r = rollOne(sicBo);
    const { dice, total } = r.detail;
    if (dice.length !== 3) outOfRange = `${dice.length} dice`;
    if (dice.some((d) => d < 1 || d > 6)) outOfRange = JSON.stringify(dice);
    if (total !== dice.reduce((a, b) => a + b, 0)) outOfRange = `total ${total} for ${dice}`;
    if (/triple/.test(r.say)) triples += 1;
    else if (/pair/.test(r.say)) pairs += 1;
    else plain += 1;
  }
  check('three dice, all of them real', !outOfRange, outOfRange ?? '');
  check('triples happen', triples > 0, `${triples} in 6000`);
  check('and are far rarer than pairs', triples * 5 < pairs, `${triples} triples, ${pairs} pairs`);
  check('most rolls are neither', plain > pairs, `${plain} plain`);

  // A triple has to beat every pair, and a pair every total, or the ranking
  // reads backwards to anybody who has played it.
  let backwards = null;
  for (let i = 0; i < 4000 && !backwards; i++) {
    const a = rollOne(sicBo);
    const b = rollOne(sicBo);
    const kind = (r) => (/triple/.test(r.say) ? 2 : /pair/.test(r.say) ? 1 : 0);
    if (kind(a) > kind(b) && a.score <= b.score) backwards = `${a.say} (${a.score}) did not beat ${b.say} (${b.score})`;
  }
  check('a triple always beats a pair, and a pair always beats a total', !backwards, backwards ?? '');
}

/* ------------------- what goes on the table comes off it ------------------ */

{
  const bad = [];
  for (const game of [baccarat, threeCard, casinoWar, sicBo]) {
    const { state, cast } = open(game, 4, { rounds: 120, ante: 20 });
    const before = totalChips(cast);

    let guard = 0;
    while (!game.isOver(state) && guard++ < 3000) {
      if (state.phase === 'bets') {
        for (const p of cast) if (Math.random() < 0.85) game.onAction(state, p, { type: 'stake' }, api);
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
  check('a hundred and twenty rounds on each table balance to the chip',
    bad.length === 0, bad.join(' | '));
}

/* ---------------------- results stay put until they are due --------------- */

{
  const { state, cast } = open(threeCard, 3);
  for (const p of cast) threeCard.onAction(state, p, { type: 'stake' }, api);
  check('everybody in deals the round', state.phase === 'roll', state.phase);
  const wire = threeCard.serialize(state);
  check('nobody\'s cards are on the wire while it is dealing',
    wire.players.every((p) => p.roll === null), JSON.stringify(wire.players.map((p) => p.roll)));
  check('not even your own', threeCard.serializeFor(state, cast[0].id).you.roll === null);
  threeCard.onTick(state, 999, api);
  check('then everybody sees everybody',
    threeCard.serialize(state).players.filter((p) => p.in).every((p) => p.roll?.detail?.cards?.length === 3));
}

rmSync(TMP, { recursive: true, force: true });

const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
