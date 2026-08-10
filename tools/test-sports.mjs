// Sports betting.
//
//   npm run test:sports
//
// The two live feeds cannot be exercised here — they want a key this machine
// does not have and a fixture somebody is actually playing. So everything below
// runs against the scripted feed, which is the honest split: what is untested
// is the mapping from one service's JSON to a snapshot, and what is tested is
// every single thing the table does with a snapshot once it has one.
//
// The property that matters most is not conservation this time, though that is
// checked too. It is the ordering: a market's baseline must be fetched when
// betting shuts, not when the question was asked. Get that wrong and the table
// still balances to the chip, still pays out, still looks completely correct —
// and quietly lets a room bet on goals they watched go in.

import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-sports');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
process.env.DATA_DIR = TMP;
// Drive the clock rather than wait on it.
process.env.SPORTS_SNAP_TTL_MS = '0';
process.env.SPORTS_PATIENCE_MS = '400';

const { sports } = await import('../server/games/sports.js');
const { registerFeed } = await import('../server/feeds/index.js');
const { scriptedFeed } = await import('../server/feeds/fake.js');
const { BOOKS, paceLine } = await import('../server/markets.js');
const { balanceOf, walletFor, award } = await import('../server/chips.js');

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};

const api = { emit() {}, emitTo() {}, finish() {}, players: () => [] };
const flush = () => new Promise((r) => setImmediate(r));

let seq = 0;
const mk = (n) => Array.from({ length: n }, () => {
  const id = `Hypnic>Sp${seq++}<Teen`;
  walletFor(id);
  award(id, 40000);
  return { id, name: `Sp${seq}`, connected: true };
});
const totalChips = (cast) => cast.reduce((sum, p) => sum + balanceOf(p.id), 0);

/** A fresh scripted match under the name the table asks for. */
function stage(sport = 'football') {
  const feed = scriptedFeed({ sport });
  registerFeed({ ...feed, sport: `demo-${sport}` });
  return feed;
}

/** Open a table, get past the brief, and point it at the scripted match. */
async function open(sport, players = 3, settings = {}) {
  const feed = stage(sport);
  const cast = mk(players);
  const state = sports.createState(cast, {
    settings: { sport: `demo-${sport}`, rounds: 6, betSeconds: 30, ...settings },
  });
  for (const p of cast) sports.onAction(state, p, { type: 'briefed' }, api);
  sports.onAction(state, cast[0], { type: 'match', id: 'demo', name: 'Scripted' }, api);
  // The host naming the match is what lets the first one open.
  sports.onTick(state, 0.25, api);
  await flush(); await flush();
  if (!state.open) { begin(state); await flush(); await flush(); }
  return { state, cast, feed };
}
const begin = (state) => { state.phase = 'brief'; state.timeLeft = 0; sports.onTick(state, 1, api); };

/** Tick until something changes or we give up. */
async function run(state, ticks = 12, dt = 0.25) {
  for (let i = 0; i < ticks; i++) {
    sports.onTick(state, dt, api);
    await flush();
  }
}
/** Shut the betting on whatever is open. */
async function shut(state) {
  if (!state.open) return;
  state.open.timeLeft = 0.01;
  await run(state, 6);
}

console.log('\n  Sports betting — asked early, locked before it happens\n');

/* ---------------------- the rules, on their own, in the dark ---------------- */

