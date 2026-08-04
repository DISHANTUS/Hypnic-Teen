// Which cinema, and which corner of it.
//
// "Guess the movie" is a different game in Chennai and in Seoul, and a room
// full of people who watch Tamil films should not be shown Marvel. So both the
// film game and the song game take a language, and each language brings its
// own genres — Korean has dramas and thrillers, Tamil has masala and rural
// drama, anime has shōnen. Offering one flat genre list would mean showing
// somebody "K-drama" for a Tamil round.
//
// Shared by movies.js and songs.js because the picker is the same picker and
// two copies of it would drift apart within a week.

/** The catalogues, and what each one is actually made of. */
export const LANGUAGES = {
  any: {
    label: 'Everything',
    note: 'all languages mixed',
    genres: ['action', 'romance', 'comedy', 'thriller', 'drama', 'horror'],
  },
  tamil: {
    label: 'Tamil',
    note: 'Kollywood',
    genres: ['action', 'romance', 'comedy', 'thriller', 'rural-drama', 'gangster'],
  },
  telugu: {
    label: 'Telugu',
    note: 'Tollywood',
    genres: ['action', 'romance', 'comedy', 'family-drama', 'period', 'thriller'],
  },
  hindi: {
    label: 'Hindi',
    note: 'Bollywood',
    genres: ['action', 'romance', 'comedy', 'thriller', 'family-drama', 'patriotic'],
  },
  malayalam: {
    label: 'Malayalam',
    note: 'Mollywood',
    genres: ['drama', 'thriller', 'comedy', 'crime', 'realism', 'romance'],
  },
  kannada: {
    label: 'Kannada',
    note: 'Sandalwood',
    genres: ['action', 'drama', 'romance', 'thriller', 'period'],
  },
  english: {
    label: 'English',
    note: 'Hollywood and beyond',
    genres: ['action', 'sci-fi', 'superhero', 'romance', 'comedy', 'horror'],
  },
  korean: {
    label: 'Korean',
    note: 'K-drama and K-cinema',
    genres: ['k-drama', 'thriller', 'romance', 'historical', 'crime', 'comedy'],
  },
  japanese: {
    label: 'Japanese',
    note: 'live action',
    genres: ['drama', 'thriller', 'romance', 'samurai', 'horror'],
  },
  anime: {
    label: 'Anime',
    note: 'series and films',
    genres: ['shonen', 'slice-of-life', 'fantasy', 'mecha', 'romance', 'psychological'],
  },
};

/** Titles people would recognise, not the ones a search engine would rank. */
const GENRE_LABELS = {
  action: 'Action',
  romance: 'Romance',
  comedy: 'Comedy',
  thriller: 'Thriller',
  drama: 'Drama',
  horror: 'Horror',
  'sci-fi': 'Sci-fi',
  superhero: 'Superhero',
  'rural-drama': 'Rural drama',
  gangster: 'Gangster',
  'family-drama': 'Family drama',
  period: 'Period',
  patriotic: 'Patriotic',
  crime: 'Crime',
  realism: 'Realism',
  'k-drama': 'K-drama',
  historical: 'Historical',
  samurai: 'Samurai',
  shonen: 'Shōnen',
  'slice-of-life': 'Slice of life',
  fantasy: 'Fantasy',
  mecha: 'Mecha',
  psychological: 'Psychological',
};

export const languageChoices = () =>
  Object.entries(LANGUAGES).map(([id, spec]) => ({ id, label: spec.label, note: spec.note }));

/** The genres that exist inside one language, plus the option not to care. */
export function genreChoices(language) {
  const spec = LANGUAGES[language] ?? LANGUAGES.any;
  return [
    { id: 'any', label: 'Any', note: 'whatever comes up' },
    ...spec.genres.map((id) => ({ id, label: GENRE_LABELS[id] ?? id })),
  ];
}

/**
 * The two knobs, rebuilt for whatever language is currently chosen. Handed to
 * a game's `refineOptions` so the lobby offers Tamil genres for Tamil and
 * K-drama only where it exists.
 */
