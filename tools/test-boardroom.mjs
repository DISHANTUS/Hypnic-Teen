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
const { ludo, legalMoves: ludoMoves, SAFE_SQUARES, ringSquare } = await import('../server/games/board/ludo.js');
const chessRules = await import('../server/games/board/chessrules.js');
const { chess } = await import('../server/games/board/chess.js');
const shogiRules = await import('../server/games/board/shogirules.js');
const { shogi } = await import('../server/games/board/shogi.js');
const { mahjong, isWinningHand, freshWall } = await import('../server/games/board/mahjong.js');
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
  // Corners of the board and the square inside the middle. Not (1,1) — that is
  // a cross on the real board, and the first version of this check used it as
  // an example of a plain square.
  check('a plain square is not safe', !isSafe([0, 0]) && !isSafe([2, 2]) && !isSafe([4, 4]));

  // The four crosses one ring in are the corners of that ring, not the middles
  // of its sides. Off a photograph of the board, and the thing that was wrong.
  check('the inner four crosses are corners',
    [[1, 1], [1, 5], [5, 1], [5, 5]].every(isSafe) &&
    ![[1, 3], [3, 1], [3, 5], [5, 3]].some(isSafe),
    [...SAFE].sort().join(' '));

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

  // The board says this in colour: each player's entry and the inner corner
  // they turn in at are painted the same. All four pairs agreeing is what
  // settled the direction of travel, so it is worth holding on to.
  const TURNS = { '6,3': '5,5', '3,0': '5,1', '0,3': '1,1', '3,6': '1,5' };
  const wrong = wire.paths
    .map((p) => ({ from: p[0], into: p[24], want: TURNS[p[0]] }))
    .filter((x) => x.into !== x.want);
  check('each player turns in at their own coloured corner',
    wrong.length === 0, JSON.stringify(wrong));
  check('and that corner is always a cross',
    wire.paths.every((p) => SAFE.has(p[24])), wire.paths.map((p) => p[24]).join(' '));
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



/* ---------------------------- pairing, in the inner ----------------------- */

{
  // Two of your own coins standing together inside may be joined. They then
  // move as one thing at half speed — which is why a pair has to be safe, or
  // pairing would be all cost and nobody would ever do it.
  const { state } = open(thayam, 2, { coins: 4 });
  const seat = state.seats[0];
  seat.cuts = 1;
  const [a, b, c] = state.coins.filter((x) => x.seat === 0);

  // Outside, nothing can be paired.
  a.at = 5;
  b.at = 5;
  check('thayam: coins on the outer ring cannot be paired',
    (thayam.serializeFor(state, seat.id).you.canPair ?? []).length === 0);

  // Inside and together, they can.
  a.at = 30;
  b.at = 30;
  const offered = thayam.serializeFor(state, seat.id).you.canPair;
  check('thayam: two of yours together inside can be paired',
    offered.some((p) => p.includes(a.i) && p.includes(b.i)), JSON.stringify(offered));

  // Apart, they cannot.
  b.at = 32;
  check('thayam: but not if they are on different squares',
    (thayam.serializeFor(state, seat.id).you.canPair ?? []).length === 0);

  // Join them.
  b.at = 30;
  thayam.onAction(state, { id: seat.id }, { type: 'pair', coins: [a.i, b.i] }, api);
  check('thayam: pairing joins both coins', a.pair === b.i && b.pair === a.i, a.pair + '/' + b.pair);

  // Only even throws move a pair, and they move half.
  const odd = legalMoves(state, seat, 3).filter((m) => m.coin === a.i || m.coin === b.i);
  check('thayam: an odd throw cannot move a pair', odd.length === 0, JSON.stringify(odd));
  const even = legalMoves(state, seat, 4).filter((m) => m.coin === a.i || m.coin === b.i);
  check('thayam: an even throw moves it half as far',
    even.length === 1 && even[0].to === 32, JSON.stringify(even));
  check('thayam: and it is offered once, not twice', even.length === 1, String(even.length));

  // Moving it takes both.
  state.rolled = { sticks: [2, 2], value: 4, grace: false };
  state.turn = 0;
  thayam.onAction(state, { id: seat.id }, { type: 'move', coin: even[0].coin }, api);
  check('thayam: both coins of a pair move together', a.at === 32 && b.at === 32, a.at + '/' + b.at);

  // And they can be separated again — on your own turn. The move above was not
  // a grace throw, so it handed the turn on, and the first version of this
  // check was refused for the right reason and read as a broken rule.
  state.turn = 0;
  thayam.onAction(state, { id: seat.id }, { type: 'unpair', coin: a.i }, api);
  check('thayam: a pair can be separated', a.pair === null && b.pair === null);
  void c;
}

