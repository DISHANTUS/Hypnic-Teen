// Standoff — rock, paper, scissors, against the whole room at once.
//
// Plain rock-paper-scissors between two people is a coin toss with extra
// steps, and a coin toss is not a party game. Two changes turn it into one.
//
// The first: you do not face one opponent, you face everybody. One throw is
// scored against every other player in the room at the same time, so the
// question stops being "what will they pick" and becomes "what will the room
// pick" — which is a question about the people in front of you rather than
// about luck. Reading that the room has got scissors-happy and throwing rock
// sweeps the lot of them, and that is a moment worth playing for.
//
// The second: your throws run out. Everyone starts with a fixed number of
// each, and what everybody has left is shown to everybody. By the back half of
// a match somebody is out of rock and the whole room knows it, so their next
// throw is a guess between two rather than three — and they know that you know.
// That is where the real game is. It also stops the one degenerate strategy
// plain RPS has, which is picking the same thing every round and daring anyone
// to notice.
//
// Everything is decided here. The client shows hands and counts down, but it
// is told what was thrown only once the round is locked — a client that knew
// the throws early is a client that could win every round.

const THROWS = ['rock', 'paper', 'scissors'];

/** What beats what. BEATS[a] is the throw that a defeats. */
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

const LABEL = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' };
const HAND = { rock: '✊', paper: '✋', scissors: '✌️' };

/** Points. Beating somebody is worth more than being beaten costs, so reading
 *  the room aggressively pays better than hiding. */
const PER_WIN = 2;
const PER_LOSS = -1;

/** Beating every single other player, with nobody tying you. */
const SWEEP_BONUS = 5;

/** The last round decides a lot of matches, so it is worth saying so. */
const FINAL_MULTIPLIER = 2;

const PHASES = { brief: 14, throw: 12, reveal: 7 };

