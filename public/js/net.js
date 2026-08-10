// Thin wrapper over Socket.IO so game code never touches raw sockets.
// Identity comes from the signed-in Hypnic account - see auth.js.

import { Auth } from './auth.js';

class NetClient {
  constructor() {
    this.socket = null;
    this.room = null;
    this.listeners = new Map();
  }

  get playerId() {
    return Auth.profile?.id ?? null;
  }

  get name() {
    return Auth.profile?.name ?? 'Player';
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.listeners.get(event)?.delete(fn);
  }

  emitLocal(event, payload) {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`listener for "${event}" failed:`, err);
      }
    }
  }

  connect() {
    if (this.socket) return this.socket;
    this.socket = io({ transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      this.emitLocal('status', { online: true });
      // Say who we are even when we are not in a room, so a tournament can
      // reach us — and so we hear about a tie of ours that is already running.
      if (Auth.token) this.socket.emit('hello', { token: Auth.token });
      // Reconnected mid-session: slide straight back into the room we were in.
      if (this.room && Auth.token) {
        this.socket.emit('room:join', { code: this.room.code, token: Auth.token });
      }
    });
    this.socket.on('disconnect', () => this.emitLocal('status', { online: false }));

    for (const event of [
      'room:joined',
      'room:state',
      'game:start',
      'game:state',
      'game:you',
      'game:event',
      'game:over',
      'profile:reward',
      'chat:message',
      'invite:new',
      'app:version',
      'app:where',
      'notice:new',
      'notice:gone',
      'social:roster',
      'social:request',
      'social:friend',
      'social:message',
      'social:invite',
      'tourney:board',
      'tourney:state',
      'tourney:match',
    ]) {
      this.socket.on(event, (payload) => {
        if (event === 'room:joined') this.room = payload.room;
        if (event === 'room:state') this.room = payload;
        if (event === 'profile:reward') Auth.applyProfile(payload.profile);
        this.emitLocal(event, payload);
      });
    }

    return this.socket;
  }

  request(event, payload) {
    return new Promise((resolve) => {
      this.connect().emit(event, payload, (res) => resolve(res ?? {}));
    });
  }

  createRoom(gameId) {
    return this.request('room:create', { gameId, token: Auth.token });
  }

  joinRoom(code) {
    return this.request('room:join', { code: String(code).toUpperCase().trim(), token: Auth.token });
  }

  startGame() {
    return this.request('room:start', {});
  }

  /** Host only: tell everyone on the site that this room is open. */
  invite() {
    return this.request('room:invite', {});
  }

  /* ------------------------------ tournaments ----------------------------- */

  listCups() {
    return this.request('tourney:list', {});
  }

  getCup(id) {
    return this.request('tourney:get', { id });
  }

  createCup(spec) {
    return this.request('tourney:create', { ...spec, token: Auth.token });
  }

  cancelCup(id) {
    return this.request('tourney:cancel', { id, token: Auth.token });
  }

  joinCup(id, team = '') {
    return this.request('tourney:join', { id, team, token: Auth.token });
  }

  leaveCup(id) {
    return this.request('tourney:leave', { id, token: Auth.token });
  }

  pairCup(id) {
    return this.request('tourney:pair', { id, token: Auth.token });
  }

  startCup(id) {
    return this.request('tourney:start', { id, token: Auth.token });
  }

  /** Host only: change how the next match is played. */
  updateSettings(patch) {
    return this.request('room:settings', patch);
  }

  /** Host only: CPU players, so a solo player still gets a game. */
  addBot() {
    return this.request('room:bot', { add: true });
  }

  removeBot() {
    return this.request('room:bot', { add: false });
  }

  fillWithBots() {
    return this.request('room:fill', {});
  }

  setReady(ready) {
    this.connect().emit('room:ready', ready);
  }

  backToLobby() {
    this.connect().emit('room:lobby');
  }

  leaveRoom() {
    if (this.socket) this.socket.emit('room:leave');
    this.room = null;
  }

  action(payload) {
    this.socket?.emit('game:action', payload);
  }

  chat(text) {
    this.socket?.emit('chat:send', text);
  }

  get isHost() {
    return this.room?.hostId === this.playerId;
  }
}

export const Net = new NetClient();
