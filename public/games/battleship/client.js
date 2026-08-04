// Ship Attack — the renderer.
//
// This is the whole "engine" a game on this site needs: a mount() that gets a
// container and a socket, draws whatever the server sends, and sends back what
// the player did. The rules, the fleets and the anti-cheat all live on the
// server (server/games/battleship.js) — nothing here is trusted, and nothing
// here knows where an enemy ship is until the server says so.
//
// The boards are DOM rather than canvas on purpose: a hundred tap targets that
// must stay legible on a cheap phone is exactly what buttons are good at, and
// CSS does the splashes.

import { Sound } from '/js/sound.js';
import { confetti, flash, shake, floatText } from '/js/fx.js';
import { createRadar } from './radar.js';
import { hullSvg, hullSliceSvg, hullFor } from './hulls.js';

const LETTERS = 'ABCDEFGHIJ';
const cellKey = (r, c) => `${r},${c}`;
const label = (r, c) => `${LETTERS[r]}${c + 1}`;

export default {
  mount({ canvas, wrap, hud, Net }) {
    canvas.style.display = 'none';
    wrap.classList.add('bs-stage');

    const root = document.createElement('div');
    root.className = 'bs';
    root.innerHTML = `
      <div class="bs-brief intro-card" hidden>
        <h2>Ship Attack</h2>
        <p class="muted">Hide your fleet. Read the sea. Sink theirs first.</p>
        <ol class="intro-rules" id="bsRules"></ol>
        <div class="bs-brief-fleet" id="bsBriefFleet"></div>
        <button class="btn btn-primary intro-ready" id="bsBriefed" type="button">Understood</button>
        <p class="muted small" id="bsBriefWait"></p>
      </div>
      <div class="bs-deploy" hidden>
        <div class="bs-deploy-head">
          <h3>Deploy your fleet</h3>
          <p class="muted small">Pick a ship, then tap your sea to move it. Tap it again where it sits to turn it.</p>
        </div>
        <div class="bs-yard" id="bsYard"></div>
        <p class="bs-light" id="bsLight" hidden></p>
        <div class="bs-deploy-actions">
          <button class="btn btn-ghost btn-sm" id="bsShuffle" type="button">🎲 Shuffle</button>
          <button class="btn btn-primary btn-sm" id="bsReady" type="button">Battle stations</button>
        </div>
      </div>
      <div class="bs-scopes" id="bsScopes" hidden>
        <div class="bs-scope">
          <div class="bs-scope-head">
            <h4 id="bsTargetName">Target</h4>
            <div class="bs-targets" id="bsTargets"></div>
          </div>
          <canvas class="bs-radar" id="bsEnemyRadar"></canvas>
        </div>
        <div class="bs-scope own">
          <div class="bs-scope-head"><h4>Your sea</h4><span class="bs-energy" id="bsEnergy"></span></div>
          <canvas class="bs-radar" id="bsOwnRadar"></canvas>
        </div>
      </div>
      <div class="bs-powers" id="bsPowers" hidden></div>
      <div class="bs-boards" id="bsBoards"></div>
      <div class="bs-intel" id="bsIntel" hidden></div>
      <ul class="bs-log" id="bsLog"></ul>`;
    wrap.appendChild(root);

    hud.innerHTML = `
      <span class="chip" id="bsPhase">Deploying</span>
      <span class="chip">⏱ <b id="bsClock">–</b>s</span>
      <span class="chip" id="bsTurn"></span>`;

    const el = {
      brief: root.querySelector('.bs-brief'),
      rules: root.querySelector('#bsRules'),
      briefFleet: root.querySelector('#bsBriefFleet'),
      briefWait: root.querySelector('#bsBriefWait'),
      deploy: root.querySelector('.bs-deploy'),
      yard: root.querySelector('#bsYard'),
      lightNote: root.querySelector('#bsLight'),
      boards: root.querySelector('#bsBoards'),
      scopes: root.querySelector('#bsScopes'),
      powers: root.querySelector('#bsPowers'),
      targets: root.querySelector('#bsTargets'),
      targetName: root.querySelector('#bsTargetName'),
      energy: root.querySelector('#bsEnergy'),
      intel: root.querySelector('#bsIntel'),
      log: root.querySelector('#bsLog'),
      phase: hud.querySelector('#bsPhase'),
      clock: hud.querySelector('#bsClock'),
      turn: hud.querySelector('#bsTurn'),
    };

    /* -------------------------------- radar ------------------------------- */

    // Deployment stays a tappable grid — placing ships wants big squares.
    // The battle happens on the scopes, which is where the game lives.
    let armedPower = null;   // id of a power waiting for its aim
    let salvoPicks = [];     // squares chosen so far for a salvo
    let targetId = null;     // which enemy sea is on the big scope

    const enemyRadar = createRadar(root.querySelector('#bsEnemyRadar'), {
      readView: () => view,
      onPick: (r, c) => onScope(r, c),
    });
    const ownRadar = createRadar(root.querySelector('#bsOwnRadar'), {
      readView: () => view,
      mine: true,
      onPick: (r, c) => onOwnScope(r, c),
    });

    /* ------------------------------- state -------------------------------- */

    let view = null;          // latest server view
    let armed = null;         // which intel is armed, or null for gunnery
    let selectedShip = null;  // ship id being placed
    let localFleet = null;    // my layout while deploying, before the server sees it
    // Ships deliberately left behind. They keep their id and shape, so putting
    // one back is just placing it again somewhere legal.
    let inPort = [];
    let canSailLight = true;  // the host's call; the first frame settles it
    let clock = 0;            // counted down locally between server frames
    let lastPhase = null;
    let lastLogAt = 0;
    const boardEls = new Map();

    /* ------------------------------ deploying ----------------------------- */

    // A fleet the player is dragging around only becomes real once the server
    // validates it — this is just what they are looking at meanwhile.
    function fleetFromView(v) {
      return v.you.board.ships.map((s) => ({
        id: s.id,
        len: s.len,
        r: s.cells[0].r,
        c: s.cells[0].c,
        horizontal: s.cells.length === 1 || s.cells[0].r === s.cells[1].r,
      }));
    }

    const shipCells = (s) =>
      Array.from({ length: s.len }, (_, i) => (s.horizontal ? { r: s.r, c: s.c + i } : { r: s.r + i, c: s.c }));

    /** The same rule the server enforces, so the UI can refuse before sending. */
    function legal(fleet, moving, cells) {
      const taken = new Map();
      for (const s of fleet) {
        if (s.id === moving) continue;
        for (const cell of shipCells(s)) taken.set(cellKey(cell.r, cell.c), s.id);
      }
      for (const { r, c } of cells) {
        if (r < 0 || r > 9 || c < 0 || c > 9) return false;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (taken.has(cellKey(r + dr, c + dc))) return false;
          }
        }
      }
      return true;
    }

    function sendFleet() {
      Net.action({
        type: 'layout',
        ships: localFleet.map((s) => ({ r: s.r, c: s.c, len: s.len, horizontal: s.horizontal })),
      });
    }

    function paintYard() {
      if (!localFleet) return;

      const chip = (s, inPort) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `bs-ship${s.id === selectedShip && !inPort ? ' on' : ''}${inPort ? ' in-port' : ''}`;
        b.style.setProperty('--len', s.len);
        const hull = hullFor(s);
        b.title = inPort
          ? `${hull.name} — left in port. Tap to bring her out.`
          : `${hull.name} · ${s.len} squares. ${hull === hullFor(s) ? '' : ''}Tap to pick her up${canSailLight ? ', long-press to leave her in port' : ''}.`;
        b.innerHTML = hullSvg(s, { cell: 22, horizontal: true }) + `<span class="bs-ship-name">${hull.name}</span>`;

        if (inPort) {
          b.addEventListener('click', () => recall(s.id));
          return b;
        }
        b.addEventListener('click', () => {
          selectedShip = selectedShip === s.id ? null : s.id;
          paintYard();
          paintBoards();
        });
        // Leaving a ship behind is a deliberate act, so it takes a deliberate
        // gesture — a long press, or the × that appears once one is picked up.
        if (canSailLight) {
          const drop = document.createElement('span');
          drop.className = 'bs-ship-drop';
          drop.textContent = '×';
          drop.title = `Leave the ${hull.name} in port`;
          drop.addEventListener('click', (e) => {
            e.stopPropagation();
            leaveInPort(s.id);
          });
          b.appendChild(drop);
        }
        return b;
      };

      el.yard.replaceChildren(...localFleet.map((s) => chip(s, false)));

      if (inPort.length) {
        const dock = document.createElement('div');
        dock.className = 'bs-port';
        const head = document.createElement('span');
        head.className = 'bs-port-label';
        head.textContent = 'In port';
        dock.append(head, ...inPort.map((s) => chip(s, true)));
        el.yard.appendChild(dock);
      }
      paintLightNote();
    }

    /* ---------------------------- sailing light --------------------------- */

    function fleetTonnage(list) {
      return list.reduce((n, s) => n + s.len, 0);
    }

    /** Room left on the board for a ship of this length, anywhere. */
    function anyLegalSpot(ship) {
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
          for (const horizontal of [true, false]) {
            const probe = { ...ship, r, c, horizontal };
            if (legal(localFleet, ship.id, shipCells(probe))) return { r, c, horizontal };
          }
        }
      }
      return null;
    }

    function leaveInPort(id) {
      const minShips = view?.minShips ?? 2;
      const minTonnage = view?.minTonnage ?? 5;
      const ship = localFleet.find((s) => s.id === id);
      if (!ship) return;
      const left = localFleet.filter((s) => s.id !== id);
      if (left.length < minShips || fleetTonnage(left) < minTonnage) {
        return note(`You have to sail with at least ${minShips} ships and ${minTonnage} squares of hull.`);
      }
      localFleet = left;
      inPort = [...inPort, ship];
      if (selectedShip === id) selectedShip = null;
      sendFleet();
      paintYard();
      paintBoards();
    }

    function recall(id) {
      const ship = inPort.find((s) => s.id === id);
      if (!ship) return;
      const spot = anyLegalSpot(ship);
      if (!spot) return note('No room left in your sea for her.');
      localFleet = [...localFleet, { ...ship, ...spot }];
      inPort = inPort.filter((s) => s.id !== id);
      selectedShip = id;
      sendFleet();
      paintYard();
      paintBoards();
    }

    /** What sailing light is currently buying, in the player's own numbers. */
    function paintLightNote() {
      if (!el.lightNote) return;
      const missing = 20 - fleetTonnage(localFleet ?? []);
      if (!missing) {
        el.lightNote.hidden = true;
        return;
      }
      const energy = Math.min(6, Math.floor(missing / 3));
      const perTurn = Math.min(3, Math.floor(missing / 6));
      const spy = Math.min(4, Math.floor(missing / 4));
      const gains = [`+${energy} energy`, spy ? `+${spy} spies` : null, perTurn ? `+${perTurn} energy a turn` : null]
        .filter(Boolean)
        .join(' · ');
      el.lightNote.hidden = false;
      el.lightNote.textContent = `Sailing light — ${localFleet.length} ships, ${missing} squares left in port. ${gains}.`;
    }

    let noteTimer = null;
    function note(text) {
      if (!el.lightNote) return;
      el.lightNote.hidden = false;
      el.lightNote.textContent = text;
      el.lightNote.classList.add('warn');
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => {
        el.lightNote.classList.remove('warn');
        paintLightNote();
      }, 2600);
    }

    /* -------------------------------- boards ------------------------------ */

    function makeBoard(title, { mine, ownerId }) {
      const box = document.createElement('div');
      box.className = `bs-board${mine ? ' mine' : ''}`;
      box.innerHTML = `<h4></h4><div class="bs-grid"></div>`;
      box.querySelector('h4').textContent = title;
      const grid = box.querySelector('.bs-grid');

      // Corner + column numbers + row letters, then 100 cells.
      grid.appendChild(document.createElement('span'));
      for (let c = 0; c < 10; c++) {
        const h = document.createElement('span');
        h.className = 'bs-axis';
        h.textContent = c + 1;
        h.addEventListener('click', () => onAxis(ownerId, 'col', c));
        grid.appendChild(h);
      }
      for (let r = 0; r < 10; r++) {
        const h = document.createElement('span');
        h.className = 'bs-axis';
        h.textContent = LETTERS[r];
        h.addEventListener('click', () => onAxis(ownerId, 'row', r));
        grid.appendChild(h);
        for (let c = 0; c < 10; c++) {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'bs-cell';
          cell.dataset.k = cellKey(r, c);
          cell.setAttribute('aria-label', label(r, c));
          cell.addEventListener('click', () => onCell(ownerId, mine, r, c));
          grid.appendChild(cell);
        }
      }
      boardEls.set(ownerId, grid);
      return box;
    }

    function paintBoards() {
      if (!view?.you) return;

      // Build the boards once, then only repaint their cells.
      if (!boardEls.size) {
        const mine = makeBoard('Your sea', { mine: true, ownerId: view.you.id });
        const others = view.seas.map((sea) =>
          makeBoard(sea.ally ? `${sea.name} (ally)` : sea.name, { mine: sea.ally, ownerId: sea.id })
        );
        el.boards.replaceChildren(mine, ...others);
      }

      paintOneBoard(view.you.id, {
        // Each square carries which ship it belongs to and how far along it
        // sits, so the cell can draw its own slice of that hull rather than a
        // featureless block.
        ships: (localFleet ?? fleetFromView(view)).flatMap((s) =>
          (s.cells ?? shipCells(s)).map((cell, i) => ({
            ...cell,
            sunk: s.sunk,
            ship: { len: s.len, cls: s.cls },
            index: i,
            horizontal: s.horizontal ?? (s.cells ? s.cells.length === 1 || s.cells[0].r === s.cells[1].r : true),
            selected: s.id === selectedShip,
          }))
        ),
        shots: view.you.board.shots,
        revealed: {},
        selectable: view.phase === 'place',
      });

      for (const sea of view.seas) {
        paintOneBoard(sea.id, {
          ships: sea.ships ? sea.ships.flatMap((s) => s.cells.map((cell) => ({ ...cell, sunk: s.sunk }))) : [],
          shots: sea.shots,
          revealed: sea.revealed,
          firable: !sea.ally && view.phase === 'battle' && view.you.isTurn,
        });
      }
    }

    function paintOneBoard(ownerId, { ships, shots, revealed, firable, selectable }) {
      const grid = boardEls.get(ownerId);
      if (!grid) return;
      grid.classList.toggle('firable', Boolean(firable));
      grid.classList.toggle('placing', Boolean(selectable));

      const shipAt = new Map();
      for (const cell of ships) shipAt.set(cellKey(cell.r, cell.c), cell);

      for (const cell of grid.querySelectorAll('.bs-cell')) {
        const k = cell.dataset.k;
        const shot = shots[k];
        const found = revealed?.[k];
        const here = shipAt.get(k);
        cell.className = 'bs-cell';
        if (here) cell.classList.add(here.sunk ? 'sunk' : 'ship');
        if (here?.selected) cell.classList.add('picked');
        if (shot === 'hit') cell.classList.add('hit');
        else if (shot === 'miss') cell.classList.add('miss');
        else if (found === 'sunk') cell.classList.add('sunk');
        else if (found === 'intel') cell.classList.add('found');
        cell.disabled = Boolean(shot) && !selectable;

        // Draw the hull, not a filled square — but only where we know which
        // hull it is. An enemy square revealed by intel is still a mystery.
        const want = here?.ship ? `${here.ship.cls ?? here.ship.len}:${here.index}:${here.horizontal ? 'h' : 'v'}` : '';
        if (cell.dataset.hull !== want) {
          cell.dataset.hull = want;
          cell.innerHTML = want ? hullSliceSvg(here.ship, here.index, { horizontal: here.horizontal }) : '';
        }
      }
    }

    /* ------------------------------ the scopes ---------------------------- */

    /** Which enemy the big scope is pointed at, defaulting to the first alive. */
    function currentTarget() {
      const enemies = (view?.seas ?? []).filter((s) => !s.ally && s.afloat > 0);
      if (!enemies.length) return null;
      return enemies.find((s) => s.id === targetId) ?? enemies[0];
    }

    function paintScopes() {
      if (!view?.you) return;
      const battle = view.phase === 'battle' || view.phase === 'over';
      el.scopes.hidden = !battle;
      el.boards.hidden = battle;
      if (!battle) return;

      const target = currentTarget();
      targetId = target?.id ?? null;
      enemyRadar.setTarget(targetId);
      el.targetName.textContent = target ? target.name : 'No target';

      // More than one enemy means you choose who to point at.
      const enemies = (view.seas ?? []).filter((s) => !s.ally);
      el.targets.hidden = enemies.length < 2;
      if (enemies.length >= 2) {
        el.targets.replaceChildren(
          ...enemies.map((s) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `bs-target${s.id === targetId ? ' on' : ''}`;
            b.disabled = s.afloat === 0;
            b.textContent = `${s.name} · ${s.afloat}`;
            b.addEventListener('click', () => {
              targetId = s.id;
              armedPower = null;
              salvoPicks = [];
              paintScopes();
              paintPowers();
            });
            return b;
          })
        );
      }

      el.energy.textContent = view.powersOn
        ? `⚡ ${view.you.energy}${view.you.jammed ? ' · JAMMED' : ''}`
        : '';
    }

    /** The squares an armed power would affect, for the aiming overlay. */
    function aimPreview(r, c) {
      if (armedPower === 'torpedo') {
        return Array.from({ length: 3 }, (_, i) => ({ r, c: c + i }));
      }
      if (armedPower === 'sonar') {
        const out = [];
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) out.push({ r: r + dr, c: c + dc });
        return out;
      }
      return [{ r, c }];
    }

    /** A tap on the enemy scope: fire, or aim whatever power is armed. */
    function onScope(r, c) {
      if (!view || view.phase !== 'battle' || !view.you.isTurn) return;
      const target = currentTarget();
      if (!target) return;

      if (!armedPower) {
        Net.action({ type: 'fire', targetId: target.id, r, c });
        return;
      }

      if (armedPower === 'salvo') {
        salvoPicks.push({ r, c });
        Sound.play('pick');
        if (salvoPicks.length >= 4) {
          Net.action({ type: 'power', power: 'salvo', targetId: target.id, cells: salvoPicks });
          armedPower = null;
          salvoPicks = [];
        }
        paintPowers();
        return;
      }

      const payload = { type: 'power', power: armedPower, targetId: target.id, r, c };
      if (armedPower === 'torpedo') payload.axis = 'row';
      Net.action(payload);
      armedPower = null;
      enemyRadar.setAim(null);
      paintPowers();
    }

    /** A tap on your own scope: only the defensive powers land here. */
    function onOwnScope(r, c) {
      if (!view || view.phase !== 'battle' || !view.you.isTurn) return;
      if (armedPower === 'decoy') {
        Net.action({ type: 'power', power: 'decoy', r, c });
        armedPower = null;
        paintPowers();
      }
    }

    function paintPowers() {
      if (!view?.you) return;
      const list = view.you.powers ?? [];
      el.powers.hidden = view.phase !== 'battle' || !list.length;
      if (el.powers.hidden) return;

      el.powers.replaceChildren(
        ...list.map((p) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `bs-power${armedPower === p.id ? ' on' : ''}${p.ready ? '' : ' broke'}`;
          b.disabled = !view.you.isTurn || !p.ready;
          b.innerHTML = `<span class="bs-power-icon"></span><b></b><i></i><small></small>`;
          b.querySelector('.bs-power-icon').textContent = p.icon;
          b.querySelector('b').textContent = p.name;
          b.querySelector('i').textContent = `⚡${p.cost}`;
          b.querySelector('small').textContent =
            armedPower === p.id
              ? p.id === 'salvo'
                ? `pick ${4 - salvoPicks.length} more`
                : p.id === 'decoy'
                  ? 'tap your own sea'
                  : p.id === 'recon'
                    ? 'tap a row or column label'
                    : 'tap the target scope'
              : p.blurb;
          b.title = p.blurb;
          b.addEventListener('click', () => {
            armedPower = armedPower === p.id ? null : p.id;
            salvoPicks = [];
            enemyRadar.setAim(null);
            // Evade and EMP need no aiming — they fire the moment you pick them.
            if (armedPower === 'emp') {
              const t = currentTarget();
              if (t) Net.action({ type: 'power', power: 'emp', targetId: t.id });
              armedPower = null;
            } else if (armedPower === 'evade') {
              armedPower = null;
              autoEvade();
            }
            Sound.play('click');
            paintPowers();
          });
          return b;
        })
      );
    }

    /**
     * Evade needs a ship and a legal berth. Rather than making the player
     * hunt for one, the client finds the first undamaged ship and the first
     * spot the rules allow — the server re-checks it anyway.
     */
    function autoEvade() {
      const ships = view.you.board.ships.filter((s) => !s.sunk);
      const hit = new Set(Object.entries(view.you.board.shots).filter(([, v]) => v === 'hit').map(([k]) => k));
      const ship = ships.find((s) => !s.cells.some((cell) => hit.has(cellKey(cell.r, cell.c))));
      if (!ship) return;

      const taken = new Set();
      for (const other of ships) {
        if (other.id === ship.id) continue;
        for (const cell of other.cells) taken.add(cellKey(cell.r, cell.c));
      }
      const free = (r, c) => {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (taken.has(cellKey(r + dr, c + dc))) return false;
          }
        }
        return true;
      };
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c <= 10 - ship.len; c++) {
          const cells = Array.from({ length: ship.len }, (_, i) => ({ r, c: c + i }));
          if (cells.every((x) => free(x.r, x.c) && !view.you.board.shots[cellKey(x.r, x.c)])) {
            Net.action({ type: 'power', power: 'evade', shipId: ship.id, r, c, horizontal: true });
            return;
          }
        }
      }
    }

    /* -------------------------------- actions ----------------------------- */

    function onCell(ownerId, mine, r, c) {
      if (!view) return;

      // Deploying: put the selected ship down here.
      if (view.phase === 'place' && ownerId === view.you.id) {
        if (selectedShip === null) return;
        const ship = localFleet.find((s) => s.id === selectedShip);
        const tryPlace = (horizontal) => {
          const candidate = { ...ship, r, c, horizontal };
          return legal(localFleet, ship.id, shipCells(candidate)) ? candidate : null;
        };
        // Tapping a ship's own square turns it; tapping elsewhere moves it.
        const onItself = shipCells(ship).some((cell) => cell.r === r && cell.c === c);
        const placed = onItself ? tryPlace(!ship.horizontal) : tryPlace(ship.horizontal) ?? tryPlace(!ship.horizontal);
        if (!placed) {
          shake(el.yard);
          Sound.play('wrong');
          return;
        }
        Object.assign(ship, placed);
        Sound.play('pick');
        sendFleet();
        paintBoards();
        return;
      }

      if (view.phase !== 'battle' || !view.you.isTurn || mine) return;

      if (armed === 'spy' || armed === 'satellite') {
        Net.action({ type: 'intel', kind: armed, targetId: ownerId, r, c });
        armed = null;
        paintIntel();
        return;
      }
      if (armed) return; // an air photo wants a row or column, not a square

      Net.action({ type: 'fire', targetId: ownerId, r, c });
    }

    function onAxis(ownerId, axis, index) {
      if (view?.phase !== 'battle' || !view.you.isTurn || armed !== 'photo') return;
      if (ownerId === view.you.id) return;
      Net.action({ type: 'intel', kind: 'photo', targetId: ownerId, axis, index });
      armed = null;
      paintIntel();
    }

    /* --------------------------------- intel ------------------------------ */

    const INTEL = [
      { kind: 'photo', icon: '🛩', name: 'Air photo', how: 'Tap a row letter or column number' },
      { kind: 'satellite', icon: '🛰', name: 'Satellite', how: 'Tap a square — counts its 3×3' },
      { kind: 'spy', icon: '🕵', name: 'Spy', how: 'Tap a square — ship or open sea' },
    ];

    function paintIntel() {
      if (!view?.you) return;
      const have = INTEL.filter((i) => (view.you.intel[i.kind] ?? 0) > 0);
      el.intel.hidden = view.phase !== 'battle' || !have.length;
      if (el.intel.hidden) return;

      el.intel.replaceChildren(
        ...have.map((item) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `bs-intel-btn${armed === item.kind ? ' on' : ''}`;
          b.disabled = !view.you.isTurn;
          b.innerHTML = `<span>${item.icon}</span><b></b><small></small>`;
          b.querySelector('b').textContent = `${item.name} ×${view.you.intel[item.kind]}`;
          b.querySelector('small').textContent = armed === item.kind ? item.how : 'Costs your turn';
          b.addEventListener('click', () => {
            armed = armed === item.kind ? null : item.kind;
            Sound.play('click');
            paintIntel();
          });
          return b;
        })
      );
    }

    /* ---------------------------------- log ------------------------------- */

    function paintLog() {
      if (!view?.log) return;
      el.log.replaceChildren(
        ...view.log.map((entry) => {
          const li = document.createElement('li');
          li.className = `bs-log-${entry.tone}`;
          li.textContent = entry.text;
          return li;
        })
      );
      // The player's own intel readings are private — they go under the log.
      for (const note of view.you?.notes?.slice(-3) ?? []) {
        const li = document.createElement('li');
        li.className = 'bs-log-intel';
        li.textContent = `📋 ${note.text}`;
        el.log.appendChild(li);
      }
      el.log.scrollTop = el.log.scrollHeight;
    }

    /* ------------------------------ the briefing -------------------------- */

    /**
     * The rules, with the clock stopped — every other game on the site opens
     * this way. It doubles as the place the fleet introduces itself, because
     * "carrier" means something and "a 4" does not.
     */
    function paintBrief(v) {
      el.brief.hidden = v.phase !== 'brief';
      if (v.phase !== 'brief') return;

      if (!el.rules.childElementCount) {
        el.rules.replaceChildren(
          ...(v.rules ?? []).map((line) => {
            const li = document.createElement('li');
            li.textContent = line;
            return li;
          })
        );

        // One card per class, drawn from the same shapes the board uses.
        const seen = new Set();
        el.briefFleet.replaceChildren(
          ...(v.fleetPlan ?? []).flatMap((cls) => {
            if (seen.has(cls)) return [];
            seen.add(cls);
            const spec = v.classes?.[cls];
            const count = (v.fleetPlan ?? []).filter((x) => x === cls).length;
            const card = document.createElement('div');
            card.className = 'bs-class';
            card.innerHTML =
              hullSvg({ len: spec?.len ?? 1, cls }, { cell: 20 }) +
              '<b></b><small></small>';
            card.querySelector('b').textContent = `${count}× ${spec?.name ?? cls}`;
            card.querySelector('small').textContent = spec?.blurb ?? '';
            return [card];
          })
        );
      }

      const waiting = (v.players ?? []).filter((p) => !p.briefed).length;
      const meReady = v.you?.briefed;
      el.briefWait.textContent = meReady
        ? waiting
          ? `Waiting for ${waiting} other${waiting === 1 ? '' : 's'}…`
          : 'Everyone is ready.'
        : `Deployment starts in ${Math.max(0, Math.round(v.timeLeft))}s whatever happens.`;
      root.querySelector('#bsBriefed').disabled = Boolean(meReady);
    }

    /* -------------------------------- painting ---------------------------- */

    function paint(v) {
      const first = !view;
      view = v;

      canSailLight = v.sailLight !== false;

      if (v.phase === 'place' && (!localFleet || first)) localFleet = fleetFromView(v);
      if (v.phase !== 'place') localFleet = null;

      paintBrief(v);
      el.deploy.hidden = v.phase !== 'place';
      el.phase.textContent =
        v.phase === 'brief'
          ? 'Briefing'
          : v.phase === 'place'
            ? 'Deploying'
            : v.phase === 'over'
              ? 'Over'
              : v.you.isTurn
                ? 'Your shot'
                : 'Waiting';
      el.phase.classList.toggle('accent', Boolean(v.you?.isTurn) && v.phase === 'battle');

      const upNow = v.players.find((p) => p.id === v.turnPlayerId);
      el.turn.textContent =
        v.phase === 'battle' ? (v.you.isTurn ? '🎯 Fire at will' : `⏳ ${upNow?.name ?? '—'}`) : '';

      clock = v.timeLeft;
      el.clock.textContent = Math.max(0, Math.round(clock));

      if (v.phase !== lastPhase) {
        lastPhase = v.phase;
        armed = null;
        Sound.play(v.phase === 'battle' ? 'start' : 'phase');
      }

      paintYard();
      paintBoards();
      paintScopes();
      paintPowers();
      paintIntel();
      paintLog();

      if (v.phase === 'over' && v.winner !== null) {
        const won = v.winner === v.you.team;
        Sound.play(won ? 'win' : 'lose');
        if (won) confetti(root, { count: 46 });
      }
    }

    /* -------------------------------- wiring ------------------------------ */

    root.querySelector('#bsBriefed').addEventListener('click', (e) => {
      Net.action({ type: 'ready' });
      e.currentTarget.disabled = true;
      Sound.play('join');
    });

    root.querySelector('#bsShuffle').addEventListener('click', () => {
      Net.action({ type: 'shuffle' });
      localFleet = null;
      selectedShip = null;
      // A shuffle deals the whole fleet again, so nothing is left ashore.
      inPort = [];
      Sound.play('pick');
    });
    root.querySelector('#bsReady').addEventListener('click', (e) => {
      Net.action({ type: 'ready' });
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Waiting for the others…';
      Sound.play('join');
    });

    const offState = Net.on('game:state', paint);
    const offYou = Net.on('game:you', () => {}); // private slice rides on game:state here

    // The splash lands on the exact square that was hit, on whichever board.
    const offEvent = Net.on('game:event', ({ event, payload }) => {
      if (event !== 'splash') return;

      // The scopes get the impact ring; the DOM boards get the cell flash.
      const scope = payload.targetId === view?.you?.id ? ownRadar : enemyRadar;
      scope.impact(payload.r, payload.c, payload.hit);
      if (payload.hit) {
        Sound.play(payload.sunk ? 'unlock' : 'correct');
        if (payload.sunk) shake(root);
      } else {
        Sound.play('back');
      }

      const grid = boardEls.get(payload.targetId);
      const cell = grid?.querySelector(`[data-k="${cellKey(payload.r, payload.c)}"]`);
      if (!cell) return;
      cell.classList.add(payload.hit ? 'boom' : 'splash');
      setTimeout(() => cell.classList.remove('boom', 'splash'), 700);
      Sound.play(payload.hit ? 'correct' : 'back');
      if (payload.sunk) {
        Sound.play('unlock');
        shake(grid);
        floatText(cell, 'SUNK');
      } else if (payload.hit && payload.by === Net.playerId) {
        flash(cell, 'good');
      }
    });

    // The clock ticks locally so it moves smoothly between server frames.
    const ticker = setInterval(() => {
      if (!view || view.phase === 'over') return;
      clock = Math.max(0, clock - 0.25);
      el.clock.textContent = Math.max(0, Math.round(clock));
    }, 250);

    return () => {
      clearInterval(ticker);
      enemyRadar.destroy();
      ownRadar.destroy();
      offState();
      offYou();
      offEvent();
      boardEls.clear();
      root.remove();
      wrap.classList.remove('bs-stage');
      canvas.style.display = '';
      hud.innerHTML = '';
    };
  },
};
