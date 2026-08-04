// The Hypnic ID: every teen who walks into the studio answers a few questions
// and walks out with an identity nobody else has — Hypnic>ShadowFox<Teen.
//
// The keyword is DERIVED, not random: same name + age + answers always produce
// the same word, so the ID feels earned rather than handed out.
//
// Scale
// -----
// The word pools give ~3,400 clean two-part names. Past that, a short suffix in
// a 32-character alphabet is appended, widening as needed — which takes the
// space to roughly 3.7 trillion IDs while keeping the first few thousand
// members on a clean `PrefixCreature`. Uniqueness itself is guaranteed by the
// caller's `isTaken` probe, not by luck, so it holds no matter how full the
// studio gets. See tools/test-identity.mjs.

import { createHash } from 'node:crypto';

export const ID_PREFIX = 'Hypnic>';
export const ID_SUFFIX = '<Teen';

// No O/0/I/1 — people read these out loud and type them from memory.
const SUFFIX_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * The onboarding quiz. Each answer carries:
 *   prefix   - words that can start the keyword
 *   creature - words that can end it
 *   trait    - feeds the "spirit" label on the profile
 *   accent   - profile colour (only the colour question sets this)
 */
export const QUIZ = [
  {
    id: 'night',
    q: "It's 3AM and you're wide awake. What are you doing?",
    options: [
      { id: 'gaming', label: '🎮 One more match, I swear', prefix: ['Insomnia', 'Neon', 'Turbo', 'Pixel', 'Static', 'Arcade'], trait: 'Restless' },
      { id: 'music', label: '🎧 Headphones on, staring at the ceiling', prefix: ['Echo', 'Lunar', 'Velvet', 'Dream', 'Haze', 'Aria'], trait: 'Dreamer' },
      { id: 'snack', label: '🍜 Raiding the kitchen', prefix: ['Midnight', 'Hungry', 'Feral', 'Crumb', 'Nomad', 'Raider'], trait: 'Opportunist' },
      { id: 'study', label: '📚 Panicking about tomorrow', prefix: ['Wired', 'Frantic', 'Panic', 'Caffeine', 'Scramble', 'Jitter'], trait: 'Overthinker' },
    ],
  },
  {
    id: 'power',
    q: 'A shady figure offers you one power. You pick:',
    options: [
      { id: 'speed', label: '⚡ Impossible speed', prefix: ['Flash', 'Comet', 'Rapid', 'Bolt', 'Dash', 'Blitz'], trait: 'Reckless' },
      { id: 'invis', label: '👻 Turn invisible', prefix: ['Shadow', 'Phantom', 'Silent', 'Ghost', 'Veil', 'Mist'], trait: 'Sneaky' },
      { id: 'mind', label: '🧠 Read minds', prefix: ['Oracle', 'Psy', 'Cipher', 'Rune', 'Augur', 'Sage'], trait: 'Calculating' },
      { id: 'time', label: '⏳ Rewind 10 seconds', prefix: ['Chrono', 'Loop', 'Rewind', 'Epoch', 'Tempo', 'Warp'], trait: 'Perfectionist' },
    ],
  },
  {
    id: 'squad',
    q: 'Your squad is losing badly. You:',
    options: [
      { id: 'carry', label: '🔥 Go in alone and try to carry', creature: ['Tiger', 'Dragon', 'Wolf', 'Lion', 'Rhino', 'Falcon'], trait: 'Fearless' },
      { id: 'plan', label: '🗺️ Start calling shots', creature: ['Fox', 'Raven', 'Owl', 'Magpie', 'Lynx', 'Hawk'], trait: 'Tactician' },
      { id: 'chill', label: '😌 Laugh and keep playing', creature: ['Panda', 'Otter', 'Cat', 'Sloth', 'Koala', 'Seal'], trait: 'Chill' },
      { id: 'tilt', label: '💀 Full tilt, blame the WiFi', creature: ['Goblin', 'Gremlin', 'Hydra', 'Imp', 'Wraith', 'Basilisk'], trait: 'Chaotic' },
    ],
  },
  {
    id: 'canteen',
    q: 'Canteen run. Your order:',
    options: [
      { id: 'spicy', label: '🌶️ The spiciest thing they have', creature: ['Phoenix', 'Viper', 'Blaze', 'Cobra', 'Ember', 'Scorpion'], trait: 'Bold' },
      { id: 'sweet', label: '🍫 Something sweet, obviously', creature: ['Bunny', 'Moth', 'Robin', 'Cub', 'Finch', 'Fawn'], trait: 'Softie' },
      { id: 'chai', label: '☕ Just chai, thanks', creature: ['Crane', 'Monk', 'Ibis', 'Turtle', 'Egret', 'Heron'], trait: 'Calm' },
      { id: 'all', label: '🍕 Everything. All of it.', creature: ['Bear', 'Kraken', 'Titan', 'Mammoth', 'Bison', 'Colossus'], trait: 'Unstoppable' },
    ],
  },
  {
    id: 'colour',
    q: 'Pick the colour that feels like you:',
    options: [
      { id: 'violet', label: '🟣 Violet', accent: '#7c5cff', prefix: ['Nova', 'Astral', 'Amethyst', 'Iris', 'Cosmo', 'Vega'], trait: 'Mysterious' },
      { id: 'cyan', label: '🔵 Electric blue', accent: '#2de2e6', prefix: ['Frost', 'Volt', 'Glacier', 'Azure', 'Krypto', 'Tide'], trait: 'Sharp' },
      { id: 'pink', label: '🩷 Hot pink', accent: '#ff3d6e', prefix: ['Nitro', 'Rose', 'Blush', 'Flare', 'Candy', 'Siren'], trait: 'Loud' },
      { id: 'green', label: '🟢 Toxic green', accent: '#3ddc97', prefix: ['Venom', 'Jade', 'Fern', 'Toxin', 'Clover', 'Moss'], trait: 'Unpredictable' },
    ],
  },
  {
    id: 'win',
    q: 'Best way to win?',
    options: [
      { id: 'skill', label: '🎯 Out-skill everyone', trait: 'Sniper' },
      { id: 'trick', label: '🃏 Out-trick everyone', trait: 'Trickster' },
      { id: 'grind', label: '🪨 Out-last everyone', trait: 'Wall' },
      { id: 'luck', label: '🍀 Pure, undeserved luck', trait: 'Lucky' },
    ],
  },
];

