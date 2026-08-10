// Accounts for the Hypnic Teen studio: signup via the quiz, login by ID + PIN,
// and everything that persists between sessions (points, stats, titles).

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

import { JsonStore, registerStore } from './store.js';
import { deriveIdentity, normaliseId, keywordOf } from './identity.js';
import { evaluateTitles } from './titles.js';

const SESSION_DAYS = 60;
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MS = 5 * 60 * 1000;

// Where the JSON store stops being the right tool — see the warning in signup().
const SCALE_WARN_AT = 25_000;

// Leaderboards sort every profile, so a busy studio would re-sort the whole
// membership on every page view. Cache briefly and drop it when scores change.
const boardCache = new Map();
const BOARD_TTL_MS = 5_000;
const invalidateBoards = () => boardCache.clear();

const users = registerStore(new JsonStore('users.json', { users: {}, order: [] }));
const secrets = registerStore(new JsonStore('secret.json', {}));

if (!secrets.data.tokenSecret) {
  secrets.data.tokenSecret = randomBytes(32).toString('hex');
  secrets.flush();
}
const TOKEN_SECRET = secrets.data.tokenSecret;

/** @type {Map<string, {count:number, until:number}>} */
const failedLogins = new Map();

/* ------------------------------ credentials ----------------------------- */

function hashPin(pin, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(String(pin), salt, 64).toString('hex') };
}

function pinMatches(pin, profile) {
  const attempt = Buffer.from(scryptSync(String(pin), profile.pinSalt, 64).toString('hex'));
  const stored = Buffer.from(profile.pinHash);
  return attempt.length === stored.length && timingSafeEqual(attempt, stored);
}

const sign = (data) => createHmac('sha256', TOKEN_SECRET).update(data).digest('base64url');

export function issueToken(id) {
  const expires = Date.now() + SESSION_DAYS * 864e5;
  const payload = Buffer.from(JSON.stringify({ id, expires })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** @returns {string|null} the account id, or null if the token is bad/expired */
export function verifyToken(token) {
  const [payload, sig] = String(token ?? '').split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { id, expires } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!id || Date.now() > expires) return null;
    return users.data.users[id] ? id : null;
  } catch {
    return null;
  }
}

/* -------------------------------- signup -------------------------------- */

// Uniqueness index. Scanning every profile per candidate was O(users) on every
// signup — fine for a class, quadratic for a studio. This is O(1) and rebuilt
// once at boot.
const takenKeywords = new Set(
  Object.values(users.data.users).map((u) => String(u.keyword).toLowerCase())
);
const keywordTaken = (keyword) => takenKeywords.has(String(keyword).toLowerCase());

// One person can only meaningfully "have played with" so many others; without a
// cap this array grows forever on a busy server.
const MAX_PLAYED_WITH = 500;

export function signup({ name, age, pin, answers, recovery }) {
  const cleanName = String(name ?? '').trim().slice(0, 16);
  if (cleanName.length < 2) return { error: 'Name needs at least 2 characters.' };

  const cleanAge = Number(age);
  if (!Number.isFinite(cleanAge) || cleanAge < 8 || cleanAge > 99) {
    return { error: 'Enter an age between 8 and 99.' };
  }

  if (!/^\d{4}$/.test(String(pin ?? ''))) return { error: 'Your PIN must be exactly 4 digits.' };
  if (!answers || typeof answers !== 'object') return { error: 'Answer the questions first.' };

  const identity = deriveIdentity({ name: cleanName, age: cleanAge, answers }, keywordTaken);
  const { salt, hash } = hashPin(pin);

  const profile = {
    id: identity.id,
    keyword: identity.keyword,
    name: cleanName,
    age: cleanAge,
    accent: identity.accent,
    spirit: identity.spirit,
    traits: identity.traits,
    answers,
    pinSalt: salt,
    pinHash: hash,
    points: 0,
    gamesPlayed: 0,
    wins: 0,
    streak: 0,
    bestStreak: 0,
    hosted: 0,
    finished: 0,
    stats: {},
    titles: [],
    playedWith: [],
    activeDays: [],
    memberNumber: users.data.order.length + 1,
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };

  users.data.users[profile.id] = profile;
  users.data.order.push(profile.id);
  takenKeywords.add(identity.keyword.toLowerCase());
  invalidateBoards();
  users.flush(); // signup is rare and important - write it immediately

  if (users.data.order.length === SCALE_WARN_AT) {
    console.warn(
      `\n  [scale] ${SCALE_WARN_AT} members. The JSON store keeps every profile in memory and\n` +
        `  rewrites the file on save — fine to roughly this size, not beyond.\n` +
        `  Move server/store.js onto a real database before growing much further.\n`
    );
  }

  return { profile: publicProfile(profile), token: issueToken(profile.id) };
}

