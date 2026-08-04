// AI Game Master — optional.
//
// Tops up the content banks with fresh material so a regular group stops seeing
// the same twenty questions. It is strictly additive: the static banks in
// content.js are always present, so a laptop on college WiFi with no internet
// behaves exactly as before.
//
// To enable:
//   npm install @anthropic-ai/sdk
//   set ANTHROPIC_API_KEY=...        (or run `ant auth login`)
//   set AI_GAME_MASTER=1
//
// Generated content is cached to data/ai-content.json, so a session that ran
// once online keeps the extra material offline afterwards.

import { JsonStore, registerStore } from './store.js';
import { TRUTHS, DARES, SITUATIONS, PLAYER_POLLS, QUIZ } from './content.js';

const MODEL = 'claude-opus-5';
const cache = registerStore(new JsonStore('ai-content.json', { batches: {}, generatedAt: 0 }));

export const isEnabled = () => process.env.AI_GAME_MASTER === '1';

let clientPromise = null;

/** The SDK is not a hard dependency — resolve it lazily and degrade quietly. */
async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        return new Anthropic(); // resolves ANTHROPIC_API_KEY / auth profile
      } catch {
        console.log('  [ai] @anthropic-ai/sdk not installed — using the built-in banks only');
        return null;
      }
    })();
  }
  return clientPromise;
}

const listSchema = (itemSchema) => ({
  type: 'object',
  properties: { items: { type: 'array', items: itemSchema } },
  required: ['items'],
  additionalProperties: false,
});

const STRING_LIST = listSchema({ type: 'string' });

const QUIZ_SCHEMA = listSchema({
  type: 'object',
  properties: {
    q: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    answer: { type: 'string' },
  },
  required: ['q', 'options', 'answer'],
  additionalProperties: false,
});

const HOUSE_STYLE = `You write content for Hypnic Teen's party games, played by Indian college
students with their friends in the same room. Keep it playful, specific and a little cheeky.
Mix Indian and global references. Never include anything sexual, discriminatory, dangerous,
or that pressures someone to reveal something genuinely private. Dares must be safe to do
indoors in under a minute with no equipment and no alcohol.`;

const JOBS = {
  truths: { schema: STRING_LIST, prompt: 'Write 12 "truth" questions for Truth or Dare. One sentence each.' },
  dares: { schema: STRING_LIST, prompt: 'Write 12 dares. Each must be safe, indoors, under a minute, no props.' },
  situations: {
    schema: STRING_LIST,
    prompt: 'Write 12 "what would you do" hypothetical situations. Each must be answerable in one sentence and spark disagreement.',
  },
  polls: {
    schema: STRING_LIST,
    prompt: 'Write 12 "Who is most likely to..." poll questions about friends in a room together. Keep them affectionate, not mean.',
  },
  quiz: {
    schema: QUIZ_SCHEMA,
    prompt: `Write 12 multiple-choice questions across these categories: movies, cricket, coding, anime, college life,
general knowledge. Each needs exactly 4 options and one correct answer that must appear verbatim in the options.`,
  },
};

/**
 * Generates one batch. Returns [] on any failure — the caller keeps its bank.
 */
async function generate(kind) {
  const job = JOBS[kind];
  const client = await getClient();
  if (!job || !client) return [];

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Low effort keeps this fast; thinking stays on (disabling it on Opus 5
      // can leak internal tags into the output).
      output_config: { effort: 'low', format: { type: 'json_schema', schema: job.schema } },
      // Safety classifiers can decline; let the API retry on a fallback model
      // rather than handing us a refusal.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: HOUSE_STYLE,
      messages: [{ role: 'user', content: job.prompt }],
    });

    if (response.stop_reason === 'refusal') {
      console.warn(`  [ai] "${kind}" was declined (${response.stop_details?.category ?? 'unknown'})`);
      return [];
    }

    const text = response.content.find((b) => b.type === 'text')?.text ?? '';
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch (err) {
    console.warn(`  [ai] "${kind}" generation failed: ${err.message}`);
    return [];
  }
}

/** Merge a batch into a live bank, skipping anything already there. */
function merge(bank, items, keyOf = (x) => String(x).toLowerCase()) {
  const seen = new Set(bank.map(keyOf));
  let added = 0;
  for (const item of items) {
    if (!item || seen.has(keyOf(item))) continue;
    seen.add(keyOf(item));
    bank.push(item);
    added += 1;
  }
  return added;
}

function applyBatch(kind, items) {
  switch (kind) {
    case 'truths': return merge(TRUTHS, items);
    case 'dares': return merge(DARES, items);
    case 'situations': return merge(SITUATIONS, items);
    case 'polls': return merge(PLAYER_POLLS, items);
    case 'quiz': {
      const valid = items.filter((q) => Array.isArray(q?.options) && q.options.includes(q.answer));
      QUIZ['AI Mix'] ??= [];
      return merge(QUIZ['AI Mix'], valid, (q) => q.q.toLowerCase());
    }
    default:
      return 0;
  }
}

/**
 * Loads cached batches immediately, then refreshes in the background if the
 * cache is stale. Never blocks server startup.
 */
export async function warmUp() {
  let restored = 0;
  for (const [kind, items] of Object.entries(cache.data.batches)) {
    restored += applyBatch(kind, items);
  }
  if (restored) console.log(`  [ai] restored ${restored} cached items`);

  if (!isEnabled()) return;
  const ageDays = (Date.now() - (cache.data.generatedAt || 0)) / 864e5;
  if (ageDays < 7 && restored) return; // still fresh

  console.log('  [ai] Game Master is generating fresh content…');
  let added = 0;
  for (const kind of Object.keys(JOBS)) {
    const items = await generate(kind);
    if (!items.length) continue;
    cache.data.batches[kind] = [...(cache.data.batches[kind] ?? []), ...items].slice(-60);
    added += applyBatch(kind, items);
  }
  if (added) {
    cache.data.generatedAt = Date.now();
    cache.flush();
    console.log(`  [ai] added ${added} new items`);
  }
}
