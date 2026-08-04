// A whole cup, start to champion.
//
//   npm run test:tournament
//
// Four players register, the bracket opens, every tie gets a real room, the
// winners walk into the next round on their own, and somebody lifts the trophy
// — with nobody typing a room code at any point. That last part is the whole
// feature, so it is what this measures.
//
// Then the team half: friends registering together, strays paired at random,
// and an odd count that has to produce a bye rather than a crash.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-cup');
const PORT = 3134;
const base = `http://127.0.0.1:${PORT}`;

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`${ok ? '\x1b[32m  ok  \x1b[0m' : '\x1b[31m FAIL \x1b[0m'} ${label}${extra ? `  \x1b[2m${extra}\x1b[0m` : ''}`);
  return ok;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (s, ev, p) => new Promise((r) => s.emit(ev, p, r));

let server = null;
const players = [];
function cleanup() {
  for (const p of players) { try { p.socket.close(); } catch { } }
  try { server?.kill(); } catch { }
  try { rmSync(TMP, { recursive: true, force: true }); } catch { }
}
process.on('SIGINT', () => { cleanup(); process.exit(130); });

/* --------------------------------- setup --------------------------------- */

console.log('\n  \x1b[1mA tournament, run start to finish\x1b[0m\n');

rmSync(TMP, { recursive: true, force: true });
server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: TMP, NODE_ENV: 'test', LLM_BOTS: '0' },
  stdio: 'ignore',
});
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await wait(250);
  up = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
}
if (!check('test server running', up, `port ${PORT}`)) { cleanup(); process.exit(1); }

const { questions } = await fetch(`${base}/api/quiz`).then((r) => r.json());
const stamp = Date.now().toString(36).slice(-4);
let seq = 0;

/**
 * A player who behaves: signs in, says hello so the bracket can find them,
 * walks into whatever room they are called to, and answers what they are shown.
 * Nothing here ever types a room code — that is the point of the feature.
 */
async function makePlayer(name) {
  const n = seq++;
  const acct = await fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: `${name}${stamp}`,
      age: 18 + n,
      pin: '4444',
      answers: Object.fromEntries(questions.map((q, i) => [q.id, q.options[(i + n) % q.options.length].id])),
    }),
  }).then((r) => r.json());
  if (acct.error) throw new Error(`${name}: ${acct.error}`);

  const socket = io(base, { transports: ['websocket'], reconnection: false });
  await new Promise((r) => socket.once('connect', r));

  const me = {
    name: acct.profile.name,
    id: acct.profile.id,
    token: acct.token,
    socket,
    calledTo: [],   // every tie they were summoned to
    played: 0,
  };

  // Called to a tie: walk in. This is the entire "nobody types a code" promise.
  socket.on('tourney:match', async ({ code }) => {
    if (me.calledTo.includes(code)) return;
    me.calledTo.push(code);
    await ask(socket, 'room:join', { code, token: me.token });
  });

  let answered = -1;
  socket.on('game:state', (s) => {
    if (s.phase === 'intro') return socket.emit('game:action', { type: 'ready' });
    if (s.phase !== 'answer' || s.round === answered) return;
    answered = s.round;
    const options = s.prompt?.options;
    // Different players favour different options, so ties are rare and the
    // bracket is decided by play rather than by the tie-break rule.
    setTimeout(() => {
      if (options?.length) socket.emit('game:action', { type: 'choice', optionId: options[n % options.length].id });
      else socket.emit('game:action', { type: 'answer', text: 'guess' });
    }, 250);
  });
  socket.on('game:over', () => { me.played += 1; });

  await ask(socket, 'hello', { token: me.token });
  players.push(me);
  return me;
}

/* ============================ a four-way cup ============================== */

const cast = [];
for (const name of ['Arjun', 'Bhavya', 'Chetan', 'Divya']) cast.push(await makePlayer(name));
check('four players signed in', cast.length === 4);

const host = cast[0];
const made = await ask(host.socket, 'tourney:create', {
  token: host.token,
  gameId: 'quiz',
  name: 'Friday Cup',
  mode: 'solo',
  reward: 'bragging rights',
  // Short ties, or a four-team cup is most of an evening.
  settings: { rounds: 1, pace: 'blitz' },
});
if (!check('a tournament can be opened', !made.error, made.error ?? made.tournament?.name)) { cleanup(); process.exit(1); }
const cup = made.tournament.id;

check('it appears on the board for everyone', (await ask(cast[3].socket, 'tourney:list', {})).tournaments?.some((t) => t.id === cup));

for (const p of cast) {
  const res = await ask(p.socket, 'tourney:join', { token: p.token, id: cup });
  if (p === cast[0]) check('the organiser can enter their own cup', !res.error, res.error ?? '');
}
let view = (await ask(host.socket, 'tourney:get', { id: cup })).tournament;
check('everyone who registered is listed', view.entrants.length === 4, `${view.entrants.length} entrants`);

