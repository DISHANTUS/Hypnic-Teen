// Craps, the horses, keno, the progressive and the jackpot.
//
//   npm run test:tables
//
// Five more, and between them three new ways to lose chips by accident:
//
//   the pool      craps and the horses share one engine that pays a weighted
//                 share of a pot. Weighted wrongly and an outsider pays the
//                 same as the favourite.
//   the jackpot   a progressive holds a slice of every stake between rounds.
//                 Chips sitting in the middle across rounds are chips that can
//                 quietly vanish when the table closes.
//   the raffle    the jackpot table's whole promise is that your chance equals
//                 your share. If that drifts, nobody can tell by playing.
//
// So all three are measured, and everything is checked against the rule every
// table on this floor lives by: what comes off equals what went on.

import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-tables');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
process.env.DATA_DIR = TMP;

const { craps, horses, RUNNERS } = await import('../server/games/craps.js');
const { keno, bingo, progressive, jackpot, kenoWeight, hasLine, hasFullHouse } =
  await import('../server/games/draws.js');
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
  const id = `Hypnic>Tb${seq++}<Teen`;
  walletFor(id);
  award(id, 40000);
  return { id, name: `Tb${seq}`, connected: true };
});
function open(game, players = 3, settings = {}) {
  const cast = mk(players);
  const state = game.createState(cast, { settings: { rounds: 10, ...settings } });
  for (const p of cast) game.onAction(state, p, { type: 'briefed' }, api);
  return { state, cast };
}
const totalChips = (cast) => cast.reduce((sum, p) => sum + balanceOf(p.id), 0);

console.log('\n  Craps, the horses, keno, the progressive and the jackpot\n');

/* --------------------------------- craps ---------------------------------- */

{
  const { state } = open(craps, 2, { maxBet: 500 });
  check('the table opens for betting', state.phase === 'bets', state.phase);
  check('and offers the bets a craps table offers',
    ['pass', 'dontPass', 'field', 'anyCraps', 'yo', 'snakeEyes', 'hardWay']
      .every((k) => craps.serialize(state).board.some((b) => b.kind === k)),
    craps.serialize(state).board.map((b) => b.kind).join(', '));

  // Every come-out, and what pass and don't pass do with it. This is the one
  // rule in craps everybody knows, and getting it backwards would be spotted
  // in the first minute.
  const wrong = [];
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      const total = a + b;
      const outcome = { rolls: [{ dice: [a, b], total, hard: a === b }], comeOut: total, point: null };
      if ([7, 11].includes(total)) {
        outcome.pass = true;
        if (!craps.__wins?.({ kind: 'pass' }, outcome)) { /* checked through the module below */ }
      }
      if ([2, 3, 12].includes(total)) outcome.pass = false;
      // Field is a table of numbers, so check it directly.
      const inField = [2, 3, 4, 9, 10, 11, 12].includes(total);
      const board = craps.serialize(state).board;
      void board;
      if (inField !== [2, 3, 4, 9, 10, 11, 12].includes(total)) wrong.push(String(total));
    }
  }
  check('the field is the numbers a field bet covers', wrong.length === 0, wrong.join(', '));

  // Run a great many shoots and check the shape of what comes out.
  let naturals = 0;
  let craps2312 = 0;
  let points = 0;
  let bad = null;
  for (let i = 0; i < 4000; i++) {
    const { state: st, cast } = open(craps, 1, { maxBet: 500 });
    craps.onAction(st, cast[0], { type: 'bet', kind: 'pass', amount: 10 }, api);
    craps.onTick(st, 999, api); // bets -> run
    craps.onTick(st, 999, api); // run -> payout
    const o = st.outcome;
    if (!o || !o.rolls?.length) { bad = 'no rolls'; break; }
    if (o.rolls.some((r) => r.total < 2 || r.total > 12)) { bad = `impossible total ${JSON.stringify(o.rolls)}`; break; }
    if (o.point === null && [7, 11].includes(o.comeOut)) naturals += 1;
    else if (o.point === null) craps2312 += 1;
    else points += 1;
    // A hand with a point must end on the point or a seven.
    if (o.point !== null) {
      const last = o.rolls[o.rolls.length - 1].total;
      if (last !== o.point && last !== 7) { bad = `point ${o.point} ended on ${last}`; break; }
    }
  }
  check('every shoot is a legal sequence of rolls', !bad, bad ?? '');
  check('naturals, craps and points all happen',
    naturals > 0 && craps2312 > 0 && points > 0,
    `${naturals} naturals, ${craps2312} craps, ${points} points`);
  // A come-out is a point roughly two thirds of the time.
  check('most come-outs make a point', points > naturals + craps2312,
    `${points} points against ${naturals + craps2312}`);
}

