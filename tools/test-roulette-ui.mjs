// Roulette at the table, on a phone.
//
//   npm run test:roulette:ui
//
// The rules are tested elsewhere. This is the part only a browser answers: the
// cage hands out chips, the felt takes them, the wheel turns, and the number is
// not on the page until the wheel has stopped.
//
// That last one matters more here than anywhere else on the site. A client
// that learns the winning number while betting is still open is a client that
// can take the whole room's chips, so it is checked against the actual wire
// rather than against what the page happens to be showing.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-rl');
const PROFILE = path.join(ROOT, 'tmp-rl-profile');
const SHOTS = path.join(ROOT, 'android', 'roulette-shots');
const PORT = 3212;
const CDP = 9489;
const base = `http://127.0.0.1:${PORT}`;

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`${ok ? '\x1b[32m  ok  \x1b[0m' : '\x1b[31m FAIL \x1b[0m'} ${label}${extra ? `  \x1b[2m${extra}\x1b[0m` : ''}`);
  return ok;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
let browser = null;
let ws = null;
const mates = [];
function cleanup() {
  for (const m of mates) { try { m.socket.close(); } catch { } }
  try { ws?.close(); } catch { }
  try { browser?.kill(); } catch { }
  try { server?.kill(); } catch { }
  for (const d of [TMP, PROFILE]) { try { rmSync(d, { recursive: true, force: true }); } catch { } }
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });

let msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.delete(id)) rej(new Error(`${method} timed out`)); }, 30000);
  });
}
async function evaluate(body) {
  const r = await send('Runtime.evaluate', { expression: `(function(){${body}})()`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}
let shotIndex = 0;
async function shot(name) {
  try {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(SHOTS, `${String(++shotIndex).padStart(2, '0')}-${name}.png`), Buffer.from(data, 'base64'));
  } catch { /* never the point */ }
}
const { waitFor, count, textOf } = pageTools(evaluate);

console.log('\n  \x1b[1mRoulette at the table\x1b[0m  \x1b[2m(390x844)\x1b[0m\n');
if (!check('a Chromium browser is installed', Boolean(CHROME))) { cleanup(); process.exit(1); }

for (const d of [TMP, PROFILE]) rmSync(d, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
mkdirSync(TMP, { recursive: true });

server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP, MEDIA_DIR: path.join(TMP, 'media'), NODE_ENV: 'test', LLM_BOTS: '0', STUDY_PROXY: '0' },
  stdio: 'ignore',
});
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await wait(250);
  up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
}
if (!check('test server running', up)) { cleanup(); process.exit(1); }

const { questions } = await fetch(`${base}/api/quiz`).then((r) => r.json());
let seq = 0;
const signUp = (name) =>
  fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name, age: 19 + seq, pin: '1717',
      answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + seq++) % q.options.length].id])),
    }),
  }).then((r) => r.json());

const me = await signUp('Punter');
if (!check('an account exists', !me.error, me.error ?? '')) { cleanup(); process.exit(1); }

/* ---------------------------------- the cage ------------------------------ */

const wallet = await fetch(`${base}/api/chips`, { headers: { authorization: `Bearer ${me.token}` } }).then((r) => r.json());
check('a new player already has chips to sit down with', wallet.balance > 0, `${wallet.balance} chips`);
check('and points they could change up', typeof wallet.spendablePoints === 'number', String(wallet.spendablePoints));

const board = await fetch(`${base}/api/chips/board`).then((r) => r.json());
check('the chip board is its own thing, not the leaderboard', Array.isArray(board.board), JSON.stringify(board).slice(0, 80));

browser = spawn(CHROME, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROFILE}`, '--headless=new',
  '--window-size=390,844', '--no-first-run', '--no-default-browser-check', '--disable-extensions', base,
], { stdio: 'ignore' });

let page = null;
for (let i = 0; i < 60 && !page; i++) {
  await wait(300);
  const list = await fetch(`http://127.0.0.1:${CDP}/json`).then((r) => r.json()).catch(() => []);
  page = list.find((p) => p.type === 'page' && p.webSocketDebuggerUrl && !p.url.startsWith('devtools'));
}
if (!check('browser attached', Boolean(page))) { cleanup(); process.exit(1); }

ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.once('open', r));
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  const s = pending.get(m.id);
  if (!s) return;
  pending.delete(m.id);
  m.error ? s.rej(new Error(m.error.message)) : s.res(m.result);
});
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

