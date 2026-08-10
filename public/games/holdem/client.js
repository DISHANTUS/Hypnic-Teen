// Texas Hold'em — the table.
//
// Everything a player needs is one glance: what is in the middle, what they
// are holding, what it is currently worth, and what it costs to stay in. The
// buttons are built from what the server says is legal rather than from what
// this thinks the rules are, so they can never offer a move that is about to
// be refused — a Call button that does nothing is how somebody loses a hand.
//
// Two cards are yours and nobody else's. Everyone else's are backs until a
// showdown turns them over, and the server only ever sends the ones that are
// genuinely face up.

import { Sound } from '/js/sound.js';
import { confetti, floatText, pulse } from '/js/fx.js';
import { mountClock, clockFrom } from '/js/turnclock.mjs';

const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const REDS = new Set(['h', 'd']);

/** A card, or a back if it is not ours to see. */
function cardEl(code, extra = '') {
  const el = document.createElement('span');
  if (!code || code === '??') {
    el.className = `he-card is-back ${extra}`;
    return el;
  }
  const rank = code[0] === 'T' ? '10' : code[0];
  const suit = code[1];
  el.className = `he-card ${REDS.has(suit) ? 'is-red' : 'is-blk'} ${extra}`;
  el.innerHTML = `<b>${rank}</b><i>${SUIT[suit] ?? ''}</i>`;
  return el;
}

/**
 * What each phase is called, and what happens after it.
 *
 * The second half is the point: a clock says how long is left and says nothing
 * about what is about to happen, which was the other half of the complaint.
 */
const CLOCK_PHASES = {
    brief: { label: 'Everybody is reading the rules', hint: 'Then the blinds go in.' },
    play: { label: 'Betting', you: 'Your move', hint: 'Then the next card comes out.' },
    showdown: { label: 'Showdown', hint: 'Best five cards takes the pot.' },
  };

