// Titles: the open ones, the secret ones, and the promise that they are secret.
//
//   node tools/test-titles.mjs
//
// Two properties matter here and one of them is a privacy property.
//
// The obvious one: every rule has to be checkable without throwing, on a
// profile that is missing most of its fields — a title that throws is a title
// nobody can ever earn, and the only sign of it is a line in a log.
//
// The one worth the file: a secret title must not leak. Not its name, not its
// emoji, not what it takes. If the catalogue a signed-out stranger can read
// contains any of that, the secret is not a secret and the person wearing it
// did a checklist rather than something surprising. So this asks the catalogue
// for what it hands to somebody who has earned nothing, and checks that every
// secret is genuinely absent rather than merely marked.

import {
  TITLES, evaluateTitles, titleCatalogue, openTitles, secretTitles,
  CASINO, CARDS, BOARD, PARTY,
} from '../server/titles.js';
import { listGames } from '../server/games/index.js';

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`${ok ? '\x1b[32m PASS \x1b[0m' : '\x1b[31m FAIL \x1b[0m'} ${label}${extra ? `  \x1b[2m— ${extra}\x1b[0m` : ''}`);
  return ok;
};

console.log('\n  \x1b[1mTitles\x1b[0m  \x1b[2m(and what a stranger is allowed to know)\x1b[0m\n');

/* ------------------------------ the rules ------------------------------- */

const bare = { titles: [], stats: {}, points: 0, gamesPlayed: 0, wins: 0, bestStreak: 0 };
const match = {
  gameId: 'chess', score: 0, won: false, place: 2, playerCount: 2,
  runnerUpScore: 0, wasHost: false, at: new Date('2026-08-11T14:00:00'),
};

check('there are titles at all', TITLES.length >= 40, `${TITLES.length}`);
check('every id is unique',
  new Set(TITLES.map((t) => t.id)).size === TITLES.length);
check('every title has a name, an emoji and a description',
  TITLES.every((t) => t.name && t.emoji && t.desc));

// A profile with almost nothing on it. Every rule has to survive this, because
// a brand new member *is* this, and a rule that throws is a title that can
// never be earned by anybody.
let threw = [];
for (const t of TITLES) {
  try { t.check(bare, match, { totalGames: 70, memberNumber: 500 }); }
  catch (err) { threw.push(`${t.id}: ${err.message}`); }
}
check('no rule throws on a brand new profile', threw.length === 0, threw.slice(0, 3).join(' | '));

// And on a profile with everything, which is where the sloppier rules break.
const full = {
  titles: [], points: 999999, gamesPlayed: 9999, wins: 9999, bestStreak: 99,
  worstLossRun: 9, hosted: 999, activeDays: Array.from({ length: 400 }, (_, i) => `d${i}`),
  playedWith: Array.from({ length: 99 }, (_, i) => `p${i}`),
  hoursPlayed: Array.from({ length: 24 }, (_, i) => i),
  stats: Object.fromEntries(listGames().map((g) => [g.id, { plays: 9, wins: 9, bestScore: 9, totalScore: 9 }])),
};
threw = [];
for (const t of TITLES) {
  try { t.check(full, { ...match, won: true, score: 100 }, { totalGames: listGames().length, memberNumber: 1 }); }
  catch (err) { threw.push(`${t.id}: ${err.message}`); }
}
check('and none throws on a full one', threw.length === 0, threw.slice(0, 3).join(' | '));

// Somebody who has done everything should be able to hold nearly everything —
// a rule that cannot fire even then is a rule with a typo in a game id.
const earned = evaluateTitles(full, { ...match, won: true, score: 77, playerCount: 8, wasHost: true, runnerUpScore: 1 },
  { totalGames: listGames().length, memberNumber: 1 });
const unreachable = TITLES.filter((t) => !earned.some((e) => e.id === t.id)).map((t) => t.id);
// A handful genuinely cannot fire on one match — they want a *different* score,
// or a loss, or an hour this match did not happen in.
check('almost every title can actually be earned',
  unreachable.length <= 12, `${unreachable.length} did not fire: ${unreachable.join(', ')}`);

/* ---------------------------- open and secret --------------------------- */

check('there are secret titles', secretTitles().length >= 15, `${secretTitles().length}`);
check('and open ones', openTitles().length >= 25, `${openTitles().length}`);
check('nothing is both', secretTitles().every((t) => !openTitles().includes(t)));

// The privacy property. A stranger asks for the catalogue and must not be able
// to learn a single thing about a secret — not the name, not the emoji, not the
// wording of what it takes.
const stranger = titleCatalogue(null);
const leaked = secretTitles().filter((s) =>
  stranger.titles.some((t) => t.id === s.id || t.name === s.name || t.desc === s.desc));
check('a stranger is told nothing about any secret', leaked.length === 0,
  leaked.map((t) => t.id).join(', '));
check('but is told how many there are',
  stranger.secretsLeft === secretTitles().length && stranger.secretsTotal === secretTitles().length,
  `${stranger.secretsLeft} of ${stranger.secretsTotal}`);
check('the open ones are all there',
  stranger.titles.length === openTitles().length, `${stranger.titles.length}`);

// Serialised, in case somebody ever sends the whole object by accident.
const wire = JSON.stringify(stranger);
const named = secretTitles().filter((t) => wire.includes(t.name));
check('and no secret name appears anywhere in the response', named.length === 0,
  named.map((t) => t.name).join(', '));

// Earn one, and it appears — for that person only.
const holder = { titles: [{ id: 'nice' }] };
const mine = titleCatalogue(holder);
check('a secret you have earned shows up on your own page',
  mine.titles.some((t) => t.id === 'nice' && t.secret === true));
check('and it stops being counted as missing',
  mine.secretsLeft === secretTitles().length - 1, `${mine.secretsLeft}`);
check('while still hidden from everybody else',
  !titleCatalogue(null).titles.some((t) => t.id === 'nice'));

/* --------------------- the room lists, against the truth ---------------- */

// These are written out in titles.js rather than imported, so they can drift.
// This is the check that makes writing them out safe.
const rooms = { casino: CASINO, cards: CARDS, board: BOARD, party: PARTY };
for (const [room, listed] of Object.entries(rooms)) {
  const real = listGames().filter((g) => (g.room ?? 'party') === room).map((g) => g.id);
  const missing = real.filter((id) => !listed.includes(id));
  const ghosts = listed.filter((id) => !real.includes(id));
  check(`the ${room} list matches the catalogue`,
    missing.length === 0 && ghosts.length === 0,
    `missing: ${missing.join(', ') || 'none'} · not real: ${ghosts.join(', ') || 'none'}`);
}

const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.log('\n  \x1b[31mwhat failed:\x1b[0m');
  for (const r of bad) console.log(`  \x1b[31m  · ${r.label}\x1b[0m`);
}
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — ${openTitles().length} to chase, ${secretTitles().length} nobody will tell you about\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
