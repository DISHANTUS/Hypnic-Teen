// Blackjack — the felt.
//
// There is no dealer here, so the screen is about the other players rather
// than about one hand you are trying to beat. Everybody's up-card and how many
// they are holding is on show all the way through: five cards in front of
// somebody who has not stood is the whole reason you might hit on eighteen.
//
// Your own hand and its total are yours alone until the reveal. The server
// sends nobody else's total, so this could not show it even if it wanted to.

import { Sound } from '/js/sound.js';
import { confetti, floatText, shake, pulse } from '/js/fx.js';
import { mountClock, clockFrom } from '/js/turnclock.js';

const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const REDS = new Set(['h', 'd']);

function cardEl(code, small = false) {
  const el = document.createElement('span');
  const cls = small ? 'bj-card is-small' : 'bj-card';
  if (!code || code === '??') {
    el.className = `${cls} is-back`;
    return el;
  }
  const rank = code[0] === 'T' ? '10' : code[0];
  el.className = `${cls} ${REDS.has(code[1]) ? 'is-red' : 'is-blk'}`;
  el.innerHTML = `<b>${rank}</b><i>${SUIT[code[1]] ?? ''}</i>`;
  return el;
}

/**
 * What each phase is called, and what happens after it.
 *
 * The second half is the point: a clock says how long is left and says nothing
 * about what is about to happen, which was the other half of the complaint.
 */
const CLOCK_PHASES = {
    brief: { label: 'Everybody is reading the rules', hint: 'Then the ante.' },
    bets: { label: 'Ante up', hint: 'Then two cards each, one of everybody else’s face down.' },
    play: { label: 'Playing the hands', you: 'Your move', hint: 'Closest to twenty-one without going over.' },
    payout: { label: 'Paying out', hint: 'Then the next hand.' },
  };

