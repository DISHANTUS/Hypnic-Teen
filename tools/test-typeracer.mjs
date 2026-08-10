// Type Racer, and Chain Reaction.
//
//   npm run test:typeracer
//
// Two games with nothing in common except that each has exactly one thing that
// has to be right, and in both cases it is a thing you cannot see by playing.
//
//   nothing a client says about itself is believed
//        A browser reporting its own words per minute is reporting a number it
//        invented. Progress is the length of the longest correct prefix of the
//        text actually sent, and the clock is the server's. Both are checked
//        here by lying to the game and watching it refuse.
//
//   the cascade stops
//        A chain reaction on a board owned by one player never settles, because
//        every orb thrown lands on that player's own cell and pushes it over
//        too. That is not a runaway to be capped, it is the game being won —
//        and the loop has to notice.

import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-tr');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
process.env.DATA_DIR = TMP;

const { typeracer, PASSAGES, wpmFrom, IMPLAUSIBLE_WPM } = await import('../server/games/typeracer.js');
const { chainreaction, capacityOf, neighbours } = await import('../server/games/board/chainreaction.js');

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};

const api = { emit() {}, emitTo() {}, finish() {}, players: () => [] };
let seq = 0;
const cast = (n) => Array.from({ length: n }, () => ({ id: `t${seq++}`, name: `T${seq}`, connected: true }));

function openRacer(n, settings = {}) {
  const players = cast(n);
  const state = typeracer.createState(players, { settings });
  for (const p of players) typeracer.onAction(state, p, { type: 'briefed' }, api);
  // brief -> ready; the passage is not out yet.
  return { state, players };
}
const goLive = (state) => { state.timeLeft = 0; typeracer.onTick(state, 1, api); };

console.log('\n  Type Racer and Chain Reaction\n');

/* -------------------------------- the passages ---------------------------- */

