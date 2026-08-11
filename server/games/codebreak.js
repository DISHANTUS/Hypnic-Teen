// Crack the Code.
//
// One person sets a secret — a run of digits, or a word — and everybody else
// takes turns guessing it. Every guess comes back with the same two numbers:
// how many characters are exactly right in exactly the right place, and how
// many are the right character sitting somewhere else. That is the whole game,
// and it is the oldest deduction game there is; the version with pegs is called
// Mastermind and the version with digits is called bulls and cows.
//
// Two decisions worth stating.
//
// The feedback is counts, never positions. "Two in place" and "the first and
// the fourth are right" are wildly different games — the second one is solved
// in about three guesses and the first one is the game people actually play.
// Saying which is a kindness that removes the entire puzzle.
//
// And repeats are allowed, which is where almost every implementation of this
// is quietly wrong. With 3-4-5-2-5 against a guess of 3-3-9-8-6, the naive
// count says the guess has a 3 and the secret has a 3, so score it — twice,
// once for each 3 in the guess. The right answer is that each character in the
// secret can only be claimed once. The fix is the standard two-pass count:
// take the exact matches out first, then match what is left greedily. Getting
// this wrong makes the numbers add up to more than the length of the code,
// which is the bug report you will get and it will be phrased as "it lied".

const DIGITS = '0123456789';

/** Words the setter can be dealt if they would rather not think of one. */
const WORDS = [
  'PLANET', 'SILVER', 'MONKEY', 'GARDEN', 'ROCKET', 'CANDLE', 'BRIDGE', 'PUZZLE',
  'MARKET', 'WINTER', 'FALCON', 'TEMPLE', 'JUNGLE', 'MIRROR', 'PEPPER', 'VELVET',
  'ORANGE', 'ISLAND', 'DRAGON', 'BUTTON', 'CIRCUS', 'HAMMER', 'LANTERN', 'CACTUS',
  'MANGO', 'TIGER', 'RIVER', 'CLOUD', 'STORM', 'BEACH', 'PIANO', 'LEMON',
  'CHAIR', 'GLASS', 'BREAD', 'SUGAR', 'TRAIN', 'HOUSE', 'MUSIC', 'PAPER',
];

/**
 * Score one guess against one secret.
 *
 * Two passes, and the order matters. Everything that is exactly right is taken
 * off the table first; only then is what remains matched up. Counting in one
 * pass double-claims a character whenever either side repeats one, and the
 * symptom is a pair of numbers that add up to more than the code is long.
 *
 * @returns {{ exact: number, elsewhere: number }}
 */
export function score(secret, guess) {
  const a = [...String(secret)];
  const b = [...String(guess)];
  let exact = 0;
  const restA = [];
  const restB = [];

  for (let i = 0; i < a.length; i++) {
    if (b[i] === a[i]) exact += 1;
    else { restA.push(a[i]); restB.push(b[i]); }
  }

  // What is left, matched greedily — each leftover character of the secret can
  // be claimed by at most one leftover character of the guess.
  const pool = new Map();
  for (const ch of restA) pool.set(ch, (pool.get(ch) ?? 0) + 1);
  let elsewhere = 0;
  for (const ch of restB) {
    const have = pool.get(ch) ?? 0;
    if (have > 0) { elsewhere += 1; pool.set(ch, have - 1); }
  }

  return { exact, elsewhere };
}

const clean = (raw, mode, length) => {
  const text = String(raw ?? '').trim().toUpperCase();
  const ok = mode === 'word' ? /^[A-Z]+$/ : /^[0-9]+$/;
  if (!ok.test(text)) return null;
  if (text.length !== length) return null;
  return text;
};

const randomCode = (mode, length) => {
  if (mode === 'word') {
    const fits = WORDS.filter((w) => w.length === length);
    if (fits.length) return fits[Math.floor(Math.random() * fits.length)];
    // No word of that length in the list, so build one out of letters. It will
    // not be a word, which is worse, but it is better than no game.
    return Array.from({ length }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]).join('');
  }
  return Array.from({ length }, () => DIGITS[Math.floor(Math.random() * 10)]).join('');
};

