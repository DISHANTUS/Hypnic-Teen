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
 *   prefix     - words that can start the keyword
 *   creature   - words that can end it
 *   trait      - the one-word character of this answer, kept for reading
 *   adjectives - the first half of the spirit line
 *   nouns      - the second half
 *   accent     - profile colour (only the colour question sets this)
 *
 * Why both a trait and a pile of words
 * ------------------------------------
 * The spirit line used to be `traits[1] + ' ' + traits[last]` — the power
 * answer next to the winning answer. Four options each, so the entire studio
 * shared **sixteen** possible titles, and with twenty-odd members the room was
 * full of Sneaky Snipers looking at other Sneaky Snipers. A title nobody else
 * has is the whole point of the thing; sixteen of them is a uniform.
 *
 * So every answer now carries six adjectives or six nouns of its own flavour.
 * The first three questions supply adjectives and the last three supply nouns,
 * which makes the studio-wide space 72 × 72 — a little over five thousand — and
 * gives any one player 18 × 18 = 324 titles their own answers could have
 * produced, with the seed choosing one. Two people who answered identically
 * still differ, because the seed includes their name and age.
 *
 * The trait is kept because it reads as a summary and because the quiz is worth
 * being able to explain: it is what that answer *means*, and the six words are
 * six ways of saying it.
 */
