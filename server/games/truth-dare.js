// Truth or Dare — the bottle decides.
//
// The paper version of this game is two people arguing about whose turn it is.
// The bottle settles that, and it settles something else too: it picks the
// *pair*. Whoever the neck lands on is on the spot; whoever is sitting at the
// other end asks them. So the question is never the app's, it is a person's,
// typed by somebody looking straight at them — which is the whole game.
//
// A dare is not finished when the clock runs out. The person who set it has to
// say it happened. If it did not, the room hands out a nickname, and it sticks
// for the rest of the night.
//
// The circle is reshuffled between rounds, so you do not spend an evening
// facing the same person.

import { deal } from '../bank.js';
// How long the rules stay up before the first spin happens without you. Taken
// from the party engine rather than picked again here, so this game's briefing
// does not sit on screen twice as long as every other game's.
import { INTRO_SECONDS as BRIEF_SECONDS } from '../party.js';
import { TRUTHS, DARES } from '../content.js';

/** How long each part of a round lasts, before the host changes it. */
const BEATS = { spin: 5, choose: 14, write: 50, act: 90, verdict: 30, reveal: 8 };


/**
 * Names for someone who would not go through with it. Teasing, not cruel —
 * this is a thing friends call each other across a room, and it wears off with
 * the match rather than following anyone onto their profile.
 */
const NICKNAMES = [
  'Chicken Little', 'The Ghost', 'Captain Backout', 'Sir Bails-a-Lot', 'The Vanisher',
  'Cold Feet', 'The Statue', 'Professor Nope', 'The Dodger', 'Lord Chickenheart',
  'The Escape Artist', 'Mister Maybe-Later', 'The Melting Ice Cube', 'Bailey McBailface',
  'The Turtle', 'Second Thoughts', 'The Retreat', 'Duke of Dodge',
];

const now = () => Date.now();

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const seated = (state) => state.seats.map((id) => state.players.find((p) => p.id === id)).filter(Boolean);
const alive = (state) => state.players.filter((p) => p.connected !== false);
const nameOf = (state, id) => state.players.find((p) => p.id === id)?.name ?? 'Someone';

function say(state, text, tone = 'info') {
  state.log.push({ text, tone, at: now() });
  if (state.log.length > 30) state.log.shift();
  state.dirty = true;
}

/* ------------------------------- the bottle ------------------------------- */

/**
 * Spins. Returns the angle the neck comes to rest at and who it is pointing
 * at — the angle is decided here rather than in the browser so that everyone
 * watches the same spin land in the same place.
 *
 * Seat 0 sits at the top and they go round clockwise, which is what the client
 * draws, so seat = angle / (360 / n).
 */
function spinBottle(state) {
  const seats = state.seats.length;
  const slice = 360 / seats;

  // Land inside a seat's wedge rather than exactly on its centre — a bottle
  // that stops dead straight every time looks rigged, because it is.
  const seat = Math.floor(Math.random() * seats);
  const jitter = (Math.random() - 0.5) * slice * 0.55;
  const angle = seat * slice + jitter;

  // Several whole turns first, so the animation has something to do.
  const turns = 4 + Math.floor(Math.random() * 3);

  return { seat, angle, spinTo: turns * 360 + angle, at: now() };
}

/** Directly across the circle. With an odd count it is the nearer of the two. */
const oppositeSeat = (seat, seats) => (seat + Math.floor(seats / 2)) % seats;

/* -------------------------------- the round ------------------------------- */

function beginRound(state) {
  state.round += 1;

  // Everybody moves. Facing the same person all evening is how this game gets
  // boring, and it is one line to prevent.
  state.seats = shuffle(alive(state).map((p) => p.id));
  if (state.seats.length < 2) {
    state.phase = 'over';
    state.over = true;
    return;
  }

  const spin = spinBottle(state);
  const askedSeat = spin.seat;
  const askerSeat = oppositeSeat(askedSeat, state.seats.length);

  state.bottle = spin;
  state.askedId = state.seats[askedSeat];
  state.askerId = state.seats[askerSeat];
  state.choice = null;      // 'truth' | 'dare', chosen by the one on the spot
  state.question = null;    // typed by the asker
  state.answer = null;      // typed back, for a truth
  state.claimed = false;    // "I did it", for a dare
  state.verdict = null;     // 'yes' | 'no', from the asker
  state.suggestion = null;  // a card from the bank, if the asker wants one
  state.phase = 'spin';
  state.timeLeft = state.settings.spinSeconds ?? BEATS.spin;
  state.roundScores = {};
  state.dirty = true;

  say(state, `The bottle points at ${nameOf(state, state.askedId)} — ${nameOf(state, state.askerId)} is asking.`, 'phase');
}

