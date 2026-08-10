// Tournaments: a bracket that runs itself.
//
// A tournament is a list of entrants, a start time, and a single-elimination
// bracket. When it starts, every first-round tie gets a real room — the same
// rooms.js rooms everything else uses — and when a room finishes, the winner
// walks into the next round automatically. Nobody has to type a code or keep
// score on paper, which is the entire point: the organiser is at the party too.
//
// Two ways in, because both happen:
//   solo   — everyone registers alone and plays for themselves
//   teams  — friends register together under a team name, and anyone who turns
//            up without one gets paired at random before the first whistle
//
// Everything survives a restart except live rooms, which is the honest trade:
// a laptop that reboots mid-match cannot resurrect the match, but it can
// remember who is in the tournament and how far it got.

import { JsonStore, registerStore } from './store.js';
import { getGame } from './games/index.js';

const store = registerStore(new JsonStore('tournaments.json', { list: [] }));

/** How long a finished tournament stays on the board before it is cleared. */
const KEEP_FINISHED_MS = 12 * 60 * 60 * 1000;
/** Nobody wants to scroll a bracket of 64 on a phone, and nobody has 64 friends here. */
const MAX_ENTRANTS = 32;
const MIN_ENTRANTS = 2;

let io = null;
/**
 * How a tie becomes a real room. Injected rather than imported, because
 * rooms.js has to call back in here when a match finishes and two modules that
 * import each other are a knot nobody enjoys untying later.
 */
let openRoom = () => null;
/** code -> { tourneyId, matchId } — set when a bracket opens a room. */
const roomsInPlay = new Map();

export function attachTournaments({ server, open }) {
  io = server;
  if (open) openRoom = open;
}

/* -------------------------------- helpers -------------------------------- */

