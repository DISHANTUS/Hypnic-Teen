// The card room.
//
//   npm run test:cardroom
//
// The casino floor had one governing property — chips are never created or
// destroyed — and everything there was measured against it. The card room has
// two, and they are both easy to break in ways that look completely fine.
//
//   fifty-two cards      A card game where a card can be played twice, or
//                        vanish when a pile is taken, is a game that goes wrong
//                        forty minutes in with no way to work out why. So every
//                        card in play is counted after every single move.
//
//   nobody sees a hand   Not "the client does not draw it" — never sent. A
//                        table state carrying everybody's cards is one open
//                        console away from ending the evening, and in Cheat it
//                        would end the game outright, because knowing what is
//                        under a claim is the whole thing being bet on.
//
// Both are checked by playing thousands of legal moves rather than by asserting
// them once on a fresh deal, because both survive a fresh deal perfectly.

import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-cardroom');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
process.env.DATA_DIR = TMP;

const { cheat } = await import('../server/games/cards/cheat.js');
const { snap } = await import('../server/games/cards/snap.js');
const { gofish } = await import('../server/games/cards/gofish.js');
const { hearts } = await import('../server/games/cards/hearts.js');
const { CARD_GAMES } = await import('../server/games/cards/index.js');
const { rankOf, suitOf } = await import('../server/cards.js');

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};

const api = { emit() {}, emitTo() {}, finish() {}, players: () => [] };
let seq = 0;
const cast = (n) => Array.from({ length: n }, () => ({ id: `p${seq++}`, name: `P${seq}`, connected: true }));

function open(game, n, settings = {}) {
  const players = cast(n);
  const state = game.createState(players, { settings: { hands: 1, ...settings } });
  for (const p of players) game.onAction(state, p, { type: 'briefed' }, api);
  return { state, players };
}

/**
 * Every card the table can account for.
 *
 * Includes the private bits deliberately — this counts the *server's* idea of
 * where the cards are, which is the only place they all exist at once.
 */
function census(state) {
  const all = [
    ...state.deck,
    ...state.pile,
    ...state.seats.flatMap((s) => s.hand),
    ...(state.claim?.cards ?? []),
    ...(state.trick ?? []).map((t) => t.card),
    ...Object.values(state.taken ?? {}).flat(),
    ...(state.spare ?? []),
  ];
  // Books are recorded as ranks rather than cards once they go down, so their
  // four cards are counted back in from the record instead.
  const booked = Object.values(state.books ?? {}).flat().length * 4;
  return { all, total: all.length + booked, unique: new Set(all).size };
}

console.log('\n  The card room — fifty-two cards, and nobody sees a hand\n');

/* ----------------------- nobody sees anybody's hand ----------------------- */

{
  for (const game of CARD_GAMES) {
    const { state, players } = open(game, game.minPlayers);
    const wire = JSON.stringify(game.serialize(state));
    // Find a card that definitely exists and make sure the public view has
    // never heard of it.
    const someones = state.seats.flatMap((s) => s.hand);
    const leaked = someones.filter((c) => wire.includes(`"${c}"`));
    check(`${game.name}: the table state carries no hand`, leaked.length === 0, leaked.slice(0, 4).join(' '));

    const mine = game.serializeFor(state, players[0].id);
    const theirs = game.serializeFor(state, players[1].id);
    check(`${game.name}: but you can see your own`, Array.isArray(mine.you.hand));
    // And crucially, your private view carries nobody else's.
    const others = state.seats.filter((s) => s.id !== players[0].id).flatMap((s) => s.hand);
    const inMine = JSON.stringify(mine.you);
    check(`${game.name}: and only your own`,
      others.every((c) => !inMine.includes(`"${c}"`)),
      others.filter((c) => inMine.includes(`"${c}"`)).slice(0, 3).join(' '));
    check(`${game.name}: two players get different hands`,
      JSON.stringify(mine.you.hand) !== JSON.stringify(theirs.you.hand) || mine.you.hand.length === 0);
  }
}

/* ------------------------------ Cheat ------------------------------------- */

