// Crossword Clash, played on a phone, 2v2.
//
//   npm run test:crossword:ui
//
// The rules and the grid builder are tested elsewhere. This is the part that
// only a browser can answer: does the board fit a phone, does typing a word
// fill the squares in, does a teammate see it appear without touching
// anything, and does the other side see nothing at all.
//
// That last one is why there are real opponents on real sockets rather than
// one browser talking to itself. Two sides racing the same puzzle is exactly
// the situation where reading somebody else's letters would be worth doing.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-crossword');
const PROFILE = path.join(ROOT, 'tmp-crossword-profile');
const SHOTS = path.join(ROOT, 'android', 'crossword-shots');
const PORT = 3210;
const CDP = 9487;
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
const { click, waitFor, count, textOf } = pageTools(evaluate);

console.log('\n  \x1b[1mCrossword Clash, 2v2 on a phone\x1b[0m  \x1b[2m(390x844)\x1b[0m\n');
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
      name, age: 19 + seq, pin: '3535',
      answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + seq++) % q.options.length].id])),
    }),
  }).then((r) => r.json());

const me = await signUp('Solver');
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

/* ---------------------------- into the crossword -------------------------- */

const opened = await evaluate(`
  const cards = [...document.querySelectorAll('.game-card')];
  const it = cards.find(c => (c.querySelector('h3')?.textContent ?? '').trim() === 'Crossword Clash');
  if (!it) return cards.map(c => c.querySelector('h3')?.textContent).join(' | ');
  it.click();
  return true;
`);
if (!check('Crossword Clash is on the shelf', opened === true, String(opened))) { cleanup(); process.exit(1); }
if (!check('a room opens', await waitFor('#roomCode', 15000))) { cleanup(); process.exit(1); }
const code = await evaluate(`return document.getElementById('roomCode').textContent.trim()`);

// Three more, so 2v2: me + Mate1 on one side, Mate2 + Mate3 on the other.
for (const name of ['Mate1', 'Mate2', 'Mate3']) {
  const mate = await signUp(name);
  const socket = io(base, { transports: ['websocket'] });
  const seen = { last: null };
  socket.on('game:state', (s) => { seen.last = s; if (s.phase === 'brief') socket.emit('game:action', { type: 'briefed' }); });
  mates.push({ socket, mate, seen });
  await new Promise((r) => socket.on('connect', r));
  await new Promise((r) => {
    socket.emit('room:join', { code, token: mate.token }, r);
    setTimeout(() => r({ error: 'no answer' }), 8000);
  });
}
await wait(1500);
const seated = await fetch(`${base}/api/room/${code}`).then((r) => r.json()).catch(() => ({}));
if (!check('four in the room', (seated.players?.length ?? 0) === 4, `${seated.players?.length}`)) { cleanup(); process.exit(1); }

// 2 a side.
await evaluate(`document.getElementById('editSetup')?.click(); return true;`);
await wait(800);
const setTeams = await evaluate(`
  const box = document.getElementById('setupFields');
  const nums = box ? [...box.querySelectorAll('.setup-exact')] : [];
  if (!nums.length) return 'no fields';
  nums[0].value = '2';                        // players per side
  nums[0].dispatchEvent(new Event('change', { bubbles: true }));
  return nums.length;
`);
await wait(900);
check('the host can set the team size', setTeams >= 1, String(setTeams));
await evaluate(`document.getElementById('editSetup')?.click(); return true;`);
await wait(400);
await evaluate(`document.getElementById('startBtn')?.click(); return true;`);

if (!check('the game starts', await waitFor('.cw-brief', 20000))) { cleanup(); await shot('no-start'); process.exit(1); }
await shot('brief');
await click('#cwBriefed');

if (!check('the board appears', await waitFor('.cw-grid .cw-cell', 25000))) { cleanup(); await shot('no-board'); process.exit(1); }
await wait(800);
await shot('board');

