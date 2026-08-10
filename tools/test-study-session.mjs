// Does Study remember you?
//
//   npm run test:study-session
//
// Reported as "every time i click ielts its asking for me to put my id and
// login each time". Signing in wrote a thirty-day cookie and a session row,
// and then nothing in the app ever read either one — getSessionUser existed
// and was never called from anywhere. So the front door showed "I have a
// Hypnic ID" to a signed-in person, forever, and the dashboard rendered the
// same page for everybody including nobody.
//
// Nothing static could catch that. The cookie was correct, the row was
// correct, every page rendered without error. The only way to see it is to
// arrive with a session and look at what you get.
//
// The session is minted straight into the database rather than typed into the
// sign-in form, because what broke was reading it, not writing it — and going
// through the form would need a studio PIN and a place on the invite list,
// neither of which is the thing under test.
//
// Needs the studio running with Study behind it: npm start.

import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { pageTools } from './lib/journey.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const STUDY_ROOT = process.env.HYPNIC_STUDY_ROOT || path.join(ROOT, '..', 'IELTS');
const PROFILE = path.join(ROOT, 'tmp-study-profile');
const PORT = Number(process.env.PORT) || 8008;
const CDP = 9479;
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

/** Runs the session script that lives beside Study's own database code. */
const sessionScript = (verb) =>
  JSON.parse(
    execFileSync('npx', ['tsx', path.join('scripts', 'test-session.ts'), verb], {
      cwd: STUDY_ROOT,
      encoding: 'utf8',
      shell: true,
    }).trim().split('\n').pop()
  );

let browser = null;
let ws = null;
let minted = false;
function cleanup() {
  try { ws?.close(); } catch { }
  try { browser?.kill(); } catch { }
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { }
  // The account exists only for this run. Left behind it would show up in any
  // member list Study ever grows.
  if (minted) { try { sessionScript('destroy'); } catch { /* say so below */ } }
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });

let msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)); }, 60000);
  });
}
async function evaluate(body) {
  const r = await send('Runtime.evaluate', { expression: `(function(){${body}})()`, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}
const { waitFor } = pageTools(evaluate);

const url = () => evaluate(`return location.pathname`);
const goTo = async (p) => {
  await send('Page.navigate', { url: `${base}${p}` });
  await wait(2500);
};

/** Reattaches to whatever page the browser has open. */
async function attach() {
  let page = null;
  for (let i = 0; i < 60 && !page; i++) {
    await wait(300);
    const list = await fetch(`http://127.0.0.1:${CDP}/json`).then((r) => r.json()).catch(() => []);
    page = list.find((p) => p.type === 'page' && p.webSocketDebuggerUrl && !p.url.startsWith('devtools'));
  }
  if (!page) return false;
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
  await send('Network.enable');
  return true;
}

console.log('\n  \x1b[1mDoes Study remember you?\x1b[0m\n');
if (!check('a Chromium browser is installed', Boolean(CHROME))) { cleanup(); process.exit(1); }

const alive = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
if (!check('the studio is running', alive, `expected it at ${base} — start it with npm start`)) { cleanup(); process.exit(1); }
const studyUp = await fetch(`${base}/study/login`).then((r) => r.ok).catch(() => false);
if (!check('Study is behind it', studyUp)) { cleanup(); process.exit(1); }

/* ------------------------------ signed out first -------------------------- */

rmSync(PROFILE, { recursive: true, force: true });
browser = spawn(CHROME, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROFILE}`, '--headless=new',
  '--window-size=1000,900', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `${base}/study`,
], { stdio: 'ignore' });
if (!check('browser attached', await attach())) { cleanup(); process.exit(1); }

await goTo('/study');
check('signed out, the front door shows the pitch', (await url()) === '/study', await url());
check('and offers a way in', await waitFor('a[href$="/login"]', 8000));

await goTo('/study/dashboard');
check('signed out, the dashboard sends you to sign in', (await url()) === '/study/login', await url());

/* ------------------------------ now with a session ------------------------ */

let session;
try {
  session = sessionScript('create');
  minted = true;
} catch (err) {
  check('a session can be minted', false, String(err.message).slice(0, 300));
  cleanup();
  process.exit(1);
}
check('a session exists in the database', Boolean(session.token), session.hypnicId);

// Set the way the sign-in would have set it: thirty days, path /, not Secure
// (this address is plain http, and a Secure cookie would simply be discarded).
// Set by url rather than by domain: for a bare IP host, Chrome rejects a
// `domain` attribute outright and setCookie reports success anyway, so the
// cookie silently never exists.
const set = await send('Network.setCookie', {
  name: 'hypnic_session',
  value: session.token,
  url: base,
  path: '/',
  httpOnly: true,
  secure: false,
  expires: Math.floor(Date.now() / 1000) + 30 * 86400,
});
const afterSet = await send('Network.getCookies', { urls: [base] });
if (!check('the browser accepted the cookie',
  afterSet.cookies.some((c) => c.name === 'hypnic_session'),
  `setCookie said ${JSON.stringify(set)}`)) {
  cleanup();
  process.exit(1);
}

await goTo('/study');
check('the front door now takes you straight to the dashboard',
  (await url()) === '/study/dashboard',
  `landed at ${await url()}`);

const shown = await evaluate(`return document.body.innerText`);
check('the dashboard says who you are', shown.includes(session.displayName), `looking for "${session.displayName}"`);
check('there is a way to sign out', shown.includes('Sign out'));

/* --------------- the actual complaint: going away and coming back --------- */

await goTo('/');
await goTo('/study');
check('coming back from the arcade goes straight in',
  (await url()) === '/study/dashboard', `landed at ${await url()}`);

await goTo('/study/dashboard');
check('the dashboard opens directly, no detour through sign-in',
  (await url()) === '/study/dashboard', `landed at ${await url()}`);

/* ---------------------- and after closing the browser --------------------- */

// Closed through the browser rather than killed. Chrome writes its cookie
// store to disk lazily, so a kill loses every cookie set in this run and the
// restart below reports "not signed in" for a reason that has nothing to do
// with the app.
await send('Page.navigate', { url: 'about:blank' });
await wait(300);
try { await send('Browser.close'); } catch { /* it may go before answering */ }
try { ws.close(); } catch { }
await wait(2500);
try { browser.kill(); } catch { }
await wait(1000);

browser = spawn(CHROME, [
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${PROFILE}`, '--headless=new',
  '--window-size=1000,900', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  `${base}/study`,
], { stdio: 'ignore' });

if (check('browser reopened', await attach())) {
  await wait(2500);
  // The case a session cookie with no expiry fails: it dies with the window,
  // which is its own version of "it keeps asking me to log in".
  check('still signed in after closing the browser',
    (await url()) === '/study/dashboard', `landed at ${await url()}`);

  const jar = await send('Network.getCookies', { urls: [base] });
  const cookie = jar.cookies.find((c) => c.name === 'hypnic_session');
  check('the cookie survived the restart', Boolean(cookie));
  check('it is good for weeks, not for this window',
    Boolean(cookie) && cookie.expires > 0 && cookie.expires * 1000 > Date.now() + 20 * 86_400_000,
    cookie ? `expires ${new Date(cookie.expires * 1000).toLocaleDateString()}` : 'no cookie');
}

/* ---------------------------------- and out ------------------------------- */

const clicked = await evaluate(`
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Sign out');
  if (b) b.click();
  return !!b;
`);
if (check('the sign-out button is clickable', clicked)) {
  await wait(3500);
  check('signing out actually signs you out', (await url()) === '/study', `landed at ${await url()}`);
  await goTo('/study/dashboard');
  check('and the dashboard is closed again', (await url()) === '/study/login', `landed at ${await url()}`);
}

cleanup();
const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n\x1b[31m  ${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n\x1b[32m  all ${results.length} passed — sign in once and Study remembers you\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
