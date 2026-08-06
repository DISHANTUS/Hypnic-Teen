// One command to run the whole studio.
//
//   npm start
//
// Brings up everything a party needs and reports what it did: the local model
// for CPU players, the content bank, the game server, and every address your
// friends can reach it on. Anything optional that is missing becomes a line of
// explanation rather than a failure — a studio with no local model still runs
// a full night of games.

import { spawn, execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { joinAddresses } from '../server/addresses.js';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const PORT = Number(process.env.PORT) || 8008;

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const portOpen = (port, host = '127.0.0.1') =>
  new Promise((resolve) => {
    const sock = createConnection({ port, host })
      .on('connect', () => {
        sock.destroy();
        resolve(true);
      })
      .on('error', () => resolve(false));
    setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 1200);
  });

console.log(`\n  ${bold('Hypnic Teen — Fun World')}\n`);

/* ------------------------------ the local model --------------------------- */

const OLLAMA_PORT = 11434;
let llmNote = '';

if (await portOpen(OLLAMA_PORT)) {
  llmNote = green('already running');
} else if (process.env.LLM_BOTS === '0') {
  llmNote = dim('disabled by LLM_BOTS=0');
} else {
  // Starting it is a convenience, not a requirement — if Ollama is not
  // installed this quietly becomes "CPU players use canned lines".
  try {
    const child = spawn('ollama', ['serve'], { stdio: 'ignore', detached: true, shell: true });
    child.unref();
    for (let i = 0; i < 12 && !(await portOpen(OLLAMA_PORT)); i++) await wait(500);
    llmNote = (await portOpen(OLLAMA_PORT)) ? green('started') : yellow('not installed — CPU players will use canned lines');
  } catch {
    llmNote = yellow('not installed — CPU players will use canned lines');
  }
}

let modelNote = '';
if (await portOpen(OLLAMA_PORT)) {
  try {
    const { models = [] } = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/tags`).then((r) => r.json());
    modelNote = models.length ? models.map((m) => m.name).join(', ') : yellow('no model pulled — run: ollama pull qwen3:8b');
  } catch {
    modelNote = yellow('not answering');
  }
}
console.log(`  local model   ${llmNote}${modelNote ? dim(`  (${modelNote})`) : ''}`);

/* -------------------------------- the bank -------------------------------- */

const bankDir = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'bank');
let banked = 0;
if (existsSync(bankDir)) {
  for (const file of readdirSync(bankDir)) {
    if (!file.endsWith('.json')) continue;
    try {
      banked += JSON.parse(readFileSync(path.join(bankDir, file), 'utf8')).length;
    } catch {
      /* a broken bank file is the server's problem to report, not the launcher's */
    }
  }
}
console.log(
  `  content bank  ${banked ? green(`${banked.toLocaleString()} generated items`) : dim('built-in only')}` +
    dim(banked ? '' : '  (grow it: npm run grow)')
);

/* -------------------------------- the port -------------------------------- */

if (await portOpen(PORT)) {
  // Almost always this is the studio already running — a window left open, or
  // a copy started in the background. Saying "something else is serving there"
  // and quitting sends somebody hunting for a conflict that is really their
  // own studio, with the links they wanted sitting in a file the whole time.
  let mine = false;
  try {
    const health = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(2500) });
    mine = health.ok && Boolean((await health.json())?.ok);
  } catch {
    /* something is listening, but it is not us */
  }

  if (mine) {
    console.log(`\n  ${green('The studio is already running on this port.')}`);
    const saved = path.join(ROOT, 'LINKS.txt');
    // Only if it describes *this* port. The file is rewritten by every run,
    // including a run on some other port for a test, and printing that back
    // hands somebody addresses to a studio that is not the one serving them.
    let text = null;
    if (existsSync(saved)) {
      try {
        const body = readFileSync(saved, 'utf8');
        if (body.includes(`:${PORT}`)) text = body;
      } catch {
        /* unreadable is the same as absent here */
      }
    }
    if (text) {
      console.log('');
      for (const line of text.split('\n')) if (line.trim()) console.log(`  ${line}`);
    } else {
      console.log(dim(`\n  Open it at http://localhost:${PORT} — the saved links are for a different run.`));
    }
    console.log(dim('\n  Nothing to do — that one is serving. To restart it, close the window'));
    console.log(dim(`  running it (or end the node task), then run this again.\n`));
  } else {
    console.log(`\n  ${yellow(`Port ${PORT} is in use by something that is not the studio.`)}`);
    console.log(dim(`  Stop it, or set PORT to another number.\n`));
  }
  process.exit(mine ? 0 : 1);
}

