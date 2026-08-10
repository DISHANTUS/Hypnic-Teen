// The Lottery — the counter and the draw.
//
// Picking six numbers on a phone has to be one thumb and no thinking, so the
// grid is big buttons and there is a lucky dip beside it for people who do not
// care which six. Everybody's tickets are on show while the counter is open,
// because half the fun is watching three people back the same numbers.
//
// The balls arrive one at a time. They are all decided on the server before
// the first one drops — this only knows them once the draw is over, and it
// reveals them on a delay so the room gets the pause between each.

import { Sound } from '/js/sound.js';
import { confetti, floatText, pulse, motionReduced } from '/js/fx.js';
import { mountClock, clockFrom } from '/js/turnclock.mjs';

/**
 * What each phase is called, and what happens after it.
 *
 * The second half is the point: a clock says how long is left and says nothing
 * about what is about to happen, which was the other half of the complaint.
 */
const CLOCK_PHASES = {
    brief: { label: 'Everybody is reading the rules', hint: 'Then the counter opens.' },
    buy: { label: 'Buy your tickets', hint: 'Six numbers, one draw, every chip in the pot.' },
    draw: { label: 'Drawing', hint: 'The balls come one at a time.' },
    payout: { label: 'Paying out', hint: 'Nobody wins and it rides on.' },
  };

