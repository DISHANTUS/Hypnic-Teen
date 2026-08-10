// What happens after the final whistle.
//
//   npm run test:endgame
//
// The journey test walks out of a match halfway through, so everything that
// happens *after* a game ends has never actually been exercised: the results
// dialog, the button that takes you back, and whether the lobby you land in is
// the real one. That is the gap this closes.
//
// It plays a full one-round match to completion twice — once as the host, once
// as an ordinary player — because the two take different code paths on the way
// out, and a fix that only works for the host is not a fix.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors, makeGuest } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP_DATA = path.join(ROOT, 'tmp-endgame');
const PROFILE = path.join(ROOT, 'tmp-endgame-profile');
const SHOTS = path.join(ROOT, 'android', 'endgame-shots');
const PORT = 3132;
const CDP = 9445;
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

let server = null;
let browser = null;
let ws = null;
const guests = [];

function cleanup() {
  for (const g of guests) { try { g.close(); } catch { } }
  try { ws?.close(); } catch { }
  try { browser?.kill(); } catch { }
  try { server?.kill(); } catch { }
  for (const dir of [TMP_DATA, PROFILE]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { }
  }
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });

/* ------------------------------ CDP plumbing ----------------------------- */

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
  const res = await send('Runtime.evaluate', {
    expression: `(function(){${body}})()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  }
  return res.result?.value;
}

let shotIndex = 0;
async function shot(name) {
  try {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(SHOTS, `${String(++shotIndex).padStart(2, '0')}-${name}.png`), Buffer.from(data, 'base64'));
  } catch { /* a screenshot is never the point */ }
}

const { click, textOf, count, waitFor, waitForGone } = pageTools(evaluate);

/**
 * A real tap, not element.click(). The difference matters here: element.click()
 * fires on a node no human could reach — one behind an open modal, or off the
 * bottom of the screen — so a button that is impossible to press still passes.
 * This aims at the middle of the element and asks the browser what is actually
 * there, which is the question the player is asking too.
 */
async function tap(sel) {
  const box = await evaluate(`
    const e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return null;
    e.scrollIntoView({block:'center'});
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return {hidden:true};
    const x = r.left + r.width/2, y = r.top + r.height/2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, reachable: Boolean(hit) && (hit === e || e.contains(hit)), blocker: hit?.id || hit?.className || hit?.tagName || null };
  `);
  if (!box || box.hidden) return { ok: false, why: 'not on screen' };
  if (!box.reachable) return { ok: false, why: `covered by ${box.blocker}` };
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
  return { ok: true };
}

/** Which screen are we actually looking at? Not which URL — which screen. */
const screenNow = () => evaluate(`
  if (document.querySelector('#playerList')) return 'lobby';
  if (document.querySelector('#stage')) return 'game';
  if (document.querySelector('.game-card')) return 'arcade';
  return document.body.innerText.trim().slice(0, 40) || 'blank';
`);

/* --------------------------------- setup --------------------------------- */

console.log('\n  \x1b[1mAfter the final whistle\x1b[0m\n');

if (!check('a Chromium browser is installed', Boolean(CHROME))) { cleanup(); process.exit(1); }

mkdirSync(SHOTS, { recursive: true });
rmSync(TMP_DATA, { recursive: true, force: true });
rmSync(PROFILE, { recursive: true, force: true });

server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP_DATA, NODE_ENV: 'test' },
  stdio: 'ignore',
});
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await wait(250);
  up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
}
if (!check('test server running', up, `port ${PORT}`)) { cleanup(); process.exit(1); }

// Sign the player in through the API — the signup wizard is the journey test's
// job, not this one's.
const { questions } = await fetch(`${base}/api/quiz`).then((r) => r.json());
const me = await fetch(`${base}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'Endgame',
    age: 20,
    pin: '3333',
    answers: Object.fromEntries(questions.map((q) => [q.id, q.options[0].id])),
  }),
}).then((r) => r.json());
if (!check('a player account exists', !me.error, me.error ?? me.profile?.hypnicId)) { cleanup(); process.exit(1); }

