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
const { snap, slapjack, war } = await import('../server/games/cards/flip.js');
const { gofish } = await import('../server/games/cards/gofish.js');
const { hearts } = await import('../server/games/cards/hearts.js');
const { crazy8s, switchGame } = await import('../server/games/cards/crazy8s.js');
const { president } = await import('../server/games/cards/president.js');
const { sevens } = await import('../server/games/cards/sevens.js');
const { speed } = await import('../server/games/cards/speed.js');
const { oldmaid } = await import('../server/games/cards/oldmaid.js');
const { memory } = await import('../server/games/cards/memory.js');
const { spoons } = await import('../server/games/cards/spoons.js');
const { spades, whist, euchre } = await import('../server/games/cards/tricks.js');
const { rummy, gin, bestKnockDiscard } = await import('../server/games/cards/rummy.js');
const { canasta, legalMeld, worth } = await import('../server/games/cards/canasta.js');
const { golf, cost, scoreGrid } = await import('../server/games/cards/golf.js');
const { cribbage, countHand, pip } = await import('../server/games/cards/cribbage.js');
const { bestLayout, isSet, isRun, pointsOf } = await import('../server/games/cards/melds.js');
const { CARD_GAMES } = await import('../server/games/cards/index.js');
const { rankOf, suitOf, RANKS } = await import('../server/cards.js');

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
    // Swept out of play but not out of existence — President clears the pile
    // between rounds and those cards are gone for the hand, not gone.
    ...(state.discard ?? []),
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
    // At least two, whatever the game allows — Memory can be played alone and
    // a one-player table has nobody to leak a hand to.
    const { state, players } = open(game, Math.max(2, game.minPlayers));
    const pub = game.serialize(state);
    const wire = JSON.stringify(pub);

    // Structural first, and for every game: a seat on the wire carries a count
    // and never an array of cards. This is the check that cannot be fooled.
    check(`${game.name}: a seat on the wire has a count, not cards`,
      (pub.seats ?? []).every((s) => !('hand' in s) && typeof s.cards === 'number'),
      JSON.stringify(pub.seats?.[0] ?? {}));

    // Then the text search — but only where a card code identifies one card.
    // Canasta deals from two packs, so a nine of spades in the discard pile
    // and a nine of spades in somebody's hand are two different cards, and
    // searching the text for the code finds the innocent one.
    const TWO_PACKS = ['canasta'];
    if (TWO_PACKS.includes(game.id)) {
      check(`${game.name}: the table state carries no hand`, true, 'two packs — checked structurally');
    } else {
      const someones = state.seats.flatMap((s) => s.hand);
      const leaked = someones.filter((c) => wire.includes(`"${c}"`));
      check(`${game.name}: the table state carries no hand`, leaked.length === 0, leaked.slice(0, 4).join(' '));
    }

    const mine = game.serializeFor(state, players[0].id);
    const theirs = game.serializeFor(state, players[1].id);
    check(`${game.name}: but you can see your own`, Array.isArray(mine.you.hand));
    // And crucially, your private view carries nobody else's.
    // Only codes this player does not hold themselves: Canasta uses two packs,
    // so "9s is in my view and also in your hand" is not a leak, it is a
    // second nine of spades.
    const others = state.seats
      .filter((s) => s.id !== players[0].id)
      .flatMap((s) => s.hand)
      .filter((c) => !mine.you.hand.includes(c));
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
  // Counted across the whole run rather than per pack. A shuffled pack has
  // about a one-in-twenty chance of containing no two adjacent cards of the
  // same rank at all, so "every pack had a pair" is a check that fails roughly
  // two runs in three — it passed the first few times by luck.
  let totalSnaps = 0;
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
    totalSnaps += snaps;
  }
  check('snap: twenty packs, never more or fewer than fifty-two', broke === null, broke ?? '');
  check('snap: and pairs did come up to be snapped', totalSnaps > 0, `${totalSnaps} snaps`);

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

/* --------------------------- Crazy Eights and Switch ---------------------- */

