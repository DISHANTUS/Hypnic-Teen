// The tournament, from the organiser's chair.
//
//   npm run test:cup:ui
//
// test-tournament.mjs proves the bracket works over raw sockets. This proves a
// person can actually reach it: the column on the front page, the form, the
// registration, the bracket drawing itself, and — the part that matters most —
// being pulled into your own tie without typing a code.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-cup-ui');
const PROFILE = path.join(ROOT, 'tmp-cup-profile');
const SHOTS = path.join(ROOT, 'android', 'cup-shots');
const PORT = 3136;
const CDP = 9447;
const base = `http://127.0.0.1:${PORT}`;

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`${ok ? '\x1b[32m  ok  \x1b[0m' : '\x1b[31m FAIL \x1b[0m'} ${label}${extra ? `  \x1b[2m${extra}\x1b[0m` : ''}`);
  return ok;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));

let server = null;
let browser = null;
let ws = null;
const rivals = [];

function cleanup() {
  for (const r of rivals) { try { r.socket.close(); } catch { } }
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
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)); }, 20000);
  });
}
async function evaluate(body) {
  const res = await send('Runtime.evaluate', { expression: `(function(){${body}})()`, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  return res.result?.value;
}
let shotIndex = 0;
async function shot(name) {
  try {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(SHOTS, `${String(++shotIndex).padStart(2, '0')}-${name}.png`), Buffer.from(data, 'base64'));
  } catch { /* never the point */ }
}

const { click, textOf, count, waitFor } = pageTools(evaluate);

/* --------------------------------- setup --------------------------------- */

console.log('\n  \x1b[1mA tournament, from the organiser\'s chair\x1b[0m\n');
if (!check('a Chromium browser is installed', Boolean(CHROME))) { cleanup(); process.exit(1); }

mkdirSync(SHOTS, { recursive: true });
for (const d of [TMP, PROFILE]) rmSync(d, { recursive: true, force: true });

server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP, NODE_ENV: 'test', LLM_BOTS: '0' },
  stdio: 'ignore',
});
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await wait(250);
  up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
}
if (!check('test server running', up, `port ${PORT}`)) { cleanup(); process.exit(1); }

const { questions } = await fetch(`${base}/api/quiz`).then((r) => r.json());
let seq = 0;
const signUp = (name) =>
  fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      age: 18 + seq,
      pin: '5555',
      answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + seq++) % q.options.length].id])),
    }),
  }).then((r) => r.json());

const me = await signUp('Organiser');
if (!check('the organiser has an account', !me.error, me.error ?? me.profile?.hypnicId)) { cleanup(); process.exit(1); }

browser = spawn(CHROME, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROFILE}`, '--headless=new',
  '--window-size=412,915', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--autoplay-policy=no-user-gesture-required', base,
], { stdio: 'ignore' });

let page = null;
for (let i = 0; i < 40 && !page; i++) {
  await wait(300);
  const list = await fetch(`http://127.0.0.1:${CDP}/json`).then((r) => r.json()).catch(() => []);
  page = list.find((p) => p.type === 'page' && p.webSocketDebuggerUrl && !p.url.startsWith('devtools'));
}
if (!check('browser attached', Boolean(page))) { cleanup(); process.exit(1); }

ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.once('open', r));
ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  const slot = pending.get(msg.id);
  if (!slot) return;
  pending.delete(msg.id);
  msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result);
});
await send('Runtime.enable');
await send('Page.enable');
await evaluate(`localStorage.setItem('htfw:token', ${JSON.stringify(me.token)}); return true;`);
await send('Page.reload');
await wait(1200);
if (await waitFor('.si-skip', 4000)) await click('.si-skip');
if (!check('signed in and at the arcade', await waitFor('.game-card', 15000))) { cleanup(); process.exit(1); }
await watchForErrors(evaluate);

/* --------------------------- the column and form -------------------------- */

check('tournaments have their own column on the front page', await waitFor('#cupColumn', 6000));
check('it says so when there are none yet', ((await textOf('#cupList')) ?? '').toLowerCase().includes('no tournaments'));
await shot('empty-column');

await click('#newCupBtn');
if (!check('the Run-one button opens a form', await waitFor('#cupDialog[open]', 5000))) { cleanup(); process.exit(1); }
check('every game can host a cup', (await count('#cupGame option')) > 1, `${await count('#cupGame option')} games`);
check('solo and teams are both offered', (await count('#cupMode option')) === 2);

// Teams mode has to reveal the team-size question; solo must not ask it.
check('team size is hidden until you pick teams', await evaluate(`return document.getElementById('cupSizeField').hidden === true`));
await evaluate(`
  const m = document.getElementById('cupMode');
  m.value = 'teams'; m.dispatchEvent(new Event('change', {bubbles:true}));
  return true;
`);
check('choosing teams asks how many a side', await evaluate(`return document.getElementById('cupSizeField').hidden === false`));
await evaluate(`
  const m = document.getElementById('cupMode');
  m.value = 'solo'; m.dispatchEvent(new Event('change', {bubbles:true}));
  document.getElementById('cupTitle').value = 'Hostel Cup';
  document.getElementById('cupPrize').value = 'chai on me';
  const g = document.getElementById('cupGame'); g.value = 'quiz';
  g.dispatchEvent(new Event('change', {bubbles:true}));
  return true;
`);
// A bracket is many matches, so the organiser has to be able to say how long
// each one runs — otherwise a cup of eight is an entire evening.
check('the organiser can set how each tie is played', (await count('#cupSetup .setup-field')) > 0, `${await count('#cupSetup .setup-field')} settings`);
await evaluate(`
  const r = document.querySelector('#cupSetup input[type=range]');
  if (r) { r.value = r.min; r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true})); }
  const blitz = document.querySelector('#cupSetup .setup-choice[data-id="blitz"]');
  if (blitz) blitz.click();
  return true;
`);
await shot('form');

