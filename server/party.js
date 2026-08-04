// The party-round engine.
//
// Seven of the studio's games are the same loop with a different collection
// step: show a prompt, gather something from everyone, reveal, score, repeat.
// This module owns that loop — phases, timers, submissions, votes, scoring and
// the private-view split — so a game module is just content plus rules.
//
// Modes:
//   answer-vote  everyone writes an answer, then votes         (Imposter, Situations)
//   race         progressive hints, first correct guess wins    (Find the Word, Movie, Song)
//   mcq          multiple choice, fastest correct gets a bonus  (Quiz)
//   poll         anonymous vote, results as percentages         (Poll)
//   turn         one player on the spot                         (Truth or Dare)

import { llmReady, say } from './llm.js';

export const SCORE = {
  correct: 10,
  fastest: 5,
  winnerBonus: 20,
  votePerBacker: 5, // an answer earns this per vote it attracts
  bestAnswer: 10,
};

export const DIFFICULTY_TIME = { easy: 30, medium: 20, hard: 10 };

// How long the rules stay up before round one. Everyone tapping "Ready" cuts
// it short, so a room that already knows the game never waits the full time.
export const INTRO_SECONDS = 12;

// How often a CPU player gets it right. Deliberately short of perfect.
const BOT_ACCURACY = 0.72;

// What a CPU says when there is no local model, or it is too slow. Dull on
// purpose — a canned line that tried to be funny would be worse than one that
// obviously isn't.
const CANNED = [
  'Run and explain later.',
  'Ask someone smarter than me.',
  'Pretend it never happened.',
  'Blame the WiFi.',
  'Do it, but with confidence.',
  'Wait for a better idea.',
  'Split it evenly and move on.',
];

/**
 * A written answer from a CPU player. Uses the local model when one is up —
 * this is the one place a language model genuinely helps, because the game is
 * asking a human to be inventive in a sentence. Falls back instantly if the
 * model is missing or slow; the round must never wait on it.
 */
function botWrite(state, me, cfg) {
  const round = state.roundData ?? {};
  const secret = cfg.secretFor?.(state, me.id);

  if (!llmReady()) {
    return { type: 'answer', text: CANNED[Math.floor(Math.random() * CANNED.length)] };
  }

  const prompt = secret?.word
    ? `You are playing a party word game with friends. Your secret word is "${secret.word}".\n` +
      `Describe it in ONE short sentence WITHOUT ever using the word itself. Be vague enough to stay hidden, specific enough to sound like you know it.\n` +
      `Reply with the sentence only.`
    : `You are playing a party game with friends. The situation:\n"${round.text ?? round.prompt ?? 'Something has gone wrong.'}"\n` +
      `Reply with ONE short, funny, harmless answer — under 12 words. Reply with the answer only.`;

  return say(prompt, { maxTokens: 48 }).then((text) => ({
    type: 'answer',
    text: text || CANNED[Math.floor(Math.random() * CANNED.length)],
  }));
}

/**
 * How fast the host wants the room to move. `time` stretches every phase;
 * `score` pays out accordingly, so a room that gives itself twice as long
 * cannot out-earn one playing under pressure.
 */
export const PACES = [
  { id: 'relaxed', label: 'Relaxed', time: 1.75, score: 0.6 },
  { id: 'normal', label: 'Normal', time: 1, score: 1 },
  { id: 'brisk', label: 'Brisk', time: 0.7, score: 1.4 },
  { id: 'blitz', label: 'Blitz', time: 0.5, score: 2 },
];

const paceById = (id) => PACES.find((p) => p.id === id) ?? PACES[1];

/**
 * Clamps whatever the client sent to something the game can actually run.
 * Settings arrive from a host who can edit them freely, so nothing here may
 * trust the incoming shape.
 */
export function normaliseSettings(options, raw) {
  const out = {};
  for (const [key, spec] of Object.entries(options ?? {})) {
    const value = raw?.[key];
    if (spec.kind === 'choice') {
      out[key] = spec.choices.some((c) => c.id === value) ? value : spec.default;
    } else if (spec.kind === 'number') {
      const n = Math.round(Number(value));
      // `max` is where the slider stops; `hardMax` is where the rules do. A
      // host who wants a hundred rounds should get a hundred rounds — the
      // slider is a convenience, not a ceiling.
      const ceiling = spec.hardMax ?? spec.max;
      out[key] = Number.isFinite(n) ? Math.min(ceiling, Math.max(spec.min, n)) : spec.default;
    } else if (spec.kind === 'toggle') {
      out[key] = typeof value === 'boolean' ? value : spec.default;
    }
  }
  return out;
}

