// Crossword Clash — one puzzle, several sides racing it.
//
// Everybody gets the same grid and the same clues, and each side fills in its
// own copy. Teammates share that copy: two people on a side are looking at the
// same board and can type into it at the same time, so solving 4-down hands
// your partner a letter in 7-across a second later. That sharing is the whole
// reason to play it as a team rather than four people doing four crosswords.
//
// A wrong answer costs time rather than points. Locking somebody out of a clue
// for a few seconds is a real penalty in a race and it still leaves them free
// to work on the rest of the grid, where taking points away for guessing would
// just teach a room not to guess — and guessing is most of a crossword.
//
// And nothing is allowed to stall. If the whole room goes quiet for long
// enough, one unsolved word is shown to everybody, and whoever types it first
// takes it. That turns the worst moment in a crossword — four people staring
// at the same clue with nothing to try — into the loudest one.
//
// The answers never leave this file. Two sides racing the same puzzle is
// exactly the situation where a client holding the solution is worth using,
// so the client is sent a grid with no letters in it and gets a square's
// letter only once its own side has earned it.

import { buildCrossword, blankGrid, coversCell, normalise } from '../crossword.js';
import { USABLE_WORDS } from '../crossword-words.js';

const SIDE_DEFS = [
  { name: 'Blue', color: '#4ad6ff' },
  { name: 'Red', color: '#ff5c8a' },
  { name: 'Green', color: '#5ad18a' },
  { name: 'Amber', color: '#ffb545' },
  { name: 'Violet', color: '#b58cff' },
  { name: 'Teal', color: '#2fd4c4' },
  { name: 'Coral', color: '#ff8a5c' },
  { name: 'Slate', color: '#9aa6c4' },
];

const BRIEF_SECONDS = 16;

/** What a word is worth, before any bonus. Longer words are harder. */
const points = (length) => 10 + length * 2;

/** First side to take a clue gets it; everyone after gets the base. */
const FIRST_BONUS = 6;

/** A word the room was shown is worth less, because it was given to them. */
const FLASH_SHARE = 0.4;

/** Wrong answers lock that clue for this side. Escalating, and capped. */
const PENALTY_STEPS = [4, 8, 15, 25];

/** Quiet for this long and the game hands one out. */
const STUCK_SECONDS = 45;

/** How long the room has to type a word it has been shown. */
const FLASH_SECONDS = 12;

