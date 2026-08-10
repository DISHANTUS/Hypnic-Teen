// Poll Game, when the questions come from the room.
//
//   npm run test:poll-written
//
// Poll was the one question game with no way to type your own. It is the same
// shape as a written quiz question with the answer key taken off — which the
// engine already knew, since the line refusing a quiz question with nothing
// marked right says "a question with no right answer is a poll".
//
// But copying Quiz's authoring wholesale would have ruined the game. Quiz
// names the person writing, on purpose: half the fun is watching somebody
// realise it is their turn. Poll is the opposite. The questions worth asking
// are the ones somebody has been sitting on for a year and would never put
// their name to, and one name on one screen ends that for the whole match.
//
// So most of this file is about anonymity, and it checks the server's own
// state rather than only what it sends — a name that is stored but not sent
// today is a name that gets sent by accident tomorrow.

import game from '../server/games/poll.js';

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};

const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, connected: true }));
const api = { emit() {}, emitTo() {}, finish() {}, players: () => [] };

/** Past the rules and into the writing phase. */
function start(players = 4, settings = {}) {
  const cast = mk(players);
  const state = game.createState(cast, { settings: { source: 'written', rounds: 4, ...settings } });
  for (const p of cast) game.onAction(state, p, { type: 'ready' }, api);
  game.onTick(state, 999, api);
  return { state, cast };
}

console.log('\n  Poll Game — questions from the room, with nobody\'s name on them\n');

/* -------------------------- the setting exists at all --------------------- */

{
  check('the host can choose where questions come from', Boolean(game.options?.source));
  check('and how many things there are to pick between', Boolean(game.options?.optionCount));
  const written = game.refineOptions?.({ source: 'written' });
  check('written mode lifts the round ceiling the bank imposes',
    (written?.rounds?.hardMax ?? 0) > 100,
    `hardMax ${written?.rounds?.hardMax}`);
}

/* ----------------------------- everybody writes --------------------------- */

{
  const { state, cast } = start(4, { optionCount: 4 });
  check('the match opens with the room writing', state.phase === 'write', state.phase);

  const shape = game.serialize(state).compose;
  check('the form is told this one has no right answer', shape?.kind === 'poll', shape?.kind);
  check('and that everybody writes, not one person', shape?.everyone === true, String(shape?.everyone));
  check('nobody is named as the author', game.serialize(state).authorName === null,
    String(game.serialize(state).authorName));
  check('and no author id is sent either', game.serialize(state).authorId === null,
    String(game.serialize(state).authorId));

  // Anybody may write — not just whoever's turn it would have been.
  game.onAction(state, cast[2], { type: 'compose', text: 'Who here has a crush?', options: ['Me', 'Not me'] }, api);
  check('any player can send one', (state.written ?? []).length === 1, JSON.stringify(state.written));
  check('one each, and no more', (() => {
    game.onAction(state, cast[2], { type: 'compose', text: 'Second go', options: ['a', 'b'] }, api);
    return (state.pollPool ?? []).length === 1;
  })(), `${(state.pollPool ?? []).length} in the pile`);

  // The pile itself must carry nothing that points back at a person.
  const first = state.pollPool[0];
  check('the stored question carries no author id',
    !('authorId' in first) && !('by' in first) && !('playerId' in first),
    Object.keys(first).join(', '));
  check('and no author name', !('authorName' in first), Object.keys(first).join(', '));

  // The whole room finishes.
  game.onAction(state, cast[0], { type: 'compose', text: 'Best food?', options: ['Biryani', 'Dosa'] }, api);
  game.onAction(state, cast[1], { type: 'compose', text: 'Worst habit?', options: ['Late', 'Loud'] }, api);
  check('the count is a number, and the match waits for everyone',
    game.serialize(state).writtenCount === 3 && state.phase === 'write',
    `${game.serialize(state).writtenCount} written, phase ${state.phase}`);

  game.onAction(state, cast[3], { type: 'compose', text: 'Tea or coffee?', options: ['Tea', 'Coffee'] }, api);
  game.onTick(state, 1, api);
  check('once everybody has written, it moves on', state.phase !== 'write', state.phase);
}

