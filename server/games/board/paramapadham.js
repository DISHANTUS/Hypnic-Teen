// பரமபதம் — Paramapadham, or Moksha Patam.
//
// The game Snakes and Ladders was made from, with the part that was taken out
// put back. Parama padam is the highest place; sopanam is the steps. The
// ladders are virtues and the snakes are vices, and every one of them has a
// name — which is the entire point of the board and the thing Victorian
// Britain removed when it exported it in the 1890s as a children's toy.
//
// So the squares here say what they are. Landing on 57 is not "a ladder", it is
// Devotion; sliding from 73 is not "a snake", it is Murder. It costs nothing to
// carry and it is the difference between this game and the one in the shops.
//
// Two things are traditional rather than modern and are worth stating:
//
// A move is resolved once. Land at the foot of a ladder and you climb it; land
// on a snake's head and you go down. What you find at the other end is where
// you stop — no chaining, no cascade. Chaining turns a board with a snake at 92
// dropping to 51 and a ladder at 51 into something that loops, and the loop is
// not in the game, it is in the implementation.
//
// And the last square must be reached exactly. Overshooting moksha is not how
// it works. You stay where you are and throw again next turn, which is the
// whole of the ending and the reason people groan at 97.

import { createBoardGame, inPlay, passTurn } from './kit.js';
import { throwSticks } from './thayam.js';

const SQUARES = 100;

/**
 * The ladders, by the virtue that lifts you.
 *
 * Names from the traditional board. If yours assigns them differently — and
 * regional boards do — this is the one table to change and nothing else needs
 * to know.
 */
export const LADDERS = {
  12: { to: 51, name: 'Faith', tamil: 'நம்பிக்கை' },
  25: { to: 63, name: 'Generosity', tamil: 'தானம்' },
  36: { to: 55, name: 'Knowledge', tamil: 'ஞானம்' },
  42: { to: 60, name: 'Compassion', tamil: 'கருணை' },
  57: { to: 91, name: 'Devotion', tamil: 'பக்தி' },
  76: { to: 98, name: 'Asceticism', tamil: 'தவம்' },
};

/** The snakes, by the vice that drops you. */
export const SNAKES = {
  41: { to: 4, name: 'Disobedience', tamil: 'கீழ்ப்படியாமை' },
  44: { to: 22, name: 'Vanity', tamil: 'ஆணவம்' },
  49: { to: 11, name: 'Vulgarity', tamil: 'இழிவு' },
  52: { to: 8, name: 'Theft', tamil: 'திருட்டு' },
  58: { to: 30, name: 'Lying', tamil: 'பொய்' },
  62: { to: 19, name: 'Drunkenness', tamil: 'மது' },
  69: { to: 33, name: 'Debt', tamil: 'கடன்' },
  73: { to: 1, name: 'Murder', tamil: 'கொலை' },
  84: { to: 13, name: 'Anger', tamil: 'கோபம்' },
  92: { to: 51, name: 'Greed', tamil: 'பேராசை' },
  95: { to: 24, name: 'Pride', tamil: 'கர்வம்' },
  99: { to: 7, name: 'Lust', tamil: 'காமம்' },
};

/** A plain six-sided die, for tables that would rather have one. */
const die = () => ({ sticks: null, value: 1 + Math.floor(Math.random() * 6), grace: false });