export default {
  id: 'crossword',
  name: 'Crossword Clash',
  tagline: 'One grid, two sides. Your team fills it in together.',
  emoji: '🔠',
  accent: '#7c5cff',
  client: 'crossword',
  minPlayers: 1,
  maxPlayers: 32,
  tickRate: 4,

  howToPlay: [
    'Everybody gets the same puzzle. Your team fills in its own copy, together.',
    'Tap a clue, type the word. Get it and the letters appear for your whole team.',
    'A wrong answer locks that clue for a few seconds — longer each time. The rest of the grid stays open.',
    'If the room goes quiet, one word is shown to everyone. First to type it takes it.',
  ],

  options: {
    teamSize: {
      label: 'Players per side',
      hint: '1 for every player for themselves, 2 for 2v2, and so on',
      kind: 'number',
      min: 1,
      max: 8,
      step: 1,
      default: 1,
    },
    wordCount: {
      label: 'Words in the grid',
      hint: 'How big the puzzle is',
      kind: 'number',
      min: 6,
      max: 16,
      hardMax: 20,
      step: 1,
      default: 12,
    },
    minutes: {
      label: 'Minutes on the clock',
      hint: 'It also ends the moment the grid is full',
      kind: 'number',
      min: 2,
      max: 20,
      hardMax: 60,
      step: 1,
      default: 8,
    },
  },

  createState(players, ctx = {}) {
    const settings = ctx.settings ?? {};
    const teamSize = Math.max(1, Math.min(8, Number(settings.teamSize) || 1));
    const wordCount = Math.max(6, Math.min(20, Number(settings.wordCount) || 12));
    const minutes = Math.max(2, Math.min(60, Number(settings.minutes) || 8));

    const puzzle = buildCrossword({
      words: USABLE_WORDS,
      target: wordCount,
      maxSize: 13,
      // Seeded from the clock so two matches in an evening are different
      // puzzles, and recorded so a match can be rebuilt exactly if it ever
      // needs to be looked at again.
      seed: (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0,
    });

    // As many sides as the room divides into. teamSize 1 means everybody is
    // their own side, which is the 8-or-16-player free-for-all.
    const sideCount = Math.max(1, Math.ceil(players.length / teamSize));
    const sides = Array.from({ length: sideCount }, (_, i) => ({
      id: i,
      name: teamSize === 1 ? (players[i]?.name ?? SIDE_DEFS[i % SIDE_DEFS.length].name) : `${SIDE_DEFS[i % SIDE_DEFS.length].name} team`,
      color: SIDE_DEFS[i % SIDE_DEFS.length].color,
      score: 0,
      /** clueId -> { at, byName, points, flashed } */
      solved: {},
      /** clueId -> epoch ms until which this side may not try it again */
      lockedUntil: {},
      /** clueId -> how many wrong tries, which sets the next lockout */
      tries: {},
    }));

    return {
      settings: { teamSize, wordCount, minutes },
      phase: 'brief',
      timeLeft: BRIEF_SECONDS,
      phaseTotal: BRIEF_SECONDS,
      briefed: [],
      puzzle,
      // Sent to the browser once; it has no letters in it.
      board: blankGrid(puzzle),
      sides,
      players: players.map((p, i) => ({
        id: p.id,
        name: p.name,
        bot: Boolean(p.bot),
        connected: p.connected !== false,
        side: Math.floor(i / teamSize) % sideCount,
        solvedCount: 0,
      })),
      /** Set when the room has been stuck: { clueId, answer, until }. */
      flash: null,
      lastSolveAt: Date.now(),
      log: [],
      over: false,
      dirty: true,
    };
  },

  onPlayerJoin(state, player) {
    const known = state.players.find((p) => p.id === player.id);
    if (known) {
      known.connected = true;
      known.name = player.name;
    } else {
      // Onto whichever side is thinnest, so a latecomer evens things up
      // rather than stacking one team.
      const counts = state.sides.map((s) => state.players.filter((p) => p.side === s.id && p.connected).length);
      const thinnest = counts.indexOf(Math.min(...counts));
      state.players.push({
        id: player.id,
        name: player.name,
        bot: Boolean(player.bot),
        connected: true,
        side: Math.max(0, thinnest),
        solvedCount: 0,
      });
    }
    state.dirty = true;
  },

  onPlayerLeave(state, player) {
    const known = state.players.find((p) => p.id === player.id);
    if (known) known.connected = false;
    state.dirty = true;
  },

  onAction(state, player, action = {}, api) {
    const me = state.players.find((p) => p.id === player.id);
    if (!me) return;

    if (action.type === 'briefed' && state.phase === 'brief') {
      if (!state.briefed.includes(me.id)) state.briefed.push(me.id);
      state.dirty = true;
      if (everyoneReady(state)) startPlaying(state);
      return;
    }

    if (action.type === 'guess' && state.phase === 'play') {
      return submitGuess(state, me, action, api);
    }
  },

  botAction() {
    // No CPU player. A machine that can read the answer off its own state is
    // not playing the same game as the room, and one that guesses at random
    // would fill a team's grid with lockouts. Better to have none than a
    // pretend one.
    return null;
  },

  onTick(state, dt) {
    if (state.over) return;
    state.timeLeft -= dt;

    if (state.phase === 'brief') {
      if (state.timeLeft <= 0) startPlaying(state);
      return;
    }

    if (state.phase !== 'play') return;

    const now = Date.now();

    // A word the room was shown, and the window to type it, has run out. It
    // fills in for everybody so the crossings keep helping, and is worth
    // nothing to anyone — they were given it and did not take it.
    if (state.flash && now >= state.flash.until) {
      giveAway(state, state.flash.clueId);
      state.flash = null;
      state.lastSolveAt = now;
      state.dirty = true;
    }

    // Nobody has got anything for a while. Hand one out.
    if (!state.flash && now - state.lastSolveAt > STUCK_SECONDS * 1000) {
      const stuck = pickStuckClue(state);
      if (stuck) {
        state.flash = { clueId: stuck.id, answer: stuck.answer, until: now + FLASH_SECONDS * 1000 };
        state.log.push(`Nobody had ${stuck.number} ${stuck.dir}. Type it — fast.`);
        state.dirty = true;
      } else {
        // Nothing left to hand out means the grid is finished.
        state.lastSolveAt = now;
      }
    }

    // Lockouts expiring are worth a repaint, so the button comes back the
    // moment it is usable rather than on the next guess.
    if (state.sides.some((s) => Object.values(s.lockedUntil).some((t) => t > now - 400 && t <= now))) {
      state.dirty = true;
    }

    if (state.timeLeft <= 0 || gridFull(state)) finish(state);
  },

  isDirty(state) {
    const was = state.dirty;
    state.dirty = false;
    return was;
  },

  isOver: (state) => Boolean(state.over),

  results(state) {
    // Solo is one player per side, so their side's score is theirs. In teams
    // everybody on a side shares the score — that is what a team is — but the
    // count of words each person got is kept so nobody is invisible.
    return [...state.players]
      .map((p) => ({
        playerId: p.id,
        name: p.name,
        score: state.sides[p.side]?.score ?? 0,
        solved: p.solvedCount,
      }))
      .sort((a, b) => b.score - a.score || b.solved - a.solved)
      .map((r, i) => ({ ...r, place: i + 1 }));
  },

  serialize(state) {
    return {
      phase: state.phase,
      rules: this.howToPlay,
      timeLeft: Math.max(0, Math.ceil(state.timeLeft)),
      phaseTotal: state.phaseTotal,
      teamSize: state.settings.teamSize,
      board: state.board,
      briefed: state.briefed,
      // How everybody is doing, without a single letter of anybody's grid.
      sides: state.sides.map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        score: s.score,
        solved: Object.keys(s.solved).length,
        members: state.players.filter((p) => p.side === s.id).map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
      })),
      totalClues: state.puzzle.entries.length,
      // The word the room has been shown, if there is one. This one is public
      // on purpose — that is the whole mechanic.
      flash: state.flash
        ? {
            clueId: state.flash.clueId,
            answer: state.flash.answer,
            secondsLeft: Math.max(0, Math.ceil((state.flash.until - Date.now()) / 1000)),
          }
        : null,
      log: state.log.slice(-5),
    };
  },

  /**
   * What one player sees: their own side's grid, filled in as far as their
   * side has earned it, and nothing at all of anybody else's.
   */
  serializeFor(state, playerId) {
    const shared = this.serialize(state);
    const me = state.players.find((p) => p.id === playerId);
    const side = state.sides[me?.side ?? 0];
    if (!side) return shared;

    const now = Date.now();
    const letters = {};
    for (const clueId of Object.keys(side.solved)) {
      const entry = state.puzzle.entries.find((e) => e.id === clueId);
      if (!entry) continue;
      for (let i = 0; i < entry.length; i++) {
        const r = entry.dir === 'across' ? entry.row : entry.row + i;
        const c = entry.dir === 'across' ? entry.col + i : entry.col;
        letters[`${r},${c}`] = entry.answer[i];
      }
    }

    return {
      ...shared,
      you: {
        id: playerId,
        sideId: side.id,
        sideName: side.name,
        color: side.color,
        // Only the squares this side has actually earned.
        letters,
        solved: Object.fromEntries(
          Object.entries(side.solved).map(([id, s]) => [id, { byName: s.byName, points: s.points, flashed: s.flashed }])
        ),
        // Seconds left on each lockout, so the clue can count itself down.
        locked: Object.fromEntries(
          Object.entries(side.lockedUntil)
            .filter(([, until]) => until > now)
            .map(([id, until]) => [id, Math.ceil((until - now) / 1000)])
        ),
      },
    };
  },
};