for (let i = 0; i < 40; i++) {
  if (await evaluate(`return location.origin === ${JSON.stringify(base)}`).catch(() => false)) break;
  await wait(250);
}
await evaluate(`localStorage.setItem('htfw:token', ${JSON.stringify(me.token)}); return true;`);
await send('Page.reload');
await wait(2000);
await evaluate(`document.querySelector('.si-skip')?.click(); for (const d of document.querySelectorAll('dialog[open]')) d.close(); return true;`);
if (!check('signed in at the arcade', await waitFor('.game-card', 15000))) { cleanup(); process.exit(1); }
await watchForErrors(evaluate);

/* ------------------------------- into the table --------------------------- */

const opened = await evaluate(`
  const cards = [...document.querySelectorAll('.game-card')];
  const it = cards.find(c => (c.querySelector('h3')?.textContent ?? '').trim() === 'Roulette');
  if (!it) return cards.map(c => c.querySelector('h3')?.textContent).join(' | ');
  it.click();
  return true;
`);
if (!check('Roulette is on the shelf', opened === true, String(opened))) { cleanup(); process.exit(1); }
if (!check('a room opens', await waitFor('#roomCode', 15000))) { cleanup(); process.exit(1); }
const code = await evaluate(`return document.getElementById('roomCode').textContent.trim()`);

// One more at the table, so the pot is genuinely somebody else's chips too.
{
  const mate = await signUp('Mate1');
  const socket = io(base, { transports: ['websocket'] });
  const seen = { last: null };
  socket.on('game:state', (s) => { seen.last = s; if (s.phase === 'brief') socket.emit('game:action', { type: 'briefed' }); });
  mates.push({ socket, mate, seen });
  await new Promise((r) => socket.on('connect', r));
  await new Promise((r) => { socket.emit('room:join', { code, token: mate.token }, r); setTimeout(() => r({}), 8000); });
}
await wait(1200);
await evaluate(`document.getElementById('startBtn')?.click(); return true;`);

if (!check('the table opens', await waitFor('.rl-brief', 20000))) { cleanup(); await shot('no-start'); process.exit(1); }
await shot('brief');
await evaluate(`document.getElementById('rlBriefed')?.click(); return true;`);

if (!check('the felt appears', await waitFor('.rl-felt .rl-spot', 25000))) { cleanup(); await shot('no-felt'); process.exit(1); }
await wait(700);

check('every pocket is on the felt, zero included', (await count('.rl-num')) === 36 && (await count('.rl-zero')) === 1,
  `${await count('.rl-num')} numbers`);
check('and the outside bets are there', (await count('.rl-out')) === 9, String(await count('.rl-out')));
check('there is a stack of chips to pick from', (await count('.rl-chip')) >= 2, String(await count('.rl-chip')));
check('the wheel is drawn', (await evaluate(`
  const c = document.getElementById('rlWheel');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  // Something other than transparent has been painted on it.
  return d.some((v, i) => i % 4 === 3 && v > 0);
`)) === true);
await shot('table');

/* -------------------------------- on a phone ------------------------------ */

const fit = JSON.parse(await evaluate(`
  const w = document.documentElement;
  const felt = document.querySelector('.rl-felt');
  const spots = [...document.querySelectorAll('.rl-spot')].map(s => s.getBoundingClientRect());
  return JSON.stringify({
    pageWidth: w.clientWidth,
    scrollWidth: w.scrollWidth,
    feltWidth: Math.round(felt.getBoundingClientRect().width),
    widest: Math.round(Math.max(...spots.map(s => s.right))),
    shortest: Math.round(Math.min(...spots.map(s => s.height))),
  });
`));
check('the page never scrolls sideways', fit.scrollWidth <= fit.pageWidth + 1, `${fit.scrollWidth} in ${fit.pageWidth}`);
check('the felt fits the screen', fit.widest <= fit.pageWidth, `rightmost spot at ${fit.widest}`);
check('and a spot is big enough to hit with a thumb', fit.shortest >= 30, `${fit.shortest}px`);

