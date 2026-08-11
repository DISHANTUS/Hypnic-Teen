// Heads Up.
//
// One of you cannot see the thing everybody else can. A photograph and its
// name go to every screen in the room except one, and the room explains it —
// out loud, across the table, any way they can that is not saying the name —
// while the one player types guesses until they get it or the clock does.
//
// The game is the talking, and the server stays out of it. There is no chat to
// police and no clue box to moderate, because the room is a real room: the
// explaining happens in the air, the way it does when the card is stuck to
// somebody's forehead. What the server owns is the one thing the room cannot
// be trusted with — who is allowed to see the word. The guesser's view never
// contains it. Not masked, not hidden behind a flag: the field is absent, so
// no console, no network tab and no clever friend can read it off their
// phone.
//
// Words come from the studio's picture bank where it has one — a photograph
// makes explaining ten times funnier than a word alone — and from a built-in
// list where it does not, so the game works on a machine with no media store
// at all.

import { clueVocabulary, clueFor } from '../media.js';

const PHASES = { brief: 18, reveal: 7 };

/** The fallback vocabulary: things a room can describe without preparation. */
const WORDS = [
  'elephant', 'umbrella', 'toothbrush', 'helicopter', 'sandcastle', 'volcano',
  'penguin', 'ladder', 'accordion', 'lighthouse', 'scarecrow', 'submarine',
  'butterfly', 'microscope', 'waterfall', 'skeleton', 'campfire', 'telescope',
  'octopus', 'typewriter', 'windmill', 'parachute', 'snowman', 'cactus',
  'fountain', 'drumkit', 'anchor', 'balloon', 'castle', 'dinosaur',
  'escalator', 'firework', 'giraffe', 'hammock', 'igloo', 'jellyfish',
  'kangaroo', 'lawnmower', 'magnet', 'noodles', 'orchestra', 'pyramid',
  'quicksand', 'rainbow', 'scissors', 'tractor', 'unicycle', 'vulture',
  'wheelbarrow', 'xylophone', 'yacht', 'zebra', 'auto rickshaw', 'coconut',
  'cricket bat', 'dosa', 'kite', 'mango', 'peacock', 'temple',
];

/** Spelling differences are not wrong answers. */
const fold = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const live = (state) => state.seats.filter((s) => s.connected);
const guesserOf = (state) => state.seats.find((s) => s.seat === state.guesser) ?? null;
/** Everybody who can see the word and is still here. */
const helpers = (state) => live(state).filter((s) => s.seat !== state.guesser);

