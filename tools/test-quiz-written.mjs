// Quiz, when the questions come from the players.
//
//   npm run test:quiz-written
//
// Two things are being proved. First that a question typed by a player is
// rebuilt on the server rather than trusted — a client that could name its own
// correct answer could hand itself the round. Second that the rotation is
// genuinely unguessable: everybody writes once per pass, but nobody can work
// out from the first name who the last one will be.

import game from '../server/games/quiz.js';

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};

const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, connected: true }));
const api = { emit() {}, emitTo() {}, finish() {}, players: () => [] };

/** Past the rules and into the first writing turn. */
function start(players = 4, settings = {}) {
  const cast = mk(players);
  const state = game.createState(cast, { settings: { source: 'written', rounds: 6, ...settings } });
  for (const p of cast) game.onAction(state, p, { type: 'ready' }, api);
  game.onTick(state, 999, api);
  return { state, cast };
}
const who = (state, id) => ({ id, name: state.players.find((p) => p.id === id)?.name ?? 'x' });

console.log('\n  Quiz — questions from the players\n');

/* ------------------------------ writing one ------------------------------- */

{
  const { state } = start(4, { optionCount: 4, correctCount: 1 });
  check('the round opens with somebody writing', state.phase === 'write');
  check('and it says who', Boolean(state.authorId));
  check('the form is told what it may build', game.serialize(state).compose?.options === 4);

  const author = state.authorId;
  const other = state.players.find((p) => p.id !== author).id;

  // Nobody else may write the question, however much they would like to.
  game.onAction(state, who(state, other), { type: 'compose', text: 'Mine', options: ['a', 'b'], correct: [0] }, api);
  check('only the person whose turn it is may write', !state.roundData.authored);

  // Rubbish is refused rather than half-accepted.
  game.onAction(state, who(state, author), { type: 'compose', text: '', options: ['a', 'b'], correct: [0] }, api);
  check('a question with no text is refused', !state.roundData.authored);
  game.onAction(state, who(state, author), { type: 'compose', text: 'One option?', options: ['a'], correct: [0] }, api);
  check('a question with one option is refused', !state.roundData.authored);
  game.onAction(state, who(state, author), { type: 'compose', text: 'Same?', options: ['a', 'A'], correct: [0] }, api);
  check('two options that say the same thing are refused', !state.roundData.authored);
  game.onAction(state, who(state, author), { type: 'compose', text: 'No answer', options: ['a', 'b'], correct: [] }, api);
  check('a question with no right answer is refused', !state.roundData.authored);
  game.onAction(state, who(state, author), { type: 'compose', text: 'Out of range', options: ['a', 'b'], correct: [9] }, api);
  check('an answer that is not one of the options is refused', !state.roundData.authored);

  game.onAction(
    state,
    who(state, author),
    { type: 'compose', text: 'Capital of France?', options: ['Paris', 'Rome', 'Madrid', 'Berlin'], correct: [0] },
    api
  );
  check('a real question is accepted', state.roundData.authored === true, state.roundData.text);
  check('and credited to whoever wrote it', state.roundData.authorName?.includes('Player'));

  // The one thing a client must never get to decide.
  const view = game.serialize(state);
  check('the answer is not in the shared state', !JSON.stringify(view).includes('answerId'), 'no answer key leaked mid-write');

  // Everyone is waiting on one person, so the round moves the moment they send.
  game.onTick(state, 0.5, api);
  check('finishing the question starts the answering', state.phase === 'answer');
  check('the question reaches everybody', game.serialize(state).prompt.title === 'Capital of France?');
  check('and the options with it', game.serialize(state).prompt.options.length === 4);
}

/* ------------------------- more than one right answer --------------------- */

