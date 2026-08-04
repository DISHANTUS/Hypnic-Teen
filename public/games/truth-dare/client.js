// Truth or Dare — the circle and the bottle.
//
// The players sit in a ring and a bottle spins in the middle. The server
// decides where it stops; this only has to get it there convincingly, which
// means spinning past the answer several times and easing into it rather than
// snapping. Everything after the spin is a panel that changes depending on
// whether you are the one on the spot, the one asking, or watching.

import { Sound } from '/js/sound.js';
import { confetti, shake, floatText } from '/js/fx.js';

const TAU = Math.PI * 2;

export default {
  mount({ canvas, wrap, hud, Net }) {
    canvas.style.display = 'none';
    wrap.classList.add('td-stage');

    const root = document.createElement('div');
    root.className = 'td';
    root.innerHTML = `
      <div class="td-brief intro-card" hidden>
        <h2>Truth or Dare</h2>
        <p class="muted">The bottle picks you. Someone across the circle picks what you do.</p>
        <ol class="intro-rules" id="tdRules"></ol>
        <button class="btn btn-primary intro-ready" id="tdBriefed" type="button">Ready</button>
        <p class="muted small" id="tdBriefWait"></p>
      </div>

      <div class="td-table" hidden>
        <div class="td-ring" id="tdRing">
          <canvas class="td-bottle" id="tdBottle"></canvas>
          <div class="td-seats" id="tdSeats"></div>
        </div>
        <div class="td-panel" id="tdPanel"></div>
        <ul class="td-log" id="tdLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <span class="chip" id="tdPhase">Spinning</span>
      <span class="chip">⏱ <b id="tdClock">–</b>s</span>
      <span class="chip" id="tdRound"></span>`;

    const el = {
      brief: root.querySelector('.td-brief'),
      rules: root.querySelector('#tdRules'),
      briefWait: root.querySelector('#tdBriefWait'),
      table: root.querySelector('.td-table'),
      ring: root.querySelector('#tdRing'),
      seats: root.querySelector('#tdSeats'),
      panel: root.querySelector('#tdPanel'),
      log: root.querySelector('#tdLog'),
      phase: hud.querySelector('#tdPhase'),
      clock: hud.querySelector('#tdClock'),
      round: hud.querySelector('#tdRound'),
    };

    const bottleCanvas = root.querySelector('#tdBottle');
    const ctx = bottleCanvas.getContext('2d');

    let view = null;
    let clock = 0;
    let lastPhase = null;
    let lastSpinAt = null;
    let panelKey = '';   // what the panel is currently showing, so typing survives repaints

    /* ------------------------------ the bottle ---------------------------- */

    // Where the bottle is pointing right now, and where it is heading. Kept in
    // turns rather than degrees so several whole rotations are just a number.
    let angle = 0;
    let from = 0;
    let to = 0;
    let spinStart = 0;
    let spinMs = 4200;

    function sizeCanvas() {
      const box = el.ring.getBoundingClientRect();
      const size = Math.max(200, Math.min(box.width, box.height));
      const dpr = Math.min(2, devicePixelRatio || 1);
      bottleCanvas.width = size * dpr;
      bottleCanvas.height = size * dpr;
      bottleCanvas.style.width = `${size}px`;
      bottleCanvas.style.height = `${size}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /** Fast at first, then a long settle — the way a real bottle gives up. */
    const easeOut = (t) => 1 - Math.pow(1 - t, 3.2);

    function drawBottle() {
      const w = bottleCanvas.width / (Math.min(2, devicePixelRatio || 1));
      const h = w;
      const cx = w / 2;
      const cy = h / 2;
      const len = w * 0.30;

      ctx.clearRect(0, 0, w, h);

      // The felt in the middle of the ring, so the bottle has something to
      // spin on rather than floating in space.
      ctx.save();
      const felt = ctx.createRadialGradient(cx, cy, len * 0.2, cx, cy, len * 1.5);
      felt.addColorStop(0, 'rgba(255,209,102,0.10)');
      felt.addColorStop(1, 'rgba(255,209,102,0)');
      ctx.fillStyle = felt;
      ctx.beginPath();
      ctx.arc(cx, cy, len * 1.5, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(cx, cy);
      // Seat 0 sits at the top, so zero degrees has to point up.
      ctx.rotate((angle - 90) * (Math.PI / 180));

      // Blur it while it is really moving — a crisp bottle at speed looks like
      // a picture being rotated, which is exactly what it is.
      const speed = Math.abs(to - from) > 1 ? Math.max(0, 1 - (performance.now() - spinStart) / spinMs) : 0;
      ctx.globalAlpha = 1;
      if (speed > 0.15) {
        ctx.shadowBlur = 18 * speed;
        ctx.shadowColor = 'rgba(255, 209, 102, 0.65)';
      }

      // Body: a long tapered glass with a neck at the pointing end.
      const grad = ctx.createLinearGradient(-len * 0.5, 0, len, 0);
      grad.addColorStop(0, '#1f6b46');
      grad.addColorStop(0.45, '#39b877');
      grad.addColorStop(1, '#8ef0be');
      ctx.fillStyle = grad;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;

      const beam = len * 0.20;
      ctx.beginPath();
      ctx.moveTo(-len * 0.62, -beam * 0.62);           // base
      ctx.lineTo(-len * 0.30, -beam);
      ctx.lineTo(len * 0.30, -beam);                    // shoulder
      ctx.lineTo(len * 0.52, -beam * 0.34);             // neck
      ctx.lineTo(len * 0.98, -beam * 0.26);
      ctx.lineTo(len * 0.98, beam * 0.26);
      ctx.lineTo(len * 0.52, beam * 0.34);
      ctx.lineTo(len * 0.30, beam);
      ctx.lineTo(-len * 0.30, beam);
      ctx.lineTo(-len * 0.62, beam * 0.62);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // A highlight down the length, which is most of what makes glass read.
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.ellipse(len * 0.05, -beam * 0.45, len * 0.42, beam * 0.16, 0, 0, TAU);
      ctx.fill();

      // The cap, so which end is the neck is never in doubt.
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(len * 0.90, -beam * 0.30, len * 0.12, beam * 0.6);
      ctx.restore();
    }

    let raf = null;
    function animate() {
      raf = requestAnimationFrame(animate);
      if (to !== from) {
        const t = Math.min(1, (performance.now() - spinStart) / spinMs);
        angle = from + (to - from) * easeOut(t);
        if (t >= 1) from = to;
      }
      // Where the neck is pointing, in the same terms the seats are laid out
      // in. Exposed so a test can check the bottle agrees with the highlight —
      // the two drifted apart once and nothing in the DOM showed it.
      window.__tdAngle = ((angle % 360) + 360) % 360;
      drawBottle();
    }

    function startSpin(bottle) {
      if (!bottle) return;
      // The server says which way the neck must be pointing when it stops.
      // Adding its number to wherever the bottle happens to be lying — which
      // is what this did — lands it that far past the answer, so the neck
      // pointed at nobody in particular and the offset carried into the next
      // spin. Work out the short way round to the target, then add the whole
      // turns on top of that.
      from = angle;
      const here = ((angle % 360) + 360) % 360;
      const target = ((bottle.angle % 360) + 360) % 360;
      const sweep = ((target - here) % 360 + 360) % 360;
      const turns = Math.max(3, Math.round((bottle.spinTo ?? 1440) / 360));
      to = angle + turns * 360 + sweep;
      spinStart = performance.now();
      spinMs = 4200;
      Sound.play('spin');
    }

    /* ------------------------------- the ring ----------------------------- */

    function paintSeats(v) {
      const seats = v.seats ?? [];
      const n = seats.length || 1;
      const box = el.ring.getBoundingClientRect();
      const radius = Math.max(90, Math.min(box.width, box.height) / 2 - 44);

      el.seats.replaceChildren(
        ...seats.map((id, i) => {
          const p = v.players.find((x) => x.id === id);
          const chip = document.createElement('div');
          chip.className = 'td-seat';
          if (id === v.askedId) chip.classList.add('asked');
          if (id === v.askerId) chip.classList.add('asker');
          if (id === v.you?.id) chip.classList.add('me');
          if (p?.nickname) chip.classList.add('mocked');

          // Seat 0 at the top, clockwise from there — the same convention the
          // server uses to decide where the bottle landed.
          const deg = (i * 360) / n - 90;
          const rad = deg * (Math.PI / 180);
          chip.style.left = `calc(50% + ${Math.cos(rad) * radius}px)`;
          chip.style.top = `calc(50% + ${Math.sin(rad) * radius}px)`;

          chip.innerHTML = '<b></b><small></small><span class="td-seat-score"></span>';
          // Once you have been named, the name is what the room calls you —
          // so it goes where your name was, and your own name goes small
          // underneath. A nickname tucked away in the caption is not mockery,
          // it is a footnote.
          chip.querySelector('b').textContent = p?.nickname ? `"${p.nickname}"` : p?.name ?? '—';
          chip.querySelector('small').textContent = p?.nickname ? p.name : '';
          chip.querySelector('.td-seat-score').textContent = p?.score ?? 0;
          return chip;
        })
      );
    }

    /* ------------------------------ the panel ----------------------------- */

    const nameOf = (v, id) => v.players.find((p) => p.id === id)?.name ?? 'Someone';

    /** Whether this round is a truth or a dare, said once and read by everyone. */
    function kindTag(choice) {
      const tag = document.createElement('span');
      tag.className = `td-kind ${choice ?? ''}`;
      tag.textContent = choice === 'dare' ? 'DARE' : 'TRUTH';
      return tag;
    }

    /** A line somebody said, with who said it. */
    function quote(text, by = '', variant = '') {
      const wrapper = document.createElement('figure');
      wrapper.className = `td-quote ${variant}`;
      const q = document.createElement('blockquote');
      q.className = 'td-question';
      q.textContent = text ?? '';
      wrapper.appendChild(q);
      if (by) {
        const cap = document.createElement('figcaption');
        cap.textContent = by;
        wrapper.appendChild(cap);
      }
      return wrapper;
    }

    function panel(v) {
      const mine = v.you ?? {};
      const asked = nameOf(v, v.askedId);
      const asker = nameOf(v, v.askerId);

      // Rebuilding the panel while somebody is typing into it throws away what
      // they have written, so it is only rebuilt when it actually changes.
      const key = [v.phase, v.round, v.choice, Boolean(v.question), v.claimed, v.verdict, v.outcome].join('|');
      if (key === panelKey) return;
      panelKey = key;

      const box = document.createElement('div');
      box.className = 'td-panel-in';

      const head = (title, sub = '') => {
        const h = document.createElement('h3');
        h.textContent = title;
        box.appendChild(h);
        if (sub) {
          const p = document.createElement('p');
          p.className = 'muted small';
          p.textContent = sub;
          box.appendChild(p);
        }
      };

      const button = (label, cls, onClick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `btn ${cls}`;
        b.textContent = label;
        b.addEventListener('click', () => {
          onClick();
          Sound.play('pick');
        });
        box.appendChild(b);
        return b;
      };

      const writer = (placeholder, send, suggestion) => {
        const area = document.createElement('textarea');
        area.className = 'td-input';
        area.rows = 3;
        area.maxLength = 240;
        area.placeholder = placeholder;
        box.appendChild(area);
        // A card to start from, for anyone whose mind has gone blank. Tapping
        // it fills the box rather than sending it, so it can still be edited.
        if (suggestion) {
          const hint = document.createElement('button');
          hint.type = 'button';
          hint.className = 'td-suggestion';
          hint.textContent = `💡 ${suggestion}`;
          hint.title = 'Use this as a starting point';
          hint.addEventListener('click', () => {
            area.value = suggestion;
            area.focus();
          });
          box.appendChild(hint);
        }
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'btn btn-primary';
        go.textContent = 'Send';
        go.addEventListener('click', () => {
          const text = area.value.trim();
          if (!text) return area.focus();
          go.disabled = true;
          go.textContent = 'Sent';
          send(text);
          Sound.play('join');
        });
        area.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) go.click();
        });
        box.appendChild(go);
        setTimeout(() => area.focus(), 60);
      };

      switch (v.phase) {
        case 'spin':
          head('The bottle is spinning…', 'Wherever the neck stops, that is who is on the spot.');
          break;

        case 'choose':
          if (mine.isAsked) {
            head('You are on the spot.', `${asker} is asking. Pick your poison.`);
            const row = document.createElement('div');
            row.className = 'td-choices';
            box.appendChild(row);
            for (const [id, label, note] of [
              ['truth', 'Truth', 'Answer honestly, in writing'],
              ['dare', 'Dare', 'Do it for real. Worth more'],
            ]) {
              const b = document.createElement('button');
              b.type = 'button';
              b.className = 'td-choice';
              b.innerHTML = '<b></b><small></small>';
              b.querySelector('b').textContent = label;
              b.querySelector('small').textContent = note;
              b.addEventListener('click', () => {
                Net.action({ type: 'choice', choice: id });
                Sound.play('pick');
              });
              row.appendChild(b);
            }
          } else {
            head(`${asked} is choosing.`, `${asker} is asking them. Sit tight.`);
          }
          break;

        case 'write':
          if (mine.isAsker) {
            head(
              v.choice === 'dare' ? `Set ${asked} a dare.` : `Ask ${asked} a question.`,
              v.choice === 'dare'
                ? 'Something they can actually do, here, now. You are the one who has to confirm it.'
                : 'Something you genuinely want to know. They have to answer it in front of everyone.'
            );
            writer(
              v.choice === 'dare' ? 'I dare you to…' : 'Tell us…',
              (text) => Net.action({ type: 'question', text }),
              mine.suggestion
            );
          } else if (mine.isAsked) {
            head(`${asker} is writing your ${v.choice}.`, 'No idea what is coming. That is the point.');
          } else {
            head(`${asker} is writing.`, `${asked} has picked ${v.choice}.`);
          }
          break;

        case 'act': {
          if (mine.isAsked) {
            head(v.choice === 'dare' ? 'Do it.' : 'Answer it.', `From ${asker}.`);
            box.append(kindTag(v.choice), quote(v.question));
            if (v.choice === 'truth') {
              writer('Your answer…', (text) => Net.action({ type: 'answer', text }));
            } else {
              button('I did it', 'btn-primary', () => Net.action({ type: 'did-it' }));
            }
            button('I am not doing that', 'btn-quiet', () => Net.action({ type: 'nope' }));
          } else {
            head(`${asked} is ${v.choice === 'dare' ? 'doing it' : 'answering'}.`, `Set by ${asker}. Watch.`);
            box.append(kindTag(v.choice), quote(v.question));
          }
          break;
        }

        case 'verdict': {
          if (mine.isAsker) {
            head(`${asked} says it is done.`, 'You set it, so you decide. Did that count?');
          } else {
            head(`${asked} says it is done.`, `${asker} has to confirm it.`);
          }
          // The room is being asked to judge something, so the room has to be
          // able to read what it was. This used to disappear the moment the
          // dare was claimed, leaving everyone but two people guessing.
          box.append(kindTag(v.choice), quote(v.question));
          if (mine.isAsker) {
            button('Yes, they did it', 'btn-primary', () => Net.action({ type: 'verdict', ok: true }));
            button('No, that does not count', 'btn-quiet', () => Net.action({ type: 'verdict', ok: false }));
          }
          break;
        }

        case 'reveal': {
          const lines = {
            performed: [`${asked} did it.`, 'Confirmed by the person who set it.'],
            answered: [`${asked} answered.`, ''],
            refused: [`${asked} backed out.`, 'And the room has opinions.'],
            disputed: [`${asker} says that did not count.`, 'Harsh, but they set it.'],
            unconfirmed: [`${asker} never confirmed it.`, `${asked} gets the benefit of the doubt.`],
            'no-choice': [`${asked} said nothing.`, ''],
            'no-question': [`${asker} never asked anything.`, 'Round wasted.'],
          };
          const [title, sub] = lines[v.outcome] ?? ['Round over', ''];
          head(title, sub);

          // What was asked, then what came back. Showing the answer on its own
          // — which is what this did — leaves everyone who was not one of the
          // two people involved reading a reply to a question they never saw.
          if (v.question) box.append(kindTag(v.choice), quote(v.question, `asked by ${asker}`));
          if (v.choice === 'truth' && v.answer) box.appendChild(quote(v.answer, `${asked} answered`, 'answer'));

          const mocked = v.players.find((p) => p.id === v.askedId)?.nickname;
          if (mocked && (v.outcome === 'refused' || v.outcome === 'disputed')) {
            const n = document.createElement('p');
            n.className = 'td-nickname';
            n.textContent = `From now on: "${mocked}"`;
            box.appendChild(n);
          }

          const scores = Object.entries(v.roundScores ?? {});
          if (scores.length) {
            const list = document.createElement('ul');
            list.className = 'td-scores';
            for (const [id, points] of scores) {
              const li = document.createElement('li');
              li.textContent = `${nameOf(v, id)} +${points}`;
              list.appendChild(li);
            }
            box.appendChild(list);
          }
          break;
        }

        default:
          head('Waiting…');
      }

      el.panel.replaceChildren(box);
    }

    /* ------------------------------- painting ----------------------------- */

    function paintBrief(v) {
      el.brief.hidden = v.phase !== 'intro';
      el.table.hidden = v.phase === 'intro';
      if (v.phase !== 'intro') return;
      if (!el.rules.childElementCount) {
        el.rules.replaceChildren(
          ...(v.rules ?? []).map((line) => {
            const li = document.createElement('li');
            li.textContent = line;
            return li;
          })
        );
      }
      const waiting = (v.players ?? []).filter((p) => !p.briefed).length;
      el.briefWait.textContent = waiting ? `Waiting for ${waiting}…` : 'Everyone is in.';
    }

    function paintLog(v) {
      el.log.replaceChildren(
        ...(v.log ?? []).map((entry) => {
          const li = document.createElement('li');
          li.className = `td-log-${entry.tone}`;
          li.textContent = entry.text;
          return li;
        })
      );
      el.log.scrollTop = el.log.scrollHeight;
    }

    function paint(v) {
      view = v;
      paintBrief(v);

      el.phase.textContent =
        { intro: 'Rules', spin: 'Spinning', choose: 'Choosing', write: 'Writing', act: 'On the spot', verdict: 'Confirming', reveal: 'Result' }[
          v.phase
        ] ?? '—';
      el.round.textContent = v.round ? `Round ${v.round}/${v.maxRounds}` : '';
      clock = v.timeLeft;
      el.clock.textContent = Math.max(0, Math.round(clock));

      if (v.phase !== 'intro') {
        sizeCanvas();
        paintSeats(v);
        panel(v);
        paintLog(v);
      }

      // A new spin is a new bottle position, and only the first frame of it
      // should start the animation — the state arrives twice a second.
      if (v.bottle && v.bottle.at !== lastSpinAt) {
        lastSpinAt = v.bottle.at;
        startSpin(v.bottle);
      }

      if (v.phase !== lastPhase) {
        lastPhase = v.phase;
        if (v.phase === 'reveal') {
          const chip = el.seats.querySelector('.td-seat.asked');
          if (v.outcome === 'performed' || v.outcome === 'answered') {
            confetti(el.panel, { count: 24 });
            Sound.play('win');
          } else if (v.outcome === 'refused' || v.outcome === 'disputed') {
            if (chip) shake(chip);
            Sound.play('lose');
          }
          const points = v.roundScores?.[v.askedId];
          if (points && chip) floatText(chip, `+${points}`);
        }
      }
    }

    root.querySelector('#tdBriefed').addEventListener('click', (e) => {
      Net.action({ type: 'ready' });
      e.currentTarget.disabled = true;
      Sound.play('join');
    });

    const offState = Net.on('game:state', paint);
    const tick = setInterval(() => {
      if (clock > 0) {
        clock -= 0.25;
        el.clock.textContent = Math.max(0, Math.round(clock));
      }
    }, 250);
    const onResize = () => {
      sizeCanvas();
      if (view) paintSeats(view);
    };
    addEventListener('resize', onResize);

    sizeCanvas();
    animate();

    return () => {
      offState();
      clearInterval(tick);
      cancelAnimationFrame(raf);
      removeEventListener('resize', onResize);
      wrap.classList.remove('td-stage');
      root.remove();
      hud.innerHTML = '';
      canvas.style.display = '';
    };
  },
};
