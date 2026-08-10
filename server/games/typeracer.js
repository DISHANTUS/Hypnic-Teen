// Type Racer.
//
// One passage, everybody at once, and the bar that moves is how far you have
// got. First to the end wins the round.
//
// Every design decision here is about one question: how do you know somebody
// actually typed it?
//
// The clock is the server's. A client that reports its own words per minute is
// reporting a number it made up — there is no version of that which can be
// checked. So the server stamps when the passage was revealed and when each
// finish arrived, and works the speed out itself. Nothing a browser says about
// time is used for anything.
//
// The text is checked, not trusted. A client sends what it has typed, and the
// server compares it against the passage; progress is the length of the longest
// correct prefix and nothing else. Typing a wrong character does not advance
// you, and neither does sending "I am 90% done".
//
// And a paste is caught by arithmetic rather than by watching for a paste
// event, which is a browser thing and therefore not evidence. Two hundred and
// fifty words a minute sustained is faster than the world record; a run that
// claims it is recorded as a run that happened and left out of the placings,
// with the reason said out loud rather than silently dropped.

const PHASES = { brief: 16, ready: 4, done: 10 };

/**
 * The passages.
 *
 * Written for this rather than borrowed, so nothing here belongs to anybody
 * else, and kept to things that are actually pleasant to type — ordinary words,
 * few capitals, no punctuation that needs a second key.
 */
export const PASSAGES = [
  'the quiet part of the evening is when the room goes from talking over each other to talking to each other and nobody can say exactly when it happened',
  'every good party game has the same shape underneath it which is that the rules are simple enough to explain in a minute and deep enough to argue about for an hour',
  'she said the trick to remembering names is to use them twice in the first minute and then never worry about it again which is either brilliant or nonsense',
  'the best thing about a game night is not the games it is the twenty minutes at the end when everyone is too tired to start another one and too happy to leave',
  'there is a particular silence that happens when somebody plays a card that changes everything and the whole table works out at the same time what it means',
  'nobody remembers who won last time but everybody remembers the hand where three people went out on the same turn and the room made a noise like a stadium',
  'a good rule is one you can break on purpose and a bad rule is one you break by accident and then argue about for the rest of the night with real feeling',
  'my grandmother played this game for sixty years and never once explained the rules she just corrected you until you stopped getting them wrong which worked',
  'the thing about typing fast is that accuracy is speed because every mistake costs you the time to notice it and the time to fix it and the rhythm you had',
  'somewhere in this building there is a box of board games with the pieces of three different sets in it and one day somebody is going to have to sort that out',
  'the rain started halfway through the second round and nobody moved because moving would have meant admitting the evening was going to end at some point',
  'he insists the rule is that you must announce it out loud and everybody else insists that he made this up in nineteen ninety four and has never let it go',
];

/**
 * Words per minute, the way the world counts it: five characters is a word.
 *
 * The elapsed time is floored at a millisecond rather than guarded against.
 * Returning nought for a divide-by-zero looks like the safe thing and is the
 * worst possible answer here — a finish inside the same millisecond is the
 * fastest run that can exist, and reporting it as the slowest sends it straight
 * past the check that is meant to catch exactly that. Floored, the number comes
 * out enormous and trips the ceiling, which is what it should do.
 */
const wpmFrom = (chars, ms) => Math.round((chars / 5) / (Math.max(1, ms) / 60000));

/**
 * Faster than this and something is wrong.
 *
 * The sustained world record sits a little over two hundred, so this is beyond
 * generous. It is a ceiling on plausibility, not a target — and a run above it
 * is kept and shown rather than deleted, because telling somebody their run did
 * not count is honest and quietly binning it is not.
 */
const IMPLAUSIBLE_WPM = 250;