/** Quiz shaped for the client - no scoring data leaks out. */
export function publicQuiz() {
  return QUIZ.map((q) => ({
    id: q.id,
    q: q.q,
    options: q.options.map((o) => ({ id: o.id, label: o.label })),
  }));
}

const FALLBACK_PREFIX = ['Hyper', 'Pixel', 'Zero', 'Lumen'];
const FALLBACK_CREATURE = ['Comet', 'Specter', 'Falcon', 'Rhino'];

/** Every distinct word available, for capacity reporting. */
export function keywordSpace() {
  const prefixes = new Set();
  const creatures = new Set();
  for (const question of QUIZ) {
    for (const option of question.options) {
      for (const p of option.prefix ?? []) prefixes.add(p);
      for (const c of option.creature ?? []) creatures.add(c);
    }
  }
  return { prefixes: prefixes.size, creatures: creatures.size, base: prefixes.size * creatures.size };
}

/**
 * Deterministic seeds from everything the player told us.
 *
 * Three independent slices of the hash, not one seed with different offsets:
 * `seed % 18` and `(seed + 7) % 12` move together, so a single seed could only
 * ever reach 36 of the 216 prefix/creature pairings available to an answer set.
 * Independent slices reach all of them.
 */
function seedsFrom(name, age, answers) {
  const material = `${name.toLowerCase().trim()}|${age}|${QUIZ.map((q) => answers[q.id] ?? '-').join(',')}`;
  const hex = createHash('sha256').update(material).digest('hex');
  return {
    prefix: parseInt(hex.slice(0, 8), 16),
    creature: parseInt(hex.slice(8, 16), 16),
    suffix: parseInt(hex.slice(16, 24), 16),
  };
}

const pick = (arr, seed) => arr[seed % arr.length];

/** Base-32 tag of a given length, drawn from the unambiguous alphabet. */
function tag(value, length) {
  let out = '';
  let v = value >>> 0;
  for (let i = 0; i < length; i++) {
    out = SUFFIX_ALPHABET[v % SUFFIX_ALPHABET.length] + out;
    v = Math.floor(v / SUFFIX_ALPHABET.length);
  }
  return out;
}

/**
 * Build the identity from the quiz.
 *
 * The clean `PrefixCreature` goes to whoever claims it first. After that the
 * probe widens a base-32 tag until it finds free space, so uniqueness never
 * depends on the pools being big enough — only on `isTaken` being honest.
 *
 * @param {{name:string, age:number, answers:Record<string,string>}} input
 * @param {(keyword:string)=>boolean} isTaken   must be O(1); see accounts.js
 */
export function deriveIdentity({ name, age, answers }, isTaken = () => false) {
  const chosen = QUIZ.map((q) => q.options.find((o) => o.id === answers[q.id])).filter(Boolean);

  const prefixes = chosen.flatMap((o) => o.prefix ?? []);
  const creatures = chosen.flatMap((o) => o.creature ?? []);
  const traits = chosen.map((o) => o.trait).filter(Boolean);
  const accent = chosen.find((o) => o.accent)?.accent ?? '#7c5cff';

  const seeds = seedsFrom(name, age, answers);
  const prefix = pick(prefixes.length ? prefixes : FALLBACK_PREFIX, seeds.prefix);
  const creature = pick(creatures.length ? creatures : FALLBACK_CREATURE, seeds.creature);

  // Two traits become the spirit line, e.g. "Sneaky Tactician".
  const spirit = traits.length >= 2 ? `${traits[1]} ${traits[traits.length - 1]}` : traits[0] || 'Wildcard';

  const base = `${prefix}${creature}`;
  const keyword = claim(base, seeds.suffix, isTaken);

  return { keyword, id: ID_PREFIX + keyword + ID_SUFFIX, accent, spirit, traits };
}

/** Finds free space for a base keyword, widening the tag as the studio fills. */
function claim(base, seed, isTaken) {
  if (!isTaken(base)) return base;

  // Golden-ratio stride so repeated attempts spread out instead of clustering.
  const STRIDE = 0x9e3779b1;
  for (let length = 2; length <= 6; length++) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = base + tag(seed + attempt * STRIDE, length);
      if (!isTaken(candidate)) return candidate;
    }
  }

  // Unreachable in practice; still terminates rather than looping forever.
  let n = 0;
  for (;;) {
    const candidate = base + tag(Date.now() + n, 7);
    if (!isTaken(candidate)) return candidate;
    n += 1;
  }
}

/** Accepts the full ID or just the keyword, and normalises it. */
export function normaliseId(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  if (s.startsWith(ID_PREFIX) && s.endsWith(ID_SUFFIX)) {
    s = s.slice(ID_PREFIX.length, -ID_SUFFIX.length);
  }
  s = s.replace(/[^A-Za-z0-9]/g, '');
  if (!s) return null;
  return ID_PREFIX + s + ID_SUFFIX;
}

export const keywordOf = (id) =>
  String(id).startsWith(ID_PREFIX) ? String(id).slice(ID_PREFIX.length, -ID_SUFFIX.length) : String(id);
