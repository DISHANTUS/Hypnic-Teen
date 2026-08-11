// Crack the Code.
//
// The screen is a list of every guess anybody has made and what came back, in
// the order they were made. That list is the game — everybody reasons off
// everybody else's information, so it is the middle of the screen rather than a
// log tucked underneath.
//
// Two clues are drawn as pips rather than written as numbers. "2 in place, 1
// elsewhere" is a sentence you have to read; two filled dots and one hollow one
// is a shape you can compare down a column at a glance, which is exactly what
// you are doing when you are trying to spot which digit moved.
//
// The setter sees their own code and nothing else useful. Everybody else's page
// does not contain it — not hidden, not masked, absent — so the console is no
// help either.

import { Sound } from '/js/sound.js';
import { confetti, floatText, motionReduced } from '/js/fx.js';
import { mountClock } from '/js/turnclock.mjs';

const PHASES = {
  brief: { label: 'Everybody is reading the rules', hint: 'Then somebody picks a code.' },
  setting: { label: 'A code is being chosen', hint: 'Then you all start guessing.' },
  guessing: { label: 'Guessing', you: 'Your guess', hint: 'Two clues back: in place, and elsewhere.' },
  reveal: { label: 'That is the round', hint: 'Next code is on its way.' },
  over: { label: 'That is the lot', hint: '' },
};

