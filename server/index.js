import { createServer, request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import express from 'express';
import compression from 'compression';
import QRCode from 'qrcode';
import { Server } from 'socket.io';

import { listGames, getGame } from './games/index.js';
import { createRoom, getRoom, roomStats } from './rooms.js';
import { publicQuiz } from './identity.js';
import { titleCatalogue } from './titles.js';
import { warmUp as warmUpAI, isEnabled as aiEnabled } from './ai.js';
import {
  signup,
  login,
  verifyToken,
  getProfile,
  publicProfile,
  leaderboard,
  memberCount,
  memberIds,
  recoverId,
  recoveryHints,
  setRecovery,
  hasRecovery,
} from './accounts.js';
import { attachNotices, postNotice, removeNotice, noticesFor, markRead, ensureNotice } from './notices.js';
import {
  attachSocial,
  arrive,
  depart,
  setWhereabouts,
  roster,
  directory,
  requestFriend,
  acceptFriend,
  declineFriend,
  unfriend,
  requestsFor,
  friendList,
  sendMessage,
  conversation,
  totalUnread,
  inviteOne,
  publicCard,
} from './social.js';
import { warmUpLLM } from './llm.js';
import { CLUE_DIR, clueFor, clueVocabulary, mediaStatus } from './media.js';
import {
  attachTournaments,
  createTournament,
  register as tourneyRegister,
  withdraw as tourneyWithdraw,
  pairStrays,
  startTournament,
  listTournaments,
  getTournament,
  liveMatchFor,
} from './tournaments.js';

const PORT = Number(process.env.PORT) || 8008;
const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');

// Dev tools (the device harness and the phase preview) are handy locally but
// have no business on a link you send to someone. Off unless asked for.
const ALLOW_DEV = process.env.ALLOW_DEV === '1' || process.env.NODE_ENV !== 'production';

// Probe the local model once at boot; CPU players fall back to canned lines if
// it never answers, so this failing is not an error.
warmUpLLM();

// How long a host must wait between shouting about their room.
const INVITE_COOLDOWN_MS = 30_000;

/**
 * A fingerprint of the code the browser is running, worked out once at startup.
 * A tab that was opened before an update keeps running the old modules with no
 * error anywhere — this is what lets it notice and offer to reload.
 */
function buildId() {
  const dir = path.join(import.meta.dirname, '..', 'public');
  const files = ['js', 'css', 'games/_party']
    .flatMap((sub) => {
      const full = path.join(dir, sub);
      return existsSync(full) ? readdirSync(full).map((f) => path.join(full, f)) : [];
    })
    .concat(path.join(dir, 'index.html'))
    .filter((f) => /\.(js|css|html)$/.test(f));

  const stamp = files
    .sort()
    .map((f) => {
      const s = statSync(f);
      return `${path.basename(f)}:${s.size}:${Math.floor(s.mtimeMs)}`;
    })
    .join('|');
  return createHash('sha256').update(stamp).digest('hex').slice(0, 12);
}

const BUILD = buildId();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }, // same-origin in practice; open so a phone on the LAN never gets blocked
  pingTimeout: 20_000,
  maxHttpBufferSize: 1e5, // 100KB — nothing this game sends is bigger
});

// Behind a tunnel or a host's load balancer, the real client IP arrives in a
// header. Without this the rate limiter would see one IP for everybody.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(compression());
app.use(express.json({ limit: '32kb' }));

if (!ALLOW_DEV) {
  app.use('/_dev', (_req, res) => res.status(404).send('Not found'));
}

app.use(
  express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      // The shell must always revalidate or a deploy never reaches anyone;
      // fingerprint-free assets get a short cache instead of a long one.
      // Code must always revalidate. These filenames carry no fingerprint, so
      // a max-age here means a friend who refreshes still runs last week's
      // build and there is no way to tell from either side. On a LAN a
      // revalidation is a 304 and costs nothing.
      if (/\.(html|js|css|webmanifest)$/.test(filePath) || filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    },
  })
);

/**
 * Small in-memory rate limiter. A public link means strangers can hit the
 * signup endpoint in a loop; this keeps one IP from filling the studio with
 * junk accounts. Not a dependency — a Map and a clock is enough here.
 */
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, list] of hits) {
      const kept = list.filter((t) => t > cutoff);
      if (kept.length) hits.set(ip, kept);
      else hits.delete(ip);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => t > now - windowMs);
    if (recent.length >= max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: message });
    }
    recent.push(now);
    hits.set(ip, recent);
    next();
  };
}

