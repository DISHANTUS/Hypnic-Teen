// The live studio, on a real phone.
//
//   node tools/live-phone-check.mjs
//
// Not the throwaway server and not an emulated viewport: this drives Chrome on
// a phone plugged in over USB, pointed at the studio that is actually running,
// with its real data and its real friends possibly online. So it is a sweep,
// not a stress test — it signs up one clearly-named account, opens a handful of
// rooms with clearly-named stand-ins, checks what a player would see, and
// leaves everything the way it found it.
//
// The phone reaches the laptop through `adb reverse`, so it works whatever
// WiFi either end is on. Chrome is driven over CDP, which mobile Chrome
// exposes for any page without the app needing a debug build.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';
import { seatDummies } from './lib/dummies.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const SDK = process.env.ANDROID_SDK || 'W:\\Android_SDK';
const ADB = path.join(SDK, 'platform-tools', 'adb.exe');
const SHOTS = path.join(ROOT, 'android', 'phone-shots');
const PORT = 8008;
const CDP = 9339;
// On the phone, the studio is its own localhost — that is what reverse means.
const phoneBase = `http://127.0.0.1:${PORT}`;
// From this laptop, it is simply the live server.
const base = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`${ok ? '\x1b[32m  ok  \x1b[0m' : '\x1b[31m FAIL \x1b[0m'} ${label}${extra ? `  \x1b[2m${extra}\x1b[0m` : ''}`);
  return ok;
};
const adb = (...a) =>
  execFileSync(ADB, a, { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let ws = null;
let dummies = [];
function cleanup() {
  for (const d of dummies) { try { d.close(); } catch { } }
  try { ws?.close(); } catch { }
  try { adb('forward', '--remove', `tcp:${CDP}`); } catch { }
  // The reverse stays: it costs nothing and pulling it out from under a page
  // the user may keep scrolling would be rude.
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const pending = new Map();
let msgId = 0;
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.delete(id)) rej(new Error(`${method} timed out`)); }, 30000);
  });
}
async function evaluate(body) {
  const r = await send('Runtime.evaluate', { expression: `(async function(){${body}})()`, returnByValue: true, awaitPromise: true });
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

console.log('\n  \x1b[1mThe live studio, on the actual phone\x1b[0m\n');

/* --------------------------------- attach --------------------------------- */

const device = adb('devices').split('\n').slice(1).find((l) => l.trim().endsWith('device'));
if (!check('a phone is attached and authorized', Boolean(device), device ?? 'nothing')) process.exit(1);
const model = adb('shell', 'getprop', 'ro.product.model');
console.log(`\x1b[2m         ${model}, Android ${adb('shell', 'getprop', 'ro.build.version.release')}\x1b[0m`);

const live = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
if (!check('the live studio is up on this laptop', live)) process.exit(1);

adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
check('the cable carries the studio to the phone', true, `reverse tcp:${PORT}`);

mkdirSync(SHOTS, { recursive: true });

// A fresh tab, straight at the studio.
adb('shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main',
  '-a', 'android.intent.action.VIEW', '-d', `${phoneBase}/`);
await wait(3500);

adb('forward', `tcp:${CDP}`, 'localabstract:chrome_devtools_remote');
let page = null;
for (let i = 0; i < 30 && !page; i++) {
  await wait(500);
  const list = await fetch(`http://127.0.0.1:${CDP}/json`).then((r) => r.json()).catch(() => []);
  page = list.find((p) => p.type === 'page' && p.url.includes(`127.0.0.1:${PORT}`) && p.webSocketDebuggerUrl);
}
if (!check('Chrome on the phone is inspectable', Boolean(page), page?.url ?? 'no tab found')) {
  cleanup(); process.exit(1);
}

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
await watchForErrors(evaluate);

/* ------------------------- the shell, and the cache ----------------------- */

check('the arcade loads on the phone', await waitFor('.room-tile, .game-card, .auth-card, .si-skip', 25000));
await evaluate(`document.querySelector('.si-skip')?.click(); return true;`);
await wait(600);

// The fix that never reached anybody: the phone must be running the renamed
// clock, not the day-old cached .mjs.
const cache = JSON.parse(await evaluate(`
  const keys = 'caches' in window ? await caches.keys() : [];
  const clock = await fetch('/js/turnclock.js', { method: 'HEAD' }).then(r => r.status).catch(() => 0);
  return JSON.stringify({ keys, clock, sw: Boolean(navigator.serviceWorker?.controller) });
`));
check('the renamed clock is served', cache.clock === 200, `/js/turnclock.js → ${cache.clock}`);
check('no stale service worker cache is hanging on',
  !cache.keys.some((k) => /^htfw-v(?!17)/.test(k)), cache.keys.join(',') || 'none yet');

// The phone's own viewport, no emulation: nothing may scroll sideways.
const fit = JSON.parse(await evaluate(`
  const w = document.documentElement;
  return JSON.stringify({ page: w.clientWidth, scroll: w.scrollWidth });
`));
check('no sideways scroll on the real screen', fit.scroll <= fit.page + 1, `${fit.scroll} in ${fit.page}`);
await shot('home');

/* ------------------------------ a fresh guest ----------------------------- */

const me = await evaluate(`
  const { questions } = await fetch('/api/quiz').then(r => r.json());
  const account = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'PhoneCheck', age: 19, pin: '4321',
      answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[i % q.options.length].id])),
    }),
  }).then(r => r.json());
  if (account.error) return { error: account.error };
  localStorage.setItem('htfw:token', account.token);
  return { name: account.profile?.name, id: account.profile?.id };
`);
if (!check('a guest signs up from the phone', !me.error, me.error ?? me.id)) { cleanup(); process.exit(1); }
await send('Page.navigate', { url: `${phoneBase}/` });
await wait(2500);
await evaluate(`document.querySelector('.si-skip')?.click(); for (const d of document.querySelectorAll('dialog[open]')) d.close(); return true;`);
check('and is signed in after a reload', await waitFor('.profile-chip:not([hidden])', 15000));

// The topbar: trolley with no number, notices, people.
const bar = JSON.parse(await evaluate(`
  const cage = document.getElementById('cageBtn');
  return JSON.stringify({
    cage: cage ? !cage.hidden : false,
    svg: cage ? cage.querySelectorAll('svg').length : 0,
    digits: cage ? /[0-9]/.test(cage.textContent ?? '') : true,
  });
`));
check('the trolley is there and carries no number', bar.cage && bar.svg === 1 && !bar.digits, JSON.stringify(bar));

/* ------------------------- rooms, one from each floor --------------------- */

const SWEEP = [
  { id: 'thayam', name: 'Thayam', shelf: 'board', min: 2, table: '.bd-table:not([hidden])',
    settle: async () => {
      const paint = JSON.parse(await evaluate(`
        const cell = document.querySelector('.bd-cell:not(.is-safe):not(.is-centre)');
        return JSON.stringify({ cell: cell ? getComputedStyle(cell).backgroundColor : null,
          cells: document.querySelectorAll('.bd-cell').length });
      `));
      check('thayam: the mat is painted on the phone', paint.cell === 'rgb(251, 243, 226)' && paint.cells === 49, JSON.stringify(paint));
    } },
  { id: 'ludo', name: 'Ludo', shelf: 'board', min: 2, table: '.bd-table:not([hidden])',
    settle: async () => {
      const anatomy = JSON.parse(await evaluate(`
        return JSON.stringify({
          ring: document.querySelectorAll('.ld-cell:not(.is-column)').length,
          yards: document.querySelectorAll('.ld-yard').length,
          tokens: document.querySelectorAll('.ld-token').length,
        });
      `));
      check('ludo: the whole board is on the phone', anatomy.ring === 52 && anatomy.yards === 4 && anatomy.tokens === 8, JSON.stringify(anatomy));
      // Throw, and watch the die tumble in.
      await evaluate(`for (const b of document.querySelectorAll('#bdDice button, .bd-throw, #bdActs button')) { if (/throw|roll/i.test(b.textContent)) { b.click(); break; } } return true;`);
      await wait(800);
      const die = await evaluate(`const d = document.querySelector('.ld-die'); return d ? d.dataset.pips : null;`);
      check('ludo: the die lands on a real face', ['1','2','3','4','5','6'].includes(die), String(die));
    } },
  { id: 'chess', name: 'Chess', shelf: 'board', min: 2, table: '.bd-table:not([hidden])',
    settle: async () => {
      const board = JSON.parse(await evaluate(`
        const sq = document.querySelector('.bd-square');
        const dark = document.querySelector('.bd-square.is-dark');
        const r = sq?.getBoundingClientRect();
        return JSON.stringify({
          light: sq ? getComputedStyle(sq).backgroundColor : null,
          dark: dark ? getComputedStyle(dark).backgroundColor : null,
          square: r ? Math.abs(r.width - r.height) < 1.5 : false,
        });
      `));
      check('chess: wooden squares, actually square',
        board.light === 'rgb(236, 218, 185)' && board.dark === 'rgb(169, 122, 79)' && board.square,
        JSON.stringify(board));
      // Pick a pawn; its destinations must light up.
      await evaluate(`
        const mine = [...document.querySelectorAll('.bd-square.can-move')];
        mine[0]?.click();
        return true;
      `);
      await wait(500);
      const hints = await count('.bd-square.is-target');
      check('chess: picking a piece shows where it may go', hints >= 1, `${hints} destinations lit`);
    } },
  { id: 'chainreaction', name: 'Chain Reaction', shelf: 'board', min: 2, table: '.bd-table:not([hidden])',
    settle: async () => {
      await evaluate(`document.querySelector('.bd-orbcell.can-drop')?.click(); return true;`);
      await wait(1000);
      const orbs = await count('.bd-orb');
      check('chain reaction: an orb lands from the phone', orbs >= 1, `${orbs} orbs`);
    } },
  { id: 'headsup', name: 'Heads Up', shelf: null, min: 2, table: '.hu-table:not([hidden])',
    settle: async () => {
      // The phone made the room, so the phone guesses first — and its page
      // must contain no word and no card.
      const view = JSON.parse(await evaluate(`
        return JSON.stringify({
          guessBox: !document.getElementById('huGuessBox')?.hidden,
          card: document.getElementById('huCard')?.hidden !== false,
          word: (document.getElementById('huWord')?.textContent ?? '') === '',
        });
      `));
      check('heads up: the guesser phone holds nothing readable',
        view.guessBox && view.card && view.word, JSON.stringify(view));
    } },
  { id: 'codebreak', name: 'Crack the Code', shelf: null, min: 2, table: '.cb-table:not([hidden])',
    settle: async () => {
      const setter = await evaluate(`return !document.getElementById('cbSet')?.hidden`);
      check('crack the code: the setter screen comes up', setter === true, String(setter));
    } },
];

for (const game of SWEEP) {
  console.log(`\n  \x1b[2m— ${game.name}, live —\x1b[0m`);
  await send('Page.navigate', { url: `${phoneBase}/` });
  await wait(2000);
  await evaluate(`location.hash = ${JSON.stringify(game.shelf ? `#/shelf/${game.shelf}` : '#/')}; return true;`);
  await wait(1000);
  await evaluate(`document.querySelector('.si-skip')?.click(); for (const d of document.querySelectorAll('dialog[open]')) d.close(); return true;`);
  if (!check(`${game.name}: the shelf loads`, await waitFor('.game-card', 20000))) continue;

  const opened = await evaluate(`
    const cards = [...document.querySelectorAll('.game-card')];
    const it = cards.find(c => (c.querySelector('h3')?.textContent ?? '').trim() === ${JSON.stringify(game.name)});
    if (!it) return 'not on this shelf (' + cards.length + ' cards)';
    it.click();
    return true;
  `);
  if (!check(`${game.name}: it is on the shelf`, opened === true, String(opened))) continue;
  if (!check(`${game.name}: a room opens`, await waitFor('#roomCode', 20000))) continue;
  const code = await evaluate(`return document.getElementById('roomCode').textContent.trim()`);

  for (const d of dummies) { try { d.close(); } catch { } }
  dummies = [];
  try {
    dummies = await seatDummies(Math.max(0, game.min - 1),
      { base, code, gameId: game.id, name: `${game.id}Mate`, chips: 0, pause: 700 });
  } catch (err) {
    check(`${game.name}: a stand-in can sit down`, false, err.message);
    continue;
  }
  await wait(1200);

  await evaluate(`document.getElementById('startBtn')?.click(); return true;`);
  const taught = await waitFor('.tut-card', 15000);
  if (taught) {
    await evaluate(`document.getElementById('tutSkip')?.click(); return true;`);
    await wait(400);
  }
  const briefed = await waitFor('.intro-ready', 15000);
  if (briefed) await evaluate(`document.querySelector('.intro-ready')?.click(); return true;`);

  if (!check(`${game.name}: the table appears on the phone`, await waitFor(game.table, 25000))) {
    await shot(`${game.id}-stuck`);
    continue;
  }
  await wait(1500);

  // The one thing the user reported twice: the clock has to move on its own.
  const t1 = await textOf('.clk-left');
  await wait(2600);
  const t2 = await textOf('.clk-left');
  const secs = (t) => Number(String(t ?? '').replace(/[^0-9]/g, ''));
  check(`${game.name}: the clock counts down on the phone`,
    secs(t2) < secs(t1) || (t1 === t2 && t1 === ''), `${t1 || '(none)'} then ${t2 || '(none)'}`);

  await game.settle?.();

  const errors = await evaluate(`return window.__journeyErrors ?? []`);
  check(`${game.name}: threw nothing on the phone`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await shot(game.id);

  // Leave the room properly so the live server is not left holding tables.
  await evaluate(`document.querySelector('#quitBtn, .back, [data-nav]')?.click(); return true;`);
  await wait(700);
}

for (const d of dummies) { try { d.close(); } catch { } }
dummies = [];

console.log(`\n  \x1b[2mscreenshots\x1b[0m  android/phone-shots/`);
cleanup();

const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.log('\n  \x1b[31mwhat failed:\x1b[0m');
  for (const r of bad) console.log(`  \x1b[31m  · ${r.label}\x1b[0m`);
}
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — the live studio, on the actual phone\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
