// The machines — one client, four faces.
//
// Slots, plinko, the wheel and scratch cards are the same game underneath:
// stake, everybody goes at once, best result takes the pot. So they share a
// screen too, and only the middle of it changes.
//
// Nobody's result arrives before everybody's. The server holds them all back
// until the payout, so the roll phase here is a few seconds of the thing
// moving with nothing decided on this side — which is the honest way round.

import { Sound } from '/js/sound.js';
import { confetti, floatText, pulse, motionReduced } from '/js/fx.js';

const FACES = {
  slots: { title: 'Slots', verb: 'Pull' },
  plinko: { title: 'Plinko', verb: 'Drop' },
  wheel: { title: 'Wheel of Fortune', verb: 'Spin' },
  scratch: { title: 'Scratch Cards', verb: 'Buy a card' },
};

export default {
  mount({ canvas, wrap, hud, Net, meta }) {
    canvas.style.display = 'none';
    wrap.classList.add('ch-stage');

    const face = meta?.machine ?? 'slots';
    const look = FACES[face] ?? FACES.slots;

    const root = document.createElement('div');
    root.className = `ch is-${face}`;
    root.innerHTML = `
      <div class="ch-brief intro-card" hidden>
        <h2>${look.title}</h2>
        <p class="muted">No house. Everybody stakes into one pot and the best result takes it.</p>
        <ol class="intro-rules" id="chRules"></ol>
        <button class="btn btn-primary intro-ready" id="chBriefed" type="button">Ready</button>
        <p class="muted small" id="chBriefWait"></p>
      </div>

      <div class="ch-table" hidden>
        <div class="ch-pot"><span>In the pot</span><b id="chPot">0</b><small id="chCarried"></small></div>
        <div class="ch-mine" id="chMine"></div>
        <div class="ch-said" id="chSaid"></div>
        <div class="ch-acts" id="chActs"></div>
        <div class="ch-others" id="chOthers"></div>
        <ul class="ch-log" id="chLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="chRound">Round 1</span>
        <span class="hud-chip" id="chClock">—</span>
        <span class="hud-chip hud-accent" id="chPhase">Get in</span>
      </div>`;

    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);
    const brief = $('.ch-brief');
    const table = $('.ch-table');

    let shownRound = 0;
    let shownResult = null;
    let spinTimer = 0;

    $('#chBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#chBriefed').disabled = true;
      $('#chBriefed').textContent = 'Waiting for the room…';
    });

    /** The middle of the screen, whichever machine this is. */
    function paintRoll(roll, rolling) {
      const box = $('#chMine');
      box.replaceChildren();

      if (face === 'slots' || face === 'scratch') {
        const cells = roll?.detail?.reels ?? roll?.detail?.panels
          ?? Array.from({ length: face === 'slots' ? 3 : 6 }, () => null);
        const row = document.createElement('div');
        row.className = face === 'slots' ? 'ch-reels' : 'ch-panels';
        for (const sym of cells) {
          const cell = document.createElement('span');
          cell.className = 'ch-cell';
          cell.classList.toggle('is-spinning', rolling);
          cell.textContent = rolling || !sym ? '❔' : sym;
          row.appendChild(cell);
        }
        box.appendChild(row);
        return;
      }

      if (face === 'plinko') {
        const slot = roll?.detail?.slot;
        const rows = roll?.detail?.rows ?? 12;
        const board = document.createElement('div');
        board.className = 'ch-plinko';
        board.style.setProperty('--slots', String(rows + 1));
        for (let i = 0; i <= rows; i++) {
          const cell = document.createElement('span');
          cell.className = 'ch-slot';
          cell.classList.toggle('is-hit', !rolling && slot === i);
          // Worth grows towards the edges, which is the whole shape of it.
          cell.textContent = String(Math.round(Math.pow(2, Math.abs(i - rows / 2))));
          board.appendChild(cell);
        }
        box.appendChild(board);
        if (rolling) {
          const disc = document.createElement('span');
          disc.className = 'ch-disc';
          box.appendChild(disc);
        }
        return;
      }

      // The wheel: just the wedge it landed on, large.
      const wedge = document.createElement('div');
      wedge.className = 'ch-wedge';
      wedge.classList.toggle('is-spinning', rolling);
      wedge.textContent = rolling ? '…' : (roll?.detail?.label ?? '—');
      box.appendChild(wedge);
    }

    function paintActs(s) {
      const box = $('#chActs');
      box.replaceChildren();
      if (s.phase !== 'bets') return;

      if (s.you?.in) {
        const said = document.createElement('p');
        said.className = 'muted small';
        said.textContent = 'In. Waiting for the rest…';
        box.appendChild(said);
        return;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-primary btn-lg';
      b.textContent = `${look.verb} · ${s.ante}`;
      b.disabled = (s.you?.chips ?? 0) < s.ante;
      b.addEventListener('click', () => {
        Net.action({ type: 'stake' });
        Sound.play('pick');
        pulse(b);
      });
      box.appendChild(b);
      if (b.disabled) {
        const no = document.createElement('p');
        no.className = 'muted small';
        no.textContent = 'Not enough chips for this one.';
        box.appendChild(no);
      }
    }

    function paint(s) {
      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        const list = $('#chRules');
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
        $('#chBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        $hud('#chClock').textContent = `${s.timeLeft}s`;
        return;
      }

      brief.hidden = true;
      table.hidden = false;

      $hud('#chRound').textContent = `Round ${s.round} of ${s.maxRounds}`;
      $hud('#chClock').textContent = s.phase === 'over' ? 'closed' : `${s.timeLeft}s`;
      $hud('#chPhase').textContent =
        s.phase === 'bets' ? 'Get in' : s.phase === 'roll' ? 'Going…' :
        s.phase === 'payout' ? 'Paying out' : 'Closed';

      $('#chPot').textContent = String(s.pot);
      $('#chCarried').textContent = s.carried ? `${s.carried} riding from last round` : '';

      if (shownRound !== s.round) {
        shownRound = s.round;
        shownResult = null;
        $('#chSaid').textContent = '';
        clearTimeout(spinTimer);
      }

      paintRoll(s.you?.roll, s.phase === 'roll');
      paintActs(s);

      // Everybody else's result, once everybody has one.
      $('#chOthers').replaceChildren(
        ...s.players.filter((p) => p.in).map((p) => {
          const row = document.createElement('span');
          row.className = 'ch-other';
          row.classList.toggle('is-you', p.id === s.you?.id);
          row.classList.toggle('is-won', Boolean(s.result?.paid?.some((x) => x.id === p.id)));
          row.innerHTML = '<b></b><i></i>';
          row.querySelector('b').textContent = p.name;
          row.querySelector('i').textContent = p.roll ? p.roll.say : s.phase === 'roll' ? '…' : 'in';
          return row;
        })
      );

      if (s.result && shownResult !== `${s.round}:${s.result.said}`) {
        shownResult = `${s.round}:${s.result.said}`;
        $('#chSaid').textContent = s.result.said;
        const mine = s.result.paid?.find((p) => p.id === s.you?.id);
        if (mine) {
          Sound.play('win');
          confetti(table, { count: 50 });
          floatText($('#chPot'), `+${mine.chips}`, 'gain');
        } else if (s.you?.in) {
          Sound.play('lose');
        }
      }

      $('#chLog').replaceChildren(
        ...(s.log ?? []).slice(-3).reverse().map((line) => {
          const li = document.createElement('li');
          li.textContent = line;
          return li;
        })
      );
      void motionReduced;
    }

    const off = Net.on('game:state', paint);

    return () => {
      clearTimeout(spinTimer);
      off?.();
      wrap.classList.remove('ch-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
