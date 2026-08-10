// Building a crossword.
//
// The hard part is not placing words, it is placing words that cross. A grid
// of parallel words that never touch is not a crossword, it is a word search
// with clues — and the whole pleasure of the thing is getting one letter for
// free because somebody on your team solved the word that crosses it.
//
// So this only ever places a word where it shares a letter with one already
// down, and it refuses anything that would leave letters sitting side by side
// without spelling something. That second rule is what stops the grid filling
// up with accidental two-letter gibberish running the other way.
//
// It is random but repeatable: give it the same seed and it builds the same
// puzzle, which is what makes it testable and what lets two teams be handed
// provably identical grids.

/**
 * @typedef {{ answer: string, clue: string }} Word
 * @typedef {{
 *   id: string, number: number, row: number, col: number,
 *   dir: 'across'|'down', answer: string, clue: string, length: number
 * }} Entry
 * @typedef {{
 *   width: number, height: number,
 *   cells: (null|{ letter: string, entries: string[] })[][],
 *   entries: Entry[]
 * }} Puzzle
 */

/**
 * A small deterministic generator.
 *
 * Math.random cannot be seeded, and an unseedable grid builder cannot be
 * tested — a failure would appear once in fifty runs and never again.
 */
export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    // xorshift32. Short, fast, and good enough to shuffle a word list.
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const shuffled = (list, rng) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** Room to grow in every direction before anything is trimmed. */
const PAD = 2;

/**
 * Builds a crossword from a list of words.
 *
 * @param {object} opts
 * @param {Word[]} opts.words     the pool to draw from
 * @param {number} [opts.target]  how many words to aim for
 * @param {number} [opts.maxSize] the widest or tallest the grid may end up
 * @param {number} [opts.seed]    same seed, same puzzle
 * @returns {Puzzle}
 */
export function buildCrossword({ words, target = 12, maxSize = 13, seed = 1 } = {}) {
  const rng = makeRng(seed);
  const pool = shuffled(words.filter((w) => w.answer.length <= maxSize), rng);
  if (!pool.length) return { width: 0, height: 0, cells: [], entries: [] };

  // Worked on a canvas big enough that nothing runs off the side, then cropped
  // to whatever was actually used. Placing straight into a tight grid means
  // rejecting good words for being two squares too far left.
  const span = maxSize + PAD * 2;
  /** @type {(null|{letter:string, across:number|null, down:number|null})[][]} */
  const grid = Array.from({ length: span }, () => Array.from({ length: span }, () => null));
  const placed = [];

  const at = (r, c) => (r >= 0 && r < span && c >= 0 && c < span ? grid[r][c] : undefined);

  /**
   * May this word sit here?
   *
   * Three things make a placement illegal, and the last one is the one that is
   * easy to forget and ruins grids: a word may not run alongside another,
   * because the letters that end up side by side spell nothing.
   */
  function fits(answer, row, col, dir) {
    const dr = dir === 'down' ? 1 : 0;
    const dc = dir === 'across' ? 1 : 0;

    // Inside the canvas, with a clear square at each end so two words cannot
    // run into one another and read as one long one.
    const beforeR = row - dr;
    const beforeC = col - dc;
    const afterR = row + dr * answer.length;
    const afterC = col + dc * answer.length;
    if (row < 0 || col < 0) return false;
    if (afterR > span || afterC > span) return false;
    if (at(beforeR, beforeC)) return false;
    if (at(afterR, afterC)) return false;

    let crossings = 0;
    for (let i = 0; i < answer.length; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      const cell = at(r, c);

      if (cell) {
        // Overlapping an existing letter is only allowed if it is the same
        // letter, and only where the two words run at right angles.
        if (cell.letter !== answer[i]) return false;
        if (dir === 'across' && cell.across !== null) return false;
        if (dir === 'down' && cell.down !== null) return false;
        crossings += 1;
        continue;
      }

      // An empty square, so check the two beside it. A neighbour here would
      // sit shoulder to shoulder with this letter in the other direction and
      // spell something nobody wrote.
      const sideA = dir === 'across' ? at(r - 1, c) : at(r, c - 1);
      const sideB = dir === 'across' ? at(r + 1, c) : at(r, c + 1);
      if (sideA || sideB) return false;
    }

    // Every word after the first has to hook onto the puzzle somewhere.
    return placed.length === 0 ? true : crossings > 0;
  }

  function place(word, row, col, dir) {
    const dr = dir === 'down' ? 1 : 0;
    const dc = dir === 'across' ? 1 : 0;
    const index = placed.length;

    for (let i = 0; i < word.answer.length; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      if (!grid[r][c]) grid[r][c] = { letter: word.answer[i], across: null, down: null };
      grid[r][c][dir] = index;
    }
    placed.push({ ...word, row, col, dir });
  }

  // The first word goes across the middle and everything else hangs off it.
  const first = pool.reduce((best, w) => (w.answer.length > best.answer.length ? w : best), pool[0]);
  const mid = Math.floor(span / 2);
  place(first, mid, Math.floor((span - first.answer.length) / 2), 'across');

  const used = new Set([first.answer]);

  // Several passes over the pool. One pass places the easy crossings; a later
  // pass can often fit a word that had nothing to hook onto the first time.
  for (let pass = 0; pass < 4 && placed.length < target; pass++) {
    for (const word of pool) {
      if (placed.length >= target) break;
      if (used.has(word.answer)) continue;

      // Every way this word could cross something already down, tried in a
      // random order so the same pool does not always build the same shape.
      const options = [];
      for (let i = 0; i < word.answer.length; i++) {
        for (const done of placed) {
          for (let j = 0; j < done.answer.length; j++) {
            if (done.answer[j] !== word.answer[i]) continue;
            const dir = done.dir === 'across' ? 'down' : 'across';
            const row = done.dir === 'across' ? done.row - i : done.row + j;
            const col = done.dir === 'across' ? done.col + j : done.col - i;
            options.push({ row, col, dir });
          }
        }
      }

      for (const spot of shuffled(options, rng)) {
        if (!fits(word.answer, spot.row, spot.col, spot.dir)) continue;
        // Keep the puzzle from growing into a cross the size of the canvas.
        if (!withinBounds(placed, word, spot, maxSize)) continue;
        place(word, spot.row, spot.col, spot.dir);
        used.add(word.answer);
        break;
      }
    }
  }

  return crop(grid, placed, span);
}