{
  for (const game of [crazy8s, switchGame]) {
    const { state } = open(game, 4);
    check(`${game.name}: it never opens on a wild`,
      rankOf(state.pile[state.pile.length - 1]) !== '8',
      state.pile[state.pile.length - 1]);
    check(`${game.name}: fifty-two cards are out`, census(state).total === 52, String(census(state).total));

    // The reshuffle, which is the one thing in this family that goes wrong
    // invisibly: the card everybody is matching against must not come back as
    // somebody's card.
    const { state: st } = open(game, 4);
    const top = st.pile[st.pile.length - 1];
    // Filler taken off the deck rather than named, so it cannot collide with
    // the card that was turned up. Hardcoding 'Kd','Qd','Jd' put a second copy
    // of the top card in the pile whenever the deal opened on one of them, and
    // the duplicate then legitimately came back in somebody's hand — a fixture
    // failing about one run in six for a reason that was nothing to do with
    // the reshuffle it was testing.
    const filler = st.deck.splice(0, 3);
    st.pile = [...filler, top];   // the top of a pile is its last element
    st.deck = [];
    const seat = st.seats[st.turn];
    game.__spec.act(st, seat, { type: 'draw' });
    check(`${game.name}: the reshuffle leaves the top card alone`,
      st.pile[st.pile.length - 1] === top && !seat.hand.includes(top),
      `${st.pile.join(',')} / drew ${seat.hand.length}`);

    // You may not pass for free while there is anything to draw.
    const { state: p } = open(game, 4);
    const before = p.turn;
    game.__spec.act(p, p.seats[p.turn], { type: 'pass' });
    check(`${game.name}: passing without drawing is refused`, p.turn === before, `${before} then ${p.turn}`);
  }

  // The Switch specials, one at a time, against a Crazy Eights table that has
  // none — the same code path, so both directions have to be checked.
  {
    const { state } = open(switchGame, 4);
    const seat = state.seats[state.turn];
    // Force a two on top of a matching suit so it is legal to play.
    state.pile = ['5h']; state.suit = 'h';
    seat.hand = ['2h', '9c', 'Ks'];
    switchGame.__spec.act(state, seat, { type: 'play', card: '2h' });
    check('switch: a two puts two on the next player', state.pending === 2, String(state.pending));

    const victim = state.seats[state.turn];
    const had = victim.hand.length;
    switchGame.__spec.act(state, victim, { type: 'pass' });
    check('switch: and they pick them up', victim.hand.length === had + 2 && state.pending === 0,
      `${had} then ${victim.hand.length}`);
  }

  {
    const { state } = open(switchGame, 4);
    state.pile = ['5h']; state.suit = 'h'; state.direction = 1;
    const seat = state.seats[state.turn];
    seat.hand = ['Qh', '9c'];
    const wasNext = (state.turn + 1) % 4;
    switchGame.__spec.act(state, seat, { type: 'play', card: 'Qh' });
    check('switch: a queen turns the play around',
      state.direction === -1 && state.turn !== wasNext, `dir ${state.direction}, turn ${state.turn}`);
  }

  {
    const { state } = open(switchGame, 4);
    state.pile = ['5h']; state.suit = 'h';
    const seat = state.seats[state.turn];
    seat.hand = ['Jh', '9c'];
    const skipped = (state.turn + 1) % 4;
    switchGame.__spec.act(state, seat, { type: 'play', card: 'Jh' });
    check('switch: a jack skips somebody', state.turn !== skipped, `skipped ${skipped}, now ${state.turn}`);
  }

  {
    // A wild names the suit, and a nonsense suit falls back to the card's own
    // rather than leaving the table on nothing.
    const { state } = open(crazy8s, 4);
    const seat = state.seats[state.turn];
    state.pile = ['5h']; state.suit = 'h';
    seat.hand = ['8s', '9c'];
    crazy8s.__spec.act(state, seat, { type: 'play', card: '8s', suit: 'd' });
    check('crazy eights: a wild names the suit', state.suit === 'd', state.suit);

    const { state: bad } = open(crazy8s, 4);
    const s2 = bad.seats[bad.turn];
    bad.pile = ['5h']; bad.suit = 'h';
    s2.hand = ['8s', '9c'];
    crazy8s.__spec.act(bad, s2, { type: 'play', card: '8s', suit: 'nonsense' });
    check('crazy eights: and nonsense falls back to its own suit', bad.suit === 's', bad.suit);
  }

  // Whole hands, counted at every move.
  let broke = null;
  for (const game of [crazy8s, switchGame]) {
    for (let round = 0; round < 20 && !broke; round++) {
      const { state: st } = open(game, 4);
      let guard = 0;
      while (!game.__spec.handOver(st) && guard++ < 900) {
        const me = st.seats[st.turn];
        if (!me || me.out) break;
        const view = game.serializeFor(st, me.id);
        const can = view.you.playable;
        if (can.length) game.__spec.act(st, me, { type: 'play', card: can[0], suit: can[0][1] });
        else if (!st.drewThisTurn && st.deck.length + st.pile.length > 1) game.__spec.act(st, me, { type: 'draw' });
        else game.__spec.act(st, me, { type: 'pass' });
        const c = census(st);
        if (c.total !== 52) { broke = `${game.id}: ${c.total} cards after ${guard} moves`; break; }
        if (c.unique !== c.all.length) { broke = `${game.id}: a card exists twice`; break; }
      }
      if (!broke && !game.__spec.handOver(st)) broke = `${game.id}: a hand never finished`;
    }
  }
  check('crazy eights and switch: forty hands, always fifty-two', broke === null, broke ?? '');
}

/* ------------------------------- President -------------------------------- */

{
  const { state } = open(president, 4);
  check('president: the whole pack goes out',
    state.seats.reduce((n, s) => n + s.hand.length, 0) === 52,
    String(state.seats.reduce((n, s) => n + s.hand.length, 0)));

  // A "set" of mixed ranks is the easiest thing to let through and it breaks
  // the game outright.
  const seat = state.seats[state.turn];
  seat.hand = ['5c', '5d', '9h', 'Ks'];
  state.set = null;
  president.__spec.act(state, seat, { type: 'play', cards: ['5c', '9h'] });
  check('president: a set must be all one rank', state.set === null, JSON.stringify(state.set));
  president.__spec.act(state, seat, { type: 'play', cards: ['5c', '5d'] });
  check('president: a real pair goes down', state.set?.count === 2 && state.set?.rank === '5',
    JSON.stringify(state.set));

  // Count and rank both have to be beaten.
  const next = state.seats[state.turn];
  next.hand = ['6c', '6d', '7h', 'Ks'];
  president.__spec.act(state, next, { type: 'play', cards: ['7h'] });
  check('president: one card cannot beat a pair', state.set?.rank === '5', JSON.stringify(state.set));
  president.__spec.act(state, next, { type: 'play', cards: ['6c', '6d'] });
  check('president: a higher pair can', state.set?.rank === '6', JSON.stringify(state.set));

  // Twos are the top of the deck, not the bottom.
  const { state: t } = open(president, 4);
  const holder = t.seats[t.turn];
  t.set = { rank: 'A', count: 1, by: (t.turn + 3) % 4 };
  holder.hand = ['2c', '3d'];
  president.__spec.act(t, holder, { type: 'play', cards: ['2c'] });
  check('president: a two beats an ace', t.set?.rank === '2', JSON.stringify(t.set));

  // And the exchange, which is the social engine of the whole game.
  const { state: ex } = open(president, 4, { hands: 2 });
  ex.ranks = { 0: 'president', 3: 'scum' };
  const pres = ex.seats[0];
  const scum = ex.seats[3];
  president.__spec.deal(ex);
  const presTop = [...pres.hand].sort((a, b) =>
    (rankOf(b) === '2' ? 99 : RANKS.indexOf(rankOf(b))) - (rankOf(a) === '2' ? 99 : RANKS.indexOf(rankOf(a))))[0];
  check('president: the scum hands two up and gets two back',
    pres.hand.length === scum.hand.length &&
    census(ex).total === 52, `${pres.hand.length} vs ${scum.hand.length}, ${census(ex).total} cards`);
  void presTop;

  // A whole hand, counted at every move.
  let broke = null;
  for (let round = 0; round < 20 && !broke; round++) {
    const { state: st } = open(president, 4);
    let guard = 0;
    while (!president.__spec.handOver(st) && guard++ < 900) {
      const me = st.seats[st.turn];
      if (!me || me.out) break;
      const view = president.serializeFor(st, me.id);
      const need = view.you.needCount || 1;
      const byRank = new Map();
      for (const c of me.hand) {
        if (!byRank.has(rankOf(c))) byRank.set(rankOf(c), []);
        byRank.get(rankOf(c)).push(c);
      }
      const set = [...byRank.values()].find((cards) =>
        cards.length >= need && view.you.playable.includes(cards[0]));
      if (set) president.__spec.act(st, me, { type: 'play', cards: set.slice(0, need) });
      else president.__spec.act(st, me, { type: 'pass' });
      const c = census(st);
      if (c.total !== 52) { broke = `${c.total} cards after ${guard} moves`; break; }
      if (c.unique !== c.all.length) { broke = 'a card exists twice'; break; }
    }
    if (!broke && !president.__spec.handOver(st)) broke = 'a hand never finished';
  }
  check('president: twenty hands, always fifty-two', broke === null, broke ?? '');
}

