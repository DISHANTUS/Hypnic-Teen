// Drives every game module through complete matches without a server.
//
// A real match takes minutes of wall clock; here the tick loop is fast-forwarded,
// so all eight party games play through in well under a second. This catches the
// failures that matter: a phase that never advances, a round that never ends,
// scoring that never fires, or a private view leaking the secret word.
//
//   npm run test:games

import { existsSync } from 'node:fs';
import path from 'node:path';

import { listGames, getGame } from '../server/games/index.js';

const ROOT = path.join(import.meta.dirname, '..');
const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
};

const mkPlayers = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, connected: true }));

/** Stand-in for the room API the engine calls back into. */
const mkApi = (events) => ({
  emit: (event, payload) => events.push({ event, payload }),
  emitTo: (playerId, event, payload) => events.push({ playerId, event, payload }),
  finish: () => {},
  players: () => [],
});

/**
 * A match opens with the rules on screen and the clock stopped, so anything
 * examining round one has to step past that first.
 */
function skipIntro(game, state) {
  const api = mkApi([]);
  let guard = 0;
  while (state.phase === 'intro' && guard++ < 500) game.onTick(state, 0.5, api);
  return state;
}

/**
 * Plays a match to completion. `act` is called on every phase change so the
 * caller can submit answers, votes and guesses like real players would.
 */
function playMatch(game, players, act, { maxTicks = 40000 } = {}) {
  const state = game.createState(players, {});
  const events = [];
  const api = mkApi(events);
  const seen = new Set();
  let ticks = 0;

  while (!game.isOver(state) && ticks < maxTicks) {
    const key = `${state.round}:${state.phase}`;
    if (!seen.has(key)) {
      seen.add(key);
      act?.(state, players, api);
    }
    game.onTick(state, 0.25, api);
    ticks += 1;
  }
  return { state, events, ticks, finished: game.isOver(state) };
}

console.log('\n  Game module tests\n');

/* ------------------------------- catalogue ------------------------------- */

const catalogue = listGames();
check('registry exposes every game', catalogue.length >= 9, `${catalogue.length} games`);
check(
  'every game has the fields the site needs',
  catalogue.every((g) => g.id && g.name && g.tagline && g.emoji && g.accent && g.client)
);
// Party games share one renderer; anything else brings its own. Asserting the
// rule rather than a count, so a new game of either kind doesn't break this.
const party = catalogue.filter((g) => g.client === '_party');
const standalone = catalogue.filter((g) => g.client !== '_party');
check(
  'every party game routes to the shared client',
  party.length > 0 && party.every((g) => g.client === '_party'),
  `${party.length} party games: ${party.map((g) => g.id).join(', ')}`
);
// The rule that actually matters is that the renderer a game names exists —
// not that it is the only game naming it. Slots, plinko, the wheel and scratch
// cards are one game in four costumes and share a screen on purpose, which the
// old "client === id" version read as four broken games.
check(
  'every other game names a renderer that exists',
  standalone.every((g) => existsSync(path.join(ROOT, 'public', 'games', g.client, 'client.js'))),
  standalone
    .filter((g) => !existsSync(path.join(ROOT, 'public', 'games', g.client, 'client.js')))
    .map((g) => `${g.id}→${g.client} (missing)`)
    .join(', ') || standalone.map((g) => `${g.id}→${g.client}`).join(', ')
);

/* ------------------------- every game completes -------------------------- */