export const paramapadham = createBoardGame({
  id: 'paramapadham',
  name: 'Paramapadham',
  tagline: 'பரமபதம் — the original. Ladders are virtues, snakes are vices, and all of them have names.',
  emoji: '🪜',
  accent: '#8e44ad',
  face: 'paramapadham',
  minPlayers: 2,
  maxPlayers: 6,
  turnSeconds: 25,

  howToPlay: [
    'This is the game Snakes and Ladders was made from. Parama padam means the highest place; sopanam means the steps.',
    'Throw and move up the numbered path towards a hundred.',
    'Land at the foot of a ladder and the virtue lifts you — faith, generosity, knowledge, compassion, devotion, asceticism.',
    'Land on a snake and the vice drops you — anger, greed, pride, theft, lying, and the rest.',
    'A move is resolved once. Where a ladder or a snake leaves you is where you stay.',
    'The last square must be reached exactly. Overshoot and you stay where you are.',
  ],

  options: {
    dice: {
      label: 'What you throw',
      kind: 'choice',
      default: 'dhayakkattai',
      choices: [
        { id: 'dhayakkattai', label: 'Dhayakkattai', note: 'two long sticks — 1 to 6, and 12 for two blanks' },
        { id: 'die', label: 'A six-sided die', note: 'the Victorian way' },
      ],
    },
  },
  settings: (s) => ({ dice: s.dice === 'die' ? 'die' : 'dhayakkattai' }),

  init(state) {
    state.at = {};        // seat -> square, 0 = not started
    state.moved = null;   // what just happened, for the client to narrate
  },

  setUp(state) {
    state.at = Object.fromEntries(state.seats.map((s) => [s.seat, 0]));
    state.moved = null;
    state.turn = 0;
    state.rolled = null;
    state.said = 'Throw to set off.';
  },

  act(state, seat, action) {
    if (state.seats[state.turn]?.id !== seat.id) return;
    if (action.type !== 'throw' || state.rolled) return;

    const roll = state.settings.dice === 'die' ? die() : throwSticks();
    state.rolled = roll;

    const from = state.at[seat.seat] ?? 0;
    const wanted = from + roll.value;

    if (wanted > SQUARES) {
      // Moksha is reached exactly or not at all.
      state.moved = { seat: seat.seat, from, to: from, blocked: true };
      state.said = `${seat.name} throws ${roll.value} — too many. Stays on ${from}.`;
      finishTurn(state, seat, roll);
      return;
    }

    let to = wanted;
    let via = null;
    // Resolved once. What is at the far end of a ladder or a snake is where
    // you stop, even if that square has something on it too.
    if (LADDERS[to]) { via = { kind: 'ladder', at: to, ...LADDERS[to] }; to = LADDERS[to].to; }
    else if (SNAKES[to]) { via = { kind: 'snake', at: to, ...SNAKES[to] }; to = SNAKES[to].to; }

    state.at[seat.seat] = to;
    state.moved = { seat: seat.seat, from, to, via, blocked: false };
    seat.score = to;

    state.said = via
      ? via.kind === 'ladder'
        ? `${seat.name} lands on ${via.at} — ${via.name} — and climbs to ${to}.`
        : `${seat.name} lands on ${via.at} — ${via.name} — and slides to ${to}.`
      : `${seat.name} throws ${roll.value} and moves to ${to}.`;
    if (via) state.log.push(state.said);

    if (to === SQUARES) {
      seat.won = 1;
      seat.score = SQUARES + 10;
      state.said = `${seat.name} reaches paramapadham.`;
      state.log.push(state.said);
      state.dirty = true;
      return;
    }
    finishTurn(state, seat, roll);
  },

  timedOut(state) {
    const seat = state.seats[state.turn];
    if (!seat) return;
    if (!state.rolled) {
      state.log.push(`${seat.name} was away — thrown for them.`);
      paramapadham.__spec.act(state, seat, { type: 'throw' });
      return;
    }
    passTurn(state);
  },

  isDone: (state) => state.seats.some((s) => (state.at[s.seat] ?? 0) === SQUARES)
    || inPlay(state).length <= 1,

  table(state) {
    return {
      squares: SQUARES,
      // Sent rather than hardcoded in the client, so the names on the board and
      // the names in the rules can never drift apart.
      ladders: Object.entries(LADDERS).map(([from, l]) => ({ from: Number(from), ...l })),
      snakes: Object.entries(SNAKES).map(([from, s]) => ({ from: Number(from), ...s })),
      at: state.seats.map((s) => ({ seat: s.seat, name: s.name, square: state.at[s.seat] ?? 0 })),
      moved: state.moved,
      dice: state.settings.dice,
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    return {
      square: state.at[seat.seat] ?? 0,
      needsThrow: !state.rolled,
      // How far from the end, which is the number people actually watch.
      toGo: SQUARES - (state.at[seat.seat] ?? 0),
    };
  },

  rank: (a, b) => b.score - a.score,
});

/**
 * End the turn — unless the sticks earned another.
 *
 * Only the dhayakkattai grant one. A six-sided die has no grace throw in this
 * game, which is a real difference between the two settings rather than a
 * detail: the sticks make the board move faster and the ending crueller.
 */
function finishTurn(state, seat, roll) {
  if (roll.grace) {
    state.rolled = null;
    state.turnLeft = state.settings.turnSeconds;
    state.dirty = true;
    return;
  }
  passTurn(state);
}

export default paramapadham;
