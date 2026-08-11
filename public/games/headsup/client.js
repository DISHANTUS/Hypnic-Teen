// Heads Up.
//
// Two completely different screens for the same state, and which one you get
// is the whole game. The room sees the photograph and the name, big, with one
// instruction; the guesser sees a guess box and the trail of what they have
// already tried. Neither screen is the other one with things hidden — the
// guesser's state never contained the word, so there is nothing here to hide.

import { Sound } from '/js/sound.js';
import { confetti, floatText, motionReduced } from '/js/fx.js';
import { mountClock } from '/js/turnclock.js';

const PHASES = {
  brief: { label: 'Everybody is reading the rules', hint: 'Then somebody starts guessing.' },
  guessing: { label: 'Explaining', you: 'They are describing it to you', hint: 'Say anything but the name.' },
  reveal: { label: 'That was the word', hint: 'Next round on its way.' },
  over: { label: 'That is the lot', hint: '' },
};

export default {
  mount({ canvas, wrap, hud, Net }) {
    canvas.style.display = 'none';
    wrap.classList.add('hu-stage');

    const root = document.createElement('div');
    root.className = 'hu';
    root.innerHTML = `
      <div class="hu-brief intro-card" hidden>
        <h2>Heads Up</h2>
        <p class="muted">Everybody can see it except one of you. Explain it out loud — never say it.</p>
        <ol class="intro-rules" id="huRules"></ol>
        <button class="btn btn-primary intro-ready" id="huBriefed" type="button">Ready</button>
        <p class="muted small" id="huBriefWait"></p>
      </div>

      <div class="hu-table" hidden>
        <div class="hu-head" id="huHead"></div>

        <div class="hu-card" id="huCard" hidden>
          <img class="hu-photo" id="huPhoto" alt="" hidden>
          <b class="hu-word" id="huWord"></b>
          <p class="hu-dont">Explain it. Don't say it.</p>
          <button class="btn btn-quiet" id="huPass" type="button"></button>
        </div>

        <div class="hu-guess" id="huGuessBox" hidden>
          <p class="hu-prompt">The room is describing something. What is it?</p>
          <div class="hu-row">
            <input class="hu-input" id="huGuess" autocomplete="off" autocorrect="off"
              autocapitalize="off" spellcheck="false" placeholder="Your guess">
            <button class="btn btn-primary" id="huSend" type="button">Guess</button>
          </div>
        </div>

        <ul class="hu-tried" id="huTried"></ul>
        <p class="hu-said" id="huSaid"></p>
        <div class="hu-seats" id="huSeats"></div>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="huRound">Round 1</span>
        <span class="hud-chip hud-accent" id="huPhase">Waiting</span>
      </div>`;

    const clock = mountClock(hud);
    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);

    let cheeredRound = -1;

    $('#huBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#huBriefed').disabled = true;
      $('#huBriefed').textContent = 'Waiting for the room…';
    });

    const send = () => {
      const box = $('#huGuess');
      const text = box.value.trim();
      if (!text) return;
      Net.action({ type: 'guess', text });
      box.value = '';
      Sound.play('pick');
    };
    $('#huSend').addEventListener('click', send);
    $('#huGuess').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
    });
    $('#huPass').addEventListener('click', () => {
      Net.action({ type: 'pass' });
      Sound.play('back');
    });

    function paint(s) {
      const brief = $('.hu-brief');
      const table = $('.hu-table');

      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        const list = $('#huRules');
        if (!list.children.length) {
          list.replaceChildren(...(s.rules ?? []).map((line) => {
            const li = document.createElement('li');
            li.textContent = line;
            return li;
          }));
        }
        const waiting = s.seats.filter((r) => r.connected && !s.briefed.includes(r.id)).length;
        $('#huBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        clock.paint({ ...PHASES.brief, left: s.timeLeft, total: s.phaseTotal });
        return;
      }

      brief.hidden = true;
      table.hidden = false;

      $hud('#huRound').textContent = `Round ${s.round} of ${s.maxRounds}`;
      $hud('#huPhase').textContent =
        s.phase === 'guessing' ? (s.you?.guessing ? 'Guess!' : 'Explain!')
        : s.phase === 'reveal' ? 'Revealed' : 'Finished';

      const guessing = s.phase === 'guessing';
      const mine = Boolean(s.you?.guessing);

      clock.paint({
        ...(PHASES[s.phase] ?? PHASES.over),
        label: guessing
          ? (mine ? 'They are describing it to you' : `${s.guesserName} is guessing`)
          : PHASES[s.phase]?.label,
        left: s.timeLeft,
        total: s.phaseTotal,
        yours: mine && guessing,
        idle: s.phase === 'over',
      });

      $('#huHead').textContent =
        s.phase === 'reveal'
          ? (s.lastBy ? `${s.lastBy} got it: ${s.lastWord}` : `Nobody got it. It was ${s.lastWord}.`)
          : guessing && !mine ? `Only ${s.guesserName} cannot see this.` : '';

      // The room's card. `s.word` simply is not in the guesser's state, so
      // this branch cannot leak by accident.
      const showCard = guessing && !mine && s.word;
      $('#huCard').hidden = !showCard;
      if (showCard) {
        const img = $('#huPhoto');
        if (s.picture) {
          if (img.getAttribute('src') !== s.picture) img.src = s.picture;
          img.hidden = false;
        } else {
          img.hidden = true;
          img.removeAttribute('src');
        }
        $('#huWord').textContent = s.word;
        $('#huPass').textContent = s.you?.voted
          ? `Swap it — ${s.passVotes} of ${s.passNeed}`
          : s.passVotes > 0 ? `Swap the word (${s.passVotes} of ${s.passNeed})` : 'Swap the word';
        $('#huPass').disabled = Boolean(s.you?.voted);
      }

      $('#huGuessBox').hidden = !(guessing && mine);
      if (guessing && mine && document.activeElement !== $('#huGuess')) $('#huGuess').focus();

      // What has been tried, newest first — the room reads this to know which
      // wrong trail to talk the guesser off.
      $('#huTried').replaceChildren(
        ...[...(s.guesses ?? [])].reverse().slice(0, 6).map((g) => {
          const li = document.createElement('li');
          li.textContent = g.text;
          return li;
        })
      );

      $('#huSaid').textContent = s.said ?? '';

      $('#huSeats').replaceChildren(
        ...(s.seats ?? []).map((p) => {
          const el = document.createElement('div');
          el.className = 'hu-seat';
          el.classList.toggle('is-guesser', p.seat === s.guesser && guessing);
          el.classList.toggle('is-you', p.id === s.you?.id);
          el.classList.toggle('is-gone', !p.connected);
          el.innerHTML = '<b></b><small></small>';
          el.querySelector('b').textContent = p.name;
          el.querySelector('small').textContent = `${p.score} pts · got ${p.got}`;
          return el;
        })
      );

      // The catch, celebrated once per round on the screens that earned it.
      if (s.phase === 'reveal' && s.lastBy && cheeredRound !== s.round) {
        cheeredRound = s.round;
        Sound.play('win');
        if (!motionReduced) {
          confetti(table, { count: 50 });
          floatText($('#huHead'), s.lastWord ?? '', 'gain');
        }
      }
    }

    const off = Net.on('game:state', paint);

    return () => {
      off?.();
      clock.destroy();
      wrap.classList.remove('hu-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
