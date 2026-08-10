// Does the crossword builder build crosswords?
//
//   npm run test:crossword:grid
//
// A grid generator fails quietly. It returns something grid-shaped every time,
// and the failure looks like "this puzzle is a bit sparse" rather than like an
// error — so it ships, and then a room of four people gets a board of parallel
// words that never touch and no way to get a letter for free.
//
// So this checks the properties that make it a crossword rather than a list:
// every word after the first crosses one already down, no two words run
// alongside each other, every letter in a shared square agrees, and the
// numbering is the one people already know how to read.
//
// Run over many seeds, because one good grid proves nothing.

import { buildCrossword, blankGrid, coversCell, makeRng, normalise } from '../server/crossword.js';
import { USABLE_WORDS } from '../server/crossword-words.js';

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};

console.log('\n  Crossword grids\n');

/* ------------------------- the same seed, the same grid ------------------- */

{
  const a = buildCrossword({ words: USABLE_WORDS, target: 12, seed: 42 });
  const b = buildCrossword({ words: USABLE_WORDS, target: 12, seed: 42 });
  check('the same seed builds the same puzzle', JSON.stringify(a) === JSON.stringify(b));

  const c = buildCrossword({ words: USABLE_WORDS, target: 12, seed: 43 });
  check('a different seed builds a different one', JSON.stringify(a) !== JSON.stringify(c));

  const rng = makeRng(7);
  const first = [rng(), rng(), rng()];
  const rng2 = makeRng(7);
  check('the generator itself repeats', JSON.stringify(first) === JSON.stringify([rng2(), rng2(), rng2()]));
  check('and produces numbers in range', first.every((n) => n >= 0 && n < 1), JSON.stringify(first));
}

/* ---------------------- every property, over many seeds ------------------- */

const RUNS = 60;
const problems = { crossings: [], parallel: [], mismatch: [], stray: [], numbering: [], bounds: [], dupes: [] };
const sizes = [];
const counts = [];

for (let seed = 1; seed <= RUNS; seed++) {
  const p = buildCrossword({ words: USABLE_WORDS, target: 12, maxSize: 13, seed });
  sizes.push(Math.max(p.width, p.height));
  counts.push(p.entries.length);

  // Nothing may run past the size it was asked for.
  if (p.width > 13 || p.height > 13) problems.bounds.push(`seed ${seed}: ${p.width}x${p.height}`);

  // The same word twice is a puzzle with two identical clues in it.
  const answers = p.entries.map((e) => e.answer);
  if (new Set(answers).size !== answers.length) problems.dupes.push(`seed ${seed}`);

  // Every letter the grid claims must match every entry that runs through it.
  for (let r = 0; r < p.height; r++) {
    for (let c = 0; c < p.width; c++) {
      const cell = p.cells[r][c];
      if (!cell) continue;
      for (const e of p.entries) {
        if (!coversCell(e, r, c)) continue;
        const at = e.dir === 'across' ? c - e.col : r - e.row;
        if (e.answer[at] !== cell.letter) {
          problems.mismatch.push(`seed ${seed}: ${e.id} wants ${e.answer[at]} at ${r},${c}, grid says ${cell.letter}`);
        }
      }
      // A square that no entry owns is a letter floating on its own.
      if (!cell.entries.length) problems.stray.push(`seed ${seed}: orphan at ${r},${c}`);
    }
  }

  // Every entry but the first has to share a square with another.
  for (const e of p.entries) {
    let crosses = 0;
    for (let i = 0; i < e.length; i++) {
      const r = e.dir === 'across' ? e.row : e.row + i;
      const c = e.dir === 'across' ? e.col + i : e.col;
      if (p.cells[r][c].entries.length > 1) crosses += 1;
    }
    if (crosses === 0 && p.entries.length > 1) problems.crossings.push(`seed ${seed}: ${e.id} ${e.answer} touches nothing`);
  }

  // Two words side by side spell something nobody wrote. Checked by walking
  // every run of letters in the grid and demanding each be a real entry.
  for (let r = 0; r < p.height; r++) {
    let run = '';
    let startC = 0;
    for (let c = 0; c <= p.width; c++) {
      const cell = c < p.width ? p.cells[r][c] : null;
      if (cell) {
        if (!run) startC = c;
        run += cell.letter;
      } else if (run) {
        if (run.length > 1 && !p.entries.some((e) => e.dir === 'across' && e.row === r && e.col === startC && e.answer === run)) {
          problems.parallel.push(`seed ${seed}: row ${r} reads "${run}" which is nobody's word`);
        }
        run = '';
      }
    }
  }
  for (let c = 0; c < p.width; c++) {
    let run = '';
    let startR = 0;
    for (let r = 0; r <= p.height; r++) {
      const cell = r < p.height ? p.cells[r][c] : null;
      if (cell) {
        if (!run) startR = r;
        run += cell.letter;
      } else if (run) {
        if (run.length > 1 && !p.entries.some((e) => e.dir === 'down' && e.col === c && e.row === startR && e.answer === run)) {
          problems.parallel.push(`seed ${seed}: column ${c} reads "${run}" which is nobody's word`);
        }
        run = '';
      }
    }
  }

  // Numbering runs in reading order, and a square where two words start
  // carries one number that both use.
  let last = 0;
  const starts = [...p.entries].sort((a, b) => a.row - b.row || a.col - b.col);
  for (const e of starts) {
    if (e.number < last) problems.numbering.push(`seed ${seed}: ${e.id} numbered ${e.number} after ${last}`);
    last = Math.max(last, e.number);
  }
  const shared = p.entries.filter((e) => p.entries.some((o) => o !== e && o.row === e.row && o.col === e.col));
  for (const e of shared) {
    const twin = p.entries.find((o) => o !== e && o.row === e.row && o.col === e.col);
    if (twin && twin.number !== e.number) {
      problems.numbering.push(`seed ${seed}: ${e.id} and ${twin.id} start together but are numbered differently`);
    }
  }
}