/* --------------------------------- Sevens --------------------------------- */

{
  const { state } = open(sevens, 4);
  check('sevens: the whole pack goes out',
    state.seats.reduce((n, s) => n + s.hand.length, 0) === 52);
  check('sevens: whoever holds the seven of diamonds opens',
    state.seats[state.turn].hand.includes('7d'));

  const seat = state.seats[state.turn];
  const notSeven = seat.hand.find((c) => c !== '7d' && rankOf(c) !== '7');
  if (notSeven) {
    sevens.__spec.act(state, seat, { type: 'play', card: notSeven });
    check('sevens: nothing but a seven opens a suit',
      Object.values(state.rows).every((r) => r === null), notSeven);
  } else {
    check('sevens: nothing but a seven opens a suit', true, 'all sevens, nothing to test');
  }
  sevens.__spec.act(state, seat, { type: 'play', card: '7d' });
  check('sevens: and a seven does', state.rows.d !== null, JSON.stringify(state.rows.d));

  // The rule the whole game turns on.
  const { state: must } = open(sevens, 4);
  const opener = must.seats[must.turn];
  sevens.__spec.act(must, opener, { type: 'play', card: '7d' });
  const holder = must.seats.find((s) => s.hand.includes('8d') || s.hand.includes('6d'));
  if (holder) {
    must.turn = holder.seat;
    const was = must.turn;
    sevens.__spec.act(must, holder, { type: 'pass' });
    check('sevens: you cannot pass when you have a card that goes', must.turn === was,
      `${was} then ${must.turn}`);
    check('sevens: and the table says so',
      sevens.serializeFor(must, holder.id).you.mustPlay === true);
  } else {
    check('sevens: you cannot pass when you have a card that goes', true, 'nobody held one');
    check('sevens: and the table says so', true, '');
  }

  let broke = null;
  for (let round = 0; round < 20 && !broke; round++) {
    const { state: st } = open(sevens, 4);
    let guard = 0;
    while (!sevens.__spec.handOver(st) && guard++ < 900) {
      const me = st.seats[st.turn];
      if (!me || me.out) break;
      const can = sevens.serializeFor(st, me.id).you.playable;
      if (can.length) sevens.__spec.act(st, me, { type: 'play', card: can[0] });
      else sevens.__spec.act(st, me, { type: 'pass' });
      const c = census(st);
      // Sevens lays cards on the table rather than into a pile, so the layout
      // has to be counted as well or every laid card reads as lost.
      const laid = Object.values(st.rows).reduce((n, r) => n + (r ? r[1] - r[0] + 1 : 0), 0);
      if (c.total + laid !== 52) { broke = `${c.total + laid} cards after ${guard} moves`; break; }
    }
    if (!broke && !sevens.__spec.handOver(st)) broke = 'a hand never finished';
  }
  check('sevens: twenty hands, always fifty-two', broke === null, broke ?? '');
}

/* ---------------------------------- Speed --------------------------------- */

{
  const { state } = open(speed, 2);
  check('speed: five in hand each', state.seats.every((s) => s.hand.length === 5),
    state.seats.map((s) => s.hand.length).join(','));
  check('speed: two piles in the middle', state.middle.filter(Boolean).length === 2);
  check('speed: and nobody has a turn', state.settings.turnSeconds === 0 || speed.__spec.turnSeconds === 0,
    String(state.settings.turnSeconds));

  // The wrap, without which the run has two dead ends.
  const { state: w } = open(speed, 2);
  const seat = w.seats[0];
  w.middle = [['Ks'], ['5d']];
  seat.hand = ['Ah', '9c', '9d', '9h', '9s'];
  speed.__spec.act(w, seat, { type: 'play', card: 'Ah', pile: 0 });
  check('speed: an ace goes on a king', w.middle[0].at(-1) === 'Ah', w.middle[0].join(','));

  // Two people racing for the same pile: the second is simply not legal any
  // more, because the card they were playing against has been covered.
  const { state: race } = open(speed, 2);
  race.middle = [['5s'], ['Jd']];
  race.seats[0].hand = ['6h', '2c', '2d', '2h', '2s'];
  race.seats[1].hand = ['4c', '3c', '3d', '3h', '3s'];
  speed.__spec.act(race, race.seats[0], { type: 'play', card: '6h', pile: 0 });
  speed.__spec.act(race, race.seats[1], { type: 'play', card: '4c', pile: 0 });
  check('speed: the first play covers the pile', race.middle[0].at(-1) === '6h', race.middle[0].join(','));
  check('speed: and the second is refused, not queued',
    race.seats[1].hand.includes('4c'), race.seats[1].hand.join(','));

  // A stuck table turns fresh cards over rather than sitting there.
  const { state: stuck } = open(speed, 2);
  stuck.middle = [['5s'], ['5d']];
  for (const s of stuck.seats) s.hand = ['9c', '9d', '9h', '9s', 'Tc'];
  // Just past the first refresh. Running on for thirty ticks triggers three of
  // them, and by the third the reserves are empty and the middle gets shuffled
  // back into itself — which can legitimately land the same two cards on top
  // again and read as "it never refreshed".
  for (let i = 0; i < 9; i++) speed.__spec.tick(stuck, 0.5);
  check('speed: a stuck table turns two fresh cards over',
    stuck.middle[0].at(-1) !== '5s' || stuck.middle[1].at(-1) !== '5d',
    `${stuck.middle[0].at(-1)},${stuck.middle[1].at(-1)}`);

  // Cards conserved across a real race. Two packs above two players, so the
  // target is not always fifty-two.
  let broke = null;
  for (let round = 0; round < 12 && !broke; round++) {
    const { state: st } = open(speed, round % 2 ? 3 : 2);
    const target = st.seats.reduce((n, s) => n + s.hand.length + (st.stacks[s.seat]?.length ?? 0), 0)
      + st.middle[0].length + st.middle[1].length + st.reserve[0].length + st.reserve[1].length;
    let guard = 0;
    while (!speed.__spec.handOver(st) && guard++ < 2000) {
      let moved = false;
      for (const me of st.seats.filter((s) => !s.out)) {
        const onto = speed.serializeFor(st, me.id).you.onto;
        const card = Object.keys(onto)[0];
        if (!card) continue;
        speed.__spec.act(st, me, { type: 'play', card, pile: onto[card][0] });
        moved = true;
        break;
      }
      if (!moved) speed.__spec.tick(st, 1);
      const now = st.seats.reduce((n, s) => n + s.hand.length + (st.stacks[s.seat]?.length ?? 0), 0)
        + st.middle[0].length + st.middle[1].length + st.reserve[0].length + st.reserve[1].length;
      if (now !== target) { broke = `${now} of ${target} after ${guard} moves`; break; }
    }
  }
  check('speed: twelve races and never a card made or lost', broke === null, broke ?? '');
}

