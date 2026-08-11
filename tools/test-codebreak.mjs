// Crack the Code.
//
//   node tools/test-codebreak.mjs
//
// Two things are worth a suite here and the first one is arithmetic.
//
// Scoring a guess against a secret when either side can repeat a character is
// the step almost every version of this game gets wrong, and it gets it wrong
// in a way that looks fine until somebody repeats a digit. The naive count says
// "the guess contains a 3 and so does the secret, score it" — for every 3 in
// the guess. The right answer is that each character of the secret can be
// claimed once and once only, which is a two-pass count: take the exact matches
// off first, then match what is left greedily.
//
// The tell for the bug is that the two numbers add up to more than the code is
// long, so that is checked on ten thousand random pairs rather than on the
// handful of cases somebody thought of.
//
// The second is that the secret is a secret. It goes to exactly one person —
// the one who chose it — and to nobody else until the round is over. Not
// masked, not blanked: absent.

import { codebreak, score } from '../server/games/codebreak.js';

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`${ok ? '\x1b[32m PASS \x1b[0m' : '\x1b[31m FAIL \x1b[0m'} ${label}${extra ? `  \x1b[2m— ${extra}\x1b[0m` : ''}`);
  return ok;
};
const api = { emit() {}, broadcast() {}, log() {} };

console.log('\n  \x1b[1mCrack the Code\x1b[0m  \x1b[2m(the counting, and the secret)\x1b[0m\n');

/* ------------------------------ the counting ----------------------------- */

// The example from the request: 34525 against 33986 is one in place.
{
  const r = score('34525', '33986');
  check("the user's own example: 34525 vs 33986", r.exact === 1 && r.elsewhere === 0,
    `${r.exact} in place, ${r.elsewhere} elsewhere`);
}

check('an exact match is all exact',
  score('1234', '1234').exact === 4 && score('1234', '1234').elsewhere === 0);
check('a total miss is nothing',
  score('1234', '5678').exact === 0 && score('1234', '5678').elsewhere === 0);
check('a full anagram is all elsewhere',
  score('1234', '4321').exact === 0 && score('1234', '4321').elsewhere === 4);

// The repeat cases, one at a time, because each breaks a different naive count.
{
  // Secret has one 7; guess has three. Only one can be claimed.
  const r = score('7123', '7777');
  check('a guess that repeats cannot claim the same character twice',
    r.exact === 1 && r.elsewhere === 0, `${r.exact}/${r.elsewhere}`);
}
{
  // Secret has three 7s; guess has one, in the wrong place.
  const r = score('7771', '1777');
  check('and a secret that repeats is counted once per character',
    r.exact === 2 && r.elsewhere === 2, `${r.exact}/${r.elsewhere}`);
}
{
  // Exact matches must be taken first, or the 2 at the front steals the count
  // that belongs to the 2 in place.
  const r = score('221', '212');
  check('exact matches are taken before the rest',
    r.exact === 1 && r.elsewhere === 2, `${r.exact}/${r.elsewhere}`);
}

// The property, on ten thousand random pairs: the two numbers can never add up
// to more than the length, and an identical pair is always all-exact.
{
  let broke = null;
  for (let i = 0; i < 10000 && !broke; i++) {
    const len = 3 + (i % 6);
    const mk = () => Array.from({ length: len }, () => '0123456789'[Math.floor(Math.random() * 10)]).join('');
    const a = mk();
    const b = mk();
    const r = score(a, b);
    if (r.exact + r.elsewhere > len) broke = `${a} vs ${b} scored ${r.exact}+${r.elsewhere} on ${len}`;
    if (r.exact < 0 || r.elsewhere < 0) broke = `${a} vs ${b} scored negative`;
    const same = score(a, a);
    if (same.exact !== len || same.elsewhere !== 0) broke = `${a} against itself scored ${same.exact}/${same.elsewhere}`;
  }
  check('ten thousand random pairs never over-count', !broke, broke ?? '');
}

