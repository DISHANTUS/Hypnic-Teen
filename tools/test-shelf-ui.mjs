// The shelf doors, the cage, and calling off a tournament.
//
//   npm run test:shelf
//
// Three small pieces of the shell, and each of them was broken in a way that
// only shows up in a browser.
//
// The doors, because sixty-two games in one scroll is not a shelf. The cage,
// because it existed from the day the casino opened and nothing linked to it —
// the only way in was a URL nobody had. And calling off a tournament, because
// the owner's flag was sent by exactly one endpoint, read on boot and nowhere
// else, so the owner's controls vanished the moment anything else replaced the
// stored profile: a login, a signup, or finishing a single game.
//
// That last one is the reason this file exists rather than a rules test. Every
// part of it was correct on the server the whole time.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-shelf');
const PROFILE = path.join(ROOT, 'tmp-shelf-profile');
const PORT = 3218;
const CDP = 9496;
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
const { waitFor, count, textOf } = pageTools(evaluate);

console.log('\n  \x1b[1mThe shelf, the cage and the tournaments\x1b[0m\n');
if (!check('a Chromium browser is installed', Boolean(CHROME))) { cleanup(); process.exit(1); }

for (const d of [TMP, PROFILE]) rmSync(d, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

// The owner is whoever OWNER_ID names, so the account has to exist before the
// server that will call them the owner does. Two boots: one to make the
// account, one that knows who they are.
const boot = (env) => spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP, MEDIA_DIR: path.join(TMP, 'media'), NODE_ENV: 'test', LLM_BOTS: '0', STUDY_PROXY: '0', ...env },
  stdio: 'ignore',
});
const upWhen = async () => {
  for (let i = 0; i < 60; i++) {
    await wait(250);
    if (await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false)) return true;
  }
  return false;
};

server = boot({});
if (!check('test server running', await upWhen())) { cleanup(); process.exit(1); }

