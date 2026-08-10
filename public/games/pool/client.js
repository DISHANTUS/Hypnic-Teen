// Craps and the horses — one board, two events.
//
// Both are the same screen: a list of things to back, everybody's chips
// showing on them, and then the event happening in the middle. The only
// difference is what the middle does, so that is the only part that branches.
//
// The board is built from what the server says can be backed rather than from
// this file's idea of what craps is. A client that decides for itself which
// bets exist will disagree with the server the day one is added.

import { Sound } from '/js/sound.js';
import { confetti, floatText, pulse, motionReduced } from '/js/fx.js';
import { mountClock, clockFrom } from '/js/turnclock.mjs';

const PIPS = { 1: '⚀', 2: '⚁', 3: '⚂', 4: '⚃', 5: '⚄', 6: '⚅' };

/**
 * What each phase is called, and what happens after it.
 *
 * The second half is the point: a clock says how long is left and says nothing
 * about what is about to happen, which was the other half of the complaint.
 */
const CLOCK_PHASES = {
    brief: { label: 'Everybody is reading the rules', hint: 'Then betting opens.' },
    bets: { label: 'Get your bets down', hint: 'Then it happens, and the pot is split by what it pays.' },
    run: { label: 'Under way', hint: 'Nothing is settled until it finishes.' },
    payout: { label: 'Paying out', hint: 'Then the next one opens.' },
  };

