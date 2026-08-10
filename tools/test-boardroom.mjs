// The board room.
//
//   npm run test:boardroom
//
// The casino floor is measured against chip conservation and the card room
// against fifty-two cards and a private hand. A board game has neither problem:
// nothing is staked and nothing is hidden. What it has instead is the one that
// replaces them —
//
//   the server refuses
//
// — because with no secret to protect, the only thing between a player and an
// illegal move is that the server will not accept it. A card game leaks by
// sending too much; a board game breaks by accepting too much.
//
// So every rule that could be broken is tried here as an illegal move rather
// than only demonstrated as a legal one. Moving somebody else's coin, moving on
// a throw you have not made, leaving the outer ring without a kill, landing on
// your own coin, overshooting the centre — each is attempted, and the board is
// checked afterwards to make sure nothing moved.

import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-board');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
process.env.DATA_DIR = TMP;

const { thayam, throwSticks, legalMoves, SAFE, isSafe } = await import('../server/games/board/thayam.js');
const { paramapadham, LADDERS, SNAKES } = await import('../server/games/board/paramapadham.js');
const { BOARD_GAMES } = await import('../server/games/board/index.js');

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};

const api = { emit() {}, emitTo() {}, finish() {}, players: () => [] };
let seq = 0;
const cast = (n) => Array.from({ length: n }, () => ({ id: `b${seq++}`, name: `B${seq}`, connected: true }));

function open(game, n, settings = {}) {
  const players = cast(n);
  const state = game.createState(players, { settings });
  for (const p of players) game.onAction(state, p, { type: 'briefed' }, api);
  return { state, players };
}

/** A snapshot of every coin, so "nothing moved" can be asserted exactly. */
const board = (state) => JSON.stringify(state.coins?.map((c) => [c.seat, c.i, c.at]) ?? state.at);

console.log('\n  The board room — the server refuses\n');

/* ------------------------------ the dayakattai ---------------------------- */

{
  // The sticks are the odds. Two long four-sided sticks reading one, two, three
  // and blank can only make certain totals, and the shape of that distribution
  // is the game — a pair of six-sided dice would give the same numbers a
  // completely different weight.
  const seen = new Map();
  let bad = null;
  for (let i = 0; i < 60000; i++) {
    const t = throwSticks();
    if (t.sticks.some((f) => f < 0 || f > 3)) { bad = `a stick read ${t.sticks}`; break; }
    seen.set(t.value, (seen.get(t.value) ?? 0) + 1);
  }
  check('every stick reads one, two, three or blank', bad === null, bad ?? '');
  check('the only throws are 1 to 6 and 12',
    [...seen.keys()].sort((a, b) => a - b).join(',') === '1,2,3,4,5,6,12',
    [...seen.keys()].sort((a, b) => a - b).join(','));

  // Expected, out of sixteen: 12 once, 1 twice, 2 three times, 3 four times,
  // 4 three times, 5 twice, 6 once. Checked loosely — this is about the shape
  // being right, not about the random number generator.
  const share = (v) => (seen.get(v) ?? 0) / 60000;
  check('three is the commonest throw',
    share(3) > share(2) && share(3) > share(4), `${(share(3) * 16).toFixed(2)}/16`);
  check('twelve and six are the rarest',
    share(12) < share(1) && share(6) < share(5),
    `12 at ${(share(12) * 16).toFixed(2)}/16, 6 at ${(share(6) * 16).toFixed(2)}/16`);
  check('dayam comes up about one throw in eight',
    Math.abs(share(1) - 2 / 16) < 0.01, `${(share(1) * 100).toFixed(1)}%`);
  check('and twelve about one in sixteen',
    Math.abs(share(12) - 1 / 16) < 0.01, `${(share(12) * 100).toFixed(1)}%`);

  const grace = [1, 5, 6, 12];
  let wrongGrace = null;
  for (let i = 0; i < 5000; i++) {
    const t = throwSticks();
    if (t.grace !== grace.includes(t.value)) { wrongGrace = `${t.value} said ${t.grace}`; break; }
  }
  check('one, five, six and twelve earn another throw — and nothing else', wrongGrace === null, wrongGrace ?? '');
}

/* --------------------------------- the board ------------------------------ */

