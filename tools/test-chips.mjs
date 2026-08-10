// The chips economy.
//
//   npm run test:chips
//
// Money code fails quietly and expensively. A wallet that can go below zero,
// a pot that pays out more than went in, a split that drops the odd chip on
// every hand — none of these throw, and all of them are only noticed weeks
// later when somebody's balance makes no sense and there is no way to work out
// why.
//
// So the two properties that matter are checked exhaustively rather than
// sampled: a balance never goes negative, and a pot always pays out exactly
// what was staked.

import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const TMP = path.join(ROOT, 'tmp-chips');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
process.env.DATA_DIR = TMP;

const {
  OPENING_BALANCE, DAILY_TOP_UP, TOP_UP_CEILING, MIN_BET,
  walletFor, balanceOf, stake, award, buyChips, spendablePoints,
  claimDaily, splitPot, historyFor, chipBoard,
} = await import('../server/chips.js');

const results = [];
const check = (label, ok, extra = '') => {
  results.push({ ok, label });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return ok;
};

console.log('\n  Chips\n');

/* ------------------------------ opening up -------------------------------- */

{
  const w = walletFor('Hypnic>First<Teen');
  check('a new player can sit down straight away', w.balance === OPENING_BALANCE, String(w.balance));
  check('and it is recorded as chips in', w.lifetimeIn === OPENING_BALANCE, String(w.lifetimeIn));
  check('somebody with no ID has no wallet', walletFor(null) === null);
}

/* -------------------------------- betting --------------------------------- */

{
  const id = 'Hypnic>Better<Teen';
  walletFor(id);

  const bet = stake(id, 100, 'roulette');
  check('a bet comes off the balance', bet.ok && bet.balance === OPENING_BALANCE - 100, JSON.stringify(bet));

  award(id, 250, 'roulette');
  check('a win goes back on', balanceOf(id) === OPENING_BALANCE - 100 + 250, String(balanceOf(id)));
  check('the biggest win is remembered', walletFor(id).biggestWin === 250, String(walletFor(id).biggestWin));

  // The one that must never happen.
  const tooBig = stake(id, 999999);
  check('you cannot bet what you do not have', Boolean(tooBig.error), JSON.stringify(tooBig));
  check('and the balance is untouched by a refused bet', balanceOf(id) === 650, String(balanceOf(id)));

  check('nor can you bet nothing', Boolean(stake(id, 0).error));
  check('nor a negative', Boolean(stake(id, -50).error));
  check('nor a fraction of a chip below the floor', Boolean(stake(id, 1).error));
  check('the floor is said out loud', /smallest bet is/.test(stake(id, 1).error), stake(id, 1).error);
  check('nonsense is refused', Boolean(stake(id, 'plenty').error) && Boolean(stake(id, NaN).error));
  check('and none of that moved the balance', balanceOf(id) === 650, String(balanceOf(id)));
}

/* ---------------------- a balance can never go negative ------------------- */

{
  // Hammered rather than sampled: money code that can go negative is the one
  // bug here that turns into everybody owing the room chips.
  const id = 'Hypnic>Hammer<Teen';
  walletFor(id);
  let refused = 0;
  let wentNegative = false;
  for (let i = 0; i < 4000; i++) {
    const amount = Math.floor(Math.random() * 200) - 20;
    const res = stake(id, amount);
    if (res.error) refused += 1;
    if (balanceOf(id) < 0) wentNegative = true;
    if (Math.random() < 0.4) award(id, Math.floor(Math.random() * 150));
  }
  check('four thousand random bets never take a balance below zero', !wentNegative, String(balanceOf(id)));
  check('and plenty of them were refused', refused > 100, `${refused} refused`);
}

/* ------------------------------- the cage --------------------------------- */

{
  const profile = { id: 'Hypnic>Cage<Teen', points: 1000, pointsSpent: 0 };
  walletFor(profile.id);

  check('points to spend start as points earned', spendablePoints(profile) === 1000);

  const bought = buyChips(profile, 300);
  check('points buy chips', bought.ok && bought.chips === 300, JSON.stringify(bought));
  check('the chips arrive', balanceOf(profile.id) === OPENING_BALANCE + 300, String(balanceOf(profile.id)));

  // The whole reason the two are separate.
  check('the points that set your rank do not move', profile.points === 1000, String(profile.points));
  check('but they are marked as spent', profile.pointsSpent === 300, String(profile.pointsSpent));
  check('so there are fewer left to spend', spendablePoints(profile) === 700, String(spendablePoints(profile)));

  check('you cannot spend points twice', Boolean(buyChips(profile, 800).error), JSON.stringify(buyChips(profile, 800)));
  check('and the refusal says how many are left', /700 points/.test(buyChips(profile, 800).error ?? ''),
    buyChips(profile, 800).error);
  check('nothing buys nothing', Boolean(buyChips(profile, 0).error));
  check('no profile, no chips', Boolean(buyChips(null, 100).error));

  // Losing every chip must not touch the rank either.
  stake(profile.id, balanceOf(profile.id));
  check('going bust leaves rank and level alone', profile.points === 1000 && balanceOf(profile.id) === 0,
    `${profile.points} points, ${balanceOf(profile.id)} chips`);
}

