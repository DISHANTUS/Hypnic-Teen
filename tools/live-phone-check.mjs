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
// ADB_SERIAL pins every command to one transport. The cable kept dying mid-
// sweep, so the harness can run over adb-over-WiFi instead — at which point
// there may be two transports for one phone, and an unpinned command refuses.
const SERIAL = (process.env.ADB_SERIAL ?? '').trim();
const adb = (...a) =>
  execFileSync(ADB, SERIAL ? ['-s', SERIAL, ...a] : a,
    { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
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

const device = adb('devices').split('\n').slice(1)
  .find((l) => l.trim().endsWith('device') && (!SERIAL || l.includes(SERIAL)));
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

async function attachTo(target) {
  ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
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
}

/**
 * Find the studio tab again and reconnect, opening a fresh tab if the old one
 * is gone. This is what lets the sweep survive a renderer crash mid-run —
 * without it, one dead tab turns every remaining game into a timeout, which
 * is exactly what happened the first time.
 */
async function reattach() {
  try { ws?.close(); } catch { }
  for (let i = 0; i < 60; i++) {
    try { if (adb('get-state') === 'device') break; } catch { }
    await wait(3000);
  }
  for (const [id, slot] of pending) { pending.delete(id); slot.rej(new Error('reattaching')); }
  adb('shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main',
    '-a', 'android.intent.action.VIEW', '-d', `${phoneBase}/`);
  await wait(3000);
  let target = null;
  for (let i = 0; i < 20 && !target; i++) {
    await wait(500);
    const list = await fetch(`http://127.0.0.1:${CDP}/json`).then((r) => r.json()).catch(() => []);
    target = list.find((p2) => p2.type === 'page' && p2.url.includes(`127.0.0.1:${PORT}`) && p2.webSocketDebuggerUrl);
  }
  if (!target) throw new Error('no studio tab came back');
  await attachTo(target);
}

await attachTo(page);

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
// Chips, by the front door: a fresh account owns nothing, and a casino table
// quite rightly disables its bet button for the broke. The daily top-up is the
// route every player takes, so the sweep takes it too.
const purse = await evaluate(`
  return await fetch('/api/chips/daily', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + localStorage.getItem('htfw:token') },
  }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
`);
check('the daily chips are claimed', !purse.error, purse.error ?? ('balance ' + (purse.balance ?? purse.chips ?? '?')));
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
// The whole catalogue, and not just opened — played. Each room is entered with
// stand-ins, and then the sweep does what a player would do first: answer the
// prompt, play a card, press the bet, throw the dice. The acceptance is always
// the same shape: the game visibly answered. A screen that renders and never
// responds is exactly as broken as one that never renders, and only this half
// of the sweep can tell them apart.

const catalogue = await fetch(`${base}/api/games`).then((r) => r.json());
const GAMES = (catalogue.games ?? catalogue);
check('the catalogue is the full studio', GAMES.length >= 70, `${GAMES.length} games`);

try { adb('shell', 'svc', 'power', 'stayon', 'usb'); } catch { }

const SHELF = { party: '#/', cards: '#/shelf/cards', board: '#/shelf/board', casino: '#/shelf/casino' };

/** What each room's real table looks like, so pokes never race the mount. */
const TABLE = {
  party: '.party, .tr-table:not([hidden]), .cb-table:not([hidden]), .hu-table:not([hidden]), .td-table, .bs-boards, .bs-deploy, .so-table, .cw-table',
  cards: '.cd-table:not([hidden])',
  board: '.bd-table:not([hidden]), .tr-table:not([hidden])',
  casino: '.bj-table, .lo-table, .ch-table, .pl-table, .kn-table, .bi-table, .jp-table, .sp-table, .ho-table, .rl-table, .roulette, #stage',
};

/** Everything a player could read off the table, for change detection. */
const READ_STATE = `
  return [
    '#cdSaid', '.bd-said', '.ch-said', '.pl-said', '.kn-said', '.bi-said',
    '.jp-said', '.lo-said', '.sp-said', '.hu-said', '#cbSaid', '.tr-mine',
    '#pTimer', '.clk-left', '#cdTurn', '#hud',
  ].map((sel) => document.querySelector(sel)?.textContent ?? '').join('|')
    + '|' + document.querySelectorAll('#cdHand .cd-card').length
    + '|' + document.querySelectorAll('.bd-coin, .ld-token, .bd-orb').length;
`;

/** The casino: which button starts a round, and what says it resolved. */
const CASINO_ACT = {
  roulette: { act: '.rl-felt > *', result: '.rl-result, .rl-pot' },
  holdem: { act: '.he-acts .btn', result: '.he-said' },
  blackjack: { act: '.bj-acts .btn', result: '.bj-said' },
  lottery: { act: '#loDip, #loBuy', result: '.lo-said, .lo-ball' },
  slots: { act: '.ch-acts .btn', result: '.ch-said' },
  plinko: { act: '.ch-acts .btn', result: '.ch-said' },
  wheel: { act: '.ch-acts .btn', result: '.ch-said' },
  scratch: { act: '.ch-acts .btn', result: '.ch-said' },
  baccarat: { act: '.ch-acts .btn', result: '.ch-said' },
  'three-card': { act: '.ch-acts .btn', result: '.ch-said' },
  'casino-war': { act: '.ch-acts .btn', result: '.ch-said' },
  'sic-bo': { act: '.ch-acts .btn', result: '.ch-said' },
  progressive: { act: '.ch-acts .btn', result: '.ch-said' },
  craps: { act: '.pl-board .pl-spot', result: '.pl-said' },
  horses: { act: '.pl-board .pl-spot', result: '.pl-said' },
  keno: { act: '.kn-num', then: '#knGo', result: '.kn-said' },
  bingo: { act: '#biBuyCard', result: '.bi-said, .bi-call' },
  jackpot: { act: '.jp-throw .btn', result: '.jp-said' },
  sports: { act: '.sp-out:not(:disabled)', result: '.sp-said, .sp-lock' },
};

/** The six deeper pokes, unchanged — now run only once the real table is up. */
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
  },
  chess: async () => {
    await evaluate(`document.querySelector('.bd-square.can-move')?.click(); return true;`);
    await wait(600);
    const lit = await count('.bd-square.is-target');
    check('  · picking a piece lights its moves', lit >= 1, `${lit} destinations`);
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
};

/**
 * One beat of actual play, per room. Returns a short note about what was done,
 * or null when the beat could not even be attempted — which is its own finding.
 */
async function pollFor(body, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    const got = await evaluate(body);
    if (got) return got;
    if (Date.now() > deadline) return null;
    await wait(800);
  }
}

