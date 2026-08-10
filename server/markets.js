// What can be asked, and how the answer is read off the feed.
//
// A market is a question about a window of the match that has not happened yet,
// plus a rule for answering it by comparing the match at the moment betting
// closed with the match at the moment the window ran out. Nothing here talks to
// the internet and nothing here holds chips — it is all pure, so every rule in
// this file can be checked by handing it two made-up snapshots.
//
// Two things shaped every question below.
//
// The window starts when betting closes, never before. That is the whole point
// of asking early: a television is ahead of every one of these feeds by
// somewhere between a few seconds and a minute, so a market about something
// that has already happened is a market the room can see the answer to. Asked
// and locked in advance, being ahead is worth nothing.
//
// And the answer has to be a subtraction between two cumulative totals, because
// that is all a free-tier feed will affordably give. "Who scored first" is not
// answerable that way when both sides score — so that outcome is offered
// honestly as `both` rather than guessed at.

const RESOLVED = (id) => ({ ok: true, outcome: id });
const UNKNOWN = (why) => ({ ok: false, why });

/* -------------------------------- football -------------------------------- */

const totalGoals = (f) => Number(f?.homeGoals ?? 0) + Number(f?.awayGoals ?? 0);

/** Nothing can be worked out across a match that stopped or never started. */
function playable(lock, close) {
  if (!lock || !close) return UNKNOWN('the feed went quiet');
  if (close.clock < lock.clock) return UNKNOWN('the clock went backwards');
  return null;
}

const FOOTBALL = [
  {
    id: 'goalSoon',
    span: 6,
    ask: (lock) => `A goal between ${lock.clock}' and ${lock.clock + 6}'?`,
    outs: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
    resolve(lock, close) {
      const bad = playable(lock, close);
      if (bad) return bad;
      return RESOLVED(totalGoals(close.facts) > totalGoals(lock.facts) ? 'yes' : 'no');
    },
  },
  {
    id: 'whoNext',
    span: 10,
    ask: (lock) => `Who scores between ${lock.clock}' and ${lock.clock + 10}'?`,
    outs: (lock) => [
      { id: 'home', label: lock.facts.home ?? 'Home' },
      { id: 'away', label: lock.facts.away ?? 'Away' },
      // Offered rather than guessed at. Two cumulative counts cannot say which
      // of two goals came first, and inventing an order would be a lie the
      // room could not check.
      { id: 'both', label: 'Both of them' },
      { id: 'neither', label: 'Neither' },
    ],
    resolve(lock, close) {
      const bad = playable(lock, close);
      if (bad) return bad;
      const dh = close.facts.homeGoals - lock.facts.homeGoals;
      const da = close.facts.awayGoals - lock.facts.awayGoals;
      if (dh > 0 && da > 0) return RESOLVED('both');
      if (dh > 0) return RESOLVED('home');
      if (da > 0) return RESOLVED('away');
      return RESOLVED('neither');
    },
  },
  {
    id: 'howManyGoals',
    span: 12,
    ask: (lock) => `How many goals between ${lock.clock}' and ${lock.clock + 12}'?`,
    outs: [{ id: 'none', label: 'None' }, { id: 'one', label: 'Exactly one' }, { id: 'more', label: 'Two or more' }],
    resolve(lock, close) {
      const bad = playable(lock, close);
      if (bad) return bad;
      const d = totalGoals(close.facts) - totalGoals(lock.facts);
      return RESOLVED(d === 0 ? 'none' : d === 1 ? 'one' : 'more');
    },
  },
  {
    id: 'homeToScore',
    span: 8,
    ask: (lock) => `Do ${lock.facts.home ?? 'the home side'} score between ${lock.clock}' and ${lock.clock + 8}'?`,
    outs: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
    resolve(lock, close) {
      const bad = playable(lock, close);
      if (bad) return bad;
      return RESOLVED(close.facts.homeGoals > lock.facts.homeGoals ? 'yes' : 'no');
    },
  },
  {
    id: 'awayToScore',
    span: 8,
    ask: (lock) => `Do ${lock.facts.away ?? 'the away side'} score between ${lock.clock}' and ${lock.clock + 8}'?`,
    outs: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
    resolve(lock, close) {
      const bad = playable(lock, close);
      if (bad) return bad;
      return RESOLVED(close.facts.awayGoals > lock.facts.awayGoals ? 'yes' : 'no');
    },
  },
];

/* --------------------------------- cricket -------------------------------- */

const overOf = (balls) => Math.floor(Number(balls ?? 0) / 6);

