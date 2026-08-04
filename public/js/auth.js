// Studio membership on the client: the quiz, the Hypnic ID, and the session.

const TOKEN_KEY = 'htfw:token';

async function api(path, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // A laptop that has gone to sleep, a hotspot that dropped, a server that
    // was restarted mid-session. Left unhandled this rejected out of the click
    // handler and the button simply did nothing — no error, no change, which
    // reads as a broken site rather than a missing one.
    return { error: 'Cannot reach the studio. Is the laptop still running it?' };
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) return { error: data.error || `Request failed (${res.status})` };
  return data;
}

class AuthClient {
  constructor() {
    this.token = localStorage.getItem(TOKEN_KEY) || null;
    this.profile = null;
    this.listeners = new Set();
  }

  get signedIn() {
    return Boolean(this.token && this.profile);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.profile);
  }

  setSession(token, profile) {
    this.token = token;
    this.profile = profile;
    localStorage.setItem(TOKEN_KEY, token);
    this.emit();
  }

  /** Called on boot - validates the stored token against the server. */
  async restore() {
    if (!this.token) return null;
    const res = await api('/api/me', { token: this.token });
    if (res.error) {
      this.logout();
      return null;
    }
    this.profile = res.profile;
    this.emit();
    return this.profile;
  }

  /** Pull the freshest profile after a match. */
  async refresh() {
    if (!this.token) return null;
    const res = await api('/api/me', { token: this.token });
    if (!res.error) {
      this.profile = res.profile;
      this.emit();
    }
    return this.profile;
  }

  /** Local update from a match reward, so the UI reacts instantly. */
  applyProfile(profile) {
    if (!profile) return;
    this.profile = profile;
    this.emit();
  }

  quiz() {
    return api('/api/quiz');
  }

  async signup(payload) {
    const res = await api('/api/auth/signup', { method: 'POST', body: payload });
    if (!res.error) this.setSession(res.token, res.profile);
    return res;
  }

  async login(id, pin) {
    const res = await api('/api/auth/login', { method: 'POST', body: { id, pin } });
    if (!res.error) this.setSession(res.token, res.profile);
    return res;
  }

  logout() {
    this.token = null;
    this.profile = null;
    localStorage.removeItem(TOKEN_KEY);
    this.emit();
  }

  leaderboard(params = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return api(`/api/leaderboard${qs ? `?${qs}` : ''}`);
  }

  titles() {
    return api('/api/titles');
  }
}

export const Auth = new AuthClient();
