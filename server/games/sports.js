// Sports betting — asked early, locked before it happens, settled off the net.
//
// Every other table on this floor decides its own result. This one cannot: the
// thing being bet on is happening somewhere else, and the only honest way to
// run it is to ask about something that has not happened yet, shut the betting
// before it does, and then go and look up what did.
//
// That ordering is the whole design and it is not a formality. Every feed that
// a room can afford runs behind the television by somewhere between a few
// seconds and a minute. A market settled off a feed but bet on *live* would be
// a market where the room already knows the answer and the table does not. So
// the window a market asks about begins at the moment betting closes, and the
// baseline it is measured from is fetched at that same moment — not before.
//
// Markets overlap. As soon as one locks the next opens, so there is always
// something to bet on while the last few are out waiting for their result. A
// market that cannot be settled — the feed goes quiet, the innings ends
// underneath it, nothing comes back in time — is void, and void hands every
// chip back exactly as it came. Nothing here ever guesses at a result.

import { stake, award, splitPot, balanceOf, MIN_BET } from '../chips.js';
import { feedFor, cached } from '../feeds/index.js';
import { bookFor, outsFor } from '../markets.js';
import '../feeds/football.js';
import '../feeds/cricket.js';
import '../feeds/fake.js';

const PHASES = { brief: 20, settle: 10 };
/**
 * How long a market waits for its answer past the end of its window before it
 * is given up on. Generous, because a feed being a minute late is ordinary and
 * voiding a market people got right is not a small thing to do to them.
 */
const PATIENCE_MS = Number(process.env.SPORTS_PATIENCE_MS ?? 150_000);
/**
 * Snapshots shared between everything that asks within this long.
 *
 * Both of these are read from the environment so the tests can drive a whole
 * match in a second. A test that had to wait out a real sixty second cache
 * would be a test nobody runs.
 */
const SNAP_TTL_MS = Number(process.env.SPORTS_SNAP_TTL_MS ?? 60_000);

