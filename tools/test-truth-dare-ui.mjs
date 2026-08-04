// Truth or Dare on a phone.
//
//   npm run test:td:ui
//
// Three things went wrong in real play that a server-side test could never
// catch, and all three are checked here on a phone-sized screen:
//
//   the bottle pointed somewhere other than the person it had landed on
//   everyone except the two people involved was shown a blank panel
//   the page could not be scrolled, so the panel was off the bottom
//
// The last one is the reason this measures geometry rather than just counting
// elements: "the button exists" was true the whole time it was unreachable.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-td-ui');
const PROFILE = path.join(ROOT, 'tmp-td-profile');
const SHOTS = path.join(ROOT, 'android', 'td-shots');
const PORT = 3138;
const CDP = 9449;
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
const ask = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));

let server = null;
let browser = null;
let ws = null;
const mates = [];

function cleanup() {
  for (const m of mates) { try { m.socket.close(); } catch { } }
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

/* --------------------------------- setup --------------------------------- */

console.log('\n  \x1b[1mTruth or Dare, on a phone\x1b[0m\n');
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
if (!check('test server running', up, `port ${PORT}`)) { cleanup(); process.exit(1); }

const { questions } = await fetch(`${base}/api/quiz`).then((r) => r.json());
let seq = 0;
const signUp = (name) =>
  fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      age: 18 + seq,
      pin: '6666',
      answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + seq++) % q.options.length].id])),
    }),
  }).then((r) => r.json());

const me = await signUp('Watcher');
if (!check('the player under test has an account', !me.error, me.error ?? '')) { cleanup(); process.exit(1); }

// A small phone, because that is where this broke.
browser = spawn(CHROME, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROFILE}`, '--headless=new',
  '--window-size=360,640', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--autoplay-policy=no-user-gesture-required', base,
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
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 2, mobile: true });
await evaluate(`localStorage.setItem('htfw:token', ${JSON.stringify(me.token)}); return true;`);
await send('Page.reload');
await wait(1200);
if (await waitFor('.si-skip', 4000)) await click('.si-skip');
if (!check('signed in on a 360×640 screen', await waitFor('.game-card', 15000))) { cleanup(); process.exit(1); }
await watchForErrors(evaluate);

/* ------------------------------ into a match ------------------------------ */

await evaluate(`
  const all = [...document.querySelectorAll('.game-card')];
  const td = all.find(c => (c.querySelector('h3')?.textContent ?? '').trim() === 'Truth or Dare');
  (td ?? all[0]).click();
  return true;
`);
if (!check('a room opens', await waitFor('#roomCode', 15000))) { cleanup(); process.exit(1); }
const code = await textOf('#roomCode');

// Three others, so the browser under test is usually a spectator — which is
// the seat the bug was reported from.
for (const name of ['Mate1', 'Mate2', 'Mate3']) {
  const acct = await signUp(name);
  const socket = io(base, { transports: ['websocket'], reconnection: false });
  await new Promise((r) => socket.once('connect', r));
  await ask(socket, 'room:join', { code, token: acct.token });
  socket.on('game:state', (s) => {
    if (s.phase === 'intro') socket.emit('game:action', { type: 'ready' });
    // Whoever they are this round, they play their part promptly.
    if (s.phase === 'choose' && s.askedId === s.you?.id) socket.emit('game:action', { type: 'choice', choice: 'dare' });
    if (s.phase === 'write' && s.askerId === s.you?.id && !s.question) {
      socket.emit('game:action', { type: 'question', text: 'Do ten push-ups right here' });
    }
    if (s.phase === 'act' && s.askedId === s.you?.id) socket.emit('game:action', { type: 'did-it' });
    if (s.phase === 'verdict' && s.askerId === s.you?.id && !s.verdict) {
      socket.emit('game:action', { type: 'verdict', ok: true });
    }
  });
  mates.push({ socket, token: acct.token });
}
await wait(1500);
await click('#startBtn');

if (!check('the rules come up', await waitFor('.td-brief .intro-rules li', 20000))) { cleanup(); process.exit(1); }
await shot('briefing');
await click('#tdBriefed');
if (!check('the circle appears', await waitFor('.td-seat', 20000), `${await count('.td-seat')} seats`)) { cleanup(); process.exit(1); }

/* ---------------------------- the bottle points --------------------------- */

// Wait out the spin, then measure where the neck actually is against where the
// highlighted seat actually is. This is the bug: the bottle was landing at an
// angle offset by wherever it had stopped last time.
await wait(7000);
const aim = await evaluate(`
  const ring = document.querySelector('.td-ring');
  const asked = document.querySelector('.td-seat.asked');
  if (!ring || !asked) return null;
  const r = ring.getBoundingClientRect();
  const a = asked.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  // Bearing from the middle of the circle to the highlighted player, measured
  // the same way the bottle measures its own: zero is up, clockwise.
  const seatDeg = (Math.atan2((a.top + a.height/2) - cy, (a.left + a.width/2) - cx) * 180 / Math.PI + 90 + 360) % 360;
  return { seatDeg, bottleDeg: (window.__tdAngle ?? null) };
