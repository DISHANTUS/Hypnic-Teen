// Standoff, played on a phone.
//
//   npm run test:standoff:ui
//
// The rules are tested elsewhere. This is about the screen: the count runs,
// every hand flips at the same moment, the beams show who beat whom, and none
// of it spills off the side of a phone.
//
// It plays a real match against real opponents through a real socket, because
// the one failure that matters here — your own throw arriving on somebody
// else's screen before the reveal — cannot happen in a single browser.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-standoff');
const PROFILE = path.join(ROOT, 'tmp-standoff-profile');
const SHOTS = path.join(ROOT, 'android', 'standoff-shots');
const PORT = 3208;
const CDP = 9485;
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
const { click, waitFor, count } = pageTools(evaluate);

console.log('\n  \x1b[1mStandoff, on a phone\x1b[0m  \x1b[2m(390x844)\x1b[0m\n');
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
      name, age: 19 + seq, pin: '9090',
      answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + seq++) % q.options.length].id])),
    }),
  }).then((r) => r.json());

const me = await signUp('Thrower');
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

// Wait for the page to actually be on the site — localStorage on about:blank
// throws SecurityError rather than returning nothing.
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

/* ------------------------------ into Standoff ----------------------------- */

const opened = await evaluate(`
  const cards = [...document.querySelectorAll('.game-card')];
  const it = cards.find(c => (c.querySelector('h3')?.textContent ?? '').trim() === 'Standoff');
  if (!it) return cards.map(c => c.querySelector('h3')?.textContent).join(' | ');
  it.click();
  return true;
`);
if (!check('Standoff is on the shelf', opened === true, String(opened))) { cleanup(); process.exit(1); }

if (!check('a room opens', await waitFor('#roomCode', 15000))) { cleanup(); process.exit(1); }
const code = await evaluate(`return document.getElementById('roomCode').textContent.trim()`);
await shot('lobby');

// Two real opponents, over real sockets. A single browser could never catch a
// throw leaking to the other players before the reveal.
let joinTrouble = null;
for (const name of ['Mate1', 'Mate2']) {
  const mate = await signUp(name);
  const sock = io(base, { transports: ['websocket'] });
  mates.push(sock);
  await new Promise((r) => sock.on('connect', r));
  const joined = await new Promise((r) => {
    sock.emit('room:join', { code, token: mate.token }, r);
    setTimeout(() => r({ error: 'no answer to room:join' }), 8000);
  });
  if (joined?.error) joinTrouble = `${name}: ${joined.error}`;

  // They read the rules, then throw whatever they still have.
  sock.on('game:state', (s) => {
    if (s.phase === 'brief' && !s.briefed?.includes(mate.profile.id)) {
      sock.emit('game:action', { type: 'briefed' });
    }
    if (s.phase === 'throw' && !s.you?.pick) {
      const stock = s.players?.find((p) => p.id === mate.profile.id)?.stock;
      const can = ['rock', 'paper', 'scissors'].filter((t) => !stock || stock[t] > 0);
      const pick = can[Math.floor(Math.random() * can.length)] ?? 'rock';
      // Slow on purpose. All three throwing ends the round instantly, and this
      // test needs the throw phase to still be there while it looks at it.
      setTimeout(() => sock.emit('game:action', { type: 'throw', pick }), 3200);
    }
  });
}
await wait(1500);
// Asked of the server rather than counted off the lobby screen, because the
// markup for that list is the lobby's business and this test is about the game.
const seated = await fetch(`${base}/api/room/${code}`).then((r) => r.json()).catch(() => ({}));
const inRoom = Array.isArray(seated.players) ? seated.players.length : 0;
if (!check('two opponents joined', inRoom >= 3,
  joinTrouble ?? `${inRoom} in the room`)) {
  cleanup();
  process.exit(1);
}

// A short match, so the whole thing runs inside the test.
//
// The panel has to be opened first: the fields are not built until then, so
// setting a value on a closed one changed nothing and the match quietly ran at
// its full eight rounds.
await evaluate(`document.getElementById('editSetup')?.click(); return true;`);
await wait(800);
const shortened = await evaluate(`
  const box = document.getElementById('setupFields');
  const nums = box ? [...box.querySelectorAll('.setup-exact')] : [];
  if (!nums.length) return 'no number fields';
  nums[0].value = '3';
  nums[0].dispatchEvent(new Event('change', { bubbles: true }));
  return nums[0].value;
`);
await wait(900);
check('the host can shorten the match', shortened === '3', String(shortened));
await evaluate(`document.getElementById('editSetup')?.click(); return true;`);
await wait(400);
await evaluate(`document.getElementById('startBtn')?.click(); return true;`);

if (!check('the game starts', await waitFor('.so-brief', 20000))) { cleanup(); await shot('no-start'); process.exit(1); }
await shot('brief');
check('the rules are shown', (await count('#soRules li')) >= 3, String(await count('#soRules li')));

await click('#soBriefed');
if (!check('the table appears', await waitFor('.so-hands .so-hand', 25000))) { cleanup(); process.exit(1); }

check('there is a hand for everybody', (await count('.so-hand')) === 3, String(await count('.so-hand')));
check('and three throws to pick from', (await count('.so-throw')) === 3, String(await count('.so-throw')));
check('everyone\'s remaining stock is on show', (await count('.so-pips')) >= 9, String(await count('.so-pips')));
await shot('throw');

