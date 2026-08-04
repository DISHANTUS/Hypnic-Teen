// The on-device journey, rehearsed in desktop Chrome.
//
//   npm run dry-run
//
// Runs the exact steps tools/device-test.mjs runs on the phone, against a real
// Chrome on this laptop. It won't catch anything phone-specific — WebView
// quirks, the network scan, touch — but it does catch every selector rename and
// broken step in seconds instead of after a ten-minute install-and-tap cycle.
//
// Starts its own server on a temporary data directory, so nothing it creates
// reaches the real studio.

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';
import { WebSocket } from 'ws';
import { runJourney, watchForErrors, makeGuest, checkInvite } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP_DATA = path.join(ROOT, 'tmp-dry-run');
const PROFILE = path.join(ROOT, 'tmp-dry-profile');
const SHOTS = path.join(ROOT, 'android', 'dry-run-shots');
const PORT = 3131;
const CDP = 9444;
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
let guest = null;

function cleanup() {
  try { ws?.close(); } catch { }
  try { guest?.close(); } catch { }
  try { browser?.kill(); } catch { }
  try { server?.kill(); } catch { }
  for (const dir of [TMP_DATA, PROFILE]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { }
  }
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });

/* ------------------------------ CDP plumbing ----------------------------- */

let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)); }, 15000);
  });
}

async function evaluate(body) {
  const res = await send('Runtime.evaluate', {
    expression: `(function(){${body}})()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  }
  return res.result?.value;
}

let shotIndex = 0;
async function shot(name) {
  try {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path.join(SHOTS, `${String(++shotIndex).padStart(2, '0')}-${name}.png`), Buffer.from(data, 'base64'));
  } catch { /* a screenshot is never the point */ }
}

/* --------------------------------- run ----------------------------------- */

console.log('\n  \x1b[1mJourney dry run\x1b[0m  \x1b[2m(desktop Chrome)\x1b[0m\n');

if (!check('a Chromium browser is installed', Boolean(CHROME), CHROME ? path.basename(CHROME) : 'none found')) {
  cleanup();
  process.exit(1);
}

mkdirSync(SHOTS, { recursive: true });
rmSync(TMP_DATA, { recursive: true, force: true });
rmSync(PROFILE, { recursive: true, force: true });

server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP_DATA, NODE_ENV: 'test' },
  stdio: 'ignore',
});
let up = false;
for (let i = 0; i < 40 && !up; i++) {
  await wait(250);
  up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
}
if (!check('test server running', up, `port ${PORT}, throwaway data`)) { cleanup(); process.exit(1); }

// Phone-sized window, so the layout under test is the one the phone will show.
browser = spawn(CHROME, [
  `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${PROFILE}`,
  '--headless=new',
  '--window-size=412,915',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--autoplay-policy=no-user-gesture-required',
  base,
], { stdio: 'ignore' });

let page = null;
for (let i = 0; i < 40 && !page; i++) {
  await wait(300);
  const list = await fetch(`http://127.0.0.1:${CDP}/json`).then((r) => r.json()).catch(() => []);
  page = list.find((p) => p.type === 'page' && p.webSocketDebuggerUrl && !p.url.startsWith('devtools'));
}
if (!check('browser attached', Boolean(page), page?.url)) { cleanup(); process.exit(1); }

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
await watchForErrors(evaluate);

guest = await makeGuest(io, base);

try {
  await runJourney({
    evaluate,
    check,
    shot,
    base,
    label: 'dry',
    joinAsSecondPlayer: guest.join,
  });
  // A third player opens their own room and calls everyone in, so the invite
  // banner is exercised the way it actually happens.
  const caller = await makeGuest(io, base);
  await checkInvite({
    evaluate,
    check,
    shot,
    hostElsewhere: async () => {
      const made = await new Promise((r) => caller.socket.emit('room:create', { gameId: 'quiz', token: caller.token }, r));
      if (made?.error) return null;
      const sent = await new Promise((r) => caller.socket.emit('room:invite', {}, r));
      return sent?.error ? null : made.code;
    },
  });
  caller.close();
} catch (err) {
  check('journey ran to the end', false, err.message);
  await shot('crash');
}

cleanup();

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log(`\n  screenshots  android/dry-run-shots/`);
console.log(`  ${passed}/${results.length} checks passed\n`);
for (const f of failed) console.log(`  \x1b[31m×\x1b[0m ${f.label}`);
if (failed.length) console.log('');
process.exit(failed.length ? 1 : 0);
