// Memory.
//
// A grid of cards face down. Turn two. A pair stays up and you go again; a miss
// turns them back and the turn moves on.
//
// Nobody holds a hand in this one, which makes it the only game in the room
// where the *table* is the secret rather than anybody's cards. That changes
// where the care goes: the grid is public, and what must never be sent is what
// is printed on a face-down square. So the wire carries a slot's identity and
// nothing else until it is turned over, and a square that gets turned back over
// on a miss goes back to carrying nothing.
//
// The miss is on a timer rather than on the next tap, and that is the whole
// game. Everybody has to be given the same second and a half to see what was
// under those two squares — it is the only information anybody gets, and taking
// it away faster for people on slower connections would be the same as dealing
// them a worse hand.

import { createCardGame, shuffle, freshDeck, nextSeat, passTurn, inPlay, rankOf, sayCard } from './kit.js';

/** How long a miss stays visible. Everybody's chance to remember it. */
const LOOK = 1.8;

export const memory = createCardGame({
  id: 'memory',
  name: 'Memory',
  tagline: 'Turn two. Remember everything. Most pairs wins.',
  emoji: '🧠',
  accent: '#2980b9',
  face: 'memory',
  minPlayers: 1,
  maxPlayers: 8,
  hands: 2,
  turnSeconds: 20,

  howToPlay: [
    'The cards are face down in a grid. On your turn, turn two of them over.',
    'A matching pair stays up and you go again.',
    'A miss turns back over — but everybody gets a moment to see it first.',
    'Watch what other people turn over. That is the whole game.',
    'Most pairs when the grid is empty wins.',
  ],

  options: {
    pairs: { label: 'Pairs on the table', kind: 'number', min: 6, max: 26, hardMax: 26, step: 2, default: 12 },
  },
  settings: (s) => ({ pairs: Math.max(6, Math.min(26, Number(s.pairs) || 12)) }),

  init(state) {
    state.grid = [];       // { card, up, gone }
    state.turned = [];     // indexes turned this go
    state.looking = 0;     // seconds left of a miss being shown
    state.pairsBy = {};
  },

  deal(state) {
    // Ranks, doubled. Suits do not matter here, so a pair is two of a rank —
    // which lets the grid be any even size rather than only a whole pack.
    const pack = shuffle(freshDeck()).slice(0, state.settings.pairs);
    const cards = shuffle([...pack, ...pack.map((c) => `${rankOf(c)}${c[1] === 's' ? 'h' : 's'}`)]);
    state.grid = cards.map((card) => ({ card, up: false, gone: false }));
    state.turned = [];
    state.looking = 0;
    state.pairsBy = Object.fromEntries(state.seats.map((s) => [s.seat, 0]));
    state.deck = [];
    state.turn = 0;
    state.said = 'Turn two.';
  },

  act(state, seat, action) {
    if (action.type !== 'turn') return;
    if (state.seats[state.turn]?.id !== seat.id || seat.out) return;
    // Nothing may be turned while a miss is still being shown — otherwise a
    // fast tap would rob the rest of the table of their look at it.
    if (state.looking > 0) return;
    if (state.turned.length >= 2) return;

    const at = Math.floor(Number(action.at));
    const slot = state.grid[at];
    if (!slot || slot.gone || slot.up) return;

    slot.up = true;
    state.turned.push(at);
    state.dirty = true;

    if (state.turned.length < 2) {
      state.said = `${seat.name} turns one.`;
      return;
    }

    const [a, b] = state.turned.map((i) => state.grid[i]);
    if (rankOf(a.card) === rankOf(b.card)) {
      a.gone = true;
      b.gone = true;
      state.pairsBy[seat.seat] = (state.pairsBy[seat.seat] ?? 0) + 1;
      state.turned = [];
      state.said = `${seat.name} pairs the ${rankOf(a.card)}s — go again.`;
      state.turnLeft = state.settings.turnSeconds;
      return;
    }

    // A miss. Both stay up for a moment, for everybody.
    state.looking = LOOK;
    state.said = `${sayCard(a.card)} and ${sayCard(b.card)}. No.`;
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat) return;
    const free = state.grid.map((s, i) => (!s.gone && !s.up ? i : -1)).filter((i) => i >= 0);
    if (!free.length) return;
    state.log.push(`${seat.name} was away — turned one.`);
    memory.__spec.act(state, seat, { type: 'turn', at: free[Math.floor(Math.random() * free.length)] });
  },

  tick(state, dt) {
    if (state.looking <= 0) return;
    state.looking -= dt;
    if (state.looking > 0) return;
    for (const i of state.turned) {
      const slot = state.grid[i];
      if (slot && !slot.gone) slot.up = false;
    }
    state.turned = [];
    passTurn(state);
  },

  handOver: (state) => state.grid.length > 0 && state.grid.every((s) => s.gone),

  scoreHand(state) {
    const counts = state.seats.map((s) => state.pairsBy[s.seat] ?? 0);
    const best = Math.max(0, ...counts);
    for (const s of state.seats) {
      const mine = state.pairsBy[s.seat] ?? 0;
      s.score += mine * 2;
      if (mine === best && best > 0) { s.score += 3; s.won += 1; }
    }
    const winners = state.seats.filter((s) => (state.pairsBy[s.seat] ?? 0) === best && best > 0);
    state.said = winners.length
      ? `${winners.map((s) => s.name).join(' and ')} with ${best} pair${best === 1 ? '' : 's'}.`
      : 'No pairs at all.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      // A face-down square carries its position and nothing else. What is
      // printed on it does not go on the wire until it is turned over.
      grid: state.grid.map((slot, i) => ({
        at: i,
        gone: slot.gone,
        card: slot.up || slot.gone ? slot.card : null,
      })),
      turned: state.turned,
      looking: Math.max(0, Math.round(state.looking * 10) / 10),
      pairsBy: state.seats.map((s) => ({
        seat: s.seat, name: s.name, pairs: state.pairsBy[s.seat] ?? 0,
      })),
      columns: state.grid.length <= 16 ? 4 : state.grid.length <= 30 ? 5 : 6,
    };
  },

  mine(state, seat) {
    return { turnedThisGo: state.turned.length, waiting: state.looking > 0, seatNo: seat?.seat ?? -1 };
  },
});

void inPlay;
void nextSeat;

export default memory;
