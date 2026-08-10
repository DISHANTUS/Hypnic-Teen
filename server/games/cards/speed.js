// Speed.
//
// No turns. Two piles in the middle, five cards in your hand, and you play
// anything one higher or lower than either pile — as fast as you can find it.
// Empty your hand and your draw pile and you have won.
//
// Like Snap this is decided by when the *server* heard you, never by anything
// the client claims about its own timing. Unlike Snap, two people can be right
// at the same moment on different piles, and that is fine — what must not
// happen is two people being right on the *same* pile. So a play is checked
// against the pile as it is at the instant it arrives, and the second one finds
// a different top card and is simply refused. No locks, no queue, no
// arbitration: the state moved, and the losing move was never legal.
//
// Aces are both ends of the run — an ace goes on a king and a two goes on an
// ace — because a game where the wrap is missing has two dead ends, and dead
// ends in a game with no turns mean everybody stares at a stuck table.

import {
  createCardGame, shuffle, freshDeck, inPlay, goOut, finishOrder,
  rankOf, sayCard, RANKS,
} from './kit.js';

const HAND = 5;
/** How long the table sits stuck before it turns two fresh cards over. */
const STUCK = 4;

const at = (rank) => RANKS.indexOf(rank);

/** The card showing on a middle pile. */
const topOf = (state, i) => state.middle[i]?.[state.middle[i].length - 1] ?? null;

/** One apart, with the ace joining both ends of the run. */
function adjacent(a, b) {
  const x = at(rankOf(a));
  const y = at(rankOf(b));
  const gap = Math.abs(x - y);
  return gap === 1 || gap === RANKS.length - 1;
}