/* --------------------------------- login -------------------------------- */

export function login({ id, pin }) {
  const key = normaliseId(id);
  if (!key) return { error: 'Enter your Hypnic ID.' };

  const lock = failedLogins.get(key);
  if (lock && lock.until > Date.now()) {
    const mins = Math.ceil((lock.until - Date.now()) / 60000);
    return { error: `Too many wrong PINs. Try again in ${mins} minute(s).` };
  }

  const profile = users.data.users[key];
  // Same message either way so nobody can fish for valid IDs.
  if (!profile || !pinMatches(pin, profile)) {
    const entry = failedLogins.get(key) ?? { count: 0, until: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILED_LOGINS) {
      entry.until = Date.now() + LOCKOUT_MS;
      entry.count = 0;
    }
    failedLogins.set(key, entry);
    return { error: 'That ID and PIN do not match.' };
  }

  failedLogins.delete(key);
  touch(profile);
  return { profile: publicProfile(profile), token: issueToken(profile.id) };
}

/* ------------------------------- recovery -------------------------------- */

// A Hypnic ID is deliberately strange, which is what makes it fun and also
// what makes it forgettable. Nobody should lose their titles and their points
// because they closed a tab, so there is a way back in — but it has to be a
// way back in for *them*, not for anyone who knows their first name.
//
// The check is: your name, your PIN, and one thing only you would have set.
// Name alone is not enough (two people share one), PIN alone is not enough
// (ten thousand possibilities and plenty of 1234s), but the three together are.

const MAX_RECOVERY_TRIES = 5;
const recoveryLocks = new Map(); // name -> { count, until }

/** Everything a returning player might be asked to prove. */
export function recoveryHints(name) {
  const matches = accountsNamed(name);
  if (!matches.length) return { error: 'No member by that name.' };
  // Which question they set, but never the answer. If they never set one, say
  // so plainly rather than pretending — they can still get in with the PIN and
  // their joining month.
  return {
    ok: true,
    count: matches.length,
    question: matches.find((p) => p.recovery?.question)?.recovery?.question ?? null,
  };
}

const accountsNamed = (name) => {
  const wanted = String(name ?? '').trim().toLowerCase();
  if (wanted.length < 2) return [];
  return Object.values(users.data.users).filter((p) => p.name.toLowerCase() === wanted);
};

/**
 * Hands back the ID — never the account. Whoever asks still has to log in with
 * it, so the worst a successful guess achieves is learning an ID that the
 * person's friends could read off a lobby screen anyway.
 *
 * @param {object} claim
 * @param {string} claim.name    what they call themselves
 * @param {string} claim.pin     the four digits they chose
 * @param {string} [claim.answer] their answer to the recovery question
 */