check('there are two sides', (await count('.cw-side')) === 2, String(await count('.cw-side')));
check('with clues down both lists', (await count('.cw-clue')) >= 6, String(await count('.cw-clue')));
check('and squares to fill', (await count('.cw-cell[data-rc]')) >= 20, String(await count('.cw-cell[data-rc]')));
check('none of them filled in yet',
  (await evaluate(`return [...document.querySelectorAll('.cw-letter')].every(l => l.textContent === '')`)) === true);

/* ------------------------------- on a phone ------------------------------- */

const fit = JSON.parse(await evaluate(`
  const w = document.documentElement;
  const grid = document.querySelector('.cw-grid');
  const cell = document.querySelector('.cw-cell[data-rc]');
  return JSON.stringify({
    pageWidth: w.clientWidth,
    scrollWidth: w.scrollWidth,
    gridWidth: Math.round(grid.getBoundingClientRect().width),
    cell: Math.round(cell.getBoundingClientRect().width),
    square: Math.abs(cell.getBoundingClientRect().width - cell.getBoundingClientRect().height) < 2,
  });
`));
check('the page never scrolls sideways', fit.scrollWidth <= fit.pageWidth + 1, `${fit.scrollWidth} in ${fit.pageWidth}`);
check('the grid fits the screen', fit.gridWidth <= fit.pageWidth, `${fit.gridWidth}px`);
check('and the squares are square', fit.square, `${fit.cell}px`);
// Fitting the window is not the same as fitting the panel it sits in. The
// grid is centred in a card with its own padding, and a board that runs past
// that card is clipped by it — the squares are there and unreachable.
const inPanel = JSON.parse(await evaluate(`
  const grid = document.querySelector('.cw-grid').getBoundingClientRect();
  const panel = document.querySelector('.stage-wrap').getBoundingClientRect();
  const cells = [...document.querySelectorAll('.cw-cell')].map(c => c.getBoundingClientRect());
  return JSON.stringify({
    gridLeft: Math.round(grid.left), gridRight: Math.round(grid.right),
    panelLeft: Math.round(panel.left), panelRight: Math.round(panel.right),
    widest: Math.round(Math.max(...cells.map(c => c.right))),
  });
`));
check('the board sits inside its panel',
  inPanel.widest <= inPanel.panelRight + 1,
  `rightmost square at ${inPanel.widest}, panel ends at ${inPanel.panelRight}`);

/* --------------------------- the answers are not here --------------------- */

const leaked = await evaluate(`
  // Everything the page is holding, searched for a word it should not know.
  const text = document.body.innerHTML;
  const words = [...document.querySelectorAll('.cw-clue-text')].map(e => e.textContent);
  return JSON.stringify({ hasLetters: /class="cw-letter">[A-Z]/.test(text), clueCount: words.length });
`);
check('no letters are on the page before anything is solved', JSON.parse(leaked).hasLetters === false, leaked);

/* ------------------------------ solving one ------------------------------- */

// The answer comes from the server's own state, the way a player would get it
// from their head. Asked for over the socket rather than read out of the page,
// because the page genuinely does not have it.
const firstClue = await evaluate(`
  const li = document.querySelector('.cw-clue:not(.is-solved)');
  li.click();
  const b = li.querySelector('b').textContent;
  const text = li.querySelector('.cw-clue-text').textContent;
  return JSON.stringify({ number: b, text });
`);
await wait(500);
check('tapping a clue opens somewhere to type', await waitFor('.cw-answer input', 5000), firstClue);
check('and highlights its squares in the grid', (await count('.cw-cell.is-on')) >= 3,
  String(await count('.cw-cell.is-on')));
await shot('picked');

// A wrong answer first, because that is the mechanic worth seeing.
await evaluate(`
  const i = document.querySelector('.cw-answer input');
  i.value = 'ZZZZZZ';
  i.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return true;
`);
await wait(1200);
check('a wrong answer says so and locks the clue',
  /[Ll]ocked/.test(await textOf('.cw-answer-note') ?? ''), await textOf('.cw-answer-note'));
check('the clue shows its countdown', (await count('.cw-clue.is-locked')) >= 1,
  String(await count('.cw-clue.is-locked')));