{
  // A single may not cut a pair. This is the reason to pair at all.
  const { state } = open(thayam, 2, { coins: 4 });
  const me = state.seats[0];
  const them = state.seats[1];
  me.cuts = 1;
  them.cuts = 1;

  const mine = state.coins.find((x) => x.seat === 0);
  const [t1, t2] = state.coins.filter((x) => x.seat === 1);

  // Put a paired enemy on a plain square three ahead of my coin.
  const path0 = thayam.serialize(state).paths[0];
  const path1 = thayam.serialize(state).paths[1];
  mine.at = 28;
  const cell = path0[31];
  const theirRel = path1.indexOf(cell);
  if (theirRel >= 0 && !SAFE.has(cell)) {
    t1.at = theirRel;
    t2.at = theirRel;
    t1.pair = t2.i;
    t2.pair = t1.i;
    const blocked = [];
    const moves = legalMoves(state, me, 3, blocked);
    check('thayam: a single coin cannot cut a pair',
      !moves.some((m) => m.coin === mine.i), JSON.stringify(moves.filter((m) => m.coin === mine.i)));
    check('thayam: and it says why', blocked.some((x) => x.why === 'pair'), JSON.stringify(blocked));
  } else {
    check('thayam: a single coin cannot cut a pair', false, 'the fixture landed on a cross');
    check('thayam: and it says why', false, 'setup failed');
  }
}

{
  // The gate, said out loud. A coin stuck behind it is not the same as no coin.
  const { state } = open(thayam, 2, { coins: 4 });
  const seat = state.seats[0];
  seat.cuts = 0;
  const coin = state.coins.find((x) => x.seat === 0);
  coin.at = 22;
  const you = thayam.serializeFor(state, seat.id);
  void you;
  const blocked = [];
  legalMoves(state, seat, 4, blocked);
  check('thayam: a coin held at the gate is reported, not silently dropped',
    blocked.some((x) => x.coin === coin.i && x.why === 'gate'), JSON.stringify(blocked));

  // And the player is told through their own view.
  state.rolled = { sticks: [2, 2], value: 4, grace: false };
  const view = thayam.serializeFor(state, seat.id);
  check('thayam: and the reason reaches the player',
    (view.you.blocked ?? []).some((x) => x.why === 'gate'), JSON.stringify(view.you.blocked));
}

/* ----------------------------------- Ludo --------------------------------- */

{
  const { state } = open(ludo, 4, { tokens: 4 });
  check('ludo: sixteen tokens, all in the yard',
    state.tokens.length === 16 && state.tokens.every((t) => t.at === -1), String(state.tokens.length));
  check('ludo: eight stars', SAFE_SQUARES.size === 8, String(SAFE_SQUARES.size));
  check('ludo: the four starts are a quarter turn apart',
    [0, 13, 26, 39].every((sq) => SAFE_SQUARES.has(sq)));

  const seat = state.seats[0];
  check('ludo: nothing but a six brings a token out',
    [1, 2, 3, 4, 5].every((v) => ludoMoves(state, seat, v).length === 0));
  check('ludo: and a six does', ludoMoves(state, seat, 6).some((m) => m.enters));

  // Each colour walks the same ring from its own corner, so the same relative
  // step is a different square for each of them.
  check('ludo: four colours, four different routes',
    new Set([0, 1, 2, 3].map((s2) => ringSquare(s2, 7))).size === 4,
    [0, 1, 2, 3].map((s2) => ringSquare(s2, 7)).join(','));
}

