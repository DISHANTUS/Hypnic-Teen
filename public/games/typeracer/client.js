// Type Racer.
//
// The passage, a box to type it into, and everybody's bar moving at once.
//
// The text you have already got right is drawn behind the cursor in a settled
// colour and the rest is drawn ahead of it in a faint one, so the passage reads
// as a track rather than as a wall of words. The character you are on is
// highlighted, because when you lose your place that is the only thing that
// gets you back.
//
// One decision worth saying: a wrong keystroke reddens the box and does not
// move you on, and the box does not stop accepting input. Locking the keyboard
// on a mistake sounds helpful and is horrible — you cannot delete your way out
// of it, and the natural thing a typist does when they go wrong is exactly what
// the game would be refusing.

import { Sound } from '/js/sound.js';
import { confetti, floatText, motionReduced } from '/js/fx.js';
import { mountClock } from '/js/turnclock.mjs';

const PHASES = {
  brief: { label: 'Everybody is reading the rules', hint: 'Then a countdown, then the passage.' },
  ready: { label: 'Get ready', hint: 'The passage appears when this hits zero.' },
  race: { label: 'Type it', you: 'Type it', hint: 'A wrong character stops you until you fix it.' },
  done: { label: 'That is the race', hint: 'The next passage is on its way.' },
};