function toPhase(state, phase, seconds) {
  state.phase = phase;
  state.timeLeft = seconds;
  state.dirty = true;
}

/** Hands out a nickname, once per person per match. */
function mock(state, playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  player.chickened = (player.chickened ?? 0) + 1;
  if (player.nickname) return; // one is enough; a pile of them is just bullying
  const taken = new Set(state.players.map((p) => p.nickname).filter(Boolean));
  const free = NICKNAMES.filter((n) => !taken.has(n));
  player.nickname = (free.length ? free : NICKNAMES)[Math.floor(Math.random() * (free.length || NICKNAMES.length))];
  say(state, `${player.name} backs out. From now on: ${player.nickname}.`, 'mock');
}

function settleRound(state) {
  const asked = state.players.find((p) => p.id === state.askedId);
  const asker = state.players.find((p) => p.id === state.askerId);
  const scoring = state.settings.scoring ?? 'normal';
  const weight = scoring === 'brutal' ? 1.5 : scoring === 'gentle' ? 0.7 : 1;

  // Work out what happened first, and only then decide who is to blame for it.
  // Doing those together is how an unconfirmed dare ended up handing the
  // performer a nickname for somebody else wandering off.
  if (!state.choice) state.outcome = 'no-choice';
  else if (!state.question) state.outcome = 'no-question'; // the asker's blank, not theirs
  else if (state.choice === 'truth') state.outcome = state.answer?.trim() ? 'answered' : 'refused';
  else if (!state.claimed) state.outcome = 'refused';
  else if (state.verdict === 'yes') state.outcome = 'performed';
  else if (state.verdict === 'no') state.outcome = 'disputed';
  else state.outcome = 'unconfirmed'; // claimed it, nobody said otherwise

  // Credit goes to anything that actually got done — including a claim the
  // asker never got round to answering, because being let down by somebody
  // else is not the same as backing out.
  const CREDIT = { answered: 100, performed: 150, unconfirmed: 150 };
  const earned = CREDIT[state.outcome] ?? 0;

  if (earned && asked) {
    state.roundScores[asked.id] = Math.round(earned * weight);
    asked.streak = (asked.streak ?? 0) + 1;
    // Three in a row without flinching is worth saying out loud.
    if (asked.streak === 3) say(state, `${asked.name} has not flinched once. Three in a row.`, 'good');
  }

  // Only two outcomes are the performer's own doing, and only those are named.
  if (state.outcome === 'refused' || state.outcome === 'disputed') {
    if (asked) asked.streak = 0;
    mock(state, state.askedId);
  }

  // The asker is paid for thinking of something — unless they then failed to
  // rule on it, in which case they get nothing and the performer keeps the
  // points.
  if (asker && state.question && state.outcome !== 'unconfirmed') {
    state.roundScores[asker.id] = Math.round(40 * weight);
  }

  for (const p of state.players) p.score = (p.score ?? 0) + (state.roundScores[p.id] ?? 0);
  state.dirty = true;
}

/* ------------------------------- the module ------------------------------- */