{
  check('there are passages to type', PASSAGES.length >= 8, String(PASSAGES.length));
  check('none of them is empty', PASSAGES.every((p) => p.length > 40));
  // Typing a capital or a bracket on a phone is two keys and a moment of
  // hunting, which is not what this game is about.
  const awkward = PASSAGES.filter((p) => /[A-Z0-9;:"(){}[\]<>|\\/@#$%^&*_+=~`]/.test(p));
  check('and none needs a shift key', awkward.length === 0, awkward.slice(0, 1).map((p) => p.slice(0, 40)).join());
  check('no passage appears twice', new Set(PASSAGES).size === PASSAGES.length);

  check('a word is five characters', wpmFrom(500, 60000) === 100, String(wpmFrom(500, 60000)));
  check('and half the time is twice the speed', wpmFrom(500, 30000) === 200, String(wpmFrom(500, 30000)));
}

/* ----------------------- nothing a client says is believed ---------------- */

{
  const { state, players } = openRacer(2);
  check('the passage is held back during the countdown',
    typeracer.serialize(state).passage === '', typeracer.serialize(state).passage.slice(0, 20));
  goLive(state);
  check('and appears when the clock starts', typeracer.serialize(state).passage.length > 0);
  check('the race clock is the server clock', state.startedAt > 0);

  const passage = state.passage;
  const me = state.racers[0];

  // Typing it wrong does not move you on.
  typeracer.onAction(state, players[0], { type: 'typed', text: 'zzzz' }, api);
  check('a wrong start does not advance you', me.at === 0, String(me.at));

  // Typing it right does, exactly as far as it is right.
  typeracer.onAction(state, players[0], { type: 'typed', text: passage.slice(0, 20) }, api);
  check('a correct prefix advances you exactly that far', me.at === 20, String(me.at));

  // A correct prefix with rubbish on the end advances to the prefix and no
  // further, which is the rule that makes accuracy into speed.
  typeracer.onAction(state, players[0], { type: 'typed', text: passage.slice(0, 30) + 'qqq' }, api);
  check('and rubbish after it does not', me.at === 30, String(me.at));

  // Claiming to be finished without the text does nothing at all.
  const was = me.at;
  typeracer.onAction(state, players[0], { type: 'typed', text: 'x'.repeat(passage.length) }, api);
  check('claiming the whole length with the wrong text moves nothing', me.at === was, String(me.at));
  check('and does not finish you', !me.finishedAt);

  // The real thing does.
  typeracer.onAction(state, players[0], { type: 'typed', text: passage }, api);
  check('typing the passage finishes the race', Boolean(me.finishedAt));
  check('and the speed is worked out from the server clock', me.wpm > 0, `${me.wpm} wpm`);
}

{
  // A paste. Instant completion is faster than the world record by a wide
  // margin, so it is recorded and left out of the placings rather than binned.
  const { state, players } = openRacer(2);
  goLive(state);
  state.startedAt = Date.now();     // as if the passage had just appeared
  typeracer.onAction(state, players[0], { type: 'typed', text: state.passage }, api);
  const me = state.racers[0];
  check('an instant finish is flagged as impossible', me.suspect === true, `${me.wpm} wpm`);
  check('and is not counted towards a best', me.best === 0, String(me.best));
  check('the ceiling is beyond the world record', IMPLAUSIBLE_WPM > 220, String(IMPLAUSIBLE_WPM));
  check('but the run is kept and shown, not deleted',
    typeracer.serialize(state).racers.some((r) => r.suspect), 'suspect reaches the wire');

  // A plausible finish is not flagged.
  const other = state.racers[1];
  state.startedAt = Date.now() - 60000;   // one minute ago
  typeracer.onAction(state, players[1], { type: 'typed', text: state.passage }, api);
  check('an ordinary finish is not flagged', other.suspect === false, `${other.wpm} wpm`);
}

{
  // Nobody may type for anybody else, and nothing is accepted before the go.
  const { state, players } = openRacer(2);
  typeracer.onAction(state, players[0], { type: 'typed', text: 'anything' }, api);
  check('nothing is accepted before the passage appears', state.racers[0].at === 0);

  goLive(state);
  typeracer.onAction(state, { id: 'ghost', name: 'Ghost' }, { type: 'typed', text: state.passage }, api);
  check('a stranger cannot type into the race',
    state.racers.every((r) => r.at === 0), state.racers.map((r) => r.at).join(','));

  // A finished racer stops being able to change anything.
  typeracer.onAction(state, players[0], { type: 'typed', text: state.passage }, api);
  const at = state.racers[0].at;
  typeracer.onAction(state, players[0], { type: 'typed', text: 'zzz' }, api);
  check('and a finished racer cannot un-finish', state.racers[0].at === at, String(state.racers[0].at));
}

{
  // The race ends the moment everybody is done, without waiting out the clock.
  const { state, players } = openRacer(2, { raceSeconds: 300 });
  goLive(state);
  for (const p of players) typeracer.onAction(state, p, { type: 'typed', text: state.passage }, api);
  typeracer.onTick(state, 0.25, api);
  check('the race ends when everybody has finished', state.phase === 'done', state.phase);
  check('and everybody scored', state.racers.every((r) => r.score > 0),
    state.racers.map((r) => r.score).join(','));
}

/* ------------------------------ Chain Reaction ---------------------------- */

{
  check('a corner holds two', capacityOf(6, 8, 0, 0) === 2, String(capacityOf(6, 8, 0, 0)));
  check('an edge holds three', capacityOf(6, 8, 3, 0) === 3, String(capacityOf(6, 8, 3, 0)));
  check('the middle holds four', capacityOf(6, 8, 3, 4) === 4, String(capacityOf(6, 8, 3, 4)));
  check('the far corner holds two too', capacityOf(6, 8, 5, 7) === 2, String(capacityOf(6, 8, 5, 7)));
  check('neighbours are only orthogonal',
    neighbours(6, 8, 0).length === 2 && neighbours(6, 8, 7).length === 4,
    `${neighbours(6, 8, 0).length} / ${neighbours(6, 8, 7).length}`);
}

function openChain(n, settings = {}) {
  const players = cast(n);
  const state = chainreaction.createState(players, { settings });
  for (const p of players) chainreaction.onAction(state, p, { type: 'briefed' }, api);
  return { state, players };
}

{
  const { state, players } = openChain(2, { cols: 5, rows: 5 });
  check('the board starts empty', state.cells.every((c) => c.n === 0 && c.owner === null));
  check('and it is the right size', state.cells.length === 25, String(state.cells.length));

  // You may drop in an empty cell or your own, never anybody else's.
  chainreaction.onAction(state, players[0], { type: 'drop', at: 12 }, api);
  check('dropping claims the cell', state.cells[12].owner === 0 && state.cells[12].n === 1);
  check('and the turn passes', state.turn === 1);

  const before = JSON.stringify(state.cells);
  chainreaction.onAction(state, players[0], { type: 'drop', at: 0 }, api);
  check('you cannot drop out of turn', JSON.stringify(state.cells) === before);

  chainreaction.onAction(state, players[1], { type: 'drop', at: 12 }, api);
  check('and you cannot drop into somebody else’s cell',
    state.cells[12].owner === 0 && state.cells[12].n === 1, JSON.stringify(state.cells[12]));
}

{
  // A corner bursts on the second orb and takes both neighbours.
  const { state, players } = openChain(2, { cols: 5, rows: 5 });
  state.cells[0] = { n: 1, owner: 0 };
  state.turn = 0;
  chainreaction.onAction(state, players[0], { type: 'drop', at: 0 }, api);
  check('a corner bursts at two', state.cells[0].n === 0 && state.cells[0].owner === null,
    JSON.stringify(state.cells[0]));
  check('and throws one into each neighbour',
    state.cells[1].n === 1 && state.cells[5].n === 1,
    `${state.cells[1].n} / ${state.cells[5].n}`);
  check('turning them your colour',
    state.cells[1].owner === 0 && state.cells[5].owner === 0);
}

{
  // A burst converts an enemy cell outright. That is the whole game.
  const { state, players } = openChain(2, { cols: 5, rows: 5 });
  state.cells[0] = { n: 1, owner: 0 };
  state.cells[1] = { n: 1, owner: 1 };
  state.played = [0, 1];
  state.turn = 0;
  chainreaction.onAction(state, players[0], { type: 'drop', at: 0 }, api);
  check('a burst takes an enemy cell', state.cells[1].owner === 0, String(state.cells[1].owner));
}

{
  // Nobody is out before they have played, or the second player is eliminated
  // before touching the board.
  const { state, players } = openChain(3, { cols: 5, rows: 5 });
  chainreaction.onAction(state, players[0], { type: 'drop', at: 0 }, api);
  check('nobody is eliminated before their first turn',
    state.seats.every((s) => !s.out), state.seats.map((s) => s.out).join(','));
}

{
  // The cascade is filmed, wave by wave, so the client can play it rather than
  // cut to the end. Watching one orb take half the board is the entire game;
  // sending only the settled board is reporting a firework as a noise.
  const { state, players } = openChain(2, { cols: 5, rows: 5 });
  // A corner loaded to one short, with its two neighbours also loaded, so one
  // drop sets off more than a single wave.
  state.cells[0] = { n: 1, owner: 0 };   // corner, holds 2
  state.cells[1] = { n: 2, owner: 0 };   // top edge, holds 3
  state.cells[5] = { n: 2, owner: 0 };   // left edge, holds 3
  // Seat 1 needs something on the board and it needs to be out of reach of the
  // blast. Without it the cascade stops after one wave for a perfectly good
  // reason — one colour left is the game being over — and the fixture measures
  // that instead of what it meant to.
  state.cells[24] = { n: 1, owner: 1 };  // the far corner
  state.played = [0, 1];
  state.turn = 0;
  chainreaction.onAction(state, players[0], { type: 'drop', at: 0 }, api);

  const film = state.bursting?.film ?? [];
  check('a cascade is filmed wave by wave', film.length >= 2, `${film.length} waves`);
  check('every frame says which cells burst',
    film.every((f) => Array.isArray(f.burst) && f.burst.length > 0));
  check('and carries the whole board',
    film.every((f) => f.cells.length === state.cells.length));

  // The last frame has to be the board the server actually settled on. A film
  // that ends anywhere else would leave the screen showing a lie until the
  // next state push corrected it.
  const last = film[film.length - 1].cells;
  check('the last frame is the settled board',
    last.every((c, i) => c.n === state.cells[i].n && c.owner === state.cells[i].owner),
    JSON.stringify({ last: last.slice(0, 3), real: state.cells.slice(0, 3) }));

  // Orbs are conserved across a wave except for the ones a burst pushes off
  // the edge of the board, so the count never rises.
  let prev = Infinity;
  for (const f of film) {
    const total = f.cells.reduce((n, c) => n + c.n, 0);
    if (total > prev) { prev = -1; break; }
    prev = total;
  }
  check('no frame invents orbs', prev !== -1);

  const moved = state.moveNo;
  chainreaction.onAction(state, players[1], { type: 'drop', at: 24 }, api);
  check('each move gets its own number', state.moveNo === moved + 1, String(state.moveNo));
}

{
  // A board primed to burst everywhere: the longest cascade that can actually
  // happen, since the colour check stops a self-feeding one the moment a single
  // colour is left. The film is capped, and what it cut is stated rather than
  // trimmed away silently.
  const { state, players } = openChain(2, { cols: 9, rows: 12 });
  for (let i = 0; i < state.cells.length; i++) {
    const cap = capacityOf(9, 12, i % 9, Math.floor(i / 9));
    state.cells[i] = { n: cap - 1, owner: 0 };
  }
  state.cells[state.cells.length - 1] = { n: 1, owner: 1 };  // out of reach, for a while
  state.played = [0, 1];
  state.turn = 0;
  chainreaction.onAction(state, players[0], { type: 'drop', at: 0 }, api);
  const b = state.bursting;
  check('a big cascade runs many waves', (b?.waves ?? 0) >= 5, String(b?.waves));
  check('the film never exceeds the cap', (b?.film.length ?? 0) <= 64, String(b?.film.length));
  check('and what was cut is stated, not hidden',
    typeof b?.cut === 'number' && b.cut === Math.max(0, b.waves - b.film.length),
    JSON.stringify({ waves: b?.waves, kept: b?.film.length, cut: b?.cut }));
}

{
  // Eight players, like the game everybody knows.
  check('chain reaction seats eight', chainreaction.maxPlayers === 8,
    String(chainreaction.maxPlayers));
  const { state } = openChain(8, { cols: 6, rows: 8 });
  check('and eight actually sit down', state.seats.length === 8, String(state.seats.length));
}

{
  // The cascade that never settles. A board owned by one colour feeds itself
  // forever — and that is the game being over, not a runaway.
  const { state, players } = openChain(2, { cols: 4, rows: 4 });
  // Fill every cell of seat 0's to one short of bursting.
  for (let i = 0; i < state.cells.length; i++) {
    const cap = capacityOf(4, 4, i % 4, Math.floor(i / 4));
    state.cells[i] = { n: cap - 1, owner: 0 };
  }
  state.played = [0, 1];
  state.turn = 0;
  const began = Date.now();
  chainreaction.onAction(state, players[0], { type: 'drop', at: 0 }, api);
  const took = Date.now() - began;
  check('a board that cannot settle stops rather than hanging', took < 2000, `${took}ms`);
  check('and it is recorded as the game being over', Boolean(state.result), JSON.stringify(state.result));
  check('with the right winner', state.result?.seat === 0, JSON.stringify(state.result));
}

{
  // Whole games, played legally, checking the invariants after every move.
  let broke = null;
  let games = 0;
  let bigWaves = 0;
  for (let round = 0; round < 30 && !broke; round++) {
    const { state, players } = openChain(2, { cols: 5, rows: 6 });
    let guard = 0;
    while (!chainreaction.__spec.isDone(state) && guard++ < 4000) {
      const seat = state.seats[state.turn];
      if (!seat || seat.out) break;
      const mine = chainreaction.serializeFor(state, seat.id).you.canDrop;
      if (!mine.length) break;
      const before = state.cells.map((c) => c.owner);
      chainreaction.onAction(state, players.find((p) => p.id === seat.id), { type: 'drop', at: mine[guard % mine.length] }, api);
      if (/waves/.test(state.said)) bigWaves += 1;

      // No cell may ever sit at or above its capacity once things have settled.
      const over = state.cells.findIndex((c, i) => c.n >= capacityOf(5, 6, i % 5, Math.floor(i / 5)));
      if (over >= 0 && !state.result) { broke = `cell ${over} left over capacity`; break; }
      // A cell with orbs always has an owner, and an empty one never does.
      if (state.cells.some((c) => (c.n > 0) !== (c.owner !== null))) { broke = 'a cell with orbs and no owner'; break; }
      void before;
    }
    if (!broke && !chainreaction.__spec.isDone(state)) broke = `a game never finished (${guard} moves)`;
    else games += 1;
  }
  check('thirty games, and the board never left a cell over capacity', broke === null, broke ?? '');
  check('games finished', games > 0, String(games));
  check('and chains actually went off', bigWaves > 0, `${bigWaves} multi-wave moves`);
}

{
  for (const game of [typeracer, chainreaction]) {
    const players = cast(Math.max(2, game.minPlayers));
    const state = game.createState(players, { settings: {} });
    for (const p of players) game.onAction(state, p, { type: 'briefed' }, api);
    game.onAction(state, { id: 'ghost', name: 'Ghost' }, { type: 'drop', at: 0 }, api);
    game.onAction(state, players[0], { type: 'nonsense' }, api);
    game.onAction(state, players[0], { type: 'drop', at: -1 }, api);
    game.onAction(state, players[0], { type: 'drop', at: 99999 }, api);
    check(`${game.name}: nonsense does nothing`, true);
    check(`${game.name}: no CPU playing`, game.botAction() === null);
    check(`${game.name}: it has its rules`, (game.howToPlay ?? []).length >= 5, String(game.howToPlay?.length));
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
  : `\n  \x1b[32mall ${results.length} passed — nothing a client says about itself is believed\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
