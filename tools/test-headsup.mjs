// Heads Up.
//
//   node tools/test-headsup.mjs
//
// One property carries this whole game: the word reaches every screen in the
// room except the guesser's. Not masked — absent. So the main test here plays
// whole matches and, at every single step, serialises the guesser's view and
// searches it for the word. Any appearance, any field, any spelling of it is
// a failure, because a phone held to a forehead must hold nothing readable.
//
// The rest is the room's machinery: spelling differences not being wrong
// answers, the room voting a word away without the guesser having a say, the
// scores paying both the catcher and the tellers, and the guesser's chair
// moving round the table.

import { headsup } from '../server/games/headsup.js';

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`${ok ? '\x1b[32m PASS \x1b[0m' : '\x1b[31m FAIL \x1b[0m'} ${label}${extra ? `  \x1b[2m— ${extra}\x1b[0m` : ''}`);
  return ok;
};
const api = { emit() {}, broadcast() {}, log() {} };

const players = (n) => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, name: `Player${i + 1}`, connected: true,
}));

function open(n, settings = {}) {
  const roster = players(n);
  const state = headsup.createState(roster, { settings, room: { hostId: 'p0' } });
  for (const p of roster) headsup.onAction(state, p, { type: 'briefed' }, api);
  return { state, roster };
}

const fold = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

console.log('\n  \x1b[1mHeads Up\x1b[0m  \x1b[2m(the word reaches everybody except one)\x1b[0m\n');

/* ------------------------------- the secret ------------------------------ */

{
  const { state, roster } = open(4);
  check('the brief ends when everybody is ready', state.phase === 'guessing', state.phase);
  check('a word was dealt', typeof state.word === 'string' && state.word.length > 0, state.word);
  check('somebody is the guesser', state.guesser >= 0, String(state.guesser));

  const guesser = roster[state.guesser];
  const rest = roster.filter((p) => p !== guesser);

  const gView = headsup.serializeFor(state, guesser.id);
  check("the guesser's view has no word field at all",
    !('word' in gView) && !('picture' in gView), Object.keys(gView).join(','));
  check('and the word is nowhere in the whole view',
    !JSON.stringify(gView).toLowerCase().includes(state.word.toLowerCase()));

  for (const p of rest) {
    const view = headsup.serializeFor(state, p.id);
    if (!check(`${p.name} sees the word`, view.word === state.word, view.word)) break;
  }
}

{
  // The sweep: whole matches, every step, every view the guesser ever gets.
  let leaked = null;
  let matches = 0;
  for (let round = 0; round < 12 && !leaked; round++) {
    const { state, roster } = open(3, { rounds: 3, guessSeconds: 30 });
    let guard = 0;
    while (!state.over && guard++ < 400) {
      if (state.phase === 'guessing' && state.word) {
        const guesser = roster[state.guesser];
        const full = headsup.serializeFor(state, guesser.id);
        // The reveal lines are public and historical — dead words, named after
        // they stopped mattering — and a dead word can innocently contain the
        // live one ("headphones" contains "phone"). So they are swept apart:
        // the live word must not appear anywhere else at all, and must not
        // appear in them as itself.
        const { log, said, lastWord, ...rest } = full;
        const view = JSON.stringify(rest).toLowerCase();
        const word = state.word.toLowerCase();
        const prose = [...(log ?? []), said ?? '', lastWord ?? ''].join(' ').toLowerCase();
        const asItself = new RegExp(`(^|[^a-z0-9])${word.replace(/[^a-z0-9 ]/g, '')}([^a-z0-9]|$)`);
        if (view.includes(word) || fold(view).includes(fold(word)) || asItself.test(prose)) {
          leaked = `round ${state.round}: "${state.word}" reached ${guesser.name}`;
          break;
        }
        // Sometimes guess wrong, sometimes right, sometimes let the clock run.
        const dice = guard % 3;
        if (dice === 0) headsup.onAction(state, guesser, { type: 'guess', text: 'wrong answer' }, api);
        else if (dice === 1) headsup.onAction(state, guesser, { type: 'guess', text: state.word }, api);
        else headsup.onTick(state, 5, api);
      } else {
        headsup.onTick(state, 2, api);
      }
    }
    if (!state.over && !leaked) leaked = `a match never finished (${guard} steps)`;
    matches += 1;
  }
  check('twelve whole matches and the word never reached the guesser',
    leaked === null, leaked ?? `${matches} matches swept`);
}

/* ------------------------------ the matching ----------------------------- */

{
  const { state, roster } = open(2);
  const guesser = roster[state.guesser];
  state.word = 'auto rickshaw';

  headsup.onAction(state, guesser, { type: 'guess', text: 'bus' }, api);
  check('a wrong guess is refused and recorded',
    state.phase === 'guessing' && state.guesses.length === 1, JSON.stringify(state.guesses));

  headsup.onAction(state, guesser, { type: 'guess', text: '  AUTO-RICKSHAW ' }, api);
  check('spelling differences are not wrong answers',
    state.phase === 'reveal' && state.lastBy === guesser.name, state.phase);
}