export const sports = {
  id: 'sports',
  name: 'Sports Betting',
  tagline: 'Bet on the real match. Asked early, locked before it happens, settled off the net.',
  emoji: '⚽',
  accent: '#27ae60',
  client: 'sports',
  minPlayers: 2,
  maxPlayers: 40,
  tickRate: 4,
  stakes: 'chips',

  howToPlay: [
    'Every market is about the next few minutes of a real match — asked before it happens.',
    'Betting shuts before the window starts, so nobody can back something they have already seen.',
    'The result comes off the internet. Nobody in this room decides it.',
    'The next market opens the moment this one shuts, so there is always one to bet on.',
    'If the result never arrives, the market is void and every chip goes back.',
  ],

  options: {
    sport: {
      label: 'What are you watching',
      kind: 'choice',
      get default() { return feedFor('football')?.ready ? 'football' : 'demo-football'; },
      choices: [
        { id: 'football', label: 'Football', note: 'goals, by side and by window' },
        { id: 'cricket', label: 'Cricket', note: 'runs and wickets by the over' },
        { id: 'demo-football', label: 'Demo match', note: 'no key needed — real chips, pretend football' },
      ],
    },
    rounds: { label: 'Markets', kind: 'number', min: 1, max: 60, hardMax: 300, step: 1, default: 12 },
    maxBet: { label: 'Most you can back with', kind: 'number', min: 10, max: 5000, hardMax: 100000, step: 10, default: 300 },
    // Two minutes by default, and the reason is the request budget rather than
    // taste: a free key is around a hundred calls a day, a market costs two,
    // and a ninety minute match at this cadence lands just inside that.
    betSeconds: { label: 'Seconds to get a bet on', kind: 'number', min: 15, max: 300, hardMax: 600, step: 15, default: 120 },
  },

  createState(players, ctx = {}) {
    const settings = ctx.settings ?? {};
    const sport = ['football', 'cricket', 'demo-football', 'demo-cricket'].includes(settings.sport)
      ? settings.sport : 'football';
    return {
      settings: {
        sport,
        rounds: Math.max(1, Math.min(300, Number(settings.rounds) || 12)),
        maxBet: Math.max(10, Math.min(100000, Number(settings.maxBet) || 300)),
        // The demo match runs a minute of football a second and is over inside
        // two, so a two minute betting window would be the whole thing. Clamped
        // rather than defaulted: the lobby always sends a value, so there is no
        // such thing as the host having left this alone to detect.
        betSeconds: Math.max(15, Math.min(sport.startsWith('demo-') ? 30 : 600,
          Number(settings.betSeconds) || 120)),
      },
      phase: 'brief',
      timeLeft: PHASES.brief,
      phaseTotal: PHASES.brief,
      briefed: [],
      hostId: ctx.room?.hostId ?? players[0]?.id ?? null,

      /** Which fixture. Chosen by the host from whatever the feed is showing. */
      matchId: null,
      matchName: '',
      /** What the feed says is on right now, for the host to pick from. */
      fixtures: [],
      /** The last thing the feed said, for the scoreboard line. */
      snap: null,
      feedTrouble: '',
      polling: false,
      calls: 0,

      opened: 0,
      /** The one taking bets. */
      open: null,
      /** Locked, waiting on the world. */
      pending: [],
      /** Done, newest first, for the board. */
      settled: [],
      used: [],

      carried: 0,
      riders: [],
      players: players.map((p) => ({
        id: p.id, name: p.name, connected: p.connected !== false, net: 0, bestWin: 0,
      })),
      log: [],
      over: false,
      dirty: true,
    };
  },

  onPlayerJoin(state, player) {
    const known = state.players.find((p) => p.id === player.id);
    if (known) { known.connected = true; known.name = player.name; }
    else state.players.push({ id: player.id, name: player.name, connected: true, net: 0, bestWin: 0 });
    if (!state.hostId) state.hostId = player.id;
    state.dirty = true;
  },

  onPlayerLeave(state, player) {
    const me = state.players.find((p) => p.id === player.id);
    if (me) me.connected = false;
    if (state.hostId === player.id) state.hostId = state.players.find((p) => p.connected)?.id ?? null;
    state.dirty = true;
  },

  onAction(state, player, action = {}) {
    const me = state.players.find((p) => p.id === player.id);
    if (!me) return;

    if (action.type === 'briefed' && state.phase === 'brief') {
      if (!state.briefed.includes(me.id)) state.briefed.push(me.id);
      state.dirty = true;
      if (everyoneReady(state)) begin(state);
      return;
    }

    // Which fixture. The host's to pick, because it is the room's television.
    if (action.type === 'match' && me.id === state.hostId) {
      state.matchId = String(action.id ?? '').slice(0, 80) || null;
      state.matchName = String(action.name ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
      state.log.push(`Following ${state.matchName || state.matchId}.`);
      state.dirty = true;
      if (state.phase === 'play' && !state.open && !state.pending.length) {
        poll(state, () => openNext(state));
      }
      return;
    }

    if (action.type === 'back' && state.open && state.open.phase === 'betting') {
      const out = state.open.outs.find((o) => o.id === action.outcome);
      if (!out) return;
      const amount = Math.floor(Number(action.amount));
      if (!Number.isFinite(amount) || amount < MIN_BET) return;
      const mine = state.open.bets.filter((b) => b.id === me.id).reduce((sum, b) => sum + b.chips, 0);
      if (mine + amount > state.settings.maxBet) return;
      const taken = stake(me.id, amount, 'sports');
      if (taken.error) return;
      const row = state.open.bets.find((b) => b.id === me.id && b.outcome === out.id);
      if (row) row.chips += amount;
      else state.open.bets.push({ id: me.id, name: me.name, outcome: out.id, chips: amount });
      state.dirty = true;
    }
  },

  botAction: () => null,

  onTick(state, dt) {
    if (state.over) return;

    if (state.phase === 'brief') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) begin(state);
      return;
    }
    if (state.phase !== 'play') return;

    // Nothing runs until the host says what everyone is watching.
    if (!state.matchId) { state.timeLeft = 0; return; }

    if (state.open?.phase === 'betting') {
      state.open.timeLeft -= dt;
      state.timeLeft = Math.max(0, Math.ceil(state.open.timeLeft));
      if (state.open.timeLeft <= 0) lock(state);
    }

    // Everything waiting on the world, checked against the last thing it said.
    for (const m of [...state.pending]) {
      if (m.phase !== 'waiting') continue;
      const snap = state.snap;
      if (snap && snap.clock >= m.closeClock) {
        settle(state, m, snap);
      } else if (Date.now() - m.lockedAt > PATIENCE_MS) {
        void_(state, m, snap ? 'the match did not get there in time' : 'the feed went quiet');
      }
    }

    // A poll is worth spending only when something is waiting on one.
    const wants = state.pending.some((m) => m.phase === 'waiting');
    if (wants) poll(state);

    if (state.opened >= state.settings.rounds && !state.open && !state.pending.length) closeBook(state);
  },

  isDirty(state) { const was = state.dirty; state.dirty = false; return was; },
  isOver: (state) => Boolean(state.over),

  results(state) {
    return [...state.players]
      .sort((a, b) => b.net - a.net || b.bestWin - a.bestWin)
      .map((p, i) => ({ playerId: p.id, name: p.name, score: p.net, place: i + 1 }));
  },

  serialize(state) {
    const feed = feedFor(state.settings.sport);
    const onEach = (m) => (m?.outs ?? []).map((o) => ({
      id: o.id,
      chips: m.bets.filter((b) => b.outcome === o.id).reduce((sum, b) => sum + b.chips, 0),
      backers: new Set(m.bets.filter((b) => b.outcome === o.id).map((b) => b.id)).size,
    }));
    const potOf = (m) => m.bets.reduce((sum, b) => sum + b.chips, 0);

    return {
      phase: state.phase,
      rules: this.howToPlay,
      sport: state.settings.sport,
      isDemo: state.settings.sport.startsWith('demo-'),
      feedReady: Boolean(feed?.ready),
      feedWhy: feed?.ready ? '' : (feed?.why ?? 'no feed for that sport'),
      feedTrouble: state.feedTrouble,
      calls: state.calls,

      hostId: state.hostId,
      matchId: state.matchId,
      matchName: state.matchName || state.snap?.name || '',
      fixtures: state.fixtures,
      clockLabel: state.snap?.clockLabel ?? '',
      score: state.snap?.facts ?? null,

      opened: state.opened,
      maxRounds: state.settings.rounds,
      maxBet: state.settings.maxBet,
      minBet: MIN_BET,
      timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
      phaseTotal: state.phaseTotal,
      carried: state.carried,

      open: state.open && {
        n: state.open.n,
        ask: state.open.ask,
        outs: state.open.outs,
        phase: state.open.phase,
        timeLeft: Math.max(0, Math.ceil(state.open.timeLeft)),
        pot: potOf(state.open) + state.carried,
        onEach: onEach(state.open),
        bets: state.open.bets,
      },
      // Locked and out in the world. The room watches these tick along.
      pending: state.pending.map((m) => ({
        n: m.n, ask: m.ask, outs: m.outs, phase: m.phase,
        pot: potOf(m), onEach: onEach(m),
        fromClock: m.lockClock, toClock: m.closeClock,
        clockLabel: m.windowLabel,
      })),
      settled: state.settled.slice(0, 4),

      players: state.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected, net: p.net })),
      briefed: state.briefed,
      log: state.log.slice(-5),
    };
  },

  serializeFor(state, playerId) {
    const mine = (m) => (m?.bets ?? []).filter((b) => b.id === playerId);
    return {
      ...this.serialize(state),
      you: {
        id: playerId,
        chips: balanceOf(playerId),
        isHost: playerId === state.hostId,
        staked: mine(state.open).reduce((sum, b) => sum + b.chips, 0),
        on: mine(state.open).map((b) => ({ outcome: b.outcome, chips: b.chips })),
        // What is still out there with your money on it.
        riding: state.pending
          .map((m) => ({ n: m.n, ask: m.ask, chips: mine(m).reduce((sum, b) => sum + b.chips, 0),
                         outcome: mine(m)[0]?.outcome ?? null }))
          .filter((x) => x.chips > 0),
      },
    };
  },
};