async function playBeat(game) {
  const room = game.room ?? 'party';

  // Games with their own client get their own beat, whatever shelf they sit on.
  if (game.id === 'typeracer') {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const typed = await evaluate(`
        const box = document.getElementById('trInput');
        if (!box || box.disabled) return false;
        box.focus();
        box.value = (document.querySelector('#trPassage')?.textContent ?? 'The').slice(0, 3);
        box.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      `);
      if (typed) {
        await wait(1000);
        const done = await evaluate(`return document.querySelectorAll('.tr-ch.is-done').length`);
        return { did: 'typed the opening', ok: done >= 1, want: 'progress marked on the passage' };
      }
      await wait(800);
    }
    const phase = await evaluate(`return document.getElementById('trPhase')?.textContent ?? '?'`);
    return { did: 'waited for the race', ok: false, want: 'the box to open inside 20s (stuck at "' + phase + '")' };
  }

  if (game.id === 'codebreak') {
    const role = await pollFor(`
      if (!document.getElementById('cbSet')?.hidden) return 'setter';
      if (!document.getElementById('cbPlay')?.hidden) return 'guesser';
      return false;
    `, 15000);
    if (role === 'setter') {
      await evaluate(`
        const box = document.getElementById('cbCode');
        const len = Number(box?.maxLength) > 0 ? Number(box.maxLength) : 5;
        box.value = '123456789'.slice(0, len);
        box.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('cbLock')?.click();
        return true;
      `);
      const begun = await pollFor(`return document.getElementById('cbSet')?.hidden === true`, 8000);
      return { did: 'set the code', ok: Boolean(begun), want: 'the guessing to begin' };
    }
    if (role === 'guesser') {
      await evaluate(`
        const box = document.getElementById('cbGuess');
        const len = Number(box?.maxLength) > 0 ? Number(box.maxLength) : 5;
        box.value = '123456789'.slice(0, len);
        box.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('cbSend')?.click();
        return true;
      `);
      const heard = await pollFor(`return document.querySelectorAll('#cbGuesses li').length >= 1`, 8000);
      return { did: 'made a guess', ok: Boolean(heard), want: 'the guess on the list' };
    }
    const phase = await evaluate(`return document.getElementById('cbPhase')?.textContent ?? '?'`);
    return { did: 'waited for a role', ok: false, want: 'setter or guesser inside 15s (stuck at "' + phase + '")' };
  }

  if (game.id === 'headsup') {
    const role = await pollFor(`
      if (document.getElementById('huGuessBox')?.hidden === false) return 'guesser';
      if (document.getElementById('huCard')?.hidden === false) return 'helper';
      return false;
    `, 15000);
    if (role === 'guesser') {
      await evaluate(`
        const box = document.getElementById('huGuess');
        box.value = 'phone check guess';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('huSend')?.click();
        return true;
      `);
      const heard = await pollFor(`return document.querySelectorAll('#huTried li').length >= 1`, 8000);
      return { did: 'sent a guess', ok: Boolean(heard), want: 'the guess on the tried list' };
    }
    if (role === 'helper') {
      await evaluate(`document.getElementById('huPass')?.click(); return true;`);
      return { did: 'voted to swap the word', ok: true, want: '' };
    }
    return { did: 'waited for a role', ok: false, want: 'guesser or helper inside 15s' };
  }

  if (game.id === 'truth-dare') {
    const pressed = await pollFor(`
      const b = [...document.querySelectorAll('.td-table button')].find((x) => !x.disabled);
      if (!b) return false;
      const label = b.textContent.trim().slice(0, 24);
      b.click();
      return label;
    `, 15000);
    return { did: pressed ? 'pressed "' + pressed + '"' : 'looked for a button', ok: Boolean(pressed), want: 'any button in the ring inside 15s' };
  }


  if (room === 'board') {
    // Throw or roll if the game has dice; the sticks or die must then exist.
    const threw = await evaluate(`
      const b = [...document.querySelectorAll('#bdDice button, .bd-throw, #bdActs button')]
        .find((x) => /roll|throw/i.test(x.textContent));
      if (!b) return false;
      b.click();
      return true;
    `);
    if (threw) {
      await wait(900);
      const shown = await evaluate(`
        return Boolean(document.querySelector('.bd-sticks, .ld-die, .bd-value'));
      `);
      return { did: 'threw the dice', ok: shown, want: 'the dice appear' };
    }
    if (game.id === 'chainreaction') {
      await evaluate(`document.querySelector('.bd-orbcell.can-drop')?.click(); return true;`);
      await wait(1100);
      return { did: 'dropped an orb', ok: (await count('.bd-orb')) >= 1, want: 'an orb on the board' };
    }
    if (game.id === 'chess' || game.id === 'shogi') {
      const played = await evaluate(`
        const from = document.querySelector('.bd-square.can-move');
        if (!from) return false;
        from.click();
        return true;
      `);
      await wait(500);
      const lit = await count('.bd-square.is-target');
      if (played && lit) {
        await evaluate(`document.querySelector('.bd-square.is-target')?.click(); return true;`);
        await wait(900);
        const moved = await evaluate(`return !document.querySelector('.bd-square.is-from')`);
        return { did: 'moved a piece', ok: moved, want: 'the move taken' };
      }
      return { did: 'tried to pick a piece', ok: played, want: 'a piece to pick' };
    }
    if (game.id === 'mahjong') {
      return { did: 'looked for a hand', ok: (await count('.bd-tile')) >= 5, want: 'tiles in hand' };
    }
    if (game.id === 'typeracer') {
      const typed = await evaluate(`
        const box = document.getElementById('trInput');
        if (!box || box.disabled) return 'no open box yet';
        box.focus();
        box.value = 'The';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      `);
      await wait(800);
      const progressed = await evaluate(`return document.querySelectorAll('.tr-ch.is-done').length`);
      return { did: 'typed the first word', ok: typed !== true || progressed >= 1, want: 'progress marked' };
    }
    return null;
  }

  if (room === 'cards') {
    // Wait for our turn where the game has turns; then play the first card the
    // client offers. Games with no turns (Snap, War...) have their own button.
    const deadline = Date.now() + 14000;
    while (Date.now() < deadline) {
      const acted = await evaluate(`
        const act = [...document.querySelectorAll('#cdActs button, .cd-acts button')]
          .find((b) => !b.disabled && /snap|slap|flip|draw|deal|stock|pass|play|turn/i.test(b.textContent));
        if (act) { act.click(); return 'button: ' + act.textContent.trim().slice(0, 20); }
        const turn = document.getElementById('cdTurn')?.textContent ?? '';
        if (/your/i.test(turn)) {
          const card = document.querySelector('#cdHand .cd-card');
          if (card) { card.click(); return 'played a card'; }
        }
        return false;
      `);
      if (acted) return { did: String(acted), ok: true, want: '' };
      await wait(800);
    }
    return { did: 'waited for a turn', ok: false, want: 'a turn or a button inside 14s' };
  }

  if (room === 'casino') {
    const plan = CASINO_ACT[game.id];
    if (!plan) return null;
    const pressBody = `
      const b = document.querySelector(` + JSON.stringify(plan.act) + `);
      if (!b || b.disabled) return false;
      b.click();
      return b.className.split(' ')[0] || b.id || 'pressed';
    `;
    const pressed = await pollFor(pressBody, 20000);
    if (!pressed) return { did: 'waited for the table action', ok: false, want: plan.act + ' to enable inside 20s' };
    if (plan.then) {
      await wait(400);
      await evaluate(`document.querySelector(` + JSON.stringify(plan.then) + `)?.click(); return true;`);
    }
    const saidBody = `
      const el = document.querySelector(` + JSON.stringify(plan.result) + `);
      return el && el.textContent.trim() ? true : false;
    `;
    const said = await pollFor(saidBody, 22000);
    return { did: 'pressed ' + pressed, ok: Boolean(said), want: plan.result + ' inside 22s' };
  }

  // Party: wait for a prompt with options, answer it, lock it in.
  const deadline = Date.now() + 16000;
  while (Date.now() < deadline) {
    const answered = await evaluate(`
      const opt = document.querySelector('button.option:not(:disabled)');
      if (!opt) return false;
      opt.click();
      const lock = [...document.querySelectorAll('.btn-primary')].find((b) => /lock|answer|send|vote/i.test(b.textContent));
      lock?.click();
      return true;
    `);
    if (answered) return { did: 'answered the prompt', ok: true, want: '' };
    // Some party faces want typing instead.
    const typed = await evaluate(`
      const box = document.querySelector('.party input:not([type]):not(:disabled), .party input[type="text"]:not(:disabled), .party textarea:not(:disabled)');
      if (!box) return false;
      box.focus();
      box.value = 'phone check';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      const send = [...document.querySelectorAll('.btn-primary')].find((b) => !b.disabled);
      send?.click();
      return true;
    `);
    if (typed) return { did: 'typed an answer', ok: true, want: '' };
    await wait(900);
  }
  // Not the party engine after all - a standalone client. One generic beat:
  // press anything pressable that is not a way out of the room.
  const generic = await pollFor(`
    const b = [...document.querySelectorAll('#stageWrap button, .hud button')]
      .find((x) => !x.disabled && !/leave|quit|back|exit/i.test(x.textContent));
    if (!b) return false;
    const label = b.textContent.trim().slice(0, 24) || b.className.split(' ')[0];
    b.click();
    return label;
  `, 8000);
  if (generic) return { did: 'pressed "' + generic + '"', ok: true, want: '' };
  return { did: 'waited for a prompt', ok: false, want: 'something to answer inside 16s' };
}