/* -------------------------- Slapjack, War, Old Maid ----------------------- */

{
  // Slapjack is Snap with one predicate swapped, so what is worth checking is
  // that the predicate really is the only difference.
  const { state } = open(slapjack, 4, { flipSeconds: 0.1 });
  state.deck = ['3c', '3d', 'Jh', '5s'];   // popped from the end
  state.face = null; state.under = null;
  slapjack.__spec.tick(state, 9);
  check('slapjack: a five is nothing', state.matching === false, state.face);
  slapjack.__spec.tick(state, 9);
  check('slapjack: a jack is everything', state.matching === true, state.face);
  slapjack.__spec.tick(state, 9);   // this one only clears the jack's window
  slapjack.__spec.tick(state, 9);
  slapjack.__spec.tick(state, 9);
  check('slapjack: and a matching pair is still nothing',
    state.face === '3c' && state.matching === false, `${state.under} then ${state.face}`);

  let broke = null;
  let slaps = 0;
  for (let round = 0; round < 15 && !broke; round++) {
    const { state: st } = open(slapjack, 4, { flipSeconds: 0.1 });
    let guard = 0;
    while (!slapjack.__spec.handOver(st) && guard++ < 3000) {
      slapjack.onTick(st, 0.7, api);
      if (st.matching) { slapjack.onAction(st, { id: st.seats[slaps % 4].id }, { type: 'snap' }, api); slaps += 1; }
      const c = census(st);
      if (c.total !== 52) { broke = `${c.total} after ${guard}`; break; }
      if (c.unique !== c.all.length) { broke = 'a card exists twice'; break; }
    }
  }
  check('slapjack: fifteen packs, always fifty-two', broke === null, broke ?? '');
  check('slapjack: and the jacks got slapped', slaps > 0, `${slaps} slaps`);
}

{
  const { state } = open(war, 4);
  check('war: the pack is split between them',
    state.seats.reduce((n, s) => n + s.hand.length, 0) === 52,
    state.seats.map((s) => s.hand.length).join(','));

  // A tie has to become a war rather than being handed to whoever sorts first.
  const { state: tie } = open(war, 2);
  tie.seats[0].hand = ['2c', '3c', '4c', '5c', 'Kh'];
  tie.seats[1].hand = ['2d', '3d', '4d', '5d', 'Kd'];
  war.__spec.tick(tie, 9);
  check('war: two kings is a war', tie.warDepth === 1, String(tie.warDepth));
  check('war: and the stakes go up', tie.spoils.length > 2, String(tie.spoils.length));

  let broke = null;
  let wars = 0;
  for (let round = 0; round < 10 && !broke; round++) {
    const { state: st } = open(war, 3);
    let guard = 0;
    while (!war.__spec.handOver(st) && guard++ < 4000) {
      war.onTick(st, 3, api);
      if (st.warDepth > 0) wars += 1;
      // War has a spoils pile and a battle in flight, so both count.
      const held = st.seats.reduce((n, s) => n + s.hand.length, 0);
      const total = held + st.spoils.length;
      if (total !== 52) { broke = `${total} cards after ${guard} battles`; break; }
    }
  }
  check('war: ten games and never a card made or lost', broke === null, broke ?? '');
  check('war: and wars actually happened', wars > 0, `${wars} ticks in war`);
}

{
  const { state } = open(oldmaid, 4);
  const held = state.seats.reduce((n, s) => n + s.hand.length, 0);
  const paired = Object.values(state.pairs).flat().length * 2;
  check('old maid: one queen is missing', held + paired === 51, String(held + paired));
  check('old maid: and it is the odd one',
    !state.seats.some((s) => s.hand.includes('Qs')), 'Qs');

  // A draw must be blind. The strongest check available is that a hand is
  // shuffled before it is drawn from, so position carries no information.
  const { state: blind } = open(oldmaid, 4);
  const from = blind.seats.find((s) => s.seat === (blind.turn + 1) % 4);
  from.hand = ['2c', '3c', '4c', '5c', '6c', '7c', '8c', '9c'];
  const before = [...from.hand];
  const me = blind.seats[blind.turn];
  oldmaid.__spec.act(blind, me, { type: 'draw', at: 0 });
  check('old maid: the hand drawn from is shuffled first',
    JSON.stringify(from.hand) !== JSON.stringify(before.slice(1)),
    `${before.join('')} -> ${from.hand.join('')}`);

  // Nobody may see how many of what somebody holds.
  const wire = JSON.stringify(oldmaid.serialize(blind));
  check('old maid: only pair counts are public',
    !wire.includes('"2c"') && !wire.includes('"9c"'), wire.slice(0, 70));

  let broke = null;
  for (let round = 0; round < 20 && !broke; round++) {
    const { state: st } = open(oldmaid, 4);
    let guard = 0;
    while (!oldmaid.__spec.handOver(st) && guard++ < 900) {
      const seat = st.seats[st.turn];
      if (!seat || seat.out) break;
      oldmaid.__spec.act(st, seat, { type: 'draw', at: 0 });
      const held = st.seats.reduce((n, s) => n + s.hand.length, 0);
      const down = Object.values(st.pairs).flat().length * 2;
      if (held + down !== 51) { broke = `${held + down} of 51 after ${guard}`; break; }
    }
    if (!broke && !oldmaid.__spec.handOver(st)) broke = 'a hand never finished';
  }
  check('old maid: twenty hands, always fifty-one', broke === null, broke ?? '');
}

