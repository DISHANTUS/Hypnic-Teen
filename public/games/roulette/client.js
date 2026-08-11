// Roulette — the wheel and the felt.
//
// The wheel is drawn rather than pictured, because the pockets have to line up
// with the number the server actually chose. A picture would have to be spun
// to an angle worked out from an image somebody measured once, and it would be
// a degree out on every screen size.
//
// It spins to a pocket the server picked before the animation started. This
// never knows where the ball is going: the result arrives when the wheel
// stops, and the spin is timed to end exactly then. A client told the number
// early is a client that can still be placing bets.

import { Sound } from '/js/sound.js';
import { confetti, floatText, motionReduced } from '/js/fx.js';
import { mountClock, clockFrom } from '/js/turnclock.js';

const TAU = Math.PI * 2;
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colourOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

/** The outside bets, in the order a felt lays them out. */
const OUTSIDE = [
  { kind: 'low', label: '1–18' },
  { kind: 'even', label: 'Even' },
  { kind: 'red', label: 'Red' },
  { kind: 'black', label: 'Black' },
  { kind: 'odd', label: 'Odd' },
  { kind: 'high', label: '19–36' },
];
const DOZENS = [
  { kind: 'dozen1', label: '1st 12' },
  { kind: 'dozen2', label: '2nd 12' },
  { kind: 'dozen3', label: '3rd 12' },
];

/**
 * What each phase is called, and what happens after it.
 *
 * The second half is the point: a clock says how long is left and says nothing
 * about what is about to happen, which was the other half of the complaint.
 */
const CLOCK_PHASES = {
    brief: { label: 'Everybody is reading the rules', hint: 'Then betting opens.' },
    bets: { label: 'Place your bets', hint: 'Then the wheel — no house, so the pot is only what is on the table.' },
    spin: { label: 'Wheel is going', hint: 'It lands where it lands.' },
    payout: { label: 'Paying out', hint: 'Then the next spin.' },
  };