export default {
  id: 'truth-dare',
  name: 'Truth or Dare',
  tagline: 'The bottle picks you. Someone across the circle picks what you do.',
  emoji: '🍾',
  accent: '#ffd166',
  client: 'truth-dare',
  minPlayers: 2,
  maxPlayers: 16,
  tickRate: 2,

  howToPlay: [
    'The bottle spins. Whoever the neck lands on is on the spot.',
    'Whoever is sitting opposite asks them — they type the question or the dare themselves.',
    'A truth is typed back. A dare is done for real, then the person who set it confirms it happened.',
    'Back out and the room gives you a nickname, and it sticks for the rest of the night.',
  ],

  options: {
    rounds: {
      label: 'Rounds',
      hint: 'How many spins the night runs for',
      kind: 'number',
      min: 3,
      max: 30,
      step: 1,
      default: 10,
    },
    writeSeconds: {
      label: 'Seconds to write',
      hint: 'How long the asker gets to think of something',
      kind: 'number',
      min: 20,
      max: 120,
      step: 5,
      default: 50,
    },
    actSeconds: {
      label: 'Seconds to do it',
      hint: 'How long to answer a truth or perform a dare',
      kind: 'number',
      min: 30,
      max: 240,
      step: 10,
      default: 90,
    },
    scoring: {
      label: 'Stakes',
      hint: 'How much a round is worth',
      kind: 'choice',
      default: 'normal',
      choices: [
        { id: 'gentle', label: 'Gentle', note: '×0.7 points' },
        { id: 'normal', label: 'Normal', note: 'standard points' },
        { id: 'brutal', label: 'Brutal', note: '×1.5 points' },
      ],
    },
    suggestions: {
      label: 'Offer suggestions',
      hint: 'Give the asker a card to start from if they are stuck',
      kind: 'toggle',
      default: true,
    },
  },

  createState(players, ctx = {}) {
    const settings = {
      rounds: 10,
      writeSeconds: BEATS.write,
      actSeconds: BEATS.act,
      scoring: 'normal',
      suggestions: true,
      ...(ctx.settings ?? {}),
    };

    const count = Math.max(12, settings.rounds + 4);
    const state = {
      settings,
      phase: 'intro',
      timeLeft: BRIEF_SECONDS,
      round: 0,
      maxRounds: settings.rounds,
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        score: 0,
        streak: 0,
        chickened: 0,
        nickname: null,
        briefed: false,
        connected: true,
      })),
      seats: shuffle(players.map((p) => p.id)),
      // Cards the asker can lean on when nothing comes to mind. They are a
      // prompt, never the question — the typed one always wins.
      truths: deal('truth-dare-truths', TRUTHS, count),
      dares: deal('truth-dare-dares', DARES, count),
      bottle: null,
      askedId: null,
      askerId: null,
      choice: null,
      question: null,
      answer: null,
      claimed: false,
      verdict: null,
      outcome: null,
      roundScores: {},
      log: [],
      over: false,
      dirty: true,
    };
    return state;
  },

  onAction(state, player, action) {
    const me = state.players.find((p) => p.id === player.id);
    if (!me || state.over) return;
    const type = action?.type;

    if (state.phase === 'intro') {
      if (type === 'ready') {
        me.briefed = true;
        state.dirty = true;
      }
      return;
    }

    // Whoever is on the spot picks their poison. Nobody else can pick for them.
    if (state.phase === 'choose' && type === 'choice' && me.id === state.askedId) {
      const pick = action.choice === 'dare' ? 'dare' : 'truth';
      state.choice = pick;
      const pool = pick === 'dare' ? state.dares : state.truths;
      state.suggestion = state.settings.suggestions ? pool[state.round % Math.max(1, pool.length)] ?? null : null;
      say(state, `${me.name} picks ${pick}.`);
      toPhase(state, 'write', state.settings.writeSeconds);
      return;
    }

    // The asker writes it. This is the point of the game — a question from a
    // person, not a card.
    if (state.phase === 'write' && type === 'question' && me.id === state.askerId) {
      const text = String(action.text ?? '').slice(0, 240).trim();
      if (!text) return;
      state.question = text;
      say(state, `${me.name} has set ${nameOf(state, state.askedId)} ${state.choice === 'dare' ? 'a dare' : 'a question'}.`);
      toPhase(state, 'act', state.settings.actSeconds);
      return;
    }

    if (state.phase === 'act') {
      // A truth is typed back and that is the end of it.
      if (type === 'answer' && me.id === state.askedId && state.choice === 'truth') {
        state.answer = String(action.text ?? '').slice(0, 500).trim();
        if (!state.answer) return;
        toPhase(state, 'reveal', BEATS.reveal);
        settleRound(state);
        return;
      }
      // A dare is claimed, and then it has to be confirmed by whoever set it.
      if (type === 'did-it' && me.id === state.askedId && state.choice === 'dare') {
        state.claimed = true;
        say(state, `${me.name} says it is done. ${nameOf(state, state.askerId)}?`);
        toPhase(state, 'verdict', BEATS.verdict);
        return;
      }
      // Or refused outright, which is allowed — it just costs you a name.
      if (type === 'nope' && me.id === state.askedId) {
        state.claimed = false;
        toPhase(state, 'reveal', BEATS.reveal);
        settleRound(state);
        return;
      }
      return;
    }

    // Only the person who set the dare can say whether it happened.
    if (state.phase === 'verdict' && type === 'verdict' && me.id === state.askerId) {
      state.verdict = action.ok ? 'yes' : 'no';
      say(
        state,
        state.verdict === 'yes'
          ? `${me.name} confirms it. ${nameOf(state, state.askedId)} did it.`
          : `${me.name} says that does not count.`,
        state.verdict === 'yes' ? 'good' : 'mock'
      );
      toPhase(state, 'reveal', BEATS.reveal);
      settleRound(state);
      return;
    }
  },

  onTick(state, dt) {
    if (state.over) return;

    if (state.phase === 'intro') {
      state.timeLeft -= dt;
      const everyone = alive(state);
      // One person who put their phone down must not hold the room on the
      // rules screen for the rest of the evening.
      if (state.timeLeft <= 0 || (everyone.length && everyone.every((p) => p.briefed))) beginRound(state);
      return;
    }

    state.timeLeft -= dt;
    if (state.timeLeft > 0) return;

    switch (state.phase) {
      case 'spin':
        toPhase(state, 'choose', BEATS.choose);
        break;

      case 'choose':
        // No answer is an answer: truth, and the clock moves on.
        if (!state.choice) {
          state.choice = 'truth';
          state.suggestion = state.settings.suggestions ? state.truths[state.round % Math.max(1, state.truths.length)] ?? null : null;
          say(state, `${nameOf(state, state.askedId)} said nothing, so it is a truth.`);
        }
        toPhase(state, 'write', state.settings.writeSeconds);
        break;

      case 'write':
        // The asker froze. Fall back to a card so the round still happens —
        // the alternative is punishing the person on the spot for somebody
        // else's blank mind.
        if (!state.question) {
          const pool = state.choice === 'dare' ? state.dares : state.truths;
          state.question = pool[state.round % Math.max(1, pool.length)] ?? 'Tell us something nobody here knows.';
          say(state, `${nameOf(state, state.askerId)} ran out of time — the app picked one.`);
        }
        toPhase(state, 'act', state.settings.actSeconds);
        break;

      case 'act':
        settleRound(state);
        toPhase(state, 'reveal', BEATS.reveal);
        break;

      case 'verdict':
        // Silence from the asker is not a conviction. An unanswered claim
        // stands, because the person who did the dare should not lose out
        // because somebody else wandered off.
        state.verdict = state.verdict ?? null;
        settleRound(state);
        toPhase(state, 'reveal', BEATS.reveal);
        break;

      case 'reveal':
        if (state.round >= state.maxRounds) {
          state.phase = 'over';
          state.over = true;
          state.dirty = true;
        } else {
          beginRound(state);
        }
        break;

      default:
        break;
    }
  },

  botAction(state, bot) {
    const me = state.players.find((p) => p.id === bot.id);
    if (!me || state.over) return null;

    if (state.phase === 'intro') return me.briefed ? null : { type: 'ready' };

    if (state.phase === 'choose' && state.askedId === bot.id && !state.choice) {
      return { type: 'choice', choice: Math.random() < 0.55 ? 'truth' : 'dare' };
    }

    if (state.phase === 'write' && state.askerId === bot.id && !state.question) {
      // A CPU asking a question uses the card it was dealt. It is not going to
      // out-write a person, and pretending otherwise reads worse than a
      // straight card would.
      const pool = state.choice === 'dare' ? state.dares : state.truths;
      const text = pool[(state.round + 1) % Math.max(1, pool.length)];
      return text ? { type: 'question', text } : null;
    }

    if (state.phase === 'act' && state.askedId === bot.id) {
      if (state.choice === 'truth') return { type: 'answer', text: 'Honestly? Yes. Moving on.' };
      // A CPU that never chickens out is no fun for anyone.
      return Math.random() < 0.8 ? { type: 'did-it' } : { type: 'nope' };
    }

    if (state.phase === 'verdict' && state.askerId === bot.id && !state.verdict) {
      return { type: 'verdict', ok: Math.random() < 0.85 };
    }

    return null;
  },

  isOver: (state) => Boolean(state.over),

  results(state) {
    return [...state.players]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({
        playerId: p.id,
        name: p.nickname ? `${p.name} "${p.nickname}"` : p.name,
        score: p.score,
        place: i + 1,
      }));
  },

  serialize(state) {
    return {
      phase: state.phase,
      rules: this.howToPlay,
      round: state.round,
      maxRounds: state.maxRounds,
      timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
      // Seats in circle order, so the client can lay the ring out and point
      // the bottle at the right person without inventing an order of its own.
      seats: state.seats,
      players: state.players.map((p) => ({
        id: p.id,
        name: p.name,
        nickname: p.nickname,
        score: p.score,
        streak: p.streak,
        chickened: p.chickened,
        briefed: p.briefed,
        connected: p.connected,
      })),
      bottle: state.bottle,
      askedId: state.askedId,
      askerId: state.askerId,
      choice: state.choice,
      // The question is public the moment it is set — everybody watches.
      question: state.phase === 'write' ? null : state.question,
      answer: state.answer,
      claimed: state.claimed,
      verdict: state.verdict,
      outcome: state.phase === 'reveal' ? state.outcome : null,
      roundScores: state.phase === 'reveal' ? state.roundScores : {},
      log: state.log.slice(-6),
      over: state.over,
    };
  },

  /** The asker's suggestion card is theirs alone — the room should be surprised. */
  serializeFor(state, playerId) {
    const view = this.serialize(state);
    view.you = { id: playerId };
    if (playerId === state.askerId && (state.phase === 'write' || state.phase === 'verdict')) {
      view.you.suggestion = state.suggestion;
    }
    view.you.isAsked = playerId === state.askedId;
    view.you.isAsker = playerId === state.askerId;
    return view;
  },
};