// A whole party usually shares one public IP — college WiFi, a hotspot, or any
// home router puts everybody behind the same NAT. So these limits are sized for
// "a room full of friends all signing up at once", not for one person. They
// still stop a script making thousands of accounts. Raise them with env vars if
// you ever run a bigger event.
const signupLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.SIGNUP_LIMIT) || 120,
  message: 'A lot of new IDs from this network already. Try again in a bit.',
});
const loginLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.LOGIN_LIMIT) || 300,
  message: 'Too many sign-in attempts from this network. Give it a few minutes.',
});

// Picture clues live outside the repo — they are bulk, they are generated, and
// a clone of this project should not have to download a gigabyte of
// photographs to run. Served straight off disk, cached hard: a picture never
// changes once it is downloaded.
if (CLUE_DIR && existsSync(CLUE_DIR)) {
  app.use(
    '/media/clues',
    express.static(CLUE_DIR, {
      maxAge: '30d',
      immutable: true,
      fallthrough: false,
      index: false,
      dotfiles: 'deny',
    })
  );
}

/**
 * Is Hypnic Study up, and where?
 *
 * The browser cannot answer this for itself. A cross-origin probe to another
 * port comes back opaque — it resolves whether Study answered, 404ed or was
 * something else entirely — and on a page served over the tunnel it is blocked
 * as mixed content before it is even sent. So the studio, which is on the same
 * machine as Study, checks properly and says.
 */
const STUDY_PORT = Number(process.env.STUDY_PORT) || 3000;
let studyLastSeen = 0;
let studyUp = false;
// The proxy only counts as a route once Study is actually answering — an
// enabled proxy in front of nothing is a 503, not a destination.
// Explicit opt-in, set by the launcher and only when it built Study with a
// matching BASE_PATH. Proxying to a Study that does not know its own prefix
// serves a page whose every asset 404s — worse than no link at all.
const STUDY_PROXIED = process.env.STUDY_PROXY === '1';
let proxyReady = false;

async function pollStudy() {
  try {
    const res = await fetch(`http://127.0.0.1:${STUDY_PORT}/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(2500),
    });
    studyUp = res.status < 500;
  } catch {
    studyUp = false;
  }
  proxyReady = STUDY_PROXIED && studyUp;
  studyLastSeen = Date.now();
  return studyUp;
}

app.get('/api/study', async (req, res) => {
  // Cached briefly: every visitor's page asks this on load, and a room full of
  // phones should not become a HEAD flood against a dev server.
  if (Date.now() - studyLastSeen > 10_000) await pollStudy();

  // With the proxy on, /study is served from this very port, so it reaches
  // whoever this page reached — including a friend who came through the
  // tunnel. Same-origin, so no mixed content and no second port to expose.
  if (proxyReady) {
    return res.json({ running: true, reachable: true, url: '/study', why: null });
  }

  // Without it, Study is only on its own port, and a second port on this
  // laptop is reachable from the same WiFi and never from outside. Saying so
  // beats handing somebody in another city a link that will hang.
  const host = String(req.hostname ?? '');
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);

  res.json({
    running: studyUp,
    reachable: studyUp && local,
    url: studyUp && local ? `http://${host}:${STUDY_PORT}` : null,
    // Said plainly so the client can explain itself rather than just hiding.
    why: !studyUp ? 'not running' : local ? null : 'only on the same WiFi',
  });
});

/* --------------------------- hypnic study, proxied ------------------------ */

