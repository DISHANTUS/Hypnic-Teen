// Checks the "call everyone" invite over real sockets.
//
//   URL=http://localhost:3100 node tools/test-invite.mjs
//
// Three players: a host, someone already in the room, and a bystander. Only the
// bystander should hear the shout — and only the host should be able to shout.

import { io } from 'socket.io-client';

const URL = process.env.URL;
if (!URL) {
  console.error('\n  Set URL to a throwaway server — this creates accounts.\n');
  process.exit(1);
}

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));

const { questions } = await (await fetch(`${URL}/api/quiz`)).json();
const stamp = Date.now().toString(36).slice(-4);
let seq = 0;

async function player(name) {
  const account = await (
    await fetch(`${URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `${name}${stamp}`,
        age: 18,
        pin: '1111',
        answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + seq) % q.options.length].id])),
      }),
    })
  ).json();
  seq += 1;
  if (account.error) throw new Error(`${name}: ${account.error}`);

  const socket = io(URL, { transports: ['websocket'], reconnection: false });
  const invites = [];
  const seen = {};
  // Attached before the connect handshake resolves — the server sends the build
  // stamp the moment it accepts us, so a later listener would miss it.
  socket.on('invite:new', (i) => invites.push(i));
  socket.on('app:version', (v) => (seen.version = v));
  await new Promise((r) => socket.once('connect', r));
  return { account, socket, invites, seen };
}

console.log('\n  Room invites\n');

const host = await player('Host');
const seated = await player('Seated');
const bystander = await player('Bystander');

const room = await ask(host.socket, 'room:create', { gameId: 'quiz', token: host.account.token });
check('host opens a room', !room.error, room.code ?? room.error);

const joined = await ask(seated.socket, 'room:join', { code: room.code, token: seated.account.token });
check('a second player sits down', !joined.error, joined.error ?? 'in');

// Someone who is not the host must not be able to spam the whole site.
const notHost = await ask(seated.socket, 'room:invite', {});
check('a non-host cannot call everyone', Boolean(notHost?.error), notHost?.error ?? 'it let them!');

const called = await ask(host.socket, 'room:invite', {});
check('the host can call everyone', !called?.error, called?.error ?? 'sent');
// Host and seated are in the room; only the bystander is reachable.
check('the host is told how many it reached', called?.reached === 1, `reached ${called?.reached}`);

await wait(600);
check('the bystander hears it', bystander.invites.length === 1, `${bystander.invites.length} received`);
check('people already in the room do not', seated.invites.length === 0, `${seated.invites.length} received`);
check('the host does not get their own shout', host.invites.length === 0, `${host.invites.length} received`);

const shout = bystander.invites[0];
if (shout) {
  check('the invite says who and what', shout.host.startsWith('Host') && shout.game === 'Quiz', `${shout.host} · ${shout.game}`);
  check('the invite carries the room code', shout.code === room.code, shout.code);
  check('the invite says how many are waiting', shout.players === 2, `${shout.players}`);
}

// Back-to-back shouts are the fastest way to make people mute you.
const again = await ask(host.socket, 'room:invite', {});
check('a second shout straight away is refused', Boolean(again?.error), again?.error ?? 'it went through');

// And the offer has to actually work.
const accepted = await ask(bystander.socket, 'room:join', { code: shout?.code, token: bystander.account.token });
check('accepting the invite gets you in', !accepted?.error, accepted?.error ?? 'joined');

/* --------------------------- hopping between rooms ------------------------ */

// Accepting an invite while already seated somewhere is the normal case, not
// the edge case — the room you leave must stop counting you.
{
  const hopper = await player('Hopper');
  const first = await ask(hopper.socket, 'room:create', { gameId: 'quiz', token: hopper.account.token });

  let firstRoom = null;
  hopper.socket.on('room:state', (r) => {
    if (r.code === first.code) firstRoom = r;
  });
  await wait(400);

  const second = await ask(hopper.socket, 'room:join', { code: room.code, token: hopper.account.token });
  check('you can hop straight into another room', !second?.error, second?.error ?? 'hopped');
  await wait(600);

  const stillSeated = (firstRoom?.players ?? []).filter((p) => p.connected).length;
  check('the room you left stops counting you', stillSeated === 0, `${stillSeated} still seated there`);
  hopper.socket.close();
}

/* ------------------------- shouting into an empty room -------------------- */

// The host has to be able to tell "five people heard me" from "nobody did".
{
  const alone = await player('Alone');
  const own = await ask(alone.socket, 'room:create', { gameId: 'quiz', token: alone.account.token });
  // Close everyone else so this really is an empty site.
  for (const p of [host, seated, bystander]) p.socket.close();
  await wait(500);

  const shouted = await ask(alone.socket, 'room:invite', {});
  check('shouting with nobody around reports zero', shouted?.reached === 0, `reached ${shouted?.reached}`);
  check('it is still not an error', !shouted?.error, shouted?.error ?? String(own.code));
  alone.socket.close();
}

/* ------------------------------ build stamp ------------------------------- */

{
  const watcher = await player('Watcher');
  await wait(400);
  const build = watcher.seen.version?.build;
  check('the server tells clients which build they are on', Boolean(build), build ?? 'never sent');
  watcher.socket.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n  ${passed}/${results.length} checks passed\n`);
process.exit(passed === results.length ? 0 : 1);
