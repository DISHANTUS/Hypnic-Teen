// Who is allowed into which app.
//
// Fun World is open to every member — that is the point of it. Hypnic Study
// is not always: it costs GPU minutes per essay, its content is still being
// tuned, and there are evenings when the owner wants it to themselves.
//
// So Study asks here before letting anybody in. The studio is the identity
// authority already, which makes it the right place for this: one list, one
// owner, and a friend who is let in stays let in across both apps without a
// second account anywhere.
//
// Closed by default is deliberate. An allowlist that starts open protects
// nothing on the evening somebody first thinks to turn it on.

import { JsonStore, registerStore } from './store.js';

const store = registerStore(
  new JsonStore('access.json', {
    // app -> { open: bool, allowed: [hypnicId] }
    apps: {},
  })
);

/** The owner is whoever the launcher says; without one, nobody can change this. */
const OWNER = (process.env.OWNER_ID ?? '').trim();

export const isOwner = (id) => Boolean(OWNER) && id === OWNER;

function appState(app) {
  const apps = store.data.apps;
  if (!apps[app]) {
    // Closed the moment the feature exists, with the owner already inside —
    // otherwise turning it on locks the owner out of their own studio.
    apps[app] = { open: false, allowed: OWNER ? [OWNER] : [] };
    store.save();
  }
  // A studio that changes hands, or an OWNER_ID set after first boot, should
  // not leave the new owner outside.
  if (OWNER && !apps[app].allowed.includes(OWNER)) {
    apps[app].allowed.push(OWNER);
    store.save();
  }
  return apps[app];
}

/**
 * May this member use this app?
 *
 * @param {string} app   'study'
 * @param {string} id    a Hypnic ID
 */
export function mayUse(app, id) {
  if (!id) return { allowed: false, why: 'Sign in first.' };
  const state = appState(app);
  if (state.open) return { allowed: true };
  // Compared without case, because Hypnic>AzureSloth<Teen and its lowercase
  // spelling are one person. Study stores the lowercase form, the studio the
  // mixed one, and an exact-match check locks the owner out of their own app
  // depending on which side is asking.
  if (state.allowed.some((a) => a.toLowerCase() === String(id).toLowerCase())) return { allowed: true };
  return {
    allowed: false,
    // Said as a fact about the door rather than about them. "You are not on
    // the list" reads as a punishment; this reads as a queue.
    why: 'IELTS training is not open to everyone yet. Ask the studio owner to let you in.',
  };
}

export function accessState(app) {
  const state = appState(app);
  return { app, open: state.open, allowed: [...state.allowed], owner: OWNER || null };
}

/** Owner-only. Returns the state that actually took effect. */
export function setAccess(app, byId, { open, allow, revoke } = {}) {
  if (!isOwner(byId)) return { error: 'Only the studio owner can change this.' };
  const state = appState(app);

  if (typeof open === 'boolean') state.open = open;

  if (allow) {
    const id = String(allow).trim();
    if (id && !state.allowed.includes(id)) state.allowed.push(id);
  }
  if (revoke) {
    const id = String(revoke).trim();
    // The owner cannot lock themselves out by accident.
    if (id !== OWNER) state.allowed = state.allowed.filter((x) => x !== id);
  }

  store.save();
  return { ok: true, ...accessState(app) };
}