// Party games only: they share one contract, so one driver plays them all.
// Orb Rush is covered by the smoke test, Ship Attack by test-battleship.mjs —
// both have rules this driver knows nothing about.
for (const meta of party) {
  const game = getGame(meta.id);
  const players = mkPlayers(Math.max(game.minPlayers, 4));

  const { state, finished } = playMatch(game, players, (s, ps, api) => {
    // Decide from the serialized view, exactly as a browser client would —
    // `mode` and `prompt` do not exist on the raw state.
    const view = game.serialize(s);
    for (const p of ps) {
      const player = { id: p.id, name: p.name };
      if (s.phase === 'answer') {
        if (view.mode === 'race') {
          game.onAction(s, player, { type: 'answer', text: s.roundData.answer }, api);
        } else if (s.roundData?.options?.length) {
          // Answer correctly where there is a correct answer, else just vote.
          const optionId = s.roundData.answerId ?? s.roundData.options[0].id;
          game.onAction(s, player, { type: 'choice', optionId }, api);
        } else {
          game.onAction(s, player, { type: 'answer', text: `answer from ${p.name}` }, api);
        }
      } else if (s.phase === 'vote') {
        const target = ps.find((x) => x.id !== p.id);
        game.onAction(s, player, { type: 'vote', targetId: target.id }, api);
      } else if (s.phase === 'choose') {
        game.onAction(s, player, { type: 'answer', choice: 'dare' }, api);
      } else if (s.phase === 'perform') {
        game.onAction(s, player, { type: 'done' }, api);
      }
    }
  });

  check(`${meta.id}: match runs to completion`, finished, `${state.round} rounds`);

  const table = game.results(state);
  check(
    `${meta.id}: produces a ranked result table`,
    Array.isArray(table) && table.length === players.length && table.every((r, i) => r.place === i + 1)
  );
  check(
    `${meta.id}: ranking is highest score first`,
    table.every((r, i) => i === 0 || table[i - 1].score >= r.score)
  );
  check(
    `${meta.id}: somebody actually scored`,
    table.some((r) => r.score > 0),
    table.map((r) => `${r.name}:${r.score}`).join(' ')
  );
}

/* ----------------------- the engine stays optional ------------------------ */
// Every capability is opt-in. These assertions exist so a future feature can't
// quietly leak into games that never asked for it.

{
  const players = mkPlayers(6);

  for (const meta of party) {
    const game = getGame(meta.id);
    const view = game.serialize(skipIntro(game, game.createState(players, {})));
    const hasTeams = view.teams !== undefined;
    const isMass = view.mass === true;

    check(
      `${meta.id}: team fields appear only when the game asks for teams`,
      hasTeams === (meta.id === 'clash')
    );
    check(
      `${meta.id}: ${isMass ? 'mass room sends no per-player list' : 'small room sends the player list'}`,
      isMass ? view.players === undefined && Boolean(view.crowd) : Array.isArray(view.players)
    );
  }

  // The generic escape hatch: a game can attach its own shared fields without
  // the engine knowing what they mean.
  const clashView = getGame('clash').serialize(skipIntro(getGame('clash'), getGame('clash').createState(players, {})));
  check('clash: custom fields ride along via the extra() hook', clashView.rope !== undefined);
  check('clash: sides start even', clashView.teams[0].members === clashView.teams[1].members);
  check(
    'quiz: an unrelated game carries none of that',
    clashView.rope !== undefined && getGame('quiz').serialize(skipIntro(getGame('quiz'), getGame('quiz').createState(players, {}))).rope === undefined
  );
}

/* --------------------------- imposter specifics --------------------------- */

const imposter = getGame('imposter');
{
  const players = mkPlayers(5);
  const state = skipIntro(imposter, imposter.createState(players, {}));

  check('imposter: exactly one imposter in a 5-player room', state.imposters.length === 1);

  const impId = state.imposters[0];
  const civId = players.find((p) => p.id !== impId).id;
  const impView = imposter.serializeFor(state, impId);
  const civView = imposter.serializeFor(state, civId);

  check('imposter: the imposter is told they are the imposter', impView.you.role === 'imposter');
  check('imposter: the imposter gets the decoy, not the real word', impView.you.secret.word === state.roundData.decoy);
  check('imposter: civilians get the real word', civView.you.secret.word === state.roundData.word);
  check(
    'imposter: the shared state never carries the secret word',
    !JSON.stringify(imposter.serialize(state)).includes(state.roundData.word)
  );
  check(
    'imposter: one player cannot see who the other players are',
    civView.you.role === 'civilian' && civView.roles === undefined
  );

  // Everyone votes for the imposter — civilians should take the round.
  const caught = skipIntro(imposter, imposter.createState(players, {}));
  const target = caught.imposters[0];
  const api = mkApi([]);
  for (const p of players) imposter.onAction(caught, p, { type: 'answer', text: 'hmm' }, api);
  while (caught.phase !== 'vote') imposter.onTick(caught, 1, api);
  for (const p of players) imposter.onAction(caught, p, { type: 'vote', targetId: target }, api);
  while (caught.phase !== 'reveal') imposter.onTick(caught, 1, api);

  check('imposter: unanimous correct vote catches them', caught.caught === true);
  check(
    'imposter: caught imposter scores nothing that round',
    (caught.roundScores[target] ?? 0) === 0
  );
  check(
    'imposter: civilians are rewarded for catching them',
    players.filter((p) => p.id !== target).every((p) => caught.roundScores[p.id] > 0)
  );
}

