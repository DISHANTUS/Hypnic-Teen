// Every card game, opened in a real browser.
//
//   npm run test:cardroom:ui
//
// The rules suite proves the games are correct and proves nothing at all about
// whether anybody can see them. Thirty games share one renderer with twenty-odd
// faces in it, and a face that throws on its first state looks exactly like a
// game that never started — a blank screen and a room asking what happened.
//
// So this is deliberately shallow and completely broad: every game, one at a
// time, with real stand-in players on real sockets. Does the shelf list it, does
// a room open, does the tutorial come up, does the table actually render, does
// the hand appear, does it fit a phone, and did anything throw. That last one is
// the point — a client that throws once leaves the screen frozen at whatever it
// had drawn before, which is the failure nobody reports because it looks like
// the game is just thinking.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';
import { seatDummies } from './lib/dummies.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-cardui');
const PROFILE = path.join(ROOT, 'tmp-cardui-profile');
const SHOTS = path.join(ROOT, 'android', 'card-shots');
const PORT = 3217;
const CDP = 9495;
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
let dummies = [];
function cleanup() {
  for (const d of dummies) { try { d.close(); } catch { } }
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

console.log('\n  \x1b[1mThe card room, in a browser\x1b[0m  \x1b[2m(390x844, every game, with stand-ins)\x1b[0m\n');
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

const catalogue = await fetch(`${base}/api/games`).then((r) => r.json());
const GAMES = (catalogue.games ?? catalogue).filter((g) => g.room === 'cards');
if (!check('the card room is on the shelf', GAMES.length === 30, `${GAMES.length} games`)) { cleanup(); process.exit(1); }

const { questions } = await fetch(`${base}/api/quiz`).then((r) => r.json());
const me = await fetch(`${base}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'CardSharp', age: 20, pin: '3131',
    answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[i % q.options.length].id])),
  }),
}).then((r) => r.json());
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

/* --------------------------- one game at a time --------------------------- */

for (const game of GAMES) {
  console.log(`\n  \x1b[2m— ${game.name} —\x1b[0m`);

  // The arcade first, then through the room's door — which is what a person
  // does, and the only way to get a fresh boot. Navigating straight to a hash
  // from a page that is already loaded is a fragment change, not a reload, so
  // the app keeps running with whatever it booted with.
  await send('Page.navigate', { url: base });
  await wait(1500);
  await evaluate(`location.hash = '#/shelf/cards'; return true;`);
  await wait(900);
  await evaluate(`document.querySelector('.si-skip')?.click(); for (const d of document.querySelectorAll('dialog[open]')) d.close(); return true;`);
  if (!check(`${game.name}: the arcade loads`, await waitFor('.game-card', 15000))) continue;
  await watchForErrors(evaluate);

  const opened = await evaluate(`
    const cards = [...document.querySelectorAll('.game-card')];
    const it = cards.find(c => (c.querySelector('h3')?.textContent ?? '').trim() === ${JSON.stringify(game.name)});
    if (!it) {
      return 'not on the shelf — showing: '
        + cards.slice(0, 4).map(c => c.querySelector('h3')?.textContent?.trim()).join(', ')
        + ' (' + cards.length + ' cards, hash ' + location.hash + ')';
    }
    it.click();
    return true;
  `);
  if (!check(`${game.name}: it is in the card room`, opened === true, String(opened))) continue;
  if (!check(`${game.name}: a room opens`, await waitFor('#roomCode', 15000))) continue;
  const code = await evaluate(`return document.getElementById('roomCode').textContent.trim()`);

  // Enough stand-ins to satisfy the game, on real sockets. They ready up on
  // their own; nothing here needs them to play well.
  for (const d of dummies) { try { d.close(); } catch { } }
  const need = Math.max(0, game.minPlayers - 1);
  try {
    dummies = need ? await seatDummies(need, { base, code, gameId: game.id, name: `${game.id}Bot`, chips: 0, pause: 700 }) : [];
  } catch (err) {
    check(`${game.name}: stand-ins can sit down`, false, err.message);
    continue;
  }
  await wait(900 + need * 200);

  await evaluate(`document.getElementById('startBtn')?.click(); return true;`);

  // The tutorial comes first for anybody who has not seen this game.
  const taught = await waitFor('.tut-card', 20000);
  if (taught) {
    const steps = await count('.tut-dot');
    check(`${game.name}: the rules are explained first`, steps >= 3, `${steps} steps`);
    await evaluate(`document.getElementById('tutSkip')?.click(); return true;`);
    await wait(400);
  } else {
    check(`${game.name}: the rules are explained first`, false, 'no tutorial card');
  }

  // Its own brief, then the table.
  const briefed = await waitFor('.intro-ready', 20000);
  if (!check(`${game.name}: the brief comes up`, briefed)) { await shot(`${game.id}-no-brief`); continue; }
  await evaluate(`document.querySelector('.intro-ready')?.click(); return true;`);

  if (!check(`${game.name}: the table appears`, await waitFor('.cd-table', 25000))) {
    await shot(`${game.id}-no-table`);
    continue;
  }
  await wait(1600);

  // The middle drew something. This is the check that catches a face that
  // threw on its first state — the renderer leaves the box empty and the room
  // sees a blank screen with no idea why.
  const middle = await evaluate(`return (document.getElementById('cdMiddle')?.children.length ?? 0)`);
  check(`${game.name}: the middle drew something`, middle > 0, `${middle} things`);

  // A hand, or a good reason not to have one — the solitaires and the flip
  // games genuinely have nothing in hand.
  const hand = await count('.cd-hand .cd-card, .cd-hand .cd-empty');
  check(`${game.name}: your side of the table is drawn`, hand > 0, `${hand}`);

  check(`${game.name}: it says whose turn it is`, Boolean(await textOf('#cdTurn')), await textOf('#cdTurn'));

  const fit = JSON.parse(await evaluate(`
    const w = document.documentElement;
    return JSON.stringify({ pageWidth: w.clientWidth, scrollWidth: w.scrollWidth });
  `));
  check(`${game.name}: no sideways scroll`, fit.scrollWidth <= fit.pageWidth + 1,
    `${fit.scrollWidth} in ${fit.pageWidth}`);

  const errors = await evaluate(`return window.__journeyErrors ?? []`);
  check(`${game.name}: threw nothing`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await shot(`${game.id}`);

  await evaluate(`document.querySelector('#quitBtn, .back, [data-nav]')?.click(); return true;`);
  await wait(500);
}

console.log(`\n  \x1b[2mscreenshots\x1b[0m  android/card-shots/`);
cleanup();

const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.log('\n  \x1b[31mwhat failed:\x1b[0m');
  for (const r of bad) console.log(`  \x1b[31m  · ${r.label}\x1b[0m`);
}
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — thirty games, every one of them drawn\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
