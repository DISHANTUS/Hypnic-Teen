// Stand-in players for testing a table.
//
// Every casino game needs other people at it — a pot with one player in it
// proves nothing about splitting, and a client cannot leak somebody else's
// cards to itself. So these sit down on real sockets and play sensibly enough
// to keep a table moving without anybody driving them by hand.
//
// They are deliberately not clever. A dummy that plays well would make the
// tests depend on strategy; these do the obvious legal thing and get out of
// the way, so a failure is always the table's fault and never theirs.

import { io } from 'socket.io-client';

/**
 * What a dummy does when it is asked to act, per game.
 *
 * Each one gets the state as that player sees it and returns an action, or
 * null to do nothing. Everything about connecting, joining and readying is
 * shared below.
 */
const BRAINS = {
  // Ante and go.
  blackjack: (s, me) => {
    if (s.phase === 'bets' && !s.you?.in) return { type: 'ante' };
    if (s.phase === 'play' && s.you?.canPlay) {
      // Hit under seventeen, otherwise stand. Dull on purpose.
      return { type: s.you.total < 17 ? 'hit' : 'stand' };
    }
    void me;
    return null;
  },

  lottery: (s) => {
    if (s.phase !== 'buy') return null;
    // One ticket a draw, lucky dip — the server fills in whatever is missing.
    if ((s.you?.tickets?.length ?? 0) > 0) return null;
    return { type: 'buy', numbers: [] };
  },

  roulette: (s) => {
    if (s.phase !== 'bets' || s.you?.staked) return null;
    return { type: 'bet', kind: 'red', amount: Math.max(5, Math.min(25, s.maxBet ?? 25)) };
  },

  holdem: (s) => {
    if (s.phase !== 'play' || !s.you?.can) return null;
    return { type: s.you.can.check ? 'check' : 'call' };
  },

  craps: (s) => (s.phase === 'bets' && !s.you?.staked ? { type: 'bet', kind: 'pass', amount: 10 } : null),
  horses: (s) => (s.phase === 'bets' && !s.you?.staked ? { type: 'bet', kind: 'h1', amount: 10 } : null),
  keno: (s) => (s.phase === 'buy' && !s.you?.card ? { type: 'buy', spots: [] } : null),

  // The only dummy that has to look at its card. The lines are worked out here
  // rather than imported from the game so that a dummy stays a dummy — and so
  // that a bug in the server's idea of a line cannot agree with itself.
  bingo: (s) => {
    if (s.phase === 'buy' && !s.you?.card) return { type: 'buy' };
    if (s.phase !== 'call' || !s.you?.card || s.you.lockedFor > 0) return null;
    const called = new Set(s.calls);
    const on = (i) => s.you.card[i] === null || called.has(s.you.card[i]);
    const lines = [[0, 6, 12, 18, 24], [4, 8, 12, 16, 20]];
    for (let r = 0; r < 5; r++) lines.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
    for (let c = 0; c < 5; c++) lines.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
    // It only calls what it has. One that mashed the button would spend the
    // whole game locked out and never reach a payout to check.
    return lines.some((line) => line.every(on)) ? { type: 'claim' } : null;
  },

  jackpot: (s) => (s.phase === 'bets' && !s.you?.staked ? { type: 'throw', amount: 50 } : null),

  // The umpire is gone — the feed settles these now — so this is back to
  // being an ordinary punter that backs whatever is open.
  sports: (s) => (
    s.open?.phase === 'betting' && !s.you?.staked
      ? { type: 'back', outcome: s.open.outs?.[0]?.id, amount: 25 }
      : null
  ),

  // The four machines and the progressive all take the same one.
  machine: (s) => (s.phase === 'bets' && !s.you?.in ? { type: 'stake' } : null),
};

const brainFor = (gameId) =>
  BRAINS[gameId] ?? (['slots', 'plinko', 'wheel', 'scratch', 'progressive', 'baccarat', 'three-card', 'casino-war', 'sic-bo'].includes(gameId) ? BRAINS.machine : null);

/**
 * Sits a dummy down at a room.
 *
 * @param {object} opts
 * @param {string} opts.base    where the studio is
 * @param {string} opts.code    the room code
 * @param {string} opts.gameId  which table, so it knows how to play
 * @param {string} opts.name
 * @param {number} [opts.chips] chips to award before sitting down
 * @param {number} [opts.pause] ms to wait before acting, so a test has time to
 *                              look at a phase before the dummies end it
 */
export async function seatDummy({ base, code, gameId, name, chips = 20000, pause = 600 }) {
  const { questions } = await fetch(`${base}/api/quiz`).then((r) => r.json());
  const account = await fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      age: 20,
      pin: '8080',
      // Different answers per dummy, so each derives its own keyword rather
      // than colliding and being handed somebody else's identity.
      answers: Object.fromEntries(
        questions.map((q, i) => [q.id, q.options[(i + name.length) % q.options.length].id])
      ),
    }),
  }).then((r) => r.json());
  if (account.error) throw new Error(`dummy signup (${name}): ${account.error}`);

  // Chips to play with, straight into the wallet — a dummy that has to visit
  // the cage first is a dummy that cannot sit down at a table with an ante.
  if (chips > 0) {
    await fetch(`${base}/api/_test/chips`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: account.profile.id, chips }),
    }).catch(() => {});
  }

  const socket = io(base, { transports: ['websocket'], reconnection: false });
  const seen = { last: null, states: 0 };
  const brain = brainFor(gameId);

  socket.on('game:state', (s) => {
    seen.last = s;
    seen.states += 1;

    if (s.phase === 'brief' && !s.briefed?.includes(account.profile.id)) {
      socket.emit('game:action', { type: 'briefed' });
      return;
    }
    if (!brain) return;
    const move = brain(s, account.profile.id);
    if (move) setTimeout(() => socket.emit('game:action', move), pause);
  });

  await new Promise((r) => socket.once('connect', r));
  const joined = await new Promise((r) => {
    socket.emit('room:join', { code, token: account.token }, r);
    setTimeout(() => r({ error: 'no answer to room:join' }), 8000);
  });
  if (joined?.error) throw new Error(`dummy join (${name}): ${joined.error}`);

  return {
    name,
    id: account.profile.id,
    token: account.token,
    socket,
    seen,
    close: () => socket.close(),
  };
}

/** A whole table of them. */
export async function seatDummies(count, opts) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(await seatDummy({ ...opts, name: opts.name ? `${opts.name}${i + 1}` : `Dummy${i + 1}` }));
  }
  return out;
}