const shuffle = (list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/**
 * How many of each throw everybody gets for the whole match.
 *
 * Set so the three stocks together comfortably cover the rounds, but no single
 * throw does. At eight rounds that is five of each: fifteen throws for eight
 * rounds, and nobody can throw rock more than five times. Running out of
 * everything is impossible; running out of a favourite is the point.
 */
const stockFor = (rounds) => Math.max(2, Math.ceil(rounds * 0.62));

export default {
  id: 'standoff',
  name: 'Standoff',
  tagline: 'Rock, paper, scissors — against everyone at once, and your throws run out.',
  emoji: '✊',
  accent: '#f0576d',
  client: 'standoff',
  minPlayers: 2,
  // Scoring is a pass over the other players, so a big room costs a little
  // more per round, but nothing here grows badly with the crowd.
  maxPlayers: 60,
  tickRate: 10,

  howToPlay: [
    'Everyone throws at the same time — and you play against every other person at once.',
    'Beat somebody and you gain; lose to somebody and you drop. Beat everybody and it is a sweep.',
    'You only have so many of each throw, and everyone can see what you have left.',
    'The last round is worth double, so nobody is ever out of it.',
  ],

  options: {
    rounds: {
      label: 'Rounds',
      hint: 'How long the standoff runs',
      kind: 'number',
      min: 3,
      max: 20,
      hardMax: 60,
      step: 1,
      default: 8,
    },
    throwSeconds: {
      label: 'Seconds to throw',
      hint: 'How long you get to decide',
      kind: 'number',
      min: 3,
      max: 30,
      hardMax: 120,
      step: 1,
      default: PHASES.throw,
    },
    stockRule: {
      label: 'How many of each throw',
      hint: 'Running out is what makes the endgame',
      kind: 'choice',
      default: 'limited',
      choices: [
        { id: 'limited', label: 'Limited', note: 'they run out — everyone can see' },
        { id: 'endless', label: 'Endless', note: 'plain rules, no counting' },
      ],
    },
  },

  createState(players, ctx = {}) {
    const settings = ctx.settings ?? {};
    const rounds = Math.max(1, Math.min(60, Number(settings.rounds) || 8));
    const limited = settings.stockRule !== 'endless';
    const stock = stockFor(rounds);

    return {
      settings: {
        rounds,
        limited,
        throwSeconds: Math.max(3, Math.min(120, Number(settings.throwSeconds) || PHASES.throw)),
      },
      phase: 'brief',
      round: 0,
      maxRounds: rounds,
      timeLeft: PHASES.brief,
      phaseTotal: PHASES.brief,
      briefed: [],
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        bot: Boolean(p.bot),
        connected: p.connected !== false,
        score: 0,
        // What is left of each throw. Shown to everybody on purpose.
        stock: limited ? { rock: stock, paper: stock, scissors: stock } : null,
        sweeps: 0,
        streak: 0,
        bestStreak: 0,
      })),
      /** playerId -> throw, this round. Never sent out before the reveal. */
      picks: {},
      /** Who has locked in — this *is* sent, because the pressure is the game. */
      locked: [],
      /** Filled at the reveal: what everybody threw and how it went. */
      table: null,
      log: [],
      over: false,
      dirty: true,
    };
  },

  onPlayerJoin(state, player) {
    const known = state.players.find((p) => p.id === player.id);
    if (known) {
      known.connected = true;
      known.name = player.name;
    } else {
      // Somebody arriving mid-match gets a full stock rather than none — they
      // are behind on score already, and handing them an empty hand would make
      // joining pointless.
      const stock = stockFor(state.maxRounds);
      state.players.push({
        id: player.id,
        name: player.name,
        bot: Boolean(player.bot),
        connected: true,
        score: 0,
        stock: state.settings.limited ? { rock: stock, paper: stock, scissors: stock } : null,
        sweeps: 0,
        streak: 0,
        bestStreak: 0,
      });
    }
    state.dirty = true;
  },

  onPlayerLeave(state, player) {
    const known = state.players.find((p) => p.id === player.id);
    if (known) known.connected = false;
    state.dirty = true;
  },

  onAction(state, player, action = {}, api) {
    const me = state.players.find((p) => p.id === player.id);
    if (!me) return;

    if (action.type === 'briefed' && state.phase === 'brief') {
      if (!state.briefed.includes(me.id)) state.briefed.push(me.id);
      state.dirty = true;
      // Nobody should sit through a countdown everybody has finished with.
      if (everyoneReady(state)) beginRound(state);
      return;
    }

    if (action.type === 'throw' && state.phase === 'throw') {
      const pick = String(action.pick ?? '');
      if (!THROWS.includes(pick)) return;
      // Out of that one. Refused rather than silently swapped, because a throw
      // you did not choose losing you the round is the worst thing this game
      // could do to somebody.
      if (state.settings.limited && (me.stock?.[pick] ?? 0) <= 0) return;
      // Changing your mind is allowed right up to the buzzer — that is half of
      // the tension — but it is not allowed to spend two of anything.
      state.picks[me.id] = pick;
      if (!state.locked.includes(me.id)) state.locked.push(me.id);
      state.dirty = true;
      if (everyoneThrown(state)) settleRound(state, api);
      return;
    }
  },

  botAction(state, bot) {
    const me = state.players.find((p) => p.id === bot.id);
    if (!me) return null;

    if (state.phase === 'brief' && !state.briefed.includes(bot.id)) {
      return { type: 'briefed' };
    }

    if (state.phase === 'throw' && state.picks[bot.id] === undefined) {
      return { type: 'throw', pick: botPick(state, me) };
    }
    return null;
  },

  onTick(state, dt, api) {
    if (state.over) return;
    state.timeLeft -= dt;
    if (state.timeLeft > 0) return;

    if (state.phase === 'brief') return beginRound(state);
    if (state.phase === 'throw') return settleRound(state, api);
    if (state.phase === 'reveal') {
      if (state.round >= state.maxRounds) {
        state.over = true;
        state.phase = 'over';
        state.dirty = true;
        api?.finish?.();
        return;
      }
      return beginRound(state);
    }
  },

  isDirty(state) {
    const was = state.dirty;
    state.dirty = false;
    return was;
  },

  isOver: (state) => Boolean(state.over),

  results(state) {
    return [...state.players]
      .sort((a, b) => b.score - a.score || b.sweeps - a.sweeps)
      .map((p, i) => ({ playerId: p.id, name: p.name, score: p.score, place: i + 1 }));
  },

  serialize(state) {
    const final = state.round === state.maxRounds;
    return {
      phase: state.phase,
      rules: this.howToPlay,
      round: state.round,
      maxRounds: state.maxRounds,
      timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
      phaseTotal: state.phaseTotal,
      limited: state.settings.limited,
      // Said out loud, because a round worth double changes how people play it.
      doubled: final && state.phase !== 'brief',
      players: state.players.map((p) => ({
        id: p.id,
        name: p.name,
        bot: p.bot,
        connected: p.connected,
        score: p.score,
        stock: p.stock ? { ...p.stock } : null,
        sweeps: p.sweeps,
        streak: p.streak,
      })),
      // Who has committed — never what to. The pressure of being the last one
      // still deciding is most of what makes the throw phase fun, and it costs
      // nothing to know.
      locked: [...state.locked],
      // Only ever set once the round is decided.
      table: state.table,
      log: state.log.slice(-6),
      briefed: state.briefed,
    };
  },

  /**
   * Your own throw comes back to you and to nobody else.
   *
   * Without this the shared view would have to carry every pick for the client
   * to show you your own, and then everybody's client would have everybody's
   * throw a phase early.
   */
  serializeFor(state, playerId) {
    const shared = this.serialize(state);
    return {
      ...shared,
      you: {
        id: playerId,
        pick: state.phase === 'throw' ? (state.picks[playerId] ?? null) : null,
        stock: state.players.find((p) => p.id === playerId)?.stock ?? null,
      },
    };
  },
};