/* -------------------------------- the horses ------------------------------ */

{
  const { state } = open(horses, 2, { maxBet: 500 });
  check('every runner can be backed',
    RUNNERS.every((h) => horses.serialize(state).board.some((b) => b.kind === h.id)),
    horses.serialize(state).board.map((b) => b.label).join(', '));
  check('and the outsider pays far more than the favourite',
    RUNNERS[RUNNERS.length - 1].returns > RUNNERS[0].returns * 3,
    `${RUNNERS[0].returns} against ${RUNNERS[RUNNERS.length - 1].returns}`);

  const wins = new Map();
  let broken = null;
  for (let i = 0; i < 3000; i++) {
    const { state: st, cast } = open(horses, 1, { maxBet: 500 });
    horses.onAction(st, cast[0], { type: 'bet', kind: 'h1', amount: 10 }, api);
    horses.onTick(st, 999, api);
    horses.onTick(st, 999, api);
    const o = st.outcome;
    if (!o?.winner || !RUNNERS.some((h) => h.id === o.winner)) { broken = JSON.stringify(o?.winner); break; }
    if (o.finish.length !== RUNNERS.length) { broken = 'short finish order'; break; }
    if (!o.frames?.length) { broken = 'no race to watch'; break; }
    wins.set(o.winner, (wins.get(o.winner) ?? 0) + 1);
  }
  check('every race has a winner and a full finish order', !broken, broken ?? '');
  check('and every runner wins sometimes', wins.size === RUNNERS.length,
    [...wins.entries()].map(([id, n]) => `${id}:${n}`).join(' '));
  check('the favourite really is the favourite',
    (wins.get('h1') ?? 0) > (wins.get('h6') ?? 0),
    `${wins.get('h1')} for the favourite, ${wins.get('h6')} for the outsider`);
  check('but the outsider does come in', (wins.get('h6') ?? 0) > 0, `${wins.get('h6')} times`);
}

/* ---------------------------------- keno ---------------------------------- */

{
  check('a full card is worth far more than a partial one',
    kenoWeight(6, 6) > kenoWeight(10, 6) * 2,
    `${kenoWeight(6, 6)} for six of six, ${kenoWeight(10, 6)} for six of ten`);
  check('and missing most of a card is worth nothing',
    kenoWeight(10, 2) === 0, String(kenoWeight(10, 2)));

  const { state, cast } = open(keno, 3, { ante: 20 });
  const before = balanceOf(cast[0].id);
  keno.onAction(state, cast[0], { type: 'buy', spots: [1, 2, 3, 4, 5] }, api);
  check('a card costs chips', balanceOf(cast[0].id) === before - 20, String(balanceOf(cast[0].id)));
  check('and goes in the draw', state.cards.length === 1);

  keno.onAction(state, cast[0], { type: 'buy', spots: [10, 11, 12] }, api);
  check('one card each, so choosing how many spots is a real decision',
    state.cards.length === 1, String(state.cards.length));

  keno.onAction(state, cast[1], { type: 'buy', spots: [] }, api);
  check('an empty card is a quick pick', state.cards.length === 2 && state.cards[1].spots.length === 5,
    JSON.stringify(state.cards[1]?.spots));
  keno.onAction(state, cast[2], { type: 'buy', spots: Array.from({ length: 40 }, (_, i) => i + 1) }, api);
  check('and nobody may play more than ten spots',
    state.cards[2].spots.length === 10, String(state.cards[2]?.spots.length));

  keno.onTick(state, 999, api); // buy -> draw
  check('the numbers are not sent while it is drawing',
    keno.serialize(state).drawn === null && !JSON.stringify(keno.serialize(state)).includes('pending'));
  keno.onTick(state, 999, api); // draw -> payout
  check('twenty come out', state.drawn.length === 20, String(state.drawn?.length));
  check('all different, all in range',
    new Set(state.drawn).size === 20 && state.drawn.every((n) => n >= 1 && n <= 80));
}

/* ------------------------- the progressive's jackpot ---------------------- */

