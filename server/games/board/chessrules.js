// Chess: the rules, on their own.
//
// Kept apart from the game module because these are the part that has to be
// exactly right and the part worth testing without a table around it. Nothing
// here knows about seats, clocks or sockets — it takes a position and gives
// back the legal moves, which is the only question chess ever asks.
//
// The thing that makes chess harder to implement than it looks is that legality
// is not a property of a move, it is a property of the position after it. A
// bishop can be pinned and still "move like a bishop"; castling is illegal
// through a square nobody is standing on. So every move here is generated
// loosely and then *played*, and kept only if the mover's king is not attacked
// afterwards. That is slower than reasoning about pins and it is correct by
// construction, which for a rulebook is the trade worth making.
//
// Positions use a 64-square array, a1 = 0 through h8 = 63, so rank = i >> 3 and
// file = i & 7. Pieces are the usual letters, upper case for white.

export const FILES = 'abcdefgh';

export const startPosition = () => ({
  board: [
    'R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R',
    'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P',
    ...Array(32).fill(null),
    'p', 'p', 'p', 'p', 'p', 'p', 'p', 'p',
    'r', 'n', 'b', 'q', 'k', 'b', 'n', 'r',
  ],
  turn: 'w',
  /** Which castles are still available, as the usual KQkq. */
  castling: { K: true, Q: true, k: true, q: true },
  /** The square a pawn may be captured on this move, or null. */
  enPassant: null,
  /** Moves since the last capture or pawn move — fifty of these is a draw. */
  halfmove: 0,
  fullmove: 1,
});

export const isWhite = (p) => Boolean(p) && p === p.toUpperCase();
export const colourOf = (p) => (p ? (isWhite(p) ? 'w' : 'b') : null);
export const squareName = (i) => `${FILES[i & 7]}${(i >> 3) + 1}`;
export const squareIndex = (name) => FILES.indexOf(name[0]) + (Number(name[1]) - 1) * 8;

const onBoard = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8;
const at = (r, f) => r * 8 + f;

