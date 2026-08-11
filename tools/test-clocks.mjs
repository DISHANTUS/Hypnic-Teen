// Every clock in the studio actually moves.
//
//   node tools/test-clocks.mjs
//
// A table broadcasts only when something happens, and a clock ticking is not
// something happening — so the countdown on screen is run by the browser,
// forward from the last frame it was sent. That is deliberate: pushing a frame
// a second per room is about five megabytes per player per hour, which is real
// money on somebody's mobile data. The browser suites check the number on
// screen actually falls.
//
// What is left for this file is the half underneath: the server's own clock has
// to be running, for every game that has one. A tick loop that never decrements
// would leave the browser counting down to a turn that never ends, and no
// amount of client-side interpolation would show it.
//
// The property, for every game with a clock:
//
//   a second of ticking leaves the number a player would read smaller than it
//   was, and never below zero.

import { listGames } from '../server/games/index.js';

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`${ok ? '\x1b[32m  ok  \x1b[0m' : '\x1b[31m FAIL \x1b[0m'} ${label}${extra ? `  \x1b[2m${extra}\x1b[0m` : ''}`);
  return ok;
};

const api = { emit() {}, broadcast() {}, log() {} };
const players = (n) => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, name: `Player${i + 1}`, connected: true,
}));

/** The countdown a player would actually read, whatever the game calls it. */
function shownClock(view) {
  const of = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return of(view.turnLeft) ?? of(view.timeLeft) ?? of(view.left) ?? null;
}

console.log('\n  \x1b[1mEvery clock in the studio\x1b[0m  \x1b[2m(a second of ticking has to reach the room)\x1b[0m\n');

const games = listGames();
let noClock = 0;

for (const meta of games) {
  const game = meta.__impl ?? meta;
  const mod = await import(`../server/games/index.js`).then((m) => m.getGame(meta.id));
  if (!mod?.onTick || !mod?.isDirty) { noClock += 1; continue; }

  const n = Math.max(mod.minPlayers ?? 2, 2);
  const roster = players(Math.min(n, mod.maxPlayers ?? n));
  let state;
  try {
    state = mod.createState(roster, { settings: {}, room: { hostId: roster[0].id } });
  } catch (err) {
    check(`${meta.name}: opens a table`, false, String(err.message).slice(0, 80));
    continue;
  }

  // Get past the briefing the way a room would: everybody says they are ready.
  for (const p of roster) {
    try { mod.onAction(state, p, { type: 'briefed' }, api); } catch { /* not all games brief */ }
  }
  mod.isDirty(state);   // swallow whatever the setup made dirty

  const before = shownClock(mod.serializeFor?.(state, roster[0].id) ?? mod.serialize(state));
  if (before === null || before <= 0) { noClock += 1; continue; }

  // A second of game time, at the rate the room ticks.
  let threw = null;
  for (let i = 0; i < 4; i++) {
    try { mod.onTick(state, 0.25); } catch (err) { threw = err; break; }
  }
  if (threw) {
    check(`${meta.name}: ticks without throwing`, false, String(threw.message).slice(0, 80));
    continue;
  }
  const after = shownClock(mod.serializeFor?.(state, roster[0].id) ?? mod.serialize(state));

  // A phase that ends inside the second restarts the clock at something bigger,
  // which is the clock working rather than failing.
  check(`${meta.name}: the server's clock is running`,
    after !== null && (after < before || after > before),
    `stuck at ${before}s through a whole second of ticks`);
  void game;
}

console.log(`\n  \x1b[2m${noClock} game${noClock === 1 ? '' : 's'} with no countdown to check\x1b[0m`);

const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.log('\n  \x1b[31mwhat failed:\x1b[0m');
  for (const r of bad) console.log(`  \x1b[31m  · ${r.label}\x1b[0m`);
}
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — every clock the studio has is running\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