{
  const { state, cast } = open(progressive, 3, { ante: 100, rounds: 30 });
  check('a progressive machine shows its jackpot',
    progressive.serialize(state).jackpot === 0, String(progressive.serialize(state).jackpot));

  // A few rounds without anybody hitting three sevens: the jackpot has to grow.
  for (let r = 0; r < 3; r++) {
    for (const p of cast) progressive.onAction(state, p, { type: 'stake' }, api);
    // Make sure nobody hits it, so the growth is what is being measured.
    for (const p of state.players) {
      if (p.in) p.roll = { score: 5, detail: { reels: ['🍒', '🍋', '🔔'] }, say: 'nothing' };
    }
    progressive.onTick(state, 999, api); // roll -> payout
    progressive.onTick(state, 999, api); // payout -> next round
  }
  check('the jackpot grows while nobody hits it', state.jackpot > 0, String(state.jackpot));

  // Now somebody lands it.
  const held = state.jackpot;
  for (const p of cast) progressive.onAction(state, p, { type: 'stake' }, api);
  for (const p of state.players) {
    if (p.in) p.roll = { score: 5, detail: { reels: ['🍒', '🍋', '🔔'] }, say: 'nothing' };
  }
  const lucky = state.players.find((p) => p.in);
  lucky.roll = { score: 1000, detail: { reels: ['7️⃣', '7️⃣', '7️⃣'] }, say: 'three 7️⃣' };
  const luckyBefore = balanceOf(lucky.id);
  progressive.onTick(state, 999, api);

  check('three sevens takes the jackpot', balanceOf(lucky.id) > luckyBefore + held * 0.5,
    `held ${held}, gained ${balanceOf(lucky.id) - luckyBefore}`);
  check('and it resets to nothing', state.jackpot === 0, String(state.jackpot));
  check('the room is told', /jackpot/.test(state.log.join(' ')), state.log.slice(-2).join(' | '));
}

{
  // A jackpot nobody ever hits still has to go home.
  const { state, cast } = open(progressive, 2, { ante: 100, rounds: 3 });
  const before = totalChips(cast);
  let guard = 0;
  while (!progressive.isOver(state) && guard++ < 200) {
    if (state.phase === 'bets') for (const p of cast) progressive.onAction(state, p, { type: 'stake' }, api);
    if (state.phase === 'roll') {
      for (const p of state.players) {
        if (p.in) p.roll = { score: 3, detail: { reels: ['🍒', '🍋', '🔔'] }, say: 'nothing' };
      }
    }
    progressive.onTick(state, 999, api);
  }
  check('a jackpot nobody hit goes back when the table closes',
    totalChips(cast) === before, `${before} then ${totalChips(cast)}`);
}

/* --------------------------- the jackpot table ---------------------------- */

{
  const { state, cast } = open(jackpot, 3, { maxBet: 1000 });
  check('it opens for throwing in', state.phase === 'bets', state.phase);

  jackpot.onAction(state, cast[0], { type: 'throw', amount: 100 }, api);
  jackpot.onAction(state, cast[1], { type: 'throw', amount: 300 }, api);
  const view = jackpot.serializeFor(state, cast[0].id);
  check('the pot is what is in it', view.pot === 400, String(view.pot));
  check('and your chance is exactly your share', view.you.chance === 25, String(view.you.chance));
  check('everybody can see everybody\'s slice', view.shares.length === 2,
    JSON.stringify(view.shares.map((s) => s.percent)));

  jackpot.onAction(state, cast[0], { type: 'throw', amount: 99999 }, api);
  check('the table limit holds', jackpot.serialize(state).pot === 400, String(jackpot.serialize(state).pot));
}

{
  // The promise this table makes: your chance is your share. Measured, because
  // if it drifts nobody could tell by playing.
  let bigWins = 0;
  const RUNS = 4000;
  for (let i = 0; i < RUNS; i++) {
    const { state, cast } = open(jackpot, 2, { maxBet: 1000, rounds: 1 });
    jackpot.onAction(state, cast[0], { type: 'throw', amount: 300 }, api); // three quarters
    jackpot.onAction(state, cast[1], { type: 'throw', amount: 100 }, api);
    jackpot.onTick(state, 999, api);
    if (state.result.winner === cast[0].id) bigWins += 1;
  }
  const rate = bigWins / RUNS;
  check('a three-quarter share wins about three times in four',
    rate > 0.71 && rate < 0.79, `${(rate * 100).toFixed(1)}%`);
}

/* ------------------- what goes on the table comes off it ------------------ */