/* -------------------------------- the round ------------------------------- */

const activePlayers = (state) => state.players.filter((p) => p.connected !== false);

function everyoneReady(state) {
  const active = activePlayers(state);
  return active.length > 0 && active.every((p) => state.briefed.includes(p.id));
}

function startPlaying(state) {
  state.phase = 'play';
  state.phaseTotal = state.settings.minutes * 60;
  state.timeLeft = state.phaseTotal;
  state.lastSolveAt = Date.now();
  state.dirty = true;
}

function gridFull(state) {
  // Finished when there is no clue left that anybody could still take.
  return state.puzzle.entries.every((e) => state.sides.every((s) => s.solved[e.id]));
}

function finish(state) {
  state.over = true;
  state.phase = 'over';
  state.dirty = true;
}

/**
 * Which word to hand out when the room is stuck.
 *
 * The one nobody has, with the fewest letters already showing — that is the
 * one they are least equipped to get, and handing out a word that three
 * crossings have half-filled would be handing out nothing.
 */
function pickStuckClue(state) {
  const open = state.puzzle.entries.filter((e) => !state.sides.every((s) => s.solved[e.id]));
  if (!open.length) return null;

  const knownLetters = (entry) => {
    let known = 0;
    for (const side of state.sides) {
      for (const otherId of Object.keys(side.solved)) {
        const other = state.puzzle.entries.find((e) => e.id === otherId);
        if (!other || other.id === entry.id) continue;
        for (let i = 0; i < entry.length; i++) {
          const r = entry.dir === 'across' ? entry.row : entry.row + i;
          const c = entry.dir === 'across' ? entry.col + i : entry.col;
          if (coversCell(other, r, c)) known += 1;
        }
      }
    }
    return known;
  };

  return open.reduce((worst, e) => (knownLetters(e) < knownLetters(worst) ? e : worst), open[0]);
}