browser = spawn(CHROME, [
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${PROFILE}`,
  '--headless=new',
  '--window-size=412,915',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--autoplay-policy=no-user-gesture-required',
  base,
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

// Attaching to the first page target catches it while it is still about:blank,
// and localStorage on about:blank throws SecurityError rather than returning
// nothing — so the test died before it began, with an error that reads like a
// browser problem and is really a race.
for (let i = 0; i < 40; i++) {
  if (await evaluate(`return location.origin === ${JSON.stringify(base)}`).catch(() => false)) break;
  await wait(250);
}
if (!check('the browser is on the site', await evaluate(`return location.origin`).then((o) => o === base).catch(() => false))) {
  cleanup();
  process.exit(1);
}

await evaluate(`localStorage.setItem('htfw:token', ${JSON.stringify(me.token)}); return true;`);
await send('Page.reload');
await wait(1200);
if (await waitFor('.si-skip', 4000)) { await click('.si-skip'); await waitForGone('.studio-intro', 6000); }
if (!check('signed in and at the arcade', await waitFor('.game-card', 15000), await screenNow())) { cleanup(); process.exit(1); }
await watchForErrors(evaluate);

/* ------------------------- one short match, played ------------------------ */

/** Opens a Quiz room from the arcade and trims it to a single blitz round. */
async function hostAShortMatch() {
  await evaluate(`location.hash = '#/'; return true;`);
  await wait(600);
  await evaluate(`
    const all = [...document.querySelectorAll('.game-card')];
    const quiz = all.find(c => (c.querySelector('h3')?.textContent ?? '').trim() === 'Quiz');
    (quiz ?? all[0]).click();
    return true;
  `);
  if (!(await waitFor('#roomCode', 15000))) return null;
  const code = await textOf('#roomCode');

  await click('#editSetup');
  await waitFor('.setup-field', 4000);
  await evaluate(`
    const r = document.querySelector('.setup-field input[type=range]');
    if (r) { r.value = r.min; r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true})); }
    return true;
  `);
  await wait(500);
  await click('.setup-choice[data-id="blitz"]');
  await wait(400);
  await click('#editSetup');
  return code;
}

/** Sits through the briefing and the round until the results dialog appears. */
async function playToTheEnd() {
  if (!(await waitFor('.intro-card', 20000))) return 'no briefing';
  await click('.intro-ready');
  if (!(await waitFor('.prompt-card', 20000))) return 'never started';
  await wait(600);
  await click('.options-grid .option');
  if (!(await waitFor('#overDialog[open]', 60000))) return 'never ended';
  return null;
}

/* ============================ leg one: the host =========================== */

console.log('\n  \x1b[2mas the host\x1b[0m');

const guest = await makeGuest(io, base, 800);
guests.push(guest);

let code = await hostAShortMatch();
if (!check('a room opens', Boolean(code) && code !== '----', code ?? 'none')) { cleanup(); process.exit(1); }
check('a second player joins', !(await guest.join(code)));
await wait(1200);

await click('#startBtn');
let failed = await playToTheEnd();
if (!check('the match reaches a result', !failed, failed ?? await textOf('#overTitle'))) { await shot('host-stuck'); cleanup(); process.exit(1); }
await shot('host-results');

// The player is looking at the results. Everything from here is the way out.
check('the results dialog names a winner', ((await textOf('#overTitle')) ?? '').length > 4, await textOf('#overTitle'));
check('the scores are listed', (await count('#resultsList li')) > 0, `${await count('#resultsList li')} rows`);

// The dialog is modal, so it covers the header — including its Lobby button.
// That is fine only if the dialog carries both exits itself, which is why they
// were put there. Both must be pressable, not merely present.
check('the header Lobby button is (correctly) covered by the modal', !(await tap('#quitBtn')).ok);
check('the results screen offers a way out as well as a way on', (await count('#overDialog .dlg-actions button')) === 2);

const again = await tap('#againBtn');
check('the Back-to-lobby button is pressable', again.ok, again.why ?? '');

const landedHost = await waitFor('#playerList li', 8000);
check('the host lands back in the lobby', landedHost, await screenNow());
check('the lobby still knows who is in it', (await count('#playerList li')) >= 1, `${await count('#playerList li')} seated`);
check('the results dialog is gone', !(await evaluate(`return document.getElementById('overDialog').open`)));
await shot('host-lobby');

// And the lobby has to be a working one, not a husk: the host can start again.
check('the host can start another match from it', await evaluate(`
  const b = document.getElementById('startBtn');
  return Boolean(b) && !b.disabled && !b.hidden;
