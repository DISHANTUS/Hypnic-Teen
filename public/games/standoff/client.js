// Standoff — the hands.
//
// The whole game is one decision a round, so the screen has to make that
// decision feel like something. Three things do the work:
//
//   the count      three shakes and a shoot, the way it is played by hand,
//                  with everybody's fist bobbing in time
//   the flip       every hand turns over at the same instant, because
//                  simultaneity is the entire point of the game
//   the beams      a line from each winner to each person they beat, drawn
//                  after the flip so the room can see the sweep happen
//
// Nothing here decides anything. The server sends what was thrown only once
// the round is locked, so until the reveal this genuinely does not know.

import { Sound } from '/js/sound.js';
import { confetti, floatText, shake, pulse, motionReduced } from '/js/fx.js';

const HAND = { rock: '✊', paper: '✋', scissors: '✌️' };
const LABEL = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' };
const THROWS = ['rock', 'paper', 'scissors'];

/** The count, in the words everybody already says. */
const CHANT = ['Rock', 'Paper', 'Scissors', 'Shoot!'];

export default {
  mount({ canvas, wrap, hud, Net }) {
    canvas.style.display = 'none';
    wrap.classList.add('so-stage');

    const root = document.createElement('div');
    root.className = 'so';
    root.innerHTML = `
      <div class="so-brief intro-card" hidden>
        <h2>Standoff</h2>
        <p class="muted">Rock, paper, scissors — but you throw against everyone in the room at once.</p>
        <ol class="intro-rules" id="soRules"></ol>
        <button class="btn btn-primary intro-ready" id="soBriefed" type="button">Ready</button>
        <p class="muted small" id="soBriefWait"></p>
      </div>

      <div class="so-table" hidden>
        <div class="so-chant" id="soChant" aria-live="polite"></div>
        <!-- The beams share a box with the hands rather than sitting loose in
             the table. Positioned against the table they were offset by the
             height of the chant above — drawn from the right coordinates into
             the wrong frame, so every line landed a couple of centimetres
             north of the cards it was supposed to join. They also go behind,
             so a line shows in the gaps between cards instead of straight
             across somebody's face. -->
        <div class="so-arena">
          <svg class="so-beams" id="soBeams" aria-hidden="true"></svg>
          <div class="so-hands" id="soHands"></div>
        </div>
        <div class="so-verdict" id="soVerdict" hidden></div>
        <div class="so-pick" id="soPick"></div>
        <ul class="so-log" id="soLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="soRound">Round 1</span>
        <span class="hud-chip" id="soClock">—</span>
        <span class="hud-chip hud-accent" id="soDouble" hidden>Final round — double points</span>
      </div>`;

    // Two roots, and they are not the same element. The scoreboard chips live
    // in the hud the site owns; everything else is in the panel this game just
    // built. One `$` over `root` alone returned null for every chip, and the
    // first `.textContent` on null threw out of paint before a single hand had
    // been laid out — so the rules showed, Ready did nothing, and the table
    // never arrived.
    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);
    const brief = $('.so-brief');
    const table = $('.so-table');
    const handsBox = $('#soHands');
    const beams = $('#soBeams');
    const chant = $('#soChant');
    const verdict = $('#soVerdict');
    const pickBox = $('#soPick');
    const logBox = $('#soLog');

    let state = null;
    let myId = null;
    /** The round we last ran the count for, so it runs once. */
    let countedRound = 0;
    /** The round we last revealed, so the flip happens once. */
    let revealedRound = 0;
    let chantTimers = [];

    const clearChant = () => {
      for (const t of chantTimers) clearTimeout(t);
      chantTimers = [];
    };

    /* ------------------------------ the brief ------------------------------ */

    $('#soBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#soBriefed').disabled = true;
      $('#soBriefed').textContent = 'Waiting for the room…';
    });

    /* ------------------------------ the hands ------------------------------ */

    /** One card per player. Rebuilt only when the cast changes, so the DOM
     *  nodes survive and can be animated rather than replaced mid-flip. */
    function layOutHands(players) {
      const want = players.map((p) => p.id).join('|');
      if (handsBox.dataset.cast === want) return;
      handsBox.dataset.cast = want;

      handsBox.replaceChildren(
        ...players.map((p) => {
          const card = document.createElement('div');
          card.className = 'so-hand';
          card.dataset.id = p.id;
          card.innerHTML = `
            <div class="so-fist" aria-hidden="true">✊</div>
            <div class="so-who"><b></b><small></small></div>
            <div class="so-stock" aria-hidden="true"></div>
            <div class="so-gain"></div>`;
          card.querySelector('b').textContent = p.name;
          return card;
        })
      );
      // A grid that stays square-ish however many people are in the room, so
      // four players do not get four tiny cards on a wide screen.
      handsBox.style.setProperty('--cols', String(Math.min(4, Math.max(2, Math.ceil(Math.sqrt(players.length))))));
    }

    function paintHands(s) {
      for (const p of s.players) {
        const card = handsBox.querySelector(`.so-hand[data-id="${cssEscape(p.id)}"]`);
        if (!card) continue;

        card.classList.toggle('is-you', p.id === myId);
        card.classList.toggle('is-out', p.connected === false);
        card.classList.toggle('is-locked', s.locked.includes(p.id) && s.phase === 'throw');

        card.querySelector('small').textContent =
          `${p.score} pt${Math.abs(p.score) === 1 ? '' : 's'}${p.streak > 1 ? ` · ${p.streak} in a row` : ''}`;

        // What they have left. This is the deduction layer, so it is shown as
        // pips rather than numbers — you read "he has one rock" at a glance,
        // and glancing is all you get during a twelve second round.
        const stockBox = card.querySelector('.so-stock');
        if (!s.limited || !p.stock) {
          stockBox.replaceChildren();
        } else {
          stockBox.replaceChildren(
            ...THROWS.map((t) => {
              const group = document.createElement('span');
              group.className = 'so-pips';
              group.title = `${p.stock[t]} ${LABEL[t].toLowerCase()} left`;
              group.dataset.throw = t;
              group.innerHTML =
                `<i>${HAND[t]}</i>` +
                Array.from({ length: Math.max(p.stock[t], 0) }, () => '<u></u>').join('');
              if (p.stock[t] === 0) group.classList.add('is-empty');
              return group;
            })
          );
        }
      }
    }

    /* ---------------------------- the count-in ----------------------------- */

    /**
     * Three shakes and a shoot.
     *
     * Timed off the phase clock rather than a fixed delay, so a host who sets
     * six seconds to throw gets a count that fits in six seconds instead of one
     * that is still going when the round ends.
     */
    function runCount(seconds) {
      clearChant();
      const step = Math.min(520, Math.max(260, (seconds * 1000 * 0.45) / CHANT.length));
      handsBox.classList.add('is-counting');

      CHANT.forEach((word, i) => {
        chantTimers.push(
          setTimeout(() => {
            chant.textContent = word;
            chant.classList.remove('is-beat');
            // Reflow, so the animation restarts on every word rather than
            // playing once and sitting still for the rest of the count.
            void chant.offsetWidth;
            chant.classList.add('is-beat');
            Sound.play(i === CHANT.length - 1 ? 'phase' : 'tick', { volume: 0.5 });
          }, i * step)
        );
      });

      chantTimers.push(
        setTimeout(() => {
          handsBox.classList.remove('is-counting');
          chant.textContent = '';
        }, CHANT.length * step + 260)
      );
    }

    /* ------------------------------ the reveal ----------------------------- */

    function reveal(s) {
      const t = s.table;
      clearChant();
      chant.textContent = '';
      handsBox.classList.remove('is-counting');

      // Every hand turns over at the same instant.
      for (const row of t.rows) {
        const card = handsBox.querySelector(`.so-hand[data-id="${cssEscape(row.id)}"]`);
        if (!card) continue;
        const fist = card.querySelector('.so-fist');
        fist.textContent = row.hand;
        card.classList.add('is-shown');
        card.classList.toggle('is-forced', row.forced);
        card.classList.remove('is-swept', 'is-beaten');
        void fist.offsetWidth;
        fist.classList.remove('is-flip');
        void fist.offsetWidth;
        fist.classList.add('is-flip');
      }
      Sound.play('reveal');

      // Then the beams, a beat later, so the flip is read first.
      setTimeout(() => drawBeams(s), motionReduced ? 0 : 320);

      // And the points, last.
      setTimeout(
        () => {
          for (const row of t.rows) {
            const card = handsBox.querySelector(`.so-hand[data-id="${cssEscape(row.id)}"]`);
            if (!card) continue;
            const gain = card.querySelector('.so-gain');
            gain.textContent = row.points > 0 ? `+${row.points}` : String(row.points);
            gain.dataset.tone = row.points > 0 ? 'up' : row.points < 0 ? 'down' : 'flat';
            gain.classList.remove('is-pop');
            void gain.offsetWidth;
            gain.classList.add('is-pop');
            if (row.swept) card.classList.add('is-swept');
            else if (row.lost > row.beat) card.classList.add('is-beaten');
          }

          const mine = t.rows.find((r) => r.id === myId);
          if (mine?.swept) {
            confetti(table, { count: 60 });
            Sound.play('win');
            floatText(handsBox.querySelector(`.so-hand[data-id="${cssEscape(myId)}"]`), 'SWEEP', 'gain');
          } else if (mine && mine.points > 0) {
            Sound.play('correct');
          } else if (mine && mine.points < 0) {
            Sound.play('wrong');
            shake(handsBox.querySelector(`.so-hand[data-id="${cssEscape(myId)}"]`));
          }
        },
        motionReduced ? 0 : 620
      );

      // The words for it.
      verdict.hidden = false;
      verdict.innerHTML = '<b></b><span></span>';
      verdict.querySelector('b').textContent = t.headline;
      verdict.querySelector('span').textContent =
        `${countsLine(t.counts)}${t.doubled ? ' · final round, doubled' : ''}`;
      verdict.classList.remove('is-in');
      void verdict.offsetWidth;
      verdict.classList.add('is-in');
    }

    /**
     * A line from every winner to everybody they beat.
     *
     * This is what makes "you played the whole room at once" visible. Without
     * it a sweep looks exactly like an ordinary round with a bigger number.
     */
    function drawBeams(s) {
      const t = s.table;
      beams.replaceChildren();
      if (motionReduced || !t) return;

      // Measured against the box the beams actually live in, so the drawing
      // frame and the coordinates cannot disagree.
      const box = beams.parentElement.getBoundingClientRect();
      beams.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);

      const centre = (id) => {
        const card = handsBox.querySelector(`.so-hand[data-id="${cssEscape(id)}"]`);
        if (!card) return null;
        const r = card.getBoundingClientRect();
        return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
      };

      const beatsOf = (pick) => ({ rock: 'scissors', paper: 'rock', scissors: 'paper' })[pick];

      let n = 0;
      for (const winner of t.rows) {
        for (const loser of t.rows) {
          if (winner.id === loser.id) continue;
          if (beatsOf(winner.pick) !== loser.pick) continue;
          const a = centre(winner.id);
          const b = centre(loser.id);
          if (!a || !b) continue;

          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', a.x);
          line.setAttribute('y1', a.y);
          line.setAttribute('x2', b.x);
          line.setAttribute('y2', b.y);
          line.setAttribute('class', winner.id === myId ? 'so-beam is-mine' : 'so-beam');
          // Staggered, so a sweep draws as a burst rather than appearing whole.
          line.style.animationDelay = `${Math.min(n * 45, 500)}ms`;
          beams.appendChild(line);
          n += 1;
        }
      }
    }

    /* ----------------------------- your own throw --------------------------- */

    function paintPick(s) {
      if (s.phase !== 'throw') {
        pickBox.replaceChildren();
        pickBox.hidden = true;
        return;
      }
      pickBox.hidden = false;

      const me = s.players.find((p) => p.id === myId);
      const chosen = s.you?.pick ?? null;

      // Rebuilt only when something about it changes, so a re-render mid-round
      // does not steal the press of a button somebody is holding.
      const want = `${s.round}:${chosen}:${JSON.stringify(me?.stock ?? null)}`;
      if (pickBox.dataset.want === want) return;
      pickBox.dataset.want = want;

      const row = document.createElement('div');
      row.className = 'so-throws';
      for (const t of THROWS) {
        const left = s.limited && me?.stock ? me.stock[t] : null;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'so-throw';
        btn.dataset.throw = t;
        btn.disabled = left === 0;
        btn.classList.toggle('is-on', chosen === t);
        btn.innerHTML =
          `<span class="so-throw-hand">${HAND[t]}</span>` +
          `<span class="so-throw-name">${LABEL[t]}</span>` +
          (left === null ? '' : `<span class="so-throw-left">${left === 0 ? 'none left' : `${left} left`}</span>`);
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          Net.action({ type: 'throw', pick: t });
          Sound.play('pick');
          pulse(btn);
        });
        row.appendChild(btn);
      }

      const note = document.createElement('p');
      note.className = 'so-pick-note muted';
      note.textContent = chosen
        ? `${LABEL[chosen]} it is. You can still change your mind.`
        : 'Throw against everyone at once. Nobody sees it until the count ends.';

      pickBox.replaceChildren(row, note);
    }

    /* -------------------------------- painting ------------------------------ */

    function paint(s) {
      state = s;
      myId = s.you?.id ?? myId ?? Net.playerId;

      // The rules, once.
      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        const list = $('#soRules');
        if (!list.children.length) {
          list.replaceChildren(
            ...(s.rules ?? []).map((line) => {
              const li = document.createElement('li');
              li.textContent = line;
              return li;
            })
          );
        }
        const waiting = s.players.filter((p) => p.connected !== false && !s.briefed.includes(p.id)).length;
        $('#soBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        $hud('#soClock').textContent = `${s.timeLeft}s`;
        $hud('#soRound').textContent = `${s.maxRounds} rounds`;
        return;
      }

      brief.hidden = true;
      table.hidden = false;

      $hud('#soRound').textContent = `Round ${s.round} of ${s.maxRounds}`;
      $hud('#soClock').textContent = s.phase === 'over' ? 'done' : `${s.timeLeft}s`;
      $hud('#soDouble').hidden = !s.doubled;

      layOutHands(s.players);
      paintHands(s);
      paintPick(s);

      if (s.phase === 'throw') {
        verdict.hidden = true;
        beams.replaceChildren();
        // Hands go back to fists for the new round.
        if (countedRound !== s.round) {
          countedRound = s.round;
          revealedRound = 0;
          for (const card of handsBox.querySelectorAll('.so-hand')) {
            card.classList.remove('is-shown', 'is-swept', 'is-beaten', 'is-forced');
            card.querySelector('.so-fist').textContent = '✊';
            card.querySelector('.so-gain').textContent = '';
          }
          runCount(s.phaseTotal ?? 12);
        }
      }

      if (s.phase === 'reveal' && s.table && revealedRound !== s.table.round) {
        revealedRound = s.table.round;
        countedRound = 0;
        reveal(s);
      }

      logBox.replaceChildren(
        ...(s.log ?? []).slice(-4).reverse().map((line) => {
          const li = document.createElement('li');
          li.textContent = line;
          return li;
        })
      );
    }

    const off = Net.on('game:state', paint);
    Net.requestState?.();

    // Beams are drawn in pixels, so they have to be redrawn when the box moves.
    const onResize = () => {
      if (state?.phase === 'reveal' && state.table) drawBeams(state);
    };
    addEventListener('resize', onResize);

    return () => {
      clearChant();
      off?.();
      removeEventListener('resize', onResize);
      wrap.classList.remove('so-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};

/** Counts as a sentence: "3 rock · 2 paper". */
function countsLine(counts) {
  return THROWS.filter((t) => counts[t] > 0)
    .map((t) => `${counts[t]} ${LABEL[t].toLowerCase()}`)
    .join(' · ');
}

/** Player ids contain > and <, which are not valid on their own in a selector. */
function cssEscape(value) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&');
}