/* ---------------------------- study, decided early ------------------------ */

// Serving Study under a prefix on this port is what lets one tunnel carry
// both — a second port has no route from outside the house. Decided before
// the server starts, because the server has to know whether to mount the
// proxy, and Study has to be built knowing its own prefix.
// The IELTS trainer is a separate project that signs people in with their
// Hypnic ID, so it belongs to the same evening as the studio. Missing or
// broken, it becomes a line of explanation rather than a failed launch.
const STUDY_ROOT = process.env.HYPNIC_STUDY_ROOT || path.join(ROOT, '..', 'IELTS');
const STUDY_PORT = Number(process.env.STUDY_PORT) || 3000;
const STUDY_BASE = process.env.STUDY_BASE_PATH ?? '/study';
// Dev mode cannot be proxied under a prefix reliably — its hot-reload client
// assumes the root — so the two are mutually exclusive.
const STUDY_DEV = process.env.STUDY_DEV === '1';
const willProxy = Boolean(STUDY_BASE) && !STUDY_DEV && process.env.NO_STUDY !== '1'
  && existsSync(path.join(STUDY_ROOT, 'package.json'));

/* ------------------------------- the server ------------------------------- */

const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  stdio: 'inherit',
  env: { ...process.env, STUDY_PROXY: willProxy ? '1' : '0', STUDY_PORT: String(STUDY_PORT) },
});

/* ------------------------------ hypnic study ------------------------------ */

let study = null;

const NEXT_BIN = path.join(STUDY_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');

/** Runs one Next command to completion. Resolves to its exit code. */
function runNext(args, label) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [NEXT_BIN, ...args], {
      cwd: STUDY_ROOT,
      stdio: process.env.STUDY_LOGS === '1' ? 'inherit' : 'ignore',
      env: { ...process.env, PORT: String(STUDY_PORT), BASE_PATH: STUDY_DEV ? '' : STUDY_BASE },
    });
    child.on('error', () => resolve(-1));
    child.on('exit', (code) => resolve(code ?? -1));
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());
    void label;
  });
}

/**
 * Whether the compiled build is older than the source it was compiled from.
 * Cheap and approximate on purpose — comparing every file would cost more than
 * the occasional unnecessary rebuild.
 */
