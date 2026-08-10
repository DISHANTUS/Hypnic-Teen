// Klondike and Spider.
//
// The only two games in the room you play alone, which raises the obvious
// question of what they are doing in a party arcade. The answer is that they
// are played alone but not in private: everybody gets the *same deal*, and the
// scoreboard is who got furthest. That turns solitaire into a race, keeps the
// existing seat-and-score machinery meaningful, and is the one version of these
// games that is worth putting in front of a room.
//
// The same deal for everybody is the whole design, so it has to be exact. A
// seeded shuffle rather than a shared array — each player's tableau is their
// own to wreck, and passing one array round would mean the first person to move
// a card moved it on everybody's screen.
//
// The other thing worth being careful about: a face-down card in a tableau is
// as hidden from its owner as it is from anybody else, so it never goes on the
// wire until it is turned up. Solitaire where you can read the buried cards is
// not a hard game.

import { createCardGame, freshDeck, rankOf, suitOf, sayCard, RANKS, SUITS } from './kit.js';

/**
 * Where a rank sits, with the ace low.
 *
 * RANKS puts the ace last, because that is what poker and rummy runs want. In
 * solitaire it is low in every direction — a tableau runs king down to ace, a
 * foundation runs ace up to king — so this file uses its own ordering
 * throughout. Using the ace-high one made an ace unplaceable on a two, made an
 * empty foundation wait for a card of index twelve, and made a completed spider
 * run unrecognisable at the very last card.
 */
const ORDER = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
const at = (rank) => ORDER.indexOf(rank);
const upAt = at;
const RED = new Set(['h', 'd']);
const isRed = (card) => RED.has(suitOf(card));

/**
 * A shuffle everybody can reproduce.
 *
 * xorshift32, seeded per hand, so every player is dealt exactly the same
 * tableau and the race is fair. Math.random would give everybody a different
 * game and quietly turn the scoreboard into a luck contest.
 */
