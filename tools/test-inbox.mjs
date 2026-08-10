// Answering people, and saying something to the room.
//
//   npm run test:inbox
//
// Two things that had no way to happen at all. Feedback arrived with a Hypnic
// ID attached and no name, so the owner could read a complaint and not know
// who they were answering — and there was no way to answer it. Notices could
// only be posted by calling the API by hand, which in practice meant nothing
// was ever announced.
//
// The part that most needs a test is the private one: a reply to somebody's
// bug report must reach them and nobody else. Getting that wrong is not a
// layout bug, it is showing one person's words to the whole room.
//
// The server is started twice on purpose. The owner is whoever OWNER_ID names,
// and signup assigns the IDs — so the first run exists to mint an account, and
// the second names it. That is also exactly what a real owner does: sign up,
// then paste their ID into START-ONLINE.cmd.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-inbox');
const PORT = 3206;
const base = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`${ok ? '\x1b[32m  ok  \x1b[0m' : '\x1b[31m FAIL \x1b[0m'} ${label}${extra ? `  \x1b[2m${extra}\x1b[0m` : ''}`);
  return ok;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
const sockets = [];
function cleanup() {
  for (const s of sockets) { try { s.close(); } catch { } }
  try { server?.kill(); } catch { }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { }
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function start(ownerId) {
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT), DATA_DIR: TMP, MEDIA_DIR: path.join(TMP, 'media'),
      NODE_ENV: 'test', LLM_BOTS: '0', STUDY_PROXY: '0',
      OWNER_ID: ownerId ?? '',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 80; i++) {
    await wait(250);
    if (await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false)) return true;
  }
  return false;
}
async function stop() {
  server?.kill();
  server = null;
  // The port has to be free before the next one binds it.
  for (let i = 0; i < 40; i++) {
    await wait(250);
    if (!(await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false))) return;
  }
}

console.log('\n  \x1b[1mAnswering people\x1b[0m\n');

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

if (!check('test server running', await start(null))) { cleanup(); process.exit(1); }

/* ------------------------------- three people ----------------------------- */

const { questions } = await fetch(`${base}/api/quiz`).then((r) => r.json());
let seq = 0;
const signUp = (name) =>
  fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name, age: 19 + seq, pin: '5150',
      answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + seq++) % q.options.length].id])),
    }),
  }).then((r) => r.json());

// signup answers { profile, token } — the ID lives on profile, not the top
// level. Reading account.id gives undefined, which then compares equal to
// another undefined and makes an assertion pass while proving nothing.
const flatten = (a) => (a.error ? a : { id: a.profile.id, name: a.profile.name, token: a.token });
const owner = flatten(await signUp('TheOwner'));
const reporter = flatten(await signUp('Reporter'));
const bystander = flatten(await signUp('Bystander'));
if (!check('three members exist', !owner.error && !reporter.error && !bystander.error, owner.error ?? '')) {
  cleanup();
  process.exit(1);
}

// Now name one of them the owner, the way START-ONLINE.cmd does.
await stop();
if (!check('the studio restarts knowing who owns it', await start(owner.id), owner.id)) { cleanup(); process.exit(1); }