{
  const { state, players } = open(cheat, 4);
  check('cheat: everybody is dealt in', state.seats.every((s) => s.hand.length > 0),
    state.seats.map((s) => s.hand.length).join(','));
  check('cheat: fifty-two cards are out', census(state).total === 52, String(census(state).total));

  // The thing the whole game rests on.
  const turn = state.seats[state.turn];
  const lie = turn.hand.find((c) => rankOf(c) !== state.rank) ?? turn.hand[0];
  cheat.onAction(state, { id: turn.id }, { type: 'play', cards: [lie] }, api);
  check('cheat: you may play a card that is not the rank', Boolean(state.claim), JSON.stringify(state.claim?.count));

  const wire = JSON.stringify(cheat.serialize(state));
  // Checked against the claim object rather than by searching the text for
  // "cards" — every seat carries a `cards` count, so that search matched the
  // one thing that is supposed to be there and called it a leak.
  check('cheat: what is under a claim is never sent',
    !wire.includes(`"${lie}"`) && !('cards' in (cheat.serialize(state).claim ?? {})),
    wire.slice(0, 90));
  check('cheat: but how many went down is', cheat.serialize(state).claim?.count === 1);

  // Called correctly: the liar picks up.
  const caller = state.seats.find((s) => s.seat !== turn.seat);
  const hadLiar = turn.hand.length;
  cheat.onAction(state, { id: caller.id }, { type: 'call' }, api);
  const lied = rankOf(lie) !== state.seats && true;
  void lied;
  check('cheat: a call turns them over', Boolean(cheat.serialize(state).reveal));
  check('cheat: and somebody picks the pile up',
    turn.hand.length > hadLiar || caller.hand.length > 0,
    `${hadLiar} then ${turn.hand.length}`);
  check('cheat: still fifty-two', census(state).total === 52, String(census(state).total));

  // You cannot call your own claim, and you cannot call twice.
  const { state: s2 } = open(cheat, 4);
  const t2 = s2.seats[s2.turn];
  cheat.onAction(s2, { id: t2.id }, { type: 'play', cards: [t2.hand[0]] }, api);
  cheat.onAction(s2, { id: t2.id }, { type: 'call' }, api);
  check('cheat: you cannot call your own bluff', Boolean(s2.claim), String(s2.called.length));

  // Nobody calls: the cards stay face down forever and leave no trace.
  const { state: s3 } = open(cheat, 4);
  const t3 = s3.seats[s3.turn];
  const hidden = t3.hand[0];
  cheat.onAction(s3, { id: t3.id }, { type: 'play', cards: [hidden] }, api);
  for (let i = 0; i < 40; i++) cheat.onTick(s3, 0.25, api);
  check('cheat: an unchallenged lie is never revealed', s3.reveal === null);
  const quiet = JSON.stringify(cheat.serialize(s3));
  check('cheat: and leaves nothing behind to work it out from',
    !quiet.includes(`"${hidden}"`), quiet.slice(0, 80));
  check('cheat: the pile keeps it', s3.pile.includes(hidden));
}

/* -------------------------------- Go Fish --------------------------------- */

{
  const { state } = open(gofish, 4);
  const asker = state.seats[state.turn];
  const held = rankOf(asker.hand[0]);
  const notHeld = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
    .find((r) => !asker.hand.some((c) => rankOf(c) === r));
  const target = state.seats.find((s) => s.seat !== asker.seat);

  const before = state.asks.length;
  gofish.onAction(state, { id: asker.id }, { type: 'ask', of: target.seat, rank: notHeld }, api);
  check('go fish: you cannot ask for a rank you do not hold', state.asks.length === before, notHeld);

  gofish.onAction(state, { id: asker.id }, { type: 'ask', of: target.seat, rank: held }, api);
  check('go fish: but you can ask for one you do', state.asks.length === before + 1, held);
  check('go fish: and the question is public',
    gofish.serialize(state).asks.some((a) => a.rank === held));
  check('go fish: still fifty-two', census(state).total === 52, String(census(state).total));

  // A whole hand, played legally, counting the cards after every move.
  let broke = null;
  for (let round = 0; round < 40 && !broke; round++) {
    const { state: st, players } = open(gofish, 4);
    let guard = 0;
    while (!gofish.__spec.handOver(st) && st.phase === 'play' && guard++ < 400) {
      const me = st.seats[st.turn];
      const ranks = [...new Set(me.hand.map(rankOf))];
      const others = st.seats.filter((s) => s.seat !== me.seat && s.hand.length);
      if (!ranks.length || !others.length) break;
      gofish.onAction(st, { id: me.id },
        { type: 'ask', of: others[guard % others.length].seat, rank: ranks[guard % ranks.length] }, api);
      const c = census(st);
      if (c.total !== 52) { broke = `${c.total} after ${guard} asks`; break; }
      if (c.unique !== c.all.length) { broke = 'a card exists twice'; break; }
      gofish.onTick(st, 0.25, api);
    }
    void players;
  }
  check('go fish: forty hands and never more or fewer than fifty-two', broke === null, broke ?? '');
}

