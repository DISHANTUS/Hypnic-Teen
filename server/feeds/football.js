// Football, from API-Football.
//
// One call per poll, and that constraint shaped the markets rather than the
// other way round. The free key allows about a hundred calls a day and a match
// lasts ninety minutes, so the budget is roughly one poll a minute for one
// match — and the fixtures endpoint alone carries everything a market here
// needs: the clock, and the goals for each side separately.
//
// Cards and substitutions live on a second endpoint. Asking for them would
// double every poll and put a single match over the day's allowance, so there
// are no card markets. That is a deliberate trade, not an oversight: five
// markets that always resolve beat seven that stop resolving at half time.
//
// The mapping below follows API-Football's published v3 shape and has never met
// the live service — there is no key on this machine and no match to point it
// at. It is read defensively throughout, and everything the table does with a
// snapshot is tested against the scripted feed instead.

import { registerFeed, getJson } from './index.js';

const HOST = 'https://v3.football.api-sports.io';
const key = () => process.env.API_FOOTBALL_KEY ?? '';

let calls = 0;
const head = () => ({ 'x-apisports-key': key() });
const rows = (data) => (Array.isArray(data?.response) ? data.response : []);

/** Over, abandoned, postponed — anything that will never advance again. */
const FINISHED = new Set(['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AWD', 'WO']);

export const football = registerFeed({
  sport: 'football',
  get ready() { return Boolean(key()); },
  why: 'no API_FOOTBALL_KEY — a free one comes from dashboard.api-football.com',
  calls: () => calls,

  async list() {
    if (!key()) return [];
    calls += 1;
    const { data, error } = await getJson(`${HOST}/fixtures?live=all`, { headers: head() });
    if (error) return [];
    return rows(data).map((r) => ({
      id: String(r?.fixture?.id ?? ''),
      name: `${r?.teams?.home?.name ?? 'Home'} vs ${r?.teams?.away?.name ?? 'Away'}`,
      status: 'live',
      startsAt: r?.fixture?.timestamp ? r.fixture.timestamp * 1000 : null,
    })).filter((m) => m.id);
  },

  async snapshot(matchId) {
    if (!key()) return null;
    calls += 1;
    const { data, error } = await getJson(
      `${HOST}/fixtures?id=${encodeURIComponent(matchId)}`, { headers: head() }
    );
    if (error) return null;
    const row = rows(data)[0];
    if (!row) return null;

    const short = String(row?.fixture?.status?.short ?? 'NS');
    // Stoppage time is added on so the clock never goes backwards between
    // polls — a market whose window straddles 45' would otherwise close early.
    const elapsed = Number(row?.fixture?.status?.elapsed ?? 0) + Number(row?.fixture?.status?.extra ?? 0);

    return {
      matchId: String(matchId),
      name: `${row?.teams?.home?.name ?? 'Home'} vs ${row?.teams?.away?.name ?? 'Away'}`,
      status: short === 'NS' ? 'upcoming' : FINISHED.has(short) ? 'done' : 'live',
      clock: elapsed,
      clockLabel: `${elapsed}'`,
      facts: {
        home: String(row?.teams?.home?.name ?? 'Home'),
        away: String(row?.teams?.away?.name ?? 'Away'),
        homeGoals: Number(row?.goals?.home ?? 0),
        awayGoals: Number(row?.goals?.away ?? 0),
      },
      at: Date.now(),
    };
  },
});
