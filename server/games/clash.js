// Clash — team vs team tug of war.
//
// Two sides, any size. Every correct answer pulls the rope toward your team;
// the fastest answers pull hardest. First side to drag it all the way across
// wins, or whoever is ahead when the questions run out.
//
// This is the shape that scales: players never interact directly, they only
// contribute to a total. 30 v 30 and 300 v 300 cost the server the same.

import { createPartyGame, shuffle, pickSome, DIFFICULTY_TIME, SCORE } from '../party.js';
import { QUIZ } from '../content.js';
import { deal } from '../bank.js';

// How far the rope can travel before a side has won outright.
const ROPE_LIMIT = 100;
// A single correct answer's pull. Scaled by team size so a bigger team doesn't
// simply out-mass a smaller one — it's accuracy that wins, not headcount.
const PULL = 10;
const FAST_BONUS = 5;

export default createPartyGame({
  id: 'clash',
  name: 'Clash',
  tagline: 'Two teams, one rope. Every right answer pulls it your way.',
  emoji: '⚔️',
  accent: '#ff3d6e',
  minPlayers: 2,
  maxPlayers: 2000,
  mass: true,
  teams: 2,
  mode: 'mcq',
  rounds: 12,
  phases: { answer: DIFFICULTY_TIME.medium, reveal: 6 },
  howToPlay: [
    'You are on a team. Every correct answer pulls the rope your way.',
    'The pull is your team\u0027s share of correct answers, not its headcount — a smaller team that knows its stuff still wins.',
    'Drag the rope all the way across and it is over early.',
  ],

  // Shares the quiz bank rather than keeping its own: they draw on the same
  // questions, so a night of Quiz should use up Clash's supply too. Without
  // this it was picking from the shipped list every match and asking the same
  // things Quiz had already asked an hour earlier.
  buildDeck: ({ rounds = 16 } = {}) => {
    const want = Math.max(16, rounds + 4);
    const all = Object.entries(QUIZ).flatMap(([category, questions]) =>
      questions.map((q) => ({ ...q, category }))
    );
    return deal('quiz', all, want)
      .slice(0, want)
      .map((q) => {
        const options = shuffle(q.options).map((label, i) => ({ id: `o${i}`, label }));
        return {
          text: q.q,
          category: q.category,
          options,
          answerId: options.find((o) => o.label === q.answer).id,
          answer: q.answer,
          seconds: DIFFICULTY_TIME.medium,
        };
      });
  },

  promptFor: (round) => ({ title: round.text, text: round.category, options: round.options }),

  /** The rope position rides in every payload — two numbers, any crowd size. */
  extra: (state) => ({
    rope: Math.round(state.rope ?? 0),
    ropeLimit: ROPE_LIMIT,
    won: state.wonBy ?? null,
  }),

  scoreRound(state) {
    state.rope ??= 0;
    const round = state.roundData;

    // Each side's pull is the share of its members who got it right, so a
    // 30-strong team and a 20-strong team are judged on accuracy, not size.
    const pulls = {};
    for (const team of state.teams) {
      const members = state.players.filter((p) => p.team === team.id);
      if (!members.length) continue;
      const correct = members.filter((p) => state.submissions[p.id] === round.answerId).length;
      pulls[team.id] = (correct / members.length) * PULL;
      team.score += correct;
    }

    // Individual points still accrue so there's a personal leaderboard.
    state.solved.forEach((id, index) => {
      const bonus = index < 3 ? FAST_BONUS : 0;
      state.roundScores[id] = (state.roundScores[id] ?? 0) + SCORE.correct + bonus;
    });
    for (const p of state.players) p.score += state.roundScores[p.id] ?? 0;

    // Red pulls negative, Blue positive.
    const [red, blue] = state.teams;
    state.rope += (pulls[blue.id] ?? 0) - (pulls[red.id] ?? 0);
    state.rope = Math.max(-ROPE_LIMIT, Math.min(ROPE_LIMIT, state.rope));

    if (Math.abs(state.rope) >= ROPE_LIMIT) {
      state.wonBy = state.rope > 0 ? blue.id : red.id;
      state.over = true; // a clean pull ends it early
    }
  },

  revealFor(state) {
    const round = state.roundData;
    const counts = {};
    for (const choice of Object.values(state.submissions)) counts[choice] = (counts[choice] ?? 0) + 1;
    const leader = state.rope === 0 ? null : state.rope > 0 ? state.teams[1] : state.teams[0];
    return {
      headline: state.wonBy
        ? `${state.teams.find((t) => t.id === state.wonBy).name} wins the rope!`
        : `Answer: ${round.answer}`,
      answerId: round.answerId,
      options: round.options.map((o) => ({
        ...o,
        picked: counts[o.id] ?? 0,
        percent: Math.round(((counts[o.id] ?? 0) / Math.max(Object.keys(state.submissions).length, 1)) * 100),
        correct: o.id === round.answerId,
      })),
      leader: leader ? { name: leader.name, color: leader.color } : null,
    };
  },
});
