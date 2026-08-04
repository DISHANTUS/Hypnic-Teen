// Grows the content banks with the local model.
//
//   npm run grow -- quiz 5000
//   npm run grow -- situations 2000
//   npm run grow                      (tops every topic up to its target)
//
// Writes data/bank/<topic>.json, which server/bank.js merges into the shipped
// content at boot. Text is cheap — 20,000 quiz questions is a couple of
// megabytes on disk and costs nothing at runtime, because a match only ever
// deals a couple of dozen.
//
// Safe to stop and restart: it appends to whatever is already there, skips
// anything it has seen before, and saves after every batch. A crash three
// hours in loses at most one batch.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { warmUpLLM, llmReady, llmModel, say } from '../server/llm.js';
import { clueVocabulary } from '../server/media.js';

const ROOT = path.join(import.meta.dirname, '..');
const DIR = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'bank');

// How to ask for each kind of material, and how to read the answer back.
const TOPICS = {
  quiz: {
    target: 50000,
    batch: 8,
    ask: (seedWords) =>
      `Write ${8} multiple-choice quiz questions for a party game played by Indian college students.\n` +
      `Mix these subjects: ${seedWords}.\n` +
      `Rules: one clearly correct answer, three plausible wrong ones, no trick questions, nothing offensive.\n` +
      `Answer with ONE JSON array and nothing else, each item exactly:\n` +
      `{"q":"question","options":["a","b","c","d"],"answer":"the correct option, copied exactly","category":"subject"}`,
    valid: (row) =>
      row?.q &&
      Array.isArray(row.options) &&
      row.options.length === 4 &&
      row.options.includes(row.answer),
  },
  situations: {
    target: 40000,
    batch: 10,
    ask: (seedWords) =>
      `Write 10 absurd "what would you do" situations for a party game with friends.\n` +
      `Themes to draw on: ${seedWords}. Keep them harmless, funny, and under 22 words each.\n` +
      `Answer with ONE JSON array of plain strings and nothing else.`,
    valid: (row) => typeof row === 'string' && row.length > 12 && row.length < 200,
  },
  // The names have to match the topic each game asks bank.deal() for, or the
  // file gets written and nothing ever reads it.
  'truth-dare-truths': {
    target: 40000,
    batch: 10,
    ask: (seedWords) =>
      `Write 10 "truth" questions for Truth or Dare among college friends.\n` +
      `Themes: ${seedWords}. Nosy and funny, never cruel, never about anything private or unsafe.\n` +
      `Answer with ONE JSON array of plain strings and nothing else.`,
    valid: (row) => typeof row === 'string' && row.length > 12 && row.length < 180,
  },
  'truth-dare-dares': {
    target: 40000,
    batch: 10,
    ask: (seedWords) =>
      `Write 10 dares for a party game in a college room.\n` +
      `Themes: ${seedWords}. They must be safe indoors, need no props, and embarrass nobody but the player.\n` +
      `Answer with ONE JSON array of plain strings and nothing else.`,
    valid: (row) => typeof row === 'string' && row.length > 10 && row.length < 180,
  },
  movies: {
    target: 40000,
    batch: 6,
    ask: (seedWords) =>
      `Write 6 "guess the movie" cards for a party game played by Indian college students.\n` +
      `Draw on a mix of Bollywood, Tamil, Telugu, Malayalam and Hollywood films people actually know. Nudge towards: ${seedWords}.\n` +
      `Answer with ONE JSON array and nothing else, each item exactly:\n` +
      `{"answer":"the film title","emoji":"4 to 6 emoji that spell out the plot","dialogue":"one famous line from it","character":"a main character's name"}`,
    valid: (row) =>
      row?.answer?.length > 1 &&
      // The emoji clue is the whole first round — a card without one is a card
      // where the opening hint is blank.
      /\p{Extended_Pictographic}/u.test(row.emoji ?? '') &&
      row.dialogue?.length > 4 &&
      row.character?.length > 1,
  },
  songs: {
    target: 40000,
    batch: 6,
    ask: (seedWords) =>
      `Write 6 "guess the song" cards for a party game played by Indian college students.\n` +
      `Mix Hindi film songs, Tamil/Telugu hits, indie and well-known English tracks. Nudge towards: ${seedWords}.\n` +
      `Answer with ONE JSON array and nothing else, each item exactly:\n` +
      `{"answer":"the song title","emoji":"4 to 6 emoji hinting at it","lyric":"a short recognisable line","from":"the film or album"}`,
    valid: (row) =>
      row?.answer?.length > 1 &&
      /\p{Extended_Pictographic}/u.test(row.emoji ?? '') &&
      row.lyric?.length > 4 &&
      row.from?.length > 1,
  },
  'find-word-hints': {
    target: 40000,
    batch: 8,
    ask: (seedWords) =>
      `Write 8 "guess the word" cards for a party game. Themes: ${seedWords}.\n` +
      `Each has one everyday word and three hints that get easier: the first vague, the last nearly gives it away.\n` +
      `Never put the answer itself inside a hint.\n` +
      `Answer with ONE JSON array and nothing else, each item exactly:\n` +
      `{"answer":"the word","hints":["vague","warmer","obvious"]}`,
    valid: (row) =>
      row?.answer?.length > 2 &&
      Array.isArray(row.hints) &&
      row.hints.length === 3 &&
      // A hint containing the answer is not a hint.
      !row.hints.some((h) => String(h).toLowerCase().includes(String(row.answer).toLowerCase())),
  },
  'find-word-scrambles': {
    target: 20000,
    batch: 10,
    ask: (seedWords) =>
      `Write 10 word scrambles for a party game. Themes: ${seedWords}. Use everyday words of 5 to 9 letters.\n` +
      `Answer with ONE JSON array and nothing else, each item exactly:\n` +
      `{"answer":"the word","scramble":"the same letters in a different order"}`,
    valid: (row) => {
      if (!row?.answer || !row?.scramble) return false;
      // The model will happily hand back a "scramble" that is the word itself,
      // or one made of different letters. Both make an unplayable round.
      const sort = (s) => [...String(s).toLowerCase().replace(/[^a-z]/g, '')].sort().join('');
      return (
        row.answer.length >= 4 &&
        sort(row.answer) === sort(row.scramble) &&
        row.answer.toLowerCase() !== String(row.scramble).toLowerCase()
      );
    },
  },
  'poll-players': {
    target: 20000,
    batch: 10,
    ask: (seedWords) =>
      `Write 10 "who is most likely to…" prompts for a party game among college friends.\n` +
      `Themes: ${seedWords}. Teasing but warm — nothing that would actually hurt someone to be voted for.\n` +
      `Answer with ONE JSON array of plain strings and nothing else.`,
    valid: (row) => typeof row === 'string' && row.length > 12 && row.length < 140,
  },
  'poll-opinions': {
    target: 40000,
    batch: 8,
    ask: (seedWords) =>
      `Write 8 opinion polls for a party game — questions with no right answer that friends will argue about.\n` +
      `Themes: ${seedWords}.\n` +
      `Answer with ONE JSON array and nothing else, each item exactly:\n` +
      `{"q":"the question","options":["two","to","four","choices"]}`,
    valid: (row) =>
      row?.q?.length > 8 &&
      Array.isArray(row.options) &&
      row.options.length >= 2 &&
      row.options.length <= 4 &&
      new Set(row.options.map((o) => String(o).toLowerCase())).size === row.options.length,
  },
};

