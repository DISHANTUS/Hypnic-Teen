// A hand of Hold'em, on a phone.
//
//   npm run test:holdem:ui
//
// The rules are tested elsewhere. This is the part only a browser answers:
// cards on the table, buttons that offer exactly what is legal, and — the one
// that matters most at a poker table — your two cards on your screen and
// nobody else's on it.
//
// The opponents are real sockets, because a page cannot leak somebody else's
// hole cards to itself.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-he');
const PROFILE = path.join(ROOT, 'tmp-he-profile');
const SHOTS = path.join(ROOT, 'android', 'holdem-shots');
const PORT = 3214;
const CDP = 9491;
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

console.log('\n  \x1b[1mA hand of Hold\'em\x1b[0m  \x1b[2m(390x844)\x1b[0m\n');
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
      name, age: 19 + seq, pin: '2929',
      answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + seq++) % q.options.length].id])),
    }),
  }).then((r) => r.json());

const me = await signUp('Shark');
if (!check('an account exists', !me.error, me.error ?? '')) { cleanup(); process.exit(1); }

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

/* -------------------------------- to the table ---------------------------- */

const opened = await evaluate(`
  const cards = [...document.querySelectorAll('.game-card')];
  const it = cards.find(c => (c.querySelector('h3')?.textContent ?? '').trim().startsWith('Texas'));
  if (!it) return cards.map(c => c.querySelector('h3')?.textContent).join(' | ');
  it.click();
  return true;
`);
if (!check("Texas Hold'em is on the shelf", opened === true, String(opened))) { cleanup(); process.exit(1); }
if (!check('a room opens', await waitFor('#roomCode', 15000))) { cleanup(); process.exit(1); }
const code = await evaluate(`return document.getElementById('roomCode').textContent.trim()`);

// Two more, so there is a real table and a real pot.
for (const name of ['Fish1', 'Fish2']) {
  const mate = await signUp(name);
  const socket = io(base, { transports: ['websocket'] });
  const seen = { last: null };
  socket.on('game:state', (s) => {
    seen.last = s;
    if (s.phase === 'brief') socket.emit('game:action', { type: 'briefed' });
    // They call anything, so the hand keeps moving without this test driving
    // three players by hand.
    if (s.phase === 'play' && s.turnId === mate.profile.id && s.you?.can) {
      setTimeout(() => socket.emit('game:action', { type: s.you.can.check ? 'check' : 'call' }), 500);
    }
  });
  mates.push({ socket, mate, seen });
  await new Promise((r) => socket.on('connect', r));
  await new Promise((r) => { socket.emit('room:join', { code, token: mate.token }, r); setTimeout(() => r({}), 8000); });
}
await wait(1200);
await evaluate(`document.getElementById('startBtn')?.click(); return true;`);

if (!check('the table opens', await waitFor('.he-brief', 20000))) { cleanup(); await shot('no-start'); process.exit(1); }
await shot('brief');
await evaluate(`document.getElementById('heBriefed')?.click(); return true;`);

if (!check('cards are dealt', await waitFor('.he-hole .he-card', 25000))) { cleanup(); await shot('no-deal'); process.exit(1); }
await wait(900);
await shot('dealt');

/* ------------------------------ what you can see -------------------------- */

check('you have two cards', (await count('.he-hole .he-card')) === 2, String(await count('.he-hole .he-card')));
check('and they are face up',
  (await count('.he-hole .he-card.is-back')) === 0, `${await count('.he-hole .he-card.is-back')} face down`);
check('there is a seat for everybody', (await count('.he-seat')) === 3, String(await count('.he-seat')));

