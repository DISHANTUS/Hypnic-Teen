// Stands up a live party game and holds it open so you can look at the real UI
// in a browser (or the dev harness).
//
//   DATA_DIR=./tmp-demo PORT=3100 node server/index.js
//   URL=http://localhost:3100 node tools/seed-party.mjs imposter
//
// Prints a room code and a session token. Open:
//   /_dev/harness.html?r=%23/room/<CODE>&w=412&token=<token>
//
// The bot players answer and vote on their own, so the room walks through every
// phase while you watch.

import { io } from 'socket.io-client';

const URL = process.env.URL || 'http://localhost:3100';
const GAME = process.argv[2] || 'imposter';
const BOTS = ['Meera', 'Rahul', 'Sana', 'Kiran'];

const post = async (path, body) =>
  (
    await fetch(URL + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json();

const { questions } = await (await fetch(URL + '/api/quiz')).json();
const answersFor = (o) =>
  Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + o) % q.options.length].id]));

const stamp = Date.now().toString(36).slice(-3);
const accounts = [];
for (const [i, name] of ['You', ...BOTS].entries()) {
  const res = await post('/api/auth/signup', {
    name: `${name}${stamp}`,
    age: 18,
    pin: '1111',
    answers: answersFor(i),
  });
  if (res.error) throw new Error(`${name}: ${res.error}`);
  accounts.push(res);
}

const sockets = accounts.map(() => io(URL, { transports: ['websocket'] }));
await Promise.all(sockets.map((s) => new Promise((r) => s.once('connect', r))));
const ask = (socket, event, payload) => new Promise((res) => socket.emit(event, payload, res));

const { code, error } = await ask(sockets[0], 'room:create', { gameId: GAME, token: accounts[0].token });
if (error) throw new Error(error);
for (let i = 1; i < sockets.length; i++) {
  await ask(sockets[i], 'room:join', { code, token: accounts[i].token });
}

// Bots play on their own so the room keeps moving through phases.
const LINES = ['Cheesy and warm', 'Reminds me of home', 'Honestly overrated', 'Ten out of ten'];
sockets.forEach((socket, i) => {
  if (i === 0) return; // seat 0 is yours — leave it for the browser
  let lastKey = '';
  socket.on('game:state', (s) => {
    const key = `${s.round}:${s.phase}`;
    if (key === lastKey) return;
    lastKey = key;

    if (s.phase === 'answer') {
      if (s.prompt?.options?.length) {
        socket.emit('game:action', { type: 'choice', optionId: s.prompt.options[0].id });
      } else if (s.mode === 'race') {
        socket.emit('game:action', { type: 'answer', text: 'not a clue' });
      } else {
        socket.emit('game:action', { type: 'answer', text: LINES[i % LINES.length] });
      }
    } else if (s.phase === 'vote') {
      const target = s.players.find((p) => p.id !== accounts[i].profile.id);
      if (target) socket.emit('game:action', { type: 'vote', targetId: target.id });
    } else if (s.phase === 'perform') {
      socket.emit('game:action', { type: 'done' });
    } else if (s.phase === 'choose' && s.turnPlayerId === accounts[i].profile.id) {
      socket.emit('game:action', { type: 'answer', choice: 'dare' });
    }
  });
});

await ask(sockets[0], 'room:start', {});

console.log(`\n  game   ${GAME}`);
console.log(`  room   ${code}`);
console.log(`  token  ${accounts[0].token}`);
console.log(`\n  /_dev/harness.html?r=%23/room/${code}&w=412&token=${accounts[0].token}\n`);
console.log('  Holding the room open. Ctrl+C to stop.\n');

process.on('SIGINT', () => {
  for (const s of sockets) s.close();
  process.exit(0);
});