const asOwner = (path, init = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}`, ...(init.headers ?? {}) },
  });

/* ------------------------- feedback carries a name ------------------------ */

const said = await fetch(`${base}/api/feedback`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    text: 'The lobby button did nothing after the match',
    kind: 'bug',
    from: reporter.id,
    fromName: reporter.name,
    where: '#/room/AB12',
  }),
}).then((r) => r.json());
check('a report is accepted', said.ok === true, JSON.stringify(said).slice(0, 120));

const pile = await asOwner('/api/feedback').then((r) => r.json());
const note = pile.items?.[0];
check('the owner can read it', Boolean(note), JSON.stringify(pile).slice(0, 120));
check('it says who sent it, by name and by ID',
  Boolean(note?.fromName) && note.fromName === reporter.name && note.from === reporter.id,
  `${note?.fromName} / ${note?.from}`);
check('and which screen they were on', note?.where === '#/room/AB12', note?.where);

/* ------------------------------- owner only ------------------------------- */

for (const [what, res] of [
  ['read the pile', await fetch(`${base}/api/feedback`, { headers: { authorization: `Bearer ${bystander.token}` } })],
  ['list everybody', await fetch(`${base}/api/members`, { headers: { authorization: `Bearer ${bystander.token}` } })],
  ['post a notice', await fetch(`${base}/api/notices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bystander.token}` },
    body: JSON.stringify({ title: 'Hello', body: 'everyone' }),
  })],
]) {
  check(`an ordinary member cannot ${what}`, res.status === 403, `status ${res.status}`);
}

const members = await asOwner('/api/members').then((r) => r.json());
check('the owner gets the member list, with names', members.members?.length === 3, JSON.stringify(members.members?.map((m) => m.name)));

/* ------------- the reply reaches the reporter, and nobody else ------------ */

// Two members with the site open, the way two tabs would be.
const connect = (token) =>
  new Promise((resolve) => {
    const s = io(base, { transports: ['websocket'] });
    sockets.push(s);
    const heard = [];
    s.on('notice:new', (n) => heard.push(n));
    // 'hello', not 'auth'. A wrong event name here does not fail — the server
    // simply never acks, and the test hangs forever with no output at all.
    s.on('connect', () => s.emit('hello', { token }, () => resolve({ heard })));
    setTimeout(() => resolve({ heard, timedOut: true }), 8000);
  });

const theirTab = await connect(reporter.token);
const otherTab = await connect(bystander.token);
await wait(600);

const replied = await asOwner(`/api/feedback/${note.id}`, {
  method: 'POST',
  body: JSON.stringify({ reply: 'Fixed — try it now, and thank you for saying.' }),
}).then((r) => r.json());
check('the owner can reply', replied.ok === true, JSON.stringify(replied).slice(0, 140));
check('the reply is recorded against the report', replied.item?.replies?.length === 1, JSON.stringify(replied.item?.replies));
check('answering it marks it read', replied.item?.read === true);

await wait(900);
check('it arrives in their notifications, live',
  theirTab.heard.some((n) => n.body?.includes('Fixed — try it now')),
  JSON.stringify(theirTab.heard.map((n) => n.title)));
check('and nobody else hears it',
  otherTab.heard.length === 0,
  `the bystander heard ${JSON.stringify(otherTab.heard.map((n) => n.title))}`);

// And on a fresh load, not only over the live socket.
const boardFor = (token) => fetch(`${base}/api/notices`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
const theirs = await boardFor(reporter.token);
const others = await boardFor(bystander.token);
check('it is on their board when they come back',
  theirs.notices.some((n) => n.body?.includes('Fixed — try it now')),
  JSON.stringify(theirs.notices.map((n) => n.title)));
check('it is never on anybody else\'s',
  !others.notices.some((n) => n.body?.includes('Fixed — try it now')),
  JSON.stringify(others.notices.map((n) => n.title)));
check('the reply quotes what they said, so it makes sense on its own',
  theirs.notices.some((n) => n.body?.includes('lobby button')));

/* ------------------------ announcing to everybody ------------------------- */

const shout = await asOwner('/api/notices', {
  method: 'POST',
  body: JSON.stringify({ title: 'Server down at nine', body: 'Back in twenty minutes.', kind: 'maintenance' }),
}).then((r) => r.json());
check('the owner can announce to everyone', shout.ok === true, JSON.stringify(shout).slice(0, 120));

await wait(900);
check('everybody hears an announcement',
  otherTab.heard.some((n) => n.title === 'Server down at nine') &&
  theirTab.heard.some((n) => n.title === 'Server down at nine'));

/* -------------------- and one addressed to a single person ---------------- */

const whisper = await asOwner('/api/notices', {
  method: 'POST',
  body: JSON.stringify({ title: 'Just for you', body: 'You are top of the table this week.', kind: 'reward', to: bystander.id }),
}).then((r) => r.json());
check('the owner can write to one person', whisper.ok === true, JSON.stringify(whisper).slice(0, 120));

await wait(900);
const afterA = await boardFor(reporter.token);
const afterB = await boardFor(bystander.token);
check('it reaches the one it names', afterB.notices.some((n) => n.title === 'Just for you'));
check('and not the other', !afterA.notices.some((n) => n.title === 'Just for you'));

cleanup();
const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n\x1b[31m  ${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n\x1b[32m  all ${results.length} passed — a reply reaches one person, an announcement reaches the room\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
