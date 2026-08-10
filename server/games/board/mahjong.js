// Mahjong, Hong Kong rules.
//
// There are several mahjong scoring systems and they are not small differences.
// Riichi is the one most people meet online and it carries riichi declarations,
// dora indicators, furiten, and a yaku table you have to know before you can
// win at all — which is a wonderful game and a terrible first game. Chinese
// Classical wants flower bonuses and a doubling table. Hong Kong asks one
// question — four sets and a pair — and scores in faan, which a table can pick
// up in a hand and a half.
//
// So this is Hong Kong, and it is Hong Kong because the room this is for is
// four friends who have mostly not played before. The alternative was a game
// where a beginner can complete a hand and be told it does not count.
//
// The part worth being careful about is the claiming. When somebody discards, up
// to three other players may want it, and they want it at the same time. That
// cannot be resolved first-come-first-served — the rules say a pung outranks a
// chow and a win outranks both, regardless of who shouted first. So a discard
// opens a short window, every claim is collected, and the window is settled by
// rank rather than by arrival. A fast connection must not beat the rules.

import { createBoardGame, inPlay, passTurn } from './kit.js';

/* --------------------------------- the tiles ------------------------------- */

/**
 * The three suits, and why dots are 'o'.
 *
 * The obvious letters are b, c, d for bamboo, characters and dots — and 'd' is
 * also the natural letter for dragons, which is exactly the collision that bit.
 * A dragon tile 'dR' was read as a dot numbered R, which is NaN, and because
 * the suit test only looked at the first letter a dragon also counted as
 * suited — so it was eligible to be part of a run. Dots are 'o' for circles,
 * which is what the tiles actually look like, and nothing overlaps.
 */
const SUITS = ['b', 'c', 'o'];             // bamboo, characters, dots (circles)
const WINDS = ['E', 'S', 'W', 'N'];
const DRAGONS = ['R', 'G', 'W'];           // red, green, white

/** A hundred and forty-four tiles: three suits, winds, dragons, flowers. */
export function freshWall() {
  const tiles = [];
  for (const s of SUITS) {
    for (let n = 1; n <= 9; n++) for (let i = 0; i < 4; i++) tiles.push(`${s}${n}`);
  }
  for (const w of WINDS) for (let i = 0; i < 4; i++) tiles.push(`w${w}`);
  for (const d of DRAGONS) for (let i = 0; i < 4; i++) tiles.push(`d${d}`);
  // Flowers and seasons: eight tiles, one of each, set aside when drawn and
  // replaced. They are bonus tiles, never part of a set.
  for (let i = 1; i <= 4; i++) tiles.push(`f${i}`);
  for (let i = 1; i <= 4; i++) tiles.push(`s${i}`);
  return tiles;
}

const isBonus = (t) => t[0] === 'f' || t[0] === 's';
const isSuited = (t) => SUITS.includes(t[0]);
const suitOf = (t) => t[0];
const numOf = (t) => Number(t[1]);