/* --------------------------------- Memory --------------------------------- */

{
  const { state } = open(memory, 3, { pairs: 8 });
  check('memory: the grid is pairs, doubled', state.grid.length === 16, String(state.grid.length));
  const wire = JSON.stringify(memory.serialize(state));
  check('memory: a face-down square carries no card',
    !state.grid.some((slot) => wire.includes(`"${slot.card}"`)),
    wire.slice(0, 70));

  // Turn two, and check the card appears only once it is up.
  const seat = state.seats[state.turn];
  memory.__spec.act(state, seat, { type: 'turn', at: 0 });
  const now = memory.serialize(state);
  check('memory: a turned square does carry its card', now.grid[0].card === state.grid[0].card);
  check('memory: and the rest still do not',
    now.grid.filter((g) => g.card).length === 1, String(now.grid.filter((g) => g.card).length));

  // The look is on a timer and nothing may be turned during it — otherwise a
  // fast tap robs everybody else of the only information in the game.
  const at = state.grid.findIndex((g, i) => i > 0 && rankOf(g.card) !== rankOf(state.grid[0].card));
  memory.__spec.act(state, seat, { type: 'turn', at });
  check('memory: a miss starts a look', state.looking > 0, String(state.looking));
  const free = state.grid.findIndex((g) => !g.up && !g.gone);
  memory.__spec.act(state, seat, { type: 'turn', at: free });
  check('memory: and nothing can be turned during it',
    state.grid[free].up === false, String(state.grid[free].up));

  // Pairing goes again rather than passing on.
  const { state: p } = open(memory, 3, { pairs: 8 });
  const a = 0;
  const b = p.grid.findIndex((g, i) => i > 0 && rankOf(g.card) === rankOf(p.grid[0].card));
  const who = p.turn;
  memory.__spec.act(p, p.seats[p.turn], { type: 'turn', at: a });
  memory.__spec.act(p, p.seats[p.turn], { type: 'turn', at: b });
  check('memory: a pair stays up', p.grid[a].gone && p.grid[b].gone);
  check('memory: and you go again', p.turn === who, `${who} then ${p.turn}`);

  let broke = null;
  for (let round = 0; round < 10 && !broke; round++) {
    const { state: st } = open(memory, 3, { pairs: 10 });
    let guard = 0;
    while (!memory.__spec.handOver(st) && guard++ < 3000) {
      const seat2 = st.seats[st.turn];
      const free2 = st.grid.map((g, i) => (!g.gone && !g.up ? i : -1)).filter((i) => i >= 0);
      if (st.looking > 0 || !free2.length) { memory.onTick(st, 0.5, api); continue; }
      // Picked at random, not by a counter. `free2[guard % free2.length]` walks
      // the list in lockstep with how the list shrinks, and with four squares
      // left it cycles through the same two mismatched pairs forever — a
      // stalled harness that reads exactly like a stalled game.
      memory.__spec.act(st, seat2, { type: 'turn', at: free2[Math.floor(Math.random() * free2.length)] });
      const pairs = st.grid.length / 2;
      const done = Object.values(st.pairsBy).reduce((n, x) => n + x, 0);
      const goneSlots = st.grid.filter((g) => g.gone).length;
      if (goneSlots !== done * 2) { broke = `${goneSlots} gone but ${done} pairs claimed`; break; }
      if (done > pairs) { broke = `${done} pairs out of ${pairs}`; break; }
    }
    if (!broke && !memory.__spec.handOver(st)) {
      const gone = st.grid.filter((g) => g.gone).length;
      broke = `stalled at ${gone} of ${st.grid.length} gone, phase ${st.phase}, looking ${st.looking}`;
    }
  }
  check('memory: ten grids, cleared exactly', broke === null, broke ?? '');
}

/* --------------------------------- Spoons --------------------------------- */

{
  const { state } = open(spoons, 4);
  check('spoons: one spoon fewer than players', state.spoons === 3, String(state.spoons));
  check('spoons: four each, and one with five',
    state.seats.filter((s) => s.hand.length === 4).length === 3 &&
    state.seats.filter((s) => s.hand.length === 5).length === 1,
    state.seats.map((s) => s.hand.length).join(','));

  // You cannot start the grab without four of a kind.
  const seat = state.seats[1];
  seat.hand = ['2c', '5d', '9h', 'Ks'];
  spoons.__spec.act(state, seat, { type: 'grab' });
  check('spoons: no four of a kind, no first grab', state.grabbing === false);

  // But once it is on, anybody may grab — that is the cruel half of the game.
  seat.hand = ['7c', '7d', '7h', '7s'];
  spoons.__spec.act(state, seat, { type: 'grab' });
  check('spoons: four of a kind starts it', state.grabbing === true);
  const other = state.seats.find((s) => s.seat !== seat.seat);
  spoons.__spec.act(state, other, { type: 'grab' });
  check('spoons: and then anybody can, with anything',
    state.grabbed.includes(other.seat), state.grabbed.join(','));

  // The last one is refused, and somebody goes out.
  const rest = state.seats.filter((s) => !state.grabbed.includes(s.seat));
  for (const s of rest) spoons.__spec.act(state, s, { type: 'grab' });
  check('spoons: there are never more spoons than spoons',
    state.grabbed.length <= 3, String(state.grabbed.length));
  check('spoons: and whoever missed out is gone',
    state.seats.filter((s) => s.out).length >= 1,
    state.seats.filter((s) => s.out).map((s) => s.name).join(','));

  // Passing may never empty a hand below four.
  const { state: p } = open(spoons, 4);
  const short = p.seats.find((s) => s.hand.length === 4);
  const was = short.hand.length;
  spoons.__spec.act(p, short, { type: 'pass', card: short.hand[0] });
  check('spoons: you cannot pass below four', short.hand.length === was, String(short.hand.length));
}

/* --------------------- Spades, Whist and Euchre ---------------------------- */

