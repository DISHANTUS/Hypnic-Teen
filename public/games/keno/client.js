// Keno — eighty numbers, pick up to ten.
//
// The one decision the game has is how many spots to play, so that is the
// thing the screen makes obvious: a running count, and what a full card is
// worth against a long one. Everything else is a grid of eighty buttons, which
// on a phone means small buttons and no way around it — so the ones you have
// picked are the loudest thing on the board.

import { Sound } from '/js/sound.js';
import { confetti, floatText, motionReduced } from '/js/fx.js';
import { mountClock, clockFrom } from '/js/turnclock.mjs';

/**
 * What each phase is called, and what happens after it.
 *
 * The second half is the point: a clock says how long is left and says nothing
 * about what is about to happen, which was the other half of the complaint.
 */
const CLOCK_PHASES = {
    brief: { label: 'Everybody is reading the rules', hint: 'Then the counter opens.' },
    buy: { label: 'Pick your numbers', hint: 'Twenty come out of eighty.' },
    draw: { label: 'Drawing', hint: 'A long card that comes in is worth far more.' },
    payout: { label: 'Paying out', hint: 'Nobody hits and the pot rides on.' },
  };

export default {
  mount({ canvas, wrap, hud, Net }) {
    canvas.style.display = 'none';
    wrap.classList.add('kn-stage');

    const root = document.createElement('div');
    root.className = 'kn';
    root.innerHTML = `
      <div class="kn-brief intro-card" hidden>
        <h2>Keno</h2>
        <p class="muted">Pick up to ten from eighty. Twenty come out, and every chip is in the pot.</p>
        <ol class="intro-rules" id="knRules"></ol>
        <button class="btn btn-primary intro-ready" id="knBriefed" type="button">Ready</button>
        <p class="muted small" id="knBriefWait"></p>
      </div>

      <div class="kn-table" hidden>
        <div class="kn-pot"><span>In the pot</span><b id="knPot">0</b><small id="knCarried"></small></div>
        <div class="kn-said" id="knSaid"></div>
        <div class="kn-grid" id="knGrid"></div>
        <div class="kn-buy" id="knBuy">
          <span class="kn-picked" id="knPicked">Pick between one and ten</span>
          <button class="btn btn-ghost btn-sm" id="knDip" type="button">Quick pick</button>
          <button class="btn btn-primary" id="knGo" type="button">Buy</button>
        </div>
        <ul class="kn-log" id="knLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="knRound">Draw 1</span>
        <span class="hud-chip" id="knClock">—</span>
        <span class="hud-chip hud-accent" id="knPhase">Pick your spots</span>
      </div>`;

    const clock = mountClock(hud);

    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);
    const brief = $('.kn-brief');
    const table = $('.kn-table');

    let picked = new Set();
    let shownRound = 0;
    let shownDraw = null;
    let drawTimers = [];

    const clearDraw = () => {
      for (const t of drawTimers) clearTimeout(t);
      drawTimers = [];
    };

    $('#knBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#knBriefed').disabled = true;
      $('#knBriefed').textContent = 'Waiting for the room…';
    });

    $('#knDip').addEventListener('click', () => {
      picked = new Set();
      while (picked.size < 5) picked.add(1 + Math.floor(Math.random() * 80));
      paintPicks();
      Sound.play('click');
    });

    $('#knGo').addEventListener('click', () => {
      Net.action({ type: 'buy', spots: [...picked] });
      Sound.play('pick');
    });

    function layOutGrid() {
      const grid = $('#knGrid');
      if (grid.dataset.built) return;
      grid.dataset.built = '1';
      grid.replaceChildren(
        ...Array.from({ length: 80 }, (_, i) => {
          const n = i + 1;
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'kn-num';
          b.dataset.n = String(n);
          b.textContent = String(n);
          b.addEventListener('click', () => {
            if (picked.has(n)) picked.delete(n);
            else {
              // Ten is ten. A eleventh swaps the earliest out rather than
              // refusing, which is what a thumb expects.
              if (picked.size >= 10) picked.delete([...picked][0]);
              picked.add(n);
            }
            paintPicks();
            Sound.play('click');
          });
          return b;
        })
      );
    }

    function paintPicks(drawn = null, card = null) {
      const hits = new Set(drawn ?? []);
      for (const b of $('#knGrid').querySelectorAll('.kn-num')) {
        const n = Number(b.dataset.n);
        const onCard = card ? card.spots.includes(n) : picked.has(n);
        b.classList.toggle('is-on', onCard);
        b.classList.toggle('is-drawn', hits.has(n));
        b.classList.toggle('is-hit', onCard && hits.has(n));
      }
      $('#knPicked').textContent = card
        ? `Your card: ${card.spots.join(' · ')}`
        : picked.size
          ? `${picked.size} spot${picked.size === 1 ? '' : 's'} — ${[...picked].sort((a, b) => a - b).join(' · ')}`
          : 'Pick between one and ten, or take a quick pick';
    }

    function paint(s) {
      // Whose turn, how long, and what comes next.
      clock.paint(clockFrom(s, CLOCK_PHASES, { yours: Boolean(s.you?.yourTurn ?? s.you?.can ?? s.you?.canPlay) }));
      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        const list = $('#knRules');
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
        $('#knBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        $hud('#knClock').textContent = `${s.timeLeft}s`;
        return;
      }

      brief.hidden = true;
      table.hidden = false;
      layOutGrid();

      $hud('#knRound').textContent = `Draw ${s.round} of ${s.maxRounds}`;
      $hud('#knClock').textContent = s.phase === 'over' ? 'closed' : `${s.timeLeft}s`;
      $hud('#knPhase').textContent =
        s.phase === 'buy' ? 'Pick your spots' : s.phase === 'draw' ? 'Drawing' :
        s.phase === 'payout' ? 'Paying out' : 'Closed';

      $('#knPot').textContent = String(s.pot);
      $('#knCarried').textContent = s.carried ? `${s.carried} riding from last draw` : '';
      $('#knBuy').hidden = s.phase !== 'buy';
      $('#knGo').textContent = `Buy · ${s.ante}`;
      $('#knGo').disabled = (s.you?.chips ?? 0) < s.ante || Boolean(s.you?.card);

      if (shownRound !== s.round) {
        shownRound = s.round;
        shownDraw = null;
        picked = new Set();
        clearDraw();
        $('#knSaid').textContent = '';
        paintPicks();
      }

      // Once bought, the board shows the card rather than a live selection.
      if (s.you?.card && !s.drawn) paintPicks(null, s.you.card);

      if (s.drawn && shownDraw !== `${s.round}:${s.drawn.join(',')}`) {
        shownDraw = `${s.round}:${s.drawn.join(',')}`;
        clearDraw();
        // Lit one at a time, because twenty numbers appearing at once is a
        // result rather than a draw.
        s.drawn.forEach((n, i) => {
          drawTimers.push(setTimeout(() => {
            paintPicks(s.drawn.slice(0, i + 1), s.you?.card ?? null);
            Sound.play('tick', { volume: 0.4 });
          }, motionReduced ? 0 : i * 160));
        });
        drawTimers.push(setTimeout(() => {
          $('#knSaid').textContent = s.result?.said ?? '';
          const mine = s.result?.paid?.find((p) => p.id === s.you?.id);
          if (mine) {
            Sound.play('win');
            confetti(table, { count: 60 });
            floatText($('#knPot'), `+${mine.chips}`, 'gain');
          }
        }, motionReduced ? 0 : s.drawn.length * 160 + 300));
      }

      $('#knLog').replaceChildren(
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
      clearDraw();
      off?.();
      wrap.classList.remove('kn-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