export const typeracer = {
  id: 'typeracer',
  name: 'Type Racer',
  tagline: 'One passage, everybody at once. Accuracy is speed.',
  emoji: '⌨️',
  accent: '#00b894',
  client: 'typeracer',
  room: 'party',
  minPlayers: 1,
  maxPlayers: 20,
  tickRate: 4,

  howToPlay: [
    'Everybody gets the same passage. It appears when the countdown ends.',
    'Type it exactly. A wrong character stops you until you fix it.',
    'The bar is how far through you are. Everybody can see everybody.',
    'Speed is counted the usual way — five characters to a word — and the clock is the server’s, not your browser’s.',
    'Accuracy is speed. Every mistake costs the time to notice it and the time to fix it.',
  ],

  options: {
    rounds: { label: 'Races', kind: 'number', min: 1, max: 10, hardMax: 20, step: 1, default: 3 },
    raceSeconds: { label: 'Longest a race runs', kind: 'number', min: 30, max: 300, hardMax: 600, step: 15, default: 120 },
  },

  createState(players, ctx = {}) {
    const settings = ctx.settings ?? {};
    return {
      settings: {
        rounds: Math.max(1, Math.min(20, Number(settings.rounds) || 3)),
        raceSeconds: Math.max(30, Math.min(600, Number(settings.raceSeconds) || 120)),
      },
      phase: 'brief',
      timeLeft: PHASES.brief,
      phaseTotal: PHASES.brief,
      briefed: [],
      round: 0,
      passage: '',
      used: [],
      /** When the passage went on screen, by the server's clock. */
      startedAt: 0,
      racers: players.map((p) => ({
        id: p.id, name: p.name, connected: p.connected !== false,
        typed: '', at: 0, mistakes: 0, finishedAt: 0, wpm: 0, accuracy: 100,
        best: 0, score: 0, suspect: false,
      })),
      log: [],
      over: false,
      dirty: true,
    };
  },

  onPlayerJoin(state, player) {
    const known = state.racers.find((r) => r.id === player.id);
    if (known) { known.connected = true; known.name = player.name; }
    else {
      state.racers.push({
        id: player.id, name: player.name, connected: true,
        typed: '', at: 0, mistakes: 0, finishedAt: 0, wpm: 0, accuracy: 100,
        best: 0, score: 0, suspect: false,
      });
    }
    state.dirty = true;
  },

  onPlayerLeave(state, player) {
    const r = state.racers.find((x) => x.id === player.id);
    if (r) r.connected = false;
    state.dirty = true;
  },

  onAction(state, player, action = {}) {
    const me = state.racers.find((r) => r.id === player.id);
    if (!me) return;

    if (action.type === 'briefed' && state.phase === 'brief') {
      if (!state.briefed.includes(me.id)) state.briefed.push(me.id);
      state.dirty = true;
      if (everyoneReady(state)) startRound(state);
      return;
    }

    if (action.type !== 'typed' || state.phase !== 'race') return;
    if (me.finishedAt) return;

    const typed = String(action.text ?? '');
    // Never longer than the passage, and never trusted as a claim — this is
    // the text itself, and the server is about to check it letter by letter.
    if (typed.length > state.passage.length + 8) return;
    me.typed = typed;

    // Progress is the longest correct prefix. A wrong character does not
    // advance you, which is the whole reason accuracy is speed.
    let at = 0;
    while (at < typed.length && typed[at] === state.passage[at]) at += 1;
    if (at > me.at) me.at = at;
    // Everything typed beyond the correct prefix is a mistake being made or
    // fixed, counted once at its furthest extent rather than per keystroke.
    me.mistakes = Math.max(me.mistakes, typed.length - at);
    me.accuracy = typed.length ? Math.round((at / Math.max(at, typed.length)) * 100) : 100;

    if (at >= state.passage.length) finish(state, me);
    state.dirty = true;
  },

  botAction: () => null,

  onTick(state, dt) {
    if (state.over) return;
    state.timeLeft -= dt;

    if (state.phase === 'race') {
      // The race ends when everybody is done, without waiting out the clock.
      const running = state.racers.filter((r) => r.connected && !r.finishedAt);
      if (!running.length) { endRound(state); return; }
    }
    if (state.timeLeft > 0) return;

    if (state.phase === 'brief') return startRound(state);
    if (state.phase === 'ready') return go(state);
    if (state.phase === 'race') return endRound(state);
    if (state.phase === 'done') {
      if (state.round >= state.settings.rounds) { state.over = true; state.phase = 'over'; state.dirty = true; return; }
      return startRound(state);
    }
  },

  isDirty(state) { const was = state.dirty; state.dirty = false; return was; },
  isOver: (state) => Boolean(state.over),

  results(state) {
    return [...state.racers]
      .sort((a, b) => b.score - a.score || b.best - a.best)
      .map((r, i) => ({ playerId: r.id, name: r.name, score: r.score, place: i + 1 }));
  },

  serialize(state) {
    return {
      phase: state.phase,
      rules: this.howToPlay,
      round: state.round,
      maxRounds: state.settings.rounds,
      timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
      phaseTotal: state.phaseTotal,
      // Held back until the countdown ends. Sending it during the countdown
      // would let somebody line up the first few words before the clock
      // started, which is the same as starting early.
      passage: state.phase === 'brief' || state.phase === 'ready' ? '' : state.passage,
      length: state.passage.length,
      racers: state.racers.map((r) => ({
        id: r.id, name: r.name, connected: r.connected,
        at: r.at, of: state.passage.length,
        wpm: r.wpm, accuracy: r.accuracy, best: r.best, score: r.score,
        finished: Boolean(r.finishedAt), suspect: r.suspect,
      })),
      briefed: state.briefed,
      log: state.log.slice(-4),
    };
  },

  serializeFor(state, playerId) {
    const me = state.racers.find((r) => r.id === playerId);
    return {
      ...this.serialize(state),
      you: {
        id: playerId,
        at: me?.at ?? 0,
        // Sent back so a reconnecting browser can restore the box rather than
        // making somebody start the passage again.
        typed: me?.typed ?? '',
        finished: Boolean(me?.finishedAt),
        wpm: me?.wpm ?? 0,
        accuracy: me?.accuracy ?? 100,
        suspect: Boolean(me?.suspect),
      },
    };
  },
};

