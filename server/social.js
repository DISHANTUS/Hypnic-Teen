// Who else is here, and what you can do about it.
//
// Until now the only way to play with somebody was to be standing next to them
// and read out a four-letter code. That works at a table and nowhere else —
// and it means the site has no memory of who you like playing with.
//
// So: a roster of who is online, a profile you can open by tapping a name,
// friend requests, direct messages, and an invite that goes to one person
// instead of shouting at the whole site.
//
// Presence is deliberately not stored. It is whoever has a live socket right
// now, rebuilt from nothing every time the server starts, because a list of
// "online" players that survives a restart is a list of lies.

import { JsonStore, registerStore } from './store.js';

const store = registerStore(new JsonStore('social.json', { friends: {}, requests: [], threads: {} }));

/** How much of a conversation is kept. Long enough to scroll back through. */
const KEEP_MESSAGES = 200;
const MAX_FRIENDS = 200;
const MESSAGE_LIMIT = 500;

let io = null;
/** accountId -> { name, at, room } for everyone with a live socket. */
const present = new Map();
/** Told where to send things; index.js owns the sockets, not this module. */
let tell = () => {};
let profileOf = () => null;

export function attachSocial({ server, tellPlayer, getProfile }) {
  io = server;
  if (tellPlayer) tell = tellPlayer;
  if (getProfile) profileOf = getProfile;
}

const now = () => Date.now();

/* -------------------------------- presence -------------------------------- */

export function arrive(account) {
  if (!account?.id) return;
  const was = present.get(account.id);
  present.set(account.id, { name: account.name, at: was?.at ?? now(), room: was?.room ?? null });
  if (!was) broadcastRoster();
}

export function depart(accountId) {
  if (present.delete(accountId)) broadcastRoster();
}

/** Where somebody is, so the roster can say "in a lobby" or "playing". */
export function setWhereabouts(accountId, where) {
  const p = present.get(accountId);
  if (!p) return;
  const changed = JSON.stringify(p.room) !== JSON.stringify(where);
  p.room = where;
  if (changed) broadcastRoster();
}

export const isOnline = (id) => present.has(id);

/**
 * Everyone here, with enough about each to decide whether to say hello.
 * Ordered so friends come first — the list is for finding people you know.
 */
export function roster(forId) {
  const mates = new Set(friendsOf(forId));
  return [...present.entries()]
    .map(([id, p]) => {
      const card = profileOf(id);
      return {
        id,
        name: p.name,
        friend: mates.has(id),
        you: id === forId,
        level: card?.level ?? 1,
        points: card?.points ?? 0,
        accent: card?.accent ?? '#7c5cff',
        spirit: card?.spirit ?? '',
        // Where they are, in words. Never the room code unless it is open —
        // a private room should not be joinable by reading somebody's status.
        where: p.room?.phase === 'playing' ? 'playing' : p.room ? 'in a lobby' : 'in the arcade',
        room: p.room?.open ? p.room.code : null,
        game: p.room?.game ?? null,
        since: p.at,
      };
    })
    .sort((a, b) => (a.friend === b.friend ? b.points - a.points : a.friend ? -1 : 1));
}

function broadcastRoster() {
  if (!io) return;
  // One event, and each client filters for its own friends — sending a
  // per-player roster to two hundred sockets on every join is not worth the
  // small amount of ordering it buys.
  io.emit('social:roster', { count: present.size });
}

/* -------------------------------- friends --------------------------------- */

export const friendsOf = (id) => store.data.friends[id] ?? [];

/** The two directions of a friendship, written together or not at all. */
function link(a, b) {
  for (const [x, y] of [[a, b], [b, a]]) {
    const list = store.data.friends[x] ?? [];
    if (!list.includes(y) && list.length < MAX_FRIENDS) list.push(y);
    store.data.friends[x] = list;
  }
}

export function requestFriend(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return { error: 'Pick somebody else.' };
  if (!profileOf(toId)) return { error: 'No member with that ID.' };
  if (friendsOf(fromId).includes(toId)) return { error: 'You are already friends.' };

  // They asked first: accept it rather than making two people press buttons at
  // each other.
  const theirs = store.data.requests.find((r) => r.from === toId && r.to === fromId);
  if (theirs) return acceptFriend(fromId, toId);

  if (store.data.requests.some((r) => r.from === fromId && r.to === toId)) {
    return { error: 'Already asked. Give them a minute.' };
  }
  store.data.requests.push({ from: fromId, to: toId, at: now() });
  store.save();

  const me = profileOf(fromId);
  tell(toId, 'social:request', { from: fromId, name: me?.name ?? 'Someone', at: now() });
  return { ok: true, pending: true };
}