export function pickerOptions(settings = {}, { languageHint = 'Which cinema', genreHint = 'Narrow it down' } = {}) {
  const language = LANGUAGES[settings.language] ? settings.language : 'any';
  return {
    language: {
      label: 'Language',
      hint: languageHint,
      kind: 'choice',
      default: 'any',
      choices: languageChoices(),
    },
    genre: {
      label: 'Genre',
      hint: genreHint,
      kind: 'choice',
      default: 'any',
      choices: genreChoices(language),
    },
  };
}

/**
 * A Bioscope round: the title as a numbered strip of photographs.
 *
 * The television version shows six pictures — a crow, a tray, a pile of
 * numbers — and the room shouts the song title. Each picture stands for a
 * word, a sound, or a piece of one, and the fun is entirely in the decoding.
 *
 * A card only becomes a Bioscope round if every word it needs has a picture on
 * disk. A grid with two photographs and four grey squares is worse than no
 * grid at all, so anything short falls back to the emoji clue it already had.
 *
 * @param {{clues?: string[]}} card   from the bank, with its decomposition
 * @param {(word:string, pick:number)=>({url:string}|null)} lookup
 * @param {number} salt   rotates which photograph of a word is used
 */
export function bioscopeFor(card, lookup, salt = 0) {
  // Two sources, in order of trust.
  //
  // A `clues` array is a decomposition somebody wrote down deliberately. Where
  // there is none, the emoji clue the card already carries is used instead —
  // and that turns out to be the better source anyway. Every card in the bank
  // already has 4–6 emoji chosen to stand for the title, which is exactly what
  // a Bioscope strip is; translating those into photographs is a lookup, not a
  // guess. Asking a language model to invent the decomposition instead
  // produced "Koi Mil Gaya = crow + moon", which decodes to nothing.
  const words = Array.isArray(card?.clues) && card.clues.length
    ? card.clues.filter(Boolean)
    : wordsFromEmoji(card?.emoji);
  if (words.length < 2) return null;

  const frames = [];
  for (const [i, word] of words.entries()) {
    const shot = lookup(word, salt + i);
    if (!shot) return null; // one missing picture and the whole grid is a lie
    frames.push({ n: i + 1, url: shot.url, credit: shot.credit ?? '' });
  }
  return frames;
}

/**
 * The emoji a card already carries, as words we hold photographs of.
 *
 * Only emoji that map to something concrete are listed — a picture of "love"
 * or "sparkles" tells nobody anything, so those are dropped and the strip is
 * built from whatever is left. If too little survives, the card stays an
 * ordinary emoji round.
 */