const SLIDES = {
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  q: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
};
const KNIGHT = [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
const KING = SLIDES.q;

/**
 * Every move the pieces could make, ignoring whether the king is left in check.
 *
 * Castling is generated here too but its "not through check" test lives in the
 * legal filter, because it is the same question asked of three squares.
 */
function pseudoMoves(pos, colour) {
  const out = [];
  const { board } = pos;

  for (let i = 0; i < 64; i++) {
    const piece = board[i];
    if (!piece || colourOf(piece) !== colour) continue;
    const r = i >> 3;
    const f = i & 7;
    const kind = piece.toLowerCase();

    if (kind === 'p') {
      const dir = colour === 'w' ? 1 : -1;
      const startRank = colour === 'w' ? 1 : 6;
      const lastRank = colour === 'w' ? 7 : 0;

      // One forward.
      if (onBoard(r + dir, f) && !board[at(r + dir, f)]) {
        pushPawn(out, i, at(r + dir, f), r + dir === lastRank);
        // Two, but only from the starting rank and only through an empty square.
        if (r === startRank && !board[at(r + 2 * dir, f)]) {
          out.push({ from: i, to: at(r + 2 * dir, f), double: true });
        }
      }
      // Captures, including en passant.
      for (const df of [-1, 1]) {
        if (!onBoard(r + dir, f + df)) continue;
        const target = at(r + dir, f + df);
        const there = board[target];
        if (there && colourOf(there) !== colour) {
          pushPawn(out, i, target, r + dir === lastRank);
        } else if (!there && pos.enPassant === target) {
          out.push({ from: i, to: target, enPassant: true });
        }
      }
      continue;
    }

    if (kind === 'n') {
      for (const [dr, df] of KNIGHT) {
        if (!onBoard(r + dr, f + df)) continue;
        const target = at(r + dr, f + df);
        if (!board[target] || colourOf(board[target]) !== colour) out.push({ from: i, to: target });
      }
      continue;
    }

    if (kind === 'k') {
      for (const [dr, df] of KING) {
        if (!onBoard(r + dr, f + df)) continue;
        const target = at(r + dr, f + df);
        if (!board[target] || colourOf(board[target]) !== colour) out.push({ from: i, to: target });
      }
      // Castling. Rights, empty squares, and the through-check test below.
      const home = colour === 'w' ? 0 : 56;
      if (i === home + 4) {
        const rights = colour === 'w' ? ['K', 'Q'] : ['k', 'q'];
        if (pos.castling[rights[0]] && !board[home + 5] && !board[home + 6]) {
          out.push({ from: i, to: home + 6, castle: 'king' });
        }
        if (pos.castling[rights[1]] && !board[home + 1] && !board[home + 2] && !board[home + 3]) {
          out.push({ from: i, to: home + 2, castle: 'queen' });
        }
      }
      continue;
    }

    const dirs = SLIDES[kind === 'q' ? 'q' : kind];
    if (!dirs) continue;
    for (const [dr, df] of dirs) {
      let rr = r + dr;
      let ff = f + df;
      while (onBoard(rr, ff)) {
        const target = at(rr, ff);
        const there = board[target];
        if (!there) out.push({ from: i, to: target });
        else {
          if (colourOf(there) !== colour) out.push({ from: i, to: target });
          break;
        }
        rr += dr;
        ff += df;
      }
    }
  }
  return out;
}

/** A pawn reaching the far rank is four moves, not one. */
function pushPawn(out, from, to, promotes) {
  if (!promotes) { out.push({ from, to }); return; }
  for (const promo of ['q', 'r', 'b', 'n']) out.push({ from, to, promote: promo });
}

/** Is this square attacked by that colour? Used for check and for castling. */
export function attacked(pos, square, byColour) {
  // Generated from the attacker's side rather than by walking outward from the
  // square, because the two would be two implementations of the same rules and
  // they would disagree about en passant sooner or later.
  return pseudoMoves(pos, byColour).some((m) => m.to === square && !m.castle);
}

export const kingSquare = (pos, colour) =>
  pos.board.findIndex((p) => p && p.toLowerCase() === 'k' && colourOf(p) === colour);

export const inCheck = (pos, colour) => {
  const k = kingSquare(pos, colour);
  return k >= 0 && attacked(pos, k, colour === 'w' ? 'b' : 'w');
};

/**
 * The moves that are actually legal.
 *
 * Every candidate is played and the position tested. Slower than reasoning
 * about pins and rays, and right by construction — which is the trade a
 * rulebook should make, because a pin bug is invisible until it decides a game.
 */
export function legalMoves(pos, colour = pos.turn) {
  const out = [];
  for (const move of pseudoMoves(pos, colour)) {
    if (move.castle) {
      // You may not castle out of, through, or into check.
      const home = colour === 'w' ? 0 : 56;
      const path = move.castle === 'king' ? [home + 4, home + 5, home + 6] : [home + 4, home + 3, home + 2];
      const enemy = colour === 'w' ? 'b' : 'w';
      if (path.some((sq) => attacked(pos, sq, enemy))) continue;
    }
    const after = applyMove(pos, move);
    if (!inCheck(after, colour)) out.push(move);
  }
  return out;
}

/** Play a move and hand back the new position. Never mutates the old one. */
export function applyMove(pos, move) {
  const board = [...pos.board];
  const piece = board[move.from];
  const colour = colourOf(piece);
  const kind = piece.toLowerCase();
  const castling = { ...pos.castling };
  let enPassant = null;

  const captured = board[move.to];
  board[move.to] = move.promote
    ? (colour === 'w' ? move.promote.toUpperCase() : move.promote)
    : piece;
  board[move.from] = null;

  // En passant takes a pawn that is not on the square being moved to, which is
  // the only capture in chess that works that way.
  if (move.enPassant) {
    const behind = colour === 'w' ? move.to - 8 : move.to + 8;
    board[behind] = null;
  }
  if (move.double) {
    enPassant = colour === 'w' ? move.from + 8 : move.from - 8;
  }
  if (move.castle) {
    const home = colour === 'w' ? 0 : 56;
    if (move.castle === 'king') { board[home + 5] = board[home + 7]; board[home + 7] = null; }
    else { board[home + 3] = board[home]; board[home] = null; }
  }

  // Rights are lost by moving the king or a rook, and by a rook being taken.
  if (kind === 'k') {
    if (colour === 'w') { castling.K = false; castling.Q = false; }
    else { castling.k = false; castling.q = false; }
  }
  if (move.from === 0 || move.to === 0) castling.Q = false;
  if (move.from === 7 || move.to === 7) castling.K = false;
  if (move.from === 56 || move.to === 56) castling.q = false;
  if (move.from === 63 || move.to === 63) castling.k = false;

  return {
    board,
    turn: colour === 'w' ? 'b' : 'w',
    castling,
    enPassant,
    // Reset by a capture or a pawn move, which is exactly what the fifty-move
    // rule is counting the absence of.
    halfmove: captured || kind === 'p' || move.enPassant ? 0 : pos.halfmove + 1,
    fullmove: colour === 'b' ? pos.fullmove + 1 : pos.fullmove,
  };
}

/** Everything that matters for repetition: the position, not the history. */
export const positionKey = (pos) =>
  `${pos.board.map((p) => p ?? '.').join('')}|${pos.turn}|` +
  `${Object.entries(pos.castling).filter(([, v]) => v).map(([k]) => k).join('') || '-'}|${pos.enPassant ?? '-'}`;

/**
 * How the game stands.
 *
 * Checkmate and stalemate are the same test — no legal moves — separated only
 * by whether the king is currently attacked, which is why they are worked out
 * together rather than in two places that could disagree.
 */
export function outcome(pos, seen = new Map()) {
  const moves = legalMoves(pos, pos.turn);
  if (!moves.length) {
    return inCheck(pos, pos.turn)
      ? { over: true, result: pos.turn === 'w' ? 'black' : 'white', why: 'checkmate' }
      : { over: true, result: 'draw', why: 'stalemate' };
  }
  if (pos.halfmove >= 100) return { over: true, result: 'draw', why: 'fifty moves without a capture or a pawn' };
  if ((seen.get(positionKey(pos)) ?? 0) >= 3) return { over: true, result: 'draw', why: 'the same position three times' };
  if (deadPosition(pos)) return { over: true, result: 'draw', why: 'neither side has enough to mate' };
  return { over: false, check: inCheck(pos, pos.turn) };
}

/** King against king, or king and one minor piece — nobody can force mate. */
function deadPosition(pos) {
  const left = pos.board.filter(Boolean).map((p) => p.toLowerCase());
  if (left.some((p) => p === 'p' || p === 'r' || p === 'q')) return false;
  const minors = left.filter((p) => p === 'b' || p === 'n');
  return minors.length <= 1;
}

/** A move in the notation people read, for the log. */
export function describe(pos, move) {
  const piece = pos.board[move.from];
  const kind = piece.toLowerCase();
  if (move.castle) return move.castle === 'king' ? 'O-O' : 'O-O-O';
  const takes = Boolean(pos.board[move.to]) || move.enPassant;
  const from = squareName(move.from);
  const to = squareName(move.to);
  const letter = kind === 'p' ? '' : kind.toUpperCase();
  const disambiguate = kind === 'p' && takes ? from[0] : '';
  const promo = move.promote ? `=${move.promote.toUpperCase()}` : '';
  return `${letter}${disambiguate}${takes ? 'x' : ''}${to}${promo}`;
}

/**
 * Read a position from FEN.
 *
 * Here for the tests rather than for the game — perft against a published
 * position is the only way to know a move generator is right, and those
 * positions are published as FEN.
 */
export function fromFen(fen) {
  const [rows, turn, castles, ep, half, full] = fen.trim().split(/\s+/);
  const board = Array(64).fill(null);
  let r = 7;
  let f = 0;
  for (const ch of rows) {
    if (ch === '/') { r -= 1; f = 0; continue; }
    if (/\d/.test(ch)) { f += Number(ch); continue; }
    board[r * 8 + f] = ch;
    f += 1;
  }
  return {
    board,
    turn: turn === 'b' ? 'b' : 'w',
    castling: {
      K: castles.includes('K'), Q: castles.includes('Q'),
      k: castles.includes('k'), q: castles.includes('q'),
    },
    enPassant: ep && ep !== '-' ? squareIndex(ep) : null,
    halfmove: Number(half ?? 0),
    fullmove: Number(full ?? 1),
  };
}