await click('#cupCreate');
if (!check('creating one takes you to its page', await waitFor('#cupName', 8000), await textOf('#cupName'))) { cleanup(); process.exit(1); }
check('the name you typed is the name on the page', (await textOf('#cupName')) === 'Hostel Cup', await textOf('#cupName'));
check('the prize is shown', ((await textOf('#cupReward')) ?? '').includes('chai'), await textOf('#cupReward'));
check('it says when it starts', ((await textOf('#cupClock')) ?? '').toLowerCase().includes('starts'), await textOf('#cupClock'));
// Entrants deserve to know the rules before they enter, not after.
check('the page states how ties will be played', ((await textOf('#cupMeta')) ?? '').includes('ties:'), await textOf('#cupMeta'));

const cupId = await evaluate(`return location.hash.split('/').pop()`);
check('the page has its own address you can share', /^t[a-z0-9]+$/.test(cupId), `#/cup/${cupId}`);
await shot('created');

/* ------------------------------ registration ------------------------------ */

await click('.cup-actions .btn-primary');
await wait(900);
check('the organiser can enter their own cup', (await count('.cup-team')) === 1, `${await count('.cup-team')} entered`);
check('and the button turns into a way out', ((await textOf('.cup-actions .btn-quiet')) ?? '').includes('Withdraw'), await textOf('.cup-actions .btn-quiet'));

// Three more players register from elsewhere. The page must update itself —
// nobody refreshes a tournament page to see who has joined.
for (const name of ['Rival1', 'Rival2', 'Rival3']) {
  const acct = await signUp(name);
  const socket = io(base, { transports: ['websocket'], reconnection: false });
  await new Promise((r) => socket.once('connect', r));
  await ask(socket, 'hello', { token: acct.token });
  await ask(socket, 'tourney:join', { token: acct.token, id: cupId });

  let answered = -1;
  socket.on('tourney:match', ({ code }) => socket.emit('room:join', { code, token: acct.token }));
  socket.on('game:state', (s) => {
    if (s.phase === 'intro') return socket.emit('game:action', { type: 'ready' });
    if (s.phase !== 'answer' || s.round === answered) return;
    answered = s.round;
    const opts = s.prompt?.options;
    setTimeout(() => socket.emit('game:action', opts?.length ? { type: 'choice', optionId: opts[0].id } : { type: 'answer', text: 'x' }), 250);
  });
  rivals.push({ socket, token: acct.token });
}
await wait(1500);
check('other players appear without a refresh', (await count('.cup-team')) === 4, `${await count('.cup-team')} entered`);
await shot('registered');

// Back on the front page, the cup should be advertised.
await evaluate(`location.hash = '#/'; return true;`);
await waitFor('.cup-card', 8000);
check('the cup is advertised on the front page', (await count('.cup-card')) === 1);
check('the card says you are in it', ((await textOf('.cup-tag')) ?? '') === 'Entered', await textOf('.cup-tag'));
check('the card says how many are playing', ((await textOf('.cup-body small')) ?? '').includes('4 players'), await textOf('.cup-body small'));
await shot('column');

await click('.cup-card');
check('tapping the card opens the tournament', await waitFor('#cupBracket, #cupName', 8000));

/* -------------------------------- the cup -------------------------------- */

await click('.cup-actions .btn-primary'); // "Start the bracket"

// The organiser is in the bracket too, so the site walks them straight into
// their own tie — which is the whole promise, and also why the bracket cannot
// be inspected right here: the page has already moved on.
const pulledIn = await waitFor('#stage, .intro-card', 25000);
check('you are pulled into your own tie without typing a code', pulledIn, await evaluate(`return location.hash`));
await shot('in-the-tie');

if (pulledIn) {
  // Play it out. The rivals answer on their own.
  if (await waitFor('.intro-card', 15000)) await click('.intro-ready');
  for (let round = 0; round < 12; round++) {
    if (await evaluate(`return document.getElementById('overDialog').open`)) break;
    if (await waitFor('.options-grid .option:not(.picked)', 12000)) {
      await wait(300);
      await click('.options-grid .option');
    }
    await wait(1500);
  }
  const ended = await waitFor('#overDialog[open]', 60000);
  check('the tie plays out like any other match', ended);
  if (ended) {
    await click('#againBtn');
    await wait(1200);
  }
}

// Back on the tournament page, the bracket must show what happened.
await evaluate(`location.hash = '#/cup/${cupId}'; return true;`);
await waitFor('.tie', 8000);
await wait(1200);
check('the bracket is drawn round by round', (await count('.bracket-round')) >= 2, `${await count('.bracket-round')} rounds`);
check('the last round is the Final', ((await textOf('.bracket-round:last-child h4')) ?? '') === 'Final', await textOf('.bracket-round:last-child h4'));
check('the ties name who is playing whom', (await count('.tie-side')) >= 4, `${await count('.tie-side')} slots`);
const settled = await count('.tie.settled');
check('the bracket records the result', settled >= 1, `${settled} tie(s) settled`);
check('the winner is marked', (await count('.tie-side.won')) >= 1);
await shot('bracket');

const thrown = await evaluate(`return (window.__journeyErrors ?? []).length`);
check('nothing threw anywhere in that', thrown === 0, thrown ? `${thrown} errors` : '');

cleanup();
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log(`\n  screenshots  android/cup-shots/`);
console.log(`  ${passed}/${results.length} checks passed\n`);
for (const f of failed) console.log(`  \x1b[31m×\x1b[0m ${f.label}`);
if (failed.length) console.log('');
process.exit(failed.length ? 1 : 0);