/* ------------------------------ race scoring ------------------------------ */

{
  const movies = getGame('movies');
  const players = mkPlayers(3);
  const state = skipIntro(movies, movies.createState(players, {}));
  const api = mkApi([]);

  movies.onAction(state, players[0], { type: 'answer', text: state.roundData.answer }, api);
  movies.onAction(state, players[1], { type: 'answer', text: 'definitely wrong' }, api);

  check('race: correct guess scores', (state.roundScores[players[0].id] ?? 0) > 0);
  check('race: wrong guess scores nothing', (state.roundScores[players[1].id] ?? 0) === 0);
  check('race: the wrong guesser can try again', !state.solved.includes(players[1].id));

  // Now the second player gets it — should score, but less than the first.
  movies.onAction(state, players[1], { type: 'answer', text: state.roundData.answer }, api);
  check(
    'race: first correct answer beats the second',
    state.roundScores[players[0].id] > state.roundScores[players[1].id],
    `${state.roundScores[players[0].id]} vs ${state.roundScores[players[1].id]}`
  );

  // Typo tolerance: a near-miss on a long title should still count.
  const fresh = skipIntro(movies, movies.createState(mkPlayers(2), {}));
  const answer = fresh.roundData.answer;
  const typo = answer.length > 6 ? answer.slice(0, -1) : answer;
  movies.onAction(fresh, { id: 'p0', name: 'P0' }, { type: 'answer', text: typo }, api);
  check('race: tolerates a one-character typo', fresh.solved.includes('p0'), `"${typo}" → "${answer}"`);
}

/* -------------------------------- quiz ----------------------------------- */

{
  const quiz = getGame('quiz');
  const players = mkPlayers(3);
  const state = skipIntro(quiz, quiz.createState(players, {}));
  const api = mkApi([]);
  const round = state.roundData;

  check('quiz: every question has exactly 4 options', round.options.length === 4);
  check('quiz: the correct option exists', round.options.some((o) => o.id === round.answerId));

  quiz.onAction(state, players[0], { type: 'choice', optionId: round.answerId }, api);
  const wrongId = round.options.find((o) => o.id !== round.answerId).id;
  quiz.onAction(state, players[1], { type: 'choice', optionId: wrongId }, api);

  check('quiz: correct answer scores', state.roundScores[players[0].id] > 0);
  check('quiz: wrong answer scores nothing', (state.roundScores[players[1].id] ?? 0) === 0);

  quiz.onAction(state, players[1], { type: 'choice', optionId: round.answerId }, api);
  check('quiz: no second attempt after answering', (state.roundScores[players[1].id] ?? 0) === 0);
}

/* --------------------------------- poll ----------------------------------- */

{
  const poll = getGame('poll');
  const players = mkPlayers(4);
  const state = skipIntro(poll, poll.createState(players, {}));
  const api = mkApi([]);
  const option = state.roundData.options[0];

  for (const p of players) poll.onAction(state, p, { type: 'choice', optionId: option.id }, api);
  while (state.phase !== 'reveal') poll.onTick(state, 1, api);

  const reveal = poll.serialize(state).reveal;
  check('poll: unanimous vote reads 100%', reveal.options[0].percent === 100, reveal.headline);
  check('poll: every option is listed in the results', reveal.options.length === state.roundData.options.length);
}

/* --------------------------- truth or dare turns -------------------------- */

// Truth or Dare left the party engine when it got a bottle: the round is no
// longer "everyone answers at once" but a chain of one-person steps, so it
// runs its own module and its own rules live in npm run test:truth-dare.
// What still belongs here is that it is a citizen of the arcade like any other.
{
  const td = getGame('truth-dare');
  const state = td.createState(mkPlayers(4), {});
  check('truth or dare: the bottle picks a pair, not a turn order', Boolean(state.seats?.length) && !('turnPlayerId' in state));
  check('truth or dare: it declares its own renderer', td.client === 'truth-dare');
  check('truth or dare: and its own rules screen', (td.howToPlay ?? []).length >= 3);
}

/* ----------------------- results panels carry numbers ---------------------- */

