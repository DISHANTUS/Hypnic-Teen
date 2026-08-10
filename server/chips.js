// Chips — what you gamble with.
//
// Points and chips are deliberately not the same thing. Points are the record
// of what somebody has done: they set the level, they order the leaderboard,
// and two titles hang off them. A night at the tables must not be able to
// rewrite that. Somebody who has played for three weeks should not wake up on
// Level 4 because a wheel went the wrong way.
//
// So there is a second balance. You take points to the cage and come back with
// chips; the points you spent are gone from your spendable side but your rank,
// your level and your titles never move. And everybody gets a free handful
// every day, so nobody is ever locked out of the room because last night went
// badly — being unable to play at all is a worse outcome than losing.
//
// Nothing here has a house. Every table pays out what the players put in, so
// chips move between friends rather than draining into the building. That is
// what the owner asked for and it is also the only version of this worth
// running: a house edge on a friends' arcade is just a slow way of taking
// everybody's evening away from them.

import { JsonStore, registerStore } from './store.js';

const store = registerStore(
  new JsonStore('chips.json', {
    // hypnicId -> { balance, lastTopUp, lifetimeIn, lifetimeOut, biggestWin }
    wallets: {},
    // A short tail of what happened, newest first. Enough to answer "where did
    // my chips go" without keeping every spin for ever.
    ledger: [],
  })
);

/** What a new player starts with, so the first table is never a cage trip. */
export const OPENING_BALANCE = 500;

/** Free chips a day. Enough for a few hands, not enough to be the strategy. */
export const DAILY_TOP_UP = 200;

/** The most a daily top-up will lift you to. Above this you are fine already. */
export const TOP_UP_CEILING = 400;

/** Points buy chips at this rate. One for one is easy to reason about. */
export const CAGE_RATE = 1;

/** Nobody may sit down for less than this, or a table is all dust bets. */
export const MIN_BET = 5;

const KEEP_LEDGER = 400;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Somebody's wallet, made if they have never had one.
 *
 * @param {string} id a Hypnic ID
 */
function walletOf(id) {
  const wallets = store.data.wallets;
  if (!wallets[id]) {
    wallets[id] = {
      balance: OPENING_BALANCE,
      lastTopUp: today(),
      lifetimeIn: OPENING_BALANCE,
      lifetimeOut: 0,
      biggestWin: 0,
    };
    store.save();
  }
  return wallets[id];
}

function note(id, kind, amount, detail = null) {
  store.data.ledger.unshift({ id, kind, amount, detail, at: Date.now() });
  if (store.data.ledger.length > KEEP_LEDGER) store.data.ledger.length = KEEP_LEDGER;
}

/**
 * The free daily handful.
 *
 * Tops up *to* a floor rather than adding on top, so it helps somebody who is
 * broke and does nothing for somebody sitting on ten thousand. Otherwise the
 * winning strategy becomes logging in every day and never playing.
 *
 * `day` is an argument rather than read straight off the clock so that a test
 * can play a second day without waiting for one. Without it the only thing
 * this function's tests could prove is that claiming twice in a row does
 * nothing, which is the half that was never going to break.
 *
 * @param {string} id
 * @param {string} [day] YYYY-MM-DD
 * @returns {{ given: number, balance: number }}
 */
export function claimDaily(id, day = today()) {
  const wallet = walletOf(id);
  if (wallet.lastTopUp === day) return { given: 0, balance: wallet.balance };

  wallet.lastTopUp = day;
  const given = Math.max(0, Math.min(DAILY_TOP_UP, TOP_UP_CEILING - wallet.balance));
  if (given > 0) {
    wallet.balance += given;
    wallet.lifetimeIn += given;
    note(id, 'daily', given);
  }
  store.save();
  return { given, balance: wallet.balance };
}

/** What somebody has, with the daily applied if it is owed. */
export function walletFor(id) {
  if (!id) return null;
  claimDaily(id);
  const w = walletOf(id);
  return {
    balance: w.balance,
    lifetimeIn: w.lifetimeIn,
    lifetimeOut: w.lifetimeOut,
    biggestWin: w.biggestWin,
    dailyClaimed: w.lastTopUp === today(),
    nextDaily: w.lastTopUp === today() ? 'tomorrow' : 'now',
  };
}

export const balanceOf = (id) => (id ? walletOf(id).balance : 0);

/**
 * Takes chips off somebody, for a bet.
 *
 * Refuses rather than allowing a negative balance. A wallet that can go below
 * zero turns one bug in one table into everybody owing the room money.
 *
 * @returns {{ ok: true, balance: number }|{ error: string }}
 */
