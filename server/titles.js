// Special titles. Every title is a rule checked after each match; when it first
// returns true the player keeps it forever and it shows next to their name.
//
// Add a new one by appending to TITLES - no other file needs to change.

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
      fresh.push({ id: title.id, name: title.name, emoji: title.emoji, desc: title.desc, earnedAt: Date.now() });
    }
  }
  return fresh;
}

/** Titles listed for the studio's "what can I earn" page. */
export const titleCatalogue = () => TITLES.map(({ id, name, emoji, desc }) => ({ id, name, emoji, desc }));
