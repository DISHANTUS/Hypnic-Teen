// Where the results come from.
//
// The betting table does not know what a football is. It asks a feed for a
// snapshot of the match, hands two snapshots to a market, and the market says
// which outcome happened between them. Everything sport-shaped lives behind
// that one interface, so a table works the same whether the numbers came from
// the internet, from a recording, or from a script written for a test.
//
// The reason it is two snapshots rather than a stream of events is request
// budget. Free tiers here are around a hundred calls a day, and a match lasts
// ninety minutes — so a table that polled every few seconds would be locked out
// before half time. One poll a minute or two, and every market resolved by
// subtracting the snapshot at lock from the snapshot at close, fits inside that
// with room to spare and needs nothing to be remembered between calls.
//
// A snapshot is cumulative on purpose. "Goals so far" subtracts into "goals in
// that window" without the feed having to be reliable about ordering, arriving
// once, or arriving at all — a missed poll costs precision, not correctness.

/**
 * @typedef {object} Snapshot
 * @property {string}  matchId
 * @property {string}  name        as people say it — "India vs Australia"
 * @property {'upcoming'|'live'|'done'} status
 * @property {number}  clock       the match's own clock, not the wall's: minutes
 *                                 for football, balls bowled for cricket
 * @property {string}  clockLabel  how to say it — "34'" or "12.3 ov"
 * @property {object}  facts       cumulative totals, per sport
 * @property {number}  at          when this was taken, ms
 */

/**
 * @typedef {object} Feed
 * @property {string} sport
 * @property {() => Promise<Array<{id:string,name:string,status:string,startsAt:?number}>>} list
 * @property {(matchId: string) => Promise<Snapshot|null>} snapshot
 * @property {boolean} ready        false when there is no key, so the room can
 *                                  be told why rather than just failing
 * @property {string}  [why]        what is missing, in words
 */

const FEEDS = new Map();

export function registerFeed(feed) {
  FEEDS.set(feed.sport, feed);
  return feed;
}

export const feedFor = (sport) => FEEDS.get(sport) ?? null;
export const feedsReady = () => [...FEEDS.values()].filter((f) => f.ready).map((f) => f.sport);
export const allFeeds = () => [...FEEDS.values()];

/**
 * A tiny cache in front of a feed.
 *
 * Several markets in flight at once all want to know the state of the same
 * match at the same moment, and each of them asking separately would multiply
 * the request count by however many are open. They share one answer instead,
 * for as long as it is fresh enough to be the same answer.
 */
export function cached(feed, ttlMs) {
  const held = new Map();
  return {
    ...feed,
    /**
     * @param {string} matchId
     * @param {object} [opts]
     * @param {boolean} [opts.fresh] refuse to answer from memory, and refuse to
     *        answer at all if the fetch fails
     *
     * The two callers want opposite things from a failed poll, and giving them
     * both the same answer was a real bug.
     *
     * Closing a window off a slightly stale snapshot is harmless: the clock on
     * it is only ever behind, so the window waits rather than resolving early.
     * Holding the last good answer is the right call there.
     *
     * Opening one is the opposite. A baseline from a minute ago puts a minute
     * of already-televised play inside the window — the room saw the goal, the
     * table did not, and it pays out as though the bet had been fair. So a
     * caller that is starting a market says so, and would rather have nothing.
     */
    async snapshot(matchId, { fresh = false } = {}) {
      const now = Date.now();
      const have = held.get(matchId);
      if (!fresh && have && now - have.at < ttlMs) return have.snap;
      const snap = await feed.snapshot(matchId);
      if (snap) held.set(matchId, { at: now, snap });
      if (fresh) return snap ?? null;
      return snap ?? have?.snap ?? null;
    },
    /** For tests and for the request-count line in the lobby. */
    calls: () => feed.calls?.() ?? 0,
  };
}

/** Ask for a thing and give up rather than hang the game loop on it. */
export async function getJson(url, { headers = {}, timeoutMs = 8000 } = {}) {
  const stop = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: stop });
    if (!res.ok) return { error: `${res.status} ${res.statusText}` };
    return { data: await res.json() };
  } catch (err) {
    return { error: err?.name === 'TimeoutError' ? 'timed out' : String(err?.message ?? err) };
  }
}