const PHASES = { brief: 16, setting: 45, guessing: 0, reveal: 9 };

const live = (state) => state.seats.filter((s) => s.connected);
const setterOf = (state) => state.seats[state.setter] ?? null;
const guessers = (state) => state.seats.filter((s) => s.seat !== state.setter && s.connected);

export const codebreak = {
  id: 'codebreak',
  name: 'Crack the Code',
  tagline: 'One of you knows the number. The rest of you have twenty guesses and two clues a go.',
  emoji: '🔐',
  accent: '#5b8def',
  client: 'codebreak',
  room: 'party',
  minPlayers: 2,
  maxPlayers: 12,
  tickRate: 4,

  howToPlay: [
    'One player is the setter. Everybody else is trying to crack their code.',
    'The setter picks a code — digits, or a word — or takes one the studio deals them.',
    'Everyone else guesses in turn. A guess must be the right length.',
    'Every guess comes back with two numbers: how many characters are exactly right in the right place, and how many are right but somewhere else.',
    'It never says which ones. Working out which is the game.',
    'Crack it and you score — the sooner the better. If nobody cracks it, the setter scores instead.',
    'Then the setter changes, and it goes again.',
  ],

  options: {
    rounds: { label: 'Rounds', kind: 'number', min: 1, max: 20, hardMax: 40, step: 1, default: 4 },
    mode: {
      label: 'Codes are',
      kind: 'choice',
      default: 'digits',
      choices: [
        { id: 'digits', label: 'Numbers', note: 'digits, repeats allowed' },
        { id: 'word', label: 'Words', note: 'letters, a real word' },
      ],
    },
    length: { label: 'How long', kind: 'number', min: 3, max: 8, hardMax: 10, step: 1, default: 5 },
    tries: { label: 'Guesses allowed', kind: 'number', min: 4, max: 30, hardMax: 60, step: 1, default: 20 },
    turnSeconds: { label: 'Seconds a guess', kind: 'number', min: 5, max: 120, hardMax: 300, step: 5, default: 30 },
  },

  createState(players, ctx = {}) {
    const s = ctx.settings ?? {};
    const mode = s.mode === 'word' ? 'word' : 'digits';
    return {
      settings: {
        rounds: Math.max(1, Math.min(40, Number(s.rounds) || 4)),
        mode,
        length: Math.max(3, Math.min(10, Number(s.length) || 5)),
        tries: Math.max(4, Math.min(60, Number(s.tries) || 20)),
        turnSeconds: Math.max(5, Math.min(300, Number(s.turnSeconds) || 30)),
      },
      phase: 'brief',
      timeLeft: PHASES.brief,
      phaseTotal: PHASES.brief,
      briefed: [],
      hostId: ctx.room?.hostId ?? players[0]?.id ?? null,
      seats: players.map((p, i) => ({
        id: p.id, name: p.name, seat: i, connected: p.connected !== false,
        score: 0, cracked: 0, set: 0,
      })),
      round: 0,
      setter: 0,
      /** Never leaves the server except to the setter, and at the reveal. */
      secret: null,
      dealt: null,
      turn: 0,
      turnLeft: 0,
      guesses: [],
      winner: null,
      said: '',
      log: [],
      over: false,
      dirty: true,
    };
  },

  onPlayerJoin(state, player) {
    const known = state.seats.find((x) => x.id === player.id);
    if (known) { known.connected = true; known.name = player.name; }
    else state.seats.push({ id: player.id, name: player.name, seat: state.seats.length, connected: true, score: 0, cracked: 0, set: 0 });
    state.dirty = true;
  },

  onPlayerLeave(state, player) {
    const seat = state.seats.find((x) => x.id === player.id);
    if (seat) seat.connected = false;
    if (state.hostId === player.id) state.hostId = live(state)[0]?.id ?? null;
    // The setter walking off would strand everybody on a code nobody can
    // reveal, so the round ends and the code is shown.
    if (seat && seat.seat === state.setter && state.phase !== 'reveal') endRound(state, null, `${seat.name} left — the code was ${state.secret ?? '—'}.`);
    else if (seat && state.seats[state.turn]?.id === player.id) passTurn(state);
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

    if (action.type === 'setCode' && state.phase === 'setting') {
      if (seat.seat !== state.setter) return;
      const code = clean(action.code, state.settings.mode, state.settings.length);
      if (!code) return;
      lockIn(state, code);
      return;
    }

    if (action.type === 'takeDealt' && state.phase === 'setting') {
      if (seat.seat !== state.setter) return;
      lockIn(state, state.dealt);
      return;
    }

    if (action.type === 'guess' && state.phase === 'guessing') {
      if (state.seats[state.turn]?.id !== seat.id) return;
      if (seat.seat === state.setter) return;
      const code = clean(action.code, state.settings.mode, state.settings.length);
      if (!code) return;

      const { exact, elsewhere } = score(state.secret, code);
      state.guesses.push({
        by: seat.seat, name: seat.name, code, exact, elsewhere, at: state.guesses.length + 1,
      });

      if (exact === state.settings.length) {
        // Sooner is worth more, and cracking it at all is worth a lot.
        const left = Math.max(0, state.settings.tries - state.guesses.length);
        seat.score += 40 + left * 3;
        seat.cracked += 1;
        const setter = setterOf(state);
        // The setter gets something for a code that took some cracking.
        if (setter) setter.score += Math.min(20, state.guesses.length);
        endRound(state, seat.seat, `${seat.name} cracked it — ${state.secret}.`);
        return;
      }

      if (state.guesses.length >= state.settings.tries) {
        const setter = setterOf(state);
        if (setter) { setter.score += 45; setter.set += 1; }
        endRound(state, null, `Nobody got it. It was ${state.secret}.`);
        return;
      }

      state.said = `${seat.name}: ${exact} in place, ${elsewhere} elsewhere.`;
      passTurn(state);
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

    if (state.phase === 'setting') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) lockIn(state, state.dealt);
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
    if (state.turnLeft > 0) {
      state.turnLeft -= dt;
      if (state.turnLeft <= 0) {
        // A guess nobody made still costs a try, otherwise a table with one
        // person away never ends.
        const away = state.seats[state.turn];
        state.guesses.push({
          by: away?.seat ?? -1, name: away?.name ?? '—', code: null,
          exact: 0, elsewhere: 0, at: state.guesses.length + 1, missed: true,
        });
        if (state.guesses.length >= state.settings.tries) {
          const setter = setterOf(state);
          if (setter) { setter.score += 45; setter.set += 1; }
          endRound(state, null, `Nobody got it. It was ${state.secret}.`);
          return;
        }
        state.said = `${away?.name ?? 'Somebody'} ran out of time.`;
        passTurn(state);
      }
    }
  },

  isDirty(state) { const was = state.dirty; state.dirty = false; return Boolean(was); },
  isOver: (state) => Boolean(state.over),

  results(state) {
    return [...state.seats]
      .sort((a, b) => b.score - a.score || b.cracked - a.cracked)
      .map((s, i) => ({ playerId: s.id, name: s.name, score: s.score, place: i + 1 }));
  },

  serialize(state) {
    return {
      phase: state.phase,
      rules: codebreak.howToPlay,
      timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
      phaseTotal: state.phaseTotal,
      turnLeft: Math.max(0, Math.ceil(state.turnLeft)),
      round: state.round,
      maxRounds: state.settings.rounds,
      mode: state.settings.mode,
      length: state.settings.length,
      tries: state.settings.tries,
      setter: state.setter,
      setterName: setterOf(state)?.name ?? '',
      turn: state.turn,
      turnName: state.seats[state.turn]?.name ?? '',
      // The guesses are public — that is the point of the game, everybody
      // reasons off everybody else's information.
      guesses: state.guesses,
      // Only ever filled in once the round is over.
      revealed: state.phase === 'reveal' ? state.secret : null,
      winner: state.winner,
      said: state.said,
      seats: state.seats.map((s) => ({
        id: s.id, name: s.name, seat: s.seat, connected: s.connected,
        score: s.score, cracked: s.cracked, set: s.set,
      })),
      briefed: state.briefed,
      hostId: state.hostId,
      log: state.log.slice(-4),
    };
  },

  serializeFor(state, playerId) {
    const seat = state.seats.find((x) => x.id === playerId);
    const isSetter = seat?.seat === state.setter;
    return {
      ...this.serialize(state),
      you: {
        id: playerId,
        seat: seat?.seat ?? -1,
        isHost: playerId === state.hostId,
        isSetter,
        yourTurn: state.phase === 'guessing' && state.seats[state.turn]?.id === playerId && !isSetter,
        // The secret goes to exactly one person, and only while they are the
        // one who chose it. Everybody else's view has no field at all — not an
        // empty one, not a masked one. There is nothing to find.
        ...(isSetter && state.secret ? { secret: state.secret } : {}),
        ...(isSetter && state.phase === 'setting' ? { dealt: state.dealt } : {}),
      },
    };
  },
};