const everyoneReady = (state) => {
  const list = state.players.filter((p) => p.connected !== false);
  return list.length > 0 && list.every((p) => state.briefed.includes(p.id));
};

/** The feed for this room, with one shared snapshot behind it. */
const feedOf = (state) => {
  const raw = feedFor(state.settings.sport);
  if (!raw) return null;
  if (!state._feed || state._feedSport !== state.settings.sport) {
    state._feed = cached(raw, SNAP_TTL_MS);
    state._feedSport = state.settings.sport;
  }
  return state._feed;
};

/**
 * Ask the feed what is happening, without holding up the game loop.
 *
 * Fired and forgotten from the tick. One at a time — a table with four markets
 * waiting would otherwise fire four requests at the same instant and spend a
 * day's allowance in an afternoon.
 */
function poll(state, then, { fresh = false } = {}) {
  if (state.polling || !state.matchId) return;
  const feed = feedOf(state);
  if (!feed) return;
  state.polling = true;
  feed.snapshot(state.matchId, { fresh })
    .then((snap) => {
      if (snap) {
        state.snap = snap;
        state.feedTrouble = '';
      } else {
        state.feedTrouble = 'the feed is not answering';
      }
      state.calls = feed.calls?.() ?? state.calls;
      state.dirty = true;
      then?.(snap);
    })
    .catch((err) => {
      state.feedTrouble = String(err?.message ?? err);
      state.dirty = true;
      then?.(null);
    })
    .finally(() => { state.polling = false; });
}