/* -------------------------------- the round ------------------------------- */

function activePlayers(state) {
  return state.players.filter((p) => p.connected !== false);
}

function everyoneReady(state) {
  const active = activePlayers(state);
  return active.length > 0 && active.every((p) => state.briefed.includes(p.id));
}

function everyoneThrown(state) {
  const active = activePlayers(state);
  return active.length > 0 && active.every((p) => state.picks[p.id] !== undefined);
}

function beginRound(state) {
  state.round += 1;
  state.phase = 'throw';
  state.picks = {};
  state.locked = [];
  state.table = null;
  state.phaseTotal = state.settings.throwSeconds;
  state.timeLeft = state.settings.throwSeconds;
  state.dirty = true;
}

/** What a player can still throw. */
function available(state, player) {
  if (!state.settings.limited || !player.stock) return [...THROWS];
  return THROWS.filter((t) => (player.stock[t] ?? 0) > 0);
}

/**
 * Works out the round and hands out the points.
 *
 * Every throw is scored against every other, which is the whole idea: one
 * decision, as many little duels as there are people in the room.
 */
function settleRound(state, api) {
  const active = activePlayers(state);
  const final = state.round >= state.maxRounds;
  const multiplier = final ? FINAL_MULTIPLIER : 1;

  // Anybody who ran out of clock throws something they still have, at random,
  // and it is marked so the room can see it was the buzzer and not them.
  const forced = [];
  for (const p of active) {
    if (state.picks[p.id] !== undefined) continue;
    const canThrow = available(state, p);
    state.picks[p.id] = canThrow[Math.floor(Math.random() * canThrow.length)] ?? 'rock';
    forced.push(p.id);
  }

  // Spending happens here rather than at the moment of choosing, so changing
  // your mind during the round costs nothing.
  if (state.settings.limited) {
    for (const p of active) {
      const pick = state.picks[p.id];
      if (p.stock && pick && p.stock[pick] > 0) p.stock[pick] -= 1;
    }
  }

  const rows = [];
  for (const p of active) {
    const mine = state.picks[p.id];
    let beat = 0;
    let lost = 0;
    let tied = 0;
    for (const other of active) {
      if (other.id === p.id) continue;
      const theirs = state.picks[other.id];
      if (theirs === mine) tied += 1;
      else if (BEATS[mine] === theirs) beat += 1;
      else lost += 1;
    }

    // A sweep is beating everybody with nobody tying you — in a room of six
    // that is five correct reads at once, and it should feel like it.
    //
    // Three players minimum. In a duel, beating your only opponent is just
    // winning; calling that a sweep paid the bonus on every single win and
    // made the word mean nothing.
    const swept = active.length > 2 && beat === active.length - 1;
    let points = (beat * PER_WIN + lost * PER_LOSS) * multiplier;
    if (swept) points += SWEEP_BONUS * multiplier;

    p.score += points;
    if (swept) {
      p.sweeps += 1;
      p.streak += 1;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
    } else if (beat > lost) {
      p.streak += 1;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
    } else {
      p.streak = 0;
    }

    rows.push({
      id: p.id,
      name: p.name,
      pick: mine,
      hand: HAND[mine],
      label: LABEL[mine],
      beat,
      lost,
      tied,
      swept,
      forced: forced.includes(p.id),
      points,
      total: p.score,
    });
  }

  rows.sort((a, b) => b.points - a.points || b.beat - a.beat);

  // What the room actually threw, which is the read everybody wants for the
  // next round.
  const counts = Object.fromEntries(THROWS.map((t) => [t, rows.filter((r) => r.pick === t).length]));

  state.table = {
    round: state.round,
    doubled: final,
    rows,
    counts,
    // Said in words, because a table of numbers is not a moment. The sweep is
    // the headline whenever there is one.
    headline: headlineFor(rows, counts, active.length),
  };

  const sweeper = rows.find((r) => r.swept);
  state.log.push(
    sweeper
      ? `Round ${state.round}: ${sweeper.name} swept the room with ${sweeper.label}.`
      : `Round ${state.round}: ${describeCounts(counts)}.`
  );

  state.phase = 'reveal';
  state.phaseTotal = PHASES.reveal;
  state.timeLeft = PHASES.reveal;
  state.dirty = true;
  void api;
}