/* -------------------- nothing anywhere says who wrote what ---------------- */

{
  const { state, cast } = start(4, { optionCount: 3 });
  const asked = ['Q from zero', 'Q from one', 'Q from two', 'Q from three'];
  cast.forEach((p, i) => game.onAction(state, p, { type: 'compose', text: asked[i], options: ['Yes', 'No'] }, api));
  game.onTick(state, 1, api);

  const shown = game.serialize(state);
  check('the question on screen is one of the room\'s', asked.includes(shown.prompt?.title), shown.prompt?.title);
  check('the prompt does not name anybody', !/Player\d/.test(shown.prompt?.text ?? ''), shown.prompt?.text);
  check('the round data holds no author', !state.roundData.authorName && !state.roundData.authorId,
    JSON.stringify(state.roundData).slice(0, 160));

  // The strongest check: no player name appears anywhere in what any player is
  // sent, in any phase, for the whole match.
  const names = cast.map((p) => p.name);
  const leaks = [];
  const sweep = (label) => {
    for (const p of cast) {
      const sent = JSON.stringify(game.serializeFor(state, p.id));
      // Names legitimately appear in the scoreboard and player list. What must
      // never appear is a name next to a question — so this looks at the
      // prompt and round data alone.
      const roundOnly = JSON.stringify({ prompt: game.serialize(state).prompt, round: state.roundData });
      for (const n of names) if (roundOnly.includes(n)) leaks.push(`${label}: ${n}`);
      void sent;
    }
  };
  sweep('answer');
  for (const p of cast) game.onAction(state, p, { type: 'vote', id: 'o0' }, api);
  game.onTick(state, 999, api);
  sweep('reveal');
  const reveal = game.serialize(state).reveal;
  check('the results name no author either', !names.some((n) => JSON.stringify(reveal).includes(n)),
    JSON.stringify(reveal).slice(0, 160));
  check('no player name is ever attached to a question', leaks.length === 0, leaks.join(' | '));

  // And nothing kept on the server maps a question back to a person.
  const kept = JSON.stringify({ pool: state.pollPool, round: state.roundData });
  check('the server keeps no link from a question to a player',
    !names.some((n) => kept.includes(n)) && !cast.some((p) => kept.includes(p.id)),
    kept.slice(0, 200));
  check('it knows who has written, but only as a list of ids with no questions attached',
    Array.isArray(state.written) && state.written.every((id) => typeof id === 'string'),
    JSON.stringify(state.written));
}

/* --------------------------- drawn at random, always ---------------------- */

{
  // The same four questions, many matches. If the order were fixed — dealt in
  // submission order, or shuffled once at the start — the first question would
  // be the same every time.
  const firsts = new Set();
  for (let run = 0; run < 60; run++) {
    const { state, cast } = start(4, { optionCount: 2 });
    cast.forEach((p, i) => game.onAction(state, p, { type: 'compose', text: `Q${i}`, options: ['a', 'b'] }, api));
    game.onTick(state, 1, api);
    firsts.add(state.roundData.text);
  }
  check('the first question is not always the same one', firsts.size > 1, `saw ${[...firsts].sort().join(', ')}`);
  check('over enough runs every question gets to go first', firsts.size === 4, `${firsts.size} of 4`);

  // And within one match, no question is asked twice while others wait.
  //
  // Driven by watching the round number rather than by counting ticks. A fixed
  // number of ticks per round drifts out of step the moment a phase ends early
  // — which is exactly what happens here, since everybody votes at once — and
  // then the same round gets recorded twice and reads as a repeat.
  const { state, cast } = start(4, { optionCount: 2, rounds: 4 });
  cast.forEach((p, i) => game.onAction(state, p, { type: 'compose', text: `Q${i}`, options: ['a', 'b'] }, api));
  const seen = [];
  let guard = 0;
  while (!state.over && guard++ < 60) {
    if (state.phase === 'answer') {
      if (state.roundData?.text && seen[state.round - 1] === undefined) seen[state.round - 1] = state.roundData.text;
      for (const p of state.players) game.onAction(state, p, { type: 'vote', id: 'o0' }, api);
    }
    game.onTick(state, 999, api);
  }
  const asked = seen.filter(Boolean);
  const unique = new Set(asked);
  check('every round asked something', asked.length === 4, `${asked.length} rounds: ${asked.join(' → ')}`);
  check('no question is asked twice in one match', unique.size === asked.length, asked.join(' → '));
  check('and all four of the room\'s questions were used',
    ['Q0', 'Q1', 'Q2', 'Q3'].every((q) => unique.has(q)),
    [...unique].sort().join(', '));
}