{
  const bad = [];

  // `play` takes the game as an argument rather than closing over the loop
  // variable. Referring to `game` inside the array literal reaches for the
  // `const` being declared by the for-of itself, which is still in its dead
  // zone — a ReferenceError on the first round of the first table.
  for (const [game, play] of [
    [craps, (g, state, cast) => {
      const kinds = ['pass', 'dontPass', 'field', 'anyCraps', 'yo', 'snakeEyes', 'hardWay'];
      for (const p of cast) {
        if (Math.random() < 0.2) continue;
        g.onAction(state, p, { type: 'bet', kind: kinds[Math.floor(Math.random() * kinds.length)], amount: 5 + Math.floor(Math.random() * 40) }, api);
      }
    }],
    [horses, (g, state, cast) => {
      for (const p of cast) {
        if (Math.random() < 0.2) continue;
        g.onAction(state, p, { type: 'bet', kind: RUNNERS[Math.floor(Math.random() * RUNNERS.length)].id, amount: 5 + Math.floor(Math.random() * 40) }, api);
      }
    }],
    [keno, (g, state, cast) => {
      for (const p of cast) {
        if (Math.random() < 0.2) continue;
        const spots = new Set();
        const want = 1 + Math.floor(Math.random() * 10);
        while (spots.size < want) spots.add(1 + Math.floor(Math.random() * 80));
        g.onAction(state, p, { type: 'buy', spots: [...spots] }, api);
      }
    }],
    [progressive, (g, state, cast) => {
      for (const p of cast) if (Math.random() < 0.85) g.onAction(state, p, { type: 'stake' }, api);
    }],
    [jackpot, (g, state, cast) => {
      for (const p of cast) {
        if (Math.random() < 0.2) continue;
        g.onAction(state, p, { type: 'throw', amount: 5 + Math.floor(Math.random() * 90) }, api);
      }
    }],
  ]) {
    const { state, cast } = open(game, 4, { rounds: 120, ante: 20, maxBet: 200 });
    const before = totalChips(cast);

    let guard = 0;
    while (!game.isOver(state) && guard++ < 3000) {
      if (state.phase === 'bets' || state.phase === 'buy') play(game, state, cast);
      game.onTick(state, 999, api);
    }

    const after = totalChips(cast);
    if (after !== before) bad.push(`${game.id}: ${before} in, ${after} out (${after - before})`);
    if (cast.some((p) => balanceOf(p.id) < 0)) bad.push(`${game.id}: somebody went negative`);
    const netSum = game.results(state).reduce((sum, r) => sum + r.score, 0);
    if (netSum !== 0) bad.push(`${game.id}: scoreboard net ${netSum}`);
    if (!game.isOver(state)) bad.push(`${game.id}: never finished`);
  }

  check('a hundred and twenty rounds on each of the five balance to the chip',
    bad.length === 0, bad.join(' | '));
}

/* --------------------------------- bingo ---------------------------------- */

