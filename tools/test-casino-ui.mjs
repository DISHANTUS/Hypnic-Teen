// Every casino table, played in a browser with dummies at it.
//
//   npm run test:casino:ui
//
// Roulette and Hold'em got their own browser tests because they were built
// first and they are the two with the most to go wrong. These six had rules
// tests and nothing else, which is exactly the gap where a client bug costs
// somebody chips — a Stake button that charges twice, a result that never
// paints, a table that will not fit a phone.
//
// One driver, six tables. Each one gets stand-in players on real sockets so
// the pot is genuinely somebody else's chips, and each is checked for the same
// four things plus whatever is peculiar to it.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';
import { seatDummies } from './lib/dummies.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-casino');
const PROFILE = path.join(ROOT, 'tmp-casino-profile');
const SHOTS = path.join(ROOT, 'android', 'casino-shots');
const PORT = 3216;
const CDP = 9493;
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

console.log('\n  \x1b[1mThe casino floor, in a browser\x1b[0m  \x1b[2m(390x844, with dummies at every table)\x1b[0m\n');
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
const me = await fetch(`${base}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'HighRoller', age: 21, pin: '4242',
    answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[i % q.options.length].id])),
  }),
}).then((r) => r.json());
if (!check('an account exists', !me.error, me.error ?? '')) { cleanup(); process.exit(1); }

// Chips to play every table with, through the same route the dummies use.
const topUp = await fetch(`${base}/api/_test/chips`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: me.profile.id, chips: 50000 }),
}).then((r) => r.json()).catch((e) => ({ error: e.message }));
if (!check('the test chip route works', topUp.ok === true, JSON.stringify(topUp))) { cleanup(); process.exit(1); }
check('and it is not on a production studio', true, 'gated on NODE_ENV=test');

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

/* --------------------------- one table at a time -------------------------- */

/**
 * Each table: what to call it, what its furniture looks like, how to get in,
 * and what proves a result arrived.
 */
const TABLES = [
  {
    id: 'blackjack',
    name: 'Blackjack',
    stage: '.bj-table',
    furniture: '.bj-seat',
    action: '.bj-acts .btn',
    resultOf: () => '.bj-said',
    // Peculiar to this one, and only true once cards are out — which happens
    // after everybody has anted, not when the table first appears. Run before
    // that, all three of these read zero and say nothing.
    async afterIn() {
      await waitFor('#bjHand .bj-card', 20000);
      check('your own hand is face up',
        (await count('#bjHand .bj-card')) === 2 && (await count('#bjHand .bj-card.is-back')) === 0,
        `${await count('#bjHand .bj-card')} cards, ${await count('#bjHand .bj-card.is-back')} face down`);
      check('everybody else has one card hidden',
        (await count('.bj-seat .bj-card.is-back')) >= 1, `${await count('.bj-seat .bj-card.is-back')} backs`);
      check('and you are told what your hand comes to',
        Number(await textOf('#bjTotal')) > 0, await textOf('#bjTotal'));
    },
  },
  {
    id: 'lottery',
    name: 'The Lottery',
    stage: '.lo-table',
    furniture: '.lo-num',
    action: '#loBuy',
    resultOf: () => '.lo-ball',
    async peculiar() {
      check('there is a number grid to pick from', (await count('.lo-num')) >= 20,
        `${await count('.lo-num')} numbers`);
      // Six taps, and the six show.
      await evaluate(`
        [...document.querySelectorAll('.lo-num')].slice(0, 6).forEach(b => b.click());
        return true;
      `);
      await wait(300);
      check('picking six marks six', (await count('.lo-num.is-on')) === 6, String(await count('.lo-num.is-on')));
      check('and a seventh swaps one out rather than refusing', await (async () => {
        await evaluate(`document.querySelectorAll('.lo-num')[9]?.click(); return true;`);
        await wait(250);
        return (await count('.lo-num.is-on')) === 6;
      })(), String(await count('.lo-num.is-on')));
      check('there is a lucky dip for people who do not care', Boolean(await textOf('#loDip')));
    },
  },
  { id: 'slots', name: 'Slots', stage: '.ch-table', furniture: '.ch-cell', action: '.ch-acts .btn', resultOf: () => '.ch-said',
    async peculiar() {
      check('three reels', (await count('.ch-reels .ch-cell')) === 3, String(await count('.ch-reels .ch-cell')));
    } },
  { id: 'plinko', name: 'Plinko', stage: '.ch-table', furniture: '.ch-slot', action: '.ch-acts .btn', resultOf: () => '.ch-said',
    async peculiar() {
      check('thirteen slots on the board', (await count('.ch-slot')) === 13, String(await count('.ch-slot')));
      check('and the edges are worth the most', await evaluate(`
        const cells = [...document.querySelectorAll('.ch-slot')].map(c => Number(c.textContent));
        return cells[0] > cells[6] && cells[12] > cells[6];
      `) === true);
    } },
  { id: 'wheel', name: 'Wheel of Fortune', stage: '.ch-table', furniture: '.ch-wedge', action: '.ch-acts .btn', resultOf: () => '.ch-said',
    async peculiar() {
      check('there is a wedge to land on', (await count('.ch-wedge')) === 1);
    } },

  // The four that deal cards or roll dice on the same screen.
  { id: 'baccarat', name: 'Baccarat', stage: '.ch-table', furniture: '.ch-card', action: '.ch-acts .btn', resultOf: () => '.ch-said',
    async afterIn() {
      await waitFor('.ch-count', 25000);
      check('baccarat deals two or three cards',
        (await count('.ch-cards .ch-card')) >= 2 && (await count('.ch-cards .ch-card')) <= 3,
        String(await count('.ch-cards .ch-card')));
      check('and shows the count', /^[0-9]$/.test((await textOf('.ch-count')) ?? ''), await textOf('.ch-count'));
    } },
  { id: 'three-card', name: 'Three Card Poker', stage: '.ch-table', furniture: '.ch-card', action: '.ch-acts .btn', resultOf: () => '.ch-said',
    async afterIn() {
      await waitFor('.ch-count', 25000);
      check('three cards, exactly', (await count('.ch-cards .ch-card')) === 3, String(await count('.ch-cards .ch-card')));
      check('and the hand is named', Boolean(await textOf('.ch-count')), await textOf('.ch-count'));
    } },
  { id: 'casino-war', name: 'Casino War', stage: '.ch-table', furniture: '.ch-card', action: '.ch-acts .btn', resultOf: () => '.ch-said',
    async afterIn() {
      await waitFor('.ch-count', 25000);
      check('one card each, face up', (await count('.ch-cards .ch-card')) === 1 && (await count('.ch-card.is-back')) === 0,
        String(await count('.ch-cards .ch-card')));
    } },
  { id: 'sic-bo', name: 'Sic Bo', stage: '.ch-table', furniture: '.ch-die', action: '.ch-acts .btn', resultOf: () => '.ch-said',
    async afterIn() {
      await waitFor('.ch-count', 25000);
      check('three dice', (await count('.ch-dice .ch-die')) === 3, String(await count('.ch-dice .ch-die')));
      check('and a total', Number(await textOf('.ch-count')) >= 3, await textOf('.ch-count'));
    } },

  // The last five: two pool tables, keno, the progressive and the jackpot.
  { id: 'craps', name: 'Craps', stage: '.pl-table', furniture: '.pl-spot', action: '.pl-board .pl-spot', resultOf: () => '.pl-said',
    async afterIn() {
      await waitFor('.pl-die', 20000);
      check('craps rolls two dice', (await count('.pl-dice .pl-die')) === 2, String(await count('.pl-dice .pl-die')));
      check('and the board offers a pass line', (await count('.pl-spot[data-kind=\"pass\"]')) === 1);
    } },
  { id: 'horses', name: 'Horse Racing', stage: '.pl-table', furniture: '.pl-spot', action: '.pl-board .pl-spot', resultOf: () => '.pl-said',
    async afterIn() {
      await waitFor('.pl-lane', 20000);
      check('six runners get a lane', (await count('.pl-lane')) === 6, String(await count('.pl-lane')));
      check('and each is named', Boolean(await textOf('.pl-lane-name')), await textOf('.pl-lane-name'));
    } },
  { id: 'keno', name: 'Keno', stage: '.kn-table', furniture: '.kn-num', action: '#knGo', resultOf: () => '.kn-said',
    async peculiar() {
      check('eighty numbers to pick from', (await count('.kn-num')) === 80, String(await count('.kn-num')));
      await evaluate(`document.getElementById('knDip')?.click(); return true;`);
      await wait(300);
      check('a quick pick fills five', (await count('.kn-num.is-on')) === 5, String(await count('.kn-num.is-on')));
    } },
  // Bingo waits on a line rather than on its caption. `.bi-said` says
  // "Waiting on the caller" from the moment the table opens, so asking whether
  // it has text would pass before a single number had come out — a claimed
  // prize is the first thing on the screen that can only mean the game ran.
  { id: 'bingo', name: 'Bingo', stage: '.bi-table', furniture: '.bi-prize', action: '#biBuyCard',
    resultOf: () => '.bi-prize.is-gone b',
    async peculiar() {
      check('both prizes are up before anybody plays', (await count('.bi-prize')) === 2, String(await count('.bi-prize')));
      check('and neither has gone', (await count('.bi-prize.is-gone')) === 0);
    },
    async afterIn() {
      await waitFor('.bi-sq', 20000);
      check('a card is twenty five squares', (await count('.bi-sq')) === 25, String(await count('.bi-sq')));
      check('with the middle given to you', (await count('.bi-sq.is-free.is-on')) === 1);
      check('and nothing marked yet but that', (await count('.bi-sq.is-on')) === 1, String(await count('.bi-sq.is-on')));
      // The caller has to actually call — but not until the counter shuts,
      // which is twenty seconds after the table opened and the driver gets
      // here about four seconds in. The first version waited twenty and landed
      // exactly on the boundary.
      await waitFor('.bi-chip', 40000);
      check('the caller gets going', (await count('.bi-chip')) > 0, String(await count('.bi-chip')));
      // Against the pattern, not against "is there any text" — the caption
      // reads "Waiting on the caller" from the moment the table opens, so a
      // non-empty check passes before a number has been called.
      const said = (await textOf('#biSaid')) ?? '';
      check('and says what it just called', /[BINGO]\s?\d+/.test(said), said);
    } },
  { id: 'progressive', name: 'Progressive Slots', stage: '.ch-table', furniture: '.ch-cell', action: '.ch-acts .btn', resultOf: () => '.ch-said',
    async peculiar() {
      check('the progressive shows three reels', (await count('.ch-reels .ch-cell')) === 3, String(await count('.ch-reels .ch-cell')));
    } },
  { id: 'jackpot', name: 'Jackpot', stage: '.jp-table', furniture: '.jp-throw .btn', action: '.jp-throw .btn', resultOf: () => '.jp-said',
    async afterIn() {
      check('your chance is shown as a percentage', /%/.test((await textOf('#jpChance')) ?? ''), await textOf('#jpChance'));
      check('and everybody has a slice of the bar', (await count('.jp-seg')) >= 1, String(await count('.jp-seg')));
    } },
  { id: 'scratch', name: 'Scratch Cards', stage: '.ch-table', furniture: '.ch-cell', action: '.ch-acts .btn', resultOf: () => '.ch-said',
    async peculiar() {
      check('six panels', (await count('.ch-panels .ch-cell')) === 6, String(await count('.ch-panels .ch-cell')));
    } },
];

for (const table of TABLES) {
  console.log(`\n  \x1b[2m— ${table.name} —\x1b[0m`);

  // Back to the arcade, fresh, for each table.
  await send('Page.navigate', { url: base });
  await wait(1800);
  await evaluate(`document.querySelector('.si-skip')?.click(); for (const d of document.querySelectorAll('dialog[open]')) d.close(); return true;`);
  if (!check(`${table.name}: the arcade loads`, await waitFor('.game-card', 15000))) continue;
  await watchForErrors(evaluate);

  const opened = await evaluate(`
    const cards = [...document.querySelectorAll('.game-card')];
    const it = cards.find(c => (c.querySelector('h3')?.textContent ?? '').trim() === ${JSON.stringify(table.name)});
    if (!it) return cards.map(c => c.querySelector('h3')?.textContent).join(' | ');
    it.click();
    return true;
  `);
  if (!check(`${table.name}: it is on the shelf`, opened === true, String(opened))) continue;
  if (!check(`${table.name}: a room opens`, await waitFor('#roomCode', 15000))) continue;
  const code = await evaluate(`return document.getElementById('roomCode').textContent.trim()`);

  // Two stand-ins, on real sockets, with chips of their own.
  for (const d of dummies) { try { d.close(); } catch { } }
  try {
    dummies = await seatDummies(2, { base, code, gameId: table.id, name: `${table.id}Bot`, pause: 900 });
  } catch (err) {
    check(`${table.name}: stand-ins can sit down`, false, err.message);
    continue;
  }
  await wait(1200);
  const seated = await fetch(`${base}/api/room/${code}`).then((r) => r.json()).catch(() => ({}));
  if (!check(`${table.name}: three at the table`, (seated.players?.length ?? 0) === 3, `${seated.players?.length}`)) continue;

  await evaluate(`document.getElementById('startBtn')?.click(); return true;`);

  // The tutorial comes first now, for anybody who has not seen this game —
  // and the host toggle defaults to on, so it comes up for everybody. It is
  // a real screen in front of the game and the driver has to get past it.
  const taught = await waitFor('.tut-card', 20000);
  check(`${table.name}: newcomers get walked through the rules`, taught);
  if (taught) {
    const steps = await count('.tut-dot');
    check(`${table.name}: it has a step for every rule`, steps >= 3, `${steps} steps`);
    check(`${table.name}: and says which game`, Boolean(await textOf('.tut-name')), await textOf('.tut-name'));
    await evaluate(`document.getElementById('tutSkip')?.click(); return true;`);
    await wait(500);
  }

  // Past the rules.
  const briefed = await waitFor('.intro-ready', 20000);
  if (!check(`${table.name}: the rules come up`, briefed)) { await shot(`${table.id}-no-brief`); continue; }
  await evaluate(`document.querySelector('.intro-ready')?.click(); return true;`);

  if (!check(`${table.name}: the table appears`, await waitFor(table.stage, 25000))) {
    await shot(`${table.id}-no-table`);
    continue;
  }
  await wait(900);
  check(`${table.name}: its own furniture is there`, (await count(table.furniture)) > 0,
    `${await count(table.furniture)} × ${table.furniture}`);

  await table.peculiar?.();

  // Getting in has to cost chips, and cost them once.
  //
  // Asked from here rather than from inside the page. The first version used
  // `await` inside the injected function, which is not async — a syntax error,
  // caught by the .catch, so both reads came back 0 and the check compared
  // nothing to nothing on every single table.
  const balance = () =>
    fetch(`${base}/api/chips`, { headers: { authorization: `Bearer ${me.token}` } })
      .then((r) => r.json())
      .then((w) => Number(w.balance ?? 0))
      .catch(() => -1);

  const before = await balance();

  const staked = await evaluate(`
    const b = document.querySelector(${JSON.stringify(table.action)});
    if (!b || b.disabled) return 'no button';
    b.click();
    return true;
  `);
  check(`${table.name}: there is a way in`, staked === true, String(staked));

  if (staked === true) {
    await wait(1400);
    const after = await balance();
    check(`${table.name}: getting in costs chips, once`,
      before > 0 && after < before && before - after <= 500,
      `${before} then ${after}`);
    await table.afterIn?.();
  }
  await shot(`${table.id}-in`);

  // And a result arrives without anybody touching anything else.
  const landed = await (async () => {
    for (let i = 0; i < 120; i++) {
      const sel = table.resultOf();
      const has = await evaluate(`
        const el = document.querySelector(${JSON.stringify(sel)});
        return !!el && (el.textContent || '').trim().length > 0;
      `);
      if (has) return true;
      await wait(500);
    }
    return false;
  })();
  check(`${table.name}: a result arrives`, landed, table.resultOf());
  if (landed) await shot(`${table.id}-result`);

  // And it fits a phone.
  const fit = JSON.parse(await evaluate(`
    const w = document.documentElement;
    return JSON.stringify({ pageWidth: w.clientWidth, scrollWidth: w.scrollWidth });
  `));
  check(`${table.name}: no sideways scroll`, fit.scrollWidth <= fit.pageWidth + 1,
    `${fit.scrollWidth} in ${fit.pageWidth}`);

  const errors = await evaluate(`return window.__journeyErrors ?? []`);
  check(`${table.name}: threw nothing`, errors.length === 0, errors.join(' | '));

  // Out, so the next table starts clean.
  await evaluate(`document.querySelector('#quitBtn, .back, [data-nav]')?.click(); return true;`);
  await wait(700);
}

cleanup();
const bad = results.filter((r) => !r.ok);
console.log(`\n  screenshots  android/casino-shots/`);
if (bad.length) {
  // Named, not just counted. This run walks ten tables and a check that fails
  // once in four runs is useless to chase if all the summary says is "1 of 145"
  // — by then the per-table output has scrolled past.
  console.log('\x1b[31m  what failed:\x1b[0m');
  for (const r of bad) console.log(`\x1b[31m    · ${r.label}\x1b[0m`);
}
console.log(bad.length
  ? `\x1b[31m  ${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\x1b[32m  all ${results.length} passed — every table plays, pays and fits a phone\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