check('but every other clue is still open', (await count('.cw-clue:not(.is-locked):not(.is-solved)')) >= 4,
  String(await count('.cw-clue:not(.is-locked):not(.is-solved)')));
await shot('locked');

/* -------------------- a teammate solves, and I see it --------------------- */

// Mate1 is on my side. What they type must appear on my board without me
// doing anything; Mate2 and Mate3 must see none of it.
const mate1 = mates[0];
const answers = await new Promise((r) => {
  // The server knows; ask it through the room the way the game does.
  mate1.socket.emit('game:action', { type: 'briefed' });
  setTimeout(() => r(mate1.seen.last), 600);
});
check('a teammate is on the same side',
  Boolean(answers?.you), `side ${answers?.you?.sideId}`);

// Mate1 solves one, the way a person does: they read the clue and know the
// word. The clue text is public and every clue in the bank is unique, so the
// test can look the answer up the same way — no backdoor into the server, and
// no brute force either.
//
// Brute force was the first attempt and it was worse than slow: dozens of
// wrong guesses at four seconds of lockout each meant the room sat quiet long
// enough for the game's own stuck timer to fire, hand the word to everybody
// for nothing, and make it look like one side was reading the other's board.
const { USABLE_WORDS } = await import('../server/crossword-words.js');
const answerFor = (clueText) => {
  const bare = clueText.replace(/\s*\(\d+\)\s*$/, '');
  return USABLE_WORDS.find((w) => w.clue === bare)?.answer ?? null;
};

// Not the clue this browser just got wrong. That one is locked for the whole
// side — which is the rule working, and is worth saying so rather than
// tripping over it: the first version of this picked the first unsolved clue,
// hit the lockout its own teammate had earned, and failed about one run in
// three with no hint as to why.
const lockedNow = mate1.seen.last?.you?.locked ?? {};
check('a teammate is locked out by their partner\'s wrong answer',
  Object.keys(lockedNow).length >= 1, JSON.stringify(lockedNow));

const target = mate1.seen.last?.board?.clues?.find(
  (c) => !mate1.seen.last.you.solved[c.id] && !(lockedNow[c.id] > 0) && answerFor(c.clue)
);
const known = target ? answerFor(target.clue) : null;
let solvedId = null;
if (target && known) {
  mate1.socket.emit('game:action', { type: 'guess', clueId: target.id, text: known });
  await wait(700);
  if (mate1.seen.last?.you?.solved?.[target.id]) solvedId = target.id;
}
check('a teammate can solve one', Boolean(solvedId),
  target ? `${target.number} ${target.dir} — "${target.clue}" → ${known}` : 'no open clue found');

if (solvedId) {
  await wait(1200);
  const mineNow = await evaluate(`
    return [...document.querySelectorAll('.cw-letter')].filter(l => l.textContent).length;
  `);
  check('their letters appear on my board without me touching anything', mineNow >= 3, `${mineNow} letters`);
  check('and the clue is ticked off with their name',
    /Mate1/.test(await evaluate(`return document.body.innerText`)),
    'looking for Mate1 on the solved clue');

  // The other side must have nothing.
  const rival = mates[1];
  const rivalLetters = Object.keys(rival.seen.last?.you?.letters ?? {}).length;
  check('the other side sees none of it', rivalLetters === 0, `${rivalLetters} letters on their board`);
  check('though they can see the score move',
    (rival.seen.last?.sides ?? []).some((s) => s.score > 0),
    JSON.stringify((rival.seen.last?.sides ?? []).map((s) => s.score)));
  await shot('solved');
}

/* ------------------------------ nothing threw ----------------------------- */

const errors = await evaluate(`return window.__journeyErrors ?? []`);
check('the page threw nothing', errors.length === 0, errors.join(' | '));

cleanup();
const bad = results.filter((r) => !r.ok);
console.log(`\n  screenshots  android/crossword-shots/`);
console.log(bad.length
  ? `\x1b[31m  ${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\x1b[32m  all ${results.length} passed — a team shares one board, and the other side sees none of it\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
