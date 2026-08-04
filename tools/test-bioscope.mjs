// The Bioscope round, on screen.
//
//   npm run test:bioscope
//
// A strip of numbered photographs that decodes into a title. Two things can go
// wrong that no server test would notice: the pictures 404 (they live outside
// the repo, on a disk that may not be mounted), and the grid renders but
// pushes everything else off a phone screen.
//
// It also measures what fraction of cards can become a Bioscope round at all,
// because a feature that fires on two cards in a hundred is not a feature.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-bio');
const PROFILE = path.join(ROOT, 'tmp-bio-profile');
const SHOTS = path.join(ROOT, 'android', 'bioscope-shots');
const PORT = 3149;
const CDP = 9453;
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
let mate = null;
function cleanup() {
  try { mate?.close(); } catch { }
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

console.log('\n  \x1b[1mThe Bioscope round\x1b[0m\n');

/* ------------------- how much of the bank can do this? -------------------- */

// Measured before anything is drawn, because a grid that only ever appears on
// two cards in a hundred would pass every visual check and still never be seen.
{
  const { bioscopeFor } = await import('../server/cinema.js');
  const { clueFor } = await import('../server/media.js');
  const { MOVIES, SONGS } = await import('../server/content.js');
  const cards = [...MOVIES, ...SONGS];
  const strips = cards.map((c) => bioscopeFor(c, clueFor, 0)).filter(Boolean);
  const share = Math.round((strips.length / cards.length) * 100);
  check('a real share of cards become picture rounds', share >= 25, `${strips.length} of ${cards.length} — ${share}%`);
  check('every strip has at least two pictures', strips.every((s) => s.length >= 2));
  check('and each picture is numbered in order', strips.every((s) => s.every((f, i) => f.n === i + 1)));
  // A card whose emoji mean nothing photographable must fall back, not break.
  check('a card with no usable emoji falls back rather than half-drawing',
    bioscopeFor({ answer: 'Nothing', emoji: '✨💫🌀' }, clueFor, 0) === null);
}

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
if (!check('test server running', up)) { cleanup(); process.exit(1); }

// The photographs live outside the repo. If that disk is not there, every
// frame in every grid is a broken image and nothing else would notice.
const pic = await fetch(`${base}/media/clues/crow-1.jpg`).catch(() => null);
check('the picture library is being served', pic?.ok === true, pic ? `HTTP ${pic.status}` : 'no answer');

const { questions } = await fetch(`${base}/api/quiz`).then((r) => r.json());
let seq = 0;
const signUp = (name) =>
  fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name, age: 19 + seq, pin: '9911',
      answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + seq++) % q.options.length].id])),
    }),
  }).then((r) => r.json());

const me = await signUp('Bio');
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
  const msg = JSON.parse(raw);
  const slot = pending.get(msg.id);
  if (!slot) return;
  pending.delete(msg.id);
  msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result);
});
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
await evaluate(`localStorage.setItem('htfw:token', ${JSON.stringify(me.token)}); return true;`);
await send('Page.reload');
await wait(1200);
if (await waitFor('.si-skip', 4000)) await click('.si-skip');
if (!check('signed in on a phone', await waitFor('.game-card', 15000))) { cleanup(); process.exit(1); }
await watchForErrors(evaluate);

/* -------------------------- into a movie round ---------------------------- */

await evaluate(`
  const all = [...document.querySelectorAll('.game-card')];
  const m = all.find(c => (c.querySelector('h3')?.textContent ?? '').trim() === 'Guess the Movie');
  (m ?? all[0]).click();
  return true;
`);
if (!check('a room opens', await waitFor('#roomCode', 15000))) { cleanup(); process.exit(1); }
const code = await textOf('#roomCode');