{
  const snap = (clock, facts) => ({ clock, clockLabel: `${clock}'`, facts, status: 'live' });
  const byId = (sport, id) => BOOKS[sport].find((m) => m.id === id);

  const goalSoon = byId('football', 'goalSoon');
  check('a goal in the window reads as yes',
    goalSoon.resolve(snap(10, { homeGoals: 1, awayGoals: 0 }), snap(16, { homeGoals: 1, awayGoals: 1 })).outcome === 'yes');
  check('and no goal reads as no',
    goalSoon.resolve(snap(10, { homeGoals: 1, awayGoals: 0 }), snap(16, { homeGoals: 1, awayGoals: 0 })).outcome === 'no');

  const whoNext = byId('football', 'whoNext');
  check('one side scoring names that side',
    whoNext.resolve(snap(10, { homeGoals: 0, awayGoals: 0 }), snap(20, { homeGoals: 1, awayGoals: 0 })).outcome === 'home');
  // The honest one: two cumulative counts cannot say who was first, so the
  // market offers `both` rather than inventing an order.
  check('both sides scoring is its own answer, not a guess at the order',
    whoNext.resolve(snap(10, { homeGoals: 0, awayGoals: 0 }), snap(20, { homeGoals: 1, awayGoals: 1 })).outcome === 'both');
  check('and `both` is an outcome people could actually have backed',
    whoNext.outs(snap(10, { home: 'A', away: 'B' })).some((o) => o.id === 'both'));

  const howMany = byId('football', 'howManyGoals');
  check('two goals is "two or more"',
    howMany.resolve(snap(0, { homeGoals: 0, awayGoals: 0 }), snap(12, { homeGoals: 1, awayGoals: 1 })).outcome === 'more');
  check('one goal is "exactly one"',
    howMany.resolve(snap(0, { homeGoals: 0, awayGoals: 0 }), snap(12, { homeGoals: 1, awayGoals: 0 })).outcome === 'one');

  // A clock that goes backwards is a feed that cannot be trusted for this
  // window, and every rule has to refuse rather than subtract its way to a
  // confident wrong answer.
  const backwards = goalSoon.resolve(snap(40, { homeGoals: 0, awayGoals: 0 }), snap(12, { homeGoals: 0, awayGoals: 0 }));
  check('a clock that goes backwards refuses to resolve', backwards.ok === false, backwards.why);
  check('and so does a feed that said nothing',
    goalSoon.resolve(snap(10, { homeGoals: 0, awayGoals: 0 }), null).ok === false);

  const cs = (clock, facts) => ({ clock, clockLabel: '', facts: { inningsKey: '1:first', balls: clock, ...facts } });
  const runsOver = BOOKS.cricket.find((m) => m.id === 'runsNextOver');
  check('nine off the over is "9 or more"',
    runsOver.resolve(cs(60, { runs: 100 }), cs(66, { runs: 109 })).outcome === 'lots');
  check('three off the over is "0 to 3"',
    runsOver.resolve(cs(60, { runs: 100 }), cs(66, { runs: 103 })).outcome === 'few');

  const wicketSoon = BOOKS.cricket.find((m) => m.id === 'wicketSoon');
  check('a wicket in the window reads as yes',
    wicketSoon.resolve(cs(60, { runs: 100, wickets: 2 }), cs(78, { runs: 120, wickets: 3 })).outcome === 'yes');

  // The one that would silently pay out nonsense: an innings break resets the
  // score to nothing, so a window that straddles one must refuse.
  const across = runsOver.resolve(
    { clock: 100, facts: { inningsKey: '1:first', runs: 180, balls: 100 } },
    { clock: 106, facts: { inningsKey: '2:second', runs: 4, balls: 106 } }
  );
  check('a window that straddles an innings break refuses to resolve', across.ok === false, across.why);

  check('the pace line follows the innings rather than being fixed',
    paceLine({ facts: { runs: 120, balls: 60 } }) === 60 &&
    paceLine({ facts: { runs: 30, balls: 60 } }) === 15,
    `${paceLine({ facts: { runs: 120, balls: 60 } })} vs ${paceLine({ facts: { runs: 30, balls: 60 } })}`);
  check('and never opens at nothing',
    paceLine({ facts: { runs: 0, balls: 0 } }) >= 5, String(paceLine({ facts: { runs: 0, balls: 0 } })));
}

/* ------------------- the ordering, which is the whole point ---------------- */