/* -------------------------------- the round ------------------------------- */

function beginRound(state) {
  state.round += 1;
  // Round one keeps seat zero; after that it moves, skipping anybody gone.
  if (state.round > 1) {
    const n = state.seats.length;
    for (let i = 1; i <= n; i++) {
      const next = (state.setter + i) % n;
      if (state.seats[next]?.connected) { state.setter = next; break; }
    }
  }
  state.phase = 'setting';
  state.timeLeft = PHASES.setting;
  state.phaseTotal = PHASES.setting;
  state.secret = null;
  state.dealt = randomCode(state.settings.mode, state.settings.length);
  state.guesses = [];
  state.winner = null;
  state.turnLeft = 0;
  state.said = `${setterOf(state)?.name ?? 'Somebody'} is thinking of a code.`;
  state.dirty = true;
}

function lockIn(state, code) {
  state.secret = code ?? randomCode(state.settings.mode, state.settings.length);
  state.phase = 'guessing';
  state.phaseTotal = state.settings.turnSeconds;
  // First guesser is whoever sits after the setter.
  state.turn = state.setter;
  passTurn(state);
  state.said = 'Code locked in. Start guessing.';
  state.log.push(`${setterOf(state)?.name ?? 'The setter'} locked in a code.`);
  state.dirty = true;
}

function passTurn(state) {
  // Everybody except the setter walking out leaves nobody to guess, and a
  // round with nobody in it would sit there until the clock ran out on a code
  // that can no longer be cracked. End it and show the answer.
  if (!guessers(state).length) {
    endRound(state, null, `Nobody left to guess. It was ${state.secret ?? '—'}.`);
    return;
  }
  const n = state.seats.length;
  for (let i = 1; i <= n; i++) {
    const next = (state.turn + i) % n;
    const seat = state.seats[next];
    if (seat && seat.connected && seat.seat !== state.setter) { state.turn = next; break; }
  }
  state.turnLeft = state.settings.turnSeconds;
  state.dirty = true;
}

function endRound(state, winnerSeat, said) {
  state.winner = winnerSeat;
  state.phase = 'reveal';
  state.timeLeft = PHASES.reveal;
  state.phaseTotal = PHASES.reveal;
  state.turnLeft = 0;
  state.said = said;
  state.log.push(said);
  state.dirty = true;
}

function finish(state) {
  state.over = true;
  state.phase = 'over';
  state.dirty = true;
}

/** Reachable for the tests without going through a socket. */
codebreak.__internals = { beginRound, lockIn, passTurn, endRound, randomCode, WORDS };

export default codebreak;