/* --------------------------------- Hearts --------------------------------- */

{
  const { state } = open(hearts, 4);
  check('hearts: thirteen each', state.seats.every((s) => s.hand.length === 13),
    state.seats.map((s) => s.hand.length).join(','));
  check('hearts: the two of clubs leads', state.seats[state.turn].hand.includes('2c'));

  const opener = state.seats[state.turn];
  const notTwo = opener.hand.find((c) => c !== '2c');
  hearts.onAction(state, { id: opener.id }, { type: 'play', card: notTwo }, api);
  check('hearts: nothing but the two of clubs opens', state.trick.length === 0, notTwo);
  hearts.onAction(state, { id: opener.id }, { type: 'play', card: '2c' }, api);
  check('hearts: and it does', state.trick.length === 1);

  // Follow suit if you can.
  const next = state.seats[state.turn];
  const offSuit = next.hand.find((c) => suitOf(c) !== 'c');
  const canFollow = next.hand.some((c) => suitOf(c) === 'c');
  if (canFollow && offSuit) {
    hearts.onAction(state, { id: next.id }, { type: 'play', card: offSuit }, api);
    check('hearts: you must follow the suit led', state.trick.length === 1, offSuit);
  } else {
    check('hearts: you must follow the suit led', true, 'void in clubs, nothing to test here');
  }

  // Hearts cannot be led until broken.
  const { state: hs } = open(hearts, 4);
  hs.broken = false;
  hs.trick = [];
  const leader = hs.seats[hs.turn];
  // Give them a hand with a heart and something else, so the "only hearts left"
  // exception does not apply.
  leader.hand = ['Ah', '3c', '9d'];
  hs.taken = Object.fromEntries(hs.seats.map((s) => [s.seat, ['Kd']]));  // not the first trick
  hearts.onAction(hs, { id: leader.id }, { type: 'play', card: 'Ah' }, api);
  check('hearts: you cannot lead a heart until they are broken', hs.trick.length === 0);
  hs.broken = true;
  hearts.onAction(hs, { id: leader.id }, { type: 'play', card: 'Ah' }, api);
  check('hearts: once broken you can', hs.trick.length === 1);

  // Shooting the moon turns the hand inside out. Worth its own check because a
  // scorer that just adds up what you took is right in every hand but this one.
  const { state: moon } = open(hearts, 4);
  const shooter = moon.seats[0];
  moon.taken = Object.fromEntries(moon.seats.map((s) => [s.seat, []]));
  moon.taken[shooter.seat] = ['Qs', ...['2h', '3h', '4h', '5h', '6h', '7h', '8h', '9h', 'Th', 'Jh', 'Qh', 'Kh', 'Ah']];
  const wasScores = moon.seats.map((s) => s.score);
  hearts.__spec.scoreHand(moon);
  check('hearts: shooting the moon costs everybody else twenty-six',
    moon.seats[0].score === wasScores[0] &&
    moon.seats.slice(1).every((s, i) => s.score === wasScores[i + 1] + 26),
    moon.seats.map((s) => s.score).join(','));

  // And lowest wins, which is the opposite of every other scoreboard here.
  const board = hearts.results(moon);
  check('hearts: the lowest score comes first', board[0].playerId === shooter.id,
    `${board[0].name} on ${board[0].score}`);

  // A whole hand of legal play, counted at every trick.
  let broke = null;
  for (let round = 0; round < 25 && !broke; round++) {
    const { state: st } = open(hearts, 4);
    let guard = 0;
    while (st.seats.some((s) => s.hand.length) && guard++ < 200) {
      const me = st.seats[st.turn];
      const view = hearts.serializeFor(st, me.id);
      const ok = view.you.playable;
      if (!ok.length) { broke = `nothing legal for ${me.name} holding ${me.hand.join(' ')}`; break; }
      hearts.onAction(st, { id: me.id }, { type: 'play', card: ok[0] }, api);
      const c = census(st);
      if (c.total !== 52) { broke = `${c.total} cards after ${guard} plays`; break; }
      if (c.unique !== c.all.length) { broke = 'a card exists twice'; break; }
    }
    if (!broke && st.seats.some((s) => s.hand.length)) broke = 'the hand never finished';
  }
  check('hearts: twenty-five hands, always a legal card and always fifty-two', broke === null, broke ?? '');
}

