// The page where friends send in a picture round.
//
//   npm run test:add
//
// This page has no tests behind it and the people using it are the ones least
// able to work around a bug — a friend, on a phone, following a link, once.
// If it half-works they do not report it, they close the tab.
//
// So this drives it the way they will: type an answer, add pictures, send it,
// and check that what came out the other end is a round the game can deal.
// Run in a phone-sized window, because that is the only screen it will see.
//
// The part worth the most here is the duplicate check. Two people picking the
// same famous song is the likeliest thing that will ever happen to this form,
// and before the guard the second submission silently overwrote the first.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { pageTools, watchForErrors } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-add');
const PROFILE = path.join(ROOT, 'tmp-add-profile');
const PORT = 3204;
const CDP = 9477;
const base = `http://127.0.0.1:${PORT}`;
const STORE = path.join(TMP, 'media', 'my-clues');

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
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)); }, 30000);
  });
}
async function evaluate(body) {
  const r = await send('Runtime.evaluate', { expression: `(function(){${body}})()`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}
const { click, waitFor, textOf, typeInto, count } = pageTools(evaluate);

console.log('\n  \x1b[1mSending in a picture round\x1b[0m  \x1b[2m(390x780, the screen it will be used on)\x1b[0m\n');
if (!check('a Chromium browser is installed', Boolean(CHROME))) { cleanup(); process.exit(1); }

for (const d of [TMP, PROFILE]) rmSync(d, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  // MEDIA_DIR — not MEDIA_ROOT, which is the exported constant and not the
  // variable that sets it. Getting that wrong does not fail loudly: the server
  // falls through to the studio's real store on G: and the test happily writes
  // rounds into it, which is how this test first left two folders behind.
  env: {
    ...process.env,
    PORT: String(PORT), DATA_DIR: TMP, MEDIA_DIR: path.join(TMP, 'media'),
    NODE_ENV: 'test', LLM_BOTS: '0', STUDY_PROXY: '0',
  },
  stdio: 'ignore',
});
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await wait(250);
  up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
}
if (!check('test server running', up)) { cleanup(); process.exit(1); }

// Asked, not assumed. This test writes real rounds, and the first version of it
// wrote them into the studio's own store because one environment variable was
// named wrong. Nothing downstream noticed — the rounds were valid, they were
// just in somebody's real game.
const where = await fetch(`${base}/api/media`).then((r) => r.json()).catch(() => ({}));
if (!check('the server is using this test\'s own store', where.root === path.join(TMP, 'media'), `using ${where.root}`)) {
  cleanup();
  process.exit(1);
}

browser = spawn(CHROME, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROFILE}`, '--headless=new',
  '--window-size=390,780', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `${base}/add`,
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
  const m = JSON.parse(raw);
  const slot = pending.get(m.id);
  if (!slot) return;
  pending.delete(m.id);
  m.error ? slot.reject(new Error(m.error.message)) : slot.resolve(m.result);
});
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });

if (!check('the page opens', await waitFor('#answer', 15000))) { cleanup(); process.exit(1); }
await watchForErrors(evaluate);

/* ---------------------------- what a first-timer sees --------------------- */

check('it explains what a picture puzzle is', Boolean(await textOf('.how-it-works')));
check('it shows a worked example', (await count('.worked-row')) >= 2, `${await count('.worked-row')} examples`);
check('the search for what is already in is on the page', await waitFor('#lookup'));
check(
  'the empty store says so plainly',
  (await textOf('#takenCount'))?.includes('Nothing yet'),
  await textOf('#takenCount')
);

/* -------------------------------- adding pictures ------------------------- */

// The real file picker cannot be driven, so the pictures are pushed through
// the same path a chosen file takes: shrink() produces a data URL, and that is
// what goes in shots[]. This adds the data URLs directly and calls the page's
// own paint, which is everything after the picker.
const addPictures = (n, colour = 'red') => evaluate(`
  const shots = [];
  for (let i = 0; i < ${n}; i++) {
    const c = document.createElement('canvas');
    c.width = c.height = 40;
    const ctx = c.getContext('2d');
    ctx.fillStyle = ${JSON.stringify(colour)};
    ctx.fillRect(0, 0, 40, 40);
    ctx.fillStyle = '#fff';
    ctx.font = '28px sans-serif';
    ctx.fillText(String(i + 1), 10, 30);
    shots.push(c.toDataURL('image/jpeg', 0.8));
  }
  window.__shots = shots;
  return shots.length;