// Rotated through so every request asks for something slightly different —
// without this a model returns near-identical batches forever.
const SEEDS = [
  'cricket, Bollywood, physics', 'anime, coding, geography', 'history, music, food',
  'space, cartoons, sports', 'chemistry, memes, festivals', 'literature, football, apps',
  'biology, hip-hop, trains', 'mythology, cars, exams', 'maths, series, weather',
  'art, tech founders, animals', 'south indian cinema, rivers, board games',
  'K-pop, astronomy, street food', 'video games, politics of the past, inventions',
];

// Must agree with server/bank.js — a different notion of "the same item" here
// would let duplicates onto disk that the server then dutifully deals twice.
// It also has to cover the topics keyed by their answer rather than a question:
// keying those on the missing `q` would make every row look identical, and the
// dedupe would accept exactly one of them and reject the next ten thousand.
const keyOf = (row) =>
  String(typeof row === 'string' ? row : row.q ?? row.text ?? row.answer ?? JSON.stringify(row))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Models label their options "a) …" however firmly you ask them not to, and
 * the game already draws its own lettering — left alone it renders "a) a)".
 */
const unlabel = (s) => String(s).replace(/^\s*[a-dA-D][)._:]\s*/, '').trim();

function tidy(topic, row) {
  if (typeof row === 'string') return row.trim();
  if (topic === 'quiz') {
    const options = row.options.map(unlabel);
    const answer = unlabel(row.answer);
    return { ...row, options, answer, q: String(row.q).trim() };
  }
  // Opinion polls get the same lettering treatment — the client numbers the
  // choices itself, so a model-supplied "a)" renders twice over.
  if (topic === 'poll-opinions') {
    return { ...row, q: String(row.q).trim(), options: row.options.map(unlabel) };
  }
  return row;
}

