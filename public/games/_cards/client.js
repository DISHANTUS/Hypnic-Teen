// The card room, one screen.
//
// Every game in here has the same three bands: the other players across the
// top, whatever is happening in the middle, and your hand along the bottom
// where your thumb already is. Only the middle changes between games, which is
// the same bargain the machines on the casino floor made and it held up.
//
// Your hand is a row of real cards, scrollable sideways, big enough to hit.
// Cards you cannot legally play are dimmed rather than removed — a hand that
// silently loses cards is a hand you stop trusting, and half of learning a game
// is seeing what you were not allowed to do.

import { Sound } from '/js/sound.js';
import { confetti, floatText, pulse, motionReduced } from '/js/fx.js';

const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const REDS = new Set(['h', 'd']);
const RANK_LABEL = { T: '10' };

/** A playing card, or a back. */
function cardEl(code, { small = false } = {}) {
  const el = document.createElement('span');
  if (!code) {
    el.className = `cd-card is-back${small ? ' is-small' : ''}`;
    return el;
  }
  const rank = RANK_LABEL[code[0]] ?? code[0];
  el.className = `cd-card ${REDS.has(code[1]) ? 'is-red' : 'is-blk'}${small ? ' is-small' : ''}`;
  el.dataset.card = code;
  el.innerHTML = `<b></b><i></i>`;
  el.querySelector('b').textContent = rank;
  el.querySelector('i').textContent = SUIT[code[1]] ?? '';
  return el;
}

const label = (code) => `${RANK_LABEL[code[0]] ?? code[0]}${SUIT[code[1]] ?? ''}`;