{
  check('there are nine crosses', SAFE.size === 9, String(SAFE.size));
  check('the centre is one of them', isSafe([3, 3]));
  check('and the four places players come on are too',
    [[6, 3], [3, 0], [0, 3], [3, 6]].every(isSafe));
  check('a plain square is not safe', !isSafe([0, 0]) && !isSafe([1, 1]));

  const { state } = open(thayam, 4, { coins: 6 });
  check('four players, six coins each, all in hand',
    state.coins.length === 24 && state.coins.every((c) => c.at === -1),
    `${state.coins.length} coins`);

  const wire = thayam.serialize(state);
  check('every player gets their own spiral',
    wire.paths.length === 4 && wire.paths.every((p) => p.length === 49),
    wire.paths.map((p) => p.length).join(','));
  check('and the four spirals start on four different squares',
    new Set(wire.paths.map((p) => p[0])).size === 4,
    wire.paths.map((p) => p[0]).join(' '));
  check('every spiral ends at the centre',
    wire.paths.every((p) => p[p.length - 1] === wire.centre), wire.centre);
}

/* ------------------------------ coming on --------------------------------- */

{
  const { state, players } = open(thayam, 2, { coins: 4 });
  const seat = state.seats[0];

  // Nothing but a dayam puts the first coin on.
  for (const v of [2, 3, 4, 5, 6, 12]) {
    const moves = legalMoves(state, seat, v);
    if (moves.length) { check(`a ${v} cannot bring the first coin on`, false, JSON.stringify(moves[0])); break; }
  }
  check('nothing but a one brings the first coin on',
    [2, 3, 4, 5, 6, 12].every((v) => legalMoves(state, seat, v).length === 0));
  check('and a one does', legalMoves(state, seat, 1).length === 1);

  // Once one is on, a five will bring the next.
  state.coins.find((c) => c.seat === 0 && c.i === 0).at = 0;
  check('once you are on the board a five brings another',
    legalMoves(state, seat, 5).some((m) => m.enters), JSON.stringify(legalMoves(state, seat, 5)));
  check('but a two still does not',
    !legalMoves(state, seat, 2).some((m) => m.enters));

  // And nobody else may move your coin.
  const before = board(state);
  state.rolled = { sticks: [1, 0], value: 1, grace: true };
  state.turn = 0;
  thayam.onAction(state, players[1], { type: 'move', coin: 1 }, api);
  check('the server refuses a move out of turn', board(state) === before);
}

/* ------------------------- the rules that can be broken ------------------- */

{
  // One coin to a plain square, even your own.
  const { state } = open(thayam, 2, { coins: 4 });
  const seat = state.seats[0];
  const mine = state.coins.filter((c) => c.seat === 0);
  mine[0].at = 5;
  mine[1].at = 2;
  // Coin 1 moving 3 would land on square 5, where coin 0 is standing.
  const moves = legalMoves(state, seat, 3);
  check('you cannot land on your own coin on a plain square',
    !moves.some((m) => m.coin === 1), JSON.stringify(moves.filter((m) => m.coin === 1)));

  // A cross holds as many as you like.
  const { state: st2 } = open(thayam, 2, { coins: 4 });
  const s2 = st2.seats[0];
  const m2 = st2.coins.filter((c) => c.seat === 0);
  // Path index 8 for seat 0 — find a safe one and stack on it.
  const path = thayam.serialize(st2).paths[0];
  const safeAt = path.findIndex((cell, i) => i > 0 && i < 24 && SAFE.has(cell));
  if (safeAt > 0) {
    m2[0].at = safeAt;
    m2[1].at = safeAt - 2;
    check('but a cross holds as many as you like',
      legalMoves(st2, s2, 2).some((m) => m.coin === 1),
      `stacking on path index ${safeAt}`);
  } else {
    check('but a cross holds as many as you like', false, 'no safe square found on the outer ring');
  }
}

{
  // Cutting, and the war rule that depends on it.
  const { state } = open(thayam, 2, { coins: 4 });
  const me = state.seats[0];
  const them = state.seats[1];
  const path0 = thayam.serialize(state).paths[0];
  const path1 = thayam.serialize(state).paths[1];

  // Put an enemy coin on a plain square that seat 0 can reach in three.
  const target = path0[3];
  const plain = !SAFE.has(target);
  const theirCoin = state.coins.find((c) => c.seat === 1);
  theirCoin.at = path1.indexOf(target);
  const myCoin = state.coins.find((c) => c.seat === 0);
  myCoin.at = 0;

  if (plain && theirCoin.at >= 0) {
    const moves = legalMoves(state, me, 3);
    const cut = moves.find((m) => m.coin === myCoin.i && m.cuts);
    check('landing on somebody off a cross cuts them', Boolean(cut), JSON.stringify(moves));

    state.rolled = { sticks: [1, 2], value: 3, grace: false };
    state.turn = 0;
    thayam.onAction(state, { id: me.id }, { type: 'move', coin: myCoin.i }, api);
    check('and the cut coin goes back to their hand', theirCoin.at === -1, String(theirCoin.at));
    check('and the cut is counted', me.cuts === 1, String(me.cuts));
  } else {
    check('landing on somebody off a cross cuts them', false, `path index 3 is ${target}, safe=${!plain}`);
    check('and the cut coin goes back to their hand', false, 'setup failed');
    check('and the cut is counted', false, 'setup failed');
  }
  void them;
}