check('you cannot register twice', Boolean((await ask(host.socket, 'tourney:join', { token: host.token, id: cup })).error));
check('nobody but the organiser can start it', Boolean((await ask(cast[2].socket, 'tourney:start', { token: cast[2].token, id: cup })).error));

const opened = await ask(host.socket, 'tourney:start', { token: host.token, id: cup });
if (!check('the organiser starts it', !opened.error, opened.error ?? '')) { cleanup(); process.exit(1); }

view = opened.tournament;
check('a bracket is drawn', view.rounds.length === 2, `${view.rounds.length} rounds`);
check('the first round is two ties', view.rounds[0]?.matches.length === 2);

// From here nobody does anything. The rooms open, the players are pulled in,
// the ties play out, and the winners advance — all on their own.
const deadline = Date.now() + 120_000;
let done = null;
while (Date.now() < deadline) {
  await wait(1500);
  const t = (await ask(host.socket, 'tourney:get', { id: cup })).tournament;
  if (t?.status === 'done') { done = t; break; }
}

if (check('the cup reaches a champion without anyone typing a code', Boolean(done), done ? done.champion?.name : 'timed out')) {
  check('the final was actually played', done.rounds.at(-1).matches[0].done);
  check('every first-round tie was played', done.rounds[0].matches.every((m) => m.done));
  check('the champion is one of the entrants', cast.some((p) => p.name === done.champion?.name), done.champion?.name);
  check('ties record a score', Boolean(done.rounds[0].matches[0].score), done.rounds[0].matches[0].score);
  const called = cast.filter((p) => p.calledTo.length > 0).length;
  check('every player was called to at least one tie', called === 4, `${called} of 4 called`);
  const champ = cast.find((p) => p.name === done.champion?.name);
  check('the champion played twice — a semi and a final', champ?.played >= 2, `${champ?.played ?? 0} matches`);
}

/* =========================== teams, and a bye ============================= */

console.log('\n  \x1b[2mteams, random pairing, and an odd number\x1b[0m');

const squad = [];
for (const name of ['Eshan', 'Farah', 'Gita', 'Hari', 'Ishan', 'Jaya']) squad.push(await makePlayer(name));

const teamCup = await ask(squad[0].socket, 'tourney:create', {
  token: squad[0].token,
  gameId: 'quiz',
  name: 'Doubles Cup',
  mode: 'teams',
  teamSize: 2,
  settings: { rounds: 1, pace: 'blitz' },
});
if (!check('a team tournament can be opened', !teamCup.error, teamCup.error ?? '')) { cleanup(); process.exit(1); }
const tid = teamCup.tournament.id;

// Two of them already know who they are playing with; the rest turn up alone.
await ask(squad[0].socket, 'tourney:join', { token: squad[0].token, id: tid, team: 'Rockets' });
await ask(squad[1].socket, 'tourney:join', { token: squad[1].token, id: tid, team: 'Rockets' });
for (const p of squad.slice(2)) await ask(p.socket, 'tourney:join', { token: p.token, id: tid });

let tv = (await ask(squad[0].socket, 'tourney:get', { id: tid })).tournament;
check('friends who registered together stay together', tv.teams.find((t) => t.name === 'Rockets')?.members.length === 2);
check('a full team is marked full', tv.teams.find((t) => t.name === 'Rockets')?.full === true);
check('you cannot be the third member of a pair', Boolean((await ask(squad[4].socket, 'tourney:join', { token: squad[4].token, id: tid, team: 'Rockets' })).error));

check('the bracket refuses to start with unteamed players', Boolean((await ask(squad[0].socket, 'tourney:start', { token: squad[0].token, id: tid })).error));

const paired = await ask(squad[0].socket, 'tourney:pair', { token: squad[0].token, id: tid });
check('the organiser can pair the strays at random', !paired.error, paired.error ?? `${paired.paired} teams`);
tv = paired.tournament;
check('everyone ends up on a team', tv.entrants.every((e) => e.teamId), `${tv.teams.length} teams`);
check('the pre-made team was left alone', tv.teams.find((t) => t.name === 'Rockets')?.members.length === 2);

const teamStart = await ask(squad[0].socket, 'tourney:start', { token: squad[0].token, id: tid });
check('a three-team cup starts', !teamStart.error, teamStart.error ?? '');
if (!teamStart.error) {
  const rounds = teamStart.tournament.rounds;
  // Three teams is not a power of two, so somebody has to get a bye rather
  // than the bracket refusing to exist.
  check('an odd number of teams produces a bye, not a crash', rounds.length === 2 && rounds[0].matches.length === 1, `${rounds.length} rounds`);
  check('the team with the bye is already in round two', rounds[1].matches[0].a || rounds[1].matches[0].b);
  check('the last round is called the Final', rounds.at(-1).name === 'Final', rounds.at(-1).name);
}

/* --------------------------------- done ---------------------------------- */

cleanup();
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log(`\n  ${passed}/${results.length} checks passed\n`);
for (const f of failed) console.log(`  \x1b[31m×\x1b[0m ${f.label}`);
if (failed.length) console.log('');
process.exit(failed.length ? 1 : 0);