const EMOJI_WORDS = {
  '👑': 'crown', '🦁': 'lion', '🕷': 'spider', '🕸': 'spider', '🤖': 'robot',
  '🔫': 'gun', '🚗': 'car', '🚙': 'car', '🚕': 'taxi', '🚌': 'bus', '🚂': 'train',
  '🚆': 'train', '🚲': 'bicycle', '🏍': 'motorcycle', '✈': 'aeroplane', '🚁': 'helicopter',
  '🚀': 'rocket', '🚢': 'ship', '⛵': 'boat', '⚓': 'anchor', '🚜': 'tractor',
  '🌙': 'moon', '🌕': 'moon', '☀': 'sun', '⭐': 'star', '🌟': 'star', '☁': 'cloud',
  '🌧': 'rain', '🌈': 'rainbow', '❄': 'snow', '⚡': 'lightning', '🔥': 'fire',
  '💧': 'water', '🌊': 'wave', '🏔': 'mountain', '⛰': 'mountain', '🌲': 'tree',
  '🌳': 'tree', '🌸': 'flower', '🌹': 'rose', '🍃': 'leaf', '🏝': 'island',
  '🏖': 'beach', '🏜': 'desert', '🌍': 'earth', '🌾': 'grass',
  '🐱': 'cat', '🐶': 'dog', '🐕': 'dog', '🐅': 'tiger', '🐘': 'elephant',
  '🐍': 'snake', '🐟': 'fish', '🦈': 'shark', '🦋': 'butterfly', '🦚': 'peacock',
  '🐴': 'horse', '🐄': 'cow', '🐵': 'monkey', '🦉': 'owl', '🦅': 'eagle',
  '🦜': 'parrot', '🐝': 'bee', '🐀': 'rat', '🐐': 'goat', '🦌': 'deer',
  '🐪': 'camel', '🐸': 'frog', '🐜': 'ant', '🐑': 'sheep', '🐻': 'bear',
  '🐰': 'rabbit', '🦢': 'swan', '🕊': 'dove', '🐦': 'crow', '🦇': 'bat',
  '👧': 'girl', '👦': 'boy', '👨': 'man', '👩': 'woman', '👶': 'baby',
  '🤴': 'king', '👸': 'queen', '💂': 'soldier', '👮': 'police', '👨‍⚕': 'doctor',
  '👩‍🏫': 'teacher', '🧑‍🌾': 'farmer', '💃': 'dancer', '🕺': 'dancer',
  '🎤': 'singer', '👰': 'bride', '🤵': 'groom', '👪': 'family',
  '❤': 'heart', '💔': 'heart', '👁': 'eye', '👀': 'eye', '✋': 'hand',
  '🦶': 'foot', '💇': 'hair', '👂': 'ear', '👃': 'nose', '👄': 'mouth',
  '🦷': 'tooth', '😊': 'smile', '😢': 'tear', '✊': 'fist',
  '🔑': 'key', '🔒': 'lock', '🕐': 'clock', '⏰': 'clock', '⌚': 'watch',
  '📖': 'book', '📚': 'book', '✏': 'pen', '📱': 'phone', '📷': 'camera',
  '🪞': 'mirror', '🪑': 'chair', '🛏': 'bed', '🚪': 'door', '🪟': 'window',
  '🪜': 'ladder', '🔪': 'knife', '✂': 'scissors', '🔨': 'hammer', '☂': 'umbrella',
  '🎒': 'bag', '👟': 'shoe', '🎩': 'hat', '💍': 'ring', '🪔': 'lamp',
  '🕯': 'candle', '🎈': 'balloon', '🪁': 'kite', '⚽': 'ball', '🥁': 'drum',
  '🎸': 'guitar', '🎺': 'flute', '🔔': 'bell', '🪙': 'coin', '💰': 'money',
  '✉': 'letter', '🗺': 'map', '🏳': 'flag', '🧺': 'basket', '📦': 'box',
  '🏠': 'house', '🏡': 'house', '🛕': 'temple', '⛪': 'church', '🏫': 'school',
  '🏥': 'hospital', '🌉': 'bridge', '🛣': 'road', '🏙': 'city', '🏰': 'palace',
  '🏭': 'factory', '🏟': 'stadium', '🍚': 'rice', '🍞': 'bread', '🥛': 'milk',
  '🥚': 'egg', '🍎': 'apple', '🍌': 'banana', '🥭': 'mango', '🥥': 'coconut',
  '🍵': 'tea', '☕': 'coffee', '🍋': 'lemon', '🍇': 'grapes', '🍰': 'cake',
  '🍫': 'chocolate', '🧅': 'onion', '🥔': 'potato', '🌶': 'chilli',
  '💤': 'sleep', '💒': 'wedding', '🎂': 'birthday', '🎁': 'gift', '⚔': 'war',
  '🎭': 'story', '🎲': 'game', '🏁': 'race', '🔢': 'numbers', '🔠': 'letters',
  '❓': 'question-mark', '➡': 'arrow', '⛓': 'chain', '⚫': 'circle', '⬛': 'square',
};

function wordsFromEmoji(emoji) {
  if (!emoji) return [];
  // Variation selectors and skin tones would stop any of these matching.
  const cleaned = String(emoji).replace(/[️\u{1F3FB}-\u{1F3FF}]/gu, '');
  const out = [];
  for (const ch of [...cleaned]) {
    const word = EMOJI_WORDS[ch];
    if (word) out.push(word);
  }
  return out;
}

/** Where a language's material is kept in the bank. */
export const bankTopic = (kind, language) => (language && language !== 'any' ? `${kind}-${language}` : kind);

/**
 * Narrows a dealt pile to the genre asked for — but never down to nothing.
 * A bank that has not been grown for a genre yet would otherwise produce an
 * empty deck and a match with no rounds, which is a worse answer than showing
 * a few films from the wrong corner of the same cinema.
 */
export function ofGenre(items, genre, want) {
  if (!genre || genre === 'any') return items;
  const matching = items.filter((it) => String(it?.genre ?? '').toLowerCase() === genre);
  if (matching.length >= want) return matching;
  const rest = items.filter((it) => !matching.includes(it));
  return [...matching, ...rest];
}
