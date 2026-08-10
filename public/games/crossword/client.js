// Crossword Clash — the board.
//
// Two decisions shape everything here, and both are about phones.
//
// You answer a whole word at a time rather than a square at a time. Cell-by-
// cell entry is how a crossword works on paper and it is miserable on a
// touchscreen — the keyboard covers the grid, the caret jumps, and half the
// room gives up. Tapping a clue and typing the word is one gesture, and it is
// also what makes a wrong answer something the game can price.
//
// And the grid never scrolls sideways. A thirteen-wide puzzle on a 390px
// screen is a 26px square, which is small but readable; letting it overflow
// instead would mean the half of the board somebody cannot see is the half
// their teammate just filled in.
//
// The letters arrive from the server as your side earns them. This never has
// the answers, which matters more here than in most games: two sides racing
// the same puzzle is exactly the situation where reading them out of a console
// would be worth doing.

import { Sound } from '/js/sound.js';
import { confetti, floatText, shake, pulse } from '/js/fx.js';

export default {
  mount({ canvas, wrap, hud, Net }) {
    canvas.style.display = 'none';
    wrap.classList.add('cw-stage');

    const root = document.createElement('div');
    root.className = 'cw';
    root.innerHTML = `
      <div class="cw-brief intro-card" hidden>
        <h2>Crossword Clash</h2>
        <p class="muted">One puzzle, and your team fills in its own copy of it — together.</p>
        <ol class="intro-rules" id="cwRules"></ol>
        <button class="btn btn-primary intro-ready" id="cwBriefed" type="button">Ready</button>
        <p class="muted small" id="cwBriefWait"></p>
      </div>

      <div class="cw-table" hidden>
        <div class="cw-flash" id="cwFlash" hidden></div>
        <div class="cw-sides" id="cwSides"></div>
        <div class="cw-gridwrap"><div class="cw-grid" id="cwGrid"></div></div>
        <div class="cw-answer" id="cwAnswer" hidden></div>
        <div class="cw-clues">
          <section><h3>Across</h3><ul id="cwAcross"></ul></section>
          <section><h3>Down</h3><ul id="cwDown"></ul></section>
        </div>
        <ul class="cw-log" id="cwLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="cwClock">—</span>
        <span class="hud-chip" id="cwDone">0 of 0</span>
      </div>`;

    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);

    const brief = $('.cw-brief');
    const table = $('.cw-table');
    const gridBox = $('#cwGrid');
    const answerBox = $('#cwAnswer');
    const flashBox = $('#cwFlash');

    let state = null;
    /** Which clue the answer box is for. */
    let picked = null;
    /** Clues solved last paint, so a new one can be celebrated once. */
    let seenSolved = new Set();
    let flashedClue = null;

    /* ------------------------------ the brief ------------------------------ */

    $('#cwBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#cwBriefed').disabled = true;
      $('#cwBriefed').textContent = 'Waiting for the room…';
    });

    /* ------------------------------- the grid ------------------------------ */

    /** Built once. After that only the letters and highlights change. */
    function layOutGrid(board) {
      if (gridBox.dataset.built === `${board.width}x${board.height}`) return;
      gridBox.dataset.built = `${board.width}x${board.height}`;
      gridBox.style.setProperty('--cols', String(board.width));
      // Both, so a puzzle that is wider than it is tall keeps square cells
      // instead of stretching them to fill a square box.
      gridBox.style.setProperty('--rows', String(board.height));

      const cells = [];
      for (let r = 0; r < board.height; r++) {
        for (let c = 0; c < board.width; c++) {
          const info = board.cells[r][c];
          const cell = document.createElement('div');
          cell.className = info ? 'cw-cell' : 'cw-cell is-block';
          if (info) {
            cell.dataset.rc = `${r},${c}`;
            cell.dataset.entries = info.entries.join(' ');
            cell.innerHTML =
              (info.number ? `<span class="cw-num">${info.number}</span>` : '') + '<span class="cw-letter"></span>';
            // Tapping a square picks the word through it, which is how anybody
            // who has ever done a crossword expects it to behave.
            cell.addEventListener('click', () => {
              const ids = info.entries;
              if (!ids.length) return;
              // Through a crossing, tapping again swaps to the other direction.
              const next = picked && ids.includes(picked) && ids.length > 1
                ? ids[(ids.indexOf(picked) + 1) % ids.length]
                : ids[0];
              pick(next);
            });
          }
          cells.push(cell);
        }
      }
      gridBox.replaceChildren(...cells);
    }

    function paintGrid(s) {
      const letters = s.you?.letters ?? {};
      const active = picked ? new Set(cellsOf(s, picked)) : new Set();

      for (const cell of gridBox.querySelectorAll('.cw-cell[data-rc]')) {
        const rc = cell.dataset.rc;
        const letter = letters[rc] ?? '';
        const slot = cell.querySelector('.cw-letter');
        if (slot.textContent !== letter) {
          slot.textContent = letter;
          if (letter) {
            cell.classList.remove('is-fill');
            void cell.offsetWidth;
            cell.classList.add('is-fill');
          }
        }
        cell.classList.toggle('is-on', active.has(rc));
        cell.classList.toggle('is-done', Boolean(letter));
      }
    }

    /** Which squares a clue runs through. */
    function cellsOf(s, clueId) {
      const clue = s.board.clues.find((c) => c.id === clueId);
      if (!clue) return [];
      return Array.from({ length: clue.length }, (_, i) =>
        clue.dir === 'across' ? `${clue.row},${clue.col + i}` : `${clue.row + i},${clue.col}`
      );
    }

    /* ------------------------------ the clues ------------------------------ */

    function paintClues(s) {
      for (const [dir, listId] of [['across', '#cwAcross'], ['down', '#cwDown']]) {
        const list = $(listId);
        const clues = s.board.clues.filter((c) => c.dir === dir);
        list.replaceChildren(
          ...clues.map((c) => {
            const solved = s.you?.solved?.[c.id];
            const locked = s.you?.locked?.[c.id] ?? 0;

            const li = document.createElement('li');
            li.className = 'cw-clue';
            li.classList.toggle('is-solved', Boolean(solved));
            li.classList.toggle('is-locked', locked > 0);
            li.classList.toggle('is-on', picked === c.id);
            li.innerHTML =
              '<b></b><span class="cw-clue-text"></span><small class="cw-clue-note"></small>';
            li.querySelector('b').textContent = String(c.number);
            li.querySelector('.cw-clue-text').textContent = `${c.clue} (${c.length})`;

            const note = li.querySelector('.cw-clue-note');
            if (solved) {
              note.textContent = solved.byName
                ? `${solved.byName} · ${solved.points > 0 ? `+${solved.points}` : 'given'}`
                : 'given to the room';
            } else if (locked > 0) {
              // The whole penalty, stated as the thing it costs: seconds.
              note.textContent = `locked ${locked}s`;
            } else {
              note.textContent = '';
            }

            if (!solved && locked <= 0) li.addEventListener('click', () => pick(c.id));
            return li;
          })
        );
      }
    }

    /* ---------------------------- typing an answer -------------------------- */

    function pick(clueId) {
      picked = clueId;
      const s = state;
      if (!s) return;
      const clue = s.board.clues.find((c) => c.id === clueId);
      if (!clue) return;
      if (s.you?.solved?.[clueId]) return;

      answerBox.hidden = false;
      answerBox.innerHTML = `
        <form class="cw-answer-form">
          <label>
            <b></b>
            <span></span>
          </label>
          <div class="cw-answer-row">
            <input type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
            <button class="btn btn-primary" type="submit">Enter</button>
          </div>
          <p class="cw-answer-note muted"></p>
        </form>`;

      answerBox.querySelector('b').textContent = `${clue.number} ${clue.dir}`;
      answerBox.querySelector('label span').textContent = `${clue.clue} — ${clue.length} letters`;
      const input = answerBox.querySelector('input');
      input.maxLength = clue.length + 4;
      input.placeholder = '·'.repeat(clue.length);

      answerBox.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        Net.action({ type: 'guess', clueId, text });
        input.value = '';
        input.focus();
      });

      paintGrid(s);
      paintClues(s);
      // Focused, but not on a phone at the exact moment somebody is reading
      // the clue — the keyboard covering the grid is the complaint that ends
      // up in the feedback box.
      if (matchMedia('(min-width: 761px)').matches) setTimeout(() => input.focus(), 40);
    }

    /** Answers the room has been shown — the loudest thing on the screen. */
    function paintFlash(s) {
      if (!s.flash) {
        flashBox.hidden = true;
        flashedClue = null;
        return;
      }
      const clue = s.board.clues.find((c) => c.id === s.flash.clueId);
      flashBox.hidden = false;
      flashBox.innerHTML =
        '<span class="cw-flash-label">Nobody had it. Type it — fast.</span>' +
        '<b class="cw-flash-word"></b>' +
        '<span class="cw-flash-where"></span>' +
        '<span class="cw-flash-clock"></span>';
      flashBox.querySelector('.cw-flash-word').textContent = s.flash.answer;
      flashBox.querySelector('.cw-flash-where').textContent = clue ? `${clue.number} ${clue.dir}` : '';
      flashBox.querySelector('.cw-flash-clock').textContent = `${s.flash.secondsLeft}s`;

      if (flashedClue !== s.flash.clueId) {
        flashedClue = s.flash.clueId;
        Sound.play('phase');
        pulse(flashBox);
        // Straight into the box, so it really is a typing race and not a
        // hunt for the right clue first.
        pick(s.flash.clueId);
      }
    }

    /* -------------------------------- painting ------------------------------ */

    function paint(s) {
      state = s;

      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        const list = $('#cwRules');
        if (!list.children.length) {
          list.replaceChildren(
            ...(s.rules ?? []).map((line) => {
              const li = document.createElement('li');
              li.textContent = line;
              return li;
            })
          );
        }
        const waiting = s.sides.flatMap((x) => x.members).filter((m) => m.connected && !s.briefed.includes(m.id)).length;
        $('#cwBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        $hud('#cwClock').textContent = `${s.timeLeft}s`;
        return;
      }

      brief.hidden = true;
      table.hidden = false;

      const mins = Math.floor(s.timeLeft / 60);
      const secs = s.timeLeft % 60;
      $hud('#cwClock').textContent = s.phase === 'over' ? 'done' : `${mins}:${String(secs).padStart(2, '0')}`;
      $hud('#cwDone').textContent = `${Object.keys(s.you?.solved ?? {}).length} of ${s.totalClues}`;

      // Who is where. In a solo room this is the scoreboard; in teams it is
      // also who you are playing with.
      $('#cwSides').replaceChildren(
        ...[...s.sides]
          .sort((a, b) => b.score - a.score)
          .map((side) => {
            const chip = document.createElement('div');
            chip.className = 'cw-side';
            chip.classList.toggle('is-you', side.id === s.you?.sideId);
            chip.style.setProperty('--side', side.color);
            chip.innerHTML = '<b></b><span></span><small></small>';
            chip.querySelector('b').textContent = side.name;
            chip.querySelector('span').textContent = `${side.score}`;
            chip.querySelector('small').textContent =
              s.teamSize > 1 ? side.members.map((m) => m.name).join(', ') : `${side.solved}/${s.totalClues}`;
            return chip;
          })
      );

      layOutGrid(s.board);
      paintFlash(s);

      // Anything newly solved is worth a noise and a number.
      const solvedNow = new Set(Object.keys(s.you?.solved ?? {}));
      for (const id of solvedNow) {
        if (seenSolved.has(id)) continue;
        const got = s.you.solved[id];
        const first = cellsOf(s, id)[0];
        const cell = first ? gridBox.querySelector(`.cw-cell[data-rc="${first}"]`) : null;
        if (got.points > 0) {
          Sound.play('correct');
          if (cell) floatText(cell, `+${got.points}`, 'gain');
        }
        if (picked === id) {
          picked = null;
          answerBox.hidden = true;
        }
      }
      // A wrong answer is a new lockout: say so where the typing is happening.
      const locked = s.you?.locked ?? {};
      if (picked && locked[picked] > 0 && !answerBox.hidden) {
        const note = answerBox.querySelector('.cw-answer-note');
        if (note && !note.dataset.for) {
          note.dataset.for = picked;
          note.textContent = `Not that. Locked for ${locked[picked]}s — try another clue meanwhile.`;
          Sound.play('wrong');
          shake(answerBox);
        }
      }
      seenSolved = solvedNow;

      paintGrid(s);
      paintClues(s);

      $('#cwLog').replaceChildren(
        ...(s.log ?? []).slice(-3).reverse().map((line) => {
          const li = document.createElement('li');
          li.textContent = line;
          return li;
        })
      );

      if (s.phase === 'over' && !table.dataset.done) {
        table.dataset.done = '1';
        const mine = s.sides.find((x) => x.id === s.you?.sideId);
        const best = [...s.sides].sort((a, b) => b.score - a.score)[0];
        if (mine && best && mine.id === best.id) confetti(table, { count: 60 });
      }
    }

    const off = Net.on('game:state', paint);

    return () => {
      off?.();
      wrap.classList.remove('cw-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
