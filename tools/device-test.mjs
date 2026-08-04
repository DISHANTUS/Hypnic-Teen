// The whole thing, on a real phone, by itself.
//
//   npm run device-test
//
// Installs the current APK, launches it, waits for the app to find this laptop
// on the network, then walks the entire journey on the handset: sign up, mint a
// Hypnic ID, open the arcade, host a game, play a round. A second player joins
// from the laptop, so this proves phone-to-PC multiplayer rather than just that
// one screen renders.
//
// The page is driven through Chrome DevTools over adb, so elements are clicked
// by selector rather than by pixel coordinate — a moved button doesn't break
// the test, and a missing one fails it honestly. The steps themselves live in
// lib/journey.mjs, shared with `npm run dry-run`.
//
// It runs its own throwaway server on a temporary data directory, so the test
// accounts never land in the real studio.
//
// Needs: phone plugged in, USB debugging on, phone UNLOCKED, port 8008 free.

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import path from 'node:path';
import { io } from 'socket.io-client';
import { WebSocket } from 'ws';
import { runJourney, watchForErrors, makeGuest } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const SDK = process.env.ANDROID_SDK || 'W:\\Android_SDK';
const ADB = path.join(SDK, 'platform-tools', 'adb.exe');
const PKG = 'com.hypnicteen.funworld';
const SHOTS = path.join(ROOT, 'android', 'test-shots');
const TMP_DATA = path.join(ROOT, 'tmp-device-test');
const PORT = 8008;
const CDP = 9333;
const base = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`${ok ? '\x1b[32m  ok  \x1b[0m' : '\x1b[31m FAIL \x1b[0m'} ${label}${extra ? `  \x1b[2m${extra}\x1b[0m` : ''}`);
  return ok;
};

// stderr is piped rather than inherited so tear-down attempts on things that
// were never set up don't print scary-looking noise over a clean run.
const adb = (...a) =>
  execFileSync(ADB, a, { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
let ws = null;
let guest = null;

function cleanup() {
  try { ws?.close(); } catch { }
  try { guest?.close(); } catch { }
  try { adb('forward', '--remove', `tcp:${CDP}`); } catch { }
  try { adb('reverse', '--remove', `tcp:${PORT}`); } catch { }
  try { adb('shell', 'svc', 'power', 'stayon', 'false'); } catch { }
  try { server?.kill(); } catch { }
  try { rmSync(TMP_DATA, { recursive: true, force: true }); } catch { }
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });

function report() {
  cleanup();
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`\n  screenshots  android/test-shots/`);
  console.log(`  ${passed}/${results.length} checks passed\n`);
  for (const f of failed) console.log(`  \x1b[31m×\x1b[0m ${f.label}`);
  if (failed.length) console.log('');
  process.exit(failed.length ? 1 : 0);
}

const bail = (msg) => { console.log(`\n  ${msg}\n`); cleanup(); process.exit(1); };

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
    adb('shell', 'screencap', '-p', '/sdcard/dt.png');
    adb('pull', '/sdcard/dt.png', path.join(SHOTS, `${String(++shotIndex).padStart(2, '0')}-${name}.png`));
    adb('shell', 'rm', '-f', '/sdcard/dt.png');
  } catch { /* a screenshot is never the point */ }
}

/* -------------------------------- preflight ------------------------------- */

mkdirSync(SHOTS, { recursive: true });
rmSync(TMP_DATA, { recursive: true, force: true });

console.log('\n  \x1b[1mHypnic Teen — on-device check\x1b[0m\n');

// The phone finds the host by scanning the subnet for 8008, so the throwaway
// server has to sit on the real port. A live studio there would both block us
// and collect the test accounts.
const portBusy = await new Promise((resolve) => {
  const sock = createConnection({ port: PORT, host: '127.0.0.1' })
    .on('connect', () => { sock.destroy(); resolve(true); })
    .on('error', () => resolve(false));
  setTimeout(() => { sock.destroy(); resolve(false); }, 1500);
});
if (portBusy) bail(`Port ${PORT} is busy — stop the running server first (this test starts its own).`);

const devices = adb('devices').split('\n').slice(1).filter((l) => l.includes('\tdevice'));
if (!check('phone connected', devices.length > 0, devices[0]?.split('\t')[0] ?? 'none')) {
  bail('Plug the phone in, turn on USB debugging, and accept the prompt on screen.');
}
const model = adb('shell', 'getprop', 'ro.product.model');
const osver = adb('shell', 'getprop', 'ro.build.version.release');