// The one that matters at a poker table.
const others = await evaluate(`
  const mine = [...document.querySelectorAll('.he-hole .he-card')].map(c => c.textContent);
  const seats = [...document.querySelectorAll('.he-seat')];
  const youSeat = seats.find(s => s.classList.contains('is-you'));
  const rest = seats.filter(s => s !== youSeat);
  return JSON.stringify({
    mine,
    othersFaceUp: rest.reduce((n, s) => n + s.querySelectorAll('.he-card:not(.is-back)').length, 0),
    othersBacks: rest.reduce((n, s) => n + s.querySelectorAll('.he-card.is-back').length, 0),
  });
`);
const seenCards = JSON.parse(others);
check('nobody else\'s cards are face up', seenCards.othersFaceUp === 0, others);
check('they are showing backs instead', seenCards.othersBacks === 4, others);

// And the wire itself carries no card codes for anybody but you.
const spy = mates[0];
const wire = JSON.stringify(spy.seen.last ?? {});
const mineOnWire = (spy.seen.last?.players ?? []).filter((p) => p.id !== spy.mate.profile.id && p.cards.some((c) => c !== '??'));
check('and the server never sends them either', mineOnWire.length === 0, JSON.stringify(mineOnWire).slice(0, 120));
check('the deck is not on the wire', !wire.includes('"deck"'));

/* ------------------------------- the buttons ------------------------------ */

const acted = await (async () => {
  for (let i = 0; i < 60; i++) {
    if (await evaluate(`return document.querySelectorAll('.he-acts .btn').length > 0`)) return true;
    await wait(500);
  }
  return false;
})();
check('when it is your turn there are buttons', acted);

if (acted) {
  const buttons = await evaluate(`return [...document.querySelectorAll('.he-acts .btn')].map(b => b.textContent.trim())`);
  check('fold is always one of them', buttons.some((b) => /Fold/i.test(b)), JSON.stringify(buttons));
  check('and either check or call, never both',
    buttons.filter((b) => /^(Check|Call)/i.test(b)).length === 1, JSON.stringify(buttons));
  check('a raise is offered with a floor and a shove',
    buttons.some((b) => /Raise/i.test(b)) && buttons.some((b) => /All in/i.test(b)), JSON.stringify(buttons));
  await shot('acting');

  // Call, and let the hand run.
  await evaluate(`
    const b = [...document.querySelectorAll('.he-acts .btn')].find(x => /^(Check|Call)/i.test(x.textContent));
    if (b) b.click();
    return true;
  `);
}

/* ------------------------------ the hand plays ---------------------------- */

const sawBoard = await (async () => {
  for (let i = 0; i < 90; i++) {
    if ((await count('.he-board .he-card:not(.is-slot)')) >= 3) return true;
    await wait(500);
  }
  return false;
})();
check('a flop comes out', sawBoard, `${await count('.he-board .he-card:not(.is-slot)')} on the board`);
if (sawBoard) {
  check('and the table tells you what you have', Boolean(await textOf('.he-best')), await textOf('.he-best'));
  await shot('flop');
}

const potShown = Number(await textOf('#hePot'));
check('the pot is on the table', potShown > 0, String(potShown));

/* -------------------------------- on a phone ------------------------------ */

const fit = JSON.parse(await evaluate(`
  const w = document.documentElement;
  const seats = [...document.querySelectorAll('.he-seat')].map(s => s.getBoundingClientRect());
  return JSON.stringify({
    pageWidth: w.clientWidth,
    scrollWidth: w.scrollWidth,
    widest: Math.round(Math.max(...seats.map(s => s.right))),
  });
`));
check('the page never scrolls sideways', fit.scrollWidth <= fit.pageWidth + 1, `${fit.scrollWidth} in ${fit.pageWidth}`);
check('the seats fit the screen', fit.widest <= fit.pageWidth, `rightmost seat at ${fit.widest}`);

const errors = await evaluate(`return window.__journeyErrors ?? []`);
check('the page threw nothing', errors.length === 0, errors.join(' | '));

cleanup();
const bad = results.filter((r) => !r.ok);
console.log(`\n  screenshots  android/holdem-shots/`);
console.log(bad.length
  ? `\x1b[31m  ${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\x1b[32m  all ${results.length} passed — your cards are yours, and nobody else's are anywhere\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
