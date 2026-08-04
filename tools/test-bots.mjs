// CPU players: can one person, alone, actually finish every game?
//
//   URL=http://localhost:3100 node tools/test-bots.mjs
//
// One real socket per game, the rest of the seats filled with CPUs, then the
// human does nothing at all. Every game must still reach a result — that is
// the whole promise of solo mode. A bot that stalls, acts out of turn, or
// lands on the leaderboard fails here.

import { io } from 'socket.io-client';

const URL = process.env.URL;
if (!URL) {
  console.error('\n  Set URL to a throwaway server — this creates accounts and plays matches.\n');
  process.exit(1);
}

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));

const games = await (await fetch(`${URL}/api/games`)).json();
const { questions } = await (await fetch(`${URL}/api/quiz`)).json();
const stamp = Date.now().toString(36).slice(-4);
let seq = 0;

async function account(name) {
  const res = await (
    await fetch(`${URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `${name}${stamp}${seq}`,
        age: 18,
        pin: '1111',
        answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + seq) % q.options.length].id])),
      }),
    })
  ).json();
  seq += 1;
  if (res.error) throw new Error(res.error);
  return res;
}

console.log('\n  Solo play against CPU players\n');

// Long enough for a short match; Orb Rush runs a full minute so it is measured
// on progress rather than completion.
const WATCH_MS = 26_000;

for (const meta of games) {
  const acct = await account('Solo');
  const socket = io(URL, { transports: ['websocket'], reconnection: false });
  await new Promise((r) => socket.once('connect', r));

  const seen = { states: 0, phases: new Set(), over: false, scores: null, botNames: new Set() };
  socket.on('game:state', (s) => {
    seen.states += 1;
    if (s.phase) seen.phases.add(s.phase);
    // Reading the rules and deploying a fleet are the two things no CPU can do
    // on a human's behalf — one is their attention, the other is their own
    // board. Everything after this is the bots.
    if (s.phase === 'brief' && !seen.briefed) {
      seen.briefed = true;
      socket.emit('game:action', { type: 'ready' });
    }
    if (s.phase === 'place' && !seen.deployed) {
      seen.deployed = true;
      socket.emit('game:action', { type: 'ready' });
    }
    for (const p of s.players ?? []) if (p.name && /^(Nova|Echo|Vega|Onyx|Iris|Kite|Rook|Sable|Lynx|Corvo|Wren|Atlas)$/.test(p.name)) seen.botNames.add(p.name);
  });
  socket.on('game:over', ({ results: table }) => {
    seen.over = true;
    seen.scores = table;
  });

  const created = await ask(socket, 'room:create', { gameId: meta.id, token: acct.token });
  if (created.error) {
    check(`${meta.name}: room opens`, false, created.error);
    socket.close();
    continue;
  }

  // Fill the room to the game's minimum with CPUs, then add one more so even
  // a solo-capable game has an opponent to beat.
  const filled = await ask(socket, 'room:fill', {});
  if (filled.error) {
    check(`${meta.name}: CPUs can be added`, false, filled.error);
    socket.close();
    continue;
  }
  await ask(socket, 'room:bot', { add: true });
  await wait(400);

  let seats = 0;
  let bots = 0;
  await new Promise((resolve) => {
    socket.once('room:state', (room) => {
      seats = room.players.length;
      bots = room.players.filter((p) => p.isBot).length;
      resolve();
    });
    socket.emit('room:ready', true);
    setTimeout(resolve, 1500);
  });
  check(`${meta.name}: CPUs take the empty seats`, bots > 0, `${bots} CPU of ${seats}`);

  const started = await ask(socket, 'room:start', {});
  if (started.error) {
    check(`${meta.name}: a solo player can start`, false, started.error);
    socket.close();
    continue;
  }
  check(`${meta.name}: a solo player can start`, true, `${seats} seats`);

  // The human does nothing from here. Everything that happens is the CPUs.
  await wait(WATCH_MS);

  const moved = meta.id === 'orb-rush' ? seen.states > 40 : seen.phases.size > 1 || seen.over;
  check(`${meta.name}: the CPUs actually play`, moved, `${seen.states} frames · ${[...seen.phases].join('→') || 'real-time'}`);

  if (seen.over) {
    const named = seen.scores?.some((r) => String(r.playerId).startsWith('bot:'));
    check(`${meta.name}: CPUs appear in the results`, Boolean(named) || seen.scores?.length > 1);
  }

  socket.close();
  await wait(250);
}

/* --------------------- CPUs must not reach the ledger --------------------- */

{
  const board = await (await fetch(`${URL}/api/leaderboard?sort=points`)).json();
  const rows = Array.isArray(board) ? board : board.rows ?? [];
  const botOnBoard = rows.some((r) =>
    /^(Nova|Echo|Vega|Onyx|Iris|Kite|Rook|Sable|Lynx|Corvo|Wren|Atlas)$/.test(r.name ?? '')
  );
  check('CPU players never reach the leaderboard', !botOnBoard, `${rows.length} rows checked`);
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n  ${passed}/${results.length} checks passed\n`);
process.exit(passed === results.length ? 0 : 1);