const acct = await signUp('Mate');
mate = io(base, { transports: ['websocket'], reconnection: false });
await new Promise((r) => mate.once('connect', r));
await new Promise((r) => mate.emit('room:join', { code, token: acct.token }, r));
mate.on('game:state', (s) => { if (s.phase === 'intro') mate.emit('game:action', { type: 'ready' }); });
// Rounds run 38 seconds apiece by default, so a ninety-second watch only ever
// saw two of them — and with roughly half the deck carrying pictures, one run
// in twenty saw none at all and failed for no reason. Blitz pace and a long
// deck put many rounds inside the window instead of gambling on the first two.
await click('#editSetup');
await waitFor('.setup-field', 4000);
await evaluate(`
  const r = document.querySelector('.setup-field input[type=range]');
  if (r) { r.value = r.max; r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true})); }
  return true;
`);
await wait(400);
await click('.setup-choice[data-id="blitz"]');
await wait(400);
await click('#editSetup');

await wait(1200);
await click('#startBtn');

if (await waitFor('.intro-card', 20000)) await click('.intro-ready');
if (!check('the match starts', await waitFor('.prompt-card', 20000))) { cleanup(); process.exit(1); }

// Rounds are dealt from a mixed deck, so play forward until a picture round
// comes up rather than assuming the first one is.
let strip = null;
const deadline = Date.now() + 150_000;
while (Date.now() < deadline && !strip) {
  if (await evaluate(`return document.querySelectorAll('.bio-frame').length > 0`)) {
    strip = await evaluate(`
      const frames = [...document.querySelectorAll('.bio-frame')];
      return {
        count: frames.length,
        numbers: frames.map(f => f.querySelector('.bio-n')?.textContent),
        broken: frames.filter(f => f.classList.contains('missing')).length,
        loaded: frames.filter(f => { const i = f.querySelector('img'); return i && i.complete && i.naturalWidth > 0; }).length,
        prompt: document.querySelector('.prompt-card h2')?.textContent ?? '',
      };
    `);
    break;
  }
  await wait(1000);
}

if (check('a picture round comes up', Boolean(strip), strip ? `${strip.count} frames` : 'none in 90s')) {
  check('every picture actually loaded', strip.loaded === strip.count, `${strip.loaded} of ${strip.count}`);
  check('none of them is a broken image', strip.broken === 0);
  check('they are numbered 1, 2, 3…', strip.numbers.join(',') === strip.numbers.map((_, i) => i + 1).join(','), strip.numbers.join(','));
  check('and the prompt says to read them', /read the pictures/i.test(strip.prompt), strip.prompt);
  // The emoji hint is replaced by the grid, not shown beside it as a blank.
  check('no empty hint card is left behind', await evaluate(`
    return [...document.querySelectorAll('.hint')].every(h => h.textContent.trim().length > 0);
  `));
  // Nothing may cover the board mid-round. The studio notice used to open
  // itself over a live match, which is how this was noticed at all — from a
  // screenshot, not from any check that was looking for it.
  check('nothing is covering the game', await evaluate(`return !document.querySelector('dialog[open]')`),
    await evaluate(`return document.querySelector('dialog[open]')?.id ?? ''`));
  await shot('bioscope');

  // A phone is the point. Six photographs must not push the answer box away.
  const fits = await evaluate(`
    const doc = document.documentElement;
    const box = document.querySelector('.answer-form, form input[type=text], .party-form input');
    const r = box?.getBoundingClientRect();
    return {
      sideways: doc.scrollWidth > doc.clientWidth + 2,
      answerOnScreen: Boolean(r) && r.top < innerHeight && r.bottom > 0,
      gridWidth: Math.round(document.querySelector('.bioscope')?.getBoundingClientRect().width ?? 0),
      screen: innerWidth,
    };
  `);
  check('the page never scrolls sideways', !fits.sideways, `grid ${fits.gridWidth}px in ${fits.screen}px`);
  check('the answer box is still reachable', fits.answerOnScreen);
}

const thrown = await evaluate(`return (window.__journeyErrors ?? []).length`);
check('nothing threw', thrown === 0, thrown ? `${thrown} errors` : '');

cleanup();
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log(`\n  screenshots  android/bioscope-shots/`);
console.log(`  ${passed}/${results.length} checks passed\n`);
for (const f of failed) console.log(`  \x1b[31m×\x1b[0m ${f.label}`);
process.exit(failed.length ? 1 : 0);