// Study runs on its own port, which is fine in the room and useless outside
// it: the tunnel carries this port and only this port, so a second one has no
// route from another city. Passing /study through to it means one address
// covers both, and a friend who is not here can use the trainer too.
//
// Study must be built with BASE_PATH=/study for this to work — Next has to
// know its own prefix or it will hand out asset URLs that land back here.
if (STUDY_PROXIED) {
  app.use('/study', (req, res) => {
    const proxied = httpRequest(
      {
        host: '127.0.0.1',
        port: STUDY_PORT,
        // express strips the mount path, so it has to go back on.
        path: `/study${req.originalUrl.slice('/study'.length)}`,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${STUDY_PORT}` },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      }
    );
    proxied.on('error', () => {
      if (!res.headersSent) {
        res
          .status(503)
          .type('html')
          .send('<h1>IELTS training is not running</h1><p>Start it on the laptop, then reload.</p>');
      }
    });
    req.pipe(proxied);
  });

  // Next's hot-reload and any websocket it opens ride an upgrade, which
  // express never sees. Without this the page loads and then sits there.
  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/study')) return; // socket.io handles its own
    const proxied = httpRequest({
      host: '127.0.0.1',
      port: STUDY_PORT,
      path: req.url,
      method: 'GET',
      headers: { ...req.headers, host: `127.0.0.1:${STUDY_PORT}` },
    });
    proxied.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(upstreamRes.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n')}\r\n\r\n`
      );
      if (upstreamHead?.length) socket.unshift(upstreamHead);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    proxied.on('error', () => socket.destroy());
    if (head?.length) proxied.write(head);
    proxied.end();
  });
}

app.get('/api/games', (_req, res) => res.json(listGames()));
app.get('/api/health', (_req, res) => res.json({ ok: true, members: memberCount(), ...roomStats() }));
app.get('/api/room/:code', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(room.publicInfo());
});

/* --------------------------- studio membership -------------------------- */

/**
 * QR for any link the app wants to show on screen. With no internet and a room
 * full of people, nobody should be typing an IP address off someone's laptop.
 */
app.get('/api/qr.svg', async (req, res) => {
  const text = String(req.query.text ?? '').slice(0, 512);
  if (!text) return res.status(400).send('missing text');
  try {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  } catch (err) {
    res.status(400).send('bad text');
  }
});

// The address the outside world can reach this studio on, when there is one.
// Everyone in the room joins over WiFi or the hotspot; a friend three states
// away needs a link that does not begin with 192.168, and only the launcher
// knows what that link is.
let publicUrl = process.env.PUBLIC_URL || null;

app.get('/api/where', (_req, res) => res.json({ publicUrl }));

// Set by tools/launch.mjs on the loopback interface once its tunnel is up.
// Refusing anything that did not come from this machine keeps a stranger from
// rewriting everybody's invite link to point at themselves.
app.post('/api/public-url', (req, res) => {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (!local) return res.status(403).json({ error: 'Local only.' });
  const url = String(req.body?.url ?? '');
  if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(url)) return res.status(400).json({ error: 'Not a URL.' });
  publicUrl = url;
  console.log(`[net] reachable from anywhere at ${url}`);
  io.emit('app:where', { publicUrl });
  res.json({ ok: true });
});

/* ------------------------------ getting back in --------------------------- */

// Which question a returning member set, so the form can ask it. Never the
// answer, and never whether the PIN was right — that comes later, together.
app.get('/api/recover/hint', (req, res) => res.json(recoveryHints(req.query.name)));

app.post('/api/recover', loginLimit, (req, res) => {
  const out = recoverId(req.body ?? {});
  res.status(out.error ? 400 : 200).json(out);
});

app.post('/api/recovery', requireAuth, (req, res) => {
  const out = setRecovery(req.accountId, req.body ?? {});
  res.status(out.error ? 400 : 200).json(out);
});

/* -------------------------------- the board ------------------------------- */

app.get('/api/notices', (req, res) => {
  const id = verifyToken((req.headers.authorization ?? '').replace(/^Bearer /, ''));
  res.json(noticesFor(id ?? ''));
});

app.post('/api/notices/read', requireAuth, (req, res) => res.json(markRead(req.accountId, req.body?.ids)));

// Posting is the owner's alone. The owner is whoever holds OWNER_ID — set it
// in the environment; without it nobody can post, which is the safe default
// for a studio somebody else has downloaded and is running themselves.
app.post('/api/notices', requireAuth, (req, res) => {
  if (!process.env.OWNER_ID || req.accountId !== process.env.OWNER_ID) {
    return res.status(403).json({ error: 'Only the studio can post notices.' });
  }
  const out = postNotice({ ...(req.body ?? {}), from: req.body?.from ?? 'Hypnic Teen Studio' });
  res.status(out.error ? 400 : 200).json(out);
});

