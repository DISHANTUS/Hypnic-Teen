// Chess.
//
// The rules live next door in chessrules.js and are tested on their own against
// published perft counts, which is the only way to actually know a move
// generator is right. This file is the table around them: two seats, a clock,
// and the part where the server refuses.
//
// The refusing is the whole job. There is no hidden information in chess, so a
// client that decided its own legality would be a client that could castle out
// of check and nobody would find out until it decided a game. Every move
// arrives as a pair of squares and is looked up in the legal list — not
// validated against it, looked up in it — so an illegal move is not rejected by
// a rule, it simply is not in the set of things that exist.

import { createBoardGame, passTurn } from './kit.js';
import {
  startPosition, legalMoves, applyMove, outcome, positionKey,
  squareName, colourOf, describe, inCheck,
} from './chessrules.js';

const COLOUR = ['w', 'b'];

export const chess = createBoardGame({
  id: 'chess',
  name: 'Chess',
  tagline: 'The whole thing — castling, en passant, promotion, and a draw by repetition.',
  emoji: '♟️',
  accent: '#34495e',
  face: 'chess',
  minPlayers: 2,
  maxPlayers: 2,
  turnSeconds: 60,

  howToPlay: [
    'White moves first. Tap a piece, then tap where it goes.',
    'Only legal moves are offered — a pinned piece will not light up, and you cannot castle out of, through, or into check.',
    'A pawn reaching the far rank becomes a queen unless you say otherwise.',
    'Checkmate wins. Stalemate is a draw, and so is the same position three times over.',
    'Fifty moves with no capture and no pawn move is also a draw.',
  ],

  init(state) {
    state.pos = startPosition();
    state.seen = {};
    state.history = [];
    state.result = null;
  },

  setUp(state) {
    state.pos = startPosition();
    state.seen = { [positionKey(state.pos)]: 1 };
    state.history = [];
    state.result = null;
    state.turn = 0;
    state.said = 'White to move.';
  },

  act(state, seat, action) {
    if (state.result) return;

    if (action.type === 'resign') {
      const other = state.seats.find((s) => s.seat !== seat.seat);
      state.result = { result: seat.seat === 0 ? 'black' : 'white', why: `${seat.name} resigned` };
      if (other) { other.score = 1; other.won = 1; }
      state.said = `${seat.name} resigns.`;
      state.log.push(state.said);
      state.dirty = true;
      return;
    }

    if (action.type !== 'move') return;
    if (state.seats[state.turn]?.id !== seat.id) return;
    // The seat's colour is fixed by where they sit, so a player cannot move
    // their opponent's pieces even on their own turn.
    if (state.pos.turn !== COLOUR[seat.seat]) return;

    const from = Number(action.from);
    const to = Number(action.to);
    const moves = legalMoves(state.pos, state.pos.turn);
    // Looked up rather than validated. A move that is not in this list is not
    // an illegal move, it is not a move.
    const move = moves.find((m) =>
      m.from === from && m.to === to &&
      (m.promote ? m.promote === (action.promote ?? 'q') : true));
    if (!move) return;

    const said = describe(state.pos, move);
    state.pos = applyMove(state.pos, move);
    const key = positionKey(state.pos);
    state.seen[key] = (state.seen[key] ?? 0) + 1;
    state.history.push({ san: said, from: squareName(from), to: squareName(to) });

    const seenMap = new Map(Object.entries(state.seen));
    const how = outcome(state.pos, seenMap);
    if (how.over) {
      state.result = how;
      for (const s of state.seats) {
        const mine = COLOUR[s.seat];
        s.score = how.result === 'draw' ? 1 : (how.result === (mine === 'w' ? 'white' : 'black') ? 2 : 0);
        if (how.result !== 'draw' && s.score === 2) s.won = 1;
      }
      state.said = how.result === 'draw' ? `Draw — ${how.why}.` : `${how.result === 'white' ? 'White' : 'Black'} wins by ${how.why}.`;
      state.log.push(state.said);
      state.dirty = true;
      return;
    }

    state.said = how.check ? `${said} — check.` : said;
    passTurn(state, state.pos.turn === 'w' ? 0 : 1);
  },

  timedOut(state) {
    if (state.result) return;
    const seat = state.seats[state.turn];
    if (!seat) return;
    const moves = legalMoves(state.pos, state.pos.turn);
    if (!moves.length) return;
    // A capture if there is one, otherwise anything. Being away should cost
    // the game, not end it — and a forfeit on one slow turn would be harsh in
    // a game where thinking is the point.
    const pick = moves.find((m) => state.pos.board[m.to]) ?? moves[Math.floor(Math.random() * moves.length)];
    state.log.push(`${seat.name} was away — a move was made for them.`);
    chess.__spec.act(state, seat, { from: pick.from, to: pick.to, promote: pick.promote, type: 'move' });
  },

  isDone: (state) => Boolean(state.result),

  table(state) {
    const moves = state.result ? [] : legalMoves(state.pos, state.pos.turn);
    return {
      board: state.pos.board,
      toMove: state.pos.turn,
      check: state.result ? false : inCheck(state.pos, state.pos.turn),
      castling: state.pos.castling,
      enPassant: state.pos.enPassant,
      halfmove: state.pos.halfmove,
      fullmove: state.pos.fullmove,
      history: state.history.slice(-12),
      result: state.result,
      // The whole legal list is public because chess has no secrets — both
      // players can work it out anyway, and sending it means the board can
      // light up without the client reimplementing the rules.
      legal: moves.map((m) => ({ from: m.from, to: m.to, promote: m.promote ?? null, castle: m.castle ?? null })),
      colours: state.seats.map((s) => ({ seat: s.seat, name: s.name, colour: COLOUR[s.seat] })),
    };
  },

  mine(state, seat) {
    if (!seat) return {};
    const mine = COLOUR[seat.seat];
    return {
      colour: mine,
      yourMove: !state.result && state.pos.turn === mine,
      inCheck: !state.result && inCheck(state.pos, mine),
      // The board goes on the wire from white's side. Black turns it round,
      // which is what every player expects and what nobody says out loud.
      flip: mine === 'b',
    };
  },

  rank: (a, b) => b.score - a.score,
});

void colourOf;

export default chess;