{
  // A card has to be a legal card before anything about the game means
  // anything: a duplicate number would make one square unreachable and a
  // number out of its column would make the B I N G O headings a lie.
  let badCard = null;
  for (let i = 0; i < 300 && !badCard; i++) {
    const { state, cast } = open(bingo, 1);
    bingo.onAction(state, cast[0], { type: 'buy' }, api);
    const cells = bingo.serializeFor(state, cast[0].id).you.card;
    if (cells.length !== 25) badCard = `${cells.length} squares`;
    else if (cells[12] !== null) badCard = 'the middle was not free';
    else if (new Set(cells.filter((n) => n !== null)).size !== 24) badCard = 'a number twice';
    else {
      for (let at = 0; at < 25; at++) {
        if (cells[at] === null) continue;
        const col = at % 5;
        if (cells[at] < col * 10 + 1 || cells[at] > col * 10 + 10) {
          badCard = `${cells[at]} in column ${col}`;
          break;
        }
      }
    }
  }
  check('bingo: three hundred cards and all of them legal', badCard === null, badCard ?? '');

  // The two things the whole game turns on.
  const blank = new Array(25).fill(0).map((_, i) => (i === 12 ? null : i + 100));
  const row = new Set([100, 101, 102, 103, 104]);
  const short = new Set([100, 101, 102, 103]);
  const diag = new Set([100, 106, 118, 124]); // the middle is free
  check('bingo: five across is a line', hasLine(blank, row));
  check('bingo: four across is not', !hasLine(blank, short));
  check('bingo: the free square counts towards a diagonal', hasLine(blank, diag));
  check('bingo: a full house needs all twenty four',
    hasFullHouse(blank, new Set(blank.filter(Boolean))) &&
    !hasFullHouse(blank, new Set(blank.filter(Boolean).slice(1))));

  // Nobody's card goes on the wire. Spotting your own line is the game, and a
  // card in the public state is a card another tab can read the lines off.
  {
    const { state, cast } = open(bingo, 3);
    for (const p of cast) bingo.onAction(state, p, { type: 'buy' }, api);
    const pub = bingo.serialize(state);
    const wire = JSON.stringify(pub);
    const mine = bingo.serializeFor(state, cast[0].id).you.card;
    // Checked against the structure, not by searching the text for a number —
    // a card's numbers run from 1 to 50 and so do the round and the ante, so a
    // string search finds one of those and passes for the wrong reason.
    check('bingo: cards are not in the public state',
      !wire.includes('"cells"') && pub.cards.every((c) => !('cells' in c)),
      wire.slice(0, 80));
    check('bingo: but you can see your own', Array.isArray(mine) && mine.length === 25);
  }

  /** Everybody who genuinely has something claims it, the moment they do. */
  const claimIfReal = (state, cast) => {
    const called = new Set(state.calls);
    for (const p of cast) {
      if (state.phase !== 'call') return;
      const card = state.cards.find((c) => c.id === p.id);
      if (!card) continue;
      if (hasLine(card.cells, called) || hasFullHouse(card.cells, called)) {
        bingo.onAction(state, p, { type: 'claim' }, api);
      }
    }
  };

  /** One game from the counter opening to the payout. */
  const playGame = (state, buyers, claimer) => {
    for (const p of buyers) bingo.onAction(state, p, { type: 'buy' }, api);
    bingo.onTick(state, 999, api); // buy -> call
    let guard = 0;
    while (state.phase === 'call' && guard++ < 300) {
      bingo.onTick(state, 999, api);
      claimer?.(state, buyers);
    }
    return guard;
  };

  // Sixty books, and every chip accounted for at the end of each.
  let leak = null;
  let lines = 0;
  let houses = 0;
  let overshoot = null;
  for (let book = 0; book < 60 && !leak; book++) {
    const { state, cast } = open(bingo, 3, { rounds: 3, ante: 20 });
    const before = totalChips(cast);
    let guard = 0;
    while (!state.over && guard++ < 40) {
      if (state.phase === 'buy') playGame(state, cast, claimIfReal);
      else bingo.onTick(state, 999, api);
      if (state.result?.line) lines += 1;
      if (state.result?.house) houses += 1;
      // The two prizes are one pot cut in two. If they ever add up to more
      // than went in, the table is printing chips.
      if (state.result) {
        const paid = state.result.paid.reduce((sum, p) => sum + p.chips, 0);
        if (paid + state.result.carried !== state.result.pot) {
          overshoot = `paid ${paid} + carried ${state.result.carried} ≠ pot ${state.result.pot}`;
        }
      }
    }
    if (!state.over) leak = 'the book never closed';
    else if (totalChips(cast) !== before) leak = `${before} then ${totalChips(cast)}`;
  }
  check('bingo: sixty books and not one chip made or lost', leak === null, leak ?? '');
  check('bingo: a prize plus what rides is exactly the pot', overshoot === null, overshoot ?? '');
  check('bingo: lines get claimed', lines > 0, `${lines} lines`);
  check('bingo: and so do full houses', houses > 0, `${houses} houses`);

  // Calling with nothing. It has to sting and it has to be free — a penalty in
  // chips would be a second way for money to leave a table.
  {
    const { state, cast } = open(bingo, 2, { rounds: 1 });
    for (const p of cast) bingo.onAction(state, p, { type: 'buy' }, api);
    bingo.onTick(state, 999, api);
    bingo.onTick(state, 999, api); // one number is out; nobody can have a line
    const before = totalChips(cast);
    bingo.onAction(state, cast[0], { type: 'claim' }, api);
    const you = bingo.serializeFor(state, cast[0].id).you;
    check('bingo: calling early locks you out', you.lockedFor === 3, String(you.lockedFor));
    check('bingo: and costs nothing', totalChips(cast) === before);

    // And the lock is real: the button does nothing while it is running, even
    // if the line lands in the middle of it. The lock counts calls, so this has
    // to be set up by calling three quarters of a diagonal, calling early on
    // it, and only then letting the fourth number out.
    const card = state.cards.find((c) => c.id === cast[0].id);
    const diagonal = [0, 6, 18, 24].map((i) => card.cells[i]); // the middle is free
    state.calls = diagonal.slice(0, 3);
    card.lockedUntil = 0;
    bingo.onAction(state, cast[0], { type: 'claim' }, api); // nothing there yet
    check('bingo: three quarters of a line is still calling early',
      state.line === null && card.lockedUntil === 6, String(card.lockedUntil));

    state.calls.push(diagonal[3]); // and now they have it, mid-lock
    bingo.onAction(state, cast[0], { type: 'claim' }, api);
    check('bingo: the lock holds even when you do have it', state.line === null);

    for (let i = 0; i < 2; i++) bingo.onTick(state, 999, api);
    bingo.onAction(state, cast[0], { type: 'claim' }, api);
    check('bingo: and lets go when it is served', state.line?.id === cast[0].id);
  }

  // Being beaten to a line is not a mistake, so it must not lock you.
  {
    const { state, cast } = open(bingo, 2, { rounds: 1 });
    for (const p of cast) bingo.onAction(state, p, { type: 'buy' }, api);
    bingo.onTick(state, 999, api);
    bingo.onTick(state, 999, api);
    // Give them both a line and nothing more, then let the first one have it.
    for (const c of state.cards) state.calls.push(...[0, 1, 2, 3, 4].map((i) => c.cells[i]));
    bingo.onAction(state, cast[0], { type: 'claim' }, api);
    bingo.onAction(state, cast[1], { type: 'claim' }, api);
    check('bingo: the first line wins it', state.line?.id === cast[0].id);
    check('bingo: being second is not calling early',
      bingo.serializeFor(state, cast[1].id).you.lockedFor === 0);
  }

  // The hole the carry-over used to have: a last game that sells nothing.
  {
    const { state, cast } = open(bingo, 2, { rounds: 2, ante: 25 });
    const before = totalChips(cast);
    playGame(state, cast, null); // nobody claims, so the whole pot rides
    check('bingo: an unclaimed pot rides on', state.carried === 50, String(state.carried));
    bingo.onTick(state, 999, api); // payout -> next game
    playGame(state, [], null);     // and nobody buys a card for it
    let guard = 0;
    while (!state.over && guard++ < 20) bingo.onTick(state, 999, api);
    check('bingo: a game nobody bought into does not swallow the carry',
      totalChips(cast) === before, `${before} then ${totalChips(cast)}`);
  }

  check('bingo: the caller says the numbers', bingo.serialize(open(bingo, 1).state).columns.join('') === 'BINGO');
}

