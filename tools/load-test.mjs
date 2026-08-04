// How many friends can actually play at once?
//
// Signs up N accounts, spreads them across R rooms, starts every room and plays
// real rounds — then reports what got through. Use it to size a session before
// a party rather than finding out mid-game.
//
//   DATA_DIR=./tmp-load PORT=3100 node server/index.js
//   URL=http://localhost:3100 node tools/load-test.mjs 40 4
//
// Args: <players> <rooms> [gameId]

import { io } from 'socket.io-client';

const URL = process.env.URL;
if (!URL) {
  console.error('\n  Set URL to a throwaway server — this creates real accounts.\n');
  process.exit(1);
}

const PLAYERS = Number(process.argv[2]) || 24;
const ROOMS = Number(process.argv[3]) || 3;
const GAME = process.argv[4] || 'quiz';
const PLAY_SECONDS = 25;

const post = async (path, body) =>
  (
    await fetch(URL + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json();

const stamp = Date.now().toString(36).slice(-4);
const { questions } = await (await fetch(URL + '/api/quiz')).json();
const answersFor = (o) =>
  Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + o) % q.options.length].id]));

console.log(`\n  Load test — ${PLAYERS} players across ${ROOMS} rooms of "${GAME}"\n`);

/* ------------------------------- sign up -------------------------------- */

const t0 = Date.now();
const accounts = [];
for (let i = 0; i < PLAYERS; i++) {
  const res = await post('/api/auth/signup', {
    name: `L${stamp}${i}`,
    age: 18,
    pin: '1111',
    answers: answersFor(i),
  });
  if (res.error) {
    console.error(`  signup ${i} failed: ${res.error}`);
    process.exit(1);
  }
  accounts.push(res);
}
console.log(`  ${accounts.length} accounts created in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

/* ------------------------------- connect -------------------------------- */

const stats = { connected: 0, joined: 0, states: 0, errors: [], disconnects: 0 };
const sockets = accounts.map(() => io(URL, { transports: ['websocket'], reconnection: false }));

await Promise.all(
  sockets.map(
    (s, i) =>
      new Promise((resolve) => {
        s.once('connect', () => {
          stats.connected += 1;
          resolve();
        });
        s.once('connect_error', (err) => {
          stats.errors.push(`socket ${i}: ${err.message}`);
          resolve();
        });
        setTimeout(resolve, 15000);
      })
  )
);
console.log(`  ${stats.connected}/${PLAYERS} sockets connected`);

for (const s of sockets) s.on('disconnect', () => (stats.disconnects += 1));

/* -------------------------- rooms, then play ----------------------------- */

const ask = (socket, event, payload) => new Promise((res) => socket.emit(event, payload, res));
const perRoom = Math.ceil(PLAYERS / ROOMS);
const codes = [];

for (let r = 0; r < ROOMS; r++) {
  const members = sockets.slice(r * perRoom, (r + 1) * perRoom);
  if (!members.length) break;
  const created = await ask(members[0], 'room:create', { gameId: GAME, token: accounts[r * perRoom].token });
  if (created.error) {
    stats.errors.push(`room ${r}: ${created.error}`);
    continue;
  }
  codes.push(created.code);
  stats.joined += 1;

  for (let m = 1; m < members.length; m++) {
    const res = await ask(members[m], 'room:join', {
      code: created.code,
      token: accounts[r * perRoom + m].token,
    });
    if (res.error) stats.errors.push(`join r${r} m${m}: ${res.error}`);
    else stats.joined += 1;
  }
}
console.log(`  ${stats.joined}/${PLAYERS} players in ${codes.length} rooms (${codes.join(', ')})`);

// Everyone answers whatever they are shown, like a real room would.
sockets.forEach((socket, i) => {
  let lastKey = '';
  socket.on('game:state', (s) => {
    stats.states += 1;
    const key = `${s.round}:${s.phase}`;
    if (key === lastKey) return;
    lastKey = key;
    if (s.phase !== 'answer') return;
    if (s.prompt?.options?.length) {
      socket.emit('game:action', { type: 'choice', optionId: s.prompt.options[i % s.prompt.options.length].id });
    } else if (s.mode === 'race') {
      socket.emit('game:action', { type: 'answer', text: 'guess' });
    } else {
      socket.emit('game:action', { type: 'answer', text: `player ${i}` });
    }
  });
});

for (let r = 0; r < codes.length; r++) {
  const res = await ask(sockets[r * perRoom], 'room:start', {});
  if (res.error) stats.errors.push(`start r${r}: ${res.error}`);
}

console.log(`  all rooms started — playing for ${PLAY_SECONDS}s…\n`);
const before = process.memoryUsage().rss;
await new Promise((r) => setTimeout(r, PLAY_SECONDS * 1000));

/* -------------------------------- report --------------------------------- */

const health = await (await fetch(URL + '/api/health')).json();
const perSecond = stats.states / PLAY_SECONDS;

console.log('  ── results ──────────────────────────────────');
console.log(`   sockets connected   ${stats.connected}/${PLAYERS}`);
console.log(`   players in rooms    ${stats.joined}/${PLAYERS}`);
console.log(`   rooms live          ${health.rooms}`);
console.log(`   server sees         ${health.players} players`);
console.log(`   state updates       ${stats.states} (${perSecond.toFixed(0)}/s)`);
console.log(`   dropped mid-test    ${stats.disconnects}`);
console.log(`   client memory       ${(before / 1e6).toFixed(0)} MB`);
console.log(`   errors              ${stats.errors.length}`);
for (const e of stats.errors.slice(0, 8)) console.log(`     - ${e}`);
console.log('  ─────────────────────────────────────────────\n');

// Judge before closing: close() fires each socket's own disconnect handler,
// which would otherwise count as 40 drops.
const ok =
  stats.connected === PLAYERS && stats.joined === PLAYERS && stats.disconnects === 0 && !stats.errors.length;

for (const s of sockets) s.close();

console.log(ok ? '  \x1b[32mPASS\x1b[0m — everyone connected, joined and played\n' : '  \x1b[31mISSUES\x1b[0m — see above\n');
process.exit(ok ? 0 : 1);