export function acceptFriend(meId, fromId) {
  const at = store.data.requests.findIndex((r) => r.from === fromId && r.to === meId);
  if (at === -1) return { error: 'No request from them.' };
  store.data.requests.splice(at, 1);
  link(meId, fromId);
  store.save();

  const me = profileOf(meId);
  tell(fromId, 'social:friend', { id: meId, name: me?.name ?? 'Someone' });
  return { ok: true, friends: friendsOf(meId) };
}

export function declineFriend(meId, fromId) {
  const before = store.data.requests.length;
  store.data.requests = store.data.requests.filter((r) => !(r.from === fromId && r.to === meId));
  if (store.data.requests.length === before) return { error: 'No request from them.' };
  store.save();
  return { ok: true };
}

export function unfriend(meId, otherId) {
  for (const [x, y] of [[meId, otherId], [otherId, meId]]) {
    store.data.friends[x] = (store.data.friends[x] ?? []).filter((id) => id !== y);
  }
  store.save();
  return { ok: true };
}

/** Requests waiting on you, with names attached so the UI need not ask twice. */
export const requestsFor = (id) =>
  store.data.requests
    .filter((r) => r.to === id)
    .map((r) => ({ ...r, name: profileOf(r.from)?.name ?? 'Someone' }));

/** Your people, whether or not they are here right now. */
export function friendList(id) {
  return friendsOf(id).map((fid) => {
    const card = profileOf(fid);
    const here = present.get(fid);
    return {
      id: fid,
      name: card?.name ?? 'Someone',
      level: card?.level ?? 1,
      accent: card?.accent ?? '#7c5cff',
      online: Boolean(here),
      where: here ? (here.room?.phase === 'playing' ? 'playing' : here.room ? 'in a lobby' : 'in the arcade') : 'away',
      unread: unreadCount(id, fid),
    };
  });
}

/* --------------------------------- messages -------------------------------- */

// One thread per pair, keyed the same way whoever opens it — otherwise two
// people would be typing into two different conversations.
const threadKey = (a, b) => [a, b].sort().join('|');

export function sendMessage(fromId, toId, text) {
  const body = String(text ?? '').slice(0, MESSAGE_LIMIT).trim();
  if (!body) return { error: 'Say something.' };
  if (!profileOf(toId)) return { error: 'No member with that ID.' };
  // Friends only. An open inbox on a site full of teenagers is a bad idea, and
  // the friend request is the consent.
  if (!friendsOf(fromId).includes(toId)) return { error: 'You can only message friends.' };

  const key = threadKey(fromId, toId);
  const thread = store.data.threads[key] ?? { messages: [], read: {} };
  const message = { from: fromId, text: body, at: now() };
  thread.messages.push(message);
  if (thread.messages.length > KEEP_MESSAGES) thread.messages.splice(0, thread.messages.length - KEEP_MESSAGES);
  store.data.threads[key] = thread;
  store.save();

  const me = profileOf(fromId);
  tell(toId, 'social:message', { from: fromId, name: me?.name ?? 'Someone', ...message });
  return { ok: true, message };
}

export function conversation(meId, otherId) {
  const key = threadKey(meId, otherId);
  const thread = store.data.threads[key] ?? { messages: [], read: {} };
  // Opening a conversation reads it.
  thread.read[meId] = now();
  store.data.threads[key] = thread;
  store.save();
  return {
    with: { id: otherId, name: profileOf(otherId)?.name ?? 'Someone', online: isOnline(otherId) },
    messages: thread.messages,
  };
}

function unreadCount(meId, otherId) {
  const thread = store.data.threads[threadKey(meId, otherId)];
  if (!thread) return 0;
  const since = thread.read?.[meId] ?? 0;
  return thread.messages.filter((m) => m.from !== meId && m.at > since).length;
}

export const totalUnread = (id) => friendsOf(id).reduce((n, fid) => n + unreadCount(id, fid), 0);

/* --------------------------------- invites --------------------------------- */

/**
 * "Come and play, specifically you." The room shout already exists and reaches
 * everybody; this is the one you send to a person, and it carries the code so
 * they can be in the room in one tap.
 */
export function inviteOne(fromId, toId, room) {
  if (!isOnline(toId)) return { error: 'They are not on the site right now.' };
  if (!room?.code) return { error: 'Open a room first.' };
  const me = profileOf(fromId);
  tell(toId, 'social:invite', {
    from: fromId,
    name: me?.name ?? 'Someone',
    code: room.code,
    game: room.game ?? 'a game',
    emoji: room.emoji ?? '🎮',
    at: now(),
  });
  return { ok: true };
}

/** What one member may see of another. Never PIN material, never recovery. */
export function publicCard(id) {
  const p = profileOf(id);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    accent: p.accent,
    spirit: p.spirit,
    level: p.level,
    points: p.points,
    gamesPlayed: p.gamesPlayed,
    wins: p.wins,
    bestStreak: p.bestStreak,
    titles: p.titles ?? [],
    memberNumber: p.memberNumber,
    online: isOnline(id),
  };
}
