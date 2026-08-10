// The board room, one screen.
//
// A board, the pieces on it, and whatever this game throws or moves. Only the
// middle changes between games, the same bargain the card room and the casino
// machines made.
//
// The dayakattai are the piece of this worth explaining. They are two long
// four-sided sticks and they are drawn as sticks rather than as a number,
// because in Thayam the sticks *are* the odds — three is common because four
// pairs make it, twelve is rare because one does. A player who can see two
// blanks land understands why twelve is worth having in a way that the numeral
// twelve never conveys. They tumble on the same broadcast everybody else gets;
// the value was decided on the server before the animation started.

import { Sound } from '/js/sound.js';
import { confetti, floatText, pulse, motionReduced } from '/js/fx.js';
import { mountClock } from '/js/turnclock.mjs';

const SEAT_TINT = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];
const SEAT_NAME = ['Red', 'Blue', 'Green', 'Yellow'];

/** What happens after this, per game. */
const NEXT = {
  thayam: 'One, five, six or twelve and you throw again.',
  paramapadham: 'A ladder is a virtue. A snake is a vice. Both have names.',
};

export default {
  mount({ canvas, wrap, hud, Net, meta }) {
    canvas.style.display = 'none';
    wrap.classList.add('bd-stage');

    const face = meta?.face ?? meta?.id ?? 'thayam';

    const root = document.createElement('div');
    root.className = `bd is-${face}`;
    root.innerHTML = `
      <div class="bd-brief intro-card" hidden>
        <h2 id="bdTitle"></h2>
        <p class="muted" id="bdTagline"></p>
        <ol class="intro-rules" id="bdRules"></ol>
        <button class="btn btn-primary intro-ready" id="bdBriefed" type="button">Ready</button>
        <p class="muted small" id="bdBriefWait"></p>
      </div>

      <div class="bd-table" hidden>
        <div class="bd-seats" id="bdSeats"></div>
        <div class="bd-board" id="bdBoard"></div>
        <div class="bd-said" id="bdSaid"></div>
        <div class="bd-dice" id="bdDice"></div>
        <div class="bd-acts" id="bdActs"></div>
        <ul class="bd-log" id="bdLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="bdWho">—</span>
        <span class="hud-chip hud-accent" id="bdPhase">Playing</span>
      </div>`;

    const clock = mountClock(hud);

    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);
    const brief = $('.bd-brief');
    const table = $('.bd-table');

    /** A coin picked up but not yet committed. */
    let picked = null;
    let shownThrow = null;
    let shownSaid = '';

    $('#bdBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#bdBriefed').disabled = true;
      $('#bdBriefed').textContent = 'Waiting for the room…';
    });

    /* ------------------------------ the board ----------------------------- */

    /**
     * The hundred squares, boustrophedon — one, two, three left to right along
     * the bottom, then eleven, twelve, thirteen back the other way. That is how
     * the board is actually numbered and drawing it any other way makes every
     * ladder and snake land somewhere that looks wrong.
     */
    function layOutLadder(s) {
      const box = $('#bdBoard');
      if (box.dataset.size === 'ladder') return;
      box.dataset.size = 'ladder';
      box.style.setProperty('--n', '10');
      box.classList.add('is-ladder');

      const ladders = new Map((s.ladders ?? []).map((l) => [l.from, l]));
      const snakes = new Map((s.snakes ?? []).map((x) => [x.from, x]));

      const cells = [];
      for (let row = 9; row >= 0; row--) {
        const leftToRight = (9 - row) % 2 === 0;
        for (let i = 0; i < 10; i++) {
          const col = leftToRight ? i : 9 - i;
          const n = row * 10 + (leftToRight ? col + 1 : 10 - col);
          cells.push({ n, row, col });
        }
      }
      // Back into visual order, top row first.
      cells.sort((a, b) => a.row - b.row || a.col - b.col);

      box.replaceChildren(
        ...cells.map(({ n }) => {
          const cell = document.createElement('div');
          cell.className = 'bd-cell bd-sq';
          cell.dataset.cell = String(n);
          const up = ladders.get(n);
          const down = snakes.get(n);
          cell.classList.toggle('is-ladder', Boolean(up));
          cell.classList.toggle('is-snake', Boolean(down));
          if (n === 100) cell.classList.add('is-centre');
          const num = document.createElement('i');
          num.className = 'bd-num';
          num.textContent = String(n);
          cell.appendChild(num);
          // The name, which is the whole reason this is not just a ladder.
          if (up || down) {
            const tag = document.createElement('em');
            tag.className = 'bd-virtue';
            tag.textContent = (up ?? down).name;
            tag.title = `${(up ?? down).name} · ${(up ?? down).tamil} → ${(up ?? down).to}`;
            cell.appendChild(tag);
          }
          return cell;
        })
      );
    }

    function layOutBoard(s) {
      const box = $('#bdBoard');
      if (box.dataset.size === String(s.size)) return;
      box.dataset.size = String(s.size);
      box.style.setProperty('--n', String(s.size));
      const safe = new Set(s.safe ?? []);

      box.replaceChildren(
        ...Array.from({ length: s.size * s.size }, (_, i) => {
          const r = Math.floor(i / s.size);
          const c = i % s.size;
          const key = `${r},${c}`;
          const cell = document.createElement('div');
          cell.className = 'bd-cell';
          cell.dataset.cell = key;
          // The crosses. Drawn from what the server says is safe rather than
          // from a hardcoded picture, so the two can never disagree about
          // where it is safe to stand.
          if (safe.has(key)) cell.classList.add('is-safe');
          if (key === s.centre) cell.classList.add('is-centre');
          return cell;
        })
      );
    }

    /** Pieces on the hundred squares. */
    function paintPieces(s) {
      const box = $('#bdBoard');
      for (const cell of box.querySelectorAll('.bd-sq')) {
        for (const p of cell.querySelectorAll('.bd-coin')) p.remove();
      }
      for (const who of s.at ?? []) {
        if (!who.square) continue;
        const cell = box.querySelector(`[data-cell="${who.square}"]`);
        if (!cell) continue;
        const el = document.createElement('span');
        el.className = 'bd-coin is-stacked';
        el.style.setProperty('--tint', SEAT_TINT[who.seat % 6] ?? SEAT_TINT[who.seat % 4]);
        el.classList.toggle('is-mine', who.seat === s.you?.seat);
        el.title = who.name;
        cell.appendChild(el);
      }

      $('#bdSeats').replaceChildren(
        ...(s.seats ?? []).map((p) => {
          const where = (s.at ?? []).find((x) => x.seat === p.seat);
          const el = document.createElement('div');
          el.className = 'bd-seat';
          el.style.setProperty('--tint', SEAT_TINT[p.seat % 4]);
          el.classList.toggle('is-turn', p.seat === s.turn);
          el.classList.toggle('is-you', p.seat === s.you?.seat);
          el.innerHTML = `<i></i><b></b><small></small>`;
          el.querySelector('b').textContent = p.name;
          el.querySelector('small').textContent = where?.square
            ? `on ${where.square} · ${100 - where.square} to go`
            : 'not away yet';
          return el;
        })
      );
    }

    /** The coins, and which of them you are allowed to move right now. */
    function paintCoins(s) {
      const box = $('#bdBoard');
      for (const cell of box.querySelectorAll('.bd-cell')) cell.replaceChildren();

      const movable = new Set((s.you?.moves ?? []).map((m) => m.coin));
      const byCell = new Map();
      for (const coin of s.coins ?? []) {
        if (!coin.cell) continue;
        if (!byCell.has(coin.cell)) byCell.set(coin.cell, []);
        byCell.get(coin.cell).push(coin);
      }

      for (const [key, coins] of byCell) {
        const cell = box.querySelector(`[data-cell="${key}"]`);
        if (!cell) continue;
        for (const coin of coins) {
          const el = document.createElement('button');
          el.type = 'button';
          el.className = 'bd-coin';
          el.style.setProperty('--tint', SEAT_TINT[coin.seat % 4]);
          el.dataset.seat = String(coin.seat);
          el.dataset.coin = String(coin.i);
          const mine = coin.seat === s.you?.seat;
          const canMove = mine && movable.has(coin.i);
          el.classList.toggle('is-mine', mine);
          el.classList.toggle('can-move', canMove);
          el.classList.toggle('is-picked', picked === coin.i && mine);
          // Stacked coins on a cross need to be visible as more than one.
          if (coins.length > 1) el.classList.add('is-stacked');
          el.disabled = !canMove;
          if (canMove) {
            el.addEventListener('click', () => {
              Net.action({ type: 'move', coin: coin.i });
              picked = null;
              Sound.play('pick');
              pulse(el);
            });
          }
          cell.appendChild(el);
        }
      }

      // Anything still in hand, drawn beside the board rather than on it.
      const hand = (s.coins ?? []).filter((c) => c.at < 0);
      const bySeat = new Map();
      for (const c of hand) bySeat.set(c.seat, (bySeat.get(c.seat) ?? 0) + 1);
      $('#bdSeats').replaceChildren(
        ...(s.seats ?? []).map((p) => {
          const el = document.createElement('div');
          el.className = 'bd-seat';
          el.style.setProperty('--tint', SEAT_TINT[p.seat % 4]);
          el.classList.toggle('is-turn', p.seat === s.turn);
          el.classList.toggle('is-you', p.seat === s.you?.seat);
          const stat = (s.cuts ?? []).find((x) => x.seat === p.seat);
          el.innerHTML = `<i></i><b></b><small></small>`;
          el.querySelector('b').textContent = p.name;
          el.querySelector('small').textContent =
            `${bySeat.get(p.seat) ?? 0} in hand · ${stat?.home ?? 0} home · ${stat?.cuts ?? 0} cut`;
          return el;
        })
      );
    }

    /* ------------------------------- the sticks --------------------------- */

    /**
     * Two dayakattai.
     *
     * Each stick shows one, two, three or a blank. They tumble for a moment
     * and settle on what the server already decided — the animation is a
     * retelling, never a decision, which is why a slow phone cannot see a
     * different number from everybody else.
     */
    function paintDice(s) {
      const box = $('#bdDice');
      const roll = s.rolled;
      if (!roll) {
        box.replaceChildren();
        if (s.you?.yourTurn && s.you?.needsThrow) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn btn-primary bd-throw';
          b.textContent = 'Throw';
          b.addEventListener('click', () => { Net.action({ type: 'throw' }); Sound.play('click'); });
          box.appendChild(b);
        }
        return;
      }

      const key = `${roll.value}:${roll.sticks.join(',')}`;
      if (box.dataset.key === key) return;
      box.dataset.key = key;

      const row = document.createElement('div');
      row.className = 'bd-sticks';
      for (const face2 of roll.sticks) {
        const stick = document.createElement('span');
        stick.className = 'bd-stick';
        stick.classList.toggle('is-blank', face2 === 0);
        if (!motionReduced) stick.classList.add('is-rolling');
        // Pips down the length of the stick, the way the real thing is marked.
        stick.innerHTML = face2 === 0
          ? '<i class="bd-blank"></i>'
          : Array.from({ length: face2 }, () => '<i class="bd-pip"></i>').join('');
        row.appendChild(stick);
      }
      box.replaceChildren(row);

      const said = document.createElement('b');
      said.className = 'bd-value';
      said.textContent = roll.value === 12 ? '12 — both blank' : String(roll.value);
      if (roll.value === 1) said.textContent = '1 — dayam';
      box.appendChild(said);

      if (shownThrow !== key) {
        shownThrow = key;
        Sound.play(roll.grace ? 'win' : 'tick');
      }
    }

    /* ------------------------------- painting ----------------------------- */

    function paint(s) {
      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        $('#bdTitle').textContent = meta?.name ?? 'Board';
        $('#bdTagline').textContent = meta?.tagline ?? '';
        const list = $('#bdRules');
        if (!list.children.length) {
          list.replaceChildren(
            ...(s.rules ?? []).map((line) => {
              const li = document.createElement('li');
              li.textContent = line;
              return li;
            })
          );
        }
        const waiting = s.seats.filter((p) => p.connected && !s.briefed.includes(p.id)).length;
        $('#bdBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        clock.paint({
          label: waiting ? 'Everybody is reading the rules' : 'Everybody is ready',
          hint: NEXT[face] ?? '',
          left: s.timeLeft,
          total: s.phaseTotal,
        });
        return;
      }

      brief.hidden = true;
      table.hidden = false;

      $hud('#bdWho').textContent = s.you?.seat >= 0 ? SEAT_NAME[s.you.seat % 4] : '—';
      $hud('#bdPhase').textContent = s.phase === 'over' ? 'Finished' : s.you?.yourTurn ? 'Your turn' : 'Playing';

      clock.paint(
        s.phase === 'over'
          ? { label: 'That is the lot', idle: true }
          : {
              label: s.you?.yourTurn
                ? (s.you?.needsThrow ? 'Your throw' : 'Your move')
                : `Waiting on ${s.turnName || 'the next player'}`,
              // Tested for presence, not for truthiness. Paramapadham has no
              // such field at all, so negating an undefined came out true and
              // every player of it was being told about a rule that belongs to
              // a different game entirely.
              hint: s.you?.yourTurn && s.you?.canLeaveFirstLayer === false
                ? 'You cannot leave the outer ring until you have cut somebody.'
                : NEXT[face] ?? '',
              left: s.turnLeft,
              total: s.phaseTotal,
              yours: Boolean(s.you?.yourTurn),
            }
      );

      if (face === 'paramapadham') {
        layOutLadder(s);
        paintPieces(s);
      } else {
        layOutBoard(s);
        paintCoins(s);
      }
      paintDice(s);

      // What you may do, when the board alone does not make it obvious.
      const acts = $('#bdActs');
      acts.replaceChildren();
      if (s.you?.yourTurn && s.rolled && !(s.you.moves ?? []).length) {
        const none = document.createElement('span');
        none.className = 'bd-none';
        none.textContent = 'Nothing that throw can move.';
        acts.appendChild(none);
      }

      if (s.said && shownSaid !== s.said) {
        shownSaid = s.said;
        $('#bdSaid').textContent = s.said;
        if (/cuts/.test(s.said)) Sound.play('buzz');
        if (/brings one home/.test(s.said) && s.said.startsWith(s.seats.find((x) => x.seat === s.you?.seat)?.name ?? ' ')) {
          confetti(table, { count: 50 });
          floatText($('#bdBoard'), 'home', 'gain');
        }
      }

      $('#bdLog').replaceChildren(
        ...(s.log ?? []).slice(-3).reverse().map((line) => {
          const li = document.createElement('li');
          li.textContent = line;
          return li;
        })
      );
    }

    const off = Net.on('game:state', paint);

    return () => {
      off?.();
      clock.destroy();
      wrap.classList.remove('bd-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