export default {
  mount({ canvas, wrap, hud, Net }) {
    canvas.style.display = 'none';
    wrap.classList.add('cb-stage');

    const root = document.createElement('div');
    root.className = 'cb';
    root.innerHTML = `
      <div class="cb-brief intro-card" hidden>
        <h2>Crack the Code</h2>
        <p class="muted">One of you knows it. The rest of you have two clues a go.</p>
        <ol class="intro-rules" id="cbRules"></ol>
        <button class="btn btn-primary intro-ready" id="cbBriefed" type="button">Ready</button>
        <p class="muted small" id="cbBriefWait"></p>
      </div>

      <div class="cb-table" hidden>
        <div class="cb-head"><b id="cbWho"></b><span id="cbCount"></span></div>

        <div class="cb-set" id="cbSet" hidden>
          <p class="muted small" id="cbSetNote"></p>
          <div class="cb-setrow">
            <input class="cb-input" id="cbCode" autocomplete="off" autocorrect="off"
              autocapitalize="characters" spellcheck="false">
            <button class="btn btn-primary" id="cbLock" type="button">Lock it in</button>
          </div>
          <button class="btn btn-quiet" id="cbDealt" type="button"></button>
        </div>

        <ul class="cb-guesses" id="cbGuesses"></ul>

        <div class="cb-play" id="cbPlay" hidden>
          <input class="cb-input" id="cbGuess" autocomplete="off" autocorrect="off"
            autocapitalize="characters" spellcheck="false">
          <button class="btn btn-primary" id="cbSend" type="button">Guess</button>
        </div>

        <p class="cb-said" id="cbSaid"></p>
        <div class="cb-seats" id="cbSeats"></div>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="cbRound">Round 1</span>
        <span class="hud-chip" id="cbMode"></span>
        <span class="hud-chip hud-accent" id="cbPhase">Waiting</span>
      </div>`;

    const clock = mountClock(hud);
    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);

    let shownRound = -1;
    let cheered = false;

    $('#cbBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#cbBriefed').disabled = true;
      $('#cbBriefed').textContent = 'Waiting for the room…';
    });

    const send = (el, type) => {
      const code = el.value.trim().toUpperCase();
      if (!code) return;
      Net.action({ type, code });
      el.value = '';
      Sound.play('pick');
    };
    $('#cbLock').addEventListener('click', () => send($('#cbCode'), 'setCode'));
    $('#cbSend').addEventListener('click', () => send($('#cbGuess'), 'guess'));
    for (const [box, type] of [['#cbCode', 'setCode'], ['#cbGuess', 'guess']]) {
      $(box).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); send($(box), type); }
      });
    }
    $('#cbDealt').addEventListener('click', () => {
      Net.action({ type: 'takeDealt' });
      Sound.play('pick');
    });

    /** Two clues as pips: filled for in-place, hollow for elsewhere. */
    function pips(exact, elsewhere, length) {
      const wrapEl = document.createElement('span');
      wrapEl.className = 'cb-pips';
      for (let i = 0; i < length; i++) {
        const pip = document.createElement('i');
        pip.className = i < exact ? 'is-exact' : i < exact + elsewhere ? 'is-near' : '';
        wrapEl.appendChild(pip);
      }
      return wrapEl;
    }

    function paint(s) {
      const brief = $('.cb-brief');
      const table = $('.cb-table');

      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        const list = $('#cbRules');
        if (!list.children.length) {
          list.replaceChildren(...(s.rules ?? []).map((line) => {
            const li = document.createElement('li');
            li.textContent = line;
            return li;
          }));
        }
        const waiting = s.seats.filter((r) => r.connected && !s.briefed.includes(r.id)).length;
        $('#cbBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        clock.paint({ ...PHASES.brief, left: s.timeLeft, total: s.phaseTotal });
        return;
      }

      brief.hidden = true;
      table.hidden = false;

      $hud('#cbRound').textContent = `Round ${s.round} of ${s.maxRounds}`;
      $hud('#cbMode').textContent = `${s.length} ${s.mode === 'word' ? 'letters' : 'digits'}`;
      $hud('#cbPhase').textContent =
        s.phase === 'setting' ? 'Choosing' : s.phase === 'guessing' ? 'Guessing'
        : s.phase === 'reveal' ? 'Revealed' : 'Finished';

      const yours = Boolean(s.you?.yourTurn);
      clock.paint({
        ...(PHASES[s.phase] ?? PHASES.over),
        label: s.phase === 'guessing'
          ? (yours ? 'Your guess' : `Waiting on ${s.turnName}`)
          : s.phase === 'setting' ? `${s.setterName} is choosing a code` : PHASES[s.phase]?.label,
        left: s.phase === 'guessing' ? s.turnLeft : s.timeLeft,
        total: s.phaseTotal,
        yours,
        idle: s.phase === 'reveal' || s.phase === 'over',
      });

      $('#cbWho').textContent = s.you?.isSetter
        ? 'Your code. Sit tight.'
        : `${s.setterName} set the code.`;
      $('#cbCount').textContent = `${s.guesses.length} of ${s.tries} guesses`;

      // The setter's half: choose a code, or take the one you were dealt.
      const setting = s.phase === 'setting' && s.you?.isSetter;
      $('#cbSet').hidden = !setting;
      if (setting) {
        $('#cbSetNote').textContent = s.mode === 'word'
          ? `A word, exactly ${s.length} letters. Nobody else will see it.`
          : `${s.length} digits. Repeats are allowed, and they make it harder.`;
        const box = $('#cbCode');
        box.maxLength = s.length;
        box.placeholder = s.mode === 'word' ? 'A word' : '0'.repeat(s.length);
        box.inputMode = s.mode === 'word' ? 'text' : 'numeric';
        $('#cbDealt').textContent = s.you.dealt ? `Use ${s.you.dealt} instead` : '';
        $('#cbDealt').hidden = !s.you.dealt;
      }

      // Everybody's guesses, newest last so the column reads downward.
      $('#cbGuesses').replaceChildren(
        ...(s.guesses ?? []).map((g) => {
          const li = document.createElement('li');
          li.className = 'cb-guess';
          li.classList.toggle('is-mine', g.by === s.you?.seat);
          li.classList.toggle('is-missed', Boolean(g.missed));
          li.innerHTML = '<span class="cb-n"></span><b class="cb-code"></b><small class="cb-by"></small>';
          li.querySelector('.cb-n').textContent = g.at;
          li.querySelector('.cb-code').textContent = g.missed ? '—' : g.code;
          li.querySelector('.cb-by').textContent = g.name;
          if (!g.missed) {
            li.appendChild(pips(g.exact, g.elsewhere, s.length));
            li.title = `${g.exact} in place, ${g.elsewhere} elsewhere`;
          }
          return li;
        })
      );

      // Your turn to guess.
      const guessing = s.phase === 'guessing' && yours;
      $('#cbPlay').hidden = !guessing;
      if (guessing) {
        const box = $('#cbGuess');
        box.maxLength = s.length;
        box.placeholder = s.mode === 'word' ? `${s.length} letters` : '0'.repeat(s.length);
        box.inputMode = s.mode === 'word' ? 'text' : 'numeric';
        if (document.activeElement !== box) box.focus();
      }

      // The reveal. Said plainly, because the whole round was about this.
      $('#cbSaid').textContent = s.revealed
        ? `${s.said}`
        : s.you?.isSetter && s.you.secret ? `Your code: ${s.you.secret}`
        : s.said ?? '';
      $('#cbSaid').classList.toggle('is-reveal', Boolean(s.revealed));

      if (shownRound !== s.round) { shownRound = s.round; cheered = false; }
      if (s.revealed && !cheered) {
        cheered = true;
        const mine = s.winner === s.you?.seat;
        if (!motionReduced && mine) { Sound.play('win'); confetti(root, { count: 60 }); }
        else Sound.play('reveal');
        if (mine) floatText($('#cbSaid'), 'cracked it', 'gain');
      }

      $('#cbSeats').replaceChildren(
        ...[...(s.seats ?? [])].sort((a, b) => b.score - a.score).map((p) => {
          const el = document.createElement('div');
          el.className = 'cb-seat';
          el.classList.toggle('is-setter', p.seat === s.setter);
          el.classList.toggle('is-turn', s.phase === 'guessing' && p.seat === s.turn);
          el.classList.toggle('is-you', p.seat === s.you?.seat);
          el.classList.toggle('is-gone', !p.connected);
          el.innerHTML = '<b></b><small></small>';
          el.querySelector('b').textContent = p.name;
          el.querySelector('small').textContent =
            `${p.score} · ${p.cracked} cracked${p.seat === s.setter ? ' · setting' : ''}`;
          return el;
        })
      );
    }

    const off = Net.on('game:state', paint);

    return () => {
      off?.();
      clock.destroy();
      wrap.classList.remove('cb-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
