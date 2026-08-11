// Bingo — the card, the caller, and one button.
//
// The card marks itself, and nothing on this screen ever says "you have a
// line". That absence is the game: the server knows, and it is not telling.
// All the help you get is that called squares look different from uncalled
// ones, which is exactly what a dabber gives you in a real hall.
//
// The claim button is deliberately large and deliberately unguarded. It does
// not check first and it does not grey itself out when you have nothing —
// pressing it on nothing costs you three calls, and knowing that is what makes
// the room hesitate.

import { Sound } from '/js/sound.js';
import { confetti, floatText, pulse, motionReduced } from '/js/fx.js';
import { mountClock, clockFrom } from '/js/turnclock.js';

/**
 * What each phase is called, and what happens after it.
 *
 * The second half is the point: a clock says how long is left and says nothing
 * about what is about to happen, which was the other half of the complaint.
 */
const CLOCK_PHASES = {
    brief: { label: 'Everybody is reading the rules', hint: 'Then the counter opens.' },
    buy: { label: 'Buy a card', hint: 'Then the numbers start, one at a time.' },
    call: { label: 'Numbers are being called', hint: 'Nothing tells you when you have a line. Spot it yourself.' },
    payout: { label: 'Paying out', hint: 'Then the next game.' },
  };

export default {
  mount({ canvas, wrap, hud, Net }) {
    canvas.style.display = 'none';
    wrap.classList.add('bi-stage');

    const root = document.createElement('div');
    root.className = 'bi';
    root.innerHTML = `
      <div class="bi-brief intro-card" hidden>
        <h2>Bingo</h2>
        <p class="muted">Fifty numbers, a card each, and nobody tells you when you have it.</p>
        <ol class="intro-rules" id="biRules"></ol>
        <button class="btn btn-primary intro-ready" id="biBriefed" type="button">Ready</button>
        <p class="muted small" id="biBriefWait"></p>
      </div>

      <div class="bi-table" hidden>
        <div class="bi-pot"><span>In the pot</span><b id="biPot">0</b><small id="biCarried"></small></div>

        <div class="bi-caller">
          <div class="bi-ball" id="biBall">—</div>
          <div class="bi-said" id="biSaid">Waiting on the caller</div>
        </div>

        <div class="bi-buy" id="biBuy">
          <button class="btn btn-primary" id="biBuyCard" type="button">Buy a card</button>
          <span class="muted small" id="biSold"></span>
        </div>

        <div class="bi-card" id="biCard" hidden></div>
        <button class="btn btn-big bi-claim" id="biClaim" type="button" hidden>Bingo!</button>
        <p class="bi-locked muted small" id="biLocked"></p>

        <div class="bi-prizes" id="biPrizes"></div>
        <div class="bi-called" id="biCalled"></div>
        <ul class="bi-log" id="biLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="biRound">Game 1</span>
        <span class="hud-chip" id="biClock">—</span>
        <span class="hud-chip hud-accent" id="biPhase">Buying in</span>
      </div>`;

    const clock = mountClock(hud);

    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);
    const brief = $('.bi-brief');
    const table = $('.bi-table');

    let shownRound = 0;
    let shownCall = 0;
    let shownResult = null;

    $('#biBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#biBriefed').disabled = true;
      $('#biBriefed').textContent = 'Waiting for the room…';
    });

    $('#biBuyCard').addEventListener('click', () => {
      Net.action({ type: 'buy' });
      Sound.play('pick');
      pulse($('#biBuyCard'));
    });

    $('#biClaim').addEventListener('click', () => {
      Net.action({ type: 'claim' });
      Sound.play('click');
      pulse($('#biClaim'));
    });

    /** The twenty five squares. Laid out once, then only the marks change. */
    function layOutCard(cells, columns) {
      const box = $('#biCard');
      const key = cells.join(',');
      if (box.dataset.key === key) return;
      box.dataset.key = key;

      const head = document.createElement('div');
      head.className = 'bi-head';
      for (const letter of columns) {
        const cell = document.createElement('span');
        cell.textContent = letter;
        head.appendChild(cell);
      }

      const grid = document.createElement('div');
      grid.className = 'bi-grid';
      cells.forEach((n, i) => {
        const cell = document.createElement('span');
        cell.className = 'bi-sq';
        cell.dataset.n = n === null ? 'free' : String(n);
        cell.dataset.at = String(i);
        cell.textContent = n === null ? '★' : String(n);
        if (n === null) cell.classList.add('is-free', 'is-on');
        grid.appendChild(cell);
      });

      box.replaceChildren(head, grid);
    }

    /** Marks. The card does this for you; spotting the line does not. */
    function markCard(calls) {
      const called = new Set(calls);
      for (const cell of $('#biCard').querySelectorAll('.bi-sq')) {
        if (cell.classList.contains('is-free')) continue;
        cell.classList.toggle('is-on', called.has(Number(cell.dataset.n)));
      }
    }

    function paint(s) {
      // Whose turn, how long, and what comes next.
      clock.paint(clockFrom(s, CLOCK_PHASES, { yours: Boolean(s.you?.yourTurn ?? s.you?.can ?? s.you?.canPlay) }));
      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        const list = $('#biRules');
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
        $('#biBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        $hud('#biClock').textContent = `${s.timeLeft}s`;
        return;
      }

      brief.hidden = true;
      table.hidden = false;

      $hud('#biRound').textContent = `Game ${s.round} of ${s.maxRounds}`;
      $hud('#biClock').textContent = s.phase === 'over' ? 'closed' : `${s.timeLeft}s`;
      $hud('#biPhase').textContent =
        s.phase === 'buy' ? 'Buying in' : s.phase === 'call' ? `${s.callsLeft} left in the bag` :
        s.phase === 'payout' ? 'Paying out' : 'Book closed';

      $('#biPot').textContent = String(s.pot);
      $('#biCarried').textContent = s.carried ? `${s.carried} riding from last game` : '';

      if (shownRound !== s.round) {
        shownRound = s.round;
        shownCall = 0;
        shownResult = null;
        $('#biCard').dataset.key = '';
        $('#biSaid').textContent = 'Waiting on the caller';
        $('#biBall').textContent = '—';
      }

      // Buying in.
      const mine = s.you?.card ?? null;
      $('#biBuy').hidden = s.phase !== 'buy' || Boolean(mine);
      $('#biBuyCard').textContent = `Buy a card · ${s.ante}`;
      $('#biBuyCard').disabled = (s.you?.chips ?? 0) < s.ante;
      $('#biSold').textContent = s.cards.length
        ? `${s.cards.length} card${s.cards.length === 1 ? '' : 's'} sold`
        : 'No cards sold yet';

      // The card.
      $('#biCard').hidden = !mine;
      if (mine) {
        layOutCard(mine, s.columns);
        markCard(s.calls);
      }

      // The caller.
      if (s.lastCall && shownCall !== s.calls.length) {
        shownCall = s.calls.length;
        $('#biBall').textContent = String(s.lastCall);
        $('#biSaid').textContent = s.lastCallSaid;
        if (!motionReduced) {
          $('#biBall').classList.remove('is-new');
          void $('#biBall').offsetWidth;
          $('#biBall').classList.add('is-new');
        }
        Sound.play('tick');
      }

      // The one button.
      const claiming = s.phase === 'call' && Boolean(mine);
      $('#biClaim').hidden = !claiming;
      $('#biClaim').disabled = (s.you?.lockedFor ?? 0) > 0;
      $('#biLocked').textContent = s.you?.lockedFor
        ? `Called early — ${s.you.lockedFor} more call${s.you.lockedFor === 1 ? '' : 's'} to sit out.`
        : '';

      // What has gone and what is left.
      $('#biPrizes').replaceChildren(
        ...[
          ['A line', s.line ? s.line.name : null],
          ['Full house', s.house ? s.house.name : null],
        ].map(([what, who]) => {
          const row = document.createElement('div');
          row.className = 'bi-prize';
          row.classList.toggle('is-gone', Boolean(who));
          row.innerHTML = `<span>${what}</span><b></b>`;
          row.querySelector('b').textContent = who ?? 'still up';
          return row;
        })
      );

      $('#biCalled').replaceChildren(
        ...s.calls.slice(-18).map((n) => {
          const b = document.createElement('span');
          b.className = 'bi-chip';
          b.textContent = String(n);
          return b;
        })
      );

      // The result.
      if (s.result && shownResult !== `${s.round}:${s.result.calls}`) {
        shownResult = `${s.round}:${s.result.calls}`;
        $('#biSaid').textContent = s.result.said;
        const won = s.result.paid.filter((p) => p.id === s.you?.id);
        if (won.length) {
          Sound.play('win');
          confetti(table, { count: 80 });
          floatText($('#biPot'), `+${won.reduce((sum, p) => sum + p.chips, 0)}`, 'gain');
        }
      }

      $('#biLog').replaceChildren(
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
      off?.();
      wrap.classList.remove('bi-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
