// Jackpot — throw in what you like, one of you takes it all.
//
// The whole game is one number: your share of the pot, which is exactly your
// chance. So that number is the screen. Everybody's slice is shown as a bar
// that moves as people pile in, because watching your share shrink while
// somebody else throws another hundred on is the entire tension.

import { Sound } from '/js/sound.js';
import { confetti, floatText, pulse } from '/js/fx.js';
import { mountClock, clockFrom } from '/js/turnclock.js';

/**
 * What each phase is called, and what happens after it.
 *
 * The second half is the point: a clock says how long is left and says nothing
 * about what is about to happen, which was the other half of the complaint.
 */
const CLOCK_PHASES = {
    brief: { label: 'Everybody is reading the rules', hint: 'Then throwing opens.' },
    bets: { label: 'Throw in what you like', hint: 'Your chance is exactly your share of the pot.' },
    payout: { label: 'Paying out', hint: 'Then it goes again.' },
  };

export default {
  mount({ canvas, wrap, hud, Net }) {
    canvas.style.display = 'none';
    wrap.classList.add('jp-stage');

    const root = document.createElement('div');
    root.className = 'jp';
    root.innerHTML = `
      <div class="jp-brief intro-card" hidden>
        <h2>Jackpot</h2>
        <p class="muted">Throw in what you like. One of you walks away with all of it, and your chance is exactly your share.</p>
        <ol class="intro-rules" id="jpRules"></ol>
        <button class="btn btn-primary intro-ready" id="jpBriefed" type="button">Ready</button>
        <p class="muted small" id="jpBriefWait"></p>
      </div>

      <div class="jp-table" hidden>
        <div class="jp-pot"><span>The pot</span><b id="jpPot">0</b></div>
        <div class="jp-mine">
          <b id="jpChance">0%</b>
          <small id="jpStaked">nothing in yet</small>
        </div>
        <div class="jp-bar" id="jpBar"></div>
        <div class="jp-shares" id="jpShares"></div>
        <div class="jp-said" id="jpSaid"></div>
        <div class="jp-throw" id="jpThrow"></div>
        <ul class="jp-log" id="jpLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="jpRound">Round 1</span>
        <span class="hud-chip" id="jpClock">—</span>
        <span class="hud-chip hud-accent" id="jpPhase">Throw in</span>
      </div>`;

    const clock = mountClock(hud);

    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);
    const brief = $('.jp-brief');
    const table = $('.jp-table');

    let shownRound = 0;
    let shownResult = null;

    $('#jpBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#jpBriefed').disabled = true;
      $('#jpBriefed').textContent = 'Waiting for the room…';
    });

    function paintThrow(s) {
      const box = $('#jpThrow');
      if (s.phase !== 'bets') {
        box.replaceChildren();
        return;
      }
      const want = `${s.round}:${s.you?.staked}:${s.you?.chips}`;
      if (box.dataset.want === want) return;
      box.dataset.want = want;

      const left = Math.max(0, s.maxBet - (s.you?.staked ?? 0));
      box.replaceChildren();

      for (const n of [10, 50, 100, 500]) {
        if (n > left) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-ghost';
        b.textContent = `+${n}`;
        b.disabled = n > (s.you?.chips ?? 0);
        b.addEventListener('click', () => {
          Net.action({ type: 'throw', amount: n });
          Sound.play('pick');
          pulse(b);
        });
        box.appendChild(b);
      }

      if (!left) {
        const note = document.createElement('p');
        note.className = 'muted small';
        note.textContent = 'That is the most this round allows.';
        box.appendChild(note);
      }
    }

    function paint(s) {
      // Whose turn, how long, and what comes next.
      clock.paint(clockFrom(s, CLOCK_PHASES, { yours: Boolean(s.you?.yourTurn ?? s.you?.can ?? s.you?.canPlay) }));
      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        const list = $('#jpRules');
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
        $('#jpBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        $hud('#jpClock').textContent = `${s.timeLeft}s`;
        return;
      }

      brief.hidden = true;
      table.hidden = false;

      $hud('#jpRound').textContent = `Round ${s.round} of ${s.maxRounds}`;
      $hud('#jpClock').textContent = s.phase === 'over' ? 'closed' : `${s.timeLeft}s`;
      $hud('#jpPhase').textContent =
        s.phase === 'bets' ? 'Throw in' : s.phase === 'payout' ? 'Drawing' : 'Closed';

      $('#jpPot').textContent = String(s.pot);
      $('#jpChance').textContent = `${s.you?.chance ?? 0}%`;
      $('#jpStaked').textContent = s.you?.staked
        ? `${s.you.staked} in — that is your chance`
        : 'nothing in yet';

      // One bar, everybody's slice of it. The whole game in one line.
      $('#jpBar').replaceChildren(
        ...s.shares.map((sh) => {
          const seg = document.createElement('span');
          seg.className = 'jp-seg';
          seg.classList.toggle('is-you', sh.id === s.you?.id);
          seg.style.width = `${sh.percent}%`;
          seg.title = `${sh.name} — ${sh.percent}%`;
          return seg;
        })
      );

      $('#jpShares').replaceChildren(
        ...s.shares.map((sh) => {
          const row = document.createElement('span');
          row.className = 'jp-share';
          row.classList.toggle('is-you', sh.id === s.you?.id);
          row.classList.toggle('is-won', s.result?.winner === sh.id);
          row.innerHTML = '<b></b><i></i>';
          row.querySelector('b').textContent = sh.name;
          row.querySelector('i').textContent = `${sh.chips} · ${sh.percent}%`;
          return row;
        })
      );

      paintThrow(s);

      if (shownRound !== s.round) {
        shownRound = s.round;
        shownResult = null;
        $('#jpSaid').textContent = '';
      }

      if (s.result && shownResult !== `${s.round}:${s.result.said}`) {
        shownResult = `${s.round}:${s.result.said}`;
        $('#jpSaid').textContent = s.result.said;
        if (s.result.winner === s.you?.id) {
          Sound.play('win');
          confetti(table, { count: 80 });
          floatText($('#jpPot'), `+${s.result.pot}`, 'gain');
        } else if (s.you?.staked) {
          Sound.play('lose');
        }
      }

      $('#jpLog').replaceChildren(
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
      wrap.classList.remove('jp-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
