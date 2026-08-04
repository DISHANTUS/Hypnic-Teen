// Guess the Song — emoji, then a lyric snippet, then where it's from.
// Audio clips would need licensed files, so the clues are text and emoji only.

import { createPartyGame, DIFFICULTY_TIME } from '../party.js';
import { SONGS } from '../content.js';
import { deal } from '../bank.js';
import { pickerOptions, bankTopic, ofGenre, bioscopeFor } from '../cinema.js';
import { clueFor } from '../media.js';

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
      .map((s, i) => {
        // The Bioscope round the television show runs: a strip of photographs
        // that decodes into the title. Only where every word has a picture —
        // otherwise the emoji clue it already had.
        const strip = bioscopeFor(s, clueFor, i);
        return {
          answer: s.answer,
          aliases: [s.answer.replace(/[^A-Za-z0-9]/g, ''), s.answer.split(' ').slice(0, 2).join(' ')],
          hints: [strip ? '' : s.emoji, `"${s.lyric}"`, `From: ${s.from}`],
          pictures: strip,
          genre: s.genre ?? null,
          seconds: DIFFICULTY_TIME.easy,
        };
      });
  },

  promptFor: (round) => ({
    title: round?.pictures ? 'Read the pictures' : 'Name the song',
    text: round?.pictures
      ? 'Each picture is a word or a sound. Put them together and name the track.'
      : 'Type your guess — spelling gets a little slack.',
    pictures: round?.pictures ?? null,
  }),
});