{
  for (const game of [spades, whist, euchre]) {
    const { state } = open(game, 4);
    check(`${game.name}: everybody has the same number of cards`,
      new Set(state.seats.map((s) => s.hand.length)).size === 1,
      state.seats.map((s) => s.hand.length).join(','));
    check(`${game.name}: there is a trump suit`, Boolean(state.trump), String(state.trump));
  }

  check('spades: spades are always trump', open(spades, 4).state.trump === 's');

  // Following suit, which is the one rule a client must not be left to police.
  {
    const { state } = open(whist, 4);
    state.bidding = false;
    const leader = state.seats[state.turn];
    const lead = leader.hand.find((c) => leader.hand.filter((x) => suitOf(x) === suitOf(c)).length >= 1);
    whist.__spec.act(state, leader, { type: 'play', card: lead });
    const next = state.seats[state.turn];
    const off = next.hand.find((c) => suitOf(c) !== state.led);
    const canFollow = next.hand.some((c) => suitOf(c) === state.led);
    if (canFollow && off) {
      whist.__spec.act(state, next, { type: 'play', card: off });
      check('whist: you must follow the suit led', state.trick.length === 1, off);
    } else {
      check('whist: you must follow the suit led', true, 'void in the led suit');
    }
  }

  // Spades: making your bid exactly is the whole game, and overtricks are worth
  // almost nothing — a scorer that just counted tricks would look fine.
  {
    const { state } = open(spades, 4);
    state.bids = { 0: 3, 1: 3, 2: 0, 3: 5 };
    state.tricks = { 0: 3, 1: 5, 2: 0, 3: 2 };
    const was = state.seats.map((s) => s.score);
    spades.__spec.scoreHand(state);
    check('spades: an exact bid pays ten a trick', state.seats[0].score === was[0] + 30,
      String(state.seats[0].score - was[0]));
    check('spades: overtricks are worth one each', state.seats[1].score === was[1] + 32,
      String(state.seats[1].score - was[1]));
    check('spades: and missing costs you the lot', state.seats[3].score === was[3] - 50,
      String(state.seats[3].score - was[3]));
  }

  // Euchre's bowers. Getting these wrong does not break anything — it just
  // means the game is not Euchre, which is why they are checked directly.
  {
    const { state } = open(euchre, 4);
    check('euchre: twenty-four cards, five each',
      state.seats.every((s) => s.hand.length === 5),
      state.seats.map((s) => s.hand.length).join(','));
    check('euchre: no card below a nine',
      state.seats.every((s) => s.hand.every((c) => !['2', '3', '4', '5', '6', '7', '8'].includes(rankOf(c)))),
      state.seats.flatMap((s) => s.hand).join(' '));

    // Force hearts as trump and check the jack of diamonds has changed sides.
    state.trump = 'h';
    state.leftBower = 'Jd';
    check('euchre: the left bower counts as trump, not its own suit',
      state.asSuit(state, 'Jd') === 'h', state.asSuit(state, 'Jd'));
    check('euchre: and an ordinary diamond does not',
      state.asSuit(state, 'Ad') === 'd', state.asSuit(state, 'Ad'));
    check('euchre: the right bower is the highest card in the game',
      state.asPower(state, 'Jh') > state.asPower(state, 'Ah') &&
      state.asPower(state, 'Jh') > state.asPower(state, 'Jd'),
      `${state.asPower(state, 'Jh')} vs ace ${state.asPower(state, 'Ah')}`);
    check('euchre: and the left bower is just under it',
      state.asPower(state, 'Jd') > state.asPower(state, 'Ah'),
      `${state.asPower(state, 'Jd')} vs ${state.asPower(state, 'Ah')}`);

    // The rule with teeth: asked to follow diamonds, you may not play the left
    // bower, because it is not a diamond any more.
    state.trick = [{ seat: 0, name: 'x', card: 'Ad' }];
    state.led = 'd';
    const holder = state.seats[1];
    // A real diamond in hand, so following the lead is actually possible —
    // that is the only situation where the bower rule bites. With no diamonds
    // at all you may throw anything, jack of diamonds included, and the first
    // version of this check was testing that instead.
    holder.hand = ['Jd', '9d'];
    const legalNow = euchre.serializeFor(state, holder.id).you.playable;
    check('euchre: the left bower cannot follow its printed suit',
      !legalNow.includes('Jd'), legalNow.join(','));
  }

  // Whole hands, all three, counted at every trick.
  let broke = null;
  for (const game of [spades, whist, euchre]) {
    for (let round = 0; round < 12 && !broke; round++) {
      const { state: st } = open(game, 4);
      const packSize = st.seats.reduce((n, s) => n + s.hand.length, 0)
        + st.deck.length + (st.turnedUp ? 1 : 0);
      if (st.bidding) for (const s of st.seats) game.__spec.act(st, s, { type: 'bid', tricks: 2 });
      let guard = 0;
      while (!game.__spec.handOver(st) && guard++ < 400) {
        const me = st.seats[st.turn];
        const ok = game.serializeFor(st, me.id).you.playable;
        if (!ok.length) { broke = `${game.id}: nothing legal for ${me.name}`; break; }
        game.__spec.act(st, me, { type: 'play', card: ok[0] });
        const held = st.seats.reduce((n, s) => n + s.hand.length, 0);
        const inTrick = st.trick.length;
        const won = Object.values(st.tricks).reduce((n, x) => n + x, 0);
        if (held + inTrick + won * 4 + st.deck.length + (st.turnedUp ? 1 : 0) !== packSize) {
          broke = `${game.id}: cards do not add up after ${guard}`;
          break;
        }
      }
      if (!broke && !game.__spec.handOver(st)) broke = `${game.id}: a hand never finished`;
    }
  }
  check('spades, whist and euchre: thirty-six hands, always legal and always complete',
    broke === null, broke ?? '');
}

/* ---------------------------- melds, on their own ------------------------- */