export default {
  mount({ canvas, wrap, hud, Net }) {
    canvas.style.display = 'none';
    wrap.classList.add('bj-stage');

    const root = document.createElement('div');
    root.className = 'bj';
    root.innerHTML = `
      <div class="bj-brief intro-card" hidden>
        <h2>Blackjack</h2>
        <p class="muted">No dealer. Closest to twenty-one without going over takes everybody's chips.</p>
        <ol class="intro-rules" id="bjRules"></ol>
        <button class="btn btn-primary intro-ready" id="bjBriefed" type="button">Ready</button>
        <p class="muted small" id="bjBriefWait"></p>
      </div>

      <div class="bj-table" hidden>
        <div class="bj-pot"><span>Pot</span><b id="bjPot">0</b><small id="bjCarried"></small></div>
        <div class="bj-said" id="bjSaid"></div>
        <div class="bj-seats" id="bjSeats"></div>

        <div class="bj-you">
          <div class="bj-hand" id="bjHand"></div>
          <div class="bj-total"><b id="bjTotal">0</b><small id="bjState"></small></div>
        </div>

        <div class="bj-acts" id="bjActs"></div>
        <ul class="bj-log" id="bjLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="bjHandNo">Hand 1</span>
        <span class="hud-chip" id="bjClock">—</span>
        <span class="hud-chip hud-accent" id="bjPhase">Ante up</span>
      </div>`;

    const clock = mountClock(hud);

    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);
    const brief = $('.bj-brief');
    const table = $('.bj-table');
    const acts = $('#bjActs');

    let shownHand = 0;
    let shownResult = null;

    $('#bjBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#bjBriefed').disabled = true;
      $('#bjBriefed').textContent = 'Waiting for the table…';
    });

    function paintSeats(s) {
      $('#bjSeats').replaceChildren(
        ...s.players.map((p) => {
          const seat = document.createElement('div');
          seat.className = 'bj-seat';
          seat.classList.toggle('is-you', p.id === s.you?.id);
          seat.classList.toggle('is-out', !p.in);
          seat.classList.toggle('is-bust', p.bust);
          seat.classList.toggle('is-stood', p.stood && !p.bust);

          const cards = document.createElement('div');
          cards.className = 'bj-seat-cards';
          for (const c of p.cards) cards.appendChild(cardEl(c, true));

          const who = document.createElement('div');
          who.className = 'bj-seat-who';
          who.innerHTML = '<b></b><small></small>';
          who.querySelector('b').textContent = p.name;
          // The total only once everything is face up — until then, how many
          // cards they are holding, which is the real tell at this table.
          who.querySelector('small').textContent = !p.in
            ? 'sitting out'
            : p.bust ? `bust${p.total ? ` on ${p.total}` : ''}`
              : p.total !== null ? String(p.total)
                : `${p.held} card${p.held === 1 ? '' : 's'}${p.stood ? ' · stood' : ''}`;

          seat.append(cards, who);
          return seat;
        })
      );
    }

    function paintActs(s) {
      acts.replaceChildren();

      if (s.phase === 'bets') {
        if (s.you?.in) {
          const said = document.createElement('p');
          said.className = 'muted small';
          said.textContent = 'In. Waiting for the rest of the table…';
          acts.appendChild(said);
          return;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-primary';
        b.textContent = `Ante ${s.ante}`;
        b.disabled = (s.you?.chips ?? 0) < s.ante;
        b.addEventListener('click', () => {
          Net.action({ type: 'ante' });
          Sound.play('pick');
          pulse(b);
        });
        acts.appendChild(b);
        if (b.disabled) {
          const no = document.createElement('p');
          no.className = 'muted small';
          no.textContent = 'Not enough chips for this table.';
          acts.appendChild(no);
        }
        return;
      }

      if (!s.you?.canPlay) return;

      for (const [label, type, cls] of [['Hit', 'hit', 'btn-primary'], ['Stand', 'stand', 'btn-ghost']]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `btn ${cls}`;
        b.textContent = label;
        b.addEventListener('click', () => {
          Net.action({ type });
          Sound.play(type === 'hit' ? 'pick' : 'click');
          acts.replaceChildren();
        });
        acts.appendChild(b);
      }
    }

    function paint(s) {
      // Whose turn, how long, and what comes next.
      clock.paint(clockFrom(s, CLOCK_PHASES, { yours: Boolean(s.you?.yourTurn ?? s.you?.can ?? s.you?.canPlay) }));
      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        const list = $('#bjRules');
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
        $('#bjBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        $hud('#bjClock').textContent = `${s.timeLeft}s`;
        return;
      }

      brief.hidden = true;
      table.hidden = false;

      $hud('#bjHandNo').textContent = `Hand ${s.hand} of ${s.maxHands}`;
      $hud('#bjClock').textContent = s.phase === 'over' ? 'closed' : `${s.timeLeft}s`;
      $hud('#bjPhase').textContent =
        s.phase === 'bets' ? 'Ante up' : s.phase === 'play' ? 'Hit or stand' :
        s.phase === 'reveal' ? 'Showing' : 'Table closed';

      $('#bjPot').textContent = String(s.pot);
      $('#bjCarried').textContent = s.carried ? `${s.carried} riding from last hand` : '';

      if (shownHand !== s.hand) {
        shownHand = s.hand;
        shownResult = null;
        $('#bjSaid').textContent = '';
      }

      $('#bjHand').replaceChildren(...(s.you?.cards ?? []).map((c) => cardEl(c)));
      $('#bjTotal').textContent = String(s.you?.total ?? 0);
      $('#bjState').textContent = s.you?.bust
        ? 'bust'
        : s.you?.blackjack ? 'blackjack'
          : s.you?.stood ? 'stood'
            : s.you?.soft ? 'soft' : '';
      $('#bjTotal').className = s.you?.bust ? 'is-bust' : s.you?.blackjack ? 'is-blackjack' : '';

      paintSeats(s);
      paintActs(s);

      if (s.result && shownResult !== `${s.hand}:${s.result.said}`) {
        shownResult = `${s.hand}:${s.result.said}`;
        $('#bjSaid').textContent = s.result.said;
        const mine = s.result.paid.find((p) => p.id === s.you?.id);
        if (mine) {
          Sound.play('win');
          confetti(table, { count: 40 });
          floatText($('#bjTotal'), `+${mine.chips}`, 'gain');
        } else if (s.you?.in) {
          Sound.play('lose');
          if (s.you?.bust) shake($('#bjHand'));
        }
      }

      $('#bjLog').replaceChildren(
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
      wrap.classList.remove('bj-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