export const headsup = {
  id: 'headsup',
  name: 'Heads Up',
  tagline: 'Everybody can see it except you. They explain, you guess, nobody says the name.',
  emoji: '🙆',
  accent: '#f27059',
  client: 'headsup',
  room: 'party',
  minPlayers: 2,
  maxPlayers: 12,
  tickRate: 4,

  howToPlay: [
    'Each round, one of you is the guesser. Everybody else sees a photo and its name.',
    'The room explains it out loud — what it does, where you find it, what it rhymes with.',
    'Saying the name, or spelling it, is the one rule. Honour it.',
    'The guesser types guesses. Close does not count; the word is the word.',
    'Got it, and the guesser scores big, the room scores too — quicker is more.',
    'Stuck? The room can vote to swap the word. It costs nothing but time.',
    'Then the phone moves on: next round, next guesser.',
  ],

  options: {
    rounds: { label: 'Rounds', kind: 'number', min: 2, max: 24, hardMax: 48, step: 1, default: 8 },
    guessSeconds: { label: 'Seconds a round', kind: 'number', min: 20, max: 180, hardMax: 300, step: 5, default: 60 },
  },

  createState(players, ctx = {}) {
    const s = ctx.settings ?? {};
    return {
      settings: {
        rounds: Math.max(2, Math.min(48, Number(s.rounds) || 8)),
        guessSeconds: Math.max(20, Math.min(300, Number(s.guessSeconds) || 60)),
      },
      phase: 'brief',
      timeLeft: PHASES.brief,
      phaseTotal: PHASES.brief,
      briefed: [],
      hostId: ctx.room?.hostId ?? players[0]?.id ?? null,
      seats: players.map((p, i) => ({
        id: p.id, name: p.name, seat: i, connected: p.connected !== false,
        score: 0, got: 0, helped: 0,
      })),
      round: 0,
      guesser: -1,
      /** The word. Reaches every serialized view except one. */
      word: null,
      picture: null,
      /** Words this match has already used, so nobody explains "penguin" twice. */
      used: [],
      guesses: [],
      passVotes: [],
      lastWord: null,
      lastBy: null,
      said: '',
      log: [],
      over: false,
      dirty: true,
    };
  },

  onPlayerJoin(state, player) {
    const known = state.seats.find((x) => x.id === player.id);
    if (known) { known.connected = true; known.name = player.name; }
    else state.seats.push({ id: player.id, name: player.name, seat: state.seats.length, connected: true, score: 0, got: 0, helped: 0 });
    state.dirty = true;
  },

  onPlayerLeave(state, player) {
    const seat = state.seats.find((x) => x.id === player.id);
    if (seat) seat.connected = false;
    if (state.hostId === player.id) state.hostId = live(state)[0]?.id ?? null;
    // The guesser walking off ends the round — a room explaining to nobody is
    // a strange thing to leave running.
    if (seat && seat.seat === state.guesser && state.phase === 'guessing') {
      endRound(state, false, `${seat.name} left. It was ${state.word}.`);
    }
    state.dirty = true;
  },

  onAction(state, player, action = {}) {
    const seat = state.seats.find((x) => x.id === player.id);
    if (!seat || state.over) return;

    if (action.type === 'briefed' && state.phase === 'brief') {
      if (!state.briefed.includes(seat.id)) state.briefed.push(seat.id);
      state.dirty = true;
      const here = live(state);
      if (here.length && here.every((x) => state.briefed.includes(x.id))) beginRound(state);
      return;
    }

    if (action.type === 'guess' && state.phase === 'guessing') {
      // Only the guesser guesses. A helper typing the answer through this
      // channel would be the textual version of shouting the name.
      if (seat.seat !== state.guesser) return;
      const text = String(action.text ?? '').trim().slice(0, 60);
      if (!text) return;

      if (fold(text) === fold(state.word)) {
        const quick = Math.max(0, Math.ceil(state.timeLeft));
        // The guesser earns the catch; the room earns the telling. Speed pays
        // both, because both made it fast.
        seat.score += 25 + quick;
        seat.got += 1;
        for (const h of helpers(state)) { h.score += 10 + Math.floor(quick / 4); h.helped += 1; }
        endRound(state, true, `${seat.name} got it — ${state.word} — with ${quick}s to spare.`);
        return;
      }

      // Wrong guesses are public. The room needs to hear what has been tried
      // to know which trail to talk them off.
      state.guesses.push({ text, at: state.guesses.length + 1 });
      state.said = `"${text}" — no.`;
      state.dirty = true;
      return;
    }

    if (action.type === 'pass' && state.phase === 'guessing') {
      // The room, not the guesser, votes a word away — the guesser cannot know
      // whether the word is a dud, only that they have not got it yet.
      if (seat.seat === state.guesser) return;
      if (state.passVotes.includes(seat.seat)) return;
      state.passVotes.push(seat.seat);
      const need = Math.max(1, Math.ceil(helpers(state).length / 2));
      if (state.passVotes.length >= need) {
        const old = state.word;
        deal(state);
        state.passVotes = [];
        state.guesses = [];
        state.said = `The room swapped the word. (It was ${old}.)`;
        state.log.push(state.said);
      } else {
        state.said = `${seat.name} wants a new word — ${state.passVotes.length} of ${need}.`;
      }
      state.dirty = true;
      return;
    }
  },

  botAction: () => null,

  onTick(state, dt) {
    if (state.over) return;

    if (state.phase === 'brief') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) beginRound(state);
      return;
    }

    if (state.phase === 'reveal') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        if (state.round >= state.settings.rounds) finish(state);
        else beginRound(state);
      }
      return;
    }

    if (state.phase !== 'guessing') return;
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) {
      endRound(state, false, `Time. It was ${state.word}.`);
    }
  },

  isDirty(state) { const was = state.dirty; state.dirty = false; return Boolean(was); },
  isOver: (state) => Boolean(state.over),

  results(state) {
    return [...state.seats]
      .sort((a, b) => b.score - a.score || b.got - a.got)
      .map((s, i) => ({ playerId: s.id, name: s.name, score: s.score, place: i + 1 }));
  },

  serialize(state) {
    return {
      phase: state.phase,
      rules: headsup.howToPlay,
      timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
      phaseTotal: state.phaseTotal,
      round: state.round,
      maxRounds: state.settings.rounds,
      guesser: state.guesser,
      guesserName: guesserOf(state)?.name ?? '',
      guesses: state.guesses,
      passVotes: state.passVotes.length,
      passNeed: Math.max(1, Math.ceil(helpers(state).length / 2)),
      // Only ever the word of a round that is over.
      lastWord: state.lastWord,
      lastBy: state.lastBy,
      said: state.said,
      log: state.log.slice(-4),
      briefed: state.briefed,
      hostId: state.hostId,
      seats: state.seats.map((s) => ({
        id: s.id, name: s.name, seat: s.seat, connected: s.connected,
        score: s.score, got: s.got, helped: s.helped,
      })),
      over: state.over,
    };
  },

  /**
   * The word reaches everybody except the one person the game is about.
   *
   * The guesser's view has no word and no picture — absent, not blanked — so
   * the phone on their forehead holds nothing that could give it away.
   */
  serializeFor(state, playerId) {
    const seat = state.seats.find((x) => x.id === playerId);
    const isGuesser = seat?.seat === state.guesser;
    const base = this.serialize(state);
    return {
      ...base,
      ...(state.phase === 'guessing' && !isGuesser
        ? { word: state.word, picture: state.picture }
        : {}),
      you: {
        id: playerId,
        seat: seat?.seat ?? -1,
        guessing: Boolean(isGuesser && state.phase === 'guessing'),
        voted: seat ? state.passVotes.includes(seat.seat) : false,
        isHost: playerId === state.hostId,
      },
    };
  },
};

