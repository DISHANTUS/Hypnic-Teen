// Words and clues for the crossword.
//
// Written by hand rather than generated. A clue that is merely plausible is
// worse here than in any other game on this site: a wrong one cannot be solved
// at all, and a room of four people will spend three minutes on it before
// deciding the game is broken. Every one of these has a single answer that the
// people playing will actually know.
//
// Weighted heavily towards three to five letters. A crossword is mostly its
// crossings, and long words cross badly — a grid built from eight-letter words
// is three words and a lot of empty squares.
//
// The register is the same as the rest of the studio: what an Indian college
// student sees in a week. Chai and monsoons and hostel WiFi, alongside the
// ordinary furniture of the language.

/**
 * @typedef {{ answer: string, clue: string }} Entry
 * Answers are letters only, upper case, no spaces. The grid cannot hold a
 * space, and a clue whose answer needs one reads as unsolvable.
 */

/** @type {Entry[]} */
export const CROSSWORD_WORDS = [
  /* ------------------------------ three ---------------------------------- */
  { answer: 'TEA', clue: 'Chai, in one syllable' },
  { answer: 'BUS', clue: 'It leaves as you reach the stop' },
  { answer: 'CAT', clue: 'Sleeps sixteen hours and owns you' },
  { answer: 'SUN', clue: 'Up before your alarm' },
  { answer: 'ICE', clue: 'Water, gone hard' },
  { answer: 'PEN', clue: 'Borrowed, never returned' },
  { answer: 'BAG', clue: 'You carry the whole semester in it' },
  { answer: 'MAP', clue: 'What you had before the phone' },
  { answer: 'CAR', clue: 'Four wheels and a horn' },
  { answer: 'EGG', clue: 'Boiled, fried or on your face' },
  { answer: 'RED', clue: 'Stop, or a very ripe tomato' },
  { answer: 'SKY', clue: 'Grey all through July' },
  { answer: 'EAR', clue: 'Where the earphone goes' },
  { answer: 'EYE', clue: 'You keep one on the clock' },
  { answer: 'ARM', clue: 'Elbow to shoulder' },
  { answer: 'LEG', clue: 'A chair has four' },
  { answer: 'CUP', clue: 'A trophy, or what chai comes in' },
  { answer: 'BED', clue: 'The most persuasive object in the hostel' },
  { answer: 'FAN', clue: 'Ceiling-mounted, and never fast enough' },
  { answer: 'KEY', clue: 'Opens a lock, or sits on a keyboard' },
  { answer: 'MAT', clue: 'Wipe your feet on it' },
  { answer: 'NET', clue: 'The internet, shortened' },
  { answer: 'OIL', clue: 'Coconut, mustard or engine' },
  { answer: 'RAT', clue: 'The race you are told you are in' },
  { answer: 'SEA', clue: 'Salt water, no far shore' },
  { answer: 'TOP', clue: 'The rank everybody claims' },
  { answer: 'WAR', clue: 'The opposite of peace' },
  { answer: 'AGE', clue: 'A number people lie about' },
  { answer: 'ART', clue: 'A stream, and a gallery' },
  { answer: 'BAT', clue: 'Willow in the hands of a batsman' },
  { answer: 'CAP', clue: 'It goes on your head, or on a pen' },
  { answer: 'DAY', clue: 'Twenty-four hours, roughly' },
  { answer: 'EAT', clue: 'What you do at the mess' },
  { answer: 'FEE', clue: 'Paid every semester, reluctantly' },
  { answer: 'GAS', clue: 'The cylinder in the kitchen' },
  { answer: 'HAT', clue: 'Sun protection with a brim' },
  { answer: 'INK', clue: 'What a pen runs out of' },
  { answer: 'JAM', clue: 'Traffic, or something on toast' },
  { answer: 'LAW', clue: 'Newton had three' },
  { answer: 'MAN', clue: 'An adult male' },
  { answer: 'NAP', clue: 'Twenty minutes that becomes two hours' },
  { answer: 'OWL', clue: 'Awake when you should not be' },
  { answer: 'PIG', clue: 'Pink, and blamed for mess' },
  { answer: 'RUN', clue: 'A score in cricket' },
  { answer: 'SIT', clue: 'What the last bench does best' },
  { answer: 'TIE', clue: 'Neckwear, or a drawn match' },
  { answer: 'VAN', clue: 'Bigger than a car, smaller than a truck' },
  { answer: 'WEB', clue: 'A spider spins it; so does the world' },
  { answer: 'ZOO', clue: 'Animals behind glass' },
  { answer: 'AIR', clue: 'You cannot see it but you need it' },
  { answer: 'BOX', clue: 'Cardboard, with corners' },

  /* ------------------------------- four ----------------------------------- */
  { answer: 'RAIN', clue: 'It arrives in Kerala first' },
  { answer: 'EXAM', clue: 'It has a hall ticket' },
  { answer: 'WIFI', clue: 'Its password is the first thing you ask for' },
  { answer: 'BOOK', clue: 'You mean to finish it' },
  { answer: 'DESK', clue: 'What a chair belongs to' },
  { answer: 'LAMP', clue: 'It lights the desk at 2am' },
  { answer: 'MOON', clue: 'Full once a month' },
  { answer: 'STAR', clue: 'A distant sun, or a rating' },
  { answer: 'FIRE', clue: 'Warm, until it is not' },
  { answer: 'ROAD', clue: 'It has potholes after the rain' },
  { answer: 'TREE', clue: 'Shade with roots' },
  { answer: 'BIRD', clue: 'It has feathers and opinions at dawn' },
  { answer: 'FISH', clue: 'Gills, no eyelids' },
  { answer: 'RICE', clue: 'Half of every plate' },
  { answer: 'SALT', clue: 'The march was about it' },
  { answer: 'MILK', clue: 'It boils over the second you look away' },
  { answer: 'DOOR', clue: 'Knock before it' },
  { answer: 'WALL', clue: 'It holds up the roof' },
  { answer: 'TIME', clue: 'Never enough of it before a deadline' },
  { answer: 'YEAR', clue: 'Twelve months' },
  { answer: 'CITY', clue: 'Bigger than a town' },
  { answer: 'SHOP', clue: 'The one downstairs, open till late' },
  { answer: 'BANK', clue: 'Money, or the side of a river' },
  { answer: 'GAME', clue: 'What you are playing right now' },
  { answer: 'SONG', clue: 'It gets stuck in your head' },
  { answer: 'FILM', clue: 'Three hours and an interval' },
  { answer: 'TEAM', clue: 'Eleven of them, on a pitch' },
  { answer: 'GOAL', clue: 'What the net is for' },
  { answer: 'BALL', clue: 'Round, and thrown' },
  { answer: 'KITE', clue: 'It flies on a string' },
  { answer: 'BIKE', clue: 'Two wheels and a helmet you forgot' },
  { answer: 'TRAIN', clue: 'Platform nine, running late' },
  { answer: 'PATH', clue: 'A small road, on foot' },
  { answer: 'HILL', clue: 'A small mountain' },
  { answer: 'LAKE', clue: 'Still water, no salt' },
  { answer: 'SAND', clue: 'It gets everywhere at the beach' },
  { answer: 'WIND', clue: 'You feel it, you do not see it' },
  { answer: 'SNOW', clue: 'Rain that took its time' },
  { answer: 'HEAT', clue: 'April, in one word' },
  { answer: 'COLD', clue: 'What the fan is not helping with' },
  { answer: 'DARK', clue: 'After the power cut' },
  { answer: 'LATE', clue: 'What the bus always is' },
  { answer: 'FAST', clue: 'Quick, or going without food' },
  { answer: 'SLOW', clue: 'How the last hour of class moves' },
  { answer: 'HOME', clue: 'Where the food is better' },
  { answer: 'ROOM', clue: 'Four walls and a roommate' },
  { answer: 'HAND', clue: 'Five fingers' },
  { answer: 'FOOT', clue: 'Twelve inches, or the end of a leg' },
  { answer: 'HEAD', clue: 'It aches before an exam' },
  { answer: 'FACE', clue: 'What a mask covers' },
  { answer: 'NOTE', clue: 'Money, or something you wrote down' },
  { answer: 'WORD', clue: 'What you are filling in' },
  { answer: 'LINE', clue: 'Stand in it at the counter' },
  { answer: 'PAGE', clue: 'Turn it' },
  { answer: 'IDEA', clue: 'It arrives in the shower' },
  { answer: 'PLAN', clue: 'It survives until Monday' },
  { answer: 'WORK', clue: 'What is due tomorrow' },
  { answer: 'REST', clue: 'What you never get enough of' },
  { answer: 'GIFT', clue: 'Wrapped, and given' },
  { answer: 'LUCK', clue: 'What you wish somebody before an exam' },

  /* ------------------------------- five ----------------------------------- */
  { answer: 'MANGO', clue: 'Summer, in a fruit' },
  { answer: 'CHAIR', clue: 'Four legs, no opinions' },
  { answer: 'PHONE', clue: 'Ninety per cent battery anxiety' },
  { answer: 'CLOUD', clue: 'Where your photos live now' },
  { answer: 'RIVER', clue: 'It has two banks and no money' },
  { answer: 'BEACH', clue: 'Sand meets sea' },
  { answer: 'CHALK', clue: 'It squeaks on the board' },
  { answer: 'CLASS', clue: 'Nine o clock, attendance compulsory' },
  { answer: 'MARKS', clue: 'Out of a hundred' },
  { answer: 'HOSTEL', clue: 'Where the mess food is' },
  { answer: 'MUSIC', clue: 'Earphones in, world out' },
  { answer: 'PIANO', clue: 'Eighty-eight keys' },
  { answer: 'DRUMS', clue: 'Hit them with sticks' },
  { answer: 'PAINT', clue: 'It comes in a tin and a brush' },
  { answer: 'BREAD', clue: 'Sliced, and toasted' },
  { answer: 'SUGAR', clue: 'Two spoons, in the chai' },
  { answer: 'WATER', clue: 'Two hydrogens and an oxygen' },
  { answer: 'JUICE', clue: 'Fruit, squeezed' },
  { answer: 'SPICE', clue: 'What the masala dabba holds' },
  { answer: 'ONION', clue: 'It makes you cry in the kitchen' },
  { answer: 'LEMON', clue: 'Yellow and sour' },
  { answer: 'GRAPE', clue: 'It comes in bunches' },
  { answer: 'APPLE', clue: 'A fruit, and a bitten logo' },
  { answer: 'TIGER', clue: 'Stripes, and the national animal' },
  { answer: 'HORSE', clue: 'You ride it, or back it' },
  { answer: 'MOUSE', clue: 'A rodent, or what the cursor obeys' },
  { answer: 'SNAKE', clue: 'No legs, plenty of reputation' },
  { answer: 'EAGLE', clue: 'It sees a rabbit from a mile up' },
  { answer: 'SHEEP', clue: 'Counted to fall asleep' },
  { answer: 'PLANE', clue: 'It leaves from a terminal' },
  { answer: 'TRUCK', clue: 'Horn OK please' },
  { answer: 'WHEEL', clue: 'Reinventing it is discouraged' },
  { answer: 'LIGHT', clue: 'Switched on at dusk' },
  { answer: 'NIGHT', clue: 'When the studying finally starts' },
  { answer: 'MONTH', clue: 'Thirty days, give or take' },
  { answer: 'CLOCK', clue: 'It ticks and you watch it' },
  { answer: 'MONEY', clue: 'It runs out before the month does' },
  { answer: 'PRICE', clue: 'What the tag says' },
  { answer: 'QUEUE', clue: 'A line, spelled the long way' },
  { answer: 'STAIRS', clue: 'The lift is broken again' },
  { answer: 'FLOOR', clue: 'What you sit on when chairs run out' },
  { answer: 'HOUSE', clue: 'Bricks with a family in it' },
  { answer: 'TOWEL', clue: 'It never dries in the monsoon' },
  { answer: 'SHIRT', clue: 'It has a collar and buttons' },
  { answer: 'SHOES', clue: 'A pair, worn out by March' },
  { answer: 'WATCH', clue: 'On your wrist, or what you do to a film' },
  { answer: 'GLASS', clue: 'You drink from it, or look through it' },
  { answer: 'PAPER', clue: 'The exam is printed on it' },
  { answer: 'BOARD', clue: 'The teacher writes on it' },
  { answer: 'SCORE', clue: 'What the scoreboard shows' },
  { answer: 'MATCH', clue: 'A game, or something you strike' },
  { answer: 'FIELD', clue: 'Where the match is played' },
  { answer: 'ROUND', clue: 'A circle, or one part of a match' },
  { answer: 'PRIZE', clue: 'What the winner takes' },
  { answer: 'DREAM', clue: 'It happens with your eyes shut' },
  { answer: 'SMILE', clue: 'Say cheese for it' },
  { answer: 'LAUGH', clue: 'What the back bench does' },
  { answer: 'SLEEP', clue: 'Eight hours, in theory' },
  { answer: 'STORY', clue: 'It has a beginning and an end' },
  { answer: 'VOICE', clue: 'What you lose after a concert' },
  { answer: 'SOUND', clue: 'It travels slower than light' },
  { answer: 'GREEN', clue: 'Go, or the colour of the leaves' },
  { answer: 'BLACK', clue: 'No colour at all' },
  { answer: 'WHITE', clue: 'All the colours at once' },
  { answer: 'BROWN', clue: 'The colour of chai with milk' },
  { answer: 'EARTH', clue: 'Third from the sun' },
  { answer: 'OCEAN', clue: 'Bigger than a sea' },
  { answer: 'STONE', clue: 'It skips across water if you are good' },
  { answer: 'METAL', clue: 'Iron, copper or gold' },
  { answer: 'GLOVE', clue: 'The keeper wears two' },

  /* ------------------------------- six ------------------------------------ */
  { answer: 'MONSOON', clue: 'A season, not a month' },
  { answer: 'CANTEEN', clue: 'Where the samosa is' },
  { answer: 'PENCIL', clue: 'It has lead and an eraser' },
  { answer: 'ERASER', clue: 'It removes the pencil' },
  { answer: 'WINDOW', clue: 'You stare out of it during class' },
  { answer: 'GARDEN', clue: 'Where things are planted' },
  { answer: 'FLOWER', clue: 'It opens in the morning' },
  { answer: 'FOREST', clue: 'A great many trees' },
  { answer: 'DESERT', clue: 'Sand as far as you can see' },
  { answer: 'ISLAND', clue: 'Land with water all round it' },
  { answer: 'BRIDGE', clue: 'It crosses the river' },
  { answer: 'TUNNEL', clue: 'The road, but through the hill' },
  { answer: 'ROCKET', clue: 'ISRO sends them up' },
  { answer: 'PLANET', clue: 'Earth is one' },
  { answer: 'CAMERA', clue: 'It has a shutter and a lens' },
  { answer: 'SCREEN', clue: 'You are looking at one' },
  { answer: 'BUTTON', clue: 'Press it' },
  { answer: 'POCKET', clue: 'Where the phone lives' },
  { answer: 'WALLET', clue: 'It holds notes and cards' },
  { answer: 'BOTTLE', clue: 'It holds water, and spins in a game' },
  { answer: 'KITCHEN', clue: 'Where the gas cylinder is' },
  { answer: 'SPOON', clue: 'Smaller than a ladle' },
  { answer: 'PLATE', clue: 'Round, and the rice goes on it' },
  { answer: 'COFFEE', clue: 'Filter, in the south' },
  { answer: 'BUTTER', clue: 'It melts on hot toast' },
  { answer: 'CHEESE', clue: 'Say it for the camera' },
  { answer: 'POTATO', clue: 'Aloo, in English' },
  { answer: 'TOMATO', clue: 'Red, and technically a fruit' },
  { answer: 'BANANA', clue: 'Peel it' },
  { answer: 'ORANGE', clue: 'A fruit and a colour, same word' },
  { answer: 'MONKEY', clue: 'It takes your snack at the hill station' },
  { answer: 'RABBIT', clue: 'Long ears, and it lost a race' },
  { answer: 'PARROT', clue: 'Green, and it repeats you' },
  { answer: 'SPIDER', clue: 'Eight legs and a web' },
  { answer: 'CAMEL', clue: 'The ship of the desert' },
  { answer: 'DONKEY', clue: 'It carries the load and gets no credit' },
  { answer: 'FRIEND', clue: 'The one who lends you the pen' },
  { answer: 'FAMILY', clue: 'Who you go home to' },
  { answer: 'PERSON', clue: 'One human' },
  { answer: 'TEACHER', clue: 'They set the paper' },
  { answer: 'DOCTOR', clue: 'An apple a day keeps them away' },
  { answer: 'FARMER', clue: 'They watch the monsoon closely' },
  { answer: 'DRIVER', clue: 'They hold the wheel' },
  { answer: 'SINGER', clue: 'They hold the note' },
  { answer: 'WINNER', clue: 'First, at the end' },
  { answer: 'ANSWER', clue: 'What a question wants' },
  { answer: 'LETTER', clue: 'A to Z, or something posted' },
  { answer: 'NUMBER', clue: 'One, two, three' },
  { answer: 'MINUTE', clue: 'Sixty seconds' },
  { answer: 'SECOND', clue: 'Just after first' },
  { answer: 'SUMMER', clue: 'When the fan gives up' },
  { answer: 'WINTER', clue: 'Sweater season' },
  { answer: 'SUNDAY', clue: 'The one that goes too fast' },
  { answer: 'MONDAY', clue: 'The one nobody asked for' },
  { answer: 'FRIDAY', clue: 'The good one' },
  { answer: 'MARKET', clue: 'Where you argue about the price' },
  { answer: 'TICKET', clue: 'Show it at the gate' },
  { answer: 'PUZZLE', clue: 'This, for instance' },
  { answer: 'RIDDLE', clue: 'A question with a trick in it' },
  { answer: 'SILENCE', clue: 'What the invigilator wants' },

  /* ------------------------------ seven plus ------------------------------ */
  { answer: 'BIRYANI', clue: 'Hyderabad and Lucknow argue about it' },
  { answer: 'CRICKET', clue: 'Eleven a side' },
  { answer: 'TRAFFIC', clue: 'Bengaluru is famous for it' },
  { answer: 'LIBRARY', clue: 'Quiet, and full of borrowed time' },
  { answer: 'HOLIDAY', clue: 'Declared, and cheered' },
  { answer: 'MORNING', clue: 'Before noon, after the alarm' },
  { answer: 'EVENING', clue: 'After the sun goes down' },
  { answer: 'PICTURE', clue: 'Worth a thousand words' },
  { answer: 'MACHINE', clue: 'It has parts and does work' },
  { answer: 'BATTERY', clue: 'It is always at fifteen per cent' },
  { answer: 'CHARGER', clue: 'Somebody has borrowed yours' },
  { answer: 'MESSAGE', clue: 'Seen at 2am, replied to never' },
  { answer: 'STATION', clue: 'Where the train stops' },
  { answer: 'AIRPORT', clue: 'Where the plane stops' },
  { answer: 'JOURNEY', clue: 'The trip itself, not the arriving' },
  { answer: 'PROBLEM', clue: 'Question three, part b' },
  { answer: 'DIWALI', clue: 'The festival of lights' },
  { answer: 'ELEPHANT', clue: 'Largest land animal' },
  { answer: 'KEYBOARD', clue: 'QWERTY' },
  { answer: 'SANDWICH', clue: 'Named after an Earl' },
  { answer: 'RAINBOW', clue: 'Seven of something, after the rain' },
  { answer: 'VOLCANO', clue: 'It sleeps, then erupts' },
  { answer: 'GRAVITY', clue: 'It keeps you on the ground' },
  { answer: 'CHEETAH', clue: 'Fastest on land' },
  { answer: 'INTERNET', clue: 'A network of networks' },
  { answer: 'PASSWORD', clue: 'It should not be 123456' },
  { answer: 'COMPUTER', clue: 'It has a motherboard' },
  { answer: 'HOSPITAL', clue: 'Where the doctor is' },
  { answer: 'MOUNTAIN', clue: 'Everest, for one' },
  { answer: 'UMBRELLA', clue: 'It turns inside out in the wind' },
];