function describeCounts(counts) {
  const parts = THROWS.filter((t) => counts[t] > 0).map((t) => `${counts[t]} ${LABEL[t].toLowerCase()}`);
  return parts.join(', ');
}

function headlineFor(rows, counts, size) {
  const sweeper = rows.find((r) => r.swept);
  if (sweeper) return `${sweeper.name} swept the room`;

  // Everybody the same is its own kind of funny and worth naming.
  const thrown = THROWS.filter((t) => counts[t] > 0);
  if (thrown.length === 1) return `Everybody threw ${LABEL[thrown[0]].toLowerCase()}`;

  // A three-way standoff in a room where all three came up in equal numbers.
  if (size >= 3 && thrown.length === 3 && new Set(thrown.map((t) => counts[t])).size === 1) {
    return 'A perfect three-way standoff';
  }

  const top = rows[0];
  if (!top || top.points <= 0) return 'Nobody got away with much';
  return `${top.name} came out on top`;
}

/* --------------------------------- the CPU -------------------------------- */

/**
 * A CPU player that is worth beating.
 *
 * Random is the honest baseline for rock-paper-scissors and it is also
 * completely flat to play against. This does the thing a person does instead:
 * looks at what the room threw last round and answers the most popular of it —
 * which is beatable by anyone who notices, and that is the point.
 *
 * It never looks at what anyone has picked this round. It cannot: the picks
 * are not on the table until the round is settled.
 */
function botPick(state, me) {
  const canThrow = available(state, me);
  if (!canThrow.length) return 'rock';

  const last = state.table?.counts;
  if (last) {
    // Most popular throw last round, answered.
    const popular = THROWS.reduce((best, t) => ((last[t] ?? 0) > (last[best] ?? 0) ? t : best), THROWS[0]);
    const counter = THROWS.find((t) => BEATS[t] === popular);
    // Not every time, or it becomes a rule somebody can farm.
    if (counter && canThrow.includes(counter) && Math.random() < 0.6) return counter;
  }

  // Otherwise lean on whatever it has most of, so a CPU never strands itself
  // holding four scissors going into the last two rounds.
  if (state.settings.limited && me.stock) {
    const richest = shuffle(canThrow).sort((a, b) => (me.stock[b] ?? 0) - (me.stock[a] ?? 0));
    if (Math.random() < 0.5) return richest[0];
  }

  return canThrow[Math.floor(Math.random() * canThrow.length)];
}