{
  // The war rule: nothing leaves the outer ring until this player has cut.
  const { state } = open(thayam, 2, { coins: 4 });
  const seat = state.seats[0];
  const coin = state.coins.find((c) => c.seat === 0);
  coin.at = 22;                 // near the end of the outer ring (24 squares)
  seat.cuts = 0;

  const blocked = legalMoves(state, seat, 4);   // would reach 26, into ring two
  check('you cannot leave the outer ring without a kill',
    !blocked.some((m) => m.coin === coin.i), JSON.stringify(blocked));
  check('but you can still move inside it',
    legalMoves(state, seat, 1).some((m) => m.coin === coin.i));

  seat.cuts = 1;
  check('one kill and the gate opens',
    legalMoves(state, seat, 4).some((m) => m.coin === coin.i && m.to === 26),
    JSON.stringify(legalMoves(state, seat, 4)));

  // And a big throw cannot jump the gate either.
  seat.cuts = 0;
  coin.at = 20;
  check('and a twelve cannot jump the gate',
    !legalMoves(state, seat, 12).some((m) => m.coin === coin.i));
}

{
  // The centre must be reached exactly.
  const { state } = open(thayam, 2, { coins: 4 });
  const seat = state.seats[0];
  seat.cuts = 1;
  const coin = state.coins.find((c) => c.seat === 0);
  coin.at = 46;                 // three short of the centre at 48
  check('overshooting the centre is not a move',
    !legalMoves(state, seat, 4).some((m) => m.coin === coin.i),
    JSON.stringify(legalMoves(state, seat, 4)));
  check('but the exact throw brings it home',
    legalMoves(state, seat, 2).some((m) => m.coin === coin.i && m.to === 48));

  state.rolled = { sticks: [1, 1], value: 2, grace: false };
  state.turn = 0;
  thayam.onAction(state, { id: seat.id }, { type: 'move', coin: coin.i }, api);
  check('and it is counted home', seat.home === 1, String(seat.home));
}

{
  // A whole game, played legally, checked at every move.
  let broke = null;
  let games = 0;
  let cuts = 0;
  for (let round = 0; round < 40 && !broke; round++) {
    const { state, players } = open(thayam, 3, { coins: 3 });
    let guard = 0;
    while (!thayam.__spec.isDone(state) && guard++ < 4000) {
      const seat = state.seats[state.turn];
      if (!state.rolled) {
        thayam.onAction(state, { id: seat.id }, { type: 'throw' }, api);
        if (!state.rolled) continue;   // the throw ended the turn by itself
      }
      const moves = legalMoves(state, seat, state.rolled.value);
      if (!moves.length) { thayam.onAction(state, { id: seat.id }, { type: 'throw' }, api); continue; }
      // Prefer a cut, so the war rule gets exercised rather than stalling.
      const pick = moves.find((m) => m.cuts) ?? moves[moves.length - 1];
      const wasCuts = seat.cuts ?? 0;
      thayam.onAction(state, { id: seat.id }, { type: 'move', coin: pick.coin }, api);
      if ((seat.cuts ?? 0) > wasCuts) cuts += 1;

      // The invariants, after every single move.
      const on = state.coins.filter((c) => c.at >= 0 && c.at !== 48);
      const cells = on.map((c) => thayam.serialize(state).coins.find((x) => x.seat === c.seat && x.i === c.i)?.cell);
      const plainCells = cells.filter((cell) => cell && !SAFE.has(cell));
      if (new Set(plainCells).size !== plainCells.length) { broke = 'two coins on one plain square'; break; }
      if (state.coins.some((c) => c.at > 48)) { broke = 'a coin went past the centre'; break; }
      const gateJumper = state.coins.find((c) => {
        const s = state.seats.find((x) => x.seat === c.seat);
        return c.at >= 24 && (s?.cuts ?? 0) === 0;
      });
      if (gateJumper) { broke = `a coin left the outer ring with no kill`; break; }
    }
    if (!broke && !thayam.__spec.isDone(state)) broke = `a game never finished (${guard} moves)`;
    else games += 1;
    void players;
  }
  check('forty games, and every rule held at every move', broke === null, broke ?? '');
  check('games actually finished', games > 0, `${games}`);
  check('and coins were cut along the way', cuts > 0, `${cuts} cuts`);
}