export function stake(id, amount, detail = null) {
  const n = Math.floor(Number(amount));
  if (!id) return { error: 'Sign in to play for chips.' };
  if (!Number.isFinite(n) || n <= 0) return { error: 'That is not a bet.' };
  if (n < MIN_BET) return { error: `The smallest bet is ${MIN_BET} chips.` };

  const wallet = walletOf(id);
  if (wallet.balance < n) return { error: `You only have ${wallet.balance} chips.` };

  wallet.balance -= n;
  wallet.lifetimeOut += n;
  note(id, 'bet', -n, detail);
  store.save();
  return { ok: true, balance: wallet.balance };
}

/** Hands chips back — a win, or a bet returned when a table is called off. */
export function award(id, amount, detail = null) {
  const n = Math.floor(Number(amount));
  if (!id || !Number.isFinite(n) || n <= 0) return { ok: true, balance: balanceOf(id) };

  const wallet = walletOf(id);
  wallet.balance += n;
  wallet.lifetimeIn += n;
  wallet.biggestWin = Math.max(wallet.biggestWin, n);
  note(id, 'win', n, detail);
  store.save();
  return { ok: true, balance: wallet.balance };
}

/**
 * The cage. Points in, chips out.
 *
 * One way on purpose. Chips going back to points would make the leaderboard a
 * record of who got lucky, which is the whole thing this split exists to
 * prevent — and it would let somebody launder a good night into a rank they
 * did not play for.
 *
 * @param {object} profile the account, which this mutates and the caller saves
 * @param {number} points how many points to spend
 */
export function buyChips(profile, points) {
  const n = Math.floor(Number(points));
  if (!profile) return { error: 'Sign in first.' };
  if (!Number.isFinite(n) || n <= 0) return { error: 'How many?' };

  // Spendable, not earned. `points` is the rank and the level, and it is not
  // what is being spent here — see `spent` below.
  const spendable = (profile.points ?? 0) - (profile.pointsSpent ?? 0);
  if (n > spendable) return { error: `You have ${Math.max(0, spendable)} points to spend.` };

  profile.pointsSpent = (profile.pointsSpent ?? 0) + n;
  const chips = n * CAGE_RATE;
  const wallet = walletOf(profile.id);
  wallet.balance += chips;
  wallet.lifetimeIn += chips;
  note(profile.id, 'cage', chips, `${n} points`);
  store.save();

  return { ok: true, chips, balance: wallet.balance, spendable: spendable - n };
}

/** Points somebody may still take to the cage. */
export const spendablePoints = (profile) =>
  Math.max(0, (profile?.points ?? 0) - (profile?.pointsSpent ?? 0));

/** Somebody's own recent chip history. */
export function historyFor(id, limit = 12) {
  return store.data.ledger.filter((e) => e.id === id).slice(0, limit);
}

/** Who is holding the most chips. Its own board — this is not the leaderboard. */
export function chipBoard(limit = 10) {
  return Object.entries(store.data.wallets)
    .map(([id, w]) => ({ id, balance: w.balance, biggestWin: w.biggestWin }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit);
}

/**
 * Splits a pot among winners in proportion to what each of them is owed.
 *
 * Every table on the floor pays out this way: the chips in the middle are
 * exactly the chips the players put in, shared out by whatever the game says
 * each winning bet was worth. There is no house taking a cut, so what is paid
 * out is what was staked, to the chip.
 *
 * Rounding is the fiddly part. Dividing a pot three ways leaves a remainder,
 * and quietly dropping it means the table slowly eats the room's chips. The
 * odd chips go to the largest claims first, so the pot always balances.
 *
 * @param {number} pot     total chips in the middle
 * @param {{id:string, weight:number}[]} claims  winners and their share weight
 * @returns {{id:string, chips:number}[]}
 */
export function splitPot(pot, claims) {
  const total = claims.reduce((sum, c) => sum + Math.max(0, c.weight), 0);
  if (pot <= 0 || total <= 0 || !claims.length) return [];

  const shares = claims.map((c) => {
    const exact = (pot * Math.max(0, c.weight)) / total;
    return { id: c.id, chips: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });

  // Whatever the flooring left behind, handed out one chip at a time to
  // whoever was closest to another whole one.
  let left = pot - shares.reduce((sum, s) => sum + s.chips, 0);
  const byFraction = [...shares].sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; left > 0 && i < byFraction.length; i++, left--) byFraction[i].chips += 1;
  // A pot bigger than the number of claimants can still have chips over.
  for (let i = 0; left > 0; i = (i + 1) % byFraction.length, left--) byFraction[i].chips += 1;

  return shares.map(({ id, chips }) => ({ id, chips }));
}