function buildIsStale() {
  const built = path.join(STUDY_ROOT, '.next', 'BUILD_ID');
  if (!existsSync(built)) return true;
  const builtAt = statSync(built).mtimeMs;
  let newest = 0;
  const walk = (dir, depth = 0) => {
    if (depth > 4 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (/\.(tsx?|jsx?|css|json)$/.test(entry.name)) {
        newest = Math.max(newest, statSync(full).mtimeMs);
      }
    }
  };
  for (const sub of ['src', 'app', 'public']) walk(path.join(STUDY_ROOT, sub));
  for (const f of ['next.config.ts', 'next.config.js', 'next.config.mjs', 'package.json']) {
    const full = path.join(STUDY_ROOT, f);
    if (existsSync(full)) newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest > builtAt;
}

async function startStudy() {
  if (process.env.NO_STUDY === '1') return 'skipped (NO_STUDY=1)';
  if (!existsSync(path.join(STUDY_ROOT, 'package.json'))) {
    return `not found at ${STUDY_ROOT}`;
  }
  if (!existsSync(path.join(STUDY_ROOT, 'node_modules'))) {
    return 'found, but its dependencies are not installed yet';
  }

  // Dev mode is for the person writing it, not for the people using it: it is
  // slow, and it puts a React error overlay with a stack trace in front of any
  // guest who trips a transient fault. Friends using it is the common case, so
  // a production build is the default and dev is the flag.
  const dev = STUDY_DEV;

  if (!dev && buildIsStale()) {
    process.stdout.write(dim('  building IELTS training… '));
    const code = await runNext(['build'], 'build');
    if (code !== 0) {
      console.log(yellow('failed'));
      return `build failed (exit ${code}) — run it with STUDY_LOGS=1 to see why`;
    }
    console.log(green('done'));
  }

  try {
    study = spawn(
      process.execPath,
      dev
        ? [NEXT_BIN, 'dev', '-H', '0.0.0.0']
        : [NEXT_BIN, 'start', '-H', '0.0.0.0', '-p', String(STUDY_PORT)],
      {
        cwd: STUDY_ROOT,
        // Quiet by default: two servers interleaving output in one terminal is
        // unreadable. STUDY_LOGS=1 when you need to debug it.
        stdio: process.env.STUDY_LOGS === '1' ? 'inherit' : 'ignore',
        // BASE_PATH matters at run time as well as at build time: next.config
        // reads it on every start, so serving without it makes Next mount at
        // the root and 404 everything under the prefix — a page that is
        // unmistakably Study's, saying it cannot find itself.
        env: { ...process.env, PORT: String(STUDY_PORT), BASE_PATH: STUDY_DEV ? '' : STUDY_BASE },
      },
    );
  } catch {
    return 'could not start';
  }

  // `error` only fires when the spawn itself fails. Next exiting a second
  // later — port already busy, a build error, a missing env var — left `study`
  // truthy, so the launcher happily printed an address that answered nothing.
  study.on('error', () => { study = null; });
  study.on('exit', (code) => {
    if (code !== 0 && code !== null) studyExit = code;
    study = null;
  });
  return null;
}

let studyExit = null;

/** Waits for Study to actually answer, rather than assuming it will. */
async function studyReady() {
  if (!study) return false;
  for (let i = 0; i < 60; i++) {
    if (!study) return false; // died while we were waiting
    if (await portOpen(STUDY_PORT)) return true;
    await wait(500);
  }
  return false;
}

const studyNote = await startStudy();

// Ctrl-C should take both down with it, not orphan them.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.kill();
    study?.kill();
    process.exit(0);
  });
}
server.on('exit', (code) => {
  study?.kill();
  process.exit(code ?? 0);
});

/* ------------------------------ where to join ----------------------------- */

for (let i = 0; i < 40; i++) {
  await wait(250);
  if (await portOpen(PORT)) break;
}

// Which local address belongs to what. A laptop running its own hotspot while
// staying on WiFi has two, and they are not interchangeable: friends in the
// room reach the hotspot one, and nothing outside the house reaches either.
// Shared with the server rather than written twice. It was written twice, and
// only this copy got the filter that keeps the WSL adapter out — so the server
// went on printing 172.26.208.1 as a way in, and handing it to the QR code.
const addresses = joinAddresses();

/* ----------------------------- the outside world -------------------------- */

// Somebody who is not in the room needs a public address, and a laptop on a
// college network or mobile data has no way to offer one — no port to forward,
// often no public IP at all. A tunnel solves it from the inside out: the
// laptop dials out, and the URL it is given points back down that pipe.
//
// One command brings up everything, so this is on by default. `--offline` is
// there for the night you would rather not be on the internet at all.
const wantsTunnel = !(process.argv.includes('--offline') || process.env.ONLINE === '0');
// Set if Serveo refused because the key is not registered yet, so the launcher
// can show the one link that would fix it. Declared here rather than beside
// the function that writes it — that put it below its first read.
let serveoHint = null;
let publicUrl = null;
// Same reason: killWithUs() writes this while openPublicDoor() is still being
// awaited below, which is long before the bottom of this file has run. Left
// down beside watchTheDoor() it threw "cannot access before initialization"
// and took the whole studio down with it.
let tunnelChild = null;
let closingDown = false;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { closingDown = true; });

