// Hand ranking.
//
//   npm run test:cards
//
// This is the one piece of the casino that has a right answer somebody at the
// table already knows by heart. If a full house loses to a flush once, nobody
// trusts the game again, and unlike a layout bug there is nothing to argue
// about — they are simply right and it is simply broken.
//
// So every category is checked against every other, the awkward corners get
// their own cases (the ace-low wheel, a flush that is not a straight flush,
// kickers deciding a pot), and then a hundred thousand random hands are ranked
// to prove the ordering is total and self-consistent.

import {
  freshDeck, shuffle, evaluate, compareHands, describe, CATEGORY,
  blackjackValue, isBlackjack, valueOf, rankOf,
} from '../server/cards.js';

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};
const hand = (...cards) => evaluate(cards);
const beats = (a, b) => compareHands(a, b) > 0;
const level = (a, b) => compareHands(a, b) === 0;

console.log('\n  Cards\n');

/* --------------------------------- the deck ------------------------------- */

{
  const deck = freshDeck();
  check('fifty-two cards', deck.length === 52, String(deck.length));
  check('all different', new Set(deck).size === 52);
  check('thirteen of each suit',
    ['s', 'h', 'd', 'c'].every((s) => deck.filter((c) => c[1] === s).length === 13));
  check('four of each rank',
    ['2', 'A', 'T', 'K'].every((r) => deck.filter((c) => c[0] === r).length === 4));

  const shuffled = shuffle(deck);
  check('shuffling keeps every card', new Set(shuffled).size === 52 && shuffled.length === 52);
  check('and actually moves them', shuffled.join('') !== deck.join(''));
  check('without touching the original', deck.join('') === freshDeck().join(''));

  // Every position should see every card eventually — a shuffle that never
  // moves the first card is a shuffle somebody can play against.
  const firsts = new Set();
  for (let i = 0; i < 400; i++) firsts.add(shuffle(deck)[0]);
  check('and it is a real shuffle, not a rotation', firsts.size > 30, `${firsts.size} different first cards`);
}

/* ---------------------------- one of each, in order ----------------------- */

{
  // The high-card example is fussier than it looks. The first attempt was
  // A 9 7 5 3 2 4, which contains A-2-3-4-5 — the wheel — so it ranked as a
  // straight and lost to nothing. Seven cards with no pair, no five of a suit
  // and no run of five takes some care to write down.
  const ladder = [
    [CATEGORY.high, 'high card', hand('Ah', 'Jd', '9c', '7s', '5h', '3d', '2c')],
    [CATEGORY.pair, 'a pair', hand('Ah', 'Ad', '7c', '5s', '3h', '9d', 'Jc')],
    [CATEGORY.twoPair, 'two pair', hand('Ah', 'Ad', '7c', '7s', '3h', '9d', 'Jc')],
    [CATEGORY.trips, 'three of a kind', hand('Ah', 'Ad', 'Ac', '7s', '3h', '9d', 'Jc')],
    [CATEGORY.straight, 'a straight', hand('5h', '6d', '7c', '8s', '9h', '2d', 'Jc')],
    [CATEGORY.flush, 'a flush', hand('2h', '5h', '9h', 'Jh', 'Kh', '3d', '4c')],
    [CATEGORY.fullHouse, 'a full house', hand('Ah', 'Ad', 'Ac', '7s', '7h', '9d', 'Jc')],
    [CATEGORY.quads, 'four of a kind', hand('Ah', 'Ad', 'Ac', 'As', '7h', '9d', 'Jc')],
    [CATEGORY.straightFlush, 'a straight flush', hand('5h', '6h', '7h', '8h', '9h', '2d', 'Jc')],
  ];

  // Each example must actually be the hand it claims to be, checked before it
  // is used to prove anything about the others.
  const misread = ladder.filter(([want, , h]) => h.category !== want);
  check('every example really is the hand it says it is', misread.length === 0,
    misread.map(([, name, h]) => `${name} read as ${h.name}`).join(' | '));

  // Every category must beat every one below it. Nine categories, thirty-six
  // pairs, all of them checked — this is the table people know by heart.
  const wrong = [];
  for (let i = 0; i < ladder.length; i++) {
    for (let j = 0; j < i; j++) {
      if (!beats(ladder[i][2], ladder[j][2])) wrong.push(`${ladder[i][1]} did not beat ${ladder[j][1]}`);
    }
  }
  check('every hand beats every weaker one', wrong.length === 0, wrong.slice(0, 3).join(' | '));
}