const now = () => Date.now();
const newId = () => `t${now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const all = () => store.data.list;
const find = (id) => all().find((t) => t.id === id) ?? null;

function persist() {
  store.save();
}

/* ------------------------------- the model ------------------------------- */

/**
 * @param {object} spec
 * @param {string} spec.gameId    which game the ties are played in
 * @param {string} spec.hostId    who is running it
 * @param {string} spec.name      what it is called on the board
 * @param {'solo'|'teams'} spec.mode
 * @param {number} spec.teamSize  players per side, teams mode only
 * @param {number} spec.startsAt  epoch ms; registration closes here
 * @param {string} spec.reward    what the winner gets, in the host's words
 */
export function createTournament(spec) {
  const game = getGame(spec.gameId);
  if (!game) return { error: 'Unknown game.' };

  const mode = spec.mode === 'teams' ? 'teams' : 'solo';
  const teamSize = mode === 'teams' ? Math.max(2, Math.min(4, Number(spec.teamSize) || 2)) : 1;

  // A tie needs enough players to fill one match of this game. Asking for
  // three-a-side in a two-player game would build a bracket that can never run.
  if (mode === 'teams' && teamSize * 2 > (game.maxPlayers ?? 8)) {
    return { error: `${game.name} seats ${game.maxPlayers}, so ${teamSize} a side will not fit.` };
  }

  const startsAt = Number(spec.startsAt) || now() + 15 * 60 * 1000;

  const t = {
    id: newId(),
    gameId: spec.gameId,
    gameName: game.name,
    name: String(spec.name || `${game.name} Cup`).slice(0, 48),
    hostId: spec.hostId,
    hostName: String(spec.hostName || 'Host').slice(0, 24),
    mode,
    teamSize,
    reward: String(spec.reward || '').slice(0, 80),
    // How each tie is played. A cup of eight teams at eight rounds a tie is an
    // hour of quiz; the organiser needs to be able to say "three rounds, brisk".
    settings: spec.settings && typeof spec.settings === 'object' ? spec.settings : {},
    startsAt,
    createdAt: now(),
    status: 'open', // open | running | done
    entrants: [], // { id, name, teamId|null }
    teams: [], // { id, name, memberIds[] }
    rounds: [], // [ [ {id, a, b, winner, roomCode, done} ] ]
    champion: null,
  };
  all().push(t);
  persist();
  announce();
  return { ok: true, tournament: publicView(t) };
}

export function register(id, player, teamName = '') {
  const t = find(id);
  if (!t) return { error: 'No such tournament.' };
  if (t.status !== 'open') return { error: 'Registration has closed.' };
  if (t.entrants.some((e) => e.id === player.id)) return { error: 'You are already registered.' };
  if (t.entrants.length >= MAX_ENTRANTS) return { error: 'This one is full.' };

  const entrant = { id: player.id, name: player.name, teamId: null };

  if (t.mode === 'teams' && teamName.trim()) {
    const wanted = teamName.trim().slice(0, 24);
    let team = t.teams.find((x) => x.name.toLowerCase() === wanted.toLowerCase());
    if (!team) {
      team = { id: `tm${t.teams.length + 1}`, name: wanted, memberIds: [] };
      t.teams.push(team);
    }
    if (team.memberIds.length >= t.teamSize) {
      return { error: `${team.name} already has ${t.teamSize}.` };
    }
    team.memberIds.push(player.id);
    entrant.teamId = team.id;
  }

  t.entrants.push(entrant);
  persist();
  announce(t);
  return { ok: true, tournament: publicView(t) };
}

export function withdraw(id, playerId) {
  const t = find(id);
  if (!t || t.status !== 'open') return { error: 'Too late to pull out.' };
  t.entrants = t.entrants.filter((e) => e.id !== playerId);
  for (const team of t.teams) team.memberIds = team.memberIds.filter((m) => m !== playerId);
  // A team nobody is left in is just clutter on the board.
  t.teams = t.teams.filter((team) => team.memberIds.length);
  persist();
  announce(t);
  return { ok: true, tournament: publicView(t) };
}

/**
 * Host-only: everyone who turned up without a team gets one. This is the
 * "I clicked the button and the system paired them" path — people who came
 * with friends keep those friends, and the strays are shuffled together.
 */
export function pairStrays(id, byId) {
  const t = find(id);
  if (!t) return { error: 'No such tournament.' };
  if (t.hostId !== byId) return { error: 'Only the organiser can pair players.' };
  if (t.status !== 'open') return { error: 'The bracket is already set.' };
  if (t.mode !== 'teams') return { error: 'This one is every player for themselves.' };

  const strays = shuffle(t.entrants.filter((e) => !e.teamId));

  // Half-empty teams get topped up first — leaving a pair of two-thirds teams
  // and then building fresh ones would hand somebody a walkover.
  for (const team of t.teams) {
    while (team.memberIds.length < t.teamSize && strays.length) {
      const e = strays.shift();
      team.memberIds.push(e.id);
      e.teamId = team.id;
    }
  }

  while (strays.length >= t.teamSize) {
    const members = strays.splice(0, t.teamSize);
    const team = { id: `tm${t.teams.length + 1}`, name: teamNameFor(t.teams.length), memberIds: members.map((m) => m.id) };
    t.teams.push(team);
    for (const m of members) m.teamId = team.id;
  }

  // Whoever is left cannot make a full side. Say so rather than starting a
  // tournament where one team is a player short and quietly loses.
  const leftOver = strays.length;
  persist();
  announce(t);
  return { ok: true, paired: t.teams.length, leftOver, tournament: publicView(t) };
}

const TEAM_NAMES = [
  'Cobras', 'Falcons', 'Titans', 'Rhinos', 'Comets', 'Wolves',
  'Sharks', 'Ravens', 'Bisons', 'Panthers', 'Hornets', 'Foxes',
  'Vipers', 'Eagles', 'Bulls', 'Lynxes',
];
const teamNameFor = (i) => TEAM_NAMES[i % TEAM_NAMES.length] + (i >= TEAM_NAMES.length ? ` ${Math.floor(i / TEAM_NAMES.length) + 1}` : '');

/* ------------------------------ the bracket ------------------------------ */

/** Who actually plays: a team in teams mode, a person in solo. */
function sides(t) {
  if (t.mode === 'solo') {
    return t.entrants.map((e) => ({ id: e.id, name: e.name, memberIds: [e.id] }));
  }
  return t.teams
    .filter((team) => team.memberIds.length)
    .map((team) => ({ id: team.id, name: team.name, memberIds: [...team.memberIds] }));
}

/**
 * Builds a single-elimination bracket. Entrant counts are never a neat power of
 * two in real life, so the odd ones out get a bye into round two rather than
 * being turned away at the door.
 */
function buildBracket(list) {
  const rounds = [];
  let seeds = shuffle(list);

  // Byes are handed to the top of the shuffled list, which is as fair as it
  // gets without a ranking to seed from.
  const size = 2 ** Math.ceil(Math.log2(seeds.length));
  const byes = size - seeds.length;

  let matchSeq = 0;
  let current = [];
  const waiting = seeds.slice(0, byes); // straight through
  const playing = seeds.slice(byes);

  for (let i = 0; i < playing.length; i += 2) {
    current.push({
      id: `m${++matchSeq}`,
      a: playing[i] ?? null,
      b: playing[i + 1] ?? null,
      winner: null,
      roomCode: null,
      done: false,
    });
  }
  if (current.length) rounds.push(current);

  // Everything after round one is empty slots, filled in as results land.
  let advancing = waiting.length + current.length;
  while (advancing > 1) {
    const next = [];
    for (let i = 0; i < Math.floor(advancing / 2); i++) {
      next.push({ id: `m${++matchSeq}`, a: null, b: null, winner: null, roomCode: null, done: false });
    }
    rounds.push(next);
    advancing = next.length + (advancing % 2);
  }

  // Byes are placed into round two before anything is played.
  if (waiting.length && rounds[1]) {
    let slot = 0;
    for (const side of waiting) {
      const match = rounds[1][Math.floor(slot / 2)];
      if (!match) break;
      if (slot % 2 === 0) match.a = side;
      else match.b = side;
      slot += 1;
    }
  }

  return { rounds, byes: waiting.map((s) => s.id) };
}

/**
 * Opens the bracket. `openRoom` is injected rather than imported so this module
 * never has to know how a room is made — and so the tests can watch it.
 */
/**
 * Calls one off.
 *
 * There was no way to. A tournament, once created, sat on everybody's home
 * screen for good — only finished ones were ever swept, so one started by
 * mistake, or abandoned when the room lost interest, stayed there as the first
 * thing anybody saw. The organiser can bin their own; the studio owner can bin
 * any, because the person who started it may well have gone home.
 *
 * Rooms already in play are left alone. A tie that is mid-match belongs to the
 * people playing it, and pulling the room out from under them to tidy a list
 * would be worse than the untidy list.
 *
 * @param {string} id
 * @param {string} byId    who is asking
 * @param {boolean} isOwner whether they run the studio
 */
export function cancelTournament(id, byId, isOwner = false) {
  const t = find(id);
  if (!t) return { error: 'No such tournament.' };
  if (t.hostId !== byId && !isOwner) {
    return { error: 'Only the organiser can call it off.' };
  }

  store.data.list = all().filter((x) => x.id !== id);
  // Any bracket rooms it opened are no longer part of anything.
  for (const [code, link] of roomsInPlay) {
    if (link.tourneyId === id) roomsInPlay.delete(code);
  }
  persist();
  announce();
  return { ok: true, name: t.name };
}

export function startTournament(id, byId) {
  const t = find(id);
  if (!t) return { error: 'No such tournament.' };
  if (t.hostId !== byId) return { error: 'Only the organiser can start it.' };
  if (t.status !== 'open') return { error: 'It is already under way.' };

  const list = sides(t);
  if (list.length < MIN_ENTRANTS) return { error: 'Two entrants minimum.' };
  if (t.mode === 'teams' && t.entrants.some((e) => !e.teamId)) {
    return { error: 'Some players still have no team — pair them first.' };
  }

  const { rounds, byes } = buildBracket(list);
  t.rounds = rounds;
  t.byePassed = byes;
  t.status = 'running';
  t.startedAt = now();
  persist();

  openRound(t, 0);
  announce(t);
  return { ok: true, tournament: publicView(t) };
}

/** Gives every playable tie in a round a room, and tells its players where. */
function openRound(t, index) {
  const round = t.rounds[index];
  if (!round) return;

  for (const match of round) {
    if (match.done || match.roomCode) continue;

    // A tie with one side is a walkover — no room, straight through.
    if (!match.a || !match.b) {
      const through = match.a ?? match.b;
      if (through) {
        match.winner = through.id;
        match.done = true;
        advance(t, index, match);
      }
      continue;
    }

    const code = openRoom({
      gameId: t.gameId,
      // Everyone in the tie, and which side they are on. The room seats them
      // itself — nobody types a code.
      seats: [
        ...match.a.memberIds.map((pid) => ({ playerId: pid, side: 'a' })),
        ...match.b.memberIds.map((pid) => ({ playerId: pid, side: 'b' })),
      ],
      tourneyId: t.id,
      matchId: match.id,
      label: `${t.name} — ${roundName(t, index)}`,
      settings: t.settings,
    });
    if (!code) continue;
    match.roomCode = code;
    roomsInPlay.set(code, { tourneyId: t.id, matchId: match.id });
  }
  persist();
  announce(t);
}

function roundName(t, index) {
  const left = t.rounds.length - index;
  if (left === 1) return 'Final';
  if (left === 2) return 'Semi-final';
  if (left === 3) return 'Quarter-final';
  return `Round ${index + 1}`;
}

/** Moves a winner into the next round, and opens that round once it is full. */
function advance(t, roundIndex, match) {
  const round = t.rounds[roundIndex];
  const next = t.rounds[roundIndex + 1];
  const side = winningSide(t, match);

  if (!next) {
    t.status = 'done';
    t.champion = side ?? null;
    t.finishedAt = now();
    persist();
    announce(t);
    return;
  }

  // Slot the winner in beside whoever came from the neighbouring tie.
  const seat = round.indexOf(match);
  const target = next[Math.floor(seat / 2)];
  if (target) {
    // Byes already occupy some slots in round two, so take whichever is free
    // rather than overwriting somebody who is standing there.
    if (!target.a) target.a = side;
    else if (!target.b) target.b = side;
    else {
      const spare = next.find((m) => !m.a || !m.b);
      if (spare) (spare.a ? (spare.b = side) : (spare.a = side));
    }
  }

  // Once every tie in this round is settled, the next one can begin.
  if (round.every((m) => m.done)) openRound(t, roundIndex + 1);
  persist();
}

function winningSide(t, match) {
  return [match.a, match.b].find((s) => s && s.id === match.winner) ?? null;
}

/**
 * Called when a tournament room finishes. `results` is the room's own table,
 * so the winner is decided by the game, not by anything here.
 */
export function reportRoom(code, results) {
  const link = roomsInPlay.get(code);
  if (!link) return null;
  roomsInPlay.delete(code);

  const t = find(link.tourneyId);
  if (!t || t.status !== 'running') return null;

  const roundIndex = t.rounds.findIndex((r) => r.some((m) => m.id === link.matchId));
  if (roundIndex === -1) return null;
  const match = t.rounds[roundIndex].find((m) => m.id === link.matchId);
  if (!match || match.done) return null;

  // Add up what each side scored. Team games already score per team, but this
  // works for both, and it means a solo tie is decided by the same rule as a
  // team one rather than by two different pieces of code.
  const total = { a: 0, b: 0 };
  for (const row of results ?? []) {
    if (match.a?.memberIds.includes(row.playerId)) total.a += row.score ?? 0;
    else if (match.b?.memberIds.includes(row.playerId)) total.b += row.score ?? 0;
  }

  // A dead heat goes to whoever the game itself put on top.
  let winner = total.a === total.b
    ? (match.a?.memberIds.includes(results?.[0]?.playerId) ? match.a.id : match.b?.id)
    : total.a > total.b ? match.a.id : match.b.id;

  match.winner = winner ?? match.a?.id ?? null;
  match.done = true;
  match.score = `${total.a}–${total.b}`;
  advance(t, roundIndex, match);
  announce(t);
  return { tourneyId: t.id, matchId: match.id, winner: match.winner };
}

/** Is this room part of a bracket? Used to keep tournament rooms out of the way. */
export const isTournamentRoom = (code) => roomsInPlay.has(code);

/* -------------------------------- the board ------------------------------ */

export function publicView(t) {
  return {
    id: t.id,
    name: t.name,
    gameId: t.gameId,
    gameName: t.gameName,
    hostId: t.hostId,
    hostName: t.hostName,
    mode: t.mode,
    teamSize: t.teamSize,
    reward: t.reward,
    settings: t.settings ?? {},
    startsAt: t.startsAt,
    status: t.status,
    champion: t.champion,
    entrants: t.entrants.map((e) => ({ id: e.id, name: e.name, teamId: e.teamId })),
    teams: t.teams.map((team) => ({
      id: team.id,
      name: team.name,
      members: team.memberIds.map((mid) => t.entrants.find((e) => e.id === mid)?.name ?? '?'),
      full: team.memberIds.length >= t.teamSize,
    })),
    rounds: t.rounds.map((round, i) => ({
      name: roundName(t, i),
      matches: round.map((m) => ({
        id: m.id,
        a: m.a ? { id: m.a.id, name: m.a.name } : null,
        b: m.b ? { id: m.b.id, name: m.b.name } : null,
        winner: m.winner,
        score: m.score ?? null,
        roomCode: m.done ? null : m.roomCode, // a finished room is not somewhere to send anyone
        done: m.done,
      })),
    })),
  };
}

export function listTournaments() {
  sweep();
  return all().map(publicView);
}

export function getTournament(id) {
  const t = find(id);
  return t ? publicView(t) : null;
}

/** Everything a given player is entered in, so the site can nudge them. */
export function tournamentsFor(playerId) {
  return all()
    .filter((t) => t.entrants.some((e) => e.id === playerId))
    .map(publicView);
}

/** Where a player should be right now, if a tie of theirs is live. */
export function liveMatchFor(playerId) {
  for (const t of all()) {
    if (t.status !== 'running') continue;
    for (const round of t.rounds) {
      for (const m of round) {
        if (m.done || !m.roomCode) continue;
        if (m.a?.memberIds.includes(playerId) || m.b?.memberIds.includes(playerId)) {
          return { tourneyId: t.id, name: t.name, roomCode: m.roomCode };
        }
      }
    }
  }
  return null;
}

function announce(t) {
  if (!io) return;
  io.emit('tourney:board', listTournaments());
  if (t) io.emit('tourney:state', publicView(t));
}

/** Finished tournaments fall off the board after a while. */
function sweep() {
  const cutoff = now() - KEEP_FINISHED_MS;
  const before = all().length;
  store.data.list = all().filter((t) => !(t.status === 'done' && (t.finishedAt ?? 0) < cutoff));
  if (store.data.list.length !== before) persist();
}

export function _resetForTests() {
  store.data.list = [];
  roomsInPlay.clear();
  persist();
}
