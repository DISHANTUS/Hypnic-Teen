// Where the heavy stuff lives.
//
// Picture clues, audio and any other bulk media do not belong in the repo —
// they are large, they are generated, and somebody cloning this project should
// get a working studio without waiting for a gigabyte of photographs. So they
// live outside it, on whatever disk has room, and the games ask for them by
// name through here.
//
// Set MEDIA_DIR to move the store. The default is the drive with space on the
// machine this was built on; if it is not there, the studio still runs and the
// games fall back to their text and emoji clues rather than refusing to start.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FALLBACK_ROOTS = [
  'G:\\hpnicteenstudio_data',
  path.join(process.env.USERPROFILE ?? '', 'hpnicteenstudio_data'),
  path.join(import.meta.dirname, '..', 'data', 'media'),
].filter(Boolean);

/**
 * Where the pictures live.
 *
 * MEDIA_DIR is an instruction, not a suggestion, so it wins even when it does
 * not exist yet — it was in the fallback list, and because the list picks the
 * first path that *already* exists, setting MEDIA_DIR to a fresh folder
 * silently landed everything in G:\ instead. Nothing failed; the files just
 * went somewhere else. A test found it by writing two rounds into the real
 * studio's store.
 */
function resolveRoot() {
  const asked = process.env.MEDIA_DIR;
  if (asked) {
    try {
      mkdirSync(asked, { recursive: true });
      return asked;
    } catch (err) {
      // Worth saying out loud rather than quietly using somewhere else, since
      // whoever set it will look for their files there.
      console.warn(`[media] cannot use MEDIA_DIR=${asked}: ${err.message}`);
    }
  }
  for (const dir of FALLBACK_ROOTS) {
    if (existsSync(dir)) return dir;
  }
  for (const dir of FALLBACK_ROOTS) {
    try {
      mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

export const MEDIA_ROOT = resolveRoot();
export const CLUE_DIR = MEDIA_ROOT ? path.join(MEDIA_ROOT, 'clues') : null;
const INDEX_FILE = MEDIA_ROOT ? path.join(MEDIA_ROOT, 'clues', 'index.json') : null;

if (MEDIA_ROOT) {
  try {
    mkdirSync(CLUE_DIR, { recursive: true });
  } catch {
    /* read-only store is fine — the games just find nothing */
  }
}

/* ------------------------------ the clue index ---------------------------- */

// word -> [ { file, credit, source } ]. Written by tools/fetch-clues.mjs and
// read here, so a running studio never touches the network.
let index = {};

export function loadClueIndex() {
  index = {};
  if (!INDEX_FILE || !existsSync(INDEX_FILE)) return index;
  try {
    index = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
  } catch (err) {
    console.warn(`[media] clue index unreadable: ${err.message}`);
  }
  const words = Object.keys(index).length;
  if (words) {
    const shots = Object.values(index).reduce((n, list) => n + list.length, 0);
    console.log(`[media] ${shots} clue pictures for ${words} words · ${MEDIA_ROOT}`);
  }
  return index;
}
loadClueIndex();

export function saveClueIndex(next) {
  if (!INDEX_FILE) return false;
  mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  writeFileSync(INDEX_FILE, JSON.stringify(next, null, 1));
  index = next;
  return true;
}

export const clueWords = () => Object.keys(index);
export const hasClue = (word) => Boolean(index[normalise(word)]?.length);

const normalise = (word) => String(word ?? '').toLowerCase().trim().replace(/\s+/g, '-');

/**
 * A picture for a word, as a URL the browser can fetch.
 *
 * `pick` chooses which of the cached shots to use, so the same word does not
 * show the same photograph in two rounds of the same match — pass the round
 * number and it rotates.
 */
export function clueFor(word, pick = 0) {
  const key = normalise(word);
  const shots = index[key];
  if (!shots?.length) return null;
  const shot = shots[Math.abs(pick) % shots.length];
  return { word: key, url: `/media/clues/${encodeURIComponent(shot.file)}`, credit: shot.credit ?? '' };
}

/** Every word we could illustrate, for a generator deciding what to ask for. */
export function clueVocabulary() {
  return Object.entries(index)
    .filter(([, shots]) => shots.length)
    .map(([word]) => word);
}

/** Used by the launcher to report the store's state in one line. */
export function mediaStatus() {
  if (!MEDIA_ROOT) return { root: null, words: 0, pictures: 0 };
  let files = 0;
  try {
    files = readdirSync(CLUE_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).length;
  } catch {
    /* not created yet */
  }
  return { root: MEDIA_ROOT, words: Object.keys(index).length, pictures: files };
}
