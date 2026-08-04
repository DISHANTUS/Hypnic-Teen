// Builds the picture-clue library.
//
//   npm run clues              (fills in whatever is missing)
//   npm run clues -- --shots 3 (more photographs per word)
//
// The Bioscope round shows a numbered grid of photographs that decode into a
// title — a crow, a tray, some numbers. That needs a stock of real pictures
// for ordinary concrete words, which is what this downloads: Openverse, which
// is Creative-Commons-licensed and needs no key, into the media store on disk.
//
// It runs once, with internet. Everything after that — every match, every
// night on a hotspot with no signal — reads from the disk.
//
// Safe to stop and restart: it skips words it already has.

import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { CLUE_DIR, MEDIA_ROOT, loadClueIndex, saveClueIndex } from '../server/media.js';

if (!MEDIA_ROOT) {
  console.error('\n  No media store. Set MEDIA_DIR to a folder with room and try again.\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const SHOTS = Math.max(1, Math.min(5, Number(flag('shots', 2))));
const ONLY = flag('word', null);

/**
 * The vocabulary. These are the words a film or song title actually breaks
 * into once you are looking for pictures: concrete, photographable, and
 * unambiguous enough that six people in a room decode the same thing.
 *
 * Grouped only for reading — the fetcher treats it as one flat list.
 */
const WORDS = {
  creatures: [
    'crow', 'cat', 'dog', 'lion', 'tiger', 'elephant', 'snake', 'fish', 'butterfly', 'peacock',
    'horse', 'cow', 'monkey', 'owl', 'eagle', 'parrot', 'bee', 'spider', 'rat', 'goat',
    'deer', 'camel', 'frog', 'ant', 'sheep', 'bear', 'rabbit', 'swan', 'dove', 'shark',
  ],
  nature: [
    'moon', 'sun', 'star', 'cloud', 'rain', 'river', 'sea', 'mountain', 'tree', 'flower',
    'rose', 'leaf', 'fire', 'water', 'wind', 'snow', 'rainbow', 'sky', 'forest', 'desert',
    'beach', 'waterfall', 'lightning', 'island', 'stone', 'sand', 'wave', 'garden', 'grass', 'seed',
  ],
  people: [
    'girl', 'boy', 'man', 'woman', 'baby', 'king', 'queen', 'soldier', 'doctor', 'teacher',
    'farmer', 'police', 'dancer', 'singer', 'chef', 'student', 'friend', 'family', 'crowd', 'bride',
    'groom', 'mother', 'father', 'brother', 'sister', 'child', 'thief', 'driver', 'nurse', 'priest',
  ],
  things: [
    'tray', 'plate', 'cup', 'bottle', 'key', 'lock', 'clock', 'watch', 'book', 'pen',
    'phone', 'camera', 'mirror', 'chair', 'table', 'bed', 'door', 'window', 'ladder', 'rope',
    'knife', 'scissors', 'hammer', 'umbrella', 'bag', 'shoe', 'hat', 'ring', 'crown', 'lamp',
    'candle', 'balloon', 'kite', 'ball', 'drum', 'guitar', 'flute', 'bell', 'coin', 'money',
    'letter', 'map', 'flag', 'basket', 'box', 'brush', 'comb', 'needle', 'thread', 'vase',
  ],
  places: [
    'house', 'temple', 'church', 'school', 'hospital', 'market', 'bridge', 'road', 'railway', 'airport',
    'city', 'village', 'shop', 'restaurant', 'library', 'stadium', 'prison', 'palace', 'factory', 'farm',
  ],
  transport: [
    'car', 'bus', 'train', 'bicycle', 'motorcycle', 'boat', 'ship', 'aeroplane', 'helicopter', 'rocket',
    'tractor', 'digger', 'truck', 'auto-rickshaw', 'ambulance', 'taxi', 'scooter', 'cart', 'anchor', 'wheel',
  ],
  food: [
    'rice', 'bread', 'milk', 'egg', 'apple', 'banana', 'mango', 'coconut', 'tea', 'coffee',
    'sugar', 'salt', 'honey', 'chilli', 'onion', 'potato', 'lemon', 'grapes', 'cake', 'chocolate',
  ],
  body: [
    'eye', 'hand', 'foot', 'heart', 'head', 'hair', 'ear', 'nose', 'mouth', 'tooth',
    'finger', 'shoulder', 'knee', 'smile', 'tear', 'fist', 'palm', 'face', 'beard', 'shadow',
  ],
  ideas: [
    'love', 'war', 'dream', 'sleep', 'dance', 'song', 'story', 'game', 'race', 'fight',
    'wedding', 'birthday', 'festival', 'party', 'journey', 'gift', 'secret', 'lie', 'truth', 'silence',
    'numbers', 'letters', 'question-mark', 'arrow', 'circle', 'square', 'cross', 'heart-shape', 'chain', 'knot',
  ],
};

const ALL = ONLY ? [ONLY] : [...new Set(Object.values(WORDS).flat())];

/** A search that leans towards a clear single subject rather than a scene. */
const query = (word) => `${word.replace(/-/g, ' ')}`;

const normalise = (w) => String(w).toLowerCase().trim().replace(/\s+/g, '-');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(CLUE_DIR, { recursive: true });
const index = loadClueIndex();

console.log(`\n  Picture clues\n`);
console.log(`  store   ${MEDIA_ROOT}`);
console.log(`  words   ${ALL.length}, ${SHOTS} picture(s) each\n`);

let added = 0;
let skipped = 0;
let failed = [];

for (const [n, raw] of ALL.entries()) {
  const word = normalise(raw);
  const have = (index[word] ?? []).filter((s) => existsSync(path.join(CLUE_DIR, s.file)));
  if (have.length >= SHOTS) {
    index[word] = have;
    skipped += 1;
    continue;
  }

  let results = [];
  try {
    const url =
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query(word))}` +
      `&page_size=${SHOTS * 4}&license_type=commercial&mature=false&size=medium`;
    const res = await fetch(url, { headers: { 'user-agent': 'HypnicTeenFunWorld/1.0 (party game; offline cache)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    results = (await res.json()).results ?? [];
  } catch (err) {
    failed.push(`${word} (search: ${err.message})`);
    continue;
  }

  const shots = [...have];
  for (const hit of results) {
    if (shots.length >= SHOTS) break;
    // Prefer the pre-scaled copy: the originals run to several megabytes and
    // nothing here is ever shown larger than a phone screen.
    const src = hit.thumbnail || hit.url;
    if (!src) continue;
    const ext = (src.match(/\.(jpe?g|png|webp)(\?|$)/i)?.[1] ?? 'jpg').toLowerCase();
    const file = `${word}-${shots.length + 1}.${ext}`;
    const dest = path.join(CLUE_DIR, file);
    try {
      const img = await fetch(src, { headers: { 'user-agent': 'HypnicTeenFunWorld/1.0' } });
      if (!img.ok) throw new Error(`HTTP ${img.status}`);
      await pipeline(Readable.fromWeb(img.body), createWriteStream(dest));
      // A "picture" of four hundred bytes is an error page with an image
      // content-type, and it would show up in a match as a broken square.
      if (statSync(dest).size < 3000) {
        unlinkSync(dest);
        continue;
      }
      shots.push({
        file,
        credit: [hit.creator, hit.license && `CC ${hit.license.toUpperCase()}`].filter(Boolean).join(' · '),
        source: hit.foreign_landing_url ?? '',
      });
      added += 1;
    } catch {
      try {
        if (existsSync(dest)) unlinkSync(dest);
      } catch { /* nothing to clean */ }
    }
  }

  if (shots.length) index[word] = shots;
  else failed.push(word);

  if ((n + 1) % 10 === 0 || n === ALL.length - 1) {
    saveClueIndex(index);
    console.log(`  ${n + 1}/${ALL.length}  ·  ${added} downloaded, ${skipped} already here`);
  }
  // Openverse is a free service run for everyone; do not hammer it.
  await wait(350);
}

saveClueIndex(index);

const words = Object.keys(index).length;
const pictures = Object.values(index).reduce((n, s) => n + s.length, 0);
console.log(`\n  ${pictures} pictures for ${words} words`);
if (failed.length) console.log(`  no picture found for ${failed.length}: ${failed.slice(0, 12).join(', ')}${failed.length > 12 ? '…' : ''}`);
console.log('');
