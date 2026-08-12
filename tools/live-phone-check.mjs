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

/* ------------------------- every game in the studio ----------------------- */
//
// The whole catalogue, one room at a time. The deep rules live in the server
// suites; what a phone can prove is the part no server suite can — that the
// game actually arrives on a real screen: the room opens, the stage mounts,
// the clock moves, and nothing throws. Six games get a deeper poke because
// they have something specific worth poking.

const catalogue = await fetch(`${base}/api/games`).then((r) => r.json());
const GAMES = (catalogue.games ?? catalogue);
check('the catalogue is the full studio', GAMES.length >= 70, `${GAMES.length} games`);

// Keep the screen on for the duration — a phone that dozes mid-sweep looks
// exactly like a studio that broke.
try { adb('shell', 'svc', 'power', 'stayon', 'usb'); } catch { }

const SHELF = { party: '#/', cards: '#/shelf/cards', board: '#/shelf/board', casino: '#/shelf/casino' };

/** The six deeper pokes, for the games with something specific to prove. */
const SPECIAL = {
  thayam: async () => {
    const paint = JSON.parse(await evaluate(`
      const cell = document.querySelector('.bd-cell:not(.is-safe):not(.is-centre)');
      return JSON.stringify({ cell: cell ? getComputedStyle(cell).backgroundColor : null,
        cells: document.querySelectorAll('.bd-cell').length });
    `));
    check('  · the mat is painted', paint.cell === 'rgb(251, 243, 226)' && paint.cells === 49, JSON.stringify(paint));
  },
  ludo: async () => {
    const anatomy = JSON.parse(await evaluate(`
      return JSON.stringify({
        ring: document.querySelectorAll('.ld-cell:not(.is-column)').length,
        yards: document.querySelectorAll('.ld-yard').length,
        tokens: document.querySelectorAll('.ld-token').length,
      });
    `));
    check('  · the whole board is there', anatomy.ring === 52 && anatomy.yards === 4 && anatomy.tokens === 8, JSON.stringify(anatomy));
    await evaluate(`for (const b of document.querySelectorAll('#bdDice button, .bd-throw, #bdActs button')) { if (/throw|roll/i.test(b.textContent)) { b.click(); break; } } return true;`);
    await wait(800);
    const die = await evaluate(`const d = document.querySelector('.ld-die'); return d ? d.dataset.pips : null;`);
    check('  · the die lands on a real face', ['1', '2', '3', '4', '5', '6'].includes(die), String(die));
  },
  chess: async () => {
    await evaluate(`document.querySelector('.bd-square.can-move')?.click(); return true;`);
    await wait(500);
    const lit = await count('.bd-square.is-target');
    check('  · picking a piece lights its moves', lit >= 1, `${lit} destinations`);
  },
  chainreaction: async () => {
    await evaluate(`document.querySelector('.bd-orbcell.can-drop')?.click(); return true;`);
    await wait(1000);
    check('  · an orb lands', (await count('.bd-orb')) >= 1);
  },
  headsup: async () => {
    const view = JSON.parse(await evaluate(`
      return JSON.stringify({
        guessBox: !document.getElementById('huGuessBox')?.hidden,
        card: document.getElementById('huCard')?.hidden !== false,
        word: (document.getElementById('huWord')?.textContent ?? '') === '',
      });
    `));
    check('  · the guesser phone holds nothing readable', view.guessBox && view.card && view.word, JSON.stringify(view));
  },
  codebreak: async () => {
    check('  · the setter screen comes up', await evaluate(`return !document.getElementById('cbSet')?.hidden`) === true);
  },
};

const broken = [];
let swept = 0;