{
  // Sending somebody home, and the star that prevents it.
  const { state: st } = open(ludo, 2, { tokens: 4 });
  const me = st.seats[0];
  const mine = st.tokens.find((t) => t.seat === 0);
  const theirs = st.tokens.find((t) => t.seat === 1);
  mine.at = 0;
  const target = ringSquare(0, 3);
  theirs.at = (target - 13 + 52) % 52;
  if (!SAFE_SQUARES.has(target)) {
    const m = ludoMoves(st, me, 3).find((x) => x.token === mine.i && x.sends);
    check('ludo: landing on somebody sends them home', Boolean(m), JSON.stringify(ludoMoves(st, me, 3)));
    st.rolled = { sticks: null, value: 3, grace: false };
    st.turn = 0;
    ludo.onAction(st, { id: me.id }, { type: 'move', token: mine.i }, api);
    check('ludo: and they go back to the yard', theirs.at === -1, String(theirs.at));
  } else {
    check('ludo: landing on somebody sends them home', false, 'the fixture landed on a star');
    check('ludo: and they go back to the yard', false, 'setup failed');
  }
}

{
  // On a star, nobody is sent anywhere.
  const { state: st } = open(ludo, 2, { tokens: 4 });
  const me = st.seats[0];
  const mine = st.tokens.find((t) => t.seat === 0);
  const theirs = st.tokens.find((t) => t.seat === 1);
  mine.at = 6;
  theirs.at = (8 - 13 + 52) % 52;
  const m = ludoMoves(st, me, 2).find((x) => x.token === mine.i);
  check('ludo: but not on a star', Boolean(m) && !m.sends, JSON.stringify(m));
}

{
  // Home is exact.
  const { state: st } = open(ludo, 2, { tokens: 4 });
  const me = st.seats[0];
  const t0 = st.tokens.find((t) => t.seat === 0);
  t0.at = 55;
  check('ludo: overshooting home is not a move',
    !ludoMoves(st, me, 4).some((m) => m.token === t0.i));
  check('ludo: the exact roll brings it home',
    ludoMoves(st, me, 2).some((m) => m.token === t0.i && m.to === 57));
}

{
  // Three sixes forfeits the turn — the oldest brake in the game.
  const { state: st } = open(ludo, 2, { tokens: 4 });
  // Spotted from the log rather than from `rolled`. Handing the turn on clears
  // the throw, so the first version was asking whether a six had been rolled
  // *after* the code that erases it had run, and never saw one.
  let sawForfeit = false;
  for (let i = 0; i < 600 && !sawForfeit; i++) {
    st.sixes = 2;
    st.rolled = null;
    st.turn = 0;
    st.log = [];
    ludo.onAction(st, { id: st.seats[0].id }, { type: 'throw' }, api);
    if (st.log.some((line) => /third six/.test(line))) {
      sawForfeit = st.turn !== 0 && st.sixes === 0;
      if (!sawForfeit) { check('ludo: three sixes in a row forfeits the turn', false, `turn ${st.turn}, sixes ${st.sixes}`); break; }
    }
  }
  check('ludo: three sixes in a row forfeits the turn', sawForfeit);
}

/* ----------------------------------- Chess -------------------------------- */

{
  const { state, players } = open(chess, 2, {});
  check('chess: white to move first', state.pos.turn === 'w');
  check('chess: thirty-two pieces', state.pos.board.filter(Boolean).length === 32);

  const before = JSON.stringify(state.pos.board);
  chess.onAction(state, players[1], { type: 'move', from: 12, to: 28 }, api);
  check('chess: nobody moves on another turn', JSON.stringify(state.pos.board) === before);
  chess.onAction(state, players[0], { type: 'move', from: 12, to: 60 }, api);
  check('chess: an illegal move is refused', JSON.stringify(state.pos.board) === before);
  chess.onAction(state, players[0], { type: 'move', from: 12, to: 28 }, api);
  check('chess: a legal one goes through', JSON.stringify(state.pos.board) !== before);
  check('chess: and the turn passes', state.pos.turn === 'b' && state.turn === 1);
}

