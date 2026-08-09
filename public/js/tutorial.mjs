// How to play, before the clock starts.
//
// Thirty games, and somebody who has just been handed a link has played none
// of them. Every game already says how it works in a list, but a list dumped
// on screen while a match is starting is read by nobody — it is the wall of
// text people tap past.
//
// So it is one point at a time, with a button. That is slower to get through
// and far more likely to be read, and it takes about eight seconds for a game
// with four rules.
//
// One implementation for every game rather than thirty. A game only has to say
// what its rules are; it never has to know this exists.

const SEEN_KEY = 'htfw:tutorialsSeen';

/** Which games this browser has already been walked through. */
function seen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

function remember(gameId) {
  try {
    const list = seen();
    list.add(gameId);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...list]));
  } catch {
    /* a browser that will not remember is one that shows the rules again */
  }
}

export const hasSeen = (gameId) => seen().has(gameId);

/** Forget them all, so the rules can be seen again on purpose. */
export function forgetTutorials() {
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * The one that is open, if any.
 *
 * The shell can enter the game screen more than once for the same match — a
 * re-render, a reconnect — and each entry would open its own copy on top of
 * the last. Two stacked cards means dismissing one leaves another, and the
 * game never starts. Whoever asks second waits on the first instead.
 */
let open = null;

/**
 * Walks somebody through a game's rules and resolves when they are done.
 *
 * Resolves either way — skipped and finished are the same to the caller,
 * because the only thing it wants to know is when to start the game.
 *
 * @param {object} opts
 * @param {{ name:string, emoji:string, tagline?:string, howToPlay?:string[] }} opts.game
 * @param {boolean} [opts.forced] the host asked for it, so no "skip for good"
 * @returns {Promise<void>}
 */
export function runTutorial({ game, forced = false }) {
  const steps = (game.howToPlay ?? []).filter(Boolean);
  // Nothing to teach is not worth a screen.
  if (!steps.length) return Promise.resolve();
  if (open) return open;

  open = new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'tut';
    box.innerHTML = `
      <div class="tut-card" role="dialog" aria-modal="true" aria-label="How to play">
        <span class="tut-emoji" aria-hidden="true"></span>
        <h2 class="tut-name"></h2>
        <p class="tut-tag muted"></p>

        <div class="tut-step">
          <span class="tut-count"></span>
          <p class="tut-text"></p>
        </div>

        <div class="tut-dots" aria-hidden="true"></div>

        <div class="tut-acts">
          <button class="btn btn-quiet" id="tutSkip" type="button">Skip</button>
          <button class="btn btn-primary" id="tutNext" type="button">Next</button>
        </div>
      </div>`;
    document.body.appendChild(box);

    const $ = (sel) => box.querySelector(sel);
    $('.tut-emoji').textContent = game.emoji ?? '🎮';
    $('.tut-name').textContent = game.name ?? 'How to play';
    $('.tut-tag').textContent = game.tagline ?? '';
    $('#tutSkip').textContent = forced ? 'Skip' : 'Skip, I know this one';

    $('.tut-dots').replaceChildren(
      ...steps.map(() => {
        const dot = document.createElement('i');
        dot.className = 'tut-dot';
        return dot;
      })
    );

    let at = 0;
    const paint = () => {
      $('.tut-count').textContent = `${at + 1} of ${steps.length}`;
      const text = $('.tut-text');
      text.textContent = steps[at];
      text.classList.remove('is-in');
      // Reflow, so each step animates in rather than the first one animating
      // and the rest appearing.
      void text.offsetWidth;
      text.classList.add('is-in');
      $('#tutNext').textContent = at === steps.length - 1 ? "Got it — let's play" : 'Next';
      for (const [i, dot] of [...box.querySelectorAll('.tut-dot')].entries()) {
        dot.classList.toggle('is-on', i <= at);
      }
    };

    const done = () => {
      remember(game.id);
      box.remove();
      document.removeEventListener('keydown', onKey);
      open = null;
      resolve();
    };

    $('#tutNext').addEventListener('click', () => {
      if (at < steps.length - 1) {
        at += 1;
        paint();
      } else {
        done();
      }
    });
    $('#tutSkip').addEventListener('click', done);

    // Space and Enter move it on, because somebody on a laptop should not have
    // to reach for the mouse four times.
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        $('#tutNext').click();
      } else if (e.key === 'Escape') {
        done();
      }
    };
    document.addEventListener('keydown', onKey);

    paint();
    setTimeout(() => $('#tutNext').focus(), 60);
  });

  return open;
}
