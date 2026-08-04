// Situation Questions — an impossible scenario, everyone answers, the room
// votes for the answer it liked best.

import { createPartyGame } from '../party.js';
import { SITUATIONS } from '../content.js';
import { deal } from '../bank.js';

export default createPartyGame({
  id: 'situations',
  name: 'Situations',
  tagline: 'Impossible scenarios. Your answer. Everyone judges.',
  emoji: '🤔',
  accent: '#8affc1',
  minPlayers: 3,
  maxPlayers: 12,
  mode: 'answer-vote',
  rounds: 5,
  phases: { answer: 60, vote: 35, reveal: 12, write: 60 },
  allowSelfVote: false,
  howToPlay: [
    'An impossible scenario. Type what you would actually do.',
    'Then everyone reads the answers and votes for the best one.',
    'Each vote your answer attracts is worth points, and the top answer takes extra.',
  ],

  // The scenarios can come from the players instead of the bank. One person
  // sets it each round, drawn from a bag so nobody can see their turn coming.
  authoring: true,
  composeKind: 'text',
  composePlaceholder: 'What if…',
  composeHint: 'Something with no good answer. That is what makes it funny.',

  options: {
    source: {
      label: 'Where the scenarios come from',
      hint: 'The bank, or each other',
      kind: 'choice',
      default: 'bank',
      choices: [
        { id: 'bank', label: 'Ready-made', note: 'thousands, never repeated' },
        { id: 'written', label: 'You write them', note: 'one player each round' },
      ],
    },
  },

  // Scenarios the players write have no supply limit, so neither does the
  // round count. The bank's ceiling stays where the bank can reach.
  refineOptions: (settings) =>
    settings?.source === 'written'
      ? { rounds: { label: 'Rounds', hint: 'One player sets each scenario', kind: 'number', min: 1, max: 20, hardMax: 1000, step: 1, default: 5 } }
      : {},

  buildDeck: ({ rounds = 6, source = 'bank' } = {}) => {
    const count = Math.max(8, rounds + 2);
    // Written mode deals blanks; each is filled in during its own round.
    if (source === 'written') {
      return Array.from({ length: count }, () => ({ text: null, authored: false }));
    }
    return deal('situations', SITUATIONS, count).map((text) => ({ text }));
  },

  promptFor: (round) => ({
    title: round?.text ?? 'Waiting for the scenario…',
    text: round?.authorName ? `set by ${round.authorName} — best answer wins` : 'Best answer wins the round.',
  }),
});