{
  const { state } = start(5, { optionCount: 4, correctCount: 2 });
  const author = state.authorId;
  game.onAction(
    state,
    who(state, author),
    { type: 'compose', text: 'Which are fruits?', options: ['Apple', 'Mango', 'Chair', 'Brick'], correct: [0, 1] },
    api
  );
  game.onTick(state, 0.5, api);

  const prompt = game.serialize(state).prompt;
  check('players are told how many to pick', prompt.pickCount === 2, `pick ${prompt.pickCount}`);
  check('but not which ones', !JSON.stringify(prompt).includes('answerIds'));

  const rest = state.players.filter((p) => p.id !== author);
  game.onAction(state, who(state, rest[0].id), { type: 'choice', optionIds: ['o0', 'o1'] }, api);
  game.onAction(state, who(state, rest[1].id), { type: 'choice', optionIds: ['o0'] }, api);
  game.onAction(state, who(state, rest[2].id), { type: 'choice', optionIds: ['o0', 'o1', 'o2', 'o3'] }, api);
  game.onAction(state, who(state, rest[3].id), { type: 'choice', optionIds: ['o2', 'o3'] }, api);

  const score = (p) => state.roundScores[p.id] ?? 0;
  check('getting both scores fully', score(rest[0]) > 0, `+${score(rest[0])}`);
  check('getting one of two scores something', score(rest[1]) > 0 && score(rest[1]) < score(rest[0]), `+${score(rest[1])}`);
  // The obvious exploit: tick everything and you have technically found them
  // all. Wrong ticks have to cancel right ones or the question is pointless.
  check('ticking everything scores nothing', score(rest[2]) === 0);
  check('and getting it wrong scores nothing', score(rest[3]) === 0);
  check('only a clean sweep counts as solved', state.solved.length === 1);

  // One shot, as ever.
  game.onAction(state, who(state, rest[1].id), { type: 'choice', optionIds: ['o0', 'o1'] }, api);
  check('you cannot answer twice', score(rest[1]) < score(rest[0]));

  game.onTick(state, 999, api);
  const reveal = game.serialize(state).reveal;
  check('the result marks every right answer', reveal.options.filter((o) => o.correct).length === 2);
  check('and says who wrote it', reveal.byline?.includes('Player'), reveal.byline);
}

/* -------------------------- the rotation is a bag ------------------------- */

{
  // Everyone writes once before anyone writes twice — that is the fair part.
  const { state, cast } = start(4, { rounds: 12 });
  const order = [];
  for (let i = 0; i < 12 && !state.over; i++) {
    order.push(state.authorId);
    game.onTick(state, 999, api); // write times out
    game.onTick(state, 999, api); // answer
    game.onTick(state, 999, api); // reveal
  }
  const passes = [order.slice(0, 4), order.slice(4, 8), order.slice(8, 12)];
  check(
    'everybody writes once before anybody writes twice',
    passes.every((pass) => new Set(pass).size === pass.length),
    passes.map((p) => p.join('')).join(' | ')
  );
  check('and everybody gets a turn', new Set(order).size === cast.length);
  // The one predictable moment a bag can produce is the seam between passes.
  check(
    'nobody writes two rounds running across the seam',
    order.every((id, i) => i === 0 || id !== order[i - 1]),
    order.join(' ')
  );
}

{
  // …and the order inside each pass is redrawn, or the whole point is lost:
  // with a fixed order, whoever writes first is known to write last-but-one.
  const orders = new Set();
  for (let run = 0; run < 40; run++) {
    const { state } = start(4, { rounds: 4 });
    const order = [];
    for (let i = 0; i < 4 && !state.over; i++) {
      order.push(state.authorId);
      game.onTick(state, 999, api);
      game.onTick(state, 999, api);
      game.onTick(state, 999, api);
    }
    orders.add(order.join(''));
  }
  check('the order is different every match', orders.size > 6, `${orders.size} different orders in 40 matches`);
}

/* ---------------------- nobody writes, nothing breaks --------------------- */

{
  const { state } = start(3, { rounds: 3 });
  let guard = 0;
  while (!state.over && guard++ < 60) game.onTick(state, 999, api);
  check('a match where nobody writes anything still finishes', state.over, `${guard} beats`);
}

/* ---------------------------- the ready-made mode ------------------------- */

{
  // The other half of the setting: the bank still works exactly as it did.
  const cast = mk(3);
  const state = game.createState(cast, { settings: { source: 'bank', rounds: 4, answerSeconds: 15 } });
  for (const p of cast) game.onAction(state, p, { type: 'ready' }, api);
  game.onTick(state, 999, api);
  check('ready-made questions skip the writing', state.phase === 'answer');
  check('and arrive with a question already on them', typeof state.roundData.text === 'string' && state.roundData.text.length > 3);
  check('the host\'s clock is used', state.roundData.seconds === 15, `${state.roundData.seconds}s`);

  const first = state.players[0];
  const right = state.roundData.answerId;
  game.onAction(state, who(state, first.id), { type: 'choice', optionId: right }, api);
  check('a single-answer question still scores the old way', (state.roundScores[first.id] ?? 0) > 0);
}

/* --------------------------------- report --------------------------------- */

const passed = results.filter((r) => r.ok).length;
console.log(`\n  ${passed}/${results.length} checks passed\n`);
for (const f of results.filter((r) => !r.ok)) console.log(`  \x1b[31m×\x1b[0m ${f.label}`);
process.exit(passed === results.length ? 0 : 1);