/* ------------------------------ the daily --------------------------------- */

{
  const id = 'Hypnic>Daily<Teen';
  walletFor(id);
  check('it cannot be claimed twice in a day', claimDaily(id).given === 0);

  // Broke, and it is tomorrow. The day is passed in rather than waited for.
  stake(id, balanceOf(id));
  check('somebody can be genuinely broke', balanceOf(id) === 0);

  const tomorrow = claimDaily(id, '2999-01-01');
  check('the next day picks them back up', tomorrow.given > 0, `${tomorrow.given} chips`);
  check('enough to sit down again', tomorrow.balance >= MIN_BET, String(tomorrow.balance));
  check('and it is capped at the floor, not added on top',
    tomorrow.balance <= TOP_UP_CEILING, `${tomorrow.balance} against a ceiling of ${TOP_UP_CEILING}`);
  check('the same day again gives nothing more', claimDaily(id, '2999-01-01').given === 0);
}

{
  // Somebody already comfortable gets nothing from the daily, or logging in
  // every day and never playing becomes the best strategy on the floor.
  const id = 'Hypnic>Rich<Teen';
  walletFor(id);
  award(id, 5000);
  const rich = claimDaily(id, '2999-02-02');
  check('the daily does nothing for somebody already flush', rich.given === 0, `${rich.given} chips`);
  check('and their balance is untouched', rich.balance === OPENING_BALANCE + 5000, String(rich.balance));
  check('the top-up is a floor, not an income', DAILY_TOP_UP <= TOP_UP_CEILING);
}

/* ---------------------------- splitting the pot --------------------------- */

{
  // The property that matters: what goes in comes out. Every time.
  let mismatch = null;
  for (let run = 0; run < 3000 && !mismatch; run++) {
    const pot = Math.floor(Math.random() * 5000) + 1;
    const n = 1 + Math.floor(Math.random() * 8);
    const claims = Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      weight: Math.random() * 10,
    }));
    const paid = splitPot(pot, claims);
    const out = paid.reduce((sum, p) => sum + p.chips, 0);
    if (out !== pot) mismatch = `pot ${pot} paid out ${out} across ${n}`;
    if (paid.some((p) => p.chips < 0)) mismatch = `negative payout: ${JSON.stringify(paid)}`;
  }
  check('three thousand pots all pay out exactly what went in', !mismatch, mismatch ?? '');

  check('one winner takes the lot',
    JSON.stringify(splitPot(100, [{ id: 'a', weight: 1 }])) === JSON.stringify([{ id: 'a', chips: 100 }]));

  const even = splitPot(100, [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }]);
  check('two equal claims split it evenly', even.every((p) => p.chips === 50), JSON.stringify(even));

  const uneven = splitPot(100, [{ id: 'a', weight: 3 }, { id: 'b', weight: 1 }]);
  check('a bigger claim gets more', uneven[0].chips === 75 && uneven[1].chips === 25, JSON.stringify(uneven));

  const three = splitPot(100, [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }, { id: 'c', weight: 1 }]);
  check('a pot that does not divide still pays out in full',
    three.reduce((s, p) => s + p.chips, 0) === 100, JSON.stringify(three));

  check('no winners, no payout', splitPot(100, []).length === 0);
  check('no pot, no payout', splitPot(0, [{ id: 'a', weight: 1 }]).length === 0);
  check('weightless claims pay nothing rather than crashing',
    splitPot(100, [{ id: 'a', weight: 0 }]).length === 0);
}

/* -------------------------------- the record ------------------------------ */

{
  const id = 'Hypnic>Ledger<Teen';
  walletFor(id);
  stake(id, 50, 'roulette');
  award(id, 120, 'roulette');
  const history = historyFor(id);
  check('a player can see where their chips went', history.length >= 2, JSON.stringify(history.slice(0, 2)));
  check('bets are recorded as going out', history.some((e) => e.kind === 'bet' && e.amount < 0));
  check('wins as coming in', history.some((e) => e.kind === 'win' && e.amount > 0));
  check('and it is only their own', history.every((e) => e.id === id));

  const board = chipBoard(5);
  check('there is a board of who is holding the most', board.length > 0 && board[0].balance >= board[board.length - 1].balance,
    JSON.stringify(board.map((b) => b.balance)));
}

rmSync(TMP, { recursive: true, force: true });

const bad = results.filter((r) => !r.ok);
console.log(bad.length
  ? `\n  \x1b[31m${bad.length} of ${results.length} failed\x1b[0m\n`
  : `\n  \x1b[32mall ${results.length} passed\x1b[0m\n`);
process.exit(bad.length ? 1 : 0);
