// Special titles. Every title is a rule checked after each match; when it first
// returns true the player keeps it forever and it shows next to their name.
//
// Add a new one by appending to TITLES - no other file needs to change.
//
// Open and secret
// ---------------
// A title with `secret: true` is not on the board. It does not appear on the
// Titles page, it is not counted in the list of what is left to earn, and there
// is nothing anywhere that hints at what it takes — until somebody does it, and
// then it is theirs and on their name for good.
//
// That is the whole point of having two kinds. An open title is a target: you
// can read what it wants and go and get it, and most people will. A secret one
// cannot be farmed, because you cannot look up the rule, which means the person
// wearing it did something rather than followed instructions. The Titles page
// says how many are still out there and nothing else, because the number is the
// invitation and the silence is the prize.
//
// So: open titles are the ones anybody could reasonably plan for. Secret ones
// are for the odd, the extreme, and the accidental.

/**
 * @typedef {Object} MatchContext
 * @property {string} gameId
 * @property {number} score     what this player scored
 * @property {boolean} won
 * @property {number} place
 * @property {number} playerCount
 * @property {number} runnerUpScore
 * @property {boolean} wasHost
 * @property {Date} at
 */

/**
 * Which games belong to which room.
 *
 * Written out rather than imported from the catalogue on purpose: importing
 * games/index.js from here would drag the whole arcade — question bank, media
 * index and all — into anything that only wanted to know what a title is. The
 * cost of writing them down is that they can drift, so test-titles.mjs checks
 * these three lists against the catalogue and fails if a game is added to a
 * room and not to its list.
 */
export const CASINO = [
  'roulette', 'holdem', 'blackjack', 'lottery', 'slots', 'plinko', 'wheel',
  'baccarat', 'three-card', 'casino-war', 'sic-bo', 'craps', 'horses', 'keno',
  'bingo', 'progressive', 'jackpot', 'scratch', 'sports',
];

export const CARDS = [
  'cheat', 'snap', 'slapjack', 'gofish', 'hearts', 'war', 'crazy8s', 'switch',
  'president', 'sevens', 'speed', 'oldmaid', 'memory', 'spoons', 'spades',
  'whist', 'euchre', 'rummy', 'gin', 'canasta', 'golf', 'cribbage', 'solitaire',
  'spider', 'liarsdeck', 'skull', 'powderkeg', 'plates', 'envelope', 'fairshares',
];

export const BOARD = [
  'chess', 'shogi', 'thayam', 'ludo', 'paramapadham', 'mahjong', 'chainreaction',
];

export const PARTY = [
  'clash', 'imposter', 'truth-dare', 'situations', 'find-word', 'quiz', 'poll',
  'movies', 'songs', 'orb-rush', 'standoff', 'crossword', 'battleship', 'typeracer',
];

const ROOM_SETS = [CASINO, CARDS, BOARD, PARTY];