/** Answers are letters only — a grid square cannot hold a space or a hyphen. */
const CLEAN = /^[A-Z]+$/;

/**
 * The list, filtered to what a grid can actually take.
 *
 * Checked at load rather than trusted, because one entry with a space in it
 * produces a puzzle with an unfillable square and nothing anywhere says why.
 */
export const USABLE_WORDS = (() => {
  const kept = [];
  const seen = new Set();
  const duplicates = [];

  for (const w of CROSSWORD_WORDS) {
    if (!CLEAN.test(w.answer)) continue;
    if (w.answer.length < 3 || w.answer.length > 10) continue;
    if (!w.clue.trim()) continue;
    // The same answer twice is the one mistake in a hand-written list that
    // survives every other check and then puts one word in a grid under two
    // different clues. Dropped, and said out loud so it gets fixed.
    if (seen.has(w.answer)) {
      duplicates.push(w.answer);
      continue;
    }
    seen.add(w.answer);
    kept.push(w);
  }

  if (duplicates.length) {
    console.warn(`[crossword] duplicate answers dropped: ${duplicates.join(', ')}`);
  }
  return kept;
})();

/** Grouped by length, which is what the grid builder actually asks for. */
export function wordsByLength() {
  const out = new Map();
  for (const w of USABLE_WORDS) {
    if (!out.has(w.answer.length)) out.set(w.answer.length, []);
    out.get(w.answer.length).push(w);
  }
  return out;
}