if (wantsTunnel) {
  process.stdout.write(dim('\n  opening a public door… '));
  publicUrl = await openPublicDoor(PORT);
  console.log(publicUrl ? green(publicUrl) : yellow('none — local play still works'));

  // From here it is watched. A tunnel is a long-lived outbound connection
  // over somebody else's WiFi and it will drop; nobody should learn that
  // from a friend saying the link is offline.
  watchTheDoor(publicUrl);

  // The server needs to know its own public name so that the invite link a
  // host copies works for the friend who is not in the room.
  if (publicUrl) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/api/public-url`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: publicUrl }),
      });
    } catch {
      /* the URL still prints below; only the in-app link misses out */
    }
  }
}

// One block, one column of addresses, each with a label saying who it is for.
// Two shouted headings pushed everything else off a short terminal and made a
// three-line answer look like a page; the labels carry the same information in
// the space the list already occupied.
const hotspot = addresses.filter((a) => a.hotspot);
const lan = addresses.filter((a) => !a.hotspot);
const col = (s) => dim(String(s).padEnd(15));

console.log(`\n  ${bold('Your friends join at')}`);
if (!addresses.length) {
  console.log(dim('    no network yet — turn on WiFi or your hotspot'));
}
// Every line names the network it belongs to, so there is never a second
// address with the same label and no way to tell them apart.
for (const a of [...hotspot, ...lan]) {
  console.log(`    ${col(`on ${a.what}`)} ${green(`http://${a.ip}:${PORT}`)}`);
}
if (publicUrl) {
  console.log(`    ${col('from anywhere')} ${green(publicUrl)}`);
  // One line about the address, because which kind it is decides whether the
  // link can be saved or has to be re-sent after every restart.
  if (/ngrok-free/.test(publicUrl)) {
    console.log(`    ${col('')} ${dim('never changes · they click past one warning, then a week free')}`);
  } else if (/trycloudflare\.com/.test(publicUrl)) {
    console.log(`    ${col('')} ${dim('temporary — changes every restart, so re-send it each time')}`);
    if (serveoHint) console.log(`    ${col('')} ${dim(`a fixed name: ${serveoHint}`)}`);
  }
} else if (wantsTunnel) {
  console.log(`    ${col('from anywhere')} ${dim('none — nobody outside this network can reach the studio')}`);
}

console.log(dim(`\n  on this laptop: http://localhost:${PORT}`));

// Written down as well as printed, because the terminal scrolls and the links
// are wanted later — usually from a phone, to paste into a chat.
try {
  const lines = [
    'Hypnic Teen — Fun World',
    '',
    'Friends in the room (same WiFi or hotspot):',
    ...(addresses.length
      ? addresses.map((a) => `  http://${a.ip}:${PORT}   (on ${a.what})`)
      : ['  (no network)']),
    '',
    'Friends far away (anywhere with internet):',
    `  ${publicUrl ?? '(none — started with --offline, or no tunnel available)'}`,
    '',
    ...(willProxy ? ['', 'IELTS training: add /study to any link above'] : []),
    '',
    `On this laptop: http://localhost:${PORT}`,
    `Started ${new Date().toLocaleString()}`,
    '',
  ].join('\n');
  writeFileSync(path.join(ROOT, 'LINKS.txt'), lines);
  console.log(dim('  these links are also in LINKS.txt'));
} catch {
  /* not being able to write a convenience file is not worth a warning */
}

// Study runs beside the studio and shares the same Hypnic ID, so its address
// belongs in the same list rather than in a second terminal nobody reads.
// Only advertised once it answers. Next takes a while to compile on first
// request, and printing the address the moment it was spawned meant handing
// out a link that was not up yet — or, if it had already died, never would be.
if (study && (await studyReady())) {
  const primary = (addresses.find((a) => a.hotspot) ?? addresses[0])?.ip;
  console.log(`\n  ${bold('IELTS training')}`);
  if (willProxy) {
    // Served under /study on the studio's own port, so every address above
    // reaches it — including the public one. Printing its own port here would
    // hand a friend somewhere else a link with no route to it.
    console.log(`    ${col('add to any link')} ${green('/study')}`);
    if (primary) console.log(`    ${col('')} ${dim(`e.g. http://${primary}:${PORT}/study`)}`);
    if (publicUrl) console.log(`    ${col('')} ${dim(`${publicUrl}/study`)}`);
  } else {
    if (primary) console.log(`    ${col('for friends')} ${green(`http://${primary}:${STUDY_PORT}`)}`);
    console.log(`    ${col('')} ${dim('same WiFi only — the public link does not reach a second port')}`);
  }
  console.log(`    ${col('')} ${dim('same Hypnic ID, no second signup')}`);
  console.log(`    ${col('')} ${dim(process.env.STUDY_DEV === '1'
    ? 'dev mode — guests may see error overlays; unset STUDY_DEV for a real build'
    : 'production build')}`);
} else if (studyExit !== null) {
  console.log(dim(`\n  IELTS training: stopped on its own (exit ${studyExit}) — run it with STUDY_LOGS=1 to see why`));
} else if (study) {
  console.log(dim(`\n  IELTS training: started but not answering on ${STUDY_PORT} yet`));
} else if (studyNote) {
  console.log(dim(`\n  IELTS training: ${studyNote}`));
}

console.log(dim(`\n    stop everything: Ctrl-C\n`));

/* ------------------------------- the tunnel ------------------------------- */

/** The name the studio would like to be known by, when it gets a choice. */
const WANTED_NAME = process.env.TUNNEL_NAME || 'hypnicteenstudio';

/**
 * Opens a door to the outside, preferring the ones whose address says who you
 * are. In order:
 *
 *   1. A Cloudflare tunnel you own, if TUNNEL_HOSTNAME is set. Permanent
 *      address on your own domain, never changes. The only proper answer, and
 *      the only one that costs anything.
 *   2. Serveo, which will hand out hypnicteenstudio.serveo.net once your SSH
 *      key is registered with them — free, and the address reads correctly.
 *   3. A Cloudflare quick tunnel. Always works, no account, no setup, but the
 *      address is four random words and changes every run.
 *
 * Each is tried in turn and the first one that answers wins, so this degrades
 * to something that works rather than to nothing.
 */
async function openPublicDoor(port) {
  if (process.env.TUNNEL_HOSTNAME) {
    const named = await openNamedCloudflare(port);
    if (named) return named;
  }
  // ngrok hands every free account one domain that never changes. It shows a
  // "served by ngrok" page on a visitor's first visit, and clicking through
  // silences it for a week — which beats sending a new link after every
  // restart, so it is preferred over the random-words tunnel below.
  if (process.env.NGROK_DOMAIN || process.env.NGROK_AUTHTOKEN) {
    const viaNgrok = await openNgrok(port);
    if (viaNgrok) return viaNgrok;
  }
  const viaServeo = await openServeo(port);
  if (viaServeo) return viaServeo;

  const exe = findCloudflared();
  if (!exe) return null;
  return openTunnel(exe, port);
}

/**
 * The free static domain, if one has been claimed. NGROK_DOMAIN is the name
 * ngrok assigned; the authtoken ties this machine to that account and is read
 * from the environment rather than written down anywhere in the repo.
 */
function openNgrok(port) {
  const exe = findNgrok();
  if (!exe) {
    console.log(`\n  ${yellow('NGROK_DOMAIN is set but ngrok is not installed.')}`);
    console.log(dim('    winget install ngrok.ngrok\n'));
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const args = ['http', String(port), '--log', 'stdout', '--log-format', 'json'];
    if (process.env.NGROK_DOMAIN) args.push('--domain', process.env.NGROK_DOMAIN);
    if (process.env.NGROK_AUTHTOKEN) args.push('--authtoken', process.env.NGROK_AUTHTOKEN);

    let child;
    try {
      child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      return resolve(null);
    }
    const settle = (v) => { clearTimeout(timer); resolve(v); };
    const scan = (chunk) => {
      const text = String(chunk);
      // ngrok reports the address it settled on in its own log line; taking it
      // from there rather than assuming NGROK_DOMAIN means a rejected domain
      // shows up as a failure instead of a URL that answers nothing.
      const hit = text.match(/url=(https:\/\/[\w.-]+)/) ?? text.match(/"url":"(https:\/\/[\w.-]+)"/);
      if (hit) return settle(hit[1]);
      if (/ERR_NGROK|authentication failed|is not authorized/i.test(text)) {
        console.log(`\n  ${yellow('ngrok refused the connection — check NGROK_AUTHTOKEN and NGROK_DOMAIN.')}`);
        child.kill();
        settle(null);
      }
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
    child.on('error', () => settle(null));
    child.on('exit', () => settle(null));
    const timer = setTimeout(() => { child.kill(); settle(null); }, 22000);
    killWithUs(child);
  });
}

function findNgrok() {
  const candidates = [
    process.env.NGROK,
    path.join(process.env.MEDIA_DIR || 'G:\\hpnicteenstudio_data', 'bin', 'ngrok.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', 'ngrok.exe'),
    'ngrok',
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === 'ngrok') return c;
    if (existsSync(c)) return c;
  }
  return null;
}

/** A tunnel on your own domain. Needs `cloudflared tunnel login` done once. */
function openNamedCloudflare(port) {
  const exe = findCloudflared();
  if (!exe) return Promise.resolve(null);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, ['tunnel', '--hostname', process.env.TUNNEL_HOSTNAME, '--url', `http://localhost:${port}`, '--no-autoupdate'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      return resolve(null);
    }
    const settle = (v) => { clearTimeout(timer); resolve(v); };
    const scan = (c) => { if (/Registered tunnel connection|connection registered/i.test(String(c))) settle(`https://${process.env.TUNNEL_HOSTNAME}`); };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
    child.on('error', () => settle(null));
    child.on('exit', () => settle(null));
    const timer = setTimeout(() => settle(null), 20000);
    killWithUs(child);
  });
}