{
  // Perft. The only way to actually know a move generator is right: these
  // counts are published and any error in castling, en passant, promotion or
  // pins changes them.
  const perft = (pos, d) => {
    if (d === 0) return 1;
    let n = 0;
    for (const m of chessRules.legalMoves(pos, pos.turn)) n += perft(chessRules.applyMove(pos, m), d - 1);
    return n;
  };
  check('chess: perft 1 is twenty', perft(chessRules.startPosition(), 1) === 20);
  check('chess: perft 2 is four hundred', perft(chessRules.startPosition(), 2) === 400);
  check('chess: perft 3 is 8902', perft(chessRules.startPosition(), 3) === 8902);

  const KIWI = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
  check('chess: kiwipete perft 1 is forty-eight', perft(chessRules.fromFen(KIWI), 1) === 48);
  check('chess: kiwipete perft 2 is 2039', perft(chessRules.fromFen(KIWI), 2) === 2039);
  const EP = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';
  check('chess: the en passant position perft 3 is 2812', perft(chessRules.fromFen(EP), 3) === 2812);
}

{
  const mate = chessRules.fromFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
  const how = chessRules.outcome(mate);
  check('chess: checkmate is recognised',
    how.over && how.why === 'checkmate' && how.result === 'black', JSON.stringify(how));

  const stale = chessRules.fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  const how2 = chessRules.outcome(stale);
  check('chess: and stalemate is a draw, not a win',
    how2.over && how2.why === 'stalemate' && how2.result === 'draw', JSON.stringify(how2));

  const bare = chessRules.fromFen('7k/8/6K1/8/8/8/8/8 w - - 0 1');
  check('chess: king against king is a draw',
    String(chessRules.outcome(bare).why).includes('enough'), JSON.stringify(chessRules.outcome(bare)));
}

/* ----------------------------------- Shogi -------------------------------- */

{
  const { state, players } = open(shogi, 2, {});
  check('shogi: forty pieces', state.pos.board.filter(Boolean).length === 40);
  check('shogi: black moves first', state.pos.turn === 'b');
  check('shogi: both hands empty', Object.keys(state.pos.hands.b).length === 0);

  const before = JSON.stringify(state.pos.board);
  shogi.onAction(state, players[1], { type: 'move', from: 60, to: 51 }, api);
  check('shogi: nobody moves on another turn', JSON.stringify(state.pos.board) === before);

  const perft = (pos, d) => {
    if (d === 0) return 1;
    let n = 0;
    for (const m of shogiRules.legalMoves(pos, pos.turn)) n += perft(shogiRules.applyMove(pos, m), d - 1);
    return n;
  };
  check('shogi: thirty moves in the opening',
    shogiRules.legalMoves(shogiRules.startPosition(), 'b').length === 30);
  check('shogi: perft 2 is nine hundred', perft(shogiRules.startPosition(), 2) === 900);
  check('shogi: perft 3 is 25470', perft(shogiRules.startPosition(), 3) === 25470);
}

{
  // A captured piece changes sides, unpromoted. That is the whole game.
  const pos = shogiRules.startPosition();
  pos.board = Array(81).fill(null);
  pos.board[shogiRules.at(8, 4)] = 'K';
  pos.board[shogiRules.at(0, 4)] = 'k';
  pos.board[shogiRules.at(4, 4)] = 'R';
  pos.board[shogiRules.at(3, 4)] = '+p';
  pos.turn = 'b';
  const m = shogiRules.legalMoves(pos, 'b').find((x) => x.from === shogiRules.at(4, 4) && x.to === shogiRules.at(3, 4));
  const after = shogiRules.applyMove(pos, m);
  check('shogi: what you take goes into your hand', (after.hands.b.P ?? 0) === 1, JSON.stringify(after.hands.b));
  check('shogi: and it comes back unpromoted',
    !Object.keys(after.hands.b).some((k) => k.startsWith('+')));
}

{
  const pos = shogiRules.startPosition();
  pos.hands.b = { P: 1 };
  check('shogi: nifu forbids a second pawn on a file',
    shogiRules.legalMoves(pos, 'b').filter((m) => m.drop === 'P').length === 0);
}

{
  const pos = shogiRules.startPosition();
  pos.board = Array(81).fill(null);
  pos.board[shogiRules.at(8, 4)] = 'K';
  pos.board[shogiRules.at(0, 0)] = 'k';
  pos.hands.b = { P: 1, N: 1, L: 1 };
  const drops = shogiRules.legalMoves(pos, 'b').filter((m) => m.drop);
  check('shogi: nothing is dropped where it could never move again',
    !drops.some((m) => shogiRules.rankOf(m.to) === 0 && ['P', 'L', 'N'].includes(m.drop))
    && !drops.some((m) => shogiRules.rankOf(m.to) === 1 && m.drop === 'N'),
    JSON.stringify(drops.filter((m) => shogiRules.rankOf(m.to) <= 1).slice(0, 3)));
}