const shuffle = (list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const counts = (tiles) => {
  const by = new Map();
  for (const t of tiles) by.set(t, (by.get(t) ?? 0) + 1);
  return by;
};

/* ------------------------------- the win test ----------------------------- */

/**
 * Four sets and a pair.
 *
 * Searched rather than pattern-matched, because a hand like 1112345678999 of
 * one suit can be read several ways and only some of them are a win. The search
 * takes the lowest tile left, tries it as a pung and as the start of a chow, and
 * recurses — which is exhaustive and, on fourteen tiles, instant.
 */
export function isWinningHand(tiles, melded = 0) {
  const need = 4 - melded;
  const sorted = [...tiles].filter((t) => !isBonus(t)).sort();
  if (sorted.length !== need * 3 + 2) return false;

  const by = counts(sorted);
  // Try each possible pair.
  for (const [tile, n] of by) {
    if (n < 2) continue;
    const rest = [...sorted];
    rest.splice(rest.indexOf(tile), 1);
    rest.splice(rest.indexOf(tile), 1);
    if (formsSets(rest, need)) return true;
  }
  return false;
}

function formsSets(tiles, need) {
  if (need === 0) return tiles.length === 0;
  if (tiles.length < need * 3) return false;
  const sorted = [...tiles].sort();
  const first = sorted[0];

  // As a pung.
  const same = sorted.filter((t) => t === first).length;
  if (same >= 3) {
    const rest = [...sorted];
    for (let i = 0; i < 3; i++) rest.splice(rest.indexOf(first), 1);
    if (formsSets(rest, need - 1)) return true;
  }
  // As a chow — suited tiles only, and never across a suit boundary.
  if (isSuited(first) && numOf(first) <= 7) {
    const a = `${suitOf(first)}${numOf(first) + 1}`;
    const b = `${suitOf(first)}${numOf(first) + 2}`;
    if (sorted.includes(a) && sorted.includes(b)) {
      const rest = [...sorted];
      rest.splice(rest.indexOf(first), 1);
      rest.splice(rest.indexOf(a), 1);
      rest.splice(rest.indexOf(b), 1);
      if (formsSets(rest, need - 1)) return true;
    }
  }
  return false;
}

/** What a hand is worth, in faan. Hong Kong's short list, honestly short. */
export function scoreHand(hand, melds, seatWind) {
  const all = [...hand, ...melds.flatMap((m) => m.tiles)].filter((t) => !isBonus(t));
  let faan = 0;
  const why = [];

  // All one suit, no honours.
  const suits = new Set(all.filter(isSuited).map(suitOf));
  const honours = all.filter((t) => !isSuited(t));
  if (suits.size === 1 && honours.length === 0) { faan += 6; why.push('all one suit'); }
  else if (suits.size === 1) { faan += 3; why.push('one suit with honours'); }

  // All pungs — no chows anywhere.
  if (melds.every((m) => m.kind !== 'chow')) { faan += 3; why.push('all pungs'); }

  // Dragon pungs, and a pung of your own wind.
  for (const m of melds) {
    if (m.kind === 'chow') continue;
    const t = m.tiles[0];
    if (t[0] === 'd') { faan += 1; why.push('a dragon pung'); }
    if (t === `w${seatWind}`) { faan += 1; why.push('your own wind'); }
  }

  // A hand nobody has claimed from.
  if (!melds.some((m) => m.claimed)) { faan += 1; why.push('concealed'); }

  return { faan: Math.max(1, faan), why };
}

/* ---------------------------------- the game ------------------------------- */

/** How long a discard stays claimable. */
const CLAIM_WINDOW = 5;
/** A win beats a pung beats a chow, whoever shouted first. */
const RANK = { win: 3, pung: 2, chow: 1 };

export const mahjong = createBoardGame({
  id: 'mahjong',
  name: 'Mahjong',
  tagline: 'Hong Kong rules. Four sets and a pair — and a race to claim the discard.',
  emoji: '🀄',
  accent: '#2e8b57',
  face: 'mahjong',
  minPlayers: 4,
  maxPlayers: 4,
  turnSeconds: 30,

  howToPlay: [
    'A hundred and forty-four tiles. Thirteen each, and you draw one and throw one away on your turn.',
    'You want four sets and a pair. A set is three of a kind, or three in a row in one suit.',
    'When somebody throws a tile away, anybody may claim it — but a pung beats a chow, and a win beats both.',
    'A chow can only be claimed from the player on your left. A pung from anyone.',
    'Flowers and seasons are bonus tiles. They set themselves aside and you draw again.',
    'Say mahjong when your hand is complete. Scoring is in faan, and the short Hong Kong list.',
  ],

  init(state) {
    state.wall = [];
    state.hands = {};
    state.melds = {};
    state.bonus = {};
    state.discards = [];
    state.lastDiscard = null;
    state.claims = [];
    state.claimWindow = 0;
    state.result = null;
  },

  setUp(state) {
    state.wall = shuffle(freshWall());
    state.hands = {};
    state.melds = {};
    state.bonus = {};
    state.discards = [];
    state.lastDiscard = null;
    state.claims = [];
    state.claimWindow = 0;
    state.result = null;

    for (const seat of state.seats) {
      state.hands[seat.seat] = state.wall.splice(0, 13);
      state.melds[seat.seat] = [];
      state.bonus[seat.seat] = [];
      seat.wind = WINDS[seat.seat % 4];
      // Bonus tiles set themselves aside immediately and are replaced.
      clearBonus(state, seat.seat);
    }
    // East starts with fourteen and throws one away.
    state.turn = 0;
    draw(state, 0);
    state.said = 'East throws one away.';
  },

  act(state, seat, action) {
    if (state.result) return;

    if (action.type === 'discard') {
      if (state.seats[state.turn]?.id !== seat.id) return;
      if (state.claimWindow > 0) return;
      const hand = state.hands[seat.seat];
      const tile = String(action.tile ?? '');
      const at = hand.indexOf(tile);
      if (at < 0) return;
      // Only ever with fourteen in hand — otherwise a player could throw twice.
      if (hand.length + state.melds[seat.seat].length * 3 !== 14) return;

      hand.splice(at, 1);
      state.discards.push({ seat: seat.seat, tile });
      state.lastDiscard = { seat: seat.seat, tile };
      state.claims = [];
      state.claimWindow = CLAIM_WINDOW;
      state.said = `${seat.name} throws the ${say(tile)}.`;
      state.dirty = true;
      return;
    }

    if (action.type === 'claim') {
      if (!state.lastDiscard || state.claimWindow <= 0) return;
      if (state.lastDiscard.seat === seat.seat) return;
      const kind = ['win', 'pung', 'chow'].includes(action.kind) ? action.kind : null;
      if (!kind) return;
      if (state.claims.some((c) => c.seat === seat.seat)) return;
      if (!canClaim(state, seat, kind, action.with)) return;
      // Collected, not acted on. The window is settled by rank when it closes,
      // so a fast connection cannot beat the rules.
      state.claims.push({ seat: seat.seat, kind, with: action.with ?? null });
      state.said = `${seat.name} calls ${kind}.`;
      state.dirty = true;
      return;
    }

    if (action.type === 'pass') {
      if (!state.lastDiscard) return;
      // Passing is only ever information — the window still runs its course.
      state.dirty = true;
      return;
    }

    if (action.type === 'mahjong') {
      if (state.seats[state.turn]?.id !== seat.id) return;
      const hand = state.hands[seat.seat];
      if (!isWinningHand(hand, state.melds[seat.seat].length)) return;
      declareWin(state, seat, 'drawn');
    }
  },

  tick(state, dt) {
    if (state.result || state.claimWindow <= 0) return;
    state.claimWindow -= dt;
    if (state.claimWindow > 0) return;
    settleClaims(state);
  },

  timedOut(state) {
    if (state.result || state.claimWindow > 0) return;
    const seat = state.seats[state.turn];
    if (!seat) return;
    const hand = state.hands[seat.seat];
    if (hand.length + state.melds[seat.seat].length * 3 === 14) {
      state.log.push(`${seat.name} was away — a tile was thrown for them.`);
      mahjong.__spec.act(state, seat, { type: 'discard', tile: hand[hand.length - 1] });
    }
  },

  isDone: (state) => Boolean(state.result) || (state.wall.length === 0 && !state.lastDiscard),

  table(state) {
    return {
      wallLeft: state.wall.length,
      discards: state.discards.slice(-24),
      lastDiscard: state.lastDiscard,
      claimWindow: Math.max(0, Math.round(state.claimWindow * 10) / 10),
      claims: state.claims.map((c) => ({ seat: c.seat, kind: c.kind })),
      result: state.result,
      // Counts and melds, never anybody's hand. A mahjong hand is the only
      // secret in this room and it is the whole game.
      players: state.seats.map((s) => ({
        seat: s.seat, name: s.name, wind: s.wind,
        tiles: (state.hands[s.seat] ?? []).length,
        melds: state.melds[s.seat] ?? [],
        bonus: state.bonus[s.seat] ?? [],
      })),
    };
  },

  mine(state, seat) {
    if (!seat) return { hand: [] };
    const hand = state.hands[seat.seat] ?? [];
    const melded = (state.melds[seat.seat] ?? []).length;
    return {
      hand: [...hand].sort(),
      melds: state.melds[seat.seat] ?? [],
      bonus: state.bonus[seat.seat] ?? [],
      wind: seat.wind,
      canDiscard: state.seats[state.turn]?.id === seat.id
        && state.claimWindow <= 0
        && hand.length + melded * 3 === 14,
      canWin: isWinningHand(hand, melded),
      // What you could claim off the tile just thrown, worked out here so the
      // buttons offered are exactly the claims the server would accept.
      claims: state.lastDiscard && state.claimWindow > 0 && state.lastDiscard.seat !== seat.seat
        ? ['win', 'pung', 'chow'].filter((k) => canClaim(state, seat, k, null))
        : [],
    };
  },

  rank: (a, b) => b.score - a.score,
});

/* -------------------------------- the workings ----------------------------- */

const say = (t) => {
  if (t[0] === 'w') return `${{ E: 'east', S: 'south', W: 'west', N: 'north' }[t[1]]} wind`;
  if (t[0] === 'd') return `${{ R: 'red', G: 'green', W: 'white' }[t[1]]} dragon`;
  if (t[0] === 'f') return `flower ${t[1]}`;
  if (t[0] === 's') return `season ${t[1]}`;
  return `${numOf(t)} of ${{ b: 'bamboo', c: 'characters', o: 'dots' }[suitOf(t)]}`;
};

/** Draw one, replacing bonus tiles as they come. */
function draw(state, seatNo) {
  if (!state.wall.length) return null;
  const tile = state.wall.shift();
  state.hands[seatNo].push(tile);
  clearBonus(state, seatNo);
  return tile;
}

/** Flowers and seasons set themselves aside and are replaced from the wall. */
function clearBonus(state, seatNo) {
  let guard = 0;
  while (guard++ < 20) {
    const hand = state.hands[seatNo];
    const at = hand.findIndex(isBonus);
    if (at < 0) return;
    state.bonus[seatNo].push(hand.splice(at, 1)[0]);
    if (!state.wall.length) return;
    hand.push(state.wall.pop());
  }
}

/** Could this seat make that claim off the tile just thrown? */
function canClaim(state, seat, kind, withTiles) {
  const d = state.lastDiscard;
  if (!d) return false;
  const hand = state.hands[seat.seat] ?? [];
  const melded = (state.melds[seat.seat] ?? []).length;

  if (kind === 'win') return isWinningHand([...hand, d.tile], melded);
  if (kind === 'pung') return hand.filter((t) => t === d.tile).length >= 2;
  if (kind === 'chow') {
    // Only from the player on your left, and only with suited tiles.
    const left = (d.seat + 1) % state.seats.length;
    if (left !== seat.seat) return false;
    if (!isSuited(d.tile)) return false;
    const n = numOf(d.tile);
    const s = suitOf(d.tile);
    const has = (x) => hand.includes(`${s}${x}`);
    if (withTiles?.length === 2) return withTiles.every((t) => hand.includes(t));
    return (has(n - 2) && has(n - 1)) || (has(n - 1) && has(n + 1)) || (has(n + 1) && has(n + 2));
  }
  return false;
}

/**
 * The window shuts. Settle by rank, not by who was fastest.
 *
 * This is the one place where being first genuinely must not matter — a pung
 * outranks a chow and a win outranks both, and a table where the quickest
 * connection took the tile would be a table where the rules are advisory.
 */
function settleClaims(state) {
  const d = state.lastDiscard;
  state.claimWindow = 0;
  if (!d) return;

  if (!state.claims.length) {
    state.lastDiscard = null;
    const next = (d.seat + 1) % state.seats.length;
    const seat = state.seats[next];
    if (!draw(state, next)) { state.result = { result: 'draw', why: 'the wall ran out' }; state.dirty = true; return; }
    passTurn(state, next);
    state.said = `${seat.name} draws.`;
    return;
  }

  const best = [...state.claims].sort((a, b) => RANK[b.kind] - RANK[a.kind])[0];
  const seat = state.seats.find((s) => s.seat === best.seat);
  const hand = state.hands[best.seat];

  if (best.kind === 'win') { declareWin(state, seat, 'claimed', d.tile); return; }

  if (best.kind === 'pung') {
    hand.splice(hand.indexOf(d.tile), 1);
    hand.splice(hand.indexOf(d.tile), 1);
    state.melds[best.seat].push({ kind: 'pung', tiles: [d.tile, d.tile, d.tile], claimed: true });
  } else {
    const n = numOf(d.tile);
    const s = suitOf(d.tile);
    const pick = [[n - 2, n - 1], [n - 1, n + 1], [n + 1, n + 2]]
      .map((pair) => pair.map((x) => `${s}${x}`))
      .find((pair) => pair.every((t) => hand.includes(t)));
    if (!pick) { state.lastDiscard = null; return; }
    for (const t of pick) hand.splice(hand.indexOf(t), 1);
    state.melds[best.seat].push({ kind: 'chow', tiles: [...pick, d.tile].sort(), claimed: true });
  }

  // The claimer takes the tile and the turn, and now owes a discard.
  state.discards.pop();
  state.lastDiscard = null;
  state.claims = [];
  state.said = `${seat.name} takes the ${say(d.tile)}.`;
  state.log.push(state.said);
  passTurn(state, best.seat);
}

function declareWin(state, seat, how, tile = null) {
  const hand = tile ? [...state.hands[seat.seat], tile] : state.hands[seat.seat];
  const score = scoreHand(hand, state.melds[seat.seat] ?? [], seat.wind);
  state.result = { result: seat.name, why: score.why.join(', ') || 'a complete hand', faan: score.faan, how };
  seat.score = score.faan * 10;
  seat.won = 1;
  state.said = `${seat.name} declares mahjong — ${score.faan} faan${score.why.length ? ` (${score.why.join(', ')})` : ''}.`;
  state.log.push(state.said);
  state.dirty = true;
}

void inPlay;

export default mahjong;