/** Would placing this keep the whole puzzle inside maxSize either way? */
function withinBounds(placed, word, spot, maxSize) {
  const dr = spot.dir === 'down' ? 1 : 0;
  const dc = spot.dir === 'across' ? 1 : 0;
  let minR = spot.row;
  let maxR = spot.row + dr * (word.answer.length - 1);
  let minC = spot.col;
  let maxC = spot.col + dc * (word.answer.length - 1);

  for (const p of placed) {
    const pr = p.dir === 'down' ? p.answer.length - 1 : 0;
    const pc = p.dir === 'across' ? p.answer.length - 1 : 0;
    minR = Math.min(minR, p.row);
    maxR = Math.max(maxR, p.row + pr);
    minC = Math.min(minC, p.col);
    maxC = Math.max(maxC, p.col + pc);
  }
  return maxR - minR + 1 <= maxSize && maxC - minC + 1 <= maxSize;
}

/**
 * Crops the canvas to what was used and numbers the entries.
 *
 * Numbering is the ordinary crossword convention: read the grid left to right,
 * top to bottom, and a square gets the next number whenever a word starts
 * there. A square where an across and a down both start shares one number,
 * which is why the two clue lists can both say "7".
 */
function crop(grid, placed, span) {
  if (!placed.length) return { width: 0, height: 0, cells: [], entries: [] };

  let minR = span;
  let maxR = 0;
  let minC = span;
  let maxC = 0;
  for (let r = 0; r < span; r++) {
    for (let c = 0; c < span; c++) {
      if (!grid[r][c]) continue;
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      minC = Math.min(minC, c);
      maxC = Math.max(maxC, c);
    }
  }

  const height = maxR - minR + 1;
  const width = maxC - minC + 1;

  const moved = placed.map((p) => ({ ...p, row: p.row - minR, col: p.col - minC }));

  // Number the starts in reading order.
  let next = 1;
  const numberAt = new Map();
  const entries = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const starts = moved.filter((p) => p.row === r && p.col === c);
      if (!starts.length) continue;
      const number = numberAt.get(`${r},${c}`) ?? next++;
      numberAt.set(`${r},${c}`, number);
      for (const p of starts) {
        entries.push({
          id: `${number}${p.dir === 'across' ? 'a' : 'd'}`,
          number,
          row: r,
          col: c,
          dir: p.dir,
          answer: p.answer,
          clue: p.clue,
          length: p.answer.length,
        });
      }
    }
  }

  // The grid as the client needs it: a letter and which entries own it, so a
  // solved word can light up exactly the squares it filled.
  const cells = Array.from({ length: height }, (_, r) =>
    Array.from({ length: width }, (_, c) => {
      const cell = grid[r + minR][c + minC];
      if (!cell) return null;
      const owners = entries.filter((e) => coversCell(e, r, c)).map((e) => e.id);
      return { letter: cell.letter, entries: owners, number: numberAt.get(`${r},${c}`) ?? null };
    })
  );

  return { width, height, cells, entries };
}

/** Does this entry run through that square? */
export function coversCell(entry, row, col) {
  if (entry.dir === 'across') return entry.row === row && col >= entry.col && col < entry.col + entry.length;
  return entry.col === col && row >= entry.row && row < entry.row + entry.length;
}

/**
 * The grid with every letter taken out — what a player is actually sent.
 *
 * The answers stay on the server. A client holding the finished grid is a
 * client that can win the match with two lines in a console, and in a game
 * where teams race the same puzzle that is not a theoretical worry.
 */
export function blankGrid(puzzle) {
  return {
    width: puzzle.width,
    height: puzzle.height,
    cells: puzzle.cells.map((row) =>
      row.map((cell) => (cell ? { number: cell.number, entries: cell.entries } : null))
    ),
    clues: puzzle.entries
      .map((e) => ({ id: e.id, number: e.number, dir: e.dir, clue: e.clue, length: e.length, row: e.row, col: e.col }))
      .sort((a, b) => a.number - b.number || (a.dir === 'across' ? -1 : 1)),
  };
}

/**
 * Close enough to count.
 *
 * Typing is the whole interaction here and a room on phones will produce
 * trailing spaces and the odd stray capital. Anything beyond that — a real
 * misspelling — is a wrong answer, because a crossword where nearly right
 * counts is not a crossword.
 */
export const normalise = (text) => String(text ?? '').toUpperCase().replace(/[^A-Z]/g, '');
