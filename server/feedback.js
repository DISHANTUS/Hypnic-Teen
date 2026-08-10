// What people say about the place.
//
// Every real bug in this project so far was found by somebody looking at a
// screen and saying "this isn't working" — not by a test. So there is a way to
// say it from inside the game, and it lands somewhere the owner will actually
// see rather than in a message they have to remember to check.
//
// Signing in is not required. The person most likely to hit something broken
// is the one who could not get past it, and asking them to log in first would
// lose exactly the reports worth having.

import { JsonStore, registerStore } from './store.js';
import { mailFeedback } from './mail.js';

const store = registerStore(new JsonStore('feedback.json', { items: [] }));

/** Enough to be useful, not so many that the file becomes the problem. */
const KEEP = 500;
const MAX_TEXT = 1200;

const KINDS = new Set(['bug', 'idea', 'game', 'other']);

/**
 * @param {object} note
 * @param {string} note.text   what they said
 * @param {string} [note.kind] bug | idea | game | other
 * @param {string} [note.from] a Hypnic ID, if they happened to be signed in
 * @param {string} [note.where] which screen they were on
 */
export function addFeedback({ text, kind, from, fromName, where } = {}) {
  const body = String(text ?? '').trim().slice(0, MAX_TEXT);
  // Two characters is a slip of the thumb, not a report.
  if (body.length < 3) return { error: 'Say a little more and it can be acted on.' };

  const item = {
    id: `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    text: body,
    kind: KINDS.has(kind) ? kind : 'other',
    from: from ? String(from).slice(0, 60) : null,
    // Kept alongside the ID, because an ID is unreadable and the owner needs to
    // know who they are answering. Stored rather than looked up later, so a
    // report still says who sent it after they change their name.
    fromName: fromName ? String(fromName).slice(0, 40) : null,
    where: where ? String(where).slice(0, 80) : null,
    at: Date.now(),
    read: false,
    // What the owner said back. A list, because a conversation can have more
    // than one turn and none of them should overwrite the last.
    replies: [],
  };

  store.data.items.unshift(item);
  if (store.data.items.length > KEEP) store.data.items.length = KEEP;
  store.save();

  // A copy goes to the owner's inbox, because the panel on their profile only
  // helps when they are sitting at this laptop. Best-effort: a note that could
  // not be emailed is still stored and still shown.
  mailFeedback(item);

  // Printed as well, because somebody watching the terminal during a party
  // should see a complaint the moment it is made.
  console.log(`[feedback] ${item.kind}: ${item.text.slice(0, 90)}${item.from ? ` — ${item.from}` : ''}`);
  return { ok: true };
}

export const feedbackList = () => store.data.items.map((i) => ({ ...i }));
export const unreadFeedback = () => store.data.items.filter((i) => !i.read).length;

export function markFeedbackRead(id) {
  const item = store.data.items.find((i) => i.id === id);
  if (item) {
    item.read = true;
    store.save();
  }
  return { ok: true, unread: unreadFeedback() };
}

/**
 * The owner's answer to one report.
 *
 * Recorded here as well as sent, so the panel shows what has already been said
 * and the owner does not answer the same person twice — the reply itself lands
 * in their notifications, where the owner cannot see it.
 *
 * @returns {{ok:true, item:object}|{error:string}}
 */
export function addReply(id, text, by) {
  const item = store.data.items.find((i) => i.id === id);
  if (!item) return { error: 'That note is gone.' };

  const body = String(text ?? '').trim().slice(0, MAX_TEXT);
  if (body.length < 2) return { error: 'Write something to send.' };
  // Somebody who was not signed in left no address to answer.
  if (!item.from) return { error: 'They were not signed in, so there is nowhere to send this.' };

  item.replies = item.replies ?? [];
  item.replies.push({ text: body, at: Date.now(), by: by ? String(by).slice(0, 60) : null });
  // Answering it is reading it.
  item.read = true;
  store.save();

  return { ok: true, item: { ...item } };
}

export function removeFeedback(id) {
  store.data.items = store.data.items.filter((i) => i.id !== id);
  store.save();
  return { ok: true };
}
