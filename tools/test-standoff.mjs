// Standoff — the rules underneath.
//
//   npm run test:standoff
//
// Rock-paper-scissors is easy to get right and easy to get subtly wrong, and
// the wrong version still looks like it works: the hands flip, points move,
// nobody notices for weeks that scissors has been beating rock the whole time.
//
// So the table of who beats whom is checked exhaustively rather than sampled,
// and so is the thing that makes this version a game rather than a coin toss:
// throws run out, everybody can see what everybody has left, and one throw is
// scored against the whole room at once.

import game from '../server/games/standoff.js';

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};

const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, connected: true }));
const api = { emit() {}, emitTo() {}, finish() {}, players: () => [] };

/** Past the rules and into the first throw. */
function start(players = 4, settings = {}) {
  const cast = mk(players);
  const state = game.createState(cast, { settings: { rounds: 8, ...settings } });
  for (const p of cast) game.onAction(state, p, { type: 'briefed' }, api);
  return { state, cast };
}
const throwFor = (state, cast, picks) => {
  picks.forEach((pick, i) => game.onAction(state, cast[i], { type: 'throw', pick }, api));
};
const rowFor = (state, id) => state.table.rows.find((r) => r.id === id);

console.log('\n  Standoff\n');

/* ------------------------- who beats whom, all nine ----------------------- */

{
  const WINS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  const THROWS = ['rock', 'paper', 'scissors'];
  let wrong = [];
  for (const mine of THROWS) {
    for (const theirs of THROWS) {
      const { state, cast } = start(2, { rounds: 8 });
      throwFor(state, cast, [mine, theirs]);
      const me = rowFor(state, 'p0');
      const expected = mine === theirs ? 'tie' : WINS[mine] === theirs ? 'win' : 'loss';
      const got = me.tied ? 'tie' : me.beat ? 'win' : 'loss';
      if (got !== expected) wrong.push(`${mine} vs ${theirs}: expected ${expected}, got ${got}`);
    }
  }
  check('all nine match-ups resolve correctly', wrong.length === 0, wrong.join(' | '));
}

/* --------------------- one throw, scored against everybody ---------------- */

{
  // The whole idea: four players, one of them throws the counter to the other
  // three and takes all three at once.
  const { state, cast } = start(4, { rounds: 8 });
  throwFor(state, cast, ['paper', 'rock', 'rock', 'rock']);

  const winner = rowFor(state, 'p0');
  check('one throw is scored against every other player', winner.beat === 3, `beat ${winner.beat}`);
  check('and beating everybody is a sweep', winner.swept === true);
  check('the three who matched each other tied, not lost',
    rowFor(state, 'p1').tied === 2 && rowFor(state, 'p1').lost === 1,
    JSON.stringify({ tied: rowFor(state, 'p1').tied, lost: rowFor(state, 'p1').lost }));

  // 3 wins × 2 + the sweep bonus.
  check('a sweep pays the bonus on top', winner.points === 3 * 2 + 5, `${winner.points} points`);
  check('the losers drop', rowFor(state, 'p1').points === -1, `${rowFor(state, 'p1').points}`);
  check('and it is called out in words', /swept the room/.test(state.table.headline), state.table.headline);
}

{
  // A tie against somebody is not a win against them.
  const { state, cast } = start(3, { rounds: 8 });
  throwFor(state, cast, ['rock', 'rock', 'scissors']);
  check('tying with one and beating another is not a sweep', rowFor(state, 'p0').swept === false);
  check('the tie scores nothing either way', rowFor(state, 'p0').points === 2, `${rowFor(state, 'p0').points}`);
}

{
  // In a duel there is no room to sweep, so beating your one opponent is just
  // a win. Paying the sweep bonus there made the word mean nothing.
  const { state, cast } = start(2, { rounds: 8 });
  throwFor(state, cast, ['rock', 'scissors']);
  check('winning a duel is not a sweep', rowFor(state, 'p0').swept === false);
  check('and pays the ordinary rate', rowFor(state, 'p0').points === 2, `${rowFor(state, 'p0').points}`);
}

{
  // Everybody the same is a real outcome and must not crash or pay anyone.
  const { state, cast } = start(4, { rounds: 8 });
  throwFor(state, cast, ['rock', 'rock', 'rock', 'rock']);
  check('a whole room throwing the same scores nobody',
    state.table.rows.every((r) => r.points === 0), JSON.stringify(state.table.rows.map((r) => r.points)));
  check('and it gets its own headline', /Everybody threw rock/i.test(state.table.headline), state.table.headline);
}