adb('shell', 'svc', 'power', 'stayon', 'usb');
adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
await wait(1200);
adb('shell', 'input', 'swipe', '540', '1600', '540', '500', '200'); // clears a swipe-only lock
await wait(1000);

if (!check('phone unlocked', !adb('shell', 'dumpsys window').includes('isKeyguardShowing=true'), `${model} · Android ${osver}`)) {
  bail('Unlock the phone (enter the PIN/pattern) and run it again.');
}

server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP_DATA, NODE_ENV: 'test' },
  stdio: 'ignore',
});
let up = false;
for (let i = 0; i < 40 && !up; i++) {
  await wait(250);
  up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
}
if (!check('test server running', up, `port ${PORT}, throwaway data`)) bail('Server would not start.');

/* ------------------------------ install & join ---------------------------- */

// The inspectable build, not the one that goes out to friends — driving the
// page needs WebView debugging, which the shipped build deliberately lacks.
const apk = path.join(ROOT, 'android', 'out', 'HypnicTeen-test.apk');
if (!existsSync(apk)) bail('No test build yet. Run `npm run apk:test` first.');
check('test APK installs', adb('install', '-r', apk).includes('Success'));

adb('shell', 'am', 'force-stop', PKG);
try { adb('shell', 'pm', 'clear', PKG); } catch { /* first install */ }
adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
await wait(2500);
check('app launches', adb('shell', 'dumpsys window').includes(PKG));

const dumpUi = () => {
  try {
    adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
    return adb('shell', 'cat', '/sdcard/ui.xml');
  } catch {
    return '';
  }
};
const tapBounds = (m, from) =>
  adb('shell', 'input', 'tap', String((+m[from] + +m[from + 2]) / 2), String((+m[from + 1] + +m[from + 3]) / 2));

// Discovery only has something to find when the phone and this laptop are on
// the same network. When they aren't, fall back to the USB cable rather than
// failing — but say which path was used, because "it connected" and "it found
// the host by itself" are different claims.
console.log('\x1b[2m         scanning the network…\x1b[0m');
let host = null;
for (let i = 0; i < 8 && !host; i++) {
  await wait(2500);
  const m = dumpUi().match(/text="Join\s+([\d.]+:\d+)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!m) continue;
  host = m[1];
  await shot('discovery');
  tapBounds(m, 2);
}

if (host) {
  check('app finds the host on its own', true, host);
} else {
  // Nothing on the subnet. Put the server on the phone's own localhost through
  // the cable and type that address in by hand, the way a player would.
  console.log('\x1b[2m         not on the same network — falling back to the USB cable\x1b[0m');
  adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
  const ui = dumpUi();
  const field = ui.match(/class="android.widget.EditText"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  const connect = ui.match(/text="Connect"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!field || !connect) {
    await shot('no-connect-screen');
    bail('Could not find the manual address box. Put the phone on the same WiFi as this laptop and retry.');
  }
  tapBounds(field, 1);
  await wait(500);
  adb('shell', 'input', 'text', `127.0.0.1:${PORT}`);
  await wait(300);
  tapBounds(connect, 1);
  await shot('manual-connect');
  console.log('\x1b[33m  note  \x1b[0mLAN discovery untested this run — phone and laptop are on different networks.');
}

/* ---------------------------- attach to the page -------------------------- */

await wait(4000);
const pid = adb('shell', 'pidof', PKG).trim().split(/\s+/)[0];
adb('forward', `tcp:${CDP}`, `localabstract:webview_devtools_remote_${pid}`);

let page = null;
for (let i = 0; i < 12 && !page; i++) {
  await wait(500);
  const list = await fetch(`http://127.0.0.1:${CDP}/json`).then((r) => r.json()).catch(() => []);
  page = list.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
}
if (!check('page is inspectable', Boolean(page), page?.url)) {
  bail('No WebView showed up. Rebuild with `npm run apk:test` — it needs the inspectable build.');
}

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
await watchForErrors(evaluate);

/* ------------------------------- the journey ------------------------------ */

guest = await makeGuest(io, base);

try {
  await runJourney({ evaluate, check, shot, base, label: 'device', joinAsSecondPlayer: guest.join });
} catch (err) {
  check('journey ran to the end', false, err.message);
  await shot('crash');
}

report();