/**
 * Fills a clue in for every side, for nothing.
 *
 * Used when a word was shown and the window closed with nobody typing it. It
 * keeps the grid moving — the crossings it provides are worth more to the
 * match than leaving a hole everybody has already given up on.
 */
function giveAway(state, clueId) {
  const entry = state.puzzle.entries.find((e) => e.id === clueId);
  if (!entry) return;
  for (const side of state.sides) {
    if (side.solved[clueId]) continue;
    side.solved[clueId] = { at: Date.now(), byName: null, points: 0, flashed: true };
  }
  state.log.push(`${entry.number} ${entry.dir} was ${entry.answer}. Nobody took it.`);
}

function submitGuess(state, me, action, api) {
  const side = state.sides[me.side];
  if (!side) return;

  const clueId = String(action.clueId ?? '');
  const entry = state.puzzle.entries.find((e) => e.id === clueId);
  if (!entry) return;

  // Already got it. Not an error — a teammate probably just typed it.
  if (side.solved[clueId]) return;

  const now = Date.now();
  if ((side.lockedUntil[clueId] ?? 0) > now) return;

  const guess = normalise(action.text);
  if (!guess) return;

  if (guess !== entry.answer) {
    // Time, not points. A lockout leaves the rest of the grid open and still
    // costs real ground in a race; taking points away for a wrong guess just
    // teaches a room to stop guessing, and guessing is most of a crossword.
    const step = Math.min(side.tries[clueId] ?? 0, PENALTY_STEPS.length - 1);
    side.lockedUntil[clueId] = now + PENALTY_STEPS[step] * 1000;
    side.tries[clueId] = (side.tries[clueId] ?? 0) + 1;
    state.dirty = true;
    return;
  }

  // Right. Was it a word the room had been shown?
  const flashed = state.flash?.clueId === clueId;
  const firstAnywhere = state.sides.every((s) => !s.solved[clueId]);
  let award = points(entry.length);
  if (flashed) award = Math.round(award * FLASH_SHARE);
  else if (firstAnywhere) award += FIRST_BONUS;

  side.solved[clueId] = { at: now, byName: me.name, points: award, flashed };
  side.score += award;
  me.solvedCount += 1;
  state.lastSolveAt = now;

  if (flashed) {
    // The race is over the moment somebody takes it.
    state.flash = null;
    state.log.push(`${me.name} typed ${entry.answer} first.`);
  } else if (firstAnywhere && state.sides.length > 1) {
    state.log.push(`${side.name} got ${entry.number} ${entry.dir} first.`);
  }

  state.dirty = true;
  if (gridFull(state)) finish(state);
  void api;
}