`);

// Driven through the module's own state by re-implementing the send, because
// the page's script is a module and its variables are not reachable from here.
// Everything server-side is the real thing.
const sendRound = (answer, kind, clues, pictureVar = '__shots') => evaluate(`
  return fetch('/api/clues', {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({
      answer: ${JSON.stringify(answer)},
      kind: ${JSON.stringify(kind)},
      clues: ${JSON.stringify(clues)},
      pictures: window.${pictureVar},
    }),
  }).then(r => r.json().then(j => ({status: r.status, ...j})));
`);

/* ------------------ the two ways in that are not the picker --------------- */

// A real DataTransfer carrying a real File, dispatched as the browser would.
// Nothing about this is faked past the event itself: the page's own handler
// runs, its own shrink() runs, and the result lands in its own shots[].
const dropOrPaste = (how) => evaluate(`
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'purple';
  ctx.fillRect(0, 0, 32, 32);

  return new Promise((resolve) => {
    c.toBlob(async (blob) => {
      const file = new File([blob], 'pasted.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const before = document.querySelectorAll('.shot').length;

      if (${JSON.stringify(how)} === 'paste') {
        document.body.focus();
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      } else {
        const zone = document.querySelector('.add-page');
        zone.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
        const lit = document.body.classList.contains('dropping');
        zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        window.__litUp = lit;
      }

      // shrink() reads and redraws the file, so give it a moment.
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (document.querySelectorAll('.shot').length > before) break;
      }
      resolve({
        added: document.querySelectorAll('.shot').length - before,
        litUp: window.__litUp ?? null,
        stillDropping: document.body.classList.contains('dropping'),
      });
    }, 'image/png');
  });
`);

const pasted = await dropOrPaste('paste');
check('a pasted picture is taken', pasted.added === 1, JSON.stringify(pasted));

const dropped = await dropOrPaste('drop');
check('a dragged picture is taken', dropped.added === 1, JSON.stringify(dropped));
check('the page says where to drop it', dropped.litUp === true, `dropping class: ${dropped.litUp}`);
check('and stops saying so once it lands', dropped.stillDropping === false);

check('the page still says you can paste or drag',
  (await textOf('#addShot'))?.includes('paste'),
  await textOf('#addShot'));

// Cleared, so the counts below are about what this test adds next.
await evaluate(`
  for (const b of document.querySelectorAll('.shot-drop')) b.click();
  return document.querySelectorAll('.shot').length;