export function recoverId({ name, pin, answer }) {
  const key = String(name ?? '').trim().toLowerCase();
  const lock = recoveryLocks.get(key);
  if (lock && lock.until > Date.now()) {
    const mins = Math.ceil((lock.until - Date.now()) / 60000);
    return { error: `Too many tries. Wait ${mins} minute(s).` };
  }

  const matches = accountsNamed(name).filter((p) => pinMatches(pin, p));

  // Where a recovery answer exists it must match; where none was ever set, the
  // name and PIN carry it. Refusing those accounts outright would lock out
  // everybody who joined before recovery existed.
  const said = String(answer ?? '').trim().toLowerCase();
  const found = matches.filter((p) => {
    if (!p.recovery?.answer) return true;
    return p.recovery.answer === said;
  });

  if (found.length !== 1) {
    const entry = recoveryLocks.get(key) ?? { count: 0, until: 0 };
    entry.count += 1;
    if (entry.count >= MAX_RECOVERY_TRIES) {
      entry.until = Date.now() + LOCKOUT_MS;
      entry.count = 0;
    }
    recoveryLocks.set(key, entry);
    // Two people with the same name, PIN and answer is vanishingly unlikely,
    // but saying "there are two of you" would be a worse answer than this.
    return { error: found.length > 1 ? 'More than one account matches. Try your recovery answer.' : 'That does not match any member.' };
  }

  recoveryLocks.delete(key);
  const profile = found[0];
  return {
    ok: true,
    id: profile.id,
    keyword: keywordOf(profile.id),
    memberSince: new Date(profile.createdAt).toISOString().slice(0, 10),
  };
}

/**
 * Sets, or replaces, the thing a member will be asked for if they lose their
 * ID. Stored lower-cased and trimmed because nobody types their own answer the
 * same way twice, and it is not a password — it only ever unlocks an ID.
 */
export function setRecovery(accountId, { question, answer }) {
  const profile = users.data.users[accountId];
  if (!profile) return { error: 'No such member.' };
  const q = String(question ?? '').trim().slice(0, 80);
  const a = String(answer ?? '').trim().slice(0, 60);
  if (q.length < 4) return { error: 'Pick a question.' };
  if (a.length < 2) return { error: 'That answer is too short to be useful.' };
  profile.recovery = { question: q, answer: a.toLowerCase(), setAt: Date.now() };
  users.save();
  return { ok: true };
}

/** Whether this member has a way back in, so the site can nag them once. */
export const hasRecovery = (accountId) => Boolean(users.data.users[accountId]?.recovery?.answer);

export function getProfile(id) {
  return users.data.users[id] ?? null;
}

/**
 * Writes the account store out.
 *
 * getProfile hands back the live object, so anything that changes a profile
 * from outside this file — the cage marking points as spent, for one — has to
 * say so or the change is lost at the next restart.
 */
export function saveAccounts() {
  users.save();
}

function touch(profile) {
  profile.lastSeen = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  if (!profile.activeDays.includes(today)) profile.activeDays.push(today);
  users.save();
}

export function level(points) {
  return Math.floor(Math.sqrt(points / 25)) + 1;
}

/** Everything safe to send to a browser - never the PIN material. */
export function publicProfile(profile) {
  if (!profile) return null;
  const { pinHash, pinSalt, answers, recovery, ...rest } = profile;
  return {
    ...rest,
    keyword: keywordOf(profile.id),
    level: level(profile.points),
    titleCount: profile.titles.length,
    // The question, so the profile can say what it is and whether it is set.
    // Never the answer — that is the whole point of it.
    recovery: recovery?.question ? { question: recovery.question } : null,
  };
}

/** Trimmed view for other players in a lobby. */
export function cardFor(id) {
  const p = users.data.users[id];
  if (!p) return null;
  const top = p.titles[p.titles.length - 1];
  return {
    id: p.id,
    name: p.name,
    accent: p.accent,
    spirit: p.spirit,
    level: level(p.points),
    points: p.points,
    title: top ? { name: top.name, emoji: top.emoji } : null,
  };
}

/* ---------------------------- match recording --------------------------- */

/**
 * Fold one finished match into every participant's profile.
 * @param {{gameId:string, hostId:string, totalGames:number,
 *          results:{playerId:string,name:string,score:number,place:number}[]}} match
 * @returns {Record<string, {pointsEarned:number, newTitles:object[], profile:object}>}
 */
