// Find the Word — hints drip in one at a time. Guess early for more points;
// the first correct answer takes the speed bonus.

import { createPartyGame, shuffle, DIFFICULTY_TIME } from '../party.js';
import { WORDS, SCRAMBLES } from '../content.js';
import { deal } from '../bank.js';

export default createPartyGame({
  id: 'find-word',
  name: 'Find the Word',
  tagline: 'Hints drip in. Guess early, score higher.',
  emoji: '🔤',
  accent: '#4ad6ff',
  minPlayers: 1,
  maxPlayers: 16,
  mode: 'race',
  rounds: 6,
  phases: { answer: DIFFICULTY_TIME.easy, reveal: 8 },
  howToPlay: [
    'A hidden word, revealed one hint at a time.',
    'Type your guess whenever you like. Close spelling still counts.',
    'The fewer hints you needed, the more it is worth — and the first one in takes a bonus.',
  ],

  // The two kinds keep separate histories: exhausting the scrambles should not
  // start recycling the hint words, and the other way round.
  buildDeck: ({ rounds = 9 } = {}) => {
    const straight = deal('find-word-hints', WORDS, Math.max(6, Math.ceil((rounds + 2) * 0.7))).map((w) => ({
      answer: w.answer,
      hints: w.hints,
      seconds: DIFFICULTY_TIME.easy,
      kind: 'hints',
    }));
    const scrambled = deal('find-word-scrambles', SCRAMBLES, Math.max(3, Math.ceil((rounds + 2) * 0.35))).map((s) => ({
      answer: s.answer,
      hints: [`Unscramble: ${s.scramble}`, `${s.answer.length} letters`, `Starts with "${s.answer[0]}"`],
      seconds: DIFFICULTY_TIME.medium,
      kind: 'scramble',
    }));
    return shuffle([...straight, ...scrambled]);
  },

  promptFor: (round) => ({
    title: round.kind === 'scramble' ? 'Unscramble it' : 'Guess the word',
    text: '',
    kind: round.kind,
  }),
});
