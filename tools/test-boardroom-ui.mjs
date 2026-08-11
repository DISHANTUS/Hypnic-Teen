// Every card game, opened in a real browser.
//
//   npm run test:cardroom:ui
//
// The rules suite proves the games are correct and proves nothing at all about
// whether anybody can see them. Thirty games share one renderer with twenty-odd
// faces in it, and a face that throws on its first state looks exactly like a
// game that never started — a blank screen and a room asking what happened.
//
// So this is deliberately shallow and completely broad: every game, one at a
// time, with real stand-in players on real sockets. Does the shelf list it, does
// a room open, does the tutorial come up, does the table actually render, does
// the hand appear, does it fit a phone, and did anything throw. That last one is
// the point — a client that throws once leaves the screen frozen at whatever it
// had drawn before, which is the failure nobody reports because it looks like
// the game is just thinking.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';
import { seatDummies } from './lib/dummies.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-boardui');
const PROFILE = path.join(ROOT, 'tmp-boardui-profile');
const SHOTS = path.join(ROOT, 'android', 'board-shots');
const PORT = 3219;
const CDP = 9497;
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
let dummies = [];
function cleanup() {
  for (const d of dummies) { try { d.close(); } catch { } }
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
const { waitFor, count, textOf } = pageTools(evaluate);

console.log('\n  \x1b[1mThe board room, in a browser\x1b[0m  \x1b[2m(390x844, every game, with stand-ins)\x1b[0m\n');
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

const catalogue = await fetch(`${base}/api/games`).then((r) => r.json());
const GAMES = (catalogue.games ?? catalogue).filter((g) => g.room === 'board');
if (!check('the board room is on the shelf', GAMES.length >= 2, `${GAMES.length} games`)) { cleanup(); process.exit(1); }

const { questions } = await fetch(`${base}/api/quiz`).then((r) => r.json());
const me = await fetch(`${base}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'BoardHand', age: 20, pin: '3232',
    answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[i % q.options.length].id])),
  }),
}).then((r) => r.json());
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

/* --------------------------- one game at a time --------------------------- */

for (const game of GAMES) {
  console.log(`\n  \x1b[2m— ${game.name} —\x1b[0m`);

  // The arcade first, then through the room's door — which is what a person
  // does, and the only way to get a fresh boot. Navigating straight to a hash
  // from a page that is already loaded is a fragment change, not a reload, so
  // the app keeps running with whatever it booted with.
  await send('Page.navigate', { url: base });
  await wait(1500);
  await evaluate(`location.hash = '#/shelf/board'; return true;`);
  await wait(900);
  await evaluate(`document.querySelector('.si-skip')?.click(); for (const d of document.querySelectorAll('dialog[open]')) d.close(); return true;`);
  if (!check(`${game.name}: the arcade loads`, await waitFor('.game-card', 15000))) continue;
  await watchForErrors(evaluate);

  const opened = await evaluate(`
    const cards = [...document.querySelectorAll('.game-card')];
    const it = cards.find(c => (c.querySelector('h3')?.textContent ?? '').trim() === ${JSON.stringify(game.name)});
    if (!it) {
      return 'not on the shelf — showing: '
        + cards.slice(0, 4).map(c => c.querySelector('h3')?.textContent?.trim()).join(', ')
        + ' (' + cards.length + ' cards, hash ' + location.hash + ')';
    }
    it.click();
    return true;
  `);
  if (!check(`${game.name}: it is in the board room`, opened === true, String(opened))) continue;
  if (!check(`${game.name}: a room opens`, await waitFor('#roomCode', 15000))) continue;
  const code = await evaluate(`return document.getElementById('roomCode').textContent.trim()`);

  // Enough stand-ins to satisfy the game, on real sockets. They ready up on
  // their own; nothing here needs them to play well.
  for (const d of dummies) { try { d.close(); } catch { } }
  const need = Math.max(0, game.minPlayers - 1);
  try {
    dummies = need ? await seatDummies(need, { base, code, gameId: game.id, name: `${game.id}Bot`, chips: 0, pause: 700 }) : [];
  } catch (err) {
    check(`${game.name}: stand-ins can sit down`, false, err.message);
    continue;
  }
  await wait(900 + need * 200);

  await evaluate(`document.getElementById('startBtn')?.click(); return true;`);

  // The tutorial comes first for anybody who has not seen this game.
  const taught = await waitFor('.tut-card', 20000);
  if (taught) {
    const steps = await count('.tut-dot');
    check(`${game.name}: the rules are explained first`, steps >= 3, `${steps} steps`);
    await evaluate(`document.getElementById('tutSkip')?.click(); return true;`);
    await wait(400);
  } else {
    check(`${game.name}: the rules are explained first`, false, 'no tutorial card');
  }

  // Its own brief, then the table.
  const briefed = await waitFor('.intro-ready', 20000);
  if (!check(`${game.name}: the brief comes up`, briefed)) { await shot(`${game.id}-no-brief`); continue; }
  await evaluate(`document.querySelector('.intro-ready')?.click(); return true;`);

  if (!check(`${game.name}: the table appears`, await waitFor('.bd-table:not([hidden])', 25000))) {
    await shot(`${game.id}-no-table`);
    continue;
  }
  await wait(1600);

  // The board itself drew. This is the check that catches a face that threw on
  // its first state — the renderer leaves the box empty and the room sees
  // nothing, with no idea why.
  // Whatever this game calls its board — ringed squares, a chequered grid, or
  // a pond and a hand of tiles. Counting only one of those made two of the six
  // look broken when they were fine.
  const squares = await count('.bd-board .bd-cell, .bd-board .bd-square, .bd-board .bd-tile, .bd-board .ld-cell');
  check(`${game.name}: the board is drawn`, squares > 0, `${squares} pieces of board`);

  // Ludo's board is the one that shipped as an empty ring, so it gets its own
  // anatomy check: the yards, the painted home columns, the stars and the
  // centre all have to actually be there, and the whole thing has to be more
  // than a ring — the old drawing had 52 cells and nothing else.
  if (game.face === 'ludo') {
    const anatomy = JSON.parse(await evaluate(`
      return JSON.stringify({
        ring: document.querySelectorAll('.ld-cell:not(.is-column)').length,
        columns: document.querySelectorAll('.ld-cell.is-column').length,
        yards: document.querySelectorAll('.ld-yard').length,
        pads: document.querySelectorAll('.ld-pad').length,
        stars: document.querySelectorAll('.ld-cell.is-star').length,
        centre: document.querySelectorAll('.ld-centre').length,
        tokens: document.querySelectorAll('.ld-token').length,
      });
    `));
    check(`${game.name}: the whole board is there, not just the ring`,
      anatomy.ring === 52 && anatomy.columns === 20 && anatomy.yards === 4
      && anatomy.pads === 16 && anatomy.stars === 8 && anatomy.centre === 1,
      JSON.stringify(anatomy));
    check(`${game.name}: every token is on the board`,
      anatomy.tokens === 8, `${anatomy.tokens} tokens for 2 seats`);
  }

  // Every seat is on screen. A board game with a player missing from the side
  // is a board game where somebody does not know they are in it.
  const seats = await count('.bd-seat');
  check(`${game.name}: everybody is shown at the side`, seats >= 2, `${seats} seats`);

  // The thing you throw. Either the sticks are out, or there is a button to
  // throw them — a board with neither is a board nobody can move.
  // Something to do: sticks to throw, a button to throw them, a coin to move,
  // a square that lights up, a tile to put down, or a piece in hand to drop.
  const canAct = await evaluate(`
    const any = (sel) => document.querySelectorAll(sel).length > 0;
    return any('.bd-stick') || any('.bd-throw') || any('.bd-coin')
      || any('.bd-square.can-move') || any('.bd-tile') || any('.bd-inhand')
      || any('.bd-orbcell.can-drop');
  `);
  check(`${game.name}: there is something to throw or move`, canAct === true, String(canAct));

  // The clock. A blank one looks exactly like no clock, so this asks for the
  // words rather than for the element.
  check(`${game.name}: the clock says what is happening`,
    Boolean((await textOf('.clk-who'))?.trim()), await textOf('.clk-who'));
  // Asked for the *right* words rather than merely for words. The first
  // version only checked the line was not empty, and passed while Paramapadham
  // sat there telling its players about a rule that belongs to Thayam.
  const hint = (await textOf('.clk-next'))?.trim() ?? '';
  const WANTS = {
    thayam: /throw again|cut somebody/i,
    paramapadham: /virtue|vice/i,
  };
  check(`${game.name}: and what happens next, in its own words`,
    (WANTS[game.face] ?? /./).test(hint), hint);

  // Thayam's crosses are painted in each player's colour, and that colour is
  // load-bearing — it is the only thing that says which inner corner you turn
  // in at. Grey crosses everywhere would draw a perfectly plausible board that
  // nobody could actually navigate.
  if (game.face === 'thayam') {
    const owned = JSON.parse(await evaluate(`
      const cells = [...document.querySelectorAll('.bd-cell.is-owned')];
      return JSON.stringify({
        n: cells.length,
        mine: document.querySelectorAll('.bd-cell.is-yours').length,
        tints: [...new Set(cells.map((c) => c.style.getPropertyValue('--own')))].filter(Boolean),
        titles: cells.map((c) => c.title).filter(Boolean).length,
      });
    `));
    // Two players in this fixture: two crosses each.
    check(`${game.name}: each player's crosses are painted their colour`,
      owned.n === 4 && owned.tints.length === 2, JSON.stringify(owned));
    check(`${game.name}: and yours are marked out from the rest`,
      owned.mine === 2, String(owned.mine));
    check(`${game.name}: every painted cross says whose it is`,
      owned.titles === owned.n, `${owned.titles} of ${owned.n}`);

    // The mat. Computed style rather than pixels, because a screenshot depends
    // on where the page happens to be scrolled and this does not.
    const paintjob = JSON.parse(await evaluate(`
      const cell = document.querySelector('.bd-cell:not(.is-safe):not(.is-centre)');
      const centre = document.querySelector('.bd-cell.is-centre');
      const board = document.querySelector('.bd-board');
      return JSON.stringify({
        cell: getComputedStyle(cell).backgroundColor,
        centre: getComputedStyle(centre).backgroundImage.slice(0, 15),
        board: getComputedStyle(board).borderColor,
      });
    `));
    check(`${game.name}: the board is dressed as a board`,
      paintjob.cell === 'rgb(251, 243, 226)'
      && paintjob.centre.startsWith('radial-gradient')
      && paintjob.board === 'rgb(58, 47, 38)',
      JSON.stringify(paintjob));
  }

  // Chain Reaction is the one game here whose whole appeal is what happens
  // after you move, so looking at an empty board proves very little. Drop one
  // and check an orb actually arrives — and that the grid is lit in the colour
  // of whoever is to play, which is how the original tells you whose turn it is
  // without making you look away from the cells.
  if (game.face === 'chain') {
    const grid = await evaluate(`
      const b = document.querySelector('.bd-board.is-chain');
      return b ? getComputedStyle(b).getPropertyValue('--turn').trim() : '';
    `);
    check(`${game.name}: the grid is lit in the colour of whoever is to play`,
      /^(#|rgb)/.test(grid), grid || '(nothing)');

    const before = await evaluate(`return document.querySelectorAll('.bd-orb').length`);
    await evaluate(`document.querySelector('.bd-orbcell.can-drop')?.click(); return true;`);
    await wait(900);
    const after = await evaluate(`return document.querySelectorAll('.bd-orb').length`);
    check(`${game.name}: an orb lands when you drop one`, after > before, `${before} → ${after}`);
  }

  // The clock has to actually move.
  //
  // This is the check that was missing while every table in three rooms showed
  // a frozen bar. A table broadcasts only when something happens and a clock
  // ticking is not something happening, so there was nothing to paint from and
  // the bar sat where the last move left it. Every server-side suite passed
  // throughout: they all ask what the server thinks, and none of them asks what
  // a person would see. So this one sits still, touches nothing, and reads the
  // screen twice.
  const tick1 = await textOf('.clk-left');
  await wait(2500);
  const tick2 = await textOf('.clk-left');
  const secs = (t) => Number(String(t ?? '').replace(/[^0-9]/g, ''));
  check(`${game.name}: the clock counts down on its own`,
    secs(tick2) < secs(tick1), `${tick1} then ${tick2}, with nothing sent between`);

  // A board has to have a size.
  //
  // Counting cells proves the DOM was built and proves nothing about whether
  // anybody can see a board — Thayam shipped for a while as forty-nine cells
  // two pixels tall, a set of flat dashes that passed every check here because
  // every check here counted nodes. A square-ish box and cells you could
  // actually hit with a thumb is the property that was missing.
  const size = JSON.parse(await evaluate(`
    const b = document.querySelector('.bd-board');
    if (!b) return JSON.stringify({ none: true });
    const r = b.getBoundingClientRect();
    const cells = [...b.children].map((c) => c.getBoundingClientRect());
    const h = Math.min(...cells.map((c) => c.height));
    const w = Math.min(...cells.map((c) => c.width));
    return JSON.stringify({
      board: [Math.round(r.width), Math.round(r.height)],
      cell: [Math.round(w), Math.round(h)],
    });
  `));
  check(`${game.name}: the board is a board, not a stack of lines`,
    size.board?.[1] >= 120, JSON.stringify(size));
  check(`${game.name}: and its cells are big enough to tap`,
    size.cell?.[0] >= 18 && size.cell?.[1] >= 18, JSON.stringify(size.cell));

  const fit = JSON.parse(await evaluate(`
    const w = document.documentElement;
    return JSON.stringify({ pageWidth: w.clientWidth, scrollWidth: w.scrollWidth });
  `));
  check(`${game.name}: no sideways scroll`, fit.scrollWidth <= fit.pageWidth + 1,
    `${fit.scrollWidth} in ${fit.pageWidth}`);

  const errors = await evaluate(`return window.__journeyErrors ?? []`);
  check(`${game.name}: threw nothing`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await shot(`${game.id}`);

  await evaluate(`document.querySelector('#quitBtn, .back, [data-nav]')?.click(); return true;`);
  await wait(500);
}

console.log(`\n  \x1b[2mscreenshots\x1b[0m  android/board-shots/`);
cleanup();

const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.log('\n  \x1b[31mwhat failed:\x1b[0m');
  for (const r of bad) console.log(`  \x1b[31m  · ${r.label}\x1b[0m`);
}
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — every board drawn, and every rule the server owns\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