export function recordMatch({ gameId, hostId, results, totalGames = 1 }) {
  const at = new Date();
  const participants = results.map((r) => r.playerId).filter((id) => users.data.users[id]);
  const runnerUpScore = results.length > 1 ? results[1].score : 0;
  const summary = {};

  for (const result of results) {
    const profile = users.data.users[result.playerId];
    if (!profile) continue; // guest or stale id

    const won = result.place === 1 && results.length > 1;
    const score = Math.max(0, Math.round(result.score) || 0);

    // Points: showing up + what you scored + a real reward for winning.
    const pointsEarned = 5 + score + (won ? 25 : 0) + Math.max(0, 4 - result.place) * 2;

    profile.points += pointsEarned;
    profile.gamesPlayed += 1;
    profile.finished += 1;
    if (won) {
      profile.wins += 1;
      profile.streak += 1;
      profile.bestStreak = Math.max(profile.bestStreak, profile.streak);
    } else {
      profile.streak = 0;
    }
    if (profile.id === hostId) profile.hosted += 1;

    const stat = (profile.stats[gameId] ??= { plays: 0, wins: 0, bestScore: 0, totalScore: 0 });
    stat.plays += 1;
    stat.totalScore += score;
    stat.bestScore = Math.max(stat.bestScore, score);
    if (won) stat.wins += 1;

    if (profile.playedWith.length < MAX_PLAYED_WITH) {
      for (const other of participants) {
        if (other !== profile.id && !profile.playedWith.includes(other)) profile.playedWith.push(other);
      }
    }

    const today = at.toISOString().slice(0, 10);
    if (!profile.activeDays.includes(today)) profile.activeDays.push(today);

    const newTitles = evaluateTitles(
      profile,
      {
        gameId,
        score,
        won,
        place: result.place,
        playerCount: results.length,
        runnerUpScore,
        wasHost: profile.id === hostId,
        at,
      },
      { totalGames, memberNumber: profile.memberNumber }
    );
    profile.titles.push(...newTitles);

    summary[profile.id] = { pointsEarned, newTitles, profile: publicProfile(profile) };
  }

  users.save();
  invalidateBoards(); // scores moved; the cached tables are stale
  return summary;
}

/** Someone left mid-match - break their win streak, don't credit a finish. */
export function noteAbandon(id) {
  const profile = users.data.users[id];
  if (!profile) return;
  profile.streak = 0;
  users.save();
}

/* ------------------------------ leaderboards ---------------------------- */

/**
 * @param {{ gameId?: string, sort?: 'points'|'wins'|'best', limit?: number }} opts
 */
export function leaderboard({ gameId, sort = 'points', limit = 50 } = {}) {
  const cacheKey = `${gameId ?? '*'}:${sort}:${limit}`;
  const hit = boardCache.get(cacheKey);
  if (hit && Date.now() - hit.at < BOARD_TTL_MS) return hit.rows;

  let rows = Object.values(users.data.users);

  if (gameId) {
    rows = rows.filter((p) => p.stats[gameId]?.plays > 0);
  }

  const value = (p) => {
    if (gameId) {
      const s = p.stats[gameId];
      return sort === 'wins' ? s.wins : sort === 'best' ? s.bestScore : s.totalScore;
    }
    return sort === 'wins' ? p.wins : p.points;
  };

  const ranked = rows
    .sort((a, b) => value(b) - value(a) || b.wins - a.wins || a.createdAt - b.createdAt)
    .slice(0, limit)
    .map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.name,
      keyword: p.keyword,
      accent: p.accent,
      spirit: p.spirit,
      level: level(p.points),
      value: value(p),
      points: p.points,
      wins: p.wins,
      gamesPlayed: p.gamesPlayed,
      titles: p.titles.slice(-3).map((t) => ({ emoji: t.emoji, name: t.name })),
    }));

  boardCache.set(cacheKey, { at: Date.now(), rows: ranked });
  return ranked;
}

export const memberCount = () => users.data.order.length;

/** Every member, in the order they joined. The directory needs the whole
 *  studio, not just whoever happens to have a socket open right now. */
export const memberIds = () => [...users.data.order];