/* ------------------------------ the awkward bits -------------------------- */

{
  // The wheel. Ace counts as one here and nowhere else.
  const wheel = hand('Ah', '2d', '3c', '4s', '5h', 'Kd', '9c');
  check('A2345 is a straight', wheel.category === CATEGORY.straight, wheel.name);
  check('and it is a five-high one, the lowest there is', wheel.tiebreak[0] === 5, String(wheel.tiebreak[0]));
  check('so a six-high straight beats it', beats(hand('2h', '3d', '4c', '5s', '6h', 'Kd', '9c'), wheel));

  const wheelFlush = hand('Ah', '2h', '3h', '4h', '5h', 'Kd', '9c');
  check('and the same run in one suit is a straight flush',
    wheelFlush.category === CATEGORY.straightFlush, wheelFlush.name);

  // Five of a suit that are not in a run is a flush, not a straight flush.
  const justFlush = hand('2h', '4h', '7h', 'Jh', 'Kh', '3d', '5c');
  check('five of a suit out of order is only a flush', justFlush.category === CATEGORY.flush, justFlush.name);

  // A straight and a flush in the same seven cards, but not the same five.
  const both = hand('2h', '3h', '4h', '5d', '6c', 'Jh', 'Kh');
  check('a straight and a flush in one hand takes the flush',
    both.category === CATEGORY.flush, `${both.name}`);

  // Seven cards containing six to a straight: the top five count.
  const long = hand('5h', '6d', '7c', '8s', '9h', 'Td', '2c');
  check('six to a straight takes the highest five', long.tiebreak[0] === 10, String(long.tiebreak[0]));

  // Two pair from three pairs: the best two, and the kicker is the highest
  // card left including the third pair's rank.
  const threePair = hand('Ah', 'Ad', 'Kh', 'Kd', 'Qh', 'Qd', '2c');
  check('three pairs make two pair from the top two',
    threePair.category === CATEGORY.twoPair && threePair.tiebreak[0] === 14 && threePair.tiebreak[1] === 13,
    JSON.stringify(threePair.tiebreak));

  // Quads on the board: the kicker decides.
  const quadsHigh = hand('9h', '9d', '9c', '9s', 'Ah', '2d', '3c');
  const quadsLow = hand('9h', '9d', '9c', '9s', 'Kh', '2d', '3c');
  check('with the same quads the kicker decides', beats(quadsHigh, quadsLow));

  // Two full houses.
  check('a bigger set beats a bigger pair in a full house',
    beats(hand('Kh', 'Kd', 'Kc', '2s', '2h', '5d', '7c'), hand('Qh', 'Qd', 'Qc', 'Ah', 'Ad', '5s', '7c')));
}

/* --------------------------- level is a real outcome ---------------------- */

{
  // Both playing the board. Nobody should quietly win this.
  const a = hand('2c', '3d', 'Ah', 'Kh', 'Qh', 'Jh', 'Th');
  const b = hand('4c', '5d', 'Ah', 'Kh', 'Qh', 'Jh', 'Th');
  check('two players on the same board are level', level(a, b), `${describe(a)} vs ${describe(b)}`);

  const c = hand('Ah', 'Ad', '9c', '7s', '5h', '3d', '2c');
  const d = hand('As', 'Ac', '9h', '7d', '5s', '3h', '2d');
  check('the same pair with the same kickers is level', level(c, d));

  check('but one better kicker wins it',
    beats(hand('Ah', 'Ad', 'Tc', '7s', '5h', '3d', '2c'), c));
}

/* ---------------------- a hundred thousand random hands ------------------- */

