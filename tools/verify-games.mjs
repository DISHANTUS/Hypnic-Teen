// Plays every game in the catalogue over real sockets against a real server.
//
// tools/test-games.mjs exercises the rules in-process; this exercises the wire:
// room creation, join, start, the private-view split, mass-mode payloads and
// action round-trips — per game, the way a phone would.
//
//   DATA_DIR=./tmp-verify PORT=3100 node server/index.js
//   URL=http://localhost:3100 node tools/verify-games.mjs

import { io } from 'socket.io-client';

const URL = process.env.URL;
if (!URL) {
  console.error('\n  Set URL to a throwaway server — this creates accounts and plays matches.\n');
  process.exit(1);
}

const WATCH_MS = 9000; // long enough to see a phase change in every game

const post = async (path, body) =>
  (
    await fetch(URL + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json();

const games = await (await fetch(URL + '/api/games')).json();
const { questions } = await (await fetch(URL + '/api/quiz')).json();
const answersFor = (o) =>
  Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + o) % q.options.length].id]));

const stamp = Date.now().toString(36).slice(-4);
let accountSeq = 0;

async function makeAccounts(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const res = await post('/api/auth/signup', {
      name: `V${stamp}${accountSeq++}`,
      age: 18,
      pin: '1111',
      answers: answersFor(accountSeq),
    });
    if (res.error) throw new Error(res.error);
    out.push(res);
  }
  return out;
}

const ask = (socket, event, payload) => new Promise((res) => socket.emit(event, payload, res));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\n  Playing all ${games.length} games over live sockets\n`);

const report = [];

for (const meta of games) {
  const players = Math.max(meta.minPlayers, 2);
  const row = { game: meta.id, players, states: 0, phases: new Set(), errors: [], private: false };

  try {
    const accounts = await makeAccounts(players);
    const sockets = accounts.map(() => io(URL, { transports: ['websocket'], reconnection: false }));
    await Promise.all(sockets.map((s) => new Promise((r) => s.once('connect', r))));

    // Collect everything the server sends, exactly as a client would.
    sockets.forEach((socket, i) => {
      socket.on('game:state', (s) => {
        row.states += 1;
        if (s.phase) row.phases.add(s.phase);
        // Non-mass games carry the private slice inline; mass games send it
        // separately on game:you. Either way we should get one.
        if (s.you) row.private = true;
        if (s.mode) row.mode = s.mode;
        if (s.mass) row.mass = true;
      });
      socket.on('game:you', () => (row.private = true));
      socket.on('game:over', () => (row.finished = true));
      socket.on('connect_error', (e) => row.errors.push(`socket ${i}: ${e.message}`));
    });

    const created = await ask(sockets[0], 'room:create', { gameId: meta.id, token: accounts[0].token });
    if (created.error) throw new Error(`create: ${created.error}`);
    row.code = created.code;

    for (let i = 1; i < sockets.length; i++) {
      const joined = await ask(sockets[i], 'room:join', { code: created.code, token: accounts[i].token });
      if (joined.error) throw new Error(`join: ${joined.error}`);
    }

    const started = await ask(sockets[0], 'room:start', {});
    if (started.error) throw new Error(`start: ${started.error}`);

    // Act like players: answer whatever we are shown.
    sockets.forEach((socket, i) => {
      let last = '';
      socket.on('game:state', (s) => {
        const key = `${s.round}:${s.phase}`;
        if (key === last) return;
        last = key;
        if (meta.id === 'battleship') {
          // Deploy, then fire at the first square nobody has shot yet.
          if (s.phase === 'place') return socket.emit('game:action', { type: 'ready' });
          if (s.phase === 'battle' && s.you?.isTurn) {
            const enemy = (s.seas ?? []).find((sea) => !sea.ally);
            if (!enemy) return;
            for (let r = 0; r < 10; r++) {
              for (let c = 0; c < 10; c++) {
                if (!enemy.shots[`${r},${c}`]) {
                  return socket.emit('game:action', { type: 'fire', targetId: enemy.id, r, c });
                }
              }
            }
          }
          return;
        }
        if (s.phase === 'intro') {
          // A match opens with the rules on screen; tapping Ready starts it.
          socket.emit('game:action', { type: 'ready' });
        } else if (s.phase === 'answer') {
          if (s.prompt?.options?.length) {
            socket.emit('game:action', { type: 'choice', optionId: s.prompt.options[i % s.prompt.options.length].id });
          } else if (s.mode === 'race') {
            socket.emit('game:action', { type: 'answer', text: 'guess' });
          } else {
            socket.emit('game:action', { type: 'answer', text: `answer ${i}` });
          }
        } else if (s.phase === 'vote') {
          const other = s.players?.find((p) => p.id !== accounts[i].profile.id) ?? s.answers?.[0];
          const target = other?.id ?? other?.playerId;
          if (target) socket.emit('game:action', { type: 'vote', targetId: target });
        } else if (s.phase === 'choose') {
          socket.emit('game:action', { type: 'answer', choice: 'dare' });
        } else if (s.phase === 'perform') {
          socket.emit('game:action', { type: 'done' });
        }
      });
    });

    await wait(WATCH_MS);
    for (const s of sockets) s.close();
  } catch (err) {
    row.errors.push(err.message);
  }

  // Party games run in phases and owe each player a private slice. Real-time
  // games (Orb Rush) have neither — they just stream shared world state — so
  // judging them by the party contract would fail a working game.
  row.realtime = meta.client !== '_party';
  row.ok = row.realtime
    ? row.states > 0 && !row.errors.length
    : row.states > 0 && row.private && row.phases.size > 0 && !row.errors.length;

  report.push(row);

  const tag = row.ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  const detail = row.errors.length
    ? row.errors[0]
    : row.realtime
      ? `${row.players}p · ${row.states} frames streamed · real-time`
      : `${row.players}p · ${row.states} states · phases: ${[...row.phases].join('→')}${row.mass ? ' · mass' : ''}`;
  console.log(`  ${tag}  ${meta.emoji} ${meta.name.padEnd(16)} ${detail}`);
}

const passed = report.filter((r) => r.ok).length;
console.log(`\n  ${passed}/${report.length} games played over live sockets\n`);
process.exit(passed === report.length ? 0 : 1);
