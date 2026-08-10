// A match that never was.
//
// The two real feeds cannot be tested here: they need a key this machine does
// not have and a fixture that is actually being played. So the engine is tested
// against this instead — a scripted match that advances on demand, scores when
// it is told to, and can be made to stall, end early or return nothing at all.
//
// It is also what the table falls back to when somebody wants to see how the
// game works and there is no key yet. That is worth being loud about: chips
// staked on a demo match are still real chips, so the table says so on every
// screen rather than letting a room find out afterwards.

import { registerFeed } from './index.js';

/**
 * @param {object} opts
 * @param {'football'|'cricket'} opts.sport
 * @param {number} [opts.perTick]  how much clock one advance() adds
 */
export function scriptedFeed({ sport = 'football', perTick = 1 } = {}) {
  const state = {
    clock: 0,
    status: 'live',
    /** Set to make the next snapshot fail, the way a flaky network does. */
    broken: false,
    facts: sport === 'football'
      ? { home: 'Rovers', away: 'Athletic', homeGoals: 0, awayGoals: 0 }
      : { runs: 0, wickets: 0, balls: 0, overs: 0, inningsNo: 1, inningsKey: '1:first' },
  };

  const feed = {
    sport,
    ready: true,
    why: '',
    calls: () => feed._calls,
    _calls: 0,

    async list() {
      return [{ id: 'demo', name: sport === 'football' ? 'Rovers vs Athletic' : 'Rest vs World', status: state.status, startsAt: null }];
    },

    async snapshot() {
      feed._calls += 1;
      if (state.broken) return null;
      return {
        matchId: 'demo',
        name: sport === 'football' ? 'Rovers vs Athletic' : 'Rest vs World',
        status: state.status,
        clock: state.clock,
        clockLabel: sport === 'football'
          ? `${state.clock}'`
          : `${Math.floor(state.clock / 6)}.${state.clock % 6} ov`,
        facts: { ...state.facts },
        at: Date.now(),
      };
    },

    /* ---- the script ---- */

    /** Move the match on. */
    advance(by = perTick) {
      state.clock += by;
      if (sport === 'cricket') {
        state.facts.balls = state.clock;
        state.facts.overs = Math.floor(state.clock / 6);
      }
      return feed;
    },
    goal(side = 'home') {
      if (side === 'home') state.facts.homeGoals += 1;
      else state.facts.awayGoals += 1;
      return feed;
    },
    runs(n) { state.facts.runs += n; return feed; },
    wicket(n = 1) { state.facts.wickets += n; return feed; },
    /** The score going backwards, which is what an innings break looks like. */
    newInnings() {
      state.facts.inningsNo += 1;
      state.facts.inningsKey = `${state.facts.inningsNo}:second`;
      state.facts.runs = 0;
      state.facts.wickets = 0;
      return feed;
    },
    finish() { state.status = 'done'; return feed; },
    breakIt(on = true) { state.broken = on; return feed; },
    at: () => state.clock,
  };

  return feed;
}

/**
 * The demo match, which plays itself.
 *
 * The scripted feed above only moves when a test tells it to, which is right
 * for a test and useless for a person: somebody trying the table with no key
 * would sit in front of a frozen scoreboard while every market they backed
 * timed out into a void. So this one runs off the wall clock instead, a match
 * minute a second, with goals at fixed minutes.
 *
 * Fixed rather than random on purpose. A demo whose results cannot be
 * predicted is indistinguishable from a demo that is making them up, and the
 * whole point of this table is that nobody is making them up.
 */
function selfPlaying({ sport, goalsAt = [], wicketsAt = [] }) {
  // Kick-off is carried in the match id rather than held here, so every room
  // gets its own match. The first version stamped it when the module loaded,
  // which meant the second room of the evening joined a game that had been
  // going for four hundred minutes and had therefore already finished.
  const kickedOff = (matchId) => {
    const at = Number(String(matchId ?? '').split(':')[1]);
    return Number.isFinite(at) ? at : Date.now();
  };
  const clockOf = (matchId) => Math.floor((Date.now() - kickedOff(matchId)) / 1000);
  let calls = 0;

  return {
    sport: `demo-${sport}`,
    ready: true,
    why: '',
    calls: () => calls,
    async list() {
      return [{
        id: `demo:${Date.now()}`,
        name: sport === 'football' ? 'Rovers vs Athletic (demo)' : 'Rest vs World (demo)',
        status: 'live', startsAt: null,
      }];
    },
    async snapshot(matchId) {
      calls += 1;
      const clock = clockOf(matchId);
      const scored = goalsAt.filter((m) => m <= clock);
      const out = wicketsAt.filter((b) => b <= clock);
      return {
        matchId: String(matchId ?? 'demo'),
        name: sport === 'football' ? 'Rovers vs Athletic (demo)' : 'Rest vs World (demo)',
        status: clock > (sport === 'football' ? 95 : 130) ? 'done' : 'live',
        clock,
        clockLabel: sport === 'football' ? `${clock}'` : `${Math.floor(clock / 6)}.${clock % 6} ov`,
        facts: sport === 'football'
          ? {
              home: 'Rovers', away: 'Athletic',
              homeGoals: scored.filter((_, i) => i % 2 === 0).length,
              awayGoals: scored.filter((_, i) => i % 2 === 1).length,
            }
          : {
              // Runs climb steadily so a pace market has something to be
              // measured against, rather than arriving in one lump.
              runs: Math.round(clock * 1.3),
              wickets: out.length,
              balls: clock,
              overs: Math.floor(clock / 6),
              inningsNo: 1,
              inningsKey: '1:first',
            },
        at: Date.now(),
      };
    },
  };
}

export const demoFootball = registerFeed(selfPlaying({ sport: 'football', goalsAt: [7, 19, 34, 52, 68, 81] }));
export const demoCricket = registerFeed(selfPlaying({ sport: 'cricket', wicketsAt: [22, 51, 79, 104, 121] }));