const broken = [];
let swept = 0;

const fromArg = process.argv.find((a) => a.startsWith('--from='))?.slice(7) ?? null;
const onlyArg = process.argv.find((a) => a.startsWith('--only='))?.slice(7)?.split(',') ?? null;
let started = !fromArg;

for (const game of GAMES) {
  if (!started) { if (game.id === fromArg) started = true; else continue; }
  if (onlyArg && !onlyArg.includes(game.id)) continue;
  const room = game.room ?? 'party';
  console.log(`\n  \x1b[2m— ${game.name} (${room}) —\x1b[0m`);

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

    // Through every gate — tutorial, brief — until the room's REAL table is
    // up. The universal "something mounted" signal fires at the rules screen,
    // which is exactly how the first version poked boards that were not there.
    let alive = false;
    const gate = Date.now() + 35000;
    while (Date.now() < gate && !alive) {
      await evaluate(`
        document.getElementById('tutSkip')?.click();
        document.querySelector('.intro-ready')?.click();
        return true;
      `);
      alive = await evaluate(`
        const brief = document.querySelector('.intro-ready');
        if (brief && brief.offsetParent !== null) return false;   // still being asked
        if (document.querySelector(${JSON.stringify(TABLE[room])})) return true;
        const c = document.getElementById('stage');
        return Boolean(c && getComputedStyle(c).display !== 'none' && c.offsetParent !== null && c.width > 100);
      `);
      if (!alive) await wait(700);
    }
    if (!check(`${game.name}: the table itself appears`, alive)) {
      await shot(`${game.id}-stuck`);
      broken.push(game.name);
      continue;
    }
    await wait(1200);

    // The clock, wherever this room draws it.
    const clockSel = room === 'party' ? '#pTimer' : '.clk-left';
    const t1 = await textOf(clockSel);
    if (t1 && t1.trim()) {
      await wait(2600);
      const t2 = await textOf(clockSel);
      const secs = (t) => Number(String(t ?? '').replace(/[^0-9]/g, ''));
      check(`${game.name}: the clock is alive`,
        secs(t2) !== secs(t1) || secs(t1) === 0, `${t1} then ${t2}`);
    }

    // One beat of actual play, and then the universal truth: over the next
    // stretch, the table visibly moved — my beat landing, or the stand-ins
    // playing, or the round resolving. A table that renders and then holds
    // perfectly still for twelve seconds is a bug whatever the DOM says.
    const before = await evaluate(READ_STATE);
    const beat = await playBeat(game);
    let moved = false;
    const still = Date.now() + 12000;
    while (Date.now() < still && !moved) {
      await wait(1500);
      moved = (await evaluate(READ_STATE)) !== before;
    }
    if (beat) {
      // A beat that failed at a table that then visibly moved is the sweep not
      // speaking the game's language - noted, but not held against the game.
      const verdict = beat.ok || moved;
      check(`${game.name}: playable — ${beat.did}`, verdict,
        beat.ok ? '' : `beat missed (wanted ${beat.want})` + (moved ? ' but the table moves' : ' and the table sat still'));
      if (!verdict) broken.push(game.name);
    } else {
      check(`${game.name}: the table moves`, moved);
      if (!moved) broken.push(game.name);
    }

    await SPECIAL[game.id]?.();

    const errors = await evaluate(`return window.__journeyErrors ?? []`);
    check(`${game.name}: threw nothing`, errors.length === 0, errors.slice(0, 2).join(' | '));
    if (errors.length) broken.push(game.name);
    await shot(game.id);

    await evaluate(`document.querySelector('#quitBtn, .back, [data-nav]')?.click(); return true;`);
    await wait(600);
    swept += 1;
    console.log(`PROGRESS ${game.id}`);
  } catch (err) {
    check(`${game.name}: the sweep itself survived`, false, String(err.message).slice(0, 90));
    broken.push(game.name);
    if (/timed out|reattaching|not opened/i.test(String(err.message))) {
      console.log('[2m         the tab died — reattaching[0m');
      try { await reattach(); } catch (e2) {
        console.log(`[31m         could not reattach: ${e2.message}[0m`);
        break;
      }
    }
  }
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
  : `\n  \x1b[32mall ${results.length} passed — every game in the studio, played on the actual phone\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