{
  // Only the guesser's guesses count — a helper typing the answer through
  // this channel is the textual version of shouting the name.
  const { state, roster } = open(3);
  const helper = roster.find((_, i) => i !== state.guesser);
  const word = state.word;
  headsup.onAction(state, helper, { type: 'guess', text: word }, api);
  check('a helper cannot guess', state.phase === 'guessing' && state.word === word);
}

/* ------------------------------- the scores ------------------------------ */

{
  const { state, roster } = open(4, { guessSeconds: 60 });
  const guesser = roster[state.guesser];
  state.timeLeft = 40;
  const before = state.seats.map((s) => s.score);
  headsup.onAction(state, guesser, { type: 'guess', text: state.word }, api);
  const after = state.seats.map((s) => s.score);
  const gSeat = state.seats.find((s) => s.id === guesser.id);
  check('the catch pays the guesser', gSeat.score >= 25 + 40, String(gSeat.score));
  const helpersPaid = state.seats.filter((s) => s.id !== guesser.id)
    .every((s, i2) => after[s.seat] > before[s.seat]);
  check('and the telling pays the room', helpersPaid,
    state.seats.map((s) => `${s.name}:${s.score}`).join(' '));
}

{
  // Time running out pays nobody.
  const { state } = open(3);
  const before = state.seats.map((s) => s.score);
  state.timeLeft = 0.1;
  headsup.onTick(state, 0.25, api);
  check('the clock running out pays nobody',
    state.phase === 'reveal' && state.seats.every((s, i) => s.score === before[i]));
  check('and the word is revealed to everybody once it is dead',
    typeof state.lastWord === 'string' && state.lastWord.length > 0, state.lastWord);
}

/* ------------------------------ the pass vote ---------------------------- */

{
  const { state, roster } = open(4);
  const word = state.word;
  const guesser = roster[state.guesser];
  const rest = roster.filter((p) => p !== guesser);

  headsup.onAction(state, guesser, { type: 'pass' }, api);
  check('the guesser has no say in swapping', state.word === word && state.passVotes.length === 0);

  headsup.onAction(state, rest[0], { type: 'pass' }, api);
  check('one vote of three is not enough', state.word === word, `${state.passVotes.length} votes`);
  headsup.onAction(state, rest[0], { type: 'pass' }, api);
  check('voting twice does not count twice', state.passVotes.length === 1);

  headsup.onAction(state, rest[1], { type: 'pass' }, api);
  check('a majority swaps the word', state.word !== word, `${word} → ${state.word}`);
  check('and the votes reset for the new word', state.passVotes.length === 0);
}

/* ------------------------------ the rotation ----------------------------- */

{
  const { state } = open(3, { rounds: 6, guessSeconds: 20 });
  const chairs = [state.guesser];
  let guard = 0;
  while (!state.over && guard++ < 200) {
    state.timeLeft = 0.1;
    headsup.onTick(state, 0.25, api);
    if (state.phase === 'guessing' && state.guesser !== chairs[chairs.length - 1]) {
      chairs.push(state.guesser);
    }
  }
  check('the chair moves round the table',
    new Set(chairs.slice(0, 3)).size === 3, chairs.join(' → '));
  check('and the match actually ends', state.over === true, `${guard} steps`);
}

{
  // No word repeats within a match — "penguin" explained twice is a dud round.
  const { state } = open(2, { rounds: 10, guessSeconds: 20 });
  const seen = [];
  let guard = 0;
  while (!state.over && guard++ < 300) {
    if (state.phase === 'guessing' && state.word && seen[seen.length - 1] !== state.word) {
      seen.push(state.word);
    }
    state.timeLeft = 0.1;
    headsup.onTick(state, 0.25, api);
  }
  check('no word repeats within a match',
    new Set(seen.map(fold)).size === seen.length, `${seen.length} words dealt`);
}

/* -------------------------------- the shelf ------------------------------ */

{
  const { listGames } = await import('../server/games/index.js');
  const meta = listGames().find((g) => g.id === 'headsup');
  check('it is on the shelf, in the party room',
    Boolean(meta) && (meta.room ?? 'party') === 'party', meta?.room);
  check('and it has its rules', (meta?.howToPlay?.length ?? 0) >= 5, String(meta?.howToPlay?.length));
}

const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.log('\n  \x1b[31mwhat failed:\x1b[0m');
  for (const r of bad) console.log(`  \x1b[31m  · ${r.label}\x1b[0m`);
}
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — the word reaches everybody except the one it is about\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