const everyoneReady = (state) => {
  const here = state.racers.filter((r) => r.connected);
  return here.length > 0 && here.every((r) => state.briefed.includes(r.id));
};

function startRound(state) {
  state.round += 1;
  // No passage twice in a session until they have all been round once.
  const unused = PASSAGES.filter((p) => !state.used.includes(p));
  const pool = unused.length ? unused : (state.used = [], PASSAGES);
  state.passage = pool[Math.floor(Math.random() * pool.length)];
  state.used.push(state.passage);

  for (const r of state.racers) {
    r.typed = '';
    r.at = 0;
    r.mistakes = 0;
    r.finishedAt = 0;
    r.wpm = 0;
    r.accuracy = 100;
    r.suspect = false;
  }
  state.phase = 'ready';
  state.phaseTotal = PHASES.ready;
  state.timeLeft = PHASES.ready;
  state.startedAt = 0;
  state.dirty = true;
}

function go(state) {
  state.phase = 'race';
  state.phaseTotal = state.settings.raceSeconds;
  state.timeLeft = state.settings.raceSeconds;
  // The only clock that counts, taken at the moment the text appears.
  state.startedAt = Date.now();
  state.dirty = true;
}

function finish(state, racer) {
  racer.finishedAt = Date.now();
  const ms = racer.finishedAt - state.startedAt;
  racer.wpm = wpmFrom(state.passage.length, ms);
  // Beyond the world record, sustained. Kept and shown rather than deleted —
  // telling somebody their run did not count is honest; binning it quietly is
  // not, and a false positive should be arguable rather than invisible.
  racer.suspect = racer.wpm > IMPLAUSIBLE_WPM;
  racer.best = Math.max(racer.best, racer.suspect ? 0 : racer.wpm);
  state.log.push(racer.suspect
    ? `${racer.name} finished at ${racer.wpm} wpm — too fast to count.`
    : `${racer.name} finishes at ${racer.wpm} wpm.`);
}

function endRound(state) {
  // Placed by how far everybody got, then by when they got there. Anybody
  // flagged as impossible is placed last rather than removed, so the room can
  // see what happened and say so.
  const order = [...state.racers]
    .filter((r) => r.connected)
    .sort((a, b) => {
      if (a.suspect !== b.suspect) return a.suspect ? 1 : -1;
      if (Boolean(a.finishedAt) !== Boolean(b.finishedAt)) return a.finishedAt ? -1 : 1;
      if (a.finishedAt && b.finishedAt) return a.finishedAt - b.finishedAt;
      return b.at - a.at;
    });

  order.forEach((r, i) => {
    r.score += Math.max(0, order.length - i) * 2 + (r.suspect ? 0 : Math.floor(r.wpm / 10));
  });
  const won = order[0];
  state.log.push(won ? `${won.name} takes the race.` : 'Nobody finished.');

  state.phase = 'done';
  state.phaseTotal = PHASES.done;
  state.timeLeft = PHASES.done;
  state.dirty = true;
}

export { wpmFrom, IMPLAUSIBLE_WPM };
export default typeracer;