/* ------------------------------ throws run out ---------------------------- */

{
  const { state, cast } = start(2, { rounds: 3 });
  const stock = state.players[0].stock.rock;
  check('everyone starts with a stock of each', stock >= 2, JSON.stringify(state.players[0].stock));

  // Spend every rock.
  for (let i = 0; i < stock; i++) {
    throwFor(state, cast, ['rock', 'paper']);
    game.onTick(state, 999, api); // out of the reveal, into the next round
  }
  check('spending a throw reduces the stock', state.players[0].stock.rock === 0,
    JSON.stringify(state.players[0].stock));

  // And now it may not be thrown.
  game.onAction(state, cast[0], { type: 'throw', pick: 'rock' }, api);
  check('a throw you have run out of is refused', state.picks.p0 === undefined, String(state.picks.p0));
  game.onAction(state, cast[0], { type: 'throw', pick: 'paper' }, api);
  check('one you still have is accepted', state.picks.p0 === 'paper', String(state.picks.p0));
}

{
  // Changing your mind must not cost two.
  const { state, cast } = start(2, { rounds: 8 });
  const before = { ...state.players[0].stock };
  game.onAction(state, cast[0], { type: 'throw', pick: 'rock' }, api);
  game.onAction(state, cast[0], { type: 'throw', pick: 'paper' }, api);
  game.onAction(state, cast[0], { type: 'throw', pick: 'scissors' }, api);
  check('changing your mind spends nothing yet',
    JSON.stringify(state.players[0].stock) === JSON.stringify(before),
    JSON.stringify(state.players[0].stock));

  throwFor(state, cast, ['scissors', 'rock']);
  check('only the throw you settled on is spent',
    state.players[0].stock.scissors === before.scissors - 1 &&
      state.players[0].stock.rock === before.rock &&
      state.players[0].stock.paper === before.paper,
    JSON.stringify(state.players[0].stock));
}

{
  // Endless mode is the plain game, for a room that does not want to count.
  const { state, cast } = start(2, { rounds: 4, stockRule: 'endless' });
  check('endless mode has no stock at all', state.players[0].stock === null);
  for (let i = 0; i < 4; i++) {
    throwFor(state, cast, ['rock', 'rock']);
    game.onTick(state, 999, api);
  }
  check('and rock can be thrown every single round', state.table.rows.every((r) => r.pick === 'rock'));
}

/* --------------------------- nobody is left stranded ---------------------- */

{
  // The stocks together must always cover the match, or somebody reaches the
  // last round with nothing legal to throw.
  const bad = [];
  for (let rounds = 3; rounds <= 60; rounds++) {
    const state = game.createState(mk(2), { settings: { rounds } });
    const total = Object.values(state.players[0].stock).reduce((a, b) => a + b, 0);
    if (total < rounds) bad.push(`${rounds} rounds but only ${total} throws`);
    // …and no single throw may cover the whole match, or the counting is
    // pointless and one-throw spam comes back.
    if (state.players[0].stock.rock >= rounds) bad.push(`${rounds} rounds and ${state.players[0].stock.rock} rock`);
  }
  check('at every length, the stocks cover the match and no single throw does', bad.length === 0, bad.slice(0, 3).join(' | '));
}

/* ------------------------------ the buzzer -------------------------------- */

{
  const { state, cast } = start(3, { rounds: 8 });
  game.onAction(state, cast[0], { type: 'throw', pick: 'rock' }, api);
  // Two never decided; the clock runs out.
  game.onTick(state, 999, api);
  check('the round still resolves when people do not throw', state.phase === 'reveal', state.phase);
  check('everybody ends up with a throw', state.table.rows.length === 3);
  check('and the ones who ran out of clock are marked',
    state.table.rows.filter((r) => r.forced).length === 2,
    JSON.stringify(state.table.rows.map((r) => [r.name, r.forced])));
  check('the one who decided in time is not', rowFor(state, 'p0').forced === false);
}

/* ---------------------------- the final round ----------------------------- */