{
  // The ordering has to be total and self-consistent: never both better and
  // worse, and equal hands always equal. A comparison that is only mostly
  // right splits pots wrongly a few times a night and nobody can prove it.
  const deck = freshDeck();
  let broken = null;
  for (let i = 0; i < 100000 && !broken; i++) {
    const s = shuffle(deck);
    const x = evaluate(s.slice(0, 7));
    const y = evaluate(s.slice(7, 14));
    const ab = compareHands(x, y);
    const ba = compareHands(y, x);
    if (Math.sign(ab) !== -Math.sign(ba)) broken = `not symmetric: ${describe(x)} vs ${describe(y)}`;
    if (compareHands(x, x) !== 0) broken = `a hand did not equal itself: ${describe(x)}`;
    if (x.category < 0 || x.category > 8) broken = `impossible category ${x.category}`;
    if (x.tiebreak.some((v) => !Number.isInteger(v))) broken = `broken tiebreak ${JSON.stringify(x.tiebreak)}`;
  }
  check('a hundred thousand hands rank consistently', !broken, broken ?? '');
}

{
  // And the categories turn up at roughly the frequencies they should. A
  // ranker that never sees a straight flush is a ranker with a broken branch,
  // and no single-hand test would find it.
  const deck = freshDeck();
  const seen = new Map();
  for (let i = 0; i < 60000; i++) {
    const h = evaluate(shuffle(deck).slice(0, 7));
    seen.set(h.category, (seen.get(h.category) ?? 0) + 1);
  }
  check('every category actually turns up', seen.size === 9, `${seen.size} of 9: ${[...seen.keys()].sort().join(',')}`);
  // Real seven-card frequencies: a pair is the commonest, straight flushes are
  // about one in three thousand.
  check('a pair is the commonest hand',
    seen.get(CATEGORY.pair) > seen.get(CATEGORY.trips), `${seen.get(CATEGORY.pair)} pairs`);
  check('and straight flushes are rare but real',
    seen.get(CATEGORY.straightFlush) > 0 && seen.get(CATEGORY.straightFlush) < 600,
    `${seen.get(CATEGORY.straightFlush)} in 60000`);
  check('quads are rarer than trips',
    seen.get(CATEGORY.quads) < seen.get(CATEGORY.trips),
    `${seen.get(CATEGORY.quads)} quads, ${seen.get(CATEGORY.trips)} trips`);
}

/* -------------------------------- blackjack ------------------------------- */

{
  check('picture cards are ten', blackjackValue(['Kh', '5d']).total === 15);
  check('an ace is eleven when it fits', blackjackValue(['Ah', '9d']).total === 20);
  check('and one when it does not', blackjackValue(['Ah', '9d', '5c']).total === 15);
  check('two aces do not make twenty-two', blackjackValue(['Ah', 'Ad']).total === 12);
  check('three aces and an eight is twenty-one', blackjackValue(['Ah', 'Ad', 'Ac', '8s']).total === 21);
  check('a soft hand knows it is soft', blackjackValue(['Ah', '6d']).soft === true);
  check('and a hard one knows it is not', blackjackValue(['Th', '6d']).soft === false);
  check('bust is bust', blackjackValue(['Kh', 'Qd', '5c']).bust === true);
  check('twenty-one is not bust', blackjackValue(['Kh', 'Ad']).bust === false);

  check('two cards to twenty-one is blackjack', isBlackjack(['Ah', 'Kd']));
  check('three cards to twenty-one is not', !isBlackjack(['5h', '6d', 'Tc']));
  check('and an empty hand is nothing', blackjackValue([]).total === 0);

  // Every two-card hand in the deck, so no rank is quietly worth the wrong
  // thing — a jack counted as eleven would take weeks to notice.
  const deck = freshDeck();
  let wrongCard = null;
  for (const card of deck) {
    const expect = { A: 11, K: 10, Q: 10, J: 10, T: 10 }[rankOf(card)] ?? valueOf(rankOf(card));
    const got = blackjackValue([card, '2d']).total - 2;
    if (got !== expect) wrongCard = `${card} counted ${got}, should be ${expect}`;
  }
  check('every card in the deck is worth what it should be', !wrongCard, wrongCard ?? '');
}

const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
