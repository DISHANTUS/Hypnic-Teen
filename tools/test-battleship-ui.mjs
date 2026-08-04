// Ship Attack in a real browser: does the renderer mount, draw, and fire?
//
//   npm run test:battleship:ui
//
// The rules are covered in-process by test-battleship.mjs. This checks the
// half that only fails on screen — grids that don't build, a fleet that
// doesn't show, a shot that doesn't reach the server.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';
import { WebSocket } from 'ws';
import { pageTools, makeGuest } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-bsui');
const PROFILE = path.join(ROOT, 'tmp-bsui-profile');
const SHOTS = path.join(ROOT, 'android', 'dry-run-shots');
const PORT = 3161;
const CDP = 9477;
const base = `http://127.0.0.1:${PORT}`;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(TMP, { recursive: true, force: true });
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP, NODE_ENV: 'test' },
  stdio: 'ignore',
});
for (let i = 0; i < 40; i++) {
  await wait(250);
  if (await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false)) break;
}

const browser = spawn(CHROME, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROFILE}`, '--headless=new',
  '--window-size=900,1000', '--no-first-run', '--no-default-browser-check', base,
], { stdio: 'ignore' });

let page = null;
for (let i = 0; i < 40 && !page; i++) {
  await wait(300);
  const list = await fetch(`http://127.0.0.1:${CDP}/json`).then((r) => r.json()).catch(() => []);
  page = list.find((p) => p.type === 'page' && p.webSocketDebuggerUrl && !p.url.startsWith('devtools'));
}
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((r) => ws.once('open', r));
let id = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  const s = pending.get(m.id);
  if (s) { pending.delete(m.id); s(m.result); }
});
const send = (method, params = {}) =>
  new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (body) => {
  const r = await send('Runtime.evaluate', { expression: `(function(){${body}})()`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');
await evaluate(`
  window.__err = [];
  addEventListener('error', (e) => window.__err.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => window.__err.push(String(e.reason)));
  sessionStorage.setItem('htfw:intro:f8', '1');   // skip the studio opening
  return true;
`);

const shot = async (name) => {
  try {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(SHOTS, `bs-${name}.png`), Buffer.from(data, 'base64'));
  } catch { }
};

const { click, textOf, count, typeInto, waitFor } = pageTools(evaluate);

/* ------------------------------ sign in & host ---------------------------- */

await evaluate(`location.reload(); return true;`);
await wait(1200);
await waitFor('.wordmark', 15000);
await click('#createIdBtn');
await waitFor('#suName');
await typeInto('#suName', 'Admiral');
await typeInto('#suAge', '19');
await click('#nextStep');
await wait(700);
for (let i = 0; i < 10; i++) {
  if (await evaluate(`return !!document.querySelector('#suPin')`)) break;
  await click('.options .option');
  await wait(600);
}
await typeInto('#suPin', '1111');
await click('#nextStep');
await waitFor('#revealId', 15000);
await click('#enterStudioBtn');
check('arcade loads', await waitFor('.game-card'));

const listed = await evaluate(`
  const card = [...document.querySelectorAll('.game-card')]
    .find(c => (c.querySelector('h3')?.textContent ?? '').trim() === 'Ship Attack');
  if (!card) return 'missing';
  return card.disabled ? 'disabled' : 'playable';
`);
check('Ship Attack is on the shelf and playable', listed === 'playable', listed);

await evaluate(`
  [...document.querySelectorAll('.game-card')]
    .find(c => (c.querySelector('h3')?.textContent ?? '').trim() === 'Ship Attack').click();
  return true;
`);
check('a room opens', await waitFor('#roomCode', 15000), await textOf('#roomCode'));
const code = await textOf('#roomCode');

const guest = await makeGuest(io, base);
guest.socket.on('game:state', (s) => {
  // The briefing and the deployment are both dismissed with `ready`.
  if (s.phase === 'brief' || s.phase === 'place') guest.socket.emit('game:action', { type: 'ready' });
});
check('an opponent joins', !(await guest.join(code)));
await wait(1200);

await click('#startBtn');

/* -------------------------------- briefing -------------------------------- */

// Like every other game here, the rules come first with the clock stopped.
check('the rules come up before the clock starts', await waitFor('.bs-brief .intro-rules li', 20000));
const ruleLines = await count('.bs-brief .intro-rules li');
check('the briefing actually explains the game', ruleLines >= 3, `${ruleLines} lines`);
const classCards = await count('.bs-class');
check('and introduces the fleet by class', classCards === 4, `${classCards} classes`);
check('each class is drawn, not described', (await count('.bs-class svg.hull')) === 4);
await shot('briefing');
await click('#bsBriefed');

/* -------------------------------- deploying ------------------------------- */

// Wait for painted content, not the empty shell — .bs-deploy ships in the
// initial markup and would pass this check before any state had arrived.
check('the deploy screen appears', await waitFor('.bs-ship', 20000));
const yard = await count('.bs-ship');
check('all ten ships are in the yard', yard === 10, `${yard} ships`);
check('every ship in the yard is drawn as a ship', (await count('.bs-ship svg.hull')) === 10);
check('and named, so you know what you are placing', (await count('.bs-ship-name')) === 10);
const named = await evaluate(`return [...new Set([...document.querySelectorAll('.bs-ship-name')].map(e => e.textContent))].sort().join(', ')`);
check('the fleet has four different classes', named.split(', ').length === 4, named);

// Ships on the board are silhouettes too, not featureless blocks.
check('ships on your sea are drawn as hulls', (await count('.bs-cell.ship svg.hull-slice')) === 20, `${await count('.bs-cell.ship svg.hull-slice')} squares drawn`);
const gridCount = await count('.bs-grid');
check('both seas are drawn', gridCount >= 2, `${gridCount} grids`);
const cells = await evaluate(`
  const g = document.querySelector('.bs-grid');
  return g ? g.querySelectorAll('.bs-cell').length : -1;
`);
check('a sea is a hundred squares', cells === 100, `${cells} cells`);
const myShips = await evaluate(`return document.querySelectorAll('.bs-grid')[0].querySelectorAll('.bs-cell.ship').length`);
check('your own fleet is visible on your sea', myShips === 20, `${myShips} parts`);
const enemyShips = await evaluate(`
  const grids = [...document.querySelectorAll('.bs-grid')];
  return grids.slice(1).reduce((n, g) => n + g.querySelectorAll('.bs-cell.ship').length, 0);
`);
check("the enemy's fleet is not", enemyShips === 0, `${enemyShips} parts showing`);
await shot('deploy');

await click('#bsShuffle');
await wait(700);
check('shuffle lays out a new fleet', (await evaluate(`return document.querySelectorAll('.bs-grid')[0].querySelectorAll('.bs-cell.ship').length`)) === 20);

/* ------------------------------ sailing light ----------------------------- */

// You may leave ships in port. Fewer hulls is a smaller target, and the
// tonnage you gave up comes back as intel and energy — the point is that the
// player can see that trade before they commit to it.
const partsBefore = await evaluate(`return document.querySelectorAll('.bs-grid')[0].querySelectorAll('.bs-cell.ship').length`);
await evaluate(`document.querySelector('.bs-ship .bs-ship-drop')?.click(); return true;`);
await wait(700);
const partsAfter = await evaluate(`return document.querySelectorAll('.bs-grid')[0].querySelectorAll('.bs-cell.ship').length`);
check('a ship can be left in port', partsAfter < partsBefore, `${partsBefore} → ${partsAfter} squares afloat`);
check('and she waits on the dock', (await count('.bs-port .bs-ship')) === 1);
check('the trade is spelled out before you commit', ((await textOf('#bsLight')) ?? '').toLowerCase().includes('energy'), await textOf('#bsLight'));
await shot('sailing-light');

// And she can be recalled, because changing your mind is normal.
await click('.bs-port .bs-ship');
await wait(700);
check('and she can be recalled', (await evaluate(`return document.querySelectorAll('.bs-grid')[0].querySelectorAll('.bs-cell.ship').length`)) === partsBefore);
check('the dock is empty again', (await count('.bs-port .bs-ship')) === 0);

await click('#bsReady');

/* ------------------------------- the radar -------------------------------- */

// Wait for a power button, not for the canvas: the scopes ship in the static
// markup, so waiting on `.bs-radar` passes before the battle has even begun.
check('the battle opens on the radar', await waitFor('.bs-power', 25000));
const scopes = await count('.bs-radar');
check('both scopes are up', scopes === 2, `${scopes} scopes`);
check('the deploy grid gives way to them', await evaluate(`return document.getElementById('bsBoards').hidden === true`));
check('the scope is actually drawing', await evaluate(`
  const cv = document.querySelector('.bs-radar');
  const ctx = cv.getContext('2d');
  const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
  // any non-transparent pixel means the renderer put something there
  for (let i = 3; i < px.length; i += 4) if (px[i] > 0) return true;
  return false;
`));
await shot('radar');

const powers = await count('.bs-power');
check('powers are offered', powers === 7, `${powers} powers`);
check('energy is shown', ((await textOf('#bsEnergy')) ?? '').includes('⚡'), await textOf('#bsEnergy'));

/* --------------------------------- firing --------------------------------- */

// A click on the enemy scope, aimed at a grid square by geometry rather than
// at a DOM node — which is the whole point of the radar.
await evaluate(`
  const cv = document.getElementById('bsEnemyRadar');
  const rect = cv.getBoundingClientRect();
  // centre of the scope is inside the grid, so it is always a legal square
  cv.dispatchEvent(new MouseEvent('click', {
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    bubbles: true,
  }));
  return true;
`);
await wait(1600);

const logged = await count('.bs-log li');
check('firing on the scope reaches the server', logged > 0, `${logged} log lines`);
await shot('fired');

const errs = await evaluate(`return (window.__err ?? []).length`);
check('nothing threw in the browser', errs === 0, errs ? `${errs} errors` : '');

/* --------------------------------- wrap up -------------------------------- */

guest.close();
ws.close();
browser.kill();
server.kill();
try { rmSync(TMP, { recursive: true, force: true }); } catch { }

const passed = results.filter((r) => r.ok).length;
console.log(`\n  screenshots  android/dry-run-shots/bs-*.png`);
console.log(`  ${passed}/${results.length} checks passed\n`);
process.exit(passed === results.length ? 0 : 1);