/** A word nobody has had this match, with its photograph where one exists. */
function deal(state) {
  const seen = new Set(state.used.map(fold));
  const bank = clueVocabulary();
  const pool = [...bank, ...WORDS].filter((w) => !seen.has(fold(w)));
  const from = pool.length ? pool : [...bank, ...WORDS];
  const word = from[Math.floor(Math.random() * from.length)];
  state.used.push(word);
  state.word = word.replace(/-/g, ' ');
  state.picture = clueFor(word, state.round)?.url ?? null;
}

function beginRound(state) {
  state.round += 1;
  state.phase = 'guessing';
  state.timeLeft = state.settings.guessSeconds;
  state.phaseTotal = state.settings.guessSeconds;
  state.guesses = [];
  state.passVotes = [];
  // The next connected seat after the last guesser, so a dropped player does
  // not black-hole a round.
  const here = live(state);
  const order = here.map((s) => s.seat).sort((a, b) => a - b);
  const after = order.find((n) => n > state.guesser);
  state.guesser = after ?? order[0] ?? 0;
  deal(state);
  const who = guesserOf(state);
  state.said = `${who?.name ?? 'Somebody'} is guessing. Everybody else: explain, don't say it.`;
  state.log.push(`Round ${state.round}: ${who?.name ?? '—'} guesses.`);
  state.dirty = true;
}

function endRound(state, got, said) {
  state.lastWord = state.word;
  state.lastBy = got ? guesserOf(state)?.name ?? null : null;
  state.word = null;
  state.picture = null;
  state.phase = 'reveal';
  state.timeLeft = PHASES.reveal;
  state.phaseTotal = PHASES.reveal;
  state.said = said;
  state.log.push(said);
  state.dirty = true;
}

function finish(state) {
  state.over = true;
  state.phase = 'over';
  const top = [...state.seats].sort((a, b) => b.score - a.score)[0];
  state.said = top ? `${top.name} takes it with ${top.score}.` : 'Done.';
  state.dirty = true;
}

export default headsup;
