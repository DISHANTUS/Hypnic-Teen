// Every screen, on the phones people actually own.
//
//   node tools/test-phone-fit.mjs
//
// The game tables were swept on a real phone and they fit. But a studio is
// mostly not game tables — it is shelves, leaderboards, title pages, dialogs,
// lobbies — and all of it had only ever been looked at on one width. Most of
// the room arrives on mobiles, and the cheap ones are 360 wide and the old
// ones are 320, and a screen that fits at 390 can overflow at 320 without
// anybody who built it ever seeing it happen.
//
// Two properties, on every route, at three widths:
//
//   nothing scrolls sideways — the page is never wider than the glass
//   what must be tapped can be: primary controls at least 40px tall
//
// Plus the dialogs (cage, theme picker, notices), which live outside routes.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-phonefit');
const PROFILE = path.join(ROOT, 'tmp-phonefit-profile');
const SHOTS = path.join(ROOT, 'android', 'fit-shots');
const PORT = 3226;
const CDP = 9504;
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
function cleanup() {
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
const { waitFor } = pageTools(evaluate);

console.log('\n  \x1b[1mEvery screen, on the phones people actually own\x1b[0m\n');
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
const me = await fetch(`${base}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'FitCheck', age: 20, pin: '9090',
    answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[i % q.options.length].id])),
  }),
}).then((r) => r.json());
if (!check('an account exists', !me.error, me.error ?? '')) { cleanup(); process.exit(1); }

browser = spawn(CHROME, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROFILE}`, '--headless=new',
  '--window-size=400,900', '--no-first-run', '--no-default-browser-check', '--disable-extensions', base,
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

for (let i = 0; i < 40; i++) {
  if (await evaluate(`return location.origin === ${JSON.stringify(base)}`).catch(() => false)) break;
  await wait(250);
}
await evaluate(`localStorage.setItem('htfw:token', ${JSON.stringify(me.token)}); return true;`);
// The token has to be there when the app boots, or the signed-in furniture —
// the cage, the profile chip — never appears and the dialog checks knock on
// doors that do not exist.
await send('Page.navigate', { url: base });
await wait(1500);
await watchForErrors(evaluate);

/* ------------------------------- the sweep -------------------------------- */

// Galaxy A-series and iPhones at 390; the cheap and the old at 360 and 320.
const WIDTHS = [390, 360, 320];

const ROUTES = [
  { hash: '#/', name: 'home', settle: '.room-tile, .game-card' },
  { hash: '#/shelf/casino', name: 'casino shelf', settle: '.game-card' },
  { hash: '#/shelf/cards', name: 'card shelf', settle: '.game-card' },
  { hash: '#/shelf/board', name: 'board shelf', settle: '.game-card' },
  { hash: '#/leaderboard', name: 'leaderboard', settle: '#view' },
  { hash: '#/titles', name: 'titles', settle: '#view' },
  { hash: '#/profile', name: 'profile', settle: '#view' },
  { hash: '#/how', name: 'how it works', settle: '#view' },
  { hash: '#/studio', name: 'studio', settle: '#view' },
];

/** The page must not be wider than the glass, and thumbs must fit buttons. */
async function fitCheck(name, width) {
  const fit = JSON.parse(await evaluate(`
    const doc = document.documentElement;
    // The worst offender, so a failure names the element instead of a number.
    let worst = null;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > doc.clientWidth + 1 && r.width > 8) {
        if (!worst || r.right > worst.right) {
          worst = { right: Math.round(r.right), tag: el.tagName.toLowerCase(),
            cls: String(el.className).split(' ')[0] || el.id || '?' };
        }
      }
    }
    // Tappability: primary interactive things a player must hit.
    const small = [];
    for (const el of document.querySelectorAll('button, a.btn, input, select, .game-card, .room-tile')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;   // hidden is fine
      if (el.closest('[hidden]')) continue;
      if (r.height < 32 && r.width < 32) {
        small.push((el.id || String(el.className).split(' ')[0] || el.tagName) + '@' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
    }
    return JSON.stringify({
      page: doc.clientWidth, scroll: doc.scrollWidth,
      worst, small: small.slice(0, 4), smallCount: small.length,
    });
  `));
  check(`${name} @${width}: nothing scrolls sideways`,
    fit.scroll <= fit.page + 1,
    fit.worst ? `${fit.scroll} in ${fit.page} — worst: .${fit.worst.cls} reaching ${fit.worst.right}` : `${fit.scroll} in ${fit.page}`);
  check(`${name} @${width}: everything tappable is thumb-sized`,
    fit.smallCount === 0, fit.smallCount ? `${fit.smallCount} tiny: ${fit.small.join(', ')}` : '');
}

for (const width of WIDTHS) {
  console.log(`\n  \x1b[2m— ${width}px wide —\x1b[0m`);
  await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 2, mobile: true });
  await wait(400);

  for (const route of ROUTES) {
    await evaluate(`location.hash = ${JSON.stringify(route.hash)}; return true;`);
    await wait(700);
    await evaluate(`document.querySelector('.si-skip')?.click(); return true;`);
    if (!(await waitFor(route.settle, 10000))) {
      check(`${route.name} @${width}: renders`, false, `nothing matching ${route.settle}`);
      continue;
    }
    await wait(300);
    await fitCheck(route.name, width);
    if (width === 320) await shot(`${route.name.replace(/\s+/g, '-')}-320`);
  }

  // The dialogs, which no route reaches.
  for (const [btn, name, close] of [
    ['#cageBtn', 'the cage', '#cageClose'],
    ['#themeBtn', 'the skin picker', '#themeClose'],
  ]) {
    await evaluate(`location.hash = '#/'; return true;`);
    await wait(500);
    await evaluate(`document.querySelector(${JSON.stringify(btn)})?.click(); return true;`);
    let open = false;
    for (let i = 0; i < 8 && !open; i++) {
      await wait(500);
      open = await evaluate(`return Boolean(document.querySelector('dialog[open]'))`);
    }
    if (!open) {
      const why = JSON.parse(await evaluate(`
        const b = document.querySelector(${JSON.stringify(btn)});
        return JSON.stringify({
          there: Boolean(b), hidden: b?.hidden ?? null,
          token: Boolean(localStorage.getItem('htfw:token')),
        });
      `));
      check(`${name} @${width}: opens`, false, JSON.stringify(why));
      continue;
    }
    check(`${name} @${width}: opens`, true);
    const box = JSON.parse(await evaluate(`
      const d = document.querySelector('dialog[open]');
      const r = d.getBoundingClientRect();
      return JSON.stringify({ w: Math.round(r.width), page: document.documentElement.clientWidth });
    `));
    check(`${name} @${width}: fits the glass`, box.w <= box.page, `${box.w} in ${box.page}`);
    await evaluate(`document.querySelector(${JSON.stringify(close)})?.click(); for (const d of document.querySelectorAll('dialog[open]')) d.close(); return true;`);
    await wait(300);
  }
}

const errors = await evaluate(`return window.__journeyErrors ?? []`);
check('nothing threw anywhere', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n  \x1b[2mscreenshots at 320px in android/fit-shots/\x1b[0m`);
cleanup();

const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.log('\n  \x1b[31mwhat failed:\x1b[0m');
  for (const r of bad) console.log(`  \x1b[31m  · ${r.label}\x1b[0m`);
}
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — every screen fits every phone\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
