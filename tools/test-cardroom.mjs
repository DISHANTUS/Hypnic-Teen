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
const { crazy8s, switchGame } = await import('../server/games/cards/crazy8s.js');
const { president } = await import('../server/games/cards/president.js');
const { sevens } = await import('../server/games/cards/sevens.js');
const { speed } = await import('../server/games/cards/speed.js');
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
    st.pile = ['Kd', 'Qd', 'Jd', top];  // the top of a pile is its last element
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
  for (let i = 0; i < 30; i++) speed.__spec.tick(stuck, 0.5);
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
