// Cricket, from CricketData (the old CricAPI).
//
// One call per poll: the match info carries the score, the overs and the
// wickets, which is everything the markets here need. Ball-by-ball exists on
// that service too, but a market that turns on a single delivery cannot be
// asked far enough ahead to be fair — by the time the room has read the
// question the ball has been bowled. So the markets are over-shaped, and an
// over's worth of runs is a subtraction between two polls.
//
// Same caveat as the football feed: the mapping below follows the published
// v1 shape and has never met the live service, because there is no key on this
// machine. Read defensively throughout, and everything downstream of a snapshot
// is tested against the scripted feed.

import { registerFeed, getJson } from './index.js';

const HOST = 'https://api.cricapi.com/v1';
const key = () => process.env.CRICKET_API_KEY ?? '';

let calls = 0;

/** "142/3" and "17.4" arrive as separate fields; both are read loosely. */
const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Overs come as 17.4 meaning seventeen overs and four balls, not 17.4 overs. */
export function ballsFromOvers(overs) {
  const n = num(overs, 0);
  const whole = Math.floor(n);
  // Rounded because 17.4 is not exactly representable and floor() of the
  // fraction times ten can land on 3.
  const balls = Math.round((n - whole) * 10);
  return whole * 6 + Math.min(5, Math.max(0, balls));
}

export const cricket = registerFeed({
  sport: 'cricket',
  get ready() { return Boolean(key()); },
  why: 'no CRICKET_API_KEY — get a free one at cricketdata.org',
  calls: () => calls,

  async list() {
    if (!key()) return [];
    calls += 1;
    const { data, error } = await getJson(`${HOST}/currentMatches?apikey=${encodeURIComponent(key())}&offset=0`);
    if (error) return [];
    const rows = Array.isArray(data?.data) ? data.data : [];
    return rows.map((m) => ({
      id: String(m?.id ?? ''),
      name: String(m?.name ?? 'A match'),
      status: m?.matchStarted && !m?.matchEnded ? 'live' : m?.matchEnded ? 'done' : 'upcoming',
      startsAt: m?.dateTimeGMT ? Date.parse(m.dateTimeGMT) : null,
    })).filter((m) => m.id);
  },

  async snapshot(matchId) {
    if (!key()) return null;
    calls += 1;
    const { data, error } = await getJson(
      `${HOST}/match_info?apikey=${encodeURIComponent(key())}&id=${encodeURIComponent(matchId)}`
    );
    if (error) return null;
    const m = data?.data;
    if (!m) return null;

    // The innings in progress is the last one with a score on it.
    const innings = Array.isArray(m?.score) ? m.score : [];
    const now = innings.length ? innings[innings.length - 1] : null;
    const balls = ballsFromOvers(now?.o);
    const overs = Math.floor(balls / 6);

    return {
      matchId: String(matchId),
      name: String(m?.name ?? 'A match'),
      status: m?.matchEnded ? 'done' : m?.matchStarted ? 'live' : 'upcoming',
      clock: balls,
      clockLabel: now ? `${Math.floor(balls / 6)}.${balls % 6} ov` : 'not started',
      facts: {
        runs: num(now?.r),
        wickets: num(now?.w),
        balls,
        overs,
        inningsNo: innings.length,
        // Which innings the runs belong to. A market must not resolve across
        // an innings break, where the score goes backwards to nothing.
        inningsKey: `${innings.length}:${now?.inning ?? ''}`,
      },
      at: Date.now(),
    };
  },
});