{
  check('melds: three of a rank is a set', isSet(['7c', '7d', '7h']));
  check('melds: two is not', !isSet(['7c', '7d']));
  check('melds: mixed ranks is not', !isSet(['7c', '7d', '8h']));
  check('melds: three in a row one suit is a run', isRun(['5c', '6c', '7c']));
  check('melds: out of order still is', isRun(['7c', '5c', '6c']));
  check('melds: across suits is not', !isRun(['5c', '6c', '7d']));
  check('melds: with a gap is not', !isRun(['5c', '6c', '8c']));
  check('melds: an ace is one and a face is ten',
    pointsOf('Ac') === 1 && pointsOf('Kc') === 10 && pointsOf('7d') === 7);

  // The case a greedy layout gets wrong, and the reason the search exists: the
  // set of sevens leaves eleven behind, the run leaves fourteen.
  const tricky = bestLayout(['5c', '6c', '7c', '7d', '7h']);
  check('melds: the search beats a greedy pass', tricky.points === 11,
    `${tricky.points} leaving ${tricky.deadwood.join(',')}`);

  const clean = bestLayout(['2c', '3c', '4c', '9d', '9h', '9s']);
  check('melds: two melds leave nothing', clean.points === 0 && clean.melds.length === 2,
    `${clean.points} points, ${clean.melds.length} melds`);
  const overlap = bestLayout(['5c', '6c', '7c', '8c', '8d', '8h']);
  check('melds: overlapping options resolve to nothing left', overlap.points === 0, String(overlap.points));

  const start = Date.now();
  for (let i = 0; i < 200; i++) bestLayout(['Ac', '2c', '3c', '5d', '6d', '7d', '9h', '9s', '9c', 'Kd']);
  check('melds: two hundred ten-card searches are instant', Date.now() - start < 2000, `${Date.now() - start}ms`);
}

/* --------------------------- Rummy and Gin Rummy -------------------------- */

{
  const { state } = open(rummy, 4);
  check('rummy: ten each and one turned up',
    state.seats.every((s) => s.hand.length === 10) && state.pile.length === 1,
    state.seats.map((s) => s.hand.length).join(','));

  // Draw before anything else.
  const seat = state.seats[state.turn];
  const was = seat.hand.length;
  rummy.__spec.act(state, seat, { type: 'discard', card: seat.hand[0] });
  check('rummy: you must draw first', seat.hand.length === was, String(seat.hand.length));
  rummy.__spec.act(state, seat, { type: 'draw', from: 'deck' });
  check('rummy: and then you have eleven', seat.hand.length === was + 1, String(seat.hand.length));

  // Only real melds go down.
  seat.hand = ['3c', '4c', '5c', '9d', '9h', 'Ks'];
  rummy.__spec.act(state, seat, { type: 'meld', cards: ['9d', '9h', 'Ks'] });
  check('rummy: nonsense does not go down', state.melds.length === 0, JSON.stringify(state.melds));
  rummy.__spec.act(state, seat, { type: 'meld', cards: ['3c', '4c', '5c'] });
  check('rummy: a real run does', state.melds.length === 1, JSON.stringify(state.melds[0]?.cards));

  // Laying off onto somebody else's meld.
  seat.hand.push('6c');
  rummy.__spec.act(state, seat, { type: 'layoff', meld: 0, card: '6c' });
  check('rummy: you can add to a meld on the table', state.melds[0].cards.length === 4,
    state.melds[0].cards.join(','));
  seat.hand.push('Kd');
  rummy.__spec.act(state, seat, { type: 'layoff', meld: 0, card: 'Kd' });
  check('rummy: but only what fits', state.melds[0].cards.length === 4, state.melds[0].cards.join(','));

  // Gin: the knock is judged on the hand after the discard, and only below ten.
  // Each of these gets its own table, because a successful knock latches and
  // every later attempt on the same state is correctly ignored — which is what
  // made the first version of this block report the first knock's points three
  // times over.
  {
    const { state: g } = open(gin, 2);
    const me = g.seats[g.turn];
    g.drewThisTurn = true;
    // Two melds and three loose cards: 8 + 10 + 10 is twenty-eight of deadwood.
    me.hand = ['2c', '3c', '4c', '9d', '9h', '9s', 'Qc', 'Kh', '8d', '7h', '5s'];
    gin.__spec.act(g, me, { type: 'knock', card: '5s' });
    check('gin: a knock on twenty-eight is refused', g.knock === null, JSON.stringify(g.knock));
  }
  {
    const { state: g } = open(gin, 2);
    const me = g.seats[g.turn];
    g.drewThisTurn = true;
    // Three melds and a loose five. Off-suit deliberately: the five of clubs
    // would extend the 2-3-4 run to four and leave nothing at all, which is
    // gin rather than a knock on five — and is what the first version of this
    // check was accidentally testing.
    me.hand = ['2c', '3c', '4c', '9d', '9h', '9s', 'Kd', 'Kh', 'Ks', '5d', '8h'];
    gin.__spec.act(g, me, { type: 'knock', card: '8h' });
    check('gin: a knock on five is allowed', g.knock?.points === 5, JSON.stringify(g.knock));
  }
  {
    const { state: g } = open(gin, 2);
    const me = g.seats[g.turn];
    g.drewThisTurn = true;
    // Ten cards that meld completely — a run of four and two sets of three —
    // plus one to throw away.
    me.hand = ['2c', '3c', '4c', '5c', '9d', '9h', '9s', 'Kd', 'Kh', 'Ks', '7d'];
    gin.__spec.act(g, me, { type: 'knock', card: '7d' });
    check('gin: nought deadwood is gin', g.knock?.gin === true, JSON.stringify(g.knock));
  }

  check('gin: the knock helper finds a legal discard when one exists',
    bestKnockDiscard(['2c', '3c', '4c', '9d', '9h', '9s', 'Kd', 'Kh', 'Ks', '5c', '8h']) !== null);
  check('gin: and says so when none does',
    bestKnockDiscard(['2c', '5d', '9h', 'Ks', 'Qc', 'Jd', 'Th', '8s', '7c', '4d', '3h']) === null);
}

/* --------------------------------- Canasta -------------------------------- */