export default {
  mount({ canvas, wrap, hud, Net }) {
    canvas.style.display = 'none';
    wrap.classList.add('lo-stage');

    const root = document.createElement('div');
    root.className = 'lo';
    root.innerHTML = `
      <div class="lo-brief intro-card" hidden>
        <h2>The Lottery</h2>
        <p class="muted">Six numbers, one draw, and every chip spent is in the pot. Nothing is kept back.</p>
        <ol class="intro-rules" id="loRules"></ol>
        <button class="btn btn-primary intro-ready" id="loBriefed" type="button">Ready</button>
        <p class="muted small" id="loBriefWait"></p>
      </div>

      <div class="lo-table" hidden>
        <div class="lo-pot"><span>In the pot</span><b id="loPot">0</b><small id="loCarried"></small></div>
        <div class="lo-balls" id="loBalls"></div>
        <div class="lo-said" id="loSaid"></div>

        <div class="lo-pick" id="loPick">
          <div class="lo-grid" id="loGrid"></div>
          <div class="lo-buy">
            <span class="lo-chosen" id="loChosen">Pick six</span>
            <button class="btn btn-ghost btn-sm" id="loDip" type="button">Lucky dip</button>
            <button class="btn btn-primary" id="loBuy" type="button">Buy</button>
          </div>
        </div>

        <div class="lo-mine" id="loMine"></div>
        <div class="lo-tickets" id="loTickets"></div>
        <ul class="lo-log" id="loLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="loRound">Draw 1</span>
        <span class="hud-chip" id="loClock">—</span>
        <span class="hud-chip hud-accent" id="loPhase">Counter open</span>
      </div>`;

    const clock = mountClock(hud);

    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);
    const brief = $('.lo-brief');
    const table = $('.lo-table');
    const ballBox = $('#loBalls');

    /** The six this player is choosing. */
    let chosen = new Set();
    let shownRound = 0;
    let shownDraw = null;
    let ballTimers = [];

    const clearBalls = () => {
      for (const t of ballTimers) clearTimeout(t);
      ballTimers = [];
    };

    $('#loBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#loBriefed').disabled = true;
      $('#loBriefed').textContent = 'Waiting for the room…';
    });

    $('#loDip').addEventListener('click', () => {
      const pool = Number(table.dataset.pool || 30);
      chosen = new Set();
      while (chosen.size < 6) chosen.add(1 + Math.floor(Math.random() * pool));
      paintGrid();
      Sound.play('click');
    });

    $('#loBuy').addEventListener('click', () => {
      Net.action({ type: 'buy', numbers: [...chosen] });
      Sound.play('pick');
      pulse($('#loBuy'));
      chosen = new Set();
      paintGrid();
    });

    function layOutGrid(pool) {
      const grid = $('#loGrid');
      if (grid.dataset.pool === String(pool)) return;
      grid.dataset.pool = String(pool);
      table.dataset.pool = String(pool);
      grid.replaceChildren(
        ...Array.from({ length: pool }, (_, i) => {
          const n = i + 1;
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'lo-num';
          b.dataset.n = String(n);
          b.textContent = String(n);
          b.addEventListener('click', () => {
            if (chosen.has(n)) chosen.delete(n);
            // Six is six. Tapping a seventh swaps the earliest out rather than
            // refusing, which is what a thumb expects.
            else {
              if (chosen.size >= 6) chosen.delete([...chosen][0]);
              chosen.add(n);
            }
            paintGrid();
            Sound.play('click');
          });
          return b;
        })
      );
    }

    function paintGrid() {
      for (const b of $('#loGrid').querySelectorAll('.lo-num')) {
        b.classList.toggle('is-on', chosen.has(Number(b.dataset.n)));
      }
      $('#loChosen').textContent = chosen.size
        ? [...chosen].sort((a, b) => a - b).join(' · ')
        : 'Pick six, or take a lucky dip';
    }

    /** The balls, one at a time, so the room gets the pause between each. */
    function dropBalls(drawn) {
      clearBalls();
      ballBox.replaceChildren();
      drawn.forEach((n, i) => {
        ballTimers.push(
          setTimeout(() => {
            const ball = document.createElement('span');
            ball.className = 'lo-ball';
            ball.textContent = String(n);
            ballBox.appendChild(ball);
            Sound.play(i === drawn.length - 1 ? 'reveal' : 'tick');
          }, motionReduced ? 0 : i * 420)
        );
      });
    }

    function paint(s) {
      // Whose turn, how long, and what comes next.
      clock.paint(clockFrom(s, CLOCK_PHASES, { yours: Boolean(s.you?.yourTurn ?? s.you?.can ?? s.you?.canPlay) }));
      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        const list = $('#loRules');
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
        $('#loBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        $hud('#loClock').textContent = `${s.timeLeft}s`;
        return;
      }

      brief.hidden = true;
      table.hidden = false;
      layOutGrid(s.pool);

      $hud('#loRound').textContent = `Draw ${s.round} of ${s.maxRounds}`;
      $hud('#loClock').textContent = s.phase === 'over' ? 'closed' : `${s.timeLeft}s`;
      $hud('#loPhase').textContent =
        s.phase === 'buy' ? 'Counter open' : s.phase === 'draw' ? 'Drawing' :
        s.phase === 'payout' ? 'Paying out' : 'Counter closed';

      $('#loPot').textContent = String(s.pot);
      $('#loCarried').textContent = s.carried ? `${s.carried} riding from last draw` : '';
      $('#loPick').hidden = s.phase !== 'buy';
      $('#loBuy').textContent = `Buy · ${s.ticketPrice}`;
      $('#loBuy').disabled = (s.you?.chips ?? 0) < s.ticketPrice;

      if (shownRound !== s.round) {
        shownRound = s.round;
        shownDraw = null;
        ballBox.replaceChildren();
        $('#loSaid').textContent = '';
        clearBalls();
      }

      // Your own tickets, and how they are doing once the numbers are out.
      const hits = new Set(s.drawn ?? []);
      $('#loMine').replaceChildren(
        ...(s.you?.tickets ?? []).map((t) => {
          const row = document.createElement('div');
          row.className = 'lo-ticket is-mine';
          for (const n of t.numbers) {
            const cell = document.createElement('span');
            cell.className = 'lo-tnum';
            cell.classList.toggle('is-hit', hits.has(n));
            cell.textContent = String(n);
            row.appendChild(cell);
          }
          if (s.drawn) {
            const got = t.numbers.filter((n) => hits.has(n)).length;
            const tag = document.createElement('small');
            tag.textContent = `${got} matched`;
            row.appendChild(tag);
          }
          return row;
        })
      );

      // Everybody else's, so the room can see who backed what.
      $('#loTickets').replaceChildren(
        ...s.tickets.filter((t) => t.id !== s.you?.id).slice(0, 24).map((t) => {
          const row = document.createElement('div');
          row.className = 'lo-ticket';
          const who = document.createElement('b');
          who.textContent = t.name;
          row.appendChild(who);
          for (const n of t.numbers) {
            const cell = document.createElement('span');
            cell.className = 'lo-tnum';
            cell.classList.toggle('is-hit', hits.has(n));
            cell.textContent = String(n);
            row.appendChild(cell);
          }
          return row;
        })
      );

      if (s.drawn && shownDraw !== `${s.round}:${s.drawn.join(',')}`) {
        shownDraw = `${s.round}:${s.drawn.join(',')}`;
        dropBalls(s.drawn);
        setTimeout(() => {
          $('#loSaid').textContent = s.result?.said ?? '';
          const mine = s.result?.paid?.find((p) => p.id === s.you?.id);
          if (mine) {
            Sound.play('win');
            confetti(table, { count: 70 });
            floatText($('#loPot'), `+${mine.chips}`, 'gain');
          }
        }, motionReduced ? 0 : s.drawn.length * 420 + 300);
      }

      $('#loLog').replaceChildren(
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
      clearBalls();
      off?.();
      wrap.classList.remove('lo-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
