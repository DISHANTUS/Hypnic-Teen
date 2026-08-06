// Imposter — everyone gets the same secret word except one player, who gets a
// decoy. Answer a question about it, then vote on who was faking.

import { createPartyGame, pickSome, shuffle, SCORE } from '../party.js';
import { IMPOSTER_WORDS, IMPOSTER_QUESTIONS } from '../content.js';
import { deal } from '../bank.js';

export default createPartyGame({
  id: 'imposter',
  name: 'Imposter',
  tagline: 'Everyone knows the word. One of you is bluffing. Find them.',
  emoji: '🎭',
  accent: '#ff5c8a',
  minPlayers: 4,
  maxPlayers: 12,
  mode: 'answer-vote',
  rounds: 5,
  phases: { brief: 8, answer: 60, vote: 35, reveal: 12 },
  allowSelfVote: false,
  howToPlay: [
    'Everyone gets a secret word. One of you gets a different one and does not know it.',
    'Describe your word without saying it. Too obvious and you expose yourself; too vague and you look guilty.',
    'Then everyone votes. Catch the imposter and the rest of you score; survive the vote and the imposter does.',
  ],

  // Dealt through the bank, like every other game. This was still drawing
  // straight from the shipped list, which reshuffles the same few dozen pairs
  // every match — so the third night in a row was the same words in a
  // different order, and the bank's memory never saw them at all.
  buildDeck: ({ rounds = 6 } = {}) => {
    const count = Math.max(8, rounds + 2);
    const pairs = deal('imposter', IMPOSTER_WORDS, count);
    // The questions rotate on their own history, so a repeated word does not
    // drag the same question back with it.
    const asks = deal('imposter-questions', IMPOSTER_QUESTIONS, count);
    return pairs.map((pair, i) => ({
      ...pair,
      question: asks.length ? asks[i % asks.length] : IMPOSTER_QUESTIONS[i % IMPOSTER_QUESTIONS.length],
    }));
  },

  // One imposter, or two once the room is big enough to hide in.
  assignRoles(state) {
    const active = state.players.filter((p) => p.connected !== false);
    const imposterCount = active.length >= 7 ? 2 : 1;
    const chosen = shuffle(active).slice(0, imposterCount).map((p) => p.id);
    state.imposters = chosen;
    for (const p of state.players) {
      state.roles[p.id] = chosen.includes(p.id) ? 'imposter' : 'civilian';
    }
  },

  secretFor(state, playerId) {
    const round = state.roundData;
    if (!round) return null;
    return state.roles[playerId] === 'imposter'
      ? { label: 'You are the IMPOSTER', word: round.decoy, hint: 'Blend in. Nobody else has this word.' }
      : { label: 'Secret word', word: round.word, hint: 'One player has a different word. Do not make it obvious.' };
  },

  promptFor: (round) => ({ title: round.question, text: 'Answer without giving the word away.' }),

  scoreRound(state) {
    const tally = {};
    for (const target of Object.values(state.votes)) tally[target] = (tally[target] ?? 0) + 1;
    const top = Math.max(0, ...Object.values(tally));
    const accused = Object.entries(tally)
      .filter(([, n]) => n === top && n > 0)
      .map(([id]) => id);

    const caught = accused.length > 0 && accused.every((id) => state.imposters.includes(id));
    state.caught = caught;

    for (const p of state.players) {
      const isImposter = state.imposters.includes(p.id);
      if (caught && !isImposter) {
        // Civilians win the round; voting correctly is worth extra.
        const votedRight = state.imposters.includes(state.votes[p.id]);
        state.roundScores[p.id] = SCORE.correct + (votedRight ? SCORE.fastest : 0);
      } else if (!caught && isImposter) {
        state.roundScores[p.id] = SCORE.winnerBonus;
      } else {
        state.roundScores[p.id] = 0;
      }
    }
    for (const p of state.players) p.score += state.roundScores[p.id] ?? 0;
  },

  revealFor(state) {
    const tally = {};
    for (const target of Object.values(state.votes)) tally[target] = (tally[target] ?? 0) + 1;
    return {
      headline: state.caught ? 'Imposter caught!' : 'The imposter got away',
      won: state.caught ? 'civilians' : 'imposter',
      word: state.roundData?.word,
      decoy: state.roundData?.decoy,
      imposters: state.imposters.map((id) => ({
        id,
        name: state.players.find((p) => p.id === id)?.name ?? '?',
      })),
      answers: Object.entries(state.submissions).map(([id, text]) => ({
        playerId: id,
        name: state.players.find((p) => p.id === id)?.name ?? '?',
        text: String(text),
        votes: tally[id] ?? 0,
        wasImposter: state.imposters.includes(id),
      })),
    };
  },
});