/**
 * Serveo hands out the subdomain you ask for, free, once your public key is
 * registered with them. Until it is, it politely refuses and prints a link —
 * so an unregistered key simply falls through to the next option rather than
 * hanging the launch.
 */
function openServeo(port) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        'ssh',
        [
          '-o', 'StrictHostKeyChecking=no',
          '-o', 'UserKnownHostsFile=/dev/null',
          '-o', 'ExitOnForwardFailure=yes',
          '-o', 'ServerAliveInterval=30',
          '-R', `${WANTED_NAME}:80:localhost:${port}`,
          'serveo.net',
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch {
      return resolve(null);
    }
    const settle = (v) => { clearTimeout(timer); resolve(v); };
    const scan = (chunk) => {
      const text = String(chunk);
      // "you first need to register your SSH public key" — not going to happen
      // on its own, so stop waiting and let the next option have a go.
      if (/register your SSH public key|need to generate a key/i.test(text)) {
        serveoHint = (text.match(/https:\/\/console\.serveo\.net\/\S+/) ?? [])[0] ?? null;
        child.kill();
        return settle(null);
      }
      const hit = text.match(/https:\/\/[\w-]+\.serveo\.net/);
      if (hit) settle(hit[0]);
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
    child.on('error', () => settle(null));
    child.on('exit', () => settle(null));
    const timer = setTimeout(() => { child.kill(); settle(null); }, 22000);
    killWithUs(child);
  });
}

