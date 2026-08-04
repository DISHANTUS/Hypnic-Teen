// Guess the Song — emoji, then a lyric snippet, then where it's from.
// Audio clips would need licensed files, so the clues are text and emoji only.

import { createPartyGame, DIFFICULTY_TIME } from '../party.js';
import { SONGS } from '../content.js';
import { deal } from '../bank.js';
import { pickerOptions, bankTopic, ofGenre } from '../cinema.js';

export default createPartyGame({
  id: 'songs',
  name: 'Guess the Song',
  tagline: 'Emoji, a lyric, a film. Name the track first.',
  emoji: '🎵',
  accent: '#3ddc97',
  minPlayers: 1,
  maxPlayers: 16,
  mode: 'race',
  rounds: 7,
  phases: { answer: DIFFICULTY_TIME.easy, reveal: 8 },
  howToPlay: [
    'Emoji, then a lyric, then the film it is from.',
    'Type the song title. Close enough counts — do not worry about exact spelling.',
    'Early guesses score more, and the first correct answer takes a bonus.',
  ],

  // Nobody wants to guess Hindi film songs at a table that only listens to
  // K-pop, so the same picker the film game uses applies here.
  options: pickerOptions({}, { languageHint: 'Whose music', genreHint: 'What kind' }),
  refineOptions: (settings) => pickerOptions(settings, { languageHint: 'Whose music', genreHint: 'What kind' }),

  buildDeck: ({ rounds = 7, language = 'any', genre = 'any' } = {}) => {
    const want = Math.max(10, rounds + 3);
    const pool = deal(bankTopic('songs', language), SONGS, want * 3);
    return ofGenre(pool, genre, want)
      .slice(0, want)
      .map((s) => ({
        answer: s.answer,
        aliases: [s.answer.replace(/[^A-Za-z0-9]/g, ''), s.answer.split(' ').slice(0, 2).join(' ')],
        hints: [s.emoji, `"${s.lyric}"`, `From: ${s.from}`],
        genre: s.genre ?? null,
        seconds: DIFFICULTY_TIME.easy,
      }));
  },

  promptFor: () => ({ title: 'Name the song', text: 'Type your guess — spelling gets a little slack.' }),
});
