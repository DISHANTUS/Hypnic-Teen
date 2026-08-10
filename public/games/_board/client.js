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
  ludo: 'A six brings one out and earns another roll. Three sixes and you lose the turn.',
  chess: 'Only legal moves light up. A pinned piece will not.',
  shogi: 'What you take goes into your hand. Drop it back as a whole move.',
  mahjong: 'A pung beats a chow and a win beats both — being fastest does not.',
  chain: 'Corners burst at two, edges at three, the middle at four.',
};

/** Chess pieces, drawn as the pieces rather than as letters. */
const CHESS_GLYPH = {
  K: '\u2654', Q: '\u2655', R: '\u2656', B: '\u2657', N: '\u2658', P: '\u2659',
  k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F',
};

/** Shogi pieces, as the kanji people actually read on a board. */
const SHOGI_GLYPH = {
  K: '\u7389', R: '\u98db', B: '\u89d2', G: '\u91d1', S: '\u9280', N: '\u6842', L: '\u9999', P: '\u6b69',
  '+R': '\u9f8d', '+B': '\u99ac', '+S': '\u5168', '+N': '\u572d', '+L': '\u6210', '+P': '\u3068',
};

/** Mahjong tiles have their own block in Unicode, which is the whole answer. */
const MJ_SUIT = { b: 0x1F010, c: 0x1F007, o: 0x1F019 };
function tileGlyph(t) {
  if (!t) return '?';
  const kind = t[0];
  if (MJ_SUIT[kind]) return String.fromCodePoint(MJ_SUIT[kind] + Number(t[1]) - 1);
  if (kind === 'w') return { E: '\u{1F000}', S: '\u{1F001}', W: '\u{1F002}', N: '\u{1F003}' }[t[1]] ?? '?';
  if (kind === 'd') return { R: '\u{1F004}', G: '\u{1F005}', W: '\u{1F006}' }[t[1]] ?? '?';
  if (kind === 'f') return String.fromCodePoint(0x1F022 + Number(t[1]) - 1);
  if (kind === 's') return String.fromCodePoint(0x1F026 + Number(t[1]) - 1);
  return '?';
}

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
    /** A piece in hand, armed for a drop. Shogi only. */
    let dropping = null;
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
          // A pair is one thing, and looks like one.
          if (coin.pair !== null && coin.pair !== undefined) el.classList.add('is-paired');
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


    /* ------------------------------ the faces ----------------------------- */

    /** Ludo: the ring, laid out as a ring rather than as a grid. */
    function paintLudo(s) {
      const box = $('#bdBoard');
      if (box.dataset.size !== 'ludo') {
        box.dataset.size = 'ludo';
        box.classList.add('is-ring');
        box.classList.remove('is-ladder');
        box.style.setProperty('--n', '13');
        // Fifty-two squares round the edge of a thirteen by thirteen, which is
        // the shape the real board has and keeps every start a quarter apart.
        const cells = [];
        for (let i = 0; i < 52; i++) cells.push(i);
        box.replaceChildren(
          ...cells.map((sq) => {
            const cell = document.createElement('div');
            cell.className = 'bd-cell bd-ringcell';
            cell.dataset.cell = String(sq);
            const side = Math.floor(sq / 13);
            const along = sq % 13;
            // Walk the outside of the grid, one side at a time.
            const pos = [
              [12, along], [12 - along, 12], [0, 12 - along], [along, 0],
            ][side];
            cell.style.gridRow = String(pos[0] + 1);
            cell.style.gridColumn = String(pos[1] + 1);
            if ((s.safe ?? []).includes(sq)) cell.classList.add('is-safe');
            if ((s.starts ?? []).includes(sq)) cell.classList.add('is-start');
            return cell;
          })
        );
      }
      for (const cell of box.querySelectorAll('.bd-ringcell')) cell.replaceChildren();

      const movable = new Set((s.you?.moves ?? []).map((m) => m.token));
      for (const t of s.tokens ?? []) {
        if (t.square === null || t.home) continue;
        const cell = box.querySelector('[data-cell="' + t.square + '"]');
        if (!cell) continue;
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'bd-coin is-stacked';
        el.style.setProperty('--tint', SEAT_TINT[t.seat % 4]);
        const canMove = t.seat === s.you?.seat && movable.has(t.i);
        el.classList.toggle('can-move', canMove);
        el.disabled = !canMove;
        if (canMove) {
          el.addEventListener('click', () => { Net.action({ type: 'move', token: t.i }); Sound.play('pick'); });
        }
        cell.appendChild(el);
      }

      // The yard and the home column, beside the board.
      $('#bdSeats').replaceChildren(
        ...(s.yards ?? []).map((y) => {
          const el = document.createElement('div');
          el.className = 'bd-seat';
          el.style.setProperty('--tint', SEAT_TINT[y.seat % 4]);
          el.classList.toggle('is-turn', y.seat === s.turn);
          el.classList.toggle('is-you', y.seat === s.you?.seat);
          el.innerHTML = '<i></i><b></b><small></small>';
          el.querySelector('b').textContent = y.name;
          el.querySelector('small').textContent =
            y.yard + ' in the yard · ' + y.home + ' home · ' + y.sent + ' sent';
          return el;
        })
      );

      // Tokens still waiting, so a six has something visible to bring out.
      const waiting = (s.you?.moves ?? []).find((m) => m.enters);
      const acts = $('#bdActs');
      if (waiting) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-primary';
        b.textContent = 'Bring one out';
        b.addEventListener('click', () => { Net.action({ type: 'move', token: waiting.token }); Sound.play('pick'); });
        acts.appendChild(b);
      }
    }

    /** Chess and shogi share a square grid; only the glyphs and drops differ. */
    function paintGrid(s, { size, glyphs, legal, onMove }) {
      const box = $('#bdBoard');
      if (box.dataset.size !== 'grid' + size) {
        box.dataset.size = 'grid' + size;
        box.classList.remove('is-ring', 'is-ladder');
        box.classList.add('is-chequer');
        box.style.setProperty('--n', String(size));
        box.replaceChildren(
          ...Array.from({ length: size * size }, (_, i) => {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'bd-cell bd-square';
            cell.dataset.cell = String(i);
            const r = Math.floor(i / size);
            const c = i % size;
            cell.classList.toggle('is-dark', (r + c) % 2 === 1);
            cell.addEventListener('click', () => onMove(i));
            return cell;
          })
        );
      }

      const from = picked;
      const targets = new Set(from === null ? [] : legal.filter((m) => m.from === from).map((m) => m.to));
      const movable = new Set(legal.map((m) => m.from));

      for (const cell of box.querySelectorAll('.bd-square')) {
        const i = Number(cell.dataset.cell);
        // The board is sent from white's side; black looks at it the other way
        // up, which is what everybody expects and nobody says out loud.
        const at = s.you?.flip ? (size * size - 1 - i) : i;
        const piece = s.board?.[at] ?? null;
        cell.textContent = piece ? (glyphs[piece] ?? piece) : '';
        cell.classList.toggle('is-from', at === from);
        cell.classList.toggle('is-target', targets.has(at));
        cell.classList.toggle('can-move', movable.has(at));
        cell.classList.toggle('is-white', Boolean(piece) && piece === piece.toUpperCase());
        cell.dataset.at = String(at);
      }
    }

    function paintChess(s) {
      paintGrid(s, {
        size: 8,
        glyphs: CHESS_GLYPH,
        legal: s.legal ?? [],
        onMove: (i) => {
          const at = s.you?.flip ? (63 - i) : i;
          const legal = s.legal ?? [];
          if (picked !== null) {
            const move = legal.find((m) => m.from === picked && m.to === at);
            if (move) {
              Net.action({ type: 'move', from: move.from, to: move.to, promote: move.promote ?? 'q' });
              picked = null;
              Sound.play('pick');
              return;
            }
          }
          picked = legal.some((m) => m.from === at) ? at : null;
          Sound.play(picked === null ? 'back' : 'click');
          paint(last);
        },
      });

      $('#bdSeats').replaceChildren(
        ...(s.colours ?? []).map((c) => {
          const el = document.createElement('div');
          el.className = 'bd-seat';
          el.style.setProperty('--tint', c.colour === 'w' ? '#ecf0f1' : '#2c3e50');
          el.classList.toggle('is-turn', c.colour === s.toMove);
          el.classList.toggle('is-you', c.seat === s.you?.seat);
          el.innerHTML = '<i></i><b></b><small></small>';
          el.querySelector('b').textContent = c.name;
          el.querySelector('small').textContent =
            (c.colour === 'w' ? 'White' : 'Black') + (c.colour === s.toMove && s.check ? ' · in check' : '');
          return el;
        })
      );
    }

    function paintShogi(s) {
      paintGrid(s, {
        size: 9,
        glyphs: SHOGI_GLYPH,
        legal: s.legal ?? [],
        onMove: (i) => {
          const at = s.you?.flip ? (80 - i) : i;
          if (dropping) {
            const squares = (s.drops ?? {})[dropping] ?? [];
            if (squares.includes(at)) {
              Net.action({ type: 'move', drop: dropping, to: at });
              dropping = null;
              Sound.play('pick');
              return;
            }
            dropping = null;
            paint(last);
            return;
          }
          const legal = s.legal ?? [];
          if (picked !== null) {
            const move = legal.find((m) => m.from === picked && m.to === at);
            if (move) {
              const both = legal.filter((m) => m.from === picked && m.to === at);
              // Promotion is a choice unless only one of the two is legal.
              const promote = both.length > 1 ? confirm('Promote?') : Boolean(move.promote);
              Net.action({ type: 'move', from: move.from, to: move.to, promote });
              picked = null;
              Sound.play('pick');
              return;
            }
          }
          picked = legal.some((m) => m.from === at) ? at : null;
          Sound.play(picked === null ? 'back' : 'click');
          paint(last);
        },
      });

      // The hands. Tapping one arms a drop; the next tap on the board places it.
      const acts = $('#bdActs');
      const hand = s.you?.hand ?? {};
      for (const kind of Object.keys(hand)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'bd-inhand' + (dropping === kind ? ' is-armed' : '');
        b.textContent = (SHOGI_GLYPH[kind] ?? kind) + ' ×' + hand[kind];
        b.disabled = !((s.drops ?? {})[kind] ?? []).length;
        b.addEventListener('click', () => {
          dropping = dropping === kind ? null : kind;
          picked = null;
          Sound.play('click');
          paint(last);
        });
        acts.appendChild(b);
      }

      $('#bdSeats').replaceChildren(
        ...(s.colours ?? []).map((c) => {
          const el = document.createElement('div');
          el.className = 'bd-seat';
          el.style.setProperty('--tint', c.side === 'b' ? '#2c3e50' : '#bdc3c7');
          el.classList.toggle('is-turn', c.side === s.toMove);
          el.classList.toggle('is-you', c.seat === s.you?.seat);
          el.innerHTML = '<i></i><b></b><small></small>';
          el.querySelector('b').textContent = c.name;
          const inHand = Object.values((s.hands ?? {})[c.side] ?? {}).reduce((n, x) => n + x, 0);
          el.querySelector('small').textContent =
            (c.side === 'b' ? 'Black' : 'White') + ' · ' + inHand + ' in hand';
          return el;
        })
      );
    }

    /** Mahjong: your hand along the bottom, the discards in the middle. */
    function paintMahjong(s) {
      const box = $('#bdBoard');
      box.dataset.size = 'mahjong';
      box.classList.remove('is-ring', 'is-chequer', 'is-ladder');
      box.replaceChildren();

      const pond = document.createElement('div');
      pond.className = 'bd-pond';
      for (const d of s.discards ?? []) {
        const t = document.createElement('span');
        t.className = 'bd-tile is-small';
        t.style.setProperty('--tint', SEAT_TINT[d.seat % 4]);
        t.textContent = tileGlyph(d.tile);
        pond.appendChild(t);
      }
      if (!pond.children.length) {
        const none = document.createElement('span');
        none.className = 'bd-none';
        none.textContent = 'Nothing thrown yet.';
        pond.appendChild(none);
      }
      box.appendChild(pond);

      const wall = document.createElement('span');
      wall.className = 'bd-none';
      wall.textContent = s.wallLeft + ' left in the wall';
      box.appendChild(wall);

      // Your own tiles, which are the only secret in this room.
      const mine = document.createElement('div');
      mine.className = 'bd-hand';
      for (const t of s.you?.hand ?? []) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'bd-tile';
        el.textContent = tileGlyph(t);
        el.title = t;
        el.disabled = !s.you?.canDiscard;
        if (s.you?.canDiscard) {
          el.addEventListener('click', () => { Net.action({ type: 'discard', tile: t }); Sound.play('pick'); });
        }
        mine.appendChild(el);
      }
      box.appendChild(mine);

      const acts = $('#bdActs');
      for (const kind of s.you?.claims ?? []) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ' + (kind === 'win' ? 'btn-primary' : 'btn-ghost');
        b.textContent = kind === 'win' ? 'Mahjong!' : kind;
        b.addEventListener('click', () => { Net.action({ type: 'claim', kind }); Sound.play('buzz'); });
        acts.appendChild(b);
      }
      if (s.you?.canWin && s.you?.canDiscard) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-primary';
        b.textContent = 'Mahjong!';
        b.addEventListener('click', () => { Net.action({ type: 'mahjong' }); Sound.play('win'); });
        acts.appendChild(b);
      }

      $('#bdSeats').replaceChildren(
        ...(s.players ?? []).map((p) => {
          const el = document.createElement('div');
          el.className = 'bd-seat';
          el.style.setProperty('--tint', SEAT_TINT[p.seat % 4]);
          el.classList.toggle('is-turn', p.seat === s.turn);
          el.classList.toggle('is-you', p.seat === s.you?.seat);
          el.innerHTML = '<i></i><b></b><small></small>';
          el.querySelector('b').textContent = p.name;
          el.querySelector('small').textContent =
            p.wind + ' · ' + p.tiles + ' tiles · ' + p.melds.length + ' sets';
          return el;
        })
      );
    }


    /**
     * Chain Reaction: a grid of cells, each drawn as the orbs it holds.
     *
     * A cell one short of bursting is drawn straining, because that is the
     * whole read of the board — you are looking for what is about to go and
     * what it will take with it, and counting dots on forty-eight cells is not
     * something anybody can do at a glance.
     */
    function paintChain(s) {
      const box = $('#bdBoard');
      const shape = 'chain' + s.cols + 'x' + s.rows;
      if (box.dataset.size !== shape) {
        box.dataset.size = shape;
        box.classList.remove('is-ring', 'is-chequer', 'is-ladder');
        box.classList.add('is-chain');
        box.style.setProperty('--n', String(s.cols));
        box.replaceChildren(
          ...Array.from({ length: s.cols * s.rows }, (_, i) => {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'bd-cell bd-orbcell';
            cell.dataset.cell = String(i);
            cell.addEventListener('click', () => {
              if (!cell.classList.contains('can-drop')) { Sound.play('back'); return; }
              Net.action({ type: 'drop', at: i });
              Sound.play('pick');
            });
            return cell;
          })
        );
      }

      const canDrop = new Set(s.you?.canDrop ?? []);
      const cells = box.querySelectorAll('.bd-orbcell');
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const c = (s.cells ?? [])[i];
        if (!c) continue;
        cell.classList.toggle('can-drop', canDrop.has(i));
        // One short of going, which is the thing worth seeing from across a
        // table without counting anything.
        cell.classList.toggle('is-critical', c.n > 0 && c.n === c.cap - 1);
        cell.style.setProperty('--tint', c.owner === null ? 'transparent' : SEAT_TINT[c.owner % 4]);
        const want = c.n;
        if (Number(cell.dataset.n) !== want || cell.dataset.owner !== String(c.owner)) {
          cell.dataset.n = String(want);
          cell.dataset.owner = String(c.owner);
          cell.replaceChildren(
            ...Array.from({ length: want }, () => {
              const orb = document.createElement('i');
              orb.className = 'bd-orb';
              return orb;
            })
          );
        }
      }

      $('#bdSeats').replaceChildren(
        ...(s.counts ?? []).map((p) => {
          const el = document.createElement('div');
          el.className = 'bd-seat';
          el.style.setProperty('--tint', SEAT_TINT[p.seat % 4]);
          el.classList.toggle('is-turn', p.seat === s.turn);
          el.classList.toggle('is-you', p.seat === s.you?.seat);
          el.classList.toggle('is-gone', p.out);
          el.innerHTML = '<i></i><b></b><small></small>';
          el.querySelector('b').textContent = p.name;
          el.querySelector('small').textContent = p.out
            ? 'wiped out'
            : p.cells + ' cells · ' + p.orbs + ' orbs';
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
              hint: s.you?.shutOut
                ? 'Nothing left to cut — you cannot get inside any more.'
                : s.you?.yourTurn && s.you?.canLeaveFirstLayer === false
                  ? 'You cannot leave the outer ring until you have cut somebody.'
                  : NEXT[face] ?? '',
              left: s.turnLeft,
              total: s.phaseTotal,
              yours: Boolean(s.you?.yourTurn),
            }
      );

      // Buttons are rebuilt by the faces that use them, so clear first.
      $('#bdActs').replaceChildren();

      if (face === 'paramapadham') { layOutLadder(s); paintPieces(s); paintDice(s); }
      else if (face === 'ludo') { paintLudo(s); paintDice(s); }
      else if (face === 'chess') paintChess(s);
      else if (face === 'shogi') paintShogi(s);
      else if (face === 'mahjong') paintMahjong(s);
      else if (face === 'chain') paintChain(s);
      else { layOutBoard(s); paintCoins(s); paintDice(s); }

      // Pairing, which only ever applies inside and is always a choice.
      if (face === 'thayam' && s.you?.yourTurn) {
        for (const [a, b] of s.you?.canPair ?? []) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn btn-ghost';
          btn.textContent = 'Pair two coins';
          btn.addEventListener('click', () => {
            Net.action({ type: 'pair', coins: [a, b] });
            Sound.play('pick');
          });
          $('#bdActs').appendChild(btn);
          break;   // one offer is enough; more is a wall of identical buttons
        }
        for (const [a] of s.you?.pairs ?? []) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn btn-quiet';
          btn.textContent = 'Separate the pair';
          btn.addEventListener('click', () => {
            Net.action({ type: 'unpair', coin: a });
            Sound.play('back');
          });
          $('#bdActs').appendChild(btn);
          break;
        }
      }

      // Why a coin will not move. Without this a player whose only coin is
      // stuck at the gate sees "nothing that throw can move" and reasonably
      // concludes the game is broken.
      const stuck = (s.you?.blocked ?? []);
      if (stuck.length) {
        const note = document.createElement('span');
        note.className = 'bd-blocked';
        note.textContent = stuck.some((x) => x.why === 'gate')
          ? 'That would take a coin inside, and you have not cut anybody yet.'
          : 'That would land on a pair, and a single coin cannot cut one.';
        $('#bdActs').appendChild(note);
      }

      // Shut out for good, which is a different thing from blocked for now and
      // deserves to be said in different words. A player who has never cut and
      // has nothing left to cut cannot reach the middle at all — telling them
      // "not yet" would be a lie, and they would sit there throwing sticks at a
      // game that is already decided.
      if (face === 'thayam' && s.you?.shutOut) {
        const note = document.createElement('span');
        note.className = 'bd-blocked bd-shutout';
        note.textContent = 'You never cut anybody, and there is nobody left out here to cut. '
          + 'The inner track is closed to you.';
        $('#bdActs').appendChild(note);
      }

      // What you may do, when the board alone does not make it obvious.
      const acts = $('#bdActs');
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
        if (/brings one home/.test(s.said) && s.said.startsWith(s.seats.find((x) => x.seat === s.you?.seat)?.name ?? ' ')) {
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