`);
const bottleDeg = await evaluate(`return window.__tdAngle ?? null`);
if (aim && bottleDeg !== null) {
  const diff = Math.abs(((bottleDeg - aim.seatDeg) % 360 + 540) % 360 - 180);
  check('the bottle points at the person it landed on', diff < 40, `${Math.round(diff)}° off`);
} else {
  check('the bottle reports where it is pointing', false, 'no angle exposed');
}
await shot('bottle');

/* --------------------------- everyone can follow -------------------------- */

// Whoever the bottle picks, somebody has to act or the round sits on a
// fifty-second writing clock and nothing is ever on screen to look at. So the
// browser plays its own part too, and we watch for the round where it is
// neither the one asked nor the one asking — that is the seat the bug was
// reported from.
let sawAsSpectator = null;
const deadline = Date.now() + 150_000;

while (Date.now() < deadline && !sawAsSpectator) {
  const now = await evaluate(`
    const panel = document.querySelector('.td-panel-in');
    return {
      phase: document.getElementById('tdPhase')?.textContent ?? '',
      heading: panel?.querySelector('h3')?.textContent ?? '',
      question: document.querySelector('.td-question')?.textContent ?? null,
      kind: document.querySelector('.td-kind')?.textContent ?? null,
      // Which chair are we in this round?
      mine: {
        asked: (document.querySelector('.td-seat.asked b')?.textContent ?? '').includes('Watcher'),
        asker: (document.querySelector('.td-seat.asker b')?.textContent ?? '').includes('Watcher'),
      },
      // Whatever the panel is offering us to press.
      writer: Boolean(panel?.querySelector('textarea')),
      buttons: [...(panel?.querySelectorAll('button') ?? [])].map((b) => b.textContent),
    };
  `);

  // Play our own part promptly so the match keeps moving.
  if (now.writer) {
    await evaluate(`
      const a = document.querySelector('.td-panel-in textarea');
      if (a) { a.value = 'Say the alphabet backwards'; a.dispatchEvent(new Event('input',{bubbles:true})); }
      [...document.querySelectorAll('.td-panel-in button')].find(b => /send/i.test(b.textContent))?.click();
      return true;
    `);
  } else if (now.buttons.some((b) => /truth|dare/i.test(b))) {
    await evaluate(`[...document.querySelectorAll('.td-choice')][1]?.click(); return true;`);
  } else if (now.buttons.some((b) => /I did it/i.test(b))) {
    await evaluate(`[...document.querySelectorAll('.td-panel-in button')].find(b => /I did it/i.test(b.textContent))?.click(); return true;`);
  } else if (now.buttons.some((b) => /they did it/i.test(b))) {
    await evaluate(`[...document.querySelectorAll('.td-panel-in button')].find(b => /they did it/i.test(b.textContent))?.click(); return true;`);
  }

  // A round where we are only watching, and there is a question on the table.
  if (!now.mine.asked && !now.mine.asker && now.question) {
    sawAsSpectator = now;
  }
  await wait(500);
}

if (check('a spectator can read the question', Boolean(sawAsSpectator), sawAsSpectator?.question ?? 'never saw one while watching')) {
  check('and is told whether it is a truth or a dare', /TRUTH|DARE/.test(sawAsSpectator.kind ?? ''), sawAsSpectator.kind);
  check('and who is on the spot', sawAsSpectator.heading.length > 0, sawAsSpectator.heading);
}
await shot('spectating');

// …and it must still be there at the result, beside the answer, or the room
// reads a reply to a question it never saw.
const gotResult = await waitFor('.td-scores, .td-nickname, .td-quote', 60000);
check('the result still shows what was asked', gotResult && (await count('.td-question')) > 0);
await shot('result');

/* -------------------------------- on a phone ------------------------------ */

// Everything above can be true while the screen is still unusable.
const fits = await evaluate(`
  const doc = document.documentElement;
  return {
    sideways: doc.scrollWidth > doc.clientWidth + 2,
    stage: (() => {
      const w = document.getElementById('stageWrap');
      if (!w) return null;
      const style = getComputedStyle(w);
      return { overflowY: style.overflowY, touch: style.touchAction, canScroll: w.scrollHeight > w.clientHeight };
    })(),
  };
`);
check('the page never scrolls sideways', !fits.sideways);
check('the game area scrolls vertically', fits.stage?.overflowY === 'auto', fits.stage?.overflowY);
check('and a finger can do it', fits.stage?.touch !== 'none', `touch-action: ${fits.stage?.touch}`);

// The controls have to be reachable, not merely present — scroll to the
// bottom and confirm something interactive is on screen.
const reachable = await evaluate(`
  const w = document.getElementById('stageWrap');
  if (w) w.scrollTop = w.scrollHeight;
  return new Promise((done) => setTimeout(() => {
    const seats = [...document.querySelectorAll('.td-seat')];
    const panel = document.querySelector('.td-panel-in');
    const inView = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight && r.width > 0;
    };
    done({ panel: inView(panel), seats: seats.filter(inView).length, total: seats.length });
  }, 400));
`);
check('the panel can be scrolled into view', reachable.panel);
check('every seat in the circle is on screen', reachable.seats === reachable.total, `${reachable.seats} of ${reachable.total}`);
await shot('scrolled');

const thrown = await evaluate(`return (window.__journeyErrors ?? []).length`);
check('nothing threw', thrown === 0, thrown ? `${thrown} errors` : '');

cleanup();
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log(`\n  screenshots  android/td-shots/`);
console.log(`  ${passed}/${results.length} checks passed\n`);
for (const f of failed) console.log(`  \x1b[31m×\x1b[0m ${f.label}`);
process.exit(failed.length ? 1 : 0);