`);

check('three pictures made', (await addPictures(3)) === 3);

const first = await sendRound('Naatu Naatu', 'song', ['From RRR', 'Two men dancing']);
check('a new round is accepted', first.ok === true, JSON.stringify(first).slice(0, 140));

const onDisk = existsSync(path.join(STORE, 'Naatu Naatu')) ? readdirSync(path.join(STORE, 'Naatu Naatu')) : [];
check('it wrote the folder a person would have made by hand',
  onDisk.filter((f) => /\.jpg$/.test(f)).length === 3 && onDisk.includes('clues.txt') && onDisk.includes('kind.txt'),
  onDisk.join(', '));

/* --------------------------- the same one, again -------------------------- */

const dupe = await sendRound('naatu  naatu!', 'song', []);
check('the same song typed differently is refused', dupe.status === 409, `status ${dupe.status}`);
check('the refusal says which one is already there', dupe.taken === 'Naatu Naatu', String(dupe.taken));
check('the refusal reads like a person wrote it', /already in the game/.test(dupe.error ?? ''), dupe.error);

const stillThere = existsSync(path.join(STORE, 'Naatu Naatu')) ? readdirSync(path.join(STORE, 'Naatu Naatu')) : [];
check('the first round was not overwritten',
  stillThere.filter((f) => /\.jpg$/.test(f)).length === 3,
  `${stillThere.filter((f) => /\.jpg$/.test(f)).length} pictures`);

/* ----------------- and the page warns before any of that work ------------- */

await send('Page.reload');
await wait(400);
if (!check('the page reopens', await waitFor('#answer', 15000))) { cleanup(); process.exit(1); }
await watchForErrors(evaluate);

// Give the list a moment to arrive, since it is fetched.
for (let i = 0; i < 30; i++) {
  if ((await count('.taken-item')) > 0) break;
  await wait(200);
}
check('what is already in is listed', (await count('.taken-item')) === 1, `${await count('.taken-item')} shown`);
check('the listed round is named', (await textOf('.taken-item b')) === 'Naatu Naatu', await textOf('.taken-item b'));

await typeInto('#answer', 'The Naatu Naatu');
await wait(250);
const warned = await evaluate(`return !document.getElementById('answerTaken').hidden`);
check('typing a title somebody already did warns straight away', warned, await textOf('#answerTaken'));

await typeInto('#answer', 'Something Nobody Has Done');
await wait(250);
check('a fresh title does not warn',
  await evaluate(`return document.getElementById('answerTaken').hidden`));

// Searching is the whole point: it is meant to be used before the pictures are
// hunted down, not after.
await typeInto('#lookup', 'naatu');
await wait(250);
check('searching finds it', (await count('.taken-item')) === 1);
await typeInto('#lookup', 'zzzz nothing');
await wait(250);
check('searching for something new says it is free',
  (await textOf('#takenCount'))?.includes('yours to make'), await textOf('#takenCount'));

/* ------------------------- the refusals people will hit ------------------- */

await addPictures(1, 'blue');
const tooFew = await sendRound('Only One Picture', 'song', []);
check('one picture is not a round', Boolean(tooFew.error), tooFew.error);

await evaluate(`window.__none = []; return true;`);
const noPics = await sendRound('No Pictures At All', 'movie', [], '__none');
check('no pictures is refused kindly', /at least two pictures/i.test(noPics.error ?? ''), noPics.error);

await addPictures(2, 'green');
const shortName = await sendRound('a', 'song', []);
check('a one-letter answer is refused', Boolean(shortName.error), shortName.error);

// A film, so both halves of the form are exercised, and to prove a different
// title still goes in after all those refusals.
const film = await sendRound('Kaakka Kaakka', 'movie', ['A Gautham Menon film']);
check('a different title still goes in', film.ok === true, JSON.stringify(film).slice(0, 120));

/* ------------------------- and the game can deal them --------------------- */

const listed = await fetch(`${base}/api/clues`).then((r) => r.json());
check('both are on the list the page reads', listed.titles?.length === 2, JSON.stringify(listed.titles));
check('the list says which is a film',
  listed.titles?.find((t) => t.answer === 'Kaakka Kaakka')?.kind === 'movie',
  JSON.stringify(listed.titles?.map((t) => `${t.answer}:${t.kind}`)));

// The pictures have to be reachable, or the round shows as broken images.
const url = `${base}/media/mine/${encodeURIComponent('Naatu Naatu')}/1.jpg`;
const pic = await fetch(url).then((r) => ({ status: r.status, type: r.headers.get('content-type') })).catch((e) => ({ status: e.message }));
check('a submitted picture is actually served', pic.status === 200, `${url} → ${pic.status} ${pic.type ?? ''}`);

/* ----------------------------------- quiet? ------------------------------- */

const errors = await evaluate(`return window.__journeyErrors ?? []`);
check('the page threw nothing', errors.length === 0, errors.join(' | '));

cleanup();
const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n\x1b[31m  ${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n\x1b[32m  all ${results.length} passed — a friend can send in a round, and cannot send the same one twice\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