export const TITLES = [
  {
    id: 'rookie',
    name: 'Rookie',
    emoji: '🐣',
    desc: 'Played your first match.',
    check: (p) => p.gamesPlayed >= 1,
  },
  {
    id: 'first-blood',
    name: 'First Blood',
    emoji: '🩸',
    desc: 'Won a match for the first time.',
    check: (p) => p.wins >= 1,
  },
  {
    id: 'hat-trick',
    name: 'Hat Trick',
    emoji: '🎩',
    desc: 'Won three matches in a row.',
    check: (p) => p.bestStreak >= 3,
  },
  {
    id: 'unstoppable',
    name: 'Unstoppable',
    emoji: '🔥',
    desc: 'Won five matches in a row.',
    check: (p) => p.bestStreak >= 5,
  },
  {
    id: 'flawless',
    name: 'Flawless',
    emoji: '✨',
    desc: 'Won with double the runner-up score.',
    check: (p, m) => m.won && m.playerCount > 1 && m.runnerUpScore > 0 && m.score >= m.runnerUpScore * 2,
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    emoji: '🦉',
    desc: 'Played a match between midnight and 5AM.',
    check: (p, m) => m.at.getHours() >= 0 && m.at.getHours() < 5,
  },
  {
    id: 'centurion',
    name: 'Centurion',
    emoji: '💯',
    desc: 'Earned 100 total points.',
    check: (p) => p.points >= 100,
  },
  {
    id: 'legend',
    name: 'Legend',
    emoji: '🏆',
    desc: 'Earned 1000 total points.',
    check: (p) => p.points >= 1000,
  },
  {
    id: 'veteran',
    name: 'Veteran',
    emoji: '🎖️',
    desc: 'Played 25 matches.',
    check: (p) => p.gamesPlayed >= 25,
  },
  {
    id: 'social',
    name: 'Social Butterfly',
    emoji: '🦋',
    desc: 'Played with 5 different people.',
    check: (p) => (p.playedWith?.length ?? 0) >= 5,
  },
  {
    id: 'ringleader',
    name: 'Ringleader',
    emoji: '📣',
    desc: 'Hosted 10 matches.',
    check: (p) => (p.hosted ?? 0) >= 10,
  },
  {
    id: 'regular',
    name: 'Regular',
    emoji: '📅',
    desc: 'Showed up on 5 different days.',
    check: (p) => (p.activeDays?.length ?? 0) >= 5,
  },
  {
    id: 'explorer',
    name: 'Explorer',
    emoji: '🧭',
    desc: 'Played every game in the studio.',
    check: (p, m, ctx) => ctx.totalGames > 0 && Object.keys(p.stats ?? {}).length >= ctx.totalGames,
  },
  {
    id: 'founder',
    name: 'Founding Teen',
    emoji: '🏛️',
    desc: 'One of the first 10 members of the studio.',
    check: (p, m, ctx) => ctx.memberNumber <= 10,
  },
  {
    id: 'good-sport',
    name: 'Good Sport',
    emoji: '🤝',
    desc: 'Finished 10 matches without rage-quitting.',
    check: (p) => (p.finished ?? 0) >= 10,
  },
  {
    id: 'mvp',
    name: 'MVP',
    emoji: '⭐',
    desc: 'Won 10 matches.',
    check: (p) => p.wins >= 10,
  },

  // ---- per-game specialities ----
  {
    id: 'quiz-master',
    name: 'Quiz Master',
    emoji: '👑',
    desc: 'Won 3 rounds of Quiz.',
    check: (p) => (p.stats?.quiz?.wins ?? 0) >= 3,
  },
  {
    id: 'detective',
    name: 'Best Detective',
    emoji: '🎭',
    desc: 'Won 3 rounds of Imposter.',
    check: (p) => (p.stats?.imposter?.wins ?? 0) >= 3,
  },
  {
    id: 'music-expert',
    name: 'Music Expert',
    emoji: '🎵',
    desc: 'Won 3 rounds of Guess the Song.',
    check: (p) => (p.stats?.songs?.wins ?? 0) >= 3,
  },
  {
    id: 'movie-buff',
    name: 'Movie Buff',
    emoji: '🎬',
    desc: 'Won 3 rounds of Guess the Movie.',
    check: (p) => (p.stats?.movies?.wins ?? 0) >= 3,
  },
  {
    id: 'wordsmith',
    name: 'Wordsmith',
    emoji: '🔤',
    desc: 'Won 3 rounds of Find the Word.',
    check: (p) => (p.stats?.['find-word']?.wins ?? 0) >= 3,
  },
  {
    id: 'daredevil',
    name: 'Daredevil',
    emoji: '😈',
    desc: 'Played 5 rounds of Truth or Dare.',
    check: (p) => (p.stats?.['truth-dare']?.plays ?? 0) >= 5,
  },
  {
    id: 'crowd-favourite',
    name: 'Crowd Favourite',
    emoji: '💬',
    desc: 'Won 3 rounds of Situations — the room liked your answers best.',
    check: (p) => (p.stats?.situations?.wins ?? 0) >= 3,
  },

  /* ------------------------------ the board room --------------------------
     One name per game, taken from what that game actually calls its best
     players rather than invented. Somebody who beats people at shogi should be
     wearing the word shogi players use. */

  { id: 'grandmaster', name: 'Grandmaster', emoji: '♟️', desc: 'Won 3 games of Chess.', check: (p) => (p.stats?.chess?.wins ?? 0) >= 3 },
  { id: 'meijin', name: 'Meijin', emoji: '🀄', desc: 'Won 3 games of Shogi.', check: (p) => (p.stats?.shogi?.wins ?? 0) >= 3 },
  { id: 'dayakattai', name: 'Dayakattai', emoji: '🐚', desc: 'Won 3 games of Thayam.', check: (p) => (p.stats?.thayam?.wins ?? 0) >= 3 },
  { id: 'ludo-king', name: 'Ludo King', emoji: '🎲', desc: 'Won 3 games of Ludo.', check: (p) => (p.stats?.ludo?.wins ?? 0) >= 3 },
  { id: 'moksha', name: 'Moksha', emoji: '🪜', desc: 'Won 3 games of Paramapadham.', check: (p) => (p.stats?.paramapadham?.wins ?? 0) >= 3 },
  { id: 'pung-master', name: 'Pung Master', emoji: '🀅', desc: 'Won 3 games of Mahjong.', check: (p) => (p.stats?.mahjong?.wins ?? 0) >= 3 },
  { id: 'critical-mass', name: 'Critical Mass', emoji: '💥', desc: 'Won 3 games of Chain Reaction.', check: (p) => (p.stats?.chainreaction?.wins ?? 0) >= 3 },
  {
    id: 'board-room',
    name: 'Board Room',
    emoji: '🧠',
    desc: 'Won a game in every corner of the board room.',
    check: (p) => ['chess', 'shogi', 'thayam', 'ludo', 'paramapadham', 'mahjong', 'chainreaction']
      .every((g) => (p.stats?.[g]?.wins ?? 0) >= 1),
  },

  /* -------------------------------- the casino ---------------------------- */

  { id: 'card-counter', name: 'Card Counter', emoji: '🂡', desc: 'Won 5 hands of Blackjack.', check: (p) => (p.stats?.blackjack?.wins ?? 0) >= 5 },
  { id: 'high-roller', name: 'High Roller', emoji: '💎', desc: 'Won 10 times across the casino.', check: (p) => CASINO.reduce((n, g) => n + (p.stats?.[g]?.wins ?? 0), 0) >= 10 },
  { id: 'poker-face', name: 'Poker Face', emoji: '🕶️', desc: "Won 3 hands of Texas Hold'em.", check: (p) => (p.stats?.holdem?.wins ?? 0) >= 3 },
  { id: 'wheelwright', name: 'Wheelwright', emoji: '🎡', desc: 'Won 3 spins of Roulette.', check: (p) => (p.stats?.roulette?.wins ?? 0) >= 3 },
  { id: 'whale', name: 'Whale', emoji: '🐋', desc: 'Sat down at 10 different casino tables.', check: (p) => CASINO.filter((g) => (p.stats?.[g]?.plays ?? 0) > 0).length >= 10 },

  /* ------------------------------- the card room -------------------------- */

  { id: 'shark', name: 'Card Shark', emoji: '🦈', desc: 'Won 10 games in the card room.', check: (p) => CARDS.reduce((n, g) => n + (p.stats?.[g]?.wins ?? 0), 0) >= 10 },
  { id: 'liar', name: 'Barefaced', emoji: '🤥', desc: 'Won 3 games of Cheat.', check: (p) => (p.stats?.cheat?.wins ?? 0) >= 3 },
  { id: 'quick-hands', name: 'Quick Hands', emoji: '✋', desc: 'Won 3 games of Snap or Slapjack.', check: (p) => (p.stats?.snap?.wins ?? 0) + (p.stats?.slapjack?.wins ?? 0) >= 3 },
  { id: 'patience', name: 'Patience', emoji: '🕯️', desc: 'Finished a game of Solitaire.', check: (p) => (p.stats?.solitaire?.wins ?? 0) >= 1 },
  { id: 'shot-the-moon', name: 'Shot the Moon', emoji: '🌙', desc: 'Won 3 games of Hearts.', check: (p) => (p.stats?.hearts?.wins ?? 0) >= 3 },

  /* -------------------------------- typing -------------------------------- */

  { id: 'touch-typist', name: 'Touch Typist', emoji: '⌨️', desc: 'Won 3 races in Type Racer.', check: (p) => (p.stats?.typeracer?.wins ?? 0) >= 3 },

  /* -------------------------------- the long haul ------------------------- */

  { id: 'millennium', name: 'Millennium', emoji: '🗿', desc: 'Earned 5,000 total points.', check: (p) => p.points >= 5000 },
  { id: 'ten-thousand', name: 'Five Figures', emoji: '🌟', desc: 'Earned 10,000 total points.', check: (p) => p.points >= 10000 },
  { id: 'half-century', name: 'Half Century', emoji: '🏏', desc: 'Played 50 matches.', check: (p) => p.gamesPlayed >= 50 },
  { id: 'century-up', name: 'Century', emoji: '💫', desc: 'Played 100 matches.', check: (p) => p.gamesPlayed >= 100 },
  { id: 'fortnight', name: 'Fortnight', emoji: '📆', desc: 'Showed up on 14 different days.', check: (p) => (p.activeDays?.length ?? 0) >= 14 },
  { id: 'season', name: 'Season Ticket', emoji: '🎟️', desc: 'Showed up on 30 different days.', check: (p) => (p.activeDays?.length ?? 0) >= 30 },
  { id: 'well-connected', name: 'Well Connected', emoji: '🤝', desc: 'Played with 15 different people.', check: (p) => (p.playedWith?.length ?? 0) >= 15 },
  { id: 'compere', name: 'Compère', emoji: '🎤', desc: 'Hosted 25 matches.', check: (p) => (p.hosted ?? 0) >= 25 },

  /* =========================== and now the secrets ========================
     Nothing below appears anywhere until it is earned. No description on the
     Titles page, no hint, no progress bar — the only way to find out one of
     these exists is to do it, or to see it on somebody else's name and ask.
     Which is the point. */

  {
    id: 'dead-heat', secret: true, name: 'Dead Heat', emoji: '🪢',
    desc: 'Tied the winner exactly, and still lost on the tiebreak.',
    check: (_p, m) => !m.won && m.playerCount > 1 && m.runnerUpScore > 0 && m.score === m.runnerUpScore,
  },
  {
    id: 'by-one', secret: true, name: 'By One', emoji: '🥶',
    desc: 'Won by a single point.',
    check: (_p, m) => m.won && m.playerCount > 1 && m.score - m.runnerUpScore === 1,
  },
  {
    id: 'nil', secret: true, name: 'Nil Points', emoji: '🫥',
    desc: 'Finished a match with nothing at all, and came back for another.',
    check: (p, m) => m.score === 0 && p.gamesPlayed >= 2,
  },
  {
    id: 'phoenix', secret: true, name: 'Phoenix', emoji: '🔥',
    desc: 'Lost five in a row, and won again.',
    check: (p, m) => m.won && (p.worstLossRun ?? 0) >= 5,
  },
  {
    id: 'witching-hour', secret: true, name: 'Witching Hour', emoji: '🕛',
    desc: 'Won a match between 3AM and 4AM.',
    check: (_p, m) => m.won && m.at.getHours() === 3,
  },
  {
    id: 'sunrise', secret: true, name: 'Sunrise', emoji: '🌅',
    desc: 'Played between 5AM and 6AM.',
    check: (_p, m) => m.at.getHours() === 5,
  },
  {
    id: 'lunch-break', secret: true, name: 'Lunch Break', emoji: '🍱',
    desc: 'Played on a weekday between 1PM and 2PM.',
    check: (_p, m) => m.at.getHours() === 13 && m.at.getDay() >= 1 && m.at.getDay() <= 5,
  },
  {
    id: 'round-the-clock', secret: true, name: 'Round the Clock', emoji: '🕰️',
    desc: 'Played a match in every one of the twenty-four hours.',
    check: (p) => (p.hoursPlayed?.length ?? 0) >= 24,
  },
  {
    id: 'half-the-clock', secret: true, name: 'Half the Clock', emoji: '🕧',
    desc: 'Played a match in twelve different hours of the day.',
    check: (p) => (p.hoursPlayed?.length ?? 0) >= 12,
  },
  {
    id: 'ten-in-a-row', secret: true, name: 'Ten in a Row', emoji: '🎯',
    desc: 'Won ten matches on the trot.',
    check: (p) => (p.bestStreak ?? 0) >= 10,
  },
  {
    id: 'twenty-in-a-row', secret: true, name: 'Untouchable', emoji: '👑',
    desc: 'Won twenty matches on the trot.',
    check: (p) => (p.bestStreak ?? 0) >= 20,
  },
  {
    id: 'triple', secret: true, name: 'Triple Threat', emoji: '🎪',
    desc: 'Won with three times the runner-up score.',
    check: (_p, m) => m.won && m.playerCount > 1 && m.runnerUpScore > 0 && m.score >= m.runnerUpScore * 3,
  },
  {
    id: 'full-house', secret: true, name: 'Full House', emoji: '🏟️',
    desc: 'Won a match with eight or more people in it.',
    check: (_p, m) => m.won && m.playerCount >= 8,
  },
  {
    id: 'wooden-spoon', secret: true, name: 'Wooden Spoon', emoji: '🥄',
    desc: 'Came dead last in a full room, and played the very next match anyway.',
    check: (p, m) => m.place === m.playerCount && m.playerCount >= 4 && p.gamesPlayed >= 5,
  },
  {
    id: 'polymath', secret: true, name: 'Polymath', emoji: '🧭',
    desc: 'Won a match in all four rooms.',
    check: (p) => ROOM_SETS.every((set) => set.some((g) => (p.stats?.[g]?.wins ?? 0) >= 1)),
  },
  {
    id: 'completionist', secret: true, name: 'Completionist', emoji: '🗺️',
    desc: 'Played every game in the studio, twice.',
    check: (p, _m, ctx) => ctx?.totalGames > 0
      && Object.values(p.stats ?? {}).filter((s) => s.plays >= 2).length >= ctx.totalGames,
  },
  {
    id: 'first-ten', secret: true, name: 'First Ten', emoji: '🔟',
    desc: 'One of the first ten people ever to sign up.',
    check: (_p, _m, ctx) => (ctx?.memberNumber ?? 999) <= 10,
  },
  {
    id: 'lucky-seven', secret: true, name: 'Lucky Seven', emoji: '🍀',
    desc: 'Scored exactly 77 in a match.',
    check: (_p, m) => m.score === 77,
  },
  {
    id: 'nice', secret: true, name: 'Nice', emoji: '😎',
    desc: 'Scored exactly 69 in a match.',
    check: (_p, m) => m.score === 69,
  },
  {
    id: 'devils-luck', secret: true, name: "Devil's Luck", emoji: '😈',
    desc: 'Scored exactly 666 in a match.',
    check: (_p, m) => m.score === 666,
  },
  {
    id: 'host-with-most', secret: true, name: 'Host With The Most', emoji: '🎩',
    desc: 'Won a match you were hosting, with six or more people in it.',
    check: (_p, m) => m.won && m.wasHost && m.playerCount >= 6,
  },
  {
    id: 'kingmaker', secret: true, name: 'Kingmaker', emoji: '🫅',
    desc: 'Hosted 50 matches.',
    check: (p) => (p.hosted ?? 0) >= 50,
  },
  {
    id: 'the-regular', secret: true, name: 'The Regular', emoji: '🪑',
    desc: 'Showed up on 100 different days.',
    check: (p) => (p.activeDays?.length ?? 0) >= 100,
  },
  {
    id: 'sociable', secret: true, name: 'Everybody Knows You', emoji: '🌍',
    desc: 'Played with 40 different people.',
    check: (p) => (p.playedWith?.length ?? 0) >= 40,
  },
  {
    id: 'chess-and-shogi', secret: true, name: 'Two Kings', emoji: '♚',
    desc: 'Won at both Chess and Shogi.',
    check: (p) => (p.stats?.chess?.wins ?? 0) >= 1 && (p.stats?.shogi?.wins ?? 0) >= 1,
  },
  {
    id: 'purist', secret: true, name: 'Purist', emoji: '🧘',
    desc: 'Won 25 board games without ever sitting at a casino table.',
    check: (p) => BOARD.reduce((n, g) => n + (p.stats?.[g]?.wins ?? 0), 0) >= 25
      && CASINO.every((g) => (p.stats?.[g]?.plays ?? 0) === 0),
  },
  {
    id: 'iron-man', secret: true, name: 'Iron Man', emoji: '🦾',
    desc: 'Played 500 matches.',
    check: (p) => p.gamesPlayed >= 500,
  },
];

