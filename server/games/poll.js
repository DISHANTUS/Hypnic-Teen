// Poll Game — no right answer. Everyone votes anonymously, then the room sees
// the split. Half the fun is who the group picked.

import { createPartyGame, shuffle } from '../party.js';
import { PLAYER_POLLS, OPINION_POLLS } from '../content.js';
import { deal } from '../bank.js';

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
  phases: { answer: 25, reveal: 12 },
  howToPlay: [
    'No right answer here. Vote for whoever or whatever fits.',
    'Votes are anonymous until the results land.',
    'Everyone who votes scores, so the only way to lose points is to sit it out.',
  ],

  buildDeck: ({ players, rounds = 10 }) => {
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
  },

  promptFor: (round) => ({
    title: round.text,
    text: round.kind === 'players' ? 'Votes are anonymous. Be honest.' : 'Pick one.',
    options: round.options,
  }),

  revealFor(state) {
    const round = state.roundData;
    const tally = {};
    for (const choice of Object.values(state.votes)) tally[choice] = (tally[choice] ?? 0) + 1;
    const total = Object.values(tally).reduce((a, b) => a + b, 0) || 1;
    const ranked = round.options
      .map((o) => ({ ...o, votes: tally[o.id] ?? 0, percent: Math.round(((tally[o.id] ?? 0) / total) * 100) }))
      .sort((a, b) => b.votes - a.votes);
    return {
      headline: ranked[0]?.votes ? `${ranked[0].label} — ${ranked[0].percent}%` : 'Nobody voted',
      options: ranked,
    };
  },
});