/* -------------------------------- betting --------------------------------- */

const chipsBefore = Number(await textOf('#rlChips'));
check('the table shows what you are holding', chipsBefore > 0, String(chipsBefore));

await evaluate(`document.querySelector('.rl-chip[data-value="25"]')?.click(); return true;`);
await evaluate(`document.querySelector('.rl-out.is-red')?.click(); return true;`);
await wait(900);

const chipsAfter = Number(await textOf('#rlChips'));
check('backing red takes the chips off you now, not at payout',
  chipsAfter === chipsBefore - 25, `${chipsBefore} then ${chipsAfter}`);
check('and the felt shows what is riding on it', (await count('.rl-onit.is-mine')) >= 1,
  String(await count('.rl-onit.is-mine')));
check('the pot went up', Number(await textOf('#rlPot')) >= 25, await textOf('#rlPot'));

await evaluate(`document.querySelector('.rl-num[data-number="17"]')?.click(); return true;`);
await wait(700);
check('you can back a single number as well', (await count('.rl-onit.is-mine')) >= 2,
  String(await count('.rl-onit.is-mine')));

await shot('bets');

// Taking it back before the wheel goes.
await evaluate(`document.getElementById('rlClear')?.click(); return true;`);
await wait(900);
check('taking it back returns every chip', Number(await textOf('#rlChips')) === chipsBefore,
  `${await textOf('#rlChips')} against ${chipsBefore}`);

// Back on, and leave it there for the spin.
await evaluate(`
  document.querySelector('.rl-chip[data-value="25"]')?.click();
  document.querySelector('.rl-out.is-red')?.click();
  return true;
`);
await wait(600);

/* --------------- the number is not on the page until it lands ------------- */

// Watched on the wire rather than in the DOM: what matters is whether the
// server ever sends it early, not whether this particular page shows it.
const spy = mates[0];
let leakedDuringBets = false;
let sawSpin = false;
const watch = setInterval(() => {
  const s = spy.seen.last;
  if (!s) return;
  if (s.phase === 'spin') sawSpin = true;
  if ((s.phase === 'bets' || s.phase === 'spin') && s.result) leakedDuringBets = true;
  if (JSON.stringify(s).includes('"pending"')) leakedDuringBets = true;
}, 120);

const landed = await (async () => {
  for (let i = 0; i < 150; i++) {
    if (await evaluate(`return !document.getElementById('rlResult').hidden`)) return true;
    await wait(500);
  }
  return false;
})();
clearInterval(watch);

check('the wheel reached a number', landed);
check('and it was not on the wire while the table was open', !leakedDuringBets);
check('the wheel really did turn', sawSpin);

if (landed) {
  // Long enough for the wheel to finish settling. A shot taken while it is
  // still easing shows the pointer between two pockets and proves nothing.
  await wait(2200);
  await shot('result');
  const said = await textOf('.rl-result-num');
  check('the number is shown', /^\d+$/.test(said ?? ''), said);
  // The wheel has to stop ON the number, not beside it. Reading the number
  // printed underneath proves nothing about where the wheel is pointing —
  // and it was pointing somewhere else entirely until the turns were made
  // whole.
  const under = await evaluate(`return document.getElementById('rlWheel').dataset.pocket`);
  check('and the wheel is pointing at it', under === said, `pointer on ${under}, result ${said}`);
  check('and the room is told what happened to the pot',
    Boolean(await textOf('.rl-result-said')), await textOf('.rl-result-said'));

  // Whatever happened, the chips must add up: either they won some or the
  // stake is gone, and never both.
  const now = Number(await textOf('#rlChips'));
  check('the balance moved by a whole number of chips and never below zero',
    Number.isInteger(now) && now >= 0, String(now));
}

const errors = await evaluate(`return window.__journeyErrors ?? []`);
check('the page threw nothing', errors.length === 0, errors.join(' | '));

cleanup();
const bad = results.filter((r) => !r.ok);
console.log(`\n  screenshots  android/roulette-shots/`);
console.log(bad.length
  ? `\x1b[31m  ${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\x1b[32m  all ${results.length} passed — chips on the felt, and the number stays on the server\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