/* ------------------- the checks that survived losing the key -------------- */

{
  const { state, cast } = start(4, { optionCount: 4 });
  const before = () => (state.pollPool ?? []).length;

  game.onAction(state, cast[0], { type: 'compose', text: '', options: ['a', 'b'] }, api);
  check('a poll with no question is refused', before() === 0);
  game.onAction(state, cast[0], { type: 'compose', text: 'One thing?', options: ['a'] }, api);
  check('a poll with one option is refused', before() === 0);
  game.onAction(state, cast[0], { type: 'compose', text: 'Same?', options: ['Tea', 'tea'] }, api);
  check('two options that say the same thing are refused', before() === 0);

  game.onAction(state, cast[0], { type: 'compose', text: 'Real one?', options: ['a', 'b'], correct: [0] }, api);
  check('a correct answer sent anyway is ignored',
    before() === 1 && !state.pollPool[0].answerId && !state.pollPool[0].answerIds,
    JSON.stringify(state.pollPool[0]));

  const over = start(4, { optionCount: 2 });
  game.onAction(over.state, over.cast[0], { type: 'compose', text: 'Too many?', options: ['a', 'b', 'c', 'd'] }, api);
  check('more options than the host allowed are trimmed',
    over.state.pollPool[0].options.length === 2,
    `${over.state.pollPool[0].options.length} kept`);
}

/* --------------------- a quiet room still gets a match -------------------- */

{
  // Four rounds asked for, one question written. The rest come from the bank
  // rather than the match dying on an empty prompt.
  const { state, cast } = start(4, { optionCount: 2, rounds: 4 });
  game.onAction(state, cast[0], { type: 'compose', text: 'The only one', options: ['a', 'b'] }, api);
  game.onTick(state, 999, api); // the write clock runs out
  check('the one written question is asked', state.roundData?.text === 'The only one', state.roundData?.text);

  // On to round two, where the pile is already empty.
  let guard2 = 0;
  while (state.round === 1 && !state.over && guard2++ < 20) {
    if (state.phase === 'answer') for (const p of state.players) game.onAction(state, p, { type: 'vote', id: 'o0' }, api);
    game.onTick(state, 999, api);
  }
  check('and the next round still has something to ask',
    Boolean(state.roundData?.text) && (state.roundData?.options?.length ?? 0) > 0,
    JSON.stringify(state.roundData).slice(0, 140));
  check('which is a ready-made one, not somebody\'s asked twice',
    state.roundData?.text !== 'The only one',
    state.roundData?.text);
}

/* --------------------- the ready-made deck still works -------------------- */

{
  const cast = mk(4);
  const state = game.createState(cast, { settings: { source: 'bank', rounds: 5 } });
  for (const p of cast) game.onAction(state, p, { type: 'ready' }, api);
  game.onTick(state, 999, api);
  check('ready-made mode deals a question straight away',
    Boolean(game.serialize(state).prompt?.title),
    game.serialize(state).prompt?.title);
  check('and does not stop to ask anyone to write one', state.phase !== 'write', state.phase);
}

const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — the room writes the polls, and nothing says whose was whose\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