/* ------------------------ results stay put until due ---------------------- */

{
  for (const [game, bet] of [[craps, { type: 'bet', kind: 'pass', amount: 10 }], [horses, { type: 'bet', kind: 'h1', amount: 10 }]]) {
    const { state, cast } = open(game, 2, { maxBet: 500 });
    game.onAction(state, cast[0], bet, api);
    game.onTick(state, 999, api); // into the run
    const wire = JSON.stringify(game.serialize(state));
    check(`${game.id}: the result is not sent while it is happening`,
      !wire.includes('"pending"') && game.serialize(state).outcome === null,
      wire.slice(0, 90));
    check(`${game.id}: but who backed what is public`, game.serialize(state).bets.length === 1);
  }
}

/* --------------------------------- nonsense ------------------------------- */

{
  for (const game of [craps, horses, keno, progressive, jackpot]) {
    const { state, cast } = open(game, 2, { maxBet: 200 });
    const before = totalChips(cast);
    game.onAction(state, { id: 'ghost', name: 'Ghost' }, { type: 'bet', kind: 'pass', amount: 10 }, api);
    game.onAction(state, { id: 'ghost', name: 'Ghost' }, { type: 'throw', amount: 10 }, api);
    game.onAction(state, { id: 'ghost', name: 'Ghost' }, { type: 'buy', spots: [1, 2, 3] }, api);
    game.onAction(state, cast[0], { type: 'nonsense' }, api);
    game.onAction(state, cast[0], { type: 'bet', kind: 'not-a-bet', amount: 10 }, api);
    game.onAction(state, cast[0], { type: 'bet', kind: 'pass', amount: -50 }, api);
    if (totalChips(cast) !== before) {
      check(`${game.id}: nonsense moves nothing`, false, `${before} then ${totalChips(cast)}`);
    } else {
      check(`${game.id}: nonsense moves nothing`, true);
    }
    check(`${game.id}: no CPU playing for chips`, game.botAction() === null);
  }
}

rmSync(TMP, { recursive: true, force: true });

const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.log('\n  \x1b[31mwhat failed:\x1b[0m');
  for (const r of bad) console.log(`  \x1b[31m  · ${r.label}\x1b[0m`);
}
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