/* ---------------------------------- Mahjong ------------------------------- */

{
  const wall = freshWall();
  check('mahjong: a hundred and forty-four tiles', wall.length === 144, String(wall.length));
  check('mahjong: eight of them are flowers and seasons',
    wall.filter((t) => t[0] === 'f' || t[0] === 's').length === 8);
  // The bug this exists for: 'd' meant both dots and dragons, so a dragon read
  // as a dot numbered R — NaN — and counted as a suited tile eligible for a
  // run. One letter meaning two things is the whole class of mistake.
  const prefixes = new Map();
  for (const t2 of wall) {
    const kind = /^[a-z]d$/.test(t2) ? 'numbered' : 'honour or bonus';
    if (!prefixes.has(t2[0])) prefixes.set(t2[0], new Set());
    prefixes.get(t2[0]).add(kind);
  }
  const overloaded = [...prefixes].filter(([, kinds]) => kinds.size > 1).map(([p]) => p);
  check('mahjong: no letter means two different things', overloaded.length === 0, overloaded.join(','));
  check('mahjong: every tile parses to something real',
    wall.every((t2) => /^[bco][1-9]$|^w[ESWN]$|^d[RGW]$|^[fs][1-4]$/.test(t2)),
    wall.filter((t2) => !/^[bco][1-9]$|^w[ESWN]$|^d[RGW]$|^[fs][1-4]$/.test(t2)).slice(0, 3).join(' '));

  check('mahjong: four of every playing tile',
    ['b1', 'c9', 'o5', 'wE', 'dR'].every((t) => wall.filter((x) => x === t).length === 4));

  check('mahjong: four pungs and a pair is a win',
    isWinningHand(['b1','b1','b1','c2','c2','c2','o3','o3','o3','wE','wE','wE','dR','dR']));
  check('mahjong: four chows and a pair is a win',
    isWinningHand(['b1','b2','b3','b4','b5','b6','c1','c2','c3','o7','o8','o9','dG','dG']));
  check('mahjong: thirteen tiles is not a win',
    !isWinningHand(['b1','b1','b1','c2','c2','c2','o3','o3','o3','wE','wE','wE','dR']));
  // A run may never cross a suit boundary, which is the easiest thing to let
  // through when a chow is checked by arithmetic on the number alone.
  check('mahjong: a chow may not run across suits',
    !isWinningHand(['b8','b9','c1','c2','c2','c2','o3','o3','o3','wE','wE','wE','dR','dR']));
  // The hand that can be read several ways and only some of them win — the
  // reason this is a search rather than a pattern match.
  check('mahjong: an ambiguous hand is read the way that wins',
    isWinningHand(['b1','b1','b1','b2','b3','b4','b5','b6','b7','b8','b9','b9','b9','b5']),
    'nine gates, completed on a five');
}

{
  const { state, players } = open(mahjong, 4, {});
  const dealt = state.hands[0].length + state.melds[0].length * 3;
  check('mahjong: thirteen each, and fourteen for east',
    state.hands[1].length === 13 && dealt === 14, dealt + ' / ' + state.hands[1].length);

  const wire = JSON.stringify(mahjong.serialize(state));
  const someoneElse = state.hands[1];
  check('mahjong: nobody can see anybody else hand',
    !someoneElse.some((t) => wire.includes('"' + t + '"')),
    someoneElse.filter((t) => wire.includes('"' + t + '"')).slice(0, 3).join(' '));

  const tile = state.hands[0][0];
  mahjong.onAction(state, players[0], { type: 'discard', tile }, api);
  check('mahjong: a discard opens a claim window', state.claimWindow > 0, String(state.claimWindow));
  check('mahjong: and the tile is on the table', state.lastDiscard?.tile === tile);

  const handWas = state.hands[0].length;
  mahjong.onAction(state, players[0], { type: 'discard', tile: state.hands[0][0] }, api);
  check('mahjong: you cannot throw twice', state.hands[0].length === handWas, String(state.hands[0].length));
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