const { questions } = await fetch(`${base}/api/quiz`).then((r) => r.json());
const mk = (name, pin, skew) => fetch(`${base}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name, age: 21, pin,
    answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + skew) % q.options.length].id])),
  }),
}).then((r) => r.json());

const catalogue = await fetch(`${base}/api/games`).then((r) => r.json());

const owner = await mk('Boss', '1111', 0);
const friend = await mk('Mate', '2222', 1);
if (!check('two accounts exist', !owner.error && !friend.error, owner.error ?? friend.error ?? '')) { cleanup(); process.exit(1); }

// The friend posts a tournament the owner did not make and cannot host.
const sockUrl = base;
const { io } = await import('socket.io-client');
const sock = io(sockUrl, { transports: ['websocket'], reconnection: false });
await new Promise((r) => sock.once('connect', r));
const made = await new Promise((r) => {
  sock.emit('tourney:create', {
    token: friend.token, gameId: 'clash', name: 'Fuckers',
    mode: 'solo', startsIn: 30, settings: {},
  }, r);
  setTimeout(() => r({ error: 'no answer' }), 8000);
});
sock.close();
if (!check("somebody else's tournament exists", made?.ok === true, JSON.stringify(made).slice(0, 90))) { cleanup(); process.exit(1); }

// Restart, this time knowing who the owner is.
server.kill();
await wait(1200);
server = boot({ OWNER_ID: owner.profile.id });
if (!check('server restarted with an owner', await upWhen())) { cleanup(); process.exit(1); }

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

for (let i = 0; i < 40; i++) {
  if (await evaluate(`return location.origin === ${JSON.stringify(base)}`).catch(() => false)) break;
  await wait(250);
}

/* ------------------------------ the owner logs in ------------------------- */

// Through the real login form, not by planting a token — the whole bug was
// that logging in produced a profile without the owner flag on it.
await evaluate(`localStorage.clear(); return true;`);
await send('Page.navigate', { url: `${base}/#/login` });
await wait(2000);
await evaluate(`document.querySelector('.si-skip')?.click(); for (const d of document.querySelectorAll('dialog[open]')) d.close(); return true;`);
const loggedIn = await evaluate(`
  const id = document.getElementById('loginId');
  const pin = document.getElementById('loginPin');
  if (!id || !pin) return 'no login form';
  id.value = ${JSON.stringify(owner.profile.id)};
  pin.value = '1111';
  id.dispatchEvent(new Event('input', { bubbles: true }));
  pin.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('#loginForm button[type=submit], #loginBtn')?.click();
  return true;
`);
check('the owner can reach the login form', loggedIn === true, String(loggedIn));
await wait(2500);
await watchForErrors(evaluate);

const isOwner = await evaluate(`return JSON.parse(localStorage.getItem('htfw:profile') ?? 'null')?.isOwner ?? window.__ownerProbe ?? null`);
// The store may not persist the profile; ask the running app instead.
const ownerNow = await evaluate(`
  return fetch('/api/me', { headers: { authorization: 'Bearer ' + localStorage.getItem('htfw:token') } })
    .then(r => r.json()).then(j => j.profile?.isOwner === true);
`);
check('the server calls them the owner', ownerNow === true, String(ownerNow));
void isOwner;

/* --------------------------------- the doors ------------------------------ */

await send('Page.navigate', { url: `${base}/#/` });
await wait(2000);
if (!check('the arcade loads', await waitFor('.game-card, .room-tile', 15000))) { cleanup(); process.exit(1); }

// Counted against the rooms the catalogue actually reports rather than a
// number written here, so adding a room is not a test failure.
const rooms = new Set((catalogue.games ?? catalogue).map((g) => g.room ?? 'party'));
const behindDoors = [...rooms].filter((r) => r !== 'party').length;
const tiles = await count('.room-tile');
check('every room but the party is a door', tiles === behindDoors, `${tiles} doors for ${behindDoors} rooms`);
const shelved = await evaluate(`
  const names = [...document.querySelectorAll('.game-card h3')].map(h => h.textContent.trim());
  return JSON.stringify({ total: names.length, hasRoulette: names.includes('Roulette'), hasGoFish: names.includes('Go Fish') });
`);
const shelf = JSON.parse(shelved);
check('no casino game is loose on the front', shelf.hasRoulette === false, JSON.stringify(shelf));
check('and no card game either', shelf.hasGoFish === false, JSON.stringify(shelf));
check('the party games are still on the front', shelf.total > 5, `${shelf.total} cards`);

await evaluate(`[...document.querySelectorAll('.room-tile')].find(t => t.textContent.includes('Casino'))?.click(); return true;`);
await wait(1200);
const inCasino = await evaluate(`
  const names = [...document.querySelectorAll('.game-card h3')].map(h => h.textContent.trim());
  return JSON.stringify({ n: names.length, roulette: names.includes('Roulette'), gofish: names.includes('Go Fish') });
`);
const casino = JSON.parse(inCasino);
check('the casino door opens onto the casino', casino.roulette === true && casino.n === 19, inCasino);
check('and nothing else is in there', casino.gofish === false, inCasino);
check('there is a way back', (await count('.room-back')) === 1);

await evaluate(`document.querySelector('.room-back')?.click(); return true;`);
await wait(1000);
check('and it goes back to the front', (await count('.room-tile')) === behindDoors);

await evaluate(`[...document.querySelectorAll('.room-tile')].find(t => t.textContent.includes('Card'))?.click(); return true;`);
await wait(1200);
const cards = Number(await evaluate(`return document.querySelectorAll('.game-card').length`));
check('the card room door opens onto thirty games', cards === 30, String(cards));

/* ---------------------------------- the cage ------------------------------ */

await send('Page.navigate', { url: `${base}/#/` });
await wait(1800);
check('the cage has a door in the top bar',
  await evaluate(`return document.getElementById('cageBtn')?.hidden === false`));
await evaluate(`document.getElementById('cageBtn').click(); return true;`);
await wait(1200);
check('and it opens', await evaluate(`return document.getElementById('cageDialog')?.open === true`));
check('it says how many chips you have', Number(await textOf('#cageChips')) > 0, await textOf('#cageChips'));
check('and how many points you can put through', (await textOf('#cagePoints')) !== null, await textOf('#cagePoints'));

// Buying with more points than exist must be refused, not silently clamped.
const before = Number(await textOf('#cageChips'));
await evaluate(`
  document.getElementById('cageAmount').value = '999999';
  document.getElementById('cageBuy').click();
  return true;
`);
await wait(1200);
check('the cage refuses what you cannot afford',
  Number(await textOf('#cageChips')) === before, `${before} then ${await textOf('#cageChips')}`);
check('and says why', await evaluate(`return document.getElementById('cageError')?.hidden === false`));

/* --------------------------- calling one off ------------------------------ */

await evaluate(`document.getElementById('cageClose')?.click(); return true;`);
await send('Page.navigate', { url: `${base}/#/` });
// The board arrives over the socket, which reconnects after a navigation — so
// this waits for the card rather than for a stopwatch.
await waitFor('.cup-card', 20000);
await wait(600);

const cups = await count('.cup-card');
check("the friend's tournament is on the board", cups >= 1, `${cups}`);
check('and the owner is offered a way to remove it', (await count('.cup-bin')) >= 1,
  `${await count('.cup-bin')} bins`);

// confirm() would block a headless browser forever.
await evaluate(`window.confirm = () => true; return true;`);
const clicked = await evaluate(`
  const bin = document.querySelector('.cup-bin');
  if (!bin) return 'no bin to click';
  bin.click();
  return true;
`);
check('the remove button can be pressed', clicked === true, String(clicked));
await wait(2000);
const left = await count('.cup-card');
check('and removing it actually removes it', left === cups - 1, `${cups} then ${left}`);

/* ------------------------ the trolley, and the skins ---------------------- */

// The cage button is a trolley and carries no number. It used to show your chip
// balance as a red badge, which in that row of the topbar says "there is
// something new here" — a permanent notification that never clears, for a
// figure the cage itself shows the moment you open it.
const cage = JSON.parse(await evaluate(`
  const b = document.getElementById('cageBtn');
  if (!b) return JSON.stringify({ missing: true });
  return JSON.stringify({
    shown: !b.hidden,
    svg: b.querySelectorAll('svg').length,
    badges: b.querySelectorAll('.news-badge').length,
    digits: /[0-9]/.test(b.textContent ?? ''),
  });
`));
check('the cage button is drawn as a trolley', cage.svg === 1 && cage.shown === true,
  JSON.stringify(cage));
check('and carries no number', cage.badges === 0 && cage.digits === false,
  JSON.stringify(cage));

// The skin picker spreads across the screen it is given. At 480px it was a tall
// narrow column with twenty-five skins in threes and most of them below the
// fold, on a monitor with room to spare either side.
//
// Measured on both shapes, because they want opposite things and only checking
// one is how the desktop got left as a phone in the first place. The rest of
// this file runs at 390 by 844; the desktop pass puts it back afterwards.
const measureSkins = async () => {
  await evaluate(`document.getElementById('themeBtn')?.click(); return true;`);
  await wait(700);
  const out = JSON.parse(await evaluate(`
    const d = document.getElementById('themeDialog');
    const g = document.getElementById('themeGrid');
    if (!d || !g) return JSON.stringify({ missing: true });
    const cards = [...g.children].filter((c) => !c.classList.contains('theme-group'));
    const tops = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top)));
    return JSON.stringify({
      open: d.open === true,
      width: Math.round(d.getBoundingClientRect().width),
      page: Math.round(document.documentElement.clientWidth),
      cards: cards.length,
      rows: tops.size,
    });
  `));
  await evaluate(`document.getElementById('themeClose')?.click(); return true;`);
  await wait(400);
  return out;
};

const onPhone = await measureSkins();
check('the skin picker opens', onPhone.open === true, JSON.stringify(onPhone));
check('on a phone it stays inside the screen',
  onPhone.width <= onPhone.page, JSON.stringify(onPhone));

await send('Emulation.setDeviceMetricsOverride',
  { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await wait(500);
// Kept as pictures too. Numbers say the dialog is a thousand pixels wide and
// six rows tall, and that the cage button holds one svg and no badge; only a
// screenshot says whether either looks like anything.
const keep = async (name, clip) => {
  try {
    const { data } = await send('Page.captureScreenshot',
      clip ? { format: 'png', clip: { ...clip, scale: 2 } } : { format: 'png' });
    mkdirSync(path.join(ROOT, 'android', 'shelf-shots'), { recursive: true });
    writeFileSync(path.join(ROOT, 'android', 'shelf-shots', `${name}.png`),
      Buffer.from(data, 'base64'));
  } catch { /* never the point */ }
};
const bar = JSON.parse(await evaluate(`
  const r = document.querySelector('.topbar-right').getBoundingClientRect();
  return JSON.stringify({ x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 });
`));
await keep('topbar-trolley', bar);

await evaluate(`document.getElementById('themeBtn')?.click(); return true;`);
await wait(700);
await keep('skins-desktop');
await evaluate(`document.getElementById('themeClose')?.click(); return true;`);
await wait(300);

const onDesk = await measureSkins();
check('on a desktop it uses the width it is given',
  onDesk.width > 480 && onDesk.width <= onDesk.page, JSON.stringify(onDesk));
// Twenty-five skins across five packs. In threes that was nine rows of skins
// plus five headings; spread across it is one row per pack.
check('so the skins lie across rather than down',
  onDesk.rows <= 6 && onDesk.rows < onPhone.rows,
  `${onDesk.cards} skins in ${onDesk.rows} rows on a desktop, ${onPhone.rows} on a phone`);
await send('Emulation.setDeviceMetricsOverride',
  { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await wait(500);

const gone = await fetch(`${base}/api/health`).then((r) => r.json()).catch(() => null);
check('the studio is still standing', Boolean(gone?.ok));

const errors = await evaluate(`return window.__journeyErrors ?? []`);
check('nothing threw', errors.length === 0, errors.slice(0, 2).join(' | '));

cleanup();

const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.log('\n  \x1b[31mwhat failed:\x1b[0m');
  for (const r of bad) console.log(`  \x1b[31m  · ${r.label}\x1b[0m`);
}
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — two doors, a cage, and a tournament nobody wanted\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
