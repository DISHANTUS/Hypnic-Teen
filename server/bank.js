// The content bank: what a game asks for material, and what remembers it.
//
// Two problems this solves, both of which show up on the third night rather
// than the first:
//
//   Repetition — the built-in banks are small, so a game that shuffles them
//   freshly every match still deals the same questions. This keeps a rolling
//   memory of what has been used and hands out unseen items first, only
//   recycling once the whole bank has genuinely been through.
//
//   Growth — generated material (tools/grow-bank.mjs writes it with the local
//   model) is loaded from data/bank/*.json at boot and merged in. Adding
//   fifty thousand questions is dropping a file in, no code change.
//
// Nothing here is allowed to fail a game: a missing file, a corrupt file or an
// exhausted bank all fall back to the built-in list.

import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(import.meta.dirname, '..', 'data');
const BANK_DIR = path.join(DATA_DIR, 'bank');
const SEEN_FILE = path.join(DATA_DIR, 'seen.json');

/** How much of a bank to burn through before allowing repeats. */
const RECYCLE_AT = 0.85;

/* ------------------------------- generated ------------------------------- */

const generated = new Map(); // topic -> array of items

function loadGenerated() {
  if (!existsSync(BANK_DIR)) return;
  for (const file of readdirSync(BANK_DIR)) {
    if (!file.endsWith('.json')) continue;
    const topic = file.replace(/\.json$/, '');
    try {
      const rows = JSON.parse(readFileSync(path.join(BANK_DIR, file), 'utf8'));
      if (Array.isArray(rows) && rows.length) {
        generated.set(topic, rows);
      }
    } catch (err) {
      console.warn(`[bank] ignoring ${file}: ${err.message}`);
    }
  }
  const total = [...generated.values()].reduce((n, rows) => n + rows.length, 0);
  if (total) console.log(`[bank] ${total} generated items across ${generated.size} topics`);
}
loadGenerated();

/** Re-reads the generated banks — used after a generation run tops them up. */
export function reloadBank() {
  generated.clear();
  loadGenerated();
}

export function bankSize(topic, builtIn = []) {
  return builtIn.length + (generated.get(topic)?.length ?? 0);
}

/* --------------------------------- memory -------------------------------- */

// topic -> Set of keys already dealt. Persisted so restarting the server does
// not reset everyone's question history mid-party.
const seen = new Map();

try {
  if (existsSync(SEEN_FILE)) {
    for (const [topic, keys] of Object.entries(JSON.parse(readFileSync(SEEN_FILE, 'utf8')))) {
      seen.set(topic, new Set(keys));
    }
  }
} catch {
  /* a corrupt history is not worth refusing to start over */
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  // Batched: a busy night would otherwise write this file every few seconds.
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      const out = {};
      for (const [topic, keys] of seen) out[topic] = [...keys];
      writeFileSync(SEEN_FILE, JSON.stringify(out));
    } catch (err) {
      console.warn(`[bank] could not save history: ${err.message}`);
    }
  }, 5000);
  saveTimer.unref?.();
}

/** What makes two items "the same question" — the text, however it is shaped. */
function keyOf(item) {
  const text = typeof item === 'string' ? item : item?.q ?? item?.text ?? item?.answer ?? JSON.stringify(item);
  return String(text).slice(0, 120).toLowerCase().replace(/\s+/g, ' ').trim();
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Deals `count` items for a topic, preferring ones nobody has been served yet.
 *
 * @param {string} topic     what to remember this under, e.g. 'quiz:movies'
 * @param {any[]} builtIn    the shipped bank for this topic
 * @param {number} count     how many are wanted
 */
export function deal(topic, builtIn, count) {
  const pool = [...(builtIn ?? []), ...(generated.get(topic) ?? [])];
  if (!pool.length) return [];

  const used = seen.get(topic) ?? new Set();

  // Once nearly everything has been dealt, wipe the slate — otherwise the last
  // few items would repeat forever while the rest stayed locked away.
  if (used.size >= pool.length * RECYCLE_AT) used.clear();

  const fresh = [];
  const stale = [];
  for (const item of pool) (used.has(keyOf(item)) ? stale : fresh).push(item);

  // Fresh material first, and only top up from the old once it runs out.
  const picked = [...shuffle(fresh), ...shuffle(stale)].slice(0, count);
  for (const item of picked) used.add(keyOf(item));
  seen.set(topic, used);
  scheduleSave();
  return picked;
}

/** How much of a topic is still unseen — surfaced so a low bank is visible. */
export function freshness(topic, builtIn = []) {
  const total = bankSize(topic, builtIn);
  const used = seen.get(topic)?.size ?? 0;
  return { total, used, left: Math.max(0, total - used) };
}
