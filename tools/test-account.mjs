// Losing your ID, and getting it back.
//
//   npm run test:account
//
// Three things that all failed in real use and none of which a server test
// would have caught:
//
//   the Titles page rendered nothing, because a new CSS class took a name an
//     old one was already using and absolutely-positioned every card
//   the notice told people to set a recovery question that had nowhere to be set
//   a button did nothing at all when the server was unreachable
//
// So this checks the screens, on a phone, with a real browser — including
// where things are on it, because "the element exists" was true every time.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-account');
const PROFILE = path.join(ROOT, 'tmp-account-profile');
const SHOTS = path.join(ROOT, 'android', 'account-shots');
const PORT = 3145;
const CDP = 9451;
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
const { click, textOf, count, typeInto, waitFor } = pageTools(evaluate);

console.log('\n  \x1b[1mLosing your ID, and getting it back\x1b[0m\n');
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

const { questions } = await fetch(`${base}/api/quiz`).then((r) => r.json());
const me = await fetch(`${base}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'Meera',
    age: 20,
    pin: '7788',
    answers: Object.fromEntries(questions.map((q) => [q.id, q.options[0].id])),
  }),
}).then((r) => r.json());
if (!check('an account exists', !me.error, me.profile?.id)) { cleanup(); process.exit(1); }

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
await evaluate(`localStorage.setItem('htfw:token', ${JSON.stringify(me.token)}); return true;`);
await send('Page.reload');
await wait(1200);
if (await waitFor('.si-skip', 4000)) await click('.si-skip');
if (!check('signed in', await waitFor('.game-card', 15000))) { cleanup(); process.exit(1); }
await watchForErrors(evaluate);

/* ------------------------------- the titles ------------------------------- */

// This page went blank because a badge class collided. Counting the cards is
// not enough — they were all still in the DOM, stacked in the top-right corner
// on top of the header. So this checks where they actually are.
await evaluate(`location.hash = '#/titles'; return true;`);
if (check('the titles page draws its cards', await waitFor('.badge', 8000), `${await count('.badge')} cards`)) {
  const laid = await evaluate(`
    const cards = [...document.querySelectorAll('.badge')];
    if (cards.length < 2) return null;
    const boxes = cards.slice(0, 6).map(c => c.getBoundingClientRect());
    // Stacked in a corner: every card at the same spot, and above the fold.
    const sameSpot = boxes.every(b => Math.abs(b.top - boxes[0].top) < 2 && Math.abs(b.left - boxes[0].left) < 2);
    return {
      sameSpot,
      firstTop: Math.round(boxes[0].top),
      distinctTops: new Set(boxes.map(b => Math.round(b.top))).size,
      offScreen: boxes.filter(b => b.right < 0 || b.left > innerWidth).length,
      overHeader: boxes.filter(b => b.top < 60).length,
    };
  `);
  check('the cards are laid out, not stacked on each other', laid && !laid.sameSpot, laid?.sameSpot ? 'all at one spot' : `${laid?.distinctTops} rows`);
  check('and none of them sits on top of the header', laid?.overHeader === 0, `${laid?.overHeader} over the header`);
  check('and none is off the side of the screen', laid?.offScreen === 0);
}
await shot('titles');

/* ------------------------- the notice, and its button --------------------- */

check('there is a bell', await evaluate(`return !document.getElementById('newsBtn').hidden`));

// The board itself is the source of truth for what is unread. The badge on
// screen may already have been cleared, because a first-time visitor gets the
// notice opened for them — a badge nobody notices is the same as no message.
const board = await fetch(`${base}/api/notices`, { headers: { authorization: `Bearer ${me.token}` } }).then((r) => r.json());
check('the studio has something to say to a new member', board.notices.length > 0, `${board.notices.length} notices`);

// Wherever the count sits, it must sit on the bell — this is the class that
// collided with the title cards, so it is worth pinning down.
const badgeAt = await evaluate(`
  const b = document.getElementById('newsCount'), btn = document.getElementById('newsBtn');
  b.hidden = false;                       // show it just long enough to measure
  b.textContent = '3';
  const r = b.getBoundingClientRect(), br = btn.getBoundingClientRect();
  const on = Math.abs(r.top - br.top) < 30 && Math.abs(r.right - br.right) < 30;
  b.hidden = true;
  return { on, pos: getComputedStyle(b).position, w: Math.round(r.width) };
`);
check('the unread count sits on the bell', badgeAt.on, `${badgeAt.pos}, ${badgeAt.w}px wide`);

await click('#newsBtn');
check('the board opens', await waitFor('#newsDialog[open] .notice', 6000), `${await count('.notice')} notices`);
check('and the notice says something', ((await textOf('.notice p')) ?? '').length > 20);
await shot('notices');

// The notice asks you to do something, so it has to be able to take you there.
const jump = await evaluate(`
  const b = [...document.querySelectorAll('.notice button')].find(x => /set it up/i.test(x.textContent));
  if (!b) return false;
  b.click();
  return true;
`);
check('a notice that asks for something carries the button that does it', jump);

/* ----------------------- and the place it takes you to -------------------- */

if (jump) {
  check('it lands on the recovery form', await waitFor('#recoveryForm:not([hidden]) #recQ', 8000), await evaluate(`return location.hash`));
  check('which is open and waiting, not hidden behind a toggle', await evaluate(`
    const f = document.getElementById('recoveryForm');
    return Boolean(f) && !f.hidden;
  `));
  check('and it says it is not set yet', ((await textOf('#recoveryState')) ?? '').includes('Not set'), await textOf('#recoveryState'));
  await shot('recovery-form');

  await typeInto('#recQ', 'What was my first school?');
  await typeInto('#recA', 'St Josephs');
  await click('#recSave');
  await wait(1200);
  check('setting it sticks', ((await textOf('#recoveryState')) ?? '').includes('Set'), await textOf('#recoveryState'));
  check('and the profile now says what the question is', ((await textOf('#recoveryBlurb')) ?? '').includes('first school'), await textOf('#recoveryBlurb'));
  await shot('recovery-set');
}

/* ------------------------------ losing it all ----------------------------- */

// Cleared browser, forgotten ID — the situation this was all built for.
await evaluate(`localStorage.clear(); return true;`);
await send('Page.reload');
await wait(1500);
if (await waitFor('.si-skip', 4000)) await click('.si-skip');
await waitFor('#haveIdBtn', 10000);
await click('#haveIdBtn');
check('the sign-in screen offers a way out', await waitFor('#forgotId', 8000));
await click('#forgotId');
check('which opens the recovery screen', await waitFor('#recName', 8000));

await typeInto('#recName', 'Meera');
await wait(900); // it looks up which question was set
check('it asks the question you chose', await evaluate(`return !document.getElementById('recAnswerField').hidden`), await textOf('#recQuestion'));

await typeInto('#recPin', '7788');
await typeInto('#recAnswer', 'st josephs'); // typed differently on purpose
await click('#recFind');
check('and hands the ID back', await waitFor('#recFound:not([hidden])', 8000), await textOf('#recId'));
check('the right one', (await textOf('#recId')) === me.profile.id, await textOf('#recId'));
await shot('recovered');

await click('#recGo');
check('one tap carries it into the sign-in box', await waitFor('#loginId', 8000));
check('already filled in', (await evaluate(`return document.getElementById('loginId').value`)) === me.profile.id);

await typeInto('#loginPin', '7788');
await click('#loginBtn');
check('and it signs you back in', await waitFor('.game-card', 10000));
await shot('back-in');

/* --------------------- and when the studio is not there ------------------- */

// A dead server used to make every button do nothing at all — no error, no
// change, which reads as a broken site rather than an unreachable one.
const offline = await evaluate(`
  const real = window.fetch;
  window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
  return new Promise(async (done) => {
    const { Auth } = await import('/js/auth.js');
    const res = await Auth.login('Hypnic>Nobody<Teen', '1111').catch((e) => ({ threw: String(e) }));
    window.fetch = real;
    done(res);
  });
`);
check('an unreachable studio says so instead of failing silently', Boolean(offline?.error) && !offline.threw, offline?.error ?? offline?.threw);

const thrown = await evaluate(`return (window.__journeyErrors ?? []).length`);
check('nothing threw', thrown === 0, thrown ? `${thrown} errors` : '');

cleanup();
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log(`\n  screenshots  android/account-shots/`);
console.log(`  ${passed}/${results.length} checks passed\n`);
for (const f of failed) console.log(`  \x1b[31m×\x1b[0m ${f.label}`);
process.exit(failed.length ? 1 : 0);
