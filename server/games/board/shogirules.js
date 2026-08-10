// Shogi: the rules, on their own.
//
// Nine by nine, and the thing that makes it a different game from chess rather
// than a variant of it: a piece you capture becomes yours, and you may drop it
// back onto the board as a move. Nothing leaves the game. That is why shogi
// almost never ends in a draw and why an exchange that would be equal in chess
// can be a disaster here.
//
// Four restrictions on dropping, and every one of them exists because without
// it something absurd becomes possible. They are the part worth being careful
// about, so each says why:
//
//   nowhere to go   A pawn or lance dropped on the last rank, or a knight on
//                   the last two, could never move again. It would be a piece
//                   thrown away, so it is not a move.
//   nifu            Two of your own unpromoted pawns on one file. Without this
//                   a wall of pawns is unbeatable.
//   uchifuzume      A pawn *drop* that is immediate checkmate is forbidden.
//                   The same mate delivered by moving a pawn is perfectly
//                   legal — it is the drop specifically that is banned, which
//                   is the single strangest rule in the game and the one every
//                   implementation gets wrong.
//   into check      As everywhere: a move that leaves your own king attacked is
//                   not a move.
//
// Squares are 0..80, file = i % 9 and rank = Math.floor(i / 9), rank 0 being
// the far side from Black. Black (sente) moves up the board and moves first.

/** Piece letters. Upper case is Black (sente); a leading + is promoted. */
export const KINDS = ['K', 'R', 'B', 'G', 'S', 'N', 'L', 'P'];
/** What each becomes when it promotes. Gold and King never do. */
const PROMOTES = { R: '+R', B: '+B', S: '+S', N: '+N', L: '+L', P: '+P' };
/** What a promoted piece is when it goes back in hand. */
const DEMOTES = { '+R': 'R', '+B': 'B', '+S': 'S', '+N': 'N', '+L': 'L', '+P': 'P' };

const N = 9;
const at = (r, f) => r * N + f;
const rankOf = (i) => Math.floor(i / N);
const fileOf = (i) => i % N;
const onBoard = (r, f) => r >= 0 && r < N && f >= 0 && f < N;

export const isBlack = (p) => Boolean(p) && p.replace('+', '') === p.replace('+', '').toUpperCase();
export const sideOf = (p) => (p ? (isBlack(p) ? 'b' : 'w') : null);
export const bare = (p) => (p ? p.replace('+', '').toUpperCase() : null);
export const promoted = (p) => Boolean(p) && p.startsWith('+');

/** Black moves towards rank 0; White towards rank 8. */
const forward = (side) => (side === 'b' ? -1 : 1);
/** The last three ranks from your side — where promotion happens. */
const inZone = (side, square) => (side === 'b' ? rankOf(square) <= 2 : rankOf(square) >= 6);

export function startPosition() {
  const board = Array(81).fill(null);
  const back = ['l', 'n', 's', 'g', 'k', 'g', 's', 'n', 'l'];
  // White at the top.
  back.forEach((p, f) => { board[at(0, f)] = p; });
  board[at(1, 1)] = 'r';
  board[at(1, 7)] = 'b';
  for (let f = 0; f < N; f++) board[at(2, f)] = 'p';
  // Black at the bottom.
  for (let f = 0; f < N; f++) board[at(6, f)] = 'P';
  board[at(7, 1)] = 'B';
  board[at(7, 7)] = 'R';
  back.forEach((p, f) => { board[at(8, f)] = p.toUpperCase(); });

  return { board, turn: 'b', hands: { b: {}, w: {} } };
}

/** A gold general's steps — five other pieces move exactly like one. */
const goldSteps = (side) => {
  const d = forward(side);
  return [[d, 0], [d, -1], [d, 1], [0, -1], [0, 1], [-d, 0]];
};

const KING_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_RAYS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_RAYS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Where one piece could go, ignoring whether it leaves its own king in check. */
function stepsFor(piece, square, board) {
  const side = sideOf(piece);
  const kind = bare(piece);
  const up = promoted(piece);
  const r = rankOf(square);
  const f = fileOf(square);
  const d = forward(side);
  const out = [];

  const step = (dr, df) => {
    if (!onBoard(r + dr, f + df)) return;
    const target = at(r + dr, f + df);
    if (!board[target] || sideOf(board[target]) !== side) out.push(target);
  };
  const ray = (dr, df) => {
    let rr = r + dr;
    let ff = f + df;
    while (onBoard(rr, ff)) {
      const target = at(rr, ff);
      if (!board[target]) out.push(target);
      else {
        if (sideOf(board[target]) !== side) out.push(target);
        break;
      }
      rr += dr;
      ff += df;
    }
  };

  if (kind === 'K') { for (const [dr, df] of KING_STEPS) step(dr, df); return out; }
  if (kind === 'G' || (up && ['S', 'N', 'L', 'P'].includes(kind))) {
    for (const [dr, df] of goldSteps(side)) step(dr, df);
    return out;
  }
  if (kind === 'R') {
    for (const [dr, df] of ROOK_RAYS) ray(dr, df);
    // A promoted rook adds the king's diagonal steps.
    if (up) for (const [dr, df] of BISHOP_RAYS) step(dr, df);
    return out;
  }
  if (kind === 'B') {
    for (const [dr, df] of BISHOP_RAYS) ray(dr, df);
    if (up) for (const [dr, df] of ROOK_RAYS) step(dr, df);
    return out;
  }
  if (kind === 'S') {
    for (const [dr, df] of [[d, 0], [d, -1], [d, 1], [-d, -1], [-d, 1]]) step(dr, df);
    return out;
  }
  if (kind === 'N') {
    // The one piece that jumps, and only forwards.
    for (const df of [-1, 1]) step(2 * d, df);
    return out;
  }
  if (kind === 'L') { ray(d, 0); return out; }
  if (kind === 'P') { step(d, 0); return out; }
  return out;
}