export default {
  mount({ canvas, wrap, hud, Net }) {
    canvas.style.display = 'none';
    wrap.classList.add('tr-stage');

    const root = document.createElement('div');
    root.className = 'tr';
    root.innerHTML = `
      <div class="tr-brief intro-card" hidden>
        <h2>Type Racer</h2>
        <p class="muted">One passage, everybody at once. The clock is the server's, not your browser's.</p>
        <ol class="intro-rules" id="trRules"></ol>
        <button class="btn btn-primary intro-ready" id="trBriefed" type="button">Ready</button>
        <p class="muted small" id="trBriefWait"></p>
      </div>

      <div class="tr-table" hidden>
        <div class="tr-bars" id="trBars"></div>
        <div class="tr-passage" id="trPassage"></div>
        <textarea class="tr-input" id="trInput" rows="3" autocomplete="off" autocorrect="off"
          autocapitalize="off" spellcheck="false" disabled
          placeholder="Wait for the passage…"></textarea>
        <div class="tr-mine" id="trMine"></div>
        <ul class="tr-log" id="trLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="trRound">Race 1</span>
        <span class="hud-chip" id="trWpm">— wpm</span>
        <span class="hud-chip hud-accent" id="trPhase">Waiting</span>
      </div>`;

    const clock = mountClock(hud);

    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);
    const brief = $('.tr-brief');
    const table = $('.tr-table');
    const input = $('#trInput');

    let shownRound = 0;
    let shownPassage = '';
    let lastSent = '';

    $('#trBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#trBriefed').disabled = true;
      $('#trBriefed').textContent = 'Waiting for the room…';
    });

    // Sent on every change rather than on a timer, because the bar moving in
    // step with the keys is most of what makes this feel like a race. The
    // passages are a couple of hundred characters, so this is nothing.
    input.addEventListener('input', () => {
      const text = input.value;
      if (text === lastSent) return;
      lastSent = text;
      Net.action({ type: 'typed', text });
    });

    // Enter would submit nothing and lose a line. Tab would leave the box.
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Tab') e.preventDefault();
    });

    /** The passage as a track: done, here, and still to come. */
    function paintPassage(passage, at) {
      const box = $('#trPassage');
      if (box.dataset.passage !== passage) {
        box.dataset.passage = passage;
        box.replaceChildren(
          ...[...passage].map((ch) => {
            const el = document.createElement('span');
            el.className = 'tr-ch';
            // The real character, always. An earlier version swapped spaces
            // for non-breaking ones so the highlight had a box to sit on,
            // which made the passage on screen differ from the passage you
            // must type — invisible to a person, and wrong for anything that
            // reads the page. The highlight gets its width from CSS instead.
            el.textContent = ch;
            return el;
          })
        );
      }
      const chars = box.children;
      for (let i = 0; i < chars.length; i++) {
        chars[i].classList.toggle('is-done', i < at);
        chars[i].classList.toggle('is-here', i === at);
      }
      // Keep the character you are on in view without dragging the whole page.
      if (!motionReduced && chars[at]) {
        chars[at].scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }

    function paint(s) {
      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        const list = $('#trRules');
        if (!list.children.length) {
          list.replaceChildren(
            ...(s.rules ?? []).map((line) => {
              const li = document.createElement('li');
              li.textContent = line;
              return li;
            })
          );
        }
        const waiting = s.racers.filter((r) => r.connected && !s.briefed.includes(r.id)).length;
        $('#trBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        clock.paint({ ...PHASES.brief, left: s.timeLeft, total: s.phaseTotal });
        return;
      }

      brief.hidden = true;
      table.hidden = false;

      $hud('#trRound').textContent = `Race ${s.round} of ${s.maxRounds}`;
      $hud('#trWpm').textContent = s.you?.wpm ? `${s.you.wpm} wpm` : '— wpm';
      $hud('#trPhase').textContent =
        s.phase === 'ready' ? 'Get ready' : s.phase === 'race' ? 'Go' :
        s.phase === 'done' ? 'Race over' : 'Finished';

      clock.paint({
        ...(PHASES[s.phase] ?? PHASES.done),
        left: s.timeLeft,
        total: s.phaseTotal,
        yours: s.phase === 'race' && !s.you?.finished,
      });

      // A new race clears the box, and the countdown keeps it shut so nobody
      // can line up the first few words before the clock starts.
      if (shownRound !== s.round) {
        shownRound = s.round;
        shownPassage = '';
        lastSent = '';
        input.value = '';
      }
      const racing = s.phase === 'race' && !s.you?.finished;
      input.disabled = !racing;
      input.placeholder = s.phase === 'ready' ? 'Any moment…' : racing ? 'Type it here' : 'Race over';
      if (racing && document.activeElement !== input) input.focus();

      if (s.passage && shownPassage !== s.passage) {
        shownPassage = s.passage;
        if (!motionReduced) Sound.play('reveal');
      }
      if (s.passage) paintPassage(s.passage, s.you?.at ?? 0);

      // Wrong is a colour, not a lock. You must be able to delete your way out.
      const typed = input.value;
      const wrong = typed.length > (s.you?.at ?? 0);
      input.classList.toggle('is-wrong', racing && wrong);

      // Everybody's bar, yours marked.
      $('#trBars').replaceChildren(
        ...[...(s.racers ?? [])]
          .sort((a, b) => b.at - a.at)
          .map((r) => {
            const row = document.createElement('div');
            row.className = 'tr-bar';
            row.classList.toggle('is-you', r.id === s.you?.id);
            row.classList.toggle('is-done', r.finished);
            row.classList.toggle('is-suspect', r.suspect);
            row.innerHTML = `<b></b><span class="tr-track"><i></i></span><small></small>`;
            row.querySelector('b').textContent = r.name;
            const pct = r.of ? Math.round((r.at / r.of) * 100) : 0;
            row.querySelector('i').style.width = `${pct}%`;
            row.querySelector('small').textContent = r.suspect
              ? `${r.wpm} wpm — not counted`
              : r.finished ? `${r.wpm} wpm · ${r.accuracy}%` : `${pct}%`;
            return row;
          })
      );

      $('#trMine').textContent = s.you?.suspect
        ? 'That was faster than the world record, so it has not been counted. Say so if that is wrong.'
        : s.you?.finished ? `Done — ${s.you.wpm} wpm at ${s.you.accuracy}% accuracy.`
        : '';

      if (s.you?.finished && !table.dataset.cheered) {
        table.dataset.cheered = '1';
        if (!s.you.suspect) { Sound.play('win'); confetti(table, { count: 60 }); floatText($('#trMine'), `${s.you.wpm} wpm`, 'gain'); }
      }
      if (!s.you?.finished) delete table.dataset.cheered;

      $('#trLog').replaceChildren(
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
      clock.destroy();
      wrap.classList.remove('tr-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