app.delete('/api/notices/:id', requireAuth, (req, res) => {
  if (!process.env.OWNER_ID || req.accountId !== process.env.OWNER_ID) {
    return res.status(403).json({ error: 'Only the studio can remove notices.' });
  }
  const out = removeNotice(req.params.id);
  res.status(out.error ? 400 : 200).json(out);
});

app.get('/api/quiz', (_req, res) => res.json({ questions: publicQuiz() }));
app.get('/api/titles', (_req, res) => res.json(titleCatalogue()));

app.post('/api/auth/signup', signupLimit, (req, res) => {
  const result = signup(req.body ?? {});
  res.status(result.error ? 400 : 200).json(result);
});

app.post('/api/auth/login', loginLimit, (req, res) => {
  const result = login(req.body ?? {});
  res.status(result.error ? 401 : 200).json(result);
});

/** Resolves the bearer token into req.accountId, or 401s. */
function requireAuth(req, res, next) {
  const token = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const id = verifyToken(token);
  if (!id) return res.status(401).json({ error: 'Sign in first.' });
  req.accountId = id;
  next();
}

app.get('/api/me', requireAuth, (req, res) => res.json({ profile: publicProfile(getProfile(req.accountId)) }));

app.get('/api/leaderboard', (req, res) => {
  const { gameId, sort, limit } = req.query;
  res.json(
    leaderboard({
      gameId: gameId || undefined,
      sort: ['points', 'wins', 'best'].includes(sort) ? sort : 'points',
      limit: Math.min(Number(limit) || 50, 100),
    })
  );
});

