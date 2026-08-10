// One renderer for every party game.
//
// The server decides the phase and what each player may see; this file only
// draws it. Adding a game to server/games/ needs no change here unless it
// introduces a genuinely new phase.

import { Sound } from '/js/sound.js';
import { confetti, flash, shake, floatText, pulse } from '/js/fx.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export default {
  mount({ canvas, wrap, hud, Net, meta }) {
    canvas.hidden = true;
    wrap.classList.add('party-stage');

    const root = el('div', 'party');
    root.innerHTML = `
      <div class="party-top">
        <div class="party-round"><b id="pRound">Round 1</b><small id="pPhase"></small></div>
        <div class="timer"><svg viewBox="0 0 36 36"><circle class="timer-track" cx="18" cy="18" r="16"/>
          <circle class="timer-fill" id="pTimerRing" cx="18" cy="18" r="16"/></svg>
          <span id="pTimer">0</span></div>
      </div>
      <div class="party-body" id="pBody"></div>
      <div class="party-players" id="pPlayers"></div>`;
    wrap.appendChild(root);

    const $ = (sel) => root.querySelector(sel);
    const body = $('#pBody');
    const ring = $('#pTimerRing');
    const RING = 2 * Math.PI * 16;
    ring.style.strokeDasharray = String(RING);

    hud.innerHTML = '<span class="chip">⭐ <b id="pScore">0</b></span>';
    const scoreEl = hud.querySelector('#pScore');

    let last = null;
    let renderedKey = '';
    let lastPhase = '';
    let lastTick = -1;
    let lastHints = 0;
    let receivedAt = 0;
    const doneBefore = new Set();

    /**
     * The server only sends state when something actually changes, so the
     * countdown is run here — measured forward from the last frame we received
     * rather than from a server timestamp, which keeps it immune to clock skew.
     */
    function remaining() {
      if (!last) return 0;
      const elapsed = (performance.now() - receivedAt) / 1000;
      return Math.max(0, Math.ceil(last.timeLeft - elapsed));
    }

    function paintClock() {
      if (!last) return;
      const left = remaining();
      $('#pTimer').textContent = left;
      const frac = last.phaseTotal ? Math.max(0, left / last.phaseTotal) : 0;
      ring.style.strokeDashoffset = String(RING * (1 - frac));
      ring.classList.toggle('urgent', left <= 5);

      // Ticks come off the local clock too, so they stay in step with the ring.
      if (left !== lastTick) {
        if (left <= 5 && left > 0 && lastTick > left) Sound.play('tick-urgent');
        lastTick = left;
      }
    }

    const clockTimer = setInterval(paintClock, 250);

    /* ------------------------------ rendering ---------------------------- */

    function render(s) {
      // --- audio cues, driven off state changes rather than sprinkled around
      if (s.phase !== lastPhase) {
        lastPhase = s.phase;
        lastTick = -1;
        doneBefore.clear();
        if (s.phase === 'reveal') {
          Sound.play('reveal');
          pulse(root);
        } else {
          Sound.play('phase');
        }
      }
      const hintCount = s.prompt?.hints?.length ?? 0;
      if (hintCount > lastHints && lastHints > 0) Sound.play('pick');
      lastHints = hintCount;

      last = s;
      receivedAt = performance.now();
      // Round zero is the briefing, and "Round 0 / 8" reads like a bug.
      $('#pRound').textContent = s.round > 0 ? `Round ${s.round} / ${s.totalRounds}` : 'Starting soon';
      $('#pPhase').textContent = phaseLabel(s);
      paintClock();
      scoreEl.textContent = s.you?.score ?? 0;

      paintTeams(s);
      paintPlayers(s);

      // Only rebuild the body when the phase or round actually changes —
      // otherwise every tick would wipe what the player is typing.
      // The author changes every round, and a multi-pick answer is an array —
      // both have to be part of what counts as "the same screen".
      const key = [s.round, s.phase, JSON.stringify(s.you?.answer ?? null), s.you?.vote ?? '', s.prompt?.hints?.length ?? 0, s.brief?.readyCount ?? '', s.authorId ?? ''].join(":");
      if (key === renderedKey) return;
      renderedKey = key;
      paintBody(s);
    }

    function phaseLabel(s) {
      switch (s.phase) {
        case 'intro': return 'How to play';
        case 'brief': return 'Your secret';
        case 'write': return s.authorId === s.you?.id ? 'Your question' : 'Someone is writing';
        case 'answer': return s.mode === 'race' ? 'Guess it' : s.mode === 'poll' ? 'Vote' : 'Answer';
        case 'vote': return 'Vote';
        case 'choose': return 'Truth or dare?';
        case 'perform': return 'Go on then';
        case 'reveal': return 'Results';
        default: return '';
      }
    }

    /** Team sides and, if the game has one, the rope between them. */
    function paintTeams(s) {
      let bar = root.querySelector('.teams');
      if (!s.teams?.length) {
        bar?.remove();
        return;
      }
      if (!bar) {
        bar = el('div', 'teams');
        bar.innerHTML = `
          <div class="team-heads"></div>
          <div class="rope"><div class="rope-track"><div class="rope-knot"></div></div></div>`;
        root.querySelector('.party-top').after(bar);
      }

      const heads = bar.querySelector('.team-heads');
      heads.replaceChildren(
        ...s.teams.map((t) => {
          const side = el('div', 'team-head');
          if (t.id === s.you?.team) side.classList.add('mine');
          side.style.setProperty('--team', t.color);
          side.append(
            el('b', null, t.name + (t.id === s.you?.team ? ' (you)' : '')),
            el('small', null, `${t.acted}/${t.members} in · ${t.score} correct`)
          );
          return side;
        })
      );

      const rope = bar.querySelector('.rope');
      if (s.rope === undefined) {
        rope.hidden = true;
        return;
      }
      rope.hidden = false;
      const pct = 50 + (s.rope / (s.ropeLimit || 100)) * 50;
      const knot = rope.querySelector('.rope-knot');
      knot.style.left = `${Math.max(2, Math.min(98, pct))}%`;
      knot.style.background = s.rope === 0 ? 'var(--text-3)' : s.teams[s.rope > 0 ? 1 : 0].color;
    }

    function paintPlayers(s) {
      const strip = $('#pPlayers');

      // Mass room: 500 name chips would be unreadable and enormous. Show how
      // much of the crowd has acted, plus who is winning.
      if (s.crowd) {
        strip.replaceChildren();
        const done = s.phase === 'vote' ? s.crowd.voted : s.mode === 'race' ? s.crowd.solved : s.crowd.answered;
        const meter = el('div', 'crowd-meter');
        const fill = el('div', 'crowd-fill');
        fill.style.width = `${s.crowd.total ? (done / s.crowd.total) * 100 : 0}%`;
        meter.append(
          el('span', 'crowd-count', `${done} / ${s.crowd.total} in`),
          fill
        );
        strip.appendChild(meter);

        if (s.top?.length) {
          const board = el('div', 'crowd-top');
          for (const p of s.top) {
            const row = el('div', 'crowd-row');
            if (p.id === Net.playerId) row.classList.add('me');
            const dot = el('i');
            dot.style.background = p.color;
            row.append(el('b', 'cr-rank', String(p.rank)), dot, el('span', 'cr-name', p.name), el('em', null, String(p.score)));
            board.appendChild(row);
          }
          strip.appendChild(board);
        }
        return;
      }

      strip.replaceChildren(
        ...s.players.map((p) => {
          const chip = el('div', 'pchip');
          const done = s.phase === 'vote' ? p.voted : s.mode === 'race' ? p.solved : p.answered;
          if (done) chip.classList.add('done');
          // Pop the chip the first time this player locks something in.
          if (done && !doneBefore.has(p.id)) {
            doneBefore.add(p.id);
            chip.classList.add('just-done');
          }
          if (p.id === s.turnPlayerId) chip.classList.add('turn');
          const dot = el('i');
          dot.style.background = p.color;
          chip.append(dot, el('span', 'pn', p.name), el('b', null, String(p.score)));
          if (s.phase === 'reveal' && p.roundScore) {
            chip.appendChild(el('em', 'gain', `+${p.roundScore}`));
          }
          return chip;
        })
      );
    }

    function paintBody(s) {
      body.replaceChildren();
      if (s.phase === 'intro') return paintIntro(s);
      if (s.phase === 'brief') return paintBrief(s);
      if (s.phase === 'write') return paintWrite(s);
      if (s.phase === 'reveal') return paintReveal(s);
      if (s.phase === 'choose') return paintChoose(s);
      if (s.phase === 'perform') return paintPerform(s);
      if (s.phase === 'vote') return paintVote(s);
      return paintAnswer(s);
    }

    /**
     * Somebody writes the question everybody else is about to answer.
     *
     * Usually one player: they get the form, the rest get a name and a wait,
     * which is the point — half the tension is watching somebody realise it is
     * them.
     *
     * In Poll it is the whole room at once and no name is ever shown, here or
     * anywhere after. The questions that game exists for are the ones nobody
     * would put their name to.
     */
    function paintWrite(s) {
      const everyone = s.compose?.everyone === true;
      const mine = everyone || (s.authorId && s.authorId === s.you?.id);
      if (!mine) {
        const card = el('div', 'prompt-card');
        card.appendChild(el('h2', null, `${s.authorName ?? 'Someone'} is writing a question…`));
        body.append(card, el('p', 'party-note', 'No idea what is coming. Nobody knows who is next either.'));
        return;
      }
      // Already sent theirs: a count, never a list of names. "Waiting for
      // Ravi" would say who has not sent one yet, and over a whole match that
      // is enough to work out whose question was whose.
      if (everyone && s.compose?.done) {
        const card = el('div', 'prompt-card');
        card.appendChild(el('h2', null, 'Sent — and nobody knows it was you.'));
        const waiting = typeof s.writtenCount === 'number'
          ? `${s.writtenCount} of ${s.players?.length ?? '?'} written. Waiting for the rest…`
          : 'Waiting for the rest…';
        body.append(card, el('p', 'party-note', waiting));
        return;
      }

      const need = s.compose?.correct ?? 1;
      const slots = s.compose?.options ?? 4;
      const textOnly = s.compose?.kind === 'text';
      // A poll is a question with options and nothing marked right, so the
      // ticks come off and the wording changes — asking somebody to pick the
      // correct answer to "tea or coffee" is nonsense.
      const noRightAnswer = s.compose?.kind === 'poll';

      const card = el('div', 'prompt-card');
      card.appendChild(el('h2', null,
        textOnly ? 'Your scenario' : everyone ? 'Ask the room anything' : 'Your question'));
      body.append(card, el('p', 'party-note',
        textOnly
          ? s.compose?.hint ?? 'Everyone will answer this one.'
          : noRightAnswer
            ? s.compose?.hint ?? `Write up to ${slots} things for the room to pick between.`
            : need > 1
              ? `Write ${slots} options and tick the ${need} that are right.`
              : `Write ${slots} options and tick the right one.`));

      // A scenario has no options to mark — the room writes its own replies
      // and votes on them, so there is nothing here but the prompt.
      if (textOnly) {
        const form = el('form', 'party-form compose');
        const line = el('input');
        line.type = 'text';
        line.maxLength = 200;
        line.placeholder = s.compose?.placeholder ?? 'What if…';
        line.className = 'compose-q';
        const note = el('p', 'party-error');
        const go = el('button', 'btn btn-primary', 'Set it');
        go.type = 'submit';
        form.append(line, note, go);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const value = line.value.trim();
          if (value.length < 8) return (note.textContent = 'Give them a bit more than that.');
          Net.action({ type: 'compose', text: value });
          line.disabled = true;
          go.disabled = true;
          go.textContent = 'Set';
          Sound.play('join');
        });
        body.appendChild(form);
        setTimeout(() => line.focus(), 60);
        return;
      }

      const form = el('form', 'party-form compose');
      const q = el('input');
      q.type = 'text';
      q.maxLength = 200;
      q.placeholder = 'Ask them something…';
      q.className = 'compose-q';
      form.appendChild(q);

      const rows = [];
      for (let i = 0; i < slots; i++) {
        const row = el('label', 'compose-row');
        const tick = el('input');
        tick.type = need > 1 ? 'checkbox' : 'radio';
        tick.name = 'correct';
        // Hidden rather than left unticked on a poll: a radio button next to
        // every option invites somebody to mark one, and then wonder why
        // nothing happened when they did.
        if (noRightAnswer) tick.hidden = true;
        const text = el('input');
        text.type = 'text';
        text.maxLength = 80;
        text.placeholder = `Option ${i + 1}`;
        // Ticking more than the allowed number silently drops the extras on
        // the server, so stop it here where it can still be explained.
        tick.addEventListener('change', () => {
          if (need === 1) return;
          const on = rows.filter((r) => r.tick.checked).length;
          if (on > need) {
            tick.checked = false;
            note.textContent = `Only ${need} can be right.`;
          } else {
            note.textContent = '';
          }
        });
        row.append(tick, text);
        rows.push({ tick, text });
        form.appendChild(row);
      }

      const note = el('p', 'party-error');
      const send = el('button', 'btn btn-primary', 'Ask it');
      send.type = 'submit';
      form.append(note, send);
      if (noRightAnswer) q.placeholder = s.compose?.placeholder ?? 'Ask the room something…';

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = q.value.trim();
        const options = rows.map((r) => r.text.value.trim());
        const filled = options.filter(Boolean);
        const correct = rows.map((r, i) => (r.tick.checked ? i : -1)).filter((i) => i >= 0 && options[i]);

        if (!text) return (note.textContent = 'It needs a question.');
        if (filled.length < 2) return (note.textContent = 'At least two options.');
        if (new Set(filled.map((o) => o.toLowerCase())).size !== filled.length) {
          return (note.textContent = 'Two options say the same thing.');
        }
        if (!noRightAnswer && !correct.length) return (note.textContent = 'Tick the right answer.');

        // Blanks in the middle would leave gaps in the option ids, so the list
        // is closed up and the ticks moved with it.
        const kept = options.map((o, i) => ({ o, i })).filter(({ o }) => o);
        Net.action({
          type: 'compose',
          text,
          options: kept.map(({ o }) => o),
          correct: kept.map(({ i }, at) => (correct.includes(i) ? at : -1)).filter((x) => x >= 0),
        });
        send.disabled = true;
        send.textContent = 'Asked';
        for (const r of rows) { r.tick.disabled = true; r.text.disabled = true; }
        q.disabled = true;
        Sound.play('join');
      });

      body.appendChild(form);
      setTimeout(() => q.focus(), 60);
    }

    function promptCard(s) {
      const card = el('div', 'prompt-card');
      if (s.prompt?.text && s.prompt.text !== s.prompt.title) {
        card.appendChild(el('span', 'prompt-kicker', s.prompt.text));
      }
      card.appendChild(el('h2', null, s.prompt?.title ?? ''));
      return card;
    }

    /* -------------------------------- phases ----------------------------- */

    function paintBrief(s) {
      const secret = s.you?.secret;
      const card = el('div', `secret-card${s.you?.role === 'imposter' ? ' imposter' : ''}`);
      card.append(
        el('span', 'secret-label', secret?.label ?? 'Your card'),
        el('div', 'secret-word', secret?.word ?? '—'),
        el('p', 'secret-hint', secret?.hint ?? '')
      );
      body.append(card, el('p', 'party-note', 'Memorise it. It disappears when the round starts.'));
    }

    function paintAnswer(s) {
      body.appendChild(promptCard(s));

      // Bioscope: the title as a numbered strip of photographs. Each picture
      // is a word or a sound, and the room shouts the answer — so the grid
      // comes before the text hints rather than instead of them, and the
      // ordinary clues still drip in behind it for anyone who is stuck.
      if (s.prompt?.pictures?.length) {
        const strip = el('div', 'bioscope');
        for (const frame of s.prompt.pictures) {
          const cell = el('figure', 'bio-frame');
          const img = document.createElement('img');
          img.src = frame.url;
          img.alt = '';           // decorative: naming it would give the answer away
          img.loading = 'lazy';
          img.decoding = 'async';
          // A picture that fails to load leaves a numbered blank rather than a
          // broken-image icon, which at least reads as "clue missing".
          img.addEventListener('error', () => cell.classList.add('missing'));
          cell.append(el('span', 'bio-n', String(frame.n)), img);
          strip.appendChild(cell);
        }
        body.appendChild(strip);
      }

      // Race: show the hints revealed so far.
      if (s.mode === 'race') {
        const hints = el('div', 'hints');
        (s.prompt?.hints ?? []).forEach((h, i) => {
          // A Bioscope round has no emoji clue — the pictures are the first
          // hint — so the empty slot it leaves behind is skipped rather than
          // drawn as a blank card.
          if (!h) return;
          const hint = el('div', `hint${i === 0 ? ' big' : ''}`, h);
          hints.appendChild(hint);
        });
        const total = s.prompt?.hintsTotal ?? 0;
        for (let i = (s.prompt?.hints ?? []).length; i < total; i++) {
          hints.appendChild(el('div', 'hint locked', '🔒 next hint…'));
        }
        body.appendChild(hints);

        if (s.you?.solved) {
          body.appendChild(el('div', 'party-ok', `✅ Got it — "${s.you.answer}"`));
          return;
        }
        return body.appendChild(guessForm(s));
      }

      // Multiple choice / poll: option buttons.
      if (s.prompt?.options?.length) {
        const need = s.prompt.pickCount ?? 1;
        const grid = el('div', 'options-grid');

        // A question with several right answers is a different act: you build
        // a set and commit it, rather than tapping once and being done. Sending
        // each tap separately would score the first pick and lock the rest out.
        if (need > 1) {
          body.appendChild(el('p', 'party-note', `Pick ${need} — you need all of them, and wrong ticks cost you.`));
          const picked = new Set(Array.isArray(s.you?.answer) ? s.you.answer : []);
          const locked = picked.size > 0;
          for (const opt of s.prompt.options) {
            const btn = el('button', 'option', opt.label);
            btn.type = 'button';
            if (picked.has(opt.id)) btn.classList.add('picked');
            btn.disabled = locked;
            btn.addEventListener('click', () => {
              btn.classList.toggle('on');
              const on = grid.querySelectorAll('.option.on').length;
              send.disabled = on === 0;
              send.textContent = on === need ? 'Lock it in' : `Lock in ${on} of ${need}`;
            });
            grid.appendChild(btn);
          }
          body.appendChild(grid);
          const send = el('button', 'btn btn-primary', `Lock in 0 of ${need}`);
          send.type = 'button';
          send.disabled = true;
          if (locked) {
            body.appendChild(el('div', 'party-ok', '✅ Locked in'));
            return;
          }
          send.addEventListener('click', () => {
            const ids = [...grid.querySelectorAll('.option.on')].map((b) => b.dataset.id);
            if (!ids.length) return;
            Net.action({ type: 'choice', optionIds: ids });
            send.disabled = true;
            send.textContent = 'Locked in';
            for (const b of grid.children) b.disabled = true;
          });
          for (const [i, b] of [...grid.children].entries()) b.dataset.id = s.prompt.options[i].id;
          return body.appendChild(send);
        }

        for (const opt of s.prompt.options) {
          const btn = el('button', 'option', opt.label);
          btn.type = 'button';
          if (s.you?.answer === opt.id || s.you?.vote === opt.id) btn.classList.add('picked');
          btn.addEventListener('click', () => {
            Net.action({ type: 'choice', optionId: opt.id });
            for (const b of grid.children) b.classList.remove('picked');
            btn.classList.add('picked');
          });
          grid.appendChild(btn);
        }
        return body.appendChild(grid);
      }

      // Free text.
      if (s.you?.answer) {
        body.appendChild(el('div', 'party-ok', `Answer locked in: "${s.you.answer}"`));
        return;
      }
      body.appendChild(answerForm());
    }

    function answerForm() {
      const form = el('form', 'party-form');
      const input = el('input');
      input.type = 'text';
      input.maxLength = 240;
      input.placeholder = 'Type your answer…';
      input.autocomplete = 'off';
      const send = el('button', 'btn btn-primary', 'Lock it in');
      send.type = 'submit';
      form.append(input, send);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!input.value.trim()) return;
        Net.action({ type: 'answer', text: input.value });
      });
      setTimeout(() => input.focus(), 50);
      return form;
    }

    function guessForm(s) {
      const form = el('form', 'party-form');
      const input = el('input');
      input.type = 'text';
      input.maxLength = 60;
      input.placeholder = 'Your guess…';
      input.autocomplete = 'off';
      const send = el('button', 'btn btn-primary', 'Guess');
      send.type = 'submit';
      const note = el('p', 'party-note wrong-note');
      form.append(input, send);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!input.value.trim()) return;
        Net.action({ type: 'answer', text: input.value });
        input.value = '';
      });
      setTimeout(() => input.focus(), 50);
      const box = el('div');
      box.append(form, note);
      offWrong?.();
      offWrong = Net.on('game:event', ({ event, payload }) => {
        if (event !== 'wrong') return;
        note.textContent = `"${payload.text}" — not it. Keep going.`;
        Sound.play('wrong');
        shake(form);
        flash(input, 'bad');
        floatText(input, '✕', 'miss');
      });
      return box;
    }

    function paintVote(s) {
      body.appendChild(promptCard(s));
      const list = el('div', 'vote-list');
      const items = (s.answers ?? []).filter((a) => a.playerId !== s.you?.id);
      if (!items.length) {
        body.appendChild(el('p', 'party-note', 'Nobody answered in time.'));
        return;
      }
      for (const a of items) {
        const btn = el('button', 'vote-item');
        btn.type = 'button';
        if (s.you?.vote === a.playerId) btn.classList.add('picked');
        btn.append(el('b', null, a.name), el('span', null, a.text || '(no answer)'));
        btn.addEventListener('click', () => {
          Net.action({ type: 'vote', targetId: a.playerId });
          for (const b of list.children) b.classList.remove('picked');
          btn.classList.add('picked');
        });
        list.appendChild(btn);
      }
      body.append(list, el('p', 'party-note', s.mode === 'answer-vote' ? 'You cannot vote for yourself.' : ''));
    }

    function paintChoose(s) {
      body.appendChild(promptCard(s));
      if (!s.you?.isTurn) {
        body.appendChild(el('p', 'party-note', 'Waiting for them to choose…'));
        return;
      }
      const row = el('div', 'choice-row');
      for (const kind of ['truth', 'dare']) {
        const btn = el('button', `big-choice ${kind}`, kind === 'truth' ? '🫢 Truth' : '🔥 Dare');
        btn.type = 'button';
        btn.addEventListener('click', () => Net.action({ type: 'answer', choice: kind }));
        row.appendChild(btn);
      }
      body.appendChild(row);
    }

    function paintPerform(s) {
      const card = el('div', `prompt-card task ${s.prompt?.kind ?? ''}`);
      card.append(el('span', 'prompt-kicker', s.prompt?.title ?? ''), el('h2', null, s.prompt?.text ?? ''));
      body.appendChild(card);
      if (s.you?.isTurn) {
        const btn = el('button', 'btn btn-primary btn-lg', 'Done ✓');
        btn.type = 'button';
        btn.addEventListener('click', () => Net.action({ type: 'done' }));
        body.appendChild(btn);
      } else {
        body.appendChild(el('p', 'party-note', 'Watch closely. No phones.'));
      }
    }

    /**
     * The rules, before the clock starts. Everyone tapping Ready cuts it short,
     * so a room that already knows the game is not held up by the ones that
     * don't — and nobody has to learn the rules while their time drains.
     */
    function paintIntro(s) {
      const b = s.brief ?? {};
      const card = el('div', 'intro-card');
      card.appendChild(el('div', 'intro-emoji', b.emoji ?? '🎮'));
      card.appendChild(el('h2', null, b.name ?? 'Get ready'));
      if (b.tagline) card.appendChild(el('p', 'intro-tagline', b.tagline));

      if (b.rules?.length) {
        const list = el('ol', 'intro-rules');
        for (const rule of b.rules) list.appendChild(el('li', null, rule));
        card.appendChild(list);
      }

      const facts = el('div', 'intro-facts');
      facts.appendChild(el('span', null, `${b.rounds} round${b.rounds === 1 ? '' : 's'}`));
      if (b.pace) facts.appendChild(el('span', null, b.pace));
      if (b.scoreNote) facts.appendChild(el('span', 'accent-text', b.scoreNote));
      card.appendChild(facts);

      const btn = el('button', 'btn btn-primary intro-ready');
      const mine = s.you?.ready;
      btn.textContent = mine ? `Waiting… ${b.readyCount}/${b.total} ready` : "Ready — let's go";
      btn.disabled = Boolean(mine);
      btn.addEventListener('click', () => {
        Net.action({ type: 'ready' });
        Sound.play('pick');
        btn.disabled = true;
      });
      card.appendChild(btn);

      body.appendChild(card);
    }

    function paintReveal(s) {
      const r = s.reveal ?? {};
      const panel = el('div', 'reveal-panel');
      if (r.headline) panel.appendChild(el('h2', null, r.headline));

      if (r.word) {
        panel.appendChild(el('p', 'reveal-sub', `The word was "${r.word}" · decoy "${r.decoy}"`));
      }
      if (r.imposters?.length) {
        panel.appendChild(
          el('p', 'reveal-sub accent-text', `Imposter: ${r.imposters.map((i) => i.name).join(', ')}`)
        );
      }
      if (r.answer && !r.word) panel.appendChild(el('p', 'reveal-sub', `Answer: ${r.answer}`));

      // Bars for polls and quizzes.
      const bars = r.options ?? [];
      if (bars.length) {
        const wrapBars = el('div', 'bars');
        for (const o of bars) {
          const row = el('div', 'bar-row');
          if (o.correct) row.classList.add('correct');
          const fill = el('div', 'bar-fill');
          fill.style.width = `${o.percent ?? 0}%`;
          row.append(el('span', 'bar-label', o.label), fill, el('b', null, `${o.percent ?? 0}%`));
          wrapBars.appendChild(row);
        }
        panel.appendChild(wrapBars);
      }

      if (r.answers?.length) {
        const list = el('div', 'reveal-answers');
        for (const a of r.answers) {
          const row = el('div', `reveal-answer${a.wasImposter ? ' imposter' : ''}`);
          row.append(
            el('b', null, a.name + (a.wasImposter ? ' 🎭' : '')),
            el('span', null, a.text || '(no answer)'),
            el('em', null, a.votes ? `${a.votes} vote${a.votes === 1 ? '' : 's'}` : '')
          );
          list.appendChild(row);
        }
        panel.appendChild(list);
      }

      if (r.correctPlayers?.length) {
        panel.appendChild(el('p', 'reveal-sub', `Correct: ${r.correctPlayers.join(', ')}`));
      }
      body.appendChild(panel);
    }

    /* -------------------------------- wiring ----------------------------- */

    let offWrong = null;
    // In a mass room the crowd view arrives without a `you`; the private slice
    // comes separately, only when this player's own state changes.
    let myPrivate = null;
    const offYou = Net.on('game:you', (you) => {
      myPrivate = you;
      if (last) {
        last.you = you;
        render(last);
      }
    });

    const offState = Net.on('game:state', (s) => {
      if (s.mass && !s.you && myPrivate) s.you = myPrivate;
      render(s);
    });
    const offEvent = Net.on('game:event', ({ event, payload }) => {
      if (event !== 'solved') return;
      const mine = payload.playerId === Net.playerId;
      const toast = el('div', 'party-toast', `${mine ? 'You' : payload.name} got it${payload.first ? ' first!' : ''}`);
      root.appendChild(toast);
      setTimeout(() => toast.remove(), 2200);

      Sound.play('correct');
      if (mine) {
        flash(root, 'good');
        if (payload.first) confetti(root, { count: 28, spread: 40 });
      }
    });

    if (meta) root.style.setProperty('--tint', meta.accent);

    return () => {
      clearInterval(clockTimer);
      offState();
      offYou();
      offEvent();
      offWrong?.();
      root.remove();
      canvas.hidden = false;
      wrap.classList.remove('party-stage');
      hud.innerHTML = '';
    };
  },
};