{
  const { state, cast, feed } = await open('football', 3);
  check('a market opens once the host says what is on', Boolean(state.open), state.open?.ask ?? 'none');
  const askedAt = feed.at();

  // The match moves on while the room is still betting — which is exactly what
  // happens in life, and exactly the gap a lazy implementation would swallow.
  feed.advance(9).goal('home');
  sports.onAction(state, cast[0], { type: 'back', outcome: state.open.outs[0].id, amount: 25 }, api);
  const locking = state.open;
  await shut(state);

  check('the baseline is taken when betting shuts, not when the question was asked',
    locking.lockClock === askedAt + 9, `${locking.lockClock} vs asked at ${askedAt}`);
  check('so the window starts after the goal the room already saw',
    locking.lockClock > askedAt, `${askedAt} then ${locking.lockClock}`);
  check('the window runs from the baseline', locking.closeClock === locking.lockClock + locking.def.span,
    `${locking.lockClock} to ${locking.closeClock}`);

  check('the locked market is out waiting on the world', state.pending.includes(locking));
  check('and the next one is already taking bets', Boolean(state.open) && state.open !== locking, state.open?.ask);

  // And nothing can be added to it once it is out there.
  //
  // Checked against that market's own book rather than against the room's
  // chips, which is what the first version did and why it failed one run in
  // two. A bet placed now lands on whatever is *open* — and by this point that
  // is the next market, which often has an outcome by the same name. So chips
  // legitimately left the room, the market under test was untouched, and the
  // check called it a leak.
  const wasOn = locking.bets.reduce((sum, b) => sum + b.chips, 0);
  sports.onAction(state, cast[1], { type: 'back', outcome: locking.outs[0].id, amount: 25 }, api);
  const stillOn = locking.bets.reduce((sum, b) => sum + b.chips, 0);
  check('a locked market takes no more money', stillOn === wasOn, `${wasOn} then ${stillOn}`);
}

/* ------------------------------ settling itself ---------------------------- */

{
  const { state, cast, feed } = await open('football', 3, { rounds: 1 });
  const m = state.open;
  const goalIdx = m.outs.findIndex((o) => o.id === 'yes' || o.id === 'home' || o.id === 'more' || o.id === 'over');
  const backing = m.outs[goalIdx >= 0 ? goalIdx : 0].id;
  for (const p of cast) sports.onAction(state, p, { type: 'back', outcome: backing, amount: 30 }, api);
  await shut(state);

  // Play out the window, with a goal in it.
  feed.goal('home').advance(m.def.span + 1);
  await run(state, 8);

  check('a market settles itself off the feed', state.settled.length === 1, JSON.stringify(state.settled[0]?.said ?? ''));
  const done = state.settled[0];
  check('and nobody in the room decided it', done && done.voided === false);
  check('the pot went to whoever backed the right thing',
    done.paid.length === 0 || done.paid.reduce((s, p) => s + p.chips, 0) === done.pot,
    `${done.paid.reduce((s, p) => s + p.chips, 0)} of ${done.pot}`);
}

/* --------------------------- when it cannot be told ------------------------ */

{
  const { state, cast, feed } = await open('football', 3, { rounds: 1 });
  const before = totalChips(cast);
  for (const p of cast) sports.onAction(state, p, { type: 'back', outcome: state.open.outs[0].id, amount: 40 }, api);
  check('backing a market costs chips', totalChips(cast) < before, `${before} then ${totalChips(cast)}`);
  await shut(state);

  // The feed dies while the market is out.
  feed.breakIt(true);
  await new Promise((r) => setTimeout(r, 450));
  await run(state, 10);

  check('a market nobody can settle is void', state.settled[0]?.voided === true, state.settled[0]?.said);
  check('and every chip goes back exactly as it came',
    totalChips(cast) === before, `${before} then ${totalChips(cast)}`);
  check('a void pays no prize', state.settled[0]?.paid.length === 0);
  check('and leaves nobody up or down', state.players.every((p) => p.net === 0));
}

{
  // No baseline at all: the feed is down at the moment betting shuts. Nobody
  // has seen anything, so this must cost the room nothing but the question.
  const { state, cast, feed } = await open('football', 3, { rounds: 2 });
  const before = totalChips(cast);
  for (const p of cast) sports.onAction(state, p, { type: 'back', outcome: state.open.outs[0].id, amount: 20 }, api);
  feed.breakIt(true);
  await shut(state);
  await run(state, 6);
  check('a market that could not even start is void', state.settled[0]?.voided === true, state.settled[0]?.said);
  check('and refunded', totalChips(cast) === before, `${before} then ${totalChips(cast)}`);
  feed.breakIt(false);
}

/* ------------------------ overlapping, as asked for ------------------------ */

{
  const { state, cast, feed } = await open('football', 3, { rounds: 4 });
  let mostAtOnce = 0;
  for (let i = 0; i < 3; i++) {
    if (!state.open) break;
    sports.onAction(state, cast[i % cast.length], { type: 'back', outcome: state.open.outs[0].id, amount: 15 }, api);
    await shut(state);
    feed.advance(2);
    await run(state, 4);
    mostAtOnce = Math.max(mostAtOnce, state.pending.length);
  }
  check('markets are out waiting while a new one takes bets', mostAtOnce >= 2, `${mostAtOnce} at once`);
  check('and there is always something to bet on', Boolean(state.open), state.open?.ask ?? 'nothing open');
  const wire = sports.serializeFor(state, cast[0].id);
  check('you can see what you still have riding', Array.isArray(wire.you.riding), JSON.stringify(wire.you.riding?.length));
}