/** Anything we started goes down when we do. */
function killWithUs(child) {
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());
  server.on('exit', () => child.kill());
  // Whatever is currently holding the door open, so the watcher below can tell
  // "it died" from "it was replaced".
  tunnelChild = child;
}

/**
 * Keeps the public address alive.
 *
 * Opening a tunnel and never looking at it again is how a friend three states
 * away found the link dead twice while the studio sat here serving happily —
 * the launcher had said "done", printed the URL, and stopped caring. A tunnel
 * is a long-lived outbound connection over somebody's WiFi; it will drop.
 *
 * So: check that the address still answers, and reopen it if it does not. The
 * check goes through the public URL rather than asking whether the process is
 * alive, because a tunnel client can be running and still not be connected —
 * which is exactly the state that produces "offline" for the visitor and looks
 * fine from here.
 */
function watchTheDoor(url) {
  if (!url) return;
  let failures = 0;

  const timer = setInterval(async () => {
    if (closingDown) return clearInterval(timer);
    let alive = false;
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(12_000) });
      // ngrok's own interstitial is a 200 from ngrok, not from us, and it only
      // appears for browsers — an API call that gets HTML means the tunnel is
      // up and reaching something. Either way the door is open.
      alive = res.ok || res.status === 511;
    } catch {
      alive = false;
    }

    if (alive) {
      failures = 0;
      return;
    }

    // One failure is a flaky moment on a hotspot; three in a row is dead.
    if (++failures < 3) return;
    failures = 0;
    console.log(`\n  ${yellow('The public link stopped answering — opening it again…')}`);
    try {
      tunnelChild?.kill();
    } catch {
      /* it is probably already gone; that is the point */
    }
    const fresh = await openPublicDoor(PORT);
    if (fresh) {
      console.log(`  ${green(fresh)}${fresh === url ? dim('  (same address)') : dim('  — a new address, re-send it')}`);
      try {
        await fetch(`http://127.0.0.1:${PORT}/api/public-url`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: fresh }),
        });
      } catch {
        /* the address above is still the one to send */
      }
      if (fresh !== url) return watchTheDoor(fresh); // follow the new one
    } else {
      console.log(dim('  could not reopen it — local play is unaffected'));
    }
  }, 60_000);
  timer.unref?.();
}