/**
 * Cricket has one thing football does not: a score that goes back to nothing.
 *
 * An innings break resets the runs, so a window that straddles one would read
 * as a colossal negative. Every rule below refuses rather than resolves when
 * the innings changed underneath it, and the market is voided — which hands
 * every chip back, which is the right answer to "we could not tell".
 */
function sameInnings(lock, close) {
  const bad = playable(lock, close);
  if (bad) return bad;
  if (lock.facts.inningsKey !== close.facts.inningsKey) return UNKNOWN('the innings ended underneath it');
  return null;
}

const CRICKET = [
  {
    id: 'runsNextOver',
    span: 6,
    ask: (lock) => `How many off over ${overOf(lock.clock) + 1}?`,
    outs: [{ id: 'few', label: '0 to 3' }, { id: 'some', label: '4 to 8' }, { id: 'lots', label: '9 or more' }],
    resolve(lock, close) {
      const bad = sameInnings(lock, close);
      if (bad) return bad;
      const d = close.facts.runs - lock.facts.runs;
      return RESOLVED(d <= 3 ? 'few' : d <= 8 ? 'some' : 'lots');
    },
  },
  {
    id: 'runsNextTwo',
    span: 12,
    ask: (lock) => `How many off overs ${overOf(lock.clock) + 1} and ${overOf(lock.clock) + 2}?`,
    outs: [{ id: 'few', label: '0 to 6' }, { id: 'some', label: '7 to 13' }, { id: 'lots', label: '14 or more' }],
    resolve(lock, close) {
      const bad = sameInnings(lock, close);
      if (bad) return bad;
      const d = close.facts.runs - lock.facts.runs;
      return RESOLVED(d <= 6 ? 'few' : d <= 13 ? 'some' : 'lots');
    },
  },
  {
    id: 'wicketSoon',
    span: 18,
    ask: (lock) => `A wicket in the next three overs, from over ${overOf(lock.clock) + 1}?`,
    outs: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
    resolve(lock, close) {
      const bad = sameInnings(lock, close);
      if (bad) return bad;
      return RESOLVED(close.facts.wickets > lock.facts.wickets ? 'yes' : 'no');
    },
  },
  {
    id: 'howManyWickets',
    span: 24,
    ask: (lock) => `How many wickets in the next four overs?`,
    outs: [{ id: 'none', label: 'None' }, { id: 'one', label: 'Exactly one' }, { id: 'more', label: 'Two or more' }],
    resolve(lock, close) {
      const bad = sameInnings(lock, close);
      if (bad) return bad;
      const d = close.facts.wickets - lock.facts.wickets;
      return RESOLVED(d === 0 ? 'none' : d === 1 ? 'one' : 'more');
    },
  },
  {
    id: 'keepingUp',
    span: 30,
    /**
     * The one market that asks something about the game rather than about the
     * next few minutes: are they going faster or slower than they have been?
     * The line is the innings' own run rate, so it moves with the match and
     * cannot be worked out in advance.
     */
    ask: (lock) => `More or fewer than ${paceLine(lock)} in the next five overs?`,
    outs: [{ id: 'over', label: 'More' }, { id: 'under', label: 'Fewer' }],
    line: (lock) => paceLine(lock),
    resolve(lock, close) {
      const bad = sameInnings(lock, close);
      if (bad) return bad;
      const d = close.facts.runs - lock.facts.runs;
      return RESOLVED(d > paceLine(lock) ? 'over' : 'under');
    },
  },
];

/** Five overs at the rate they have managed so far, rounded to something sayable. */
export function paceLine(lock) {
  const overs = Math.max(1, Number(lock.facts.balls ?? 0) / 6);
  const rate = Number(lock.facts.runs ?? 0) / overs;
  // Before anybody has faced anything there is no rate to go on, so it opens
  // at a middling one rather than at zero — a line of nought is not a bet.
  const per5 = (Number.isFinite(rate) && rate > 0 ? rate : 7) * 5;
  return Math.max(5, Math.round(per5));
}

export const BOOKS = { football: FOOTBALL, cricket: CRICKET };

/** The market list for a sport, demo feeds included. */
export const bookFor = (sport) => BOOKS[String(sport).replace(/^demo-/, '')] ?? FOOTBALL;

/** A market by id, whichever book it is in. */
export const marketById = (id) =>
  [...FOOTBALL, ...CRICKET].find((m) => m.id === id) ?? null;

/** The outcomes for a market, which some of them work out from the match. */
export const outsFor = (market, lock) =>
  typeof market.outs === 'function' ? market.outs(lock) : market.outs;
