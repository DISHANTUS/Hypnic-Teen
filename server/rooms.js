// Room / lobby manager. Completely game-agnostic: it owns players, codes and
// phases, and hands the actual rules over to a game module (see server/games).

import { getGame, listGames } from './games/index.js';
import { normaliseSettings } from './party.js';
import { recordMatch, noteAbandon, cardFor } from './accounts.js';
import { reportRoom } from './tournaments.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 - people read these out loud

// CPU players get names that read as crew, not as robots.
const BOT_NAMES = [
  'Nova', 'Echo', 'Vega', 'Onyx', 'Iris', 'Kite',
  'Rook', 'Sable', 'Lynx', 'Corvo', 'Wren', 'Atlas',
];
/**
 * A human pause before a CPU moves, so it feels like an opponent rather than a
 * reflex. Real-time games override it — a racer that only changes course twice
 * a second drives into walls.
 */
const BOT_PAUSE_MS = (game) =>
  game?.botPause != null ? game.botPause : 700 + Math.random() * 1400;
const CODE_LENGTH = 4;
const EMPTY_ROOM_GRACE_MS = 60_000; // keep the room alive briefly so reconnects land back home

/** @type {Map<string, Room>} */
const rooms = new Map();

function makeCode() {
  let code;
  do {
    code = Array.from({ length: CODE_LENGTH }, () =>
      CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

/**
 * @typedef {Object} Player
 * @property {string} id        stable id kept in the browser, survives reconnects
 * @property {string} name
 * @property {string|null} socketId
 * @property {boolean} connected
 * @property {boolean} ready
 */

class Room {
  constructor(code, gameId, io) {
    this.code = code;
    this.gameId = gameId;
    this.io = io;
    /** @type {Map<string, Player>} */
    this.players = new Map();
    this.hostId = null;
    this.phase = 'lobby'; // lobby | playing | over
    this.settings = normaliseSettings(getGame(gameId)?.options, {});
    this.botSeq = 1;
    this.state = null;
    this.tickTimer = null;
    this.emptySince = null;
    this.createdAt = Date.now();
    /** Set when a bracket opened this room: { id, matchId, label, expected }. */
    this.tourney = null;
    this.tourneyTimer = null;
  }

  get game() {
    return getGame(this.gameId);
  }

  playerList() {
    return [...this.players.values()].map((p) => {
      const card = cardFor(p.id);
      return {
        id: p.id,
        name: p.name,
        connected: p.connected,
        ready: p.ready,
        isHost: p.id === this.hostId,
        isBot: Boolean(p.isBot),
        accent: p.isBot ? '#8a8f98' : card?.accent ?? '#7c5cff',
        spirit: p.isBot ? 'CPU' : card?.spirit ?? '',
        level: card?.level ?? 1,
        title: card?.title ?? null,
      };
    });
  }

  publicInfo() {
    return {
      code: this.code,
      gameId: this.gameId,
      gameName: this.game?.name ?? this.gameId,
      phase: this.phase,
      hostId: this.hostId,
      players: this.playerList(),
      minPlayers: this.game?.minPlayers ?? 1,
      maxPlayers: this.game?.maxPlayers ?? 8,
      // What the host can tune, and what it is currently set to. Everyone gets
      // both so a guest can see the rules they are about to play under.
      options: this.optionsNow(),
      settings: this.settings,
    };
  }

  /**
   * The knobs as they stand right now. Some settings change what the others
   * can be — picking Tamil should offer Tamil genres, not Korean ones — so a
   * game may rework its own descriptor in light of what is already chosen.
   */
  optionsNow(settings = this.settings) {
    const game = this.game;
    if (!game?.options) return null;
    try {
      return game.refineOptions?.(settings) ?? game.options;
    } catch (err) {
      console.error(`[${this.code}] refineOptions:`, err);
      return game.options;
    }
  }

  /** Host-only, lobby-only. Returns the settings that actually took effect. */
  applySettings(raw) {
    if (this.phase !== 'lobby') return { error: 'Settings are locked once a game starts.' };
    if (!this.game?.options) return { error: 'This game has nothing to change.' };
    // Normalised twice on purpose: the first pass settles the settings that
    // decide the shape of the rest, and the second validates the rest against
    // that shape. One pass would judge a Tamil genre against Korean choices.
    const once = normaliseSettings(this.game.options, { ...this.settings, ...raw });
    this.settings = normaliseSettings(this.optionsNow(once), { ...once, ...raw });
    this.broadcastRoom();
    return { ok: true, settings: this.settings };
  }

  addPlayer({ id, name, socketId }) {
    const existing = this.players.get(id);
    if (existing) {
      existing.socketId = socketId;
      existing.connected = true;
      if (name) existing.name = name;
    } else {
      this.players.set(id, {
        id,
        name: name || 'Player',
        socketId,
        connected: true,
        ready: false,
      });
    }
    this.emptySince = null;
    if (!this.hostId || !this.players.get(this.hostId)?.connected) {
      this.hostId = this.firstConnectedId() ?? id;
    }
    // Joining mid-match: let the game slot them in if it supports it.
    if (this.phase === 'playing' && this.game?.onPlayerJoin) {
      this.game.onPlayerJoin(this.state, this.players.get(id));
    }
    // A tie starts the moment both sides have turned up. Waiting for someone to
    // press Start would mean the bracket stalls on whoever is slowest to look
    // at their phone.
    if (this.tourney && this.phase === 'lobby' && this.everyoneExpectedIsHere()) this.beginTie();
    return this.players.get(id);
  }

  everyoneExpectedIsHere() {
    return (this.tourney?.expected ?? []).every((pid) => this.players.get(pid)?.connected);
  }

  /**
   * Runs a bracket tie. Latecomers get a CPU standing in for them rather than
   * holding up everyone else in the tournament — a no-show should cost their
   * own side, not the evening.
   */
  beginTie() {
    if (!this.tourney || this.phase !== 'lobby') return;
    clearTimeout(this.tourneyTimer);
    this.tourneyTimer = null;

    // Every seat the tie was built for, not merely the game's minimum: a 2v2
    // with one player missing needs a stand-in on that side, even though three
    // players would satisfy the game.
    const need = Math.max(this.game?.minPlayers ?? 1, this.tourney.expected?.length ?? 0);
    while ([...this.players.values()].filter((p) => p.connected).length < need) {
      if (this.addBot().error) break;
    }
    for (const p of this.players.values()) p.ready = true;
    this.start();
  }

  /** Opens the doors and sets the clock running on a tie. */
  armTie(waitMs) {
    if (!this.tourney) return;
    clearTimeout(this.tourneyTimer);
    this.tourneyTimer = setTimeout(() => this.beginTie(), waitMs);
    this.tourneyTimer.unref?.();
  }

  firstConnectedId() {
    for (const p of this.players.values()) if (p.connected) return p.id;
    return null;
  }

  markDisconnected(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    if (this.phase === 'playing') {
      this.game?.onPlayerLeave?.(this.state, p);
      noteAbandon(p.id); // bailing mid-match costs you your streak
    }
    if (this.phase === 'lobby') this.players.delete(playerId);
    if (this.hostId === playerId) this.hostId = this.firstConnectedId();
    if (![...this.players.values()].some((x) => x.connected)) {
      this.emptySince = Date.now();
      this.stopLoop();
    }
  }

  broadcastRoom() {
    this.io.to(this.code).emit('room:state', this.publicInfo());
  }

  /**
   * Games that hide information from some players (the imposter's word, your
   * own hand) implement serializeFor(state, playerId) and get a private view
   * per socket. Everything else broadcasts one shared state.
   */
  broadcastGame() {
    if (!this.state) return;
    const game = this.game;

    // Mass rooms: one serialization, one broadcast, however many players are
    // in here. Private slices go only to the players whose own view changed —
    // which is only ever whoever just acted.
    if (game.mass) {
      this.io.to(this.code).emit('game:state', game.serialize(this.state));
      for (const playerId of game.takePrivateDirty(this.state)) {
        const sid = this.players.get(playerId)?.socketId;
        if (sid) this.io.to(sid).emit('game:you', game.privateFor(this.state, playerId));
      }
      return;
    }

    if (!game.serializeFor) {
      this.io.to(this.code).emit('game:state', game.serialize(this.state));
      return;
    }
    for (const player of this.players.values()) {
      if (player.socketId && player.connected) {
        this.io.to(player.socketId).emit('game:state', game.serializeFor(this.state, player.id));
      }
    }
  }

  /** The first frame a player sees, private view included. */
  startFrameFor(playerId) {
    const game = this.game;
    return game.serializeFor ? game.serializeFor(this.state, playerId) : game.serialize(this.state);
  }

  start() {
    const game = this.game;
    if (!game) return { error: 'Unknown game.' };
    const active = [...this.players.values()].filter((p) => p.connected);
    if (active.length < game.minPlayers) {
      return { error: `Need at least ${game.minPlayers} player(s).` };
    }
    this.state = game.createState(active, { room: this, settings: this.settings });
    this.phase = 'playing';
    this.broadcastRoom();
    for (const player of this.players.values()) {
      if (player.socketId) this.io.to(player.socketId).emit('game:start', this.startFrameFor(player.id));
    }
    this.startLoop();
    return { ok: true };
  }

  /**
   * CPU players. A bot is a player in every respect the game can see — it sits
   * in the same map, holds a seat, and its moves arrive through the same
   * handleAction the humans use. Only the room knows the difference, which is
   * why no game module needs bot-specific code paths.
   */
  addBot() {
    if (this.phase !== 'lobby') return { error: 'Add CPU players before the game starts.' };
    const seated = [...this.players.values()].filter((p) => p.connected).length;
    if (seated >= (this.game?.maxPlayers ?? 8)) return { error: 'The room is full.' };

    const taken = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !taken.has(n)) ?? `CPU ${this.players.size + 1}`;
    const id = `bot:${this.code}:${this.botSeq++}`;
    this.players.set(id, {
      id,
      name,
      socketId: null,
      connected: true,
      ready: true,
      isBot: true,
      thinkUntil: 0,
      thinking: false,
    });
    this.broadcastRoom();
    return { ok: true, id, name };
  }

  removeBot(id) {
    const bot = id ? this.players.get(id) : [...this.players.values()].reverse().find((p) => p.isBot);
    if (!bot?.isBot) return { error: 'No CPU player to remove.' };
    this.players.delete(bot.id);
    this.broadcastRoom();
    return { ok: true };
  }

  /** Tops the room up to the minimum the chosen game needs. */
  fillWithBots() {
    const need = (this.game?.minPlayers ?? 1) - [...this.players.values()].filter((p) => p.connected).length;
    for (let i = 0; i < need; i++) {
      const res = this.addBot();
      if (res.error) return res;
    }
    return { ok: true, added: Math.max(0, need) };
  }

  /**
   * Gives every CPU a turn to act. Bots deliberately pause before moving —
   * an opponent that answers the instant a question appears feels like a bug,
   * not a challenge. A bot may also think asynchronously (the local model
   * writing an answer), and must not be asked again while it is.
   */
  runBots() {
    const game = this.game;
    if (!game?.botAction || !this.state) return;
    const now = Date.now();

    for (const bot of this.players.values()) {
      if (!bot.isBot || bot.thinking || now < bot.thinkUntil) continue;

      let move;
      try {
        move = game.botAction(this.state, { id: bot.id, name: bot.name });
      } catch (err) {
        console.error(`[${this.code}] bot error:`, err.message);
        bot.thinkUntil = now + 2000;
        continue;
      }
      if (!move) continue;

      if (typeof move.then === 'function') {
        bot.thinking = true;
        move
          .then((action) => {
            bot.thinking = false;
            bot.thinkUntil = Date.now() + BOT_PAUSE_MS(game);
            if (action && this.phase === 'playing') this.handleAction(bot.id, action);
          })
          .catch(() => {
            bot.thinking = false;
            bot.thinkUntil = Date.now() + 2000;
          });
        continue;
      }

      bot.thinkUntil = now + BOT_PAUSE_MS(game);
      this.handleAction(bot.id, move);
    }
  }

  startLoop() {
    this.stopLoop();
    const game = this.game;
    if (!game?.tickRate) return;
    const step = 1000 / game.tickRate;
    let last = Date.now();
    this.tickTimer = setInterval(() => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      try {
        game.onTick?.(this.state, dt, this.api());
      } catch (err) {
        console.error(`[${this.code}] tick error:`, err);
      }
      this.runBots();
      if (game.isOver?.(this.state)) return this.finish();
      // Games that can say "nothing changed" get to skip the send entirely.
      if (game.isDirty && !game.isDirty(this.state)) return;
      this.broadcastGame();
    }, step);
  }

  stopLoop() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  handleAction(playerId, action) {
    if (this.phase !== 'playing' || !this.state) return;
    const player = this.players.get(playerId);
    if (!player) return;
    try {
      this.game.onAction?.(this.state, player, action, this.api());
    } catch (err) {
      console.error(`[${this.code}] action error:`, err);
    }
    // Turn-based games have no tick loop, so push the new state right away.
    if (!this.game.tickRate) {
      if (this.game.isOver?.(this.state)) return this.finish();
      this.broadcastGame();
    }
  }

  finish() {
    if (this.phase === 'over') return; // a tick and an action can both trip the end
    this.stopLoop();
    this.phase = 'over';

    const results = this.game.results?.(this.state) ?? [];
    // CPU players have no account to credit, and letting them into the ledger
    // would put made-up names on the leaderboard.
    const rewards = recordMatch({
      gameId: this.gameId,
      hostId: this.hostId,
      results: results.filter((r) => !String(r.playerId).startsWith('bot:')),
      totalGames: listGames().length,
    });

    this.io.to(this.code).emit('game:over', { results, state: this.game.serialize(this.state) });

    // If this was a bracket tie, the winner walks into the next round and the
    // room that opens for it is somebody else's problem now.
    if (this.tourney) {
      try {
        reportRoom(this.code, results);
      } catch (err) {
        console.error(`[${this.code}] tournament result:`, err);
      }
    }

    // Points and freshly unlocked titles are personal - send them one by one.
    for (const [playerId, reward] of Object.entries(rewards)) {
      const sid = this.players.get(playerId)?.socketId;
      if (sid) this.io.to(sid).emit('profile:reward', reward);
    }
    this.broadcastRoom();
  }

  returnToLobby() {
    this.stopLoop();
    this.phase = 'lobby';
    this.state = null;
    for (const p of this.players.values()) p.ready = false;
    this.broadcastRoom();
  }

  /** Small surface the game modules use to talk back to the room. */
  api() {
    return {
      emit: (event, payload) => this.io.to(this.code).emit('game:event', { event, payload }),
      emitTo: (playerId, event, payload) => {
        const sid = this.players.get(playerId)?.socketId;
        if (sid) this.io.to(sid).emit('game:event', { event, payload });
      },
      finish: () => this.finish(),
      players: () => [...this.players.values()],
    };
  }
}

export function createRoom(gameId, io) {
  if (!getGame(gameId)) return null;
  const room = new Room(makeCode(), gameId, io);
  rooms.set(room.code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase().trim());
}

export function roomStats() {
  return {
    rooms: rooms.size,
    players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0),
  };
}

// Reap rooms nobody came back to.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince && now - room.emptySince > EMPTY_ROOM_GRACE_MS) {
      room.stopLoop();
      rooms.delete(code);
    }
  }
}, 30_000).unref();
