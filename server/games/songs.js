// Guess the Song — emoji, then a lyric snippet, then where it's from.
// Audio clips would need licensed files, so the clues are text and emoji only.

import { createPartyGame, shuffle, DIFFICULTY_TIME } from '../party.js';
import { SONGS } from '../content.js';
import { deal } from '../bank.js';
import { pickerOptions, bankTopic, ofGenre, bioscopeFor } from '../cinema.js';
import { clueFor } from '../media.js';
import { ownClues } from '../own-clues.js';

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

    // Rounds your friends wrote come first, and every one of them is used
    // before anything generated. Somebody chose those pictures for this room;
    // a machine that broke a title into words did not. Where there are more
    // than a match needs, they are shuffled so the same ones do not open
    // every night.
    const mine = shuffle(ownClues()).map((card) => ({
      answer: card.answer,
      aliases: [card.answer.replace(/[^A-Za-z0-9]/g, ''), card.answer.split(' ').slice(0, 2).join(' ')],
      // Their own clues, shown one at a time if the pictures are not enough.
      hints: card.clues.length ? card.clues : ['Look at the pictures again'],
      pictures: card.pictures.map((p, n) => ({ n: n + 1, url: p.url })),
      own: true,
      seconds: DIFFICULTY_TIME.easy,
    }));

    const room = Math.max(0, want - mine.length);
    if (!room) return mine.slice(0, want);

    const pool = deal(bankTopic('songs', language), SONGS, room * 3);
    const rest = ofGenre(pool, genre, room)
      .slice(0, room)
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

    return shuffle([...mine, ...rest]);
  },

  promptFor: (round) => ({
    title: round?.pictures ? 'Read the pictures' : 'Name the song',
    text: round?.pictures
      ? 'Each picture is a word or a sound. Put them together and name the track.'
      : 'Type your guess — spelling gets a little slack.',
    pictures: round?.pictures ?? null,
  }),
});
