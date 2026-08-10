// Crossword Clash — the rules underneath.
//
//   npm run test:crossword
//
// The grid builder is tested separately. This is about what happens when
// several sides race the same puzzle: that a team really does share one board,
// that a wrong answer costs time and not the rest of the grid, that a side can
// never read another side's letters, and that the room can never be left
// staring at a clue nobody can get.

import game from '../server/games/crossword.js';

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};

const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, connected: true }));
const api = { emit() {}, emitTo() {}, finish() {}, players: () => [] };

/** Past the rules and into play. */
function start(players = 4, settings = {}) {
  const cast = mk(players);
  const state = game.createState(cast, { settings: { teamSize: 2, wordCount: 10, minutes: 8, ...settings } });
  for (const p of cast) game.onAction(state, p, { type: 'briefed' }, api);
  return { state, cast };
}
const answerOf = (state, i = 0) => state.puzzle.entries[i];
const guess = (state, player, entry, text) =>
  game.onAction(state, player, { type: 'guess', clueId: entry.id, text }, api);

console.log('\n  Crossword Clash\n');

/* ------------------------------- the sides -------------------------------- */

{
  const { state } = start(4, { teamSize: 2 });
  check('four players at 2 a side makes two teams', state.sides.length === 2, String(state.sides.length));
  check('and splits them evenly',
    state.players.filter((p) => p.side === 0).length === 2 && state.players.filter((p) => p.side === 1).length === 2,
    JSON.stringify(state.players.map((p) => p.side)));

  const solo = start(8, { teamSize: 1 }).state;
  check('eight players at 1 a side is eight sides', solo.sides.length === 8, String(solo.sides.length));
  check('and each side is named after the player', solo.sides[0].name === 'Player0', solo.sides[0].name);

  const big = start(16, { teamSize: 4 }).state;
  check('sixteen players at 4 a side is four teams', big.sides.length === 4, String(big.sides.length));
  check('teams are named as teams', /team/.test(big.sides[0].name), big.sides[0].name);

  const odd = start(5, { teamSize: 2 }).state;
  check('an odd room still gives everybody a side',
    odd.players.every((p) => odd.sides[p.side]), JSON.stringify(odd.players.map((p) => p.side)));
}

/* ------------------------- a team shares one board ------------------------ */

{
  const { state, cast } = start(4, { teamSize: 2 });
  const word = answerOf(state);
  guess(state, cast[0], word, word.answer);

  const mine = game.serializeFor(state, 'p0');
  const partner = game.serializeFor(state, 'p1');
  const rival = game.serializeFor(state, 'p2');

  check('solving it fills it in for you', Object.keys(mine.you.letters).length === word.length,
    JSON.stringify(mine.you.letters));
  check('and for your teammate, who did not type it',
    JSON.stringify(partner.you.letters) === JSON.stringify(mine.you.letters));
  check('the other side gets nothing', Object.keys(rival.you.letters).length === 0,
    JSON.stringify(rival.you.letters));
  check('the teammate sees who got it', partner.you.solved[word.id]?.byName === 'Player0',
    String(partner.you.solved[word.id]?.byName));
  check('the score goes to the team', state.sides[0].score > 0 && state.sides[1].score === 0,
    `${state.sides[0].score} / ${state.sides[1].score}`);
}

/* ------------------------- wrong costs time, not points ------------------- */

