// Word from the studio.
//
// A room full of people has no idea why the server went quiet, why their
// points changed, or that there is a tournament at eight. Telling them needs
// somewhere to put a message that outlives the moment — a chat line scrolls
// away, and half the room was not looking.
//
// So: a small board the owner writes to and everyone reads once. Each notice
// is marked read per member, so nobody is shown the same maintenance warning
// every time they open the site, and nobody misses one because they were mid-
// match when it went up.

import { JsonStore, registerStore } from './store.js';

const store = registerStore(new JsonStore('notices.json', { list: [], read: {} }));

/** Old news is not news. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_KEPT = 60;

/** What a notice is for, which is also how it is coloured. */
export const KINDS = ['news', 'maintenance', 'reward', 'warning'];

let io = null;
export function attachNotices(server) {
  io = server;
}

const now = () => Date.now();
const all = () => store.data.list;

/**
 * Posts a notice. Only ever called for someone who has already been checked as
 * the owner — this module does not decide who is allowed to speak.
 */
export function postNotice({ title, body, kind = 'news', from = 'Hypnic Teen Studio', pinned = false }) {
  const text = String(body ?? '').trim().slice(0, 900);
  const head = String(title ?? '').trim().slice(0, 90);
  if (!head) return { error: 'It needs a title.' };
  if (!text) return { error: 'It needs something to say.' };

  const notice = {
    id: `n${now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    title: head,
    body: text,
    kind: KINDS.includes(kind) ? kind : 'news',
    from: String(from).slice(0, 40),
    pinned: Boolean(pinned),
    at: now(),
  };
  all().unshift(notice);
  sweep();
  store.save();

  // Anyone on the site right now hears it immediately; anyone who arrives
  // later picks it up from the board.
  io?.emit('notice:new', notice);
  return { ok: true, notice };
}

export function removeNotice(id) {
  const before = all().length;
  store.data.list = all().filter((n) => n.id !== id);
  if (store.data.list.length === before) return { error: 'No such notice.' };
  store.save();
  io?.emit('notice:gone', { id });
  return { ok: true };
}

/** The board as one member sees it, newest first, with what they have read. */
export function noticesFor(accountId) {
  sweep();
  const seen = new Set(store.data.read[accountId] ?? []);
  const list = all().map((n) => ({ ...n, read: seen.has(n.id) }));
  return {
    notices: list,
    unread: list.filter((n) => !n.read).length,
  };
}

export function markRead(accountId, ids) {
  if (!accountId) return { error: 'Sign in first.' };
  const wanted = Array.isArray(ids) ? ids : all().map((n) => n.id);
  const seen = new Set(store.data.read[accountId] ?? []);
  for (const id of wanted) seen.add(String(id));
  // Only remember reads for notices that still exist, or this grows forever.
  const live = new Set(all().map((n) => n.id));
  store.data.read[accountId] = [...seen].filter((id) => live.has(id));
  store.save();
  return { ok: true, unread: noticesFor(accountId).unread };
}

/**
 * A notice everyone should see once, which the studio itself can raise —
 * used for "add a way to recover your ID" and anything else the site needs to
 * ask of members who joined before a feature existed. Posting it twice would
 * be nagging, so it is keyed and only ever posted once.
 */
export function ensureNotice(key, spec) {
  if (all().some((n) => n.key === key)) return { ok: true, already: true };
  const res = postNotice(spec);
  if (res.notice) {
    res.notice.key = key;
    store.save();
  }
  return res;
}

function sweep() {
  const cutoff = now() - KEEP_MS;
  const kept = all().filter((n) => n.pinned || n.at > cutoff).slice(0, MAX_KEPT);
  if (kept.length !== all().length) {
    store.data.list = kept;
    store.save();
  }
}
