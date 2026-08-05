// Walks every screen in a real browser and reports what looks wrong.
//
//   npm run sweep
//
// The suites all pass while a page can still be unusable: the proxy framed
// every response twice and curl called it 200, and the login page told
// everyone the studio was down while serving them. Both were invisible to
// anything that was not a browser looking at a rendered page.
//
// So this asks the questions a person would, on a phone-sized screen:
// did anything throw, is the screen empty, does it scroll sideways, is
// anything off the edge, are there broken images, is something covering the
// page. It reports rather than asserts a fixed list, because the point is to
// find what nobody thought to write a test for.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-sweep');
const PROFILE = path.join(ROOT, 'tmp-sweep-profile');
const SHOTS = path.join(ROOT, 'android', 'sweep-shots');
const PORT = 3192;
const CDP = 9463;
const base = `http://127.0.0.1:${PORT}`;

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);

const findings = [];
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

console.log('\n  \x1b[1mSweeping every screen\x1b[0m  \x1b[2m(390x780, real Chrome)\x1b[0m\n');
if (!CHROME) { console.log('  no Chromium found'); process.exit(1); }

mkdirSync(SHOTS, { recursive: true });
for (const d of [TMP, PROFILE]) rmSync(d, { recursive: true, force: true });

server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP, NODE_ENV: 'test', LLM_BOTS: '0', STUDY_PROXY: '0' },
  stdio: 'ignore',
});
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await wait(250);
  up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
}
if (!up) { console.log('  server never came up'); cleanup(); process.exit(1); }