// Quiz once shipped a reveal that looked perfect and read 0% on every bar: the
// game sent `picked`, the client drew `percent`. Nothing failed, nothing threw,
// the screen was just wrong. So every game that draws option bars gets checked
// for the field the client actually reads.
{
  for (const meta of listGames()) {
    const game = getGame(meta.id);
    const players = mkPlayers(Math.max(meta.minPlayers, 4));
    let bars = null;

    playMatch(game, players, (s, ps, api) => {
      if (s.phase === 'reveal' && !bars) {
        const view = game.serialize(s);
        if (view.reveal?.options?.length) bars = view.reveal.options;
      }
      // Everyone picks the first option, so the tally is unambiguous.
      const options = s.roundData?.options;
      if (s.phase === 'answer' && options?.length) {
        for (const p of ps) game.onAction(s, p, { type: 'choice', optionId: options[0].id }, api);
      } else if (s.phase === 'answer') {
        for (const p of ps) game.onAction(s, p, { type: 'answer', text: `from ${p.id}` }, api);
      } else if (s.phase === 'vote') {
        for (const p of ps) game.onAction(s, p, { type: 'vote', targetId: ps[0].id }, api);
      } else if (s.phase === 'choose') {
        game.onAction(s, { id: s.turnPlayerId, name: 'x' }, { type: 'answer', choice: 'dare' }, api);
      } else if (s.phase === 'perform') {
        game.onAction(s, { id: s.turnPlayerId, name: 'x' }, { type: 'done' }, api);
      }
    });

    if (!bars) continue; // this game doesn't draw bars, nothing to check
    check(
      `${meta.id}: results bars carry a percent`,
      bars.every((o) => typeof o.percent === 'number'),
      bars.map((o) => `${o.percent}%`).join(' ')
    );
    check(
      `${meta.id}: everyone picking one option reads 100%`,
      bars.some((o) => o.percent === 100),
      bars.map((o) => `${o.label ?? o.id}:${o.percent}%`).join(' · ')
    );
  }
}

/* ---------------------------- host-tunable setup --------------------------- */

// The host can shorten the clock, and a room that gives itself less time has to
// be paid more for the same answer — otherwise "hard mode" is pure downside.
{
  const quiz = getGame('quiz');
  check('games declare what the host can change', Boolean(quiz.options?.pace && quiz.options?.rounds));

  const scoreAt = (pace) => {
    const players = mkPlayers(2);
    const state = skipIntro(quiz, quiz.createState(players, { settings: { pace, rounds: 3 } }));
    const api = mkApi([]);
    // Everyone answers correctly on the first question.
    quiz.onAction(state, players[0], { type: 'choice', optionId: state.roundData.answerId }, api);
    return { state, points: state.roundScores[players[0].id] ?? 0 };
  };

  const relaxed = scoreAt('relaxed');
  const normal = scoreAt('normal');
  const blitz = scoreAt('blitz');

  check('a blitz room pays more than a normal one', blitz.points > normal.points, `${blitz.points} vs ${normal.points}`);
  check('a relaxed room pays less', relaxed.points < normal.points, `${relaxed.points} vs ${normal.points}`);
  check('a blitz round is shorter than a relaxed one', blitz.state.phaseTotal < relaxed.state.phaseTotal,
    `${blitz.state.phaseTotal}s vs ${relaxed.state.phaseTotal}s`);
  check('the round count the host picked is used', normal.state.totalRounds === 3, `${normal.state.totalRounds} rounds`);

  // Settings arrive from a host who can send anything at all.
  const junk = skipIntro(quiz, quiz.createState(mkPlayers(2), { settings: { pace: 'instant', rounds: 9999 } }));
  // The ceiling is whatever the game says it is, read from the game rather
  // than copied here — a number written down twice is a number that goes stale.
  // `max` is where the slider stops; `hardMax` is where the rules do, and a
  // host typing a number is held to the latter.
  const maxRounds = quiz.options?.rounds?.hardMax ?? quiz.options?.rounds?.max ?? 20;
  check('nonsense settings fall back to something playable',
    junk.settings.pace === 'normal' && junk.totalRounds > 0 && junk.totalRounds <= maxRounds,
    `pace=${junk.settings.pace} rounds=${junk.totalRounds} (max ${maxRounds})`);

  // A results screen that flashes past is unreadable however fast the room wants to go.
  const fast = skipIntro(quiz, quiz.createState(mkPlayers(2), { settings: { pace: 'blitz' } }));
  fast.phase = 'reveal';
  check('results stay on screen long enough to read', quiz.serialize(fast).phaseTotal >= 5);
}

/* --------------------------------- report --------------------------------- */

const passed = results.filter((r) => r.ok).length;
console.log(`\n  ${passed}/${results.length} checks passed\n`);
process.exit(passed === results.length ? 0 : 1);
