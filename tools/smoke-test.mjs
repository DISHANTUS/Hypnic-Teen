// End-to-end check: membership (quiz -> Hypnic ID -> login) plus a real match
// between two accounts, with points, titles and the leaderboard verified.
//
// Run against a throwaway data dir so it never touches the real studio:
//   DATA_DIR=./tmp-test PORT=3100 node server/index.js
//   URL=http://localhost:3100 node tools/smoke-test.mjs
import { io } from 'socket.io-client';

// No default target on purpose. This test signs up accounts and plays matches,
// so pointing it at the studio people actually use would fill it with junk.
// Requiring URL makes you say which server you mean.
if (!process.env.URL) {
  console.error(`
  Set URL to a throwaway server — this test creates real accounts.

    DATA_DIR=./tmp-test PORT=3100 node server/index.js
    URL=http://localhost:3100 npm run smoke
`);
  process.exit(1);
}
const URL = process.env.URL;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (label, ok, extra = '') => {
  results.push(ok);
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` - ${extra}` : ''}`);
};

const once = (socket, event, timeout = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const request = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

const post = async (path, body) => {
  const res = await fetch(`${URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
};

const get = async (path, token) =>
  (await fetch(`${URL}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })).json();

console.log(`\n  Smoke testing ${URL}\n`);

/* ------------------------------ catalogue ------------------------------- */

const catalogue = await get('/api/games');
check('GET /api/games returns the catalogue', Array.isArray(catalogue) && catalogue.length > 0, `${catalogue.length} game(s)`);

const { questions } = await get('/api/quiz');
check('GET /api/quiz returns the onboarding questions', Array.isArray(questions) && questions.length >= 4, `${questions.length} questions`);
check(
  'quiz answers never leak their scoring data',
  questions.every((q) => q.options.every((o) => Object.keys(o).sort().join() === 'id,label'))
);

/* ------------------------------ membership ------------------------------ */

const stamp = Date.now().toString(36).slice(-4);
const answersFor = (offset) =>
  Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + offset) % q.options.length].id]));

const alice = await post('/api/auth/signup', {
  name: `Ana${stamp}`,
  age: 17,
  pin: '1234',
  answers: answersFor(0),
});
check('signup mints a Hypnic ID', /^Hypnic>[A-Za-z0-9]+<Teen$/.test(alice.profile?.id ?? ''), alice.profile?.id);
check('profile carries a derived spirit and accent', Boolean(alice.profile?.spirit && alice.profile?.accent), `${alice.profile?.spirit} / ${alice.profile?.accent}`);
check('PIN material never reaches the client', !('pinHash' in (alice.profile ?? {})) && !('pinSalt' in (alice.profile ?? {})));

const bob = await post('/api/auth/signup', {
  name: `Bo${stamp}`,
  age: 19,
  pin: '5678',
  answers: answersFor(2),
});
check('a second teen gets a different ID', Boolean(bob.profile?.id) && bob.profile.id !== alice.profile.id, bob.profile?.id);

const shortPin = await post('/api/auth/signup', { name: 'Nope', age: 15, pin: '12', answers: answersFor(1) });
check('a bad PIN is rejected at signup', Boolean(shortPin.error), shortPin.error);

const badAge = await post('/api/auth/signup', { name: 'Nope', age: 200, pin: '1234', answers: answersFor(1) });
check('a nonsense age is rejected', Boolean(badAge.error), badAge.error);

const wrongPin = await post('/api/auth/login', { id: alice.profile.id, pin: '0000' });
check('wrong PIN cannot sign in', Boolean(wrongPin.error), wrongPin.error);

const keywordOnly = alice.profile.id.replace('Hypnic>', '').replace('<Teen', '');
const relogin = await post('/api/auth/login', { id: keywordOnly, pin: '1234' });
check('login works with just the keyword', relogin.profile?.id === alice.profile.id);

const meNoToken = await get('/api/me');
check('/api/me refuses anonymous callers', Boolean(meNoToken.error));

const me = await get('/api/me', alice.token);
check('/api/me returns the profile for a valid token', me.profile?.id === alice.profile.id);

/* -------------------------------- match --------------------------------- */

const host = io(URL, { transports: ['websocket'] });
const guest = io(URL, { transports: ['websocket'] });
await Promise.all([once(host, 'connect'), once(guest, 'connect')]);
check('both clients connected over websocket', host.connected && guest.connected);

const unauth = await request(host, 'room:create', { gameId: 'orb-rush', token: 'garbage' });
check('a forged token cannot open a room', Boolean(unauth.error), unauth.error);

const created = await request(host, 'room:create', { gameId: 'orb-rush', token: alice.token });
check('host created a room', Boolean(created.code), created.code);

let hostRoomState = null;
host.on('room:state', (state) => (hostRoomState = state));

const joined = await request(guest, 'room:join', { code: created.code, token: bob.token });
check('guest joined by code', joined.ok === true);

await wait(200);
check('room shows both players', hostRoomState?.players.length === 2, hostRoomState?.players.map((p) => p.name).join(', '));
check('lobby shows studio identity', hostRoomState?.players.every((p) => p.level >= 1 && p.accent));

const rejected = await request(guest, 'room:start', {});
check('non-host cannot start the game', Boolean(rejected.error), rejected.error);

const startPromise = once(guest, 'game:start');
const started = await request(host, 'room:start', {});
await startPromise;
check('host started the game', started.ok === true);

const first = await once(guest, 'game:state');
check('server is broadcasting game state', Array.isArray(first.players) && first.players.length === 2);

const before = first.players.find((p) => p.id === bob.profile.id);
guest.emit('game:action', { type: 'move', dx: 1, dy: 0 });
await wait(600);
const later = await once(guest, 'game:state');
const moved = later.players.find((p) => p.id === bob.profile.id);
check('input moves the player server-side', moved.x > before.x, `x ${before.x} -> ${moved.x}`);

guest.emit('game:action', { type: 'move', dx: 50, dy: 50 }); // cheat attempt
await wait(500);
const cheatFrame = await once(guest, 'game:state');
const cheater = cheatFrame.players.find((p) => p.id === bob.profile.id);
check('oversized input vectors are clamped', cheater.x <= cheatFrame.world.w && cheater.y <= cheatFrame.world.h);

const chatPromise = once(host, 'chat:message');
guest.emit('chat:send', 'hello from the smoke test');
const chat = await chatPromise;
check('chat relays to the room', chat.text === 'hello from the smoke test');

/* ----------------------- finish the match & rewards --------------------- */

console.log('\n  …letting the 60s round finish\n');
const rewardPromise = once(guest, 'profile:reward', 75_000);
const over = await once(guest, 'game:over', 75_000);
check('match ended with a result table', Array.isArray(over.results) && over.results.length === 2);

const reward = await rewardPromise;
check('points were awarded', reward.pointsEarned > 0, `+${reward.pointsEarned}`);
check('titles were unlocked', reward.newTitles.length > 0, reward.newTitles.map((t) => `${t.emoji} ${t.name}`).join(', '));
check('the Rookie title is among them', reward.newTitles.some((t) => t.id === 'rookie'));
check('profile points persisted', reward.profile.points === reward.pointsEarned);

const board = await get('/api/leaderboard');
check('leaderboard lists the players', board.length >= 2, board.slice(0, 2).map((r) => `${r.name}:${r.value}`).join(', '));
check('leaderboard is sorted high to low', board.every((r, i) => i === 0 || board[i - 1].value >= r.value));

const gameBoard = await get(`/api/leaderboard?gameId=orb-rush&sort=best`);
check('per-game leaderboard works', gameBoard.length >= 2 && gameBoard[0].value >= gameBoard[1].value);

const persisted = await get('/api/me', alice.token);
check('stats survive on the profile', persisted.profile.gamesPlayed === 1 && persisted.profile.stats['orb-rush']?.plays === 1);

host.close();
guest.close();

const passed = results.filter(Boolean).length;
console.log(`\n  ${passed}/${results.length} checks passed\n`);
process.exit(passed === results.length ? 0 : 1);