const COLORS = ['#ff5c8a', '#4ad6ff', '#ffd166', '#8affc1', '#c084fc', '#ff9f45', '#7c5cff', '#3ddc97'];

/** Team sides, in join order. Two is the usual shape; four works too. */
export const TEAM_DEFS = [
  { id: 'red', name: 'Red', color: '#ff3d6e' },
  { id: 'blue', name: 'Blue', color: '#2de2e6' },
  { id: 'gold', name: 'Gold', color: '#ffc93c' },
  { id: 'green', name: 'Green', color: '#3ddc97' },
];

/** Puts a player on whichever side is currently short-handed. */
function assignTeam(state) {
  const counts = state.teams.map((t) => state.players.filter((p) => p.team === t.id).length);
  const smallest = counts.indexOf(Math.min(...counts));
  return state.teams[smallest].id;
}

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Accepts near-misses so a stray space or "the" doesn't cost someone the round. */
export function answerMatches(guess, answer, aliases = []) {
  const g = norm(guess);
  if (!g) return false;
  return [answer, ...aliases].some((candidate) => {
    const c = norm(candidate);
    if (!c) return false;
    if (g === c) return true;
    // Allow one typo on longer answers.
    return c.length >= 6 && levenshtein(g, c) <= 1;
  });
}

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

export const shuffle = (arr) => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export const pickSome = (arr, n) => shuffle(arr).slice(0, n);

/**
 * Builds a room-compatible game module from a party config.
 *
 * @param {Object} cfg
 * @param {string} cfg.mode
 * @param {(ctx:{players:any[]}) => any[]} cfg.buildDeck   one entry per round
 * @param {(round:any, state:any) => any} [cfg.promptFor]  what the client shows
 * @param {(state:any) => void} [cfg.assignRoles]          per-round secret roles
 * @param {(state:any, api:any) => void} [cfg.scoreRound]  custom scoring
 * @param {Object} [cfg.phases]                            phase -> seconds
 */