function findCloudflared() {
  const candidates = [
    process.env.CLOUDFLARED,
    // Kept beside the media store rather than in the repo: it is a 54 MB
    // binary, and nobody cloning this project should have to download it.
    path.join(process.env.MEDIA_DIR || 'G:\\hpnicteenstudio_data', 'bin', 'cloudflared.exe'),
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
    'cloudflared',
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === 'cloudflared') return c; // on PATH, let spawn find it
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Starts a quick tunnel and waits for it to say what URL it got. No account,
 * no DNS, no port forwarding — the address changes every run, which is fine
 * for a party and the reason this is not the default.
 */
function openTunnel(exe, port) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      return resolve(null);
    }

    const done = (url) => {
      clearTimeout(timer);
      resolve(url);
    };
    // cloudflared prints its banner on stderr, so both streams are read.
    const scan = (chunk) => {
      // cloudflared talks to api.trycloudflare.com to set the tunnel up and
      // logs that too, so a plain match on the domain hands back Cloudflare's
      // own endpoint — which answers, looks fine, and serves nothing of ours.
      // The address we want is several words joined by hyphens; theirs is not.
      const hit = String(chunk).match(/https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+){2,}\.trycloudflare\.com/i);
      if (hit) done(hit[0]);
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
    child.on('error', () => done(null));
    child.on('exit', () => done(null));

    const timer = setTimeout(() => done(null), 25000);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill());
    server.on('exit', () => child.kill());
  });
}