check('every word crosses another', problems.crossings.length === 0, problems.crossings.slice(0, 2).join(' | '));
check('no two words run alongside each other', problems.parallel.length === 0, problems.parallel.slice(0, 2).join(' | '));
check('shared squares agree on their letter', problems.mismatch.length === 0, problems.mismatch.slice(0, 2).join(' | '));
check('no letter is left with no word', problems.stray.length === 0, problems.stray.slice(0, 2).join(' | '));
check('numbering reads left to right, top to bottom', problems.numbering.length === 0, problems.numbering.slice(0, 2).join(' | '));
check('no puzzle grows past the size asked for', problems.bounds.length === 0, problems.bounds.slice(0, 2).join(' | '));
check('no word appears twice in one puzzle', problems.dupes.length === 0, problems.dupes.slice(0, 2).join(' | '));

/* ------------------------------ and it is full ---------------------------- */

const worst = Math.min(...counts);
const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
check('every seed produces a real puzzle, not three words', worst >= 7, `worst ${worst}, average ${mean.toFixed(1)}`);
check('and grids stay a sensible size', Math.max(...sizes) <= 13, `largest ${Math.max(...sizes)}`);

/* --------------------- what the player is actually sent ------------------- */

{
  const p = buildCrossword({ words: USABLE_WORDS, target: 12, seed: 9 });
  const sent = blankGrid(p);
  const wire = JSON.stringify(sent);

  check('the blank grid has the same shape', sent.width === p.width && sent.height === p.height);
  check('every clue is sent', sent.clues.length === p.entries.length, `${sent.clues.length} of ${p.entries.length}`);
  check('the clues are in numbered order',
    sent.clues.every((c, i) => i === 0 || c.number >= sent.clues[i - 1].number),
    sent.clues.map((c) => c.number).join(','));

  // The one that matters. A client holding the answers can win the match from
  // a console, and two teams racing the same puzzle makes that worth doing.
  const leaked = p.entries.filter((e) => wire.includes(`"${e.answer}"`) || wire.includes(e.answer.split('').join('","')));
  check('no answer is anywhere in what the client is sent', leaked.length === 0,
    leaked.map((e) => e.answer).join(', '));
  check('and no square carries its letter',
    !sent.cells.flat().some((c) => c && 'letter' in c),
    JSON.stringify(sent.cells.flat().find((c) => c && 'letter' in c)));
}

/* ------------------------------- the typing ------------------------------- */

{
  check('spacing and case are forgiven', normalise('  bir yani ') === 'BIRYANI');
  check('punctuation is forgiven', normalise('wi-fi!') === 'WIFI');
  check('but a misspelling is not', normalise('biriani') !== 'BIRYANI');
  check('and nothing is not an answer', normalise('   ') === '');
  check('null does not crash it', normalise(null) === '');
}

/* -------------------------- a small pool still works ---------------------- */

{
  // A room could ask for a puzzle when only a handful of words are eligible.
  const tiny = USABLE_WORDS.filter((w) => w.answer.length === 4).slice(0, 8);
  const p = buildCrossword({ words: tiny, target: 12, seed: 3 });
  check('a small pool gives a small puzzle rather than a broken one', p.entries.length >= 2 && p.width > 0,
    `${p.entries.length} words in ${p.width}x${p.height}`);

  const empty = buildCrossword({ words: [], target: 12, seed: 3 });
  check('no words at all gives an empty puzzle, not a crash', empty.entries.length === 0 && empty.width === 0);
}

/* ------------------------------ show one ---------------------------------- */

{
  const p = buildCrossword({ words: USABLE_WORDS, target: 12, seed: 11 });
  console.log(`\n  \x1b[2mseed 11 — ${p.entries.length} words, ${p.width}x${p.height}\x1b[0m\n`);
  for (let r = 0; r < p.height; r++) {
    let line = '   ';
    for (let c = 0; c < p.width; c++) line += p.cells[r][c] ? ` ${p.cells[r][c].letter}` : ' ·';
    console.log(`\x1b[2m${line}\x1b[0m`);
  }
  console.log('');
  for (const e of p.entries.slice(0, 4)) {
    console.log(`   \x1b[2m${e.number} ${e.dir}: ${e.clue} (${e.length})\x1b[0m`);
  }
}

const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — ${RUNS} seeds, every one a real crossword\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