/** Models wrap JSON in prose or fences however you ask them not to. */
function parseRows(text) {
  if (!text) return [];
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '');
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const rows = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function grow(topic, target) {
  const spec = TOPICS[topic];
  if (!spec) {
    console.error(`  unknown topic "${topic}" — try: ${Object.keys(TOPICS).join(', ')}`);
    return;
  }
  mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `${topic}.json`);

  let rows = [];
  if (existsSync(file)) {
    try {
      rows = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      rows = [];
    }
  }
  const seen = new Set(rows.map(keyOf));

  // What can be illustrated, settled once rather than per batch.
  const vocab = new Set(clueVocabulary());
  const vocabList = [...vocab].join(", ");
  if (spec.vocabulary && !vocab.size) {
    console.error("  no picture library yet — run: npm run clues");
    return;
  }

  console.log(`\n  ${topic}: ${rows.length} on disk, growing to ${target}\n`);
  const started = Date.now();
  let sinceSave = 0;
  let empties = 0;

  while (rows.length < target) {
    const seed = SEEDS[Math.floor(Math.random() * SEEDS.length)];
    // Topics that build picture clues are handed the words we actually hold
    // photographs for. Asking for anything else produces a grid with holes.
    const text = await say(spec.vocabulary ? spec.ask(seed, vocabList) : spec.ask(seed), { maxTokens: 1100, temperature: 1.0, raw: true });
    // Tidy first, then validate — the answer has to still match an option
    // after both have had their labels stripped.
    const batch = parseRows(text)
      .map((row) => {
        try {
          return tidy(topic, row);
        } catch {
          return null;
        }
      })
      .filter((row) => row && spec.valid(row, vocab));

    let added = 0;
    for (const row of batch) {
      const k = keyOf(row);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      rows.push(row);
      added += 1;
    }

    // A model that has stopped producing anything usable should not spin for
    // hours — stop and report rather than burning the machine.
    empties = added ? 0 : empties + 1;
    if (empties >= 12) {
      console.log(`  the model stopped producing usable rows — stopping at ${rows.length}`);
      break;
    }

    sinceSave += added;
    if (sinceSave >= 25) {
      writeFileSync(file, JSON.stringify(rows));
      sinceSave = 0;
      const mins = (Date.now() - started) / 60000;
      const rate = rows.length / Math.max(mins, 0.01);
      console.log(`  ${rows.length}/${target}  ·  ${Math.round(rate)}/min  ·  ${Math.round(mins)}m elapsed`);
    }
  }

  writeFileSync(file, JSON.stringify(rows));
  const kb = Math.round(Buffer.byteLength(JSON.stringify(rows)) / 1024);
  console.log(`\n  ${topic}: ${rows.length} items, ${kb} KB on disk\n`);
}

/* ---------------------------------- run ----------------------------------- */

if (!(await warmUpLLM())) {
  console.error('\n  No local model answering. Start Ollama, then run this again.\n');
  process.exit(1);
}
console.log(`  writing with ${llmModel()}`);

const [topicArg, countArg] = process.argv.slice(2);
if (topicArg) {
  await grow(topicArg, Number(countArg) || TOPICS[topicArg]?.target || 1000);
} else {
  for (const [topic, spec] of Object.entries(TOPICS)) await grow(topic, spec.target);
}
