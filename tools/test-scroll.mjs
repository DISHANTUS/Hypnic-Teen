// Can you scroll a game with your thumb?
//
//   npm run test:scroll
//
// Reported from a real phone: "I can scroll only when I swipe at the very
// edge." The cause was a nested scroll container over the play area with
// nothing in it to scroll, which swallowed every gesture that started inside
// it and left the page reachable only around the outside.
//
// Nothing static could have caught that. The CSS was all individually
// sensible. So this synthesises a real touch drag in the middle of the game
// and checks whether the page actually moved.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-scroll');
const PROFILE = path.join(ROOT, 'tmp-scroll-profile');
const SHOTS = path.join(ROOT, 'android', 'scroll-shots');
const PORT = 3202;
const CDP = 9475;
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
  for (const m of mates) { try { m.close(); } catch { } }
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
const { click, waitFor, textOf } = pageTools(evaluate);

/**
 * A thumb, dragged up the screen. Chrome's touch emulation goes through the
 * same pipeline a real finger does — including touch-action and whichever
 * element decides to keep the gesture — which a scrollTo() would skip entirely
 * and report success on a page nobody can actually scroll.
 */
async function swipeUp(x, fromY, toY) {
  const step = (type, y, points) =>
    send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points ? [{ x, y }] : [],
    });
  await step('touchStart', fromY, true);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await step('touchMove', fromY + ((toY - fromY) * i) / steps, true);
    await wait(16);
  }
  await step('touchEnd', toY, false);
  await wait(700); // let momentum settle
}

/** How far down the page is, wherever the scrolling actually happens. */
const scrollNow = () => evaluate(`
  const wrap = document.getElementById('stageWrap');
  return {
    page: Math.round(scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0),
    inner: wrap ? Math.round(wrap.scrollTop) : 0,
    pageScrollable: Math.round(document.documentElement.scrollHeight - innerHeight),
    innerScrollable: wrap ? Math.round(wrap.scrollHeight - wrap.clientHeight) : 0,
    touch: wrap ? getComputedStyle(wrap).touchAction : null,
    overflow: wrap ? getComputedStyle(wrap).overflowY : null,
  };
`);

console.log('\n  \x1b[1mCan you scroll a game with your thumb?\x1b[0m  \x1b[2m(390x780, touch)\x1b[0m\n');
if (!check('a Chromium browser is installed', Boolean(CHROME))) { cleanup(); process.exit(1); }

mkdirSync(SHOTS, { recursive: true });
for (const d of [TMP, PROFILE]) rmSync(d, { recursive: true, force: true });

server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP, NODE_ENV: 'test', LLM_BOTS: '0', STUDY_PROXY: '0' },
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
      name, age: 19 + seq, pin: '2468',
      answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + seq++) % q.options.length].id])),
    }),
  }).then((r) => r.json());

const me = await signUp('Thumb');
if (!check('an account exists', !me.error)) { cleanup(); process.exit(1); }

browser = spawn(CHROME, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROFILE}`, '--headless=new',
  '--window-size=390,780', '--no-first-run', '--no-default-browser-check', '--disable-extensions', base,
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
  const m = JSON.parse(raw);
  const slot = pending.get(m.id);
  if (!slot) return;
  pending.delete(m.id);
  m.error ? slot.reject(new Error(m.error.message)) : slot.resolve(m.result);
});
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
// Without this, dispatchTouchEvent is ignored and every swipe silently passes.
await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });

await evaluate(`localStorage.setItem('htfw:token', ${JSON.stringify(me.token)}); return true;`);
await send('Page.reload');
await wait(1500);
await evaluate(`document.querySelector('.si-skip')?.click(); return true;`);
await wait(1000);
await evaluate(`for (const d of document.querySelectorAll('dialog[open]')) d.close(); return true;`);
if (!check('signed in on a phone-sized screen', await waitFor('.game-card', 15000))) { cleanup(); process.exit(1); }
await watchForErrors(evaluate);

/* ------------------------ into a game with long content ------------------- */

// Ship Attack is the tallest screen in the studio — two ten-by-ten seas and a
// deploy panel — so if anything scrolls badly it shows here first.
await evaluate(`
  const all = [...document.querySelectorAll('.game-card')];
  const bs = all.find(c => (c.querySelector('h3')?.textContent ?? '').trim() === 'Ship Attack');
  (bs ?? all[0]).click();
  return true;
`);
if (!check('a room opens', await waitFor('#roomCode', 15000))) { cleanup(); process.exit(1); }
const code = await textOf('#roomCode');

const mate = await signUp('Mate');
const sock = io(base, { transports: ['websocket'], reconnection: false });
await new Promise((r) => sock.once('connect', r));
await new Promise((r) => sock.emit('room:join', { code, token: mate.token }, r));
sock.on('game:state', (s) => {
  if (s.phase === 'brief' || s.phase === 'place') sock.emit('game:action', { type: 'ready' });
});
mates.push(sock);
await wait(1500);
await click('#startBtn');

if (!check('the match starts', await waitFor('.bs-brief, .bs-deploy, .prompt-card', 25000))) { cleanup(); process.exit(1); }
await evaluate(`document.getElementById('bsBriefed')?.click(); return true;`);
await wait(2500);
await shot('before-swipe');

/* ------------------------------- the thumb -------------------------------- */

const before = await scrollNow();
check('the page is long enough to need scrolling', before.pageScrollable > 60, `${before.pageScrollable}px past the fold`);
check('the play area is not a second scroller', before.innerScrollable === 0, `inner has ${before.innerScrollable}px`);
check('and it lets a finger through', before.touch !== 'none', `touch-action: ${before.touch}`);

// The middle of the screen — where a thumb naturally lands, and where the old
// build did nothing at all.
await swipeUp(195, 600, 200);
const afterMiddle = await scrollNow();
const movedMiddle = afterMiddle.page + afterMiddle.inner - (before.page + before.inner);
check('a swipe in the MIDDLE of the game scrolls', movedMiddle > 40, `moved ${movedMiddle}px`);
await shot('after-middle-swipe');

// The edge worked even when it was broken, so it has to keep working.
await evaluate(`scrollTo(0, 0); const w = document.getElementById('stageWrap'); if (w) w.scrollTop = 0; return true;`);
await wait(500);
const beforeEdge = await scrollNow();
await swipeUp(8, 600, 200);
const afterEdge = await scrollNow();
const movedEdge = afterEdge.page + afterEdge.inner - (beforeEdge.page + beforeEdge.inner);
check('and a swipe at the very edge still does', movedEdge > 40, `moved ${movedEdge}px`);

// Nothing may drift sideways on a phone.
check('the page never scrolls sideways', await evaluate(`
  return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2;
`));

const thrown = await evaluate(`return (window.__journeyErrors ?? []).length`);
check('nothing threw', thrown === 0, thrown ? `${thrown} errors` : '');

cleanup();
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log(`\n  screenshots  android/scroll-shots/`);
console.log(`  ${passed}/${results.length} checks passed\n`);
for (const f of failed) console.log(`  \x1b[31m×\x1b[0m ${f.label}`);
process.exit(failed.length ? 1 : 0);