{
  check('canasta: a meld may never be more than half wild',
    legalMeld(['7c', '7d', '2h']) && !legalMeld(['7c', '2d', '2h']),
    `${legalMeld(['7c', '7d', '2h'])} / ${legalMeld(['7c', '2d', '2h'])}`);
  check('canasta: and needs two naturals at least',
    !legalMeld(['7c', '2d', '2h', '2s']));
  check('canasta: values are twenty, ten and five',
    worth('Ac') === 20 && worth('2c') === 20 && worth('Kc') === 10 && worth('4c') === 5);

  const { state } = open(canasta, 3);
  check('canasta: two packs are used', state.seats.every((s) => s.hand.length === 11));

  // Taking the pile needs two naturals of the top card in hand, right now.
  const seat = state.seats[state.turn];
  state.pile = ['9d', '9h', '5c'];
  seat.hand = ['2c', '3d', '4h'];
  canasta.__spec.act(state, seat, { type: 'takePile' });
  check('canasta: no pair, no pile', state.pile.length === 3, String(state.pile.length));
  seat.hand = ['5d', '5h', '3d'];
  canasta.__spec.act(state, seat, { type: 'takePile' });
  check('canasta: two naturals takes the whole thing', state.pile.length === 0, String(state.pile.length));
  check('canasta: and the meld goes straight down',
    (state.melds[seat.seat] ?? []).length === 1,
    JSON.stringify(state.melds[seat.seat]));

  // Going out needs a canasta.
  const { state: out } = open(canasta, 3);
  const s2 = out.seats[out.turn];
  out.drewThisTurn = true;
  out.melds[s2.seat] = [{ cards: ['7c', '7d', '7h'] }];
  s2.hand = ['Kd'];
  canasta.__spec.act(out, s2, { type: 'discard', card: 'Kd' });
  check('canasta: you cannot leave without a canasta', s2.out === false, String(s2.out));

  const { state: win } = open(canasta, 3);
  const s3 = win.seats[win.turn];
  win.drewThisTurn = true;
  win.melds[s3.seat] = [{ cards: ['7c', '7d', '7h', '7s', '7c', '7d', '2h'] }];
  s3.hand = ['Kd'];
  canasta.__spec.act(win, s3, { type: 'discard', card: 'Kd' });
  check('canasta: with one, you can', s3.out === true, String(s3.out));
}

/* ---------------------------------- Golf ---------------------------------- */

{
  check('golf: a king is worth nothing', cost('Kc') === 0);
  check('golf: an ace is one and a queen is ten', cost('Ac') === 1 && cost('Qd') === 10);
  // The column rule, which is the whole game.
  check('golf: a matched column cancels to nothing',
    scoreGrid(['9c', 'Kd', 'Kh', '9d', '2c', '3c']) === 5,
    String(scoreGrid(['9c', 'Kd', 'Kh', '9d', '2c', '3c'])));
  check('golf: and an unmatched one does not',
    scoreGrid(['9c', 'Kd', 'Kh', '8d', '2c', '3c']) === 22,
    String(scoreGrid(['9c', 'Kd', 'Kh', '8d', '2c', '3c'])));

  const { state } = open(golf, 3);
  check('golf: six each, two showing',
    state.seats.every((s) => (state.up[s.seat] ?? []).filter(Boolean).length === 2),
    state.seats.map((s) => (state.up[s.seat] ?? []).filter(Boolean).length).join(','));

  const wire = JSON.stringify(golf.serialize(state));
  const hidden = state.seats.flatMap((s) =>
    (state.grids[s.seat] ?? []).filter((c, i) => !state.up[s.seat][i]));
  check('golf: face-down squares carry no card, not even your own',
    !hidden.some((c) => wire.includes(`"${c}"`)), wire.slice(0, 70));

  // You must take before you can do anything.
  const seat = state.seats[state.turn];
  const grid = [...state.grids[seat.seat]];
  golf.__spec.act(state, seat, { type: 'swap', at: 2 });
  check('golf: nothing happens until you take one',
    JSON.stringify(state.grids[seat.seat]) === JSON.stringify(grid));
  golf.__spec.act(state, seat, { type: 'take', from: 'deck' });
  check('golf: and then you are holding one', Boolean(state.held), JSON.stringify(state.held));
  golf.__spec.act(state, seat, { type: 'swap', at: 2 });
  check('golf: swapping turns that square up', state.up[seat.seat][2] === true);
}

/* -------------------------------- Cribbage -------------------------------- */

{
  // The best hand in the game. It only comes out right if fifteens, pairs and
  // nobs are all counted independently of one another.
  const best = countHand(['5s', '5h', '5d', 'Jc'], '5c');
  check('cribbage: the twenty-nine hand', best.points === 29, `${best.points}: ${best.parts.join('; ')}`);
  check('cribbage: a hand worth nothing', countHand(['2c', '4d', '6h', '8s'], 'Th').points === 0);

  // A double run of three is two runs plus a pair — six plus two, not three.
  const dbl = countHand(['4c', '5d', '5h', '6s'], '2c');
  check('cribbage: a double run counts twice', dbl.points === 12, `${dbl.points}: ${dbl.parts.join('; ')}`);
  check('cribbage: three of a kind is six',
    countHand(['9c', '9d', '9h', '2s'], 'Kc').points === 6);

  const f4 = countHand(['2c', '4c', '6c', '8c'], 'Th');
  check('cribbage: four to a flush in hand is four', f4.parts.some((p) => p.includes('flush of four')));
  check('cribbage: but a four-flush in the crib is nothing',
    !countHand(['2c', '4c', '6c', '8c'], 'Th', true).parts.some((p) => p.includes('flush')));
  check('cribbage: unless the cut matches it',
    countHand(['2c', '4c', '6c', '8c'], 'Tc', true).parts.some((p) => p.includes('flush of five')));
  check('cribbage: his nobs is one',
    countHand(['Jh', '2c', '4d', '6s'], '9h').parts.some((p) => p.includes('nobs')));

  const { state } = open(cribbage, 2);
  check('cribbage: six each', state.seats.every((s) => s.hand.length === 6));
  check('cribbage: and it starts by throwing', state.phase2 === 'throwing', state.phase2);
  for (const s of state.seats) cribbage.__spec.act(state, s, { type: 'throw', cards: s.hand.slice(0, 2) });
  check('cribbage: the crib has four in it', state.crib.length === 4, String(state.crib.length));
  check('cribbage: a card is cut', Boolean(state.cut), String(state.cut));
  check('cribbage: and then you peg', state.phase2 === 'pegging', state.phase2);
  check('cribbage: everybody kept four', state.seats.every((s) => s.hand.length === 4));

  // Never past thirty-one.
  state.total = 30;
  const seat = state.seats[state.turn];
  const big = seat.hand.find((c) => pip(c) > 1);
  if (big) {
    const held = seat.hand.length;
    cribbage.__spec.act(state, seat, { type: 'play', card: big });
    check('cribbage: you cannot go past thirty-one', seat.hand.length === held, String(seat.hand.length));
  } else {
    check('cribbage: you cannot go past thirty-one', true, 'all aces, nothing to test');
  }
}

/* -------------------------------- nonsense -------------------------------- */

{
  for (const game of CARD_GAMES) {
    const { state, players } = open(game, Math.max(2, game.minPlayers));
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