function begin(state) {
  state.phase = 'play';
  state.timeLeft = 0;
  state.dirty = true;
  if (state.matchId) { poll(state, () => openNext(state)); return; }

  // Ask what is on, so the host taps a fixture instead of finding an id. One
  // live match and there is nothing to choose between — follow it rather than
  // make somebody confirm the only option.
  const feed = feedOf(state);
  feed?.list?.().then((list) => {
    state.fixtures = (list ?? []).slice(0, 12);
    state.dirty = true;
    if (state.fixtures.length === 1) {
      state.matchId = state.fixtures[0].id;
      state.matchName = state.fixtures[0].name;
      state.log.push(`Following ${state.matchName}.`);
      poll(state, () => openNext(state));
    }
  }).catch(() => { state.feedTrouble = 'could not ask what is on'; state.dirty = true; });
}

/** The question for the next market, asked against whatever the feed last said. */
function openNext(state) {
  if (state.opened >= state.settings.rounds) return;
  const book = bookFor(state.settings.sport);
  const unused = book.filter((m) => !state.used.includes(m.id));
  const pool = unused.length ? unused : book;
  if (!unused.length) state.used = [];
  const def = pool[Math.floor(Math.random() * pool.length)];
  state.used.push(def.id);

  // Asked against the last snapshot, but this is only the wording. What the
  // market is actually measured from is fetched again when betting shuts.
  const seen = state.snap ?? { clock: 0, facts: {}, clockLabel: '' };
  state.opened += 1;
  state.open = {
    n: state.opened,
    def,
    ask: def.ask(seen),
    outs: outsFor(def, seen),
    phase: 'betting',
    timeLeft: state.settings.betSeconds,
    bets: [],
    lockClock: null,
    closeClock: null,
    lockedAt: 0,
    windowLabel: '',
  };
  state.timeLeft = state.settings.betSeconds;
  state.phaseTotal = state.settings.betSeconds;
  state.dirty = true;
}

/**
 * Betting shuts, and the market goes out into the world.
 *
 * The baseline is fetched here rather than reused from when the question was
 * asked, and that is the single most important line in this file. A baseline
 * from two minutes ago would put two minutes of already-televised football
 * inside the window — which is exactly the thing this table exists to avoid.
 */