{
  const { state, cast } = start(4, { teamSize: 2 });
  const word = answerOf(state);
  const before = state.sides[0].score;

  guess(state, cast[0], word, 'DEFINITELYNOT');
  check('a wrong answer takes no points', state.sides[0].score === before, String(state.sides[0].score));
  check('it locks that clue', (game.serializeFor(state, 'p0').you.locked[word.id] ?? 0) > 0,
    JSON.stringify(game.serializeFor(state, 'p0').you.locked));
  check('the lock is on the team, not the person',
    (game.serializeFor(state, 'p1').you.locked[word.id] ?? 0) > 0);
  check('the other side is not locked',
    (game.serializeFor(state, 'p2').you.locked[word.id] ?? 0) === 0);

  // Right answer during a lockout does nothing — that is the penalty.
  guess(state, cast[0], word, word.answer);
  check('even the right answer will not go in while locked', !state.sides[0].solved[word.id]);

  // The rest of the grid is still open, which is the point of a lockout
  // rather than a points fine.
  const other = answerOf(state, 1);
  guess(state, cast[0], other, other.answer);
  check('but the rest of the grid stays open', Boolean(state.sides[0].solved[other.id]));

  // Escalating.
  const fresh = start(2, { teamSize: 1 });
  const w = answerOf(fresh.state);
  guess(fresh.state, fresh.cast[0], w, 'NOPE');
  const first = fresh.state.sides[0].lockedUntil[w.id];
  fresh.state.sides[0].lockedUntil[w.id] = 0; // let the clock run out
  guess(fresh.state, fresh.cast[0], w, 'NOPEAGAIN');
  const second = fresh.state.sides[0].lockedUntil[w.id];
  check('and each wrong answer locks it for longer', second - Date.now() > first - Date.now(),
    `${Math.round((first - Date.now()) / 1000)}s then ${Math.round((second - Date.now()) / 1000)}s`);
}

/* ----------------------------- close enough ------------------------------- */

{
  const { state, cast } = start(2, { teamSize: 1 });
  const word = answerOf(state);
  guess(state, cast[0], word, `  ${word.answer.toLowerCase()} `);
  check('case and spaces are forgiven', Boolean(state.sides[0].solved[word.id]));

  const other = start(2, { teamSize: 1 });
  const w2 = answerOf(other.state);
  guess(other.state, other.cast[0], w2, `${w2.answer}X`);
  check('a real misspelling is not', !other.state.sides[0].solved[w2.id]);
}

/* --------------------------- racing for a word ---------------------------- */

{
  const { state, cast } = start(4, { teamSize: 2 });
  const word = answerOf(state);

  guess(state, cast[0], word, word.answer);
  const firstScore = state.sides[0].score;
  guess(state, cast[2], word, word.answer);
  const secondScore = state.sides[1].score;

  check('the side that got there first scores more', firstScore > secondScore,
    `${firstScore} then ${secondScore}`);
  check('but the second side still gets it', Boolean(state.sides[1].solved[word.id]));
  check('and both boards now show it',
    Object.keys(game.serializeFor(state, 'p2').you.letters).length === word.length);
}

/* ------------------------ nothing is allowed to stall --------------------- */

{
  const { state, cast } = start(2, { teamSize: 1 });
  check('nothing is shown while the room is solving', state.flash === null);

  // The room goes quiet.
  state.lastSolveAt = Date.now() - 60_000;
  game.onTick(state, 1, api);
  check('going quiet gets a word shown to everybody', Boolean(state.flash), JSON.stringify(state.flash));
  check('and the answer is in it, on purpose', Boolean(state.flash?.answer), String(state.flash?.answer));

  const shown = state.puzzle.entries.find((e) => e.id === state.flash.clueId);
  check('it is a word nobody had', !state.sides.some((s) => s.solved[shown.id]));

  // Typing it takes it, for less.
  const normal = 10 + shown.length * 2;
  guess(state, cast[0], shown, shown.answer);
  check('typing it first takes it', Boolean(state.sides[0].solved[shown.id]));
  check('for less than solving it cold', state.sides[0].solved[shown.id].points < normal,
    `${state.sides[0].solved[shown.id].points} against ${normal}`);
  check('and the race is over the moment somebody has it', state.flash === null);
  check('it is marked as one that was given', state.sides[0].solved[shown.id].flashed === true);
}