const { questions } = await fetch(`${base}/api/quiz`).then((r) => r.json());
const me = await fetch(`${base}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'Sweeper', age: 20, pin: '1234',
    answers: Object.fromEntries(questions.map((q) => [q.id, q.options[0].id])),
  }),
}).then((r) => r.json());

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
if (!page) { console.log('  browser never attached'); cleanup(); process.exit(1); }

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
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });

await evaluate(`
  localStorage.setItem('htfw:token', ${JSON.stringify(me.token)});
  return true;
`);
await send('Page.reload');
await wait(1500);
await evaluate(`document.querySelector('.si-skip')?.click(); return true;`);
await wait(1200);
// A new member is shown the studio notice once, on purpose. A person clicks
// through it and then looks at the site; so does this. Leaving it up would
// report the same covering-dialog on every screen and bury anything real.
await evaluate(`for (const d of document.querySelectorAll('dialog[open]')) d.close(); return true;`);
await wait(800);

// Anything the page throws, from here on, belongs to whichever screen was up.
await evaluate(`
  window.__sweep = [];
  addEventListener('error', (e) => window.__sweep.push('error: ' + e.message));
  addEventListener('unhandledrejection', (e) => window.__sweep.push('rejection: ' + e.reason));
  const realError = console.error;
  console.error = (...a) => { window.__sweep.push('console: ' + a.map(String).join(' ').slice(0, 140)); realError(...a); };
  return true;
`);

/** Everything a person would notice about the screen in front of them. */
const LOOK = `
  const doc = document.documentElement;
  const view = document.getElementById('view');
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const all = [...document.querySelectorAll('#view *')].filter(vis);
  return {
    text: (view?.innerText ?? '').trim().length,
    elements: all.length,
    sideways: doc.scrollWidth > doc.clientWidth + 2,
    offRight: all.filter((el) => el.getBoundingClientRect().right > innerWidth + 2).length,
    brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getClientRects().length > 0).length,
    covering: document.querySelector('dialog[open]')?.id ?? null,
    // Text that leaked a template or an undefined into the page.
    leaks: ((view?.innerText ?? '').match(/undefined|\\[object |NaN|\\$\\{/g) ?? []).length,
    thrown: (window.__sweep ?? []).length,
    lastThrow: (window.__sweep ?? [])[0] ?? null,
  };
`;

const SCREENS = [
  ['arcade', '#/'],
  ['leaderboard', '#/leaderboard'],
  ['titles', '#/titles'],
  ['profile', '#/profile'],
  ['studio', '#/studio'],
  ['how to play', '#/how'],
];

let shot = 0;
for (const [name, hash] of SCREENS) {
  await evaluate(`window.__sweep = []; location.hash = ${JSON.stringify(hash)}; return true;`);
  await wait(1800);
  let look;
  try {
    look = await evaluate(LOOK);
  } catch (err) {
    findings.push([name, `the page threw while being looked at: ${err.message}`]);
    continue;
  }

  const problems = [];
  if (look.text < 20) problems.push(`almost no text (${look.text} chars) — screen looks empty`);
  if (look.sideways) problems.push('scrolls sideways on a phone');
  if (look.offRight) problems.push(`${look.offRight} element(s) off the right edge`);
  if (look.brokenImages) problems.push(`${look.brokenImages} broken image(s)`);
  if (look.leaks) problems.push(`${look.leaks} place(s) showing undefined/NaN/a raw template`);
  if (look.thrown) problems.push(`threw: ${look.lastThrow}`);
  if (look.covering) problems.push(`covered by <dialog id="${look.covering}">`);

  console.log(
    `  ${problems.length ? '\x1b[31mFAIL\x1b[0m' : '\x1b[32m ok \x1b[0m'}  ${name.padEnd(14)}` +
      `\x1b[2m${look.elements} elements, ${look.text} chars\x1b[0m`
  );
  for (const p of problems) {
    console.log(`        \x1b[31m→\x1b[0m ${p}`);
    findings.push([name, p]);
  }

  try {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(SHOTS, `${String(++shot).padStart(2, '0')}-${name.replace(/\s+/g, '-')}.png`), Buffer.from(data, 'base64'));
  } catch { /* a screenshot is never the point */ }
}

/* --------------------------- the panels and sheets ------------------------ */

// Dialogs are where the late features live and where the test coverage is
// thinnest, so each is opened and looked at the same way.
const SHEETS = [
  ['members', `document.getElementById('peopleBtn')?.click()`, '#peopleDialog'],
  ['notices', `document.getElementById('newsBtn')?.click()`, '#newsDialog'],
  ['new tournament', `location.hash='#/'; setTimeout(()=>document.getElementById('newCupBtn')?.click(), 900)`, '#cupDialog'],
];

for (const [name, open, sel] of SHEETS) {
  await evaluate(`
    window.__sweep = [];
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    ${open};
    return true;
  `);
  await wait(2000);
  const look = await evaluate(`
    const dlg = document.querySelector(${JSON.stringify(sel)});
    if (!dlg || !dlg.open) return { missing: true, thrown: (window.__sweep ?? []).length, lastThrow: (window.__sweep ?? [])[0] ?? null };
    const r = dlg.getBoundingClientRect();
    return {
      missing: false,
      text: dlg.innerText.trim().length,
      offBottom: r.bottom > innerHeight + 2,
      offRight: r.right > innerWidth + 2,
      tooWide: r.width > innerWidth,
      leaks: (dlg.innerText.match(/undefined|\\[object |NaN/g) ?? []).length,
      thrown: (window.__sweep ?? []).length,
      lastThrow: (window.__sweep ?? [])[0] ?? null,
    };
  `);

  const problems = [];
  if (look.missing) problems.push('did not open');
  else {
    if (look.text < 10) problems.push(`almost no text (${look.text} chars)`);
    if (look.tooWide || look.offRight) problems.push('wider than the screen');
    if (look.leaks) problems.push(`${look.leaks} place(s) showing undefined/NaN`);
  }
  if (look.thrown) problems.push(`threw: ${look.lastThrow}`);

  console.log(
    `  ${problems.length ? '\x1b[31mFAIL\x1b[0m' : '\x1b[32m ok \x1b[0m'}  ${name.padEnd(14)}\x1b[2m${look.missing ? '' : `${look.text} chars`}\x1b[0m`
  );
  for (const p of problems) {
    console.log(`        \x1b[31m→\x1b[0m ${p}`);
    findings.push([name, p]);
  }
}

/* --------------------------------- report -------------------------------- */

cleanup();
console.log(`\n  screenshots  android/sweep-shots/`);
if (!findings.length) {
  console.log(`  \x1b[32mnothing looked wrong on any screen\x1b[0m\n`);
} else {
  console.log(`\n  \x1b[31m${findings.length} thing(s) to look at\x1b[0m`);
  for (const [where, what] of findings) console.log(`    ${where}: ${what}`);
  console.log('');
}
process.exit(findings.length ? 1 : 0);
