// Sports betting — one question open, several still out.
//
// The screen has to hold two different things at once and they want opposite
// treatment. The market taking bets is the loud part: one question, big
// buttons, a clock running down. The ones already locked are quiet rows that
// tick along on their own and light up when a result lands.
//
// Nothing here can be pressed to change a result, because nothing in this room
// decides one. That absence is worth showing rather than hiding: the strip at
// the top says where the answer is coming from and what the match is doing, so
// a room can see the table is watching the same thing they are.

import { Sound } from '/js/sound.js';
import { confetti, floatText, pulse } from '/js/fx.js';

const AMOUNTS = [10, 25, 50, 100];

export default {
  mount({ canvas, wrap, hud, Net }) {
    canvas.style.display = 'none';
    wrap.classList.add('sp-stage');

    const root = document.createElement('div');
    root.className = 'sp';
    root.innerHTML = `
      <div class="sp-brief intro-card" hidden>
        <h2>Sports Betting</h2>
        <p class="muted">Every market is asked before it happens and shut before it starts. The result comes off the internet — nobody here decides it.</p>
        <ol class="intro-rules" id="spRules"></ol>
        <button class="btn btn-primary intro-ready" id="spBriefed" type="button">Ready</button>
        <p class="muted small" id="spBriefWait"></p>
      </div>

      <div class="sp-table" hidden>
        <div class="sp-feed" id="spFeed">
          <span class="sp-what" id="spWhat">—</span>
          <span class="sp-score" id="spScore"></span>
          <span class="sp-clock" id="spClock"></span>
        </div>
        <p class="sp-trouble" id="spTrouble" hidden></p>

        <div class="sp-fixtures" id="spFixtures" hidden></div>
        <form class="sp-pick" id="spPick" hidden>
          <input id="spPickIn" type="text" maxlength="80" placeholder="Or paste a match id" />
          <button class="btn btn-ghost btn-sm" type="submit">Follow it</button>
        </form>

        <div class="sp-pot"><span>In the pot</span><b id="spPot">0</b><small id="spCarried"></small></div>

        <div class="sp-now" id="spNow">
          <h3 class="sp-ask" id="spAsk"></h3>
          <p class="sp-shuts muted small" id="spShuts"></p>
          <div class="sp-amounts" id="spAmounts"></div>
          <div class="sp-outs" id="spOuts"></div>
          <p class="sp-mine muted small" id="spMine"></p>
        </div>

        <div class="sp-riding" id="spRiding"></div>
        <div class="sp-done" id="spDone"></div>
        <ul class="sp-log" id="spLog"></ul>
      </div>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <div class="hud-row">
        <span class="hud-chip" id="spCount">Market 1</span>
        <span class="hud-chip" id="spTimer">—</span>
        <span class="hud-chip hud-accent" id="spPhase">Betting</span>
      </div>`;

    const $ = (sel) => root.querySelector(sel);
    const $hud = (sel) => hud.querySelector(sel);
    const brief = $('.sp-brief');
    const table = $('.sp-table');

    let amount = AMOUNTS[1];
    let shownMarket = 0;
    let shownSettled = null;

    $('#spBriefed').addEventListener('click', () => {
      Net.action({ type: 'briefed' });
      $('#spBriefed').disabled = true;
      $('#spBriefed').textContent = 'Waiting for the room…';
    });

    $('#spPick').addEventListener('submit', (e) => {
      e.preventDefault();
      const id = $('#spPickIn').value.trim();
      if (!id) return;
      Net.action({ type: 'match', id, name: id });
      Sound.play('click');
    });

    function layOutAmounts(maxBet, minBet) {
      const box = $('#spAmounts');
      if (box.dataset.max === String(maxBet)) return;
      box.dataset.max = String(maxBet);
      const steps = AMOUNTS.filter((n) => n >= minBet && n <= maxBet);
      if (!steps.length) steps.push(minBet);
      box.replaceChildren(
        ...steps.map((n) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'sp-amount';
          b.dataset.n = String(n);
          b.textContent = String(n);
          b.addEventListener('click', () => { amount = n; paintAmounts(); Sound.play('click'); });
          return b;
        })
      );
      if (!steps.includes(amount)) amount = steps[0];
      paintAmounts();
    }

    const paintAmounts = () => {
      for (const b of $('#spAmounts').querySelectorAll('.sp-amount')) {
        b.classList.toggle('is-on', Number(b.dataset.n) === amount);
      }
    };

    /**
     * The outcomes for whatever is open.
     *
     * Rebuilt per market rather than patched, because two markets running back
     * to back can have the same number of outcomes with different meanings —
     * and a reused button would carry the old market's handler with it.
     */
    function layOutOuts(open, you) {
      const box = $('#spOuts');
      const live = open?.phase === 'betting';
      const key = `${open?.n ?? 0}:${live ? 'live' : 'shut'}`;
      if (box.dataset.key !== key) {
        box.dataset.key = key;
        box.replaceChildren(
          ...(open?.outs ?? []).map((o) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'sp-out';
            b.dataset.out = o.id;
            b.disabled = !live;
            b.innerHTML = `<b></b><small class="sp-pool"></small>`;
            b.querySelector('b').textContent = o.label;
            if (live) {
              b.addEventListener('click', () => {
                Net.action({ type: 'back', outcome: o.id, amount });
                Sound.play('pick');
                pulse(b);
              });
            }
            return b;
          })
        );
      }
      const mine = new Map((you?.on ?? []).map((x) => [x.outcome, x.chips]));
      for (const b of box.querySelectorAll('.sp-out')) {
        const pool = open?.onEach?.find((x) => x.id === b.dataset.out);
        const yours = mine.get(b.dataset.out) ?? 0;
        b.querySelector('.sp-pool').textContent = pool?.chips
          ? `${pool.chips} on it${yours ? ` · ${yours} yours` : ''}`
          : 'nothing on it';
        b.classList.toggle('is-yours', yours > 0);
      }
    }

    function paint(s) {
      if (s.phase === 'brief') {
        brief.hidden = false;
        table.hidden = true;
        const list = $('#spRules');
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
        $('#spBriefWait').textContent = waiting ? `${waiting} still reading…` : 'Everyone is ready.';
        $hud('#spTimer').textContent = `${s.timeLeft}s`;
        return;
      }

      brief.hidden = true;
      table.hidden = false;

      // Where the answers come from, said plainly. A demo match still costs
      // real chips, so it says so rather than letting a room find out later.
      $('#spWhat').textContent = s.matchName || (s.matchId ? s.matchId : 'No match yet');
      $('#spClock').textContent = s.clockLabel ?? '';
      $('#spScore').textContent = s.score
        ? (s.score.homeGoals !== undefined
            ? `${s.score.home ?? 'Home'} ${s.score.homeGoals} — ${s.score.awayGoals} ${s.score.away ?? 'Away'}`
            : `${s.score.runs}/${s.score.wickets}`)
        : '';
      $('#spFeed').classList.toggle('is-demo', Boolean(s.isDemo));

      const trouble =
        s.isDemo ? 'Demo match — the football is pretend, the chips are not.'
        : !s.feedReady ? s.feedWhy
        : s.feedTrouble ? s.feedTrouble
        : '';
      $('#spTrouble').textContent = trouble;
      $('#spTrouble').hidden = !trouble;

      // Picking what to follow, but only until something is being followed.
      const choosing = Boolean(s.you?.isHost) && !s.matchId;
      $('#spPick').hidden = !choosing;
      $('#spFixtures').hidden = !choosing || !(s.fixtures ?? []).length;
      if (choosing) {
        const box = $('#spFixtures');
        const key = (s.fixtures ?? []).map((f) => f.id).join(',');
        if (box.dataset.key !== key) {
          box.dataset.key = key;
          box.replaceChildren(
            ...(s.fixtures ?? []).map((f) => {
              const b = document.createElement('button');
              b.type = 'button';
              b.className = 'sp-fixture';
              b.textContent = f.name;
              b.addEventListener('click', () => {
                Net.action({ type: 'match', id: f.id, name: f.name });
                Sound.play('pick');
              });
              return b;
            })
          );
        }
      }

      $hud('#spCount').textContent = `Market ${s.opened} of ${s.maxRounds}`;
      $hud('#spTimer').textContent = s.open?.phase === 'betting' ? `${s.open.timeLeft}s` : '—';
      $hud('#spPhase').textContent =
        s.phase === 'over' ? 'Book closed'
        : !s.matchId ? 'Waiting on a match'
        : s.open?.phase === 'betting' ? 'Betting'
        : s.open?.phase === 'locking' ? 'Shutting'
        : s.pending.length ? 'Out on the match' : '—';

      $('#spPot').textContent = String(s.open?.pot ?? s.carried ?? 0);
      $('#spCarried').textContent = s.carried ? `${s.carried} riding from an earlier market` : '';

      // The one being bet on.
      $('#spNow').hidden = !s.open;
      if (s.open) {
        if (shownMarket !== s.open.n) {
          shownMarket = s.open.n;
          Sound.play('tick');
        }
        $('#spAsk').textContent = s.open.ask;
        $('#spShuts').textContent = s.open.phase === 'betting'
          ? `Shuts in ${s.open.timeLeft}s — the window starts after that, so nothing you have already seen counts.`
          : 'Shutting. Reading the match…';
        $('#spAmounts').hidden = s.open.phase !== 'betting';
        if (s.open.phase === 'betting') layOutAmounts(s.maxBet, s.minBet);
        layOutOuts(s.open, s.you);
        const left = s.maxBet - (s.you?.staked ?? 0);
        $('#spMine').textContent = s.you?.staked
          ? `You have ${s.you.staked} on this one · ${left} left of your limit`
          : `Tap an outcome to put ${amount} on it`;
      }

      // The ones already out there.
      $('#spRiding').replaceChildren(
        ...(s.pending ?? []).map((m) => {
          const mine = s.you?.riding?.find((r) => r.n === m.n);
          const row = document.createElement('div');
          row.className = 'sp-ride';
          row.classList.toggle('is-yours', Boolean(mine));
          row.innerHTML = `<b></b><small></small>`;
          row.querySelector('b').textContent = m.ask;
          row.querySelector('small').textContent = mine
            ? `${mine.chips} of yours riding · waiting on the match`
            : 'waiting on the match';
          return row;
        })
      );

      // And the ones that came back.
      $('#spDone').replaceChildren(
        ...(s.settled ?? []).map((r) => {
          const row = document.createElement('div');
          row.className = 'sp-result';
          row.classList.toggle('is-void', Boolean(r.voided));
          row.innerHTML = `<b></b><small></small>`;
          row.querySelector('b').textContent = r.voided ? 'Void' : r.label;
          row.querySelector('small').textContent = r.said;
          return row;
        })
      );

      const newest = s.settled?.[0];
      if (newest && shownSettled !== `${newest.n}`) {
        shownSettled = `${newest.n}`;
        const mine = newest.paid?.find((p) => p.id === s.you?.id);
        if (mine) {
          Sound.play('win');
          confetti(table, { count: 70 });
          floatText($('#spPot'), `+${mine.chips}`, 'gain');
        }
      }

      $('#spLog').replaceChildren(
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
      wrap.classList.remove('sp-stage');
      root.remove();
      hud.innerHTML = '';
    };
  },
};