function lock(state) {
  const m = state.open;
  if (!m) return;
  m.phase = 'locking';
  state.dirty = true;

  poll(state, (snap) => {
    if (!snap) {
      // No baseline, no market. Nobody has seen anything yet, so this costs
      // the room nothing but the question.
      void_(state, m, 'could not reach the feed to start the clock');
      state.open = null;
      openNext(state);
      return;
    }
    m.lock = snap;
    m.lockClock = snap.clock;
    m.closeClock = snap.clock + m.def.span;
    m.lockedAt = Date.now();
    m.windowLabel = `${snap.clockLabel} onwards`;
    // Re-worded now that the real baseline is known, so the board never shows
    // a window that turns out not to be the one being measured.
    m.ask = m.def.ask(snap);
    m.phase = 'waiting';
    state.pending.push(m);
    state.open = null;
    state.log.push(`Market ${m.n} is shut: ${m.ask}`);
    openNext(state);
    state.dirty = true;
  }, { fresh: true });
}

function settle(state, m, close) {
  const verdict = m.def.resolve(m.lock, close);
  if (!verdict.ok) return void_(state, m, verdict.why);

  const pot = m.bets.reduce((sum, b) => sum + b.chips, 0) + state.carried;
  const winners = m.bets.filter((b) => b.outcome === verdict.outcome);
  const label = m.outs.find((o) => o.id === verdict.outcome)?.label ?? verdict.outcome;
  const paid = [];

  if (winners.length && pot > 0) {
    for (const { id, chips } of splitPot(pot, winners.map((b) => ({ id: b.id, weight: b.chips })))) {
      award(id, chips, 'sports');
      const who = state.players.find((p) => p.id === id);
      if (who) who.bestWin = Math.max(who.bestWin, chips);
      paid.push({ id, name: who?.name ?? id, chips });
    }
    state.carried = 0;
  } else if (m.bets.length) {
    state.carried = pot;
  }

  for (const b of m.bets) {
    const who = state.players.find((p) => p.id === b.id);
    if (who) who.net -= b.chips;
  }
  for (const p of paid) {
    const who = state.players.find((x) => x.id === p.id);
    if (who) who.net += p.chips;
  }
  if (m.bets.length) state.riders = m.bets.map((b) => ({ id: b.id, weight: b.chips }));

  finish(state, m, {
    n: m.n, ask: m.ask, voided: false, outcome: verdict.outcome, label,
    pot, paid: paid.sort((a, b) => b.chips - a.chips), carried: state.carried,
    said: paid.length
      ? `${label}. ${paid[0].name} takes ${paid[0].chips}.`
      : m.bets.length ? `${label}. Nobody had it — ${state.carried} rides on.` : `${label}. Nobody had a bet on.`,
  });
}

/**
 * Give up on a market and hand everything back.
 *
 * Underscored because `void` is a keyword. Worth having as its own path rather
 * than as a branch of settle: a void must return each bet exactly as it was
 * staked, not a weighted share of a pot, and the two are only the same number
 * when nothing has carried.
 */
function void_(state, m, why) {
  for (const b of m.bets) award(b.id, b.chips, 'sports — void');
  finish(state, m, {
    n: m.n, ask: m.ask, voided: true, outcome: null, label: '—',
    pot: m.bets.reduce((sum, b) => sum + b.chips, 0),
    paid: [], carried: state.carried,
    said: `Market ${m.n} void — ${why}. Every chip back.`,
  });
}

function finish(state, m, result) {
  m.phase = 'settled';
  m.result = result;
  state.pending = state.pending.filter((x) => x !== m);
  state.settled.unshift(result);
  state.settled = state.settled.slice(0, 12);
  state.log.push(result.said);
  state.dirty = true;
}

function closeBook(state) {
  if (state.carried > 0 && state.riders.length) {
    for (const { id, chips } of splitPot(state.carried, state.riders)) {
      award(id, chips, 'sports — closed');
      const who = state.players.find((p) => p.id === id);
      if (who) who.net += chips;
    }
    state.carried = 0;
    state.log.push('Book closed. What nobody won went back.');
  }
  state.over = true;
  state.phase = 'over';
  state.dirty = true;
}

/** For the tests, which drive the clock rather than waiting on it. */
export const __internals = { openNext, lock, settle, void_, poll, PATIENCE_MS };

export const SPORT_GAMES = [sports];