`));

/* ========================= leg two: everyone else ========================= */

console.log('\n  \x1b[2mas an ordinary player\x1b[0m');

// This time someone else hosts, so the browser under test has no host powers —
// the path that was broken for longest.
const host = await makeGuest(io, base, 800);
guests.push(host);
const made = await new Promise((r) => host.socket.emit('room:create', { gameId: 'quiz', token: host.token }, r));
if (!check('someone else opens a room', !made?.error, made?.error ?? made?.code)) { cleanup(); process.exit(1); }
await new Promise((r) => host.socket.emit('room:settings', { rounds: 1, pace: 'blitz' }, r));

await evaluate(`location.hash = '#/room/${made.code}'; return true;`);
if (!check('you can join it', await waitFor('#playerList li', 10000), await screenNow())) { cleanup(); process.exit(1); }
check('you are not the host here', await evaluate(`
  const b = document.getElementById('startBtn');
  return !b || b.hidden || b.disabled;
`));

await wait(600);
host.socket.emit('room:ready', true);
await new Promise((r) => host.socket.emit('room:start', {}, r));

failed = await playToTheEnd();
if (!check('the match reaches a result', !failed, failed ?? await textOf('#overTitle'))) { await shot('guest-stuck'); cleanup(); process.exit(1); }
await shot('guest-results');

const guestAgain = await tap('#againBtn');
check('the Back-to-lobby button is pressable', guestAgain.ok, guestAgain.why ?? '');

const landedGuest = await waitFor('#playerList li', 8000);
check('a non-host lands back in the lobby too', landedGuest, await screenNow());
check('the room code is still shown', /^[A-Z0-9]{4}$/.test((await textOf('#roomCode')) ?? ''), await textOf('#roomCode'));
await shot('guest-lobby');

/* ---------------- and the other door: leaving, not staying ---------------- */

// Some people want out rather than another round, and while the results are up
// Leave is the only exit they can actually reach.
console.log('\n  \x1b[2mwalking out instead\x1b[0m');

host.socket.emit('room:lobby');
await wait(800);
host.socket.emit('room:ready', true);
await new Promise((r) => host.socket.emit('room:start', {}, r));

failed = await playToTheEnd();
if (check('a second match reaches a result', !failed, failed ?? await textOf('#overTitle'))) {
  const out = await tap('#overLeaveBtn');
  check('the Leave button is pressable', out.ok, out.why ?? '');
  check('leaving lands you in the arcade', await waitFor('.game-card', 8000), await screenNow());
  check('and you are really out of the room', await evaluate(`return !document.querySelector('#playerList')`));
  await shot('left');
}

const thrown = await evaluate(`return (window.__journeyErrors ?? []).length`);
check('nothing threw on the way out', thrown === 0, thrown ? `${thrown} errors` : '');

/* --------------------------------- done ---------------------------------- */

cleanup();

const passed = results.filter((r) => r.ok).length;
const failedChecks = results.filter((r) => !r.ok);
console.log(`\n  screenshots  android/endgame-shots/`);
console.log(`  ${passed}/${results.length} checks passed\n`);
for (const f of failedChecks) console.log(`  \x1b[31m×\x1b[0m ${f.label}`);
if (failedChecks.length) console.log('');
process.exit(failedChecks.length ? 1 : 0);
