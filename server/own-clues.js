// Picture rounds written by the people who will play them.
//
// The generated ones were not good enough. A model breaking a title into
// photographable words produces clues that do not decode, and mapping the
// emoji a card already carries only works when the emoji happen to be
// concrete. Neither knows which songs this particular room actually knows.
//
// So the best rounds are the ones your friends write. This reads them off
// disk, in the simplest shape a person can produce without being taught a
// format: one folder per song, the folder named after the answer, the photos
// inside it, and a clues.txt of one clue per line.
//
//   my-clues/
//     Naatu Naatu/
//       1.jpg
//       2.jpg
//       clues.txt      "From RRR" / "Two men dancing in front of a palace"
//
// Numbered filenames set the order the pictures are shown in. Anything the
// folder cannot supply is simply left out, so a half-finished folder still
// plays rather than breaking the game.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { MEDIA_ROOT } from './media.js';

export const OWN_DIR = MEDIA_ROOT ? path.join(MEDIA_ROOT, 'my-clues') : null;

const PICTURE = /\.(jpe?g|png|webp|gif)$/i;

/** Written once so the folder explains itself to whoever opens it. */
const README = `HOW TO ADD YOUR OWN PICTURE ROUNDS
==================================

Make one folder per song or film. Name the folder exactly what the answer is.

  my-clues/
    Naatu Naatu/
      1.jpg
      2.jpg
      3.jpg
      clues.txt

The pictures are shown in filename order, so name them 1, 2, 3.
Two to six pictures works best.

clues.txt is optional. Put one clue on each line — they are shown one at a
time if nobody guesses from the pictures alone:

  From RRR
  Two men dancing in front of a palace

That is all. Drop the folder in, restart the studio, and it is in the game.
Anything missing is just left out: no clues.txt is fine, and a folder with
one picture is skipped rather than shown half-empty.
`;

if (OWN_DIR && !existsSync(OWN_DIR)) {
  try {
    mkdirSync(OWN_DIR, { recursive: true });
    writeFileSync(path.join(OWN_DIR, 'READ ME FIRST.txt'), README);
  } catch {
    /* a store we cannot write to is one we simply do not use */
  }
}

/**
 * Everything on disk, as cards the games can deal.
 *
 * Read once at boot and again on demand, because the whole point is that
 * somebody drops a folder in during the week and it is there next time.
 */
export function loadOwnClues() {
  if (!OWN_DIR || !existsSync(OWN_DIR)) return [];

  const cards = [];
  for (const entry of readdirSync(OWN_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(OWN_DIR, entry.name);

    let files;
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }

    // Filename order is the order they are shown in, so "10" must not sort
    // before "2" — which a plain sort does, and which would scramble a clue
    // sequence somebody thought about.
    const pictures = files
      .filter((f) => PICTURE.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    // One picture is not a picture round.
    if (pictures.length < 2) continue;

    let clues = [];
    const cluesFile = path.join(dir, 'clues.txt');
    if (existsSync(cluesFile)) {
      try {
        clues = readFileSync(cluesFile, 'utf8')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 4);
      } catch {
        /* an unreadable clues.txt costs the hints, not the round */
      }
    }

    cards.push({
      // The folder name is the answer, which is what makes this writable by
      // somebody who has never opened a JSON file.
      answer: entry.name.trim(),
      own: true,
      clues,
      pictures: pictures.map((f) => ({
        url: `/media/mine/${encodeURIComponent(entry.name)}/${encodeURIComponent(f)}`,
      })),
    });
  }
  return cards;
}

let cache = loadOwnClues();
let cachedAt = Date.now();

/** Re-read if the folder has been touched since we last looked. */
export function ownClues() {
  if (!OWN_DIR) return [];
  try {
    const changed = statSync(OWN_DIR).mtimeMs > cachedAt;
    if (changed || Date.now() - cachedAt > 60_000) {
      cache = loadOwnClues();
      cachedAt = Date.now();
    }
  } catch {
    /* keep whatever we last had */
  }
  return cache;
}

export function ownCluesStatus() {
  const cards = ownClues();
  return {
    dir: OWN_DIR,
    cards: cards.length,
    pictures: cards.reduce((n, c) => n + c.pictures.length, 0),
  };
}