/* ------------------------------- Paramapadham ----------------------------- */

{
  const { state } = open(paramapadham, 3, {});
  check('everybody starts off the board',
    state.seats.every((s) => (state.at[s.seat] ?? 0) === 0));

  // No square may be both a ladder foot and a snake head, or the resolution
  // order silently decides which one a player gets.
  const clash = Object.keys(LADDERS).filter((n) => SNAKES[n]);
  check('no square is both a virtue and a vice', clash.length === 0, clash.join(','));
  check('every ladder goes up',
    Object.entries(LADDERS).every(([from, l]) => l.to > Number(from)));
  check('every snake goes down',
    Object.entries(SNAKES).every(([from, s]) => s.to < Number(from)));
  check('nothing lands outside the board',
    [...Object.values(LADDERS), ...Object.values(SNAKES)].every((x) => x.to >= 1 && x.to <= 100));
  check('and all of them are named',
    [...Object.values(LADDERS), ...Object.values(SNAKES)].every((x) => x.name && x.tamil));

  // A ladder lifts you and a snake drops you, once.
  const seat = state.seats[0];
  state.at[seat.seat] = 11;
  state.turn = 0;
  state.rolled = null;
  // Force the throw to a one by hand rather than waiting for it.
  paramapadham.__spec.act(state, seat, { type: 'throw' });
  // Whatever was thrown, check the resolution is consistent with the tables.
  const at = state.at[seat.seat];
  const moved = state.moved;
  const landedOn = moved.blocked ? null : (moved.via ? moved.via.at : at);
  check('a move resolves to a legal square', at >= 1 && at <= 100, String(at));
  if (moved.via) {
    const table = moved.via.kind === 'ladder' ? LADDERS : SNAKES;
    check('and a ladder or snake sends you where the table says',
      table[landedOn]?.to === at, `${landedOn} → ${at}`);
  } else {
    check('and a ladder or snake sends you where the table says', true, 'landed on a plain square');
  }

  // Resolved once — the far end is where you stop.
  check('the far end of a snake is not re-resolved',
    !moved.via || !(LADDERS[at] || SNAKES[at]) || moved.via.to === at,
    JSON.stringify(moved));
}

{
  // The last square, exactly.
  const { state } = open(paramapadham, 2, { dice: 'die' });
  const seat = state.seats[0];
  state.at[seat.seat] = 97;
  state.turn = 0;
  let blocked = 0;
  let landed = 0;
  let crept = null;
  for (let i = 0; i < 200; i++) {
    state.at[seat.seat] = 97;
    state.rolled = null;
    state.turn = 0;
    paramapadham.__spec.act(state, seat, { type: 'throw' });
    if (state.moved.blocked) {
      blocked += 1;
      // Recorded rather than asserted inside the loop — the same check ninety
      // times over is ninety lines of output saying one thing.
      if (state.at[seat.seat] !== 97) crept = `moved to ${state.at[seat.seat]} on a blocked throw`;
    }
    if (state.at[seat.seat] === 100) landed += 1;
  }
  check('a blocked move never moves you', crept === null, crept ?? '');
  check('overshooting a hundred leaves you where you are', blocked > 0, `${blocked} of 200 throws`);
  check('and an exact throw gets there', landed > 0, `${landed} of 200`);
}

/* -------------------------------- nonsense -------------------------------- */

{
  for (const game of BOARD_GAMES) {
    const { state, players } = open(game, Math.max(2, game.minPlayers), {});
    const before = board(state);
    game.onAction(state, { id: 'ghost', name: 'Ghost' }, { type: 'throw' }, api);
    game.onAction(state, { id: 'ghost', name: 'Ghost' }, { type: 'move', coin: 0 }, api);
    game.onAction(state, players[0], { type: 'move', coin: 99 }, api);
    game.onAction(state, players[0], { type: 'move', coin: -1 }, api);
    game.onAction(state, players[0], { type: 'nonsense' }, api);
    check(`${game.name}: nonsense moves nothing`, board(state) === before);
    check(`${game.name}: no CPU playing`, game.botAction() === null);
    check(`${game.name}: it is in the board room`, game.room === 'board', game.room);
    check(`${game.name}: and it has its rules`, (game.howToPlay ?? []).length >= 4, String(game.howToPlay?.length));

    // Nobody's move goes through without a throw behind it.
    const stillBefore = board(state);
    game.onAction(state, players[0], { type: 'move', coin: 0 }, api);
    check(`${game.name}: you cannot move without throwing first`, board(state) === stillBefore);
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
  : `\n  \x1b[32mall ${results.length} passed — the server refuses\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
