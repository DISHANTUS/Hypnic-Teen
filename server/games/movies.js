// Guess the Movie — emoji first, then a dialogue, then a character name.
// Guess on the emoji alone and you keep the biggest bonus.

import { createPartyGame, DIFFICULTY_TIME } from '../party.js';
import { MOVIES } from '../content.js';
import { deal } from '../bank.js';
import { pickerOptions, bankTopic, ofGenre } from '../cinema.js';

export default createPartyGame({
  id: 'movies',
  name: 'Guess the Movie',
  tagline: 'Emoji, then a dialogue, then a character. Guess it before the clues run out.',
  emoji: '🎬',
  accent: '#7c5cff',
  minPlayers: 1,
  maxPlayers: 16,
  mode: 'race',
  rounds: 7,
  phases: { answer: DIFFICULTY_TIME.easy, reveal: 8 },
  howToPlay: [
    'Emoji first, then a line of dialogue, then a character name.',
    'Type the film the moment you have it. Small typos are forgiven.',
    'Guessing on the emoji alone is worth the most, so do not wait for certainty.',
  ],

  // Which cinema, and which corner of it. The genre list changes with the
  // language, because "K-drama" means nothing in a Tamil round.
  options: pickerOptions({}, { languageHint: 'Whose films', genreHint: 'What kind' }),
  refineOptions: (settings) => pickerOptions(settings, { languageHint: 'Whose films', genreHint: 'What kind' }),

  // Dealt through the bank, so a film you guessed last week does not come round
  // again while a hundred others sit unused. Each language keeps its own
  // history, so a Tamil night does not use up the English shelf.
  buildDeck: ({ rounds = 7, language = 'any', genre = 'any' } = {}) => {
    const want = Math.max(10, rounds + 3);
    // Deal generously, then narrow — asking the bank for exactly `want` and
    // then filtering by genre would leave a short deck and a truncated match.
    const pool = deal(bankTopic('movies', language), MOVIES, want * 3);
    return ofGenre(pool, genre, want)
      .slice(0, want)
      .map((m) => ({
        answer: m.answer,
        // Common shorthand people actually type.
        aliases: [m.answer.replace(/^The /i, ''), m.answer.replace(/[^A-Za-z0-9]/g, '')],
        hints: [m.emoji, `"${m.dialogue}"`, `Character: ${m.character}`],
        genre: m.genre ?? null,
        seconds: DIFFICULTY_TIME.easy,
      }));
  },

  promptFor: () => ({ title: 'Which movie?', text: 'Type your guess — spelling gets a little slack.' }),
});
