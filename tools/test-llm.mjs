// Is the local model actually writing for CPU players, or quietly falling back?
//
//   npm run test:llm
//
// Silence is the failure mode that hides: a slow or missing model just makes
// bots dull, and nothing errors. This makes that visible either way.

import { warmUpLLM, llmReady, llmModel, say } from '../server/llm.js';

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[33mSKIP\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};

console.log('\n  Local model for CPU players\n');

const up = await warmUpLLM();
if (!up) {
  console.log('  \x1b[33mNo local model answering.\x1b[0m CPU players will use canned lines,');
  console.log('  which is a supported mode — start Ollama to give them a voice.\n');
  process.exit(0);
}

check('a local model is reachable', true, llmModel());

const t0 = Date.now();
const answer = await say(
  'You are playing a party game with friends. The situation:\n' +
    '"Your professor catches you asleep in class."\n' +
    'Reply with ONE short, funny, harmless answer — under 12 words. Reply with the answer only.'
);
const took = Date.now() - t0;

check('it writes a game answer', Boolean(answer), answer ?? 'nothing came back');
check('the answer is short enough to read on a phone', (answer ?? '').length <= 160, `${(answer ?? '').length} chars`);
check('no thinking tags leak through', !/<think>/i.test(answer ?? ''));
check('it answers fast enough for a live round', took < 9000, `${took}ms`);

const hidden = await say(
  'You are playing a word game. Your secret word is "Biryani".\n' +
    'Describe it in ONE short sentence WITHOUT ever using the word itself.\n' +
    'Reply with the sentence only.'
);
check('it can describe a word without saying it', Boolean(hidden), hidden ?? 'nothing came back');
check(
  'and it does not blurt the secret',
  !/biryani/i.test(hidden ?? ''),
  hidden ? '' : 'no answer to check'
);

const passed = results.filter((r) => r.ok).length;
console.log(`\n  ${passed}/${results.length} checks passed\n`);
process.exit(passed === results.length ? 0 : 1);