export function createPartyGame(cfg) {
  const phaseTimes = { brief: 6, answer: 45, vote: 30, reveal: 8, ...cfg.phases };
  const maxRounds = cfg.rounds ?? 5;

  // What the host is allowed to change before pressing Start. Games add their
  // own on top, so a new game can expose its own knobs without the lobby or the
  // settings plumbing knowing anything about it.
  const options = {
    rounds: {
      label: 'Rounds',
      hint: 'How long the match runs',
      kind: 'number',
      min: 1,
      max: Math.max(maxRounds, 20),
      step: 1,
      default: maxRounds,
    },
    pace: {
      label: 'Pace',
      hint: 'Less time is worth more points',
      kind: 'choice',
      default: 'normal',
      choices: PACES.map((p) => ({
        id: p.id,
        label: p.label,
        note: p.score === 1 ? 'standard points' : `×${p.score} points`,
      })),
    },
    ...cfg.options,
  };

  const settingsOf = (state) => state?.settings ?? {};
  const paceOf = (state) => paceById(settingsOf(state).pace);

  /** Which phases this mode walks through, in order. */
  const phasesFor = (state) => {
    // A game whose questions come from the players needs somebody to write one
    // before anybody can answer it.
    const authored = cfg.authoring && settingsOf(state).source === 'written';
    switch (cfg.mode) {
      case 'answer-vote': {
        const base = cfg.assignRoles ? ['brief', 'answer', 'vote', 'reveal'] : ['answer', 'vote', 'reveal'];
        return authored ? ['write', ...base] : base;
      }
      case 'race':
      case 'mcq':
        return authored ? ['write', 'answer', 'reveal'] : ['answer', 'reveal'];
      case 'poll':
        return ['answer', 'reveal'];
      case 'turn':
        return ['choose', 'perform', 'reveal'];
      default:
        return ['answer', 'reveal'];
    }
  };

  /**
   * A match opens with the rules on screen and the clock stopped. Nobody
   * should be learning how a game works while their answer time drains — and
   * in a room where half the players have never seen the game, they were.
   */
  function startIntro(state) {
    state.dirty = true;
    state.phase = 'intro';
    state.round = 0;
    state.ready = [];
    state.phaseTotal = INTRO_SECONDS;
    state.timeLeft = INTRO_SECONDS;
    state.phaseStarted = Date.now();
  }

  function beginRound(state) {
    state.dirty = true;
    state.round += 1;
    state.roundData = state.deck[state.round - 1] ?? null;
    state.submissions = {};
    state.votes = {};
    state.roundScores = {};
    state.hintIndex = 0;
    state.solved = [];
    state.roles = {};
    state.phaseList = phasesFor(state);
    state.phaseIndex = -1;
    if (state.phaseList.includes('write')) pickAuthor(state);
    cfg.assignRoles?.(state);
    nextPhase(state);
  }

  /**
   * Whose turn it is to write a question.
   *
   * Straight rotation is fair but boring: with four players and five rounds,
   * everyone can see who is coming, and knowing you are safe for the next
   * three rounds takes all the tension out. This draws from a bag instead —
   * everybody writes once before anybody writes twice, but the order inside
   * each pass is redrawn, so the next name is genuinely unknown right up to
   * the moment it appears.
   */
  function pickAuthor(state) {
    const active = state.players.filter((p) => p.connected !== false).map((p) => p.id);
    if (!active.length) return;
    // Anyone who joined mid-match belongs in the current bag too.
    state.authorBag = (state.authorBag ?? []).filter((id) => active.includes(id));
    if (!state.authorBag.length) {
      state.authorBag = shuffle(active);
      // Never open a fresh bag with the person who closed the last one — that
      // is the one predictable moment a bag can produce, and it reads as the
      // same player twice in a row.
      if (state.authorBag.length > 1 && state.authorBag[0] === state.lastAuthorId) {
        state.authorBag.push(state.authorBag.shift());
      }
    }
    state.authorId = state.authorBag.shift();
    state.lastAuthorId = state.authorId;
  }

  function nextPhase(state) {
    state.dirty = true;
    state.phaseIndex += 1;
    if (state.phaseIndex >= state.phaseList.length) {
      if (state.round >= state.totalRounds) {
        state.over = true;
        state.phase = 'over';
        return;
      }
      return beginRound(state);
    }
    state.phase = state.phaseList[state.phaseIndex];
    const seconds = phaseTimeFor(state, state.phase);
    state.phaseTotal = seconds;
    state.timeLeft = seconds;
    state.phaseStarted = Date.now();
    if (state.phase === 'reveal') scoreRound(state);
  }

  function phaseTimeFor(state, phase) {
    const base = phase === 'answer' && state.roundData?.seconds ? state.roundData.seconds : phaseTimes[phase] ?? 20;
    // Results screens are for reading, not for racing — stretching them with
    // the pace is fine, but squeezing them below readable is not.
    const stretched = base * paceOf(state).time;
    return Math.max(phase === 'reveal' ? 5 : 6, Math.round(stretched));
  }

  /** Everyone acted — no reason to sit and watch a clock run out. */
  function everyoneDone(state) {
    const active = state.players.filter((p) => p.connected !== false);
    if (!active.length) return false;
    if (state.phase === 'intro') return active.every((p) => state.ready?.includes(p.id));
    // Only one person is writing, so the round moves on the moment they are
    // done rather than waiting out a clock everyone else is watching.
    if (state.phase === 'write') return Boolean(state.roundData?.authored);
    if (state.phase === 'answer') {
      if (cfg.mode === 'race') return active.every((p) => state.solved.includes(p.id));
      return active.every((p) => state.submissions[p.id] !== undefined);
    }
    if (state.phase === 'vote') {
      const eligible = active.filter((p) => cfg.mode !== 'answer-vote' || true);
      return eligible.every((p) => state.votes[p.id] !== undefined);
    }
    if (state.phase === 'choose') return Boolean(state.submissions[state.turnPlayerId]);
    if (state.phase === 'perform') return Boolean(state.submissions.__done);
    return false;
  }

  function scoreRound(state) {
    if (cfg.scoreRound) {
      cfg.scoreRound(state);
    } else if (cfg.mode === 'answer-vote') {
      // Votes are for the best answer: each backer is worth points.
      const tally = {};
      for (const target of Object.values(state.votes)) tally[target] = (tally[target] ?? 0) + 1;
      const top = Math.max(0, ...Object.values(tally));
      for (const [playerId, count] of Object.entries(tally)) {
        award(state, playerId, count * SCORE.votePerBacker + (count === top ? SCORE.bestAnswer : 0));
      }
    } else if (cfg.mode === 'poll') {
      for (const p of state.players) if (state.votes[p.id] !== undefined) award(state, p.id, 5);
    }
    for (const p of state.players) p.score += state.roundScores[p.id] ?? 0;
  }

  // Every point in every game flows through here, so the pace multiplier is
  // applied once rather than being remembered at each call site.
  function award(state, playerId, points) {
    const scaled = Math.round(points * paceOf(state).score);
    state.roundScores[playerId] = (state.roundScores[playerId] ?? 0) + scaled;
  }

  /* --------------------------- serialization --------------------------- */

  function publicPrompt(state) {
    const round = state.roundData;
    if (!round) return null;
    const prompt = cfg.promptFor ? cfg.promptFor(round, state) : { text: round.text ?? '' };
    if (cfg.mode === 'race') {
      // Hints arrive one at a time as the clock runs down.
      prompt.hints = (round.hints ?? []).slice(0, state.hintIndex + 1);
      prompt.hintsTotal = (round.hints ?? []).length;
    }
    return prompt;
  }

  const TOP_SHOWN = 10;

  function base(state) {
    const shared = {
      mode: cfg.mode,
      mass: Boolean(cfg.mass),
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
      phaseTotal: state.phaseTotal,
      prompt: publicPrompt(state),
      turnPlayerId: state.turnPlayerId ?? null,
      // Whose turn it is to write one. Everyone sees the name — half the fun
      // is watching somebody realise it is them.
      authorId: state.authorId ?? null,
      authorName: state.players.find((p) => p.id === state.authorId)?.name ?? null,
      // What the writer is allowed to build, so the form can enforce it before
      // the server has to refuse it.
      compose:
        state.phase === 'write'
          ? {
              kind: cfg.composeKind ?? 'mcq',
              options: settingsOf(state).optionCount ?? 4,
              correct: settingsOf(state).correctCount ?? 1,
              placeholder: cfg.composePlaceholder ?? 'Ask them something…',
              hint: cfg.composeHint ?? null,
            }
          : null,
      reveal: state.phase === 'reveal' ? (cfg.revealFor?.(state) ?? defaultReveal(state)) : null,
      // So the scoreboard can say why everyone's points look different today.
      pace: { id: paceOf(state).id, label: paceOf(state).label, score: paceOf(state).score },
    };

    if (state.phase === 'intro') {
      shared.brief = {
        name: cfg.name,
        emoji: cfg.emoji,
        tagline: cfg.tagline,
        rules: cfg.howToPlay ?? [],
        rounds: state.totalRounds,
        pace: paceOf(state).label,
        scoreNote: paceOf(state).score === 1 ? null : `Points ×${paceOf(state).score} at this pace`,
        readyCount: state.ready?.length ?? 0,
        total: state.players.filter((p) => p.connected !== false).length,
      };
    }

    // Team standings are two or four entries — the same size at 6 players or
    // 600, so they ride along in every payload.
    if (state.teams) {
      shared.teams = state.teams.map((t) => ({
        ...t,
        members: state.players.filter((p) => p.team === t.id).length,
        acted: state.players.filter((p) => p.team === t.id && state.submissions[p.id] !== undefined).length,
      }));
    }
    if (cfg.extra) Object.assign(shared, cfg.extra(state));

    if (!cfg.mass) {
      // Small room: everyone can see everyone.
      shared.players = state.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        score: p.score,
        roundScore: state.roundScores[p.id] ?? 0,
        answered: state.submissions[p.id] !== undefined,
        voted: state.votes[p.id] !== undefined,
        solved: state.solved.includes(p.id),
      }));
      return shared;
    }

    // Mass room: a per-player array would be quadratic — 500 players each
    // receiving 500 entries. Send counts plus a leaderboard instead, which is
    // the same size whether 60 people are playing or 5,000.
    let answered = 0;
    let solved = 0;
    for (const p of state.players) {
      if (state.submissions[p.id] !== undefined) answered += 1;
      if (state.solved.includes(p.id)) solved += 1;
    }
    shared.crowd = {
      total: state.players.length,
      answered,
      solved,
      voted: Object.keys(state.votes).length,
    };
    shared.top = [...state.players]
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_SHOWN)
      .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, color: p.color, score: p.score }));
    return shared;
  }

  function defaultReveal(state) {
    const tally = {};
    for (const target of Object.values(state.votes)) tally[target] = (tally[target] ?? 0) + 1;
    const totalVotes = Object.values(tally).reduce((a, b) => a + b, 0) || 1;

    // Quiz-style rounds record the chosen option as a submission, not a vote,
    // so the option bars have to be counted from there or every bar reads 0%.
    const optionTally = cfg.mode === 'mcq' ? {} : tally;
    let optionTotal = totalVotes;
    if (cfg.mode === 'mcq') {
      for (const choice of Object.values(state.submissions)) {
        optionTally[choice] = (optionTally[choice] ?? 0) + 1;
      }
      optionTotal = Object.values(optionTally).reduce((a, b) => a + b, 0) || 1;
    }

    return {
      answer: state.roundData?.answer ?? null,
      answers: Object.entries(state.submissions)
        .filter(([id]) => !id.startsWith('__'))
        .map(([id, value]) => ({
          playerId: id,
          name: state.players.find((p) => p.id === id)?.name ?? '?',
          text: typeof value === 'string' ? value : (value?.text ?? ''),
          votes: tally[id] ?? 0,
          percent: Math.round(((tally[id] ?? 0) / totalVotes) * 100),
        })),
      options: (state.roundData?.options ?? []).map((opt) => ({
        id: opt.id,
        label: opt.label,
        votes: optionTally[opt.id] ?? 0,
        percent: Math.round(((optionTally[opt.id] ?? 0) / optionTotal) * 100),
        correct: state.roundData?.answerId ? opt.id === state.roundData.answerId : undefined,
      })),
    };
  }

  return {
    id: cfg.id,
    name: cfg.name,
    tagline: cfg.tagline,
    emoji: cfg.emoji,
    accent: cfg.accent,
    minPlayers: cfg.minPlayers ?? 2,
    maxPlayers: cfg.maxPlayers ?? 12,
    tickRate: 4,

    options,

    // Some settings decide what the others may be — picking Tamil should offer
    // Tamil genres. A game says so by exporting refineOptions, and this has to
    // be forwarded or the room only ever sees the opening descriptor and every
    // language shows the same genre list.
    ...(cfg.refineOptions
      ? { refineOptions: (settings) => ({ ...options, ...cfg.refineOptions(settings) }) }
      : {}),

    // Rules screens are read by the client, so they belong on the module.
    howToPlay: cfg.howToPlay ?? [],

    createState(players, ctx = {}) {
      const teams = cfg.teams ? TEAM_DEFS.slice(0, cfg.teams).map((t) => ({ ...t, score: 0 })) : null;
      // Settled before the deck is built, because how many rounds the host
      // asked for decides how much material to deal.
      const settings = normaliseSettings(options, ctx.settings);
      const state = {
        settings,
        teams,
        players: players.map((p, i) => ({
          id: p.id,
          name: p.name,
          color: teams ? teams[i % teams.length].color : COLORS[i % COLORS.length],
          // Alternate on deal so the sides start even.
          team: teams ? teams[i % teams.length].id : null,
          score: 0,
          connected: true,
        })),
        // The deck is built knowing how many rounds the host asked for, so a
        // long match does not quietly get capped by a short deck.
        // The whole setup, not just the round count. A game that wants to know
        // how long an answer gets, or where its questions come from, was being
        // handed the round count and left to guess at the rest.
        deck: cfg.buildDeck({ ...settings, players, rounds: settings.rounds ?? maxRounds }),
        round: 0,
        over: false,
        roundScores: {},
        submissions: {},
        votes: {},
        solved: [],
        roles: {},
        hintIndex: 0,
      };
      state.totalRounds = Math.min(state.settings.rounds ?? maxRounds, state.deck.length);
      startIntro(state);
      return state;
    },

    onPlayerJoin(state, player) {
      if (state.players.some((p) => p.id === player.id)) {
        state.players.find((p) => p.id === player.id).connected = true;
        return;
      }
      const team = state.teams ? assignTeam(state) : null;
      state.players.push({
        id: player.id,
        name: player.name,
        color: team
          ? state.teams.find((t) => t.id === team).color
          : COLORS[state.players.length % COLORS.length],
        team,
        score: 0,
        connected: true,
      });
      state.dirty = true;
    },

    onPlayerLeave(state, player) {
      const p = state.players.find((x) => x.id === player.id);
      if (p) p.connected = false;
    },

    onAction(state, player, action, api) {
      if (state.over) return;
      // Any action can move the round on, so the next tick must publish.
      state.dirty = true;
      // ...and this player's own view definitely changed.
      (state.privateDirty ??= new Set()).add(player.id);
      const handled = cfg.onAction?.(state, player, action, api, { award, answerMatches });
      if (handled) return;

      switch (action?.type) {
        // A question written by a player, mid-match. Only the person whose
        // turn it is may write, and everything they send is rebuilt here
        // rather than trusted — the client decides nothing about scoring.
        case 'compose': {
          if (state.phase !== 'write' || player.id !== state.authorId) return;
          const settings = settingsOf(state);
          const text = String(action.text ?? '').slice(0, 200).trim();

          // Some games want a scenario, not a question with answers — the room
          // writes its own replies and votes on them, so there is nothing to
          // mark and nothing to build but the prompt itself.
          if (cfg.composeKind === 'text') {
            if (text.length < 8) return;
            state.roundData = {
              ...state.roundData,
              text,
              authored: true,
              authorName: player.name,
            };
            return;
          }

          const raw = Array.isArray(action.options) ? action.options : [];
          const options = raw
            .map((o) => String(o?.label ?? o ?? '').slice(0, 80).trim())
            .filter(Boolean)
            .slice(0, settings.optionCount ?? 4);
          // Two options is the least that is still a question; duplicates make
          // a round where two answers are the same and one of them is wrong.
          const unique = [...new Set(options.map((o) => o.toLowerCase()))];
          if (!text || options.length < 2 || unique.length !== options.length) return;

          const correct = [...new Set((Array.isArray(action.correct) ? action.correct : []).map(Number))]
            .filter((i) => Number.isInteger(i) && i >= 0 && i < options.length)
            .slice(0, settings.correctCount ?? 1);
          if (!correct.length) return; // a question with no right answer is a poll

          const built = options.map((label, i) => ({ id: `o${i}`, label }));
          state.roundData = {
            ...state.roundData,
            text,
            category: `written by ${player.name}`,
            options: built,
            answerIds: correct.map((i) => `o${i}`),
            answerId: `o${correct[0]}`, // single-answer games still read this
            answer: correct.map((i) => options[i]).join(', '),
            authored: true,
            authorName: player.name,
          };
          return;
        }

        case 'answer': {
          if (state.phase !== 'answer' && state.phase !== 'perform' && state.phase !== 'choose') return;
          const text = String(action.text ?? '').slice(0, 240).trim();

          if (cfg.mode === 'race') {
            if (state.solved.includes(player.id) || !text) return;
            const round = state.roundData;
            if (answerMatches(text, round.answer, round.aliases)) {
              const first = state.solved.length === 0;
              state.solved.push(player.id);
              state.submissions[player.id] = text;
              // Fewer hints used means a bigger reward.
              const hintBonus = Math.max(0, (round.hints?.length ?? 1) - 1 - state.hintIndex);
              award(state, player.id, SCORE.correct + (first ? SCORE.fastest : 0) + hintBonus);
              api?.emit('solved', { playerId: player.id, name: player.name, first });
            } else {
              api?.emitTo(player.id, 'wrong', { text });
            }
            return;
          }

          if (cfg.mode === 'turn' && state.phase === 'choose') {
            if (player.id !== state.turnPlayerId) return;
            state.submissions[state.turnPlayerId] = String(action.choice ?? 'truth');
            return;
          }

          if (!text) return;
          state.submissions[player.id] = text;
          return;
        }

        case 'choice': {
          if (state.phase !== 'answer') return;
          const optionId = String(action.optionId ?? '');
          if (cfg.mode === 'mcq') {
            if (state.submissions[player.id] !== undefined) return; // one shot
            const round = state.roundData;
            const keys = round.answerIds ?? [round.answerId];

            // A question can have more than one right answer, in which case
            // picking one of three correct options is not the same as picking
            // all three — so the whole set arrives at once and is marked
            // together. Ticking every box must not be a winning strategy, so
            // wrong ticks cancel right ones.
            if (keys.length > 1) {
              const picks = [...new Set((Array.isArray(action.optionIds) ? action.optionIds : [optionId]).map(String))]
                .filter((id) => round.options.some((o) => o.id === id))
                .slice(0, round.options.length);
              if (!picks.length) return;
              state.submissions[player.id] = picks;

              const right = picks.filter((id) => keys.includes(id)).length;
              const wrong = picks.length - right;
              const net = right - wrong;
              if (net <= 0) return;
              const perfect = right === keys.length && !wrong;
              if (perfect) state.solved.push(player.id);
              const first = perfect && state.solved.length === 1;
              // Part marks for a partial answer, full marks plus the speed
              // bonus only for getting all of it and nothing else.
              award(
                state,
                player.id,
                Math.round((SCORE.correct * net) / keys.length) + (first ? SCORE.fastest : 0)
              );
              return;
            }

            state.submissions[player.id] = optionId;
            if (optionId === round.answerId) {
              const first = state.solved.length === 0;
              state.solved.push(player.id);
              award(state, player.id, SCORE.correct + (first ? SCORE.fastest : 0));
            }
            return;
          }
          if (cfg.mode === 'poll') {
            state.votes[player.id] = optionId;
            state.submissions[player.id] = optionId;
          }
          return;
        }

        case 'vote': {
          if (state.phase !== 'vote') return;
          const target = String(action.targetId ?? '');
          if (target === player.id && cfg.allowSelfVote === false) return;
          state.votes[player.id] = target;
          return;
        }

        case 'done': {
          if (state.phase === 'perform') state.submissions.__done = true;
          return;
        }

        case 'ready': {
          if (state.phase !== 'intro') return;
          if (!state.ready.includes(player.id)) {
            state.ready.push(player.id);
            state.dirty = true;
          }
          return;
        }

        case 'skip': {
          if (state.phase === 'answer') state.submissions[player.id] = '';
          return;
        }
      }
    },

    /**
     * One CPU brain for every party game. It reads the same serialized view a
     * browser gets, so it can only act on what a player could see — a bot that
     * peeked at raw state would beat everyone and be no fun.
     *
     * Returns an action, null to keep waiting, or a promise when the local
     * model is writing something.
     */
    botAction(state, bot) {
      const me = state.players.find((p) => p.id === bot.id);
      if (!me || state.over) return null;

      switch (state.phase) {
        case 'intro':
          return state.ready?.includes(bot.id) ? null : { type: 'ready' };

        case 'answer': {
          if (state.submissions[bot.id] !== undefined) return null;
          const round = state.roundData;

          if (cfg.mode === 'mcq' || cfg.mode === 'poll') {
            const options = round?.options ?? [];
            if (!options.length) return null;
            // Right most of the time, wrong sometimes — a CPU that never
            // misses is a wall, not an opponent.
            const answer = options.find((o) => o.id === round.answerId);
            const pick =
              answer && Math.random() < BOT_ACCURACY
                ? answer
                : options[Math.floor(Math.random() * options.length)];
            return { type: 'choice', optionId: pick.id };
          }

          if (cfg.mode === 'race') {
            if (state.solved.includes(bot.id)) return null;
            // Wait until a couple of hints are out, then usually get it.
            if (state.hintIndex < 1) return null;
            if (Math.random() > 0.5) return null; // keep thinking
            const truth = round?.answer;
            if (truth && Math.random() < BOT_ACCURACY) return { type: 'answer', text: truth };
            return null;
          }

          // Free text — Situations, and the imposter's description.
          return botWrite(state, me, cfg);
        }

        case 'vote': {
          if (state.votes[bot.id] !== undefined) return null;
          if (cfg.mode === 'answer-vote') {
            const others = Object.keys(state.submissions).filter(
              (id) => !id.startsWith('__') && id !== bot.id
            );
            if (!others.length) return null;
            return { type: 'vote', targetId: others[Math.floor(Math.random() * others.length)] };
          }
          const rivals = state.players.filter((p) => p.id !== bot.id);
          if (!rivals.length) return null;
          return { type: 'vote', targetId: rivals[Math.floor(Math.random() * rivals.length)].id };
        }

        case 'choose':
          if (state.turnPlayerId !== bot.id) return null;
          return { type: 'answer', choice: Math.random() < 0.5 ? 'truth' : 'dare' };

        case 'perform':
          if (state.turnPlayerId !== bot.id) return null;
          return { type: 'done' };

        default:
          return null;
      }
    },

    onTick(state, dt) {
      if (state.over) return;
      state.timeLeft -= dt;

      // The briefing is not part of any round, so it hands off to round one
      // rather than walking the normal phase list.
      if (state.phase === 'intro') {
        if (state.timeLeft <= 0 || everyoneDone(state)) beginRound(state);
        return;
      }

      // Race mode leaks a new hint at regular intervals.
      if (state.phase === 'answer' && cfg.mode === 'race') {
        const hints = state.roundData?.hints ?? [];
        const step = state.phaseTotal / Math.max(hints.length, 1);
        const elapsed = state.phaseTotal - state.timeLeft;
        const next = Math.min(hints.length - 1, Math.floor(elapsed / step));
        if (next !== state.hintIndex) {
          state.hintIndex = next;
          state.dirty = true;
        }
      }

      if (state.timeLeft <= 0 || everyoneDone(state)) nextPhase(state);
    },

    /**
     * Broadcasting 4×/second when only the clock moved costs ~19 MB per player
     * per hour — real money on mobile data. The room asks this before sending,
     * so state goes out on actual change; clients run the countdown themselves
     * from the last frame they received.
     */
    isDirty(state) {
      const was = state.dirty;
      state.dirty = false;
      return Boolean(was);
    },

    isOver: (state) => state.over === true,

    results(state) {
      const ranked = [...state.players].sort((a, b) => b.score - a.score);
      if (ranked.length && ranked[0].score > 0) ranked[0].score += SCORE.winnerBonus;
      return ranked.map((p, i) => ({ playerId: p.id, name: p.name, score: p.score, place: i + 1 }));
    },

    serialize: (state) => base(state),

    /**
     * Mass rooms split the payload: the crowd view is broadcast once by the
     * room, and this private slice goes only to the player it changed for —
     * which is only ever the player who just acted.
     */
    mass: Boolean(cfg.mass),

    privateFor: (state, playerId) => privateSlice(state, playerId),

    /** Who needs a fresh private slice, and clear the list. */
    takePrivateDirty(state) {
      const ids = [...(state.privateDirty ?? [])];
      state.privateDirty = new Set();
      return ids;
    },

    /** Private view: your own role, your own answer, what you may not see. */
    serializeFor(state, playerId) {
      const view = base(state);
      view.you = privateSlice(state, playerId);
      if (cfg.mode === 'answer-vote' && (state.phase === 'vote' || state.phase === 'reveal')) {
        view.answers = Object.entries(state.submissions)
          .filter(([id]) => !id.startsWith('__'))
          .map(([id, text]) => ({
            playerId: id,
            name: state.players.find((p) => p.id === id)?.name ?? '?',
            text: String(text),
          }));
      }
      return view;
    },
  };

  /** Everything only this player may see. Small, and cheap to build. */
  function privateSlice(state, playerId) {
    const me = state.players.find((p) => p.id === playerId);
    return {
      id: playerId,
      team: me?.team ?? null,
      role: state.roles[playerId] ?? null,
      secret: cfg.secretFor?.(state, playerId) ?? null,
      answer: state.submissions[playerId] ?? null,
      vote: state.votes[playerId] ?? null,
      score: me?.score ?? 0,
      roundScore: state.roundScores[playerId] ?? 0,
      solved: state.solved.includes(playerId),
      isTurn: state.turnPlayerId === playerId,
      ready: Boolean(state.ready?.includes(playerId)),
    };
  }
}
