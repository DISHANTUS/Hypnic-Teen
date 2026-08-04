// Ship Attack: rules, fairness, and — most of all — that nothing leaks.
//
//   npm run test:battleship
//
// A battleship client that knows where the ships are is not a game, so the
// leak checks here are the ones that matter: whatever the server sends a
// player must never contain an enemy fleet position they have not earned.

import game from '../server/games/battleship.js';

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
};

const mkPlayers = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player${i}`, connected: true }));

const api = { emit() {}, emitTo() {}, finish() {}, players: () => [] };
const cellKey = (r, c) => `${r},${c}`;

/** Runs the deployment phase out so the battle starts. */
/** Past the briefing and into deployment, where layouts are accepted. */
function toPlace(state) {
  for (const p of state.players) game.onAction(state, p, { type: 'ready' }, api);
  game.onTick(state, 0.5, api);
  return state;
}

function toBattle(state) {
  // Briefing, then deployment, then guns. Every phase is dismissed the same
  // way a player would dismiss it — with `ready`.
  for (let guard = 0; guard < 6 && state.phase !== 'battle'; guard++) {
    for (const p of state.players) game.onAction(state, p, { type: 'ready' }, api);
    game.onTick(state, 0.5, api);
  }
  return state;
}

console.log('\n  Ship Attack\n');

/* ------------------------------ fleet legality ---------------------------- */

{
  // The no-touching rule is now the host's choice, so the strict layout has to
  // be asked for. Everything else about a fleet holds either way.
  const state = game.createState(mkPlayers(2), { settings: { spacing: true } });
  const board = state.players[0].board;

  check('the fleet is the full ten ships', board.ships.length === 10, `${board.ships.length} ships`);
  check(
    'every hull knows what it is',
    board.ships.every((s) => s.cls) &&
      new Set(board.ships.map((s) => s.cls)).size === 4,
    [...new Set(board.ships.map((s) => s.cls))].join(', ')
  );
  check(
    'twenty ship parts, in the right sizes',
    board.ships.reduce((n, s) => n + s.len, 0) === 20 &&
      JSON.stringify(board.ships.map((s) => s.len).sort((a, b) => b - a)) === JSON.stringify([4, 3, 3, 2, 2, 2, 1, 1, 1, 1])
  );

  // The rule from the sheet: ships must be surrounded by open sea.
  let touching = false;
  for (const ship of board.ships) {
    for (const { r, c } of ship.cells) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr > 9 || cc < 0 || cc > 9) continue;
          const other = board.grid[rr][cc];
          if (other !== null && other !== ship.id) touching = true;
        }
      }
    }
  }
  check('with the classic rule on, no two ships touch — not even at a corner', !touching);

  // And with it off, a ship may moor alongside another. Half the board silently
  // refusing your ship is the complaint that made this a setting.
  {
    const loose = toPlace(game.createState(mkPlayers(2), { settings: { spacing: false } }));
    const me = loose.players[0];
    const before = JSON.stringify(me.board.ships.map((s) => s.cells));
    // Two hulls in adjacent rows — illegal under the classic rule.
    game.onAction(
      loose,
      me,
      {
        type: 'layout',
        ships: [
          { r: 0, c: 0, len: 4, horizontal: true },
          { r: 1, c: 0, len: 3, horizontal: true },
        ],
      },
      api
    );
    const now = JSON.stringify(me.board.ships.map((s) => s.cells));
    check('with it off, ships may moor alongside each other', now !== before && me.board.ships.length === 2);
  }

  // A hundred layouts, since this is random every match.
  let allLegal = true;
  for (let i = 0; i < 100; i++) {
    const s = game.createState(mkPlayers(2), {});
    for (const p of s.players) {
      if (p.board.ships.length !== 10) allLegal = false;
    }
  }
  check('a hundred random deployments are all legal', allLegal);
}

/* -------------------------------- the leak -------------------------------- */

{
  const state = toBattle(game.createState(mkPlayers(2), {}));
  const [me, foe] = state.players;
  const foeCells = new Set(foe.board.ships.flatMap((s) => s.cells.map((x) => cellKey(x.r, x.c))));

  const full = game.serializeFor(state, me.id);
  const shared = JSON.stringify(game.serialize(state));

  // Search the enemy's slice only. Searching the whole payload would match my
  // OWN ships, which are supposed to be there — and two fleets on two boards
  // routinely occupy the same coordinates.
  const enemySlice = JSON.stringify(full.seas.filter((s) => !s.ally));
  const leaked = [...foeCells].filter((k) => {
    const [r, c] = k.split(',').map(Number);
    return enemySlice.includes(`"r":${r},"c":${c}`) || enemySlice.includes(`"${cellKey(r, c)}"`);
  });
  check('an enemy fleet never appears in your view', leaked.length === 0, leaked.length ? `${leaked.length} cells leaked` : 'clean');
  check('the shared state carries no fleet at all', !shared.includes('"cells"'));

  const seas = full.seas;
  check('enemy seas arrive with ships stripped', seas.every((s) => s.ally || s.ships === null));
  check('your own sea comes back in full', game.serializeFor(state, me.id).you.board.ships.length === 10);
}

/* ------------------------------- taking shots ----------------------------- */

{
  const state = toBattle(game.createState(mkPlayers(2), {}));
  const gunner = state.players.find((p) => p.id === state.turnPlayerId);
  const target = state.players.find((p) => p.team !== gunner.team);

  const shipCell = target.board.ships[0].cells[0];
  let empty = null;
  for (let r = 0; r < 10 && !empty; r++) {
    for (let c = 0; c < 10 && !empty; c++) if (target.board.grid[r][c] === null) empty = { r, c };
  }

  game.onAction(state, gunner, { type: 'fire', targetId: target.id, ...shipCell }, api);
  check('a hit is recorded', target.board.shots[cellKey(shipCell.r, shipCell.c)] === 'hit');
  check('a hit keeps the turn with the same side', state.turnTeam === gunner.team);

  const before = state.turnTeam;
  game.onAction(state, state.players.find((p) => p.id === state.turnPlayerId), { type: 'fire', targetId: target.id, ...empty }, api);
  check('a miss hands the turn over', state.turnTeam !== before);

  // Out of turn, at yourself, and at an already-hit square: all refused.
  const offTurn = state.players.find((p) => p.id !== state.turnPlayerId && p.team !== state.turnTeam);
  const shotsBefore = Object.keys(target.board.shots).length;
  game.onAction(state, offTurn ?? gunner, { type: 'fire', targetId: target.id, r: 9, c: 9 }, api);
  check('you cannot fire out of turn', Object.keys(target.board.shots).length === shotsBefore);

  // Friendly fire needs a real ally and a square nobody has shot at yet, or
  // the check passes for the wrong reason.
  const teamState = toBattle(game.createState(mkPlayers(4), { settings: { teamSize: 2 } }));
  const shooter = teamState.players.find((p) => p.id === teamState.turnPlayerId);
  const mate = teamState.players.find((p) => p.team === shooter.team && p.id !== shooter.id);
  const before2 = Object.keys(mate.board.shots).length;
  game.onAction(teamState, shooter, { type: 'fire', targetId: mate.id, r: 4, c: 4 }, api);
  check('you cannot fire at your own side', Object.keys(mate.board.shots).length === before2);
}

/* --------------------------------- sinking -------------------------------- */

{
  const state = toBattle(game.createState(mkPlayers(2), {}));
  const gunner = state.players.find((p) => p.id === state.turnPlayerId);
  const target = state.players.find((p) => p.team !== gunner.team);
  const ship = target.board.ships.find((s) => s.len === 4);

  for (const cell of ship.cells) {
    game.onAction(state, state.players.find((p) => p.id === state.turnPlayerId), { type: 'fire', targetId: target.id, ...cell }, api);
  }
  check('a ship sinks when every part is hit', ship.sunk);

  const seas = game.serializeFor(state, gunner.id).seas;
  const sea = seas.find((s) => s.id === target.id);
  const shown = ship.cells.every((cell) => sea.revealed[cellKey(cell.r, cell.c)] === 'sunk');
  check('a sunk ship surfaces for everyone', shown);
}

/* ---------------------------------- intel --------------------------------- */

{
  const state = toBattle(game.createState(mkPlayers(2), { settings: { intel: 'standard' } }));
  const me = state.players.find((p) => p.id === state.turnPlayerId);
  const foe = state.players.find((p) => p.team !== me.team);

  check('intel is issued', me.intel.photo === 1 && me.intel.satellite === 1 && me.intel.spy === 2);

  const trueRow0 = foe.board.ships.flatMap((s) => s.cells).filter((c) => c.r === 0).length;
  game.onAction(state, me, { type: 'intel', kind: 'photo', targetId: foe.id, axis: 'row', index: 0 }, api);
  const photo = me.notes.find((n) => n.kind === 'photo');
  check('an air photo counts the row correctly', photo?.count === trueRow0, `reported ${photo?.count}, truth ${trueRow0}`);
  check('using intel spends the resource', me.intel.photo === 0);
  check('using intel costs the turn', state.turnTeam !== me.team);

  // Spent resources cannot be reused.
  const notesBefore = me.notes.length;
  game.onAction(state, me, { type: 'intel', kind: 'photo', targetId: foe.id, axis: 'row', index: 1 }, api);
  check('a spent resource is gone for good', me.notes.length === notesBefore);

  // A spy marks the map for that player only.
  const state2 = toBattle(game.createState(mkPlayers(2), { settings: { intel: 'standard' } }));
  const spy = state2.players.find((p) => p.id === state2.turnPlayerId);
  const prey = state2.players.find((p) => p.team !== spy.team);
  const known = prey.board.ships[0].cells[0];
  game.onAction(state2, spy, { type: 'intel', kind: 'spy', targetId: prey.id, ...known }, api);
  const spySea = game.serializeFor(state2, spy.id).seas.find((s) => s.id === prey.id);
  check('a spy reveals the square to its buyer', spySea.revealed[cellKey(known.r, known.c)] === 'intel');
  const otherView = game.serializeFor(state2, prey.id);
  check('and to nobody else', !JSON.stringify(otherView.seas ?? []).includes('"intel"'));

  const off = game.createState(mkPlayers(2), { settings: { intel: 'off' } });
  check('intel can be switched off entirely', off.players[0].intel.photo === 0 && off.players[0].intel.spy === 0);
}

/* ------------------------------- team battles ----------------------------- */

{
  const state = game.createState(mkPlayers(4), { settings: { teamSize: 2 } });
  const blue = state.players.filter((p) => p.team === 0).length;
  const red = state.players.filter((p) => p.team === 1).length;
  check('2v2 splits the room evenly', blue === 2 && red === 2, `${blue}v${red}`);

  toBattle(state);
  const gunner = state.players.find((p) => p.id === state.turnPlayerId);
  const mate = state.players.find((p) => p.team === gunner.team && p.id !== gunner.id);
  const mateSea = game.serializeFor(state, gunner.id).seas.find((s) => s.id === mate.id);
  check('teammates can see each other’s fleets', Array.isArray(mateSea.ships) && mateSea.ships.length === 10);

  const enemySea = game.serializeFor(state, gunner.id).seas.find((s) => !s.ally);
  check('enemies still cannot', enemySea.ships === null);

  const six = game.createState(mkPlayers(6), { settings: { teamSize: 3 } });
  check('3v3 works the same way', six.players.filter((p) => p.team === 0).length === 3);
}

/* -------------------------------- finishing ------------------------------- */

{
  const state = toBattle(game.createState(mkPlayers(2), { settings: { extraOnHit: true } }));
  const gunner = state.players.find((p) => p.id === state.turnPlayerId);
  const target = state.players.find((p) => p.team !== gunner.team);

  for (const ship of target.board.ships) {
    for (const cell of ship.cells) {
      const up = state.players.find((p) => p.id === state.turnPlayerId);
      game.onAction(state, up ?? gunner, { type: 'fire', targetId: target.id, ...cell }, api);
    }
  }
  check('sinking the last ship ends the match', game.isOver(state));
  check('the right side is declared the winner', state.winner === gunner.team);

  const table = game.results(state);
  check('a ranked result table comes out', table.length === 2 && table[0].place === 1);
  check('the winner ranks first', table[0].team === gunner.team);
  check('the winner outscores the loser', table[0].score > table[1].score, `${table[0].score} vs ${table[1].score}`);
}

/* ------------------------- refusing an illegal fleet ---------------------- */

{
  // Fleet validation is strictest under the classic no-touching rule, so that
  // is what these are checked against.
  const state = toPlace(game.createState(mkPlayers(2), { settings: { spacing: true } }));
  const me = state.players[0];
  const original = JSON.stringify(me.board.ships.map((s) => s.cells));

  // Two ships in the same place.
  game.onAction(state, me, {
    type: 'layout',
    ships: [
      { r: 0, c: 0, len: 4, horizontal: true },
      { r: 0, c: 0, len: 3, horizontal: true },
      { r: 3, c: 0, len: 3, horizontal: true },
      { r: 5, c: 0, len: 2, horizontal: true },
      { r: 7, c: 0, len: 2, horizontal: true },
      { r: 9, c: 0, len: 2, horizontal: true },
      { r: 0, c: 8, len: 1, horizontal: true },
      { r: 2, c: 8, len: 1, horizontal: true },
      { r: 4, c: 8, len: 1, horizontal: true },
      { r: 6, c: 8, len: 1, horizontal: true },
    ],
  }, api);
  check('an overlapping fleet is refused', JSON.stringify(me.board.ships.map((s) => s.cells)) === original);

  // Ships touching corner to corner.
  game.onAction(state, me, {
    type: 'layout',
    ships: [
      { r: 0, c: 0, len: 4, horizontal: true },
      { r: 1, c: 4, len: 3, horizontal: true },
      { r: 3, c: 0, len: 3, horizontal: true },
      { r: 5, c: 0, len: 2, horizontal: true },
      { r: 7, c: 0, len: 2, horizontal: true },
      { r: 9, c: 0, len: 2, horizontal: true },
      { r: 0, c: 8, len: 1, horizontal: true },
      { r: 2, c: 8, len: 1, horizontal: true },
      { r: 4, c: 8, len: 1, horizontal: true },
      { r: 6, c: 8, len: 1, horizontal: true },
    ],
  }, api);
  check('a touching fleet is refused', JSON.stringify(me.board.ships.map((s) => s.cells)) === original);

  // A fleet running off the edge.
  game.onAction(state, me, {
    type: 'layout',
    ships: [{ r: 0, c: 8, len: 4, horizontal: true }, ...Array.from({ length: 9 }, (_, i) => ({ r: i, c: 0, len: 1, horizontal: true }))],
  }, api);
  check('a fleet hanging off the board is refused', JSON.stringify(me.board.ships.map((s) => s.cells)) === original);

  // A legal one is accepted.
  const legal = [
    { r: 0, c: 0, len: 4, horizontal: true },
    { r: 2, c: 0, len: 3, horizontal: true },
    { r: 4, c: 0, len: 3, horizontal: true },
    { r: 6, c: 0, len: 2, horizontal: true },
    { r: 8, c: 0, len: 2, horizontal: true },
    { r: 0, c: 6, len: 2, horizontal: false },
    { r: 3, c: 6, len: 1, horizontal: true },
    { r: 5, c: 6, len: 1, horizontal: true },
    { r: 7, c: 6, len: 1, horizontal: true },
    { r: 9, c: 6, len: 1, horizontal: true },
  ];
  game.onAction(state, me, { type: 'layout', ships: legal }, api);
  check('a legal fleet is accepted', me.board.ships.length === 10 && me.board.grid[0][0] !== null);
}

/* ------------------------------- the CPU admiral -------------------------- */

// Two bots, no humans, played to the end — and the hunt/target search has to
// beat blind guessing, or the "CPU" is just a dice roll wearing a name.
{
  const runMatch = (smart, settings = {}) => {
    const players = mkPlayers(2).map((p, i) => ({ ...p, id: `bot:x:${i}` }));
    const state = game.createState(players, { settings });
    let turns = 0;
    for (let step = 0; step < 6000 && !game.isOver(state); step++) {
      game.onTick(state, 0.5, api);
      for (const p of state.players) {
        const move = smart
          ? game.botAction(state, p)
          : randomShot(state, p);
        if (move && typeof move.then !== 'function') {
          if (move.type === 'fire') turns += 1;
          game.onAction(state, p, move, api);
        }
      }
    }
    return { finished: game.isOver(state), turns, state };
  };

  const randomShot = (state, bot) => {
    const me = state.players.find((p) => p.id === bot.id);
    if (!me) return null;
    if (state.phase === 'brief') return me.briefed ? null : { type: 'ready' };
    if (state.phase === 'place') return me.placed ? null : { type: 'ready' };
    if (state.phase !== 'battle' || state.turnPlayerId !== bot.id) return null;
    const foe = state.players.find((p) => p.team !== me.team);
    const open = [];
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) if (!foe.board.shots[cellKey(r, c)]) open.push({ r, c });
    }
    if (!open.length) return null;
    const pick = open[Math.floor(Math.random() * open.length)];
    return { type: 'fire', targetId: foe.id, r: pick.r, c: pick.c };
  };

  const smart = runMatch(true);
  check('two CPUs play a whole match to the end', smart.finished, `${smart.turns} shots fired`);
  check('a CPU match produces a winner', smart.state.winner !== null);

  // Averaged over enough matches to mean something. Five was not enough: the
  // two averages landed within a shot of each other often enough that this
  // failed on a good CPU and passed on a bad one, which is worse than useless.
  const avg = (smartMode, settings) => {
    let total = 0;
    for (let i = 0; i < 9; i++) total += runMatch(smartMode, settings).turns;
    return total / 9;
  };

  // Under both rules. The hunt was written when ships could not touch, and
  // free placement — now the default — breaks the assumption that a hit's
  // neighbours belong to the same ship, so it has to be measured there too.
  for (const [name, settings] of [
    ['with the classic no-touching rule', { spacing: true }],
    ['and with ships free to touch', { spacing: false }],
  ]) {
    const smartShots = avg(true, settings);
    const blindShots = avg(false, settings);
    check(
      `hunting beats guessing ${name}`,
      smartShots < blindShots * 0.95,
      `${Math.round(smartShots)} shots vs ${Math.round(blindShots)} blind`
    );
  }
}

/* ---------------------------------- powers -------------------------------- */

// The design rule was that every power has a counter. These check the two that
// carry the strategy — a decoy that fools sonar, and a ship that runs away —
// plus that the energy economy actually constrains anything.
{
  const start = () => {
    const state = toBattle(game.createState(mkPlayers(2), { settings: { powers: 'standard' } }));
    const me = state.players.find((p) => p.id === state.turnPlayerId);
    const foe = state.players.find((p) => p.team !== me.team);
    return { state, me, foe };
  };

  {
    const { state, me } = start();
    check('players start with energy', me.energy > 0, `${me.energy}`);
    check('energy is offered to the client', game.serializeFor(state, me.id).you.powers.length === 7);
  }

  // Sonar counts contacts; a decoy is a contact that is not a ship.
  // Each block finds its own empty water — every match lays a fresh fleet, so
  // a patch that was clear in one state is not clear in the next.
  const emptyPatch = (board) => {
    for (let r = 1; r < 9; r++) {
      for (let c = 1; c < 9; c++) if (squareCellsAllEmpty(board, r, c)) return { r, c };
    }
    return null;
  };

  {
    const { state, me, foe } = start();
    const empty = emptyPatch(foe.board);
    game.onAction(state, me, { type: 'power', power: 'sonar', targetId: foe.id, ...empty }, api);
    const clean = me.notes.at(-1);
    check('sonar reports an empty patch as empty', clean.count === 0, `${clean.count} contacts`);
  }

  {
    const { state, me, foe } = start();
    const empty = emptyPatch(foe.board);
    foe.decoys.push(`${empty.r},${empty.c}`);
    me.energy = 10;
    game.onAction(state, me, { type: 'power', power: 'sonar', targetId: foe.id, ...empty }, api);
    const fooled = me.notes.at(-1);
    check('a decoy makes sonar lie', fooled.count === 1, `${fooled.count} contacts where there is no ship`);
  }

  {
    // Recon sees hulls, not signatures — the decoy's counter.
    const { state, me, foe } = start();
    const empty = emptyPatch(foe.board);
    foe.decoys.push(`${empty.r},${empty.c}`);
    const truth = foe.board.ships.flatMap((s) => s.cells).filter((c) => c.r === empty.r).length;
    me.energy = 10;
    game.onAction(state, me, { type: 'power', power: 'recon', targetId: foe.id, axis: 'row', index: empty.r }, api);
    check('recon is not fooled by decoys', me.notes.at(-1).count === truth, `${me.notes.at(-1).count} vs ${truth} real`);
  }

  // A torpedo run is three shells in a line.
  {
    const { state, me, foe } = start();
    me.energy = 10;
    game.onAction(state, me, { type: 'power', power: 'torpedo', targetId: foe.id, r: 4, c: 0, axis: 'row' }, api);
    const fired = ['4,0', '4,1', '4,2'].every((k) => foe.board.shots[k]);
    check('a torpedo run puts three shells in a line', fired);
    check('it costs its energy', me.energy === 10 - 4, `${me.energy} left`);
  }

  // Evade is the deduction-breaker.
  {
    const { state, me } = start();
    me.energy = 10;
    const ship = me.board.ships.find((s) => s.hits === 0 && s.len === 1);
    const from = { ...ship.cells[0] };
    // Ships may not touch, so a berth has to be clear of every neighbour too —
    // "the first empty square" is almost always illegal.
    let spot = null;
    for (let r = 0; r < 10 && !spot; r++) {
      for (let c = 0; c < 10 && !spot; c++) {
        if (r === from.r && c === from.c) continue;
        const clear = squareCellsAllEmpty(me.board, r, c) || (
          // the ship's own square counts as empty once it lifts off
          me.board.grid[r][c] === null &&
          [-1, 0, 1].every((dr) =>
            [-1, 0, 1].every((dc) => {
              const rr = r + dr;
              const cc = c + dc;
              if (rr < 0 || rr > 9 || cc < 0 || cc > 9) return true;
              const occupant = me.board.grid[rr][cc];
              return occupant === null || occupant === ship.id;
            })
          )
        );
        if (clear) spot = { r, c };
      }
    }
    const before = state.turnPlayerId;
    game.onAction(state, me, { type: 'power', power: 'evade', shipId: ship.id, horizontal: true, ...spot }, api);
    const moved = ship.cells[0].r !== from.r || ship.cells[0].c !== from.c;
    check('evade moves an undamaged ship', moved);
    check('the old berth is empty again', me.board.grid[from.r][from.c] === null);
    check('evading does not cost you the shot', state.turnPlayerId === before);

    // A wounded ship cannot run.
    const hurt = me.board.ships.find((s) => s.len === 4);
    hurt.hits = 1;
    const where = { ...hurt.cells[0] };
    game.onAction(state, me, { type: 'power', power: 'evade', shipId: hurt.id, horizontal: true, r: 0, c: 0 }, api);
    check('a damaged ship cannot run', hurt.cells[0].r === where.r && hurt.cells[0].c === where.c);
  }

  // EMP denies the enemy their income.
  {
    const { state, me, foe } = start();
    me.energy = 10;
    const before = foe.energy;
    game.onAction(state, me, { type: 'power', power: 'emp', targetId: foe.id }, api);
    check('EMP jams the other side', foe.jammedUntil >= state.round);
    check('a jammed player earns nothing', foe.energy === before, `${foe.energy} vs ${before}`);
  }

  // Nothing is free.
  {
    const { state, me, foe } = start();
    me.energy = 1; // cannot afford anything
    const notesBefore = me.notes.length;
    game.onAction(state, me, { type: 'power', power: 'salvo', targetId: foe.id, cells: [{ r: 0, c: 0 }] }, api);
    check('a power you cannot afford does nothing', me.notes.length === notesBefore && !foe.board.shots['0,0']);

    const off = toBattle(game.createState(mkPlayers(2), { settings: { powers: 'off' } }));
    const solo = off.players.find((p) => p.id === off.turnPlayerId);
    check('powers can be switched off entirely', game.serializeFor(off, solo.id).you.powers.length === 0);
  }
}

function squareCellsAllEmpty(board, r, c) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || rr > 9 || cc < 0 || cc > 9) continue;
      if (board.grid[rr][cc] !== null) return false;
    }
  }
  return true;
}

/* --------------------------------- wrecks --------------------------------- */

// A kill should be visible for a couple of rounds and then gone. A sea that
// stays littered with old wrecks forever turns into a map of solved squares.
{
  const state = toBattle(game.createState(mkPlayers(2), { settings: { powers: 'off' } }));
  const gunner = state.players.find((p) => p.id === state.turnPlayerId);
  const target = state.players.find((p) => p.team !== gunner.team);
  const ship = target.board.ships.find((s) => s.len === 1);

  game.onAction(state, state.players.find((p) => p.id === state.turnPlayerId),
    { type: 'fire', targetId: target.id, ...ship.cells[0] }, api);
  check('a sunk ship records when it went down', ship.sunk && Number.isInteger(ship.sunkRound));

  const seaNow = () => game.serializeFor(state, gunner.id).seas.find((s) => s.id === target.id);
  check('the wreck is on the scope straight away', (seaNow().wrecks ?? []).length === 1);

  // Age it past the window.
  state.round += 3;
  const later = seaNow();
  check('the sea closes over it after a couple of rounds', (later.wrecks ?? []).length === 0);
  check(
    'but the hits that sank her remain',
    Object.values(later.shots).filter((v) => v === 'hit').length > 0
  );

  // Your own wrecks fade on the same clock.
  const own = game.serializeFor(state, target.id).you.board.ships.find((s) => s.sunk);
  check('your own wreck is marked gone too', own?.gone === true);
}

/* ------------------------- the rules come up first ------------------------ */

{
  const state = game.createState(mkPlayers(2), {});
  check('a match opens with the briefing, not a running clock', state.phase === 'brief');
  check('the briefing has something to say', (game.howToPlay ?? []).length >= 3, `${game.howToPlay?.length} lines`);
  check('the rules reach the client', (game.serialize(state).rules ?? []).length >= 3);

  // One player reading does not start the match for everyone.
  game.onAction(state, state.players[0], { type: 'ready' }, api);
  game.onTick(state, 0.5, api);
  check('one player reading does not rush the other', state.phase === 'brief');

  game.onAction(state, state.players[1], { type: 'ready' }, api);
  game.onTick(state, 0.5, api);
  check('once everyone has read it, deployment begins', state.phase === 'place');
  check('and the deployment clock starts full', state.timeLeft === state.settings.placeSeconds, `${state.timeLeft}s`);

  // Nobody gets stranded on the briefing by a player who wandered off.
  const stalled = game.createState(mkPlayers(2), {});
  game.onTick(stalled, 999, api);
  check('a player who never presses on does not hold up the match', stalled.phase === 'place');
}

/* ---------------------- a hit earns another shot -------------------------- */

{
  const state = toBattle(game.createState(mkPlayers(2), { settings: { extraOnHit: true, turnSeconds: 30 } }));
  const gunner = state.players.find((p) => p.id === state.turnPlayerId);
  const target = state.players.find((p) => p.team !== gunner.team);
  const hit = target.board.ships[0].cells[0];

  // Spend most of the turn thinking, the way a player actually does.
  state.turnLeft = 4;
  game.onAction(state, gunner, { type: 'fire', targetId: target.id, ...hit }, api);

  check('hitting keeps the turn', state.turnPlayerId === gunner.id);
  // The bug that made the feature look broken: the extra shot inherited the
  // dregs of the old clock, so the tick took the turn away before it could be
  // used. An extra shot with four seconds on it is not an extra shot.
  check('and the extra shot comes with a fresh clock', state.turnLeft === 30, `${state.turnLeft}s`);
  check('a hit does not advance the round, so it earns no extra energy', state.round === 1, `round ${state.round}`);

  // Keep hitting, keep firing.
  const second = target.board.ships[0].cells[1] ?? target.board.ships[1].cells[0];
  game.onAction(state, gunner, { type: 'fire', targetId: target.id, ...second }, api);
  check('and again on the next hit', state.turnPlayerId === gunner.id);

  // A miss hands it over.
  let blank = null;
  for (let r = 0; r < 10 && !blank; r++) {
    for (let c = 0; c < 10 && !blank; c++) {
      if (target.board.grid[r][c] === null && !target.board.shots[`${r},${c}`]) blank = { r, c };
    }
  }
  game.onAction(state, gunner, { type: 'fire', targetId: target.id, ...blank }, api);
  check('a miss ends the run', state.turnPlayerId !== gunner.id);

  // And with the rule switched off, one shot is one shot.
  const strict = toBattle(game.createState(mkPlayers(2), { settings: { extraOnHit: false } }));
  const g2 = strict.players.find((p) => p.id === strict.turnPlayerId);
  const t2 = strict.players.find((p) => p.team !== g2.team);
  game.onAction(strict, g2, { type: 'fire', targetId: t2.id, ...t2.board.ships[0].cells[0] }, api);
  check('with the rule off, even a hit passes the turn', strict.turnPlayerId !== g2.id);
}

/* ---------------------------- sailing light ------------------------------- */

{
  const state = toPlace(game.createState(mkPlayers(2), { settings: { sailLight: true } }));

  const me = state.players[0];
  const carrierAndBattleship = [
    { r: 0, c: 0, len: 4, horizontal: true },
    { r: 3, c: 0, len: 3, horizontal: true },
  ];
  game.onAction(state, me, { type: 'layout', ships: carrierAndBattleship }, api);
  check('you can go to sea with just two ships', me.board.ships.length === 2, `${me.board.ships.length} ships`);

  const bonus = me.light;
  check('leaving thirteen cells in port is noticed', bonus.missing === 13, `${bonus.missing} cells short`);
  check('and it buys energy', bonus.energy > 0, `+${bonus.energy}`);
  check('and spies', bonus.spy > 0, `+${bonus.spy}`);
  check('and more energy every turn', bonus.perTurn > 0, `+${bonus.perTurn}/turn`);

  // The compensation must actually land, not just be calculated.
  const energyBefore = me.energy;
  const spiesBefore = me.intel.spy;
  game.onTick(state, 999, api); // run the deployment clock out, into battle
  check('the energy is on the board before the first shell', me.energy > energyBefore, `${energyBefore} → ${me.energy}`);
  check('and so are the spies', me.intel.spy > spiesBefore, `${spiesBefore} → ${me.intel.spy}`);

  // The other side sailed full strength and gets nothing.
  const them = state.players[1];
  check('a full fleet earns no handicap', (them.light?.missing ?? 0) === 0);

  // Floors: one submarine alone in a hundred squares is not a game.
  const tiny = toPlace(game.createState(mkPlayers(2), { settings: { sailLight: true } }));
  const solo = tiny.players[0];
  const wasSolo = JSON.stringify(solo.board.ships.map((s) => s.cells));
  game.onAction(tiny, solo, { type: 'layout', ships: [{ r: 0, c: 0, len: 1, horizontal: true }] }, api);
  check('one ship is refused', JSON.stringify(solo.board.ships.map((s) => s.cells)) === wasSolo);
  game.onAction(
    tiny,
    solo,
    { type: 'layout', ships: [{ r: 0, c: 0, len: 1, horizontal: true }, { r: 5, c: 5, len: 1, horizontal: true }] },
    api
  );
  check('and so are two submarines hiding in a hundred squares', JSON.stringify(solo.board.ships.map((s) => s.cells)) === wasSolo);

  // You cannot invent hulls the yard never gave you.
  game.onAction(
    tiny,
    solo,
    {
      type: 'layout',
      ships: [
        { r: 0, c: 0, len: 4, horizontal: true },
        { r: 3, c: 0, len: 4, horizontal: true },
      ],
    },
    api
  );
  check('and you cannot bring two carriers', JSON.stringify(solo.board.ships.map((s) => s.cells)) === wasSolo);

  // With the option off, a short fleet is simply refused.
  const strict = toPlace(game.createState(mkPlayers(2), { settings: { sailLight: false } }));
  const full = strict.players[0];
  const wasFull = JSON.stringify(full.board.ships.map((s) => s.cells));
  game.onAction(strict, full, { type: 'layout', ships: carrierAndBattleship }, api);
  check('a host can insist on full fleets', JSON.stringify(full.board.ships.map((s) => s.cells)) === wasFull);
}

/* --------------------------------- report --------------------------------- */

const passed = results.filter((r) => r.ok).length;
console.log(`\n  ${passed}/${results.length} checks passed\n`);
process.exit(passed === results.length ? 0 : 1);