export default {
  mount({ canvas, wrap, hud, Net, meta }) {
    canvas.style.display = 'none';
    wrap.classList.add('pl-stage');

    const kind = meta?.pool ?? 'craps';

    const root = document.createElement('div');
    root.className = `pl is-${kind}`;
    root.innerHTML = `
      <div class="pl-brief intro-card" hidden>
        <h2>${meta?.name ?? 'Table'}</h2>
        <p class="muted">${meta?.tagline ?? ''}</p>
        <ol class="intro-rules" id="plRules"></ol>
        <button class="btn btn-primary intro-ready" id="plBriefed" type="button">Ready</button>
        <p class="muted small" id="plBriefWait"></p>
      </div>

      <div class="pl-table" hidden>
        <div class="pl-pot"><span>In the middle</span><b id="plPot">0</b><small id="plCarried"></small></div>
        <div class="pl-event" id="plEvent"></div>
        <div class="pl-said" id="plSaid"></div>

        <div class="pl-mine">
          <span>You have <b id="plChips">0</b> chips</span>
          <span id="plStaked"></span>
          <button class="btn btn-quiet btn-sm" id="plClear" type="button" hidden>Take it back</button>
        </div>

        <div class="pl-stack" id="plStack"></div>
        <div class="pl-board" id="plBoard"></div>
        <ul class="pl-log" id="plLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="plRound">1</span>
        <span class="hud-chip" id="plClock">—</span>
        <span class="hud-chip hud-accent" id="plPhase">Place your bets</span>
      </div>`;

    const clock = mountClock(hud);

    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);
    const brief = $('.pl-brief');
    const table = $('.pl-table');
    const eventBox = $('#plEvent');

    let chipSize = 25;
    let shownRound = 0;
    let shownResult = null;
    let raceTimer = 0;

    $('#plBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#plBriefed').disabled = true;
      $('#plBriefed').textContent = 'Waiting for the table…';
    });
    $('#plClear').addEventListener('click', () => {
      Net.action({ type: 'clear' });
      Sound.play('back');
    });

    /* -------------------------------- the board ---------------------------- */

    function layOutBoard(s) {
      const box = $('#plBoard');
      const want = s.board.map((b) => b.kind).join('|');
      if (box.dataset.built === want) return;
      box.dataset.built = want;

      box.replaceChildren(
        ...s.board.map((b) => {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'pl-spot';
          cell.dataset.kind = b.kind;
          cell.innerHTML =
            '<b class="pl-spot-label"></b>' +
            '<small class="pl-spot-note"></small>' +
            '<span class="pl-spot-pays"></span>' +
            '<span class="pl-onit" hidden></span>';
          cell.querySelector('.pl-spot-label').textContent = b.label;
          cell.querySelector('.pl-spot-note').textContent = b.note ?? '';
          // What a chip on it is worth, said the way a board says it.
          cell.querySelector('.pl-spot-pays').textContent = `${b.returns - 1} to 1`;
          cell.addEventListener('click', () => {
            if (table.dataset.open !== '1') return;
            if ((Net.roomState?.you?.chips ?? Infinity) < chipSize) return floatText(cell, 'no chips', 'loss');
            Net.action({ type: 'bet', kind: b.kind, amount: chipSize });
            Sound.play('pick');
          });
          return cell;
        })
      );
    }

    function paintBoard(s) {
      const totals = new Map();
      const mine = new Map();
      for (const b of s.bets) {
        totals.set(b.kind, (totals.get(b.kind) ?? 0) + b.amount);
        if (b.id === s.you?.id) mine.set(b.kind, (mine.get(b.kind) ?? 0) + b.amount);
      }
      const open = s.phase === 'bets';
      table.dataset.open = open ? '1' : '0';

      for (const cell of $('#plBoard').querySelectorAll('.pl-spot')) {
        const k = cell.dataset.kind;
        const on = totals.get(k) ?? 0;
        const tag = cell.querySelector('.pl-onit');
        tag.textContent = on ? String(on) : '';
        tag.hidden = !on;
        tag.classList.toggle('is-mine', (mine.get(k) ?? 0) > 0);
        cell.disabled = !open;
        // The winning spot, once there is one.
        cell.classList.toggle('is-won', Boolean(s.result) && wonSpot(s, k));
      }
    }

    /** Did this spot come in? Read from who got paid rather than re-judged. */
    function wonSpot(s, kind) {
      if (!s.outcome) return false;
      if (kind.startsWith('h')) return s.outcome.winner === kind;
      // Craps: work it from the outcome the same way the server did.
      const { comeOut, pass, rolls } = s.outcome;
      switch (kind) {
        case 'pass': return pass === true;
        case 'dontPass': return pass === false;
        case 'field': return [2, 3, 4, 9, 10, 11, 12].includes(comeOut);
        case 'anyCraps': return [2, 3, 12].includes(comeOut);
        case 'yo': return comeOut === 11;
        case 'snakeEyes': return comeOut === 2;
        case 'hardWay': return rolls?.[0]?.hard === true;
        default: return false;
      }
    }

    function paintStack(s) {
      const box = $('#plStack');
      const sizes = [5, 25, 100, 500].filter((n) => n <= Math.max(s.maxBet, 5));
      if (box.dataset.built !== sizes.join(',')) {
        box.dataset.built = sizes.join(',');
        box.replaceChildren(
          ...sizes.map((n) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'pl-chip';
            b.dataset.value = String(n);
            b.textContent = String(n);
            b.addEventListener('click', () => {
              chipSize = n;
              paintStack(s);
              Sound.play('click');
            });
            return b;
          })
        );
        if (!sizes.includes(chipSize)) chipSize = sizes[0];
      }
      for (const b of box.querySelectorAll('.pl-chip')) {
        b.classList.toggle('is-on', Number(b.dataset.value) === chipSize);
        b.disabled = Number(b.dataset.value) > (s.you?.chips ?? 0);
      }
    }

    /* ------------------------------- the middle ---------------------------- */

    function paintEvent(s) {
      clearTimeout(raceTimer);

      if (kind === 'craps') {
        const rolls = s.outcome?.rolls ?? [];
        eventBox.replaceChildren();
        const row = document.createElement('div');
        row.className = 'pl-dice';
        const shown = rolls.length ? rolls[rolls.length - 1].dice : [null, null];
        for (const d of shown) {
          const die = document.createElement('span');
          die.className = 'pl-die';
          die.classList.toggle('is-rolling', s.phase === 'run');
          die.textContent = s.phase === 'run' || !d ? PIPS[1 + Math.floor(Math.random() * 6)] : PIPS[d];
          row.appendChild(die);
        }
        eventBox.appendChild(row);

        if (s.outcome) {
          const line = document.createElement('span');
          line.className = 'pl-total';
          line.textContent = s.outcome.point
            ? `come-out ${s.outcome.comeOut} · point ${s.outcome.point} · ${s.outcome.reason}`
            : `${s.outcome.comeOut} — ${s.outcome.reason}`;
          eventBox.appendChild(line);
        }
        return;
      }

      // The race. Replayed frame by frame, because a winner that simply
      // appears is a lottery draw and half of a race is the watching.
      const frames = s.outcome?.frames ?? [];
      if (!eventBox.dataset.built) {
        eventBox.dataset.built = '1';
      }
      const lanes = document.createElement('div');
      lanes.className = 'pl-track';
      const runners = s.board.map((b) => b.kind);
      for (const id of runners) {
        const lane = document.createElement('div');
        lane.className = 'pl-lane';
        lane.dataset.runner = id;
        lane.innerHTML = '<span class="pl-horse">🐎</span><b class="pl-lane-name"></b>';
        lane.querySelector('.pl-lane-name').textContent = s.board.find((b) => b.kind === id)?.label ?? id;
        lanes.appendChild(lane);
      }
      eventBox.replaceChildren(lanes);

      if (!frames.length) return;

      const step = (i) => {
        const frame = frames[Math.min(i, frames.length - 1)];
        for (const lane of lanes.querySelectorAll('.pl-lane')) {
          const at = frame[lane.dataset.runner] ?? 0;
          lane.querySelector('.pl-horse').style.left = `${Math.min(100, (at / 30) * 100)}%`;
          lane.classList.toggle('is-won', Boolean(s.outcome) && s.outcome.winner === lane.dataset.runner && i >= frames.length - 1);
        }
        if (i < frames.length - 1) raceTimer = setTimeout(() => step(i + 1), motionReduced ? 0 : 90);
      };
      step(motionReduced ? frames.length - 1 : 0);
    }

    /* -------------------------------- painting ----------------------------- */

    function paint(s) {
      // Whose turn, how long, and what comes next.
      clock.paint(clockFrom(s, CLOCK_PHASES, { yours: Boolean(s.you?.yourTurn ?? s.you?.can ?? s.you?.canPlay) }));
      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        const list = $('#plRules');
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
        $('#plBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        $hud('#plClock').textContent = `${s.timeLeft}s`;
        return;
      }

      brief.hidden = true;
      table.hidden = false;
      layOutBoard(s);

      $hud('#plRound').textContent = `${s.round} of ${s.maxRounds}`;
      $hud('#plClock').textContent = s.phase === 'over' ? 'closed' : `${s.timeLeft}s`;
      $hud('#plPhase').textContent =
        s.phase === 'bets' ? 'Place your bets' :
        s.phase === 'run' ? (kind === 'craps' ? 'Rolling' : 'And they’re off') :
        s.phase === 'payout' ? 'Paying out' : 'Table closed';

      $('#plPot').textContent = String(s.pot);
      $('#plCarried').textContent = s.carried ? `${s.carried} riding from last time` : '';
      $('#plChips').textContent = String(s.you?.chips ?? 0);
      $('#plStaked').textContent = s.you?.staked ? `${s.you.staked} on the board` : '';
      $('#plClear').hidden = s.phase !== 'bets' || !s.you?.staked;

      paintStack(s);
      paintBoard(s);

      if (shownRound !== s.round) {
        shownRound = s.round;
        shownResult = null;
        $('#plSaid').textContent = '';
      }
      paintEvent(s);

      if (s.result && shownResult !== `${s.round}:${s.result.said}`) {
        shownResult = `${s.round}:${s.result.said}`;
        $('#plSaid').textContent = s.result.said;
        const mine = s.result.paid?.find((p) => p.id === s.you?.id);
        if (mine) {
          Sound.play('win');
          confetti(table, { count: 50 });
          floatText($('#plPot'), `+${mine.chips}`, 'gain');
        } else if (s.you?.staked) {
          Sound.play('lose');
        }
      }

      $('#plLog').replaceChildren(
        ...(s.log ?? []).slice(-3).reverse().map((line) => {
          const li = document.createElement('li');
          li.textContent = line;
          return li;
        })
      );
      void pulse;
    }

    const off = Net.on('game:state', paint);

    return () => {
      clock.destroy();
      clearTimeout(raceTimer);
      off?.();
      wrap.classList.remove('pl-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