export default {
  mount({ canvas, wrap, hud, Net, meta }) {
    canvas.style.display = 'none';
    wrap.classList.add('cd-stage');

    const face = meta?.face ?? meta?.id ?? 'cheat';

    const root = document.createElement('div');
    root.className = `cd is-${face}`;
    root.innerHTML = `
      <div class="cd-brief intro-card" hidden>
        <h2 id="cdTitle"></h2>
        <p class="muted" id="cdTagline"></p>
        <ol class="intro-rules" id="cdRules"></ol>
        <button class="btn btn-primary intro-ready" id="cdBriefed" type="button">Ready</button>
        <p class="muted small" id="cdBriefWait"></p>
      </div>

      <div class="cd-table" hidden>
        <div class="cd-seats" id="cdSeats"></div>
        <div class="cd-middle" id="cdMiddle"></div>
        <div class="cd-said" id="cdSaid"></div>
        <div class="cd-acts" id="cdActs"></div>
        <div class="cd-hand" id="cdHand"></div>
        <ul class="cd-log" id="cdLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="cdHandNo">Hand 1</span>
        <span class="hud-chip" id="cdClock">—</span>
        <span class="hud-chip hud-accent" id="cdTurn">—</span>
      </div>`;

    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);
    const brief = $('.cd-brief');
    const table = $('.cd-table');

    /** Cards picked up but not yet committed — Cheat plays several at once. */
    let picked = new Set();
    let shownHand = 0;
    let shownSaid = '';
    let shownReveal = null;
    let shownTaken = null;

    $('#cdBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#cdBriefed').disabled = true;
      $('#cdBriefed').textContent = 'Waiting for the room…';
    });

    /* ------------------------------ the hand ------------------------------ */

    function paintHand(s) {
      const box = $('#cdHand');
      const hand = s.you?.hand ?? [];
      const playable = s.you?.playable ? new Set(s.you.playable) : null;
      const key = `${hand.join(',')}|${[...picked].join(',')}|${playable ? [...playable].join(',') : ''}`;
      if (box.dataset.key === key) return;
      box.dataset.key = key;

      box.replaceChildren(
        ...hand.map((code) => {
          const el = cardEl(code);
          // Dimmed, never removed. A hand that quietly drops cards is a hand
          // nobody believes, and seeing what you cannot play is how you learn
          // the rule.
          const allowed = !playable || playable.has(code);
          el.classList.toggle('is-dim', !allowed);
          el.classList.toggle('is-picked', picked.has(code));
          el.addEventListener('click', () => onCard(s, code, allowed));
          return el;
        })
      );
      if (!hand.length) {
        const none = document.createElement('span');
        none.className = 'cd-empty';
        none.textContent = s.you?.out ? 'Sitting out this hand' : 'No cards';
        box.appendChild(none);
      }
    }

    function onCard(s, code, allowed) {
      if (face === 'cheat') {
        // Any card can be claimed as any rank — that is the entire game — so
        // nothing is refused here.
        if (picked.has(code)) picked.delete(code);
        else if (picked.size < 4) picked.add(code);
        Sound.play('click');
        $('#cdHand').dataset.key = '';
        paint(last);
        return;
      }
      if (!allowed || !s.you?.yourTurn) { Sound.play('back'); return; }
      if (face === 'hearts') {
        Net.action({ type: 'play', card: code });
        Sound.play('pick');
        return;
      }
      Sound.play('click');
    }

    /* ----------------------------- the middle ----------------------------- */

    const middles = {
      cheat(s) {
        const box = $('#cdMiddle');
        box.replaceChildren();

        const on = document.createElement('div');
        on.className = 'cd-rank';
        on.innerHTML = `<span>The table is on</span><b></b>`;
        on.querySelector('b').textContent = RANK_LABEL[s.rank] ?? s.rank;
        box.appendChild(on);

        const pile = document.createElement('div');
        pile.className = 'cd-pile';
        // Backs, and only backs. The server never sends what is under them.
        for (let i = 0; i < Math.min(6, s.pileSize); i++) pile.appendChild(cardEl(null, { small: true }));
        const n = document.createElement('span');
        n.className = 'cd-count';
        n.textContent = `${s.pileSize} in the pile`;
        pile.appendChild(n);
        box.appendChild(pile);

        if (s.claim) {
          const claim = document.createElement('div');
          claim.className = 'cd-claim';
          claim.textContent = `${s.claim.byName} says ${s.claim.count} × ${RANK_LABEL[s.claim.rank] ?? s.claim.rank}`;
          box.appendChild(claim);
        }

        if (s.reveal) {
          const rev = document.createElement('div');
          rev.className = `cd-reveal ${s.reveal.lied ? 'is-lie' : 'is-true'}`;
          const cards = document.createElement('div');
          cards.className = 'cd-row';
          for (const c of s.reveal.cards) cards.appendChild(cardEl(c, { small: true }));
          rev.appendChild(cards);
          const says = document.createElement('span');
          says.textContent = s.reveal.lied
            ? `${s.reveal.byName} lied — ${s.reveal.picksUp} takes ${s.reveal.count}`
            : `They were real — ${s.reveal.picksUp} takes ${s.reveal.count}`;
          rev.appendChild(says);
          box.appendChild(rev);
        }
      },

      snap(s) {
        const box = $('#cdMiddle');
        box.replaceChildren();
        const stack = document.createElement('div');
        stack.className = 'cd-snap';
        stack.classList.toggle('is-match', Boolean(s.matching));
        if (s.under) {
          const u = cardEl(s.under);
          u.classList.add('is-under');
          stack.appendChild(u);
        }
        if (s.faceUp) stack.appendChild(cardEl(s.faceUp));
        else stack.appendChild(cardEl(null));
        box.appendChild(stack);

        const n = document.createElement('span');
        n.className = 'cd-count';
        n.textContent = `${s.pileSize} in the middle · ${s.deckLeft} to come`;
        box.appendChild(n);
      },

      gofish(s) {
        const box = $('#cdMiddle');
        box.replaceChildren();
        const books = document.createElement('div');
        books.className = 'cd-books';
        for (const b of s.books ?? []) {
          if (!b.ranks.length) continue;
          const row = document.createElement('span');
          row.className = 'cd-book';
          row.textContent = `${b.name}: ${b.ranks.map((r) => RANK_LABEL[r] ?? r).join(' ')}`;
          books.appendChild(row);
        }
        if (!books.children.length) {
          const none = document.createElement('span');
          none.className = 'cd-count';
          none.textContent = 'No books down yet';
          books.appendChild(none);
        }
        box.appendChild(books);

        // Public on purpose — remembering these is most of the game.
        const asks = document.createElement('ul');
        asks.className = 'cd-asks';
        for (const a of (s.asks ?? []).slice(-5).reverse()) {
          const li = document.createElement('li');
          li.textContent = `${a.byName} asked ${a.ofName} for ${RANK_LABEL[a.rank] ?? a.rank}` +
            (a.got ? ` — got ${a.got}` : ' — go fish');
          asks.appendChild(li);
        }
        box.appendChild(asks);
      },

      hearts(s) {
        const box = $('#cdMiddle');
        box.replaceChildren();
        const trick = document.createElement('div');
        trick.className = 'cd-trick';
        for (const t of s.trick ?? []) {
          const wrap2 = document.createElement('div');
          wrap2.className = 'cd-played';
          wrap2.appendChild(cardEl(t.card));
          const who = document.createElement('small');
          who.textContent = t.name;
          wrap2.appendChild(who);
          trick.appendChild(wrap2);
        }
        if (!trick.children.length) {
          const none = document.createElement('span');
          none.className = 'cd-count';
          none.textContent = s.broken ? 'Lead anything' : 'Hearts not broken yet';
          trick.appendChild(none);
        }
        box.appendChild(trick);

        const took = document.createElement('div');
        took.className = 'cd-took';
        for (const t of s.taken ?? []) {
          const chip = document.createElement('span');
          chip.className = 'cd-pts';
          chip.classList.toggle('is-queen', Boolean(t.queen));
          chip.textContent = `${t.name} ${t.points}`;
          took.appendChild(chip);
        }
        box.appendChild(took);
      },
    };

    /* ----------------------------- the buttons ---------------------------- */

    function paintActs(s) {
      const box = $('#cdActs');
      box.replaceChildren();
      const add = (text, cls, onClick, disabled = false) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `btn ${cls}`;
        b.textContent = text;
        b.disabled = disabled;
        if (!disabled) b.addEventListener('click', () => { onClick(); pulse(b); });
        box.appendChild(b);
        return b;
      };

      if (face === 'cheat') {
        if (s.you?.yourTurn && !s.claim) {
          add(picked.size ? `Play ${picked.size} as ${RANK_LABEL[s.rank] ?? s.rank}` : 'Pick cards to play',
            'btn-primary',
            () => { Net.action({ type: 'play', cards: [...picked] }); picked = new Set(); Sound.play('pick'); },
            picked.size === 0);
        }
        if (s.you?.canCall) {
          add(`Cheat! (${s.callWindow}s)`, 'cd-call', () => { Net.action({ type: 'call' }); Sound.play('buzz'); });
        }
        return;
      }

      if (face === 'snap') {
        // Always live. A button that only appears on a match would be a button
        // that tells you the answer.
        add('SNAP', 'cd-snap-btn', () => { Net.action({ type: 'snap' }); Sound.play('buzz'); });
        return;
      }

      if (face === 'gofish' && s.you?.yourTurn) {
        const ranks = s.you?.canAsk ?? [];
        const others = (s.seats ?? []).filter((x) => x.seat !== s.you.seat && !x.out && x.cards > 0);
        if (!ranks.length || !others.length) return;
        const pickRank = document.createElement('select');
        pickRank.className = 'cd-select';
        pickRank.id = 'cdRank';
        for (const r of ranks) {
          const o = document.createElement('option');
          o.value = r;
          o.textContent = RANK_LABEL[r] ?? r;
          pickRank.appendChild(o);
        }
        const pickWho = document.createElement('select');
        pickWho.className = 'cd-select';
        pickWho.id = 'cdWho';
        for (const o2 of others) {
          const o = document.createElement('option');
          o.value = String(o2.seat);
          o.textContent = o2.name;
          pickWho.appendChild(o);
        }
        box.appendChild(pickWho);
        box.appendChild(pickRank);
        add('Ask', 'btn-primary', () => {
          Net.action({ type: 'ask', of: Number(pickWho.value), rank: pickRank.value });
          Sound.play('pick');
        });
      }
    }

    /* ------------------------------- painting ----------------------------- */

    let last = null;

    function paint(s) {
      if (!s) return;
      last = s;

      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        $('#cdTitle').textContent = meta?.name ?? 'Cards';
        $('#cdTagline').textContent = meta?.tagline ?? '';
        const list = $('#cdRules');
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
        $('#cdBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        $hud('#cdClock').textContent = `${s.timeLeft}s`;
        return;
      }

      brief.hidden = true;
      table.hidden = false;

      $hud('#cdHandNo').textContent = `Hand ${s.hand} of ${s.maxHands}`;
      $hud('#cdClock').textContent =
        s.phase === 'over' ? 'done'
        : s.phase === 'between' ? `${s.timeLeft}s`
        : s.turnLeft ? `${s.turnLeft}s` : '—';
      $hud('#cdTurn').textContent =
        s.phase === 'over' ? 'Finished'
        : s.phase === 'between' ? 'Scoring'
        : s.you?.yourTurn ? 'Your turn'
        : s.turnName ? `${s.turnName}'s turn` : 'Playing';

      if (shownHand !== s.hand) {
        shownHand = s.hand;
        picked = new Set();
        $('#cdHand').dataset.key = '';
      }

      // The other players, with counts and never cards.
      $('#cdSeats').replaceChildren(
        ...(s.seats ?? []).filter((p) => p.seat !== s.you?.seat).map((p) => {
          const el = document.createElement('div');
          el.className = 'cd-seat';
          el.classList.toggle('is-turn', p.seat === s.turn && s.phase === 'play');
          el.classList.toggle('is-gone', !p.connected);
          el.innerHTML = `<b></b><span></span><small></small>`;
          el.querySelector('b').textContent = p.name;
          el.querySelector('span').textContent = `${p.cards}`;
          el.querySelector('small').textContent = s.lowestWins ? `${p.score} pts` : `${p.score}`;
          return el;
        })
      );

      (middles[face] ?? middles.cheat)(s);
      paintActs(s);
      paintHand(s);

      if (s.said && shownSaid !== s.said) {
        shownSaid = s.said;
        $('#cdSaid').textContent = s.said;
      }

      // A caught lie and a taken pile both deserve a noise.
      if (s.reveal && shownReveal !== JSON.stringify(s.reveal)) {
        shownReveal = JSON.stringify(s.reveal);
        Sound.play(s.reveal.lied ? 'buzz' : 'reveal');
        if (!motionReduced && s.reveal.picksUp === s.seats.find((x) => x.seat === s.you?.seat)?.name) {
          floatText($('#cdMiddle'), `+${s.reveal.count}`, 'loss');
        }
      }
      if (s.tookPile && shownTaken !== `${s.tookPile.name}:${s.tookPile.cards}`) {
        shownTaken = `${s.tookPile.name}:${s.tookPile.cards}`;
        Sound.play('win');
        if (s.tookPile.name === s.seats.find((x) => x.seat === s.you?.seat)?.name) {
          confetti(table, { count: 40 });
        }
      }

      $('#cdLog').replaceChildren(
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
      wrap.classList.remove('cd-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