export default {
  mount({ canvas, wrap, hud, Net }) {
    canvas.style.display = 'none';
    wrap.classList.add('rl-stage');

    const root = document.createElement('div');
    root.className = 'rl';
    root.innerHTML = `
      <div class="rl-brief intro-card" hidden>
        <h2>Roulette</h2>
        <p class="muted">One wheel, and no house. Every chip on the table goes to whoever wins it.</p>
        <ol class="intro-rules" id="rlRules"></ol>
        <button class="btn btn-primary intro-ready" id="rlBriefed" type="button">Ready</button>
        <p class="muted small" id="rlBriefWait"></p>
      </div>

      <div class="rl-table" hidden>
        <div class="rl-top">
          <canvas class="rl-wheel" id="rlWheel" width="360" height="360"></canvas>
          <div class="rl-pot">
            <span class="rl-pot-label">In the middle</span>
            <b id="rlPot">0</b>
            <small id="rlCarried"></small>
          </div>
        </div>

        <div class="rl-result" id="rlResult" hidden></div>

        <div class="rl-mine">
          <span>You have <b id="rlChips">0</b> chips</span>
          <span id="rlStaked"></span>
          <button class="btn btn-quiet btn-sm" id="rlClear" type="button">Take it back</button>
        </div>

        <div class="rl-stack" id="rlStack"></div>
        <div class="rl-felt" id="rlFelt"></div>
        <ul class="rl-log" id="rlLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="rlRound">Spin 1</span>
        <span class="hud-chip" id="rlClock">—</span>
        <span class="hud-chip hud-accent" id="rlPhase">Place your bets</span>
      </div>`;

    const clock = mountClock(hud);

    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);

    const brief = $('.rl-brief');
    const table = $('.rl-table');
    const wheelCanvas = $('#rlWheel');
    const ctx = wheelCanvas.getContext('2d');
    const feltBox = $('#rlFelt');
    const resultBox = $('#rlResult');

    let state = null;
    /** Which chip value is loaded, so tapping the felt places that much. */
    let chipSize = 25;
    /** Where the wheel is pointing, in turns. Animated towards a target. */
    let angle = 0;
    let target = null;
    let spinning = false;
    let raf = 0;
    let shownRound = 0;
    let shownResult = null;

    /* ------------------------------ the brief ------------------------------ */

    $('#rlBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#rlBriefed').disabled = true;
      $('#rlBriefed').textContent = 'Waiting for the table…';
    });

    $('#rlClear').addEventListener('click', () => {
      Net.action({ type: 'clear' });
      Sound.play('back');
    });

    /* ------------------------------- the wheel ------------------------------ */

    function drawWheel(wheel) {
      const size = wheelCanvas.width;
      const mid = size / 2;
      const r = mid - 6;
      const slice = TAU / wheel.length;

      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(mid, mid);
      // The pointer sits at the top, so the wheel turns under it.
      ctx.rotate(-angle * TAU - Math.PI / 2 - slice / 2);

      const paint = { red: '#c8392b', black: '#22242c', green: '#1f8f5f' };
      for (let i = 0; i < wheel.length; i++) {
        const n = wheel[i];
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, i * slice, (i + 1) * slice);
        ctx.closePath();
        ctx.fillStyle = paint[colourOf(n)];
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // The number, standing up out of the rim.
        ctx.save();
        ctx.rotate((i + 0.5) * slice);
        ctx.translate(r - 15, 0);
        ctx.rotate(Math.PI / 2);
        ctx.fillStyle = '#fff';
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n), 0, 0);
        ctx.restore();
      }

      // The hub, so the middle is not a mess of thirty-seven points.
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.42, 0, TAU);
      ctx.fillStyle = '#14161d';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.stroke();
      ctx.restore();

      // The pointer. Drawn last and unrotated — it does not move.
      ctx.beginPath();
      ctx.moveTo(mid, 2);
      ctx.lineTo(mid - 9, 20);
      ctx.lineTo(mid + 9, 20);
      ctx.closePath();
      ctx.fillStyle = '#f5c451';
      ctx.fill();

      // Which pocket is actually under the pointer, published so it can be
      // checked. A wheel that stops next to the winning number rather than on
      // it looks like a rigged table and cannot be caught by any test that
      // only reads the number printed underneath.
      const under = ((Math.round(angle * wheel.length) % wheel.length) + wheel.length) % wheel.length;
      wheelCanvas.dataset.pocket = String(wheel[under]);
    }

    /**
     * Spins to a pocket over a set number of seconds.
     *
     * Eased out hard at the end, because a wheel that stops at a constant
     * speed reads as a list scrolling rather than as something with weight.
     */
    function spinTo(pocketIndex, total, seconds) {
      if (motionReduced) {
        angle = pocketIndex / total;
        drawWheel(state.wheel);
        return;
      }
      const from = angle;
      // Whole turns, then the pocket. Whole matters: this was
      // `4 + Math.random() * 2`, which is four-and-a-bit turns, and the bit
      // became a random offset added to the landing. The wheel stopped
      // somewhere near the right number every time and on it never — the
      // result said 11 while the pointer sat over 33.
      const turns = 4 + Math.floor(Math.random() * 3);
      const to = Math.floor(from) + turns + pocketIndex / total;
      const started = performance.now();
      const ms = seconds * 1000;
      spinning = true;
      Sound.play('spin');

      cancelAnimationFrame(raf);
      const step = (now) => {
        const t = Math.min(1, (now - started) / ms);
        // Quintic ease-out: fast, then a long settle.
        const eased = 1 - Math.pow(1 - t, 5);
        angle = from + (to - from) * eased;
        drawWheel(state.wheel);
        if (t < 1) raf = requestAnimationFrame(step);
        else spinning = false;
      };
      raf = requestAnimationFrame(step);
    }

    /* -------------------------------- the felt ------------------------------ */

    function layOutFelt() {
      if (feltBox.dataset.built) return;
      feltBox.dataset.built = '1';

      const chipsOn = (kind, number) => {
        const box = document.createElement('span');
        box.className = 'rl-onit';
        box.dataset.spot = number === null || number === undefined ? kind : `straight:${number}`;
        return box;
      };

      // Zero, then the three rows of twelve, then the outside bets.
      const grid = document.createElement('div');
      grid.className = 'rl-numbers';

      const zero = document.createElement('button');
      zero.type = 'button';
      zero.className = 'rl-spot rl-zero';
      zero.dataset.kind = 'straight';
      zero.dataset.number = '0';
      zero.innerHTML = '<span class="rl-spot-label">0</span>';
      zero.appendChild(chipsOn('straight', 0));
      grid.appendChild(zero);

      for (let n = 1; n <= 36; n++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `rl-spot rl-num is-${colourOf(n)}`;
        cell.dataset.kind = 'straight';
        cell.dataset.number = String(n);
        cell.innerHTML = `<span class="rl-spot-label">${n}</span>`;
        cell.appendChild(chipsOn('straight', n));
        grid.appendChild(cell);
      }
      feltBox.appendChild(grid);

      const rows = document.createElement('div');
      rows.className = 'rl-outside';
      for (const group of [DOZENS, OUTSIDE]) {
        const row = document.createElement('div');
        row.className = 'rl-outside-row';
        for (const b of group) {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = `rl-spot rl-out is-${b.kind}`;
          cell.dataset.kind = b.kind;
          cell.innerHTML = `<span class="rl-spot-label">${b.label}</span>`;
          cell.appendChild(chipsOn(b.kind));
          row.appendChild(cell);
        }
        rows.appendChild(row);
      }
      feltBox.appendChild(rows);

      feltBox.addEventListener('click', (e) => {
        const spot = e.target.closest('.rl-spot');
        if (!spot || state?.phase !== 'bets') return;
        const kind = spot.dataset.kind;
        const number = spot.dataset.number === undefined ? null : Number(spot.dataset.number);
        if ((state.you?.chips ?? 0) < chipSize) return floatText(spot, 'no chips', 'loss');
        Net.action({ type: 'bet', kind, amount: chipSize, number });
        Sound.play('pick');
      });
    }

    function paintFelt(s) {
      // Everything the room has on each spot, so you can see the table filling
      // up — watching somebody put their whole stack on 17 is most of the fun.
      const totals = new Map();
      const mine = new Map();
      for (const b of s.bets) {
        const key = b.kind === 'straight' ? `straight:${b.number}` : b.kind;
        totals.set(key, (totals.get(key) ?? 0) + b.amount);
        if (b.id === s.you?.id) mine.set(key, (mine.get(key) ?? 0) + b.amount);
      }

      for (const box of feltBox.querySelectorAll('.rl-onit')) {
        const key = box.dataset.spot;
        const all = totals.get(key) ?? 0;
        box.textContent = all ? String(all) : '';
        box.classList.toggle('is-mine', (mine.get(key) ?? 0) > 0);
        box.hidden = !all;
      }

      const open = s.phase === 'bets';
      for (const spot of feltBox.querySelectorAll('.rl-spot')) spot.disabled = !open;
      feltBox.classList.toggle('is-closed', !open);
    }

    function paintStack(s) {
      const box = $('#rlStack');
      const sizes = [5, 25, 100, 500].filter((n) => n <= Math.max(s.maxBet, 5));
      if (box.dataset.built !== sizes.join(',')) {
        box.dataset.built = sizes.join(',');
        box.replaceChildren(
          ...sizes.map((n) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'rl-chip';
            b.dataset.value = String(n);
            b.textContent = String(n);
            b.addEventListener('click', () => {
              chipSize = n;
              for (const other of box.querySelectorAll('.rl-chip')) {
                other.classList.toggle('is-on', other === b);
              }
              Sound.play('click');
            });
            return b;
          })
        );
        if (!sizes.includes(chipSize)) chipSize = sizes[0];
      }
      for (const b of box.querySelectorAll('.rl-chip')) {
        b.classList.toggle('is-on', Number(b.dataset.value) === chipSize);
        b.disabled = Number(b.dataset.value) > (s.you?.chips ?? 0);
      }
    }

    /* -------------------------------- painting ------------------------------ */

    function paint(s) {
      // Whose turn, how long, and what comes next.
      clock.paint(clockFrom(s, CLOCK_PHASES, { yours: Boolean(s.you?.yourTurn ?? s.you?.can ?? s.you?.canPlay) }));
      state = s;

      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        const list = $('#rlRules');
        if (!list.children.length) {
          list.replaceChildren(
            ...(s.rules ?? []).map((line) => {
              const li = document.createElement('li');
              li.textContent = line;
              return li;
            })
          );
        }
        const waiting = s.players.filter((p) => p.connected && !s.briefed.includes(p.id)).length;
        $('#rlBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        $hud('#rlClock').textContent = `${s.timeLeft}s`;
        return;
      }

      brief.hidden = true;
      table.hidden = false;
      layOutFelt();

      $hud('#rlRound').textContent = `Spin ${s.round} of ${s.maxRounds}`;
      $hud('#rlClock').textContent = s.phase === 'over' ? 'done' : `${s.timeLeft}s`;
      $hud('#rlPhase').textContent =
        s.phase === 'bets' ? 'Place your bets' :
        s.phase === 'spin' ? 'No more bets' :
        s.phase === 'payout' ? 'Paying out' : 'Table closed';

      $('#rlPot').textContent = String(s.pot);
      $('#rlCarried').textContent = s.carried ? `${s.carried} riding from last spin` : '';
      $('#rlChips').textContent = String(s.you?.chips ?? 0);
      $('#rlStaked').textContent = s.you?.staked ? `${s.you.staked} on the table` : '';
      $('#rlClear').hidden = s.phase !== 'bets' || !s.you?.staked;

      paintStack(s);
      paintFelt(s);

      // A new spin: clear the last result and stop the wheel drifting.
      if (shownRound !== s.round) {
        shownRound = s.round;
        shownResult = null;
        resultBox.hidden = true;
        drawWheel(s.wheel);
      }

      // The wheel turns while the ball is in the air. The number is not here
      // yet — the server sends it only when the wheel stops — so this spins to
      // nowhere in particular and the real landing happens below.
      if (s.phase === 'spin' && !spinning && !s.result) {
        spinTo(Math.floor(Math.random() * s.wheel.length), s.wheel.length, s.phaseTotal);
      }

      if (s.result && shownResult !== `${s.round}:${s.result.number}`) {
        shownResult = `${s.round}:${s.result.number}`;
        // Land it properly now that the number is known.
        spinTo(s.result.pocket, s.wheel.length, motionReduced ? 0 : 0.9);

        const mine = s.result.paid.find((p) => p.id === s.you?.id);
        resultBox.hidden = false;
        resultBox.className = `rl-result is-${s.result.colour}`;
        resultBox.innerHTML =
          '<b class="rl-result-num"></b><span class="rl-result-said"></span><div class="rl-result-paid"></div>';
        resultBox.querySelector('.rl-result-num').textContent = String(s.result.number);
        resultBox.querySelector('.rl-result-said').textContent =
          s.result.paid.length
            ? `${s.result.pot} chips shared`
            : `Nobody had it — ${s.result.carried} rides on`;
        resultBox.querySelector('.rl-result-paid').replaceChildren(
          ...s.result.paid.slice(0, 5).map((p) => {
            const row = document.createElement('span');
            row.className = 'rl-paid';
            row.classList.toggle('is-you', p.id === s.you?.id);
            row.innerHTML = '<i></i><b></b>';
            row.querySelector('i').textContent = p.name;
            row.querySelector('b').textContent = `+${p.chips}`;
            return row;
          })
        );

        if (mine) {
          Sound.play(mine.chips > mine.staked ? 'win' : 'correct');
          if (mine.chips > mine.staked * 3) confetti(table, { count: 50 });
        } else if (s.you?.staked) {
          Sound.play('lose');
        }
      }

      $('#rlLog').replaceChildren(
        ...(s.log ?? []).slice(-3).reverse().map((line) => {
          const li = document.createElement('li');
          li.textContent = line;
          return li;
        })
      );
    }

    const off = Net.on('game:state', paint);

    return () => {
      clock.destroy();
      cancelAnimationFrame(raf);
      off?.();
      wrap.classList.remove('rl-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