export default {
  mount({ canvas, wrap, hud, Net }) {
    canvas.style.display = 'none';
    wrap.classList.add('he-stage');

    const root = document.createElement('div');
    root.className = 'he';
    root.innerHTML = `
      <div class="he-brief intro-card" hidden>
        <h2>Texas Hold'em</h2>
        <p class="muted">No dealer and no house. Everybody's chips go in the middle and one of you takes them.</p>
        <ol class="intro-rules" id="heRules"></ol>
        <button class="btn btn-primary intro-ready" id="heBriefed" type="button">Ready</button>
        <p class="muted small" id="heBriefWait"></p>
      </div>

      <div class="he-table" hidden>
        <div class="he-middle">
          <div class="he-board" id="heBoard"></div>
          <div class="he-pot"><span>Pot</span><b id="hePot">0</b></div>
          <div class="he-said" id="heSaid"></div>
        </div>

        <div class="he-seats" id="heSeats"></div>

        <div class="he-you" id="heYou">
          <div class="he-hole" id="heHole"></div>
          <div class="he-yourinfo">
            <b id="heStack">0</b><small>in front of you</small>
            <span class="he-best" id="heBest"></span>
          </div>
        </div>

        <div class="he-acts" id="heActs"></div>
        <ul class="he-log" id="heLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="heHand">Hand 1</span>
        <span class="hud-chip" id="heClock">—</span>
        <span class="hud-chip hud-accent" id="heStreet">Pre-flop</span>
      </div>`;

    const clock = mountClock(hud);

    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);
    const brief = $('.he-brief');
    const table = $('.he-table');

    let state = null;
    let shownHand = 0;
    let shownShowdown = null;

    $('#heBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#heBriefed').disabled = true;
      $('#heBriefed').textContent = 'Waiting for the table…';
    });

    /* ------------------------------- the seats ------------------------------ */

    function paintSeats(s) {
      $('#heSeats').replaceChildren(
        ...[...s.players]
          .sort((a, b) => a.seat - b.seat)
          .map((p) => {
            const seat = document.createElement('div');
            seat.className = 'he-seat';
            seat.classList.toggle('is-turn', p.id === s.turnId);
            seat.classList.toggle('is-out', p.folded || !p.seated);
            seat.classList.toggle('is-you', p.id === s.you?.id);
            seat.classList.toggle('is-allin', p.allIn);

            const cards = document.createElement('div');
            cards.className = 'he-seat-cards';
            for (const c of p.cards) cards.appendChild(cardEl(c, 'is-small'));

            const who = document.createElement('div');
            who.className = 'he-seat-who';
            who.innerHTML = '<b></b><small></small>';
            who.querySelector('b').textContent = p.name + (p.seat === s.button ? ' ⓑ' : '');
            who.querySelector('small').textContent = p.seated
              ? `${p.stack}${p.bet ? ` · ${p.bet} in` : ''}${p.allIn ? ' · all in' : ''}`
              : 'sitting out';

            seat.append(cards, who);
            if (p.folded && p.seated) {
              const tag = document.createElement('span');
              tag.className = 'he-folded';
              tag.textContent = 'folded';
              seat.appendChild(tag);
            }
            return seat;
          })
      );
    }

    /* ------------------------------ the buttons ----------------------------- */

    /**
     * Built from what the server says is legal.
     *
     * The rules live in one place and it is not here. A client that decides for
     * itself what a legal raise is will disagree with the server the moment
     * somebody is short-stacked, and the disagreement looks like a dead button.
     */
    function paintActs(s) {
      const box = $('#heActs');
      const can = s.you?.can;

      if (!can) {
        box.replaceChildren();
        if (s.phase === 'play' && s.you?.seated && !s.you?.folded) {
          const waiting = document.createElement('p');
          waiting.className = 'muted small';
          const whose = s.players.find((p) => p.id === s.turnId);
          waiting.textContent = whose ? `Waiting on ${whose.name}…` : '';
          box.appendChild(waiting);
        }
        return;
      }

      const button = (label, cls, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `btn ${cls}`;
        b.textContent = label;
        b.addEventListener('click', () => {
          fn();
          Sound.play('pick');
          pulse(b);
          box.replaceChildren();
        });
        box.appendChild(b);
        return b;
      };

      button('Fold', 'btn-quiet', () => Net.action({ type: 'fold' }));
      if (can.check) button('Check', 'btn-ghost', () => Net.action({ type: 'check' }));
      else button(`Call ${can.call}`, 'btn-ghost', () => Net.action({ type: 'call' }));

      if (can.canRaise) {
        const row = document.createElement('div');
        row.className = 'he-raise';
        const input = document.createElement('input');
        input.type = 'number';
        input.min = String(can.raiseTo);
        input.max = String(can.allInTo);
        input.step = '1';
        input.value = String(Math.min(can.raiseTo, can.allInTo));
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'btn btn-primary';
        go.textContent = 'Raise to';
        go.addEventListener('click', () => {
          Net.action({ type: 'raise', to: Number(input.value) });
          Sound.play('pick');
          box.replaceChildren();
        });
        const shove = document.createElement('button');
        shove.type = 'button';
        shove.className = 'btn btn-quiet btn-sm';
        shove.textContent = `All in ${can.allInTo}`;
        shove.addEventListener('click', () => {
          Net.action({ type: 'raise', to: can.allInTo });
          Sound.play('start');
          box.replaceChildren();
        });
        row.append(go, input, shove);
        box.appendChild(row);
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
        const list = $('#heRules');
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
        $('#heBriefWait').textContent = waiting
          ? `${waiting} still reading… everyone buys in for ${s.buyIn}.`
          : `Everyone is ready. Buy-in is ${s.buyIn}.`;
        $hud('#heClock').textContent = `${s.timeLeft}s`;
        return;
      }

      brief.hidden = true;
      table.hidden = false;

      $hud('#heHand').textContent = `Hand ${s.hand} of ${s.maxHands}`;
      $hud('#heClock').textContent = s.phase === 'over' ? 'closed' : `${s.timeLeft}s`;
      $hud('#heStreet').textContent =
        { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River' }[s.street] ?? s.street;

      // A new hand: clear the table before anything is dealt onto it.
      if (shownHand !== s.hand) {
        shownHand = s.hand;
        shownShowdown = null;
        $('#heSaid').textContent = '';
      }

      const board = $('#heBoard');
      board.replaceChildren(...s.board.map((c) => cardEl(c)));
      // Five slots always, so the table does not jump about as cards land.
      for (let i = s.board.length; i < 5; i++) {
        const gap = document.createElement('span');
        gap.className = 'he-card is-slot';
        board.appendChild(gap);
      }

      $('#hePot').textContent = String(s.pot);
      $('#heStack').textContent = String(s.you?.stack ?? 0);
      $('#heBest').textContent = s.you?.best ?? '';

      $('#heHole').replaceChildren(...(s.you?.cards ?? []).map((c) => cardEl(c)));

      paintSeats(s);
      paintActs(s);

      if (s.showdown && shownShowdown !== `${s.hand}:${s.showdown.said}`) {
        shownShowdown = `${s.hand}:${s.showdown.said}`;
        $('#heSaid').textContent = s.showdown.said;
        const mine = s.showdown.wins.find((w) => w.id === s.you?.id);
        if (mine) {
          Sound.play('win');
          confetti(table, { count: 40 });
          floatText($('#heYou'), `+${mine.chips}`, 'gain');
        } else if (s.you?.seated) {
          Sound.play('lose');
        }
      }

      $('#heLog').replaceChildren(
        ...(s.log ?? []).slice(-4).reverse().map((line) => {
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
      wrap.classList.remove('he-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
