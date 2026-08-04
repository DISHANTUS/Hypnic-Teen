// Quiz — multiple choice across categories. One shot per question; the fastest
// correct answer takes a bonus.

import { createPartyGame, shuffle, DIFFICULTY_TIME } from '../party.js';
import { QUIZ } from '../content.js';
import { deal } from '../bank.js';

export default createPartyGame({
  id: 'quiz',
  name: 'Quiz',
  tagline: 'Movies, cricket, coding, anime, college. Fastest correct wins.',
  emoji: '❓',
  accent: '#c084fc',
  minPlayers: 1,
  // Everyone answers independently and scoring is per-option, so this one
  // scales with the crowd. `mass` switches the payload to counts + a top-10
  // board instead of a per-player array.
  maxPlayers: 2000,
  mass: true,
  mode: 'mcq',
  rounds: 8,
  phases: { answer: DIFFICULTY_TIME.medium, reveal: 7, write: 75 },
  // This game can take its questions from the players instead of the bank.
  authoring: true,

  options: {
    source: {
      label: 'Where the questions come from',
      hint: 'The bank, or each other',
      kind: 'choice',
      default: 'bank',
      choices: [
        { id: 'bank', label: 'Ready-made', note: 'thousands, never repeated' },
        { id: 'written', label: 'You write them', note: 'one player each round' },
      ],
    },
    rounds: {
      label: 'Questions',
      hint: 'How many are asked in the match',
      kind: 'number',
      min: 1,
      max: 30,
      // The bank has to hold a question for every round, so the ready-made
      // ceiling is what the bank can supply. Written mode has no such limit —
      // the players are the supply — and refineOptions lifts it below.
      hardMax: 60,
      step: 1,
      default: 8,
    },
    answerSeconds: {
      label: 'Seconds to answer',
      hint: 'How long everyone gets on each question',
      kind: 'number',
      min: 3,
      max: 120,
      // Typed, a host can give a room ten minutes on a question if they want
      // to. It is their room.
      hardMax: 900,
      step: 1,
      default: DIFFICULTY_TIME.medium,
    },
    optionCount: {
      label: 'Options per question',
      kind: 'number',
      min: 2,
      max: 6,
      step: 1,
      default: 4,
    },
    correctCount: {
      label: 'Right answers allowed',
      hint: 'More than one means you must find them all',
      kind: 'number',
      min: 1,
      max: 3,
      step: 1,
      default: 1,
    },
    pace: {
      label: 'Pace',
      hint: 'Less time is worth more points',
      kind: 'choice',
      default: 'normal',
      choices: [
        { id: 'relaxed', label: 'Relaxed', note: '×0.6 points' },
        { id: 'normal', label: 'Normal', note: 'standard points' },
        { id: 'brisk', label: 'Brisk', note: '×1.4 points' },
        { id: 'blitz', label: 'Blitz', note: '×2 points' },
      ],
    },
  },

  /**
   * The round ceiling depends on where the questions come from. Ready-made
   * questions are limited by what the bank can deal; questions the players
   * write are limited by nothing at all, so a host who wants a hundred-round
   * night gets one.
   */
  refineOptions: (settings) =>
    settings?.source === 'written'
      ? { rounds: { label: 'Questions', hint: 'One player writes each one', kind: 'number', min: 1, max: 30, hardMax: 1000, step: 1, default: 8 } }
      : {},
  howToPlay: [
    'A question and four options. Tap one — you only get a single shot.',
    'First correct answer takes a bonus on top, so do not sit on it.',
    'Wrong answers cost nothing but the chance, so never leave one blank.',
  ],

  buildDeck: ({ rounds = 8, source = 'bank', answerSeconds } = {}) => {
    const seconds = answerSeconds ?? DIFFICULTY_TIME.medium;
    const count = Math.max(12, rounds + 4);

    // When the players write the questions, the deck is a stack of blanks —
    // each one filled in during its own round by whoever the bag picked. They
    // still carry the clock, because the timing is the host's choice either way.
    if (source === 'written') {
      return Array.from({ length: count }, () => ({
        text: null,
        options: [],
        answerIds: [],
        authored: false,
        seconds,
      }));
    }

    // Every category's questions, dealt through the bank so the same ones do
    // not come back night after night — with enough spare to cover a host who
    // turns the round count up.
    const all = Object.entries(QUIZ).flatMap(([category, questions]) =>
      questions.map((q) => ({ ...q, category }))
    );
    return deal('quiz', all, count).map((q) => {
      const options = shuffle(q.options).map((label, i) => ({ id: `o${i}`, label }));
      const answerId = options.find((o) => o.label === q.answer).id;
      return {
        text: q.q,
        category: q.category,
        options,
        answerId,
        answerIds: [answerId],
        answer: q.answer,
        seconds,
      };
    });
  },

  promptFor: (round, state) => {
    const keys = round?.answerIds ?? (round?.answerId ? [round.answerId] : []);
    return {
      title: round?.text ?? 'Waiting for the question…',
      text: round?.category ?? '',
      options: round?.options ?? [],
      // Telling people "pick two" is the difference between a fair question and
      // a trick one, so the count is public even though the answers are not.
      pickCount: keys.length,
      author: round?.authorName ?? (state?.settings?.source === 'written' ? state?.authorName : null) ?? null,
    };
  },

  revealFor: (state) => {
    const round = state.roundData;
    const keys = round.answerIds ?? [round.answerId];
    // A submission is one option id, or an array of them when the question has
    // more than one right answer. Counting has to handle both.
    const counts = {};
    for (const pick of Object.values(state.submissions)) {
      for (const id of Array.isArray(pick) ? pick : [pick]) counts[id] = (counts[id] ?? 0) + 1;
    }
    const answered = Math.max(Object.keys(state.submissions).length, 1);
    return {
      headline: `Answer: ${round.answer}`,
      answerId: round.answerId,
      answerIds: keys,
      byline: round.authorName ? `written by ${round.authorName}` : null,
      options: round.options.map((o) => ({
        ...o,
        picked: counts[o.id] ?? 0,
        percent: Math.round(((counts[o.id] ?? 0) / answered) * 100),
        correct: keys.includes(o.id),
      })),
      correctPlayers: state.solved.map((id) => state.players.find((p) => p.id === id)?.name ?? '?'),
    };
  },
});
