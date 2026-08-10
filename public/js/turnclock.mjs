// The clock, for every table that has one.
//
// The feedback was that nobody could tell whose turn it was or how a game was
// flowing. Both facts were already on screen — a chip saying "Your turn" and a
// chip saying "18s" — and both were being missed, which is the same thing as
// not being there.
//
// Three changes, and the reasoning matters more than the code:
//
// It is a bar, not a number. A number tells you what the clock says; a bar
// tells you how much is left without being read, from across a room, while you
// are looking at your cards. Nobody reads a number they are not already looking
// for.
//
// It says whose turn it is in the second person or by name, never as a state.
// "Your turn" and "Waiting on Priya" are things a person says. "turn: 3" is
// not, and neither is a highlighted seat somebody has to notice.
//
// And it says what happens next. That is the "how does this flow" half of the
// complaint, and no amount of clock answers it — somebody watching a betting
// phase has no way to know a wheel is about to spin unless the table tells
// them. Every game supplies its own line for this.
//
// The bar is driven off state pushes, not off a local timer. A local countdown
// looks smoother and lies: it drifts from the server, and on a slow connection
// it can hit zero while the turn is still open, which is worse than no clock
// at all because it teaches people the clock cannot be trusted.

const CLASS = 'clk';

/**
 * @param {HTMLElement} parent  usually the game's hud
 * @returns {{ paint: (o: object) => void, destroy: () => void }}
 */
export function mountClock(parent) {
  const root = document.createElement('div');
  root.className = CLASS;
  root.innerHTML = `
    <div class="clk-row">
      <b class="clk-who"></b>
      <span class="clk-left"></span>
    </div>
    <div class="clk-track"><i class="clk-fill"></i></div>
    <small class="clk-next"></small>`;
  parent.appendChild(root);

  const who = root.querySelector('.clk-who');
  const left = root.querySelector('.clk-left');
  const fill = root.querySelector('.clk-fill');
  const next = root.querySelector('.clk-next');

  let lastUrgent = false;

  /**
   * @param {object} o
   * @param {string} o.label   whose turn, or what is happening
   * @param {string} [o.hint]  what happens after this
   * @param {number} [o.left]  seconds remaining
   * @param {number} [o.total] what it counted down from
   * @param {boolean} [o.yours]
   * @param {boolean} [o.idle] no clock running — hides the bar rather than
   *                           showing a full one, which reads as "loads of time"
   */
  function paint(o = {}) {
    const total = Number(o.total) || 0;
    const secs = Math.max(0, Number(o.left) || 0);
    const idle = o.idle || total <= 0;

    who.textContent = o.label ?? '';
    who.classList.toggle('is-you', Boolean(o.yours));
    next.textContent = o.hint ?? '';
    next.hidden = !o.hint;

    root.classList.toggle('is-idle', idle);
    root.classList.toggle('is-you', Boolean(o.yours));

    if (idle) {
      left.textContent = '';
      fill.style.width = '0%';
      root.classList.remove('is-urgent');
      lastUrgent = false;
      return;
    }

    left.textContent = `${Math.ceil(secs)}s`;
    fill.style.width = `${Math.max(0, Math.min(100, (secs / total) * 100))}%`;

    // Urgent is about the clock being nearly out, not about the bar being
    // short — a five second turn is not an emergency for its whole length.
    const urgent = secs <= 5 && total > 6;
    root.classList.toggle('is-urgent', urgent);
    // Only when it becomes urgent, and only when it is actually your problem.
    if (urgent && !lastUrgent && o.yours) root.classList.add('clk-nudge');
    if (!urgent) root.classList.remove('clk-nudge');
    lastUrgent = urgent;
  }

  return {
    paint,
    destroy() { root.remove(); },
  };
}

/**
 * The usual shape, for the many tables that phrase it the same way.
 *
 * A table supplies a map of phase to what to say, and this works out the rest
 * from the fields every game on this floor already puts on the wire.
 */
export function clockFrom(s, phases = {}, opts = {}) {
  const said = phases[s.phase] ?? {};
  const yours = Boolean(opts.yours);
  return {
    label: opts.label ?? (yours && said.you ? said.you : said.label ?? ''),
    hint: said.hint ?? '',
    left: opts.left ?? s.timeLeft,
    total: opts.total ?? s.phaseTotal,
    yours,
    idle: opts.idle ?? (s.phase === 'over'),
  };
}