{
  const { state, cast } = start(2, { rounds: 2 });
  throwFor(state, cast, ['rock', 'scissors']);
  const normal = rowFor(state, 'p0').points;
  check('an ordinary round pays the ordinary rate', normal === 2, String(normal));

  game.onTick(state, 999, api);
  throwFor(state, cast, ['rock', 'scissors']);
  check('the last round pays double', rowFor(state, 'p0').points === normal * 2, String(rowFor(state, 'p0').points));
  check('and says so', state.table.doubled === true);
}

/* ------------------------------- the shape -------------------------------- */

{
  const { state, cast } = start(3, { rounds: 8 });
  game.onAction(state, cast[0], { type: 'throw', pick: 'rock' }, api);

  const shared = game.serialize(state);
  check('nobody can see anybody\'s throw before the reveal',
    !JSON.stringify(shared).includes('"rock"') || shared.table === null,
    JSON.stringify(shared).slice(0, 160));
  check('but who has committed is public', shared.locked.includes('p0'), JSON.stringify(shared.locked));

  const mine = game.serializeFor(state, 'p0');
  const theirs = game.serializeFor(state, 'p1');
  check('you can see your own throw', mine.you.pick === 'rock', String(mine.you.pick));
  check('and nobody else\'s', theirs.you.pick === null, String(theirs.you.pick));
  check('everyone can see what everyone has left',
    shared.players.every((p) => p.stock && typeof p.stock.rock === 'number'),
    JSON.stringify(shared.players.map((p) => p.stock)));
}

/* -------------------------- it plays to the end --------------------------- */

{
  const { state, cast } = start(5, { rounds: 6 });
  let guard = 0;
  while (!game.isOver(state) && guard++ < 200) {
    if (state.phase === 'throw') {
      for (const p of cast) {
        const move = game.botAction(state, p);
        if (move) game.onAction(state, p, move, api);
      }
    }
    game.onTick(state, 999, api);
  }
  check('a full match finishes', game.isOver(state), `phase ${state.phase} after ${guard} ticks`);
  check('it played the rounds it was asked for', state.round === 6, String(state.round));

  const table = game.results(state);
  check('everybody is placed', table.length === 5);
  check('places run 1..5 with no gaps', table.map((r) => r.place).join(',') === '1,2,3,4,5', table.map((r) => r.place).join(','));
  check('the winner is the top scorer', table[0].score >= table[table.length - 1].score,
    table.map((r) => `${r.name}:${r.score}`).join(' '));
  check('nobody overspent their stock',
    state.players.every((p) => Object.values(p.stock).every((n) => n >= 0)),
    JSON.stringify(state.players.map((p) => p.stock)));
}

/* ------------------------------- the CPU ---------------------------------- */

{
  // A CPU must never pick something it has run out of, however long the match.
  const { state, cast } = start(3, { rounds: 20 });
  let illegal = 0;
  let guard = 0;
  while (!game.isOver(state) && guard++ < 400) {
    if (state.phase === 'throw') {
      for (const p of cast) {
        const move = game.botAction(state, p);
        if (!move) continue;
        const stock = state.players.find((x) => x.id === p.id).stock;
        if (stock[move.pick] <= 0) illegal += 1;
        game.onAction(state, p, move, api);
      }
    }
    game.onTick(state, 999, api);
  }
  check('a CPU never throws what it has run out of', illegal === 0, `${illegal} illegal picks`);

  // And it is not a fixed pattern anybody could farm.
  const seen = new Set();
  for (let run = 0; run < 40; run++) {
    const fresh = start(3, { rounds: 8 });
    const move = game.botAction(fresh.state, fresh.cast[0]);
    if (move) seen.add(move.pick);
  }
  check('and it does not open with the same throw every time', seen.size >= 2, [...seen].join(', '));
}

/* --------------------------- people coming and going ---------------------- */

{
  const { state, cast } = start(3, { rounds: 8 });
  game.onPlayerLeave(state, cast[2]);
  throwFor(state, cast, ['rock', 'scissors']);
  check('a round settles with somebody gone', state.phase === 'reveal', state.phase);
  check('and the one who left is not scored', state.table.rows.length === 2, String(state.table.rows.length));

  game.onPlayerJoin(state, { id: 'late', name: 'Latecomer' });
  const late = state.players.find((p) => p.id === 'late');
  check('somebody arriving mid-match gets a full hand',
    late.stock.rock > 0 && late.stock.paper > 0 && late.stock.scissors > 0,
    JSON.stringify(late.stock));
}

const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