const byId = new Map(TITLES.map((t) => [t.id, t]));
export const getTitle = (id) => byId.get(id) ?? null;

/**
 * Evaluate every rule and return the titles newly earned this match.
 * @returns {{id:string,name:string,emoji:string,desc:string,earnedAt:number}[]}
 */
export function evaluateTitles(profile, match, ctx) {
  const owned = new Set((profile.titles ?? []).map((t) => t.id));
  const fresh = [];
  for (const title of TITLES) {
    if (owned.has(title.id)) continue;
    let earned = false;
    try {
      earned = Boolean(title.check(profile, match, ctx));
    } catch (err) {
      console.error(`[titles] rule "${title.id}" threw:`, err);
    }
    if (earned) {
      fresh.push({
        id: title.id, name: title.name, emoji: title.emoji, desc: title.desc,
        secret: Boolean(title.secret), earnedAt: Date.now(),
      });
    }
  }
  return fresh;
}

export const openTitles = () => TITLES.filter((t) => !t.secret);
export const secretTitles = () => TITLES.filter((t) => t.secret);

/**
 * The "what can I earn" page, for one particular person.
 *
 * Open titles are all here whether or not they have them — that is the point of
 * an open title, it is a thing to go and do. Secret ones are here only if they
 * have already earned them, so the page never leaks what is left.
 *
 * `secretsLeft` is the one thing it does say about the rest: how many are still
 * out there. A number with no names attached is an invitation; the names would
 * be a checklist, and a checklist is not a secret.
 *
 * @param {object} [profile] whoever is looking; omit for a signed-out view
 */
export function titleCatalogue(profile = null) {
  const owned = new Set((profile?.titles ?? []).map((t) => t.id));
  const open = TITLES.filter((t) => !t.secret)
    .map(({ id, name, emoji, desc }) => ({ id, name, emoji, desc, secret: false, held: owned.has(id) }));
  const found = TITLES.filter((t) => t.secret && owned.has(t.id))
    .map(({ id, name, emoji, desc }) => ({ id, name, emoji, desc, secret: true, held: true }));
  const secretsLeft = TITLES.filter((t) => t.secret && !owned.has(t.id)).length;
  return { titles: [...open, ...found], secretsLeft, secretsTotal: TITLES.filter((t) => t.secret).length };
}