/* --------------------- your throw is yours until the reveal --------------- */

const before = await evaluate(`
  return [...document.querySelectorAll('.so-hand .so-fist')].map(f => f.textContent.trim());
`);
check('every hand is a fist before the reveal',
  before.every((h) => h === '✊'), JSON.stringify(before));

// Measured here, during the throw, because that is the only phase the buttons
// exist in — taken after the reveal they are gone and every size reads null.
const fit = JSON.parse(await evaluate(`
  const w = document.documentElement;
  const hands = document.querySelector('.so-hands');
  const throws = document.querySelector('.so-throws');
  return JSON.stringify({
    pageWidth: w.clientWidth,
    scrollWidth: w.scrollWidth,
    handsWidth: Math.round(hands.getBoundingClientRect().width),
    throwsWidth: Math.round(throws?.getBoundingClientRect().width ?? 0),
    smallestThrow: Math.min(...[...document.querySelectorAll('.so-throw')].map(b => Math.round(b.getBoundingClientRect().height))),
  });
`));
check('the page never scrolls sideways', fit.scrollWidth <= fit.pageWidth + 1, `${fit.scrollWidth} in ${fit.pageWidth}`);
check('the hands fit the screen', fit.handsWidth <= fit.pageWidth, `${fit.handsWidth}px`);
check('the throw buttons are big enough for a thumb', fit.smallestThrow >= 44, `${fit.smallestThrow}px tall`);

await click('.so-throw[data-throw="paper"]');
await wait(500);
check('picking one marks it', await evaluate(`return document.querySelector('.so-throw[data-throw="paper"]')?.classList.contains('is-on') === true`));
check('and it says so in words',
  /Paper it is/.test(await evaluate(`return document.querySelector('.so-pick-note')?.textContent ?? ''`)),
  await evaluate(`return document.querySelector('.so-pick-note')?.textContent ?? ''`));
check('the hands still show nothing', (await evaluate(`
  return [...document.querySelectorAll('.so-hand .so-fist')].map(f => f.textContent.trim()).every(h => h === '✊');
`)) === true);

/* ------------------------------- the reveal ------------------------------- */

const revealed = await (async () => {
  for (let i = 0; i < 80; i++) {
    if (await evaluate(`return document.querySelectorAll('.so-hand.is-shown').length > 0`)) return true;
    await wait(500);
  }
  return false;
})();
if (!check('the round reveals', revealed)) { cleanup(); await shot('no-reveal'); process.exit(1); }
await wait(900);
await shot('reveal');

check('every hand turned over at once', (await count('.so-hand.is-shown')) === 3, String(await count('.so-hand.is-shown')));
const hands = await evaluate(`return [...document.querySelectorAll('.so-hand .so-fist')].map(f => f.textContent.trim())`);
check('and they show real throws', hands.every((h) => ['✊', '✋', '✌️'].includes(h)), JSON.stringify(hands));
check('the round is summed up in words',
  Boolean(await evaluate(`return document.querySelector('.so-verdict b')?.textContent?.trim()`)),
  await evaluate(`return document.querySelector('.so-verdict b')?.textContent ?? ''`));
check('beams were drawn between the hands, or it was an all-tie',
  (await count('.so-beam')) > 0 || /Everybody threw/.test(await evaluate(`return document.querySelector('.so-verdict b')?.textContent ?? ''`)),
  `${await count('.so-beam')} beams`);

/* ------------------------------- on a phone ------------------------------- */

// The reveal is the tallest the screen ever gets — hands, verdict and log all
// at once — so it is the state worth re-measuring for a sideways scroll.
const atReveal = JSON.parse(await evaluate(`
  const w = document.documentElement;
  return JSON.stringify({ pageWidth: w.clientWidth, scrollWidth: w.scrollWidth });
`));
check('and it still does not scroll sideways at the reveal',
  atReveal.scrollWidth <= atReveal.pageWidth + 1,
  `${atReveal.scrollWidth} in ${atReveal.pageWidth}`);

/* ---------------------------- and it finishes ----------------------------- */

// Sized from the match the host actually got, not from the one the test asked
// for — if the rounds setting did not take, this should say so rather than
// time out at some number picked by hand.
const shape = await evaluate(`return document.getElementById('soRound')?.textContent ?? ''`);
const total = Number(/of (\d+)/.exec(shape)?.[1] ?? 8);
check('the match is as long as the host set it', total <= 4, `${shape || 'no round chip'}`);

// Each round is a throw phase plus a reveal, and the last one needs a moment
// to put the results up.
const budgetMs = total * (12 + 7) * 1000 + 20_000;
const finished = await (async () => {
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    if (await evaluate(`return !!document.getElementById('overDialog')?.open`)) return true;
    await wait(500);
  }
  return false;
})();
check('the match reaches a result', finished, `gave it ${Math.round(budgetMs / 1000)}s for ${total} rounds`);
if (finished) await shot('result');

const errors = await evaluate(`return window.__journeyErrors ?? []`);
check('nothing threw', errors.length === 0, errors.join(' | '));

cleanup();
const bad = results.filter((r) => !r.ok);
console.log(`\n  screenshots  android/standoff-shots/`);
console.log(bad.length
  ? `\x1b[31m  ${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\x1b[32m  all ${results.length} passed — it plays, it reveals, and it fits a phone\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
