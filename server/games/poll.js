// Poll Game — no right answer. Everyone votes anonymously, then the room sees
// the split. Half the fun is who the group picked.

import { createPartyGame, shuffle } from '../party.js';
import { PLAYER_POLLS, OPINION_POLLS } from '../content.js';
import { deal } from '../bank.js';

/**
 * The ready-made deck.
 *
 * Kept as its own function so buildDeck below reads as the choice it is —
 * bank or players — rather than one branch buried in a longer body.
 */
function builtInDeck({ players, rounds = 10 }) {
  // Sized to the match, not to a number written here. This used to deal a
  // flat ten cards whatever the host asked for, so a longer match was
  // silently cut short — and a room that wanted twenty questions got ten.
  const want = Math.max(10, rounds + 2);

  // "Who is most likely to…" only works when the options are real people —
  // and only while the list is short enough to read. In a big room, fall
  // back to opinion polls rather than showing 200 names as choices.
  const namedShare = players.length > 12 ? 0 : Math.ceil(want * 0.6);
  const named = deal('poll-players', PLAYER_POLLS, namedShare).map((q) => ({
    text: q,
    options: players.map((p) => ({ id: p.id, label: p.name })),
    kind: 'players',
  }));
  const opinions = deal('poll-opinions', OPINION_POLLS, want - named.length).map((p) => ({
    text: p.q,
    options: p.options.map((label, i) => ({ id: `o${i}`, label })),
    kind: 'opinion',
  }));
  return shuffle([...named, ...opinions]);
}

export default createPartyGame({
  id: 'poll',
  name: 'Poll Game',
  tagline: 'No right answers. Vote anonymously, then face the results.',
  emoji: '📊',
  accent: '#ff9f45',
  minPlayers: 3,
  // Votes aggregate into percentages, so the crowd can be any size.
  maxPlayers: 2000,
  mass: true,
  mode: 'poll',
  rounds: 6,
  phases: { answer: 25, reveal: 12, write: 75 },
  howToPlay: [
    'No right answer here. Vote for whoever or whatever fits.',
    'Votes are anonymous until the results land.',
    'Everyone who votes scores, so the only way to lose points is to sit it out.',
  ],

  // The questions can come from the room instead of the bank. A poll is a
  // question with options and nothing marked right, so it composes like a quiz
  // question minus the answer key.
  //
  // Everybody writes one, not one person per round — and unlike Quiz, no name
  // is ever attached. Poll is built on nobody knowing who asked. The questions
  // worth asking are the ones somebody has been sitting on for a year and
  // would never put their name to, and a named author kills every one of them
  // before it is typed.
  authoring: 'everyone',
  composeKind: 'poll',
  composePlaceholder: 'Ask the room something…',
  composeHint: 'Nobody will ever know this was yours. Ask the thing you have been wanting to ask.',

  options: {
    source: {
      label: 'Where the questions come from',
      hint: 'The bank, or each other',
      kind: 'choice',
      default: 'bank',
      choices: [
        { id: 'bank', label: 'Ready-made', note: 'thousands, never repeated' },
        { id: 'written', label: 'You write them', note: 'everyone writes one, anonymously' },
      ],
    },
    optionCount: {
      label: 'Options per question',
      hint: 'How many things there are to pick between',
      kind: 'number',
      min: 2,
      max: 6,
      step: 1,
      default: 4,
    },
  },

  // Written questions have no supply limit — the players are the supply — so
  // the ceiling the bank imposes on rounds does not apply.
  refineOptions: (settings) =>
    settings?.source === 'written'
      ? {
          rounds: {
            label: 'Questions',
            hint: 'Drawn at random from what the room wrote',
            kind: 'number',
            min: 1,
            max: 20,
            hardMax: 1000,
            step: 1,
            default: 6,
          },
        }
      : {},

  // Ready-made questions are dealt either way, and in written mode they sit
  // underneath as backup rather than being the match.
  //
  // Written mode used to deal blanks. That was fine while the room wrote one
  // question each and there were fewer rounds than players — and it left a
  // round with a literally empty prompt the moment that stopped being true.
  // Three people writing one each in a six-round match is not an edge case,
  // it is a Tuesday.
  buildDeck: ({ players, rounds = 10 }) => builtInDeck({ players, rounds }),

  promptFor: (round) => ({
    title: round?.text ?? 'Waiting for the question…',
    // No author line, ever. Not even "asked by someone in the room" — the
    // fewer words spent on where it came from, the less the room thinks about
    // it. Quiz names its writer here on purpose; this game must not.
    text: round?.authored
      ? 'Somebody here wrote this. Votes are anonymous too.'
      : round?.kind === 'players'
        ? 'Votes are anonymous. Be honest.'
        : 'Pick one.',
    options: round?.options ?? [],
  }),

  revealFor(state) {
    const round = state.roundData;
    const tally = {};
    for (const choice of Object.values(state.votes)) tally[choice] = (tally[choice] ?? 0) + 1;
    const total = Object.values(tally).reduce((a, b) => a + b, 0) || 1;
    const ranked = (round?.options ?? [])
      .map((o) => ({ ...o, votes: tally[o.id] ?? 0, percent: Math.round(((tally[o.id] ?? 0) / total) * 100) }))
      .sort((a, b) => b.votes - a.votes);
    return {
      headline: ranked[0]?.votes ? `${ranked[0].label} — ${ranked[0].percent}%` : 'Nobody voted',
      options: ranked,
    };
  },
});