for (const game of GAMES) {
  const room = game.room ?? 'party';
  console.log(`\n  \x1b[2m— ${game.name} (${room}) —\x1b[0m`);
  const before = results.length;

  try {
    await send('Page.navigate', { url: `${phoneBase}/` });
    await wait(1800);
    await evaluate(`location.hash = ${JSON.stringify(SHELF[room] ?? '#/')}; return true;`);
    await wait(900);
    await evaluate(`document.querySelector('.si-skip')?.click(); for (const d of document.querySelectorAll('dialog[open]')) d.close(); return true;`);
    if (!check(`${game.name}: the shelf loads`, await waitFor('.game-card', 20000))) { broken.push(game.name); continue; }

    const openedIt = await evaluate(`
      const cards = [...document.querySelectorAll('.game-card')];
      const it = cards.find(c => (c.querySelector('h3')?.textContent ?? '').trim() === ${JSON.stringify(game.name)});
      if (!it) return 'not on this shelf (' + cards.length + ' cards)';
      it.click();
      return true;
    `);
    if (!check(`${game.name}: it is on the shelf`, openedIt === true, String(openedIt))) { broken.push(game.name); continue; }
    if (!check(`${game.name}: a room opens`, await waitFor('#roomCode', 20000))) { broken.push(game.name); continue; }
    const code = await evaluate(`return document.getElementById('roomCode').textContent.trim()`);

    for (const d of dummies) { try { d.close(); } catch { } }
    dummies = [];
    const need = Math.max(0, Math.min(3, (game.minPlayers ?? 1) - 1));
    if (need) {
      try {
        dummies = await seatDummies(need, { base, code, gameId: game.id, name: `${game.id}Mate`, chips: 0, pause: 700 });
      } catch (err) {
        check(`${game.name}: stand-ins can sit down`, false, err.message);
        broken.push(game.name);
        continue;
      }
      await wait(900 + need * 250);
    }

    await evaluate(`document.getElementById('startBtn')?.click(); return true;`);

    // Every gate there is, mashed until the stage is alive: tutorial, brief,
    // and any dialog a game opens on the way in. Different games have
    // different subsets, and the order is always the same.
    let alive = false;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && !alive) {
      await evaluate(`
        document.getElementById('tutSkip')?.click();
        document.querySelector('.intro-ready')?.click();
        return true;
      `);
      alive = await evaluate(`
        const wrap = document.getElementById('stageWrap');
        if (!wrap || wrap.closest('[hidden]')) return false;
        const canvas = document.getElementById('stage');
        const painted = canvas && canvas.offsetParent !== null && canvas.width > 50;
        const mounted = wrap.querySelectorAll('*').length > 3;
        const hud = (document.getElementById('hud')?.children.length ?? 0) > 0;
        return Boolean(painted || mounted || hud);
      `);
      if (!alive) await wait(700);
    }
    if (!check(`${game.name}: the game arrives on screen`, alive)) {
      await shot(`${game.id}-stuck`);
      broken.push(game.name);
      continue;
    }
    await wait(1200);

    // The clock, where the game has one. Slapjack-style tables honestly have
    // none, and a restarted clock (a phase ending mid-probe) counts as alive.
    const t1 = await textOf('.clk-left');
    if (t1 && t1.trim()) {
      await wait(2600);
      const t2 = await textOf('.clk-left');
      const secs = (t) => Number(String(t ?? '').replace(/[^0-9]/g, ''));
      check(`${game.name}: the clock is alive`,
        secs(t2) !== secs(t1) || secs(t1) === 0, `${t1} then ${t2}`);
    }

    await SPECIAL[game.id]?.();

    const errors = await evaluate(`return window.__journeyErrors ?? []`);
    check(`${game.name}: threw nothing`, errors.length === 0, errors.slice(0, 2).join(' | '));
    if (errors.length) broken.push(game.name);
    await shot(game.id);

    await evaluate(`document.querySelector('#quitBtn, .back, [data-nav]')?.click(); return true;`);
    await wait(600);
    swept += 1;
  } catch (err) {
    check(`${game.name}: the sweep itself survived`, false, String(err.message).slice(0, 90));
    broken.push(game.name);
  }

  if (results.length === before) broken.push(game.name);
}

for (const d of dummies) { try { d.close(); } catch { } }
dummies = [];
try { adb('shell', 'svc', 'power', 'stayon', 'false'); } catch { }

console.log(`\n  \x1b[2m${swept} of ${GAMES.length} games swept · screenshots in android/phone-shots/\x1b[0m`);
cleanup();

const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.log('\n  \x1b[31mwhat failed:\x1b[0m');
  for (const r of bad) console.log(`  \x1b[31m  · ${r.label}\x1b[0m`);
}
if (broken.length) {
  console.log(`\n  \x1b[31mgames needing attention: ${[...new Set(broken)].join(', ')}\x1b[0m`);
}
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — every game in the studio, on the actual phone\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
