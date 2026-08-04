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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { networkInterfaces } from 'node:os';
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
  console.log(`\n  ${yellow(`Port ${PORT} is already in use.`)}`);
  console.log(dim(`  Something else is serving there — stop it, or set PORT to another number.\n`));
  process.exit(1);
}

/* ------------------------------- the server ------------------------------- */

const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  stdio: 'inherit',
  env: process.env,
});

/* ------------------------------ hypnic study ------------------------------ */

// The IELTS trainer is a separate project that signs people in with their
// Hypnic ID, so it belongs to the same evening as the studio. Missing or
// broken, it becomes a line of explanation rather than a failed launch.
const STUDY_ROOT = process.env.HYPNIC_STUDY_ROOT || path.join(ROOT, '..', 'IELTS');
const STUDY_PORT = Number(process.env.STUDY_PORT) || 3000;

let study = null;

function startStudy() {
  if (process.env.NO_STUDY === '1') return 'skipped (NO_STUDY=1)';
  if (!existsSync(path.join(STUDY_ROOT, 'package.json'))) {
    return `not found at ${STUDY_ROOT}`;
  }
  if (!existsSync(path.join(STUDY_ROOT, 'node_modules'))) {
    return 'found, but its dependencies are not installed yet';
  }

  try {
    study = spawn(
      process.execPath,
      [path.join(STUDY_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-H', '0.0.0.0'],
      {
        cwd: STUDY_ROOT,
        // Quiet by default: two dev servers interleaving output in one
        // terminal is unreadable. STUDY_LOGS=1 when you need to debug it.
        stdio: process.env.STUDY_LOGS === '1' ? 'inherit' : 'ignore',
        env: { ...process.env, PORT: String(STUDY_PORT) },
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

const studyNote = startStudy();

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
const HOTSPOT_RANGE = /^192\.168\.137\./; // Windows Mobile Hotspot always uses this
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => ({ ip: n.address, hotspot: HOTSPOT_RANGE.test(n.address) }));

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

if (wantsTunnel) {
  process.stdout.write(dim('\n  opening a public door… '));
  publicUrl = await openPublicDoor(PORT);
  console.log(publicUrl ? green(publicUrl) : yellow('none — local play still works'));

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

console.log(`\n  ${bold('Your friends join at')}`);
const hotspot = addresses.filter((a) => a.hotspot);
const lan = addresses.filter((a) => !a.hotspot);
for (const a of hotspot) console.log(`    ${a.ip === hotspot[0]?.ip ? 'on your hotspot ' : '               '} http://${a.ip}:${PORT}`);
for (const a of lan) console.log(`    ${a === lan[0] ? 'on this WiFi   ' : '               '} http://${a.ip}:${PORT}`);
if (!addresses.length) console.log(dim('    no network yet — turn on WiFi or your hotspot'));
if (publicUrl) {
  console.log(`    ${bold('from anywhere ')} ${publicUrl}`);
  console.log(dim('    (send that one to anybody not in the room)'));
  if (/trycloudflare\.com/.test(publicUrl) && serveoHint) {
    // The address works, it just does not say who it belongs to. Fixing that
    // takes one login, once, and this is where somebody would notice.
    console.log(dim(`\n    want ${WANTED_NAME}.serveo.net instead? register your key once:`));
    console.log(dim(`    ${serveoHint}`));
  }
}
console.log(dim(`\n    on this laptop: http://localhost:${PORT}`));

// Study runs beside the studio and shares the same Hypnic ID, so its address
// belongs in the same list rather than in a second terminal nobody reads.
// Only advertised once it answers. Next takes a while to compile on first
// request, and printing the address the moment it was spawned meant handing
// out a link that was not up yet — or, if it had already died, never would be.
if (study && (await studyReady())) {
  const primary = (addresses.find((a) => a.hotspot) ?? addresses[0])?.ip;
  console.log(`\n  ${bold('IELTS training')}`);
  if (primary) console.log(`    for friends     http://${primary}:${STUDY_PORT}`);
  console.log(dim(`    on this laptop: http://localhost:${STUDY_PORT}`));
  console.log(dim('    same Hypnic ID, no second signup'));
  // The tunnel only ever carries the studio's own port, so anybody who came
  // in from outside cannot reach this at all. Better said here than
  // discovered by a friend clicking a link that hangs.
  if (publicUrl) console.log(dim('    same WiFi only — the public link does not reach it'));
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