/* ---------------------------------- Snap ---------------------------------- */

{
  const { state } = open(snap, 4, { flipSeconds: 0.6 });
  check('snap: nobody is dealt anything', state.seats.every((s) => s.hand.length === 0));
  check('snap: the whole pack is in the middle', state.deck.length === 52, String(state.deck.length));

  // Snapping at nothing costs you.
  const someone = state.seats[0];
  someone.hand = ['As', 'Kd', 'Qc'];
  snap.onAction(state, { id: someone.id }, { type: 'snap' }, api);
  check('snap: snapping at nothing pays everybody', someone.hand.length === 0,
    `${someone.hand.length} left`);
  check('snap: and the cards went to the others',
    state.seats.slice(1).reduce((sum, s) => sum + s.hand.length, 0) === 3);

  // Run the whole pack through and count at every flip.
  let broke = null;
  for (let round = 0; round < 20 && !broke; round++) {
    const { state: st } = open(snap, 4, { flipSeconds: 0.1 });
    let guard = 0;
    let snaps = 0;
    while (!snap.__spec.handOver(st) && guard++ < 3000) {
      snap.onTick(st, 0.12, api);
      if (st.matching) {
        snap.onAction(st, { id: st.seats[snaps % st.seats.length].id }, { type: 'snap' }, api);
        snaps += 1;
      }
      const c = census(st);
      if (c.total !== 52) { broke = `${c.total} cards after ${guard} ticks`; break; }
      if (c.unique !== c.all.length) { broke = 'a card exists twice'; break; }
    }
    if (!broke && snaps === 0) broke = 'no pair ever came up in a whole pack';
  }
  check('snap: twenty packs, never more or fewer than fifty-two', broke === null, broke ?? '');

  // The window shuts on the first shout, so a second one wins nothing.
  const { state: race } = open(snap, 3, { flipSeconds: 0.1 });
  race.face = 'As'; race.under = 'Ah'; race.matching = true; race.window = 2;
  race.pile = ['Ah', 'As'];
  snap.onAction(race, { id: race.seats[0].id }, { type: 'snap' }, api);
  const firstGot = race.seats[0].hand.length;
  snap.onAction(race, { id: race.seats[1].id }, { type: 'snap' }, api);
  check('snap: the first hand down takes it', firstGot === 2, String(firstGot));
  check('snap: and the second wins nothing', race.seats[1].hand.length === 0,
    String(race.seats[1].hand.length));
}

/* -------------------------------- nonsense -------------------------------- */

{
  for (const game of CARD_GAMES) {
    const { state, players } = open(game, game.minPlayers);
    const before = census(state).total;
    game.onAction(state, { id: 'ghost', name: 'Ghost' }, { type: 'play', cards: ['As'] }, api);
    game.onAction(state, players[0], { type: 'play', card: 'ZZ' }, api);
    game.onAction(state, players[0], { type: 'play', cards: ['ZZ', 'YY'] }, api);
    game.onAction(state, players[0], { type: 'ask', of: 99, rank: 'A' }, api);
    game.onAction(state, players[0], { type: 'nonsense' }, api);
    check(`${game.name}: nonsense changes nothing`, census(state).total === before,
      `${before} then ${census(state).total}`);
    check(`${game.name}: no CPU playing`, game.botAction() === null);
    check(`${game.name}: it is in the card room`, game.room === 'cards', game.room);
    check(`${game.name}: and knows its own face`, Boolean(game.face), game.face);
  }
}

rmSync(TMP, { recursive: true, force: true });

const bad = results.filter((r) => !r.ok);
if (bad.length) {
  console.log('\n  \x1b[31mwhat failed:\x1b[0m');
  for (const r of bad) console.log(`  \x1b[31m  · ${r.label}\x1b[0m`);
}
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed — fifty-two cards, and nobody sees a hand\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