// Scoring is symmetric in its totals — the same two strings either way round
// give the same numbers. Asymmetry there means one side is being consumed.
{
  let broke = null;
  for (let i = 0; i < 3000 && !broke; i++) {
    const mk = () => Array.from({ length: 5 }, () => '0123'[Math.floor(Math.random() * 4)]).join('');
    const a = mk(); const b = mk();
    const x = score(a, b); const y = score(b, a);
    if (x.exact !== y.exact || x.elsewhere !== y.elsewhere) broke = `${a}/${b}: ${x.exact},${x.elsewhere} vs ${y.exact},${y.elsewhere}`;
  }
  check('and it reads the same from either side', !broke, broke ?? '');
}

/* -------------------------------- the game ------------------------------- */

function open(n = 3, settings = {}) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i + 1}`, connected: true }));
  const state = codebreak.createState(players, { settings, room: { hostId: 'p0' } });
  for (const p of players) codebreak.onAction(state, p, { type: 'briefed' }, api);
  return { state, players };
}

{
  const { state } = open(3, { length: 4, mode: 'digits' });
  check('everybody ready starts the round', state.phase === 'setting', state.phase);
  check('somebody is the setter', state.setter === 0, String(state.setter));
  check('and they are dealt something in case they cannot think of one',
    typeof state.dealt === 'string' && state.dealt.length === 4, String(state.dealt));
}

{
  // The secret reaches exactly one person.
  const { state, players } = open(3, { length: 4 });
  codebreak.onAction(state, players[0], { type: 'setCode', code: '1357' }, api);
  check('the setter can lock a code in', state.phase === 'guessing' && state.secret === '1357', state.phase);

  const setterView = codebreak.serializeFor(state, 'p0');
  const otherView = codebreak.serializeFor(state, 'p1');
  check('the setter can see their own code', setterView.you.secret === '1357');
  check('nobody else can', otherView.you.secret === undefined);
  // Absent, not blank. A masked field is a field somebody can go looking at.
  check('and it is absent rather than emptied',
    !('secret' in otherView.you), JSON.stringify(otherView.you));
  check('it is nowhere in the whole view either',
    !JSON.stringify(otherView).includes('1357'));
}

{
  // A guess, and what comes back.
  const { state, players } = open(3, { length: 4 });
  codebreak.onAction(state, players[0], { type: 'setCode', code: '1357' }, api);
  const first = state.turn;
  check('the setter does not get a turn', first !== state.setter, `turn ${first}`);

  codebreak.onAction(state, players[first], { type: 'guess', code: '1234' }, api);
  const g = state.guesses[0];
  check('a guess is recorded with its two numbers',
    g && g.exact === 1 && g.elsewhere === 1, JSON.stringify(g));
  check('and everybody can read it — that is the game',
    codebreak.serializeFor(state, 'p2').guesses.length === 1);
  check('but it still does not carry the answer',
    !JSON.stringify(codebreak.serializeFor(state, 'p2')).includes('1357'));

  // Wrong length, or wrong alphabet, is not a guess.
  const before = state.guesses.length;
  codebreak.onAction(state, players[state.turn], { type: 'guess', code: '12' }, api);
  codebreak.onAction(state, players[state.turn], { type: 'guess', code: 'ABCD' }, api);
  check('a malformed guess is refused', state.guesses.length === before, `${state.guesses.length}`);

  // And somebody guessing out of turn is refused.
  const notTheirTurn = state.seats.find((s) => s.seat !== state.turn && s.seat !== state.setter);
  if (notTheirTurn) {
    codebreak.onAction(state, { id: notTheirTurn.id }, { type: 'guess', code: '9999' }, api);
    check('and so is a guess out of turn', state.guesses.length === before, `${state.guesses.length}`);
  }
}

{
  // Cracking it.
  const { state, players } = open(3, { length: 4 });
  codebreak.onAction(state, players[0], { type: 'setCode', code: '1357' }, api);
  const who = state.turn;
  codebreak.onAction(state, players[who], { type: 'guess', code: '1357' }, api);
  check('cracking it ends the round', state.phase === 'reveal', state.phase);
  check('the code is shown once it is over',
    codebreak.serializeFor(state, 'p2').revealed === '1357');
  check('the cracker scores', state.seats[who].score > 0, String(state.seats[who].score));
  check('and the setter gets something for the trouble',
    state.seats[0].score > 0, String(state.seats[0].score));
}

{
  // Running out of tries hands it to the setter.
  const { state, players } = open(3, { length: 3, tries: 4 });
  codebreak.onAction(state, players[0], { type: 'setCode', code: '111' }, api);
  for (let i = 0; i < 4 && state.phase === 'guessing'; i++) {
    codebreak.onAction(state, players[state.turn], { type: 'guess', code: '999' }, api);
  }
  check('running out of guesses ends the round', state.phase === 'reveal', state.phase);
  check('and the setter takes the points', state.seats[0].score >= 45, String(state.seats[0].score));
  check('nobody is credited with cracking it', state.winner === null, String(state.winner));
}

{
  // A whole match, played legally, checking nothing leaks at any point.
  const { state, players } = open(4, { rounds: 3, length: 4, tries: 6 });
  let guard = 0;
  let leaked = null;
  while (!state.over && guard++ < 2000) {
    if (state.phase === 'setting') {
      codebreak.onAction(state, players[state.setter], { type: 'takeDealt' }, api);
    } else if (state.phase === 'guessing') {
      const mk = Array.from({ length: 4 }, () => '0123456789'[Math.floor(Math.random() * 10)]).join('');
      codebreak.onAction(state, players[state.turn], { type: 'guess', code: mk }, api);
    } else {
      codebreak.onTick(state, 1);
    }
    // At every single step, anybody who is not the setter must not be able to
    // see the code — including through the guess list or the said line.
    //
    // Once the round is over the code is public on purpose, which is both
    // 'reveal' and 'over': the match ending does not un-finish the last round,
    // and the line announcing what it was is the point of the reveal.
    if (state.secret && state.phase !== 'reveal' && state.phase !== 'over') {
      for (const p of players) {
        if (p.id === players[state.setter].id) continue;
        if (JSON.stringify(codebreak.serializeFor(state, p.id)).includes(state.secret)) {
          // A random guess can legitimately equal the code; that is a crack,
          // not a leak, and the round would have ended.
          leaked = `${p.id} could see ${state.secret} in ${state.phase}`;
          break;
        }
      }
    }
    if (leaked) break;
  }
  check('a whole match runs to the end', state.over, `${guard} steps, phase ${state.phase}`);
  check('and the code never leaked at any point', !leaked, leaked ?? '');
  check('everybody has a score', state.seats.every((s) => typeof s.score === 'number'));
  const table = codebreak.results(state);
  check('the results are ranked', table.length === 4 && table[0].place === 1);
}

{
  // Words, not just digits.
  const { state, players } = open(3, { mode: 'word', length: 5 });
  check('a word game deals a word',
    /^[A-Z]{5}$/.test(state.dealt ?? ''), String(state.dealt));
  codebreak.onAction(state, players[0], { type: 'setCode', code: 'crane' }, api);
  check('a lowercase word is accepted and squared up', state.secret === 'CRANE', String(state.secret));
  codebreak.onAction(state, players[state.turn], { type: 'guess', code: 'CRATE' }, api);
  const g = state.guesses[0];
  check('and letters score the same way as digits',
    g.exact === 4 && g.elsewhere === 0, `${g?.exact}/${g?.elsewhere}`);
  // Digits are not letters.
  const before = state.guesses.length;
  codebreak.onAction(state, players[state.turn], { type: 'guess', code: '12345' }, api);
  check('digits are refused in a word game', state.guesses.length === before);
}

{
  // The setter leaving must not strand the room on a code nobody can reveal.
  const { state, players } = open(3, { length: 4 });
  codebreak.onAction(state, players[0], { type: 'setCode', code: '1357' }, api);
  codebreak.onPlayerLeave(state, players[0]);
  check('the setter walking out ends the round', state.phase === 'reveal', state.phase);
  check('and the code is shown rather than lost',
    codebreak.serializeFor(state, 'p1').revealed === '1357');
}

{
  // It is in the catalogue and it says how to play.
  check('it has rules', codebreak.howToPlay.length >= 5, String(codebreak.howToPlay.length));
  check('nonsense moves nothing', (() => {
    const { state, players } = open(3);
    const before = JSON.stringify(state);
    codebreak.onAction(state, players[1], { type: 'nonsense', code: '!!!' }, api);
    return JSON.stringify(state) === before;
  })());
}

const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.log('\n  \x1b[31mwhat failed:\x1b[0m');
  for (const r of bad) console.log(`  \x1b[31m  · ${r.label}\x1b[0m`);
}
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — the count is honest and the code stays with one person\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
