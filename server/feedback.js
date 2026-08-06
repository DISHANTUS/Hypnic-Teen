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
export function addFeedback({ text, kind, from, where } = {}) {
  const body = String(text ?? '').trim().slice(0, MAX_TEXT);
  // Two characters is a slip of the thumb, not a report.
  if (body.length < 3) return { error: 'Say a little more and it can be acted on.' };

  const item = {
    id: `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    text: body,
    kind: KINDS.has(kind) ? kind : 'other',
    from: from ? String(from).slice(0, 60) : null,
    where: where ? String(where).slice(0, 80) : null,
    at: Date.now(),
    read: false,
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

export function removeFeedback(id) {
  store.data.items = store.data.items.filter((i) => i.id !== id);
  store.save();
  return { ok: true };
}
