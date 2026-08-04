// Proves the Hypnic ID stays unique as the studio fills up.
//
// Mints a large batch of identities through the same code path signup uses,
// then checks that not one collides — and that minting stays fast as the taken
// set grows, which is the part that used to be quadratic.
//
//   npm run test:identity [count]

import { deriveIdentity, normaliseId, keywordOf, keywordSpace, QUIZ } from '../server/identity.js';

const COUNT = Number(process.argv[2]) || 200_000;

const results = [];
const check = (label, ok, extra = '') => {
  results.push(ok);
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
};

const space = keywordSpace();
console.log(`\n  Identity test — minting ${COUNT.toLocaleString()} IDs\n`);
console.log(`  word pools: ${space.prefixes} prefixes × ${space.creatures} creatures = ${space.base.toLocaleString()} clean names\n`);

/* --------------------------- mint a large batch --------------------------- */

// The real uniqueness index from accounts.js is a Set; mirror it exactly.
const taken = new Set();
const isTaken = (keyword) => taken.has(keyword.toLowerCase());

const NAMES = ['Advay', 'Meera', 'Rahul', 'Sana', 'Kiran', 'Priya', 'Arjun', 'Neha', 'Vikram', 'Anaya'];
const answerFor = (n) =>
  Object.fromEntries(QUIZ.map((q, i) => [q.id, q.options[(n >> (i * 2)) % q.options.length].id]));

// Every possible un-suffixed name. The suffix alphabet contains letters, so
// "looks alphabetic" is not a test for cleanliness — membership here is.
const BASE_NAMES = new Set();
{
  const prefixes = new Set();
  const creatures = new Set();
  for (const q of QUIZ) {
    for (const o of q.options) {
      for (const p of o.prefix ?? []) prefixes.add(p);
      for (const c of o.creature ?? []) creatures.add(c);
    }
  }
  for (const p of prefixes) for (const c of creatures) BASE_NAMES.add(`${p}${c}`.toLowerCase());
}

const ids = new Set();
let cleanNames = 0;
let firstThousandMs = 0;
let lastThousandMs = 0;
const t0 = Date.now();

for (let i = 0; i < COUNT; i++) {
  if (i === 1000) firstThousandMs = Date.now() - t0;
  if (i === COUNT - 1000) lastThousandMs = Date.now();

  const identity = deriveIdentity(
    { name: `${NAMES[i % NAMES.length]}${i}`, age: 15 + (i % 20), answers: answerFor(i) },
    isTaken
  );
  taken.add(identity.keyword.toLowerCase());
  ids.add(identity.id);
  if (BASE_NAMES.has(identity.keyword.toLowerCase())) cleanNames += 1;
}

const totalMs = Date.now() - t0;
lastThousandMs = Date.now() - lastThousandMs;

check('every ID is unique', ids.size === COUNT, `${ids.size.toLocaleString()} of ${COUNT.toLocaleString()}`);
check('every keyword is unique', taken.size === COUNT);
check(
  'the clean two-word names all get claimed before suffixes start',
  cleanNames === Math.min(COUNT, BASE_NAMES.size),
  `${cleanNames.toLocaleString()} of ${BASE_NAMES.size.toLocaleString()} un-suffixed names issued`
);

/* ------------------------------- speed ----------------------------------- */

// The old linear scan got slower with every signup. This is the regression
// guard: minting near the end must not be dramatically slower than at the start.
const slowdown = lastThousandMs / Math.max(firstThousandMs, 1);
check(
  'minting does not slow down as the studio fills',
  slowdown < 4,
  `first 1k ${firstThousandMs}ms · last 1k ${lastThousandMs}ms (${slowdown.toFixed(1)}×)`
);
check(
  'throughput is usable',
  COUNT / (totalMs / 1000) > 20_000,
  `${Math.round(COUNT / (totalMs / 1000)).toLocaleString()} IDs/sec`
);

/* ------------------------------ properties ------------------------------- */

const sample = [...ids].slice(0, 3);
check('IDs keep the Hypnic>…<Teen shape', sample.every((id) => /^Hypnic>[A-Za-z0-9]+<Teen$/.test(id)), sample[0]);
check(
  'IDs survive a round trip through normalise',
  sample.every((id) => normaliseId(keywordOf(id)) === id)
);
check(
  'the same person always derives the same ID',
  (() => {
    const person = { name: 'Advay', age: 17, answers: answerFor(42) };
    const a = deriveIdentity(person, () => false);
    const b = deriveIdentity(person, () => false);
    return a.id === b.id;
  })()
);
check(
  'a different person derives a different ID',
  deriveIdentity({ name: 'Advay', age: 17, answers: answerFor(1) }, () => false).id !==
    deriveIdentity({ name: 'Meera', age: 19, answers: answerFor(2) }, () => false).id
);

// Adversarial: everyone answers identically and is the same age. Only the name
// differs, so every ID lands on one base keyword and the suffix does all the work.
const clash = new Set();
const clashTaken = (k) => clash.has(k.toLowerCase());
const sameAnswers = answerFor(7);
for (let i = 0; i < 20_000; i++) {
  const id = deriveIdentity({ name: `Same${i}`, age: 18, answers: sameAnswers }, clashTaken);
  clash.add(id.keyword.toLowerCase());
}
check('20k identical answer sets still produce 20k unique IDs', clash.size === 20_000, `${clash.size} unique`);

/* -------------------------------- report --------------------------------- */

const passed = results.filter(Boolean).length;
console.log(`\n  minted ${COUNT.toLocaleString()} IDs in ${(totalMs / 1000).toFixed(1)}s`);
console.log(`\n  ${passed}/${results.length} checks passed\n`);
process.exit(passed === results.length ? 0 : 1);
