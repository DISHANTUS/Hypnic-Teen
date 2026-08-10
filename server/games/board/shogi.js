// Shogi.
//
// The rules are next door and tested on their own against published perft
// counts. This is the table: two seats, a clock, and the refusing.
//
// One thing differs from the chess table and it is worth saying. In chess the
// legal move list is public because both players could work it out anyway. The
// same is true here, but the list is much larger — a middlegame with four
// pieces in hand can offer three hundred moves, most of them drops. So the
// drops are sent as "which kinds, and which squares each may go to" rather than
// as one entry per pair, which is the same information at a tenth of the size.

import { createBoardGame, passTurn } from './kit.js';
import {
  startPosition, legalMoves, applyMove, outcome, inCheck, bare, sideOf, squareName,
} from './shogirules.js';

const SIDE = ['b', 'w'];

export const shogi = createBoardGame({
  id: 'shogi',
  name: 'Shogi',
  tagline: 'Japanese chess. Nothing you capture leaves the game — it changes sides.',
  emoji: '⛩️',
  accent: '#b03a2e',
  face: 'shogi',
  minPlayers: 2,
  maxPlayers: 2,
  turnSeconds: 60,

  howToPlay: [
    'Nine by nine. Black moves first, up the board.',
    'Take a piece and it goes into your hand — you may drop it back on any empty square as a whole move.',
    'Reach the last three ranks and most pieces may promote. Gold and the king never do.',
    'A dropped pawn may not give immediate checkmate, and you may never have two of your own pawns on one file.',
    'Checkmate wins. There is no stalemate — nothing legal to play is a loss.',
  ],

  init(state) {
    state.pos = startPosition();
    state.history = [];
    state.result = null;
  },

  setUp(state) {
    state.pos = startPosition();
    state.history = [];
    state.result = null;
    state.turn = 0;
    state.said = 'Black to move.';
  },

  act(state, seat, action) {
    if (state.result) return;

    if (action.type === 'resign') {
      const other = state.seats.find((s) => s.seat !== seat.seat);
      state.result = { result: seat.seat === 0 ? 'white' : 'black', why: `${seat.name} resigned` };
      if (other) { other.score = 1; other.won = 1; }
      state.said = `${seat.name} resigns.`;
      state.log.push(state.said);
      state.dirty = true;
      return;
    }

    if (action.type !== 'move') return;
    if (state.seats[state.turn]?.id !== seat.id) return;
    if (state.pos.turn !== SIDE[seat.seat]) return;

    const moves = legalMoves(state.pos, state.pos.turn);
    const move = action.drop
      ? moves.find((m) => m.drop === action.drop && m.to === Number(action.to))
      : moves.find((m) => m.from === Number(action.from) && m.to === Number(action.to)
          && Boolean(m.promote) === Boolean(action.promote));
    if (!move) return;

    const said = move.drop
      ? `${move.drop}*${squareName(move.to)}`
      : `${bare(state.pos.board[move.from])}${squareName(move.to)}${move.promote ? '+' : ''}`;

    state.pos = applyMove(state.pos, move);
    state.history.push({ san: said });

    const how = outcome(state.pos);
    if (how.over) {
      state.result = how;
      for (const s of state.seats) {
        const mine = SIDE[s.seat] === 'b' ? 'black' : 'white';
        s.score = how.result === mine ? 2 : 0;
        if (s.score === 2) s.won = 1;
      }
      state.said = `${how.result === 'black' ? 'Black' : 'White'} wins by ${how.why}.`;
      state.log.push(state.said);
      state.dirty = true;
      return;
    }

    state.said = how.check ? `${said} — check.` : said;
    passTurn(state, state.pos.turn === 'b' ? 0 : 1);
  },

  timedOut(state) {
    if (state.result) return;
    const seat = state.seats[state.turn];
    if (!seat) return;
    const moves = legalMoves(state.pos, state.pos.turn);
    if (!moves.length) return;
    const pick = moves.find((m) => !m.drop && state.pos.board[m.to]) ?? moves[Math.floor(Math.random() * moves.length)];
    state.log.push(`${seat.name} was away — a move was made for them.`);
    shogi.__spec.act(state, seat, { type: 'move', ...pick });
  },

  isDone: (state) => Boolean(state.result),

  table(state) {
    const moves = state.result ? [] : legalMoves(state.pos, state.pos.turn);
    // Board moves one by one; drops folded by kind, because a hand of four can
    // otherwise put three hundred near-identical entries on the wire.
    const drops = {};
    for (const m of moves) {
      if (!m.drop) continue;
      (drops[m.drop] ??= []).push(m.to);
    }
    return {
      board: state.pos.board,
      hands: state.pos.hands,
      toMove: state.pos.turn,
      check: state.result ? false : inCheck(state.pos, state.pos.turn),
      history: state.history.slice(-12),
      result: state.result,
      legal: moves.filter((m) => !m.drop).map((m) => ({ from: m.from, to: m.to, promote: Boolean(m.promote) })),
      drops,
      colours: state.seats.map((s) => ({ seat: s.seat, name: s.name, side: SIDE[s.seat] })),
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    const mine = SIDE[seat.seat];
    return {
      side: mine,
      yourMove: !state.result && state.pos.turn === mine,
      inCheck: !state.result && inCheck(state.pos, mine),
      hand: state.pos.hands[mine] ?? {},
      // Same as chess: the board travels from Black's side and White turns it.
      flip: mine === 'w',
    };
  },

  rank: (a, b) => b.score - a.score,
});

void sideOf;

export default shogi;