export const QUIZ = [
  {
    id: 'night',
    q: "It's 3AM and you're wide awake. What are you doing?",
    options: [
      {
        id: 'gaming', label: '🎮 One more match, I swear', trait: 'Restless',
        prefix: ['Insomnia', 'Neon', 'Turbo', 'Pixel', 'Static', 'Arcade'],
        adjectives: ['Sleepless', 'Wired', 'Nocturnal', 'Unblinking', 'Relentless', 'Caffeinated'],
      },
      {
        id: 'music', label: '🎧 Headphones on, staring at the ceiling', trait: 'Dreamer',
        prefix: ['Echo', 'Lunar', 'Velvet', 'Dream', 'Haze', 'Aria'],
        adjectives: ['Dreaming', 'Faraway', 'Velvet', 'Wistful', 'Drifting', 'Half-Awake'],
      },
      {
        id: 'snack', label: '🍜 Raiding the kitchen', trait: 'Opportunist',
        prefix: ['Midnight', 'Hungry', 'Feral', 'Crumb', 'Nomad', 'Raider'],
        adjectives: ['Ravenous', 'Shameless', 'Prowling', 'Midnight', 'Unrepentant', 'Foraging'],
      },
      {
        id: 'study', label: '📚 Panicking about tomorrow', trait: 'Overthinker',
        prefix: ['Wired', 'Frantic', 'Panic', 'Caffeine', 'Scramble', 'Jitter'],
        adjectives: ['Frantic', 'Overthinking', 'Jittery', 'Second-Guessing', 'Underslept', 'Cramming'],
      },
    ],
  },
  {
    id: 'power',
    q: 'A shady figure offers you one power. You pick:',
    options: [
      {
        id: 'speed', label: '⚡ Impossible speed', trait: 'Reckless',
        prefix: ['Flash', 'Comet', 'Rapid', 'Bolt', 'Dash', 'Blitz'],
        adjectives: ['Reckless', 'Headlong', 'Impatient', 'Breakneck', 'Impulsive', 'Hurtling'],
      },
      {
        id: 'invis', label: '👻 Turn invisible', trait: 'Sneaky',
        prefix: ['Shadow', 'Phantom', 'Silent', 'Ghost', 'Veil', 'Mist'],
        adjectives: ['Sneaky', 'Unseen', 'Slippery', 'Shadowed', 'Uninvited', 'Quiet'],
      },
      {
        id: 'mind', label: '🧠 Read minds', trait: 'Calculating',
        prefix: ['Oracle', 'Psy', 'Cipher', 'Rune', 'Augur', 'Sage'],
        adjectives: ['Calculating', 'Knowing', 'Shrewd', 'Watchful', 'Unsurprised', 'Three-Moves-Ahead'],
      },
      {
        id: 'time', label: '⏳ Rewind 10 seconds', trait: 'Perfectionist',
        prefix: ['Chrono', 'Loop', 'Rewind', 'Epoch', 'Tempo', 'Warp'],
        adjectives: ['Precise', 'Exacting', 'Methodical', 'Immaculate', 'Rehearsed', 'Unhurried'],
      },
    ],
  },
  {
    id: 'squad',
    q: 'Your squad is losing badly. You:',
    options: [
      {
        id: 'carry', label: '🔥 Go in alone and try to carry', trait: 'Fearless',
        creature: ['Tiger', 'Dragon', 'Wolf', 'Lion', 'Rhino', 'Falcon'],
        adjectives: ['Fearless', 'Stubborn', 'Immovable', 'Defiant', 'Unbothered', 'One-Man-Army'],
      },
      {
        id: 'plan', label: '🗺️ Start calling shots', trait: 'Tactician',
        creature: ['Fox', 'Raven', 'Owl', 'Magpie', 'Lynx', 'Hawk'],
        adjectives: ['Tactical', 'Deliberate', 'Scheming', 'Composed', 'Measured', 'Cold-Blooded'],
      },
      {
        id: 'chill', label: '😌 Laugh and keep playing', trait: 'Chill',
        creature: ['Panda', 'Otter', 'Cat', 'Sloth', 'Koala', 'Seal'],
        adjectives: ['Easygoing', 'Cheerful', 'Unshakeable', 'Serene', 'Amused', 'Unbothered'],
      },
      {
        id: 'tilt', label: '💀 Full tilt, blame the WiFi', trait: 'Chaotic',
        creature: ['Goblin', 'Gremlin', 'Hydra', 'Imp', 'Wraith', 'Basilisk'],
        adjectives: ['Chaotic', 'Feral', 'Unhinged', 'Volatile', 'Cursed', 'Doomed'],
      },
    ],
  },
  {
    id: 'canteen',
    q: 'Canteen run. Your order:',
    options: [
      {
        id: 'spicy', label: '🌶️ The spiciest thing they have', trait: 'Bold',
        creature: ['Phoenix', 'Viper', 'Blaze', 'Cobra', 'Ember', 'Scorpion'],
        nouns: ['Firebrand', 'Menace', 'Furnace', 'Wildfire', 'Spark', 'Dare'],
      },
      {
        id: 'sweet', label: '🍫 Something sweet, obviously', trait: 'Softie',
        creature: ['Bunny', 'Moth', 'Robin', 'Cub', 'Finch', 'Fawn'],
        nouns: ['Softie', 'Sweetheart', 'Marshmallow', 'Daydream', 'Cub', 'Sugarcube'],
      },
      {
        id: 'chai', label: '☕ Just chai, thanks', trait: 'Calm',
        creature: ['Crane', 'Monk', 'Ibis', 'Turtle', 'Egret', 'Heron'],
        nouns: ['Monk', 'Sage', 'Regular', 'Philosopher', 'Kettle', 'Elder'],
      },
      {
        id: 'all', label: '🍕 Everything. All of it.', trait: 'Unstoppable',
        creature: ['Bear', 'Kraken', 'Titan', 'Mammoth', 'Bison', 'Colossus'],
        nouns: ['Colossus', 'Appetite', 'Machine', 'Titan', 'Vortex', 'Landslide'],
      },
    ],
  },
  {
    id: 'colour',
    q: 'Pick the colour that feels like you:',
    options: [
      {
        id: 'violet', label: '🟣 Violet', accent: '#7c5cff', trait: 'Mysterious',
        prefix: ['Nova', 'Astral', 'Amethyst', 'Iris', 'Cosmo', 'Vega'],
        nouns: ['Enigma', 'Oracle', 'Riddle', 'Mirage', 'Secret', 'Omen'],
      },
      {
        id: 'cyan', label: '🔵 Electric blue', accent: '#2de2e6', trait: 'Sharp',
        prefix: ['Frost', 'Volt', 'Glacier', 'Azure', 'Krypto', 'Tide'],
        nouns: ['Blade', 'Circuit', 'Frost', 'Signal', 'Scalpel', 'Prism'],
      },
      {
        id: 'pink', label: '🩷 Hot pink', accent: '#ff3d6e', trait: 'Loud',
        prefix: ['Nitro', 'Rose', 'Blush', 'Flare', 'Candy', 'Siren'],
        nouns: ['Siren', 'Firework', 'Anthem', 'Riot', 'Megaphone', 'Headline'],
      },
      {
        id: 'green', label: '🟢 Toxic green', accent: '#3ddc97', trait: 'Unpredictable',
        prefix: ['Venom', 'Jade', 'Fern', 'Toxin', 'Clover', 'Moss'],
        nouns: ['Wildcard', 'Glitch', 'Gremlin', 'Weathervane', 'Coin-Flip', 'Rumour'],
      },
    ],
  },
  {
    id: 'win',
    q: 'Best way to win?',
    options: [
      {
        id: 'skill', label: '🎯 Out-skill everyone', trait: 'Sniper',
        nouns: ['Sniper', 'Marksman', 'Specialist', 'Surgeon', 'Craftsman', 'Ace'],
      },
      {
        id: 'trick', label: '🃏 Out-trick everyone', trait: 'Trickster',
        nouns: ['Trickster', 'Magician', 'Bluff', 'Fox', 'Illusionist', 'Pickpocket'],
      },
      {
        id: 'grind', label: '🪨 Out-last everyone', trait: 'Wall',
        nouns: ['Wall', 'Anchor', 'Fortress', 'Mountain', 'Marathon', 'Bulwark'],
      },
      {
        id: 'luck', label: '🍀 Pure, undeserved luck', trait: 'Lucky',
        nouns: ['Charm', 'Fluke', 'Horseshoe', 'Longshot', 'Miracle', 'Coincidence'],
      },
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
const FALLBACK_ADJECTIVE = ['Unlabelled', 'Unusual', 'Unwritten', 'Offbeat'];
const FALLBACK_NOUN = ['Wildcard', 'Unknown', 'Stranger', 'Newcomer'];

/**
 * The spirit line: one adjective and one noun, out of everything the answers
 * put on the table.
 *
 * A half-finished quiz still has to produce something — somebody who answered
 * two questions is not getting an error where their title should be — so each
 * half falls back to its own small pool rather than to the other half.
 */
export function spiritFrom(chosen, seeds) {
  const adjectives = chosen.flatMap((o) => o.adjectives ?? []);
  const nouns = chosen.flatMap((o) => o.nouns ?? []);
  const adjective = pick(adjectives.length ? adjectives : FALLBACK_ADJECTIVE, seeds.adjective);
  const noun = pick(nouns.length ? nouns : FALLBACK_NOUN, seeds.noun);
  return `${adjective} ${noun}`;
}

/** How many distinct spirit lines the studio can hand out, for reporting. */
export function spiritSpace() {
  const adjectives = new Set();
  const nouns = new Set();
  for (const question of QUIZ) {
    for (const option of question.options) {
      for (const a of option.adjectives ?? []) adjectives.add(a);
      for (const n of option.nouns ?? []) nouns.add(n);
    }
  }
  return {
    adjectives: adjectives.size,
    nouns: nouns.size,
    total: adjectives.size * nouns.size,
  };
}

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
    // The spirit needs two of its own, for the same reason the keyword does:
    // reusing a slice with an offset walks the two picks in lockstep and
    // collapses the grid to a diagonal.
    adjective: parseInt(hex.slice(24, 32), 16),
    noun: parseInt(hex.slice(32, 40), 16),
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

  const spirit = spiritFrom(chosen, seeds);

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
