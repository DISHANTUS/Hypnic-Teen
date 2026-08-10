// Does `npm start` actually start?
//
// This file has now shipped two crashes that `node --check` could never catch,
// both the same shape: a `let` read by a function that runs while the module
// body is still on its way down to the declaration. STUDY_ROOT was the first,
// tunnelChild the second, and each one took the whole studio down on boot
// while every other test passed.
//
// Parsing the file cannot find that. Only running it can. So this runs it —
// offline, without Study, on a port nothing else uses — and asks for the two
// things that prove the module body got all the way through: the server
// answers, and the launcher printed an address a friend could type in.
//
// It also checks that address list, because the other thing this file has got
// wrong is *which* addresses it offers. An adapter that only leads back to
// software on this laptop is worse in that list than no address at all: it is
// the one somebody tries first when the real one does not work.

import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const PORT = 8177;
const GIVE_UP_AFTER = 90_000;

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? green('PASS') : red('FAIL')}  ${label}`);
  if (!ok) {
    failures++;
    if (detail) console.log(`        ${detail}`);
  }
}

console.log('\n  Launcher smoke test\n');

const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'launch.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    // The point is the launcher, not the things it can start. Every one of
    // these left on would make the test slow, or need the internet, or need a
    // second project checked out beside this one.
    ONLINE: '0',
    NO_STUDY: '1',
    NO_BANK: '1',
    AI_GAME_MASTER: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let out = '';
let err = '';
child.stdout.on('data', (b) => (out += b));
child.stderr.on('data', (b) => (err += b));

let died = null;
child.on('exit', (code) => (died = code));

/** Waits for the studio to answer, or for the launcher to fall over first. */
async function waitForIt() {
  const until = Date.now() + GIVE_UP_AFTER;
  while (Date.now() < until) {
    // Checked first, so a crash is reported as a crash rather than as a
    // timeout ninety seconds later.
    if (died !== null) return { ok: false, why: `the launcher exited with code ${died}` };
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return { ok: true };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, why: `nothing answered on port ${PORT} within ${GIVE_UP_AFTER / 1000}s` };
}

const up = await waitForIt();

// A crash is worth showing in full — the whole reason this test exists is that
// the stack trace was going to a log file nobody was reading.
check('the studio answers', up.ok, up.ok ? '' : `${up.why}\n\n${err.trim() || out.trim()}\n`);

if (up.ok) {
  // The server answers as soon as it is listening, which is before the
  // launcher has printed anything about addresses — so waiting on health and
  // then reading stdout read an empty buffer, and every check about the list
  // passed vacuously against no list at all.
  const printed = await (async () => {
    const until = Date.now() + 30_000;
    while (Date.now() < until) {
      if (out.includes('Your friends join at')) return true;
      if (died !== null) return false;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  })();
  check('it gets as far as printing the links', printed, out.replace(/\x1b\[[0-9;]*m/g, ''));

  // Stripped of colour, because the launcher paints its output and a test
  // should not have to know the escape codes.
  const plain = out.replace(/\x1b\[[0-9;]*m/g, '');

  // Everything under "Your friends join at", which is now the only list —
  // the server used to print a second one that could not contain the public
  // link, and that incomplete one came first.
  const block = plain.split('Your friends join at')[1] ?? '';
  const offered = [...block.matchAll(/http:\/\/([0-9.]+):/g)].map((m) => m[1]);
  check('it printed an address for friends to type in', offered.length > 0, `stdout:\n${plain}`);
  check('and only one list of them', plain.split('Friends join   ').length === 1, 'the server printed its own as well');

  // Every address it offers has to be one that actually exists on this
  // machine, and not one of the software-only adapters.
  const real = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
    (list ?? [])
      .filter((n) => n.family === 'IPv4' && !n.internal)
      .map((n) => ({ ip: n.address, adapter: name }))
  );
  const VIRTUAL = /^(vEthernet|WSL|Hyper-V|Docker|VirtualBox|VMware|Loopback|Bluetooth|Tailscale|ZeroTier|Npcap)/i;

  const unknown = offered.filter((ip) => !real.some((r) => r.ip === ip));
  check('every address it offers exists on this machine', unknown.length === 0, `not found: ${unknown.join(', ')}`);

  const virtual = offered.filter((ip) => real.some((r) => r.ip === ip && VIRTUAL.test(r.adapter)));
  check(
    'no software-only adapter is offered as a way in',
    virtual.length === 0,
    virtual.map((ip) => `${ip} — ${real.find((r) => r.ip === ip).adapter}`).join('\n        ')
  );

  // The health route answering is the server; the catalogue answering is the
  // server having finished loading the games, which is what a visitor needs.
  try {
    const games = await fetch(`http://127.0.0.1:${PORT}/api/games`).then((r) => r.json());
    const list = Array.isArray(games) ? games : (games.games ?? []);
    check('the games are on the shelf', list.length > 0, JSON.stringify(games).slice(0, 200));
  } catch (e) {
    check('the games are on the shelf', false, e.message);
  }
}

child.kill();
// The launcher starts the server as its own child; give the tree a moment to
// go down so the next run does not find the port still held.
await new Promise((r) => setTimeout(r, 1500));
child.kill('SIGKILL');

console.log(failures ? red(`\n  ${failures} problem(s)\n`) : green('\n  the launcher boots and offers real addresses\n'));
process.exit(failures ? 1 : 0);