/** Squares with nothing this piece could ever do from them. */
function deadDrop(kind, side, square) {
  const r = rankOf(square);
  const last = side === 'b' ? 0 : 8;
  const nextToLast = side === 'b' ? 1 : 7;
  if ((kind === 'P' || kind === 'L') && r === last) return true;
  if (kind === 'N' && (r === last || r === nextToLast)) return true;
  return false;
}

export const kingSquare = (pos, side) =>
  pos.board.findIndex((p) => p && bare(p) === 'K' && sideOf(p) === side);

/** Is that square attacked? Asked from the attacker's side, as in chess. */
export function attacked(pos, square, bySide) {
  for (let i = 0; i < 81; i++) {
    const piece = pos.board[i];
    if (!piece || sideOf(piece) !== bySide) continue;
    if (stepsFor(piece, i, pos.board).includes(square)) return true;
  }
  return false;
}

export const inCheck = (pos, side) => {
  const k = kingSquare(pos, side);
  return k >= 0 && attacked(pos, k, side === 'b' ? 'w' : 'b');
};

/** Every move, board and drops, that does not leave your own king attacked. */
export function legalMoves(pos, side = pos.turn) {
  const out = [];

  // Moving what is on the board.
  for (let i = 0; i < 81; i++) {
    const piece = pos.board[i];
    if (!piece || sideOf(piece) !== side) continue;
    const kind = bare(piece);
    for (const to of stepsFor(piece, i, pos.board)) {
      const canPromote = PROMOTES[kind] && !promoted(piece) && (inZone(side, i) || inZone(side, to));
      // A pawn or lance on the last rank, or a knight on the last two, has no
      // move left — so promotion stops being optional there.
      const forced = canPromote && deadDrop(kind, side, to);
      if (!forced) out.push({ from: i, to });
      if (canPromote) out.push({ from: i, to, promote: true });
    }
  }

  // Drops.
  const hand = pos.hands[side] ?? {};
  for (const kind of Object.keys(hand)) {
    if (!hand[kind]) continue;
    for (let to = 0; to < 81; to++) {
      if (pos.board[to]) continue;
      if (deadDrop(kind, side, to)) continue;
      // Nifu: never two of your own unpromoted pawns on one file.
      if (kind === 'P' && hasOwnPawn(pos, side, fileOf(to))) continue;
      out.push({ drop: kind, to });
    }
  }

  return out.filter((m) => {
    const after = applyMove(pos, m);
    if (inCheck(after, side)) return false;
    // Uchifuzume: a *dropped* pawn may not deliver immediate checkmate. The
    // same mate by moving a pawn is fine — it is the drop that is banned.
    if (m.drop === 'P') {
      const other = side === 'b' ? 'w' : 'b';
      if (inCheck(after, other) && legalMoves(after, other).length === 0) return false;
    }
    return true;
  });
}

const hasOwnPawn = (pos, side, file) => {
  for (let r = 0; r < N; r++) {
    const p = pos.board[at(r, file)];
    if (p && sideOf(p) === side && bare(p) === 'P' && !promoted(p)) return true;
  }
  return false;
};

/** Play a move. Never mutates the position it was given. */
export function applyMove(pos, move) {
  const board = [...pos.board];
  const hands = { b: { ...pos.hands.b }, w: { ...pos.hands.w } };
  const side = pos.turn;

  if (move.drop) {
    hands[side][move.drop] = (hands[side][move.drop] ?? 0) - 1;
    if (hands[side][move.drop] <= 0) delete hands[side][move.drop];
    board[move.to] = side === 'b' ? move.drop : move.drop.toLowerCase();
  } else {
    const piece = board[move.from];
    const taken = board[move.to];
    if (taken) {
      // Captured pieces change hands, unpromoted. That is the whole game.
      const kind = DEMOTES[taken.replace(/^\+/, '+')] ?? bare(taken);
      const plain = bare(taken);
      hands[side][plain] = (hands[side][plain] ?? 0) + 1;
      void kind;
    }
    const kind = bare(piece);
    board[move.to] = move.promote && PROMOTES[kind]
      ? (side === 'b' ? PROMOTES[kind] : PROMOTES[kind].toLowerCase())
      : piece;
    board[move.from] = null;
  }

  return { board, turn: side === 'b' ? 'w' : 'b', hands };
}

/** How the game stands. Shogi has no stalemate — no moves is a loss. */
export function outcome(pos) {
  const moves = legalMoves(pos, pos.turn);
  if (!moves.length) {
    // Checkmate, or the rarer case of having nothing legal at all. Both lose:
    // shogi has no stalemate, which is part of why draws are so rare.
    return {
      over: true,
      result: pos.turn === 'b' ? 'white' : 'black',
      why: inCheck(pos, pos.turn) ? 'checkmate' : 'no legal move',
    };
  }
  return { over: false, check: inCheck(pos, pos.turn) };
}

export const squareName = (i) => `${9 - fileOf(i)}${'abcdefghi'[rankOf(i)]}`;
export { at, rankOf, fileOf, inZone, stepsFor, PROMOTES };