// Everything else falls through to the single-page shell.
app.use((_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

/* ------------------------------- tournaments ------------------------------ */

// Who is on the site right now, so a bracket can tell people their tie is
// ready without them having to be staring at the tournament page.
/** @type {Map<string, Set<string>>} accountId -> socket ids */
const online = new Map();

const seatOnline = (accountId, socketId) => {
  if (!online.has(accountId)) online.set(accountId, new Set());
  online.get(accountId).add(socketId);
};
const seatOffline = (accountId, socketId) => {
  const seats = online.get(accountId);
  if (!seats) return;
  seats.delete(socketId);
  if (!seats.size) online.delete(accountId);
};
const tellPlayer = (accountId, event, payload) => {
  for (const sid of online.get(accountId) ?? []) io.to(sid).emit(event, payload);
};

/** How long a tie waits for both sides before CPUs stand in for the missing. */
const TIE_GRACE_MS = 45_000;

attachNotices(io);
attachSocial({
  server: io,
  tellPlayer: (id, event, payload) => tellPlayer(id, event, payload),
  getProfile: (id) => publicProfile(getProfile(id)),
});

// Members who joined before recovery existed have no way back in if they lose
// their ID — which is exactly how this feature came to be written. Ask them
// once, on the board, rather than interrupting a match to demand it.
ensureNotice('set-recovery', {
  title: 'Add a way back into your account',
  body:
    'Your Hypnic ID is the only key to your points, titles and history — and it is easy to lose. ' +
    'Open your profile and set a recovery question, so your name and PIN can find it again if you ever clear your browser.',
  kind: 'warning',
  pinned: true,
});

attachTournaments({
  server: io,
  open: ({ gameId, seats, tourneyId, matchId, label, settings }) => {
    const room = createRoom(gameId, io);
    if (!room) return null;
    room.tourney = { id: tourneyId, matchId, label, expected: seats.map((s) => s.playerId) };
    if (settings && Object.keys(settings).length) room.applySettings(settings);
    room.armTie(TIE_GRACE_MS);
    for (const seat of seats) {
      tellPlayer(seat.playerId, 'tourney:match', { code: room.code, tourneyId, label });
    }
    console.log(`[cup] ${label} → room ${room.code} (${seats.length} seats)`);
    return room.code;
  },
});

io.on('connection', (socket) => {
  // Set once the socket is inside a room; used by every later handler.
  let ctx = null;
  /** The signed-in account behind this socket, once it identifies itself. */
  let account = null;

  socket.emit('app:version', { build: BUILD });

  // Hopping straight from one room to another — which is exactly what accepting
  // an invite does — must vacate the old seat, or the room you left keeps
  // counting you and waits for an answer that is never coming.
  const leaveCurrent = () => {
    const previous = ctx && getRoom(ctx.code);
    if (!previous) return;
    socket.leave(previous.code);
    previous.markDisconnected(ctx.playerId);
    if (account) setWhereabouts(account.id, null);
    previous.broadcastRoom();
    ctx = null;
  };

  const enter = (room, playerId) => {
    if (ctx && ctx.code !== room.code) leaveCurrent();
    ctx = { code: room.code, playerId };
    // The roster says "in a lobby" or "playing" rather than just "online".
    if (account) setWhereabouts(account.id, { code: room.code, phase: room.phase, game: room.game?.name, open: true });
    socket.join(room.code);
    socket.emit('room:joined', { room: room.publicInfo(), youId: playerId });
    room.broadcastRoom();
    if (room.phase === 'playing' && room.state) {
      socket.emit('game:start', room.startFrameFor(playerId));
    }
  };

  /** Identity always comes from the signed token, never from the client's claim. */
  const authenticate = (token) => {
    const id = verifyToken(token);
    const profile = id ? getProfile(id) : null;
    // Remember the face at the door: tournaments need to reach a player who is
    // on the site but not in any room.
    if (profile && account?.id !== profile.id) {
      if (account) seatOffline(account.id, socket.id);
    // Only really gone once the last tab closes.
    if (account && !online.has(account.id)) depart(account.id);
      account = profile;
      seatOnline(profile.id, socket.id);
    }
    return profile;
  };

  // Signing in without joining anything — the tournament board needs to know
  // you are here, and you need to know if a tie of yours is already running.
  socket.on('hello', ({ token } = {}, ack) => {
    const me = authenticate(token);
    if (!me) return ack?.({ error: 'Your session expired. Sign in again.' });
    arrive(me);
    const waiting = liveMatchFor(me.id);
    if (waiting) socket.emit('tourney:match', { code: waiting.roomCode, tourneyId: waiting.tourneyId, label: waiting.name });
    ack?.({ ok: true, tournaments: listTournaments() });
  });

  socket.on('room:create', ({ gameId, token }, ack) => {
    const account = authenticate(token);
    if (!account) return ack?.({ error: 'Your session expired. Sign in again.' });
    if (!getGame(gameId)) return ack?.({ error: 'Unknown game.' });

    const room = createRoom(gameId, io);
    const player = room.addPlayer({ id: account.id, name: account.name, socketId: socket.id });
    room.hostId = player.id;
    enter(room, player.id);
    ack?.({ ok: true, code: room.code });
  });

  socket.on('room:join', ({ code, token }, ack) => {
    const account = authenticate(token);
    if (!account) return ack?.({ error: 'Your session expired. Sign in again.' });

    const room = getRoom(code);
    if (!room) return ack?.({ error: 'No room with that code.' });

    const known = room.players.has(account.id);
    const connected = [...room.players.values()].filter((p) => p.connected).length;
    if (!known && connected >= (room.game?.maxPlayers ?? 8)) {
      return ack?.({ error: 'That room is full.' });
    }
    const player = room.addPlayer({ id: account.id, name: account.name, socketId: socket.id });
    enter(room, player.id);
    ack?.({ ok: true, code: room.code, gameId: room.gameId });
  });

  socket.on('room:ready', (ready) => {
    const room = ctx && getRoom(ctx.code);
    const player = room?.players.get(ctx.playerId);
    if (!player) return;
    player.ready = Boolean(ready);
    room.broadcastRoom();
  });

  socket.on('room:start', (_payload, ack) => {
    const room = ctx && getRoom(ctx.code);
    if (!room) return ack?.({ error: 'Not in a room.' });
    if (room.hostId !== ctx.playerId) return ack?.({ error: 'Only the host can start.' });
    ack?.(room.start());
  });

  // CPU players, so nobody has to wait for a room to fill up to play.
  socket.on('room:bot', ({ add, id } = {}, ack) => {
    const room = ctx && getRoom(ctx.code);
    if (!room) return ack?.({ error: 'Not in a room.' });
    if (room.hostId !== ctx.playerId) return ack?.({ error: 'Only the host can add CPU players.' });
    ack?.(add === false ? room.removeBot(id) : room.addBot());
  });

  socket.on('room:fill', (_payload, ack) => {
    const room = ctx && getRoom(ctx.code);
    if (!room) return ack?.({ error: 'Not in a room.' });
    if (room.hostId !== ctx.playerId) return ack?.({ error: 'Only the host can add CPU players.' });
    ack?.(room.fillWithBots());
  });

  socket.on('room:settings', (patch, ack) => {
    const room = ctx && getRoom(ctx.code);
    if (!room) return ack?.({ error: 'Not in a room.' });
    if (room.hostId !== ctx.playerId) return ack?.({ error: 'Only the host can change the setup.' });
    ack?.(room.applySettings(patch ?? {}));
  });

  socket.on('room:lobby', () => {
    const room = ctx && getRoom(ctx.code);
    if (room && room.hostId === ctx.playerId) room.returnToLobby();
  });

  socket.on('room:leave', leaveCurrent);

  socket.on('game:action', (action) => {
    const room = ctx && getRoom(ctx.code);
    room?.handleAction(ctx.playerId, action);
  });

  // The host can call everyone who is on the site but not already playing.
  // One shout per room every half minute — an invite people learn to ignore is
  // worse than no invite at all.
  socket.on('room:invite', (_payload, ack) => {
    const room = ctx && getRoom(ctx.code);
    if (!room) return ack?.({ error: 'Not in a room.' });
    if (room.hostId !== ctx.playerId) return ack?.({ error: 'Only the host can invite.' });

    const now = Date.now();
    const waited = now - (room.lastInviteAt ?? 0);
    if (waited < INVITE_COOLDOWN_MS) {
      return ack?.({ error: `Wait ${Math.ceil((INVITE_COOLDOWN_MS - waited) / 1000)}s before calling again.` });
    }
    room.lastInviteAt = now;

    const host = room.players.get(ctx.playerId);
    const seated = [...room.players.values()].filter((p) => p.connected).length;

    // Count who this actually reaches, so a shout into an empty room says so
    // instead of reporting a cheerful success nobody heard.
    const inRoom = io.sockets.adapter.rooms.get(room.code) ?? new Set();
    const reached = [...io.sockets.sockets.keys()].filter((id) => !inRoom.has(id)).length;

    // Everyone except the people already sitting in this room.
    socket.broadcast.except(room.code).emit('invite:new', {
      code: room.code,
      game: room.game?.name ?? 'a game',
      emoji: room.game?.emoji ?? '🎮',
      host: host?.name ?? 'Someone',
      players: seated,
      at: now,
    });
    console.log(`[invite] ${host?.name ?? '?'} called ${reached} player(s) to ${room.code}`);
    ack?.({ ok: true, reached });
  });

  /* ------------------------------ tournaments ----------------------------- */

  // Every one of these needs a signed-in account, and none of them trusts the
  // client for who that is.
  const withAccount = (token, ack, fn) => {
    const me = authenticate(token);
    if (!me) return ack?.({ error: 'Your session expired. Sign in again.' });
    ack?.(fn(me));
  };

  /* -------------------------------- the room ------------------------------ */

  // Who is here, and where. The roster is only useful if it is current, so
  // every arrival, departure and room move is reported.
  socket.on('social:here', ({ token } = {}, ack) => {
    const me = authenticate(token);
    if (!me) return ack?.({ error: 'Sign in first.' });
    arrive(me);
    ack?.({
      ok: true,
      roster: roster(me.id),
      directory: directory(me.id, memberIds),
      friends: friendList(me.id),
      requests: requestsFor(me.id),
      unread: totalUnread(me.id),
    });
  });

  socket.on('social:card', ({ id } = {}, ack) => {
    const card = publicCard(id);
    ack?.(card ? { ok: true, card } : { error: 'No member with that ID.' });
  });

  const social = (token, ack, fn) => {
    const me = authenticate(token);
    if (!me) return ack?.({ error: 'Sign in first.' });
    ack?.(fn(me));
  };

  socket.on('social:add', ({ token, id } = {}, ack) => social(token, ack, (me) => requestFriend(me.id, id)));
  socket.on('social:accept', ({ token, id } = {}, ack) =>
    social(token, ack, (me) => ({ ...acceptFriend(me.id, id), friends: friendList(me.id) })));
  socket.on('social:decline', ({ token, id } = {}, ack) => social(token, ack, (me) => declineFriend(me.id, id)));
  socket.on('social:remove', ({ token, id } = {}, ack) =>
    social(token, ack, (me) => ({ ...unfriend(me.id, id), friends: friendList(me.id) })));

  socket.on('social:say', ({ token, id, text } = {}, ack) => social(token, ack, (me) => sendMessage(me.id, id, text)));
  socket.on('social:thread', ({ token, id } = {}, ack) =>
    social(token, ack, (me) => ({ ok: true, ...conversation(me.id, id) })));

  // An invite aimed at one person, carrying the code so they arrive in a tap.
  socket.on('social:invite', ({ token, id } = {}, ack) =>
    social(token, ack, (me) => {
      const room = ctx && getRoom(ctx.code);
      if (!room) return { error: 'Open a room first.' };
      return inviteOne(me.id, id, { code: room.code, game: room.game?.name, emoji: room.game?.emoji });
    }));

  socket.on('tourney:list', (_p, ack) => ack?.({ ok: true, tournaments: listTournaments() }));

  socket.on('tourney:create', ({ token, ...spec } = {}, ack) =>
    withAccount(token, ack, (me) => createTournament({ ...spec, hostId: me.id, hostName: me.name })));

  socket.on('tourney:join', ({ token, id, team } = {}, ack) =>
    withAccount(token, ack, (me) => tourneyRegister(id, { id: me.id, name: me.name }, String(team ?? ''))));

  socket.on('tourney:leave', ({ token, id } = {}, ack) =>
    withAccount(token, ack, (me) => tourneyWithdraw(id, me.id)));

  socket.on('tourney:pair', ({ token, id } = {}, ack) =>
    withAccount(token, ack, (me) => pairStrays(id, me.id)));

  socket.on('tourney:start', ({ token, id } = {}, ack) =>
    withAccount(token, ack, (me) => startTournament(id, me.id)));

  socket.on('tourney:get', ({ id } = {}, ack) => {
    const t = getTournament(id);
    ack?.(t ? { ok: true, tournament: t } : { error: 'No such tournament.' });
  });

  socket.on('chat:send', (text) => {
    const room = ctx && getRoom(ctx.code);
    const player = room?.players.get(ctx.playerId);
    if (!player) return;
    const message = String(text ?? '').slice(0, 200).trim();
    if (message) {
      io.to(room.code).emit('chat:message', { name: player.name, text: message, at: Date.now() });
    }
  });

  socket.on('disconnect', () => {
    if (account) seatOffline(account.id, socket.id);
    const room = ctx && getRoom(ctx.code);
    if (!room) return;
    room.markDisconnected(ctx.playerId);
    room.broadcastRoom();
  });
});

// A public link means one unexpected request must never take the studio down
// mid-match. Log and keep serving.
process.on('uncaughtException', (err) => console.error('[fatal] uncaught:', err));
process.on('unhandledRejection', (err) => console.error('[fatal] unhandled rejection:', err));

// Express error handler — must take four arguments to be recognised as one.
app.use((err, _req, res, _next) => {
  console.error('[http]', err.message);
  res.status(500).json({ error: 'Something broke on our side.' });
});

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

httpServer.listen(PORT, '0.0.0.0', async () => {
  const games = listGames().length;
  const addresses = lanAddresses();
  console.log('\n  \x1b[36m✦ HYPNIC TEEN\x1b[0m \x1b[2m·\x1b[0m FUN WORLD');
  console.log(`  ${games} game${games === 1 ? '' : 's'} loaded\n`);
  console.log(`  On this PC     http://localhost:${PORT}`);
  for (const ip of addresses) {
    console.log(`  Friends join   \x1b[36mhttp://${ip}:${PORT}\x1b[0m`);
  }

  // A scannable code beats reading an IP address out to twenty people.
  const joinUrl = addresses.length ? `http://${addresses[0]}:${PORT}` : null;
  if (joinUrl) {
    try {
      const qr = await QRCode.toString(joinUrl, { type: 'terminal', small: true });
      console.log(`\n  Point a phone camera at this — no typing, no internet needed:\n`);
      console.log(qr);
    } catch {
      /* a terminal that can't draw it still has the URL above */
    }
  }

  console.log('  (Everyone on the same WiFi or router. Ctrl+C to stop.)\n');

  // Never blocks startup — the built-in banks are already loaded.
  warmUpAI().catch((err) => console.warn('  [ai] warm-up failed:', err.message));
  if (!aiEnabled()) {
    console.log('  Tip: set AI_GAME_MASTER=1 (and install @anthropic-ai/sdk) for fresh questions each week.\n');
  }
});