{
  // Nobody types it. It fills in for everybody, for nothing, so the crossings
  // keep helping rather than leaving a hole the room has given up on.
  const { state } = start(4, { teamSize: 2 });
  state.lastSolveAt = Date.now() - 60_000;
  game.onTick(state, 1, api);
  const clueId = state.flash.clueId;
  state.flash.until = Date.now() - 1;
  game.onTick(state, 1, api);

  check('a word nobody typed is filled in for everyone',
    state.sides.every((s) => Boolean(s.solved[clueId])),
    JSON.stringify(state.sides.map((s) => Boolean(s.solved[clueId]))));
  check('and is worth nothing to anybody',
    state.sides.every((s) => s.solved[clueId].points === 0));
  check('the room is told what it was', /was/.test(state.log.join(' ')), state.log.slice(-1)[0]);
}

/* --------------------------- the answers stay here ------------------------ */

{
  const { state } = start(4, { teamSize: 2 });
  const wire = JSON.stringify(game.serialize(state));
  const leaked = state.puzzle.entries.filter((e) => wire.includes(e.answer));
  check('the shared view carries no answers', leaked.length === 0, leaked.map((e) => e.answer).join(', '));

  const mine = JSON.stringify(game.serializeFor(state, 'p0'));
  const leakedToMe = state.puzzle.entries.filter((e) => mine.includes(e.answer));
  check('and neither does a player view, before they have solved anything',
    leakedToMe.length === 0, leakedToMe.map((e) => e.answer).join(', '));

  // The grid the browser is sent has no letters at all.
  check('the board itself is blank',
    !game.serialize(state).board.cells.flat().some((c) => c && 'letter' in c));
  check('but it does carry the clues',
    game.serialize(state).board.clues.length === state.puzzle.entries.length);
}

/* ------------------------------ how it ends ------------------------------- */

{
  const { state, cast } = start(2, { teamSize: 1 });
  for (const entry of state.puzzle.entries) {
    guess(state, cast[0], entry, entry.answer);
    guess(state, cast[1], entry, entry.answer);
  }
  check('filling the grid ends it', game.isOver(state), state.phase);

  const table = game.results(state);
  check('everybody is placed', table.length === 2);
  check('places run 1 and 2', table.map((r) => r.place).join(',') === '1,2');
  check('the one who got there first is ahead', table[0].score >= table[1].score,
    table.map((r) => `${r.name}:${r.score}`).join(' '));
  check('and how many each person got is kept', table.every((r) => typeof r.solved === 'number'),
    JSON.stringify(table.map((r) => r.solved)));
}

{
  // Or the clock runs out.
  const { state } = start(4, { teamSize: 2, minutes: 2 });
  game.onTick(state, 200, api);
  check('the clock ending it also works', game.isOver(state), state.phase);
}

/* ----------------------------- people arriving ---------------------------- */

{
  const { state } = start(4, { teamSize: 2 });
  game.onPlayerLeave(state, { id: 'p3' });
  game.onPlayerJoin(state, { id: 'late', name: 'Latecomer' });
  const late = state.players.find((p) => p.id === 'late');
  check('a latecomer gets a side', typeof late.side === 'number' && Boolean(state.sides[late.side]),
    String(late.side));
  check('and it is the thinnest one', late.side === 1, `joined side ${late.side}`);
  check('their view works straight away', Boolean(game.serializeFor(state, 'late').you));
}

/* --------------------------- nonsense from a client ----------------------- */

{
  const { state, cast } = start(2, { teamSize: 1 });
  const before = JSON.stringify(state.sides);
  game.onAction(state, cast[0], { type: 'guess', clueId: 'nope', text: 'ANYTHING' }, api);
  game.onAction(state, cast[0], { type: 'guess' }, api);
  game.onAction(state, cast[0], { type: 'guess', clueId: answerOf(state).id, text: '' }, api);
  game.onAction(state, { id: 'ghost', name: 'Ghost' }, { type: 'guess', clueId: answerOf(state).id, text: answerOf(state).answer }, api);
  check('a clue that does not exist changes nothing', JSON.stringify(state.sides) === before);
  check('and somebody not in the match cannot play', JSON.stringify(state.sides) === before);
}

const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