export const speed = createCardGame({
  id: 'speed',
  name: 'Speed',
  tagline: 'No turns. One higher or one lower, as fast as you can see it.',
  emoji: '⚡',
  accent: '#e74c3c',
  face: 'speed',
  minPlayers: 2,
  maxPlayers: 4,
  hands: 1,
  turnSeconds: 0,

  howToPlay: [
    'There are no turns. Everybody plays at once, as fast as they can.',
    'Play any card one higher or one lower than the top of either middle pile.',
    'Aces join both ends — an ace goes on a king, a two goes on an ace.',
    'Your hand tops itself back up to five from your own pile.',
    'When nobody can go, two fresh cards turn over. First to run out of everything wins.',
  ],

  init(state) {
    // Two actual piles, not two top cards. The first version kept only the
    // card on top and overwrote it on every play — which looks identical on
    // screen and quietly destroyed a card per move, so a race that started
    // with fifty-two ended with nine.
    state.middle = [[], []];
    state.stacks = {};     // seat -> their own draw pile
    state.reserve = [[], []];
    state.stuckFor = 0;
    state.finished = [];
    state.lastPlay = null;
  },

  deal(state) {
    // Enough packs that everybody gets a real draw pile. Two players share one
    // pack the traditional way; more than that and one pack is a game over in
    // twenty seconds.
    const packs = state.seats.length > 2 ? 2 : 1;
    let cards = [];
    for (let i = 0; i < packs; i++) cards = cards.concat(freshDeck());
    cards = shuffle(cards);

    const per = Math.floor((cards.length - 4) / state.seats.length);
    state.stacks = {};
    for (const s of state.seats) {
      s.hand = cards.splice(0, HAND);
      state.stacks[s.seat] = cards.splice(0, Math.max(0, per - HAND));
      s.out = false;
    }
    // Two to turn over now, and two held back for when the table sticks.
    state.reserve = [cards.splice(0, Math.ceil(cards.length / 2)), cards];
    state.middle = [
      [state.reserve[0].pop()].filter(Boolean),
      [state.reserve[1].pop()].filter(Boolean),
    ];
    state.deck = [];
    state.stuckFor = 0;
    state.finished = [];
    state.lastPlay = null;
    state.said = 'Go.';
  },

  act(state, seat, action) {
    if (action.type !== 'play' || seat.out) return;
    const card = String(action.card ?? '');
    const which = Number(action.pile);
    if (![0, 1].includes(which)) return;
    if (!seat.hand.includes(card)) return;

    const top = topOf(state, which);
    // Checked against the pile as it is right now. Two people racing for the
    // same pile means the second one is looking at a card that has already
    // been covered, and their move simply is not legal any more.
    if (!top || !adjacent(card, top)) return;

    seat.hand.splice(seat.hand.indexOf(card), 1);
    state.middle[which].push(card);
    state.stuckFor = 0;
    state.lastPlay = { name: seat.name, card, pile: which };
    state.said = `${seat.name} → ${sayCard(card)}`;

    // Top back up to five.
    const mine = state.stacks[seat.seat] ?? [];
    while (seat.hand.length < HAND && mine.length) seat.hand.push(mine.pop());

    if (!seat.hand.length && !mine.length) {
      goOut(state, seat);
      state.said = `${seat.name} is out!`;
    }
    state.dirty = true;
  },

  tick(state, dt) {
    // Is anybody able to move at all?
    const stuck = inPlay(state).every((s) =>
      !s.hand.some((c) => [0, 1].some((i) => topOf(state, i) && adjacent(c, topOf(state, i)))));
    if (!stuck) { state.stuckFor = 0; return; }

    state.stuckFor += dt;
    if (state.stuckFor < STUCK) return;
    state.stuckFor = 0;

    // Two fresh cards. If the reserves are empty, the middle itself is
    // reshuffled back into them — otherwise a stuck table with cards still in
    // hand would sit there for the rest of the evening.
    if (!state.reserve[0].length && !state.reserve[1].length) {
      // The buried cards come back, which is what a real table does when it
      // sticks — and is only possible because nothing was thrown away.
      const spare = shuffle([...state.middle[0], ...state.middle[1]]);
      state.middle = [[], []];
      state.reserve = [spare.slice(0, Math.ceil(spare.length / 2)), spare.slice(Math.ceil(spare.length / 2))];
      if (!state.reserve[0].length && !state.reserve[1].length) {
        // Genuinely nothing left to turn over. Everybody left is out together.
        for (const s of inPlay(state)) goOut(state, s);
        state.dirty = true;
        return;
      }
    }
    for (const i of [0, 1]) {
      const next = state.reserve[i].pop();
      if (next) state.middle[i].push(next);
    }
    state.said = 'Stuck — two fresh cards.';
    state.log.push(state.said);
    state.dirty = true;
  },

  handOver: (state) => inPlay(state).length <= (state.seats.length > 2 ? 1 : 0) && (state.finished?.length ?? 0) > 0,

  scoreHand(state) {
    const order = finishOrder(state);
    order.forEach((seatNo, i) => {
      const s = state.seats.find((x) => x.seat === seatNo);
      if (!s) return;
      s.score += Math.max(0, order.length - i - 1) * 3;
      if (i === 0) { s.score += 5; s.won += 1; }
    });
    const first = state.seats.find((x) => x.seat === order[0]);
    state.said = first ? `${first.name} got there first.` : 'Nobody got out.';
    state.log.push(state.said);
  },

  table(state) {
    return {
      // The tops, for drawing. What is under them is nobody's business and
      // sending it would just be a bigger message.
      middle: [topOf(state, 0), topOf(state, 1)],
      buried: [state.middle[0].length, state.middle[1].length],
      stuckFor: Math.round(state.stuckFor * 10) / 10,
      stuckAt: STUCK,
      lastPlay: state.lastPlay,
      finished: state.finished,
      // Everybody's remaining draw pile, which is the real scoreboard while a
      // hand is running — hand size alone always reads five.
      stacks: state.seats.map((s) => ({
        seat: s.seat, name: s.name, left: (state.stacks[s.seat] ?? []).length + s.hand.length,
      })),
    };
  },

  mine(state, seat) {
    if (!seat) return { playable: [], onto: {} };
    // Which pile each card would go on, so a tap knows where to send it
    // without the client reimplementing the wrap-around rule.
    const onto = {};
    for (const c of seat.hand) {
      const piles = [0, 1].filter((i) => topOf(state, i) && adjacent(c, topOf(state, i)));
      if (piles.length) onto[c] = piles;
    }
    return { playable: Object.keys(onto), onto, stack: (state.stacks[seat.seat] ?? []).length };
  },

  rank: (a, b) => b.score - a.score,
});

export default speed;