/* --------------------------- cricket, and the break ------------------------ */

{
  const { state, cast, feed } = await open('cricket', 3, { rounds: 1 });
  const before = totalChips(cast);
  for (const p of cast) sports.onAction(state, p, { type: 'back', outcome: state.open.outs[0].id, amount: 25 }, api);
  const m = state.open;
  await shut(state);
  // The innings ends inside the window, taking the score back to nothing.
  feed.runs(14).advance(m.def.span + 1).newInnings();
  await run(state, 8);
  check('a market straddling an innings break is void rather than absurd',
    state.settled[0]?.voided === true, state.settled[0]?.said);
  check('and hands the chips back', totalChips(cast) === before, `${before} then ${totalChips(cast)}`);
}

/* ------------------------------- conservation ------------------------------ */

{
  let leak = null;
  let settled = 0;
  let voided = 0;
  for (let book = 0; book < 12 && !leak; book++) {
    const { state, cast, feed } = await open(book % 2 ? 'cricket' : 'football', 3, { rounds: 4 });
    const before = totalChips(cast);
    let guard = 0;
    while (!state.over && guard++ < 120) {
      if (state.open?.phase === 'betting') {
        // Spread across the outcomes by seat, so some markets pay and some carry.
        cast.forEach((p, i) => {
          sports.onAction(state, p, { type: 'back', outcome: state.open.outs[i % state.open.outs.length].id, amount: 20 }, api);
        });
        await shut(state);
        // Every third book the feed dies, so the void path carries real weight.
        if (book % 3 === 2) { feed.breakIt(true); await new Promise((r) => setTimeout(r, 450)); }
        else { feed.goal('home').runs(9).wicket(1).advance(40); }
      }
      await run(state, 6);
      feed.breakIt(false);
    }
    settled += state.settled.filter((s) => !s.voided).length;
    voided += state.settled.filter((s) => s.voided).length;
    if (!state.over) leak = `book ${book} never closed (${state.opened} opened, ${state.pending.length} pending)`;
    else if (totalChips(cast) !== before) leak = `${before} then ${totalChips(cast)}`;
  }
  check('twelve books and not one chip made or lost', leak === null, leak ?? '');
  check('markets settled off the feed', settled > 0, String(settled));
  check('markets were voided', voided > 0, String(voided));
}

/* ---------------------------------- nonsense ------------------------------- */

{
  const { state, cast } = await open('football', 3);
  const before = totalChips(cast);
  sports.onAction(state, { id: 'ghost', name: 'Ghost' }, { type: 'back', outcome: state.open.outs[0].id, amount: 50 }, api);
  sports.onAction(state, cast[0], { type: 'back', outcome: 'not-an-outcome', amount: 50 }, api);
  sports.onAction(state, cast[0], { type: 'back', outcome: state.open.outs[0].id, amount: -50 }, api);
  sports.onAction(state, cast[0], { type: 'back', outcome: state.open.outs[0].id, amount: 1e9 }, api);
  sports.onAction(state, cast[0], { type: 'nonsense' }, api);
  check('nonsense moves nothing', totalChips(cast) === before, `${before} then ${totalChips(cast)}`);

  const other = cast.find((p) => p.id !== state.hostId);
  sports.onAction(state, other, { type: 'match', id: 'x', name: 'Hijacked' }, api);
  check('only the host says which match', state.matchName !== 'Hijacked', state.matchName);
  check('no CPU playing for chips', sports.botAction() === null);

  // Nobody's bets are secret here, but the wire must still never carry a
  // player's balance to somebody else.
  const wire = JSON.stringify(sports.serialize(state));
  check('the public state carries no wallets', !wire.includes('"chips":4'), wire.slice(0, 60));
}

rmSync(TMP, { recursive: true, force: true });

const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.log('\n  \x1b[31mwhat failed:\x1b[0m');
  for (const r of bad) console.log(`  \x1b[31m  · ${r.label}\x1b[0m`);
}
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — asked early, locked before it happens, settled off the feed\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
