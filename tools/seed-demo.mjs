// Fills a studio with a few members and one finished match, so the signed-in
// screens have real data to look at. Point it at a throwaway server — never
// your real one.
//
//   DATA_DIR=./tmp-demo PORT=3100 node server/index.js
//   URL=http://localhost:3100 node tools/seed-demo.mjs
//
// Prints the first member's session token, which the dev harness can use:
//   /_dev/harness.html?r=%23/profile&token=<token>

import { io } from 'socket.io-client';

const URL = process.env.URL || 'http://localhost:3100';

const post = async (path, body) =>
  (
    await fetch(URL + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json();

const { questions } = await (await fetch(URL + '/api/quiz')).json();
const answersFor = (offset) =>
  Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + offset) % q.options.length].id]));

const people = [
  ['Advay', 17, '1111'],
  ['Meera', 18, '2222'],
  ['Rahul', 16, '3333'],
  ['Sana', 19, '4444'],
];

const accounts = [];
for (const [i, [name, age, pin]] of people.entries()) {
  const res = await post('/api/auth/signup', { name, age, pin, answers: answersFor(i) });
  if (res.error) throw new Error(`${name}: ${res.error}`);
  accounts.push(res);
  console.log(`  ${name.padEnd(6)} ${res.profile.id}  (PIN ${pin})`);
}

const sockets = accounts.map(() => io(URL, { transports: ['websocket'] }));
await Promise.all(sockets.map((s) => new Promise((r) => s.once('connect', r))));

const ask = (socket, event, payload) => new Promise((res) => socket.emit(event, payload, res));

const { code } = await ask(sockets[0], 'room:create', { gameId: 'orb-rush', token: accounts[0].token });
for (let i = 1; i < sockets.length; i++) {
  await ask(sockets[i], 'room:join', { code, token: accounts[i].token });
}
await ask(sockets[0], 'room:start', {});
console.log(`\n  playing one round in room ${code}…`);

const finished = new Promise((r) => sockets[0].once('game:over', r));
// Each player sweeps a different path so the scores end up different.
const drive = setInterval(() => {
  sockets.forEach((s, i) =>
    s.emit('game:action', {
      type: 'move',
      dx: Math.cos(i * 1.7 + Date.now() / 700),
      dy: Math.sin(i * 2.3 + Date.now() / 900),
    })
  );
}, 120);

await finished;
clearInterval(drive);
for (const s of sockets) s.close();

console.log(`\n  seeded. token for ${accounts[0].profile.name}:\n\n${accounts[0].token}\n`);