function seededShuffle(cards, seed) {
  let x = seed || 1;
  const next = () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* -------------------------------- Klondike -------------------------------- */

/** The classic seven columns, one more card each, only the last face up. */
function dealKlondike(deck) {
  const columns = [];
  let at2 = 0;
  for (let c = 0; c < 7; c++) {
    const col = [];
    for (let n = 0; n <= c; n++) col.push({ card: deck[at2++], up: n === c });
    columns.push(col);
  }
  return { columns, stock: deck.slice(at2), waste: [], foundations: { s: [], h: [], d: [], c: [] } };
}

/** Alternating colours, descending — the rule of the tableau. */
const klondikeStacks = (onto, card) => isRed(onto) !== isRed(card) && at(rankOf(onto)) === at(rankOf(card)) + 1;

/* --------------------------------- Spider --------------------------------- */

/**
 * Spider, at two suits.
 *
 * Four suits is the version that takes an hour and is lost more often than won,
 * which is not what a room wants; one suit is a puzzle rather than a game. Two
 * is the one people actually play, so it is the one here — and the suit count
 * is a host setting for anybody who disagrees.
 */
function spiderPack(suits) {
  const use = SUITS.slice(0, suits);
  const cards = [];
  // Eight packs of one suit each, or four of two, and so on — always 104.
  for (let i = 0; i < 8 / use.length; i++) {
    for (const suit of use) for (const rank of RANKS) cards.push(`${rank}${suit}`);
  }
  return cards;
}

function dealSpider(deck) {
  const columns = [];
  let at2 = 0;
  for (let c = 0; c < 10; c++) {
    const depth = c < 4 ? 6 : 5;
    const col = [];
    for (let n = 0; n < depth; n++) col.push({ card: deck[at2++], up: n === depth - 1 });
    columns.push(col);
  }
  return { columns, stock: deck.slice(at2), waste: [], foundations: {} };
}

/* --------------------------------- shared --------------------------------- */

const topOf = (col) => (col.length ? col[col.length - 1] : null);

/** The face-up run at the bottom of a column that could move as one. */
function movableRun(col, spider) {
  const run = [];
  for (let i = col.length - 1; i >= 0; i--) {
    const slot = col[i];
    if (!slot.up) break;
    if (!run.length) { run.unshift(i); continue; }
    const above = col[run[0]];
    const ok = spider
      ? suitOf(slot.card) === suitOf(above.card) && at(rankOf(slot.card)) === at(rankOf(above.card)) + 1
      : isRed(slot.card) !== isRed(above.card) && at(rankOf(slot.card)) === at(rankOf(above.card)) + 1;
    if (!ok) break;
    run.unshift(i);
  }
  return run;
}

function build({ id, name, tagline, emoji, accent, spider, howToPlay, options, settings }) {
  return createCardGame({
    id, name, tagline, emoji, accent,
    face: 'solitaire',
    // Alone, but not in private: everybody races the same deal.
    minPlayers: 1,
    maxPlayers: 12,
    hands: 3,
    turnSeconds: 0,
    howToPlay,
    options,
    settings,

    init(state) {
      state.boards = {};
      state.seed = 1;
      state.done = {};
    },

    deal(state) {
      // One seed for the whole table, so everybody gets the same game.
      state.seed = 1 + Math.floor(Math.random() * 2 ** 30);
      const pack = spider ? spiderPack(state.settings.suits ?? 2) : freshDeck();
      const deck = seededShuffle(pack, state.seed);
      state.boards = {};
      state.done = {};
      for (const s of state.seats) {
        s.hand = [];
        state.boards[s.seat] = spider ? dealSpider(deck) : dealKlondike(deck);
      }
      state.deck = [];
      state.said = 'Same deal for everybody. Go.';
    },

    act(state, seat, action) {
      const board = state.boards[seat.seat];
      if (!board || state.done[seat.seat]) return;

      if (action.type === 'stock') {
        if (spider) {
          // Spider deals one to every column at once, and refuses while any
          // column is empty — the rule that stops the deal being wasted.
          if (!board.stock.length) return;
          if (board.columns.some((c) => c.length === 0)) return;
          for (const col of board.columns) {
            const card = board.stock.shift();
            if (card) col.push({ card, up: true });
          }
        } else if (board.stock.length) {
          board.waste.push(board.stock.shift());
        } else {
          // Turn the waste back over, which is what makes Klondike winnable.
          board.stock = board.waste.reverse();
          board.waste = [];
        }
        state.dirty = true;
        return;
      }

      if (action.type === 'move') {
        const from = Number(action.from);
        const to = Number(action.to);
        const count = Math.max(1, Math.floor(Number(action.count) || 1));
        if (!moveCards(board, from, to, count, spider)) return;
        turnUpEnds(board);
        harvest(board, state, seat, spider);
        state.dirty = true;
        return;
      }

      if (action.type === 'foundation' && !spider) {
        const from = Number(action.from);
        if (!toFoundation(board, from)) return;
        turnUpEnds(board);
        harvest(board, state, seat, spider);
        state.dirty = true;
      }
    },

    handOver: (state) => state.seats.every((s) => state.done[s.seat]) && state.seats.length > 0,

    scoreHand(state) {
      const got = state.seats.map((s) => ({ s, n: progress(state.boards[s.seat], spider) }));
      const best = Math.max(0, ...got.map((g) => g.n));
      for (const { s, n } of got) {
        s.score += n;
        if (n === best && best > 0) s.won += 1;
      }
      state.said = got.map((g) => `${g.s.name} ${g.n}`).join(' · ');
      state.log.push(state.said);
    },

    table(state) {
      return {
        spider: Boolean(spider),
        seed: state.seed,
        // Everybody's progress, because the race is the point of playing these
        // in a room rather than alone.
        progress: state.seats.map((s) => ({
          seat: s.seat, name: s.name,
          done: progress(state.boards[s.seat], spider),
          finished: Boolean(state.done[s.seat]),
        })),
      };
    },

    mine(state, seat) {
      const board = seat ? state.boards[seat.seat] : null;
      if (!board) return { board: null };
      return {
        board: {
          // A face-down card carries its position and nothing else, even to
          // the person whose tableau it is.
          columns: board.columns.map((col) => col.map((slot) => ({
            card: slot.up ? slot.card : null,
            up: slot.up,
          }))),
          stock: board.stock.length,
          waste: board.waste.slice(-3),
          foundations: spider ? null : board.foundations,
          piles: spider ? (board.piles ?? 0) : null,
        },
        finished: Boolean(state.done[seat.seat]),
      };
    },

    rank: (a, b) => b.score - a.score,
  });
}

/** Move `count` cards off the bottom of one column onto another. */
function moveCards(board, from, to, count, spider) {
  const src = board.columns[from];
  const dst = board.columns[to];
  if (!src || !dst || from === to) return false;
  if (count > src.length) return false;
  const taken = src.slice(src.length - count);
  if (!taken.every((s) => s.up)) return false;

  // The run being moved has to be a legal sequence in its own right.
  const run = movableRun(src, spider);
  if (run.length < count) return false;

  const head = taken[0].card;
  const onto = topOf(dst);
  if (!onto) {
    // Only a king may start an empty Klondike column. Spider takes anything,
    // which is why an empty column there is so valuable.
    if (!spider && rankOf(head) !== 'K') return false;
  } else if (!onto.up) return false;
  else if (spider) {
    if (at(rankOf(onto.card)) !== at(rankOf(head)) + 1) return false;
  } else if (!klondikeStacks(onto.card, head)) return false;

  src.length -= count;
  dst.push(...taken);
  return true;
}

/** Klondike only: send the bottom card of a column up to its foundation. */
function toFoundation(board, from) {
  const col = board.columns[from] ?? (from === -1 ? null : null);
  let card = null;
  let take = null;
  if (from === -1) {
    // -1 means the waste pile, which is where most foundation cards come from.
    card = board.waste[board.waste.length - 1];
    take = () => board.waste.pop();
  } else {
    const slot = topOf(col ?? []);
    if (!slot?.up) return false;
    card = slot.card;
    take = () => col.pop();
  }
  if (!card) return false;
  const pile = board.foundations[suitOf(card)];
  const wanted = pile.length ? upAt(rankOf(pile[pile.length - 1])) + 1 : 0;
  if (upAt(rankOf(card)) !== wanted) return false;
  take();
  pile.push(card);
  return true;
}

/** Any column whose bottom card is face down turns it over. */
function turnUpEnds(board) {
  for (const col of board.columns) {
    const last = topOf(col);
    if (last && !last.up) last.up = true;
  }
}

/** Spider only: a complete king-to-ace run in one suit leaves the table. */
function harvest(board, state, seat, spider) {
  if (!spider) return;
  for (const col of board.columns) {
    if (col.length < 13) continue;
    const tail = col.slice(col.length - 13);
    if (!tail.every((s) => s.up)) continue;
    const suit = suitOf(tail[0].card);
    const ok = tail.every((s, i) =>
      suitOf(s.card) === suit && at(rankOf(s.card)) === at('K') - i);
    if (!ok) continue;
    col.length -= 13;
    board.piles = (board.piles ?? 0) + 1;
    const last = topOf(col);
    if (last && !last.up) last.up = true;
    state.log.push(`${seat.name} completes a run.`);
    if (board.piles >= 8) state.done[seat.seat] = true;
  }
}

/** How far somebody has got, as a single number for the scoreboard. */
function progress(board, spider) {
  if (!board) return 0;
  if (spider) return (board.piles ?? 0) * 13;
  return Object.values(board.foundations).reduce((n, pile) => n + pile.length, 0);
}

export const klondike = build({
  id: 'solitaire',
  name: 'Solitaire',
  tagline: 'The same deal for everybody. Furthest up the foundations wins.',
  emoji: '🂡',
  accent: '#2980b9',
  spider: false,
  howToPlay: [
    'Everybody gets exactly the same deal, and it is a race.',
    'Build the columns downwards in alternating colours — a red six on a black seven.',
    'Only a king may go into an empty column.',
    'Send aces up to the foundations and build them back up in suit.',
    'Furthest up the foundations when the room finishes wins.',
  ],
});

export const spider = build({
  id: 'spider',
  name: 'Spider Solitaire',
  tagline: 'Ten columns, two suits, and eight runs to find.',
  emoji: '🕷️',
  accent: '#7f8c8d',
  spider: true,
  options: {
    suits: {
      label: 'Suits', kind: 'choice', default: '2',
      choices: [
        { id: '1', label: 'One', note: 'a puzzle rather than a game' },
        { id: '2', label: 'Two', note: 'the one people actually play' },
        { id: '4', label: 'Four', note: 'lost more often than won' },
      ],
    },
  },
  settings: (s) => ({ suits: [1, 2, 4].includes(Number(s.suits)) ? Number(s.suits) : 2 }),
  howToPlay: [
    'Everybody gets exactly the same deal, and it is a race.',
    'Build downwards regardless of suit — but only a run all of one suit moves as a group.',
    'A complete king down to ace in one suit leaves the table. There are eight to find.',
    'Dealing from the stock puts one card on every column, and is refused while any column is empty.',
    'Most complete runs wins.',
  ],
});

export const SOLITAIRE_GAMES = [klondike, spider];
void sayCard;
